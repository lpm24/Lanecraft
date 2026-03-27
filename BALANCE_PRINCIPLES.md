# Lanecraft — Auto-Balance Foundational Principles

This document defines the **immutable design principles** that any automated balancing system must respect. Stat tuning must never flatten race identity — the goal is parity of *power*, not sameness of *feel*.

---

## 1. Race Fantasy — Every Race Must Feel Different

Each race has a **core fantasy** that stat changes must preserve. If a number tweak would erode the fantasy, the tweak is wrong.

| Race | Fantasy | Feel | Non-Negotiables |
|------|---------|------|-----------------|
| **Crown** | Noble kingdom, disciplined armies | Steady, reliable, "easy to learn" | Shield caster, balanced stat spread, no extreme highs or lows |
| **Horde** | Savage warband, overwhelming force | Heavy, punchy, every hit *lands* | Knockback on every hit, highest raw ranged damage, durable buildings |
| **Goblins** | Sneaky tricksters, death by cuts | Frantic, swarmy, annoying to fight | Cheapest units in the game, fastest attack speed, poison/burn stacking |
| **Oozlings** | Alien ooze, adaptive swarm | Flooding, relentless, numbers game | spawnCount:2 mechanic, haste-on-hit, lowest individual unit power |
| **Demon** | Hellfire elites, glass cannon chaos | Explosive, scary, high risk/reward | No gold economy, highest single-target damage (Overlord), burn, longest range |
| **Deep** | Ancient ocean titans, immovable | Glacial, oppressive, unkillable frontline | Tankiest melee in game (Shell Guard), slow stacks, hop/splash attacks |
| **Wild** | Untamed beasts, nature's fury | Feral, varied creature roster, poisonous | Cleave attacks, creature diversity (Bear/Spider/Minotaur/Snake), poison |
| **Geists** | Undead legion, won't stay dead | Grinding, attrition, draining | Lifesteal exclusive, revive mechanic, dodge chance |
| **Tenders** | Forest guardians, living growth | Patient, sustaining, outlasts you | Highest regen, healing caster, most durable towers, Ent/Mushroom branches |

### Identity Locks (auto-balancer must NOT change these)
- Oozlings **always** spawn 2 units per building tick
- Demon and Wild **never** use gold
- Crown caster **always** grants shields
- Horde melee **always** knocks back
- Deep melee **always** has the highest base HP of any melee unit
- Goblins **always** have the cheapest building costs
- Geists **always** have lifesteal
- Tenders **always** have the highest tower HP

---

## 2. Thematic Stat Coherence — Numbers Must Tell the Story

Stats aren't just balance levers — they communicate *what a unit is*. A player should be able to guess a unit's role from its stats alone.

### Cost ↔ Power Mapping
- **Cheap units feel cheap**: Low HP, fast attack, expendable. Goblins and Oozlings should die fast but come fast.
- **Expensive units feel elite**: High HP or damage, slower to replace. Demon Overlord, Deep Shell Guard, Horde Brute.
- **Cost must match resource theme**: Meat races (Horde, Geists) pay meat for durability. Wood races (Tenders, Wild) pay wood for growth/nature.

### Stat ↔ Animation Mapping
Units should *look like they fight the way they fight*:

| If the animation shows... | Then stats should reflect... |
|---|---|
| Big, heavy creature (Turtle, Ent, Brute) | High HP, slow move speed, high damage per hit |
| Small, quick creature (Goblin, Slime, Spider) | Low HP, fast move/attack speed, low damage per hit |
| Magical casting (Monk heal, Necromancer, Panda) | Range 7+, slow attack speed (big wind-up), high damage or utility |
| Lunging/dashing (Mimic Dash, Dwarfette Dash) | Above-average move speed or burst mechanic |
| Projectile-heavy (Archer, Harpooner, Eye Sniper) | Consistent ranged DPS, medium HP |
| Massive creature (FrogBoss, Minotaur scale 1.5) | Significantly higher HP and damage than base tier, cleave/AoE |

### Animation Utilization Rules
- **Every upgrade-path creature with unique attack animations should have a mechanic that showcases it.** Don't give a lunging Mimic a generic melee stat block — give it burst or dash damage.
- **Scale correlates with power.** A unit rendered at scale 1.5 (Minotaur) must feel 1.5x as impactful — either through cleave, higher HP, or area damage.
- **Color variants signal branching, not power.** Horde Blue/Red orcs and Oozling Cyan/Purple slimes are alternate *paths*, not power tiers.

---

## 3. Balance Targets — What "Balanced" Means

### Win Rate Targets
- **Overall race win rate**: 40%–60% across all matchups (no race is generically weak/strong)
- **Individual matchup**: 30/70 is acceptable — strong counters are part of the game
- **Matchup character**: Every race should have clear **predators and prey**. A race that goes 50/50 against everything is boring. A race that crushes Goblins but gets crushed by Deep tells a story.
- **Rock-paper-scissors is healthy**: Asymmetric matchups create drafting strategy, team comp decisions, and "I know what beats that" moments
- **Mirror match**: Should feel fair and skill-dependent (not snowbally)

### Match Pacing Targets
- **Average match length**: 3–5 minutes (too short = one race snowballs; too long = stalemate)
- **First combat**: Should happen within 30–45 seconds
- **Nuke relevance**: Nukes should matter but not decide games alone

### Economy Balance
- **No-gold races (Demon, Wild)** should not be strictly better or worse than gold races — the tradeoff is *different*, not *harder*
- **Harvester hut escalation** (1.35x) should make "hut spam" a viable but not dominant strategy
- **Passive income** should sustain basic unit production; active harvesting provides the edge

---

## 4. Upgrade Tree Principles

### Power Curve
- **Tier 1 upgrades** should feel like a meaningful bump (~20-30% effective power increase)
- **Tier 2 upgrades** should feel transformative (~40-60% effective power increase, often with new mechanics)
- **Branch choice should be a real dilemma** — both paths viable, neither strictly dominant

### Art-Changing Nodes Must Justify Their Creature
When an upgrade swaps the sprite to an entirely new creature:
- The new creature's **stats must diverge** from the base unit (not just +10% HP)
- The new creature's **mechanic must match its animation** (Mimic lunges → burst damage; Frog hops → AoE landing; Minotaur swings → cleave)
- The creature should feel like a **payoff** for investing in that branch

### Branching Identity
- **B-branch vs C-branch**: Should offer genuinely different playstyles (e.g., Horde Blue Orcs = tankier path, Red Orcs = aggressive path)
- **Tier 2 inherits parent identity**: D/E follow B's theme, F/G follow C's theme
- **No dead branches**: Every terminal node (D, E, F, G) should be a valid endgame pick

---

## 5. Tuning Knobs — What the Auto-Balancer CAN Adjust

### Free to Tune (within thematic bounds)
- Unit HP, damage, attack speed, move speed (within ±25% of current values)
- Building costs (gold, wood, meat amounts)
- Building HP
- Tower damage and attack speed
- Status effect duration and magnitude (burn damage, slow %, shield amount)
- Upgrade tier stat multipliers
- Spawn timing / cooldowns

### Tune With Caution (requires thematic validation)
- Unit range (must stay within category norms: melee 1, ranged 6-8, caster 6-7)
- spawnCount values (Oozlings identity)
- Special mechanic numbers (cleave targets, hop radius, dodge %)

### Never Tune (locked by design)
- Which races use which resources (Crown=Gold+Wood, etc.)
- Which race has which status effects (lifesteal=Geists only, etc.)
- spawnCount existing on Oozlings (can tune the number, not remove the mechanic)
- Knockback existing on Horde (can tune force, not remove it)
- Shield existing on Crown caster (can tune amount, not remove it)

---

## 6. Auto-Balance Loop Design

```
┌─────────────────────────────────────────────────┐
│  1. RUN BALANCE SIM                             │
│     npm run balance 10 --full                   │
│     → Win rates, matchup grid, economy stats    │
├─────────────────────────────────────────────────┤
│  2. DIAGNOSE                                    │
│     • Which races are outside 44-56% overall?   │
│     • Which matchups are outside 35-65%?        │
│     • Are match lengths in 3-5 min range?       │
│     • Any race feeling same-y? (DPS too close)  │
├─────────────────────────────────────────────────┤
│  3. PROPOSE CHANGES                             │
│     • Identify root cause (not symptom)         │
│     • Check against Identity Locks above        │
│     • Check against Stat↔Animation coherence    │
│     • Prefer small nudges (5-10%) over big ones │
│     • Change max 2-3 values per iteration       │
├─────────────────────────────────────────────────┤
│  4. APPLY & RE-TEST                             │
│     • Edit data.ts with proposed changes        │
│     • Re-run balance sim                        │
│     • Compare before/after                      │
│     • If worse or identity-breaking, revert     │
├─────────────────────────────────────────────────┤
│  5. LOG & LEARN                                 │
│     • Record what was changed and why           │
│     • Track which knobs had most impact         │
│     • Build intuition for future iterations     │
└─────────────────────────────────────────────────┘
```

### Convergence Criteria
The balancer should stop when:
- All 9 races are within 40-60% overall win rate
- No matchup worse than 30/70 (hard floor/ceiling)
- Every race has at least 2 favorable and 2 unfavorable matchups
- All identity locks are preserved
- Match length averages are in the 3-5 minute range

### Guardrails
- **Max iterations per session**: 20 (prevent infinite loops)
- **Max stat change per iteration**: ±15% of any single value
- **Revert threshold**: If a change makes any race drop below 35% or above 65% *overall*, auto-revert
- **Don't sand down edges**: If a specific matchup is 70/30 but both races are healthy overall (40-60%), that's fine — it's a counter matchup, not a balance problem
- **Diversity check**: After tuning, verify that race stat profiles are still distinct (e.g., Deep melee HP > 2x Goblin melee HP)

---

## 7. Race Differentiation Metrics

To ensure races *feel* different, track these spread metrics:

| Metric | Healthy Range | Meaning |
|--------|--------------|---------|
| Melee HP spread | 3:1+ ratio (highest/lowest) | Deep (226) vs Oozling (45) = 5:1 ✓ |
| DPS spread | 2:1+ ratio | Demon Overlord vs Goblin Sticker |
| Move speed spread | 1.5:1+ ratio | Goblins (5.0) vs Deep (2.5) = 2:1 ✓ |
| Building cost spread | 2:1+ ratio | Goblins (35g) vs Crown (85g) = 2.4:1 ✓ |
| Tower HP spread | 1.8:1+ ratio | Tenders (300) vs Goblins (150) = 2:1 ✓ |

If tuning ever compresses these ratios below healthy range, the change should be rejected — races are becoming too similar.

---

## 8. Resource Exchange Rate & Effective Cost Model

All balance cost comparisons use the **effective cost** model derived from harvester economics on the Duel map (2v2):

### Exchange Rate: 2 gold = 1 wood = 1 meat

**Why this ratio:**
- Gold mine is 7.5 tiles from HQ → 7.0s cycle → 4 gold/trip → **0.571 gold/s** (0.286 eff/s)
- Wood/Meat nodes are ~54 tiles from HQ → 38.2s cycle → 10/trip → **0.262 resource/s** (0.262 eff/s)
- Gold income per worker in effective terms (0.286) ≈ wood/meat income (0.262), confirming the 2:1 ratio

**Effective cost formula:** `eff = gold/2 + wood + meat`

This means a building costing 80 gold (40 eff) requires roughly the same harvester-time investment as one costing 40 wood (40 eff).

### Research Cost Parity

Research costs are normalized so all races pay equal effective cost per level:
- **Gold races**: pay `80 × 1.5^level` in gold → 40 eff per base level
- **Non-gold races** (Demon, Wild): pay `40 × 1.5^level` split across wood/meat → 40 eff per base level
- **Oozlings**: pay `30 × 1.4^level` in deathEssence (own economy)

One-shot research follows the same principle: 150 gold = 75 wood/meat total for non-gold races.

### Cost Analysis Tool

Run `npm run cost-analysis` to generate a full report covering:
1. **Building effective costs** — all 9 races × 6 building types
2. **Upgrade effective costs** — tier 1 and tier 2 node costs
3. **Unit power & efficiency** — HP×DPS per spawn cycle, power rate, cost-efficiency ratio at T0/T1/T2
4. **Research costs** — cumulative effective cost and power multipliers
5. **Late-game power** — T2 units × research multipliers, total investment efficiency
6. **Tower value** — HP×DPS / effective cost
7. **Hut payback** — seconds to recoup investment per hut (escalating costs)
8. **Summary rankings** — sorted efficiency, rush cost, research cost, hut payback

**Key metrics:**
- **Power** = HP × DPS × spawnCount (combat value per spawn cycle)
- **Power Rate** = Power / spawn interval (combat output per second from a building)
- **Efficiency** = Power Rate / total effective cost (value per resource invested)
- **Hut Payback** = hut effective cost / harvester income rate (seconds to break even)

**When to re-run:** After any change to building costs, unit stats, upgrade multipliers, research costs, spawn intervals, or harvester economics.

The tool reads directly from `data.ts` constants, so output always reflects the current state of the code.
