# Lanecraft - Game Design Document v2

> **Note:** This document is a historical design reference from early development. The game has since evolved significantly: 9 races (Crown, Horde, Goblins, Oozlings, Demon, Deep, Wild, Geists, Tenders) replace the original 4 (Surge, Tide, Ember, Bastion), "Stone" is now "Meat", maps are data-driven (Duel 80x120, Skirmish 160x90, Warzone), and match duration targets 3-5 minutes. See `README.md` and `BALANCE_PRINCIPLES.md` for the current state of the game.

## Working Title
Lanecraft

## High Concept
A real-time lane autobattler supporting 1v1, 2v2, 3v3, and 4v4 modes. Players build spawn buildings on a base grid. Units automatically march toward the enemy base, splitting left or right around a central diamond obstacle. Players win either by destroying the enemy HQ or by mining and returning a single unique diamond to their HQ.

## Platform and Presentation

- **Platform:** Web app first (desktop browsers), iOS and Android later.
- **Screen orientation:** Vertical (portrait), one-hand friendly on mobile.
- **Art:** Sprite-based rendering on HTML5 Canvas using Tiny Swords and character sprite packs. Readability first: outline separation, z-order layering, colored accents per race.
- **Color:** Used intentionally for clarity and appeal, with colorblind-safe alternatives (icons, patterns, shape coding). Each race has a primary and secondary accent color.
- **Target resolution:** 360x640 logical pixels minimum (mobile), scales up for desktop.
- **Target frame rate:** 60 FPS rendering, simulation at 20 ticks/second.

## Core Pillars

1. Readable lane pressure and teamwork across 1v1 to 4v4
2. Simple build decisions with meaningful branching upgrades
3. Strategic resource risk: safe income vs. contested center
4. Big save moments via nukes and diamond steals
5. High unit spectacle without losing clarity

---

## Game Mode and Match Rules

### Game Modes
- **1v1** — Solo duel on the portrait Duel map. Build grids are centered.
- **2v2** — Default team mode on the portrait Duel map. Teammates share an HQ.
- **3v3** — Large battles on the landscape Skirmish map. 3 bases stacked per side.
- **4v4** — Massive battles on the Warzone map.
- Teams share one HQ health pool. If HQ dies, team loses.
- Player perspective is always bottom-up (your base at bottom, enemy at top) on portrait maps, or left-to-right on landscape maps.
- **Match duration target:** 8-15 minutes average.

### MVP Requirement
Support bots as teammate and/or opponent, with difficulty variants later.

### Race Selection and Party Flow
- Players choose their race in the lobby before matchmaking begins.
- Teammates may pick the same or different races.
- Matchmaking: find 4 players (or fill missing slots with bots), then enter match.

### Disconnect and Reconnect
- If a player disconnects, a bot takes over immediately.
- Player can relaunch and resume control, inheriting the bot's state (buildings placed, resources spent).
- Bot is allowed to spend resources and place buildings while covering.
- **Reconnect window:** 10 minutes. After window expires, player becomes spectator and bot continues for the rest of the match.

---

## Map and Lanes

### Map Layout
- Vertical scrolling battlefield.
- **Map size:** 80 tiles wide x 200 tiles tall.
- Two lanes separated by an impassable center diamond obstacle (~20x20 tiles).
- Each lane is ~25 tiles wide with a ~10 tile gap between lanes (the diamond).
- **Bottom team:** P1 controls left lane, P2 controls right lane.
- **Top team:** P3 controls left lane, P4 controls right lane.
- Units spawn from bases and march upward (bottom team) or downward (top team).

### Map Zones (bottom-to-top)
1. **Bottom base zone** (rows 1-30): P1 and P2 build grids, HQ, base gold node.
2. **Bottom territory** (rows 31-60): Side resource nodes (wood left, stone right).
3. **Mid zone** (rows 61-140): Center diamond obstacle, fork point, super gold piles, the Diamond objective. This is the primary combat zone.
4. **Top territory** (rows 141-170): Mirrored side resource nodes.
5. **Top base zone** (rows 171-200): P3 and P4 build grids, HQ.

### Fork and Lane Routing
- Each unit is associated with the building that spawned it.
- Each building has a lane setting: left or right.
- There is a single decision-point fork where lanes diverge around the center diamond (~row 80 for bottom team, ~row 120 for top team).
- When a unit reaches the fork, it checks its building's **current** lane setting at that moment and routes accordingly. Changing a building's lane toggle redirects future arrivals at the fork.

### Lane Separation and Fighting
- Lanes are visually separated enough for clarity in mid-field.
- Lanes converge near bases so fights can blend, providing crossover defensive benefit. The dominant flow remains lane-based.

### Pathfinding
- Navigation mesh or equivalent for steering around the diamond and blocked geometry.
- Units follow a primary lane spline with local avoidance for crowding.
- Local avoidance uses soft collision: units can slide past slightly but still form blobs and traffic jams.

---

## Camera and Controls

### Camera
- **Mobile:** Drag to pan vertically, pinch to zoom.
- **Desktop:** Mouse drag or WASD to pan, scroll wheel to zoom.
- Fully zoomed out on phone shows entire map width and ~70% of the vertical battlefield; slight scroll needed to see both bases.
- **Prototype status:** Zoom is currently continuous with min/max clamping.

### Primary Player Actions
1. Place buildings by selecting from tray/hotkey and tapping a base grid slot.
2. Toggle building lane (left or right).
3. Purchase upgrades for buildings.
4. Build harvester huts and assign them to resource types.
5. Use 1 nuke per match via armed targeting mode (`N` then tap target).
6. Pan/zoom the camera to scout.

### Communication (MVP)
- **Ping system:** `P`, middle-click, or the `PING` utility button sends team-visible ping.
- **Quick chat:** 4 preset messages (Attack Left, Attack Right, Defend, Get Diamond) via radial menu (`Q` hold or touch long-press).
- **Cooldown fallback:** While quick-chat is on cooldown, utility button switches to `DEFEND` and can queue/cancel a delayed `Defend` send.

---

## Base Building System

### Base Build Zone
- Building placement is restricted to your base build zone (a 7x7 grid of slots).
- Grid coordinates map directly to spawn offsets: units spawn in formation mirroring building positions.
- Each player has their own 7x7 grid. P1's grid is on the left side, P2's on the right.

### Building Placement UX
- Drag from a build tray at bottom of screen onto a grid slot.
- Valid slots highlight green; invalid placement shows red with a reason tooltip.
- Placement requires confirmation (tap confirm button or release with confirm toggle on).
- Selling is allowed but punitive:
  - **Sell refund:** 50% of base gold cost, 0% of wood/stone costs.
  - **Sell cooldown:** Cannot sell a building within 5 seconds of placement.
  - Sell requires a confirm tap to prevent accidents.

---

## Economy and Resources

### Resource Types
MVP supports 3 spend currencies plus a special objective item:

| Resource | Role | Source |
|----------|------|--------|
| Gold | Primary currency, used for all buildings | Passive income, base node, center super gold |
| Wood | Secondary currency for upgrades/casters | Left-side forest nodes (infinite) |
| Stone | Secondary currency for upgrades/towers | Right-side quarry nodes (infinite) |
| The Diamond | Unique win-condition object | Center of map (1 per match) |

### Income Sources

| Source | Yield | Notes |
|--------|-------|-------|
| Passive gold | +2 gold/sec per team (+1 per player) | Always active |
| Base gold node | +3 gold per harvester trip (2s mine time) | Infinite, safe |
| Wood node | +4 wood per harvester trip (2s mine time) | Infinite, side of map |
| Stone node | +4 stone per harvester trip (2s mine time) | Infinite, side of map |
| Center super gold | +8 gold per harvester trip (3s mine time) | 3 finite piles, 50 gold each, shared between teams |
| Kill rewards | None in MVP | Avoids snowball; can add later |

- Resources are **per-player wallets** (not shared between teammates).
- Passive income is evenly distributed to both players each second.

---

## Harvester System

### Harvester Huts
- Players can build harvester huts (max 10 per player).
- Costs escalate: hut N costs `baseCost * 1.35^(N-1)`.

| Hut # | Gold Cost |
|-------|-----------|
| 1 | 50 |
| 2 | 68 |
| 3 | 91 |
| 4 | 123 |
| 5 | 166 |
| 6 | 224 |
| 7 | 302 |
| 8 | 408 |
| 9 | 551 |
| 10 | 744 |

- Each hut supports 1 active harvester at a time.
- If a harvester dies, it respawns from its hut after **10 seconds**.
- Huts are placed in the base build zone and occupy grid slots like other buildings.

### Assignment and Behavior
- Each hut has an assignment: base gold, wood, stone, center super gold, or center diamond.
- Harvesters physically walk to assigned node, channel-mine, then walk back to HQ to deposit.
- **Mining channel times:**
  - Base gold, wood, stone: 2 seconds.
  - Center super gold: 3 seconds.
  - Diamond extraction: 8 seconds.
- Assignment can be changed at any time via a cycle button on the hut UI.

### Diamond Harvesting Rules
- If assigned to center diamond, harvesters path to the diamond spawn point.
- If the diamond has been dropped somewhere on the map, diamond-assigned harvesters prioritize picking up the dropped diamond instead.
- Picking up a dropped diamond is instant (no channel time).
- **Diamond delivery:** When a harvester carrying the diamond reaches your HQ deposit zone, the match ends immediately in your team's victory.
- If a diamond carrier dies, the diamond drops at the death location and remains there indefinitely (no reset timer).
- **Any unit or harvester on the carrying team can pick up a dropped diamond** if they walk over it, but only harvesters assigned to diamond will actively seek it out. Combat units pick it up passively if they path over it.

### Harvester Vulnerability
- Harvesters have low HP (30 HP), no attacks, and attempt to flee back toward their base when enemies are within 5 tiles.
- If killed, they drop any carried diamond and lose any in-progress mining.

---

## Units and Combat

### Unit Categories per Race (MVP)
Each race provides 4 building types that produce/are:

| Building | Produces | Role |
|----------|----------|------|
| Melee Spawner | Melee units | Frontline, tanking, DPS |
| Ranged Spawner | Ranged units | Back-line sustained damage |
| Caster Spawner | Caster units | AoE/utility/status effects |
| Tower | Nothing (is itself the unit) | Stationary base defense |

Flying and special units are **out of scope for MVP**.

### Core Combat Rules
- Real-time continuous combat.
- Attacks use windup + cooldown (attack speed).
- Units stick to current target until target dies or exits range, then reacquire nearest valid target.
- **Projectiles:**
  - Have travel time (speed varies by unit type).
  - If target dies before impact, projectile misses (no retargeting).
  - AoE projectiles still damage others within radius on impact.
  - Piercing, bouncing, chaining are special upgrade behaviors only (not baseline).

### Targeting
- Default targeting: nearest enemy within attack range.
- Towers pick a target in range, retarget when target dies or leaves range.
- Ranged units prefer to maintain ~3 tiles behind nearest allied melee if possible (soft preference, not hard requirement).

### Collision and Movement
- Soft collision and local avoidance.
- Units can slide past each other slightly, avoiding deadlocks, while still behaving like crowds.
- Units can briefly occupy the same tile space if pushed by crowd forces but should quickly separate.
- Allies do not block allied ranged unit projectiles.

### Status Effects
MVP includes simple resist/weakness by element. No combo crafting.

| Race | Signature Status | Stacking |
|------|-----------------|----------|
| Surge (Electric) | Chain Lightning / Haste | Chain hits up to 3 targets; haste does not stack, refreshes |
| Tide (Water) | Slow | Stacks up to 5 (each stack = -10% move speed) |
| Ember (Fire) | Burn (DoT) | Stacks up to 5 (each stack = 2 damage/sec for 3s) |
| Bastion (Stone) | Knockback / Shield | Shield stacks to 1 instance, refreshes duration; knockback does not stack |

---

## Races

Players pick one race pre-matchmaking and are locked for the match. Each race uses the same building archetypes but spawns race-specific units with distinct stats and signature effects.

### Surge (Electric)

**Theme:** Speed and chain reactions. Fast, fragile units that punish clumping.

| Unit | ASCII Sprite | HP | Damage | Attack Speed | Move Speed | Range | Special |
|------|-------------|-----|--------|-------------|------------|-------|---------|
| Spark Blade (Melee) | `/>` | 80 | 12 | 0.8s | 5 | 1 | 15% chance to apply Haste to self on hit (1.3x speed, 3s) |
| Arc Archer (Ranged) | `~>` | 50 | 10 | 1.2s | 4 | 8 | Projectile chains to 1 nearby enemy (half damage) |
| Storm Mage (Caster) | `{S}` | 40 | 18 | 2.0s | 3 | 7 | AoE 3x3, applies 1 stack of Slow to all hit |
| Tesla Coil (Tower) | `[Z]` | 200 | 15 | 1.5s | 0 | 9 | Chain lightning hits up to 3 targets |

### Tide (Water)

**Theme:** Control and attrition. Slow enemies down, grind them out.

| Unit | ASCII Sprite | HP | Damage | Attack Speed | Move Speed | Range | Special |
|------|-------------|-----|--------|-------------|------------|-------|---------|
| Wave Guard (Melee) | `|W|` | 110 | 8 | 1.0s | 3.5 | 1 | Applies 1 Slow stack on hit |
| Bubble Shot (Ranged) | `o~` | 55 | 9 | 1.3s | 3.5 | 7 | Applies 1 Slow stack on hit |
| Tidal Caller (Caster) | `{T}` | 45 | 14 | 2.2s | 3 | 7 | AoE 4x4, applies 2 Slow stacks |
| Whirlpool (Tower) | `(@)` | 250 | 8 | 1.0s | 0 | 7 | Hits all enemies in range, applies 1 Slow stack |

### Ember (Fire)

**Theme:** Aggressive burst damage. Glass cannon with burn pressure.

| Unit | ASCII Sprite | HP | Damage | Attack Speed | Move Speed | Range | Special |
|------|-------------|-----|--------|-------------|------------|-------|---------|
| Flame Knight (Melee) | `/F\` | 70 | 15 | 0.9s | 4.5 | 1 | Applies 1 Burn stack on hit |
| Fire Archer (Ranged) | `>>` | 45 | 13 | 1.1s | 4 | 8 | Applies 1 Burn stack on hit |
| Inferno Mage (Caster) | `{I}` | 35 | 22 | 2.5s | 3 | 6 | AoE 3x3, applies 2 Burn stacks |
| Flame Turret (Tower) | `<F>` | 180 | 20 | 1.8s | 0 | 8 | Burn 1 stack, high single-target damage |

### Bastion (Stone)

**Theme:** Durable and defensive. Shields, knockback, hard to kill.

| Unit | ASCII Sprite | HP | Damage | Attack Speed | Move Speed | Range | Special |
|------|-------------|-----|--------|-------------|------------|-------|---------|
| Stone Wall (Melee) | `[#]` | 150 | 6 | 1.2s | 2.5 | 1 | Knockback on every 3rd hit |
| Rock Thrower (Ranged) | `.o` | 60 | 11 | 1.4s | 3 | 7 | 20% chance to knockback |
| Earth Shaman (Caster) | `{E}` | 50 | 10 | 2.0s | 3 | 6 | Grants Shield to 3 nearest allies (absorbs 20 damage, 5s) |
| Stone Pillar (Tower) | `[||]` | 350 | 10 | 1.5s | 0 | 6 | Grants Shield to all allied units within 4 tiles every 8s |

---

## Buildings and Spawning

### Building Types (MVP)
Per player: Melee Spawner, Ranged Spawner, Caster Spawner, Tower.

| Building | Gold Cost | Wood Cost | Stone Cost | HP |
|----------|-----------|-----------|------------|-----|
| Melee Spawner | 100 | 0 | 0 | 300 |
| Ranged Spawner | 120 | 20 | 0 | 250 |
| Caster Spawner | 150 | 30 | 20 | 200 |
| Tower | 200 | 0 | 50 | Race-specific (see above) |
| Harvester Hut | 50 (escalating) | 0 | 0 | 150 |

### Spawning Rules
- Buildings auto-spawn units on a timer; cannot be paused.
- **Baseline spawn interval:** 10 seconds for all spawners.
- Spawner buildings have an internal queue of 1. If spawn point is blocked, spawn delays until clear.
- Towers do not spawn units; they are themselves static combat units.
- Players may build multiple copies of the same building type.

### Lane Toggles
- Each spawner building has a lane setting: left or right. Default is the lane matching the player's side.
- **Global lane toggle:** A button that sets all spawners to left or right at once, with per-building overrides available afterward.

---

## Upgrade System

### Upgrade Philosophy
Upgrades are **per building**, not global. They modify future spawns from that building (existing units on the field are unaffected).

### Upgrade Tree Shape
Branching tiers with choices:
```
        [A] (base)
       /   \
     [B]   [C]       (Tier 1: choose one)
    /   \   /   \
  [D]  [E] [F]  [G]  (Tier 2: choose one within your branch)
```

### Upgrade Costs

| Tier | Gold | Wood | Stone |
|------|------|------|-------|
| Tier 1 (B or C) | 80 | 20 | 20 |
| Tier 2 (D/E/F/G) | 160 | 50 | 50 |

### Melee Spawner Upgrades (Example - Surge Race)

| Node | Name | Effect |
|------|------|--------|
| A | Spark Blade | Base unit |
| B | Hardened Blade | +30 HP, +3 damage |
| C | Swift Blade | +1.5 move speed, -0.1s attack speed |
| D | Iron Spark | +50 HP, +5 damage, gains small knockback |
| E | Berserker Spark | +8 damage, attacks apply Haste to self (guaranteed) |
| F | Phantom Blade | +3 move speed, 30% dodge chance |
| G | Chain Striker | Attacks chain to 1 additional enemy for 50% damage |

*Each race has its own upgrade tree for each building type (48 upgrade nodes total across all races). Full tables to be defined per race during implementation.*

---

## HQ

| Property | Value |
|----------|-------|
| HP (shared per team) | 2000 |
| Regen | None |
| Armor | 0 |
| Position | Center of base zone, behind build grid |
| Size | 6x4 tiles |
| Diamond deposit zone | 3-tile radius around HQ |

The HQ is indestructible by its own team. It does not attack.

---

## Nuke Ability

### Rules
- Each player gets **1 nuke per match**.
- Drag-and-drop targeting anywhere on the map.
- Affects **enemy units only**. No friendly fire. Does not damage buildings or HQ.
- **Telegraph:** 1.25-second warning circle visible to all players, then detonation.
- **Radius:** 8 tiles.
- **Damage:** Kills all normal units within radius (infinite damage to units).
- **Diamond interaction:** If an enemy diamond carrier is within radius, it dies and drops the diamond.

---

## Win Conditions

Two win conditions (mutually exclusive by construction):

1. **Military Victory:** Destroy enemy HQ (reduce to 0 HP).
2. **Diamond Victory:** Return the unique diamond to your HQ deposit zone.

### Rules
- Diamond victory only triggers when the diamond is delivered to HQ **and** HQ still exists.
- If HQ is destroyed in the same frame the diamond arrives, military victory takes priority (HQ must exist at moment of delivery).
- If no win condition is met after **20 minutes**, the team with higher remaining HQ HP wins. If tied, the match is a draw.

---

## UI and UX

### HUD Elements
- **Top bar:** Gold / Wood / Stone counters with income rate shown as (+N/s).
- **Nuke icon:** Bottom-right, shows used/unused state with cooldown if applicable.
- **Mini-map:** Always visible in corner; shows lane pressure bars, approximate battle lines, unit density dots, and diamond location. Can be tapped to jump camera.
- **Teammate indicator:** Small portrait + race icon showing ally's status.

### Build Tray
- Bottom of screen, horizontal scrollable tray showing available buildings with costs.
- Drag-and-drop onto grid to place.
- Tap a placed building on grid to open a context panel:
  - Lane toggle (left/right button)
  - Upgrade button (shows branch choices if available)
  - Sell button (with confirm)

### Harvester UI
- Tapping a hut shows:
  - Assigned resource type (icon + label)
  - Harvester status: alive (with position dot on minimap) or respawn timer countdown
- Quick-toggle to cycle assignment types: Base Gold -> Wood -> Stone -> Center Gold -> Diamond -> Base Gold.

### Match Start Sequence
1. Loading screen with team composition display (races chosen).
2. 10-second pre-match phase: camera starts zoomed on your base, build tray is active, timer counts down. Players can place initial buildings.
3. Match begins: units start spawning, passive income starts.

---

## Bots

### Bot Behavior
- Maintain ~2:1 spending ratio between combat buildings and economy huts until late game (after 10 minutes, shift to 3:1 favoring combat).
- Periodically adjust lane toggles based on lane pressure (every 15 seconds, evaluate which lane has fewer allied units and redirect 1 spawner).
- Use nuke defensively when a large enemy blob (8+ units) is within your half and threatens HQ or a diamond carrier.
- Place first building within 3 seconds of match start.

### Bot Difficulty (Post-MVP)
- **Easy:** Slower build cadence, doesn't use upgrades, poor nuke timing.
- **Normal:** Standard behavior as described above.
- **Hard:** Optimized build order, reactive upgrades, good nuke timing, active lane management.

### Bot Takeover on Disconnect
Bot inherits all player state and can: build, upgrade, toggle lanes, spend resources, fire nuke.

---

## Audio

### Sound Design
- **Engine:** Programmatic/synthesized SFX (no large audio assets).
- **Unit select:** Each unit type has a short soundbite when tapped (4 races x 4 unit types = 16 sounds).
- **Combat sounds:** Hit impact (melee thud, ranged ping, caster whoosh), death sound per unit size category (small pop, medium crumble, large crash).
- **Building placement:** Satisfying "lock-in" click.
- **Nuke:** Warning siren during telegraph, explosion on detonation.
- **Diamond events:** Pickup chime, drop thud, delivery fanfare.
- **Music:** Minimal ambient loop, escalates in intensity when HQ HP drops below 50%.

---

## Technical and Implementation Notes

### Networking
- Firebase for queue management and matchmaking.
- **Server-authoritative simulation** with clients rendering state.
- Clients send commands only:
  - Place building
  - Sell building
  - Toggle lane
  - Purchase upgrade
  - Build hut
  - Set hut assignment
  - Fire nuke
  - Ping/quick chat
- **Tick rate:** 20 ticks/second (50ms per tick).
- **Input latency budget:** Commands acknowledged within 100ms.

### Performance
- **Soft unit cap:** 400 units per team (800 total on field).
- If above cap, degrade simulation fidelity for distant units:
  - Far-away units tick at half rate.
  - Visual LOD reduces animation frequency and particle count.
- Spawn throttling allowed only if needed to prevent frame collapse; must be logged.
- **Target devices:** iPhone SE (2020) and equivalent Android as minimum spec.
- **Memory budget:** < 100 MB.

### Tech Stack (Recommended)
- **Frontend:** HTML5 Canvas or WebGL for rendering.
- **Game loop:** requestAnimationFrame for rendering, fixed-timestep for simulation.
- **Networking:** Firebase Realtime Database or Firestore for state sync.
- **Server logic:** Cloud Functions or a lightweight Node.js server for authoritative simulation.

---

## Telemetry, Post-Match Stats, and Awards

### Timeline Graphs
- Gold income over time
- Wood and stone income over time
- Unit count over time (per player)
- Lane pressure over time (battle line position per lane)

### End Screen Stats
- Total resources earned by type
- Total units spawned by type
- Total damage dealt (by unit type and towers)
- Nukes used and nuke kills
- Diamond interactions: time held, pickups, drops, deliveries

### Awards (Lightweight)
- **MVP Damage** - Most total damage dealt
- **Best Economy** - Most total resources earned
- **Best Defender** - Most damage dealt near HQ (within 20 tiles)
- **Diamond Hero** - Most time carrying diamond or successful delivery

---

## Onboarding (MVP)

### Tutorial Flow
1. **Build Basics** (forced): Place a melee spawner, watch units spawn and march.
2. **Economy Intro** (forced): Build a harvester hut, assign to base gold.
3. **Lane Control** (prompted): Toggle a building's lane, observe units routing.
4. **Upgrades** (prompted): Purchase first upgrade on a building.
5. **Nuke** (prompted): Fire nuke at a practice target cluster.
6. **Diamond** (skippable): Assign a harvester to the diamond, watch extraction.

Each step is a self-contained mini-scenario (~30 seconds each). Total tutorial: ~3 minutes.

### Tooltips
- First-time contextual tooltips on every UI element, dismissible, do not repeat.

---

## Monetization (Post-MVP, Design Space)

*Not in MVP scope, but the GDD should acknowledge the design space to avoid closing off options.*

- **Cosmetic ASCII skins:** Alternate character sprites for units (no gameplay effect).
- **Battle pass:** Seasonal cosmetic rewards.
- **No pay-to-win:** No purchasable stat boosts, no purchasable resources.
- The escalating harvester hut cost curve and single-nuke-per-match design intentionally avoid "spend more = win more" patterns.

---

## MVP Scope Checklist

### In Scope
- [x] Real-time 2v2 with bots as fill and disconnect replacement
- [x] Vertical scrolling, pan and zoom
- [x] Fixed base grid (7x7) building placement
- [x] 4 races with melee, ranged, caster, and tower units
- [x] Spawners with 10-second cadence
- [x] Per-building lane toggle at fork
- [x] Passive income + harvester huts for wood, stone, base gold, center gold, diamond
- [x] One unique diamond win condition
- [x] One nuke per player, enemy only, circular AoE
- [x] Branching per-building upgrade trees (2 tiers)
- [x] Ping and quick-chat communication
- [x] Tutorial / onboarding flow
- [x] Post-match stats and simple awards
- [x] Bot teammates and opponents

### Out of Scope for MVP
- [ ] Flying and special units
- [ ] Element combo crafting beyond resist/weakness
- [ ] Multiple maps
- [ ] Ranked ladder / matchmaking rating
- [ ] Complex cosmetics / monetization
- [ ] Spectator mode
- [ ] Replays
- [ ] Social features (friends list, clans)

---

## Implementation Backlog

Track feature work here so scope changes are explicit and implementation can proceed incrementally.

### Done
- [x] Enforce building sell cooldown (5 seconds after placement) before a sell command succeeds.
- [x] Add cooldown-denied sell feedback text with countdown near the building.
- [x] Implement `purchase_upgrade` command handling in simulation and connect initial UI trigger.
- [x] Add basic ping command visualization (`ping` command + map marker fadeout).
- [x] Add quick-chat callout stub (`quick_chat` command + short-lived rendered text).
- [x] Add explicit on-screen upgrade branch buttons for hovered buildings.
- [x] Show upgrade branch availability/affordability in tooltip and tray UI.
- [x] Add minimal radial quick-chat UI (tap/hold + 4 options) in addition to hotkeys.
- [x] Persist selected-building upgrade panel so upgrades no longer depend on hover.
- [x] Add click-safe spawner lane toggling (double-click to toggle, single-click selects).
- [x] Add quick-chat cooldown guard with visible cooldown indicator.
- [x] Add minimap ping/quick-chat badges for team communication awareness while zoomed out.
- [x] Add quick-chat category icon/color styling in callout feed.
- [x] Add touch long-press quick-chat radial (no keyboard dependency).
- [x] Add lane-toggle mode setting (single vs double click) with in-game toggle.
- [x] Add settings drawer UI and persist lane-toggle mode preference between sessions.
- [x] Add haptic/audio quick-chat feedback for send and cooldown rejection.
- [x] Add optional mute toggle for UI feedback beeps/haptics in settings drawer.
- [x] Add dedicated touch-first quick-chat button (in addition to long-press gesture).
- [x] Add radial quick-chat edge clamping so options stay visible near screen borders.
- [x] Add visual touch affordance ring while long-press is arming radial quick-chat.
- [x] Add settings-based tuning for quick-chat long-press delay and radial size.
- [x] Add subtle non-blocking toast when quick-chat is blocked by cooldown.
- [x] Add reset-to-defaults action in settings drawer.
- [x] Add first-time mobile hint chip for hold-to-chat gesture.
- [x] Add explicit close button for settings drawer panel.
- [x] Add quick-chat radial accessibility mode (larger labels + higher contrast).
- [x] Add tap-outside-to-close behavior for settings drawer.
- [x] Add tooltip/help copy directly in settings for each row (lane mode, hold delay, radial size, a11y).
- [x] Prevent long-press quick-chat arming while multi-touch pinch zoom is active.
- [x] Add lane-toggle confirmation toast in Safe mode to clarify first-tap select vs toggle.
- [x] Add one-tap quick-chat fallback button while radial is on cooldown (defaults to Defend).
- [x] Add small lane-mode legend beside settings button (`Fast`/`Safe`) on compact screens.
- [x] Add queued fallback cancellation on second tap of `DEFEND` button before send.
- [x] Add mini inline tooltip over `DEFEND` button explaining queued-send behavior.

### Next Up
- [ ] Add small queued-chat countdown indicator (`queued in 0.8s`) beside `DEFEND`.
- [ ] Add settings toggle to enable/disable queued fallback behavior.

## Balance Philosophy

- **Rock-paper-scissors at race level:** No race hard-counters another, but each has soft advantages (e.g., Tide's slows are strong against Surge's speed reliance; Ember's burst beats Bastion's shields if focused).
- **Upgrade choices create counter-play:** Branching upgrades let players adapt mid-match to what the enemy is building.
- **Economy vs. military tension:** Every harvester hut is a grid slot NOT spent on a spawner. Over-investing in economy means weaker army early; under-investing means falling behind on upgrades.
- **The diamond is a comeback mechanic:** A losing team can sneak a diamond win. A winning team must stay vigilant.
- **Nukes prevent deathball:** One well-timed nuke punishes clumped-up armies, encouraging spread-out play and lane splitting.

---

## Glossary

| Term | Definition |
|------|-----------|
| HQ | Headquarters building; shared HP pool for the team |
| Lane | One of two paths units follow around the center diamond |
| Fork | The point where units choose left or right lane |
| Harvester | Non-combat unit that gathers resources |
| Hut | Building that spawns a harvester |
| The Diamond | Unique map objective; returning it to HQ wins the match |
| Nuke | One-time-use AoE ability that kills all enemy units in radius |
| Tick | One simulation step (50ms at 20 ticks/sec) |
| Spawner | Building that auto-produces combat units |
| Tower | Stationary defensive building that attacks enemies |
