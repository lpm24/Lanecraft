"""
Generate Geists melee, ranged, caster, and hut buildings using the trained LoRA.
Geists = undead/spectral. Skulls, bones, crypts, coffins, purple spectral energy.
Melee: floating skulls, bone knights, mimics, soul eaters.
Ranged: wraith archers, vampire bowmen, bone ballista.
Caster: lich priests, necromancers, plague mages, sorcerers.
Buildings are crypts, tombs, bone altars, haunted sanctums.
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
OUT_DIR = os.path.join(SCRIPT_DIR, "generated_sprites_lora", "geists_all")
os.makedirs(OUT_DIR, exist_ok=True)

MODEL = "kingkrool/lanecraft-buildings:f76e5e4af6c48d50689ba2ff794523fcaf7292476e4dd59597cf9f8398457b85"
TRIGGER = "LCBLDG"
DELAY = 12

STYLE = (
    f"a {TRIGGER} isometric fantasy game building sprite, "
    "cel-shaded with thick dark outlines, "
    "undead gothic architecture, dark grey stone, skull and bone decorations, "
    "glowing purple and magenta spectral energy, coffins, crypts, tombstones, "
    "ghostly wisps, iron chains, gothic arches, "
    "single building centered on dark background, 2D hand-painted RTS game asset"
)

BUILDINGS = [
    # === MELEE CRYPT (Bone Knight=skull -> Iron Bones/Ambush Chest(mimic) -> Death Knight/Soul Eater/Mimic/Soul Gorger) ===
    ("melee", "A", "Bone Knight Crypt", (
        "small undead crypt, a stone tomb with a skull carved above the entrance, "
        "cracked coffin lid leaning against the wall, purple spectral glow from within, "
        "small and ominous, bones scattered at the entrance"
    )),
    ("melee", "B", "Iron Bones Crypt", (
        "medium iron-reinforced crypt, heavier stone tomb with iron bands and chains, "
        "iron skeleton armor on display at the entrance, reinforced coffin vault, "
        "emphasis on TOUGHNESS — iron-bound stone, heavy chains, skull iron door knocker"
    )),
    ("melee", "C", "Ambush Chest Crypt", (
        "medium mimic lair, a deceptive treasure room with ornate chest as the entrance, "
        "the building itself looks like a giant treasure chest with teeth, "
        "emphasis on STEALTH and DODGE — hidden fangs, deceptive gold trim, "
        "mimicry and trickery, same size as B"
    )),
    ("melee", "D", "Death Knight Crypt", (
        "large death knight tomb, an imposing dark stone mausoleum with burning purple braziers, "
        "death knight armor and flaming sword displayed at the gate, "
        "emphasis on BURN DAMAGE — purple flames everywhere, charred stone, "
        "same scale as E/F/G"
    )),
    ("melee", "E", "Soul Eater Crypt", (
        "large soul eater vault, a deep dark crypt with soul-catching spectral chains, "
        "ghostly soul wisps being drawn into the structure, purple soul energy swirling, "
        "emphasis on REGENERATION — souls fuel the undead, soul vortex, "
        "same scale as D/F/G"
    )),
    ("melee", "F", "Snapping Mimic Lair", (
        "large mimic fortress, an elaborate structure that looks like multiple treasure chests, "
        "hidden jaw mechanisms, deceptive gold and jewel decorations that are actually teeth, "
        "emphasis on DODGE and SPEED — the entire building is a trap, "
        "same scale as D/E/G"
    )),
    ("melee", "G", "Soul Gorger Crypt", (
        "large soul gorger sanctum, a massive dark crypt with a soul-harvesting vortex on top, "
        "dozens of ghostly souls swirling into the structure, growing stronger, "
        "emphasis on SCALING POWER — the more that die nearby the stronger it gets, "
        "purple soul maelstrom, bone crown, same scale as D/E/F"
    )),

    # === RANGED TOMB (Wraith Bow=vampire archer -> Venom Wraith/Bone Skull -> Plague/Hex/Wailing/Bone Ballista) ===
    ("ranged", "A", "Wraith Bow Tomb", (
        "small wraith archer tomb, a narrow stone tomb with spectral bow-and-arrow carving, "
        "arrow slits glowing with purple light, ghostly quiver of arrows, "
        "compact haunted archer post"
    )),
    ("ranged", "B", "Venom Wraith Tomb", (
        "medium venom wraith tomb, a dark stone tomb dripping with spectral venom, "
        "venomous purple mist seeping from arrow slits, poison arrow racks, "
        "emphasis on BURN — toxic spectral venom coating everything"
    )),
    ("ranged", "C", "Bone Skull Tomb", (
        "medium bone skull tomb, a tomb made of stacked skulls and bones, "
        "skull-shaped arrow slits, bone projectile ammunition piled up, "
        "emphasis on SPEED and RANGE — rapid skull-launching mechanisms, "
        "same size as B"
    )),
    ("ranged", "D", "Plague Arrow Tomb", (
        "large plague arrow tomb, a diseased dark stone tomb oozing purple plague mist, "
        "plague-tipped arrow manufacturing visible inside, corroded stone, "
        "emphasis on MAXIMUM BURN — concentrated plague on every projectile, "
        "same scale as E/F/G"
    )),
    ("ranged", "E", "Hex Volley Tomb", (
        "large hex volley tomb, a dark stone tomb with multiple spectral crossbow mechanisms, "
        "fires two projectiles at once, dual skull launchers on the roof, "
        "emphasis on MULTI-SHOT — double firing mechanisms, hex runes, "
        "same scale as D/F/G"
    )),
    ("ranged", "F", "Wailing Skull Tomb", (
        "large wailing skull tomb, a haunted tomb with screaming skull faces in the walls, "
        "spectral wailing energy, ghostly speed, dodge-focused design, "
        "emphasis on SPEED and DODGE — ethereal and hard to hit, "
        "same scale as D/E/G"
    )),
    ("ranged", "G", "Bone Ballista Tomb", (
        "large bone ballista tomb, a massive undead siege emplacement, "
        "enormous ballista made entirely of bones and sinew mounted on a dark stone base, "
        "emphasis on SIEGE — devastating long range bone siege weapon, "
        "bone ammunition stacked high, same scale as D/E/F"
    )),

    # === CASTER SANCTUM (Lich Priest=sorcerer -> Plague Mage/Dark Sorcerer -> Necromancer/Soul Harvester/Shadow Sorc/Arch Lich) ===
    ("caster", "A", "Lich Priest Sanctum", (
        "small lich priest sanctum, a small dark stone altar with purple magical energy, "
        "floating spell book, candles with purple flames, bone ritual circle, "
        "compact and mystical, necromantic energy"
    )),
    ("caster", "B", "Plague Mage Sanctum", (
        "medium plague mage sanctum, a diseased altar surrounded by plague clouds, "
        "bubbling plague cauldron, skeleton minions partially summoned from the ground, "
        "emphasis on SKELETON SUMMONING — bones rising from the earth, "
        "purple-green plague mist"
    )),
    ("caster", "C", "Dark Sorcerer Sanctum", (
        "medium dark sorcerer sanctum, an elegant dark stone tower with purple crystal focus, "
        "arcane circles on the floor, floating dark magic orbs, "
        "emphasis on SPEED and RANGE — focused dark energy projection, "
        "same size as B"
    )),
    ("caster", "D", "Necromancer Sanctum", (
        "large necromancer temple, a massive dark stone temple with skeleton army rising from graves, "
        "necromantic ritual circle, purple death energy, bone pillars, "
        "emphasis on MAXIMUM SKELETON SUMMONING — the dead rise here, "
        "coffins opening, bones assembling, same scale as E/F/G"
    )),
    ("caster", "E", "Soul Harvester Sanctum", (
        "large soul harvester sanctum, a dark temple with soul-catching crystal on top, "
        "ghostly souls being drawn in, purple burn energy radiating, "
        "emphasis on DAMAGE and BURN — harvested souls fuel destructive magic, "
        "same scale as D/F/G"
    )),
    ("caster", "F", "Shadow Sorcerer Sanctum", (
        "large shadow sorcerer sanctum, a dark elegant spire wreathed in shadow magic, "
        "rapid shadow bolt mechanisms, dark purple shadow energy, "
        "emphasis on VERY FAST CASTING with skeleton summoning, "
        "same scale as D/E/G"
    )),
    ("caster", "G", "Arch Lich Sanctum", (
        "large arch lich sanctum, the ultimate necromancer temple, "
        "massive skull throne of power, army of skeletons emerging from the ground, "
        "emphasis on MAXIMUM POWER — the arch lich commands death itself, "
        "enormous purple death crystal, bone crown spire, same scale as D/E/F"
    )),

    # === HUT (harvests Meat + Gold) ===
    ("hut", "A", "Geist Harvester Crypt", (
        "small undead harvester shelter, a small crumbling tombstone-roofed crypt, "
        "spectral worker tools, ghost lantern hanging by the door, "
        "a humble undead worker dwelling, bones and iron tools, "
        "small coffin-shaped structure, ghostly purple glow"
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

    print(f"Geists ALL buildings ({total} images, ~{DELAY}s delay)")
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
