"""
Generate ALL Demon buildings using the trained LoRA.
Demon = glass cannon, burn, fire, hellfire, dark magic. No gold economy (Meat+Wood).
Melee: Shadow Rhino Smasher — each upgrade is a DIFFERENT COLOR:
  A = dark shadow/purple (base). B = icy blue. C = red/fire. D = green/tan.
  E = white/light blue. F = black/gold. G = deep turquoise.
  Buildings should reflect these color shifts.
Ranged: Eye Sniper (cyclops archer) — same model all levels. G = Brimstone Cannon siege.
Caster: Game Master / Fire Lord — same model all levels, fire magic.
Tower: Demon turrets — hellfire, dark stone, fire.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "demon_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "demonic hellfire architecture, dark obsidian stone, lava and fire, "
    "hellish and menacing, sharp angles, demonic runes, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE PIT (Shadow Rhino Smasher — each tier has a unique color theme) ===
    ("melee", "A", "Demon Smasher Pit", (
        "small demon pit, dark obsidian stone pit with DARK PURPLE and SHADOW energy, "
        "shadow rhino horn trophies, dark smoky entrance, purple demonic runes, "
        "compact and ominous, dark shadow aesthetic"
    )),
    ("melee", "B", "Inferno Smasher Pit", (
        "medium demon pit with ICY BLUE color theme, blue-tinted obsidian, "
        "ice-blue crystal decorations, frost and fire combined, blue demonic energy, "
        "emphasis on TOUGHNESS — heavier stone, blue ice armor accents"
    )),
    ("melee", "C", "Blaze Smasher Pit", (
        "medium demon pit with BRIGHT RED and FIRE color theme, "
        "red-hot lava veins in the stone, blazing fire braziers, red demonic runes, "
        "emphasis on SPEED — aggressive fire energy, same size as B"
    )),
    ("melee", "D", "Doom Smasher Pit", (
        "large demon pit with GREEN and TAN color theme, "
        "green toxic fire, tan sandstone mixed with obsidian, poison-green lava, "
        "emphasis on BURN DAMAGE — toxic green flames, "
        "same scale as E/F/G"
    )),
    ("melee", "E", "Bloodfire Berserker Pit", (
        "large demon pit with WHITE and LIGHT BLUE color theme, "
        "white marble mixed with obsidian, pale blue ethereal fire, ghostly white energy, "
        "emphasis on KILL SCALING — grows stronger with each kill, spectral glow, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Phoenix Blade Pit", (
        "large demon pit with BLACK and GOLD color theme, "
        "black obsidian with gold inlay and trim, golden demonic runes, "
        "emphasis on REVIVE and SPEED — phoenix rebirth energy, golden flames, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Magma Smasher Pit", (
        "large demon pit with DEEP TURQUOISE color theme, "
        "turquoise crystal formations in dark stone, teal-green magma, "
        "emphasis on MAXIMUM BURN — turquoise hellfire, exotic and powerful, "
        "same scale as D/E/F"
    )),

    # === RANGED SPIRE (Eye Sniper=cyclops archer — consistent demonic eye/fire theme) ===
    ("ranged", "A", "Demon Eye Spire", (
        "small demon ranged spire, a dark stone tower with a large demonic eye carved above the entrance, "
        "fire-tipped arrow slits, hellfire ammunition, compact and menacing"
    )),
    ("ranged", "B", "Flame Sniper Spire", (
        "medium flame sniper spire, a taller demon tower with burning eye emblem, "
        "fire-enchanted bolts on racks, longer range design, "
        "emphasis on DAMAGE and RANGE — precision fire weaponry"
    )),
    ("ranged", "C", "Rapid Eye Spire", (
        "medium rapid eye spire, a sleeker demon tower with multiple fire eye slits, "
        "rapid-fire mechanisms, faster attack design, "
        "emphasis on SPEED — multiple rapid bolt launchers, same size as B"
    )),
    ("ranged", "D", "Meteor Eye Spire", (
        "large meteor eye fortress, a massive demon tower with meteor-launching mechanism, "
        "emphasis on SPLASH DAMAGE — explosive fire projectiles, "
        "burning meteor ammunition, same scale as E/F/G"
    )),
    ("ranged", "E", "Inferno Reaper Spire", (
        "large inferno reaper tower, a dark demon tower that grows stronger from kills, "
        "soul-collecting fire, kill counter trophies, reaping energy, "
        "emphasis on KILL SCALING — power grows with each victim, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Blitz Eye Spire", (
        "large blitz eye tower, a rapid-fire demon tower with multiple eye-bolt launchers, "
        "extreme speed firing mechanisms, hellfire conduits, "
        "emphasis on VERY FAST ATTACKS and RANGE, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Brimstone Cannon Spire", (
        "large brimstone cannon siege emplacement, an enormous demonic siege cannon, "
        "massive hellfire cannon barrel made of obsidian and iron, "
        "emphasis on SIEGE — devastating long-range brimstone bombardment, "
        "explosive fire ammunition, same scale as D/E/F"
    )),

    # === CASTER SHRINE (Fire Lord — consistent dark fire magic temple theme) ===
    ("caster", "A", "Demon Shrine", (
        "small demon fire shrine, a dark obsidian altar with burning hellfire on top, "
        "demonic runes on the floor, floating fire orbs, "
        "compact dark magic sanctum, menacing fire energy"
    )),
    ("caster", "B", "Hellfire Lord Shrine", (
        "medium hellfire lord temple, a larger obsidian altar with intense hellfire, "
        "demonic fire pillars, burning skull braziers, "
        "emphasis on DAMAGE — more intense fire magic, stronger flames"
    )),
    ("caster", "C", "Pyro Lord Shrine", (
        "medium pyro lord temple, a sleek fire-focused altar with rapid fire mechanisms, "
        "multiple fire orb projectors, quicker flame casting, "
        "emphasis on SPEED and RANGE — rapid fire magic, same size as B"
    )),
    ("caster", "D", "Apocalypse Lord Shrine", (
        "large apocalypse lord temple, a massive obsidian temple engulfed in hellfire, "
        "apocalyptic fire energy radiating, massive burn damage, "
        "emphasis on MAXIMUM BURN — everything burns, "
        "same scale as E/F/G"
    )),
    ("caster", "E", "Eruption Lord Shrine", (
        "large eruption lord temple, a volcanic demon temple with lava erupting, "
        "wide area fire eruptions, magma pools, "
        "emphasis on AoE — eruption blasts in all directions, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Flame Conduit Shrine", (
        "large flame conduit temple, a dark channeling shrine with rapid fire conduits, "
        "fire energy channeled through obsidian pipes, rapid casting, "
        "emphasis on VERY FAST CASTING and AoE, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Soul Pyre Shrine", (
        "large soul pyre temple, the ultimate demon fire temple, "
        "a massive soul-burning pyre that grows stronger from kills, "
        "emphasis on KILL SCALING — souls fuel the fire, growing power, "
        "same scale as D/E/F"
    )),

    # === TOWER (Demon Turrets — hellfire dark stone turrets) ===
    ("tower", "A", "Demon Turret", (
        "small demon turret, a crude obsidian watchtower with hellfire on top, "
        "dark stone with fire-tipped spikes, demonic eye emblem, "
        "compact and menacing fire turret"
    )),
    ("tower", "B", "Demon Turret", (
        "medium reinforced demon turret, heavier obsidian walls with iron banding, "
        "larger hellfire brazier on top, more fortified, "
        "emphasis on TOUGHNESS and DAMAGE — heavy dark stone"
    )),
    ("tower", "C", "Rapid Turret", (
        "medium rapid demon turret, multiple fire-bolt launchers, "
        "burn-focused rapid fire mechanisms, fire everywhere, "
        "emphasis on SPEED and BURN — rapid hellfire bolts, same size as B"
    )),
    ("tower", "D", "Inferno Turret", (
        "large inferno turret fortress, enormous obsidian and iron turret, "
        "massive hellfire cannon, extremely heavy fortification, "
        "emphasis on MAXIMUM TOUGHNESS and DAMAGE, "
        "same scale as E/F/G"
    )),
    ("tower", "E", "Napalm Turret", (
        "large napalm turret, a demon tower that sprays burning napalm, "
        "dripping fire, burning liquid reservoirs, napalm launchers, "
        "emphasis on MAXIMUM BURN STACKS — fire that won't stop burning, "
        "same scale as D/F/G"
    )),
    ("tower", "F", "Gatling Turret", (
        "large gatling demon turret, a rapid-fire hellfire machine, "
        "multiple rotating fire-bolt barrels, mechanical fire mechanisms, "
        "emphasis on VERY FAST ATTACKS — the fastest demon turret, "
        "same scale as D/E/G"
    )),
    ("tower", "G", "Dragon Turret", (
        "large dragon turret, the ultimate demon turret shaped like a dragon head, "
        "enormous dragon jaw breathing hellfire, dragon wings on the sides, "
        "emphasis on MAXIMUM DAMAGE and RANGE — dragon fire at extreme distance, "
        "same scale as D/E/F"
    )),

    # === HUT (harvests Meat + Wood — no gold) ===
    ("hut", "A", "Demon Harvester Pit", (
        "small demon worker pit, a dark obsidian pit with hellfire forge, "
        "meat hooks and lumber piles, dark fire tools, "
        "a crude demon resource gathering station, compact and hot"
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

    print(f"Demon ALL buildings ({total} images, ~{DELAY}s delay)")
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
