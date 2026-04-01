import { BuildingType, Race, ResourceType } from '../simulation/types';

// ============================================================
// BUILDING SPRITES (Tiny Swords)
// ============================================================
// P0 = Blue, P1 = Purple, P2 = Red, P3 = Yellow, P4 = Black
import blueHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/House1.png?url';
import blueHouse2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/House2.png?url';
import blueBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Barracks.png?url';
import blueArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Archery.png?url';
import blueMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Monastery.png?url';
import blueTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Tower.png?url';
import blueCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Blue Buildings/Castle.png?url';
import purpleHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/House1.png?url';
import purpleHouse2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/House2.png?url';
import purpleBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Barracks.png?url';
import purpleArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Archery.png?url';
import purpleMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Monastery.png?url';
import purpleTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Tower.png?url';
import purpleCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Purple Buildings/Castle.png?url';
import redHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/House1.png?url';
import redHouse2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/House2.png?url';
import redBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Barracks.png?url';
import redArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Archery.png?url';
import redMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Monastery.png?url';
import redTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Tower.png?url';
import redCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Red Buildings/Castle.png?url';
import yellowHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/House1.png?url';
import yellowHouse2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/House2.png?url';
import yellowBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Barracks.png?url';
import yellowArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Archery.png?url';
import yellowMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Monastery.png?url';
import yellowTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Tower.png?url';
import yellowCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Yellow Buildings/Castle.png?url';
import blackHouse from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/House1.png?url';
import blackHouse2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/House2.png?url';
import blackBarracks from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/Barracks.png?url';
import blackArchery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/Archery.png?url';
import blackMonastery from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/Monastery.png?url';
import blackTower from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/Tower.png?url';
import blackCastle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Buildings/Black Buildings/Castle.png?url';

// ============================================================
// SPECIAL BUILDING SPRITES
// ============================================================
import seedPlantIdle from '../assets/images/Pixel Adventure 2/Enemies/Plant/Idle (44x42).png?url';
// Crown Foundry — Ship Helm (single frame, static building sprite)
import foundryHelmUrl from '../assets/images/Treasure Hunters/Treasure Hunters/Palm Tree Island/Sprites/Objects/Ship Helm/Ship Helm Idle 01.png?url';
// Crown siege — Kings and Pigs Cannon
import cannonIdle from '../assets/images/Kings and Pigs/Sprites/10-Cannon/Idle.png?url';
import cannonShoot from '../assets/images/Kings and Pigs/Sprites/10-Cannon/Shoot (44x28).png?url';

const SEED_SPRITE_DEF: SpriteDef = {
  url: seedPlantIdle,
  frameW: 44,
  frameH: 42,
  cols: 11,
  groundY: 0.95,
  scale: 1.0,
  animSpeed: 0.6,
};

// ============================================================
// UNIT SPRITES — Crown (Tiny Swords humans)
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
import harvesterBlueMineMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Pawn/Pawn_Interact Knife.png?url';
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
import harvesterPurpleMineMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Purple Units/Pawn/Pawn_Interact Knife.png?url';
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
import harvesterRedMineMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Pawn/Pawn_Interact Knife.png?url';
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
import harvesterYellowMineMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Yellow Units/Pawn/Pawn_Interact Knife.png?url';
import crownMeleeBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Warrior/Warrior_Run.png?url';
import crownRangedBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Archer/Archer_Run.png?url';
import crownCasterBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Monk/Run.png?url';
import harvesterBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Idle.png?url';
import harvesterBlackRun from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Run.png?url';
import harvesterBlackRunGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Run Gold.png?url';
import harvesterBlackRunWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Run Wood.png?url';
import harvesterBlackRunMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Run Meat.png?url';
import harvesterBlackMineGold from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Interact Pickaxe.png?url';
import harvesterBlackMineWood from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Interact Axe.png?url';
import harvesterBlackMineMeat from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Pawn/Pawn_Interact Knife.png?url';

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
import globuleSpriteUrl from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl06_Idle_1x1.png?url';
import globuleIdleUrl from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl05_Move_6x1.png?url';
import globuleAtkUrl from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/01_GREEN/Slime_Lvl05_ATK_Down_11x1.png?url';

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
import crownMeleeAtkBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Warrior/Warrior_Attack1.png?url';
import crownRangedAtkBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Archer/Archer_Shoot.png?url';
import crownCasterAtkBlack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Black Units/Monk/Heal.png?url';
import humanWizardIdle from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Human Wizard-idle.png?url';
import humanWizardAttack from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Human Wizard-attack.png?url';
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
// Minotaur (Wild melee D — tier 2, from Bear path)
import minotaurWalk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Minotaur/Minotaur_Walk.png?url';
import minotaurAttack from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Minotaur/Minotaur_Attack.png?url';
// Bear (Wild melee B branch)
import bearRun from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Bear/Bear_Run.png?url';
import bearAttack from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Bear/Bear_Attack.png?url';
// Snake (Wild melee F + Wild ranged C branch)
import snakeRun from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Snake/Snake_Run.png?url';
import snakeAttack from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Snake/Snake_Attack.png?url';
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
// Oozlings color variants: Cyan (02), Purple (04), Red (07), Orange (10)
import oozMeleeCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl01_Move_5x1.png?url';
import oozRangedCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl04_Move_6x1.png?url';
import oozCasterCyan from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/02_CYAN/Slime_Lvl06_Move_6x1.png?url';
import oozMeleePurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl01_Move_5x1.png?url';
import oozRangedPurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl04_Move_6x1.png?url';
import oozCasterPurple from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/04_PURPLE/Slime_Lvl06_Move_6x1.png?url';
import oozMeleeRed from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/07_RED/Slime_Lvl01_Move_5x1.png?url';
import oozRangedRed from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/07_RED/Slime_Lvl04_Move_6x1.png?url';
import oozCasterRed from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/07_RED/Slime_Lvl06_Move_6x1.png?url';
import oozMeleeOrange from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/10_ORANGE/Slime_Lvl01_Move_5x1.png?url';
import oozRangedOrange from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/10_ORANGE/Slime_Lvl04_Move_6x1.png?url';
import oozCasterOrange from '../assets/images/SLIMES BLOBS TENTACLES/[CHARACTER PACK] SLIMES, BLOBS & TENTACLES/10_ORANGE/Slime_Lvl06_Move_6x1.png?url';

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
import bush3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Bushes/Bushe3.png?url';
import bush4 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Bushes/Bushe4.png?url';
import tilemapColor2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color2.png?url';
import tilemapColor3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color3.png?url';
import tilemapColor4 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color4.png?url';
import tilemapColor5 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color5.png?url';
import terrainShadow from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Tileset/Shadow.png?url';
import rock2 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks/Rock2.png?url';
import rock3 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks/Rock3.png?url';
import rock4 from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Terrain/Decorations/Rocks/Rock4.png?url';

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
import uiIconMana from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Mana.png?url';
import uiIconSouls from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Souls.png?url';
import uiIconOoze from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/UI Elements/UI Elements/Icons/Ooze.png?url';

// ============================================================
// PROJECTILE SPRITES
// ============================================================
// Arrows (ranged units — per team color)
import arrowBlue from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Blue Units/Archer/Arrow.png?url';
import arrowRed from '../assets/images/Tiny Swords (Free Pack)/Tiny Swords (Free Pack)/Units/Red Units/Archer/Arrow.png?url';
// Bone projectile (Wild Bonechucker)
import gnollBone from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Gnoll/Gnoll_Bone.png?url';
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

// Per-unit projectile sprites (128x128 transparent PNGs)
import projArrow from '../assets/images/projectiles/arrow.png?url';
import projDagger from '../assets/images/projectiles/dagger.png?url';
import projFireArrow from '../assets/images/projectiles/fire_arrow.png?url';
import projFireBolt from '../assets/images/projectiles/fire_bolt.png?url';
import projHarpoon from '../assets/images/projectiles/harpoon.png?url';
import projIceArrow from '../assets/images/projectiles/ice_arrow.png?url';
import projAcidSpit from '../assets/images/projectiles/acid_spit.png?url';
import projShadowArrow from '../assets/images/projectiles/shadow_arrow.png?url';
import projHolyBolt from '../assets/images/projectiles/holy_bolt.png?url';
import projMagicMissile from '../assets/images/projectiles/magic_missile.png?url';
import projMusicNote from '../assets/images/projectiles/music_note.png?url';
import projNatureBolt from '../assets/images/projectiles/nature_bolt.png?url';
import projPoisonArrow from '../assets/images/projectiles/poison_arrow.png?url';
import projShadowBolt from '../assets/images/projectiles/shadow_bolt.png?url';
import projSlimeMissile from '../assets/images/projectiles/slime_missile.png?url';
import projStoneBall from '../assets/images/projectiles/stone_ball.png?url';
import projWaterBolt from '../assets/images/projectiles/water_bolt.png?url';

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
// Geist summon telegraph
import fxBlackHole from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_BlackHole/FX_BlackHole_Little_Orange_7x8.png?url';
import goldenSkull from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Golden Skull/01.png?url';
// Meteorite projectiles (10x6 grids — 10 cols animation, 6 rows rotation)
import fxMeteoriteOrange from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_Meteorite/FX_Meteorite_Orange_10x6.png?url';
import fxMeteoriteGreen from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_Meteorite/FX_Meteorite_Green_10x6.png?url';
import fxMeteoritePurple from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_Meteorite/FX_Meteorite_Purple_10x6.png?url';
// StarShine sparkle bursts (13x1 strips)
import fxStarShineBlue from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_StarShine/FX_StarShine_Big_Blue_13x1.png?url';
import fxStarShinePink from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_StarShine/FX_StarShine_Big_Pink_13x1.png?url';
// Eclipse (20x1 strip)
import fxEclipse from '../assets/images/OVERSTELLAR AssetPack/OVERSTELLAR AssetPack/FX_Eclipse/FX_Eclipse01_20x1.png?url';

// ============================================================
// NEW UPGRADE PATH SPRITES
// ============================================================
// --- Kings and Pigs (strip format, frameW×frameH in filename) ---
import kingHumanRun from '../assets/images/Kings and Pigs/Sprites/01-King Human/Run (78x58).png?url';
import kingHumanAtk from '../assets/images/Kings and Pigs/Sprites/01-King Human/Attack (78x58).png?url';
import kingPigRun from '../assets/images/Kings and Pigs/Sprites/02-King Pig/Run (38x28).png?url';
import kingPigAtk from '../assets/images/Kings and Pigs/Sprites/02-King Pig/Attack (38x28).png?url';
import pigRun from '../assets/images/Kings and Pigs/Sprites/03-Pig/Run (34x28).png?url';
import pigAtk from '../assets/images/Kings and Pigs/Sprites/03-Pig/Attack (34x28).png?url';
// --- Pixel Adventure 2 (strip format) ---
import chameleonRun from '../assets/images/Pixel Adventure 2/Enemies/Chameleon/Run (84x38).png?url';
import chameleonAtk from '../assets/images/Pixel Adventure 2/Enemies/Chameleon/Attack (84x38).png?url';
import skullIdle from '../assets/images/Pixel Adventure 2/Enemies/Skull/Idle 1 (52x54).png?url';
import radishRun from '../assets/images/Pixel Adventure 2/Enemies/Radish/Run (30x38).png?url';
// --- Demon Smasher color variants (CHARACTER MEGAPACK) ---
import demonMeleeDevil from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_04_Devil/Move_8x1.png?url';
import demonMeleeDevilAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_04_Devil/Charge_Full_42x1.png?url';
import demonMeleeSilver from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_02_Silver/Move_8x1.png?url';
import demonMeleeSilverAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_02_Silver/Charge_Full_42x1.png?url';
import demonMeleeGold from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_03_Gold/Move_8x1.png?url';
import demonMeleeGoldAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_03_Gold/Charge_Full_42x1.png?url';
import demonMeleeOrc from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_05_Orc/Move_8x1.png?url';
import demonMeleeOrcAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_05_Orc/Charge_Full_42x1.png?url';
import demonMeleeFrozen from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_07_Frozen/Move_8x1.png?url';
import demonMeleeFrozenAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_07_Frozen/Charge_Full_42x1.png?url';
import demonMeleeBio from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_08_Bioluminescent/Move_8x1.png?url';
import demonMeleeBioAtk from '../assets/images/CHARACTER MEGAPACK/CHARACTER MEGAPACK/RhinoMonster_08_Bioluminescent/Charge_Full_42x1.png?url';
// --- Troll (Tiny Swords Enemy Pack) ---
import trollWalk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Troll/Troll_Walk.png?url';
import trollAtk from '../assets/images/Tiny Swords (Enemy Pack)/Tiny Swords (Enemy Pack)/Enemy Pack/Troll/Troll_Attack.png?url';
// --- Pirate Bomb (combined strips) ---
import whaleRun from '../assets/images/Pirate Bomb/Sprites/6-Enemy-Whale/Whale_Run.png?url';
import whaleAtk from '../assets/images/Pirate Bomb/Sprites/6-Enemy-Whale/Whale_Attack.png?url';
// --- Treasure Hunters - Crusty Crew (combined strips) ---
import crabbyRun from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Crabby/Crabby_Run.png?url';
import crabbyAtk from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Crabby/Crabby_Attack.png?url';
import fierceToothRun from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Fierce Tooth/FierceTooth_Run.png?url';
import fierceToothAtk from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Fierce Tooth/FierceTooth_Attack.png?url';
import pinkStarRun from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Pink Star/PinkStar_Run.png?url';
import pinkStarAtk from '../assets/images/Treasure Hunters/Treasure Hunters/The Crusty Crew/Sprites/Pink Star/PinkStar_Attack.png?url';
// --- Treasure Hunters - Seashell (clam, combined strips) ---
import seashellOpening from '../assets/images/Treasure Hunters/Treasure Hunters/Shooter Traps/Sprites/Seashell/Seashell_Opening.png?url';
import seashellBite from '../assets/images/Treasure Hunters/Treasure Hunters/Shooter Traps/Sprites/Seashell/Seashell_Bite.png?url';
// --- Pirate Bomb - Bald Pirate (combined strips) ---
import baldPirateRun from '../assets/images/Pirate Bomb/Sprites/2-Enemy-Bald Pirate/BaldPirate_Run.png?url';
import baldPirateAtk from '../assets/images/Pirate Bomb/Sprites/2-Enemy-Bald Pirate/BaldPirate_Attack.png?url';
// --- Pirate Bomb - Captain (combined strips) ---
import captainRun from '../assets/images/Pirate Bomb/Sprites/5-Enemy-Captain/Captain_Run.png?url';
import captainAtk from '../assets/images/Pirate Bomb/Sprites/5-Enemy-Captain/Captain_Attack.png?url';
// --- Treasure Hunters - Captain Clown Nose (combined strips) ---
import clownNoseRun from '../assets/images/Treasure Hunters/Treasure Hunters/Captain Clown Nose/Sprites/Captain Clown Nose/ClownNose_Run.png?url';
import clownNoseAtk from '../assets/images/Treasure Hunters/Treasure Hunters/Captain Clown Nose/Sprites/Captain Clown Nose/ClownNose_Attack.png?url';
// --- Treasure Hunters - Diamond (combined strips) ---
import blueDiamondIdle from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Blue Diamond/BlueDiamond_Idle.png?url';
import bluePotionIdle from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Blue Potion/BluePotion_Idle.png?url';
import redPotionIdle from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Red Potion/RedPotion_Idle.png?url';
import greenPotionIdle from '../assets/images/Treasure Hunters/Treasure Hunters/Pirate Treasure/Sprites/Green Bottle/GreenBottle_Idle.png?url';

// ============================================================
// SPRITE DEFINITIONS
// ============================================================

/** Describes how to extract a frame from a spritesheet or single image */
export interface SpriteDef {
  url: string;
  frameW: number;   // width of one frame in pixels
  frameH: number;   // height of one frame in pixels
  cols: number;     // number of columns (frames) in the sheet
  rows?: number;    // optional number of rows for grid-like animation sheets
  srcX?: number;    // source x offset inside the image
  srcY?: number;    // source y offset inside the image
  groundY?: number;  // where the feet/ground contact is as fraction of frame height (0=top, 1=bottom)
  scale?: number;    // optional display scale multiplier (default 1.0)
  heightScale?: number; // squash/stretch height independently of width (default 1.0)
  animSpeed?: number;  // animation speed multiplier (default 1.0, higher = faster)
  anchorX?: number;    // horizontal anchor as fraction of frame width (0=left, 0.5=center, 1=right; default 0.5)
  flipX?: boolean;     // if true, sprite faces left natively and should be flipped to match right-facing convention
}

/** Compute animation frame index from a tick counter (~20 ticks/sec).
 *  Always targets ~1 cycle per second regardless of frame count.
 *  High-frame sprites (48+) skip frames to stay at 1s; low-frame sprites hold frames longer. */
export function getSpriteFrame(tick: number, def: SpriteDef): number {
  const totalFrames = def.cols * (def.rows ?? 1);
  const speed = def.animSpeed ?? 1.0;
  return Math.floor(tick * totalFrames * speed / 20) % totalFrames;
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

function rowStrip(
  url: string,
  frameSize: number,
  cols: number,
  row: number,
  groundY = 0.86,
): SpriteDef {
  return {
    url,
    frameW: frameSize,
    frameH: frameSize,
    cols,
    srcY: row * frameSize,
    groundY,
  };
}

function gridAnim(
  url: string,
  frameW: number,
  frameH: number,
  cols: number,
  rows: number,
  groundY = 0.86,
): SpriteDef {
  return { url, frameW, frameH, cols, rows, groundY };
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
    melee:  { 0: tsSheet(crownMeleeBlue, 1152, 192), 1: tsSheet(crownMeleePurple, 1152, 192), 2: tsSheet(crownMeleeRed, 1152, 192), 3: tsSheet(crownMeleeYellow, 1152, 192), 4: tsSheet(crownMeleeBlack, 1152, 192) },
    ranged: { 0: tsSheet(crownRangedBlue, 768, 192), 1: tsSheet(crownRangedPurple, 768, 192), 2: tsSheet(crownRangedRed, 768, 192), 3: tsSheet(crownRangedYellow, 768, 192), 4: tsSheet(crownRangedBlack, 768, 192) },
    caster: { 0: tsSheet(crownCasterBlue, 768, 192), 1: tsSheet(crownCasterPurple, 768, 192), 2: tsSheet(crownCasterRed, 768, 192), 3: tsSheet(crownCasterYellow, 768, 192), 4: tsSheet(crownCasterBlack, 768, 192) },
  },
  [Race.Horde]: {
    melee:  { ...cmStrip(hordeMelee, 57 * 5, 58, 5), scale: 0.9 },
    ranged: { ...cmStrip(hordeRanged, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
    caster: { ...cmStrip(hordeCaster, 38 * 10, 26, 10), scale: 0.445 },
  },
  [Race.Goblins]: {
    melee:  tsSheet(goblinsMelee, 1536, 256, 0.67),
    ranged: tsSheet(goblinsRanged, 1152, 192, 0.69),
    caster: tsSheet(goblinsCaster, 768, 192),
  },
  [Race.Oozlings]: {
    melee:  { ...cmStrip(oozlingsMelee, 30 * 5, 30, 5, 0.93), scale: 0.5 },
    ranged: { ...cmStrip(oozlingsRanged, 40 * 6, 40, 6, 0.75), scale: 0.7 },
    caster: { ...cmStrip(oozlingsCaster, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  },
  [Race.Demon]: {
    melee:  { ...cmStrip(demonMelee, 78 * 8, 54, 8, 0.76), scale: 0.9 },
    ranged: { ...cmStrip(demonRanged, 624, 30, 16), scale: 0.60 },
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
    caster: { ...cmStrip(geistsCaster, 984, 42, 24, 0.69), scale: 0.9 },
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
    melee:  { 0: tsSheet(crownMeleeAtkBlue, 768, 192), 1: tsSheet(crownMeleeAtkPurple, 768, 192), 2: tsSheet(crownMeleeAtkRed, 768, 192), 3: tsSheet(crownMeleeAtkYellow, 768, 192), 4: tsSheet(crownMeleeAtkBlack, 768, 192) },
    ranged: { 0: tsSheet(crownRangedAtkBlue, 1536, 192), 1: tsSheet(crownRangedAtkPurple, 1536, 192), 2: tsSheet(crownRangedAtkRed, 1536, 192), 3: tsSheet(crownRangedAtkYellow, 1536, 192), 4: tsSheet(crownRangedAtkBlack, 1536, 192) },
    caster: { 0: tsSheet(crownCasterAtkBlue, 2112, 192), 1: tsSheet(crownCasterAtkPurple, 2112, 192), 2: tsSheet(crownCasterAtkRed, 2112, 192), 3: tsSheet(crownCasterAtkYellow, 2112, 192), 4: tsSheet(crownCasterAtkBlack, 2112, 192) },
  },
  [Race.Horde]: {
    melee:  { ...cmStrip(hordeMeleeAtk, 684, 58, 12), scale: 0.9 },
    ranged: { ...cmStrip(hordeRangedAtk, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
    caster: { ...cmStrip(hordeCasterAtk, 380, 26, 10), scale: 0.445 },
  },
  [Race.Goblins]: {
    melee:  tsSheet(goblinsMeleeAtk, 2048, 256, 0.67),
    ranged: tsSheet(goblinsRangedAtk, 1152, 192, 0.69),
    caster: tsSheet(goblinsCasterAtk, 1920, 192),
  },
  [Race.Oozlings]: {}, // slimes use same animation for move/attack
  [Race.Demon]: {
    melee:  { ...cmStrip(demonMeleeAtk, 3276, 54, 42, 0.76), scale: 0.9 },
    ranged: { ...cmStrip(demonRangedAtk, 858, 30, 22), scale: 0.60 },
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
  [upgradeKey(Race.Geists, 'melee', 'C')]: { ...cmStrip(mimicL1Move, 602, 32, 14), scale: 0.8 },
  [upgradeKey(Race.Geists, 'melee', 'F')]: { ...cmStrip(mimicL2Move, 696, 38, 24), scale: 0.8 },
  [upgradeKey(Race.Geists, 'melee', 'G')]: cmStrip(mimicL4Move, 1200, 69, 16),
  // --- Crown ranged: Archer → Dwarfette branch (C/F), Cannon siege (G) ---
  [upgradeKey(Race.Crown, 'ranged', 'C')]: { ...cmStrip(dwarfetteL1Move, 368, 36, 8, 0.72), scale: 0.7 },
  [upgradeKey(Race.Crown, 'ranged', 'F')]: { ...cmStrip(dwarfetteL2Move, 530, 35, 10, 0.89), scale: 0.7 },
  [upgradeKey(Race.Crown, 'ranged', 'G')]: { ...singleFrame(cannonIdle, 44, 28, 0.95), flipX: true },
  // --- Horde: Orc color variants (B=Blue, C=Red for melee/ranged/caster) ---
  [upgradeKey(Race.Horde, 'melee', 'B')]: { ...cmStrip(hordeMeleeBlue, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'C')]: { ...cmStrip(hordeMeleeRed, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'D')]: { ...cmStrip(hordeMeleeBlue, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'E')]: { ...cmStrip(hordeMeleeBlue, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'F')]: { ...cmStrip(hordeMeleeRed, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'G')]: { ...cmStrip(hordeMeleeRed, 57 * 5, 58, 5), scale: 0.9 },
  [upgradeKey(Race.Horde, 'ranged', 'B')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'C')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'D')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'E')]: { ...cmStrip(hordeRangedBlue, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'F')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'G')]: { ...cmStrip(hordeRangedRed, 74 * 6, 41, 6), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'caster', 'B')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'C')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'D')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'E')]: { ...cmStrip(hordeCasterBlue, 38 * 10, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'F')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'G')]: { ...cmStrip(hordeCasterRed, 38 * 10, 26, 10), scale: 0.445 },
  // --- Oozlings: Slime color variants (B/D=Cyan, E=Purple, C/F=Red, G=Orange) ---
  [upgradeKey(Race.Oozlings, 'melee', 'B')]: { ...cmStrip(oozMeleeCyan, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'melee', 'C')]: { ...cmStrip(oozMeleeRed, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'melee', 'D')]: { ...cmStrip(oozMeleeCyan, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'melee', 'E')]: { ...cmStrip(oozMeleePurple, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'melee', 'F')]: { ...cmStrip(oozMeleeRed, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'melee', 'G')]: { ...cmStrip(oozMeleeOrange, 30 * 5, 30, 5, 0.93), scale: 0.5 },
  [upgradeKey(Race.Oozlings, 'ranged', 'B')]: { ...cmStrip(oozRangedCyan, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'ranged', 'C')]: { ...cmStrip(oozRangedRed, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'ranged', 'D')]: { ...cmStrip(oozRangedCyan, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'ranged', 'E')]: { ...cmStrip(oozRangedPurple, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'ranged', 'F')]: { ...cmStrip(oozRangedRed, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'ranged', 'G')]: { ...cmStrip(oozRangedOrange, 40 * 6, 40, 6, 0.75), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'B')]: { ...cmStrip(oozCasterCyan, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'C')]: { ...cmStrip(oozCasterRed, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'D')]: { ...cmStrip(oozCasterCyan, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'E')]: { ...cmStrip(oozCasterPurple, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'F')]: { ...cmStrip(oozCasterRed, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  [upgradeKey(Race.Oozlings, 'caster', 'G')]: { ...cmStrip(oozCasterOrange, 30 * 6, 40, 6, 0.93), scale: 0.7 },
  // --- Wild melee: Spider → Bear (B) / Spider Brood (C) branches ---
  [upgradeKey(Race.Wild, 'melee', 'B')]: tsSheet(bearRun, 1280, 256, 0.69),
  [upgradeKey(Race.Wild, 'melee', 'C')]: { ...tsSheet(wildMelee, 960, 192, 0.71), scale: 0.6 }, // Spider Brood (3 small spiders)
  [upgradeKey(Race.Wild, 'melee', 'D')]: { ...tsSheet(minotaurWalk, 2560, 320, 0.67), scale: 1.5 },
  [upgradeKey(Race.Wild, 'melee', 'E')]: { ...tsSheet(bearRun, 1280, 256, 0.69), scale: 1.3 },
  [upgradeKey(Race.Wild, 'melee', 'F')]: { ...tsSheet(snakeRun, 1536, 192, 0.64), scale: 0.6 }, // Viper Nest (3 small snakes)
  [upgradeKey(Race.Wild, 'melee', 'G')]: { ...tsSheet(wildMelee, 960, 192, 0.71), scale: 0.5 }, // Spider Swarm (5 tiny spiders)
  // --- Deep melee: Turtle → Frog branch (C=FrogMonster, F/G=FrogBoss) ---
  [upgradeKey(Race.Deep, 'melee', 'C')]: { ...cmStrip(frogMonsterMove, 1056, 48, 22), animSpeed: 1.8, scale: 0.8 },
  [upgradeKey(Race.Deep, 'melee', 'F')]: { ...cmStrip(frogBossMove, 2552, 97, 22), animSpeed: 1.8, scale: 0.9 },
  [upgradeKey(Race.Deep, 'melee', 'G')]: { ...cmStrip(frogBossMove, 2552, 97, 22), animSpeed: 1.8 },
  // --- Tenders caster: Panda → Mushroom branch (C/F/G) ---
  [upgradeKey(Race.Tenders, 'caster', 'C')]: { ...cmStrip(mushroomMove, 800, 31, 20), scale: 0.6 },
  [upgradeKey(Race.Tenders, 'caster', 'F')]: { ...cmStrip(mushroomMove, 800, 31, 20), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'caster', 'G')]: { ...cmStrip(mushroomMove, 800, 31, 20), scale: 0.8 },
  // --- Geists caster: Sorcerer LVL1 → LVL2/3/4 branch (C/F/G) ---
  [upgradeKey(Race.Geists, 'caster', 'C')]: { ...cmStrip(sorcererL2Move, 456, 28, 12, 1.0), scale: 0.7 },
  [upgradeKey(Race.Geists, 'caster', 'F')]: { ...cmStrip(sorcererL3Move, 624, 44, 12, 1.0), scale: 0.8 },
  [upgradeKey(Race.Geists, 'caster', 'G')]: cmStrip(sorcererL4Move, 1488, 59, 24, 1.0),
  // --- Tenders melee: Ent LVL1 → LVL2/3/4 branch (B/D/E) ---
  [upgradeKey(Race.Tenders, 'melee', 'B')]: cmStrip(entL2Move, 828, 45, 12, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'D')]: cmStrip(entL3Move, 1548, 56, 18, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'E')]: cmStrip(entL4Move, 1416, 70, 24, 0.94),
  // --- Wild ranged: Gnoll → Snake branch (C/F/G) ---
  [upgradeKey(Race.Wild, 'ranged', 'C')]: tsSheet(snakeRun, 1536, 192, 0.64),
  [upgradeKey(Race.Wild, 'ranged', 'F')]: tsSheet(snakeRun, 1536, 192, 0.64),
  [upgradeKey(Race.Wild, 'ranged', 'G')]: tsSheet(snakeRun, 1536, 192, 0.64),
  // --- Crown melee: Warrior → King Human branch (C/F/G) — faces RIGHT natively ---
  [upgradeKey(Race.Crown, 'melee', 'C')]: cmStrip(kingHumanRun, 624, 58, 8, 0.74),
  [upgradeKey(Race.Crown, 'melee', 'F')]: cmStrip(kingHumanRun, 624, 58, 8, 0.74),
  [upgradeKey(Race.Crown, 'melee', 'G')]: { ...cmStrip(dwarfetteL4Move, 1876, 52, 28, 0.94), scale: 0.8 },
  // --- Deep melee: → Whale branch (B/D/E) — bigger aquatic elite ---
  [upgradeKey(Race.Deep, 'melee', 'B')]: { ...cmStrip(whaleRun, 952, 46, 14, 0.98), scale: 0.5 },
  [upgradeKey(Race.Deep, 'melee', 'D')]: { ...cmStrip(whaleRun, 952, 46, 14, 0.98), scale: 0.6 },
  [upgradeKey(Race.Deep, 'melee', 'E')]: { ...cmStrip(whaleRun, 952, 46, 14, 0.98), scale: 0.7 },
  // --- Deep ranged: → Crabby branch (C/F/G) ---
  [upgradeKey(Race.Deep, 'ranged', 'C')]: { ...cmStrip(crabbyRun, 432, 32, 6, 0.81), scale: 0.5 },
  [upgradeKey(Race.Deep, 'ranged', 'F')]: { ...cmStrip(crabbyRun, 432, 32, 6, 0.81), scale: 0.6 },
  [upgradeKey(Race.Deep, 'ranged', 'G')]: { ...cmStrip(crabbyRun, 432, 32, 6, 0.81), scale: 0.7 },
  // --- Geists ranged: → Skull branch (C/F/G) ---
  [upgradeKey(Race.Geists, 'ranged', 'C')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.3 },
  [upgradeKey(Race.Geists, 'ranged', 'F')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.4 },
  [upgradeKey(Race.Geists, 'ranged', 'G')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.5 },
  // --- Wild ranged: → Chameleon branch (B/D/E) — tongue lash ---
  [upgradeKey(Race.Wild, 'ranged', 'B')]: { ...cmStrip(chameleonRun, 672, 38, 8, 0.97), scale: 0.3, anchorX: 0.25 },
  [upgradeKey(Race.Wild, 'ranged', 'D')]: { ...cmStrip(chameleonRun, 672, 38, 8, 0.97), scale: 0.4, anchorX: 0.25 },
  [upgradeKey(Race.Wild, 'ranged', 'E')]: { ...cmStrip(chameleonRun, 672, 38, 8, 0.97), scale: 0.5, anchorX: 0.25 },
  // --- Goblins ranged: → Pig Bomber branch (C/F/G) ---
  [upgradeKey(Race.Goblins, 'ranged', 'C')]: { ...cmStrip(pigRun, 204, 28, 6, 0.89), scale: 0.5 },
  [upgradeKey(Race.Goblins, 'ranged', 'F')]: { ...cmStrip(kingPigRun, 228, 28, 6, 0.89), scale: 0.6 },
  [upgradeKey(Race.Goblins, 'ranged', 'G')]: { ...cmStrip(kingPigRun, 228, 28, 6, 0.89), scale: 0.6 },
  // --- Demon melee: unique color per upgrade (Silver→Devil→Orc→Frozen→Gold→Bioluminescent) ---
  [upgradeKey(Race.Demon, 'melee', 'B')]: { ...cmStrip(demonMeleeSilver, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'C')]: { ...cmStrip(demonMeleeDevil, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'D')]: { ...cmStrip(demonMeleeOrc, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'E')]: { ...cmStrip(demonMeleeFrozen, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'F')]: { ...cmStrip(demonMeleeGold, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'G')]: { ...cmStrip(demonMeleeBio, 78 * 8, 54, 8, 0.76), scale: 0.9 },
  // --- Tenders melee: → Radish branch (C/F/G) ---
  [upgradeKey(Race.Tenders, 'melee', 'C')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'melee', 'F')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'melee', 'G')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  // --- Goblins melee: → Troll branch (B/D/E) ---
  [upgradeKey(Race.Goblins, 'melee', 'B')]: { ...tsSheet(trollWalk, 3840, 384, 0.71), scale: 1.2 },
  [upgradeKey(Race.Goblins, 'melee', 'D')]: { ...tsSheet(trollWalk, 3840, 384, 0.71), scale: 1.5 },
  [upgradeKey(Race.Goblins, 'melee', 'E')]: { ...tsSheet(trollWalk, 3840, 384, 0.71), scale: 1.8 },
  // --- Crown melee: → Pirate branch (B/D/E) — Bald Pirate (RIGHT) → Captain (RIGHT) → Clown Nose (RIGHT) ---
  [upgradeKey(Race.Crown, 'melee', 'B')]: { ...cmStrip(baldPirateRun, 882, 67, 14, 0.97), scale: 0.55 },
  [upgradeKey(Race.Crown, 'melee', 'D')]: { ...cmStrip(captainRun, 1120, 72, 14, 0.97), scale: 0.5 },
  [upgradeKey(Race.Crown, 'melee', 'E')]: { ...cmStrip(clownNoseRun, 384, 40, 6, 0.73), scale: 0.6 },
  // --- Crown caster: Priest branch (B/D/E) → Human Wizard sheet ---
  [upgradeKey(Race.Crown, 'caster', 'C')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.25, animSpeed: 0.75 },
  [upgradeKey(Race.Crown, 'caster', 'F')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.35, animSpeed: 0.75 },
  [upgradeKey(Race.Crown, 'caster', 'G')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.45, animSpeed: 0.75 },
  // --- Deep ranged: → Fierce Tooth / shark branch (B/D/E) ---
  [upgradeKey(Race.Deep, 'ranged', 'B')]: { ...cmStrip(fierceToothRun, 204, 30, 6, 0.97), scale: 0.55 },
  [upgradeKey(Race.Deep, 'ranged', 'D')]: { ...cmStrip(fierceToothRun, 204, 30, 6, 0.97), scale: 0.6 },
  [upgradeKey(Race.Deep, 'ranged', 'E')]: { ...cmStrip(fierceToothRun, 204, 30, 6, 0.97), scale: 0.7 },
  // --- Deep caster: → Seashell / clam branch (C/F/G) ---
  [upgradeKey(Race.Deep, 'caster', 'C')]: { ...cmStrip(seashellOpening, 240, 38, 5, 1.0), scale: 0.5 },
  [upgradeKey(Race.Deep, 'caster', 'F')]: { ...cmStrip(seashellOpening, 240, 38, 5, 1.0), scale: 0.6 },
  [upgradeKey(Race.Deep, 'caster', 'G')]: { ...cmStrip(seashellOpening, 240, 38, 5, 1.0), scale: 0.7 },
  // --- Deep caster: → Pink Star / starfish branch (B/D/E) ---
  [upgradeKey(Race.Deep, 'caster', 'B')]: { ...cmStrip(pinkStarRun, 204, 30, 6, 0.97), scale: 0.55 },
  [upgradeKey(Race.Deep, 'caster', 'D')]: { ...cmStrip(pinkStarRun, 204, 30, 6, 0.97), scale: 0.6 },
  [upgradeKey(Race.Deep, 'caster', 'E')]: { ...cmStrip(pinkStarRun, 204, 30, 6, 0.97), scale: 0.7 },
};

const UPGRADE_IDLE_SPRITES: Record<string, SpriteDef> = {
  [upgradeKey(Race.Crown, 'caster', 'C')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.25, animSpeed: 0.75 },
  [upgradeKey(Race.Crown, 'caster', 'F')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.35, animSpeed: 0.75 },
  [upgradeKey(Race.Crown, 'caster', 'G')]: { ...rowStrip(humanWizardIdle, 256, 5, 0, 0.66), scale: 1.45, animSpeed: 0.75 },
};

const UPGRADE_ATK_SPRITES: Record<string, SpriteDef> = {
  // --- Geists melee: Mimic dash attacks ---
  [upgradeKey(Race.Geists, 'melee', 'C')]: { ...cmStrip(mimicL1Atk, 602, 32, 14), scale: 0.8 },
  [upgradeKey(Race.Geists, 'melee', 'F')]: { ...cmStrip(mimicL2Atk, 290, 38, 10), scale: 0.8 },
  [upgradeKey(Race.Geists, 'melee', 'G')]: cmStrip(mimicL4Atk, 1050, 69, 14),
  // --- Crown ranged: Dwarfette dash attacks (C/F), Cannon shoot (G) ---
  [upgradeKey(Race.Crown, 'ranged', 'C')]: { ...cmStrip(dwarfetteL1Atk, 368, 36, 8, 0.72), scale: 0.7 },
  [upgradeKey(Race.Crown, 'ranged', 'F')]: { ...cmStrip(dwarfetteL2Atk, 742, 35, 14, 0.89), scale: 0.7 },
  [upgradeKey(Race.Crown, 'ranged', 'G')]: { ...cmStrip(cannonShoot, 176, 28, 4, 0.95), flipX: true },
  // --- Horde: Orc color variant attacks ---
  [upgradeKey(Race.Horde, 'melee', 'B')]: { ...cmStrip(hordeMeleeAtkBlue, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'C')]: { ...cmStrip(hordeMeleeAtkRed, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'D')]: { ...cmStrip(hordeMeleeAtkBlue, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'E')]: { ...cmStrip(hordeMeleeAtkBlue, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'F')]: { ...cmStrip(hordeMeleeAtkRed, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'melee', 'G')]: { ...cmStrip(hordeMeleeAtkRed, 684, 58, 12), scale: 0.9 },
  [upgradeKey(Race.Horde, 'ranged', 'B')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'C')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'D')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'E')]: { ...cmStrip(hordeRangedAtkBlue, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'F')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'ranged', 'G')]: { ...cmStrip(hordeRangedAtkRed, 1332, 41, 18), scale: 0.74, heightScale: 0.74 },
  [upgradeKey(Race.Horde, 'caster', 'B')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'C')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'D')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'E')]: { ...cmStrip(hordeCasterAtkBlue, 380, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'F')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.445 },
  [upgradeKey(Race.Horde, 'caster', 'G')]: { ...cmStrip(hordeCasterAtkRed, 380, 26, 10), scale: 0.445 },
  // --- Wild melee: Bear (B/E) / Minotaur (D) / Snake (F) attacks ---
  [upgradeKey(Race.Wild, 'melee', 'B')]: tsSheet(bearAttack, 2304, 256, 0.69),
  [upgradeKey(Race.Wild, 'melee', 'C')]: { ...tsSheet(wildMeleeAtk, 1536, 192, 0.71), scale: 0.6 }, // Spider Brood attack
  [upgradeKey(Race.Wild, 'melee', 'D')]: { ...tsSheet(minotaurAttack, 3840, 320, 0.67), scale: 1.5 },
  [upgradeKey(Race.Wild, 'melee', 'E')]: { ...tsSheet(bearAttack, 2304, 256, 0.69), scale: 1.3 },
  [upgradeKey(Race.Wild, 'melee', 'F')]: { ...tsSheet(snakeAttack, 1152, 192, 0.64), scale: 0.6 }, // Viper Nest attack
  [upgradeKey(Race.Wild, 'melee', 'G')]: { ...tsSheet(wildMeleeAtk, 1536, 192, 0.71), scale: 0.5 }, // Spider Swarm attack
  // --- Wild ranged: Snake attack sprites (C/F/G) ---
  [upgradeKey(Race.Wild, 'ranged', 'C')]: tsSheet(snakeAttack, 1152, 192, 0.64),
  [upgradeKey(Race.Wild, 'ranged', 'F')]: tsSheet(snakeAttack, 1152, 192, 0.64),
  [upgradeKey(Race.Wild, 'ranged', 'G')]: tsSheet(snakeAttack, 1152, 192, 0.64),
  // --- Deep melee: Frog jump attacks ---
  [upgradeKey(Race.Deep, 'melee', 'C')]: { ...cmStrip(frogMonsterAtk, 672, 48, 14), animSpeed: 1.8, scale: 0.8 },
  [upgradeKey(Race.Deep, 'melee', 'F')]: { ...cmStrip(frogBossAtk, 2552, 138, 22, 0.90), animSpeed: 1.8, scale: 0.9 },
  [upgradeKey(Race.Deep, 'melee', 'G')]: { ...cmStrip(frogBossAtk, 2552, 138, 22, 0.90), animSpeed: 1.8 },
  // --- Tenders caster: Mushroom spell loop ---
  [upgradeKey(Race.Tenders, 'caster', 'C')]: { ...cmStrip(mushroomAtk, 714, 40, 14), scale: 0.6 },
  [upgradeKey(Race.Tenders, 'caster', 'F')]: { ...cmStrip(mushroomAtk, 714, 40, 14), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'caster', 'G')]: { ...cmStrip(mushroomAtk, 714, 40, 14), scale: 0.8 },
  // --- Geists caster: Sorcerer dash attacks ---
  [upgradeKey(Race.Geists, 'caster', 'C')]: { ...cmStrip(sorcererL2Atk, 380, 28, 10, 1.0), scale: 0.7 },
  [upgradeKey(Race.Geists, 'caster', 'F')]: { ...cmStrip(sorcererL3Atk, 832, 44, 16, 1.0), scale: 0.8 },
  [upgradeKey(Race.Geists, 'caster', 'G')]: cmStrip(sorcererL4Atk, 620, 59, 10, 0.98),
  // --- Tenders melee: Ent dash attacks ---
  [upgradeKey(Race.Tenders, 'melee', 'B')]: cmStrip(entL2Atk, 690, 45, 10, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'D')]: cmStrip(entL3Atk, 688, 56, 8, 0.94),
  [upgradeKey(Race.Tenders, 'melee', 'E')]: cmStrip(entL4Atk, 1888, 70, 32, 0.94),
  // --- Crown caster: Priest branch (B/D/E) → Human Wizard attack row ---
  [upgradeKey(Race.Crown, 'caster', 'C')]: { ...gridAnim(humanWizardAttack, 256, 256, 5, 5, 0.66), scale: 1.25, animSpeed: 1.0 },
  [upgradeKey(Race.Crown, 'caster', 'F')]: { ...gridAnim(humanWizardAttack, 256, 256, 5, 5, 0.66), scale: 1.35, animSpeed: 1.0 },
  [upgradeKey(Race.Crown, 'caster', 'G')]: { ...gridAnim(humanWizardAttack, 256, 256, 5, 5, 0.66), scale: 1.45, animSpeed: 1.0 },
  // --- Crown melee: King Human sword attacks (C/F), Dwarfette Champion (G) — faces RIGHT natively ---
  [upgradeKey(Race.Crown, 'melee', 'C')]: cmStrip(kingHumanAtk, 234, 58, 3, 0.74),
  [upgradeKey(Race.Crown, 'melee', 'F')]: cmStrip(kingHumanAtk, 234, 58, 3, 0.74),
  [upgradeKey(Race.Crown, 'melee', 'G')]: { ...cmStrip(dwarfetteL4Atk, 1072, 52, 16, 0.94), scale: 0.8 },
  // --- Deep melee: Whale bite (B/D/E) ---
  [upgradeKey(Race.Deep, 'melee', 'B')]: { ...cmStrip(whaleAtk, 748, 46, 11, 0.98), scale: 0.5 },
  [upgradeKey(Race.Deep, 'melee', 'D')]: { ...cmStrip(whaleAtk, 748, 46, 11, 0.98), scale: 0.6 },
  [upgradeKey(Race.Deep, 'melee', 'E')]: { ...cmStrip(whaleAtk, 748, 46, 11, 0.98), scale: 0.7 },
  // --- Deep ranged: Crabby claw attacks ---
  [upgradeKey(Race.Deep, 'ranged', 'C')]: { ...cmStrip(crabbyAtk, 288, 32, 4, 0.81), scale: 0.5 },
  [upgradeKey(Race.Deep, 'ranged', 'F')]: { ...cmStrip(crabbyAtk, 288, 32, 4, 0.81), scale: 0.6 },
  [upgradeKey(Race.Deep, 'ranged', 'G')]: { ...cmStrip(crabbyAtk, 288, 32, 4, 0.81), scale: 0.7 },
  // --- Geists ranged: Skull (uses same idle as attack, floating) ---
  [upgradeKey(Race.Geists, 'ranged', 'C')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.3 },
  [upgradeKey(Race.Geists, 'ranged', 'F')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.4 },
  [upgradeKey(Race.Geists, 'ranged', 'G')]: { ...cmStrip(skullIdle, 416, 54, 8, 0.96), scale: 0.5 },
  // --- Wild ranged: Chameleon tongue lash (B/D/E) ---
  [upgradeKey(Race.Wild, 'ranged', 'B')]: { ...cmStrip(chameleonAtk, 840, 38, 10, 0.97), scale: 0.3, anchorX: 0.25 },
  [upgradeKey(Race.Wild, 'ranged', 'D')]: { ...cmStrip(chameleonAtk, 840, 38, 10, 0.97), scale: 0.4, anchorX: 0.25 },
  [upgradeKey(Race.Wild, 'ranged', 'E')]: { ...cmStrip(chameleonAtk, 840, 38, 10, 0.97), scale: 0.5, anchorX: 0.25 },
  // --- Goblins ranged: Pig attacks ---
  [upgradeKey(Race.Goblins, 'ranged', 'C')]: { ...cmStrip(pigAtk, 170, 28, 5, 0.89), scale: 0.5 },
  [upgradeKey(Race.Goblins, 'ranged', 'F')]: { ...cmStrip(kingPigAtk, 190, 28, 5, 0.89), scale: 0.6 },
  [upgradeKey(Race.Goblins, 'ranged', 'G')]: { ...cmStrip(kingPigAtk, 190, 28, 5, 0.89), scale: 0.6 },
  // --- Demon melee: unique color per upgrade charge attacks ---
  [upgradeKey(Race.Demon, 'melee', 'B')]: { ...cmStrip(demonMeleeSilverAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'C')]: { ...cmStrip(demonMeleeDevilAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'D')]: { ...cmStrip(demonMeleeOrcAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'E')]: { ...cmStrip(demonMeleeFrozenAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'F')]: { ...cmStrip(demonMeleeGoldAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  [upgradeKey(Race.Demon, 'melee', 'G')]: { ...cmStrip(demonMeleeBioAtk, 3276, 54, 42, 0.76), scale: 0.9 },
  // --- Tenders melee: Radish (C/F/G, same anim for attack) ---
  [upgradeKey(Race.Tenders, 'melee', 'C')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'melee', 'F')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  [upgradeKey(Race.Tenders, 'melee', 'G')]: { ...cmStrip(radishRun, 360, 38, 12, 0.95), scale: 0.7 },
  // --- Goblins melee: Troll attacks (B/D/E) ---
  [upgradeKey(Race.Goblins, 'melee', 'B')]: { ...tsSheet(trollAtk, 2304, 384, 0.71), scale: 1.2 },
  [upgradeKey(Race.Goblins, 'melee', 'D')]: { ...tsSheet(trollAtk, 2304, 384, 0.71), scale: 1.5 },
  [upgradeKey(Race.Goblins, 'melee', 'E')]: { ...tsSheet(trollAtk, 2304, 384, 0.71), scale: 1.8 },
  // --- Crown melee: Pirate attacks (B/D/E) — all face RIGHT ---
  [upgradeKey(Race.Crown, 'melee', 'B')]: { ...cmStrip(baldPirateAtk, 756, 67, 12, 0.97), scale: 0.55 },
  [upgradeKey(Race.Crown, 'melee', 'D')]: { ...cmStrip(captainAtk, 560, 72, 7, 0.97), scale: 0.5 },
  [upgradeKey(Race.Crown, 'melee', 'E')]: { ...cmStrip(clownNoseAtk, 192, 40, 3, 0.73), scale: 0.6 },
  // --- Deep ranged: Fierce Tooth / shark attacks (B/D/E) ---
  [upgradeKey(Race.Deep, 'ranged', 'B')]: { ...cmStrip(fierceToothAtk, 170, 30, 5, 0.97), scale: 0.55 },
  [upgradeKey(Race.Deep, 'ranged', 'D')]: { ...cmStrip(fierceToothAtk, 170, 30, 5, 0.97), scale: 0.6 },
  [upgradeKey(Race.Deep, 'ranged', 'E')]: { ...cmStrip(fierceToothAtk, 170, 30, 5, 0.97), scale: 0.7 },
  // --- Deep caster: Seashell / clam bite attacks (C/F/G) ---
  [upgradeKey(Race.Deep, 'caster', 'C')]: { ...cmStrip(seashellBite, 288, 38, 6, 1.0), scale: 0.5 },
  [upgradeKey(Race.Deep, 'caster', 'F')]: { ...cmStrip(seashellBite, 288, 38, 6, 1.0), scale: 0.6 },
  [upgradeKey(Race.Deep, 'caster', 'G')]: { ...cmStrip(seashellBite, 288, 38, 6, 1.0), scale: 0.7 },
  // --- Deep caster: Pink Star / starfish spin attacks (B/D/E) ---
  [upgradeKey(Race.Deep, 'caster', 'B')]: { ...cmStrip(pinkStarAtk, 136, 30, 4, 0.97), scale: 0.55 },
  [upgradeKey(Race.Deep, 'caster', 'D')]: { ...cmStrip(pinkStarAtk, 136, 30, 4, 0.97), scale: 0.6 },
  [upgradeKey(Race.Deep, 'caster', 'E')]: { ...cmStrip(pinkStarAtk, 136, 30, 4, 0.97), scale: 0.7 },
};

// Harvester (Pawn) — player colored, state-based animations
// idle=8fr(1536), run=6fr(1152), runGold/runWood/runMeat=6fr(1152), mineGold=6fr(1152), mineWood=6fr(1152), mineMeat=4fr(768)
interface HarvesterSpriteSet {
  idle: SpriteDef;
  run: SpriteDef;
  runGold: SpriteDef;
  runWood: SpriteDef;
  runMeat: SpriteDef;
  mineGold: SpriteDef;
  mineWood: SpriteDef;
  mineMeat: SpriteDef;
}

function pawnSet(idle: string, run: string, runGold: string, runWood: string, runMeat: string,
  mineGold: string, mineWood: string, mineMeat: string): HarvesterSpriteSet {
  return {
    idle: tsSheet(idle, 1536, 192),
    run: tsSheet(run, 1152, 192),
    runGold: tsSheet(runGold, 1152, 192),
    runWood: tsSheet(runWood, 1152, 192),
    runMeat: tsSheet(runMeat, 1152, 192),
    mineGold: tsSheet(mineGold, 1152, 192),
    mineWood: tsSheet(mineWood, 1152, 192),
    mineMeat: tsSheet(mineMeat, 768, 192),
  };
}

const HARVESTER_SPRITES: { [pid: number]: HarvesterSpriteSet } = {
  0: pawnSet(harvesterBlue, harvesterBlueRun, harvesterBlueRunGold, harvesterBlueRunWood, harvesterBlueRunMeat, harvesterBlueMineGold, harvesterBlueMineWood, harvesterBlueMineMeat),
  1: pawnSet(harvesterPurple, harvesterPurpleRun, harvesterPurpleRunGold, harvesterPurpleRunWood, harvesterPurpleRunMeat, harvesterPurpleMineGold, harvesterPurpleMineWood, harvesterPurpleMineMeat),
  2: pawnSet(harvesterRed, harvesterRedRun, harvesterRedRunGold, harvesterRedRunWood, harvesterRedRunMeat, harvesterRedMineGold, harvesterRedMineWood, harvesterRedMineMeat),
  3: pawnSet(harvesterYellow, harvesterYellowRun, harvesterYellowRunGold, harvesterYellowRunWood, harvesterYellowRunMeat, harvesterYellowMineGold, harvesterYellowMineWood, harvesterYellowMineMeat),
  4: pawnSet(harvesterBlack, harvesterBlackRun, harvesterBlackRunGold, harvesterBlackRunWood, harvesterBlackRunMeat, harvesterBlackMineGold, harvesterBlackMineWood, harvesterBlackMineMeat),
};

// ============================================================
// BUILDING SPRITE LOOKUP
// ============================================================

// Number of unique building/harvester sprite color variants (Blue, Purple, Red, Yellow, Black)
const NUM_SPRITE_VARIANTS = 5;

// Player-keyed building URLs: "playerId/buildingKey"
const BUILDING_URLS: Record<string, string> = {
  '0/hut': blueHouse, '0/melee': blueBarracks, '0/ranged': blueArchery,
  '0/caster': blueMonastery, '0/tower': blueTower, '0/hq': blueCastle, '0/research': blueBarracks,
  '1/hut': purpleHouse, '1/melee': purpleBarracks, '1/ranged': purpleArchery,
  '1/caster': purpleMonastery, '1/tower': purpleTower, '1/hq': purpleCastle, '1/research': purpleBarracks,
  '2/hut': redHouse, '2/melee': redBarracks, '2/ranged': redArchery,
  '2/caster': redMonastery, '2/tower': redTower, '2/hq': redCastle, '2/research': redBarracks,
  '3/hut': yellowHouse, '3/melee': yellowBarracks, '3/ranged': yellowArchery,
  '3/caster': yellowMonastery, '3/tower': yellowTower, '3/hq': yellowCastle, '3/research': yellowBarracks,
  '4/hut': blackHouse, '4/melee': blackBarracks, '4/ranged': blackArchery,
  '4/caster': blackMonastery, '4/tower': blackTower, '4/hq': blackCastle, '4/research': blackBarracks,
};

// Isometric House2 variants for hut buildings
const ISO_HUT_URLS: Record<number, string> = {
  0: blueHouse2, 1: purpleHouse2, 2: redHouse2,
  3: yellowHouse2, 4: blackHouse2,
};

const BUILDING_KEY: Partial<Record<BuildingType, string>> = {
  [BuildingType.HarvesterHut]: 'hut',
  [BuildingType.MeleeSpawner]: 'melee',
  [BuildingType.RangedSpawner]: 'ranged',
  [BuildingType.CasterSpawner]: 'caster',
  [BuildingType.Tower]: 'tower',
  [BuildingType.Research]: 'research', // Barracks sprite (shared with melee spawner)
};

// ============================================================
// RACE-SPECIFIC BUILDING SPRITES (new asset packs)
// ============================================================

// Glob-import all building PNGs from the 4 new packs (resolved at build time by Vite)
const humanBldgModules = import.meta.glob<string>(
  '../assets/images/Medieval Human Building Pack*/Source/Human Building (*).png',
  { eager: true, import: 'default', query: '?url' }
);
const orcBldgModules = import.meta.glob<string>(
  '../assets/images/Fantasy RTS Orc Building*/Source/Orc Building (*).png',
  { eager: true, import: 'default', query: '?url' }
);
const elfBldgModules = import.meta.glob<string>(
  '../assets/images/Fantasy RTS Elven Building*/Source/Elf Building (*).png',
  { eager: true, import: 'default', query: '?url' }
);
const nightElfBldgModules = import.meta.glob<string>(
  '../assets/images/Stylized Night Elf RTS Building*/Source/NightEfl Building (*).png',
  { eager: true, import: 'default', query: '?url' }
);

function extractBldgUrl(modules: Record<string, string>, num: number): string | undefined {
  for (const [path, url] of Object.entries(modules)) {
    // Match "(N).png" at end of path
    const m = path.match(/\((\d+)\)\.png$/);
    if (m && parseInt(m[1]) === num) return url;
  }
  return undefined;
}

function H(n: number) { return extractBldgUrl(humanBldgModules, n); }
function O(n: number) { return extractBldgUrl(orcBldgModules, n); }
function E(n: number) { return extractBldgUrl(elfBldgModules, n); }
function N(n: number) { return extractBldgUrl(nightElfBldgModules, n); }

// Key: "race:buildingKey:upgradeNode" → asset URL
// buildingKey = melee|ranged|caster|tower|hut|research
// upgradeNode = A|B|C|D|E|F|G
// Rules: each asset appears at most once per race across all building types.
// Reuse within a building is only along the same upgrade path (inherits parent art).
// Missing nodes inherit from parent: D→B→A, E→B→A, F→C→A, G→C→A.
const RACE_BUILDING_SPRITES: Record<string, string | undefined> = {
  // === CROWN (T0 = Tiny Swords, upgrades from Human Pack) ===
  'crown:research:A': H(6), 'crown:foundry:A': H(102),
  'crown:melee:A': H(103), 'crown:melee:B': H(104), 'crown:melee:C': H(105),
  'crown:melee:D': H(106), 'crown:melee:E': H(107), 'crown:melee:F': H(108), 'crown:melee:G': H(109),
  'crown:ranged:A': H(110), 'crown:ranged:B': H(111), 'crown:ranged:C': H(112),
  'crown:ranged:D': H(113), 'crown:ranged:E': H(114), 'crown:ranged:F': H(115), 'crown:ranged:G': H(116),
  'crown:caster:A': H(95), 'crown:caster:B': H(96), 'crown:caster:C': H(97),
  'crown:caster:D': H(98), 'crown:caster:E': H(99), 'crown:caster:F': H(100), 'crown:caster:G': H(101),
  'crown:tower:A': H(117), 'crown:tower:B': H(118), 'crown:tower:C': H(119),
  'crown:tower:D': H(120), 'crown:tower:E': H(121), 'crown:tower:F': H(122), 'crown:tower:G': H(123),

  // === GOBLINS (Human Pack) ===
  'goblins:research:A': H(18), 'goblins:hut:A': H(79), 'goblins:potionshop:A': H(87),
  'goblins:melee:A': H(80), 'goblins:melee:B': H(81), 'goblins:melee:C': H(82),
  'goblins:melee:D': H(83), 'goblins:melee:E': H(84), 'goblins:melee:F': H(85), 'goblins:melee:G': H(86),
  'goblins:ranged:A': H(88), 'goblins:ranged:B': H(89), 'goblins:ranged:C': H(90),
  'goblins:ranged:D': H(91), 'goblins:ranged:E': H(92), 'goblins:ranged:F': H(93), 'goblins:ranged:G': H(94),
  'goblins:caster:A': H(72), 'goblins:caster:B': H(73), 'goblins:caster:C': H(74),
  'goblins:caster:D': H(75), 'goblins:caster:E': H(76), 'goblins:caster:F': H(77), 'goblins:caster:G': H(78),
  'goblins:tower:A': H(65), 'goblins:tower:B': H(66), 'goblins:tower:C': H(67),
  'goblins:tower:D': H(68), 'goblins:tower:E': H(69), 'goblins:tower:F': H(70), 'goblins:tower:G': H(71),

  // === HORDE (Orc Pack — warm tribal) ===
  'horde:research:A': O(38), 'horde:hut:A': O(66),
  'horde:melee:A': O(67), 'horde:melee:B': O(68), 'horde:melee:C': O(69),
  'horde:melee:D': O(70), 'horde:melee:E': O(71), 'horde:melee:F': O(72), 'horde:melee:G': O(73),
  'horde:ranged:A': O(74), 'horde:ranged:B': O(75), 'horde:ranged:C': O(76),
  'horde:ranged:D': O(77), 'horde:ranged:E': O(78), 'horde:ranged:F': O(79), 'horde:ranged:G': O(80),
  'horde:caster:A': O(59), 'horde:caster:B': O(60), 'horde:caster:C': O(61),
  'horde:caster:D': O(62), 'horde:caster:E': O(63), 'horde:caster:F': O(64), 'horde:caster:G': O(65),
  'horde:tower:A': O(81), 'horde:tower:B': O(82), 'horde:tower:C': O(83),
  'horde:tower:D': O(84), 'horde:tower:E': O(85), 'horde:tower:F': O(86), 'horde:tower:G': O(87),

  // === DEMON (Orc Pack — dark/fire/menace) ===
  'demon:research:A': O(33), 'demon:hut:A': O(95),
  'demon:melee:A': O(96), 'demon:melee:B': O(97), 'demon:melee:C': O(98),
  'demon:melee:D': O(99), 'demon:melee:E': O(100), 'demon:melee:F': O(101), 'demon:melee:G': O(102),
  'demon:ranged:A': O(103), 'demon:ranged:B': O(104), 'demon:ranged:C': O(105),
  'demon:ranged:D': O(106), 'demon:ranged:E': O(107), 'demon:ranged:F': O(108), 'demon:ranged:G': O(109),
  'demon:caster:A': O(88), 'demon:caster:B': O(89), 'demon:caster:C': O(90),
  'demon:caster:D': O(91), 'demon:caster:E': O(92), 'demon:caster:F': O(93), 'demon:caster:G': O(94),
  'demon:tower:A': O(110), 'demon:tower:B': O(111), 'demon:tower:C': O(112),
  'demon:tower:D': O(113), 'demon:tower:E': O(114), 'demon:tower:F': O(115), 'demon:tower:G': O(116),

  // === TENDERS (Elf Pack — nature/healing) ===
  'tenders:research:A': E(1), 'tenders:hut:A': E(90),
  'tenders:melee:A': E(91), 'tenders:melee:B': E(92), 'tenders:melee:C': E(93),
  'tenders:melee:D': E(94), 'tenders:melee:E': E(95), 'tenders:melee:F': E(96), 'tenders:melee:G': E(97),
  'tenders:ranged:A': E(98), 'tenders:ranged:B': E(99), 'tenders:ranged:C': E(100),
  'tenders:ranged:D': E(101), 'tenders:ranged:E': E(102), 'tenders:ranged:F': E(103), 'tenders:ranged:G': E(104),
  'tenders:caster:A': E(83), 'tenders:caster:B': E(84), 'tenders:caster:C': E(85),
  'tenders:caster:D': E(86), 'tenders:caster:E': E(87), 'tenders:caster:F': E(88), 'tenders:caster:G': E(89),
  'tenders:tower:A': E(105), 'tenders:tower:B': E(106), 'tenders:tower:C': E(107),
  'tenders:tower:D': E(108), 'tenders:tower:E': E(109), 'tenders:tower:F': E(110), 'tenders:tower:G': E(111),
  // E inherits B=E(18), F inherits C=E(19)

  // === WILD (Elf Pack — feral/aggressive) ===
  'wild:research:A': E(2), 'wild:hut:A': E(61),
  'wild:melee:A': E(62), 'wild:melee:B': E(63), 'wild:melee:C': E(64),
  'wild:melee:D': E(65), 'wild:melee:E': E(66), 'wild:melee:F': E(67), 'wild:melee:G': E(68),
  // F inherits C=E(28), G inherits C=E(28)
  'wild:ranged:A': E(69), 'wild:ranged:B': E(70), 'wild:ranged:C': E(71),
  'wild:ranged:D': E(72), 'wild:ranged:E': E(73), 'wild:ranged:F': E(74), 'wild:ranged:G': E(75),
  'wild:caster:A': E(54), 'wild:caster:B': E(55), 'wild:caster:C': E(56),
  'wild:caster:D': E(57), 'wild:caster:E': E(58), 'wild:caster:F': E(59), 'wild:caster:G': E(60),
  // D/E inherit B=E(23), F/G inherit C=E(44)
  'wild:tower:A': E(76), 'wild:tower:B': E(77), 'wild:tower:C': E(78),
  'wild:tower:D': E(79), 'wild:tower:E': E(80), 'wild:tower:F': E(81), 'wild:tower:G': E(82),

  // === DEEP (NightElf Pack — teal/aquatic) ===
  'deep:research:A': N(22), 'deep:hut:A': N(129),
  'deep:melee:A': N(130), 'deep:melee:B': N(131), 'deep:melee:C': N(132),
  'deep:melee:D': N(133), 'deep:melee:E': N(134), 'deep:melee:F': N(135), 'deep:melee:G': N(136),
  'deep:ranged:A': N(137), 'deep:ranged:B': N(138), 'deep:ranged:C': N(139),
  'deep:ranged:D': N(140), 'deep:ranged:E': N(141), 'deep:ranged:F': N(142), 'deep:ranged:G': N(143),
  'deep:caster:A': N(122), 'deep:caster:B': N(123), 'deep:caster:C': N(124),
  'deep:caster:D': N(125), 'deep:caster:E': N(126), 'deep:caster:F': N(127), 'deep:caster:G': N(128),
  'deep:tower:A': N(56), 'deep:tower:B': N(57), 'deep:tower:C': N(58),
  'deep:tower:D': N(59), 'deep:tower:E': N(60), 'deep:tower:F': N(61), 'deep:tower:G': N(62),

  // === GEISTS (NightElf Pack — purple/dark/undead) ===
  // 16 assets: N(1,10,14,15,16,17,21,24,27,30,32,33,36,37,40,43)
  // research=N(1), hut=N(14), melee=N(15), ranged=N(17), caster=N(21), tower=N(36)
  // Remaining for upgrades: N(10,16,24,27,30,32,33,37,40,43)
  'geists:research:A': N(1), 'geists:hut:A': N(107),
  'geists:melee:A': N(108), 'geists:melee:B': N(109), 'geists:melee:C': N(110),
  'geists:melee:D': N(111), 'geists:melee:E': N(112), 'geists:melee:F': N(113), 'geists:melee:G': N(114),
  'geists:ranged:A': N(115), 'geists:ranged:B': N(116), 'geists:ranged:C': N(117),
  'geists:ranged:D': N(118), 'geists:ranged:E': N(119), 'geists:ranged:F': N(120), 'geists:ranged:G': N(121),
  'geists:caster:A': N(100), 'geists:caster:B': N(101), 'geists:caster:C': N(102),
  'geists:caster:D': N(103), 'geists:caster:E': N(104), 'geists:caster:F': N(105), 'geists:caster:G': N(106),
  'geists:tower:A': N(93), 'geists:tower:B': N(94), 'geists:tower:C': N(98),
  'geists:tower:D': N(96), 'geists:tower:E': N(97), 'geists:tower:F': N(95), 'geists:tower:G': N(99),
  // all tower upgrades inherit base — N(36) only used here

  // === OOZLINGS (NightElf Pack — green/alchemical) ===
  // 12 assets: N(2,3,4,5,6,8,18,23,25,28,41,44)
  // research=N(3), hut=N(28), melee=N(5), ranged=N(8), caster=N(18), tower=N(41)
  // Remaining unique for upgrades: N(2,4,6,23,25,44)
  'oozlings:research:A': N(3), 'oozlings:hut:A': N(77),
  'oozlings:melee:A': N(78), 'oozlings:melee:B': N(79), 'oozlings:melee:C': N(80),
  'oozlings:melee:D': N(81), 'oozlings:melee:E': N(82), 'oozlings:melee:F': N(83), 'oozlings:melee:G': N(84),
  'oozlings:ranged:A': N(86), 'oozlings:ranged:B': N(87), 'oozlings:ranged:C': N(88),
  'oozlings:ranged:D': N(89), 'oozlings:ranged:E': N(90), 'oozlings:ranged:F': N(91), 'oozlings:ranged:G': N(92),
  'oozlings:caster:A': N(70), 'oozlings:caster:B': N(71), 'oozlings:caster:C': N(72),
  'oozlings:caster:D': N(73), 'oozlings:caster:E': N(74), 'oozlings:caster:F': N(75), 'oozlings:caster:G': N(76),
  'oozlings:tower:A': N(63), 'oozlings:tower:B': N(64), 'oozlings:tower:C': N(65),
  'oozlings:tower:D': N(66), 'oozlings:tower:E': N(67), 'oozlings:tower:F': N(68), 'oozlings:tower:G': N(69),
};

const RACE_KEY: Record<Race, string> = {
  [Race.Crown]: 'crown', [Race.Horde]: 'horde', [Race.Goblins]: 'goblins',
  [Race.Oozlings]: 'oozlings', [Race.Demon]: 'demon', [Race.Deep]: 'deep',
  [Race.Wild]: 'wild', [Race.Geists]: 'geists', [Race.Tenders]: 'tenders',
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
  tree: { url: tree1, frameW: 192, frameH: 256, cols: 8, groundY: 0.71 },
  tree2: { url: tree2, frameW: 192, frameH: 256, cols: 8, groundY: 0.71 },
  tree3: { url: tree3, frameW: 192, frameH: 192, cols: 8, groundY: 0.71 },
  sheep: tsSheet(sheepIdle, 768, 128),
  sheepGrass: tsSheet(sheepGrass, 1536, 128),
  meatResource: singleFrame(meatResource, 64, 64),
  rock: singleFrame(rock1, 64, 64),
  diamond: cmStrip(blueDiamondIdle, 96, 24, 4, 0.9),
  // UI resource icons (cleaner for HUD / race select)
  uiGold: singleFrame(uiIconGold, 64, 64),
  uiWood: singleFrame(uiIconWood, 64, 64),
  uiMeat: singleFrame(uiIconMeat, 64, 64),
  uiMana: singleFrame(uiIconMana, 1024, 1024),
  uiSouls: singleFrame(uiIconSouls, 1024, 1024),
  uiOoze: singleFrame(uiIconOoze, 1024, 1024),
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
  bush3: tsSheet(bush3, 1024, 128),
  bush4: tsSheet(bush4, 1024, 128),
  tilemap2: singleFrame(tilemapColor2, 576, 384),
  tilemap3: singleFrame(tilemapColor3, 576, 384),
  tilemap4: singleFrame(tilemapColor4, 576, 384),
  tilemap5: singleFrame(tilemapColor5, 576, 384),
  shadow: singleFrame(terrainShadow, 128, 128),
  rock2: singleFrame(rock2, 64, 64),
  rock3: singleFrame(rock3, 64, 64),
  rock4: singleFrame(rock4, 64, 64),
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

// Bone projectile: 4x1 spritesheet (256x64, use first frame 64x64)
const BONE_SPRITE: SpriteDef = singleFrame(gnollBone, 64, 64, 0.5);

// Per-unit projectile sprites (128x128 single-frame PNGs)
const PROJECTILE_SPRITES: Record<string, SpriteDef> = {
  arrow:          singleFrame(projArrow, 128, 128),
  dagger:         singleFrame(projDagger, 128, 128),
  fire_arrow:     singleFrame(projFireArrow, 128, 128),
  fire_bolt:      singleFrame(projFireBolt, 128, 128),
  harpoon:        singleFrame(projHarpoon, 128, 128),
  holy_bolt:      singleFrame(projHolyBolt, 128, 128),
  magic_missile:  singleFrame(projMagicMissile, 128, 128),
  music_note:     singleFrame(projMusicNote, 128, 128),
  nature_bolt:    singleFrame(projNatureBolt, 128, 128),
  poison_arrow:   singleFrame(projPoisonArrow, 128, 128),
  shadow_bolt:    singleFrame(projShadowBolt, 128, 128),
  slime_missile:  singleFrame(projSlimeMissile, 128, 128),
  stone_ball:     singleFrame(projStoneBall, 128, 128),
  water_bolt:     singleFrame(projWaterBolt, 128, 128),
  ice_arrow:      singleFrame(projIceArrow, 128, 128),
  acid_spit:      singleFrame(projAcidSpit, 128, 128),
  shadow_arrow:   singleFrame(projShadowArrow, 128, 128),
};

// Sprite keys that should spin in addition to rotating toward target
const SPINNING_PROJECTILES = new Set(['stone_ball']);

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

  /** Get a race-specific ability building sprite (e.g. foundry, potionshop) */
  getRaceBuildingSprite(race: Race, key: string): HTMLImageElement | null {
    const rk = RACE_KEY[race];
    const url = RACE_BUILDING_SPRITES[`${rk}:${key}:A`];
    return url ? this.loadImage(url) : null;
  }

  /** Returns true if a race-specific (non-Tiny Swords) sprite would be used for this building. */
  isRacePackSprite(type: BuildingType, race?: Race, upgradePath?: string[]): boolean {
    if (race == null) return false;
    const bKey = BUILDING_KEY[type];
    if (!bKey) return false;
    const rk = RACE_KEY[race];
    const PARENT: Record<string, string> = { D: 'B', E: 'B', F: 'C', G: 'C', B: 'A', C: 'A' };
    let node = upgradePath && upgradePath.length >= 2
      ? upgradePath[upgradePath.length - 1]
      : 'A';
    while (node) {
      if (RACE_BUILDING_SPRITES[`${rk}:${bKey}:${node}`]) return true;
      node = PARENT[node] ?? (node === 'A' ? '' : 'A');
      if (node === '') break;
    }
    return false;
  }

  getBuildingSprite(type: BuildingType, playerId: number, _isometric = false, race?: Race, upgradePath?: string[]): HTMLImageElement | null {
    const bKey = BUILDING_KEY[type];
    if (!bKey) return null;

    // Try race-specific building sprite first — walk up the upgrade path
    // Path inheritance: D→B→A, E→B→A, F→C→A, G→C→A
    if (race != null) {
      const rk = RACE_KEY[race];
      const PARENT: Record<string, string> = { D: 'B', E: 'B', F: 'C', G: 'C', B: 'A', C: 'A' };
      let node = upgradePath && upgradePath.length >= 2
        ? upgradePath[upgradePath.length - 1]
        : 'A';
      // Walk up: exact node → parent → grandparent → A
      while (node) {
        const url = RACE_BUILDING_SPRITES[`${rk}:${bKey}:${node}`];
        if (url) return this.loadImage(url);
        node = PARENT[node] ?? (node === 'A' ? '' : 'A');
        if (node === '') break;
      }
    }

    // Fall back to Tiny Swords
    const vid = playerId % NUM_SPRITE_VARIANTS;
    if (bKey === 'hut') {
      const isoUrl = ISO_HUT_URLS[vid];
      if (isoUrl) return this.loadImage(isoUrl);
    }
    const url = BUILDING_URLS[`${vid}/${bKey}`];
    return url ? this.loadImage(url) : null;
  }

  getHQSprite(playerId: number): HTMLImageElement | null {
    const url = BUILDING_URLS[`${playerId % NUM_SPRITE_VARIANTS}/hq`];
    return url ? this.loadImage(url) : null;
  }

  getSeedSprite(): [HTMLImageElement, SpriteDef] | null {
    const img = this.loadImage(SEED_SPRITE_DEF.url);
    return img ? [img, SEED_SPRITE_DEF] : null;
  }

  getFoundrySprite(): HTMLImageElement | null {
    return this.loadImage(foundryHelmUrl);
  }

  getGlobuleSprite(): HTMLImageElement | null {
    return this.loadImage(globuleSpriteUrl);
  }

  /** Animated idle wobble for globule building (Lvl05 Move strip, 6 frames) */
  getGlobuleIdleSprite(): [HTMLImageElement, SpriteDef] | null {
    const img = this.loadImage(globuleIdleUrl);
    const def: SpriteDef = { url: globuleIdleUrl, frameW: 30, frameH: 24, cols: 6, groundY: 0.93 };
    return img ? [img, def] : null;
  }

  /** Spawn wiggle for globule building (Lvl05 ATK_Down strip, 11 frames) */
  getGlobuleAtkSprite(): [HTMLImageElement, SpriteDef] | null {
    const img = this.loadImage(globuleAtkUrl);
    const def: SpriteDef = { url: globuleAtkUrl, frameW: 50, frameH: 40, cols: 11, groundY: 0.93 };
    return img ? [img, def] : null;
  }

  getBlackHoleSprite(): HTMLImageElement | null {
    return this.loadImage(fxBlackHole);
  }

  getGoldenSkullSprite(): HTMLImageElement | null {
    return this.loadImage(goldenSkull);
  }

  getMeteoriteSprite(color: 'orange' | 'green' | 'purple'): HTMLImageElement | null {
    const url = color === 'orange' ? fxMeteoriteOrange : color === 'green' ? fxMeteoriteGreen : fxMeteoritePurple;
    return this.loadImage(url);
  }

  getStarShineSprite(color: 'blue' | 'pink'): HTMLImageElement | null {
    return this.loadImage(color === 'blue' ? fxStarShineBlue : fxStarShinePink);
  }

  getEclipseSprite(): HTMLImageElement | null {
    return this.loadImage(fxEclipse);
  }

  // --- Units ---

  /** Check if a dedicated attack sprite exists for this unit config. */
  hasAttackSprite(race: Race, category: UnitCategory, upgradeNode?: string): boolean {
    if (upgradeNode) {
      const key = upgradeKey(race, category, upgradeNode);
      if (UPGRADE_ATK_SPRITES[key]) return true;
    }
    const atkSprites = RACE_ATK_SPRITES[race];
    return !!(atkSprites?.[category]);
  }

  hasIdleSprite(race: Race, category: UnitCategory, upgradeNode?: string): boolean {
    if (!upgradeNode) return false;
    const key = upgradeKey(race, category, upgradeNode);
    return !!UPGRADE_IDLE_SPRITES[key];
  }

  getUnitSprite(
    race: Race,
    category: UnitCategory,
    playerId: number,
    attacking = false,
    upgradeNode?: string,
    preferIdle = false,
  ): [HTMLImageElement, SpriteDef] | null {
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
      if (preferIdle) {
        const idleDef = UPGRADE_IDLE_SPRITES[key];
        if (idleDef) {
          const idleImg = this.loadImage(idleDef.url);
          if (idleImg) return [idleImg, idleDef];
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
        const atkDef: SpriteDef = (0 in atkRaw) ? (atkRaw as PlayerVariants)[playerId % NUM_SPRITE_VARIANTS] ?? (atkRaw as PlayerVariants)[0] : atkRaw as SpriteDef;
        const atkImg = this.loadImage(atkDef.url);
        if (atkImg) return [atkImg, atkDef];
      }
    }
    // Fallback to idle/move sprite
    const raceSprites = RACE_UNIT_SPRITES[race];
    if (!raceSprites) return null;
    const raw = raceSprites[category];
    const def: SpriteDef = (0 in raw) ? (raw as PlayerVariants)[playerId % NUM_SPRITE_VARIANTS] ?? (raw as PlayerVariants)[0] : raw as SpriteDef;
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
    const set = HARVESTER_SPRITES[playerId % NUM_SPRITE_VARIANTS] ?? HARVESTER_SPRITES[0];
    let def: SpriteDef;

    if (state === 'mining') {
      // Mining animation based on resource assignment
      if (assignment === 'wood') def = set.mineWood;
      else if (assignment === 'meat') def = set.mineMeat;
      else def = set.mineGold; // base_gold and center both mine gold
    } else if (state === 'walking_home' && carryingResource) {
      // Carrying resource home
      if (carryingResource === ResourceType.Wood) def = set.runWood;
      else if (carryingResource === ResourceType.Meat) def = set.runMeat;
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

  /** Get arrow sprite for ranged units (team 0=bottom, 1=top) */
  getArrowSprite(team: number): [HTMLImageElement, SpriteDef] | null {
    const def = ARROW_SPRITES[team] ?? ARROW_SPRITES[0];
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  // --- Potions (Goblin Potion Shop) ---

  private static POTION_DEFS: Record<string, { url: string; def: SpriteDef }> = {
    blue:  { url: bluePotionIdle,  def: { url: bluePotionIdle,  frameW: 13, frameH: 17, cols: 7, groundY: 0.9 } },
    red:   { url: redPotionIdle,   def: { url: redPotionIdle,   frameW: 13, frameH: 17, cols: 7, groundY: 0.9 } },
    green: { url: greenPotionIdle, def: { url: greenPotionIdle, frameW: 13, frameH: 17, cols: 7, groundY: 0.9 } },
  };

  getPotionSprite(color: 'blue' | 'red' | 'green'): [HTMLImageElement, SpriteDef] | null {
    const p = SpriteLoader.POTION_DEFS[color];
    const img = this.loadImage(p.url);
    return img ? [img, p.def] : null;
  }

  /** Get bone projectile sprite (Wild Bonechucker) */
  getBoneSprite(): [HTMLImageElement, SpriteDef] | null {
    const img = this.loadImage(BONE_SPRITE.url);
    return img ? [img, BONE_SPRITE] : null;
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

  /** Get a named projectile sprite (per-unit sprites) */
  getProjectileSprite(key: string): [HTMLImageElement, SpriteDef] | null {
    const def = PROJECTILE_SPRITES[key];
    if (!def) return null;
    const img = this.loadImage(def.url);
    return img ? [img, def] : null;
  }

  /** Whether this sprite key should spin (e.g. stone_ball) */
  isSpinningProjectile(key: string): boolean {
    return SPINNING_PROJECTILES.has(key);
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
    // Isometric House2 variants
    for (const url of Object.values(ISO_HUT_URLS)) urls.add(url);

    // Resource sprites
    for (const def of Object.values(RESOURCE_SPRITES)) urls.add(def.url);

    // Terrain sprites
    for (const def of Object.values(TERRAIN_SPRITES)) urls.add(def.url);

    // FX sprites
    for (const def of Object.values(FX_SPRITES)) urls.add(def.url);

    // Projectile sprites
    for (const def of Object.values(ARROW_SPRITES)) urls.add(def.url);
    urls.add(BONE_SPRITE.url);
    for (const def of Object.values(ORB_SM)) urls.add(def.url);
    for (const def of Object.values(ORB_LG)) urls.add(def.url);
    for (const def of Object.values(CIRCLE_SM)) urls.add(def.url);
    for (const def of Object.values(CIRCLE_LG)) urls.add(def.url);
    for (const def of Object.values(PROJECTILE_SPRITES)) urls.add(def.url);

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
  const totalFrames = def.cols * (def.rows ?? 1);
  const f = frame % totalFrames;
  const col = f % def.cols;
  const row = Math.floor(f / def.cols);
  const sx = (def.srcX ?? 0) + col * def.frameW;
  const sy = (def.srcY ?? 0) + row * def.frameH;
  ctx.drawImage(img, sx, sy, def.frameW, def.frameH, dx, dy, drawW, drawH);
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
