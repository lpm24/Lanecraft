"""
Generate Deep melee, ranged, caster, and hut buildings using the trained LoRA.
Deep = aquatic creatures. Buildings should match the specific sea creature trained there.
Melee: turtles, whales, frogs. Ranged: sharks, crabs, harpoon fish. Caster: starfish, clams.
Buildings are underwater/tidal structures — coral, shells, tidal pools, reef formations.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "deep_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Deep: aquatic, tidal, coral, shells, sea creatures
# Dark blue-grey stone, teal crystals/water, gold ornaments
# Buildings match their creatures — NOT generic gothic
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "aquatic underwater architecture, coral reef formations, "
    "tidal pools, seashells, dark blue-grey stone with teal water energy, "
    "gold chain ornaments, barnacles, sea plants, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE GROTTO (Shell Guard=turtle -> Bull Whale/Frog Scout -> Armored Whale/Leviathan/Leapfrog/Frog Titan) ===
    ("melee", "A", "Shell Guard Grotto", (
        "small turtle shell grotto, a rocky tidal pool shelter shaped like a turtle shell, "
        "dark stone arch with barnacles, small teal water pool at the entrance, "
        "turtle shell pattern in the stonework, compact and defensive"
    )),
    ("melee", "B", "Whale Grotto", (
        "medium whale grotto, a large rocky cave shaped like a whale's open mouth, "
        "whale bone ribs forming the archway, barnacles and coral growing on surfaces, "
        "emphasis on SIZE and POWER — wide whale jaw entrance, teal water flowing within, "
        "baleen-like stone curtains"
    )),
    ("melee", "C", "Frog Grotto", (
        "medium frog grotto, a lily pad-topped tidal pool with a rocky cave beneath, "
        "frog-shaped stone carvings, small stepping stones, water plants growing, "
        "emphasis on SPEED and AGILITY — bouncy stepping stone path, "
        "green lily pads on teal water, same size as B"
    )),
    ("melee", "D", "Armored Whale Grotto", (
        "large armored whale cavern, enormous rocky cave with whale bone armor plating, "
        "heavy barnacle-encrusted stone walls, massive whale skull entrance, "
        "emphasis on MAXIMUM TOUGHNESS — impenetrable sea fortress, "
        "thick coral armor, same scale as E/F/G"
    )),
    ("melee", "E", "Leviathan Grotto", (
        "large leviathan den, a deep sea cavern with massive sea serpent carvings, "
        "giant tentacle-shaped stone pillars, glowing teal depths, "
        "emphasis on POWER and KNOCKBACK — imposing deep sea lair, "
        "ancient leviathan skull mounted above entrance, same scale as D/F/G"
    )),
    ("melee", "F", "Leapfrog Pond", (
        "large leapfrog training pond, a wide tidal pool with lily pads and stepping stones, "
        "frog statues on the edges, splash marks in the water, "
        "emphasis on SPEED and HOP ATTACKS — springboard launching pads, "
        "lots of lily pads and jumping platforms, same scale as D/E/G"
    )),
    ("melee", "G", "Frog Titan Pond", (
        "large frog titan domain, an enormous ancient pond with a massive frog throne of coral, "
        "giant lily pads, ancient frog totems, teal healing energy from the water, "
        "emphasis on POWER and REGENERATION — the mightiest frog's domain, "
        "same scale as D/E/F"
    )),

    # === RANGED REEF (Harpooner=fish -> Reef Shark/Spray Crab -> Hammerhead/Great White/Depth Charge/King Crab) ===
    ("ranged", "A", "Harpooner Reef", (
        "small harpoon fish reef, a coral reef outcrop with harpoon-shaped coral spikes, "
        "fishing net draped over rocks, teal water pool, small and compact, "
        "barbed coral tips pointing outward, a natural ranged lookout"
    )),
    ("ranged", "B", "Shark Reef", (
        "medium shark reef, a jagged coral reef shaped like shark fins breaking the surface, "
        "shark tooth-shaped stone spikes, fast-current water channels, "
        "emphasis on SPEED — sleek hydrodynamic reef shape, shark jaw entrance"
    )),
    ("ranged", "C", "Crab Reef", (
        "medium crab reef, a rocky formation shaped like a giant crab shell, "
        "crab claw-shaped stone pincers flanking the entrance, spray nozzles, "
        "emphasis on SPRAY ATTACKS — water jet openings, crab eye stalks on top, "
        "same size as B"
    )),
    ("ranged", "D", "Hammerhead Reef", (
        "large hammerhead reef, a wide T-shaped coral reef like a hammerhead shark, "
        "hammerhead-shaped stone archway, powerful water current channels, "
        "emphasis on DAMAGE and SLOW — wide sweeping attack coverage, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Great White Reef", (
        "large great white reef, an enormous shark jaw-shaped rock formation, "
        "rows of sharp coral teeth forming the entrance, deep teal water within, "
        "emphasis on RANGE and HEAVY SLOW — the apex predator's lair, "
        "massive and terrifying, same scale as D/F/G"
    )),
    ("ranged", "F", "Depth Charge Reef", (
        "large depth charge siege reef, a deep underwater volcanic vent formation, "
        "enormous explosive coral structure, pressure building inside, "
        "emphasis on SIEGE — massive explosive power, bubbling pressure vents, "
        "deep sea mine-like coral formations, same scale as D/E/G"
    )),
    ("ranged", "G", "King Crab Reef", (
        "large king crab reef, an enormous crab shell-shaped coral fortress, "
        "massive crab claws of stone flanking the structure, royal coral crown, "
        "emphasis on SPLASH DAMAGE — wide sweeping claw reach, "
        "the most imposing coral structure, gold ornaments, same scale as D/E/F"
    )),

    # === CASTER SHRINE (Tidecaller=paddlefish -> Sea Star/Snap Clam -> Crown Star/Star Lord/Giant Clam/Pearl Maw) ===
    ("caster", "A", "Tidecaller Shrine", (
        "small tidecaller shrine, a mystical tidal pool with a glowing starfish-shaped altar, "
        "teal healing water rippling, small coral pillars, seashell wind chimes, "
        "gentle mystical glow from within, compact and sacred"
    )),
    ("caster", "B", "Sea Star Shrine", (
        "medium sea star shrine, a starfish-shaped stone shrine radiating teal healing light, "
        "five pointed starfish arms forming the structure, coral pillars at each point, "
        "emphasis on HEALING — gentle teal glow, medicinal sea plants growing, "
        "same size as C"
    )),
    ("caster", "C", "Snap Clam Shrine", (
        "medium snap clam shrine, a giant clamshell structure that opens to reveal a teal pearl, "
        "the clam shell forms the building walls, coral decorations around base, "
        "emphasis on AoE and SPEED — wide open clam radiating energy outward, "
        "same size as B"
    )),
    ("caster", "D", "Crown Star Shrine", (
        "large crown star temple, an enormous five-pointed starfish formation with a golden crown, "
        "each arm glows with teal energy, central healing pool, "
        "emphasis on DAMAGE and SLOW — the crowned starfish radiates power, "
        "gold crown ornament on top, same scale as E/F/G"
    )),
    ("caster", "E", "Star Lord Shrine", (
        "large star lord sanctum, a radiant starfish temple with intense teal healing aura, "
        "multiple starfish arms reaching upward, cleansing light pouring outward, "
        "emphasis on MAXIMUM HEALING — the most powerful healing shrine, "
        "beacon of teal energy, same scale as D/F/G"
    )),
    ("caster", "F", "Giant Clam Shrine", (
        "large giant clam fortress, an enormous fortified clam shell structure, "
        "the massive clam shell walls are thick and armored, giant teal pearl visible inside, "
        "emphasis on TANKINESS and DAMAGE — the clam is both fortress and weapon, "
        "heavy barnacle armor, same scale as D/E/G"
    )),
    ("caster", "G", "Pearl Maw Shrine", (
        "large pearl maw sanctum, the ultimate tidal shrine with a massive glowing pearl, "
        "enormous open clam jaw revealing a radiant pearl that pulses with energy, "
        "emphasis on MAXIMUM AoE — the pearl radiates teal energy in all directions, "
        "the most sacred and powerful aquatic temple, same scale as D/E/F"
    )),

    # === HUT (harvests Wood + Gold) ===
    ("hut", "A", "Deep Harvester Hut", (
        "small aquatic harvester shelter, a modest seashell-roofed hut on stilts over water, "
        "fishing nets and coral harvesting tools, teal water pool beneath, "
        "barnacle-covered wooden dock, kelp drying rack, "
        "a simple tidal worker station, compact and functional"
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

    print(f"Deep ALL buildings ({total} images, ~{DELAY}s delay)")
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
