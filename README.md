# ASCII Wars

Browser RTS prototype with deterministic tick simulation, canvas rendering, and lightweight bot AI.

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

## Current Controls (Implemented)

- `1`/`2`/`3`/`4`: select building type (Melee/Ranged/Caster/Tower), then click a valid slot to place.
- `M`: build miner hut.
- Right-click own building: sell (blocked for 5s after placement).
- `U`/`I`: buy upgrade branch on selected/hovered owned building.
- Click owned spawner: lane behavior depends on lane mode:
  - `Fast Toggle`: single click switches lane.
  - `Safe Select`: first click selects, second quick click switches lane.
- `K`: toggle lane mode (`Fast Toggle`/`Safe Select`).
- `L`: flip all owned spawners to opposite lane.
- `N`: enter/exit nuke targeting, then click map to fire.
- `P` (or middle mouse click): send ping at camera center / cursor.
- `Q` hold + release: quick-chat radial (`Attack Left`, `Attack Right`, `Defend`, `Get Diamond`).
- `Z`/`X`/`C`/`V`: direct quick-chat shortcuts.
- `W`/`A`/`S`/`D` or drag: camera pan.
- Mouse wheel or pinch: zoom.
- `Esc`: close overlays/cancel modes.

## Mobile / Touch UX (Implemented)

- Long-press the map to arm quick-chat radial.
- Pinch zoom is enabled (`touchAction: none`) with two-pointer anchor zoom.
- Utility row above tray includes:
  - `PING`
  - `SETTINGS` (with compact `FAST`/`SAFE` lane-mode legend on small screens)
  - `CHAT` / `DEFEND` (during chat cooldown)
- When chat is cooling down, tapping `DEFEND` queues a `Defend` quick-chat send; tapping again cancels the queue.
- Settings drawer supports:
  - Lane tap mode
  - UI feedback (haptic/beep)
  - Radial hold delay
  - Radial size
  - Radial accessibility mode
  - Reset defaults
  - Tap-outside-to-close

## Project Structure

- `src/main.ts`: app bootstrap.
- `src/game/Game.ts`: top-level game coordinator (loop, input, bots, sound dispatch).
- `src/game/GameLoop.ts`: fixed timestep update + per-frame render driver.
- `src/simulation/types.ts`: core constants, map geometry, game data types, command types.
- `src/simulation/data.ts`: static balance tables and race/unit stats.
- `src/simulation/GameState.ts`: authoritative simulation systems and command processing.
- `src/rendering/Renderer.ts`: all world/HUD/minimap drawing.
- `src/rendering/Camera.ts`: pan/zoom transform and input-driven camera motion.
- `src/ui/InputHandler.ts`: keyboard/mouse controls, build tray UI, placement logic.
- `src/audio/SoundManager.ts`: generated SFX and spatial volume attenuation.
- `src/tests/simSmoke.ts`: no-dependency simulation smoke checks.

## Runtime Model

- Simulation is fixed at `TICK_RATE` (20 ticks/second) in `GameLoop`.
- Rendering runs every animation frame and reads the current simulation state.
- Commands are queued by input/bots and consumed by `simulateTick`.
- Most game behavior is deterministic from state + command list.

## Key Gameplay Systems

- **Movement/Formations**
  - Units advance along lane paths with local steering (formation slots, crowd dampening, choke spreading).
  - Unit and harvester positions are clamped to arena bounds derived from map margins.
- **Collision**
  - Unit-unit separation (all teams), plus collisions against buildings and unmined diamond cells.
- **Combat/Aggro**
  - Units acquire targets beyond strict attack range (`aggro bonus`) and chase until in range.
  - HQ is damaged by normal attacks when in range (not by path-end auto-damage).
  - HQ has defensive fire against nearby enemies.
- **Nukes**
  - Telegraph + delayed detonation.
  - Radius is currently `16`.
  - Bot nuke targeting picks the densest local enemy cluster (not global centroid).
- **Economy/Objectives**
  - Harvesters mine base resources and center cells.
  - Diamond objective is exposed after center mining opens a path.
  - Center objective is visually signposted in-world and in HUD.

## Layout/Alignment Notes

- Build grids use team pair spacing from `getBuildGridOrigin`.
- Hut rows are controlled independently by `getHutGridOrigin`.
- Current hut gap tuning is intentionally customized for P1/P2 and P3/P4 visual parity.

## AI Contributor Notes

- Prefer changing constants and helper functions before rewriting whole systems.
- Keep map geometry changes centralized in `types.ts`; mirror resource-node updates in both simulation and renderer.
- When changing targeting/collision/pathing, validate with both:
  - `npm run build`
  - `npm run test:sim`
- If behavior is visual/layout-sensitive, verify in-game with representative 2v2 scenarios (early lane clash, center contest, HQ pressure).
