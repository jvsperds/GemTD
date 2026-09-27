"""Extract Gem TD reference data from the saved fan-wiki HTML pages into JSON.
Usage: python tools/extract_wiki.py   (run from repo root)
Output: data/raw/*.json  (reference data; game data files are derived from these)
"""
import re, html, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "docs/wikipages", ROOT / "data/raw"
OUT.mkdir(parents=True, exist_ok=True)
ABIL_KEYS = {"Name", "Tooltip", "Raw", "Raw: Special", "Raw: Special 2", "Raw: Special 3",
             "Pierce Spell Immunity", "Gold cost", "Shell price", "Network code"}

def lines_of(f):
    t = f.read_text(encoding="utf-8", errors="ignore")
    t = re.sub(r"(?s)<(script|style).*?</\1>", "", t)
    t = re.sub(r"<br\s*/?>|</tr>|</p>|</h\d>|</div>", "\n", t)
    t = re.sub(r"</td>|</th>", " |\u0001", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("%%", "%")
    out = []
    for ln in t.split("\n"):
        ln = re.sub(r"\s+", " ", ln.replace("\u0001", "")).strip()
        if ln: out.append(ln)
    return out

def cell(ln):  # "x |" -> "x"
    return ln[:-1].strip() if ln.endswith("|") else None

def parse_entities(lines, start_key="Code"):
    ents, cur, abil, title = [], None, None, None
    i = 0
    while i < len(lines):
        ln = lines[i]; k = cell(ln)
        if k is None:
            title = ln; i += 1; continue
        if k == "~": i += 1; continue
        v = cell(lines[i+1]) if i+1 < len(lines) else None
        if v is None: v = ""
        if k == start_key:
            cur = {"title": title, start_key.lower(): v, "abilities": []}; ents.append(cur); abil = None
        elif cur is None:
            pass
        elif k == "Ability":
            abil = {"id": v}; cur["abilities"].append(abil)
        elif abil is not None and k in ABIL_KEYS:
            abil[k] = v
        else:
            cur[k] = v; abil = None
        i += 2
    return ents

def num(s):
    m = re.match(r"\s*([\d.]+)(?:\s*\[\+([\d.]+)\])?", s or "")
    return (float(m.group(1)), float(m.group(2) or 0)) if m else (None, 0)

def tower(e):
    dmg, bonus = num(e.get("Attack Damage"))
    return {"code": e["code"], "name": e.get("English", e["title"]),
            "damage": dmg, "bonusDamage": bonus,
            "attackRate": num(e.get("Attack Rate"))[0], "range": num(e.get("Attack Range"))[0],
            "recipe": e.get("Combination"), "abilities": e["abilities"]}

def recipe_table(lines, header):
    """Parse the summary memo table: name | inputs [| alt inputs] rows after a section header."""
    res, sec = [], None
    for i, ln in enumerate(lines):
        c = cell(ln)
        if c is None:
            if res or sec: break
            continue
        if c in header: sec = c; continue
        if sec and c not in ("~", "") and "+" not in c and "*" not in c:
            j, ins = i + 1, []
            while j < len(lines) and cell(lines[j]) and ("+" in cell(lines[j]) or "*" in cell(lines[j])):
                ins.append(cell(lines[j])); j += 1
            if ins: res.append({"section": sec, "name": c, "inputs": ins[0], "altInputs": ins[1:]})
    return res

pages = {p.stem: lines_of(p) for p in SRC.glob("*.html")}
out = {}
out["base_towers"] = [tower(e) for e in parse_entities(pages["baseTowers"])]
adv = parse_entities(pages["advancedTowers"])
out["advanced_towers"] = [tower(e) for e in adv]
out["recipes"] = recipe_table(pages["advancedTowers"], {"Combined towers", "Secret towers"})
out["pedals"] = [{"code": e["code"], "name": e.get("English"), "recipe": e.get("Combination"),
                  "abilities": e["abilities"]} for e in parse_entities(pages["pedals"])]
out["pedal_recipes"] = recipe_table(pages["pedals"], {"Pedals", "Sparkling Pedals", "Blingbling Pedals"})
out["hero_abilities"] = [a for e in parse_entities(pages["heroAbilities"], "Network code") for a in [e]]
out["stealable_abilities"] = parse_entities(["x"] + pages["steal"], "Ability")

# creeps: track "Level N ..." headings
creeps, level = [], None
ents = []
lines = pages["creeps"]
for i, ln in enumerate(lines):
    m = re.match(r"Level (\d+) ", ln)
    if m: level = int(m.group(1))
    if ln.startswith("Others") and cell(ln) is None: level = "other"
    if cell(ln) == "Code":
        ents.append((i, level))
parsed = parse_entities(lines)
for (i, lvl), e in zip(ents, parsed):
    hp = e.get("HP (1-4 players) [Base]", ""); mv = e.get("Movement (1-4 players) [Base]", "")
    hb = re.search(r"\[([\d.]+)\]", hp); mb = re.search(r"\[([\d.]+)\]", mv)
    creeps.append({"wave": lvl, "code": e["code"], "name": e.get("English"),
                   "hpBase": float(hb.group(1)) if hb else None,
                   "hpByPlayers": [float(x) for x in re.findall(r"\d+(?:\.\d+)?", hp.split("[")[0])],
                   "moveBase": float(mb.group(1)) if mb else None,
                   "flying": "flying" in mv, "armor": num(e.get("Armor"))[0],
                   "magicResist": num(e.get("Magic resistance"))[0],
                   "abilities": [a["id"] for a in e["abilities"]], "raw": e})
out["creeps"] = creeps
coef = {}
for i, ln in enumerate(lines[:40]):
    c = cell(ln)
    if c and c.startswith(("HP (", "Speed (")): coef[c] = cell(lines[i+1])
out["creep_coefficients"] = coef

for k, v in out.items():
    (OUT / f"{k}.json").write_text(json.dumps(v, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{k}: {len(v)}")
