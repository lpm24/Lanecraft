# Lanecraft

Fantasy RTS with 9 races, sprite-based HTML5 Canvas rendering, and deterministic tick simulation.
Supports 1v1 through 4v4 with bot or multiplayer (Firebase RTDB lockstep).

## Quick Reference

```bash
npm run dev              # Dev server (Vite, port 5173)
npm run build            # TypeScript check + Vite production build
npm run test:sim         # Simulation smoke tests (must pass before push)
npm run balance          # Headless bot-vs-bot balance sim (full matchup grid)
npm run sanity           # Quick 1-match balance check
npm run cost-analysis    # Effective cost report for all 9 races
npm run profile-sim      # Bot composition profile comparison
python scripts/generate_store_screenshots.py  # App Store screenshots from marketing/z/
```

## Critical Rules

### Determinism — the #1 footgun
The simulation must be **fully deterministic** for multiplayer lockstep sync. All clients run the same `simulateTick()` with the same commands and must produce byte-identical state. Any divergence = desync = broken game.

- **NEVER use `Math.random()` in any `src/simulation/` file.** Always use `state.rng()`.
- Any new `state.rng()` call changes the RNG sequence, which **invalidates all prior balance data** and can cause multiplayer desync. Re-run `npm run balance` after any such change.
- **NEVER use `Date.now()`, `performance.now()`, or any time-dependent value** in simulation logic. Tick count is the only clock.
- **NEVER iterate `Map` or `Object.keys()` in simulation** where order matters unless the result is sorted. Use arrays or sort by entity ID.
- **NEVER use `Set` iteration order** for game logic — convert to sorted array first.
- Simulation-side sort tie-breakers must be stable (use entity ID as final tiebreaker).
- **All player actions must flow through `GameCommand` objects** — never mutate game state directly from input handlers or UI code.
- If you add/remove/reorder any code path that calls `state.rng()`, even conditionally, every subsequent random result shifts and all clients diverge.

### Resource types
The game uses **Gold, Wood, Meat** (NOT Stone). "Stone" appears in the old GDD but was renamed.

### 9 Races and their economies
| Race | Resources | Identity |
|------|-----------|----------|
| Crown | Gold + Wood | Balanced, shield + dmg reduction |
| Horde | Gold + Meat + Wood | Brute force, knockback |
| Goblins | Gold + Wood | Fast + cheap, poison/burn |
| Oozlings | Gold + Meat | Swarm (spawnCount:2), haste |
| Demon | Meat + Wood | Glass cannon, burn. **No gold economy.** |
| Deep | Wood + Gold | Tank + control, slow |
| Wild | Wood + Meat | Aggro + poison. **No gold economy.** |
| Geists | Meat + Gold | Undying, lifesteal |
| Tenders | Wood + Gold + Meat | Regen + healing |

### Identity locks (never change these)
- Oozlings always spawn 2 units per tick (spawnCount mechanic)
- Demon and Wild never use gold
- Crown caster always grants shields
- Horde melee always knocks back
- Geists always have lifesteal
- Tenders always have the highest tower HP
- Deep melee always has the highest base HP
- Goblins always have the cheapest building costs

## Architecture

```
src/
  simulation/        # Pure game logic (no DOM, no rendering)
    types.ts         # All types, enums, constants, map shape functions
    data.ts          # Unit stats, building costs, upgrade trees, race colors
    GameState.ts     # State creation, tick orchestration, command processing
    SimShared.ts     # Shared helpers, SpatialGrid, constants, projectile visuals
    SimLayout.ts     # Grid origins, HQ positions, lane paths, choke points
    SimMovement.ts   # Spawning, movement, pathfinding, collision, damage/status
    SimCombat.ts     # Combat targeting, towers, projectiles, status effect ticking
    SimAbilities.ts  # Race abilities, nukes, diamond/wood, death tracking
    SimHarvesters.ts # Harvester AI, mining, resource delivery
    BotAI.ts         # Bot AI entry point + orchestrator (thin, re-exports)
    BotProfiles.ts   # Race profiles, composition selection, difficulty presets
    BotIntelligence.ts # Threat assessment, combat telemetry, resource planning
    BotValuation.ts  # Throughput estimation, upgrade scoring, value functions
    BotDecisions.ts  # Build orders, upgrades, lanes, nukes, actions
    maps.ts          # Data-driven map definitions (Duel, Skirmish, Warzone)
  rendering/         # Canvas rendering (client only)
    Renderer.ts      # Render orchestrator, camera transforms, zone drawing
    RendererEntities.ts # Y-sorted entity drawing (units, buildings, projectiles)
    RendererOverlays.ts # HUD, minimap, fog of war, floating text, effects
    RendererTerrain.ts  # Terrain cache, water animation, resource nodes
    RendererShapes.ts   # Unit shape drawing, type defs, pure helpers
    SpriteLoader.ts  # Sprite loading (Tiny Swords + character packs)
    UIAssets.ts      # 9-slice panels, ribbons, icons
    Camera.ts        # Pan/zoom (mouse, keyboard, touch)
    VisualEffects.ts # Day/night, weather, particles, screen shake
  scenes/            # Scene system (Title, RaceSelect, Match, PostMatch, etc.)
    TitleScene.ts    # Title screen orchestrator, lifecycle, click handling
    TitleParty.ts    # Party/Firebase/matchmaking logic
    TitleRender.ts   # Title screen rendering (menus, panels, duel units)
  ui/                # Input handling, popups (Building, Hut, Research), TutorialManager
    InputHandler.ts  # Input orchestrator, keyboard/mouse setup, placement
    InputBuildTray.ts # Build tray layout and rendering
    InputSettings.ts  # Settings panel drawing and persistence
    InputTutorial.ts  # Tutorial overlay rendering and state
    InputAbilities.ts # Ability icons, nuke overlay, unit selection
  game/              # Game orchestration (Game.ts, GameLoop.ts)
  network/           # Firebase RTDB multiplayer (PartyManager, CommandSync)
  audio/             # Music + procedural SFX
  profile/           # Player stats, achievements, avatars (localStorage)
  tests/             # Headless simulation tests and balance tools
  util/              # Dev utilities (BalanceTracker)
```

### Key separation
- `simulation/` is **pure** — no DOM, no rendering, no imports from rendering/ui/scenes. This is the shared logic for both client and headless test runners.
- All player actions flow through `GameCommand` objects processed by `simulateTick()`.
- Rendering reads state but never mutates it.
- `GameState.ts` and `BotAI.ts` are public facades. Inside `src/simulation/`, prefer importing from the owning `Sim*` / `Bot*` module directly instead of routing through compatibility re-exports.

## Maps

| Mode | Map | Dimensions | Orientation | Shape axis |
|------|-----|------------|-------------|------------|
| 1v1, 2v2 | Duel | 80×120 | Portrait | `y` (top vs bottom) |
| 3v3 | Skirmish | 160×90 | Landscape | `x` (left vs right) |
| 4v4 | Warzone | 160×90 | Landscape | `x` (left vs right) |

Mode implicitly determines map — no separate map selector.

## Sprite System Gotchas

- **`SpriteDef.groundY`** = where feet touch ground (0=top, 1=bottom of frame). Tiny Swords sprites use 0.71, CHARACTER MEGAPACK uses 0.95. Attack sprites must match their move counterpart's groundY.
- **9-slice UI panels have dead space around edges** — always draw ~15% oversized to compensate.
- **UI spritesheets have 64px transparent gaps** between tiles — account for this when calculating source rects.
- SpriteLoader uses Vite `?url` static imports for Tiny Swords. Race building packs use `import.meta.glob` with `?url` query.
- Tiny Swords building color variants: Blue(P0), Purple(P1), Red(P2), Yellow(P3), Black(P4). Only used as fallback when no race-specific sprite exists.

## Race Building Sprites

Each race has unique building art from 4 purchased asset packs, loaded via `import.meta.glob` in `SpriteLoader.ts`.

- **Packs:** Human (57), Orc (58), Elf (45), NightElf (55) — 205 total PNGs
- **Pack → Race mapping:**
  - Human → Crown (upgrades only, T0 = Tiny Swords), Goblins
  - Orc → Horde, Demon
  - Elf → Tenders, Wild
  - NightElf → Deep, Geists, Oozlings
- **Sprite table:** `RACE_BUILDING_SPRITES` in SpriteLoader.ts, keyed by `"race:buildingKey:upgradeNode"` (e.g. `"crown:melee:B"`)
- **Fallback chain:** walks up the upgrade path: D→B→A, E→B→A, F→C→A, G→C→A. Missing entries inherit parent art. Final fallback = Tiny Swords.
- **Ability buildings:** Crown Foundry = `crown:foundry:A`, Goblin Potion Shop = `goblins:potionshop:A`. Loaded via `getRaceBuildingSprite()`.
- **Asset rules:**
  1. No cross-race duplicates (same PNG must not appear in two different races)
  2. No cross-building-type duplicates within a race (same PNG for melee and tower = bad), except tower bases where no unique asset is available
  3. Same-building reuse only along the same upgrade path (A→B→D OK, D and F sharing = bad)
- **Building names:** `getRaceBuildingName()` in `BuildingPopup.ts` returns race-flavored names (e.g. "Brute Camp", "Tidecaller Shrine"). Upgrade-aware: reflects current upgrade node name.
- **Building suffixes by race:**

| Race | Melee | Ranged | Caster |
|------|-------|--------|--------|
| Crown | Barracks | Range | Chapel |
| Horde | Camp | Post | Drum Pit |
| Goblins | Hut | Shack | Den |
| Oozlings | Pool | Pool | Pool |
| Demon | Pit | Spire | Shrine |
| Deep | Grotto | Reef | Shrine |
| Wild | Den | Nest | Hollow |
| Geists | Crypt | Tomb | Sanctum |
| Tenders | Grove | Bower | Garden |

## Research Skill Icons

Research upgrades in the popup use painted icons from the **Nhance Spell Icons Bundle**.

- **Source folder:** `src/assets/images/NhanceSpellIconsBundle/Textures_PNG/` — full 1,300-icon library. **Gitignored**, kept locally for browsing.
- **Used folder:** `src/assets/images/NhanceSpellIconsBundle/Used/` — only the ~92 icons referenced in the code. Committed to git, included in the build.
- **Loading:** `UIAssets.ts` uses `import.meta.glob` on the `Used/` folder. Icons are keyed by filename without extension (e.g. `T_Icon_Fire_08`).
- **Mapping:** `SKILL_ICON_MAP` in `ResearchPopup.ts` maps each upgrade ID to an icon key. Icons are drawn in a rounded-rect bordered frame (40px desktop, 30px mobile).
- **To swap an icon:** copy the new `.png` from `Textures_PNG/` into `Used/`, update the key in `SKILL_ICON_MAP`.
- **Categories:** BloodCombat (melee/weapons), Gold (royal/economy), Fire, Frost, Nature (healing/poison), Shadow (dark/undead), Unholy (spectral/death), Arcane (magic), Energy (buffs/power), Elements (earth/golem), Tech (fortification).
- **Duplicate rule:** no two icons on the same tab for the same race may share an icon. Cross-race sharing is OK (player only sees one race at a time).

## Multiplayer

- Firebase RTDB lockstep: `CommandSync` exchanges commands per turn, all clients simulate identically.
- **Sync model:** Each client buffers local commands, broadcasts them via Firebase RTDB, waits for all players' commands for the current turn, then advances the tick. If any client's simulation diverges by even one bit, the game desyncs irreparably.
- **What breaks sync:** Non-deterministic iteration order, `Math.random()`, time-dependent logic, floating-point differences across platforms (use integer math in simulation), conditional `state.rng()` calls, unordered collection iteration.
- **Testing sync changes:** After touching anything in `src/simulation/`, run `npm run test:sim` to verify determinism. Run two browser tabs in a local multiplayer game to smoke-test manually.
- Party system supports N players with bot backfill.
- `git push` from local `main` goes to `origin/master` (branch naming mismatch is intentional).

## Balance Workflow

After changing anything in `data.ts` (costs, stats, upgrades, spawn intervals):

1. `npm run cost-analysis` — verify effective cost ratios
2. `npm run balance` — check win rates (target: 40-60% per race overall)
3. See `BALANCE_PRINCIPLES.md` for identity locks and tuning guidelines

Effective cost model: **2 gold = 1 wood = 1 meat** (derived from harvester economics).

## Status Effects

| Type | Behavior | Max stacks |
|------|----------|------------|
| Slow | -10% move speed/stack, 3s | 5 |
| Burn | 2 dmg/sec/stack, 3s | 5 |
| Haste | 1.3x speed, 3s, refreshes | 1 |
| Shield | Absorbs 12 dmg, 4s | 1 |
| Frenzy | +50% damage (2-stack = +100%), 3s (Wild kill bonus) | 1 (2 via upgrades) |
| Wound | -50% healing, 6s | 1 |
| Vulnerable | +20% damage taken, 3s | 1 |

**Combos:** SEARED (Burn+Slow = +50% burn dmg), BLIGHT (Burn >= 3 blocks regen).

**Important:** `applyOnHitEffects()` is ONLY called from the melee path — ranged effects go through `tickProjectiles`.

## Tutorial System

- `src/ui/TutorialManager.ts` — state machine with localStorage persistence (`lanecraft.tutorial`)
- First-time players auto-enter a 2v2 tutorial match (Crown + Deep vs Goblins + Horde)
- 16 steps guide through: miner hut → melee barracks → tower → research → nuke → menu tour
- All peripheral inputs gated during tutorial (nuke, rally, research, right-click, minimap, keyboard shortcuts)
- Post-match returns to title screen for solo games

## Weather System

- 8 weather types: clear, overcast, rain, storm, snow, blizzard, fog, sandstorm
- 5 biomes with weighted weather pools (temperate, arctic, desert, swamp, volcanic)
- Split depth rendering (behind/in front of units), camera-culled particles
- Gradual transitions with pre-weather wind cues, procedural audio (rain/wind/thunder)

## Race Abilities

Each race has a unique ability building with 4 upgrade tiers (defined in `RACE_ABILITY_UPGRADES` in `data.ts`). Ability building costs use `ABILITY_COST_MODIFIERS` in `data.ts`.

- **Ability buildings share `BuildingType.Tower`** but are NOT real towers. They have marker flags (`isFoundry`, `isPotionShop`, `isGlobule`, `isSeed`). Use `isAbilityBuilding()` from `types.ts` to exclude them from tower cost escalation, tower targeting, tower counting, etc.
- **When adding a new race ability building** that uses `BuildingType.Tower`, add its marker flag to `BuildingState` and to `isAbilityBuilding()` in `types.ts`.

## Upgrade System

- **216 upgrade nodes** (9 races × 4 building types × 6 nodes: B, C, D, E, F, G). Node A is the base unit.
- **Tree shape:** A → B or C (tier 1) → D/E under B, F/G under C (tier 2). Each building has exactly 2 choices at each tier.
- **Per-node costs:** Every upgrade node has an explicit `cost: { gold, wood, meat }` in `UPGRADE_TREES` (data.ts). B vs C paths deliberately favor different resources, creating economic tradeoffs.
- **Upgrade cost function:** `getNodeUpgradeCost()` in data.ts returns the node's cost. If no `cost` field exists, falls back to the flat `RACE_UPGRADE_COSTS` table.
- **Stat multipliers:** `getUnitUpgradeMultipliers()` lives in `SimShared.ts` and is re-exported by `GameState.ts`; it walks the upgrade path and compounds all multipliers (hp, damage, attackSpeed, moveSpeed, range, spawnSpeed).
- **Specials:** `UpgradeSpecial` (data.ts) — per-node special effects like `dodgeChance`, `extraBurnStacks`, `splashRadius`, `auraDamageBonus`, `isSiegeUnit`, etc.

## Aura System

Horde (and potentially other races) have upgrade nodes that grant **aura buffs** to nearby allied units within range.

- **Source fields** (in `UpgradeSpecial`): `auraDamageBonus`, `auraSpeedBonus`, `auraArmorBonus`, `auraAttackSpeedBonus`, `auraHealPerSec`, `auraDodgeBonus`
- **Runtime fields** (transient, set per tick on affected units): `_auraDmg`, `_auraSpd`, `_auraArmor`, `_auraAtkSpd`, `_auraHeal`, `_auraDodge`
- **Reset each tick** in `tickAbilityEffects()` before recomputing — auras are non-stacking, best-value-wins.
- **Mechanics:**
  - `_auraDmg` / `_auraArmor` / `_auraSpd`: applied directly to combat math
  - `_auraAtkSpd`: extra attack timer tick-down (10% = extra tick every 10th game tick)
  - `_auraHeal`: heals N HP/sec (applied once per second via `state.tick % TICK_RATE === 0`)
  - `_auraDodge`: added to dodge chance in `dealDamage()`
- **Visuals** (Renderer.ts): rotating colored ring on source units, small pulsing dot at feet of buffed allies. Colors: red=damage, blue=armor, green=speed, yellow=atkSpeed, softGreen=healing, purple=dodge.

## Siege Units

Some upgrade paths produce **siege units** — slow, fragile, devastating vs buildings.

- **Marker:** `UpgradeSpecial.isSiegeUnit = true`
- **Traits:** High damage + `buildingDamageMult` (3-5x vs buildings), large splash, very slow move speed, long attack cooldown, reduced HP
- **Races with siege paths:** Crown (Cannon), Horde (Orc Catapult→Bombard/Doom Catapult), Goblins (Goblin Mortar), Oozlings (Glob Siege), Demon (Brimstone Cannon), Deep (Depth Charge)
- **Bot AI:** Siege upgrades are heavily penalized (0.1x value before 8 min, 0.4x after) — bots almost never pick siege early.

## Tri-Resource Economies

Most races use 2 resources. Two races use all 3:

- **Horde (Gold+Meat+Wood):** Melee costs meat, ranged costs wood, caster costs gold. Towers/huts cost a mix. Upgrade B vs C paths split across resources. Starting resources: 100g/50w/50m.
- **Tenders (Wood+Gold+Meat):** Building costs are wood+gold only. Meat comes from **Growth Pod** huts which cycle through generating gold → wood → meat (3s per resource, +3 each). Passive income is wood+gold. Starting: 50g/150w/0m.

## Multishot System

Some ranged units fire multiple projectiles per attack:

- **Marker:** `UpgradeSpecial.multishotCount` = number of extra projectiles (1 = 2 total, 2 = 3 total)
- **Damage:** Each projectile deals `multishotDamagePct` of base damage (e.g., 0.70 = 70%)
- **Races:** Horde Bowcleaver B-path (2→3 projectiles), Goblins Fan Knifer (2 projectiles)
- **Projectiles target different enemies** within range — multishot is area denial, not single-target burst.

## App Store Screenshots

`scripts/generate_store_screenshots.py` generates marketing screenshots for iOS App Store from raw gameplay captures.

- **Input:** `marketing/z/` — raw phone screenshots (1179×2556). Filename = caption text.
- **Output:** `marketing/apple/` (iPhone 1284×2778) and `marketing/apple-ipad/` (iPad 2048×2732)
- **Layout:** Dark teal gradient background, uppercase Impact caption at top, gameplay screenshot centered with rounded corners
- **Format:** RGB PNG, no alpha (App Store requirement)
- **To update:** rename/add/remove files in `marketing/z/`, then re-run the script. Captions are derived from filenames.
- **Accepted iPhone dimensions:** 1242×2688, 1284×2778, or 2778×1284 (landscape). Current: 1284×2778.

## Common Pitfalls

- Adding a `console.log` in `simulation/` files won't cause issues, but adding `Math.random()` will cause desync.
- Upgrade trees have 216 nodes (9 races × 4 building types × 6 nodes). Art-changing nodes must match their creature's animation.
- Touch + click can double-fire on hybrid devices — `lastClickTime` debounce guards against this.
- The bot AI value function bypasses race profile targets unless steering multipliers are applied.
- First tower is free per player. Tower alley is shared per team. Tower sell refund is prorated by HP: `50% × (currentHp / maxHp)`.
- Hut cost escalates: `baseCost × 1.35^hutCount`.
- Burn/poison suppresses regen entirely (BLIGHT combo at 3+ burn stacks).
- Aura `_runtime` fields (e.g., `_auraDmg`) are **transient** — they're reset to 0 every tick and recomputed. Never save/serialize them.
- Per-node upgrade costs must use the race's actual resources. Crown nodes use gold+wood, Demon nodes use meat+wood (never gold), etc.
- Siege units (`isSiegeUnit: true`) should only appear at T2 (terminal nodes D-G). They're too impactful for T1.
- Building sprites are clamped to tile width in iso mode — don't set tier scaling so high that buildings overflow their tile.
- Units attacking towers/HQ keep `targetId === null` — the simulation gates building-attack on `targetId === null`. The transient `_attackBuildingIdx` field is set by the simulation when a unit attacks a building (index into `state.buildings`, or -1 for HQ). Use it in renderer/UI code to detect building combat instead of relying on `targetId`.
