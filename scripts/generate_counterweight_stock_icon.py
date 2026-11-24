"""Draws the Blackwood Ordnance Counter-Weight Stock (att_stk_08) icon.

Icons_Extracted is not committed, so run this to recreate the picture:
    python scripts/generate_counterweight_stock_icon.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT_PATH = Path(__file__).resolve().parent.parent / "img/Icons_Extracted/Attachments/Misc/stock-counterweight-black-walnut.png"

OUTLINE = (22, 20, 24, 255)
WOOD, WOOD_LIGHT, WOOD_DARK, GRAIN = (92, 58, 36, 255), (126, 84, 52, 255), (62, 38, 24, 255), (74, 46, 29, 255)
STEEL, STEEL_LIGHT, STEEL_DARK = (58, 62, 70, 255), (96, 102, 112, 255), (34, 36, 42, 255)
RUBBER, RUBBER_LIGHT = (40, 38, 40, 255), (64, 60, 62, 255)
BRASS, BRASS_LIGHT = (186, 132, 58, 255), (226, 178, 96, 255)
LEAD, LEAD_LIGHT, LEAD_DARK = (118, 120, 126, 255), (170, 172, 178, 255), (72, 74, 80, 255)


def draw_flat():
    # Drawn lying flat (butt on the left), then tilted to match the other stock icons.
    im = Image.new("RGBA", (150, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    d.rectangle([98, 24, 142, 35], fill=STEEL)
    d.line([98, 24, 142, 24], fill=STEEL_LIGHT)
    d.line([98, 35, 142, 35], fill=STEEL_DARK)
    d.rectangle([138, 22, 144, 37], fill=STEEL)
    d.line([138, 22, 144, 22], fill=STEEL_LIGHT)
    for x in (108, 122):
        d.ellipse([x, 27, x + 4, 31], fill=STEEL_DARK)

    d.polygon([(12, 10), (100, 21), (100, 38), (12, 52)], fill=WOOD)
    d.line([(12, 10), (100, 21)], fill=WOOD_LIGHT)
    d.line([(12, 11), (100, 22)], fill=WOOD_LIGHT)
    d.line([(12, 52), (100, 38)], fill=WOOD_DARK)
    d.line([(12, 51), (100, 37)], fill=WOOD_DARK)
    for i, y in enumerate((20, 27, 34, 41)):
        d.line([(60, y + (i - 1)), (96, y * 0.85 + 5)], fill=GRAIN)
    d.ellipse([70, 27, 86, 35], fill=WOOD_DARK)
    d.ellipse([72, 28, 84, 33], fill=(0, 0, 0, 0))
    d.rectangle([84, 25, 94, 30], fill=BRASS)
    d.line([84, 25, 94, 25], fill=BRASS_LIGHT)

    # The weight chamber, with a window showing the lead shot inside.
    d.rounded_rectangle([18, 4, 60, 58], radius=6, fill=STEEL)
    d.rectangle([20, 6, 58, 9], fill=STEEL_LIGHT)
    d.rectangle([20, 53, 58, 56], fill=STEEL_DARK)
    for x in (18, 57):
        d.rectangle([x, 4, x + 3, 58], fill=STEEL_DARK)
    for x in (24, 52):
        for y in (8, 54):
            d.point((x, y), fill=LEAD_LIGHT)
    d.rectangle([25, 14, 53, 46], fill=STEEL_DARK)
    d.rectangle([27, 16, 51, 44], fill=LEAD_DARK)
    for y in range(17, 44, 4):
        for x in range(28 + (y // 4 % 2) * 2, 50, 4):
            d.ellipse([x, y, x + 3, y + 3], fill=LEAD)
            d.point((x + 1, y + 1), fill=LEAD_LIGHT)
    d.line([(27, 16), (51, 16)], fill=STEEL_LIGHT)
    d.line([(30, 19), (36, 25)], fill=(210, 220, 230, 150))
    d.line([(31, 19), (37, 25)], fill=(210, 220, 230, 90))

    d.rounded_rectangle([3, 8, 13, 54], radius=3, fill=RUBBER)
    for y in range(12, 52, 5):
        d.line([(4, y), (12, y)], fill=RUBBER_LIGHT)
    return im


def main():
    im = draw_flat().rotate(48, resample=Image.NEAREST, expand=True)
    alpha = im.getchannel("A").point(lambda v: 255 if v > 0 else 0)
    ring = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(3)), alpha)
    framed = Image.new("RGBA", im.size, (0, 0, 0, 0))
    framed.paste(Image.new("RGBA", im.size, OUTLINE), (0, 0), ring)
    framed.alpha_composite(im)
    framed = framed.crop(framed.getbbox())
    pad = 2
    canvas = Image.new("RGBA", (framed.width + pad * 2, framed.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(framed, (pad, pad))
    canvas = canvas.resize((canvas.width * 5, canvas.height * 5), Image.NEAREST)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_PATH)
    print(f"Wrote {OUT_PATH} ({canvas.width}x{canvas.height})")


if __name__ == "__main__":
    main()
