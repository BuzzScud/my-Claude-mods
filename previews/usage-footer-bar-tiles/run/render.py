#!/usr/bin/env python3
"""Render drive.py's captures to a PNG the way a dark terminal shows them (needs Pillow; Menlo on macOS).

    python3 render.py captures.json captures.png
"""
import json, sys

from PIL import Image, ImageDraw, ImageFont

snaps = json.load(open(sys.argv[1]))
FONT = '/System/Library/Fonts/Menlo.ttc'
font, label = ImageFont.truetype(FONT, 26), ImageFont.truetype(FONT, 20)
cw, ch = 16, 34
BG, FG = (0x1e, 0x1e, 0x1e), (0xd0, 0xd0, 0xd0)


def rgb(color, default):
    if len(color) == 6:
        try:
            return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    return default


width = max(snap['columns'] for snap in snaps) * cw + 40
img = Image.new('RGB', (width, len(snaps) * (ch + 50) + 20), (0x14, 0x14, 0x14))
draw = ImageDraw.Draw(img)
y = 10
for snap in snaps:
    draw.text((20, y), f"{snap['label']} · {snap['columns']} columns", font=label, fill=(0x88, 0x88, 0x88))
    y += 30
    draw.rectangle([20, y, 20 + snap['columns'] * cw, y + ch], fill=BG)
    for x, (glyph, fg, bg) in enumerate(snap['rows'][-1]):
        back = rgb(bg, BG)
        if back != BG:
            draw.rectangle([20 + x * cw, y, 20 + (x + 1) * cw - 1, y + ch - 1], fill=back)
        if glyph.strip():
            draw.text((20 + x * cw, y + 2), glyph, font=font, fill=rgb(fg, FG))
    y += ch + 20
img.save(sys.argv[2])
print(sys.argv[2], img.size)
