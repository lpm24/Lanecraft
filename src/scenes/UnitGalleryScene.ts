import { Scene, SceneManager } from './Scene';
import { SpriteLoader, drawSpriteFrame, getSpriteFrame } from '../rendering/SpriteLoader';
import { UIAssets } from '../rendering/UIAssets';
import { Race, BuildingType, TILE_SIZE } from '../simulation/types';
import { loadProfile, checkNonMatchAchievement, ACHIEVEMENTS } from '../profile/ProfileData';
import { UNIT_STATS, RACE_COLORS, RACE_LABELS, UPGRADE_TREES, UpgradeNodeDef } from '../simulation/data';
import { getUnitUpgradeMultipliers } from '../simulation/GameState';
import { getElo, ELO_DEFAULT } from './TitleElo';
import { Capacitor } from '@capacitor/core';
import { getSafeTop } from '../ui/SafeArea';

const IS_NATIVE = Capacitor.isNativePlatform();

const T = TILE_SIZE;

const ALL_RACES: Race[] = [
  Race.Crown, Race.Horde, Race.Goblins, Race.Oozlings, Race.Demon,
  Race.Deep, Race.Wild, Race.Geists, Race.Tenders,
];

const CATEGORIES: { bt: BuildingType; cat: 'melee' | 'ranged' | 'caster' }[] = [
  { bt: BuildingType.MeleeSpawner, cat: 'melee' },
  { bt: BuildingType.RangedSpawner, cat: 'ranged' },
  { bt: BuildingType.CasterSpawner, cat: 'caster' },
];

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
const DISPLAY_SCALE = 1.0;

export class UnitGalleryScene implements Scene {
  private manager: SceneManager;
  private canvas: HTMLCanvasElement;
  private sprites: SpriteLoader;
  private animTime = 0;
  private scrollY = 0;
  private activeTab = 0;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private touchLastY = 0;

  constructor(manager: SceneManager, canvas: HTMLCanvasElement, sprites: SpriteLoader, _ui: UIAssets) {
    this.manager = manager;
    this.canvas = canvas;
    this.sprites = sprites;
  }

  enter(): void {
    this.scrollY = 0;
    this.animTime = 0;
    this.activeTab = 0;

    // Track gallery visit achievement
    const profile = loadProfile();
    const achId = checkNonMatchAchievement(profile, 'gallery_visitor');
    if (achId) { const def = ACHIEVEMENTS.find(a => a.id === achId); if (def) this.manager.showToast(`Achievement: ${def.name}`, def.desc); }

    let lastTouchTime = 0;
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
        const rect = this.canvas.getBoundingClientRect();
        const cx = touch.clientX - rect.left;
        const cy = touch.clientY - rect.top;
        this.handleClick(cx, cy);
      } else if (e.type === 'touchmove') {
        e.preventDefault();
        const dy = this.touchLastY - touch.clientY;
        this.touchLastY = touch.clientY;
        this.scrollY = Math.max(0, this.scrollY + dy);
      }
    };

    this.wheelHandler = (e: WheelEvent) => {
      this.scrollY = Math.max(0, this.scrollY + e.deltaY);
    };

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.manager.switchTo('title');
      const num = parseInt(e.key);
      if (num >= 1 && num <= 7) { this.activeTab = num - 1; this.scrollY = 0; }
    };

    this.canvas.addEventListener('click', this.clickHandler);
    this.canvas.addEventListener('touchstart', this.touchHandler, { passive: false });
    this.canvas.addEventListener('touchmove', this.touchHandler, { passive: false });
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: true });
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    if (this.touchHandler) {
      this.canvas.removeEventListener('touchstart', this.touchHandler);
      this.canvas.removeEventListener('touchmove', this.touchHandler);
    }
    if (this.wheelHandler) this.canvas.removeEventListener('wheel', this.wheelHandler);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.clickHandler = null;
    this.touchHandler = null;
    this.wheelHandler = null;
    this.keyHandler = null;
  }

  private handleClick(cx: number, cy: number): void {
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

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    const tab = TAB_PATHS[this.activeTab];
    const upgradeTier = tab.path.length - 1; // 0, 1, or 2

    // Layout constants — responsive to screen width
    const rowH = 110;
    const headerH = 98 + getSafeTop();
    const labelPad = 14; // left margin for race label (overlaps first unit column)
    const colMargin = 20; // margin on each side of the 3 columns
    const unitSpacing = Math.min(160, Math.max(100, Math.floor((W - colMargin * 2) / 3)));
    const colStartX = Math.max(colMargin, Math.floor((W - unitSpacing * 3) / 2));
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

      // Draw each unit category
      for (let c = 0; c < CATEGORIES.length; c++) {
        const { bt, cat } = CATEGORIES[c];
        const baseStats = UNIT_STATS[race]?.[bt];
        if (!baseStats) continue;

        const unitCX = colStartX + c * unitSpacing + unitSpacing / 2;
        const unitCY = rowY + rowH * 0.38;

        // Get upgrade info for this tab
        const upgrade = getUnitUpgradeMultipliers(tab.path, race, bt);
        const tree = UPGRADE_TREES[race]?.[bt];
        const nodeKey = tab.path[tab.path.length - 1];
        const nodeDef: UpgradeNodeDef | undefined = nodeKey !== 'A' ? (tree as any)?.[nodeKey] : undefined;

        // Compute upgraded stats
        const hp = Math.max(1, Math.round(baseStats.hp * upgrade.hp));
        const dmg = Math.max(1, Math.round(baseStats.damage * upgrade.damage));
        const atkSpd = Math.max(0.2, baseStats.attackSpeed * upgrade.attackSpeed);
        const spd = Math.max(0.5, baseStats.moveSpeed * upgrade.moveSpeed);

        // Unit name: show upgrade name if available, else base name
        const displayName = nodeDef?.name ?? baseStats.name;

        // Get sprite and render at 2x display size (use upgrade node for art-changing paths)
        const spriteData = this.sprites.getUnitSprite(race, cat, 0, false, nodeKey !== 'A' ? nodeKey : undefined);
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

        // Unit name
        ctx.fillStyle = nodeDef ? '#e0c860' : '#ccc';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(displayName, unitCX, unitCY + 38);

        // Stats line
        ctx.fillStyle = '#999';
        ctx.font = '11px monospace';
        const statsStr = IS_NATIVE
          ? `${hp}hp ${dmg}dmg ${atkSpd.toFixed(1)}as`
          : `${hp}hp ${dmg}dmg ${atkSpd.toFixed(1)}as ${spd.toFixed(1)}ms`;
        ctx.fillText(statsStr, unitCX, unitCY + 50);

        // ELO rating — shown for base units always, and for upgraded units on native
        const showElo = nodeKey === 'A' || IS_NATIVE;
        if (showElo) {
          const eloNode = nodeKey === 'A' ? undefined : nodeKey;
          const elo = getElo(race, cat, eloNode);
          const eloColor = elo > ELO_DEFAULT ? '#ffe082' : elo < ELO_DEFAULT ? '#ef9a9a' : '#888';
          ctx.fillStyle = eloColor;
          ctx.font = '11px monospace';
          ctx.fillText(`ELO ${elo}`, unitCX, unitCY + 61);
        }

        // Upgrade description (desktop only — too wide for mobile)
        if (nodeDef?.desc && !IS_NATIVE) {
          ctx.fillStyle = '#6a6';
          ctx.font = '11px monospace';
          ctx.fillText(nodeDef.desc, unitCX, unitCY + 61);
        }

        // Scale info (dev only — not useful on native builds)
        if (spriteData && !IS_NATIVE && import.meta.env.DEV) {
          const def = spriteData[1];
          const sc = def.scale ?? 1;
          const hsc = def.heightScale ?? 1;
          const scaleLabel = sc !== 1 || hsc !== 1
            ? `${(sc * 100).toFixed(0)}%${hsc !== 1 ? ` h:${(hsc * 100).toFixed(0)}%` : ''}`
            : '100%';
          ctx.fillStyle = '#555';
          ctx.font = '11px monospace';
          ctx.fillText(scaleLabel, unitCX, unitCY + 72);
        }
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
    for (let c = 0; c < CATEGORIES.length; c++) {
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
  }
}
