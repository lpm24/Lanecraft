"""
Generate ALL Goblin buildings using the trained LoRA.
Goblins = sneaky, scrappy, poison/burn. NOT human architecture.
Melee B-branch becomes trolls (big, brutish, tribal).
Melee C-branch stays goblin (fast, sneaky, assassin).
Ranged = knife throwers, war pigs, mortar.
Caster = voodoo hex doctors, curse weavers, plague hexers.
Buildings should feel goblin: rickety, crude, mushrooms, totems, cauldrons.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "goblins_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Goblins: rickety, crude, scrappy, totems, mushrooms, poison vials
# NOT clean human buildings — think goblin shantytown, swamp huts, totems
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "goblin architecture, rickety wooden shanty construction, "
    "scrap metal patches, crooked nails, rope bindings, green poison vials, "
    "mushrooms growing, totem poles, crude tribal decorations, "
    "dark swampy colors, greens and browns and purples, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE HUT (Stabber -> Troll Brute/Quick Sticker -> Smasher/Warlord/Shadow/Ace) ===
    ("melee", "A", "Goblin Stabber Hut", (
        "small goblin shanty, a tiny crooked wooden shack with a rusty knife sign above the door, "
        "poison vials on the windowsill, crude scrap metal patches on walls, "
        "goblin-sized doorway, mushrooms growing on the roof, compact and ramshackle"
    )),
    ("melee", "B", "Troll Brute Hut", (
        "medium troll hut, a larger crude structure made for bigger creatures, "
        "heavy log walls, troll tribal totems flanking the entrance, bone decorations, "
        "emphasis on TROLL TRIBAL — bigger doorway, war drums outside, animal hide roof, "
        "crude but powerful looking, troll face carving above the door"
    )),
    ("melee", "C", "Quick Sticker Den", (
        "medium goblin assassin den, a sneaky low-profile hideout, "
        "hidden entrance covered by canvas, throwing knives embedded in the walls, "
        "emphasis on STEALTH and SPEED — dark colors, shadowy, poison smoke seeping out, "
        "same size as B but sleeker and sneakier"
    )),
    ("melee", "D", "Troll Smasher Lodge", (
        "large troll war lodge, heavy timber and stone construction sized for trolls, "
        "burning torches flanking the entrance, troll war totems with fire, "
        "emphasis on BURN DAMAGE — fire braziers, flame symbols carved in wood, "
        "troll skull totems wreathed in fire, same scale as E/F/G"
    )),
    ("melee", "E", "Troll Warlord Hall", (
        "large troll warlord hall, imposing tribal structure with bone throne visible inside, "
        "war trophies hanging from the rafters, troll warlord banner, "
        "emphasis on POWER and SLOW — chains and heavy weapons on display, intimidating, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Shadow Sticker Hideout", (
        "large goblin shadow assassin lair, a dark concealed structure draped in shadow cloth, "
        "hidden blade mechanisms, smoke bombs, caltrops scattered outside, "
        "emphasis on DODGE and SPEED — ninja-like goblin aesthetic, dark and dangerous, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Goblin Ace Arena", (
        "large goblin champion arena, a crude fighting pit with audience stands, "
        "trophy weapons mounted on the walls, champion goblin banner, "
        "emphasis on MAXIMUM DAMAGE — the best goblin fighters train here, "
        "war paint markings, crude but impressive, same scale as D/E/F"
    )),

    # === RANGED SHACK (Knifer -> Venom Knifer/War Pig -> Plague/Fan/King Pig/Mortar) ===
    ("ranged", "A", "Goblin Knife Shack", (
        "small goblin ranged shack, a crude lean-to with racks of throwing knives, "
        "poison-dipped blades on a workbench, target practice dummy outside, "
        "green venom bottles, compact knife-throwing training post"
    )),
    ("ranged", "B", "Venom Knifer Shack", (
        "medium venom workshop, a larger shack with bubbling poison cauldrons outside, "
        "racks of venom-coated knives, green toxic drip from the workbench, "
        "emphasis on BURN — poison brewing station, toxic smoke, venom vials everywhere"
    )),
    ("ranged", "C", "War Pig Pen", (
        "medium war pig stable, a crude wooden pen with a large armored pig inside, "
        "pig skull emblem, muddy ground, feeding trough with scraps, "
        "emphasis on MOUNTED COMBAT — saddle and armor on display, pig war paint, "
        "same size as B"
    )),
    ("ranged", "D", "Plague Knifer Workshop", (
        "large plague knife workshop, an elaborate poison laboratory, "
        "multiple bubbling cauldrons of plague toxin, green toxic clouds, "
        "emphasis on MAXIMUM BURN — concentrated plague venom, corroded workbenches, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Fan Knifer Arsenal", (
        "large multi-knife arsenal, racks upon racks of throwing knives and shuriken, "
        "mechanical fan-blade throwing devices, emphasis on MULTI-SHOT — fires 2 projectiles, "
        "blade-spinning contraptions, knife storage everywhere, same scale as D/F/G"
    )),
    ("ranged", "F", "King Pig Stables", (
        "large armored war pig palace, a fortified stable for the biggest war pig, "
        "golden pig crown emblem, heavy pig armor on display, royal mud pit, "
        "emphasis on SPEED and DODGE — agile mounted combat, pig war banners, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Goblin Mortar Pit", (
        "large goblin mortar emplacement, a crude but devastating siege weapon, "
        "an enormous goblin-engineered mortar cannon in the center, "
        "emphasis on SIEGE — huge explosive ammunition piled up, "
        "blast marks around the pit, the biggest goblin weapon, same scale as D/E/F"
    )),

    # === CASTER DEN (Hex Caster -> Hex Master/Curse Weaver -> Grand/Plague/Rapid/Doom Hexer) ===
    ("caster", "A", "Goblin Hex Den", (
        "small voodoo hut, a crooked mushroom-roofed shack with hanging voodoo dolls, "
        "bubbling green potion cauldron out front, hex symbols painted on the walls, "
        "shrunken heads and bone chimes, eerie green glow from within, "
        "goblin witch doctor aesthetic"
    )),
    ("caster", "B", "Hex Master Den", (
        "medium hex master lair, a larger voodoo hut with more elaborate hex totems, "
        "bigger cauldron bubbling with purple-green hex magic, voodoo masks on the walls, "
        "emphasis on SLOW STACKS — cursing totems, tangling vines from hexes, "
        "shrunken head garlands, bone wind chimes"
    )),
    ("caster", "C", "Curse Weaver Den", (
        "medium curse weaver workshop, a dark goblin witch hut with spider web decorations, "
        "curse scrolls and hex dolls hanging from the ceiling, "
        "emphasis on SPEED and RANGE — quick curse casting, curse circles on the floor, "
        "same size as B"
    )),
    ("caster", "D", "Grand Hexer Den", (
        "large grand hexer sanctum, an imposing voodoo temple with massive hex totems, "
        "enormous bubbling hex cauldron in the center, green-purple hex energy swirling, "
        "emphasis on MAXIMUM SLOW — the most powerful curse magic, "
        "giant voodoo masks, hex circles everywhere, same scale as E/F/G"
    )),
    ("caster", "E", "Plague Hexer Den", (
        "large plague hexer den, a toxic voodoo laboratory overflowing with plague magic, "
        "enormous poison cloud rising, plague rat totems, diseased green energy, "
        "emphasis on LARGE AoE DAMAGE — plague spreads to everything nearby, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Rapid Hexer Den", (
        "large rapid hexer hut, a sleek voodoo casting station optimized for speed, "
        "multiple small cauldrons for rapid hex brewing, quick-cast hex circles, "
        "emphasis on VERY FAST CASTING — streamlined curse production, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Doom Hexer Sanctum", (
        "large doom hexer sanctum, the ultimate voodoo temple, massive skull totem on top, "
        "swirling green-purple doom energy, the most powerful hex magic, "
        "emphasis on MAXIMUM DAMAGE and RANGE — devastating curse power, "
        "giant voodoo mask facade, hex energy radiating outward"
    )),

    # === HUT (harvests Gold + Wood) ===
    ("hut", "A", "Goblin Harvester Hut", (
        "small goblin worker shack, a tiny ramshackle lean-to with crude tools, "
        "pickaxe and lumber axe leaning against the wall, gathered mushrooms in baskets, "
        "a goblin-sized rickety shelter made of scrap wood and canvas, "
        "compact and messy, gold coins scattered near the entrance"
    )),

    # === POTION SHOP (ability building) ===
    ("potionshop", "A", "Goblin Potion Shop", (
        "medium goblin potion shop, a bubbling alchemist workshop, "
        "shelves of colorful potion bottles, a large cauldron brewing green liquid, "
        "mushroom ingredients hanging from the ceiling, smoke and steam rising, "
        "crude wooden shop front with a potion bottle sign, "
        "goblin alchemy lab aesthetic"
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

    print(f"Goblins ALL buildings ({total} images, ~{DELAY}s delay)")
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
