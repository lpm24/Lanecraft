"""
Crown Tower A->G progression test using the trained LoRA.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "crown_tower")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12  # seconds between requests to respect rate limit

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "medieval European stone architecture, warm sandstone and grey stone walls, "
    "orange-red tiled roof sections, golden trim and accents, wooden support beams, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# A = base (tier 0), B/C = tier 1 (same size), D/E/F/G = tier 2 (same size, bigger than B/C)
TIERS = [
    ("A", "Tower", "small basic stone watchtower, simple round tower with battlements, single arrow slit, wooden door at base, compact and humble, small wooden platform on top"),
    ("B", "Reinforced Tower", "medium reinforced defensive tower, thick stone walls with iron banding and rivets, stone buttresses at base, pointed roof with orange tiles, emphasis on durability and thick heavy stone, shield emblem on front wall"),
    ("C", "Rapid Tower", "medium fast-firing tower, sleek design with multiple arrow slits on every side, mounted repeating crossbow mechanism on rooftop, quiver racks of bolts visible, lighter stone emphasizing speed, targeting scope on top"),
    ("D", "Fortress Tower", "large fortress tower, massive thick double-walls, darker heavier stone, multiple layers of battlements, wide base with stone buttresses, iron-banded gates, murder holes, looks almost indestructible, crown heraldry carved in stone"),
    ("E", "War Tower", "large war tower, multiple firing platforms at different heights, large mounted ballista on top, war banners and crown pennants, golden trim on battlements, burning braziers for fire arrows, battle-scarred stone"),
    ("F", "Gatling Tower", "large mechanical rapid-fire tower, prominent multi-barrel repeating crossbow mechanism on top, visible wooden gears cranks and rotating mechanisms, multiple loaded bolt magazines, brass and iron fittings, feed hoppers of ammunition"),
    ("G", "Siege Tower", "large siege tower, enormous trebuchet or siege cannon on rooftop, weapon dominates the roofline aimed at distant targets, golden crown emblem, stacked ammunition boulders and explosive barrels, iron-reinforced at every joint"),
]

CANDIDATES = 2  # 2 per tier to conserve credits (14 total)


def generate(prompt, outpath):
    """Generate one image, return True on success."""
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

    print(f"Crown Tower A->G test ({total} images, ~{DELAY}s between requests)")
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
