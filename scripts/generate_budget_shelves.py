"""Builds every Budget Shelf size (2 or 3 levels, 2 to 4 sections) from the 3x4 template
art in img/Icons_Extracted/ShelfTemplates, so each shelf space is exactly the 3x4's size.

Writes img/Icons_Extracted/Tileset/Fixtures/shelf_budget_{levels}x{sections}_{facing}.png.
Keep the measurements here in sync with js/logic/BudgetShelfArt.js.
Add any new image paths to data/TilesetManifest.json by hand.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "img" / "Icons_Extracted" / "ShelfTemplates"
OUT = ROOT / "img" / "Icons_Extracted" / "Tileset" / "Fixtures"

# Front (down-facing) template, in source pixels.
LEFT_POST = 28
SECTION = 78
DIVIDER = 8
RIGHT_POST = 20
TOP_BAR = 48
LEVEL = 44
FULL_LEVELS = 3
TEMPLATE_WIDTH = 384
HEIGHT = 192
# Fixture widths snap to an eighth of a floor square (192 source px).
WIDTH_STEP = 24

# Side template rows: the shelf top runs to 232, then the side panel, then the legs.
SIDE_TOP_BAND = (40, 220)
SIDE_PANEL_TOP = 232
SIDE_PANEL_BOTTOM = 352
SIDE_OUTLINE_ROW = 236
SIDE_DARK_ROW = 260
SIDE_LIGHT_ROW = 300
SIDE_LIGHT = 8
# Back template: removing this band drops one level and one panel line.
BACK_LEVEL_BAND = (92, 136)


def natural_width(sections):
    return LEFT_POST + sections * SECTION + (sections - 1) * DIVIDER + RIGHT_POST


def padded_width(sections):
    width = natural_width(sections)
    return -(-width // WIDTH_STEP) * WIDTH_STEP


def paste_rows(target, source, top, rows):
    """Copy source rows (y0, y1) one after another into target starting at `top`."""
    for y0, y1 in rows:
        target.alpha_composite(source.crop((0, y0, source.width, y1)), (0, top))
        top += y1 - y0
    return top


def front(template, levels, sections):
    wide = Image.new("RGBA", (natural_width(sections), HEIGHT))
    x = 0
    pieces = [(0, LEFT_POST)]
    for index in range(sections):
        pieces.append((LEFT_POST, LEFT_POST + SECTION))
        if index < sections - 1:
            pieces.append((LEFT_POST + SECTION, LEFT_POST + SECTION + DIVIDER))
    pieces.append((TEMPLATE_WIDTH - RIGHT_POST, TEMPLATE_WIDTH))
    for x0, x1 in pieces:
        wide.alpha_composite(template.crop((x0, 0, x1, HEIGHT)), (x, 0))
        x += x1 - x0
    rows = [(0, TOP_BAR)] + [(TOP_BAR, TOP_BAR + LEVEL)] * (levels - 1) + \
        [(TOP_BAR + LEVEL * (FULL_LEVELS - 1), HEIGHT)]
    return drop_to_floor(wide, rows)


def back(template, levels, sections):
    width = natural_width(sections)
    half = width // 2
    wide = Image.new("RGBA", (width, HEIGHT))
    wide.alpha_composite(template.crop((0, 0, half, HEIGHT)), (0, 0))
    wide.alpha_composite(template.crop((TEMPLATE_WIDTH - (width - half), 0, TEMPLATE_WIDTH, HEIGHT)), (half, 0))
    rows = [(0, HEIGHT)] if levels == FULL_LEVELS else \
        [(0, BACK_LEVEL_BAND[0]), (BACK_LEVEL_BAND[1], HEIGHT)]
    return drop_to_floor(wide, rows)


def drop_to_floor(image, rows):
    """Stack the given rows so the shelf's legs stay on the bottom edge."""
    height = sum(y1 - y0 for y0, y1 in rows)
    out = Image.new("RGBA", (image.width, HEIGHT))
    paste_rows(out, image, HEIGHT - height, rows)
    return out


def side(template, levels, sections):
    """Side view: a long shelf top, then a side panel showing one opening per level."""
    length = natural_width(sections)
    cut = TEMPLATE_WIDTH - length
    band_end = SIDE_TOP_BAND[0] + (SIDE_TOP_BAND[1] - SIDE_TOP_BAND[0]) - cut
    if band_end < SIDE_TOP_BAND[0]:
        raise ValueError("Shelf too short for its side art")
    # A shorter side panel (fewer levels) would leave the top of the image empty, so the
    # shelf top grows by the same amount and the art still spans the shelf's full length.
    filler_row = (SIDE_TOP_BAND[0] + 1, SIDE_TOP_BAND[0] + 2)
    rows = [(0, band_end)] + [filler_row] * ((FULL_LEVELS - levels) * LEVEL) + \
        [(SIDE_TOP_BAND[1], SIDE_PANEL_TOP)]
    panel = []
    opening = (SIDE_PANEL_BOTTOM - SIDE_PANEL_TOP - (FULL_LEVELS - levels) * LEVEL - DIVIDER * levels) // levels
    panel.append(("outline", DIVIDER))
    for index in range(levels):
        if index > 0:
            panel.append(("outline", DIVIDER))
            panel.append(("light", SIDE_LIGHT))
            panel.append(("dark", opening - SIDE_LIGHT))
        else:
            panel.append(("dark", opening))
    panel_height = sum(size for _, size in panel)
    content = sum(y1 - y0 for y0, y1 in rows) + panel_height + (TEMPLATE_WIDTH - SIDE_PANEL_BOTTOM)
    out = Image.new("RGBA", (template.width, length))
    top = paste_rows(out, template, length - content, rows)
    source_row = {"outline": SIDE_OUTLINE_ROW, "dark": SIDE_DARK_ROW, "light": SIDE_LIGHT_ROW}
    for kind, size in panel:
        strip = template.crop((0, source_row[kind], template.width, source_row[kind] + 1))
        for _ in range(size):
            out.alpha_composite(strip, (0, top))
            top += 1
    paste_rows(out, template, top, [(SIDE_PANEL_BOTTOM, TEMPLATE_WIDTH)])
    return out


def pad(image, sections, vertical):
    """Center the shelf in transparent space so its width lands on the placement grid."""
    total = padded_width(sections) - natural_width(sections)
    before = total // 2
    size = (image.width, image.height + total) if vertical else (image.width + total, image.height)
    out = Image.new("RGBA", size)
    out.alpha_composite(image, (0, before) if vertical else (before, 0))
    return out


def main():
    templates = {
        facing: Image.open(TEMPLATES / f"budget_3x4_{facing}.png").convert("RGBA")
        for facing in ("down", "left", "up", "right")
    }
    for levels in (2, 3):
        for sections in (2, 3, 4):
            art = {
                "down": pad(front(templates["down"], levels, sections), sections, False),
                "up": pad(back(templates["up"], levels, sections), sections, False),
                "left": pad(side(templates["left"], levels, sections), sections, True),
                "right": pad(side(templates["right"], levels, sections), sections, True),
            }
            for facing, image in art.items():
                path = OUT / f"shelf_budget_{levels}x{sections}_{facing}.png"
                image.save(path)
                print(f"{path.name} {image.width}x{image.height}")


if __name__ == "__main__":
    main()
