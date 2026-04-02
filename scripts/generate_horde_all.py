"""
Generate ALL Horde buildings using the trained LoRA.
Horde = orc warriors. Dark wood, stone, bone, reds and oranges.
KEY: Color branching reflects unit color changes:
  A = GREEN orc theme (base)
  B/D/E = BLUE orc branch (tankier, defensive, aura)
  C/F/G = ORANGE orc branch (aggressive, rage, siege)
Towers have no color branching — just crude orc palisade progression.
Caster A = war drum pit. Keep the drum aesthetic.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "horde_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

# Horde: dark wood, crude stone, bone, hide, war banners
# Colors shift with upgrades: green(A) -> blue(BDE) or orange(CFG)
STYLE_BASE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "orcish tribal architecture, dark heavy wood and crude stone, "
    "bone decorations, war banners, hide coverings, iron spikes, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

# Color-specific style additions
GREEN = "green orc tribal colors, green war paint, green banners and accents"
BLUE = "blue orc tribal colors, blue war paint, blue banners and accents, blue-tinted stone"
ORANGE = "orange and red orc tribal colors, orange war paint, orange-red banners, fire and rage accents"

BUILDINGS = [
    # === MELEE CAMP (Brute -> Iron Brute(blue)/Raging Brute(orange) -> Warchief/Berserker/Bloodrager/Skull Crusher) ===
    ("melee", "A", "Orc Brute Camp", (
        f"{GREEN}, small orc warrior camp, a crude wooden stockade with green orc war banner, "
        "bone trophies on the gate, training dummy inside, "
        "compact orcish barracks, heavy log construction"
    )),
    ("melee", "B", "Iron Brute Camp", (
        f"{BLUE}, medium iron brute camp, a sturdier orc barracks with blue war banners, "
        "iron-reinforced wooden walls, heavy armor on display, blue shield emblem, "
        "emphasis on TOUGHNESS — iron banding, thick walls"
    )),
    ("melee", "C", "Raging Brute Camp", (
        f"{ORANGE}, medium raging brute camp, an aggressive orc arena with orange-red war banners, "
        "fire braziers burning, rage symbols painted on walls, weapon racks, "
        "emphasis on AGGRESSION — fire and fury, same size as B"
    )),
    ("melee", "D", "Warchief Hall", (
        f"{BLUE}, large warchief's hall, an imposing orc command center with blue war banners, "
        "warchief throne visible, heavy iron and stone construction, aura totems, "
        "emphasis on ARMOR AURA — protective, commanding, blue-tinted stone, "
        "same scale as E/F/G"
    )),
    ("melee", "E", "Berserker Pit", (
        f"{BLUE}, large berserker fighting pit, a savage orc arena with blue war paint markings, "
        "bloodstained ground, weapon racks of heavy axes, blue rage totems, "
        "emphasis on DAMAGE AURA and KNOCKBACK — brutal power, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Bloodrager Lodge", (
        f"{ORANGE}, large bloodrager lodge, a fiery orc war lodge with orange-red banners, "
        "fire pits burning, speed totems, orange war paint everywhere, "
        "emphasis on HASTE and SPEED AURA — burning with rage energy, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Skull Crusher Arena", (
        f"{ORANGE}, large skull crusher arena, the ultimate orc fighting arena with orange-red fire, "
        "skull trophy pile, massive weapons on display, orange rage energy, "
        "emphasis on MAXIMUM DAMAGE AURA — the most feared orc warriors train here, "
        "same scale as D/E/F"
    )),

    # === RANGED POST (Cleaver -> Heavy Cleaver(blue)/Orc Catapult(orange) -> War/Battle(blue), Bombard/Doom(orange)) ===
    ("ranged", "A", "Orc Axe Post", (
        f"{GREEN}, small orc ranged post, a crude wooden watchtower with green orc banner, "
        "throwing axe racks, bone-handled cleavers on display, "
        "compact orc ranged outpost, scout tower aesthetic"
    )),
    ("ranged", "B", "Heavy Cleaver Post", (
        f"{BLUE}, medium heavy cleaver post, a sturdier orc ranged barracks with blue banners, "
        "heavier throwing axes, reinforced walls, blue shield markings, "
        "emphasis on DAMAGE — bigger axes, stronger throws"
    )),
    ("ranged", "C", "Orc Catapult Post", (
        f"{ORANGE}, medium orc catapult emplacement, a crude siege weapon with orange war banners, "
        "catapult made of heavy logs and rope, rock ammunition pile, "
        "emphasis on SIEGE — devastating ranged weapon, orange fire pots, "
        "same size as B"
    )),
    ("ranged", "D", "War Thrower Post", (
        f"{BLUE}, large war thrower barracks, an elaborate orc ranged training ground with blue banners, "
        "war throwing axes with knockback power, speed aura totems, "
        "emphasis on KNOCKBACK and SPEED AURA — powerful throws, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Battle Cleaver Post", (
        f"{BLUE}, large battle cleaver armory, a massive orc weapon forge with blue banners, "
        "splash-damage cleaver weapons, damage aura totems, "
        "emphasis on SPLASH DAMAGE and DAMAGE AURA, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Horde Bombard", (
        f"{ORANGE}, large horde bombard siege emplacement, an enormous orc siege weapon with orange banners, "
        "massive bombard cannon made of iron and wood, explosive ammunition, "
        "emphasis on HEAVY SIEGE and ARMOR AURA — devastating long range, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Doom Catapult", (
        f"{ORANGE}, large doom catapult, the ultimate orc siege weapon with orange-red fire, "
        "enormous catapult hurling flaming boulders, massive AoE devastation, "
        "emphasis on MAXIMUM SIEGE DAMAGE — the biggest orc weapon, "
        "same scale as D/E/F"
    )),

    # === CASTER DRUM PIT (War Chanter -> Battle Chanter(blue)/War Drummer(orange) -> chanters and shamans) ===
    ("caster", "A", "War Drum Pit", (
        f"{GREEN}, small orc war drum pit, a crude stone pit with a large war drum in the center, "
        "green orc banner, drumsticks crossed above the entrance, "
        "bone and hide drum, rhythmic war energy, compact drum circle"
    )),
    ("caster", "B", "Battle Chanter Pit", (
        f"{BLUE}, medium battle chanter pit, a larger drum circle with blue war banners, "
        "multiple war drums, chain heal totems, blue healing energy from the drums, "
        "emphasis on CHAIN HEALING — the drums heal allies, blue glow"
    )),
    ("caster", "C", "War Drummer Pit", (
        f"{ORANGE}, medium war drummer pit, an aggressive drum circle with orange war banners, "
        "war drums beating faster, orange rage energy, speed-boosting rhythms, "
        "emphasis on SPEED and RANGE — faster drumming, same size as B"
    )),
    ("caster", "D", "Blood Chanter Pit", (
        f"{BLUE}, large blood chanter temple, an imposing orc drum hall with blue banners, "
        "enormous war drums, chain heal totems reaching many allies, blue healing aura, "
        "emphasis on CHAIN HEAL 5 ALLIES and DAMAGE AURA, "
        "same scale as E/F/G"
    )),
    ("caster", "E", "Rage Shaman Pit", (
        f"{BLUE}, large rage shaman sanctum, a powerful orc shaman lodge with blue totems, "
        "rage aura totems, blue-fire braziers, large AoE effect, "
        "emphasis on DAMAGE and SPEED AURA — empowering nearby orcs, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Swift Chanter Pit", (
        f"{ORANGE}, large swift chanter drum hall, rapid drumming station with orange banners, "
        "multiple small drums for fast rhythm, orange energy pulses, armor totems, "
        "emphasis on VERY FAST DRUMMING and ARMOR AURA, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Doom Chanter Pit", (
        f"{ORANGE}, large doom chanter temple, the ultimate orc war drum temple with orange-red fire, "
        "enormous doom drums, devastating sound waves, damage aura totems, "
        "emphasis on MAXIMUM DAMAGE and RANGE — the mightiest war drums, "
        "same scale as D/E/F"
    )),

    # === TOWER (Orc Palisade — crude wooden spike walls, no color branching) ===
    ("tower", "A", "Orc Palisade", (
        "small orc palisade, a crude wooden watchtower made of sharpened logs, "
        "iron spikes on top, bone decorations, orc war banner, "
        "a simple scout tower, dark wood construction"
    )),
    ("tower", "B", "Orc Palisade", (
        "medium reinforced orc palisade, thicker sharpened log walls with iron bands, "
        "heavier bone decorations, more war banners, crude stone base, "
        "emphasis on DURABILITY — thick dark wood, iron spikes"
    )),
    ("tower", "C", "Spiked Palisade", (
        "medium spiked palisade, a faster-firing orc tower bristling with iron spikes, "
        "multiple arrow slits for rapid fire, bone and iron spike crown, "
        "emphasis on SPEED — rapid attack mechanisms, same size as B"
    )),
    ("tower", "D", "War Palisade", (
        "large war palisade fortress, an enormous orc defensive fortification, "
        "massive sharpened log walls, iron-reinforced everything, bone armor, "
        "emphasis on MAXIMUM TOUGHNESS — impenetrable orc fortress, "
        "same scale as E/F/G"
    )),
    ("tower", "E", "Siege Palisade", (
        "large siege palisade, a heavy orc weapon tower with mounted siege equipment, "
        "heavy ballista or axe thrower on top, damage-focused design, "
        "emphasis on DAMAGE and RANGE — offensive orc fortification, "
        "same scale as D/F/G"
    )),
    ("tower", "F", "Rapid Palisade", (
        "large rapid palisade, an orc tower with multiple rapid-fire mechanisms, "
        "many arrow slits and axe launchers, fast attack speed design, "
        "emphasis on VERY FAST ATTACKS — bristling with weapons, "
        "same scale as D/E/G"
    )),
    ("tower", "G", "Doom Palisade", (
        "large doom palisade, the ultimate orc defense tower, "
        "enormous dark wood and iron fortress, skull trophies, doom banner, "
        "emphasis on MAXIMUM DAMAGE and RANGE — the most feared orc tower, "
        "same scale as D/E/F"
    )),

    # === HUT (harvests Gold + Meat) ===
    ("hut", "A", "Orc Harvester Hut", (
        "small orc worker hut, a crude but sturdy wooden shack with hide roof, "
        "meat drying rack outside, mining pick and axe, orc-sized doorway, "
        "bone and iron tools, compact and functional, green orc banner"
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

    print(f"Horde ALL buildings ({total} images, ~{DELAY}s delay)")
    print(f"Output: {OUT_DIR}\n")

    for btype, node, name, desc in BUILDINGS:
        prompt = f"{STYLE_BASE}, {name}: {desc}"

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
