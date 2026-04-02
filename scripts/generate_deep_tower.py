"""
Deep Tower A->G progression using the trained LoRA.
Deep towers are aquatic/oceanic themed and apply slow effects.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "deep_tower")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "dark gothic fantasy architecture, dark blue-grey stone with glowing teal crystals, "
    "gold chain ornaments and gold trim, aquatic oceanic theme, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Deep tower: all about SLOW effects + aquatic theme
# A = base (tier 0), B/C = tier 1 (same size), D/E/F/G = tier 2 (same size)
# Stats:
#   B: +50% HP, +35% dmg (tankier tidal pool)
#   C: +2 slow stacks, +range (more control)
#   D: +100% HP, +40% dmg, +range (massive fortified pool)
#   E: +55% dmg, +3 slow (damage + heavy slow)
#   F: +2 range, +4 slow stacks (ultimate slow machine)
#   G: +50% dmg, +3 range (long range frozen attacks)

TIERS = [
    ("A", "Tidal Pool", (
        "small aquatic tidal pool tower, dark stone cylindrical base with a teal crystal dome on top, "
        "gold chain ornaments hanging from the dome, small teal glowing windows, "
        "water ripple effects around the base, compact and simple, "
        "oceanic watchtower with coral and barnacle details"
    )),
    ("B", "Tidal Pool Tower", (
        "medium reinforced tidal pool tower, thicker dark stone walls with teal crystal dome, "
        "stronger gold bands reinforcing the structure, more barnacles and coral growth, "
        "emphasis on DURABILITY and sturdiness, teal water energy glowing within, "
        "gold chain ornaments, heavier fortified aquatic tower"
    )),
    ("C", "Vortex Pool", (
        "medium vortex pool tower, swirling teal water vortex visible inside crystal dome, "
        "multiple teal crystal focusing lenses for slowing enemies, "
        "emphasis on CONTROL and range, whirlpool energy radiating outward, "
        "gold ornamental rings, sleeker than B but same overall size, aquatic arcane focus"
    )),
    ("D", "Abyssal Pool", (
        "large abyssal pool fortress, massive dark stone walls double-thick, enormous teal crystal dome, "
        "deep sea pressure cracks glowing with teal energy, heavy gold reinforcement bands, "
        "the TANKIEST aquatic tower, almost indestructible deep-sea fortress, "
        "coral armor plating, barnacle-encrusted battlements, abyssal depth theme"
    )),
    ("E", "Crushing Tide", (
        "large crushing tide tower, powerful teal tidal wave energy weapon on top, "
        "waves of water crashing around the structure, emphasis on DAMAGE and heavy slow, "
        "dark stone with teal water cannons, gold trim, multiple tidal force projectors, "
        "same scale as D but focused on offensive water weaponry"
    )),
    ("F", "Tsunami Tower", (
        "large tsunami tower, ultimate slow machine with massive swirling vortex on top, "
        "four teal crystal slow-projectors pointing outward in all directions, "
        "emphasis on AREA CONTROL and maximum slow stacks, teal energy tendrils radiating, "
        "dark stone base with gold arcane rings, whirlpool energy field visible"
    )),
    ("G", "Frozen Pool", (
        "large frozen pool tower, ice-encrusted aquatic tower with frozen teal crystals, "
        "emphasis on LONG RANGE frozen attacks, ice crystal cannon aimed at distant targets, "
        "frost and ice covering the dark stone, frozen water cascading down the sides, "
        "gold trim frosted over, the most imposing aquatic tower, arctic deep-sea theme"
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
    total = len(TIERS) * CANDIDATES
    done = 0

    print(f"Deep Tower A->G ({total} images, ~{DELAY}s delay)")
    print(f"Output: {OUT_DIR}\n")

    for node, name, desc in TIERS:
        prompt = f"{STYLE}, {name}: {desc}"

        for c in range(CANDIDATES):
            outpath = os.path.join(OUT_DIR, f"{node}_candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"[{node}] Candidate {c+1}: exists, skipping")
                done += 1
                continue

            print(f"[{node}] {name} - candidate {c+1}/{CANDIDATES}...")
            success = generate(prompt, outpath)
            done += 1

            if success:
                print(f"    Saved: {node}_candidate_{c+1}.png")

            remaining = total - done
            if remaining > 0:
                print(f"    Waiting {DELAY}s... ({remaining} remaining)")
                time.sleep(DELAY)

    print(f"\nDone! {done}/{total} generated.")
    print(f"Review: {OUT_DIR}")


if __name__ == "__main__":
    main()
