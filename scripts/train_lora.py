"""
LoRA Training Pipeline for Lanecraft Building Sprites

Step 1: Curate & prep training images from the 4 asset packs
Step 2: Composite onto dark background, generate captions
Step 3: Zip and upload to Replicate for LoRA training
Step 4: Generate missing sprites once training completes

Usage:
  python scripts/train_lora.py prep        # Step 1-2: curate, composite, caption
  python scripts/train_lora.py train       # Step 3: upload and start training
  python scripts/train_lora.py status      # Check training status
  python scripts/train_lora.py generate    # Step 4: generate gap sprites
"""

import os
import sys
import json
import time
import random
import zipfile
import urllib.request
import hashlib

# Try to import PIL for image processing
try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Run: pip install Pillow")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
PREP_DIR = os.path.join(SCRIPT_DIR, "lora_training_data")
ZIP_PATH = os.path.join(SCRIPT_DIR, "lora_training_data.zip")
STATE_FILE = os.path.join(SCRIPT_DIR, "lora_state.json")
GENERATED_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora")

TRIGGER_WORD = "LCBLDG"
BG_COLOR = (40, 40, 50)  # dark blue-gray background
TARGET_SIZE = 1024  # Flux trains at 1024x1024

API_TOKEN = os.environ.get("REPLICATE_API_TOKEN")

# ============================================================
# Asset pack definitions
# ============================================================

PACKS = {
    "human": {
        "dir": os.path.join(PROJECT_DIR, "src", "assets", "images",
                            "Medieval Human Building Pack \u2013 2D Fantasy RTS Town Assets for Strategy Games", "Source"),
        "pattern": "Human Building ({n}).png",
        "style": "medieval European stone architecture, warm sandstone walls, orange-red tiled roofs, golden trim, wooden beams",
        "races": "Crown, Goblins",
        "count": 57,
    },
    "orc": {
        "dir": os.path.join(PROJECT_DIR, "src", "assets", "images",
                            "Fantasy RTS Orc Building Icons for Base Building and Strategy Games", "Source"),
        "pattern": "Orc Building ({n}).png",
        "style": "dark tribal orcish architecture, bone and hide decorations, wooden spikes, war banners, crude stone and metal",
        "races": "Horde, Demon",
        "count": 58,
    },
    "elf": {
        "dir": os.path.join(PROJECT_DIR, "src", "assets", "images",
                            "Fantasy RTS Elven Building Icons for Base Building and City-Building Games", "Source"),
        "pattern": "Elf Building ({n}).png",
        "style": "natural elven architecture, living wood and vines, leaf roofing, thorny red vines, teal accents, organic shapes",
        "races": "Tenders, Wild",
        "count": 53,  # actual count based on exploration (was 45 in CLAUDE.md but 53 found)
    },
    "nightelf": {
        "dir": os.path.join(PROJECT_DIR, "src", "assets", "images",
                            "Stylized Night Elf RTS Building Pack for Fantasy Strategy and RPG Games", "Source"),
        "pattern": "NightEfl Building ({n}).png",
        "style": "dark gothic fantasy architecture, dark stone with glowing purple and teal crystals, gold ornaments, mystical energy",
        "races": "Deep, Geists, Oozlings",
        "count": 55,
    },
}

# Building types for captioning — maps pack number to a description
# We'll auto-generate generic captions and let the LoRA learn the style
BUILDING_TYPES = [
    "barracks", "tower", "keep", "house", "temple", "workshop",
    "forge", "stable", "shrine", "outpost", "fortress", "hut",
    "market", "library", "altar", "monument", "gate", "wall segment",
    "watchtower", "hall", "camp", "pit", "den", "grove", "crypt",
    "reef", "grotto", "vat", "pool", "nest", "hollow", "sanctum",
]


def get_pack_images(pack_key):
    """Get all PNG file paths for a pack."""
    pack = PACKS[pack_key]
    images = []
    d = pack["dir"]
    if not os.path.isdir(d):
        print(f"  WARNING: Pack dir not found: {d}")
        return images
    for fname in os.listdir(d):
        if fname.endswith(".png") and not fname.endswith(".meta"):
            images.append(os.path.join(d, fname))
    images.sort()
    return images


def curate_images():
    """Select a diverse subset of images for training."""
    all_images = []
    for pack_key, pack in PACKS.items():
        imgs = get_pack_images(pack_key)
        print(f"  {pack_key}: {len(imgs)} images found")

        # Take a diverse sample — skip every Nth to avoid too-similar neighbors
        # For packs with 50+ images, take ~20-25 each
        if len(imgs) > 30:
            # Take every 2nd-3rd image for variety
            step = max(1, len(imgs) // 22)
            selected = imgs[::step][:25]
        else:
            selected = imgs[:20]

        for img_path in selected:
            all_images.append((pack_key, img_path))

    print(f"\n  Total curated: {len(all_images)} images")
    return all_images


def composite_on_background(img_path, output_path):
    """Composite RGBA image onto solid background, resize to target."""
    img = Image.open(img_path).convert("RGBA")

    # Create background
    bg = Image.new("RGBA", img.size, BG_COLOR + (255,))
    bg.paste(img, (0, 0), img)  # paste with alpha mask
    result = bg.convert("RGB")

    # Resize to fit within TARGET_SIZE while maintaining aspect ratio
    # Pad to square
    w, h = result.size
    scale = min(TARGET_SIZE / w, TARGET_SIZE / h) * 0.85  # 85% fill, leave margin
    new_w = int(w * scale)
    new_h = int(h * scale)
    result = result.resize((new_w, new_h), Image.LANCZOS)

    # Center on square canvas
    canvas = Image.new("RGB", (TARGET_SIZE, TARGET_SIZE), BG_COLOR)
    x = (TARGET_SIZE - new_w) // 2
    y = (TARGET_SIZE - new_h) // 2
    canvas.paste(result, (x, y))

    canvas.save(output_path, "PNG")
    return output_path


def generate_caption(pack_key, img_path):
    """Generate a training caption for an image."""
    pack = PACKS[pack_key]
    fname = os.path.basename(img_path)

    # Extract number from filename for variety in description
    num = ""
    for c in fname:
        if c.isdigit():
            num += c
    idx = int(num) if num else 0

    # Pick a building type descriptor based on index for variety
    btype = BUILDING_TYPES[idx % len(BUILDING_TYPES)]

    caption = (
        f"a {TRIGGER_WORD} isometric fantasy game building sprite, "
        f"cel-shaded with thick dark outlines, "
        f"{pack['style']}, "
        f"{btype} structure, "
        f"single building centered on dark background, "
        f"2D hand-painted RTS game asset"
    )
    return caption


def cmd_prep():
    """Curate, composite, and caption training images."""
    print("=== Step 1: Curating training images ===\n")

    os.makedirs(PREP_DIR, exist_ok=True)

    images = curate_images()

    print(f"\n=== Step 2: Compositing and captioning ===\n")

    for i, (pack_key, img_path) in enumerate(images):
        # Generate a short hash for unique filename
        short_hash = hashlib.md5(img_path.encode()).hexdigest()[:8]
        base_name = f"{pack_key}_{short_hash}"

        out_img = os.path.join(PREP_DIR, f"{base_name}.png")
        out_txt = os.path.join(PREP_DIR, f"{base_name}.txt")

        # Composite
        composite_on_background(img_path, out_img)

        # Caption
        caption = generate_caption(pack_key, img_path)
        with open(out_txt, "w", encoding="utf-8") as f:
            f.write(caption)

        print(f"  [{i+1}/{len(images)}] {os.path.basename(img_path)} -> {base_name}.png")

    # Create zip
    print(f"\n=== Creating zip: {ZIP_PATH} ===\n")
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(PREP_DIR):
            fpath = os.path.join(PREP_DIR, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, fname)

    zip_size = os.path.getsize(ZIP_PATH) / (1024 * 1024)
    file_count = len([f for f in os.listdir(PREP_DIR) if f.endswith(".png")])
    print(f"  Zip created: {zip_size:.1f} MB ({file_count} images + captions)")
    print(f"\n  Ready to train! Run: python scripts/train_lora.py train")


def api_request(method, path, body=None, files=None):
    """Make a request to the Replicate API."""
    if not API_TOKEN:
        print("ERROR: Set REPLICATE_API_TOKEN environment variable")
        sys.exit(1)

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


def upload_zip():
    """Upload the training zip to Replicate's file hosting."""
    if not API_TOKEN:
        print("ERROR: Set REPLICATE_API_TOKEN environment variable")
        sys.exit(1)

    print("Uploading training data to Replicate...")

    # Use Replicate's file upload API
    zip_size = os.path.getsize(ZIP_PATH)
    url = "https://api.replicate.com/v1/files"

    # Multipart upload
    import mimetypes
    boundary = "----ReplicateUpload" + hashlib.md5(str(time.time()).encode()).hexdigest()[:16]

    body_parts = []
    body_parts.append(f"--{boundary}\r\n".encode())
    body_parts.append(f'Content-Disposition: form-data; name="content"; filename="lora_training_data.zip"\r\n'.encode())
    body_parts.append(b'Content-Type: application/zip\r\n\r\n')
    with open(ZIP_PATH, "rb") as f:
        body_parts.append(f.read())
    body_parts.append(f"\r\n--{boundary}--\r\n".encode())

    body = b"".join(body_parts)

    req = urllib.request.Request(
        url, data=body,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )

    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())

    file_url = result.get("urls", {}).get("get", "")
    print(f"  Uploaded: {file_url}")
    return file_url


def cmd_train():
    """Upload training data and start LoRA training on Replicate."""
    if not os.path.exists(ZIP_PATH):
        print("ERROR: No training zip found. Run 'prep' first.")
        sys.exit(1)

    print("=== Starting LoRA Training ===\n")

    # Upload the zip file
    file_url = upload_zip()

    # Get the latest version of the trainer
    print("\nFetching trainer model version...")
    model_info = api_request("GET", "models/ostris/flux-dev-lora-trainer")
    latest_version = model_info["latest_version"]["id"]
    print(f"  Trainer version: {latest_version[:12]}...")

    # Check if we have a destination model, create if needed
    # The user needs to have a Replicate account username
    print("\nNote: The trained model will be published to your Replicate account.")
    print("Make sure you've created a model at replicate.com/create first,")
    print("or the training API will create one for you.\n")

    # Start training
    print("Starting training run...")
    training = api_request("POST", "trainings", {
        "model": "ostris/flux-dev-lora-trainer",
        "version": latest_version,
        "input": {
            "input_images": file_url,
            "trigger_word": TRIGGER_WORD,
            "steps": 1200,
            "learning_rate": 0.0001,
            "lora_rank": 16,
            "batch_size": 1,
            "resolution": "512,768,1024",
            "autocaption": False,  # we provide our own captions
        },
    })

    training_id = training.get("id", "unknown")
    status = training.get("status", "unknown")

    # Save state
    state = {
        "training_id": training_id,
        "status": status,
        "started_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "file_url": file_url,
    }
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

    print(f"\n  Training ID: {training_id}")
    print(f"  Status: {status}")
    print(f"  State saved to: {STATE_FILE}")
    print(f"\n  Monitor with: python scripts/train_lora.py status")
    print(f"  Or check: https://replicate.com/trainings/{training_id}")


def cmd_status():
    """Check training status."""
    if not os.path.exists(STATE_FILE):
        print("No training in progress. Run 'train' first.")
        return

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    training_id = state["training_id"]
    print(f"Training ID: {training_id}")
    print(f"Started: {state.get('started_at', 'unknown')}")

    result = api_request("GET", f"trainings/{training_id}")
    status = result.get("status", "unknown")
    print(f"Status: {status}")

    if status == "succeeded":
        model_url = result.get("output", {})
        print(f"\nTraining complete!")
        print(f"Model output: {model_url}")

        # Update state with model info
        state["status"] = "succeeded"
        state["model_output"] = model_url
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)

        print(f"\nReady to generate! Run: python scripts/train_lora.py generate")

    elif status == "failed":
        error = result.get("error", "unknown error")
        logs = result.get("logs", "")
        print(f"\nTraining FAILED: {error}")
        if logs:
            print(f"\nLogs (last 500 chars):\n{logs[-500:]}")

    elif status == "processing":
        logs = result.get("logs", "")
        if logs:
            # Show last few lines of training logs
            lines = logs.strip().split("\n")
            print(f"\nRecent logs:")
            for line in lines[-10:]:
                print(f"  {line}")

    else:
        print(f"  (waiting to start...)")


# ============================================================
# Gap definitions — what sprites to generate
# ============================================================

GAPS = [
    # Deep towers
    {"race": "deep", "building": "tower", "node": "B", "name": "Tidal Pool Tower",
     "desc": "aquatic watchtower with teal crystal dome, dark stone base, coral details, gold chain ornaments, slow aura effect"},
    {"race": "deep", "building": "tower", "node": "C", "name": "Vortex Pool",
     "desc": "aquatic vortex tower, swirling water energy, dark stone with teal whirlpool on top, faster attack variant"},
    {"race": "deep", "building": "tower", "node": "D", "name": "Abyssal Pool",
     "desc": "massive deep-sea fortress tower, enormous teal dome, very thick dark stone walls, heavily fortified, barnacles and coral armor"},
    {"race": "deep", "building": "tower", "node": "E", "name": "Crushing Tide",
     "desc": "offensive aquatic war tower, mounted harpoon launcher on top, teal crystal targeting lens, battle-worn stone"},
    {"race": "deep", "building": "tower", "node": "F", "name": "Tsunami Tower",
     "desc": "rapid-fire aquatic tower, multiple water jet cannons, teal energy conduits, fast-attack mechanism"},
    {"race": "deep", "building": "tower", "node": "G", "name": "Frozen Pool",
     "desc": "long-range aquatic siege tower, massive ice crystal cannon on top, frost aura, teal and white frozen stone"},

    # Geists towers
    {"race": "geists", "building": "tower", "node": "B", "name": "Shadow Spire",
     "desc": "haunted gothic tower, dark grey stone, glowing purple stained glass, spectral flames, reinforced and sturdy"},
    {"race": "geists", "building": "tower", "node": "C", "name": "Wither Spire",
     "desc": "rapid-attack undead tower, multiple skull-shaped arrow slits, purple energy bolts, faster attack mechanism"},
    {"race": "geists", "building": "tower", "node": "D", "name": "Void Spire",
     "desc": "massive dark fortress tower, very thick obsidian walls, purple void energy core, heavily fortified undead bastion"},
    {"race": "geists", "building": "tower", "node": "E", "name": "Blight Spire",
     "desc": "offensive undead war tower, mounted spectral cannon, purple death energy beam weapon, battle-scarred dark stone"},
    {"race": "geists", "building": "tower", "node": "F", "name": "Nightmare Spire",
     "desc": "rapid-fire undead tower, multiple ghostly bolt launchers, purple energy conduits, mechanical nightmare mechanism"},
    {"race": "geists", "building": "tower", "node": "G", "name": "Death Spire",
     "desc": "long-range undead siege tower, enormous death ray crystal on top, purple devastation beam, ultimate dark power"},

    # Geists casters
    {"race": "geists", "building": "caster", "node": "C", "name": "Dark Sanctum",
     "desc": "dark sorcerer sanctum, obsidian altar with swirling purple dark magic, floating rune stones, trains dark sorcerers"},
    {"race": "geists", "building": "caster", "node": "D", "name": "Necro Sanctum",
     "desc": "necromancer sanctum, bone-decorated dark temple, green necromantic glow, skull totems, trains necromancers who summon skeletons"},
    {"race": "geists", "building": "caster", "node": "E", "name": "Soul Sanctum",
     "desc": "soul harvester sanctum, purple soul-catching crystals, spectral chains, ghostly energy vortex, trains soul harvesters"},
    {"race": "geists", "building": "caster", "node": "F", "name": "Shadow Sanctum",
     "desc": "shadow sorcerer sanctum, dark purple shadow magic, floating shadow orbs, obsidian pillars, trains shadow sorcerers"},

    # Geists ranged
    {"race": "geists", "building": "ranged", "node": "D", "name": "Plague Tomb",
     "desc": "plague archer tomb, dark stone with green plague mist, poison arrow racks, diseased aura, trains plague archers"},
    {"race": "geists", "building": "ranged", "node": "E", "name": "Hex Tomb",
     "desc": "hex volley tomb, purple hexagonal rune patterns, magical bolt launchers, trains hex volley wraiths"},
    {"race": "geists", "building": "ranged", "node": "F", "name": "Wailing Tomb",
     "desc": "wailing skull tomb, skull-shaped architecture, ghostly wailing energy, bone ballista components visible"},

    # Oozlings towers
    {"race": "oozlings", "building": "tower", "node": "B", "name": "Slime Pillar",
     "desc": "reinforced slime pillar tower, twisted dark wood with purple flower petals, ooze dripping, sturdier than base"},
    {"race": "oozlings", "building": "tower", "node": "C", "name": "Rapid Pillar",
     "desc": "fast-attack slime pillar, multiple ooze nozzles for rapid fire, bubbling purple-green slime, mechanical pump"},
    {"race": "oozlings", "building": "tower", "node": "D", "name": "Grand Pillar",
     "desc": "massive fortified slime pillar, enormous purple flower canopy, very thick dark wood walls, heavily armored with ooze"},
    {"race": "oozlings", "building": "tower", "node": "E", "name": "Acid Pillar",
     "desc": "offensive acid pillar, dripping green acid, corrosive damage focus, acid-etched dark stone, melting details"},
    {"race": "oozlings", "building": "tower", "node": "F", "name": "Storm Pillar",
     "desc": "rapid-fire storm pillar, crackling purple lightning, multiple ooze bolt launchers, electrical storm energy"},
    {"race": "oozlings", "building": "tower", "node": "G", "name": "Ooze Beacon",
     "desc": "ultimate ooze beacon tower, massive pulsing slime crystal on top, radiating chain lightning, the most powerful ooze structure"},

    # Oozlings casters
    {"race": "oozlings", "building": "caster", "node": "B", "name": "Bloater Vat",
     "desc": "bloater breeding vat, stone base with large bubbling purple-blue crystal, golden rim cauldron, trains big bloater slimes"},
    {"race": "oozlings", "building": "caster", "node": "C", "name": "Quick Vat",
     "desc": "quick bloater vat, sleeker design, speed-enhancing runes, faster slime production, trains quick bloater slimes"},
    {"race": "oozlings", "building": "caster", "node": "D", "name": "Mega Vat",
     "desc": "mega bloater vat, enormous bubbling cauldron, thick reinforced walls, trains mega bloater slimes"},
    {"race": "oozlings", "building": "caster", "node": "E", "name": "Acid Bloater Vat",
     "desc": "acid bloater vat, corrosive green acid bubbling, acid-etched stone, trains acid bloater slimes"},
    {"race": "oozlings", "building": "caster", "node": "F", "name": "Hyper Vat",
     "desc": "hyper bloater vat, crackling energy, rapid production mechanism, trains hyper bloater slimes"},
    {"race": "oozlings", "building": "caster", "node": "G", "name": "Ooze Lord Vat",
     "desc": "ultimate ooze lord vat, massive ornate cauldron, radiating purple power, trains ooze lord slimes"},

    # Oozlings melee
    {"race": "oozlings", "building": "melee", "node": "D", "name": "Armored Vat",
     "desc": "armored globule vat, thick reinforced walls, heavy plating, trains armored glob slimes"},
    {"race": "oozlings", "building": "melee", "node": "E", "name": "Acid Vat",
     "desc": "acid globule vat, corrosive green acid dripping, acid-etched stone, trains acid glob slimes"},
    {"race": "oozlings", "building": "melee", "node": "F", "name": "Volatile Vat",
     "desc": "volatile globule vat, unstable energy, warning markings, explosive slime brewing, trains volatile glob slimes"},

    # Oozlings ranged
    {"race": "oozlings", "building": "ranged", "node": "D", "name": "Acid Spitter Vat",
     "desc": "acid spitter vat, nozzles for acid projectiles, corrosive green bubbling, trains acid spitter slimes"},
    {"race": "oozlings", "building": "ranged", "node": "E", "name": "Burst Vat",
     "desc": "burst spitter vat, multiple rapid-fire nozzles, pressurized slime tanks, trains burst spitter slimes"},
    {"race": "oozlings", "building": "ranged", "node": "F", "name": "Hyper Vat",
     "desc": "hyper spitter vat, overcharged energy conduits, rapid slime production, trains hyper spitter slimes"},

    # Wild towers
    {"race": "wild", "building": "tower", "node": "B", "name": "Thorn Nest Tower",
     "desc": "reinforced thorn nest tower, thick thorny wooden walls, green leaf canopy, poison-tipped barbs, sturdy beast den"},
    {"race": "wild", "building": "tower", "node": "C", "name": "Venom Nest Tower",
     "desc": "fast-attack venom nest, multiple thorn launchers, dripping green venom, rapid-fire poison barbs"},
    {"race": "wild", "building": "tower", "node": "D", "name": "Great Nest Tower",
     "desc": "massive great nest fortress, enormous thorny wooden walls, very thick bark armor, heavily fortified beast stronghold"},
    {"race": "wild", "building": "tower", "node": "E", "name": "Poison Nest Tower",
     "desc": "offensive poison nest, concentrated venom launchers, glowing green poison reservoirs, deadly toxin weapons"},
    {"race": "wild", "building": "tower", "node": "F", "name": "Web Nest Tower",
     "desc": "rapid-fire web nest, spider silk launchers, sticky web traps, multiple fast-firing thorn cannons"},
    {"race": "wild", "building": "tower", "node": "G", "name": "Alpha Nest Tower",
     "desc": "ultimate alpha nest tower, massive ancient living wood fortress, glowing with primal power, the most powerful beast structure"},

    # Wild casters
    {"race": "wild", "building": "caster", "node": "D", "name": "Primal Hollow",
     "desc": "primal sage hollow, ancient living wood, glowing green nature runes, primal energy, trains primal sages"},
    {"race": "wild", "building": "caster", "node": "E", "name": "Storm Hollow",
     "desc": "storm sage hollow, wind-swept branches, crackling lightning, storm energy swirling, trains storm sages"},
    {"race": "wild", "building": "caster", "node": "F", "name": "Feral Hollow",
     "desc": "feral sage hollow, wild overgrown structure, savage thorns, glowing feral eyes in the darkness, trains feral sages"},
    {"race": "wild", "building": "caster", "node": "G", "name": "Alpha Hollow",
     "desc": "ultimate alpha sage hollow, massive ancient tree structure, radiating nature power, trains alpha sages"},

    # Wild melee
    {"race": "wild", "building": "melee", "node": "F", "name": "Viper Nest Den",
     "desc": "viper nest den, snake-themed lair, coiled serpent decorations, venom dripping, trains viper nest spawns"},
    {"race": "wild", "building": "melee", "node": "G", "name": "Spider Swarm Den",
     "desc": "spider swarm den, massive web-covered structure, multiple spider egg sacs, trains spider swarm spawns"},
]

# Pack style to use per race for generation prompts
RACE_PACK_STYLE = {
    "deep": "nightelf",
    "geists": "nightelf",
    "oozlings": "nightelf",
    "wild": "elf",
    "crown": "human",
    "horde": "orc",
    "goblins": "human",
    "demon": "orc",
    "tenders": "elf",
}


def cmd_generate():
    """Generate missing sprites using the trained LoRA."""
    if not os.path.exists(STATE_FILE):
        print("ERROR: No training state found. Run 'train' first.")
        sys.exit(1)

    with open(STATE_FILE, "r") as f:
        state = json.load(f)

    if state.get("status") != "succeeded":
        print("Training not yet complete. Run 'status' to check.")
        return

    model_output = state.get("model_output", "")
    if not model_output:
        print("ERROR: No model output URL in state. Check training results.")
        return

    print(f"=== Generating {len(GAPS)} missing sprites ===\n")
    print(f"Model: {model_output}\n")

    os.makedirs(GENERATED_DIR, exist_ok=True)
    candidates_per = 4
    delay_between = 5  # seconds between requests to avoid rate limiting

    for i, gap in enumerate(GAPS):
        race = gap["race"]
        building = gap["building"]
        node = gap["node"]
        name = gap["name"]
        desc = gap["desc"]
        pack_style = PACKS[RACE_PACK_STYLE[race]]["style"]

        slot_dir = os.path.join(GENERATED_DIR, race, f"{building}_{node}")
        os.makedirs(slot_dir, exist_ok=True)

        prompt = (
            f"a {TRIGGER_WORD} isometric fantasy game building sprite, "
            f"cel-shaded with thick dark outlines, "
            f"{pack_style}, "
            f"{name}: {desc}, "
            f"single building centered on dark background, "
            f"2D hand-painted RTS game asset"
        )

        print(f"[{i+1}/{len(GAPS)}] {race}:{building}:{node} ({name})")

        for c in range(candidates_per):
            outpath = os.path.join(slot_dir, f"candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"  Candidate {c+1}: exists, skipping")
                continue

            print(f"  Candidate {c+1}/{candidates_per}...")

            try:
                prediction = api_request("POST", "predictions", {
                    "model": model_output if "/" in str(model_output) else None,
                    "version": model_output if "/" not in str(model_output) else None,
                    "input": {
                        "prompt": prompt,
                        "num_outputs": 1,
                        "guidance_scale": 7.5,
                        "num_inference_steps": 28,
                        "width": 1024,
                        "height": 1024,
                        "disable_safety_checker": True,
                    },
                })

                pred_id = prediction["id"]

                # Poll for result
                while True:
                    time.sleep(4)
                    result = api_request("GET", f"predictions/{pred_id}")
                    status = result["status"]
                    if status == "succeeded":
                        urls = result.get("output", [])
                        if urls:
                            urllib.request.urlretrieve(urls[0], outpath)
                            print(f"    Saved: {outpath}")
                        break
                    elif status == "failed":
                        print(f"    FAILED: {result.get('error', 'unknown')}")
                        break

            except Exception as e:
                print(f"    Error: {e}")

            time.sleep(delay_between)

        print()

    print(f"Done! Review generated sprites in: {GENERATED_DIR}")
    print(f"Pick the best candidates and copy them into the asset pack folders.")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1].lower()

    if cmd == "prep":
        cmd_prep()
    elif cmd == "train":
        cmd_train()
    elif cmd == "status":
        cmd_status()
    elif cmd == "generate":
        cmd_generate()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)


if __name__ == "__main__":
    main()
