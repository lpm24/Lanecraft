"""
Oozlings Tower A->G progression using the trained LoRA.
Oozlings are a slime/ooze race — green blobs, acid, bubbling vats.
Towers have chain attacks that bounce between enemies.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "oozlings_tower")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Oozlings style: slime, ooze, bubbling, green/purple, organic, vats, mushrooms
# NOT gothic stone — should feel alive, slimy, gelatinous
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "organic slime and ooze architecture, bubbling green and purple slime, "
    "mushroom growths, gelatinous surfaces, dripping ooze, glass containers of slime, "
    "dark stone base with green glowing slime energy, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Oozlings tower: chain attacks that bounce between enemies
# B: +50% HP, +30% dmg (tankier pillar)
# C: much faster, +2 chain targets (rapid chain bouncing)
# D: +100% HP, +range (massive fortified pillar)
# E: +45% dmg, +2 slow stacks (acid damage + slow)
# F: +3 chain targets, faster (ultimate chain bouncer)
# G: +55% dmg, +3 range (long range ooze beacon)

TIERS = [
    ("A", "Slime Pillar", (
        "small slime pillar tower, a stone pedestal with a large bubbling green slime blob on top, "
        "the slime glows and pulses with energy, small mushrooms growing at the base, "
        "green ooze dripping down the sides, simple and compact, "
        "a living slime creature sitting on a dark stone column"
    )),
    ("B", "Reinforced Slime Pillar", (
        "medium reinforced slime pillar, thicker stone base reinforced with iron bands, "
        "larger bubbling green slime blob on top, more mushroom growths, "
        "emphasis on STURDINESS — heavier stone, thicker slime coating on walls, "
        "green ooze pooling at the base, glass vials of slime embedded in the stone"
    )),
    ("C", "Rapid Pillar", (
        "medium rapid-fire slime pillar, multiple smaller slime nozzles pointing outward, "
        "emphasis on SPEED and CHAIN ATTACKS — slime tendrils reaching out in multiple directions, "
        "crackling green energy arcs between multiple slime tips, "
        "same size as B but bristling with slime projectile launchers, "
        "bubbling rapidly, pressurized slime tanks visible"
    )),
    ("D", "Grand Pillar", (
        "large grand slime pillar fortress, enormous bubbling slime reservoir on top, "
        "very thick reinforced stone walls coated in hardened slime armor, "
        "the TANKIEST slime tower — massive and imposing, "
        "multiple layers of ooze protection, giant mushrooms growing from the walls, "
        "green slime waterfall cascading down the front"
    )),
    ("E", "Acid Pillar", (
        "large acid slime pillar, corrosive bright green acid dripping and sizzling, "
        "emphasis on DAMAGE and ACID — the slime is more toxic and concentrated, "
        "acid-etched stone showing corrosion damage, bubbling acid pools at the base, "
        "same scale as D but clearly more dangerous and offensive, "
        "toxic green fumes rising, warning-like coloring"
    )),
    ("F", "Storm Pillar", (
        "large storm slime pillar, crackling green lightning arcing between multiple slime orbs, "
        "emphasis on CHAIN LIGHTNING — green energy bolts bouncing between floating slime nodes, "
        "the ultimate chain attack tower, electrical storm of slime energy, "
        "multiple slime antenna projectors radiating outward, "
        "green electrical discharge effects, buzzing with power"
    )),
    ("G", "Ooze Beacon", (
        "large ooze beacon tower, massive glowing green slime crystal or beacon on top, "
        "emphasis on LONG RANGE — the beacon projects slime energy at great distance, "
        "the most imposing and powerful ooze structure, radiating green light, "
        "enormous concentrated slime core pulsing with power, "
        "slime energy waves emanating outward, the ultimate slime tower"
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

    print(f"Oozlings Tower A->G ({total} images, ~{DELAY}s delay)")
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
