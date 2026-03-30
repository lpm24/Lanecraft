```
================================================================================
  COST-BENEFIT ANALYSIS — All 9 Races
  Exchange rate: 2 gold = 1 wood = 1 meat
  Gold yield: 4/trip, Wood: 10/trip, Meat: 10/trip
  Spawn interval: 16.8s base
================================================================================

## BUILDING EFFECTIVE COSTS

Race      |  Melee |  Ranged |  Caster |  Tower |   Hut
----------+--------+---------+---------+--------+------
Crown     |   30.0 |    19.0 |    30.0 |   43.0 |  21.0
Horde     |   35.0 |    40.0 |    37.5 |   55.0 |  23.0
Goblins   |   15.0 |    27.5 |    35.0 |   30.0 |  17.5
Oozlings  |   25.0 |    37.0 |    45.0 |   48.5 |  23.0
Demon     |   40.0 |    38.0 |    60.0 |   50.0 |  23.0
Deep      |   47.5 |    52.0 |    60.0 |   52.0 |  26.0
Wild      |   42.0 |    46.0 |    45.0 |   46.0 |  22.0
Geists    |   55.0 |    42.5 |    52.5 |   52.5 |  26.0
Tenders   |   48.0 |    30.0 |    58.0 |   45.5 |  26.5

## UPGRADE EFFECTIVE COSTS (per node)

Race      |  Tier 1 |  Tier 2
----------+---------+--------
Crown     |    22.5 |    64.0
Horde     |    50.0 |   100.0
Goblins   |    37.5 |    75.0
Oozlings  |    33.0 |    67.5
Demon     |    50.0 |   100.0
Deep      |    45.0 |    90.0
Wild      |    40.0 |    80.0
Geists    |    30.0 |    50.0
Tenders   |    45.0 |    90.0

## MELEE UNIT POWER — ALL UPGRADE PATHS

  Crown — Swordsman (building: 30.0 eff)
Path       |             Name |  Power |  Total $ |   Eff |  Interval |                   Specials
-----------+------------------+--------+----------+-------+-----------+---------------------------
T0 (base)  |        Swordsman |   1418 |     30.0 |  2.81 |      16.8 |                          -
B          |        Buccaneer |   1711 |     55.0 |  2.10 |      14.8 |                gold/kill 3
C          |            Noble |   1668 |     57.5 |  1.96 |      14.8 |                          -
B→D        |  Corsair Captain |   2417 |     92.5 |  2.16 |      12.1 |  gold/kill 3, gold/death 5
B→E        |      Pirate King |   2356 |    120.0 |  1.62 |      12.1 |  gold/kill 6, gold/death 8
C→F        |             King |   2741 |    112.5 |  2.01 |      12.1 |                  dodge 30%
C→G        |         Champion |   3128 |    122.5 |  2.11 |      12.1 |                          -

  Horde — Brute (building: 35.0 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                Specials
-----------+----------------+--------+----------+-------+-----------+------------------------
T0 (base)  |          Brute |   1909 |     35.0 |  3.25 |      16.8 |                       -
B          |     Iron Brute |   3436 |     80.0 |  2.91 |      14.8 |                       -
C          |   Raging Brute |   2920 |     57.5 |  3.43 |      14.8 |                       -
B→D        |       Warchief |   6905 |    170.0 |  3.35 |      12.1 |  DR 15%, auraArmor +10%
B→E        |      Berserker |   5350 |    170.0 |  2.60 |      12.1 |         auraAtkSpd +10%
C→F        |     Bloodrager |   5057 |    102.5 |  4.07 |      12.1 |     haste, auraSpd +10%
C→G        |  Skull Crusher |   5872 |    102.5 |  4.73 |      12.1 |              auraDmg +4

  Goblins — Sticker (building: 15.0 eff)
Path       |            Name |  Power |  Total $ |   Eff |  Interval |   Specials
-----------+-----------------+--------+----------+-------+-----------+-----------
T0 (base)  |         Sticker |    610 |     15.0 |  2.42 |      16.8 |          -
B          |     Troll Brute |    912 |     45.0 |  1.51 |      13.4 |          -
C          |   Quick Sticker |    718 |     47.5 |  1.12 |      13.4 |          -
B→D        |   Troll Smasher |   2243 |    100.0 |  2.38 |       9.4 |    burn +2
B→E        |   Troll Warlord |   1481 |    110.0 |  1.00 |      13.4 |    slow +2
C→F        |  Shadow Sticker |   1025 |    102.5 |  1.06 |       9.4 |  dodge 30%
C→G        |      Goblin Ace |   1530 |    117.5 |  0.97 |      13.4 |  dodge 15%

  Oozlings — Globule ×2 (building: 25.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |                 Specials
-----------+---------------+--------+----------+-------+-----------+-------------------------
T0 (base)  |       Globule |    511 |     25.0 |  1.22 |      16.8 |                        -
B          |    Tough Glob |    828 |     55.0 |  1.12 |      13.4 |                        -
C          |      Baneling |    707 |     55.0 |  0.96 |      13.4 |           explode 35×2.8
B→D        |  Armored Glob |   1510 |    112.5 |  1.43 |       9.4 |                   DR 15%
B→E        |     Acid Glob |   2815 |    117.5 |  1.78 |      13.4 |                  burn +2
C→F        |      Volatile |    919 |    115.0 |  0.85 |       9.4 |           explode 60×3.4
C→G        |     Detonator |   2911 |    127.5 |  2.43 |       9.4 |  burn +3, explode 70×4.0

  Demon — Smasher (building: 40.0 eff)
Path       |                 Name |  Power |  Total $ |   Eff |  Interval |    Specials
-----------+----------------------+--------+----------+-------+-----------+------------
T0 (base)  |              Smasher |   1080 |     40.0 |  1.61 |      16.8 |           -
B          |      Inferno Smasher |   1895 |     90.0 |  1.42 |      14.8 |           -
C          |        Blaze Smasher |   1271 |     85.0 |  1.01 |      14.8 |           -
B→D        |         Doom Smasher |   4247 |    185.0 |  1.89 |      12.1 |     burn +2
B→E        |  Bloodfire Berserker |   2843 |    170.0 |  1.38 |      12.1 |   killScale
C→F        |        Phoenix Blade |   2440 |    170.0 |  1.18 |      12.1 |  revive 60%
C→G        |        Magma Smasher |   3875 |    170.0 |  1.88 |      12.1 |     burn +3

  Deep — Shell Guard (building: 47.5 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                 Specials
-----------+----------------+--------+----------+-------+-----------+-------------------------
T0 (base)  |    Shell Guard |   1267 |     47.5 |  1.59 |      16.8 |                        -
B          |     Bull Whale |   2375 |     87.5 |  1.80 |      15.1 |                        -
C          |     Frog Scout |   1469 |     77.5 |  1.25 |      15.1 |                  slow +2
B→D        |  Armored Whale |   5047 |    155.0 |  2.53 |      12.9 |                   DR 20%
B→E        |      Leviathan |   3444 |    152.5 |  1.76 |      12.9 |                        -
C→F        |       Leapfrog |   2168 |    127.5 |  1.32 |      12.9 |             slow +3, hop
C→G        |     Frog Titan |   2855 |    137.5 |  1.62 |      12.9 |  regen 3/s, slow +2, hop

  Wild — Lurker (building: 42.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |   Specials
-----------+---------------+--------+----------+-------+-----------+-----------
T0 (base)  |        Lurker |    810 |     42.0 |  1.15 |      16.8 |          -
B          |     Cave Bear |   1417 |     82.0 |  1.17 |      14.8 |          -
C          |  Spider Brood |   1115 |     82.0 |  0.92 |      14.8 |          -
B→D        |      Minotaur |   4922 |    162.0 |  2.51 |      12.1 |  cleave +1
B→E        |     Dire Bear |   3947 |    162.0 |  2.01 |      12.1 |     DR 20%
C→F        |    Viper Nest |    546 |    152.0 |  0.30 |      12.1 |    slow +2
C→G        |  Spider Swarm |    876 |    162.0 |  0.45 |      12.1 |    slow +2

  Geists — Bone Knight (building: 55.0 eff)
Path       |            Name |  Power |  Total $ |   Eff |  Interval |                Specials
-----------+-----------------+--------+----------+-------+-----------+------------------------
T0 (base)  |     Bone Knight |    567 |     55.0 |  0.61 |      16.8 |                       -
B          |      Iron Bones |    993 |     85.0 |  0.77 |      15.1 |                       -
C          |    Ambush Chest |    756 |     82.5 |  0.61 |      15.1 |               dodge 25%
B→D        |    Death Knight |   2680 |    140.0 |  1.49 |      12.9 |                 burn +2
B→E        |      Soul Eater |   2321 |    140.0 |  1.29 |      12.9 |               regen 3/s
C→F        |  Snapping Mimic |   1091 |    137.5 |  0.62 |      12.9 |               dodge 35%
C→G        |     Soul Gorger |   1994 |    137.5 |  1.13 |      12.9 |  dodge 25%, soulHarvest

  Tenders — Treant (building: 48.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |            Specials
-----------+---------------+--------+----------+-------+-----------+--------------------
T0 (base)  |        Treant |   1133 |     48.0 |  1.41 |      16.8 |                   -
B          |     Young Ent |   1836 |     93.0 |  1.31 |      15.1 |                   -
C          |   Wild Radish |   1467 |     93.0 |  1.04 |      15.1 |           regen 2/s
B→D        |     Elder Ent |   3348 |    183.0 |  1.42 |      12.9 |           regen 2/s
B→E        |   Ancient Ent |   2754 |    183.0 |  1.17 |      12.9 |                   -
C→F        |  Radish Brute |   2240 |    183.0 |  0.95 |      12.9 |           regen 3/s
C→G        |   Radish King |   2382 |    183.0 |  1.01 |      12.9 |  regen 2/s, slow +2


## RANGED UNIT POWER — ALL UPGRADE PATHS

  Crown — Bowman (building: 19.0 eff)
Path       |               Name |  Power |  Total $ |   Eff |  Interval |                        Specials
-----------+--------------------+--------+----------+-------+-----------+--------------------------------
T0 (base)  |             Bowman |    380 |     19.0 |  1.19 |      16.8 |                               -
B          |          Heavy Bow |    618 |     49.0 |  0.85 |      14.8 |                               -
C          |    Dwarfette Scout |    475 |     41.5 |  0.77 |      14.8 |                               -
B→D        |            Longbow |    934 |    109.0 |  0.71 |      12.1 |                         slow +1
B→E        |            War Bow |   1501 |    106.5 |  1.16 |      12.1 |                       splash r2
C→F        |  Dwarfette Blitzer |    679 |     99.0 |  0.57 |      12.1 |                               -
C→G        |             Cannon |    239 |    111.5 |  0.18 |      12.1 |  siege ×4vsBldg, siegeSplash r3

  Horde — Bowcleaver (building: 40.0 eff)
Path       |            Name |  Power |  Total $ |   Eff |  Interval |                                                      Specials
-----------+-----------------+--------+----------+-------+-----------+--------------------------------------------------------------
T0 (base)  |      Bowcleaver |   1052 |     40.0 |  1.57 |      16.8 |                                                             -
B          |   Heavy Cleaver |   1789 |     85.0 |  1.42 |      14.8 |                                                  multi ×2@70%
C          |    Orc Catapult |    828 |     85.0 |  0.66 |      14.8 |                  auraDmg +2, siege ×3vsBldg, siegeSplash r2.5
B→D        |     War Thrower |   2334 |    175.0 |  1.10 |      12.1 |                                   multi ×3@60%, auraDodge +8%
B→E        |  Battle Cleaver |   2707 |    175.0 |  1.28 |      12.1 |                                      multi ×2@70%, auraDmg +3
C→F        |   Horde Bombard |    984 |    175.0 |  0.46 |      12.1 |  auraDmg +2, auraArmor +10%, siege ×4vsBldg, siegeSplash r3.5
C→G        |   Doom Catapult |   1317 |    175.0 |  0.62 |      12.1 |                    auraDmg +4, siege ×5vsBldg, siegeSplash r4

  Goblins — Knifer (building: 27.5 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                                 Specials
-----------+----------------+--------+----------+-------+-----------+-----------------------------------------
T0 (base)  |         Knifer |    290 |     27.5 |  0.63 |      16.8 |                                        -
B          |   Venom Knifer |    711 |     62.5 |  0.85 |      13.4 |                                  burn +2
C          |       War Boar |    363 |     60.0 |  0.45 |      13.4 |                                        -
B→D        |  Plague Knifer |   1011 |    127.5 |  0.84 |       9.4 |                                  burn +3
B→E        |     Fan Knifer |    964 |    122.5 |  0.59 |      13.4 |                    multi ×2@70%, burn +2
C→F        |      King Boar |    483 |    102.5 |  0.50 |       9.4 |                                dodge 25%
C→G        |  Goblin Mortar |    269 |    135.0 |  0.18 |      11.0 |  burn +1, siege ×4vsBldg, siegeSplash r3

  Oozlings — Spitter ×2 (building: 37.0 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                                 Specials
-----------+----------------+--------+----------+-------+-----------+-----------------------------------------
T0 (base)  |        Spitter |    349 |     37.0 |  0.56 |      16.8 |                                        -
B          |  Thick Spitter |    567 |     69.5 |  0.61 |      13.4 |                                        -
C          |  Rapid Spitter |    436 |     64.5 |  0.50 |      13.4 |                                        -
B→D        |   Acid Spitter |    888 |    127.0 |  0.74 |       9.4 |                                  slow +2
B→E        |  Burst Spitter |   1327 |    124.5 |  0.79 |      13.4 |                                splash r2
C→F        |  Hyper Spitter |    623 |    122.0 |  0.54 |       9.4 |                                        -
C→G        |     Glob Siege |   1258 |    134.5 |  0.85 |      11.0 |  slow +2, siege ×4vsBldg, siegeSplash r3

  Demon — Eye Sniper (building: 38.0 eff)
Path       |              Name |  Power |  Total $ |   Eff |  Interval |                                   Specials
-----------+-------------------+--------+----------+-------+-----------+-------------------------------------------
T0 (base)  |        Eye Sniper |    434 |     38.0 |  0.68 |      16.8 |                                          -
B          |      Flame Sniper |    586 |     88.0 |  0.45 |      14.8 |                                          -
C          |         Rapid Eye |    543 |     78.0 |  0.47 |      14.8 |                                          -
B→D        |        Meteor Eye |   1666 |    178.0 |  0.77 |      12.1 |                                  splash r2
B→E        |    Inferno Reaper |    879 |    163.0 |  0.45 |      12.1 |                                  killScale
C→F        |         Blitz Eye |    776 |    163.0 |  0.39 |      12.1 |                                          -
C→G        |  Brimstone Cannon |    415 |    178.0 |  0.19 |      12.1 |  burn +2, siege ×4vsBldg, siegeSplash r3.5

  Deep — Harpooner (building: 52.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |                                   Specials
-----------+---------------+--------+----------+-------+-----------+-------------------------------------------
T0 (base)  |     Harpooner |    719 |     52.0 |  0.82 |      16.8 |                                          -
B          |    Reef Shark |    914 |     87.0 |  0.69 |      15.1 |                                    slow +1
C          |    Spray Crab |   1043 |     87.0 |  0.79 |      15.1 |                                    slow +2
B→D        |    Hammerhead |   1617 |    142.0 |  0.89 |      12.9 |                                    slow +2
B→E        |   Great White |   1364 |    144.5 |  0.73 |      12.9 |                                    slow +3
C→F        |  Depth Charge |    563 |    164.5 |  0.27 |      12.9 |  slow +3, siege ×4vsBldg, siegeSplash r3.5
C→G        |     King Crab |   2928 |    152.0 |  1.50 |      12.9 |                         splash r3, slow +2

  Wild — Bonechucker (building: 46.0 eff)
Path       |            Name |  Power |  Total $ |   Eff |  Interval |                                   Specials
-----------+-----------------+--------+----------+-------+-----------+-------------------------------------------
T0 (base)  |     Bonechucker |    553 |     46.0 |  0.72 |      16.8 |                                          -
B          |       Chameleon |    934 |     86.0 |  0.73 |      14.8 |                                          -
C          |  Spitting Snake |    801 |     86.0 |  0.63 |      14.8 |                                    slow +2
B→D        |         Stalker |   2354 |    161.0 |  1.21 |      12.1 |                                  splash r2
B→E        |  Catapult Beast |    741 |    171.0 |  0.36 |      12.1 |  burn +1, siege ×3.5vsBldg, siegeSplash r3
C→F        |   Venom Serpent |   2433 |    156.0 |  1.29 |      12.1 |                    burn +2 SEARED, slow +2
C→G        |      Hydra Spit |   2557 |    161.0 |  1.31 |      12.1 |                         splash r3, slow +2

  Geists — Wraith Bow (building: 42.5 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                                 Specials
-----------+----------------+--------+----------+-------+-----------+-----------------------------------------
T0 (base)  |     Wraith Bow |    250 |     42.5 |  0.35 |      16.8 |                                        -
B          |   Venom Wraith |    588 |     70.0 |  0.56 |      15.1 |                                  burn +2
C          |     Bone Skull |    313 |     72.5 |  0.29 |      15.1 |                                        -
B→D        |   Plague Arrow |    864 |    125.0 |  0.54 |      12.9 |                                  burn +3
B→E        |     Hex Volley |    841 |    125.0 |  0.52 |      12.9 |                    multi ×2@75%, burn +2
C→F        |  Wailing Skull |    500 |    127.5 |  0.31 |      12.9 |                                dodge 25%
C→G        |  Bone Ballista |    197 |    127.5 |  0.12 |      12.9 |  burn +1, siege ×4vsBldg, siegeSplash r3

  Tenders — Tinker (building: 30.0 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |                                 Specials
-----------+----------------+--------+----------+-------+-----------+-----------------------------------------
T0 (base)  |         Tinker |    390 |     30.0 |  0.77 |      16.8 |                                        -
B          |   Heavy Tinker |    684 |     52.5 |  0.86 |      15.1 |                                        -
C          |  Thorn Thrower |    565 |     75.0 |  0.50 |      15.1 |                                  slow +2
B→D        |  Blight Tinker |   1725 |     97.5 |  1.38 |      12.9 |                                splash r2
B→E        |   Grand Tinker |   2064 |     97.5 |  1.65 |      12.9 |                                splash r3
C→F        |   Toxic Hurler |   1546 |    165.0 |  0.73 |      12.9 |                  burn +2 SEARED, slow +2
C→G        |     Vine Siege |    303 |    165.0 |  0.14 |      12.9 |  slow +2, siege ×3vsBldg, siegeSplash r3


## CASTER UNIT POWER — ALL UPGRADE PATHS

  Crown — Priest (building: 30.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |               Specials
-----------+---------------+--------+----------+-------+-----------+-----------------------
T0 (base)  |        Priest |    260 |     30.0 |  0.52 |      16.8 |                      -
B          |   High Priest |    418 |     57.5 |  0.49 |      14.8 |         shield +2t/+0a
C          |      War Mage |    710 |     60.0 |  0.80 |      14.8 |           aoe +1, mage
B→D        |   Arch Bishop |    779 |    110.0 |  0.58 |      12.1 |         shield +3t/+0a
B→E        |    War Cleric |    645 |    117.5 |  0.45 |      12.1 |        shield +2t/+25a
C→F        |  Battle Magus |   1598 |    120.0 |  1.10 |      12.1 |  burn +1, aoe +2, mage
C→G        |      Archmage |   2551 |    135.0 |  1.56 |      12.1 |  burn +2, aoe +3, mage

  Horde — War Chanter (building: 37.5 eff)
Path       |            Name |  Power |  Total $ |   Eff |  Interval |                                     Specials
-----------+-----------------+--------+----------+-------+-----------+---------------------------------------------
T0 (base)  |     War Chanter |    480 |     37.5 |  0.76 |      16.8 |                                            -
B          |  Battle Chanter |    637 |     60.0 |  0.72 |      14.8 |                        heal +5, chainHeal ×3
C          |     War Drummer |    750 |     82.5 |  0.61 |      14.8 |                                            -
B→D        |   Blood Chanter |    943 |    105.0 |  0.74 |      12.1 |          heal +8, chainHeal ×5, auraHeal 2/s
B→E        |     Rage Shaman |   1491 |    105.0 |  1.17 |      12.1 |  aoe +2, heal +5, chainHeal ×3, auraSpd +15%
C→F        |   Swift Chanter |   1536 |    172.5 |  0.73 |      12.1 |                      heal +5, auraArmor +10%
C→G        |    Doom Chanter |   1274 |    172.5 |  0.61 |      12.1 |                              auraAtkSpd +15%

  Goblins — Hexer (building: 35.0 eff)
Path       |          Name |  Power |  Total $ |   Eff |  Interval |         Specials
-----------+---------------+--------+----------+-------+-----------+-----------------
T0 (base)  |         Hexer |    294 |     35.0 |  0.50 |      16.8 |                -
B          |    Hex Master |    546 |     70.0 |  0.58 |      13.4 |          slow +3
C          |  Curse Weaver |    422 |     67.5 |  0.47 |      13.4 |                -
B→D        |   Grand Hexer |    872 |    135.0 |  0.69 |       9.4 |          slow +4
B→E        |  Plague Hexer |   1311 |    132.5 |  0.74 |      13.4 |  slow +3, aoe +2
C→F        |   Rapid Hexer |    779 |    132.5 |  0.63 |       9.4 |                -
C→G        |    Doom Hexer |    718 |    142.5 |  0.37 |      13.4 |                -

  Oozlings — Bloater ×2 (building: 45.0 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |         Specials
-----------+----------------+--------+----------+-------+-----------+-----------------
T0 (base)  |        Bloater |    310 |     45.0 |  0.41 |      16.8 |                -
B          |    Big Bloater |    524 |     77.5 |  0.50 |      13.4 |           aoe +1
C          |  Quick Bloater |    775 |     80.0 |  0.72 |      13.4 |         chain +2
B→D        |   Mega Bloater |    733 |    137.5 |  0.57 |       9.4 |           aoe +1
B→E        |   Acid Bloater |    877 |    137.5 |  0.47 |      13.4 |  slow +3, aoe +1
C→F        |  Hyper Bloater |   1490 |    145.0 |  1.09 |       9.4 |         chain +3
C→G        |      Ooze Lord |   1163 |    147.5 |  0.59 |      13.4 |         chain +2

  Demon — Overlord (building: 60.0 eff)
Path       |             Name |  Power |  Total $ |   Eff |  Interval |   Specials
-----------+------------------+--------+----------+-------+-----------+-----------
T0 (base)  |         Overlord |    650 |     60.0 |  0.64 |      16.8 |          -
B          |    Hellfire Lord |   1138 |    110.0 |  0.70 |      14.8 |          -
C          |        Pyro Lord |    813 |    105.0 |  0.52 |      14.8 |          -
B→D        |  Apocalypse Lord |   2437 |    210.0 |  0.96 |      12.1 |    burn +3
B→E        |    Eruption Lord |   2144 |    200.0 |  0.88 |      12.1 |     aoe +1
C→F        |    Flame Conduit |   1625 |    185.0 |  0.72 |      12.1 |     aoe +1
C→G        |        Soul Pyre |   1219 |    170.0 |  0.59 |      12.1 |  killScale

  Deep — Tidecaller (building: 60.0 eff)
Path       |        Name |  Power |  Total $ |   Eff |  Interval |          Specials
-----------+-------------+--------+----------+-------+-----------+------------------
T0 (base)  |  Tidecaller |    418 |     60.0 |  0.41 |      16.8 |                 -
B          |    Sea Star |    546 |    100.0 |  0.36 |      15.1 |           heal +3
C          |   Snap Clam |    679 |     90.0 |  0.50 |      15.1 |            aoe +1
B→D        |  Crown Star |    878 |    162.5 |  0.42 |      12.9 |  slow +3, heal +3
B→E        |   Star Lord |    548 |    155.0 |  0.28 |      12.9 |           heal +6
C→F        |  Giant Clam |   1521 |    147.5 |  0.80 |      12.9 |            aoe +1
C→G        |   Pearl Maw |   1340 |    152.5 |  0.68 |      12.9 |            aoe +3

  Wild — Scaled Sage (building: 45.0 eff)
Path       |         Name |  Power |  Total $ |   Eff |  Interval |         Specials
-----------+--------------+--------+----------+-------+-----------+-----------------
T0 (base)  |  Scaled Sage |    307 |     45.0 |  0.41 |      16.8 |                -
B          |   Elder Sage |    403 |     85.0 |  0.32 |      14.8 |          heal +5
C          |   Swift Sage |    384 |     80.0 |  0.32 |      14.8 |                -
B→D        |  Primal Sage |    566 |    160.0 |  0.29 |      12.1 |          heal +8
B→E        |   Storm Sage |    931 |    165.0 |  0.47 |      12.1 |  aoe +2, heal +5
C→F        |   Feral Sage |    596 |    145.0 |  0.34 |      12.1 |          heal +6
C→G        |   Alpha Sage |    576 |    155.0 |  0.31 |      12.1 |                -

  Geists — Necromancer (building: 52.5 eff)
Path       |             Name |  Power |  Total $ |   Eff |  Interval |                 Specials
-----------+------------------+--------+----------+-------+-----------+-------------------------
T0 (base)  |      Necromancer |    169 |     52.5 |  0.19 |      16.8 |                        -
B          |      Plague Mage |    273 |     82.5 |  0.22 |      15.1 |           skelSummon 15%
C          |    Dark Sorcerer |    211 |     80.0 |  0.17 |      15.1 |                        -
B→D        |      Necromancer |    372 |    137.5 |  0.21 |      12.9 |           skelSummon 18%
B→E        |   Soul Harvester |    548 |    137.5 |  0.31 |      12.9 |  burn +2, skelSummon 15%
C→F        |  Shadow Sorcerer |    397 |    135.0 |  0.23 |      12.9 |           skelSummon 20%
C→G        |        Arch Lich |    435 |    135.0 |  0.25 |      12.9 |           skelSummon 30%

  Tenders — Grove Keeper (building: 58.0 eff)
Path       |           Name |  Power |  Total $ |   Eff |  Interval |          Specials
-----------+----------------+--------+----------+-------+-----------+------------------
T0 (base)  |   Grove Keeper |    318 |     58.0 |  0.33 |      16.8 |                 -
B          |      Deep Root |    519 |    103.0 |  0.33 |      15.1 |           heal +5
C          |   Spore Weaver |    493 |    103.0 |  0.32 |      15.1 |           slow +3
B→D        |    Fungal Hulk |    814 |    193.0 |  0.33 |      12.9 |  slow +2, heal +8
B→E        |   Bloom Shaper |   1241 |    193.0 |  0.50 |      12.9 |   aoe +2, heal +5
C→F        |  Mycelium Sage |    764 |    193.0 |  0.31 |      12.9 |  slow +3, heal +6
C→G        |    Fungal Lord |    814 |    193.0 |  0.33 |      12.9 |           slow +3


## RESEARCH COSTS (cumulative eff for ONE category atk+def)

Race      |  1a+1d |  2a+2d |  3a+3d |  Power ×1+1 |  Power ×3+2
----------+--------+--------+--------+-------------+------------
Crown     |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Horde     |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Goblins   |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Oozlings  |   60.0 |  144.0 |  262.0 |       1.33× |       2.19×
Demon     |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Deep      |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Wild      |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Geists    |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×
Tenders   |   80.0 |  200.0 |  380.0 |       1.33× |       2.19×

## LATE-GAME POWER (best T2 path + 3atk/2def research)

  Melee:
Race      |  Path |  Late Pwr |  Late Rate |  Res $ |  Total $ |  Late Eff
----------+-------+-----------+------------+--------+----------+----------
Horde     |   B→D |     15104 |     1245.9 |  290.0 |    460.0 |     2.709
Oozlings  |   C→G |      6368 |      676.9 |  203.0 |    330.5 |     2.048
Wild      |   B→D |     10766 |      888.1 |  290.0 |    452.0 |     1.965
Deep      |   B→D |     11040 |      859.0 |  290.0 |    445.0 |     1.930
Demon     |   B→D |      9291 |      766.4 |  290.0 |    475.0 |     1.613
Crown     |   C→G |      6843 |      564.5 |  290.0 |    412.5 |     1.368
Goblins   |   B→D |      4906 |      521.5 |  290.0 |    390.0 |     1.337
Tenders   |   B→D |      7324 |      569.9 |  290.0 |    473.0 |     1.205
Geists    |   B→D |      5863 |      456.2 |  290.0 |    430.0 |     1.061

  Ranged:
Race      |  Path |  Late Pwr |  Late Rate |  Res $ |  Total $ |  Late Eff
----------+-------+-----------+------------+--------+----------+----------
Deep      |   C→G |      6406 |      498.4 |  290.0 |    442.0 |     1.128
Horde     |   B→E |      5922 |      488.5 |  290.0 |    465.0 |     1.051
Wild      |   C→G |      5593 |      461.3 |  290.0 |    451.0 |     1.023
Tenders   |   B→E |      4516 |      351.4 |  290.0 |    387.5 |     0.907
Oozlings  |   C→G |      2751 |      249.6 |  203.0 |    337.5 |     0.740
Crown     |   B→E |      3282 |      270.8 |  290.0 |    396.5 |     0.683
Demon     |   B→D |      3645 |      300.7 |  290.0 |    468.0 |     0.642
Goblins   |   B→D |      2212 |      235.2 |  290.0 |    417.5 |     0.563
Geists    |   B→D |      1891 |      147.1 |  290.0 |    415.0 |     0.355

  Caster:
Race      |  Path |  Late Pwr |  Late Rate |  Res $ |  Total $ |  Late Eff
----------+-------+-----------+------------+--------+----------+----------
Crown     |   C→G |      5581 |      460.4 |  290.0 |    425.0 |     1.083
Oozlings  |   C→F |      3260 |      346.5 |  203.0 |    348.0 |     0.996
Demon     |   B→D |      5332 |      439.8 |  290.0 |    500.0 |     0.880
Horde     |   B→E |      3261 |      269.0 |  290.0 |    395.0 |     0.681
Deep      |   C→F |      3328 |      258.9 |  290.0 |    437.5 |     0.592
Goblins   |   B→E |      2867 |      213.3 |  290.0 |    422.5 |     0.505
Tenders   |   B→E |      2715 |      211.2 |  290.0 |    483.0 |     0.437
Wild      |   B→E |      2036 |      167.9 |  290.0 |    455.0 |     0.369
Geists    |   B→E |      1198 |       93.2 |  290.0 |    427.5 |     0.218


## TOWER VALUE

Race      |    HP |   DPS |  Power |  Cost |  Pwr/$ |  Range
----------+-------+-------+--------+-------+--------+-------
Goblins   |   660 |   9.1 |   6000 |  30.0 |  200.0 |      6
Horde     |  1100 |   9.3 |  10267 |  55.0 |  186.7 |      6
Tenders   |  1144 |   7.3 |   8320 |  45.5 |  182.9 |      5
Wild      |   880 |   9.1 |   8000 |  46.0 |  173.9 |      6
Deep      |  1232 |   7.3 |   8960 |  52.0 |  172.3 |      6
Demon     |   800 |  10.0 |   8000 |  50.0 |  160.0 |      7
Crown     |   968 |   6.7 |   6453 |  43.0 |  150.1 |      6
Geists    |   792 |   9.2 |   7311 |  52.5 |  139.3 |      7
Oozlings  |   748 |   8.9 |   6649 |  48.5 |  137.1 |      6

## HUT PAYBACK ANALYSIS (Duel Map, 2v2)

  Gold harvester:  0.571 gold/s  (0.286 eff/s, cycle 7.0s)
  Wood harvester:  0.262 wood/s  (0.262 eff/s, cycle 38.2s)
  Meat harvester:  0.262 meat/s  (0.262 eff/s, cycle 38.2s)

Race      |  Hut1 $ |  Pay1 |  Hut2 $ |  Pay2 |  Hut3 $ |  Pay3 |  Hut4 $ |  Pay4
----------+---------+-------+---------+-------+---------+-------+---------+------
Goblins   |    17.5 |   61s |    23.0 |   88s |    31.0 |  118s |    42.5 |  162s
Crown     |    21.0 |   74s |    28.0 |  107s |    38.0 |  145s |    51.5 |  197s
Wild      |    22.0 |   77s |    29.0 |  111s |    39.0 |  149s |    53.0 |  202s
Horde     |    23.0 |   81s |    30.5 |  116s |    41.0 |  157s |    55.5 |  212s
Oozlings  |    23.0 |   81s |    30.0 |  115s |    41.0 |  157s |    55.5 |  212s
Demon     |    23.0 |   81s |    30.0 |  115s |    41.0 |  157s |    55.0 |  210s
Deep      |    26.0 |   91s |    34.5 |  132s |    47.0 |  179s |    63.5 |  242s
Geists    |    26.0 |   91s |    34.0 |  130s |    47.0 |  179s |    63.5 |  242s
Tenders   |    26.5 |   93s |    35.0 |  134s |    48.0 |  183s |    64.5 |  246s

## SUMMARY RANKINGS

  Melee Best T2 Efficiency:
    1. Horde      2.709
    2. Oozlings   2.048
    3. Wild       1.965
    4. Deep       1.930
    5. Demon      1.613
    6. Crown      1.368
    7. Goblins    1.337
    8. Tenders    1.205
    9. Geists     1.061

  Cheapest Melee Opening:
    1. Goblins    15.0 eff
    2. Oozlings   25.0 eff
    3. Crown      30.0 eff
    4. Horde      35.0 eff
    5. Demon      40.0 eff
    6. Wild       42.0 eff
    7. Deep       47.5 eff
    8. Tenders    48.0 eff
    9. Geists     55.0 eff

  Research Cost (2atk+1def per category):
    1. Oozlings   102.0 eff
    2. Crown      140.0 eff
    3. Horde      140.0 eff
    4. Goblins    140.0 eff
    5. Demon      140.0 eff
    6. Deep       140.0 eff
    7. Wild       140.0 eff
    8. Geists     140.0 eff
    9. Tenders    140.0 eff

  Hut #1 Payback:
    1. Goblins    61s
    2. Crown      74s
    3. Wild       77s
    4. Horde      81s
    5. Oozlings   81s
    6. Demon      81s
    7. Deep       91s
    8. Geists     91s
    9. Tenders    93s

================================================================================
  Analysis complete. Re-run after balance changes to compare.
================================================================================
```
