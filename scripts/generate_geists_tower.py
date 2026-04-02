"""
Geists Tower A->G progression using the trained LoRA.
Geists are undead/spectral — dark stone, purple energy, skulls, ghostly flames.
Towers deal burn damage that stacks.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "geists_tower")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "dark gothic undead architecture, dark grey and slate blue stone, "
    "glowing purple and magenta stained glass windows, spectral energy, "
    "pointed gothic arches, spiral staircases, ghostly wisps, skull decorations, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Geists tower: BURN damage that stacks
# B: +50% HP, +35% dmg (sturdier shadow spire)
# C: +2 burn stacks, +range (more fire, more reach)
# D: +90% HP, +50% dmg (massive void fortress)
# E: +45% dmg, +3 burn stacks (maximum burn damage)
# F: very fast attack, +2 range (rapid nightmare bolts)
# G: +60% dmg, +3 range (ultimate death ray)

TIERS = [
    ("A", "Shadow Spire", (
        "small gothic shadow spire tower, dark grey stone with purple stained glass windows, "
        "pointed slate roof, spectral purple flames flickering at the top, "
        "spiral staircase visible, small ghostly wisps, compact undead watchtower, "
        "skull ornament above the entrance"
    )),
    ("B", "Shadow Spire Tower", (
        "medium reinforced shadow spire, thicker dark stone walls with iron bracing, "
        "larger purple stained glass windows glowing brighter, pointed gothic roof, "
        "emphasis on STURDINESS — heavier stone, reinforced gothic buttresses, "
        "purple spectral flames on battlements, same size as C"
    )),
    ("C", "Wither Spire", (
        "medium wither spire, multiple purple flame braziers burning on the walls, "
        "emphasis on BURN DAMAGE and RANGE — purple fire everywhere, "
        "burning skull ornaments, withering dark energy radiating outward, "
        "sleeker than B but same overall size, focused on projecting spectral fire"
    )),
    ("D", "Void Spire", (
        "large void spire fortress, massive dark obsidian walls, "
        "enormous purple void crystal embedded in the structure, "
        "the TANKIEST undead tower — extremely heavy and imposing, "
        "multiple layers of dark stone battlements, void energy crackling, "
        "skull carvings on every surface, same scale as E/F/G"
    )),
    ("E", "Blight Spire", (
        "large blight spire, concentrated purple blight fire weapon on top, "
        "emphasis on MAXIMUM BURN DAMAGE — intense purple flames erupting, "
        "blighted dark stone with corruption spreading outward, "
        "multiple burning skull totems, toxic purple energy, same scale as D/F/G"
    )),
    ("F", "Nightmare Spire", (
        "large nightmare spire, rapid-fire spectral bolt launchers, "
        "emphasis on VERY FAST ATTACKS — multiple ghostly crossbow mechanisms, "
        "purple energy conduits feeding rapid-fire spectral weapons, "
        "nightmare eyes glowing from dark windows, same scale as D/E/G"
    )),
    ("G", "Death Spire", (
        "large death spire, ultimate undead tower with enormous death ray crystal on top, "
        "emphasis on MAXIMUM DAMAGE and LONGEST RANGE, "
        "massive purple death energy beam weapon aimed at distant targets, "
        "the most imposing and terrifying undead tower, skull crown at the peak, "
        "death energy radiating outward, dark obsidian fortress"
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

    print(f"Geists Tower A->G ({total} images, ~{DELAY}s delay)")
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
