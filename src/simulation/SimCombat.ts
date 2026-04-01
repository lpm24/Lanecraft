/**
 * Combat resolution: melee/ranged targeting, towers, projectiles, and status effects.
 *
 * Tick functions (called from simulateTick in GameState.ts):
 *   tickCombat        — target acquisition, chase, melee/ranged/caster attacks, death cleanup
 *   tickHQDefense     — HQ auto-attack against nearby enemies
 *   tickTowers        — tower targeting, firing, race-specific specials
 *   tickProjectiles   — projectile movement, impact, AoE splash
 *   tickEffects       — visual effect aging (floating text, particles, pings)
 *   tickStatusEffects — burn DoT, shield expiry, regen, SEARED/BLIGHT combos
 */
import {
  GameState, Team, Race, Lane,
  BuildingType, BuildingState, UnitState, StatusType,
  TICK_RATE, HQ_WIDTH, HQ_HEIGHT, isAbilityBuilding,
  type HarvesterState,
} from './types';
import {
  TOWER_STATS, UNIT_STATS, getUpgradeNodeDef,
} from './data';
import {
  genId, getUnitUpgradeMultipliers, getProjectileVisual,
  addSound, addFloatingText, addDeathParticles, addCombatEvent,
  compactInPlace, hasStatus,
  _combatGrid, _unitById, _attackerCount, _combatOrder,
  _projectileRemoveSet,
} from './SimShared';
import {
  getHQPosition,
  getLanePath, interpolatePath, findNearestPathProgress,
  getCachedPathLength,
} from './SimLayout';
import {
  dealDamage, applyStatus, applyKnockback, healUnit, applyWound, applyVulnerable,
  getEffectiveSpeed, getEffectiveDamage,
  clampToArenaBounds,
  moveWithSlide, applyCasterSupport, applyOnHitEffects,
  trackHealing,
} from './SimMovement';
import {
  dropDiamond, trackDeathResources,
  killHarvester,
} from './SimAbilities';

export function tickCombat(state: GameState): void {
  // _unitById and _combatGrid already built at top of simulateTick() — reuse them
  const unitById = _unitById;
  const AGGRO_BONUS = 2.5;
  const AGGRO_LEASH = 3.5;
  let meleeHitSounds = 0; // simulation-side throttle (SoundManager has its own per-category cooldown too)

  // Count how many units are already targeting each enemy (for target spreading)
  _attackerCount.clear();
  for (const u of state.units) {
    if (u.hp <= 0 || u.targetId === null) continue;
    _attackerCount.set(u.targetId, (_attackerCount.get(u.targetId) ?? 0) + 1);
  }
  const attackerCount = _attackerCount;

  // Reset transient building-attack flags (set below when units attack towers/HQ)
  for (const u of state.units) u._attackBuildingIdx = undefined;

  // Shuffle combat processing order to prevent first-mover advantage
  // Fisher-Yates shuffle using deterministic rng for lockstep safety
  _combatOrder.length = 0;
  for (const u of state.units) _combatOrder.push(u);
  const combatOrder = _combatOrder;
  for (let i = combatOrder.length - 1; i > 0; i--) {
    const j = Math.floor(state.rng() * (i + 1));
    const tmp = combatOrder[i]; combatOrder[i] = combatOrder[j]; combatOrder[j] = tmp;
  }

  for (const unit of combatOrder) {
    // Goblin flee: when below 25% HP, run away for 2 seconds then re-engage
    const ownerRace = state.players[unit.playerId]?.race;
    if (ownerRace === Race.Goblins) {
      if (unit.fleeTimer != null && unit.fleeTimer > 0) {
        unit.fleeTimer--;
        unit.targetId = null; // drop target while fleeing
        // Move backward along path
        if (unit.pathProgress > 0) {
          const speed = getEffectiveSpeed(unit, state) * 1.5; // run faster when fleeing
          const pathLen = getCachedPathLength(unit.team, unit.lane, state.mapDef);
          const path = getLanePath(unit.team, unit.lane, state.mapDef);
          const movePerTick = speed / TICK_RATE;
          // Get backward direction from path tangent — move from ACTUAL position,
          // not from interpolatePath(pathProgress). pathProgress can diverge far
          // from x/y after combat chase moves, so snapping to it would teleport.
          const p0 = interpolatePath(path, Math.max(0, unit.pathProgress - 0.02));
          const p1 = interpolatePath(path, unit.pathProgress);
          const fwdX = p1.x - p0.x, fwdY = p1.y - p0.y;
          const fwdLen = Math.sqrt(fwdX * fwdX + fwdY * fwdY) || 1;
          unit.x -= (fwdX / fwdLen) * movePerTick;
          unit.y -= (fwdY / fwdLen) * movePerTick;
          clampToArenaBounds(unit, 0.35, state.mapDef);
          unit.pathProgress = Math.max(0, unit.pathProgress - movePerTick / pathLen);
        }
        if (unit.fleeTimer <= 0) {
          // Flee ended — enter cooldown so unit re-engages before fleeing again
          unit.fleeTimer = -3 * TICK_RATE; // 3 second cooldown before can flee again
        }
        continue; // skip combat while fleeing
      }
      // Cooldown ticking (negative fleeTimer = cooldown)
      if (unit.fleeTimer != null && unit.fleeTimer < 0) {
        unit.fleeTimer++;
        // Once cooldown expires, reset to allow another flee
        if (unit.fleeTimer >= 0) unit.fleeTimer = undefined;
      }
      // Trigger flee when dropping below 25% HP
      if (unit.hp > 0 && unit.hp < unit.maxHp * 0.25 && unit.fleeTimer == null) {
        unit.fleeTimer = 2 * TICK_RATE; // 2 seconds of running
        unit.targetId = null;
        continue;
      }
    }

    // Check if current target is still valid
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (!target || target.hp <= 0) unit.targetId = null;
      else {
        const dist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (dist > unit.range + AGGRO_LEASH) unit.targetId = null;
      }
    }
    // Acquire new target — spread across enemies to form a battle line
    // Siege units never lock onto units — they follow their lane path and fire at buildings
    if (unit.targetId === null && !unit.upgradeSpecial?.isSiegeUnit) {
      let best: UnitState | null = null;
      let bestScore = Infinity;
      const aggroRange = unit.range + AGGRO_BONUS;
      for (const o of _combatGrid.getNearby(unit.x, unit.y, aggroRange)) {
        if (o.team === unit.team) continue;
        const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
        if (d > aggroRange) continue;
        // Penalize targets that already have many melee attackers
        // so units spread across the front line instead of dog-piling.
        // Cap at 3 tiles so units don't ignore nearby enemies to walk past them.
        const attackers = attackerCount.get(o.id) ?? 0;
        const crowdPenalty = unit.range <= 2
          ? Math.min(attackers * 1.2, 3.0)
          : attackers * 0.3;
        const score = d + crowdPenalty;
        if (score < bestScore || (score === bestScore && best && o.id < best.id)) { best = o; bestScore = score; }
      }
      if (best) {
        unit.targetId = best.id;
        unit.stuckTicks = 0; // clear stuck counter — unit is now actively engaging
        attackerCount.set(best.id, (attackerCount.get(best.id) ?? 0) + 1);
      }
    }

    // Chase current target — all unit types try to reach optimal range.
    // Units steer around allied blockers to find openings and envelop enemies.
    if (unit.targetId !== null) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const dx = target.x - unit.x;
        const dy = target.y - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const isMelee = unit.range <= 2;

        const tooFar = dist > unit.range + 0.15;
        const tooClose = !isMelee && dist < unit.range * 0.4 && dist > 0.5;

        if ((tooFar || tooClose) && dist > 0.001) {
          const movePerTick = getEffectiveSpeed(unit, state) / TICK_RATE;

          // Direction toward (or away from) target
          const dirX = dx / dist, dirY = dy / dist;
          const chaseDir = tooClose ? -1 : 1; // retreat if too close (ranged)

          // Count allies blocking the path to the target
          let blockCount = 0;
          let blockCx = 0, blockCy = 0;
          if (tooFar) {
            for (const ally of _combatGrid.getNearby(unit.x, unit.y, 3.0)) {
              if (ally.id === unit.id || ally.team !== unit.team) continue;
              const ax = ally.x - unit.x, ay = ally.y - unit.y;
              const ad = Math.sqrt(ax * ax + ay * ay);
              if (ad > 3.0 || ad < 0.1) continue;
              // Is ally between us and the target?
              const dot = (ax * dirX + ay * dirY) / ad;
              if (dot > 0.2) {
                const cross = Math.abs(ax * dirY - ay * dirX);
                if (cross < 1.5) {
                  blockCount++;
                  blockCx += ally.x;
                  blockCy += ally.y;
                }
              }
            }
          }

          let goalX: number, goalY: number;
          let step: number;

          if (blockCount >= 1 && tooFar) {
            // Flanking: steer around allied blockers
            blockCx /= blockCount;
            blockCy /= blockCount;
            const perpX = -dirY, perpY = dirX;
            // Choose side: away from blocker centroid
            const toBcx = blockCx - unit.x, toBcy = blockCy - unit.y;
            const side = perpX * toBcx + perpY * toBcy;
            const flankX = side > 0 ? -perpX : perpX;
            const flankY = side > 0 ? -perpY : perpY;
            // Heavier flanking with more blockers, melee flanks harder than ranged
            const blend = isMelee
              ? (blockCount >= 3 ? 0.85 : blockCount >= 2 ? 0.7 : 0.55)
              : (blockCount >= 2 ? 0.5 : 0.35);
            const steerX = dirX * (1 - blend) + flankX * blend;
            const steerY = dirY * (1 - blend) + flankY * blend;
            const sLen = Math.sqrt(steerX * steerX + steerY * steerY) || 1;
            step = movePerTick;
            goalX = unit.x + (steerX / sLen) * step * 4;
            goalY = unit.y + (steerY / sLen) * step * 4;
          } else {
            // Direct chase (or retreat for ranged too close)
            step = tooFar ? Math.min(movePerTick, dist - unit.range) : movePerTick * 0.6;
            goalX = unit.x + dirX * chaseDir * step * 4;
            goalY = unit.y + dirY * chaseDir * step * 4;
          }

          moveWithSlide(unit, goalX, goalY, step, state.diamondCells, state.mapDef);
          clampToArenaBounds(unit, 0.35, state.mapDef);
        } else if (dist > 0.5) {
          // In range — gentle lateral drift so units spread the battle line
          // instead of stacking on the same spot.
          const movePerTick = getEffectiveSpeed(unit, state) / TICK_RATE;
          const perpX = -dy / dist, perpY = dx / dist;
          let lateralForce = 0;
          for (const ally of _combatGrid.getNearby(unit.x, unit.y, 2.0)) {
            if (ally.id === unit.id || ally.team !== unit.team) continue;
            const ax = ally.x - unit.x, ay = ally.y - unit.y;
            const ad = Math.sqrt(ax * ax + ay * ay);
            if (ad > 2.0 || ad < 0.05) continue;
            const proj = ax * perpX + ay * perpY;
            const urgency = (2.0 - ad) / 2.0;
            lateralForce -= proj * urgency * 0.3;
          }
          if (Math.abs(lateralForce) > 0.02) {
            const driftStep = movePerTick * 0.25;
            const sign = lateralForce > 0 ? 1 : -1;
            const nx = unit.x + perpX * sign * driftStep * 3;
            const ny = unit.y + perpY * sign * driftStep * 3;
            moveWithSlide(unit, nx, ny, driftStep, state.diamondCells, state.mapDef);
            clampToArenaBounds(unit, 0.35, state.mapDef);
          }
        }
      }
    }

    // Siege units: always prioritize building targets — fire cannonball at nearest enemy building in range
    if (unit.upgradeSpecial?.isSiegeUnit && unit.attackTimer <= 0 && unit.range > 2) {
      const sp = unit.upgradeSpecial;
      let bestSiegeBuilding: BuildingState | null = null;
      let bestSiegeDist = Infinity;
      for (const b of state.buildings) {
        if (b.buildGrid !== 'alley') continue; // only alley buildings are targetable
        const bPlayer = state.players[b.playerId];
        if (!bPlayer || bPlayer.team === unit.team) continue;
        if (b.hp <= 0) continue;
        const bd = Math.sqrt((b.worldX - unit.x) ** 2 + (b.worldY - unit.y) ** 2);
        if (bd <= unit.range + 0.15 && bd < bestSiegeDist) { bestSiegeBuilding = b; bestSiegeDist = bd; }
      }
      if (bestSiegeBuilding) {
        const effDmg = getEffectiveDamage(unit, state);
        const siegeRace = state.players[unit.playerId]?.race ?? Race.Crown;
        const siegeVis = getProjectileVisual(siegeRace, unit.category, unit.upgradeNode);
        state.projectiles.push({
          id: genId(state), x: unit.x, y: unit.y,
          targetId: 0,
          targetX: bestSiegeBuilding.worldX,
          targetY: bestSiegeBuilding.worldY,
          damage: effDmg,
          speed: 8, aoeRadius: sp?.splashRadius ?? 3, team: unit.team,
          visual: siegeVis.visual, spriteKey: siegeVis.spriteKey,
          sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
          splashDamagePct: sp?.splashDamagePct ?? 0.60,
          buildingDamageMult: sp?.buildingDamageMult ?? 3.0,
          extraBurnStacks: sp?.extraBurnStacks,
          extraSlowStacks: sp?.extraSlowStacks,
        });
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        unit._attackBuildingIdx = state.buildings.indexOf(bestSiegeBuilding);
        addSound(state, 'ranged_hit', unit.x, unit.y, { race: state.players[unit.playerId]?.race });
        continue; // skip regular attack this tick
      }
    }

    // Attack — tolerance of 0.15 tiles so units that are clamped/blocked
    // just outside nominal range can still attack (prevents whiff bug).
    if (unit.targetId !== null && unit.attackTimer <= 0) {
      const target = unitById.get(unit.targetId);
      if (target) {
        const targetDist = Math.sqrt((target.x - unit.x) ** 2 + (target.y - unit.y) ** 2);
        if (targetDist > unit.range + 0.15) {
          // Not in attack range yet (still chasing).
          if (unit.attackTimer > 0) unit.attackTimer--;
          continue;
        }

        const race = state.players[unit.playerId].race;
        const isCaster = unit.category === 'caster';

        if (isCaster && race !== Race.Demon) {
          // Support casters: perform support ability + fire AoE at enemy
          const sp = unit.upgradeSpecial;
          const isCrownMage = race === Race.Crown && sp?.crownMage;

          // Crown mage branch skips shielding — pure damage dealer
          if (!isCrownMage) {
            applyCasterSupport(state, unit, race, sp);
          }

          // Geists caster: single-target projectile (no AoE — summons skeletons from deaths instead)
          if (race === Race.Geists) {
            const effDmg = getEffectiveDamage(unit, state);
            const gVis = getProjectileVisual(race, 'caster', unit.upgradeNode);
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 12, aoeRadius: 0, team: unit.team,
              visual: gVis.visual, spriteKey: gVis.spriteKey,
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              lifestealPct: sp?.lifeDrainPct ?? 0.1,
              applyVulnerable: sp?.applyVulnerable,
            });
          } else if (isCrownMage) {
            // Crown mage branch: high-damage AoE with spell effects
            const aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
            const effDmg = getEffectiveDamage(unit, state);
            const cmVis = getProjectileVisual(race, 'caster', unit.upgradeNode);
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 10, aoeRadius, team: unit.team,
              visual: cmVis.visual, spriteKey: cmVis.spriteKey,
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
            });
            addCombatEvent(state, { type: 'pulse', x: unit.x, y: unit.y, radius: aoeRadius, color: '#ffd700' });
            // Battle Magus: shield self on attack
            if (sp?.shieldSelf) {
              applyStatus(unit, StatusType.Shield, 1, state);
              unit.shieldHp = Math.max(unit.shieldHp, 12);
            }
          } else if (race !== Race.Crown) {
          // Crown (shield caster) doesn't fire AoE projectile
            let aoeRadius = (race === Race.Deep || race === Race.Tenders ? 4 : 3) + (sp?.aoeRadiusBonus ?? 0);
            // Research: Wild Nature's Wrath — +1 AoE radius for caster
            const cbuGen = state.players[unit.playerId]?.researchUpgrades;
            if (cbuGen?.raceUpgrades['wild_caster_1']) aoeRadius += 1;
            const effDmg = getEffectiveDamage(unit, state);
            const cVis = getProjectileVisual(race, 'caster', unit.upgradeNode);
            // Caster chain lightning: fire chain projectiles to nearby enemies (Oozlings, Goblins, Tenders)
            const casterChainCount = sp?.extraChainTargets ?? 0;
            if (casterChainCount > 0) {
              // Primary single-target hit (no AoE) + chain bounces
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: target.id, damage: effDmg,
                speed: 12, aoeRadius: 0, team: unit.team,
                visual: cVis.spriteKey ? cVis.visual : 'orb', spriteKey: cVis.spriteKey,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                extraSlowStacks: sp?.extraSlowStacks,
                applyWound: sp?.applyWound,
                applyVulnerable: sp?.applyVulnerable,
              });
              const chainPct = sp?.chainDamagePct ?? 0.5;
              const chained: number[] = [target.id];
              let lastX = target.x, lastY = target.y;
              for (let ci = 0; ci < casterChainCount; ci++) {
                let chainTgt: UnitState | null = null;
                let chainDist = Infinity;
                for (const o of _combatGrid.getNearby(lastX, lastY, 4)) {
                  if (o.team === unit.team || chained.includes(o.id)) continue;
                  const d = (o.x - lastX) ** 2 + (o.y - lastY) ** 2;
                  if (d <= 16 && (d < chainDist || (d === chainDist && chainTgt && o.id < chainTgt.id))) { chainTgt = o; chainDist = d; }
                }
                if (!chainTgt) break;
                chained.push(chainTgt.id);
                addCombatEvent(state, { type: 'chain', x: lastX, y: lastY, x2: chainTgt.x, y2: chainTgt.y, color: '#7c4dff' });
                state.projectiles.push({
                  id: genId(state), x: lastX, y: lastY,
                  targetId: chainTgt.id, damage: Math.round(effDmg * chainPct),
                  speed: 20, aoeRadius: 0, team: unit.team, visual: 'orb',
                  sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                });
                lastX = chainTgt.x; lastY = chainTgt.y;
              }
            } else {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: target.id, damage: effDmg,
                speed: 10, aoeRadius, team: unit.team,
                visual: cVis.spriteKey ? cVis.visual : 'circle', spriteKey: cVis.spriteKey,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                extraBurnStacks: sp?.extraBurnStacks,
                extraSlowStacks: sp?.extraSlowStacks,
                applyWound: sp?.applyWound,
                applyVulnerable: sp?.applyVulnerable,
              });
            }
          }
        } else if (isCaster) {
          // Demon caster: pure damage AoE, no support
          const sp = unit.upgradeSpecial;
          const cbu = state.players[unit.playerId]?.researchUpgrades;
          let aoeRadius = 3 + (sp?.aoeRadiusBonus ?? 0);
          // Research: Demon Eye of Destruction — +1.5 AoE radius for caster
          if (cbu?.raceUpgrades['demon_ranged_2']) aoeRadius += 1.5;
          const effDmg = getEffectiveDamage(unit, state);
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: effDmg,
            speed: 10, aoeRadius, team: unit.team, visual: 'circle',
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
          });
        } else if (unit.range > 2) {
          // Ranged unit: fire projectile
          const sp = unit.upgradeSpecial;
          const splashR = sp?.splashRadius ?? 0;
          let effDmg = getEffectiveDamage(unit, state);
          let rangedAoe = splashR;
          let rangedSplashPct = sp?.splashDamagePct;
          // Research ranged upgrades applied at projectile creation
          const rbu = state.players[unit.playerId]?.researchUpgrades;
          if (rbu) {
            // Crown Piercing Arrows: +20% damage
            if (rbu.raceUpgrades['crown_ranged_1']) effDmg = Math.round(effDmg * 1.20);
            // Demon Hellfire Arrows: +10% damage
            if (rbu.raceUpgrades['demon_ranged_1']) effDmg = Math.round(effDmg * 1.10);
            // Horde Bombardier: add AoE to ranged projectiles
            if (rbu.raceUpgrades['horde_ranged_2'] && rangedAoe === 0) { rangedAoe = 2.5; rangedSplashPct = 0.30; }
            // Horde Berserker Howl: +25% ranged damage while hasted
            if (rbu.raceUpgrades['horde_caster_2'] && hasStatus(unit.statusEffects, StatusType.Haste)) effDmg = Math.round(effDmg * 1.25);
            // Deep Anchor Shot: +100% damage for siege units
            if (rbu.raceUpgrades['deep_ranged_2'] && (sp?.isSiegeUnit ?? false)) effDmg = Math.round(effDmg * 2.00);
          }
          const isSiege = sp?.isSiegeUnit ?? false;
          const rVis = getProjectileVisual(race, 'ranged', unit.upgradeNode);
          state.projectiles.push({
            id: genId(state), x: unit.x, y: unit.y,
            targetId: target.id, damage: effDmg,
            speed: isSiege ? 8 : 15,
            aoeRadius: rangedAoe, team: unit.team,
            visual: rVis.visual, spriteKey: rVis.spriteKey,
            sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            extraBurnStacks: sp?.extraBurnStacks,
            extraSlowStacks: sp?.extraSlowStacks,
            splashDamagePct: rangedSplashPct,
            lifestealPct: isSiege ? (sp?.lifestealPct) : (race === Race.Geists ? 0.1 : undefined),
            buildingDamageMult: isSiege ? (sp?.buildingDamageMult ?? 3.0) : undefined,
            critChance: UNIT_STATS[race]?.[BuildingType.RangedSpawner]?.critChance,
            critMult: UNIT_STATS[race]?.[BuildingType.RangedSpawner]?.critMult,
          });
          // Research: Crown Volley — fire extra projectile at 40% damage
          if (rbu?.raceUpgrades['crown_ranged_2']) {
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: Math.round(effDmg * 0.40),
              speed: 15, aoeRadius: 0, team: unit.team,
              visual: rVis.visual, spriteKey: rVis.spriteKey,
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
            });
          }
          // Research: Goblins Lucky Shot — 15% chance extra projectile
          if (rbu?.raceUpgrades['goblins_ranged_2'] && state.rng() < 0.15) {
            state.projectiles.push({
              id: genId(state), x: unit.x, y: unit.y,
              targetId: target.id, damage: effDmg,
              speed: 15, aoeRadius: 0, team: unit.team,
              visual: rVis.visual, spriteKey: rVis.spriteKey,
              sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              extraBurnStacks: sp?.extraBurnStacks,
              extraSlowStacks: sp?.extraSlowStacks,
            });
          }
          // Research: Geists Phantom Volley — 15% chance extra projectile at nearby different enemy
          if (rbu?.raceUpgrades['geists_ranged_2'] && state.rng() < 0.15) {
            let pvTarget: UnitState | undefined;
            let pvBestDist = Infinity;
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const pvd = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (pvd <= unit.range && (pvd < pvBestDist || (pvd === pvBestDist && (!pvTarget || o.id < pvTarget.id)))) {
                pvTarget = o; pvBestDist = pvd;
              }
            }
            if (pvTarget) {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: pvTarget.id, damage: effDmg,
                speed: 15, aoeRadius: 0, team: unit.team,
                visual: rVis.visual, spriteKey: rVis.spriteKey,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                lifestealPct: 0.1,
              });
            }
          }
          // Multishot: extra projectiles at nearby enemies
          const msCount = sp?.multishotCount ?? 0;
          if (msCount > 0) {
            const msDmg = Math.round(effDmg * (sp?.multishotDamagePct ?? 0.5));
            const nearby: { u: UnitState; d: number }[] = [];
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const d = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (d <= unit.range) nearby.push({ u: o, d });
            }
            nearby.sort((a, b) => a.d - b.d || a.u.id - b.u.id);
            for (let mi = 0; mi < Math.min(msCount, nearby.length); mi++) {
              state.projectiles.push({
                id: genId(state), x: unit.x, y: unit.y,
                targetId: nearby[mi].u.id, damage: msDmg,
                speed: 15, aoeRadius: 0, team: unit.team,
                visual: rVis.visual, spriteKey: rVis.spriteKey,
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
                extraBurnStacks: sp?.extraBurnStacks,
                extraSlowStacks: sp?.extraSlowStacks,
                lifestealPct: race === Race.Geists ? 0.1 : undefined,
              });
            }
          }
          // Oozlings ranged: chain to nearby enemies
          if (race === Race.Oozlings) {
            const chainCount = 1 + (sp?.extraChainTargets ?? 0);
            const chainPct = sp?.chainDamagePct ?? 0.5;
            const chained: number[] = [target.id];
            let lastX = target.x, lastY = target.y;
            for (let ci = 0; ci < chainCount; ci++) {
              let chainTarget: UnitState | null = null;
              let chainDist = Infinity;
              for (const o of _combatGrid.getNearby(lastX, lastY, 4)) {
                if (o.team === unit.team || chained.includes(o.id)) continue;
                const d = (o.x - lastX) ** 2 + (o.y - lastY) ** 2;
                if (d <= 16 && (d < chainDist || (d === chainDist && chainTarget && o.id < chainTarget.id))) { chainTarget = o; chainDist = d; }
              }
              if (!chainTarget) break;
              chained.push(chainTarget.id);
              addCombatEvent(state, { type: 'chain', x: lastX, y: lastY, x2: chainTarget.x, y2: chainTarget.y, color: '#76ff03' });
              state.projectiles.push({
                id: genId(state), x: lastX, y: lastY,
                targetId: chainTarget.id, damage: Math.round(getEffectiveDamage(unit, state) * chainPct),
                speed: 20, aoeRadius: 0, team: unit.team, visual: 'orb',
                sourcePlayerId: unit.playerId, sourceUnitId: unit.id,
              });
              lastX = chainTarget.x; lastY = chainTarget.y;
            }
          }
        } else {
          // Melee: instant damage
          const sp = unit.upgradeSpecial;

          // Suicide attack (Oozlings Boomling): explode on first melee hit, killing self
          if (sp?.suicideAttack) {
            const eDmg = sp.explodeDamage ?? 30;
            const eRadius = sp.explodeRadius ?? 3;
            const eBurn = sp.extraBurnStacks ?? 0;
            const eR2 = eRadius * eRadius;
            const blastNearby = _combatGrid.getNearby(unit.x, unit.y, eRadius);
            for (const e of blastNearby) {
              if (e.team === unit.team || e.hp <= 0) continue;
              if ((e.x - unit.x) ** 2 + (e.y - unit.y) ** 2 > eR2) continue;
              dealDamage(state, e, eDmg, true, unit.playerId, unit.id);
              if (eBurn > 0) applyStatus(e, StatusType.Burn, eBurn);
            }
            addCombatEvent(state, { type: 'splash', x: unit.x, y: unit.y, radius: eRadius, color: '#7c4dff' });
            addDeathParticles(state, unit.x, unit.y, '#7c4dff', 8);
            addFloatingText(state, unit.x, unit.y, `${eDmg}`, '#7c4dff', undefined, undefined,
              { ftType: 'damage', magnitude: eDmg, miniIcon: 'fire' });
            addSound(state, 'nuke_detonated', unit.x, unit.y);
            // Kill self
            unit.hp = 0;
            continue;
          }

          // Hop attack: leap to target with AoE slow on landing
          if (sp?.hopAttack) {
            // Visually leap — snap position near target
            const leapDx = target.x - unit.x;
            const leapDy = target.y - unit.y;
            const leapDist = Math.sqrt(leapDx * leapDx + leapDy * leapDy);
            if (leapDist > 1.5) {
              // Move to 1 tile from target
              unit.x = target.x - leapDx / leapDist;
              unit.y = target.y - leapDy / leapDist;
            }
            addCombatEvent(state, { type: 'pulse', x: unit.x, y: unit.y, radius: 3, color: '#2196f3' });
            addSound(state, 'ability_leap', unit.x, unit.y);
            // AoE slow on landing
            for (const nearby of _combatGrid.getNearby(unit.x, unit.y, 3)) {
              if (nearby.team === unit.team) continue;
              const nd = Math.sqrt((nearby.x - unit.x) ** 2 + (nearby.y - unit.y) ** 2);
              if (nd <= 3) {
                applyStatus(nearby, StatusType.Slow, 1 + (sp?.extraSlowStacks ?? 0));
              }
            }
          }

          let meleeDmg = getEffectiveDamage(unit, state);
          // Research race one-shot bonus damage
          const mPlayer = state.players[unit.playerId];
          if (mPlayer) {
            const mbu = mPlayer.researchUpgrades;
            // Horde Blood Rage: up to +40% dmg based on missing HP (linear: 0% at full, 40% at 50% HP, 80% at 0 HP)
            if (mbu.raceUpgrades['horde_melee_1'] && unit.hp < unit.maxHp) {
              const missingPct = 1 - unit.hp / unit.maxHp; // 0 at full, 1 at 0 HP
              meleeDmg = Math.round(meleeDmg * (1 + 0.80 * missingPct));
            }
            // Demon Infernal Rage: +25% vs burning
            if (mbu.raceUpgrades['demon_melee_1'] && hasStatus(target.statusEffects, StatusType.Burn)) meleeDmg = Math.round(meleeDmg * 1.25);
            // Deep Crushing Depths: +50% vs slowed
            if (mbu.raceUpgrades['deep_melee_2'] && hasStatus(target.statusEffects, StatusType.Slow)) meleeDmg = Math.round(meleeDmg * 1.50);
            // Wild Pack Hunter: +5% per nearby ally, max +40%
            if (mbu.raceUpgrades['wild_melee_2']) {
              let nearAllies = 0;
              for (const a of _combatGrid.getNearby(unit.x, unit.y, 4)) {
                if (a.id === unit.id || a.team !== unit.team) continue;
                const ad = Math.sqrt((a.x - unit.x) ** 2 + (a.y - unit.y) ** 2);
                if (ad <= 4) nearAllies++;
              }
              meleeDmg = Math.round(meleeDmg * (1 + Math.min(0.40, nearAllies * 0.05)));
            }
            // Wild Savage Frenzy: +10% extra damage during frenzy
            if (mbu.raceUpgrades['wild_melee_1'] && hasStatus(unit.statusEffects, StatusType.Frenzy)) meleeDmg = Math.round(meleeDmg * 1.10);
            // Horde Berserker Howl: +25% damage while hasted
            if (mbu.raceUpgrades['horde_caster_2'] && hasStatus(unit.statusEffects, StatusType.Haste)) meleeDmg = Math.round(meleeDmg * 1.25);
          }
          dealDamage(state, target, meleeDmg, meleeDmg >= 5, unit.playerId, unit.id);
          if (meleeHitSounds < 4) { addSound(state, 'melee_hit', unit.x, unit.y, { race: state.players[unit.playerId]?.race }); meleeHitSounds++; }
          applyOnHitEffects(state, unit, target);

          // Horde: Trample — War Troll deals AoE trample damage on hit
          if (unit.type === 'War Troll' && mPlayer?.researchUpgrades.raceUpgrades['horde_ability_1']) {
            const trampleDmg = Math.round(meleeDmg * 0.4);
            const trampleRadius = 2.5;
            for (const nearby of _combatGrid.getNearby(unit.x, unit.y, trampleRadius)) {
              if (nearby.team === unit.team || nearby.id === target.id || nearby.hp <= 0) continue;
              const nd2 = (nearby.x - unit.x) ** 2 + (nearby.y - unit.y) ** 2;
              if (nd2 <= trampleRadius * trampleRadius) {
                dealDamage(state, nearby, trampleDmg, false, unit.playerId, unit.id);
              }
            }
          }

          // Cleave: hit additional adjacent enemies
          const cleaveN = sp?.cleaveTargets ?? 0;
          if (cleaveN > 0) {
            const cleaved: UnitState[] = [];
            for (const o of _combatGrid.getNearby(unit.x, unit.y, unit.range + 1.5)) {
              if (o.team === unit.team || o.id === target.id) continue;
              const cd = Math.sqrt((o.x - unit.x) ** 2 + (o.y - unit.y) ** 2);
              if (cd <= unit.range + 1.5) cleaved.push(o);
            }
            // Sort by distance for determinism
            cleaved.sort((a, b) => {
              const da = (a.x - unit.x) ** 2 + (a.y - unit.y) ** 2;
              const db = (b.x - unit.x) ** 2 + (b.y - unit.y) ** 2;
              return da - db || a.id - b.id;
            });
            for (let ci = 0; ci < Math.min(cleaveN, cleaved.length); ci++) {
              const cleaveDmg = Math.round(meleeDmg * 0.6);
              dealDamage(state, cleaved[ci], cleaveDmg, cleaveDmg >= 5, unit.playerId, unit.id);
              applyOnHitEffects(state, unit, cleaved[ci]);
              addCombatEvent(state, { type: 'chain', x: unit.x, y: unit.y, x2: cleaved[ci].x, y2: cleaved[ci].y, color: '#ff9800' });
            }
            if (cleaved.length > 0) {
              addSound(state, 'ability_cleave', unit.x, unit.y);
              if (state.rng() < 0.3) addFloatingText(state, unit.x, unit.y - 0.3, 'CLEAVE', '#ff9800', undefined, true,
                { ftType: 'status', miniIcon: 'cleave' });
            }
          }
        }

        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
      }
    }

    // Attack enemy alley buildings when no unit targets available
    if (!unit.upgradeSpecial?.isSiegeUnit && unit.targetId === null && unit.attackTimer <= 0) {
      let nearestTower: BuildingState | null = null;
      let ntd = Infinity;
      for (const b of state.buildings) {
        if (b.buildGrid !== 'alley') continue; // only alley buildings are targetable
        const bPlayer = state.players[b.playerId];
        if (!bPlayer || bPlayer.team === unit.team) continue;
        if (b.hp <= 0) continue;
        const d = Math.sqrt((b.worldX + 0.5 - unit.x) ** 2 + (b.worldY + 0.5 - unit.y) ** 2);
        if (d <= unit.range + 1.5 && d < ntd) { nearestTower = b; ntd = d; }
      }
      if (nearestTower) {
        const tDmg = getEffectiveDamage(unit, state);
        nearestTower.hp -= tDmg;
        if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].totalDamageDealt += tDmg;
        addFloatingText(state, nearestTower.worldX, nearestTower.worldY, `${tDmg}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: tDmg, miniIcon: 'sword' });
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        unit._attackBuildingIdx = state.buildings.indexOf(nearestTower);
        if (nearestTower.hp <= 0) {
          addFloatingText(state, nearestTower.worldX, nearestTower.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
          { ftType: 'status' });
          addSound(state, 'building_destroyed', nearestTower.worldX, nearestTower.worldY);
        }
      }
    }

    // Attack enemy HQ when in range (instead of auto-damaging at path end).
    if (unit.hp > 0 && unit.targetId === null && unit.attackTimer <= 0) {
      const enemyTeam = unit.team === Team.Bottom ? Team.Top : Team.Bottom;
      const hq = getHQPosition(enemyTeam, state.mapDef);
      const hqCx = hq.x + HQ_WIDTH / 2;
      const hqCy = hq.y + HQ_HEIGHT / 2;
      const hqRadius = Math.max(HQ_WIDTH, HQ_HEIGHT) * 0.5;
      const distToHq = Math.sqrt((unit.x - hqCx) ** 2 + (unit.y - hqCy) ** 2);
      if (distToHq <= unit.range + hqRadius) {
        // Suicide attack on HQ: explode for AoE + HQ damage, then die
        const hqSp = unit.upgradeSpecial;
        if (hqSp?.suicideAttack) {
          const eDmg = hqSp.explodeDamage ?? 30;
          const eRadius = hqSp.explodeRadius ?? 3;
          const eBurn = hqSp.extraBurnStacks ?? 0;
          const eR2 = eRadius * eRadius;
          // Damage HQ
          state.hqHp[enemyTeam] -= eDmg;
          if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].totalDamageDealt += eDmg;
          // AoE damage to nearby enemy units
          const blastNearby = _combatGrid.getNearby(unit.x, unit.y, eRadius);
          for (const e of blastNearby) {
            if (e.team === unit.team || e.hp <= 0) continue;
            if ((e.x - unit.x) ** 2 + (e.y - unit.y) ** 2 > eR2) continue;
            dealDamage(state, e, eDmg, true, unit.playerId, unit.id);
            if (eBurn > 0) applyStatus(e, StatusType.Burn, eBurn);
          }
          addCombatEvent(state, { type: 'splash', x: unit.x, y: unit.y, radius: eRadius, color: '#7c4dff' });
          addDeathParticles(state, unit.x, unit.y, '#7c4dff', 8);
          addFloatingText(state, hqCx, hqCy, `${eDmg}`, '#7c4dff', undefined, undefined,
            { ftType: 'damage', magnitude: eDmg, miniIcon: 'fire' });
          addSound(state, 'nuke_detonated', unit.x, unit.y);
          unit.hp = 0;
          continue;
        }
        const hDmg = getEffectiveDamage(unit, state);
        state.hqHp[enemyTeam] -= hDmg;
        if (state.playerStats[unit.playerId]) state.playerStats[unit.playerId].totalDamageDealt += hDmg;
        addFloatingText(state, hqCx, hqCy, `${hDmg}`, '#ffffff', undefined, undefined,
          { ftType: 'damage', magnitude: hDmg, miniIcon: 'sword' });
        addSound(state, 'hq_damaged', hqCx, hqCy);
        unit.attackTimer = Math.round(unit.attackSpeed * TICK_RATE);
        unit._attackBuildingIdx = -1; // -1 = HQ
      }
    }

    // Deluge: Deep allies attack 2x faster, non-Deep enemies attack at half speed
    const delugeEff = state.abilityEffects.find(e => e.type === 'deep_rain');
    if (delugeEff) {
      const unitRace = state.players[unit.playerId]?.race;
      const isDeep = unitRace === Race.Deep;
      const isDeepAlly = unit.team === delugeEff.team && isDeep;
      if (isDeepAlly) {
        // Deep allies: attack timer ticks down by 2 (2x attack speed)
        if (unit.attackTimer > 0) unit.attackTimer = Math.max(0, unit.attackTimer - 2);
      } else if (!isDeep && state.tick % 2 === 0) {
        // Non-Deep units: attack timer ticks every other tick (half attack speed)
        if (unit.attackTimer > 0) unit.attackTimer--;
      } else {
        // Deep enemies / non-Deep allies: normal tick
        if (unit.attackTimer > 0) unit.attackTimer--;
      }
    } else {
      if (unit.attackTimer > 0) unit.attackTimer--;
    }

    // Horde War Drums: hasted units attack 20% faster (extra tick every 5th tick)
    const warDrumPlayer = state.players[unit.playerId];
    if (warDrumPlayer?.researchUpgrades.raceUpgrades['horde_caster_1']
      && hasStatus(unit.statusEffects, StatusType.Haste)
      && unit.attackTimer > 0 && state.tick % 5 === 0) {
      unit.attackTimer--;
    }

    // Horde aura attack speed: extra tick-down based on aura %
    // 10% = extra tick every 10th tick, 15% = every ~7th tick
    const auraAtkSpd = unit.upgradeSpecial?._auraAtkSpd ?? 0;
    if (auraAtkSpd > 0 && unit.attackTimer > 0) {
      const interval = Math.max(2, Math.round(1 / auraAtkSpd));
      if (state.tick % interval === 0) unit.attackTimer--;
    }
  }

  // Remove dead units with particles (check revive first)
  let deathSoundCount = 0;
  for (const u of state.units) {
    if (u.hp > 0) continue;
    const revivePct = u.upgradeSpecial?.reviveHpPct ?? 0;
    if (revivePct > 0) {
      // Revive once: restore HP and clear the special so it doesn't trigger again
      u.hp = Math.max(1, Math.round(u.maxHp * revivePct));
      u.upgradeSpecial = { ...u.upgradeSpecial, reviveHpPct: 0 };
      addFloatingText(state, u.x, u.y, '', '#44ff44', undefined, true,
        { ftType: 'heal', miniIcon: 'heart' });
      addDeathParticles(state, u.x, u.y, '#44ff44', 3);
      addCombatEvent(state, { type: 'revive', x: u.x, y: u.y, color: '#44ff44' });
      continue;
    }
    addDeathParticles(state, u.x, u.y, u.team === Team.Bottom ? '#4488ff' : '#ff4444', 5);
    if (u.carryingDiamond) dropDiamond(state, u.x, u.y);
    // Gold on death (Crown Buccaneer upgrade path)
    const god = u.upgradeSpecial?.goldOnDeath ?? 0;
    if (god > 0) {
      const dp = state.players[u.playerId];
      if (dp) { dp.gold += god; addFloatingText(state, u.x, u.y - 0.3, `+${god}g`, '#ffd700'); }
    }
    if (state.playerStats[u.playerId]) state.playerStats[u.playerId].unitsLost++;
    trackDeathResources(state, u);
    if (deathSoundCount < 3) { addSound(state, 'unit_killed', u.x, u.y); deathSoundCount++; }
    // Research: Oozlings death effects
    const deathPlayer = state.players[u.playerId];
    if (deathPlayer) {
      const dbu = deathPlayer.researchUpgrades;
      // Oozlings Volatile Membrane: melee death AoE — 15 dmg within 2 tiles
      if (dbu.raceUpgrades['oozlings_melee_1'] && u.category === 'melee') {
        const deathNearby = _combatGrid.getNearby(u.x, u.y, 2);
        for (const enemy of deathNearby) {
          if (enemy.team === u.team || enemy.hp <= 0) continue;
          const dd = Math.sqrt((enemy.x - u.x) ** 2 + (enemy.y - u.y) ** 2);
          if (dd <= 2) dealDamage(state, enemy, 15, true, u.playerId);
        }
        addCombatEvent(state, { type: 'splash', x: u.x, y: u.y, radius: 2, color: '#76ff03' });
      }
      // Oozlings Mitosis: 10% chance to spawn copy at half stats on melee death
      if (dbu.raceUpgrades['oozlings_melee_2'] && u.category === 'melee' && state.rng() < 0.10) {
        const mitLane = u.lane;
        const mitPath = getLanePath(u.team, mitLane, state.mapDef);
        const mitProg = findNearestPathProgress(mitPath, u.x, u.y);
        state.units.push({
          id: genId(state), type: u.type, playerId: u.playerId, team: u.team,
          x: u.x, y: u.y,
          hp: Math.round(u.maxHp * 0.5), maxHp: Math.round(u.maxHp * 0.5),
          damage: Math.round(u.damage * 0.5),
          attackSpeed: u.attackSpeed, attackTimer: 0, moveSpeed: u.moveSpeed, range: u.range,
          targetId: null, lane: mitLane, pathProgress: mitProg, carryingDiamond: false,
          statusEffects: [], hitCount: 0, shieldHp: 0,
          category: u.category, upgradeTier: u.upgradeTier, upgradeNode: u.upgradeNode,
          upgradeSpecial: {}, kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
        });
        if (state.playerStats[u.playerId]) state.playerStats[u.playerId].unitsSpawned++;
        addFloatingText(state, u.x, u.y, 'MUTATE', '#76ff03', undefined, true,
          { ftType: 'status' });
      }
      // Oozlings Acid Pool: ranged death AoE — 5 dmg to enemies within 1.5 tiles
      if (dbu.raceUpgrades['oozlings_ranged_2'] && u.category === 'ranged') {
        const acidNearby = _combatGrid.getNearby(u.x, u.y, 1.5);
        for (const enemy of acidNearby) {
          if (enemy.team === u.team || enemy.hp <= 0) continue;
          const dd = Math.sqrt((enemy.x - u.x) ** 2 + (enemy.y - u.y) ** 2);
          if (dd <= 1.5) dealDamage(state, enemy, 5, true, u.playerId);
        }
        addCombatEvent(state, { type: 'splash', x: u.x, y: u.y, radius: 1.5, color: '#69f0ae' });
      }
    }
    // Record fallen heroes (units with kills, healing, buff, or tank contributions)
    if (u.kills > 0 || u.healingDone > 0 || u.buffsApplied > 0 || u.damageTaken > 50) {
      const fallRace = state.players[u.playerId].race;
      const fallBldg = `${u.category}_spawner` as BuildingType;
      state.fallenHeroes.push({
        name: getUpgradeNodeDef(fallRace, fallBldg, u.upgradeNode)?.name ?? u.type,
        playerId: u.playerId, race: fallRace,
        category: u.category, upgradeNode: u.upgradeNode,
        kills: u.kills, damageDone: u.damageDone, damageTaken: u.damageTaken, healingDone: u.healingDone, buffsApplied: u.buffsApplied,
        survived: false, killedByName: u.lastDamagedByName || 'unknown',
        spawnTick: u.spawnTick, deathTick: state.tick,
      });
    }
  }
  compactInPlace(state.units, u => u.hp > 0);

  // Remove destroyed towers (killed by combat units)
  for (let i = state.buildings.length - 1; i >= 0; i--) {
    const db = state.buildings[i];
    if (db.hp <= 0 && db.type === BuildingType.Tower) {
      // Oozlings Death Burst: globule spawns 3 random ooze on death
      if (db.isGlobule) {
        const gOwner = state.players[db.playerId];
        if (gOwner && gOwner.researchUpgrades.raceUpgrades['oozlings_ability_3']) {
          const categories: BuildingType[] = [BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner];
          const catNames: ('melee' | 'ranged' | 'caster')[] = ['melee', 'ranged', 'caster'];
          for (let di = 0; di < 3; di++) {
            const ci = Math.floor(state.rng() * 3);
            const dStats = UNIT_STATS[gOwner.race]?.[categories[ci]];
            if (!dStats) continue;
            const dlane = state.rng() < 0.5 ? Lane.Left : Lane.Right;
            const dPath = getLanePath(gOwner.team, dlane, state.mapDef);
            const dProg = findNearestPathProgress(dPath, db.worldX, db.worldY);
            state.units.push({
              id: genId(state), type: dStats.name, playerId: db.playerId, team: gOwner.team,
              x: db.worldX + (state.rng() - 0.5), y: db.worldY + (state.rng() - 0.5),
              hp: dStats.hp, maxHp: dStats.hp, damage: dStats.damage,
              attackSpeed: dStats.attackSpeed, attackTimer: 0, moveSpeed: dStats.moveSpeed, range: dStats.range,
              targetId: null, lane: dlane, pathProgress: dProg, carryingDiamond: false,
              statusEffects: [], hitCount: 0, shieldHp: 0, category: catNames[ci],
              upgradeTier: 0, upgradeNode: 'A', upgradeSpecial: {},
              kills: 0, damageDone: 0, damageTaken: 0, healingDone: 0, buffsApplied: 0, lastDamagedByName: '', spawnTick: state.tick,
            });
          }
          addFloatingText(state, db.worldX, db.worldY, 'DEATH BURST!', '#69f0ae');
        }
      }
      state.buildings.splice(i, 1);
    }
  }
}

// === Tower Combat ===

export function tickHQDefense(state: GameState): void {
  const HQ_RANGE = 11;
  const HQ_DAMAGE = 18;
  const HQ_COOLDOWN_TICKS = Math.round(1.32 * TICK_RATE); // 10% slower

  for (const team of [Team.Bottom, Team.Top]) {
    state.hqAttackTimer[team]--;
    if (state.hqAttackTimer[team] > 0) continue;

    const enemyTeam = team === Team.Bottom ? Team.Top : Team.Bottom;
    const hq = getHQPosition(team, state.mapDef);
    const hx = hq.x + HQ_WIDTH / 2;
    const hy = hq.y + HQ_HEIGHT / 2;

    // Find closest enemy unit in range (spatial grid lookup)
    let closest: UnitState | null = null;
    let closestDist = Infinity;
    const hqNearby = _combatGrid.getNearby(hx, hy, HQ_RANGE);
    for (const u of hqNearby) {
      if (u.team !== enemyTeam) continue;
      const d = (u.x - hx) ** 2 + (u.y - hy) ** 2;
      if (d <= HQ_RANGE * HQ_RANGE && (d < closestDist || (d === closestDist && closest && u.id < closest.id))) {
        closest = u;
        closestDist = d;
      }
    }

    if (closest) {
      // Fire a cannonball from the HQ — splash damage in area
      state.projectiles.push({
        id: genId(state),
        x: hx, y: hy,
        targetId: closest.id,
        damage: HQ_DAMAGE,
        speed: 8,
        aoeRadius: 4,
        team, visual: 'cannonball',
        sourcePlayerId: -1, // HQ has no specific player owner
        splashDamagePct: 0.5,
      });
      state.hqAttackTimer[team] = HQ_COOLDOWN_TICKS;
      continue;
    }

    // If no enemy units are nearby, HQ can still defend against harvesters (direct damage).
    let closestHarv: HarvesterState | null = null;
    let closestHarvDist = Infinity;
    for (const h of state.harvesters) {
      if (h.team !== enemyTeam || h.state === 'dead') continue;
      const d = (h.x - hx) ** 2 + (h.y - hy) ** 2;
      if (d <= HQ_RANGE * HQ_RANGE && (d < closestHarvDist || (d === closestHarvDist && closestHarv && h.id < closestHarv.id))) {
        closestHarv = h;
        closestHarvDist = d;
      }
    }
    if (!closestHarv) continue;

    closestHarv.hp -= HQ_DAMAGE;
    addFloatingText(state, closestHarv.x, closestHarv.y, `${HQ_DAMAGE}`, '#ffffff', undefined, undefined,
      { ftType: 'damage', magnitude: HQ_DAMAGE, miniIcon: 'sword' });
    if (closestHarv.hp <= 0) {
      addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
      killHarvester(state, closestHarv);
    }
    state.hqAttackTimer[team] = HQ_COOLDOWN_TICKS;
  }
}

export function tickTowers(state: GameState): void {
  let towerFireSounds = 0;
  for (const building of state.buildings) {
    if (building.type !== BuildingType.Tower) continue;
    // Skip special ability buildings that use Tower type but don't shoot
    if (isAbilityBuilding(building)) continue;

    const player = state.players[building.playerId];
    const baseStats = TOWER_STATS[player.race];
    const upgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
    const towerRangeBonus = upgrade.special.towerRangeBonus ?? 0;
    const stats = {
      damage: Math.max(1, Math.round(baseStats.damage * upgrade.damage)),
      attackSpeed: Math.max(0.2, baseStats.attackSpeed * upgrade.attackSpeed),
      range: Math.max(1, baseStats.range * upgrade.range) + towerRangeBonus,
    };
    const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

    building.actionTimer--; // reuse actionTimer as attack cooldown
    if (building.actionTimer > 0) continue;

    const tx = building.worldX + 0.5;
    const ty = building.worldY + 0.5;

    // Races with special tower behavior (non-standard attack patterns)
    const specialTowerRaces: Race[] = [
      Race.Crown, Race.Oozlings, Race.Deep, Race.Wild, Race.Tenders, // AoE or support
      Race.Geists, Race.Demon, Race.Horde, // single-target special
    ];
    if (specialTowerRaces.includes(player.race)) {
      const towerNearby = _combatGrid.getNearby(tx, ty, stats.range);
      let hasEnemiesInRange = false;
      for (const u of towerNearby) {
        if (u.team !== enemyTeam) continue;
        if ((u.x - tx) ** 2 + (u.y - ty) ** 2 <= stats.range * stats.range) { hasEnemiesInRange = true; break; }
      }
      if (hasEnemiesInRange) {
        applyTowerSpecial(state, building, player.race, stats, upgrade.special);
        if (towerFireSounds < 2) { addSound(state, 'tower_fire', tx, ty); towerFireSounds++; }
        continue;
      }
    }

    // Default: find closest enemy unit, fire projectile (Ember + fallback)
    let closest: UnitState | null = null;
    let closestDist = Infinity;

    const defaultNearby = _combatGrid.getNearby(tx, ty, stats.range);
    for (const u of defaultNearby) {
      if (u.team !== enemyTeam) continue;
      const dx = u.x - tx, dy = u.y - ty;
      const dist = dx * dx + dy * dy;
      if (dist <= stats.range * stats.range && (dist < closestDist || (dist === closestDist && closest && u.id < closest.id))) {
        closest = u;
        closestDist = dist;
      }
    }

    if (closest) {
      const towerUpgrade = getUnitUpgradeMultipliers(building.upgradePath, player.race, BuildingType.Tower);
      state.projectiles.push({
        id: genId(state),
        x: tx, y: ty,
        targetId: closest.id,
        damage: stats.damage,
        speed: 12,
        aoeRadius: 0,
        team: player.team, visual: 'bolt',
        sourcePlayerId: building.playerId,
        extraBurnStacks: towerUpgrade.special.extraBurnStacks,
        extraSlowStacks: towerUpgrade.special.extraSlowStacks,
        isTowerShot: true,
      });
      // Ember tower applies burn on hit (handled in tickProjectiles)
      if (towerFireSounds < 2) { addSound(state, 'tower_fire', tx, ty); towerFireSounds++; }
      building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      continue;
    }

    // No unit targets — try enemy harvesters (direct damage)
    let closestHarv: HarvesterState | null = null;
    let closestHarvDist = Infinity;
    for (const h of state.harvesters) {
      if (h.team !== enemyTeam || h.state === 'dead') continue;
      const dx = h.x - tx, dy = h.y - ty;
      const dist = dx * dx + dy * dy;
      if (dist <= stats.range * stats.range && (dist < closestHarvDist || (dist === closestHarvDist && closestHarv && h.id < closestHarv.id))) {
        closestHarv = h;
        closestHarvDist = dist;
      }
    }
    if (closestHarv) {
      closestHarv.hp -= stats.damage;
      addFloatingText(state, closestHarv.x, closestHarv.y, `${stats.damage}`, '#ffffff', undefined, undefined,
        { ftType: 'damage', magnitude: stats.damage, miniIcon: 'arrow' });
      if (closestHarv.hp <= 0) {
        addDeathParticles(state, closestHarv.x, closestHarv.y, '#ffaa00', 4);
        killHarvester(state, closestHarv);
      }
      building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
    }
  }
}

// === Projectiles ===

export function tickProjectiles(state: GameState): void {
  _projectileRemoveSet.clear();
  const toRemove = _projectileRemoveSet;
  // _unitById already rebuilt after tickCombat's dead-unit filter (line 955) — reuse it
  const unitById = _unitById;
  let rangedHitSounds = 0;

  for (const p of state.projectiles) {
    // === Position-targeted siege cannonball (no unit target, flies to a world position) ===
    if (p.targetX !== undefined && p.targetY !== undefined) {
      const pdx = p.targetX - p.x, pdy = p.targetY - p.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
      const pmove = p.speed / TICK_RATE;
      if (pdist <= pmove) {
        // Impact: AoE damage to units
        const impX = p.targetX, impY = p.targetY;
        if (p.aoeRadius > 0) {
          addCombatEvent(state, { type: 'splash', x: impX, y: impY, radius: p.aoeRadius, color: '#ff6600' });
          const splashNearby = _combatGrid.getNearby(impX, impY, p.aoeRadius);
          for (const u of splashNearby) {
            if (u.team === p.team || u.hp <= 0) continue;
            const ud = Math.sqrt((u.x - impX) ** 2 + (u.y - impY) ** 2);
            if (ud <= p.aoeRadius) {
              const splashDmg = Math.round(p.damage * (p.splashDamagePct ?? 0.60));
              dealDamage(state, u, splashDmg, true, p.sourcePlayerId, p.sourceUnitId);
              const srcPlayer = state.players[p.sourcePlayerId];
              if (srcPlayer) {
                if (p.extraBurnStacks) applyStatus(u, StatusType.Burn, p.extraBurnStacks);
                if (p.extraSlowStacks) applyStatus(u, StatusType.Slow, p.extraSlowStacks);
              }
            }
          }
        }
        // Impact: building damage (alley buildings only)
        if (p.buildingDamageMult && p.buildingDamageMult > 0) {
          const bldAoe = (p.aoeRadius ?? 0) + 1;
          for (const b of state.buildings) {
            if (b.hp <= 0 || b.buildGrid !== 'alley') continue;
            const bPlayer = state.players[b.playerId];
            if (!bPlayer || bPlayer.team === p.team) continue;
            const bd = Math.sqrt((b.worldX - impX) ** 2 + (b.worldY - impY) ** 2);
            if (bd <= bldAoe) {
              const bldDmg = Math.round(p.damage * p.buildingDamageMult);
              b.hp = Math.max(0, b.hp - bldDmg);
              if (state.playerStats[p.sourcePlayerId]) state.playerStats[p.sourcePlayerId].totalDamageDealt += bldDmg;
              addFloatingText(state, b.worldX, b.worldY - 0.5, `${bldDmg}`, '#ffffff', undefined, undefined,
                { ftType: 'damage', magnitude: bldDmg, miniIcon: 'sword' });
              if (b.hp <= 0) {
                addFloatingText(state, b.worldX, b.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
                  { ftType: 'status' });
                addSound(state, 'building_destroyed', b.worldX, b.worldY);
              }
            }
          }
          // Also damage enemy HQ if in blast radius
          const enemyTeam = p.team === Team.Bottom ? Team.Top : Team.Bottom;
          const hq = getHQPosition(enemyTeam, state.mapDef);
          const hqCx = hq.x + HQ_WIDTH / 2, hqCy = hq.y + HQ_HEIGHT / 2;
          const hqDist = Math.sqrt((hqCx - impX) ** 2 + (hqCy - impY) ** 2);
          if (hqDist <= bldAoe + 2) {
            const hqBldDmg = Math.round(p.damage * p.buildingDamageMult * 0.5);
            state.hqHp[enemyTeam] = Math.max(0, state.hqHp[enemyTeam] - hqBldDmg);
            if (state.playerStats[p.sourcePlayerId]) state.playerStats[p.sourcePlayerId].totalDamageDealt += hqBldDmg;
            addFloatingText(state, hqCx, hqCy, `${hqBldDmg}`, '#ffffff', undefined, undefined,
              { ftType: 'damage', magnitude: hqBldDmg, miniIcon: 'sword' });
          }
        }
        addDeathParticles(state, impX, impY, '#ff6600', 6);
        if (rangedHitSounds < 3) { addSound(state, 'ranged_hit', impX, impY, { race: state.players[p.sourcePlayerId]?.race }); rangedHitSounds++; }
        toRemove.add(p.id);
      } else {
        p.x += (pdx / pdist) * pmove;
        p.y += (pdy / pdist) * pmove;
      }
      continue;
    }

    const target = unitById.get(p.targetId);
    if (!target || target.hp <= 0) {
      toRemove.add(p.id);
      continue;
    }

    const dx = target.x - p.x, dy = target.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const moveAmt = p.speed / TICK_RATE;

    if (dist <= moveAmt) {
      // Visual-only projectile (0 damage) — just remove on arrival, no effects
      if (p.damage <= 0) {
        toRemove.add(p.id);
        continue;
      }

      // Critical hit: always consume 1 RNG to keep sequence stable
      let hitDmg = p.damage;
      { const critRoll = state.rng();
        if (p.critChance && p.critMult && critRoll < p.critChance) {
          hitDmg = Math.round(hitDmg * p.critMult);
          addFloatingText(state, target.x, target.y - 0.5, 'CRIT!', '#ff4444', undefined, undefined, { ftType: 'status' });
        }
      }
      // Hit! Apply damage through shield
      dealDamage(state, target, hitDmg, true, p.sourcePlayerId, p.sourceUnitId, p.isTowerShot);
      if (rangedHitSounds < 3) { addSound(state, 'ranged_hit', target.x, target.y, { race: state.players[p.sourcePlayerId]?.race }); rangedHitSounds++; }
      addDeathParticles(state, target.x, target.y, '#ffaa00', 2);

      // Apply status effects based on source player's race + upgrade extras
      const sourcePlayer = state.players[p.sourcePlayerId];
      if (sourcePlayer) {
        const race = sourcePlayer.race;
        const extraSlow = p.extraSlowStacks ?? 0;
        const extraBurn = p.extraBurnStacks ?? 0;
        // Slow races: Deep always 2 (Harpooner), Tenders 1 or 2
        if (race === Race.Deep) applyStatus(target, StatusType.Slow, 2 + extraSlow);
        else if (race === Race.Tenders) applyStatus(target, StatusType.Slow, (p.aoeRadius > 0 ? 2 : 1) + extraSlow);
        // Burn races: Demon, Geists, Wild, Goblins (Knifer poison)
        if (race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Goblins)
          applyStatus(target, StatusType.Burn, (p.aoeRadius > 0 ? 2 : 1) + extraBurn);
        // Anti-heal: Wound on ranged/caster hits for Goblins, Demon, Wild, Horde (Geists melee only)
        if (race === Race.Goblins || race === Race.Demon || race === Race.Wild || race === Race.Horde)
          applyWound(target);
        // Geists Wraith Bow: ranged lifesteal
        if (p.lifestealPct && p.lifestealPct > 0) {
          const source = p.sourceUnitId != null ? unitById.get(p.sourceUnitId) : undefined;
          if (source && source.hp > 0) {
            const steal = Math.round(p.damage * p.lifestealPct);
            if (steal > 0) {
              const lsAh = healUnit(source, steal);
              if (lsAh > 0) trackHealing(state, source, lsAh);
              addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: source.x, y2: source.y, color: '#b39ddb' });
            }
          }
        }
        // Upgrade special: apply Vulnerable/Wound on projectile hit
        if (p.applyVulnerable) applyVulnerable(target, state);
        if (p.applyWound) applyWound(target);
        // Research race one-shot ranged effects
        const pbu = sourcePlayer.researchUpgrades;
        // Goblins Incendiary Tips: +1 Burn on ranged
        if (pbu.raceUpgrades['goblins_ranged_1']) applyStatus(target, StatusType.Burn, 1);
        // Demon Hellfire Arrows: +1 Burn, +10% dmg (extra burn already via this)
        if (pbu.raceUpgrades['demon_ranged_1']) applyStatus(target, StatusType.Burn, 1);
        // Demon Flame Conduit: +1 AoE burn stack on caster projectiles
        if (pbu.raceUpgrades['demon_caster_1'] && p.aoeRadius > 0) applyStatus(target, StatusType.Burn, 1);
        // Oozlings Corrosive Spit: Vulnerable (+20% dmg taken) on ranged hit
        if (pbu.raceUpgrades['oozlings_ranged_1']) applyVulnerable(target, state);
        // Crown Piercing Arrows: ignore 20% def (applied as bonus damage)
        // Geists Soul Arrows: +5% lifesteal on ranged
        if (pbu.raceUpgrades['geists_ranged_1']) {
          const lsSource = p.sourceUnitId != null ? unitById.get(p.sourceUnitId) : undefined;
          if (lsSource && lsSource.hp > 0) {
            const extraSteal = Math.round(p.damage * 0.05);
            if (extraSteal > 0) {
              const ah = healUnit(lsSource, extraSteal);
              if (ah > 0) trackHealing(state, lsSource, ah);
            }
          }
        }
        // Wild Savage Instinct: frenzied Wild units gain 15% lifesteal on ranged
        if (pbu.raceUpgrades['wild_ability_4']) {
          const wildSrc = p.sourceUnitId != null ? unitById.get(p.sourceUnitId) : undefined;
          if (wildSrc && wildSrc.hp > 0 && hasStatus(wildSrc.statusEffects, StatusType.Frenzy)) {
            const wildSteal = Math.round(p.damage * 0.15);
            if (wildSteal > 0) {
              const wah = healUnit(wildSrc, wildSteal);
              if (wah > 0) trackHealing(state, wildSrc, wah);
              addCombatEvent(state, { type: 'lifesteal', x: target.x, y: target.y, x2: wildSrc.x, y2: wildSrc.y, color: '#66bb6a' });
            }
          }
        }
        // Tenders Root Snare: 20% chance +1 Slow on ranged hit
        if (pbu.raceUpgrades['tenders_ranged_2'] && state.rng() < 0.20) applyStatus(target, StatusType.Slow, 1);
        // Tenders Healing Sap: heal ally 15% of dmg done
        if (pbu.raceUpgrades['tenders_ranged_1']) {
          const healAmt = Math.round(p.damage * 0.15);
          if (healAmt > 0) {
            // Find lowest HP ally nearby
            let lowestAlly: UnitState | null = null;
            let lowestHpPct = 1;
            const healNearby = _combatGrid.getNearby(target.x, target.y, 8);
            for (const u of healNearby) {
              if (u.team !== sourcePlayer.team || u.hp <= 0 || u.hp >= u.maxHp) continue;
              const d2 = (u.x - target.x) ** 2 + (u.y - target.y) ** 2;
              if (d2 > 64) continue; // 8 tile radius
              const hpPct = u.hp / u.maxHp;
              if (hpPct < lowestHpPct || (hpPct === lowestHpPct && lowestAlly && u.id < lowestAlly.id)) { lowestHpPct = hpPct; lowestAlly = u; }
            }
            if (lowestAlly) {
              const ah = healUnit(lowestAlly, healAmt);
              if (ah > 0) addCombatEvent(state, { type: 'heal', x: lowestAlly.x, y: lowestAlly.y, color: '#66bb6a' });
            }
          }
        }
      }

      // AOE damage
      if (p.aoeRadius > 0) {
        addCombatEvent(state, { type: 'splash', x: target.x, y: target.y, radius: p.aoeRadius, color: '#ffaa00' });
        const aoeNearby = _combatGrid.getNearby(target.x, target.y, p.aoeRadius);
        for (const u of aoeNearby) {
          if (u.id === target.id || u.team === p.team) continue;
          const ad = Math.sqrt((u.x - target.x) ** 2 + (u.y - target.y) ** 2);
          if (ad <= p.aoeRadius) {
            const aoeDmg = Math.round(p.damage * (p.splashDamagePct ?? 0.5) * 0.9);
            dealDamage(state, u, aoeDmg, true, p.sourcePlayerId, p.sourceUnitId);
            if (sourcePlayer) {
              const race = sourcePlayer.race;
              const extraSlow = p.extraSlowStacks ?? 0;
              const extraBurn = p.extraBurnStacks ?? 0;
              // Slow races: Deep always 2, Tenders 2 (AoE)
              if (race === Race.Deep) applyStatus(u, StatusType.Slow, 2 + extraSlow);
              else if (race === Race.Tenders) applyStatus(u, StatusType.Slow, 2 + extraSlow);
              // Burn races
              if (race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Goblins)
                applyStatus(u, StatusType.Burn, 2 + extraBurn);
              // Demon Flame Conduit: +1 AoE burn stack on caster projectiles
              if (sourcePlayer.researchUpgrades.raceUpgrades['demon_caster_1'] && p.aoeRadius > 0) applyStatus(u, StatusType.Burn, 1);
              if (race === Race.Oozlings) applyStatus(u, StatusType.Slow, 1);
              // Anti-heal on AoE: Wound for Goblins, Demon, Geists, Wild, Horde
              if (race === Race.Goblins || race === Race.Demon || race === Race.Geists || race === Race.Wild || race === Race.Horde)
                applyWound(u);
              // Oozlings caster_2 (Mass Division → Corrosive Aura): AoE applies Wound
              if (race === Race.Oozlings && sourcePlayer.researchUpgrades.raceUpgrades['oozlings_caster_2'])
                applyWound(u);
              // Upgrade special: apply Vulnerable/Wound on AoE hit
              if (p.applyVulnerable) applyVulnerable(u, state);
              if (p.applyWound) applyWound(u);
              // AoE lifesteal
              if (p.lifestealPct && p.lifestealPct > 0) {
                const source = p.sourceUnitId != null ? unitById.get(p.sourceUnitId) : undefined;
                if (source && source.hp > 0) {
                  const steal = Math.round(aoeDmg * p.lifestealPct);
                  if (steal > 0) {
                    const aoeAh = healUnit(source, steal);
                    if (aoeAh > 0) trackHealing(state, source, aoeAh);
                  }
                }
              }
            }
          }
        }
      }
      // Siege projectile: splash also damages nearby enemy alley buildings
      if (p.buildingDamageMult && p.buildingDamageMult > 0 && p.aoeRadius > 0) {
        const bldAoe = p.aoeRadius + 1;
        for (const b of state.buildings) {
          if (b.hp <= 0 || b.buildGrid !== 'alley') continue;
          const bPlayer = state.players[b.playerId];
          if (!bPlayer || bPlayer.team === p.team) continue;
          const bd = Math.sqrt((b.worldX - target.x) ** 2 + (b.worldY - target.y) ** 2);
          if (bd <= bldAoe) {
            const bldDmg = Math.round(p.damage * p.buildingDamageMult * (p.splashDamagePct ?? 0.60));
            b.hp = Math.max(0, b.hp - bldDmg);
            addFloatingText(state, b.worldX, b.worldY - 0.5, `${bldDmg}`, '#ffffff', undefined, undefined,
              { ftType: 'damage', magnitude: bldDmg, miniIcon: 'sword' });
            if (b.hp <= 0) {
              addFloatingText(state, b.worldX, b.worldY, 'DESTROYED', '#ff0000', undefined, undefined,
                { ftType: 'status' });
              addSound(state, 'building_destroyed', b.worldX, b.worldY);
            }
          }
        }
      }
      toRemove.add(p.id);
    } else {
      p.x += (dx / dist) * moveAmt;
      p.y += (dy / dist) * moveAmt;
    }
  }

  if (toRemove.size > 0) compactInPlace(state.projectiles, p => !toRemove.has(p.id));
}

// === Visual Effects ===

export function tickEffects(state: GameState): void {
  // Floating texts
  for (const ft of state.floatingTexts) ft.age++;
  compactInPlace(state.floatingTexts, ft => ft.age < ft.maxAge);

  // Particles
  for (const p of state.particles) {
    p.x += p.vx / TICK_RATE;
    p.y += p.vy / TICK_RATE;
    p.vy += 0.1; // gravity
    p.age++;
  }
  compactInPlace(state.particles, p => p.age < p.maxAge);

  // Nuke effects
  for (const n of state.nukeEffects) n.age++;
  compactInPlace(state.nukeEffects, n => n.age < n.maxAge);

  // Pings
  for (const p of state.pings) p.age++;
  compactInPlace(state.pings, p => p.age < p.maxAge);

  // Quick chat callouts
  for (const c of state.quickChats) c.age++;
  compactInPlace(state.quickChats, c => c.age < c.maxAge);
}

// === Status Effects ===

export function tickStatusEffects(state: GameState): void {
  // Upgrade regen: heal once per second (suppressed by burn, poison/slow, or blight)
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      let regen = unit.upgradeSpecial?.regenPerSec ?? 0;
      // Research: Tenders Bark Skin — regen 1->2 HP/s for melee
      const regenPlayer = state.players[unit.playerId];
      if (regenPlayer && unit.category === 'melee' && regenPlayer.researchUpgrades.raceUpgrades['tenders_melee_1']) {
        regen = Math.max(regen, 2);
      }
      // Oozlings Ooze Vitality: all Oozling units regen 2 HP/s
      if (regenPlayer && regenPlayer.race === Race.Oozlings && regenPlayer.researchUpgrades.raceUpgrades['oozlings_ability_4']) {
        regen = Math.max(regen, 2);
      }
      if (regen > 0 && unit.hp < unit.maxHp) {
        // Any burn or slow (poison) effect suppresses regen
        const hasBurn = hasStatus(unit.statusEffects, StatusType.Burn);
        const hasSlow = hasStatus(unit.statusEffects, StatusType.Slow);
        if (!hasBurn && !hasSlow) {
          const regenAh = healUnit(unit, regen);
          if (regenAh > 0) trackHealing(state, unit, regenAh);
          addDeathParticles(state, unit.x, unit.y, '#4caf50', 1);
          // Throttle heal VFX to every 3 seconds to avoid sparkle spam
          if (state.tick % (TICK_RATE * 3) === 0) {
            addCombatEvent(state, { type: 'heal', x: unit.x, y: unit.y, color: '#4caf50' });
          }
        }
      }
    }
  }
  for (const unit of state.units) {
    for (let i = unit.statusEffects.length - 1; i >= 0; i--) {
      const eff = unit.statusEffects[i];
      eff.duration--;

      // Burn DoT: 2 damage per stack per second (routes through shield)
      // SEARED combo: if also slowed, burn does 50% more damage
      if (eff.type === StatusType.Burn && state.tick % TICK_RATE === 0) {
        const hasSlowCombo = hasStatus(unit.statusEffects, StatusType.Slow);
        const baseBurnDmg = 2 * eff.stacks;
        const burnDmg = hasSlowCombo ? Math.round(baseBurnDmg * 1.5) : baseBurnDmg;
        // Attribute burn to first active enemy player (correct in 1v1, approximate in team modes)
        let burnSourceId: number | undefined;
        for (const ep of state.players) {
          if (ep.team !== unit.team && !ep.isEmpty) { burnSourceId = ep.id; break; }
        }
        dealDamage(state, unit, burnDmg, true, burnSourceId);
        if (burnSourceId !== undefined && state.playerStats[burnSourceId]) {
          state.playerStats[burnSourceId].burnDamageDealt += burnDmg;
        }
        if (hasSlowCombo) {
          addDeathParticles(state, unit.x, unit.y, '#ff6600', 1);
          addDeathParticles(state, unit.x, unit.y, '#2979ff', 1);
          if (state.tick % (TICK_RATE * 3) === 0) { // show "SEARED" every 3 seconds
            addFloatingText(state, unit.x, unit.y - 0.3, '', '#ff8c00', undefined, true,
              { ftType: 'status', miniIcon: 'fire' });
          }
        } else {
          addDeathParticles(state, unit.x, unit.y, '#ff4400', 1);
        }
        // BLIGHT: burn 3+ stacks = no regen (shown every 3s)
        if (eff.stacks >= 3 && state.tick % (TICK_RATE * 3) === 0) {
          addFloatingText(state, unit.x, unit.y - 0.5, '', '#9c27b0', undefined, true,
            { ftType: 'status', miniIcon: 'poison' });
        }
      }

      // Shield expired
      if (eff.type === StatusType.Shield && eff.duration <= 0) {
        unit.shieldHp = 0;
      }

      if (eff.duration <= 0) {
        unit.statusEffects.splice(i, 1);
      }
    }
  }

  // Research: Oozlings Symbiotic Link — heal 1 HP/s while hasted (casters only)
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      const sympPlayer = state.players[unit.playerId];
      if (sympPlayer?.researchUpgrades.raceUpgrades['oozlings_caster_1'] && unit.category === 'caster') {
        if (hasStatus(unit.statusEffects, StatusType.Haste) && unit.hp < unit.maxHp) {
          healUnit(unit, 1);
        }
      }
    }
  }

  // Research: Demon Immolation — casters burn enemies within 2 tiles every second
  if (state.tick % TICK_RATE === 0) {
    for (const unit of state.units) {
      const immoPlayer = state.players[unit.playerId];
      if (immoPlayer?.researchUpgrades.raceUpgrades['demon_caster_2'] && unit.category === 'caster' && unit.hp > 0) {
        const immoNearby = _combatGrid.getNearby(unit.x, unit.y, 2);
        for (const enemy of immoNearby) {
          if (enemy.team === unit.team || enemy.hp <= 0) continue;
          const d = Math.sqrt((enemy.x - unit.x) ** 2 + (enemy.y - unit.y) ** 2);
          if (d <= 2) applyStatus(enemy, StatusType.Burn, 1);
        }
      }
    }
  }
}

// === Tower Race Specials ===

/** Spawn a visual-only tower projectile (0 damage) so players see something fly from tower to target. */
export function towerVisualProjectile(state: GameState, building: BuildingState, target: UnitState): void {
  state.projectiles.push({
    id: genId(state), x: building.worldX + 0.5, y: building.worldY + 0.5,
    targetId: target.id, damage: 0, speed: 12, aoeRadius: 0,
    team: state.players[building.playerId].team, visual: 'bolt',
    sourcePlayerId: building.playerId,
  });
}

/** Spawn a visual-only chain projectile from (sx,sy) to a target. */
export function towerChainProjectile(state: GameState, building: BuildingState, sx: number, sy: number, target: UnitState): void {
  state.projectiles.push({
    id: genId(state), x: sx, y: sy,
    targetId: target.id, damage: 0, speed: 18, aoeRadius: 0,
    team: state.players[building.playerId].team, visual: 'orb',
    sourcePlayerId: building.playerId,
  });
}

/** Expanding ring of particles from tower position — used for AoE tower visuals. */
export function towerAoePulse(state: GameState, tx: number, ty: number, color: string, range: number): void {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const speed = range * 0.8 + state.rng() * range * 0.4;
    state.particles.push({
      x: tx, y: ty,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      age: 0,
      maxAge: TICK_RATE * 0.5,
      size: 2.5 + state.rng() * 1.5,
    });
  }
}

export function applyTowerSpecial(state: GameState, building: BuildingState, race: Race, stats: { damage: number; range: number; attackSpeed: number }, sp: import('./data').UpgradeSpecial): void {
  const tx = building.worldX + 0.5;
  const ty = building.worldY + 0.5;
  const player = state.players[building.playerId];
  const enemyTeam = player.team === Team.Bottom ? Team.Top : Team.Bottom;

  // Helper: find nearest enemy in spatial grid within range
  const findNearest = (range: number): UnitState | null => {
    let nearest: UnitState | null = null;
    let nearestDist = range * range;
    const nearby = _combatGrid.getNearby(tx, ty, range);
    for (const u of nearby) {
      if (u.team !== enemyTeam) continue;
      const d = (u.x - tx) ** 2 + (u.y - ty) ** 2;
      if (d < nearestDist || (d === nearestDist && nearest && u.id < nearest.id)) { nearest = u; nearestDist = d; }
    }
    return nearest;
  };

  switch (race) {
    case Race.Crown: {
      // Balanced single-target: hit nearest, no special effect
      const nearest = findNearest(stats.range);
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        addDeathParticles(state, nearest.x, nearest.y, '#ffd700', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Horde: {
      // Heavy single-target with knockback chance
      const nearest = findNearest(stats.range);
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        { // Always consume 2 RNG values to keep sequence stable
          const knockRoll = state.rng(), textRoll = state.rng();
          if (knockRoll < 0.3) {
            applyKnockback(nearest, 0.02, state.mapDef);
            addDeathParticles(state, nearest.x, nearest.y, '#ffab40', 3);
            if (textRoll < 0.3) addFloatingText(state, nearest.x, nearest.y - 0.3, 'KNOCK', '#ffab40', undefined, true,
              { ftType: 'status', miniIcon: 'knockback' });
          }
        }
        addDeathParticles(state, nearest.x, nearest.y, '#c62828', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Oozlings: {
      // Chain: hit up to 3 + extra targets
      const chainMax = 3 + (sp.extraChainTargets ?? 0);
      const targets: UnitState[] = [];
      let lastX = tx, lastY = ty;
      for (let chain = 0; chain < chainMax; chain++) {
        let best: UnitState | null = null;
        const chainRange = chain === 0 ? stats.range : 4;
        let bestDist = chainRange * chainRange;
        // Copy nearby results since we call getNearby multiple times in loop
        const chainNearby = _combatGrid.getNearby(lastX, lastY, chainRange).slice();
        for (const u of chainNearby) {
          if (u.team !== enemyTeam || targets.some(t => t.id === u.id)) continue;
          const d = (u.x - lastX) ** 2 + (u.y - lastY) ** 2;
          if (d <= bestDist && (d < bestDist || (best && u.id < best.id))) { best = u; bestDist = d; }
        }
        if (best) {
          targets.push(best);
          lastX = best.x; lastY = best.y;
        } else break;
      }
      const chainPct = sp.chainDamagePct ?? 0.6;
      let chainX = tx, chainY = ty;
      for (let i = 0; i < targets.length; i++) {
        const dmg = i === 0 ? stats.damage : Math.round(stats.damage * chainPct);
        dealDamage(state, targets[i], dmg, true, building.playerId, undefined, true);
        addDeathParticles(state, targets[i].x, targets[i].y, '#00e5ff', 2);
        // Chain projectile from previous position to this target
        addCombatEvent(state, { type: 'chain', x: chainX, y: chainY, x2: targets[i].x, y2: targets[i].y, color: '#00e5ff' });
        towerChainProjectile(state, building, chainX, chainY, targets[i]);
        chainX = targets[i].x;
        chainY = targets[i].y;
      }
      if (targets.length > 0) {
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Demon: {
      // Single-target + burn
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      const nearest = findNearest(stats.range);
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#ff3d00', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Deep: {
      // AoE slow: hit ALL enemies in range — ice pulse
      const slowStacks = 1 + (sp.extraSlowStacks ?? 0);
      let hit = false;
      const deepNearby = _combatGrid.getNearby(tx, ty, stats.range);
      for (const u of deepNearby) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Slow, slowStacks);
          addDeathParticles(state, u.x, u.y, '#4fc3f7', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#2196f3', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Wild: {
      // AoE poison: damage ALL enemies in range + burn — toxic cloud
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      const slowStacks = sp.extraSlowStacks ?? 0;
      let hit = false;
      const wildNearby = _combatGrid.getNearby(tx, ty, stats.range);
      for (const u of wildNearby) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Burn, burnStacks);
          if (slowStacks > 0) applyStatus(u, StatusType.Slow, slowStacks);
          addDeathParticles(state, u.x, u.y, '#66bb6a', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#4caf50', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Geists: {
      // Wither: hit nearest enemy + apply burn
      const burnStacks = 1 + (sp.extraBurnStacks ?? 0);
      const nearest = findNearest(stats.range);
      if (nearest) {
        towerVisualProjectile(state, building, nearest);
        dealDamage(state, nearest, stats.damage, false, building.playerId, undefined, true);
        applyStatus(nearest, StatusType.Burn, burnStacks);
        addDeathParticles(state, nearest.x, nearest.y, '#546e7a', 2);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    case Race.Tenders: {
      // Thorns aura: damage ALL enemies in range + slow — vine pulse
      const slowStacks = 1 + (sp.extraSlowStacks ?? 0);
      const burnStacks = sp.extraBurnStacks ?? 0;
      let hit = false;
      const tendNearby = _combatGrid.getNearby(tx, ty, stats.range);
      for (const u of tendNearby) {
        if (u.team !== enemyTeam) continue;
        const d = Math.sqrt((u.x - tx) ** 2 + (u.y - ty) ** 2);
        if (d <= stats.range) {
          dealDamage(state, u, stats.damage, false, building.playerId, undefined, true);
          applyStatus(u, StatusType.Slow, slowStacks);
          if (burnStacks > 0) applyStatus(u, StatusType.Burn, burnStacks);
          addDeathParticles(state, u.x, u.y, '#a5d6a7', 1);
          hit = true;
        }
      }
      if (hit) {
        towerAoePulse(state, tx, ty, '#81c784', stats.range);
        building.actionTimer = Math.round(stats.attackSpeed * TICK_RATE);
      }
      break;
    }
    // Goblins: default single-target (handled in tickTowers normally via projectile)
  }
}
