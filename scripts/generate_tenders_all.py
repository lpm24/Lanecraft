"""
Generate ALL Tenders buildings using the trained LoRA.
Tenders = nature guardians with actual homes/structures (unlike Wild's animal habitats).
Melee: ents (living trees) and radishes (root vegetables come alive). Buildings = groves, tree homes.
Ranged: gnomes/tinkers. Buildings = cozy gnome workshops, inventor shacks.
Caster B branch: panda druids (bloom/heal). C branch: mushroom casters (spore/fungal).
Tower: living thorn walls and vine structures.
Aesthetic: warm, cozy, nature-magic, gardens, flowers, mushrooms, living wood.
"""

import os
import sys
import time
import urllib.request

try:
    import replicate
except ImportError:
    print("ERROR: pip install replicate")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "tenders_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Tenders: warm nature, living wood, flowers, gardens, cozy homes
# Different from Wild — these are CIVILIZED nature beings with actual structures
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "nature guardian architecture, living wood and growing plants, "
    "warm cozy aesthetic, flowers blooming, green leaves, garden paths, "
    "magical nature energy, soft green glow, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE GROVE (Sapling=ent -> Young Ent/Wild Radish -> Elder Ent/Ancient Ent/Radish Brute/Radish King) ===
    ("melee", "A", "Sapling Grove", (
        "small ent sapling grove, a young living tree with a face in the bark, "
        "small garden around its roots, tiny flowers blooming, "
        "the tree IS the building — a sentient sapling nursery, compact and green"
    )),
    ("melee", "B", "Young Ent Grove", (
        "medium ent grove, a larger living tree home with branch arms and bark face, "
        "leafy canopy roof, roots forming walls, wooden door in the trunk, "
        "emphasis on STRENGTH — thicker trunk, stronger branches, moss-covered bark"
    )),
    ("melee", "C", "Radish Garden", (
        "medium radish garden, a vegetable garden patch with large magical radishes growing, "
        "radish-shaped hut partially underground, leafy green tops sticking up, "
        "emphasis on REGENERATION — rich garden soil, growing vegetables, healing roots, "
        "same size as B but garden-themed instead of tree-themed"
    )),
    ("melee", "D", "Elder Ent Grove", (
        "large ancient ent home, an enormous old tree with a wise bark face, "
        "thick gnarled branches forming protective walls, moss and lichen everywhere, "
        "emphasis on TOUGHNESS — ancient hardwood, deep roots, unshakeable, "
        "same scale as E/F/G"
    )),
    ("melee", "E", "Ancient Ent Grove", (
        "large ancient ent fortress, a massive centuries-old tree with powerful branch arms, "
        "the tree looks like it could walk, enormous trunk, battle-scarred bark, "
        "emphasis on KNOCKBACK POWER — the mightiest tree in the forest, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Radish Brute Garden", (
        "large radish warrior garden, an enormous magical radish growing from rich soil, "
        "the radish is muscular and imposing, thick leafy top, reinforced root walls, "
        "emphasis on REGENERATION — constantly regrowing, healing soil energy, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Radish King Garden", (
        "large radish king's royal garden, the most magnificent radish garden, "
        "a crowned radish on a throne of roots, flower crown, royal garden beds, "
        "emphasis on SPEED and POWER — the radish king's domain, golden leaf crown, "
        "same scale as D/E/F"
    )),

    # === RANGED BOWER (Thorn Shooter=gnome -> Heavy Tinker/Thorn Thrower -> Blight/Grand/Toxic/Vine Siege) ===
    ("ranged", "A", "Gnome Bower", (
        "small gnome workshop, a cozy little treehouse workshop with tiny door, "
        "thorn projectiles on the workbench, small gnome-sized windows, "
        "flower box in the window, a tinkerer's compact outpost"
    )),
    ("ranged", "B", "Heavy Tinker Bower", (
        "medium gnome tinker workshop, a sturdier treehouse with gnome engineering, "
        "heavier thorn launchers, reinforced wooden walls, gear mechanisms, "
        "emphasis on DAMAGE — bigger thorn ammunition, stronger construction"
    )),
    ("ranged", "C", "Thorn Thrower Bower", (
        "medium thorn thrower outpost, a vine-covered bower with rapid-fire thorn launchers, "
        "thorny vines growing everywhere, multiple thorn ammo racks, "
        "emphasis on SPEED and SLOW — rapid thorn projectiles coated in sap, "
        "same size as B"
    )),
    ("ranged", "D", "Blight Tinker Bower", (
        "large gnome blight workshop, an elaborate tinker lab with splash damage devices, "
        "blight-spreading thorn grenades, gnome engineering at its finest, "
        "emphasis on SPLASH DAMAGE — area thorn sprayers, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Grand Tinker Bower", (
        "large grand gnome workshop, the finest tinker engineering workshop, "
        "precision thorn artillery, larger splash weapons, golden gear emblems, "
        "emphasis on MAXIMUM SPLASH — wide area thorn coverage, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Toxic Hurler Bower", (
        "large toxic gnome lab, a poison thorn laboratory with bubbling toxic vats, "
        "burn-inducing thorn projectiles, green toxic coating station, "
        "emphasis on BURN DAMAGE — toxic thorn production, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Vine Siege Bower", (
        "large vine siege emplacement, an enormous living vine catapult, "
        "the vine IS the weapon — a giant living plant that hurls boulders, "
        "emphasis on SIEGE — massive plant siege weapon, devastating range, "
        "same scale as D/E/F"
    )),

    # === CASTER GARDEN (Bloom Mage=panda -> Deep Root(panda)/Spore Weaver(mushroom) -> Fungal/Bloom/Mycelium/Fungal Lord) ===
    ("caster", "A", "Bloom Mage Garden", (
        "small bloom mage garden, a small flower garden with a magical stone altar, "
        "blooming flowers radiating healing energy, panda-friendly cozy aesthetic, "
        "soft green healing glow, crystal dewdrops on petals"
    )),
    ("caster", "B", "Deep Root Garden", (
        "medium deep root healing garden, a lush flower garden with deep magical roots visible, "
        "healing energy pulsing from the roots below, blooming flowers everywhere, "
        "emphasis on HEALING — the deepest roots channel the most healing power, "
        "panda meditation stones, warm and nurturing"
    )),
    ("caster", "C", "Spore Weaver Mushroom Ring", (
        "medium mushroom fairy ring, a circle of large magical mushrooms, "
        "spore clouds drifting between the mushrooms, bioluminescent glow, "
        "emphasis on SPEED and SLOW — spores that slow enemies, "
        "purple and teal mushroom caps, mycelium network visible, "
        "same size as B but mushroom-themed"
    )),
    ("caster", "D", "Fungal Hulk Garden", (
        "large fungal hulk mushroom grove, enormous magical mushrooms with thick stalks, "
        "healing spore clouds, massive mushroom canopy providing cover, "
        "emphasis on DAMAGE and HEALING — powerful fungal magic, "
        "same scale as E/F/G"
    )),
    ("caster", "E", "Bloom Shaper Garden", (
        "large bloom shaper flower temple, an elaborate flower garden with massive blooms, "
        "each flower radiates healing energy in a wide area, petal-covered altar, "
        "emphasis on LARGE AoE — the flowers project healing across the battlefield, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Mycelium Sage Mushroom Grove", (
        "large mycelium sage network, an enormous underground mushroom network surfacing, "
        "rapid-growing mycelium tendrils, bioluminescent mushroom clusters, "
        "emphasis on VERY FAST HEALING — the mycelium network heals rapidly, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Fungal Lord Sanctum", (
        "large fungal lord sanctum, the ultimate mushroom temple, "
        "an enormous ancient mushroom throne with a crowned fungal cap, "
        "emphasis on MAXIMUM POWER — the fungal lord's domain radiates power, "
        "spore clouds and mycelium energy everywhere, same scale as D/E/F"
    )),

    # === TOWER (living thorn walls and vine structures) ===
    ("tower", "A", "Thorn Wall", (
        "small living thorn wall, a cluster of thorny vines growing from the ground, "
        "natural thorn barricade with small flowers between the thorns, "
        "a defensive living plant structure, compact natural wall"
    )),
    ("tower", "B", "Reinforced Thorn Wall", (
        "medium reinforced thorn wall, thicker thorny vines with hardened bark armor, "
        "emphasis on DURABILITY — dense impenetrable thorn growth, "
        "flower accents among the deadly thorns"
    )),
    ("tower", "C", "Vine Tower", (
        "medium vine tower, a tall vine-wrapped structure with entangling tendrils, "
        "emphasis on SLOW — sticky sap-dripping vines that entangle enemies, "
        "same size as B but focused on vine entanglement"
    )),
    ("tower", "D", "Great Thorn", (
        "large great thorn fortress, an enormous thorny growth with bark armor, "
        "the TANKIEST natural defense, impenetrable thorn wall, "
        "same scale as E/F/G"
    )),
    ("tower", "E", "Poison Thorn", (
        "large poison thorn, toxic thorns dripping with burning sap, "
        "emphasis on BURN DAMAGE — every thorn is coated in toxic sap, "
        "same scale as D/F/G"
    )),
    ("tower", "F", "Entangle Tower", (
        "large entangle tower, massive vine structure with sticky web-like tendrils, "
        "emphasis on MAXIMUM SLOW — entangling vines everywhere, "
        "same scale as D/E/G"
    )),
    ("tower", "G", "Nature Spire", (
        "large nature spire, the ultimate living tower, an ancient tree spire blooming with power, "
        "emphasis on MAXIMUM DAMAGE and RANGE — nature's wrath concentrated, "
        "flowers and thorns combined, golden nature energy, same scale as D/E/F"
    )),

    # === HUT (harvests Wood + Gold) ===
    ("hut", "A", "Tenders Harvester Hut", (
        "small nature harvester cottage, a cozy little wooden cottage with a garden, "
        "flower boxes in every window, small vegetable garden patch, "
        "wooden tools leaning by the door, smoke from a chimney, "
        "warm and homey, gnome-friendly proportions"
    )),
]

CANDIDATES = 2


def generate(prompt, outpath):
    try:
        output = replicate.run(
            MODEL,
            input={
                "prompt": prompt,
                "num_outputs": 1,
                "guidance_scale": 7.5,
                "num_inference_steps": 28,
                "width": 1024,
                "height": 1024,
                "disable_safety_checker": True,
            }
        )
        for item in output:
            urllib.request.urlretrieve(str(item), outpath)
            return True
    except Exception as e:
        print(f"    Error: {e}")
        return False


def main():
    total = len(BUILDINGS) * CANDIDATES
    done = 0

    print(f"Tenders ALL buildings ({total} images, ~{DELAY}s delay)")
    print(f"Output: {OUT_DIR}\n")

    for btype, node, name, desc in BUILDINGS:
        prompt = f"{STYLE}, {name}: {desc}"

        for c in range(CANDIDATES):
            outpath = os.path.join(OUT_DIR, f"{btype}_{node}_candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"[{btype}:{node}] Candidate {c+1}: exists, skipping")
                done += 1
                continue

            print(f"[{btype}:{node}] {name} - candidate {c+1}/{CANDIDATES}...")
            success = generate(prompt, outpath)
            done += 1

            if success:
                print(f"    Saved: {btype}_{node}_candidate_{c+1}.png")

            remaining = total - done
            if remaining > 0:
                print(f"    Waiting {DELAY}s... ({remaining} remaining)")
                time.sleep(DELAY)

    print(f"\nDone! {done}/{total} generated.")
    print(f"Review: {OUT_DIR}")


if __name__ == "__main__":
    main()
