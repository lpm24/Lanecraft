"""
Goblins Tower A->G progression using the trained LoRA.
Goblins are fast, cheap, sneaky tinkerers — poison, burn, crude engineering.
Towers are ramshackle wooden forts with poison/burn mechanics.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "goblins_tower")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Goblins: scrappy, ramshackle, wooden, crude metal, poison vials, green accents
# NOT clean or elegant — cobbled together, jury-rigged, clever but messy
STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "ramshackle goblin architecture, crude wooden planks and scrap metal, "
    "crooked construction, rope bindings, nailed-together boards, "
    "green poison vials and toxic smoke, small and scrappy, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Goblin tower: poison/burn focus, crude engineering
# B: +50% HP, +30% dmg (sturdier fort)
# C: much faster attack, +range (rapid fire contraption)
# D: +80% HP, +2 burn stacks (tanky poison fort)
# E: +40% dmg, +3 burn stacks (maximum poison damage)
# F: very fast attack, +2 range (blitz rapid-fire machine)
# G: +55% dmg, +3 range (long range plague launcher)

TIERS = [
    ("A", "Goblin Fort", (
        "small goblin watchtower, a rickety wooden tower made of crooked planks nailed together, "
        "a crude crossbow mounted on top, green poison-tipped bolts, "
        "rope and scrap metal holding it together, a small goblin flag, "
        "compact and ramshackle, looks like it might fall over"
    )),
    ("B", "Goblin Fort", (
        "medium reinforced goblin fort, same rickety wooden style but with extra planks nailed on, "
        "scrap metal armor plates bolted to the walls, crude iron bands for reinforcement, "
        "emphasis on STURDINESS in a goblin way — more nails, more planks, more patches, "
        "still looks cobbled together but noticeably tougher, same size as C"
    )),
    ("C", "Rapid Fort", (
        "medium rapid-fire goblin fort, multiple small crude crossbow mechanisms mounted on every side, "
        "emphasis on SPEED and RAPID FIRE — bristling with tiny bolt launchers, "
        "gears and pulleys made of wood and rope, a crank mechanism for rapid reloading, "
        "green poison bolt racks everywhere, same size as B but more weapons than armor"
    )),
    ("D", "Poison Fort", (
        "large poison goblin fort, thick wooden walls reinforced with crude iron plates, "
        "large green poison cauldron bubbling on top, toxic green smoke rising, "
        "emphasis on TANKINESS and POISON — heavily armored wooden walls with green slime dripping, "
        "poison vials strapped to the exterior, same scale as E/F/G"
    )),
    ("E", "Venom Fort", (
        "large venom goblin fort, concentrated green venom weapon on top, "
        "emphasis on MAXIMUM BURN DAMAGE — bright green toxic sprayers, "
        "venom reservoirs and tubes feeding the weapon, corrosion damage on the wood, "
        "dripping acid, warning skull signs, same scale as D/F/G"
    )),
    ("F", "Blitz Fort", (
        "large blitz goblin fort, extreme rapid-fire contraption, "
        "emphasis on VERY FAST ATTACKS and RANGE — a complex goblin-engineered repeating mechanism, "
        "multiple rotating bolt launchers, wooden gears and rope pulleys spinning, "
        "ammunition hoppers overflowing with green bolts, same scale as D/E/G"
    )),
    ("G", "Plague Fort", (
        "large plague goblin fort, enormous plague catapult or launcher on the roof, "
        "emphasis on LONGEST RANGE and HIGH DAMAGE — a crude but powerful siege weapon, "
        "barrels of plague ammunition, green toxic clouds around the weapon, "
        "the most elaborate and dangerous goblin engineering, skull and crossbones flag"
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

    print(f"Goblins Tower A->G ({total} images, ~{DELAY}s delay)")
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
