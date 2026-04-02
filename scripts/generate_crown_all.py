"""
Generate ALL Crown buildings using the trained LoRA.
Crown = blue/brown/grey medieval human kingdom. Balanced, shields.
Color scheme: blue accents, warm brown/grey stone, golden trim.

Melee: Swordsman -> B: Buccaneer(pirate/gold) / C: Noble(king/royal)
  B branch: D=Corsair Captain, E=Pirate King (pirate gold theme continues)
  C branch: F=King(dodge/speed), G=Champion(pure damage)

Ranged: Bowman -> B: Heavy Bow (same archer) / C: Dwarfette Scout (dwarf!)
  B branch: D=Longbow, E=War Bow (same archer, bigger bows)
  C branch: F=Dwarfette Blitzer (bigger dwarf), G=Cannon (SIEGE)

Caster: Priest -> B: High Priest(shields) / C: War Mage(AoE damage)
  B branch: D=Arch Bishop, E=War Cleric (holy shield theme)
  C branch: F=Battle Magus, G=Archmage (fire/AoE mage theme)

Tower: blue/grey stone towers (already done but regenerate to match)
Foundry: gold smelting building (ability building)
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "crown_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "medieval human kingdom architecture, blue and grey stone walls, "
    "warm brown wood accents, golden trim, blue banners and shields, "
    "clean and orderly, heraldic emblems, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE BARRACKS (Swordsman -> Buccaneer(pirate)/Noble(royal) -> pirates/royals) ===
    ("melee", "A", "Swordsman Barracks", (
        "small human barracks, a blue-grey stone military building with blue banner, "
        "sword rack by the door, shield emblem above entrance, "
        "compact and orderly, blue roof tiles, golden door frame"
    )),
    ("melee", "B", "Buccaneer Barracks", (
        "medium pirate-themed barracks, a blue-grey stone building with gold coin decorations, "
        "pirate treasure chest by the entrance, crossed cutlass emblem, "
        "emphasis on PIRATE GOLD THEME — gold coins, treasure, nautical rope details, "
        "blue stone with gold accents"
    )),
    ("melee", "C", "Noble Barracks", (
        "medium noble knight barracks, an elegant blue-grey stone building with royal banner, "
        "knight armor on display, crown emblem above door, ornate stone carvings, "
        "emphasis on ROYAL NOBILITY — refined, golden crown details, blue heraldry, "
        "same size as B but more elegant"
    )),
    ("melee", "D", "Corsair Captain Barracks", (
        "large corsair captain headquarters, a sturdy pirate-themed stone building, "
        "ship wheel decoration, treasure hoard visible, corsair captain portrait, "
        "emphasis on TANK and GOLD — heavy construction, gold coin piles, "
        "same scale as E/F/G"
    )),
    ("melee", "E", "Pirate King Barracks", (
        "large pirate king palace, an elaborate treasure-filled pirate headquarters, "
        "golden pirate crown emblem, overflowing gold treasure, pirate king banner, "
        "emphasis on MAXIMUM GOLD — the richest pirate building, dripping with treasure, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "King Barracks", (
        "large king's guard quarters, a regal blue-grey stone palace guard building, "
        "royal crown on top, elegant blue and gold decoration, knight statues flanking, "
        "emphasis on SPEED and DODGE — swift royal guards, elegant and fast, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Champion Barracks", (
        "large champion arena, an impressive blue-grey stone training hall, "
        "champion trophy weapons mounted on walls, battle standard on top, "
        "emphasis on MAXIMUM DAMAGE — the finest warriors train here, "
        "golden champion emblem, same scale as D/E/F"
    )),

    # === RANGED RANGE (Bowman -> Heavy Bow/Dwarfette -> Longbow/War Bow/Dwarfette Blitzer/Cannon) ===
    ("ranged", "A", "Archery Range", (
        "small human archery range, a blue-grey stone range with target boards, "
        "arrow racks, bow storage, blue banner with arrow emblem, "
        "compact archer training post"
    )),
    ("ranged", "B", "Heavy Bow Range", (
        "medium heavy bow range, a sturdier archery building with larger bow racks, "
        "heavier arrows, reinforced stone walls, blue banner, "
        "emphasis on DAMAGE — bigger bows, heavier ammunition"
    )),
    ("ranged", "C", "Dwarfette Workshop", (
        "medium dwarf workshop, a compact sturdy stone building with dwarf proportions, "
        "smaller doorway, mechanical crossbow mechanisms, gear decorations, "
        "emphasis on DWARF ENGINEERING — short and stout construction, brass gears, "
        "same size as B but dwarf-themed"
    )),
    ("ranged", "D", "Longbow Range", (
        "large longbow range, an elaborate archery training ground with tall bow racks, "
        "long-range target practice setup, precision equipment, "
        "emphasis on DAMAGE and RANGE — the finest archers, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "War Bow Range", (
        "large war bow armory, a massive archery arsenal with explosive arrow storage, "
        "splash damage bow mechanisms, war arrow production, "
        "emphasis on SPLASH DAMAGE — area bombardment arrows, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Dwarfette Blitzer Workshop", (
        "large dwarf blitzer workshop, a fortified dwarf engineering lab, "
        "rapid-fire mechanical crossbow contraptions, brass and iron machinery, "
        "emphasis on VERY FAST ATTACKS — dwarf rapid-fire engineering, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Cannon Foundry", (
        "large cannon forge, an enormous stone forge with a massive cannon being built, "
        "cannon barrels, cannonball ammunition stacked, black powder kegs, "
        "emphasis on SIEGE — the biggest weapon, devastating long range, "
        "same scale as D/E/F"
    )),

    # === CASTER CHAPEL (Priest -> High Priest(shields)/War Mage(AoE) -> Bishop/Cleric/Magus/Archmage) ===
    ("caster", "A", "Chapel", (
        "small human chapel, a blue-grey stone chapel with stained glass window, "
        "holy cross symbol, golden bell on top, prayer candles, "
        "compact and sacred, blue-tinted glass"
    )),
    ("caster", "B", "High Priest Chapel", (
        "medium high priest chapel, a larger holy building with protective shield emblem, "
        "golden holy symbols, shield-shaped stained glass, healing aura, "
        "emphasis on SHIELDS — protective magic, holy defense"
    )),
    ("caster", "C", "War Mage Tower", (
        "medium war mage tower, a stone tower with arcane fire energy at the top, "
        "magical runes on the walls, fire crystal focus, offensive magic design, "
        "emphasis on AoE DAMAGE — arcane destructive magic, "
        "same size as B but more aggressive"
    )),
    ("caster", "D", "Arch Bishop Cathedral", (
        "large arch bishop cathedral, an imposing stone cathedral with holy stained glass, "
        "multiple shield-shaped windows, golden cross spire, holy healing energy, "
        "emphasis on MAXIMUM SHIELDS — the holiest protective building, "
        "same scale as E/F/G"
    )),
    ("caster", "E", "War Cleric Fortress", (
        "large war cleric fortress, a fortified chapel-fortress hybrid, "
        "shield emblem combined with weapons, battle-priest aesthetic, "
        "emphasis on DAMAGE plus SHIELDS — offensive defense, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Battle Magus Tower", (
        "large battle magus tower, an imposing arcane tower with fire and burn magic, "
        "large fire crystal on top, arcane circles, burning runes, "
        "emphasis on HEAVY AoE DAMAGE and BURN — destructive arcane magic, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Archmage Sanctum", (
        "large archmage sanctum, the ultimate arcane tower with massive fire crystal crown, "
        "enormous AoE burn energy radiating, the most powerful mage building, "
        "emphasis on MAXIMUM AoE and BURN — devastating arcane destruction, "
        "same scale as D/E/F"
    )),

    # === TOWER (blue/grey stone towers — regenerate to match Crown color scheme) ===
    ("tower", "A", "Crown Tower", (
        "small blue-grey stone watchtower with blue banner, "
        "simple battlements, arrow slit, wooden door, "
        "blue roof tiles, golden trim, compact and orderly"
    )),
    ("tower", "B", "Reinforced Tower", (
        "medium reinforced blue-grey stone tower, thicker walls with iron banding, "
        "blue shield emblem, pointed blue roof, stone buttresses, "
        "emphasis on DURABILITY — thick walls, heavy stone"
    )),
    ("tower", "C", "Rapid Tower", (
        "medium rapid-fire tower, sleeker blue-grey stone with multiple arrow slits, "
        "repeating crossbow mechanism on top, bolt ammunition racks, "
        "emphasis on SPEED — rapid fire, same size as B"
    )),
    ("tower", "D", "Fortress Tower", (
        "large fortress tower, massive blue-grey stone fortification, "
        "thick double walls, iron-banded gates, blue heraldic banners, "
        "emphasis on MAXIMUM TOUGHNESS — impenetrable fortress, "
        "same scale as E/F/G"
    )),
    ("tower", "E", "War Tower", (
        "large war tower, tall blue-grey stone with multiple weapon platforms, "
        "mounted ballista, war banners, golden battlements, "
        "emphasis on DAMAGE and RANGE — offensive tower, "
        "same scale as D/F/G"
    )),
    ("tower", "F", "Gatling Tower", (
        "large gatling tower, blue-grey stone with mechanical rapid-fire crossbow on top, "
        "wooden gears and repeating bolt mechanism, ammunition hoppers, "
        "emphasis on VERY FAST ATTACKS — rapid fire engineering, "
        "same scale as D/E/G"
    )),
    ("tower", "G", "Siege Tower", (
        "large siege tower, enormous blue-grey stone fortress with trebuchet on roof, "
        "golden crown emblem, massive long-range weapon, siege ammunition, "
        "emphasis on MAXIMUM DAMAGE and RANGE — ultimate fortress, "
        "same scale as D/E/F"
    )),

    # === FOUNDRY (ability building — gold smelting) ===
    ("foundry", "A", "Gold Foundry", (
        "medium gold foundry, a stone forge building with molten gold pouring from a crucible, "
        "golden glow from the furnace, gold ingots stacked outside, "
        "chimney with golden smoke, smelting equipment, anvil, "
        "emphasis on GOLD PRODUCTION — melted liquid gold, glowing forge, "
        "a place where gold is smelted and refined"
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
    total = len(BUILDINGS) * CANDIDATES
    done = 0

    print(f"Crown ALL buildings ({total} images, ~{DELAY}s delay)")
    print(f"Output: {OUT_DIR}\n")

    for btype, node, name, desc in BUILDINGS:
        prompt = f"{STYLE}, {name}: {desc}"

        for c in range(CANDIDATES):
            outpath = os.path.join(OUT_DIR, f"{btype}_{node}_candidate_{c+1}.png")
            if os.path.exists(outpath):
                print(f"[{btype}:{node}] Candidate {c+1}: exists, skipping")
                done += 1
                continue

            print(f"[{btype}:{node}] {name} - candidate {c+1}/{CANDIDATES}...")
            success = generate(prompt, outpath)
            done += 1

            if success:
                print(f"    Saved: {btype}_{node}_candidate_{c+1}.png")

            remaining = total - done
            if remaining > 0:
                print(f"    Waiting {DELAY}s... ({remaining} remaining)")
                time.sleep(DELAY)

    print(f"\nDone! {done}/{total} generated.")
    print(f"Review: {OUT_DIR}")


if __name__ == "__main__":
    main()
