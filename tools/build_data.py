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
    return {v["name"]: v for v in towers.values()}


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
