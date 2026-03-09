import { BuildingType, Race, ResourceType } from '../simulation/types';

// ============================================================
// BUILDING SPRITES (Tiny Swords)
// ============================================================
// P0 = Blue, P1 = Purple (bottom team), P2 = Red, P3 = Yellow (top team)
import blueHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/House1.png?url';
import blueBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Barracks.png?url';
import blueArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Archery.png?url';
import blueMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Monastery.png?url';
import blueTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Tower.png?url';
import blueCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Castle.png?url';
import purpleHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/House1.png?url';
import purpleBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Barracks.png?url';
import purpleArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Archery.png?url';
import purpleMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Monastery.png?url';
import purpleTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Tower.png?url';
import purpleCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Castle.png?url';
import redHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/House1.png?url';
import redBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Barracks.png?url';
import redArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Archery.png?url';
import redMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Monastery.png?url';
import redTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Tower.png?url';
import redCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Castle.png?url';
import yellowHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/House1.png?url';
import yellowBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Barracks.png?url';
import yellowArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Archery.png?url';
import yellowMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Monastery.png?url';
import yellowTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Tower.png?url';
import yellowCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Castle.png?url';

// ============================================================
// UNIT SPRITES — Crown (Tiny Swords humans, Blue + Red)
// ============================================================
// P0=Blue, P1=Purple, P2=Red, P3=Yellow
import crownMeleeBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Warrior/Warrior_Run.png?url';
import crownRangedBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Archer/Archer_Run.png?url';
import crownCasterBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Monk/Run.png?url';
import harvesterBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Idle.png?url';
import harvesterBlueRun from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Run.png?url';
import harvesterBlueRunGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Run Gold.png?url';
import harvesterBlueRunWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Run Wood.png?url';
import harvesterBlueRunMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Run Meat.png?url';
import harvesterBlueMineGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Interact Pickaxe.png?url';
import harvesterBlueMineWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Interact Axe.png?url';
import harvesterBlueMineStone from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Interact Knife.png?url';
import crownMeleePurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Warrior/Warrior_Run.png?url';
import crownRangedPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Archer/Archer_Run.png?url';
import crownCasterPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Monk/Run.png?url';
import harvesterPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Idle.png?url';
import harvesterPurpleRun from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Run.png?url';
import harvesterPurpleRunGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Run Gold.png?url';
import harvesterPurpleRunWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Run Wood.png?url';
import harvesterPurpleRunMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Run Meat.png?url';
import harvesterPurpleMineGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Interact Pickaxe.png?url';
import harvesterPurpleMineWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Interact Axe.png?url';
import harvesterPurpleMineStone from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Interact Knife.png?url';
import crownMeleeRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Warrior/Warrior_Run.png?url';
import crownRangedRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Archer/Archer_Run.png?url';
import crownCasterRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Monk/Run.png?url';
import harvesterRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Idle.png?url';
import harvesterRedRun from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Run.png?url';
import harvesterRedRunGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Run Gold.png?url';
import harvesterRedRunWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Run Wood.png?url';
import harvesterRedRunMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Run Meat.png?url';
import harvesterRedMineGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Interact Pickaxe.png?url';
import harvesterRedMineWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Interact Axe.png?url';
import harvesterRedMineStone from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Interact Knife.png?url';
import crownMeleeYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Warrior/Warrior_Run.png?url';
import crownRangedYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Archer/Archer_Run.png?url';
import crownCasterYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Monk/Run.png?url';
import harvesterYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Idle.png?url';
import harvesterYellowRun from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Run.png?url';
import harvesterYellowRunGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Run Gold.png?url';
import harvesterYellowRunWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Run Wood.png?url';
import harvesterYellowRunMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Run Meat.png?url';
import harvesterYellowMineGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Interact Pickaxe.png?url';
import harvesterYellowMineWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Interact Axe.png?url';
import harvesterYellowMineStone from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Interact Knife.png?url';

// ============================================================
// UNIT SPRITES — Horde (CHARACTER MEGAPACK Orcs — animated strips)
// ============================================================
import hordeMelee from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_01 (Green Skinned)/Orc_Barbare_01_Move_5x1.png?url';
import hordeRanged from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_01 (Green Skinned)/Orc_Archer_01_Move_6x1.png?url';
import hordeCaster from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_01 (Green Skinned)/Goblin_Barrel_01_Move_10x1.png?url';

// ============================================================
// UNIT SPRITES — Goblins (Tiny Swords)
// ============================================================
import goblinsMelee from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Lancer/Lancer_Run.png?url';
import goblinsRanged from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Thief/Thief_Run.png?url';
import goblinsCaster from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Shaman/Shaman_Run.png?url';

// ============================================================
// UNIT SPRITES — Oozlings (Slimes — animated strips)
// ============================================================
import oozlingsMelee from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl01_Move_5x1.png?url';
import oozlingsRanged from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl04_Move_6x1.png?url';
import oozlingsCaster from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl06_Move_6x1.png?url';

// ============================================================
// UNIT SPRITES — Demon (CHARACTER MEGAPACK — animated strips)
// ============================================================
import demonMelee from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_01_Regular/Move_8x1.png?url';
import demonRanged from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Cyclop_Archer_01/Move_16x1.png?url';
import demonCaster from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/GameMaster/Idle_48x1.png?url';

// ============================================================
// UNIT SPRITES — Deep (Tiny Swords Enemy Pack)
// ============================================================
import deepMelee from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Turtle/Turtle_Walk.png?url';
import deepRanged from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Harpoon Fish/HarpoonFish_Run.png?url';
import deepCaster from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Paddle Fish/PaddleFish_Run.png?url';

// ============================================================
// UNIT SPRITES — Wild (Tiny Swords Enemy Pack)
// ============================================================
import wildMelee from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Spider/Spider_Run.png?url';
import wildRanged from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Gnoll/Gnoll_Walk.png?url';
import wildCaster from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Lizard/Lizard_Run.png?url';

// ============================================================
// UNIT SPRITES — Geists (Mixed TS Enemy Pack + CHARACTER MEGAPACK strips)
// ============================================================
import geistsMelee from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Skull/Skull_Run.png?url';
import geistsRanged from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Vampire_Archer_01/Move_20x1.png?url';
import geistsCaster from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL1/Move_24x1.png?url';

// ============================================================
// UNIT SPRITES — Tenders (Mixed)
// ============================================================
import tendersMelee from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL1/Idle_34x1.png?url';
import tendersRanged from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Gnome/Gnome_Run.png?url';
import tendersCaster from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Panda/Panda_Run.png?url';

// ============================================================
// ATTACK SPRITES
// ============================================================
// Crown (Tiny Swords Free Pack — per player color)
import crownMeleeAtkBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Warrior/Warrior_Attack1.png?url';
import crownMeleeAtkPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Warrior/Warrior_Attack1.png?url';
import crownMeleeAtkRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Warrior/Warrior_Attack1.png?url';
import crownMeleeAtkYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Warrior/Warrior_Attack1.png?url';
import crownRangedAtkBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Archer/Archer_Shoot.png?url';
import crownRangedAtkPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Archer/Archer_Shoot.png?url';
import crownRangedAtkRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Archer/Archer_Shoot.png?url';
import crownRangedAtkYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Archer/Archer_Shoot.png?url';
import crownCasterAtkBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Monk/Heal.png?url';
import crownCasterAtkPurple from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Monk/Heal.png?url';
import crownCasterAtkRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Monk/Heal.png?url';
import crownCasterAtkYellow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Monk/Heal.png?url';
// Horde (CHARACTER MEGAPACK)
import hordeMeleeAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_01 (Green Skinned)/Orc_Barbare_01_ATK_Full_12x1.png?url';
import hordeRangedAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_01 (Green Skinned)/Orc_Archer_01_ATK_Full_18x1.png?url';
import hordeCasterAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_01 (Green Skinned)/Goblin_Barrel_01_ATK_Full_10x1.png?url';
// Goblins (Enemy Pack)
import goblinsMeleeAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Lancer/Lancer_Attack.png?url';
import goblinsRangedAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Thief/Thief_Attack.png?url';
import goblinsCasterAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Shaman/Shaman_Attack.png?url';
// Demon (CHARACTER MEGAPACK)
import demonMeleeAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_01_Regular/Charge_Full_42x1.png?url';
import demonRangedAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Cyclop_Archer_01/ATK_Full_22x1.png?url';
import demonCasterAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/GameMaster/ATK_48x1.png?url';
// Deep (Enemy Pack)
import deepMeleeAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Turtle/Turtle_Attack.png?url';
import deepRangedAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Harpoon Fish/HarpoonFish_Throw.png?url';
import deepCasterAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Paddle Fish/PaddleFish_Attack.png?url';
// Wild (Enemy Pack)
import wildMeleeAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Spider/Spider_Attack.png?url';
import wildRangedAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Gnoll/Gnoll_Throw.png?url';
import wildCasterAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Lizard/Lizard_Attack.png?url';
// Geists
import geistsMeleeAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Skull/Skull_Attack.png?url';
import geistsRangedAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Vampire_Archer_01/ATK_Full_24x1.png?url';
// Tenders
import tendersMeleeAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL1/Special_Full_54x1.png?url';
import tendersRangedAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Gnome/Gnome_Attack.png?url';
import tendersCasterAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Panda/Panda_Attack.png?url';

// ============================================================
// UPGRADE PATH SPRITES
// ============================================================
// Mimic LVL1/2/4 (Geists melee C/F/G branch — off Skull)
import mimicL1Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL1/Move_14x1.png?url';
import mimicL1Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL1/Dash_Full_14x1.png?url';
import mimicL2Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL2/Move_24x1.png?url';
import mimicL2Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL2/Dash_Full_10x1.png?url';
import mimicL4Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL4/Move_16x1.png?url';
import mimicL4Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mimic_LVL4/Dash_Full_14x1.png?url';
// Dwarfette LVL1/2/4 (Crown ranged C/F/G branch)
import dwarfetteL1Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL1/Move_8x1.png?url';
import dwarfetteL1Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL1/Dash_Full_8x1.png?url';
import dwarfetteL2Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL2/Move_10x1.png?url';
import dwarfetteL2Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL2/Dash_Full_14x1.png?url';
import dwarfetteL4Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL4/Move_28x1.png?url';
import dwarfetteL4Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Dwarfette_LVL4/Dash_16x1.png?url';
// Minotaur (Wild melee C/F/G branch)
import minotaurWalk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Minotaur/Minotaur_Walk.png?url';
import minotaurAttack from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Minotaur/Minotaur_Attack.png?url';
// FrogMonster (Deep melee C branch)
import frogMonsterMove from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/FrogMonster/Jump_Full_22x1.png?url';
import frogMonsterAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/FrogMonster/Jump_14x1.png?url';
// FrogBoss (Deep melee F/G branch)
import frogBossMove from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/FrogBoss/Move_Full_22x1.png?url';
import frogBossAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/FrogBoss/Jump_ATK_22x1.png?url';
// Mushroom (Tenders caster C/F/G branch)
import mushroomMove from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mushroom/Move_20x1.png?url';
import mushroomAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Mushroom/Spell_Loop_14x1.png?url';
// Sorcerer LVL2/3/4 (Geists caster C/F/G branch)
import sorcererL2Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL2/Move_12x1.png?url';
import sorcererL2Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL2/Dash_Full_10x1.png?url';
import sorcererL3Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL3/Move_12x1.png?url';
import sorcererL3Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL3/Dash_Full_16x1.png?url';
import sorcererL4Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL4/Move_24x1.png?url';
import sorcererL4Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Sorcerer_LVL4/Dash_Full_10x1.png?url';
// Ent LVL2/3/4 (Tenders melee B/D/E branch)
import entL2Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL2/Move_12x1.png?url';
import entL2Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL2/Dash_Full_10x1.png?url';
import entL3Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL3/Move_18x1.png?url';
import entL3Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL3/Dash_Full_8x1.png?url';
import entL4Move from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL4/Move_24x1.png?url';
import entL4Atk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Ent_LVL4/Dash_Full_32x1.png?url';
// Horde color variants: Blue Skinned (02), Red Skinned (03)
import hordeMeleeBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_02 (Blue Skinned)/Orc_Barbare_02_Move_5x1.png?url';
import hordeMeleeAtkBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_02 (Blue Skinned)/Orc_Barbare_02_ATK_Full_12x1.png?url';
import hordeMeleeRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_03 (Red Skinned)/Orc_Barbare_03_Move_5x1.png?url';
import hordeMeleeAtkRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Barbare_03 (Red Skinned)/Orc_Barbare_03_ATK_Full_12x1.png?url';
import hordeRangedBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_02 (Blue Skinned)/Orc_Archer_02_Move_6x1.png?url';
import hordeRangedAtkBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_02 (Blue Skinned)/Orc_Archer_02_ATK_Full_18x1.png?url';
import hordeRangedRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_03 (Red Skinned)/Orc_Archer_03_Move_6x1.png?url';
import hordeRangedAtkRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Orc_Archer_03 (Red Skinned)/Orc_Archer_03_ATK_Full_18x1.png?url';
import hordeCasterBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_02 (Blue Skinned)/Goblin_Barrel_02_Move_10x1.png?url';
import hordeCasterAtkBlue from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_02 (Blue Skinned)/Goblin_Barrel_02_ATK_Full_10x1.png?url';
import hordeCasterRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_03 (Red Skinned)/Goblin_Barrel_03_Move_10x1.png?url';
import hordeCasterAtkRed from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/Goblin_Barrel_03 (Red Skinned)/Goblin_Barrel_03_ATK_Full_10x1.png?url';
// Oozlings color variants: Cyan (02), Purple (04), Red (07)
import oozMeleeCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl01_Move_5x1.png?url';
import oozRangedCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl04_Move_6x1.png?url';
import oozCasterCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl06_Move_6x1.png?url';
import oozMeleePurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl01_Move_5x1.png?url';
import oozRangedPurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl04_Move_6x1.png?url';
import oozCasterPurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl06_Move_6x1.png?url';

// ============================================================
// TERRAIN SPRITES (Tileset, Water, Decorations)
// ============================================================
import tilemapColor1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color1.png?url';
import waterBgColor from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Water Background color.png?url';
import waterFoam from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Water Foam.png?url';
import cloud1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_01.png?url';
import cloud2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_02.png?url';
import cloud3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_03.png?url';
import waterRock1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks in the Water/Water Rocks_01.png?url';
import waterRock2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks in the Water/Water Rocks_02.png?url';
import bush1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Bushes/Bushe1.png?url';
import bush2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Bushes/Bushe2.png?url';

// ============================================================
// RESOURCE SPRITES
// ============================================================
import goldResource from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Gold/Gold Resource/Gold_Resource.png?url';
import goldStone1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Gold/Gold Stones/Gold Stone 1.png?url';
import goldStone2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Gold/Gold Stones/Gold Stone 2.png?url';
import goldStone3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Gold/Gold Stones/Gold Stone 3.png?url';
import woodResource from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Wood/Wood Resource/Wood Resource.png?url';
import tree1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Wood/Trees/Tree1.png?url';
import tree2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Wood/Trees/Tree2.png?url';
import tree3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Wood/Trees/Tree3.png?url';
import sheepIdle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Meat/Sheep/Sheep_Idle.png?url';
import sheepGrass from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Meat/Sheep/Sheep_Grass.png?url';
import meatResource from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Resources/Meat/Meat Resource/Meat Resource.png?url';
import rock1 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks/Rock1.png?url';

// UI Icons
import uiIconGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_03.png?url';
import uiIconWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_02.png?url';
import uiIconMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Icon_04.png?url';

// ============================================================
// PROJECTILE SPRITES
// ============================================================
// Arrows (Crown ranged — per team color)
import arrowBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Archer/Arrow.png?url';
import arrowRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Archer/Arrow.png?url';
// Orbs — small 32px (6x5 grid, 288x240, 48x48/frame) for Goblins & Oozlings
import orbYellowSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_Orb32px_Short_Full_6x5.png?url';
import orbBlueSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_Orb32px_Short_Full_6x5.png?url';
import orbGreenSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_Orb32px_Short_Full_6x5.png?url';
import orbPurpleSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/03 Purple FX/FX_Fire03_Orb32px_Short_Full_6x5.png?url';
// Orbs — large 48px (6x5 grid, 432x360, 72x72/frame) for most races
import orbYellowLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_Orb48px_Short_Full_6x5.png?url';
import orbBlueLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_Orb48px_Short_Full_6x5.png?url';
import orbGreenLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_Orb48px_Short_Full_6x5.png?url';
import orbPurpleLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/03 Purple FX/FX_Fire03_Orb48px_Short_Full_6x5.png?url';
// Circles — small 32px (8x6 grid, 384x288, 48x48/frame) for smaller caster projectiles
import circleYellowSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_Circle32px_8x6.png?url';
import circleBlueSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_Circle32px_8x6.png?url';
import circleGreenSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_Circle32px_8x6.png?url';
import circlePurpleSm from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/03 Purple FX/FX_Fire03_Circle32px_8x6.png?url';
// Circles — large 64px (8x6 grid, 768x576, 96x96/frame) for dramatic caster AoE
import circleYellowLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_Circle64px_8x6.png?url';
import circleBlueLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_Circle64px_8x6.png?url';
import circleGreenLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_Circle64px_8x6.png?url';
import circlePurpleLg from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/03 Purple FX/FX_Fire03_Circle64px_8x6.png?url';

// ============================================================
// VFX SPRITES (OVERBURN + Tiny Swords Particle FX)
// ============================================================
// Status effect overlays
import fxBurnFlame from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_FlameCartoon_S01_7x1.png?url';
import fxSlowOrb from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_FlameCartoon_S01_7x1.png?url';
import fxHasteFlame from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_FlameCartoon_S01_7x1.png?url';
import fxShieldOrb from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/01 Blue FX/FX_Fire01_Circle32px_8x6.png?url';
import fxPoisonFlame from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/02 Green FX/FX_Fire02_FlameCartoon_S02_7x1.png?url';
import fxLifestealFlame from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/03 Purple FX/FX_Fire03_FlameCartoon_S01_7x1.png?url';
// Building damage fire
import fxBuildingFire from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_Flame_Regular_6x4.png?url';
// Explosions
import fxExplosion from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Particle FX/Explosion_01.png?url';
import fxDust from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Particle FX/Dust_01.png?url';
// Nuke shockwave
import fxNukeShockwave from '../assets/images/OVERBURN AssetPack/OVERBURN AssetPack/00 Yellow-Orange FX/FX_Fire00_ShockWave_6x4.png?url';

// ============================================================
// SPRITE DEFINITIONS
// ============================================================

/** Describes how to extract a frame from a spritesheet or single image */
export interface SpriteDef {
  url: string;
  frameW: number;   // width of one frame in pixels
  frameH: number;   // height of one frame in pixels
  cols: number;     // number of columns (frames) in the sheet
  groundY?: number;  // where the feet/ground contact is as fraction of frame height (0=top, 1=bottom)
  scale?: number;    // optional display scale multiplier (default 1.0)
  heightScale?: number; // squash/stretch height independently of width (default 1.0)
}

// Tiny Swords spritesheets: divide total width by frame height to get frame count
// Most TS units are 192px tall frames, Enemy pack also 192, some 256 or 320
function tsSheet(url: string, totalW: number, totalH: number, groundY = 0.71): SpriteDef {
  // For TS, frames are square-ish: frameW = totalH (frame width equals frame height)
  const frameW = totalH;
  const cols = Math.round(totalW / frameW);
  return { url, frameW, frameH: totalH, cols, groundY };
}

// Single-frame sprites (CHARACTER MEGAPACK individual files, slimes)
function singleFrame(url: string, w: number, h: number, groundY = 0.95): SpriteDef {
  return { url, frameW: w, frameH: h, cols: 1, groundY };
}

// CHARACTER MEGAPACK horizontal strip: name contains NxM (e.g. Idle_34x1.png = 34 cols, 1 row)
function cmStrip(url: string, totalW: number, totalH: number, cols: number, groundY = 0.95): SpriteDef {
  return { url, frameW: Math.round(totalW / cols), frameH: totalH, cols, groundY };
}

/** Grid-based spritesheet (e.g. 8x6 = 48 frames in an 8-col grid) */
export interface GridSpriteDef {
  url: string;
  frameW: number;
  frameH: number;
  cols: number;
  rows: number;
  totalFrames: number;
}

function gridSheet(url: string, totalW: number, totalH: number, cols: number, rows: number): GridSpriteDef {
  return { url, frameW: Math.round(totalW / cols), frameH: Math.round(totalH / rows), cols, rows, totalFrames: cols * rows };
}

// ============================================================
// UNIT SPRITE LOOKUP
// ============================================================

type UnitCategory = 'melee' | 'ranged' | 'caster';

// Some races have player-colored variants (Crown, Goblins melee), others are race-specific
// Player IDs: 0=Blue, 1=Purple, 2=Red, 3=Yellow
type PlayerVariants = { [pid: number]: SpriteDef };
interface RaceUnitSprites {
  melee: SpriteDef | PlayerVariants;
  ranged: SpriteDef | PlayerVariants;
  caster: SpriteDef | PlayerVariants;
}

const RACE_UNIT_SPRITES: Record<Race, RaceUnitSprites> = {
  [Race.Crown]: {
    melee:  { 0: tsSheet(crownMeleeBlue, 1152, 192), 1: tsSheet(crownMeleePurple, 1152, 192), 2: tsSheet(crownMeleeRed, 1152, 192), 3: tsSheet(crownMeleeYellow, 1152, 192) },
    ranged: { 0: tsSheet(crownRangedBlue, 768, 192), 1: tsSheet(crownRangedPurple, 768, 192), 2: tsSheet(crownRangedRed, 768, 192), 3: tsSheet(crownRangedYellow, 768, 192) },
    caster: { 0: tsSheet(crownCasterBlue, 768, 192), 1: tsSheet(crownCasterPurple, 768, 192), 2: tsSheet(crownCasterRed, 768, 192), 3: tsSheet(crownCasterYellow, 768, 192) },
  },
  [Race.Horde]: {
    melee:  cmStrip(hordeMelee, 57 * 5, 58, 5),
    ranged: { ...cmStrip(hordeRanged, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
    caster: { ...cmStrip(hordeCaster, 38 * 10, 26, 10), scale: 0.495 },
  },
  [Race.Goblins]: {
    melee:  tsSheet(goblinsMelee, 1536, 256, 0.67),
    ranged: tsSheet(goblinsRanged, 1152, 192, 0.69),
    caster: tsSheet(goblinsCaster, 768, 192),
  },
  [Race.Oozlings]: {
    melee:  { ...cmStrip(oozlingsMelee, 30 * 5, 30, 5, 0.93), scale: 0.6 },
    ranged: { ...cmStrip(oozlingsRanged, 40 * 6, 40, 6, 0.75), scale: 0.8 },
    caster: { ...cmStrip(oozlingsCaster, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  },
  [Race.Demon]: {
    melee:  cmStrip(demonMelee, 78 * 8, 54, 8, 0.76),
    ranged: { ...cmStrip(demonRanged, 624, 30, 16), scale: 0.70 },
    caster: { ...cmStrip(demonCaster, 173 * 48, 156, 48, 0.86), scale: 1.3 },
  },
  [Race.Deep]: {
    melee:  { ...tsSheet(deepMelee, 2240, 320, 0.65), scale: 1.68 },
    ranged: tsSheet(deepRanged, 1152, 192),
    caster: { ...tsSheet(deepCaster, 1152, 192), scale: 1.1 },
  },
  [Race.Wild]: {
    melee:  tsSheet(wildMelee, 960, 192),
    ranged: tsSheet(wildRanged, 1536, 192, 0.70),
    caster: { ...tsSheet(wildCaster, 1152, 192, 0.79), scale: 1.3 },
  },
  [Race.Geists]: {
    melee:  tsSheet(geistsMelee, 1152, 192, 0.68),
    ranged: { ...cmStrip(geistsRanged, 740, 29, 20), scale: 0.55 },
    caster: cmStrip(geistsCaster, 984, 42, 24, 0.69),
  },
  [Race.Tenders]: {
    melee:  cmStrip(tendersMelee, 1666, 52, 34, 0.94),
    ranged: tsSheet(tendersRanged, 1152, 192, 0.66),
    caster: tsSheet(tendersCaster, 1536, 256, 0.67),
  },
};

// Attack animation sprites (same structure as RACE_UNIT_SPRITES)
const RACE_ATK_SPRITES: Record<Race, Partial<RaceUnitSprites>> = {
  [Race.Crown]: {
    melee:  { 0: tsSheet(crownMeleeAtkBlue, 768, 192), 1: tsSheet(crownMeleeAtkPurple, 768, 192), 2: tsSheet(crownMeleeAtkRed, 768, 192), 3: tsSheet(crownMeleeAtkYellow, 768, 192) },
    ranged: { 0: tsSheet(crownRangedAtkBlue, 1536, 192), 1: tsSheet(crownRangedAtkPurple, 1536, 192), 2: tsSheet(crownRangedAtkRed, 1536, 192), 3: tsSheet(crownRangedAtkYellow, 1536, 192) },
    caster: { 0: tsSheet(crownCasterAtkBlue, 2112, 192), 1: tsSheet(crownCasterAtkPurple, 2112, 192), 2: tsSheet(crownCasterAtkRed, 2112, 192), 3: tsSheet(crownCasterAtkYellow, 2112, 192) },
  },
  [Race.Horde]: {
    melee:  cmStrip(hordeMeleeAtk, 684, 58, 12),
    ranged: { ...cmStrip(hordeRangedAtk, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
    caster: { ...cmStrip(hordeCasterAtk, 380, 26, 10), scale: 0.495 },
  },
  [Race.Goblins]: {
    melee:  tsSheet(goblinsMeleeAtk, 2048, 256, 0.67),
    ranged: tsSheet(goblinsRangedAtk, 1152, 192, 0.69),
    caster: tsSheet(goblinsCasterAtk, 1920, 192),
  },
  [Race.Oozlings]: {}, // slimes use same animation for move/attack
  [Race.Demon]: {
    melee:  cmStrip(demonMeleeAtk, 3276, 54, 42, 0.76),
    ranged: { ...cmStrip(demonRangedAtk, 858, 30, 22), scale: 0.70 },
    caster: { ...cmStrip(demonCasterAtk, 8304, 156, 48, 0.86), scale: 1.3 },
  },
  [Race.Deep]: {
    melee:  { ...tsSheet(deepMeleeAtk, 3200, 320, 0.65), scale: 1.68 },
    ranged: tsSheet(deepRangedAtk, 1536, 192),
    caster: { ...tsSheet(deepCasterAtk, 1152, 192), scale: 1.1 },
  },
  [Race.Wild]: {
    melee:  tsSheet(wildMeleeAtk, 1536, 192),
    ranged: tsSheet(wildRangedAtk, 1536, 192, 0.70),
    caster: { ...tsSheet(wildCasterAtk, 1728, 192, 0.79), scale: 1.3 },
  },
  [Race.Geists]: {
    melee:  tsSheet(geistsMeleeAtk, 1344, 192, 0.68),
    ranged: { ...cmStrip(geistsRangedAtk, 888, 29, 24), scale: 0.55 },
  },
  [Race.Tenders]: {
    melee:  cmStrip(tendersMeleeAtk, 2646, 52, 54, 0.94),
    ranged: tsSheet(tendersRangedAtk, 1344, 192, 0.66),
    caster: tsSheet(tendersCasterAtk, 3328, 256, 0.67),
  },
};

// ============================================================
// UPGRADE PATH SPRITE OVERRIDES
// ============================================================
// Key format: "race:category:node" — only entries that change art are listed.
// Missing entries fall back to base RACE_UNIT_SPRITES / RACE_ATK_SPRITES.

function upgradeKey(race: Race, cat: UnitCategory, node: string): string {
  return `${race}:${cat}:${node}`;
}

const UPGRADE_MOVE_SPRITES: Record<string, SpriteDef> = {
  // --- Geists melee: Skull → Mimic branch (C/F/G) ---
  [upgradeKey(Race.Geists, 'melee', 'C')]: cmStrip(mimicL1Move, 602, 32, 14),
  [upgradeKey(Race.Geists, 'melee', 'F')]: cmStrip(mimicL2Move, 696, 38, 24),
  [upgradeKey(Race.Geists, 'melee', 'G')]: cmStrip(mimicL4Move, 1200, 69, 16),
  // --- Crown ranged: Archer → Dwarfette branch (C/F/G) ---
  [upgradeKey(Race.Crown, 'ranged', 'C')]: cmStrip(dwarfetteL1Move, 368, 36, 8, 0.72),
  [upgradeKey(Race.Crown, 'ranged', 'F')]: cmStrip(dwarfetteL2Move, 530, 35, 10, 0.89),
  [upgradeKey(Race.Crown, 'ranged', 'G')]: cmStrip(dwarfetteL4Move, 1876, 52, 28, 0.94),
  // --- Horde: Orc color variants (B=Blue, C=Red for melee/ranged/caster) ---
  [upgradeKey(Race.Horde, 'melee', 'B')]: cmStrip(hordeMeleeBlue, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'melee', 'C')]: cmStrip(hordeMeleeRed, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'melee', 'D')]: cmStrip(hordeMeleeBlue, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'melee', 'E')]: cmStrip(hordeMeleeBlue, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'melee', 'F')]: cmStrip(hordeMeleeRed, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'melee', 'G')]: cmStrip(hordeMeleeRed, 57 * 5, 58, 5),
  [upgradeKey(Race.Horde, 'ranged', 'B')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'C')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'D')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'E')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'F')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'G')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'caster', 'B')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'C')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'D')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'E')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'F')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'G')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.495 },
  // --- Oozlings: Slime color variants (B=Cyan, C=Purple for melee/ranged/caster, tier2 inherits) ---
  [upgradeKey(Race.Oozlings, 'melee', 'B')]: { ...cmStrip(oozMeleeCyan, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'melee', 'C')]: { ...cmStrip(oozMeleePurple, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'melee', 'D')]: { ...cmStrip(oozMeleeCyan, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'melee', 'E')]: { ...cmStrip(oozMeleeCyan, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'melee', 'F')]: { ...cmStrip(oozMeleePurple, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'melee', 'G')]: { ...cmStrip(oozMeleePurple, 30 * 5, 30, 5, 0.93), scale: 0.6 },
  [upgradeKey(Race.Oozlings, 'ranged', 'B')]: { ...cmStrip(oozRangedCyan, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'ranged', 'C')]: { ...cmStrip(oozRangedPurple, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'ranged', 'D')]: { ...cmStrip(oozRangedCyan, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'ranged', 'E')]: { ...cmStrip(oozRangedCyan, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'ranged', 'F')]: { ...cmStrip(oozRangedPurple, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'ranged', 'G')]: { ...cmStrip(oozRangedPurple, 40 * 6, 40, 6, 0.75), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'B')]: { ...cmStrip(oozCasterCyan, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'C')]: { ...cmStrip(oozCasterPurple, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'D')]: { ...cmStrip(oozCasterCyan, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'E')]: { ...cmStrip(oozCasterCyan, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'F')]: { ...cmStrip(oozCasterPurple, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  [upgradeKey(Race.Oozlings, 'caster', 'G')]: { ...cmStrip(oozCasterPurple, 30 * 6, 40, 6, 0.93), scale: 0.8 },
  // --- Wild melee: Spider → Minotaur branch (C/F/G) ---
  [upgradeKey(Race.Wild, 'melee', 'C')]: tsSheet(minotaurWalk, 2560, 320),
  [upgradeKey(Race.Wild, 'melee', 'F')]: tsSheet(minotaurWalk, 2560, 320),
  [upgradeKey(Race.Wild, 'melee', 'G')]: tsSheet(minotaurWalk, 2560, 320),
  // --- Deep melee: Turtle → Frog branch (C=FrogMonster, F/G=FrogBoss) ---
  [upgradeKey(Race.Deep, 'melee', 'C')]: cmStrip(frogMonsterMove, 1056, 48, 22),
  [upgradeKey(Race.Deep, 'melee', 'F')]: cmStrip(frogBossMove, 2552, 97, 22),
  [upgradeKey(Race.Deep, 'melee', 'G')]: cmStrip(frogBossMove, 2552, 97, 22),
  // --- Tenders caster: Panda → Mushroom branch (C/F/G) ---
  [upgradeKey(Race.Tenders, 'caster', 'C')]: cmStrip(mushroomMove, 800, 31, 20),
  [upgradeKey(Race.Tenders, 'caster', 'F')]: cmStrip(mushroomMove, 800, 31, 20),
  [upgradeKey(Race.Tenders, 'caster', 'G')]: cmStrip(mushroomMove, 800, 31, 20),
  // --- Geists caster: Sorcerer LVL1 → LVL2/3/4 branch (C/F/G) ---
  [upgradeKey(Race.Geists, 'caster', 'C')]: cmStrip(sorcererL2Move, 456, 28, 12, 0.69),
  [upgradeKey(Race.Geists, 'caster', 'F')]: cmStrip(sorcererL3Move, 624, 44, 12, 0.69),
  [upgradeKey(Race.Geists, 'caster', 'G')]: cmStrip(sorcererL4Move, 1488, 59, 24, 0.69),
  // --- Tenders melee: Ent LVL1 → LVL2/3/4 branch (B/D/E) ---
  [upgradeKey(Race.Tenders, 'melee', 'B')]: cmStrip(entL2Move, 828, 45, 12, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'D')]: cmStrip(entL3Move, 1548, 56, 18, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'E')]: cmStrip(entL4Move, 1416, 70, 24, 0.94),
};

const UPGRADE_ATK_SPRITES: Record<string, SpriteDef> = {
  // --- Geists melee: Mimic dash attacks ---
  [upgradeKey(Race.Geists, 'melee', 'C')]: cmStrip(mimicL1Atk, 602, 32, 14),
  [upgradeKey(Race.Geists, 'melee', 'F')]: cmStrip(mimicL2Atk, 290, 38, 10),
  [upgradeKey(Race.Geists, 'melee', 'G')]: cmStrip(mimicL4Atk, 1050, 69, 14),
  // --- Crown ranged: Dwarfette dash attacks ---
  [upgradeKey(Race.Crown, 'ranged', 'C')]: cmStrip(dwarfetteL1Atk, 368, 36, 8, 0.72),
  [upgradeKey(Race.Crown, 'ranged', 'F')]: cmStrip(dwarfetteL2Atk, 742, 35, 14, 0.89),
  [upgradeKey(Race.Crown, 'ranged', 'G')]: cmStrip(dwarfetteL4Atk, 1072, 52, 16, 0.94),
  // --- Horde: Orc color variant attacks ---
  [upgradeKey(Race.Horde, 'melee', 'B')]: cmStrip(hordeMeleeAtkBlue, 684, 58, 12),
  [upgradeKey(Race.Horde, 'melee', 'C')]: cmStrip(hordeMeleeAtkRed, 684, 58, 12),
  [upgradeKey(Race.Horde, 'melee', 'D')]: cmStrip(hordeMeleeAtkBlue, 684, 58, 12),
  [upgradeKey(Race.Horde, 'melee', 'E')]: cmStrip(hordeMeleeAtkBlue, 684, 58, 12),
  [upgradeKey(Race.Horde, 'melee', 'F')]: cmStrip(hordeMeleeAtkRed, 684, 58, 12),
  [upgradeKey(Race.Horde, 'melee', 'G')]: cmStrip(hordeMeleeAtkRed, 684, 58, 12),
  [upgradeKey(Race.Horde, 'ranged', 'B')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'C')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'D')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'E')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'F')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'ranged', 'G')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.84, heightScale: 0.84 },
  [upgradeKey(Race.Horde, 'caster', 'B')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'C')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'D')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'E')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'F')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.495 },
  [upgradeKey(Race.Horde, 'caster', 'G')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.495 },
  // --- Wild melee: Minotaur cleave attack ---
  [upgradeKey(Race.Wild, 'melee', 'C')]: tsSheet(minotaurAttack, 3840, 320),
  [upgradeKey(Race.Wild, 'melee', 'F')]: tsSheet(minotaurAttack, 3840, 320),
  [upgradeKey(Race.Wild, 'melee', 'G')]: tsSheet(minotaurAttack, 3840, 320),
  // --- Deep melee: Frog jump attacks ---
  [upgradeKey(Race.Deep, 'melee', 'C')]: cmStrip(frogMonsterAtk, 672, 48, 14),
  [upgradeKey(Race.Deep, 'melee', 'F')]: cmStrip(frogBossAtk, 2552, 138, 22, 0.90),
  [upgradeKey(Race.Deep, 'melee', 'G')]: cmStrip(frogBossAtk, 2552, 138, 22, 0.90),
  // --- Tenders caster: Mushroom spell loop ---
  [upgradeKey(Race.Tenders, 'caster', 'C')]: cmStrip(mushroomAtk, 714, 40, 14),
  [upgradeKey(Race.Tenders, 'caster', 'F')]: cmStrip(mushroomAtk, 714, 40, 14),
  [upgradeKey(Race.Tenders, 'caster', 'G')]: cmStrip(mushroomAtk, 714, 40, 14),
  // --- Geists caster: Sorcerer dash attacks ---
  [upgradeKey(Race.Geists, 'caster', 'C')]: cmStrip(sorcererL2Atk, 380, 28, 10, 0.69),
  [upgradeKey(Race.Geists, 'caster', 'F')]: cmStrip(sorcererL3Atk, 832, 44, 16, 0.69),
  [upgradeKey(Race.Geists, 'caster', 'G')]: cmStrip(sorcererL4Atk, 620, 59, 10, 0.69),
  // --- Tenders melee: Ent dash attacks ---
  [upgradeKey(Race.Tenders, 'melee', 'B')]: cmStrip(entL2Atk, 690, 45, 10, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'D')]: cmStrip(entL3Atk, 688, 56, 8, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'E')]: cmStrip(entL4Atk, 1888, 70, 32, 0.94),
};

// Harvester (Pawn) — player colored, state-based animations
// idle=8fr(1536), run=6fr(1152), runGold/runWood/runMeat=6fr(1152), mineGold=6fr(1152), mineWood=6fr(1152), mineStone=4fr(768)
interface HarvesterSpriteSet {
  idle: SpriteDef;
  run: SpriteDef;
  runGold: SpriteDef;
  runWood: SpriteDef;
  runMeat: SpriteDef;  // also used for stone
  mineGold: SpriteDef;
  mineWood: SpriteDef;
  mineStone: SpriteDef;
}

function pawnSet(idle: string, run: string, runGold: string, runWood: string, runMeat: string,
  mineGold: string, mineWood: string, mineStone: string): HarvesterSpriteSet {
  return {
    idle: tsSheet(idle, 1536, 192),
    run: tsSheet(run, 1152, 192),
    runGold: tsSheet(runGold, 1152, 192),
    runWood: tsSheet(runWood, 1152, 192),
    runMeat: tsSheet(runMeat, 1152, 192),
    mineGold: tsSheet(mineGold, 1152, 192),
    mineWood: tsSheet(mineWood, 1152, 192),
    mineStone: tsSheet(mineStone, 768, 192),
  };
}

const HARVESTER_SPRITES: { [pid: number]: HarvesterSpriteSet } = {
  0: pawnSet(harvesterBlue, harvesterBlueRun, harvesterBlueRunGold, harvesterBlueRunWood, harvesterBlueRunMeat, harvesterBlueMineGold, harvesterBlueMineWood, harvesterBlueMineStone),
  1: pawnSet(harvesterPurple, harvesterPurpleRun, harvesterPurpleRunGold, harvesterPurpleRunWood, harvesterPurpleRunMeat, harvesterPurpleMineGold, harvesterPurpleMineWood, harvesterPurpleMineStone),
  2: pawnSet(harvesterRed, harvesterRedRun, harvesterRedRunGold, harvesterRedRunWood, harvesterRedRunMeat, harvesterRedMineGold, harvesterRedMineWood, harvesterRedMineStone),
  3: pawnSet(harvesterYellow, harvesterYellowRun, harvesterYellowRunGold, harvesterYellowRunWood, harvesterYellowRunMeat, harvesterYellowMineGold, harvesterYellowMineWood, harvesterYellowMineStone),
};

// ============================================================
// BUILDING SPRITE LOOKUP
// ============================================================

// Player-keyed building URLs: "playerId/buildingKey"
const BUILDING_URLS: Record<string, string> = {
  '0/hut': blueHouse, '0/melee': blueBarracks, '0/ranged': blueArchery,
  '0/caster': blueMonastery, '0/tower': blueTower, '0/hq': blueCastle,
  '1/hut': purpleHouse, '1/melee': purpleBarracks, '1/ranged': purpleArchery,
  '1/caster': purpleMonastery, '1/tower': purpleTower, '1/hq': purpleCastle,
  '2/hut': redHouse, '2/melee': redBarracks, '2/ranged': redArchery,
  '2/caster': redMonastery, '2/tower': redTower, '2/hq': redCastle,
  '3/hut': yellowHouse, '3/melee': yellowBarracks, '3/ranged': yellowArchery,
  '3/caster': yellowMonastery, '3/tower': yellowTower, '3/hq': yellowCastle,
};

const BUILDING_KEY: Partial<Record<BuildingType, string>> = {
  [BuildingType.HarvesterHut]: 'hut',
  [BuildingType.MeleeSpawner]: 'melee',
  [BuildingType.RangedSpawner]: 'ranged',
  [BuildingType.CasterSpawner]: 'caster',
  [BuildingType.Tower]: 'tower',
};

// ============================================================
// RESOURCE SPRITE LOOKUP
// ============================================================

export const RESOURCE_SPRITES = {
  goldResource: singleFrame(goldResource, 128, 128),
  goldStone: singleFrame(goldStone1, 128, 128),
  goldStone2: singleFrame(goldStone2, 128, 128),
  goldStone3: singleFrame(goldStone3, 128, 128),
  woodResource: singleFrame(woodResource, 64, 64),
  tree: tsSheet(tree1, 1536, 256),
  tree2: tsSheet(tree2, 1536, 256),
  tree3: tsSheet(tree3, 1536, 192),
  sheep: tsSheet(sheepIdle, 768, 128),
  sheepGrass: tsSheet(sheepGrass, 1536, 128),
  meatResource: singleFrame(meatResource, 64, 64),
  rock: singleFrame(rock1, 64, 64),
  // UI resource icons (cleaner for HUD / race select)
  uiGold: singleFrame(uiIconGold, 64, 64),
  uiWood: singleFrame(uiIconWood, 64, 64),
  uiMeat: singleFrame(uiIconMeat, 64, 64),
};

// Terrain tileset and decorations
export const TERRAIN_SPRITES = {
  tilemap: singleFrame(tilemapColor1, 576, 384),
  waterBg: singleFrame(waterBgColor, 64, 64),
  waterFoam: tsSheet(waterFoam, 3072, 192),
  cloud1: singleFrame(cloud1, 576, 256),
  cloud2: singleFrame(cloud2, 576, 256),
  cloud3: singleFrame(cloud3, 576, 256),
  waterRock1: tsSheet(waterRock1, 1024, 64),
  waterRock2: tsSheet(waterRock2, 1024, 64),
  bush1: tsSheet(bush1, 1024, 128),
  bush2: tsSheet(bush2, 1024, 128),
};

// ============================================================
// VFX SPRITE DEFINITIONS
// ============================================================

export const FX_SPRITES = {
  // Status effects (7-frame horizontal strips, 350x30 = 50x30 per frame)
  burn: cmStrip(fxBurnFlame, 350, 30, 7),
  slow: cmStrip(fxSlowOrb, 350, 30, 7),
  haste: cmStrip(fxHasteFlame, 350, 30, 7),
  poison: cmStrip(fxPoisonFlame, 350, 30, 7),
  lifesteal: cmStrip(fxLifestealFlame, 350, 30, 7),
  // Grid-based effects
  shield: gridSheet(fxShieldOrb, 384, 288, 8, 6),       // 48x48 per frame, 48 total
  buildingFire: gridSheet(fxBuildingFire, 288, 192, 6, 4), // 48x48 per frame, 24 total
  explosion: cmStrip(fxExplosion, 1536, 192, 8),         // 192x192, 8 frames
  dust: cmStrip(fxDust, 512, 64, 8),                     // 64x64, 8 frames
  nukeShockwave: gridSheet(fxNukeShockwave, 768, 512, 6, 4), // 128x128, 24 total
};

// ============================================================
// PROJECTILE SPRITE DEFINITIONS
// ============================================================

// Arrows: single 64x64 frames, per team color
const ARROW_SPRITES: { [team: number]: SpriteDef } = {
  0: singleFrame(arrowBlue, 64, 64),   // Team.Bottom (Blue/Purple)
  1: singleFrame(arrowRed, 64, 64),    // Team.Top (Red/Yellow)
};

// Orbs — small 32px: 6x5 grid (288x240, 48x48/frame, 30 frames)
const ORB_SM = {
  yellow: gridSheet(orbYellowSm, 288, 240, 6, 5),
  blue:   gridSheet(orbBlueSm, 288, 240, 6, 5),
  green:  gridSheet(orbGreenSm, 288, 240, 6, 5),
  purple: gridSheet(orbPurpleSm, 288, 240, 6, 5),
};

// Orbs — large 48px: 6x5 grid (432x360, 72x72/frame, 30 frames)
const ORB_LG = {
  yellow: gridSheet(orbYellowLg, 432, 360, 6, 5),
  blue:   gridSheet(orbBlueLg, 432, 360, 6, 5),
  green:  gridSheet(orbGreenLg, 432, 360, 6, 5),
  purple: gridSheet(orbPurpleLg, 432, 360, 6, 5),
};

// Circles — small 32px: 8x6 grid (384x288, 48x48/frame, 48 frames)
const CIRCLE_SM = {
  yellow: gridSheet(circleYellowSm, 384, 288, 8, 6),
  blue:   gridSheet(circleBlueSm, 384, 288, 8, 6),
  green:  gridSheet(circleGreenSm, 384, 288, 8, 6),
  purple: gridSheet(circlePurpleSm, 384, 288, 8, 6),
};

// Circles — large 64px: 8x6 grid (768x576, 96x96/frame, 48 frames)
const CIRCLE_LG = {
  yellow: gridSheet(circleYellowLg, 768, 576, 8, 6),
  blue:   gridSheet(circleBlueLg, 768, 576, 8, 6),
  green:  gridSheet(circleGreenLg, 768, 576, 8, 6),
  purple: gridSheet(circlePurpleLg, 768, 576, 8, 6),
};

type OrbColor = 'yellow' | 'blue' | 'green' | 'purple';

// Per-race projectile config: color + size variant
interface RaceProjectileConfig {
  color: OrbColor;
  orbSize: 'sm' | 'lg';     // 32px vs 48px orbs
  circleSize: 'sm' | 'lg';  // 32px vs 64px circles
}

const RACE_PROJECTILE: Record<Race, RaceProjectileConfig> = {
  [Race.Crown]:    { color: 'blue',   orbSize: 'lg', circleSize: 'lg' },
  [Race.Horde]:    { color: 'yellow', orbSize: 'lg', circleSize: 'lg' },
  [Race.Goblins]:  { color: 'green',  orbSize: 'sm', circleSize: 'sm' },  // small units → small projectiles
  [Race.Oozlings]: { color: 'purple', orbSize: 'sm', circleSize: 'sm' },  // swarm units → small projectiles
  [Race.Demon]:    { color: 'yellow', orbSize: 'lg', circleSize: 'lg' },
  [Race.Deep]:     { color: 'blue',   orbSize: 'lg', circleSize: 'lg' },
  [Race.Wild]:     { color: 'green',  orbSize: 'lg', circleSize: 'lg' },
  [Race.Geists]:   { color: 'purple', orbSize: 'lg', circleSize: 'lg' },
  [Race.Tenders]:  { color: 'green',  orbSize: 'lg', circleSize: 'lg' },
};

// ============================================================
// SPRITE LOADER
// ============================================================

export class SpriteLoader {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();

  private loadImage(url: string): HTMLImageElement | null {
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (this.loading.has(url)) return null;

    this.loading.add(url);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      this.cache.set(url, img);
      this.loading.delete(url);
    };
    img.onerror = () => {
      this.loading.delete(url);
    };
    return null;
  }

  // --- Buildings ---

  getBuildingSprite(type: BuildingType, playerId: number): HTMLImageElement | null {
    const bKey = BUILDING_KEY[type];
    if (!bKey) return null;
    const url = BUILDING_URLS[`${playerId}/${bKey}`];
    return url ? this.loadImage(url) : null;
  }

  getHQSprite(playerId: number): HTMLImageElement | null {
    const url = BUILDING_URLS[`${playerId}/hq`];
    return url ? this.loadImage(url) : null;
  }

  // --- Units ---

  /** Returns [image, spriteDef] or null if not loaded yet.
   *  upgradeNode: optional upgrade node key (e.g. 'C', 'F', 'G') to use upgrade-path art */
  getUnitSprite(race: Race, category: UnitCategory, playerId: number, attacking = false, upgradeNode?: string): [HTMLImageElement, SpriteDef] | null {
    // Check upgrade-path sprites first
    if (upgradeNode) {
      const key = upgradeKey(race, category, upgradeNode);
      if (attacking) {
        const atkDef = UPGRADE_ATK_SPRITES[key];
        if (atkDef) {
          const atkImg = this.loadImage(atkDef.url);
          if (atkImg) return [atkImg, atkDef];
        }
      }
      const moveDef = UPGRADE_MOVE_SPRITES[key];
      if (moveDef) {
        const moveImg = this.loadImage(moveDef.url);
        if (moveImg) return [moveImg, moveDef];
      }
      // Fall through to base sprites if upgrade sprite not found
    }

    // Try attack sprite first if attacking
    if (attacking) {
      const atkSprites = RACE_ATK_SPRITES[race];
      const atkRaw = atkSprites?.[category];
      if (atkRaw) {
        const atkDef: SpriteDef = (0 in atkRaw) ? (atkRaw as PlayerVariants)[playerId] ?? (atkRaw as PlayerVariants)[0] : atkRaw as SpriteDef;
        const atkImg = this.loadImage(atkDef.url);
        if (atkImg) return [atkImg, atkDef];
      }
    }
    // Fallback to idle/move sprite
    const raceSprites = RACE_UNIT_SPRITES[race];
    if (!raceSprites) return null;
    const raw = raceSprites[category];
    const def: SpriteDef = (0 in raw) ? (raw as PlayerVariants)[playerId] ?? (raw as PlayerVariants)[0] : raw as SpriteDef;
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Harvesters ---

  getHarvesterSprite(
    playerId: number,
    state: 'walking_to_node' | 'mining' | 'walking_home' | 'fighting' | 'dead',
    carryingResource: ResourceType | null,
    assignment: string,
  ): [HTMLImageElement, SpriteDef] | null {
    const set = HARVESTER_SPRITES[playerId] ?? HARVESTER_SPRITES[0];
    let def: SpriteDef;

    if (state === 'mining') {
      // Mining animation based on resource assignment
      if (assignment === 'wood') def = set.mineWood;
      else if (assignment === 'stone') def = set.mineStone;
      else def = set.mineGold; // base_gold and center both mine gold
    } else if (state === 'walking_home' && carryingResource) {
      // Carrying resource home
      if (carryingResource === ResourceType.Wood) def = set.runWood;
      else if (carryingResource === ResourceType.Stone) def = set.runMeat;
      else def = set.runGold;
    } else if (state === 'walking_to_node' || state === 'walking_home') {
      def = set.run;
    } else {
      def = set.idle;
    }

    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Resources ---

  getResourceSprite(key: keyof typeof RESOURCE_SPRITES): [HTMLImageElement, SpriteDef] | null {
    const def = RESOURCE_SPRITES[key];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Terrain ---

  getTerrainSprite(key: keyof typeof TERRAIN_SPRITES): [HTMLImageElement, SpriteDef] | null {
    const def = TERRAIN_SPRITES[key];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Projectiles ---

  /** Get arrow sprite for Crown ranged (team 0=bottom, 1=top) */
  getArrowSprite(team: number): [HTMLImageElement, SpriteDef] | null {
    const def = ARROW_SPRITES[team] ?? ARROW_SPRITES[0];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  /** Get orb sprite for a race's ranged projectiles (size based on race) */
  getOrbSprite(race: Race): [HTMLImageElement, GridSpriteDef] | null {
    const cfg = RACE_PROJECTILE[race];
    const def = cfg.orbSize === 'lg' ? ORB_LG[cfg.color] : ORB_SM[cfg.color];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  /** Get circle sprite for a race's caster AoE projectiles (size based on race) */
  getCircleSprite(race: Race): [HTMLImageElement, GridSpriteDef] | null {
    const cfg = RACE_PROJECTILE[race];
    const def = cfg.circleSize === 'lg' ? CIRCLE_LG[cfg.color] : CIRCLE_SM[cfg.color];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- VFX ---

  getFxSprite(key: keyof typeof FX_SPRITES): [HTMLImageElement, SpriteDef | GridSpriteDef] | null {
    const def = FX_SPRITES[key];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Preload all sprites ---

  /** Kick off loading all sprites. Returns a promise that resolves when every image is ready. */
  preloadAll(): Promise<void> {
    const urls = new Set<string>();

    // Unit sprites (all races, all categories, all player variants)
    for (const raceSprites of Object.values(RACE_UNIT_SPRITES)) {
      for (const raw of Object.values(raceSprites)) {
        if (0 in (raw as PlayerVariants)) {
          for (const def of Object.values(raw as PlayerVariants)) urls.add(def.url);
        } else {
          urls.add((raw as SpriteDef).url);
        }
      }
    }

    // Attack sprites (all races, all categories)
    for (const atkSprites of Object.values(RACE_ATK_SPRITES)) {
      for (const raw of Object.values(atkSprites)) {
        if (0 in (raw as PlayerVariants)) {
          for (const def of Object.values(raw as PlayerVariants)) urls.add(def.url);
        } else {
          urls.add((raw as SpriteDef).url);
        }
      }
    }

    // Upgrade path sprites
    for (const def of Object.values(UPGRADE_MOVE_SPRITES)) urls.add(def.url);
    for (const def of Object.values(UPGRADE_ATK_SPRITES)) urls.add(def.url);

    // Harvester sprites (all players, all states)
    for (const set of Object.values(HARVESTER_SPRITES)) {
      for (const def of Object.values(set)) urls.add(def.url);
    }

    // Building sprites
    for (const url of Object.values(BUILDING_URLS)) urls.add(url);

    // Resource sprites
    for (const def of Object.values(RESOURCE_SPRITES)) urls.add(def.url);

    // Terrain sprites
    for (const def of Object.values(TERRAIN_SPRITES)) urls.add(def.url);

    // FX sprites
    for (const def of Object.values(FX_SPRITES)) urls.add(def.url);

    // Projectile sprites
    for (const def of Object.values(ARROW_SPRITES)) urls.add(def.url);
    for (const def of Object.values(ORB_SM)) urls.add(def.url);
    for (const def of Object.values(ORB_LG)) urls.add(def.url);
    for (const def of Object.values(CIRCLE_SM)) urls.add(def.url);
    for (const def of Object.values(CIRCLE_LG)) urls.add(def.url);

    // Kick off loading for all URLs and collect promises
    const promises: Promise<void>[] = [];
    for (const url of urls) {
      if (this.cache.has(url)) continue;
      promises.push(new Promise<void>((resolve) => {
        if (this.loading.has(url)) {
          const check = () => {
            if (this.cache.has(url) || !this.loading.has(url)) resolve();
            else setTimeout(check, 16);
          };
          check();
          return;
        }
        this.loading.add(url);
        const img = new Image();
        img.src = url;
        img.onload = () => { this.cache.set(url, img); this.loading.delete(url); resolve(); };
        img.onerror = () => { this.loading.delete(url); resolve(); };
      }));
    }
    return Promise.all(promises).then(() => {});
  }
}

/** Extract a specific animation frame from a spritesheet image */
export function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  def: SpriteDef,
  frame: number,
  dx: number, dy: number,
  drawW: number, drawH: number,
): void {
  const f = frame % def.cols;
  const sx = f * def.frameW;
  ctx.drawImage(img, sx, 0, def.frameW, def.frameH, dx, dy, drawW, drawH);
}

/** Draw a frame from a grid-based spritesheet (cols x rows) */
export function drawGridFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  def: GridSpriteDef,
  frame: number,
  dx: number, dy: number,
  drawW: number, drawH: number,
): void {
  const f = frame % def.totalFrames;
  const col = f % def.cols;
  const row = Math.floor(f / def.cols);
  ctx.drawImage(img, col * def.frameW, row * def.frameH, def.frameW, def.frameH, dx, dy, drawW, drawH);
}
