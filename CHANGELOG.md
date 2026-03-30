# Changelog

## 2026-03-29 — v1.1.0 (since iOS 1.0.7 build 10)

_42 commits: 8133aac → 1276820_

### New Features
- **Tutorial system** — 16-step guided first-time match (miner hut → melee → tower → research → nuke → full menu tour) with spotlight overlays, gated input, and localStorage persistence
- **Weather system** — 8 weather types across 5 biomes, split-depth particle rendering, gradual transitions with wind cues, procedural rain/wind/thunder audio
- **Post-match minimap replay** — 30s animated replay with nuke markers, war heroes, scrollable scoreboard, portrait animations
- **War Hero awards** — 4 hero categories (Reaper, Iron Wall, Battle Sage, Life Weaver) with animated sprites, confetti, and sortable summary tables
- **Unit info panel** — Sprite art display, HUD-safe positioning, WoW-style buff icons, stat breakdown
- **Building popup stat bars** — Dynamic bars (HP, DMG, DPS, Speed, Range, Spawn Rate) with hover delta previews showing upgrade impact before buying
- **Race ability upgrade trees** — Each race gets a unique ability building with 4 upgrade tiers; ability buildings use `isAbilityBuilding()` helper for correct tower exclusion
- **AI-generated building sprites** — Custom LoRA model, complete rework for all 9 races (205 PNGs across 4 asset packs)
- **Bot composition profiles** — Difficulty-gated random strategy selection with tick fairness shuffles
- **Race combat music** — Per-race thematic music tracks during matches
- **Quick chat radial menu** — Ping targets radial center position; 3 new chat styles (Save Us, Sending Now, Random)
- **Tenders tri-resource economy** — Huts cycle through generating Gold → Wood → Meat; "Growth Pod" popup with animated 3-segment progress bar

### UI & Rendering
- **Title screen duels** — Rotating subtitle with roll animation, dead unit strikethrough names, type filter
- **Deep deluge vignette** — Blue screen-edge effect during Deluge ability
- **Skill research icons** — Nhance Spell Icons (92 painted icons) for all upgrade nodes
- **Mobile two-tap upgrades** — BuildingPopup: first tap selects (shows preview), second tap confirms
- **Isometric building sizing** — Tier scaling [0.85, 1.0, 1.15], centered on diamond
- **Minimap ping improvements** — Larger/pulsing markers, combat glow
- **Two-column party layout** — Join popup buttons, mobile keyboard support, resource icons
- **Unit gallery overhaul** — Shared StatBarUtils, per-node Elo ratings, responsive columns
- **Race-flavored building names** — Upgrade-aware names (e.g., "Brute Camp", "Tidecaller Shrine")
- Fix 1px seams in 9-slice panels and iso terrain tiles
- flipX sprite support for directional units
- Mobile UX: suppress long-press context menu, text truncation, gallery click-through
- Post-match hero cards: fixed-width sprite column, better award icons (nuke/diamond/mana/star)
- Bot name abbreviations in summary (Medium→Med, Nightmare→NM)
- Building tooltip hidden at render-time when popup is open (hover tracking still active)
- Wider title screen subtitle ribbon
- Mobile upgrade buttons: "TAP TO CONFIRM" / "CAN'T AFFORD" label, cost always visible, dim glow on unaffordable

### Balance
- **Stone → Meat** resource rename across entire codebase
- Horde Brute 120→130 HP, Bowcleaver 71→76 HP
- Demon Overlord 52→65 HP
- Geists soul cost scaling +5→+10 per ability cast
- Geists lifesteal nerf, economy rework
- Crown/Oozlings costs reduced ~15%
- Wild resource costs reduced
- Burn/poison suppresses regen (BLIGHT combo at 3+ burn stacks)
- Tower sell refund prorated by HP: 50% × (currentHp / maxHp)
- Spectator achievement now requires 10 duels (was 1)

### Simulation
- `isAbilityBuilding()` centralized helper — replaces scattered manual flag checks
- `totalBuffsApplied` player stat for support tracking
- `damageTaken` on units for tank hero computation
- Tenders seed: remove 10-stack cap, rework Fast Growth to bonus tick (2 of 5 ticks) for determinism
- Exported `SEED_GROW_TIMES` constant (renderer uses same values as simulation)
- Harvester floating text every tick (was every other)
- Spatial grid optimization for combat tick
- Fog of war throttled to every 3 ticks

### Bot AI
- 4th-tier race abilities for all 9 races
- Research value scales with spawnerCount^1.5
- Difficulty redesign: decision intervals + mistake rates replace spawn caps
- Stronger profile steering (1.5x multipliers for build targets)
- Correct ability building exclusion from tower counting
- Diamond workers: send 2 instead of 1 (need to contest the node)
- Demon mana worker capped at 1 (extras redirected to bottleneck resource)
- Harvester reassignment hysteresis (10s cooldown prevents toggling)

### Multiplayer & Networking
- **CommandSync race condition fix** — Buffer all remote turn data on disconnect
- **Cross-peer desync detection** — Compare all remote hashes, not just last
- **Deferred turn resolution** — `queueMicrotask` for Firebase listener buffering
- **Firebase rules tightened** — Slot-specific write permissions, `left` signal node
- Camera `dragDisabled` flag for radial menu

### Performance
- Cached pixel coords in Y-sort buffer (eliminates redundant iso projections per entity per frame)
- Inlined iso projection in fog/ambient particle loops (~14k fewer function calls/frame)
- Viewport-culled ambient race particles
- Removed building/HQ shadow ellipses

---

## 2026-03-25 — Race Art, 4th Abilities, Balance Tuning

_Commits: 43c7e38, 58b733a (since iOS build 3a65b22 on 2026-03-24)_

### Art & Rendering
- **Race-specific building sprites** — 4 purchased asset packs (Human, Orc, Elf, NightElf; 205 PNGs) mapped to all 9 races with upgrade-path inheritance fallback chain
- **Nhance Spell Icons** — 92 painted icons replace emoji in the research popup, with bordered frames and ownership coloring
- **Oozlings animated mound** — spawn wiggle + idle wobble animation with elliptical glow effect
- **"Now Playing" display** — music track name on title screen, auto-fades after 10s
- **15 combat music tracks renamed** with thematic names for Now Playing display

### Simulation
- **4th-tier race abilities** for all 9 races:
  - Crown: Timber Surplus (+40% wood returns)
  - Horde: Trophy Hunter (Troll +2% HP/dmg per kill, persists across summons)
  - Goblins: Elixir Mastery (permanent potion buffs)
  - Oozlings: Ooze Vitality (2 HP/s regen)
  - Demon: Mana Siphon (+50% mana from workers)
  - Deep: Purifying Deluge (cleanse debuffs every 2s)
  - Wild: Savage Instinct (frenzied units gain 15% lifesteal)
  - Geists: Hungering Dark (lifesteal % also increases damage)
  - Tenders: Ironwood (tower upgrade costs -50%)
- **Retroactive research buffs** — existing units get HP/damage/speed on research purchase
- **Spatial grid optimization** — O(1) neighbor lookups for auras, knockback, towers, AoE
- **Fog of war throttled** to every 3 ticks (was every tick)
- **Fireball damage buff** (base 25 to 35, mana bonus 0.5x to 0.7x)
- **Tower sell refund prorated** by current HP (damaged towers refund less)

### Balance
- **Geists lifesteal nerf** — base lifesteal reduced from 20% to 10% across all unit types
- **Geists Death Grip/Soul Arrows** bonus reduced from +10% to +5%
- **Geist skeleton summons** lifesteal tuned down (melee 15% to 8%, ranged 10% to 5%)

### Bot AI
- **Difficulty redesign** — decision intervals + mistake rates replace spawn caps
- **Stronger profile steering** — 1.5x multipliers for race build targets, 0.3x for skipped categories
- **Research value overhaul** — scales with spawnerCount^1.5
- **Early hut value boost** — 1.8x/1.3x for first 2-3 huts

### UI
- **Race-flavored building names** (e.g., "Brute Camp", "Tidecaller Shrine")
- **Improved sell refund display** — shows 50% of all invested resources (base + upgrades)
- **Hut grid slot placement** — click specifies exact slot
- **Race-specific icons** in building tray
- **Unit Gallery overhaul** — 4th tower column with stats, building sprites behind units, 1.8x display scale

### Code Quality
- Centralized ability cost modifiers in `data.ts` (was hardcoded in InputHandler + GameState)
- Fallback "?" icon for missing skill icon keys in research popup
- `roundRect` polyfill for older browsers (Safari <15.4, Firefox <112)
- Replaced fragile `naturalWidth > 400` heuristic with explicit `isRacePackSprite()`
- Cached tray building sprite lookups (only cache successful loads)
- Responsive gallery columns (3 on narrow screens <400px, 4 on wide)
- `Skill_Icon_Pack/` added to `.gitignore` (unused)
- 4 new debug/test tools: hierarchyTest, debugMirror, nightmareDebug, valueDump
