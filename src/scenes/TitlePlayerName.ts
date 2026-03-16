// ─── Random name generator ───

const NAME_PRE = [
  'Swift','Bold','Iron','Dark','Grim','Red','Brave','Fell','Storm','Ash',
  'Dire','Wild','Pale','Dread','Cold','Keen','Lone','Mad','Old','Sly',
  'Tall','Wry','Stark','Void','Grey','Dusk','Dawn','Frost','Flame','Stone',
  'Thorn','Shade','Ghost','Blood','War','Sky','Sea','Rust','Bone','Grit',
  'Hex','Doom','Foul','Bleak','Gilt','Numb','Rot','Fey','Brisk','Woe',
  'Gloom','Soot','Moss','Brine','Slag','Char','Murk','Haze','Mire','Smog',
  'Dust','Vex','Jinx','Gale','Pyre','Bile','Scorn','Wilt','Ruin','Blight',
  'Sleet','Barb','Crag','Gorge','Marsh','Ember','Chill','Blaze','Wisp','Lurk',
  'Gaunt','Brute','Crook','Rogue','Fiend','Wraith','Snarl','Dour','Blunt','Coil',
  'Crude','Scrap','Crux','Sleek','Bliss','Vigor','Noble','Sage','Grand','Prime',
];
const NAME_SUF = [
  'Wolf','Blade','Fang','Hawk','Thorn','Raven','Viper','Bear','Fox','Crow',
  'Skull','Horn','Shard','Bane','Drake','Helm','Root','Wyrm','Claw','Axe',
  'Pike','Mace','Bow','Warg','Orc','Fist','Maw','Spine','Tooth','Hide',
  'Bone','Eye','Tail','Wing','Scale','Hoof','Pelt','Tusk','Fin','Snout',
  'Beak','Talon','Barb','Sting','Coil','Gut','Mane','Brood','Husk','Shell',
  'Reef','Knot','Burr','Gnarl','Stump','Slab','Flint','Ore','Silt','Peat',
  'Grub','Mite','Newt','Shrew','Toad','Wasp','Moth','Slug','Wren','Lark',
  'Asp','Lynx','Ram','Boar','Stag','Hart','Bull','Hound','Crane','Eel',
  'Carp','Squid','Shark','Crow','Rook','Jay','Finch','Dove','Owl','Bat',
  'Rat','Stoat','Otter','Mink','Yak','Ibex','Goat','Lamb','Colt','Foal',
];

export function randomName(): string {
  const pre = NAME_PRE[Math.floor(Math.random() * NAME_PRE.length)];
  const suf = NAME_SUF[Math.floor(Math.random() * NAME_SUF.length)];
  return `${pre}${suf}`;
}

export function loadPlayerName(): string {
  try {
    const saved = localStorage.getItem('lanecraft_name');
    if (saved) return saved;
    const name = randomName();
    savePlayerName(name);
    return name;
  } catch { return randomName(); }
}

export function savePlayerName(name: string): void {
  try { localStorage.setItem('lanecraft_name', name); } catch {}
}
