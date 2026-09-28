"""Derive game data (data/*.json) from the wiki extract (data/raw/*.json) and validate it.

Usage: python tools/build_data.py        (writes data/gems.json, towers.json, waves.json)
       python tools/build_data.py --check (validate only, non-zero exit on error)
Ranges stay in Dota units; the renderer/sim converts with map.json cellUnits.
"""
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw"
GEM_TYPES = "BDEGPQRY"
SOLO = 0  # index into the 1-4 player columns


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def short(name):
    """'Chipped Sapphire / B1' -> ('Chipped Sapphire', 'B1')"""
    full, _, code = name.rpartition(" / ")
    return full, code


def abilities(t):
    return [a["id"] for a in t["abilities"]]


def build_gems():
    out = {}
    for t in load(RAW / "base_towers.json"):
        full, code = short(t["name"])
        out[code] = {
            "name": full,
            "type": code[0],
            "quality": int(code[1]),
            "damage": t["damage"],
            "bonusDamage": t["bonusDamage"],
            "attackRate": t["attackRate"],
            "range": t["range"],
            "abilities": abilities(t),
        }
    return out


def build_towers(gems):
    towers = {}
    for t in load(RAW / "advanced_towers.json"):
        full, _ = short(t["name"])
        towers[norm(full)] = {
            "name": full,
            "damage": t["damage"],
            "bonusDamage": t["bonusDamage"],
            "attackRate": t["attackRate"],
            "range": t["range"],
            "abilities": abilities(t),
            "recipes": [],
        }
    ids = {k: v["name"] for k, v in towers.items()}
    for r in load(RAW / "recipes.json"):
        tower = towers[norm(r["name"])]
        tower["secret"] = r["section"] == "Secret towers"
        for alt in [r["inputs"], *r["altInputs"]]:
            for variant in alt.split("|"):
                parts = [p.strip() for p in variant.split("+")]
                tower["recipes"].append([p if p in gems else ids[norm(p)] for p in parts])
    return apply_codex({v["name"]: v for v in towers.values()}, gems)


# Wiki name -> Codex name (the Codex is exported from the live game, so its names win).
CODEX_RENAME = {"Deep Sea Pearl": "Deepsea Pearl", "Burning Stone": "The Burning Stone",
                "Yaphets Stone": "Geluanshi"}
# Codex towers the wiki lacks: abilities picked from existing ids to match the Codex effect text.
# ponytail: approximations of the Codex blurbs; swap in exact ids if the real kit turns up.
CODEX_NEW = {"Black Opal": ["tower_baoji1"],                                  # heavy crits
             "Ehome": ["tower_speed_aura6", "tower_speed_aura_guichu"],        # aura max + otomad
             "Wings Stone": ["tower_jianshe6"]}                                # full-force splash
TIERS = {"Chipped": 1, "Flawed": 2, "Regular": 3, "Flawless": 4, "Perfect": 5, "Great": 6}
CELL_UNITS = 150  # Codex RNG is in board cells of 150 Dota units


def apply_codex(towers, gems):
    """Make names, recipes and base stats match data/raw/codex_towers.json."""
    codex = RAW / "codex_towers.json"
    if not codex.exists():
        return towers
    towers = {CODEX_RENAME.get(n, n): {**t, "name": CODEX_RENAME.get(n, n)} for n, t in towers.items()}
    gem_code = {(g["name"].split()[-1], g["quality"]): code for code, g in gems.items()}
    for c in load(codex):
        t = towers.get(c["name"])
        if t is None:
            t = towers[c["name"]] = {"name": c["name"], "damage": 0, "bonusDamage": 0, "attackRate": 1,
                                     "range": 0, "abilities": CODEX_NEW[c["name"]], "recipes": []}
        # Codex DMG is damage + bonusDamage (what a hit deals); keep the split where it fits.
        t["bonusDamage"] = min(t["bonusDamage"], c["damage"])
        t["damage"] = c["damage"] - t["bonusDamage"]
        if abs(1 / t["attackRate"] - c["attacksPerSec"]) > 0.01:
            t["attackRate"] = round(1 / c["attacksPerSec"], 3)
        if abs(t["range"] / CELL_UNITS - c["rangeCells"]) > 0.05:  # Codex rounds to 0.1 cell
            t["range"] = round(c["rangeCells"] * CELL_UNITS)
        t["secret"] = c["secret"]
        if c["recipe"].startswith("Any "):  # The Great Stone: special-cased by the sim
            continue
        parts = []
        for p in c["recipe"].split(" + "):
            tier, _, gem = p.partition(" ")
            parts.append(gem_code[(gem, TIERS[tier])] if tier in TIERS and (gem, TIERS[tier]) in gem_code else p)
        t["recipes"] = [parts]
    return towers


def build_waves():
    raw = load(RAW / "creeps.json")
    coef = load(RAW / "creep_coefficients.json")
    hp_mul = float(coef["HP (1-4 players)"].split(" . ")[SOLO])
    speed_mul = float(coef["Speed (1-4 players)"].split(" . ")[SOLO])
    waves = []
    for c in raw:
        if c["wave"] == "other":
            continue
        waves.append({
            "wave": c["wave"],
            "name": c["name"],
            "hp": round(c["hpBase"] * hp_mul, 2),
            "speed": round(c["moveBase"] * speed_mul, 2),
            "armor": c["armor"],
            "magicResist": c["magicResist"],
            "flying": c["flying"],
            "boss": c["wave"] % 10 == 0,
            "abilities": [a for a in c["abilities"] if a != "gemtd_guai_base"],
        })
    return waves


def validate(gems, towers, waves, quality):
    errs = []
    if len(gems) != 48 or {g["type"] for g in gems.values()} != set(GEM_TYPES):
        errs.append(f"gems: expected 8 types x 6 qualities, got {len(gems)}")
    for name, t in towers.items():
        if not t["recipes"]:
            print(f"warn: tower {name} has no recipe (unobtainable until one is found)")
        for rec in t["recipes"]:
            for p in rec:
                if p not in gems and p not in towers:
                    errs.append(f"tower {name}: unknown ingredient {p}")
    for n, t in {**gems, **towers}.items():
        # damage 0 is legit: Radiance towers (tower_huiyao*) only burn
        if not (t["damage"] >= 0 and t["attackRate"] > 0 and t["range"] > 0):
            errs.append(f"{n}: bad damage/rate/range")
    got = sorted({w["wave"] for w in waves})
    if got != list(range(1, 51)):
        errs.append(f"waves: missing {sorted(set(range(1, 51)) - set(got))}")
    for w in waves:
        if not (w["hp"] > 0 and w["speed"] > 0):
            errs.append(f"wave {w['wave']}: non-positive hp/speed")
    for lv in quality["levels"]:
        if sum(lv["odds"]) != 100:
            errs.append(f"quality level {lv['level']}: odds sum {sum(lv['odds'])}")
    return errs


def main():
    gems = build_gems()
    towers = build_towers(gems)
    waves = build_waves()
    errs = validate(gems, towers, waves, load(DATA / "quality_levels.json"))
    for e in errs:
        print("ERROR", e)
    if errs:
        sys.exit(1)
    if "--check" not in sys.argv:
        for name, obj in [("gems", gems), ("towers", towers), ("waves", waves)]:
            (DATA / f"{name}.json").write_text(json.dumps(obj, indent=1) + "\n", encoding="utf-8")
    print(f"ok: {len(gems)} gems, {len(towers)} towers, {len(waves)} wave entries")


if __name__ == "__main__":
    main()
