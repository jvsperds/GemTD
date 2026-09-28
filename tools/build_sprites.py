"""Bake tower/creep portraits from the saved wiki pages into small square sprites.

Usage: python tools/build_sprites.py [path/to/docs/wikipages/references]
Writes src/sprites/<slug>.webp (gitignored: third-party art stays local). Needs Pillow.
The game falls back to drawn gems/orbs for any sprite that is missing.
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "src" / "sprites"
SIZE = 96


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def bake(src, dst):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = min(w, h)
    # Centre crop, nudged up a little: the renders stand their subject on the lower half.
    top = max(0, min(h - s, (h - s) // 2 - s // 12))
    im = im.crop(((w - s) // 2, top, (w - s) // 2 + s, top + s)).resize((SIZE, SIZE), Image.LANCZOS)
    im.save(dst, "WEBP", quality=80)


def main():
    refs = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "wikipages" / "references"
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [(refs / "baseTowers_files" / f"{t}.png", f"gem-{t}") for t in "BDEGPQRY"]
    for t in json.loads((RAW / "advanced_towers.json").read_text(encoding="utf-8")):
        jobs.append((refs / "advancedTowers_files" / f"{t['code']}.png", slug(t["name"].rpartition(" / ")[0])))
    for c in json.loads((RAW / "creeps.json").read_text(encoding="utf-8")):
        jobs.append((refs / "creeps_files" / f"{c['code']}.png", "creep-" + slug(c["name"])))
    missing = [str(src.name) for src, key in jobs if not src.exists()]
    for src, key in jobs:
        if src.exists():
            bake(src, OUT / f"{key}.webp")
    print(f"{len(jobs) - len(missing)} sprites -> {OUT}; missing: {missing or 'none'}")


if __name__ == "__main__":
    main()
