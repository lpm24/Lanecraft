"""
Batch sprite generator using Replicate API.
Generates building upgrade variants for races missing unique tower/caster art.

Usage:
  $env:REPLICATE_API_TOKEN="r8_yourtoken"
  python scripts/generate_sprites.py

Output goes to scripts/generated_sprites/<race>/<building>/
Review candidates manually, then copy winners into the asset pack folders.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN")
if not API_TOKEN:
    print("ERROR: Set $env:REPLICATE_API_TOKEN first")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "generated_sprites")

# --- Style descriptions per pack (derived from viewing actual assets) ---

STYLE_BASE = (
    "2D fantasy RTS building icon, cel-shaded with thick dark outlines, "
    "isometric view, detailed hand-painted style, semi-transparent dark background gradient, "
    "game asset for a strategy game, high detail"
)

PACK_STYLES = {
    "nightelf": (
        f"{STYLE_BASE}, dark gothic fantasy architecture, "
        "dark grey and slate blue stone, glowing purple/magenta crystal accents, "
        "pointed arches, spiral staircases, mystical energy, "
        "night elf aesthetic, dark enchanted building"
    ),
    "elf": (
        f"{STYLE_BASE}, natural fantasy architecture, "
        "wooden construction with green leaf roofing, thorny red vines, "
        "teal banner flags, overgrown forest structure, "
        "wild druidic aesthetic, organic shapes"
    ),
    "human": (
        f"{STYLE_BASE}, medieval European architecture, "
        "warm sandstone walls, red-orange tiled roof, golden trim, "
        "arched doorways, small and cozy, heraldic shield emblem, "
        "classic fantasy village building"
    ),
}

# --- What to generate ---
# Each entry: (race, building_type, upgrade_tier, pack_style, description_addon)

GENERATIONS = [
    # === DEEP (NightElf pack) — tower upgrades ===
    ("deep", "tower", "B", "nightelf",
     "aquatic watchtower, teal crystal dome on dark stone base, coral and barnacle details, gold chain ornaments"),
    ("deep", "tower", "C", "nightelf",
     "tall aquatic fortress tower, large teal crystal dome, dark stone with gold bands, hanging chain ornaments, ocean-themed"),
    ("deep", "tower", "D", "nightelf",
     "reinforced aquatic watchtower, teal glass panels, dark stone, gold trim, slightly larger than basic tower"),
    ("deep", "tower", "E", "nightelf",
     "grand aquatic spire tower, multiple teal crystal domes, dark stone with golden filigree, imposing sea fortress"),
    ("deep", "tower", "F", "nightelf",
     "massive aquatic citadel tower, enormous teal dome, dark stone fortification, gold chains and ornaments everywhere"),
    ("deep", "tower", "G", "nightelf",
     "ultimate aquatic tower of power, radiant teal crystal crown, dark obsidian stone, golden arcane rings, most ornate version"),

    # === GEISTS (NightElf pack) — tower upgrades ===
    ("geists", "tower", "B", "nightelf",
     "haunted gothic bell tower, dark grey stone, glowing purple stained glass windows, spiral staircase, spectral energy"),
    ("geists", "tower", "C", "nightelf",
     "tall haunted gothic tower, dark stone with purple crystal windows, pointed roof, ghostly aura, larger and more ominous"),
    ("geists", "tower", "D", "nightelf",
     "reinforced haunted watchtower, dark stone, purple banners, ghostly wisps, slightly upgraded from basic"),
    ("geists", "tower", "E", "nightelf",
     "grand spectral tower, dark stone spire, large glowing purple crystals, floating magical runes"),
    ("geists", "tower", "F", "nightelf",
     "massive undead fortress tower, dark obsidian, enormous purple crystal crown, death energy radiating"),
    ("geists", "tower", "G", "nightelf",
     "ultimate spectral tower, towering dark spire with brilliant purple energy, ghostly flames, most powerful version"),

    # === OOZLINGS (NightElf pack) — tower upgrades ===
    ("oozlings", "tower", "B", "nightelf",
     "organic ooze tower, twisted dark wood pillars with purple flower petals on top, slime dripping, alchemical"),
    ("oozlings", "tower", "C", "nightelf",
     "tall organic tower, dark twisted wood with large purple petal canopy, bubbling ooze pool at base, mystical"),
    ("oozlings", "tower", "D", "nightelf",
     "reinforced organic watchtower, dark wood and stone, purple flowers, vine-wrapped, slightly upgraded"),
    ("oozlings", "tower", "E", "nightelf",
     "grand alchemical tower, twisted dark branches, massive purple bloom on top, glowing ooze veins"),
    ("oozlings", "tower", "F", "nightelf",
     "massive organic spire tower, enormous purple flower crown, dark gnarled wood, pulsing with slime energy"),
    ("oozlings", "tower", "G", "nightelf",
     "ultimate organic tower, colossal purple crystal-flower hybrid, dark ancient wood, most powerful alchemical structure"),

    # === OOZLINGS — caster upgrades ===
    ("oozlings", "caster", "B", "nightelf",
     "alchemical workshop, stone base with large purple crystal floating above, golden rim cauldron, mystical glow"),
    ("oozlings", "caster", "C", "nightelf",
     "large alchemical laboratory, bubbling purple crystal above stone structure, wooden supports, arcane energy"),
    ("oozlings", "caster", "D", "nightelf",
     "upgraded alchemical workshop, bigger purple crystal, reinforced stone base, golden trim, more magical"),
    ("oozlings", "caster", "E", "nightelf",
     "grand alchemical sanctum, massive floating purple crystal, ornate stone and gold base, powerful magical aura"),
    ("oozlings", "caster", "F", "nightelf",
     "enormous alchemical tower, brilliant purple crystal crown, dark stone fortress base, peak magical power"),
    ("oozlings", "caster", "G", "nightelf",
     "ultimate alchemical nexus, radiant purple crystal constellation above grand stone temple, most powerful version"),

    # === WILD (Elf pack) — tower upgrades ===
    ("wild", "tower", "B", "elf",
     "wooden guard tower with green leaf roof, thorny red vines climbing up, teal flag on top, forest watchtower"),
    ("wild", "tower", "C", "elf",
     "tall wooden watchtower, thick green leaf canopy roof, red thorny vines, wooden platform, forest fortress"),
    ("wild", "tower", "D", "elf",
     "reinforced wooden tower, green leaf roof, red vine armor, teal pennant, slightly upgraded forest outpost"),
    ("wild", "tower", "E", "elf",
     "grand forest spire tower, massive leaf canopy, thick red thorn vines, imposing wooden structure"),
    ("wild", "tower", "F", "elf",
     "massive druidic tower fortress, enormous green leaf dome, red thorny armor plating, ancient wood"),
    ("wild", "tower", "G", "elf",
     "ultimate wild tower, colossal leaf crown, glowing red thorns, ancient living wood structure, most powerful"),

    # === GEISTS — caster upgrades ===
    ("geists", "caster", "C", "nightelf",
     "spectral ritual altar, dark stone with glowing purple runes, floating ghostly orbs, undead shrine"),
    ("geists", "caster", "D", "nightelf",
     "upgraded spectral shrine, dark stone, larger purple crystal focus, ghostly energy swirling"),
    ("geists", "caster", "E", "nightelf",
     "grand undead sanctum, dark obsidian with brilliant purple crystals, death magic radiating"),
    ("geists", "caster", "F", "nightelf",
     "massive spectral temple, enormous purple crystal spire, dark stone, ghostly flames and runes"),

    # === CROWN — missing hut ===
    ("crown", "hut", "A", "human",
     "small medieval peasant cottage, warm sandstone walls, red-orange tiled roof, tiny wooden door, simple cozy house"),
]

CANDIDATES_PER_SLOT = 4


def api_request(method, path, body=None):
    """Make a request to the Replicate API."""
    url = f"https://api.replicate.com/v1/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def generate_image(prompt):
    """Submit a generation to Replicate and wait for the result."""
    # Using SDXL — good quality, cheap, fast
    prediction = api_request("POST", "predictions", {
        "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        "input": {
            "prompt": prompt,
            "negative_prompt": (
                "3D render, photo, realistic, blurry, low quality, text, watermark, "
                "white background, plain background, UI elements, multiple buildings, "
                "top-down view, side view, pixel art"
            ),
            "width": 512,
            "height": 640,
            "num_outputs": 1,
            "guidance_scale": 7.5,
            "num_inference_steps": 30,
        },
    })

    pred_id = prediction["id"]
    print(f"  Prediction {pred_id} started...")

    # Poll for completion
    while True:
        time.sleep(3)
        result = api_request("GET", f"predictions/{pred_id}")
        status = result["status"]
        if status == "succeeded":
            return result["output"]
        elif status == "failed":
            print(f"  FAILED: {result.get('error', 'unknown')}")
            return None
        # still processing, keep waiting


def download_image(url, filepath):
    """Download an image from URL to local path."""
    urllib.request.urlretrieve(url, filepath)


def main():
    total = len(GENERATIONS) * CANDIDATES_PER_SLOT
    print(f"Generating {total} candidate images for {len(GENERATIONS)} sprite slots...")
    print(f"Output: {OUTPUT_DIR}\n")

    for i, (race, building, tier, pack, desc) in enumerate(GENERATIONS):
        prompt = f"{PACK_STYLES[pack]}, {desc}"

        slot_dir = os.path.join(OUTPUT_DIR, race, f"{building}_{tier}")
        os.makedirs(slot_dir, exist_ok=True)

        print(f"[{i+1}/{len(GENERATIONS)}] {race}:{building}:{tier}")

        for c in range(CANDIDATES_PER_SLOT):
            outpath = os.path.join(slot_dir, f"candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"  Candidate {c+1} already exists, skipping")
                continue

            print(f"  Generating candidate {c+1}/{CANDIDATES_PER_SLOT}...")
            try:
                urls = generate_image(prompt)
                if urls and len(urls) > 0:
                    download_image(urls[0], outpath)
                    print(f"  Saved: {outpath}")
                else:
                    print(f"  No output returned")
            except Exception as e:
                print(f"  Error: {e}")

        print()

    print("Done! Review candidates in:")
    print(f"  {OUTPUT_DIR}")
    print()
    print("Next steps:")
    print("  1. Pick the best candidate for each slot")
    print("  2. Remove the dark background (make transparent)")
    print("  3. Copy into the appropriate asset pack folder with next sequential number")
    print("  4. Add entry to RACE_BUILDING_SPRITES in SpriteLoader.ts")


if __name__ == "__main__":
    main()
