import { Race, BuildingType, TICK_RATE } from '../simulation/types';
import { UNIT_STATS, SPAWN_INTERVAL_TICKS, type UpgradeNodeDef, type UpgradeSpecial } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import type { IconName, UIAssets } from '../rendering/UIAssets';

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

export type StatVisualKey =
  | 'health' | 'damage' | 'dps' | 'attack-speed' | 'move-speed' | 'range' | 'spawn-rate'
  | 'burn' | 'slow' | 'dodge' | 'damage-reduction' | 'shield' | 'aoe' | 'splash'
  | 'additional-projectile' | 'chain' | 'chain-heal' | 'healing' | 'regen' | 'wound' | 'cleanse'
  | 'cleave' | 'siege' | 'knockback' | 'gold' | 'haste' | 'revive' | 'summon'
  | 'kill-scale' | 'aura' | 'explode' | 'lifesteal' | 'frenzy' | 'vulnerable';

interface StatVisualMeta {
  color: string;
  statIcon?: string;
  fallbackIcon?: IconName;
}

export const STAT_VISUALS: Record<StatVisualKey, StatVisualMeta> = {
  health: { color: STAT_COLORS.hp, statIcon: 'health' },
  damage: { color: STAT_COLORS.damage, statIcon: 'damage', fallbackIcon: 'sword' },
  dps: { color: STAT_COLORS.dps, statIcon: 'dps', fallbackIcon: 'sword' },
  'attack-speed': { color: STAT_COLORS.atkSpeed, statIcon: 'attack-speed', fallbackIcon: 'sword' },
  'move-speed': { color: STAT_COLORS.moveSpeed, statIcon: 'move-speed' },
  range: { color: STAT_COLORS.range, statIcon: 'range' },
  'spawn-rate': { color: STAT_COLORS.spawnSpeed, statIcon: 'spawn-rate', fallbackIcon: 'research' },
  burn: { color: '#ff7043', statIcon: 'burn' },
  slow: { color: '#4fc3f7', statIcon: 'slow' },
  dodge: { color: '#80cbc4', statIcon: 'dodge' },
  'damage-reduction': { color: '#90a4ae', statIcon: 'damage-reduction', fallbackIcon: 'shield' },
  shield: { color: '#42a5f5', statIcon: 'shield', fallbackIcon: 'shield' },
  aoe: { color: '#ffb74d', statIcon: 'aoe' },
  splash: { color: '#4dd0e1', statIcon: 'splash' },
  'additional-projectile': { color: '#ffd54f', statIcon: 'multishot' },
  chain: { color: '#80cbc4', statIcon: 'chain-heal' },
  'chain-heal': { color: '#80cbc4', statIcon: 'chain-heal' },
  healing: { color: '#66bb6a', statIcon: 'healing' },
  regen: { color: '#9ccc65', statIcon: 'regen' },
  wound: { color: '#ef5350', statIcon: 'wound' },
  cleanse: { color: '#64b5f6', statIcon: 'cleanse' },
  cleave: { color: '#ffa726', statIcon: 'cleave' },
  siege: { color: '#8d6e63', statIcon: 'siege' },
  knockback: { color: '#ffb74d', statIcon: 'knockback' },
  gold: { color: '#ffd740', fallbackIcon: 'gold' },
  haste: { color: '#ec407a', statIcon: 'move-speed' },
  revive: { color: '#aed581', fallbackIcon: 'star' },
  summon: { color: '#bcaaa4', fallbackIcon: 'souls' },
  'kill-scale': { color: '#ffee58', statIcon: 'damage', fallbackIcon: 'star' },
  aura: { color: '#fff176', statIcon: 'aoe', fallbackIcon: 'star' },
  explode: { color: '#ff8a65', statIcon: 'aoe' },
  lifesteal: { color: '#ab47bc', statIcon: 'wound', fallbackIcon: 'souls' },
  frenzy: { color: '#ef5350', statIcon: 'damage', fallbackIcon: 'sword' },
  vulnerable: { color: '#ffca28', statIcon: 'wound', fallbackIcon: 'info' },
};

export interface StatTextLine {
  key: StatVisualKey;
  text: string;
  isBuff: boolean;
}

export function getStatVisual(key: StatVisualKey): StatVisualMeta {
  return STAT_VISUALS[key];
}

export function drawStatVisualIcon(
  ctx: CanvasRenderingContext2D,
  ui: UIAssets,
  key: StatVisualKey,
  x: number, y: number, size: number,
  noBg = false,
): boolean {
  const visual = getStatVisual(key);
  if (!noBg) {
    // Draw a dark rounded background for contrast
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 3);
    ctx.fill();
  }
  // Draw the icon 5% smaller, centered within the background
  const iconSize = noBg ? size : size * 0.95;
  const offset = (size - iconSize) / 2;
  const ix = x + offset;
  const iy = y + offset;
  if (visual.statIcon && ui.drawStatIcon(ctx, visual.statIcon, ix, iy, iconSize, visual.color)) return true;
  if (visual.fallbackIcon) return ui.drawTintedIcon(ctx, visual.fallbackIcon, ix, iy, iconSize, visual.color);
  return false;
}

// ── Shared bar layout constants ──
const BAR_LABEL_W = 86;
const BAR_VALUE_W = 40;

// ── Draw a single stat bar ──
export function drawStatBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, barW: number, barH: number,
  label: string, value: number, max: number, display: string, color: string,
  ui?: UIAssets,
  iconKey?: StatVisualKey,
): void {
  const iconSize = barH + 4;
  const iconOffset = ui && iconKey ? iconSize + 6 : 0;
  if (ui && iconKey) {
    drawStatVisualIcon(ctx, ui, iconKey, x, y - 1, iconSize);
  }

  // Label
  ctx.fillStyle = '#aaa';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + iconOffset, y + barH - 2);

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
export function formatNodeStatChanges(node: UpgradeNodeDef): StatTextLine[] {
  // Specials first (unique abilities the player needs to read)
  const specials: StatTextLine[] = [];
  if (node.special) specials.push(...formatSpecialBonuses(node.special));

  // Stat multipliers second (bars show these, but text reinforces)
  const stats: StatTextLine[] = [];
  if (node.hpMult && node.hpMult !== 1) {
    const pct = Math.round((node.hpMult - 1) * 100);
    stats.push({ key: 'health', text: `${pct > 0 ? '+' : ''}${pct}% HP`, isBuff: pct > 0 });
  }
  if (node.damageMult && node.damageMult !== 1) {
    const pct = Math.round((node.damageMult - 1) * 100);
    stats.push({ key: 'damage', text: `${pct > 0 ? '+' : ''}${pct}% damage`, isBuff: pct > 0 });
  }
  if (node.attackSpeedMult && node.attackSpeedMult !== 1) {
    const pct = Math.round((1 - node.attackSpeedMult) * 100);
    const label = pct > 0 ? 'faster attacks' : 'slower attacks';
    stats.push({ key: 'attack-speed', text: `${Math.abs(pct)}% ${label}`, isBuff: pct > 0 });
  }
  if (node.moveSpeedMult && node.moveSpeedMult !== 1) {
    const pct = Math.round((node.moveSpeedMult - 1) * 100);
    stats.push({ key: 'move-speed', text: `${pct > 0 ? '+' : ''}${pct}% move speed`, isBuff: pct > 0 });
  }
  if (node.rangeMult && node.rangeMult !== 1) {
    const pct = Math.round((node.rangeMult - 1) * 100);
    stats.push({ key: 'range', text: `${pct > 0 ? '+' : ''}${pct}% range`, isBuff: pct > 0 });
  }
  if (node.spawnSpeedMult && node.spawnSpeedMult !== 1) {
    const pct = Math.round((1 - node.spawnSpeedMult) * 100);
    stats.push({ key: 'spawn-rate', text: `${Math.abs(pct)}% ${pct > 0 ? 'faster' : 'slower'} spawns`, isBuff: pct > 0 });
  }

  return [...specials, ...stats];
}

// ── Generate only special/abstract effect lines (used in hover bonuses below stat bars) ──
// Excludes stat multipliers and dodge/DR since those are shown as bars.
export function formatSpecialOnlyChanges(node: UpgradeNodeDef): StatTextLine[] {
  if (!node.special) return [];
  return formatSpecialBonuses(node.special);
}

// ── Generate readable lines for UpgradeSpecial effects ──
export function formatSpecialBonuses(special: UpgradeSpecial): StatTextLine[] {
  const lines: StatTextLine[] = [];

  if (special.goldOnKill) lines.push({ key: 'gold', text: `+${special.goldOnKill} gold per kill`, isBuff: true });
  if (special.goldOnDeath) lines.push({ key: 'gold', text: `+${special.goldOnDeath} gold on death`, isBuff: true });
  // dodgeChance and damageReductionPct are shown as stat bars, not text lines
  if (special.extraBurnStacks) lines.push({ key: 'burn', text: `+${special.extraBurnStacks} burn on hit`, isBuff: true });
  if (special.extraSlowStacks) lines.push({ key: 'slow', text: `+${special.extraSlowStacks} slow on hit`, isBuff: true });
  if (special.knockbackEveryN) lines.push({ key: 'knockback', text: `Knockback every ${special.knockbackEveryN} hits`, isBuff: true });
  if (special.guaranteedHaste) lines.push({ key: 'haste', text: 'Haste on hit', isBuff: true });
  if (special.shieldTargetBonus) lines.push({ key: 'shield', text: `Shield +${special.shieldTargetBonus} targets`, isBuff: true });
  if (special.shieldAbsorbBonus) lines.push({ key: 'shield', text: `Shield +${special.shieldAbsorbBonus} absorb`, isBuff: true });
  if (special.shieldSelf) lines.push({ key: 'shield', text: 'Shields self on attack', isBuff: true });
  if (special.crownMage) lines.push({ key: 'aoe', text: 'AoE damage mode', isBuff: true });
  if (special.aoeRadiusBonus) lines.push({ key: 'aoe', text: `+${special.aoeRadiusBonus} AoE radius`, isBuff: true });
  if (special.splashRadius) lines.push({ key: 'splash', text: `Splash ${special.splashRadius}t at ${Math.round((special.splashDamagePct ?? 0.5) * 100)}%`, isBuff: true });
  if (special.multishotCount) lines.push({ key: 'additional-projectile', text: `+${special.multishotCount} projectile at ${Math.round((special.multishotDamagePct ?? 0.5) * 100)}%`, isBuff: true });
  if (special.chainHeal) lines.push({ key: 'chain-heal', text: `Chain heal ${special.chainHeal} allies`, isBuff: true });
  if (special.healBonus) lines.push({ key: 'healing', text: `+${special.healBonus} heal amount`, isBuff: true });
  if (special.regenPerSec) lines.push({ key: 'regen', text: `${special.regenPerSec} HP/s regen`, isBuff: true });
  if (special.reviveHpPct) lines.push({ key: 'revive', text: `Revive at ${Math.round(special.reviveHpPct * 100)}% HP`, isBuff: true });
  if (special.cleaveTargets) lines.push({ key: 'cleave', text: `Cleave ${special.cleaveTargets} targets`, isBuff: true });
  if (special.hopAttack) lines.push({ key: 'move-speed', text: 'Leap attack + AoE slow', isBuff: true });
  if (special.suicideAttack) lines.push({ key: 'explode', text: `Suicide attack (${special.explodeDamage ?? 0} dmg, ${special.explodeRadius ?? 0}t AoE)`, isBuff: true });
  if (special.skeletonSummonChance) lines.push({ key: 'summon', text: `${Math.round(special.skeletonSummonChance * 100)}% summon chance`, isBuff: true });
  if (special.soulHarvest) lines.push({ key: 'summon', text: `Grows from nearby deaths (max ${special.soulMaxStacks ?? 20})`, isBuff: true });
  if (special.killScaling) lines.push({ key: 'kill-scale', text: `+${Math.round((special.killDmgPct ?? 0.05) * 100)}% dmg/kill (max ${special.killMaxStacks ?? 10})`, isBuff: true });
  if (special.isSiegeUnit) lines.push({ key: 'siege', text: `SIEGE: ${special.buildingDamageMult ?? 3}x building damage`, isBuff: true });
  if (special.towerRangeBonus) lines.push({ key: 'range', text: `+${special.towerRangeBonus} tower range`, isBuff: true });
  if (special.spawnCount) lines.push({ key: 'spawn-rate', text: `Spawn ${special.spawnCount} per cycle`, isBuff: special.spawnCount > 1 });
  if (special.extraChainTargets) lines.push({ key: 'chain', text: `Chain to ${special.extraChainTargets} targets`, isBuff: true });
  if (special.auraDamageBonus) lines.push({ key: 'aura', text: `AURA: +${special.auraDamageBonus} damage nearby`, isBuff: true });
  if (special.auraSpeedBonus) lines.push({ key: 'aura', text: `AURA: +${Math.round(special.auraSpeedBonus * 100)}% speed nearby`, isBuff: true });
  if (special.auraArmorBonus) lines.push({ key: 'aura', text: `AURA: +${Math.round(special.auraArmorBonus * 100)}% armor nearby`, isBuff: true });

  return lines;
}
