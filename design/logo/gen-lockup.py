#!/usr/bin/env python3
"""Regenerate apps/shell/src/renderer/src/assets/onedesk-logo.svg (the in-app
horizontal lockup) from the mark master and the vendored Poppins Bold subset.

The wordmark is set in OneDesk Poppins Bold (OFL) with zero tracking: the
7-glyph string is fit exactly into the 324..1090 text box of the 240-tall
lockup grid, on baseline y=189. The glyph is the 4-tile mark from design/logo/
mark.svg, ink height ~132 (cap height + optical overshoot), centred on y=128.

Requires fonttools + brotli (any venv): python3 -m venv /tmp/ft-venv &&
/tmp/ft-venv/bin/pip install fonttools brotli

Usage (repo root): /tmp/ft-venv/bin/python design/logo/gen-lockup.py
"""

from pathlib import Path
import re

from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
FONT_PATH = ROOT / "apps/docs/src/renderer/fonts/OneDeskPoppins-Bold-subset.woff2"
OUT_PATH = ROOT / "apps/shell/src/renderer/src/assets/onedesk-logo.svg"

WORD = "OneDesk"
BASELINE = 189.0
TEXT_LEFT = 324.0
TEXT_WIDTH = 766.0  # right edge 1090
MARK_GRID = 220.0  # mark ink spans 18..238 on the 256 grid
MARK_INK = 132.0
MARK_RIGHT = 264.0
MARK_CENTER_Y = 128.0

font = TTFont(FONT_PATH)
cmap = font.getBestCmap()
glyph_set = font.getGlyphSet()
upem = font["head"].unitsPerEm

names = [cmap[ord(ch)] for ch in WORD]
advances = [glyph_set[name].width for name in names]
total_units = sum(advances)
scale = TEXT_WIDTH / total_units
print(f"cap height {font['OS/2'].sCapHeight * scale:.1f}, x-height {font['OS/2'].sxHeight * scale:.1f}")

paths = []
x = TEXT_LEFT
for name, advance in zip(names, advances):
    inner = SVGPathPen(glyph_set)
    pen = TransformPen(inner, Transform(scale, 0, 0, -scale, x, BASELINE))
    glyph_set[name].draw(pen)
    data = re.sub(r"\d+\.\d{3,}", lambda m: f"{float(m.group()):.2f}", inner.getCommands())
    paths.append(f'<path d="{data}" fill="black"/>')
    x += advance * scale

mark_scale = MARK_INK / MARK_GRID  # 0.6
mark_x = MARK_RIGHT - MARK_INK
mark_y = MARK_CENTER_Y - MARK_INK / 2.0


def placed(rx, ry, w, rad):
    return (
        round(mark_x + (rx - 18) * mark_scale, 2),
        round(mark_y + (ry - 18) * mark_scale, 2),
        round(w * mark_scale, 2),
        round(rad * mark_scale, 2),
    )


# mark tiles baked to final coordinates (no group transform)
tiles = "".join(
    f'<rect x="{rx}" y="{ry}" width="{w}" height="{w}" rx="{rad}" fill="black"/>\n'
    for rx, ry, w, rad in map(
        lambda t: placed(*t),
        [
            (18, 18, 132, 26),
            (166, 18, 72, 20),
            (18, 166, 72, 20),
            (166, 166, 72, 20),
        ],
    )
)

svg = (
    '<svg width="973" height="240" viewBox="118 0 973 240" fill="none" '
    'xmlns="http://www.w3.org/2000/svg">\n'
    "<title>OneDesk</title>\n"
    + tiles
    + "".join(p + "\n" for p in paths)
    + "</svg>\n"
)
OUT_PATH.write_text(svg, encoding="utf-8")
print(f"wrote {OUT_PATH.relative_to(ROOT)} ({len(svg)} bytes)")
