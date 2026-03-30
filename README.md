# Lanecraft

Fantasy RTS with 9 races, sprite-based rendering, and deterministic tick simulation. Supports 1v1, 2v2, 3v3, and 4v4 modes. Build spawners, upgrade units, contest the diamond, and destroy the enemy HQ.

## Quick Start

```bash
npm install
npm run dev
```

Build and smoke test:

```bash
npm run build
npm run test:sim
```

Run headless balance simulation:

```bash
npm run balance          # full matchup grid
npm run balance -- --quick  # mirror-team round robin only
```

## 9 Races

| Race | Resources | Identity |
|------|-----------|----------|
| Crown | Gold + Wood | Balanced, shield + dmg reduction |
| Horde | Gold + Meat + Wood | Brute force, knockback |
| Goblins | Gold + Wood | Fast + cheap, poison |
| Oozlings | Gold + Meat | Swarm (2x units), haste |
| Demon | Meat + Wood | Glass cannon, burn |
| Deep | Wood + Gold | Tank + control, slow |
| Wild | Wood + Meat | Aggro + poison |
| Geists | Meat + Gold | Undying, lifesteal |
| Tenders | Wood + Gold + Meat | Regen + healing |

## Controls

### Keyboard
- `1`/`2`/`3`/`4`: select building type (Melee/Ranged/Caster/Tower), then click to place.
- `M`: build miner hut.
- Right-click own building: sell (blocked for 5s after placement).
- `U`/`I`: buy upgrade branch on selected/hovered owned building.
- Click owned spawner: toggle lane (behavior depends on lane mode).
- `K`: toggle lane mode (`Fast Toggle`/`Safe Select`).
- `L`: flip all owned spawners to opposite lane.
- `N`: enter/exit nuke targeting, then click map to fire.
- `P` (or middle mouse): send ping at cursor.
- `Q` hold + release: quick-chat radial.
- `Z`/`X`/`C`/`V`: direct quick-chat shortcuts.
- `W`/`A`/`S`/`D` or drag: camera pan.
- Mouse wheel: zoom.
- `Esc`: close overlays/cancel modes.

### Mobile / Touch
- Long-press map: quick-chat radial.
- Pinch: zoom.
- Utility row: PING, SETTINGS, CHAT/DEFEND buttons.
- Settings drawer: lane tap mode, UI feedback, radial hold delay/size, accessibility mode.

## Project Structure

- `src/main.ts` — Entry point, wires SceneManager.
- `src/scenes/` — Scene system (Title, RaceSelect, DifficultySelect, Match, PostMatch, UnitGallery, Profile).
- `src/game/Game.ts` — Game coordinator (loop, input, sound dispatch).
- `src/game/GameLoop.ts` — Fixed timestep (20 ticks/sec).
- `src/simulation/types.ts` — Constants, map geometry, enums, command types.
- `src/simulation/data.ts` — Unit stats, building costs, race colors, tower stats, upgrade trees.
- `src/simulation/GameState.ts` — Authoritative simulation tick and command processing.
- `src/simulation/BotAI.ts` — Pure bot AI (no DOM deps), used by Game.ts and headless sim.
- `src/rendering/Renderer.ts` — World, HUD, minimap drawing.
- `src/rendering/SpriteLoader.ts` — Loads sprites from Tiny Swords asset pack.
- `src/rendering/VisualEffects.ts` — Day/night, weather, particles, screen shake.
- `src/rendering/UIAssets.ts` — 9-slice panels, ribbons, swords, icons.
- `src/rendering/Camera.ts` — Pan/zoom with mouse, keyboard, touch.
- `src/simulation/maps.ts` — Data-driven map definitions (Duel, Skirmish, Warzone).
- `src/network/PartyManager.ts` — Firebase RTDB party/lobby management.
- `src/network/CommandSync.ts` — N-player turn-based lockstep sync.
- `src/profile/ProfileData.ts` — Player stats, achievements, avatars (localStorage).
- `src/ui/InputHandler.ts` — Input handling, build tray UI, placement logic.
- `src/audio/SoundManager.ts` — Procedural SFX and spatial volume.
- `src/audio/MusicPlayer.ts` — Background music playback.
- `src/util/BalanceTracker.ts` — localStorage match history for dev balance overlay.
- `src/tests/simSmoke.ts` — Simulation smoke tests.
- `src/tests/balanceSim.ts` — Headless balance simulation script.

## Runtime Model

- Simulation runs at `TICK_RATE` (20 ticks/second) in `GameLoop`.
- Rendering runs every animation frame and reads current simulation state.
- Commands are queued by input/bots and consumed by `simulateTick`.
- Simulation is pure (no rendering) — ready for server extraction.

## Key Gameplay Systems

- **Movement/Formations** — Lane-based pathing with formation slots, crowd dampening, choke spreading.
- **Combat/Aggro** — Units acquire targets beyond attack range, chase until in range. HQ has defensive fire.
- **Economy** — Race-aware passive income (+1/sec primary, +0.1/sec secondary). Harvesters mine base resources and center gold cells.
- **Diamond Objective** — Exposed after center mining. Any combat unit picks up on contact. Delivering spawns a Diamond Champion.
- **Nukes** — Telegraph + delayed detonation (radius 16). Bot targeting picks densest enemy cluster.
- **Multiplayer** — Firebase RTDB party system with N-player lockstep sync, matchmaking, party codes.
- **Upgrades** — 216 upgrade nodes (9 races × 4 building types × 6 nodes). Specials: dodge, regen, revive, chain, multishot, splash, knockback, etc.
- **First Tower Free** — First tower placement costs nothing.
- **Tower Alley** — Shared 20×12 team build zone in the neck area.

## Sprite Assets

- `src/assets/images/Tiny Swords (Free Pack)/` — Buildings (Blue/Red/Purple/Yellow/Black), units (Crown/Deep), UI elements, resources, FX.
- `src/assets/images/CHARACTER MEGAPACK/` — Unit sprites (Horde, Demon, Geists, Tenders melee, Oozlings).
- `src/assets/images/RPG HEROES ENEMIES/` — Various unit sprites.
- `src/assets/images/SLIMES BLOBS TENTACLES/` — Oozlings sprites.

## AI Contributor Notes

- Prefer changing constants and helper functions before rewriting whole systems.
- Keep map geometry changes centralized in `types.ts`; mirror resource-node updates in both simulation and renderer.
- Validate changes with `npm run build` and `npm run test:sim`.
- For balance changes, run `npm run balance` to check race win rates.
