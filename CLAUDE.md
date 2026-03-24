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
```

## Critical Rules

### Determinism — the #1 footgun
The simulation must be **fully deterministic** for multiplayer lockstep sync.

- **NEVER use `Math.random()` in any `src/simulation/` file.** Always use `state.rng()`.
- Any new `state.rng()` call changes the RNG sequence, which **invalidates all prior balance data** and can cause multiplayer desync. Re-run `npm run balance` after any such change.
- Sort tie-breakers in GameState.ts and BotAI.ts must be stable (use entity ID as final tiebreaker).

### Resource types
The game uses **Gold, Wood, Meat** (NOT Stone). "Stone" appears in the old GDD but was renamed.

### 9 Races and their economies
| Race | Resources | Identity |
|------|-----------|----------|
| Crown | Gold + Wood | Balanced, shield + dmg reduction |
| Horde | Gold + Meat | Brute force, knockback |
| Goblins | Gold + Wood | Fast + cheap, poison/burn |
| Oozlings | Gold + Meat | Swarm (spawnCount:2), haste |
| Demon | Meat + Wood | Glass cannon, burn. **No gold economy.** |
| Deep | Wood + Gold | Tank + control, slow |
| Wild | Wood + Meat | Aggro + poison. **No gold economy.** |
| Geists | Meat + Gold | Undying, lifesteal |
| Tenders | Wood + Gold | Regen + healing |

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
    GameState.ts     # State creation, tick simulation, command processing
    BotAI.ts         # Bot AI (no DOM deps), used by Game.ts and headless tests
    maps.ts          # Data-driven map definitions (Duel, Skirmish, Warzone)
  rendering/         # Canvas rendering (client only)
    Renderer.ts      # World, HUD, minimap drawing
    SpriteLoader.ts  # Sprite loading (Tiny Swords + character packs)
    UIAssets.ts      # 9-slice panels, ribbons, icons
    Camera.ts        # Pan/zoom (mouse, keyboard, touch)
    VisualEffects.ts # Day/night, weather, particles, screen shake
  scenes/            # Scene system (Title, RaceSelect, Match, PostMatch, etc.)
  ui/                # Input handling, popups (Building, Hut, Research)
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
- SpriteLoader uses Vite `?url` static imports. Building color variants: Blue(P0), Purple(P1), Red(P2), Yellow(P3), Black(P4).

## Multiplayer

- Firebase RTDB lockstep: `CommandSync` exchanges commands per turn, all clients simulate identically.
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
| Frenzy | +50% damage, 3s (Wild kill bonus) | 1 |
| Wound | -50% healing, 6s | 1 |
| Vulnerable | +20% damage taken, 3s | 1 |

**Combos:** SEARED (Burn+Slow = +50% burn dmg), BLIGHT (Burn >= 3 blocks regen).

**Important:** `applyOnHitEffects()` is ONLY called from the melee path — ranged effects go through `tickProjectiles`.

## Common Pitfalls

- Adding a `console.log` in `simulation/` files won't cause issues, but adding `Math.random()` will cause desync.
- Upgrade trees have 216 nodes (9 races × 4 building types × 6 nodes). Art-changing nodes must match their creature's animation.
- Touch + click can double-fire on hybrid devices — `lastClickTime` debounce guards against this.
- The bot AI value function bypasses race profile targets unless steering multipliers are applied.
- First tower is free per player. Tower alley is shared per team.
- Hut cost escalates: `baseCost × 1.35^hutCount`.
