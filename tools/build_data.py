"""Derive game data (data/*.json) from the wiki extracts in data/raw/.
Usage: python tools/build_data.py   (run from repo root; fails loudly if the data looks wrong)
"""
import json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data/raw", ROOT / "data"
SOLO_HP, SOLO_SPEED = 0.6, 0.85  # 1-player column of creep_coefficients.json
GEM_TYPES = "BDEGPQRY"
GEM_RE = re.compile(r"^([A-Z])([1-6])$")

def load(name):
    return json.loads((RAW / name).read_text(encoding="utf-8"))

def save(name, obj):
    (OUT / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

def abilities(t):
    return [{"id": a["id"], "raw": a.get("Raw", "")} for a in t["abilities"]]

def tower(t, **extra):
    return {**extra, "damage": t["damage"], "bonusDamage": t["bonusDamage"],
            "attackRate": t["attackRate"], "range": t["range"], "abilities": abilities(t)}

def inputs(s):
    """'B1 + Y1 + D1' -> [{gem:'B',q:1},...]; tower names stay as {tower:name}."""
    out = []
    for tok in (p.strip() for p in s.split("+")):
        m = GEM_RE.match(tok)
        out.append({"gem": m[1], "q": int(m[2])} if m else {"tower": tok})
    return out

gems = []
for t in load("base_towers.json"):
    name, code = (s.strip() for s in t["name"].split("/"))
    m = GEM_RE.match(code)
    gems.append(tower(t, gem=m[1], q=int(m[2]), name=name))
assert len(gems) == 48 and {(g["gem"], g["q"]) for g in gems} == {(c, q) for c in GEM_TYPES for q in range(1, 7)}

towers = [tower(t, name=t["name"].split(" / ")[0].strip()) for t in load("advanced_towers.json")]
names = {t["name"] for t in towers}

recipes = []
for r in load("recipes.json"):
    alts = [r["inputs"], *r["altInputs"]]
    # "A | B" in one cell = alternative recipes
    alts = [p.strip() for a in alts for p in a.split("|")]
    recipes.append({"name": r["name"], "secret": r["section"] == "Secret towers", "inputs": [inputs(a) for a in alts]})
for r in recipes:
    assert r["name"] in names, f"recipe without tower stats: {r['name']}"
    for alt in r["inputs"]:
        for i in alt:
            assert i["tower"] in names if "tower" in i else i["gem"] in GEM_TYPES, f"{r['name']}: bad input {i}"

waves = {}
for c in load("creeps.json"):
    if c["wave"] == "other": continue
    # Two creeps on one wave = alternative skins for that wave; keep both.
    waves.setdefault(c["wave"], []).append({
        "name": c["name"], "hp": c["hpByPlayers"][0], "speed": round(c["moveBase"] * SOLO_SPEED, 2),
        "armor": c["armor"], "magicResist": c["magicResist"], "flying": c["flying"],
        "abilities": [a for a in c["abilities"] if a != "gemtd_guai_base"]})
waves = [{"wave": w, "variants": waves[w]} for w in sorted(waves)]
assert [w["wave"] for w in waves] == list(range(1, 51))
assert abs(waves[0]["variants"][0]["hp"] - load("creeps.json")[0]["hpBase"] * SOLO_HP) < 1e-6

save("gems.json", gems)
save("towers.json", towers)
save("recipes.json", recipes)
save("waves.json", waves)
print(f"ok: {len(gems)} gems, {len(towers)} towers, {len(recipes)} recipes, {len(waves)} waves")
