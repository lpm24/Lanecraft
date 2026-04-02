"""
Generate iOS App Store screenshots from raw gameplay captures.

HOW TO USE:
  1. Take screenshots on your phone while playing the game
  2. Drop the raw PNGs into marketing/z/
  3. Name each file with the caption text you want displayed, e.g.:
       "pick from 9 unique races.PNG"
       "easy to play war rts game.PNG"
     The filename (minus extension) becomes the uppercase caption.
  4. Run: python scripts/generate_store_screenshots.py
  5. Output lands in marketing/apple/ (iPhone) and marketing/apple-ipad/ (iPad)
  6. Upload to App Store Connect under the correct device size tabs

APP STORE DIMENSION REQUIREMENTS (as of March 2026):
  - iPhone 6.5": 1284x2778 or 2778x1284 (landscape)  <-- we use this one
  - Also accepted: 1242x2688 or 2688x1242
  - iPad 12.9":  2048x2732 or 2732x2048 (landscape)
  - Format: RGB PNG or JPEG, NO alpha channel (transparency rejected)
  - Apple auto-scales these to cover smaller device sizes

  If Apple changes accepted dimensions, update IPHONE_SIZE / IPAD_SIZE below.
  The error message from App Store Connect will tell you the accepted sizes.

RAW SCREENSHOT NOTES:
  - Raw captures from an iPhone are typically 1179x2556 (6.1" device)
  - The script scales + pads these to fit the target size
  - iOS status bar (time, battery) is included — Apple allows this
  - Files sort alphabetically, so prefix with numbers to control order
    (e.g. "01 pick from 9 unique races.PNG")

DEPENDENCIES:
  pip install Pillow
  Font: C:/Windows/Fonts/impact.ttf (bundled with Windows)
  On macOS: change CAPTION_FONT_PATH to "/System/Library/Fonts/Impact.ttf"
  or any other bold condensed font

VISUAL STYLE:
  - Dark teal vertical gradient background (matches game's UI palette)
  - White uppercase Impact text with black drop shadow at top
  - Gameplay screenshot centered below with rounded corners
  - All spacing is ratio-based so it scales to any target size
"""

from PIL import Image, ImageDraw, ImageFont
import os

# ============================================================================
# CONFIG — tweak these to change the output
# ============================================================================

# Input/output directories (relative to repo root)
RAW_DIR = os.path.join("marketing", "z")
IPHONE_DIR = os.path.join("marketing", "apple")
IPAD_DIR = os.path.join("marketing", "apple-ipad")

# Target dimensions — update these if Apple changes requirements
# Check App Store Connect error messages for accepted sizes
IPHONE_SIZE = (1284, 2778)   # iPhone 6.5" portrait
IPAD_SIZE = (2048, 2732)     # iPad 12.9" portrait

# Background gradient colors (R, G, B) — top to bottom
# Current: dark teal matching the game's field/UI color scheme
BG_COLOR_TOP = (24, 48, 52)
BG_COLOR_BOTTOM = (16, 32, 38)

# Caption text styling
CAPTION_COLOR = (255, 255, 255)          # white text
CAPTION_SHADOW_COLOR = (0, 0, 0)         # black drop shadow
CAPTION_SHADOW_OFFSET = 3                # shadow offset in pixels
CAPTION_FONT_PATH = "C:/Windows/Fonts/impact.ttf"
CAPTION_FONT_SIZE_RATIO = 0.038          # font size as fraction of output height
CAPTION_MAX_WIDTH_RATIO = 0.85           # max text width as fraction of output width

# Layout ratios (all relative to output dimensions)
CAPTION_Y_RATIO = 0.03           # top padding above caption
SCREENSHOT_TOP_RATIO = 0.10      # earliest y where screenshot can start
SCREENSHOT_BOTTOM_RATIO = 0.98   # bottom edge of screenshot area
SCREENSHOT_SIDE_PAD_RATIO = 0.03 # horizontal padding on each side
CAPTION_TO_SCREENSHOT_GAP = 20   # min px gap between caption bottom and screenshot

# Corner rounding on the gameplay screenshot (px)
CORNER_RADIUS = 24

# ============================================================================
# IMPLEMENTATION
# ============================================================================


def make_gradient(size, color_top, color_bottom):
    """Create a vertical linear gradient from color_top to color_bottom."""
    w, h = size
    img = Image.new("RGB", size, color_top)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        r = int(color_top[0] * (1 - t) + color_bottom[0] * t)
        g = int(color_top[1] * (1 - t) + color_bottom[1] * t)
        b = int(color_top[2] * (1 - t) + color_bottom[2] * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    return img


def round_corners(img, radius):
    """Return a copy of img with an alpha mask for rounded corners."""
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), img.size], radius=radius, fill=255)
    result = img.copy()
    result.putalpha(mask)
    return result


def caption_from_filename(filename):
    """
    Extract caption text from filename.
    "pick from 9 unique races.PNG" -> "pick from 9 unique races"
    Strips extension and trailing dots/spaces.
    """
    name = os.path.splitext(filename)[0]
    name = name.rstrip(". ")
    return name


def wrap_text(text, font, max_width, draw):
    """Word-wrap text to fit within max_width pixels. Returns list of lines."""
    words = text.split()
    lines = []
    current_line = ""
    for word in words:
        test = f"{current_line} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line = test
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    if current_line:
        lines.append(current_line)
    return lines


def draw_caption(draw, text, font, target_size, y_start):
    """
    Draw centered, word-wrapped caption with drop shadow.
    Returns the y coordinate of the bottom of the text.
    """
    w, h = target_size
    max_text_width = int(w * CAPTION_MAX_WIDTH_RATIO)
    lines = wrap_text(text.upper(), font, max_text_width, draw)

    line_height = font.size + 8
    y = y_start

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (w - text_w) // 2
        # Shadow (offset down-right for depth)
        draw.text(
            (x + CAPTION_SHADOW_OFFSET, y + CAPTION_SHADOW_OFFSET),
            line, fill=CAPTION_SHADOW_COLOR, font=font
        )
        # Main text
        draw.text((x, y), line, fill=CAPTION_COLOR, font=font)
        y += line_height

    return y


def generate_screenshot(raw_path, caption, target_size, output_path):
    """
    Compose a single App Store screenshot:
    gradient background + caption text + scaled gameplay image with rounded corners.
    Saves as RGB PNG (no alpha).
    """
    w, h = target_size

    # 1. Gradient background
    bg = make_gradient(target_size, BG_COLOR_TOP, BG_COLOR_BOTTOM)
    draw = ImageDraw.Draw(bg)

    # 2. Caption text
    font_size = int(h * CAPTION_FONT_SIZE_RATIO)
    font = ImageFont.truetype(CAPTION_FONT_PATH, font_size)
    caption_y = int(h * CAPTION_Y_RATIO)
    text_bottom = draw_caption(draw, caption, font, target_size, caption_y)

    # 3. Load raw screenshot
    raw = Image.open(raw_path).convert("RGB")

    # 4. Calculate available area below caption
    pad_x = int(w * SCREENSHOT_SIDE_PAD_RATIO)
    top_y = max(int(h * SCREENSHOT_TOP_RATIO), text_bottom + CAPTION_TO_SCREENSHOT_GAP)
    bot_y = int(h * SCREENSHOT_BOTTOM_RATIO)

    avail_w = w - 2 * pad_x
    avail_h = bot_y - top_y

    # 5. Scale to fit available area, preserving aspect ratio
    raw_aspect = raw.width / raw.height
    avail_aspect = avail_w / avail_h

    if raw_aspect > avail_aspect:
        new_w = avail_w
        new_h = int(avail_w / raw_aspect)
    else:
        new_h = avail_h
        new_w = int(avail_h * raw_aspect)

    scaled = raw.resize((new_w, new_h), Image.LANCZOS)

    # 6. Round corners and composite onto background
    rounded = round_corners(scaled, CORNER_RADIUS)
    x = (w - new_w) // 2
    y = top_y + (avail_h - new_h) // 2
    bg.paste(scaled, (x, y), rounded.split()[3])  # alpha channel as mask

    # 7. Save as RGB PNG — App Store rejects images with alpha
    bg.save(output_path, "PNG")
    print(f"  -> {output_path} ({w}x{h})")


def main():
    os.makedirs(IPHONE_DIR, exist_ok=True)
    os.makedirs(IPAD_DIR, exist_ok=True)

    # Sorted alphabetically — prefix filenames with numbers to control order
    raw_files = sorted([
        f for f in os.listdir(RAW_DIR)
        if f.lower().endswith((".png", ".jpg", ".jpeg"))
    ])

    if not raw_files:
        print(f"No screenshots found in {RAW_DIR}")
        return

    print(f"Found {len(raw_files)} screenshots in {RAW_DIR}\n")

    for i, filename in enumerate(raw_files, 1):
        raw_path = os.path.join(RAW_DIR, filename)
        caption = caption_from_filename(filename)

        print(f"[{i}/{len(raw_files)}] {caption}")

        iphone_out = os.path.join(IPHONE_DIR, f"screenshot_{i}.png")
        generate_screenshot(raw_path, caption, IPHONE_SIZE, iphone_out)

        ipad_out = os.path.join(IPAD_DIR, f"screenshot_{i}.png")
        generate_screenshot(raw_path, caption, IPAD_SIZE, ipad_out)

    print(f"\nDone! Generated {len(raw_files)} screenshots for iPhone + iPad.")
    print(f"  iPhone ({IPHONE_SIZE[0]}x{IPHONE_SIZE[1]}): {IPHONE_DIR}/")
    print(f"  iPad ({IPAD_SIZE[0]}x{IPAD_SIZE[1]}): {IPAD_DIR}/")


if __name__ == "__main__":
    main()
