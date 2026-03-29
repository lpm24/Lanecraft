import { Race, BuildingType, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, SPAWN_INTERVAL_TICKS, type UpgradeNodeDef, type UpgradeSpecial } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';

// ── All races & categories for max-stat sweep ──
const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];
const CATEGORIES: BuildingType[] = [
  BuildingType.MeleeSpawner, BuildingType.RangedSpawner, BuildingType.CasterSpawner,
];
const ALL_PATHS: string[][] = [
  ['A'], ['A','B'], ['A','C'],
  ['A','B','D'], ['A','B','E'], ['A','C','F'], ['A','C','G'],
];

// ── MAX_STATS: computed once, used by all bar renderers ──
export interface MaxStats {
  hp: number; damage: number; dps: number; moveSpeed: number; atkRate: number; range: number; spawnRate: number;
}

export function computeMaxStats(): MaxStats {
  let maxHp = 0, maxDmg = 0, maxDps = 0, maxSpd = 0, maxAtkRate = 0, maxRange = 0, maxSpawnRate = 0;
  for (const race of ALL_RACES) {
    for (const bt of CATEGORIES) {
      const base = UNIT_STATS[race]?.[bt];
      if (!base) continue;
      for (const path of ALL_PATHS) {
        const upgrade = getUnitUpgradeMultipliers(path, race, bt);
        const hp = Math.round(base.hp * upgrade.hp);
        const dmg = Math.round(base.damage * upgrade.damage);
        const atkSpd = base.attackSpeed * upgrade.attackSpeed;
        const dps = dmg / atkSpd;
        const atkRate = 1 / atkSpd;
        const spd = base.moveSpeed * upgrade.moveSpeed;
        const range = Math.round(base.range * upgrade.range);
        const baseSpawnSec = SPAWN_INTERVAL_TICKS / TICK_RATE;
        const spawnRate = 1 / (baseSpawnSec * upgrade.spawnSpeed); // higher = faster spawns
        if (hp > maxHp) maxHp = hp;
        if (dmg > maxDmg) maxDmg = dmg;
        if (dps > maxDps) maxDps = dps;
        if (atkRate > maxAtkRate) maxAtkRate = atkRate;
        if (spd > maxSpd) maxSpd = spd;
        if (range > maxRange) maxRange = range;
        if (spawnRate > maxSpawnRate) maxSpawnRate = spawnRate;
      }
    }
  }
  return { hp: maxHp, damage: maxDmg, dps: maxDps, moveSpeed: maxSpd, atkRate: maxAtkRate, range: maxRange, spawnRate: maxSpawnRate };
}

export const MAX_STATS = computeMaxStats();

// ── Stat bar colors ──
export const STAT_COLORS = {
  hp: '#4caf50',
  damage: '#f44336',
  dps: '#ff9800',
  atkSpeed: '#e91e63',
  moveSpeed: '#2196f3',
  range: '#9c27b0',
  spawnSpeed: '#ffb74d',
} as const;

// ── Emoji stat icons (temp measure) ──
export const STAT_EMOJI: Record<string, string> = {
  hp: '\u2764\uFE0F', damage: '\u2694\uFE0F', atkSpeed: '\u26A1', moveSpeed: '\uD83C\uDFC3',
  range: '\uD83C\uDFAF', spawnSpeed: '\u23F0', burn: '\uD83D\uDD25', slow: '\u2744\uFE0F',
  dodge: '\uD83D\uDCA8', shield: '\uD83D\uDEE1\uFE0F', heal: '\uD83D\uDC9A', aoe: '\uD83D\uDCA5',
  knockback: '\uD83D\uDCAA', gold: '\uD83E\uDE99', regen: '\u267B\uFE0F', summon: '\uD83D\uDC80',
  splash: '\uD83D\uDCA6', chain: '\u26D3\uFE0F', armor: '\uD83D\uDEE1\uFE0F', haste: '\u2728',
  aura: '\uD83D\uDCE2', siege: '\uD83C\uDFF0', explode: '\uD83D\uDCA3', revive: '\u271D\uFE0F',
  wound: '\uD83E\uDE79', lifesteal: '\uD83E\uDE78', frenzy: '\uD83D\uDE24', vulnerable: '\u26A0\uFE0F',
  killScale: '\uD83D\uDCC8',
};

// ── Shared bar layout constants ──
const BAR_LABEL_W = 70;
const BAR_VALUE_W = 36;

// ── Draw a single stat bar ──
export function drawStatBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, barW: number, barH: number,
  label: string, value: number, max: number, display: string, color: string,
): void {
  // Label
  ctx.fillStyle = '#aaa';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + barH - 2);

  // Value (right-aligned)
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(display, x + barW, y + barH - 2);

  // Bar background
  const bx = x + BAR_LABEL_W;
  const bw = barW - BAR_LABEL_W - BAR_VALUE_W;
  const by = y + 1;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, barH - 2, 3);
  ctx.fill();

  // Filled portion
  const pct = Math.min(1, Math.max(0, value / max));
  if (pct > 0) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(2, bw * pct), barH - 2, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ── Draw delta overlay on a stat bar ──
// Draws the green/red bar segment AND replaces the value text with "current → projected"
export function drawStatBarDelta(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, barW: number, barH: number,
  currentVal: number, projectedVal: number, max: number,
  deltaDisplay: string,
): void {
  const bx = x + BAR_LABEL_W;
  const bw = barW - BAR_LABEL_W - BAR_VALUE_W;
  const by = y + 1;

  const curPct = Math.min(1, Math.max(0, currentVal / max));
  const projPct = Math.min(1, Math.max(0, projectedVal / max));

  if (projPct > curPct) {
    // Buff: green extension
    ctx.fillStyle = '#4caf50';
    ctx.globalAlpha = 0.6;
    const startX = bx + bw * curPct;
    const deltaW = bw * (projPct - curPct);
    ctx.beginPath();
    ctx.roundRect(startX, by, Math.max(2, deltaW), barH - 2, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (projPct < curPct) {
    // Nerf: red overlay
    ctx.fillStyle = '#f44336';
    ctx.globalAlpha = 0.6;
    const startX = bx + bw * projPct;
    const deltaW = bw * (curPct - projPct);
    ctx.beginPath();
    ctx.roundRect(startX, by, Math.max(2, deltaW), barH - 2, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Replace value text: erase original, draw projected in buff/nerf color
  if (deltaDisplay) {
    const isBuff = projectedVal > currentVal;
    // Black-out the original value area
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x + barW - BAR_VALUE_W, y, BAR_VALUE_W, barH);
    // Draw projected value with arrow
    ctx.fillStyle = isBuff ? '#69f0ae' : '#ff6666';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('\u2192' + deltaDisplay, x + barW, y + barH - 2);
  }
}

// ── Generate ALL stat change lines for an upgrade node (used in upgrade button descriptions) ──
// Special/unique abilities come FIRST so they aren't truncated by the 3-line limit.
// Stat multipliers come after since the bars already show those visually.
export function formatNodeStatChanges(node: UpgradeNodeDef): { text: string; isBuff: boolean }[] {
  // Specials first (unique abilities the player needs to read)
  const specials: { text: string; isBuff: boolean }[] = [];
  if (node.special) specials.push(...formatSpecialBonuses(node.special));

  // Stat multipliers second (bars show these, but text reinforces)
  const stats: { text: string; isBuff: boolean }[] = [];
  if (node.hpMult && node.hpMult !== 1) {
    const pct = Math.round((node.hpMult - 1) * 100);
    stats.push({ text: `${STAT_EMOJI.hp} ${pct > 0 ? '+' : ''}${pct}% HP`, isBuff: pct > 0 });
  }
  if (node.damageMult && node.damageMult !== 1) {
    const pct = Math.round((node.damageMult - 1) * 100);
    stats.push({ text: `${STAT_EMOJI.damage} ${pct > 0 ? '+' : ''}${pct}% damage`, isBuff: pct > 0 });
  }
  if (node.attackSpeedMult && node.attackSpeedMult !== 1) {
    const pct = Math.round((1 - node.attackSpeedMult) * 100);
    const label = pct > 0 ? 'faster attacks' : 'slower attacks';
    stats.push({ text: `${STAT_EMOJI.atkSpeed} ${Math.abs(pct)}% ${label}`, isBuff: pct > 0 });
  }
  if (node.moveSpeedMult && node.moveSpeedMult !== 1) {
    const pct = Math.round((node.moveSpeedMult - 1) * 100);
    stats.push({ text: `${STAT_EMOJI.moveSpeed} ${pct > 0 ? '+' : ''}${pct}% move speed`, isBuff: pct > 0 });
  }
  if (node.rangeMult && node.rangeMult !== 1) {
    const pct = Math.round((node.rangeMult - 1) * 100);
    stats.push({ text: `${STAT_EMOJI.range} ${pct > 0 ? '+' : ''}${pct}% range`, isBuff: pct > 0 });
  }
  if (node.spawnSpeedMult && node.spawnSpeedMult !== 1) {
    const pct = Math.round((1 - node.spawnSpeedMult) * 100);
    stats.push({ text: `${STAT_EMOJI.spawnSpeed} ${Math.abs(pct)}% ${pct > 0 ? 'faster' : 'slower'} spawns`, isBuff: pct > 0 });
  }

  return [...specials, ...stats];
}

// ── Generate only special/abstract effect lines (used in hover bonuses below stat bars) ──
// Excludes stat multipliers and dodge/DR since those are shown as bars.
export function formatSpecialOnlyChanges(node: UpgradeNodeDef): { text: string; isBuff: boolean }[] {
  if (!node.special) return [];
  return formatSpecialBonuses(node.special);
}

// ── Generate readable lines for UpgradeSpecial effects ──
export function formatSpecialBonuses(special: UpgradeSpecial): { text: string; isBuff: boolean }[] {
  const lines: { text: string; isBuff: boolean }[] = [];

  if (special.goldOnKill) lines.push({ text: `${STAT_EMOJI.gold} +${special.goldOnKill} gold per kill`, isBuff: true });
  if (special.goldOnDeath) lines.push({ text: `${STAT_EMOJI.gold} +${special.goldOnDeath} gold on death`, isBuff: true });
  // dodgeChance and damageReductionPct are shown as stat bars, not text lines
  if (special.extraBurnStacks) lines.push({ text: `${STAT_EMOJI.burn} +${special.extraBurnStacks} burn on hit`, isBuff: true });
  if (special.extraSlowStacks) lines.push({ text: `${STAT_EMOJI.slow} +${special.extraSlowStacks} slow on hit`, isBuff: true });
  if (special.knockbackEveryN) lines.push({ text: `${STAT_EMOJI.knockback} Knockback every ${special.knockbackEveryN} hits`, isBuff: true });
  if (special.guaranteedHaste) lines.push({ text: `${STAT_EMOJI.haste} Haste on hit`, isBuff: true });
  if (special.shieldTargetBonus) lines.push({ text: `${STAT_EMOJI.shield} Shield +${special.shieldTargetBonus} targets`, isBuff: true });
  if (special.shieldAbsorbBonus) lines.push({ text: `${STAT_EMOJI.shield} Shield +${special.shieldAbsorbBonus} absorb`, isBuff: true });
  if (special.crownMage) lines.push({ text: `${STAT_EMOJI.aoe} AoE damage mode`, isBuff: true });
  if (special.aoeRadiusBonus) lines.push({ text: `${STAT_EMOJI.aoe} +${special.aoeRadiusBonus} AoE radius`, isBuff: true });
  if (special.splashRadius) lines.push({ text: `${STAT_EMOJI.splash} Splash ${special.splashRadius}t at ${Math.round((special.splashDamagePct ?? 0.5) * 100)}%`, isBuff: true });
  if (special.multishotCount) lines.push({ text: `${STAT_EMOJI.range} +${special.multishotCount} projectile at ${Math.round((special.multishotDamagePct ?? 0.5) * 100)}%`, isBuff: true });
  if (special.chainHeal) lines.push({ text: `${STAT_EMOJI.heal} Chain heal ${special.chainHeal} allies`, isBuff: true });
  if (special.healBonus) lines.push({ text: `${STAT_EMOJI.heal} +${special.healBonus} heal amount`, isBuff: true });
  if (special.regenPerSec) lines.push({ text: `${STAT_EMOJI.regen} ${special.regenPerSec} HP/s regen`, isBuff: true });
  if (special.reviveHpPct) lines.push({ text: `${STAT_EMOJI.revive} Revive at ${Math.round(special.reviveHpPct * 100)}% HP`, isBuff: true });
  if (special.cleaveTargets) lines.push({ text: `${STAT_EMOJI.damage} Cleave ${special.cleaveTargets} targets`, isBuff: true });
  if (special.hopAttack) lines.push({ text: `${STAT_EMOJI.moveSpeed} Leap attack + AoE slow`, isBuff: true });
  if (special.explodeOnDeath) lines.push({ text: `${STAT_EMOJI.explode} Explode on death (${special.explodeDamage ?? 0} dmg, ${special.explodeRadius ?? 0}t)`, isBuff: true });
  if (special.skeletonSummonChance) lines.push({ text: `${STAT_EMOJI.summon} ${Math.round(special.skeletonSummonChance * 100)}% summon chance`, isBuff: true });
  if (special.soulHarvest) lines.push({ text: `${STAT_EMOJI.summon} Grows from nearby deaths (max ${special.soulMaxStacks ?? 20})`, isBuff: true });
  if (special.killScaling) lines.push({ text: `${STAT_EMOJI.killScale} +${Math.round((special.killDmgPct ?? 0.05) * 100)}% dmg/kill (max ${special.killMaxStacks ?? 10})`, isBuff: true });
  if (special.isSiegeUnit) lines.push({ text: `${STAT_EMOJI.siege} SIEGE: ${special.buildingDamageMult ?? 3}x building damage`, isBuff: true });
  if (special.towerRangeBonus) lines.push({ text: `${STAT_EMOJI.range} +${special.towerRangeBonus} tower range`, isBuff: true });
  if (special.spawnCount) lines.push({ text: `${STAT_EMOJI.spawnSpeed} Spawn ${special.spawnCount} per cycle`, isBuff: special.spawnCount > 1 });
  if (special.extraChainTargets) lines.push({ text: `${STAT_EMOJI.chain} Chain to ${special.extraChainTargets} targets`, isBuff: true });
  if (special.auraDamageBonus) lines.push({ text: `${STAT_EMOJI.aura} AURA: +${special.auraDamageBonus} damage nearby`, isBuff: true });
  if (special.auraSpeedBonus) lines.push({ text: `${STAT_EMOJI.aura} AURA: +${Math.round(special.auraSpeedBonus * 100)}% speed nearby`, isBuff: true });
  if (special.auraArmorBonus) lines.push({ text: `${STAT_EMOJI.aura} AURA: +${Math.round(special.auraArmorBonus * 100)}% armor nearby`, isBuff: true });

  return lines;
}
