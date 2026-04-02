"""
Generate ALL Wild buildings using the trained LoRA.
Wild = natural beasts. Buildings are ANIMAL HABITATS not human dwellings.
Caves, burrows, nests, pits, web clusters, hollow trees, bone formations.
Nothing constructed — everything looks like it grew or was carved by animals.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "wild_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Wild: NATURAL animal habitats, NOT built structures
# Caves, burrows, rock formations, webs, bone piles, hollow trees
# Colors: earthy browns, moss greens, bone white, dark cave openings, blood red accents
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "natural animal habitat, NOT a human dwelling, organic and wild, "
    "rock formations, caves, burrows, bone piles, thorns, moss, "
    "earthy browns, moss greens, bone white accents, "
    "single structure centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE DEN (spider burrow -> bear cave/spider eggs -> minotaur labyrinth/dire cave/viper pit/swarm cluster) ===
    ("melee", "A", "Lurker Burrow", (
        "small spider burrow, a dark hole in rocky ground with spider webs stretched across it, "
        "silk-wrapped prey hanging nearby, small green glowing spider eyes in the darkness, "
        "natural cave opening, no construction, just webbed earth"
    )),
    ("melee", "B", "Bear Cave", (
        "medium bear cave, a rocky cavern entrance with deep claw marks gouged into the stone, "
        "bear fur caught on the rocks, large paw prints in mud, bones of prey scattered outside, "
        "emphasis on a STRONG NATURAL CAVE — no building materials, just raw stone and claw marks"
    )),
    ("melee", "C", "Spider Brood Nest", (
        "medium spider egg cluster, a mass of pale spider egg sacs wrapped in thick webs, "
        "attached to rocks and dead branches, tiny spiders crawling on the surface, "
        "emphasis on SPAWNING MANY — dozens of eggs about to hatch, web-covered rock formation, "
        "same size as B"
    )),
    ("melee", "D", "Minotaur Labyrinth", (
        "large stone labyrinth entrance, ancient cracked stone archway leading into darkness, "
        "bull horns carved into the rock, maze-like stone walls visible inside, "
        "emphasis on POWER — imposing stone ruins overgrown with moss, horn trophies, "
        "blood-stained entrance stones, same scale as E/F/G"
    )),
    ("melee", "E", "Dire Bear Cave", (
        "large deep cave, enormous rocky cavern with massive claw gouges in the stone, "
        "thick moss covering, giant bear skull at the entrance, bones everywhere, "
        "emphasis on TOUGHNESS — the deepest most protected cave, impenetrable stone, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Viper Pit", (
        "large viper pit, a deep rocky pit with coiled snake forms visible inside, "
        "fang-shaped stalagmites around the rim, shed snake skins draped on rocks, "
        "emphasis on SPEED and VENOM — venomous snakes slithering, green venom pools, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Spider Swarm Nest", (
        "large spider swarm colony, enormous web structure stretched between dead trees and rocks, "
        "hundreds of egg sacs, webs covering everything, tiny spiders everywhere, "
        "emphasis on MAXIMUM NUMBERS — the biggest web colony, overwhelming swarm, "
        "same scale as D/E/F"
    )),

    # === RANGED NEST (bone perch -> chameleon rock/snake coil -> stalker overhang/siege bone/venom fang/hydra formation) ===
    ("ranged", "A", "Bonechucker Perch", (
        "small bone-covered rocky perch, a natural rock outcrop littered with animal bones, "
        "skull pile at the base, antler rack on top, a predator lookout point, "
        "no construction — just a rock with bones piled on it"
    )),
    ("ranged", "B", "Chameleon Overhang", (
        "medium camouflaged rock overhang, natural stone and leaf cover blending together, "
        "barely visible — the structure IS the camouflage, hidden among rocks and foliage, "
        "emphasis on STEALTH — a hunting blind made by nature, chameleon eye patterns in moss"
    )),
    ("ranged", "C", "Snake Coil", (
        "medium coiled snake formation, rocks arranged in a spiral pattern like a coiled serpent, "
        "fang-shaped stone spikes, snake scales carved by wind into the rock, "
        "emphasis on VENOM and SPEED — venomous drip from fang stones, same size as B"
    )),
    ("ranged", "D", "Stalker Overhang", (
        "large predator cave overhang, a jutting rock formation creating a shadowed hunting perch, "
        "predator eyes glowing from the darkness, prey bones below, "
        "emphasis on AMBUSH and SPLASH — a high vantage point overlooking territory, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Catapult Beast Mound", (
        "large beast siege mound, enormous animal ribcage forming a natural catapult frame, "
        "giant bone spine used as the throwing arm, boulder ammunition natural rock pile, "
        "emphasis on SIEGE — the skeleton of a massive dead beast repurposed as a weapon, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Venom Serpent Den", (
        "large venomous serpent rock den, fang-shaped rock spires dripping green venom, "
        "multiple snake holes in the rock face, coiled serpent fossils in the stone, "
        "emphasis on RAPID VENOM — fast-striking snake lair, toxic green pools, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Hydra Rock", (
        "large hydra rock formation, a multi-headed rock outcrop shaped like serpent heads, "
        "three stone serpent heads pointing in different directions, each with glowing eyes, "
        "emphasis on MULTI-TARGET — the hydra formation spits from all heads, "
        "the most imposing rock beast structure"
    )),

    # === CASTER HOLLOW (druidic natural formations — hollow trees, ritual stones, moss magic) ===
    ("caster", "A", "Sage Hollow", (
        "small druidic hollow, an ancient hollow tree stump with glowing green moss inside, "
        "tiny mushrooms and ferns growing from cracks, faint nature magic glow, "
        "bone wind chimes hanging from dead branches, a natural sacred spot"
    )),
    ("caster", "B", "Elder Hollow", (
        "medium elder sage hollow, a larger ancient hollow tree with green healing energy emanating, "
        "animal bones arranged in ritual patterns around the base, totem animal skulls, "
        "emphasis on HEALING — green glow from within, medicinal moss and herbs growing, "
        "same size as C"
    )),
    ("caster", "C", "Swift Hollow", (
        "medium swift sage hollow, a wind-shaped twisted dead tree with hollow core, "
        "feathers and bird bones hanging as wind chimes, air swirling through gaps, "
        "emphasis on SPEED — wind-swept, light, fast-feeling natural formation, "
        "same size as B"
    )),
    ("caster", "D", "Primal Hollow", (
        "large primal sage mound, ancient stone circle with a massive gnarled tree growing through it, "
        "glowing primal runes carved into standing stones, deep green nature energy, "
        "emphasis on RAW POWER — ancient and primordial, moss-covered megaliths, "
        "same scale as E/F/G"
    )),
    ("caster", "E", "Storm Hollow", (
        "large storm sage formation, a lightning-struck ancient tree split open, crackling with energy, "
        "storm clouds gathering above, electrified vines and moss, wind howling through, "
        "emphasis on LARGE AoE — storm energy radiating outward from the dead tree, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Feral Hollow", (
        "large feral sage thicket, wild overgrown thorny bramble formation with glowing core, "
        "vines growing rapidly, thorns everywhere, untamed nature magic pulsing, "
        "emphasis on FAST HEALING — life energy bursting from within, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Alpha Hollow", (
        "large alpha sage ancient tree, an enormous ancient dead tree with massive alpha beast skull mounted in its trunk, "
        "radiating green nature energy, standing stones around the base, bone totems, "
        "emphasis on ULTIMATE POWER — the most sacred beast druid site, primal authority, "
        "same scale as D/E/F"
    )),

    # === TOWER (natural thorn/bone/rock formations — NOT built towers) ===
    ("tower", "A", "Thorn Thicket", (
        "small thorn thicket, a natural cluster of thorny brambles growing from rocky ground, "
        "poison-tipped thorns pointing outward, small bones caught in the thorns, "
        "a natural defense — no construction, just dangerous wild growth"
    )),
    ("tower", "B", "Thorn Wall", (
        "medium reinforced thorn formation, thicker denser thorn growth on a rocky mound, "
        "bone spikes mixed with natural thorns, hardened bark armor on the stems, "
        "emphasis on TOUGHNESS — impenetrable natural barrier, same size as C"
    )),
    ("tower", "C", "Venom Thicket", (
        "medium venom-dripping thorn cluster, thorns coated in dripping green venom, "
        "toxic flowers blooming among the thorns, poison sacs on the branches, "
        "emphasis on BURN DAMAGE — every thorn is venomous, green toxic drip, same size as B"
    )),
    ("tower", "D", "Great Thorn Mound", (
        "large enormous thorn mound, massive thorny growth on a rock formation, "
        "bone spikes reinforcing the natural thorns, impenetrable wall of barbs, "
        "emphasis on MAXIMUM TOUGHNESS — the biggest natural defense, "
        "same scale as E/F/G"
    )),
    ("tower", "E", "Poison Mound", (
        "large poison thorn formation, concentrated toxic thorns dripping bright green venom, "
        "dead vegetation around it from the toxicity, noxious green cloud, "
        "emphasis on MAXIMUM BURN — intensely poisonous natural growth, "
        "same scale as D/F/G"
    )),
    ("tower", "F", "Web Thicket", (
        "large web-and-thorn hybrid, thick spider webs woven between massive thorns, "
        "sticky web strands radiating outward, caught prey visible in webs, "
        "emphasis on MAXIMUM SLOW — entangling web trap combined with thorns, "
        "same scale as D/E/G"
    )),
    ("tower", "G", "Alpha Mound", (
        "large alpha beast mound, enormous rock formation crowned with a massive predator skull, "
        "thorns and bones and webs all combined, the ultimate natural defense, "
        "emphasis on MAXIMUM POWER — radiating primal energy, bone crown on top, "
        "the most fearsome natural formation"
    )),

    # === HUT (foraging burrow — NOT a house) ===
    ("hut", "A", "Foraging Burrow", (
        "small animal burrow, a hole in a grassy hillside with gathered resources piled outside, "
        "sticks, berries, bones, and meat scraps at the entrance, "
        "a simple animal food cache, natural earth mound with a dark opening, "
        "NOT a building — just a burrow in the ground where beasts store food"
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

    print(f"Wild ALL buildings ({total} images, ~{DELAY}s delay)")
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
