"""Extract the crafted-tower table from the saved Gem Maze TD Codex page into data/raw/codex_towers.json.
Usage: python tools/extract_codex.py   (run from repo root)
The Codex is exported from that game's code, so build_data.py treats it as the authority for
tower names, recipes and base stats. Pedals are skipped: they live in pedals.json / sim/pedals.ts.
"""
import html, json, pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/wikipages/references/Codex — Gem Maze TD.html"


def cells(tr):
    return [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]


def num(s):
    return float(s.replace(",", "").replace("/s", ""))


towers = []
for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", SRC.read_text(encoding="utf-8"), re.S):
    r = cells(tr)
    if len(r) != 6 or "Pedal" in r[0]:
        continue
    recipe, secret = re.subn(r"\s*Secret$", "", r[1])
    towers.append({"name": r[0].replace("★", "").strip(), "elite": "★" in r[0], "secret": bool(secret),
                   "recipe": recipe, "damage": num(r[2]), "attacksPerSec": num(r[3]),
                   "rangeCells": num(r[4]), "effect": r[5]})
out = ROOT / "data/raw/codex_towers.json"
out.write_text(json.dumps(towers, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"codex_towers: {len(towers)}")
