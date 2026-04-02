"""
Generate ALL Oozlings buildings using the trained LoRA.
Melee (Vat), Ranged (Vat), Caster (Vat), Hut, and Ooze Mound.
All with slime/ooze aesthetic matching the tower progression.
Respects rate limiting: 1 request per 12 seconds.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "oozlings_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "organic slime and ooze architecture, bubbling green and purple slime, "
    "mushroom growths, gelatinous surfaces, dripping ooze, "
    "dark stone base with green glowing slime energy, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Oozlings units always spawn 2 at a time (swarm mechanic)
# Melee = Globule (green blobs that fight in melee, can explode)
# Ranged = Spitter (green blobs that spit acid at range)
# Caster = Slimer/Bloater (green blobs that cast AoE slime magic, apply haste)
# All buildings are called "Vat" — breeding vats for slimes

BUILDINGS = [
    # === MELEE VAT (trains Globules — melee slime blobs, explosions) ===
    ("melee", "A", "Globule Vat", (
        "small slime breeding vat, a stone cauldron filled with bubbling green slime, "
        "small green slime blobs forming inside, simple ooze container, "
        "mushrooms growing at the base, compact melee unit production facility"
    )),
    ("melee", "B", "Tough Vat", (
        "medium reinforced slime vat, thicker stone cauldron with iron bands, "
        "larger bubbling green slime pool, tougher slime blobs forming, "
        "emphasis on DURABILITY — heavier stone walls coated in hardened slime"
    )),
    ("melee", "C", "Baneling Vat", (
        "medium explosive slime vat, volatile green slime bubbling dangerously, "
        "warning-like markings, unstable energy crackling, emphasis on EXPLOSIONS, "
        "small explosion sparks visible, pressurized slime about to burst"
    )),
    ("melee", "D", "Armored Vat", (
        "large armored slime vat, very thick stone walls with slime armor plating, "
        "hardened green crystal slime coating, the TANKIEST vat, heavily fortified, "
        "same scale as E/F/G, iron reinforcement over stone"
    )),
    ("melee", "E", "Acid Vat", (
        "large acid slime vat, corrosive bright green acid bubbling inside, "
        "acid-etched stone, sizzling corrosion damage visible, emphasis on BURN DAMAGE, "
        "toxic green fumes rising, same scale as D/F/G"
    )),
    ("melee", "F", "Volatile Vat", (
        "large volatile slime vat, highly unstable glowing green slime, "
        "cracks of energy in the container, about to explode feeling, "
        "emphasis on SPEED and BIG EXPLOSIONS, same scale as D/E/G"
    )),
    ("melee", "G", "Detonator Vat", (
        "large detonator slime vat, massive explosive slime reactor, "
        "the most dangerous looking vat, enormous green energy buildup, "
        "explosive runes and containment rings, ultimate explosive slime factory"
    )),

    # === RANGED VAT (trains Spitters — ranged acid-spitting slimes) ===
    ("ranged", "A", "Spitter Vat", (
        "small ranged slime vat, a stone basin with green slime and small nozzles, "
        "acid spitting tubes protruding from the top, simple ranged unit factory, "
        "green slime projectile residue on the walls"
    )),
    ("ranged", "B", "Thick Spitter Vat", (
        "medium reinforced ranged vat, thicker acid reservoir, "
        "larger slime nozzles, more concentrated green acid, "
        "emphasis on THICKER more powerful acid shots"
    )),
    ("ranged", "C", "Rapid Spitter Vat", (
        "medium rapid-fire ranged vat, multiple small slime nozzles pointing outward, "
        "emphasis on SPEED — many rapid-fire acid tubes, pressurized slime tanks, "
        "sleeker design optimized for fast acid projectile production"
    )),
    ("ranged", "D", "Acid Spitter Vat", (
        "large corrosive ranged vat, concentrated bright green acid, "
        "corrosion damage on the stone, emphasis on ACID DAMAGE and SLOW effects, "
        "toxic dripping, same scale as E/F/G"
    )),
    ("ranged", "E", "Burst Spitter Vat", (
        "large burst ranged vat, slime splash cannon on top, "
        "emphasis on SPLASH DAMAGE — wide spray nozzle, area effect design, "
        "green slime explosion marks, same scale as D/F/G"
    )),
    ("ranged", "F", "Hyper Spitter Vat", (
        "large hyper-speed ranged vat, multiple rapid-fire slime cannons, "
        "emphasis on EXTREME SPEED and RANGE, overcharged slime conduits, "
        "buzzing with pressurized energy, same scale as D/E/G"
    )),
    ("ranged", "G", "Glob Siege Vat", (
        "large siege ranged vat, enormous slime catapult or trebuchet on top, "
        "emphasis on MASSIVE LONG RANGE SIEGE, huge glob ammunition, "
        "the biggest ranged weapon, devastating slime siege engine"
    )),

    # === CASTER VAT (trains Slimers/Bloaters — AoE magic slimes, haste) ===
    ("caster", "A", "Slimer Vat", (
        "small caster slime vat, a mystical stone basin with swirling purple and green slime, "
        "magical runes glowing, arcane slime energy, trains magic-casting slimes, "
        "floating slime orbs above the vat"
    )),
    ("caster", "B", "Bloater Vat", (
        "medium bloater caster vat, larger mystical slime pool, "
        "bigger floating slime orbs, more arcane purple energy mixed with green, "
        "emphasis on BIGGER AoE — wider magical aura"
    )),
    ("caster", "C", "Quick Bloater Vat", (
        "medium quick caster vat, sleeker magical design, chain energy arcs, "
        "emphasis on SPEED and CHAIN TARGETS, purple lightning between slime nodes, "
        "faster slime magic production"
    )),
    ("caster", "D", "Mega Bloater Vat", (
        "large mega caster vat, enormous magical slime reservoir, "
        "massive purple-green arcane explosion aura, emphasis on MASSIVE AoE DAMAGE, "
        "powerful magical slime energy radiating, same scale as E/F/G"
    )),
    ("caster", "E", "Acid Bloater Vat", (
        "large acid caster vat, corrosive magical slime, acid and arcane combined, "
        "emphasis on BURN + MAGIC, toxic purple-green energy, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Hyper Bloater Vat", (
        "large hyper caster vat, rapidly pulsing magical slime energy, "
        "emphasis on EXTREME SPEED casting, overcharged arcane conduits, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Ooze Lord Vat", (
        "large ooze lord vat, the ultimate magical slime sanctum, "
        "massive crown-like slime crystal on top, radiating purple-green power, "
        "the most ornate and powerful caster vat, trains ooze lord slimes"
    )),

    # === HUT (harvests Gold + Meat) ===
    ("hut", "A", "Ooze Harvester Hut", (
        "small slime harvester hut, a humble mushroom-shaped shelter made of hardened slime, "
        "green ooze walls with a purple mushroom cap roof, small doorway, "
        "slime worker tools leaning against the wall, simple resource gathering hut, "
        "compact and cozy slime cottage"
    )),

    # === OOZE MOUND (racial ability building — spawns extra oozlings) ===
    ("mound", "A", "Ooze Mound", (
        "medium ooze mound structure, a large mound of bubbling green slime, "
        "slime eggs or cocoons visible inside, baby slimes emerging from the ooze, "
        "organic spawning pit, pulsing with life energy, "
        "purple mushrooms growing on top, a living slime breeding ground, "
        "green ooze flowing outward from the mound"
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

    print(f"Oozlings ALL buildings ({total} images, ~{DELAY}s delay)")
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
