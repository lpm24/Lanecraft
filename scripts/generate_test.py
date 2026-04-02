"""
Proof-of-concept: Generate Crown Tower A->G progression using Replicate.
Uses the Tiny Swords Tower A as img2img base, generates progressively
stronger/larger tower variants.

Usage:
  $env:REPLICATE_API_TOKEN="r8_yourtoken"
  python scripts/generate_test.py

Output: scripts/generated_sprites/crown/tower_test/
"""

import os
import sys
import json
import time
import base64
import urllib.request

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN")
if not API_TOKEN:
    print("ERROR: Set $env:REPLICATE_API_TOKEN first")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "generated_sprites", "crown", "tower_test")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Reference image: Crown Tower A (Tiny Swords)
REF_IMAGE = os.path.join(
    os.path.dirname(__file__), "..",
    "src", "assets", "images",
    "Tiny Swords (Free Pack)", "Tiny Swords (Free Pack)",
    "Buildings", "Blue Buildings", "Tower.png"
)

# Also load Crown Tower B (Human pack) as style target
STYLE_REF = os.path.join(
    os.path.dirname(__file__), "..",
    "src", "assets", "images",
    "Medieval Human Building Pack \u2013 2D Fantasy RTS Town Assets for Strategy Games",
    "Source", "Human Building (24).png"
)

# Crown tower upgrade progression with specific mechanics
# Crown tower upgrades — each prompt conveys the gameplay effect visually
# A = base, B/C = tier 1 branches, D/E = tier 2, F/G = tier 3
# Stats from data.ts:
#   B: +60% HP, +30% dmg (tankier, harder hitting)
#   C: faster atk, +range (speed/precision)
#   D: +150% HP, +range (massive fortification)
#   E: +50% dmg, +2 range (offensive reach)
#   F: very fast atk, +range (rapid fire)
#   G: +60% dmg, +3 range (ultimate long-range siege)

TIERS = {
    # --- BASE (tier 0) ---
    "A": {
        "name": "Tower",
        "desc": (
            "Basic small medieval stone watchtower. Simple round tower with battlements on top, "
            "a single arrow slit, wooden door at the base. Compact and humble. "
            "Blue-grey stone, a small wooden platform on top for one archer."
        ),
        "size": "small, compact",
        "strength": 0.75,
    },

    # --- TIER 1 (B and C are equal quality, different specialization) ---
    "B": {
        "name": "Reinforced Tower",
        "desc": (
            "Reinforced defensive tower — visually STURDIER than the basic tower. "
            "Thicker stone walls with iron banding and rivets. Stone buttresses at the base. "
            "A pointed roof with orange tiles. Taller than A. "
            "The emphasis is DURABILITY — thick walls, heavy stone, iron reinforcement plates. "
            "A shield emblem mounted on the front wall."
        ),
        "size": "medium",
        "strength": 0.70,
    },
    "C": {
        "name": "Rapid Tower",
        "desc": (
            "Fast-firing tower — visually shows SPEED and PRECISION. Same overall size as Reinforced Tower "
            "but different character — not as thick-walled but bristling with weapons. "
            "Multiple arrow slits on every side for rapid volleys. "
            "A mounted repeating crossbow mechanism on the rooftop platform. "
            "Quiver racks of bolts visible. Lighter colored stone, emphasizing agility over bulk. "
            "A weathervane or targeting scope on top."
        ),
        "size": "medium",
        "strength": 0.72,
    },

    # --- TIER 2 (D, E, F, G are all equal quality — bigger than B/C, different specialization) ---
    "D": {
        "name": "Fortress Tower",
        "desc": (
            "Fortress tower — the TANKIEST specialization. Upgrades from Reinforced Tower (B). "
            "Thicker double-walls, darker heavier stone, multiple layers of battlements. "
            "Wide base with stone buttresses. Iron-banded gates, murder holes above the entrance. "
            "Looks almost indestructible. Crown heraldry carved into the stone. "
            "Clearly bigger and more impressive than B, but same general scale as E/F/G."
        ),
        "size": "large",
        "strength": 0.74,
    },
    "E": {
        "name": "War Tower",
        "desc": (
            "War tower — offensive DAMAGE specialization. Upgrades from Reinforced Tower (B). "
            "Same overall scale as D/F/G but focused on weaponry instead of walls. "
            "Multiple firing platforms at different heights, a large mounted ballista on top. "
            "War banners and crown pennants flying. Golden trim on battlements. "
            "Burning braziers for fire arrows. Battle-scarred stone showing combat use."
        ),
        "size": "large",
        "strength": 0.74,
    },
    "F": {
        "name": "Gatling Tower",
        "desc": (
            "Gatling tower — RAPID FIRE specialization. Upgrades from Rapid Tower (C). "
            "Same overall scale as D/E/G but dominated by a mechanical repeating crossbow on top. "
            "Visible wooden gears, cranks, and rotating mechanisms. Multiple loaded bolt magazines. "
            "Brass and iron fittings. The mechanical contraption is the visual centerpiece. "
            "Feed hoppers of ammunition. Medieval engineering marvel."
        ),
        "size": "large",
        "strength": 0.76,
    },
    "G": {
        "name": "Siege Tower",
        "desc": (
            "Siege tower — LONG RANGE specialization. Upgrades from Rapid Tower (C). "
            "Same overall scale as D/E/F but topped with an enormous trebuchet or siege cannon. "
            "The weapon dominates the roofline, aimed at distant targets. "
            "Golden crown emblem prominently displayed. Stacked ammunition — boulders, explosive barrels. "
            "Iron-reinforced at every joint. Emphasis on projecting power at extreme distance."
        ),
        "size": "large",
        "strength": 0.78,
    },
}

STYLE_PROMPT = (
    "2D fantasy RTS building icon, cel-shaded with thick dark outlines, "
    "isometric 3/4 view, detailed hand-painted style, dark background gradient, "
    "fantasy European stone architecture, warm sandstone and grey stone walls, "
    "orange-red tiled roof sections, golden trim and accents, "
    "wooden support beams, arched doorways, "
    "single building centered in frame, video game asset, family friendly, cartoon style"
)

CANDIDATES = 4


def image_to_data_uri(filepath):
    """Convert a local image to a base64 data URI."""
    with open(filepath, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    return f"data:image/png;base64,{data}"


def api_request(method, path, body=None):
    url = f"https://api.replicate.com/v1/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def generate_with_img2img(prompt, image_uri, strength):
    """Generate using SDXL img2img — uses reference image as starting point."""
    prediction = api_request("POST", "predictions", {
        "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        "input": {
            "prompt": prompt,
            "image": image_uri,
            "prompt_strength": strength,
            "negative_prompt": (
                "3D render, photo, realistic, blurry, low quality, text, watermark, "
                "white background, plain background, UI elements, multiple buildings, "
                "top-down view, side view, modern, sci-fi, futuristic, "
                "characters, people, units, soldiers"
            ),
            "width": 512,
            "height": 640,
            "num_outputs": 1,
            "guidance_scale": 7.5,
            "num_inference_steps": 35,
        },
    })

    pred_id = prediction["id"]
    print(f"    Prediction {pred_id}...")

    while True:
        time.sleep(3)
        result = api_request("GET", f"predictions/{pred_id}")
        status = result["status"]
        if status == "succeeded":
            return result["output"]
        elif status == "failed":
            print(f"    FAILED: {result.get('error', 'unknown')}")
            return None


def generate_text_only(prompt):
    """Generate using SDXL text-to-image (no reference image)."""
    prediction = api_request("POST", "predictions", {
        "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
        "input": {
            "prompt": prompt,
            "negative_prompt": (
                "3D render, photo, realistic, blurry, low quality, text, watermark, "
                "white background, plain background, UI elements, multiple buildings, "
                "top-down view, side view, modern, sci-fi, futuristic, "
                "characters, people, units, soldiers"
            ),
            "width": 512,
            "height": 640,
            "num_outputs": 1,
            "guidance_scale": 7.5,
            "num_inference_steps": 35,
        },
    })

    pred_id = prediction["id"]
    print(f"    Prediction {pred_id}...")

    while True:
        time.sleep(3)
        result = api_request("GET", f"predictions/{pred_id}")
        status = result["status"]
        if status == "succeeded":
            return result["output"]
        elif status == "failed":
            print(f"    FAILED: {result.get('error', 'unknown')}")
            return None


def download_image(url, filepath):
    urllib.request.urlretrieve(url, filepath)


def main():
    print("Crown Tower A->G Proof of Concept")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Candidates per tier: {CANDIDATES}")
    print()

    # Load reference images
    print("Loading reference images...")
    ref_uri = image_to_data_uri(REF_IMAGE)
    style_uri = image_to_data_uri(STYLE_REF) if os.path.exists(STYLE_REF) else None
    print(f"  Tower A (Tiny Swords): loaded")
    if style_uri:
        print(f"  Tower B (Human Pack): loaded as style target")
    print()

    total = len(TIERS) * CANDIDATES
    generated = 0

    for tier_key, tier in TIERS.items():
        tier_dir = os.path.join(OUTPUT_DIR, tier_key)
        os.makedirs(tier_dir, exist_ok=True)

        full_prompt = f"{STYLE_PROMPT}, {tier['desc']}, {tier['size']} building"

        print(f"[{tier_key}] {tier['name']} ({tier['size']})")
        print(f"  Prompt: ...{tier['desc'][:80]}")

        for c in range(CANDIDATES):
            outpath = os.path.join(tier_dir, f"candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"  Candidate {c+1}: already exists, skipping")
                generated += 1
                continue

            print(f"  Candidate {c+1}/{CANDIDATES}:")

            try:
                # Always use Human Pack Tower B as img2img base —
                # Tiny Swords pixel art is too low-res for SDXL
                if style_uri:
                    urls = generate_with_img2img(full_prompt, style_uri, tier['strength'])
                else:
                    urls = generate_text_only(full_prompt)

                if urls and len(urls) > 0:
                    download_image(urls[0], outpath)
                    generated += 1
                    print(f"    Saved: {outpath}")
                else:
                    print(f"    No output")
            except Exception as e:
                print(f"    Error: {e}")

        print()

    print(f"Done! Generated {generated}/{total} images.")
    print(f"\nReview: {OUTPUT_DIR}")
    print("Each tier subfolder (A/ B/ C/ ... G/) has 4 candidates to compare.")
    print("\nNext: open the review HTML and compare AI candidates against existing Human Pack sprites.")


if __name__ == "__main__":
    main()
