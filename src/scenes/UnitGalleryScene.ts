import { Scene, SceneManager } from './Scene';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { UIAssets, IconName } from '../rendering/UIAssets';
import { Race, BuildingType, TILE_SIZE } from '../simulation/types';
import { loadProfile, checkNonMatchAchievement, ACHIEVEMENTS } from '../profile/ProfileData';
import {
  UNIT_STATS, RACE_COLORS, RACE_LABELS, UPGRADE_TREES, UpgradeNodeDef, UpgradeSpecial,
  RACE_BUILDING_COSTS, RACE_RESEARCH_UPGRADES, SPAWN_INTERVAL_TICKS,
  getNodeUpgradeCost, TOWER_STATS,
} from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { getElo, ELO_DEFAULT } from './TitleElo';
import { getSafeTop } from '../ui/SafeArea';

const T = TILE_SIZE;

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];

const CATEGORIES: { bt: BuildingType; cat: 'melee' | 'ranged' | 'caster' | 'tower' }[] = [
  { bt: BuildingType.MeleeSpawner, cat: 'melee' },
  { bt: BuildingType.RangedSpawner, cat: 'ranged' },
  { bt: BuildingType.CasterSpawner, cat: 'caster' },
  { bt: BuildingType.Tower, cat: 'tower' },
];
/** Show tower column only if screen is wide enough (>400px) */
function getNumColumns(canvasW: number): number { return canvasW < 400 ? 3 : 4; }

// Upgrade path for each tab
// A=base, B=tier1 choice1, C=tier1 choice2, D=B→choice1, E=B→choice2, F=C→choice1, G=C→choice2
const TAB_PATHS: { label: string; path: string[]; desc: string }[] = [
  { label: 'A',  path: ['A'],           desc: 'Base' },
  { label: 'B',  path: ['A', 'B'],      desc: 'Tier 1a' },
  { label: 'C',  path: ['A', 'C'],      desc: 'Tier 1b' },
  { label: 'D',  path: ['A', 'B', 'D'], desc: 'Tier 2: B\u2192D' },
  { label: 'E',  path: ['A', 'B', 'E'], desc: 'Tier 2: B\u2192E' },
  { label: 'F',  path: ['A', 'C', 'F'], desc: 'Tier 2: C\u2192F' },
  { label: 'G',  path: ['A', 'C', 'G'], desc: 'Tier 2: C\u2192G' },
];

// Display scale multiplier (visual only, not shown in %)
const DISPLAY_SCALE = 1.8;

// Race innate traits for melee/ranged/caster (verified against GameState.ts combat logic)
const RACE_INNATE_TRAITS: Record<Race, Record<string, string[]>> = {
  [Race.Crown]:    { melee: ['10% damage reduction'], ranged: [], caster: ['Shields nearby allies'] },
  [Race.Horde]:    { melee: ['Knockback every 3rd hit', '10% lifesteal'], ranged: ['Wound on hit'], caster: ['Grants Haste to allies', 'AoE damage'] },
  [Race.Goblins]:  { melee: ['15% dodge', 'Wound on hit'], ranged: ['Burn on hit', 'Wound on hit'], caster: ['Slows enemies', 'AoE damage', 'Wound on hit'] },
  [Race.Oozlings]: { melee: ['Spawns x2', '15% chance Haste on hit'], ranged: ['Spawns x2'], caster: ['Spawns x2', 'Haste allies', 'AoE damage'] },
  [Race.Demon]:    { melee: ['Burn on hit', 'Wound on hit'], ranged: ['Burn on hit', 'Wound on hit'], caster: ['AoE burn (pure damage, no support)'] },
  [Race.Deep]:     { melee: ['Slow on hit'], ranged: ['2 Slow on hit'], caster: ['Cleanses burn from allies', 'AoE damage'] },
  [Race.Wild]:     { melee: ['Burn (poison) on hit'], ranged: ['Burn on hit', 'Wound on hit'], caster: ['Haste allies', 'AoE damage'] },
  [Race.Geists]:   { melee: ['Burn on hit', '20% lifesteal', 'Wound on hit'], ranged: ['Burn on hit', '20% lifesteal', 'Wound on hit'], caster: ['Single-target attacker', '20% lifesteal', 'Skeleton summon on nearby death'] },
  [Race.Tenders]:  { melee: ['1 HP/s regen'], ranged: ['Slow on hit'], caster: ['Heals most injured ally', 'AoE damage'] },
};

// Compute max stats across all units at all upgrade tiers for stat bar normalization
function computeMaxStats(): { hp: number; damage: number; dps: number; moveSpeed: number; atkRate: number; range: number } {
  let maxHp = 0, maxDmg = 0, maxDps = 0, maxSpd = 0, maxAtkRate = 0, maxRange = 0;
  for (const race of ALL_RACES) {
    for (const { bt } of CATEGORIES) {
      const base = UNIT_STATS[race]?.[bt];
      if (!base) continue;
      for (const tab of TAB_PATHS) {
        const upgrade = getUnitUpgradeMultipliers(tab.path, race, bt);
        const hp = Math.round(base.hp * upgrade.hp);
        const dmg = Math.round(base.damage * upgrade.damage);
        const atkSpd = base.attackSpeed * upgrade.attackSpeed;
        const dps = dmg / atkSpd;
        const atkRate = 1 / atkSpd;
        const spd = base.moveSpeed * upgrade.moveSpeed;
        const range = Math.round(base.range * upgrade.range);
        if (hp > maxHp) maxHp = hp;
        if (dmg > maxDmg) maxDmg = dmg;
        if (dps > maxDps) maxDps = dps;
        if (atkRate > maxAtkRate) maxAtkRate = atkRate;
        if (spd > maxSpd) maxSpd = spd;
        if (range > maxRange) maxRange = range;
      }
    }
  }
  return { hp: maxHp, damage: maxDmg, dps: maxDps, moveSpeed: maxSpd, atkRate: maxAtkRate, range: maxRange };
}

const MAX_STATS = computeMaxStats();

interface DetailSelection {
  race: Race;
  catIndex: number; // 0=melee, 1=ranged, 2=caster
}

export class UnitGalleryScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private sprites: SpriteLoader;
  private ui: UIAssets;
  private animTime = 0;
  private scrollY = 0;
  private activeTab = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchLastY = 0;
  private detail: DetailSelection | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchMoved = false;
  private touchEndHandler: ((e: TouchEvent) => void) | null = null;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, sprites: SpriteLoader, ui: UIAssets) {
    this.manager = manager;
    this.canvas = canvas;
    this.sprites = sprites;
    this.ui = ui;
  }

  enter(): void {
    this.scrollY = 0;
    this.animTime = 0;
    this.activeTab = 0;
    this.detail = null;
    this.touchMoved = true; // ignore orphaned touchend from scene that opened us

    // Track gallery visit achievement
    const profile = loadProfile();
    const achId = checkNonMatchAchievement(profile, 'gallery_visitor');
    if (achId) { const def = ACHIEVEMENTS.find(a => a.id === achId); if (def) this.manager.showToast(`Achievement: ${def.name}`, def.desc); }

    let lastTouchTime = Date.now(); // debounce stale clicks from prior scene's tap
    this.clickHandler = (e: MouseEvent) => {
      if (Date.now() - lastTouchTime < 300) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this.handleClick(cx, cy);
    };

    this.touchHandler = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (e.type === 'touchstart') {
        e.preventDefault();
        lastTouchTime = Date.now();
        this.touchLastY = touch.clientY;
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchMoved = false;
      } else if (e.type === 'touchmove') {
        e.preventDefault();
        const dy = this.touchLastY - touch.clientY;
        this.touchLastY = touch.clientY;
        const totalDx = Math.abs(touch.clientX - this.touchStartX);
        const totalDy = Math.abs(touch.clientY - this.touchStartY);
        if (totalDx > 8 || totalDy > 8) this.touchMoved = true;
        if (this.detail) {
          this.detailScrollY = Math.max(0, this.detailScrollY + dy);
        } else {
          this.scrollY = Math.max(0, this.scrollY + dy);
        }
      }
    };

    this.touchEndHandler = (e: TouchEvent) => {
      e.preventDefault();
      if (this.touchMoved) return; // was a scroll, not a tap
      const rect = this.canvas.getBoundingClientRect();
      const cx = this.touchStartX - rect.left;
      const cy = this.touchStartY - rect.top;
      this.handleClick(cx, cy);
    };

    this.wheelHandler = (e: WheelEvent) => {
      if (this.detail) {
        this.detailScrollY = Math.max(0, this.detailScrollY + e.deltaY);
      } else {
        this.scrollY = Math.max(0, this.scrollY + e.deltaY);
      }
    };

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.detail) { this.detail = null; return; }
        this.manager.switchTo('title');
      }
      if (this.detail) {
        if (e.key === 'ArrowLeft') { this.cycleRace(-1); return; }
        if (e.key === 'ArrowRight') { this.cycleRace(1); return; }
        return;
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= 7) { this.activeTab = num - 1; this.scrollY = 0; }
    };

    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: true });
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) {
      this.canvas.removeEventListener('touchstart', this.touchHandler);
      this.canvas.removeEventListener('touchmove', this.touchHandler);
    }
    if (this.touchEndHandler) this.canvas.removeEventListener('touchend', this.touchEndHandler);
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.clickHandler = null;
    this.touchHandler = null;
    this.touchEndHandler = null;
    this.wheelHandler = null;
    this.keyHandler = null;
  }

  private detailScrollY = 0;

  private cycleRace(dir: -1 | 1): void {
    if (!this.detail) return;
    const curIdx = ALL_RACES.indexOf(this.detail.race);
    const next = (curIdx + dir + ALL_RACES.length) % ALL_RACES.length;
    this.detail = { race: ALL_RACES[next], catIndex: this.detail.catIndex };
    this.detailScrollY = 0;
  }

  // Store arrow button positions for click detection
  private leftArrowRect = { x: 0, y: 0, w: 0, h: 0 };
  private rightArrowRect = { x: 0, y: 0, w: 0, h: 0 };

  private handleClick(cx: number, cy: number): void {
    // If detail panel is open, handle close
    if (this.detail) {
      const W = this.canvas.clientWidth;
      const H = this.canvas.clientHeight;
      const panelW = Math.min(520, W - 32);
      const panelX = (W - panelW) / 2;
      const panelY = 20 + getSafeTop();
      const panelH = H - panelY - 20;
      // Close button (top-right of panel) — 44x44 touch target
      const closeBtnSize = 44;
      const closeX = panelX + panelW - closeBtnSize - 4;
      const closeY = panelY + 4;
      if (cx >= closeX && cx <= closeX + closeBtnSize && cy >= closeY && cy <= closeY + closeBtnSize) {
        this.detail = null;
        return;
      }
      // Left/right arrow buttons (in fixed header, not scrolled)
      const la = this.leftArrowRect;
      if (cx >= la.x && cx <= la.x + la.w && cy >= la.y && cy <= la.y + la.h) {
        this.cycleRace(-1);
        return;
      }
      const ra = this.rightArrowRect;
      if (cx >= ra.x && cx <= ra.x + ra.w && cy >= ra.y && cy <= ra.y + ra.h) {
        this.cycleRace(1);
        return;
      }
      // Click outside panel closes it
      if (cx < panelX || cx > panelX + panelW || cy < panelY || cy > panelY + panelH) {
        this.detail = null;
        return;
      }
      // Check upgrade path node clicks (in fixed header area, not scrolled)
      this.handleDetailUpgradeClick(cx, cy, panelX, panelW);
      return;
    }

    // Back button
    if (cy < 36 + getSafeTop() && cy > getSafeTop() && cx < 100) {
      this.manager.switchTo('title');
      return;
    }
    // Tab bar (fixed at top)
    const tabLayout = this.getTabLayout();
    const tabBarY = tabLayout[0].y;
    const tabH = tabLayout[0].h;
    if (cy >= tabBarY && cy <= tabBarY + tabH) {
      for (let i = 0; i < tabLayout.length; i++) {
        const t = tabLayout[i];
        if (cx >= t.x && cx <= t.x + t.w) {
          this.activeTab = i;
          this.scrollY = 0;
          return;
        }
      }
    }

    // Unit click detection
    const W = this.canvas.clientWidth;
    const numCols = getNumColumns(W);
    const rowH = 110;
    const headerH = 98 + getSafeTop();
    const colMargin = 20;
    const unitSpacing = Math.min(140, Math.max(80, Math.floor((W - colMargin * 2) / numCols)));
    const colStartX = Math.max(colMargin, Math.floor((W - unitSpacing * numCols) / 2));

    const contentY = cy + this.scrollY - headerH;
    const raceIdx = Math.floor(contentY / rowH);
    if (raceIdx < 0 || raceIdx >= ALL_RACES.length) return;

    for (let c = 0; c < numCols; c++) {
      const unitCX = colStartX + c * unitSpacing + unitSpacing / 2;
      if (Math.abs(cx - unitCX) < unitSpacing / 2 - 5) {
        const race = ALL_RACES[raceIdx];
        const { bt, cat } = CATEGORIES[c];
        if (cat === 'tower') {
          if (!TOWER_STATS[race]) return;
        } else {
          if (!UNIT_STATS[race]?.[bt]) return;
        }
        this.detail = { race, catIndex: c };
        this.detailScrollY = 0;
        return;
      }
    }
  }

  // Store upgrade node positions for click detection
  private upgradeNodePositions: { x: number; y: number; w: number; h: number; tabIndex: number }[] = [];

  private handleDetailUpgradeClick(cx: number, cy: number, _panelX: number, _panelW: number): void {
    // Node positions are in screen-space (fixed header, not scrolled)
    for (const node of this.upgradeNodePositions) {
      if (cx >= node.x && cx <= node.x + node.w && cy >= node.y && cy <= node.y + node.h) {
        this.activeTab = node.tabIndex;
        this.detailScrollY = 0;
        return;
      }
    }
  }

  private getTabLayout(): { x: number; y: number; w: number; h: number }[] {
    const W = this.canvas.clientWidth;
    const tabW = Math.min(60, (W - 120) / 7);
    const gap = 8;
    // Gaps: after A (index 0) and after C (index 2)
    const totalW = tabW * 7 + gap * 2;
    const startX = (W - totalW) / 2;
    const tabY = 30 + getSafeTop();
    const tabH = 28;
    return TAB_PATHS.map((_, i) => {
      let x = startX + i * tabW;
      if (i >= 1) x += gap;       // gap after A
      if (i >= 3) x += gap;       // gap after C
      return { x, y: tabY, w: tabW, h: tabH };
    });
  }

  update(dt: number): void {
    this.animTime += dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    const tab = TAB_PATHS[this.activeTab];
    const upgradeTier = tab.path.length - 1; // 0, 1, or 2

    // Layout constants — responsive to screen width
    const numCols = getNumColumns(W);
    const rowH = 110;
    const headerH = 98 + getSafeTop();
    const labelPad = 14; // left margin for race label (overlaps first unit column)
    const colMargin = 20; // margin on each side of the 3 columns
    const unitSpacing = Math.min(140, Math.max(80, Math.floor((W - colMargin * 2) / numCols)));
    const colStartX = Math.max(colMargin, Math.floor((W - unitSpacing * numCols) / 2));
    const totalContentH = headerH + ALL_RACES.length * rowH + 40;

    // Clamp scroll
    const maxScroll = Math.max(0, totalContentH - H);
    this.scrollY = Math.min(this.scrollY, maxScroll);

    ctx.save();
    ctx.translate(0, -this.scrollY + headerH);

    // Tick for animation (simulate 20tps)
    const tick = Math.floor(this.animTime / 50);

    // Draw each race row
    for (let r = 0; r < ALL_RACES.length; r++) {
      const race = ALL_RACES[r];
      const rc = RACE_COLORS[race];
      const rowY = r * rowH;

      // Race row background (alternating)
      ctx.fillStyle = r % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(0, rowY, W, rowH);

      // Race label — top-left of row (overlaps first unit column)
      ctx.fillStyle = rc.primary;
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(RACE_LABELS[race], labelPad, rowY + 16);

      // Draw each column (melee, ranged, caster, tower)
      for (let c = 0; c < numCols; c++) {
        const { bt, cat } = CATEGORIES[c];
        const unitCX = colStartX + c * unitSpacing + unitSpacing / 2;
        const unitCY = rowY + rowH * 0.38;
        const isTower = cat === 'tower';

        // Get upgrade info for this tab
        const tree = UPGRADE_TREES[race]?.[bt];
        const nodeKey = tab.path[tab.path.length - 1];
        const nodeDef: UpgradeNodeDef | undefined = nodeKey !== 'A' ? (tree as any)?.[nodeKey] : undefined;

        if (isTower) {
          // Tower column: building sprite only (no unit)
          if (!TOWER_STATS[race]) continue;
          const towerName = nodeDef?.name ?? 'Tower';
          const bldgImg = this.sprites.getBuildingSprite(bt, 0, false, race, tab.path);
          if (bldgImg) {
            const bldgMaxH = rowH * 0.6;
            const bAsp = bldgImg.width / bldgImg.height;
            const bldgH = bldgMaxH;
            const bldgW = bldgH * bAsp;
            ctx.drawImage(bldgImg, unitCX - bldgW / 2, unitCY - bldgH * 0.35 - 10, bldgW, bldgH);
          }
          ctx.fillStyle = nodeDef ? '#e0c860' : '#ccc';
          ctx.font = 'bold 11px monospace';
          ctx.textAlign = 'center';
          this.drawTruncatedText(ctx, towerName, unitCX, unitCY + 38, unitSpacing - 8);
          continue;
        }

        // Unit columns (melee/ranged/caster)
        const baseStats = UNIT_STATS[race]?.[bt];
        if (!baseStats) continue;
        const displayName = nodeDef?.name ?? baseStats.name;

        // Draw building sprite behind unit (offset up-left)
        const bldgImg = this.sprites.getBuildingSprite(bt, 0, false, race, tab.path);
        if (bldgImg) {
          const bldgMaxH = rowH * 0.45;
          const bAsp = bldgImg.width / bldgImg.height;
          const bldgW = bldgMaxH * bAsp;
          ctx.globalAlpha = 0.45;
          ctx.drawImage(bldgImg, unitCX - bldgW * 0.65 - 7, unitCY - bldgMaxH * 0.3 - 13, bldgW, bldgMaxH);
          ctx.globalAlpha = 1;
        }

        // Get sprite and render (use upgrade node for art-changing paths)
        const spriteData = this.sprites.getUnitSprite(race, cat as 'melee' | 'ranged' | 'caster', 0, false, nodeKey !== 'A' ? nodeKey : undefined);
        if (spriteData) {
          const [img, def] = spriteData;
          const spriteScale = def.scale ?? 1.0;
          const baseH = T * 1.82 * spriteScale * DISPLAY_SCALE;
          const tierScale = 1.0 + upgradeTier * 0.15;
          const aspect = def.frameW / def.frameH;
          const drawW = baseH * aspect * tierScale;
          const drawH = baseH * (def.heightScale ?? 1.0) * tierScale;
          const gY = def.groundY ?? 0.71;

          // Anchor feet
          const feetY = unitCY + 20;
          const drawX = unitCX - drawW * (def.anchorX ?? 0.5);
          const drawY = feetY - drawH * gY;

          // Animate
          const frame = getSpriteFrame(tick, def);

          // Drop shadow
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(unitCX, feetY + 2, drawW * 0.35, 4, 0, 0, Math.PI * 2);
          ctx.fill();

          // Apply flipX if sprite faces wrong direction natively
          if (def.flipX) {
            ctx.save();
            ctx.translate(unitCX, 0);
            ctx.scale(-1, 1);
            ctx.translate(-unitCX, 0);
          }

          // Tier glow
          if (upgradeTier >= 1) {
            ctx.globalAlpha = 0.12 + upgradeTier * 0.06;
            ctx.globalCompositeOperation = 'lighter';
            drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          }

          drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);

          if (def.flipX) {
            ctx.restore();
          }

          // Ground line
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath();
          ctx.moveTo(unitCX - 35, feetY);
          ctx.lineTo(unitCX + 35, feetY);
          ctx.stroke();
        } else {
          ctx.fillStyle = rc.primary;
          ctx.beginPath();
          ctx.arc(unitCX, unitCY, 10, 0, Math.PI * 2);
          ctx.fill();
        }

        // Unit name (truncated)
        ctx.fillStyle = nodeDef ? '#e0c860' : '#ccc';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        this.drawTruncatedText(ctx, displayName, unitCX, unitCY + 38, unitSpacing - 8);
      }
    }

    ctx.restore();

    // === Fixed header ===
    ctx.fillStyle = 'rgba(26,26,46,0.95)';
    ctx.fillRect(0, 0, W, headerH);

    // Back button
    const st = getSafeTop();
    ctx.fillStyle = '#4fc3f7';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('< BACK', 14, 18 + st);

    // Title
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UNIT GALLERY', W / 2, 18 + st);

    // Tab bar — rarity colors: A=common, B/C=rare blue, D/E/F/G=epic purple
    const tabLayout = this.getTabLayout();
    const TAB_RARITY: { bg: string; bgActive: string; border: string; borderActive: string; text: string; textActive: string }[] = [
      // A — common (white/grey)
      { bg: '#22223a', bgActive: '#3a3a4e', border: '#555', borderActive: '#ccc', text: '#888', textActive: '#e0e0e0' },
      // B — rare blue
      { bg: '#1a2a40', bgActive: '#1e3a5e', border: '#2a5a8a', borderActive: '#4fc3f7', text: '#4a90c0', textActive: '#4fc3f7' },
      // C — rare blue
      { bg: '#1a2a40', bgActive: '#1e3a5e', border: '#2a5a8a', borderActive: '#4fc3f7', text: '#4a90c0', textActive: '#4fc3f7' },
      // D — epic purple
      { bg: '#2a1a3a', bgActive: '#3e2258', border: '#6a3a9a', borderActive: '#b388ff', text: '#8a5abf', textActive: '#b388ff' },
      // E — epic purple
      { bg: '#2a1a3a', bgActive: '#3e2258', border: '#6a3a9a', borderActive: '#b388ff', text: '#8a5abf', textActive: '#b388ff' },
      // F — epic purple
      { bg: '#2a1a3a', bgActive: '#3e2258', border: '#6a3a9a', borderActive: '#b388ff', text: '#8a5abf', textActive: '#b388ff' },
      // G — epic purple
      { bg: '#2a1a3a', bgActive: '#3e2258', border: '#6a3a9a', borderActive: '#b388ff', text: '#8a5abf', textActive: '#b388ff' },
    ];
    for (let i = 0; i < TAB_PATHS.length; i++) {
      const t = tabLayout[i];
      const isActive = i === this.activeTab;
      const r = TAB_RARITY[i];

      // Tab background
      ctx.fillStyle = isActive ? r.bgActive : r.bg;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      // Border
      ctx.strokeStyle = isActive ? r.borderActive : r.border;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeRect(t.x, t.y, t.w, t.h);

      // Tab label
      ctx.fillStyle = isActive ? r.textActive : r.text;
      ctx.font = `bold 13px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(TAB_PATHS[i].label, t.x + t.w / 2, t.y + t.h / 2 + 5);
    }

    // Tab description
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(tab.desc + `  [path: ${tab.path.join('\u2192')}]`, W / 2, 72 + st);

    // Column headers — same layout as unit columns
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#777';
    for (let c = 0; c < numCols; c++) {
      const cx = colStartX + c * unitSpacing + unitSpacing / 2;
      ctx.fillText(CATEGORIES[c].cat.toUpperCase(), cx, headerH - 4);
    }

    // Scroll hint
    if (maxScroll > 0) {
      ctx.fillStyle = '#444';
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`scroll ${Math.round(this.scrollY)}/${Math.round(maxScroll)}`, W - 14, 18);
    }

    ctx.textAlign = 'start';

    // === Detail panel overlay ===
    if (this.detail) {
      this.renderDetailPanel(ctx, W, H, tick);
    }
  }

  private drawTruncatedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
    let display = text;
    while (ctx.measureText(display).width > maxW && display.length > 3) {
      display = display.slice(0, -2) + '…';
    }
    ctx.fillText(display, x, y);
  }

  private renderDetailPanel(ctx: CanvasRenderingContext2D, W: number, H: number, tick: number): void {
    const { race, catIndex } = this.detail!;
    const { bt, cat } = CATEGORIES[catIndex];

    // Tower detail panel (separate path — no unit stats)
    if (cat === 'tower') {
      this.renderTowerDetailPanel(ctx, W, H, tick);
      return;
    }

    const baseStats = UNIT_STATS[race]?.[bt];
    if (!baseStats) return;

    const tab = TAB_PATHS[this.activeTab];
    const nodeKey = tab.path[tab.path.length - 1];
    const upgrade = getUnitUpgradeMultipliers(tab.path, race, bt);
    const tree = UPGRADE_TREES[race]?.[bt];
    const nodeDef: UpgradeNodeDef | undefined = nodeKey !== 'A' ? (tree as any)?.[nodeKey] : undefined;
    const rc = RACE_COLORS[race];

    // Upgraded stats
    const hp = Math.max(1, Math.round(baseStats.hp * upgrade.hp));
    const dmg = Math.max(1, Math.round(baseStats.damage * upgrade.damage));
    const atkSpd = Math.max(0.2, baseStats.attackSpeed * upgrade.attackSpeed);
    const spd = Math.max(0.5, baseStats.moveSpeed * upgrade.moveSpeed);
    const range = Math.max(1, Math.round(baseStats.range * upgrade.range));
    const dps = dmg / atkSpd;
    const spawnCount = upgrade.special?.spawnCount ?? baseStats.spawnCount ?? 1;

    const displayName = nodeDef?.name ?? baseStats.name;
    const upgradeTier = tab.path.length - 1;

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);

    // Panel dimensions
    const panelW = Math.min(520, W - 32);
    const panelX = (W - panelW) / 2;
    const panelY = 20 + getSafeTop();
    const panelH = H - panelY - 20;
    const innerPad = 18;
    const contentW = panelW - innerPad * 2;

    // Panel background
    const panelDrawn = this.ui.drawWoodTable(ctx, panelX - panelW * 0.075, panelY - panelH * 0.075, panelW * 1.15, panelH * 1.15);
    if (!panelDrawn) {
      ctx.fillStyle = '#1e1e38';
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
    }

    // === Fixed header: Upgrade tree + arrows ===
    const barX = panelX + innerPad;
    let headerY = panelY + innerPad;

    // Upgrade tree (fixed, not scrolled)
    const arrowBtnSize = 44;
    const treeAreaX = barX + arrowBtnSize + 4;
    const treeAreaW = contentW - (arrowBtnSize + 4) * 2;

    this.upgradeNodePositions = [];
    const treeEndY = this.renderUpgradeTree(ctx, treeAreaX, headerY, treeAreaW, race, bt, tree);

    // Left/right arrow buttons — vertically centered on the tree
    const treeMidY = (headerY + treeEndY) / 2;
    const arrowY = treeMidY - arrowBtnSize / 2;

    // Left arrow
    this.leftArrowRect = { x: barX - 4, y: arrowY, w: arrowBtnSize, h: arrowBtnSize };
    this.ui.drawIcon(ctx, 'leftArrow', barX + 2, arrowY + 6, arrowBtnSize - 12);

    // Right arrow
    const rightArrowX = barX + contentW - arrowBtnSize + 4;
    this.rightArrowRect = { x: rightArrowX, y: arrowY, w: arrowBtnSize, h: arrowBtnSize };
    this.ui.drawIcon(ctx, 'rightArrow', rightArrowX + 6, arrowY + 6, arrowBtnSize - 12);

    // Race label + category centered below tree with contrast background
    headerY = treeEndY + 4;
    ctx.font = 'bold 13px monospace';
    const raceCatText = `${RACE_LABELS[race]}  ${cat.toUpperCase()}`;
    const raceCatW = ctx.measureText(raceCatText).width + 20;
    const raceCatX = panelX + panelW / 2 - raceCatW / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, raceCatX, headerY, raceCatW, 18, 4);
    ctx.fill();
    ctx.fillStyle = rc.primary;
    ctx.textAlign = 'center';
    ctx.fillText(raceCatText, panelX + panelW / 2, headerY + 13);
    headerY += 22;

    const fixedHeaderH = headerY - panelY;

    // Compute total content height for scrolling
    const totalContentH = this.getDetailContentHeight(contentW, race, cat, bt, baseStats, nodeDef, upgrade);
    const scrollableH = panelH - fixedHeaderH;
    const maxDetailScroll = Math.max(0, totalContentH - scrollableH + 10);
    this.detailScrollY = Math.min(this.detailScrollY, maxDetailScroll);

    // === Scrollable content area ===
    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX, headerY, panelW, panelH - fixedHeaderH);
    ctx.clip();
    ctx.translate(0, -this.detailScrollY);

    let y = headerY + 8;
    const secPad = 8; // padding inside section backgrounds
    const secGap = 6; // gap between sections
    const secR = 6;   // corner radius

    // Helper to draw a section background
    const drawSectionBg = (sy: number, sh: number, shade: number) => {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      roundRect(ctx, panelX + 6, sy, panelW - 12, sh, secR);
      ctx.fill();
    };

    // ========== SECTION 1: Name + Sprite + ELO ==========
    const sec1Start = y;
    y += secPad;

    // Unit name (big)
    const tierColors = ['#e0e0e0', '#4fc3f7', '#b388ff'];
    ctx.fillStyle = tierColors[upgradeTier] ?? '#e0e0e0';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(displayName, panelX + panelW / 2, y + 18);
    y += 32;

    // Upgrade description
    if (nodeDef?.desc) {
      ctx.fillStyle = '#8c8';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(nodeDef.desc, panelX + panelW / 2, y + 10);
      y += 22;
    }

    // Large Sprite
    const spriteAreaH = 130;
    const spriteCX = panelX + panelW / 2;
    const spriteCY = y + spriteAreaH / 2;
    y += spriteAreaH + 8;

    // ELO
    const eloNode = nodeKey === 'A' ? undefined : nodeKey;
    const elo = getElo(race, cat, eloNode);
    const eloColor = elo > ELO_DEFAULT ? '#ffe082' : elo < ELO_DEFAULT ? '#ef9a9a' : '#888';
    ctx.fillStyle = eloColor;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ELO ${elo}`, panelX + panelW / 2, y + 10);
    y += 20 + secPad;

    y = sec1Start;
    const sec1H = secPad + 32 + (nodeDef?.desc ? 22 : 0) + 130 + 8 + 20 + secPad;
    drawSectionBg(y, sec1H, 0.3);
    y += secPad;

    // Re-draw name
    ctx.fillStyle = tierColors[upgradeTier] ?? '#e0e0e0';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(displayName, panelX + panelW / 2, y + 18);
    y += 32;

    if (nodeDef?.desc) {
      ctx.fillStyle = '#8c8';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(nodeDef.desc, panelX + panelW / 2, y + 10);
      y += 22;
    }

    // Re-draw sprite
    const spriteData = this.sprites.getUnitSprite(race, cat, 0, false, nodeKey !== 'A' ? nodeKey : undefined);
    if (spriteData) {
      const [img, def] = spriteData;
      const spriteScale = def.scale ?? 1.0;
      const baseH = T * 5.25 * spriteScale;
      const tierScale = 1.0 + upgradeTier * 0.12;
      const aspect = def.frameW / def.frameH;
      const drawW = baseH * aspect * tierScale;
      const drawH = baseH * (def.heightScale ?? 1.0) * tierScale;
      const gY = def.groundY ?? 0.71;
      const feetY = spriteCY + 30;
      const drawX = spriteCX - drawW * (def.anchorX ?? 0.5);
      const drawY = feetY - drawH * gY;
      const frame = getSpriteFrame(tick, def);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(spriteCX, feetY + 3, drawW * 0.4, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (def.flipX) {
        ctx.save();
        ctx.translate(spriteCX, 0);
        ctx.scale(-1, 1);
        ctx.translate(-spriteCX, 0);
      }

      if (upgradeTier >= 1) {
        ctx.globalAlpha = 0.15 + upgradeTier * 0.08;
        ctx.globalCompositeOperation = 'lighter';
        drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }

      drawSpriteFrame(ctx, img, def, frame, drawX, drawY, drawW, drawH);
      if (def.flipX) ctx.restore();
    }
    y += spriteAreaH + 8;

    // Re-draw ELO
    ctx.fillStyle = eloColor;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`ELO ${elo}`, panelX + panelW / 2, y + 10);
    y += 20 + secPad;
    y += secGap;

    // ========== SECTION 2: Stats + Spawn ==========
    const statsH = 26 * 6 + 4 + 18; // stat bars + spawn info
    drawSectionBg(y, statsH + secPad * 2, 0.25);
    y += secPad;

    const barW = contentW;
    const barH = 14;
    const barGap = 26;
    const labelW = 90;

    const stats: { label: string; value: number; max: number; display: string; color: string }[] = [
      { label: 'HEALTH', value: hp, max: MAX_STATS.hp, display: `${hp}`, color: '#4caf50' },
      { label: 'DAMAGE', value: dmg, max: MAX_STATS.damage, display: `${dmg}`, color: '#f44336' },
      { label: 'DPS', value: dps, max: MAX_STATS.dps, display: `${dps.toFixed(1)}`, color: '#ff9800' },
      { label: 'ATK SPEED', value: 1 / atkSpd, max: MAX_STATS.atkRate, display: `${atkSpd.toFixed(2)}s`, color: '#e91e63' },
      { label: 'MOVE SPEED', value: spd, max: MAX_STATS.moveSpeed, display: `${spd.toFixed(1)}`, color: '#2196f3' },
      { label: 'RANGE', value: range, max: MAX_STATS.range, display: `${range}`, color: '#9c27b0' },
    ];

    for (const stat of stats) {
      ctx.fillStyle = '#aaa';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, barX, y + 10);

      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(stat.display, barX + barW, y + 10);

      const bx = barX + labelW;
      const bw = barW - labelW - 50;
      const by = y + 2;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, bx, by, bw, barH, 3);
      ctx.fill();

      const pct = Math.min(1, Math.max(0, stat.value / stat.max));
      if (pct > 0) {
        ctx.fillStyle = stat.color;
        ctx.globalAlpha = 0.8;
        roundRect(ctx, bx, by, bw * pct, barH, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      y += barGap;
    }

    y += 4;

    // Spawn Info
    ctx.fillStyle = '#999';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    const spawnSec = (SPAWN_INTERVAL_TICKS / 20) * (upgrade.spawnSpeed);
    const spawnInfo = spawnCount > 1
      ? `Spawns ${spawnCount} units every ${spawnSec.toFixed(1)}s`
      : `Spawns every ${spawnSec.toFixed(1)}s`;
    ctx.fillText(spawnInfo, barX, y + 10);
    y += 18 + secPad;
    y += secGap;

    // ========== SECTION 3: Cost Breakdown ==========
    const costStartY = y;
    // Estimate cost section height
    const costSteps = 1 + (tab.path.length - 1);
    const costH = secPad + 18 + costSteps * 17 + (costSteps > 1 ? 26 : 5) + secPad;
    drawSectionBg(y, costH, 0.3);
    y += secPad;
    y = this.renderCostBreakdown(ctx, barX, y, race, bt, tab.path, contentW);
    y = costStartY + costH;
    y += secGap;

    // ========== SECTION 4: Innate Traits ==========
    const traits = RACE_INNATE_TRAITS[race]?.[cat] ?? [];
    if (traits.length > 0) {
      const traitsH = secPad + 20 + traits.length * 17 + secPad;
      drawSectionBg(y, traitsH, 0.25);
      y += secPad;
      ctx.fillStyle = '#aaa';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('INNATE TRAITS', barX, y + 10);
      y += 20;
      for (const trait of traits) {
        ctx.fillStyle = '#78c878';
        ctx.font = '12px monospace';
        ctx.fillText(`  ${trait}`, barX, y + 10);
        y += 17;
      }
      y += secPad;
      y += secGap;
    }

    // ========== SECTION 5: Upgrade Specials ==========
    if (upgrade.special && Object.keys(upgrade.special).length > 0) {
      const specials = describeSpecials(upgrade.special);
      const specialsH = secPad + 20 + specials.length * 17 + secPad;
      drawSectionBg(y, specialsH, 0.3);
      y += secPad;
      ctx.fillStyle = '#aaa';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('UPGRADE SPECIALS', barX, y + 10);
      y += 20;
      for (const s of specials) {
        ctx.fillStyle = '#e0c860';
        ctx.font = '12px monospace';
        ctx.fillText(`  ${s}`, barX, y + 10);
        y += 17;
      }
      y += secPad;
      y += secGap;
    }

    // ========== SECTION 6: Race Research ==========
    const raceResearch = RACE_RESEARCH_UPGRADES[race]?.filter(r => r.category === cat) ?? [];
    if (raceResearch.length > 0) {
      const researchH = secPad + 20 + raceResearch.length * 32 + secPad;
      drawSectionBg(y, researchH, 0.25);
      y += secPad;
      ctx.fillStyle = '#aaa';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('RACE RESEARCH', barX, y + 10);
      y += 20;
      for (const res of raceResearch) {
        ctx.fillStyle = '#82b1ff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(res.name, barX + 4, y + 10);
        y += 16;
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.fillText(res.desc, barX + 12, y + 10);
        y += 16;
      }
      y += secPad;
      y += secGap;
    }

    y += 20; // bottom padding

    ctx.restore();

    // === Close button (44x44 touch target, red round button with icon_09) ===
    const closeBtnSize = 44;
    const closeX = panelX + panelW - closeBtnSize - 4;
    const closeY = panelY + 4;
    const closeSize = 32;
    const closeVisX = closeX + (closeBtnSize - closeSize) / 2;
    const closeVisY = closeY + (closeBtnSize - closeSize) / 2;
    this.ui.drawSmallRedRoundButton(ctx, closeVisX, closeVisY, closeSize);
    this.ui.drawIcon(ctx, 'close', closeVisX + closeSize / 2 - 10, closeVisY + closeSize / 2 - 10, 20);

    // Scroll indicator (positioned within the scrollable area, below the fixed header)
    if (maxDetailScroll > 0) {
      const scrollPct = this.detailScrollY / maxDetailScroll;
      const trackH = scrollableH - 20;
      const thumbH = Math.max(20, (scrollableH / totalContentH) * trackH);
      const thumbY = headerY + 10 + scrollPct * (trackH - thumbH);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      roundRect(ctx, panelX + panelW - 6, thumbY, 4, thumbH, 2);
      ctx.fill();
    }

    ctx.textAlign = 'start';
  }

  private getDetailContentHeight(
    _contentW: number, race: Race, cat: string, _bt: BuildingType,
    _baseStats: any, nodeDef: UpgradeNodeDef | undefined, upgrade: any
  ): number {
    const secPad = 8;
    const secGap = 6;
    let h = 8; // top pad

    // Section 1: Name + sprite + ELO
    h += secPad + 32 + (nodeDef?.desc ? 22 : 0) + 130 + 8 + 20 + secPad + secGap;

    // Section 2: Stats + spawn
    h += secPad + 26 * 6 + 4 + 18 + secPad + secGap;

    // Section 3: Cost breakdown
    const upgradeTier = TAB_PATHS[this.activeTab].path.length - 1;
    const costSteps = 1 + upgradeTier;
    h += secPad + 18 + costSteps * 17 + (costSteps > 1 ? 26 : 5) + secPad + secGap;

    // Section 4: Innate traits
    const traits = RACE_INNATE_TRAITS[race]?.[cat] ?? [];
    if (traits.length > 0) h += secPad + 20 + traits.length * 17 + secPad + secGap;

    // Section 5: Upgrade specials
    if (upgrade.special && Object.keys(upgrade.special).length > 0) {
      const specials = describeSpecials(upgrade.special);
      h += secPad + 20 + specials.length * 17 + secPad + secGap;
    }

    // Section 6: Race research
    const raceResearch = RACE_RESEARCH_UPGRADES[race]?.filter((r: any) => r.category === cat) ?? [];
    if (raceResearch.length > 0) h += secPad + 20 + raceResearch.length * 32 + secPad + secGap;

    h += 30; // bottom pad
    return h;
  }


  private renderCostBreakdown(
    ctx: CanvasRenderingContext2D, barX: number, startY: number,
    race: Race, bt: BuildingType, path: string[], contentW: number,
  ): number {
    let y = startY;
    const upgradeTier = path.length - 1;

    // Collect each step: building, then each upgrade in the path
    const steps: { label: string; cost: { gold: number; wood: number; meat: number; deathEssence?: number; souls?: number } }[] = [];

    // Building cost
    const buildCost = RACE_BUILDING_COSTS[race]?.[bt];
    if (buildCost) {
      steps.push({ label: 'Building', cost: { gold: buildCost.gold, wood: buildCost.wood, meat: buildCost.meat } });
    }

    // Upgrade costs for each step in the path (skip 'A' which is base)
    for (let i = 1; i < path.length; i++) {
      const nodeChoice = path[i];
      const cost = getNodeUpgradeCost(race, bt, i, nodeChoice);
      const tierLabel = i === 1 ? 'Tier 1' : 'Tier 2';
      steps.push({ label: `${tierLabel} (${nodeChoice})`, cost });
    }

    if (steps.length === 0) return y;

    // Header
    const headerLabel = upgradeTier === 0 ? 'BUILDING COST' : 'TOTAL INVESTMENT';
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(headerLabel, barX, y + 12);
    y += 18;

    // Sum totals
    const totals = { gold: 0, wood: 0, meat: 0, souls: 0, deathEssence: 0 };

    for (const step of steps) {
      totals.gold += step.cost.gold;
      totals.wood += step.cost.wood;
      totals.meat += step.cost.meat;
      totals.souls += (step.cost.souls ?? 0);
      totals.deathEssence += (step.cost.deathEssence ?? 0);

      // Draw step label
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(step.label, barX + 4, y + 10);

      // Draw step costs inline
      let costX = barX + 100;
      costX = this.drawCostIcons(ctx, costX, y, step.cost);
      y += 17;
    }

    // Show totals if more than one step
    if (steps.length > 1) {
      // Separator line
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(barX + 4, y + 2);
      ctx.lineTo(barX + contentW - 4, y + 2);
      ctx.stroke();
      y += 6;

      ctx.fillStyle = '#ccc';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Total', barX + 4, y + 10);
      let costX = barX + 100;
      costX = this.drawCostIcons(ctx, costX, y, totals);
      y += 20;
    } else {
      y += 5;
    }

    return y;
  }

  private drawCostIcons(
    ctx: CanvasRenderingContext2D, startX: number, y: number,
    cost: { gold: number; wood: number; meat: number; souls?: number; deathEssence?: number },
  ): number {
    let x = startX;
    const items: { val: number; icon: IconName }[] = [];
    if (cost.gold > 0) items.push({ val: cost.gold, icon: 'gold' });
    if (cost.wood > 0) items.push({ val: cost.wood, icon: 'wood' });
    if (cost.meat > 0) items.push({ val: cost.meat, icon: 'meat' });
    if ((cost.souls ?? 0) > 0) items.push({ val: cost.souls!, icon: 'souls' });
    if ((cost.deathEssence ?? 0) > 0) items.push({ val: cost.deathEssence!, icon: 'ooze' });

    for (const item of items) {
      this.ui.drawIcon(ctx, item.icon, x, y - 2, 14);
      x += 16;
      ctx.fillStyle = '#ddd';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      const valStr = String(item.val);
      ctx.fillText(valStr, x, y + 10);
      x += ctx.measureText(valStr).width + 8;
    }
    return x;
  }

  private renderTowerDetailPanel(ctx: CanvasRenderingContext2D, W: number, H: number, _tick: number): void {
    const { race } = this.detail!;
    const bt = BuildingType.Tower;
    const towerBase = TOWER_STATS[race];
    if (!towerBase) return;

    const tab = TAB_PATHS[this.activeTab];
    const nodeKey = tab.path[tab.path.length - 1];
    const upgrade = getUnitUpgradeMultipliers(tab.path, race, bt);
    const tree = UPGRADE_TREES[race]?.[bt];
    const nodeDef: UpgradeNodeDef | undefined = nodeKey !== 'A' ? (tree as any)?.[nodeKey] : undefined;
    const rc = RACE_COLORS[race];

    const hp = Math.max(1, Math.round(towerBase.hp * upgrade.hp));
    const dmg = Math.max(1, Math.round(towerBase.damage * upgrade.damage));
    const atkSpd = Math.max(0.2, towerBase.attackSpeed * upgrade.attackSpeed);
    const range = Math.max(1, Math.round(towerBase.range * upgrade.range)) + (upgrade.special?.towerRangeBonus ?? 0);
    const dps = dmg / atkSpd;
    const displayName = nodeDef?.name ?? 'Tower';
    const upgradeTier = tab.path.length - 1;

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, H);

    // Panel
    const panelW = Math.min(520, W - 32);
    const panelX = (W - panelW) / 2;
    const panelY = 20 + getSafeTop();
    const panelH = H - panelY - 20;
    const innerPad = 18;
    const contentW = panelW - innerPad * 2;
    const barX = panelX + innerPad;

    if (!this.ui.drawWoodTable(ctx, panelX - panelW * 0.075, panelY - panelH * 0.075, panelW * 1.15, panelH * 1.15)) {
      ctx.fillStyle = '#1e1e38';
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
    }

    // === Fixed header: Upgrade tree + arrows (same as unit detail) ===
    let headerY = panelY + innerPad;
    const arrowBtnSize = 44;
    const treeAreaX = barX + arrowBtnSize + 4;
    const treeAreaW = contentW - (arrowBtnSize + 4) * 2;

    this.upgradeNodePositions = [];
    const treeEndY = this.renderUpgradeTree(ctx, treeAreaX, headerY, treeAreaW, race, bt, tree);

    const treeMidY = (headerY + treeEndY) / 2;
    const arrowY = treeMidY - arrowBtnSize / 2;
    this.leftArrowRect = { x: barX - 4, y: arrowY, w: arrowBtnSize, h: arrowBtnSize };
    this.ui.drawIcon(ctx, 'leftArrow', barX + 2, arrowY + 6, arrowBtnSize - 12);
    const rightArrowX = barX + contentW - arrowBtnSize + 4;
    this.rightArrowRect = { x: rightArrowX, y: arrowY, w: arrowBtnSize, h: arrowBtnSize };
    this.ui.drawIcon(ctx, 'rightArrow', rightArrowX + 6, arrowY + 6, arrowBtnSize - 12);

    headerY = treeEndY + 4;
    ctx.font = 'bold 13px monospace';
    const raceCatText = `${RACE_LABELS[race]}  TOWER`;
    const raceCatW = ctx.measureText(raceCatText).width + 20;
    const raceCatX = panelX + panelW / 2 - raceCatW / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(raceCatX, headerY, raceCatW, 18, 4); ctx.fill();
    ctx.fillStyle = rc.primary;
    ctx.textAlign = 'center';
    ctx.fillText(raceCatText, panelX + panelW / 2, headerY + 13);
    headerY += 22;

    const fixedHeaderH = headerY - panelY;
    const scrollableH = panelH - fixedHeaderH;
    const maxDetailScroll = Math.max(0, 600 - scrollableH);
    this.detailScrollY = Math.min(this.detailScrollY, maxDetailScroll);

    // Scrollable content
    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX, headerY, panelW, panelH - fixedHeaderH);
    ctx.clip();
    ctx.translate(0, -this.detailScrollY);

    let y = headerY + 8;

    // Tower name
    const tierColors = ['#e0e0e0', '#4fc3f7', '#b388ff'];
    ctx.fillStyle = tierColors[upgradeTier] ?? '#e0e0e0';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(displayName, panelX + panelW / 2, y + 18);
    y += 32;

    if (nodeDef?.desc) {
      ctx.fillStyle = '#8c8';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(nodeDef.desc, panelX + panelW / 2, y + 10);
      y += 22;
    }

    // Building sprite (centered, no unit behind it)
    const spriteAreaH = 130;
    const spriteCX = panelX + panelW / 2;
    const bldgImg = this.sprites.getBuildingSprite(bt, 0, false, race, tab.path);
    if (bldgImg) {
      const bH = spriteAreaH * 0.85;
      const bAsp = bldgImg.width / bldgImg.height;
      const bW = bH * bAsp;
      ctx.drawImage(bldgImg, spriteCX - bW / 2, y + (spriteAreaH - bH) / 2, bW, bH);
    }
    y += spriteAreaH + 8;

    // Stats: HP, DAMAGE, DPS, ATK SPEED, RANGE (no MOVE SPEED)
    const barW = contentW;
    const barH = 14;
    const barGap = 26;
    const labelW = 90;

    const roundRect = (cx: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, r: number) => {
      cx.beginPath(); cx.roundRect(rx, ry, rw, rh, r);
    };

    const stats = [
      { label: 'HEALTH', value: hp, max: MAX_STATS.hp * 4, display: `${hp}`, color: '#4caf50' },
      { label: 'DAMAGE', value: dmg, max: MAX_STATS.damage, display: `${dmg}`, color: '#f44336' },
      { label: 'DPS', value: dps, max: MAX_STATS.dps, display: `${dps.toFixed(1)}`, color: '#ff9800' },
      { label: 'ATK SPEED', value: 1 / atkSpd, max: MAX_STATS.atkRate, display: `${atkSpd.toFixed(2)}s`, color: '#e91e63' },
      { label: 'RANGE', value: range, max: MAX_STATS.range * 2, display: `${range}`, color: '#9c27b0' },
    ];

    for (const stat of stats) {
      ctx.fillStyle = '#aaa';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(stat.label, barX, y + 10);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(stat.display, barX + barW, y + 10);

      const bx = barX + labelW;
      const bw = barW - labelW - 50;
      const by = y + 2;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, bx, by, bw, barH, 3); ctx.fill();
      const pct = Math.min(1, Math.max(0, stat.value / stat.max));
      if (pct > 0) {
        ctx.fillStyle = stat.color;
        ctx.globalAlpha = 0.8;
        roundRect(ctx, bx, by, bw * pct, barH, 3); ctx.fill();
        ctx.globalAlpha = 1;
      }
      y += barGap;
    }

    y += 8;

    // Cost breakdown
    y = this.renderCostBreakdown(ctx, barX, y, race, bt, tab.path, contentW);
    y += 8;

    // Special traits from upgrade
    if (nodeDef) {
      const specials = describeSpecials(nodeDef.special ?? {});
      if (specials.length > 0) {
        ctx.fillStyle = '#aaa';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('UPGRADE BONUSES', barX, y + 10);
        y += 20;
        for (const s of specials) {
          ctx.fillStyle = '#78c878';
          ctx.font = '11px monospace';
          ctx.fillText(`• ${s}`, barX + 8, y + 10);
          y += 17;
        }
      }
    }

    ctx.restore();

    // Close button (matches unit detail panel)
    const closeBtnSize = 44;
    const closeX = panelX + panelW - closeBtnSize - 4;
    const closeY2 = panelY + 4;
    const closeSize = 32;
    const closeVisX = closeX + (closeBtnSize - closeSize) / 2;
    const closeVisY = closeY2 + (closeBtnSize - closeSize) / 2;
    this.ui.drawSmallRedRoundButton(ctx, closeVisX, closeVisY, closeSize);
    this.ui.drawIcon(ctx, 'close', closeVisX + closeSize / 2 - 10, closeVisY + closeSize / 2 - 10, 20);
  }

  private renderUpgradeTree(
    ctx: CanvasRenderingContext2D, x: number, startY: number, w: number,
    race: Race, bt: BuildingType,
    tree: Record<string, UpgradeNodeDef> | undefined,
  ): number {
    const nodeW = Math.min(120, (w - 20) / 2);
    const nodeH = 36;
    const rowGap = 44;
    const centerX = x + w / 2;
    const tab = TAB_PATHS[this.activeTab];
    const currentNodeKey = tab.path[tab.path.length - 1];

    let y = startY;

    // Base (A)
    const baseStats = UNIT_STATS[race]?.[bt];
    const baseName = bt === BuildingType.Tower ? 'Tower' : (baseStats?.name ?? 'Base');
    this.drawUpgradeNode(ctx, centerX - nodeW / 2, y, nodeW, nodeH, baseName, 'A', currentNodeKey === 'A', 0);
    this.upgradeNodePositions.push({ x: centerX - nodeW / 2, y, w: nodeW, h: nodeH, tabIndex: 0 });
    y += rowGap;

    // Draw connecting lines
    const drawLine = (fx: number, fy: number, tx: number, ty: number) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    };

    if (!tree) return y;

    // Tier 1: B and C
    const leftX = centerX - nodeW - 8;
    const rightX = centerX + 8;
    drawLine(centerX, y - rowGap + nodeH, leftX + nodeW / 2, y);
    drawLine(centerX, y - rowGap + nodeH, rightX + nodeW / 2, y);

    if (tree.B) {
      this.drawUpgradeNode(ctx, leftX, y, nodeW, nodeH, tree.B.name, 'B', currentNodeKey === 'B', 1);
      this.upgradeNodePositions.push({ x: leftX, y, w: nodeW, h: nodeH, tabIndex: 1 });
    }
    if (tree.C) {
      this.drawUpgradeNode(ctx, rightX, y, nodeW, nodeH, tree.C.name, 'C', currentNodeKey === 'C', 1);
      this.upgradeNodePositions.push({ x: rightX, y, w: nodeW, h: nodeH, tabIndex: 2 });
    }
    y += rowGap;

    // Tier 2 nodes — use smaller width if space is tight
    const t2nodeW = Math.min(nodeW, (w - 40) / 4);
    const quarter = w / 4;
    const dX = x + quarter * 0 + (quarter - t2nodeW) / 2;
    const eX = x + quarter * 1 + (quarter - t2nodeW) / 2;
    const fX = x + quarter * 2 + (quarter - t2nodeW) / 2;
    const gX = x + quarter * 3 + (quarter - t2nodeW) / 2;

    // Tier 2 connecting lines from B → D/E and C → F/G
    if (tree.B) {
      drawLine(leftX + nodeW / 2, y - rowGap + nodeH, dX + t2nodeW / 2, y);
      drawLine(leftX + nodeW / 2, y - rowGap + nodeH, eX + t2nodeW / 2, y);
    }
    if (tree.C) {
      drawLine(rightX + nodeW / 2, y - rowGap + nodeH, fX + t2nodeW / 2, y);
      drawLine(rightX + nodeW / 2, y - rowGap + nodeH, gX + t2nodeW / 2, y);
    }

    if (tree.D) {
      this.drawUpgradeNode(ctx, dX, y, t2nodeW, nodeH, tree.D.name, 'D', currentNodeKey === 'D', 2);
      this.upgradeNodePositions.push({ x: dX, y, w: t2nodeW, h: nodeH, tabIndex: 3 });
    }
    if (tree.E) {
      this.drawUpgradeNode(ctx, eX, y, t2nodeW, nodeH, tree.E.name, 'E', currentNodeKey === 'E', 2);
      this.upgradeNodePositions.push({ x: eX, y, w: t2nodeW, h: nodeH, tabIndex: 4 });
    }
    if (tree.F) {
      this.drawUpgradeNode(ctx, fX, y, t2nodeW, nodeH, tree.F.name, 'F', currentNodeKey === 'F', 2);
      this.upgradeNodePositions.push({ x: fX, y, w: t2nodeW, h: nodeH, tabIndex: 5 });
    }
    if (tree.G) {
      this.drawUpgradeNode(ctx, gX, y, t2nodeW, nodeH, tree.G.name, 'G', currentNodeKey === 'G', 2);
      this.upgradeNodePositions.push({ x: gX, y, w: t2nodeW, h: nodeH, tabIndex: 6 });
    }

    y += rowGap;
    return y;
  }

  private drawUpgradeNode(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    name: string, nodeKey: string, isActive: boolean, tier: number,
  ): void {
    const tierBg = ['#22223a', '#1e3a5e', '#3e2258'];
    const tierBgActive = ['#3a3a4e', '#2a5a8a', '#5e3a8a'];
    const tierBorder = ['#555', '#4fc3f7', '#b388ff'];

    ctx.fillStyle = isActive ? tierBgActive[tier] : tierBg[tier];
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();

    ctx.strokeStyle = isActive ? tierBorder[tier] : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = isActive ? 2 : 1;
    roundRect(ctx, x, y, w, h, 4);
    ctx.stroke();

    // Node letter
    ctx.fillStyle = isActive ? tierBorder[tier] : '#888';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(nodeKey, x + 4, y + h / 2 + 4);

    // Name
    ctx.fillStyle = isActive ? '#e0e0e0' : '#aaa';
    ctx.font = `${isActive ? 'bold ' : ''}11px monospace`;
    ctx.textAlign = 'center';
    // Truncate name if too wide
    let displayName = name;
    while (ctx.measureText(displayName).width > w - 22 && displayName.length > 3) {
      displayName = displayName.slice(0, -1);
    }
    if (displayName !== name) displayName += '..';
    ctx.fillText(displayName, x + w / 2 + 4, y + h / 2 + 4);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function describeSpecials(sp: UpgradeSpecial): string[] {
  const lines: string[] = [];
  if (sp.dodgeChance) lines.push(`${(sp.dodgeChance * 100).toFixed(0)}% dodge chance`);
  if (sp.knockbackEveryN) lines.push(`Knockback every ${sp.knockbackEveryN} hits`);
  if (sp.goldOnKill) lines.push(`+${sp.goldOnKill} gold on kill`);
  if (sp.goldOnDeath) lines.push(`+${sp.goldOnDeath} gold on death`);
  if (sp.splashRadius) lines.push(`Splash ${sp.splashRadius}t at ${((sp.splashDamagePct ?? 0.5) * 100).toFixed(0)}%`);
  if (sp.extraChainTargets) lines.push(`Chain to ${sp.extraChainTargets} extra targets`);
  if (sp.extraBurnStacks) lines.push(`+${sp.extraBurnStacks} burn stacks on hit`);
  if (sp.extraSlowStacks) lines.push(`+${sp.extraSlowStacks} slow stacks on hit`);
  if (sp.shieldTargetBonus) lines.push(`Shield +${sp.shieldTargetBonus} extra targets`);
  if (sp.shieldAbsorbBonus) lines.push(`+${sp.shieldAbsorbBonus} shield absorb`);
  if (sp.regenPerSec) lines.push(`Regen ${sp.regenPerSec} HP/s`);
  if (sp.damageReductionPct) lines.push(`${sp.damageReductionPct}% damage reduction`);
  if (sp.reviveHpPct) lines.push(`Revive at ${(sp.reviveHpPct * 100).toFixed(0)}% HP`);
  if (sp.multishotCount) lines.push(`+${sp.multishotCount} projectiles at ${((sp.multishotDamagePct ?? 0.5) * 100).toFixed(0)}%`);
  if (sp.healBonus) lines.push(`+${sp.healBonus} heal amount`);
  if (sp.cleaveTargets) lines.push(`Cleave ${sp.cleaveTargets} adjacent enemies`);
  if (sp.hopAttack) lines.push('Leap attack with AoE slow');
  if (sp.explodeOnDeath) lines.push(`Explode on death: ${sp.explodeDamage ?? 0} dmg in ${sp.explodeRadius ?? 0}t`);
  if (sp.skeletonSummonChance) lines.push(`${(sp.skeletonSummonChance * 100).toFixed(0)}% skeleton summon on death`);
  if (sp.crownMage) lines.push('Fire AoE damage (mage mode)');
  if (sp.isSiegeUnit) lines.push(`Siege: ${sp.buildingDamageMult ?? 1}x building dmg`);
  if (sp.auraDamageBonus) lines.push(`Aura: +${sp.auraDamageBonus} dmg to allies`);
  if (sp.auraSpeedBonus) lines.push(`Aura: +${((sp.auraSpeedBonus ?? 0) * 100).toFixed(0)}% speed to allies`);
  if (sp.auraArmorBonus) lines.push(`Aura: ${((sp.auraArmorBonus ?? 0) * 100).toFixed(0)}% DR to allies`);
  if (sp.guaranteedHaste) lines.push('Guaranteed haste on hit');
  if (sp.towerRangeBonus) lines.push(`+${sp.towerRangeBonus} tower range`);
  if (sp.soulHarvest) lines.push(`Soul harvest: grows from nearby deaths`);
  if (sp.killScaling) lines.push(`Kill scaling: +${((sp.killDmgPct ?? 0.05) * 100).toFixed(0)}% dmg/kill`);
  if (sp.spawnCount) lines.push(`Spawns ${sp.spawnCount} units`);
  return lines;
}
