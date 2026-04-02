"""
Process projectile images:
1. Remove backgrounds (rembg) for AI-generated images
2. Trim to content bounding box
3. Resize to uniform 128x128 with padding
4. Normalize filenames (no spaces, snake_case)
5. Copy already-clean pixel art as-is (just rename)

Outputs to src/assets/images/projectiles/processed/
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageFilter

# Only import rembg when needed
PROJ_DIR = Path(r"C:\Users\junk7\KroolWorld\ASCIIWars\src\assets\images\projectiles")
OUT_DIR = PROJ_DIR / "processed"
TARGET_SIZE = 128

# Files that are already clean pixel art — just copy with normalized name
ALREADY_CLEAN = {"Arrow.png", "Gnoll_Bone.png"}

# These also need background removal (fake transparency / checkered pattern baked in)
# TRANSPARENT_BG = {} — none are truly transparent

# Everything else needs rembg background removal


def normalize_name(filename: str) -> str:
    """Convert to snake_case, no spaces."""
    name = Path(filename).stem.lower()
    name = name.replace(" ", "_").replace("-", "_")
    # Fix typo
    if name == "music_not3e":
        name = "music_note"
    return name + ".png"


def trim_to_content(img: Image.Image, padding: int = 4) -> Image.Image:
    """Crop to non-transparent content with small padding."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # Get bounding box of non-transparent pixels
    bbox = img.getbbox()
    if bbox is None:
        return img

    # Add padding
    x0 = max(0, bbox[0] - padding)
    y0 = max(0, bbox[1] - padding)
    x1 = min(img.width, bbox[2] + padding)
    y1 = min(img.height, bbox[3] + padding)

    return img.crop((x0, y0, x1, y1))


def resize_to_uniform(img: Image.Image, target: int) -> Image.Image:
    """Resize to fit within target x target, centered on transparent background."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # Scale to fit
    w, h = img.size
    scale = min(target / w, target / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))

    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Center on transparent canvas
    canvas = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    offset_x = (target - new_w) // 2
    offset_y = (target - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y), resized)

    return canvas


def process_clean(filepath: Path) -> Image.Image:
    """For already-clean files: just load, trim, resize."""
    img = Image.open(filepath).convert("RGBA")
    img = trim_to_content(img)
    return resize_to_uniform(img, TARGET_SIZE)


def process_transparent(filepath: Path) -> Image.Image:
    """For files with existing transparency: trim and resize."""
    img = Image.open(filepath).convert("RGBA")
    img = trim_to_content(img)
    return resize_to_uniform(img, TARGET_SIZE)


def process_remove_bg(filepath: Path) -> Image.Image:
    """Use rembg to remove background, then trim and resize."""
    from rembg import remove

    with open(filepath, "rb") as f:
        input_data = f.read()

    output_data = remove(input_data)

    from io import BytesIO
    img = Image.open(BytesIO(output_data)).convert("RGBA")
    img = trim_to_content(img)
    return resize_to_uniform(img, TARGET_SIZE)


def main():
    OUT_DIR.mkdir(exist_ok=True)

    files = sorted(PROJ_DIR.glob("*.png"))
    print(f"Found {len(files)} projectile images\n")

    for filepath in files:
        fname = filepath.name
        out_name = normalize_name(fname)
        out_path = OUT_DIR / out_name

        if fname in ALREADY_CLEAN:
            print(f"  COPY   {fname} -> {out_name}")
            img = process_clean(filepath)
        elif False:  # no transparent-bg files
            pass
        else:
            print(f"  REMBG  {fname} -> {out_name}")
            img = process_remove_bg(filepath)

        img.save(out_path, "PNG", optimize=True)

        orig_size = filepath.stat().st_size
        new_size = out_path.stat().st_size
        print(f"         {orig_size//1024}KB -> {new_size//1024}KB  ({img.size[0]}x{img.size[1]})")

    print(f"\nDone! Processed files in: {OUT_DIR}")
    print("\nReview the output. If everything looks good, you can replace the originals.")


if __name__ == "__main__":
    main()
