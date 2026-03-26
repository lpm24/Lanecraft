# Changelog

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
