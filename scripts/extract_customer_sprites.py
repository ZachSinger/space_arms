"""
Extracts customer character sprites from img/Uncut_Sheets/SixthGeneration/CharacterSheets.webp
(a single 1024x1024 montage containing 10 labeled "sheets", each a 4x4 grid: 4 characters x
4 facings). Chroma-keys the green background to transparency, same approach as
extract_item_icons.py (sampled key color + green-channel check + despill).

Only rows that were visually confirmed to depict the SAME character consistently across all
4 facings are extracted -- a number of rows in this generation have a hair-color/style
mismatch between facings (most often the "facing up"/back view), which would look like the
customer visually turns into a different person when they change walking direction in-game.
See KEEP_ROWS below for exactly which rows passed review.

Usage: python scripts/extract_customer_sprites.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET_PATH = ROOT / "img" / "Uncut_Sheets" / "SixthGeneration" / "CharacterSheets.webp"
OUT_DIR = ROOT / "img" / "Icons_Extracted" / "Customers"

SHEET_SIZE = 1024

# Measured row boundaries (y-pixel) -- top row of sheet-blocks (sheets 1-5) and bottom row
# (sheets 6-10) have slightly different grid heights, so each gets its own set.
ROW_BOUNDS_TOP = [61, 155, 252, 347, 444]
ROW_BOUNDS_BOTTOM = [530, 629, 732, 837, 938]

# Measured column boundaries (x-pixel) per sheet -- NOT uniform width, so each sheet's 5
# boundary points (4 columns) were individually detected from the source image rather than
# assumed from even division.
COL_BOUNDS = {
    1: [2, 58, 112, 165, 221],
    2: [221, 276, 327, 377, 430],
    3: [430, 479, 525, 570, 614],
    4: [614, 667, 714, 761, 807],
    5: [807, 863, 915, 967, 1021],
    6: [2, 58, 110, 161, 218],
    7: [218, 272, 322, 372, 426],
    8: [426, 479, 525, 570, 619],
    9: [619, 670, 716, 762, 810],
    10: [810, 867, 916, 967, 1020],
}

FACINGS = ["down", "up", "left", "right"]  # column order, per the resource request spec

# (sheet_index 1-10, row_index 1-4, faction, note) -- only rows confirmed to show the SAME
# character consistently across all 4 facings during review.
KEEP_ROWS = [
    (1, 1, "scavenger"),
    (2, 1, "scavenger"),
    (3, 1, "mercenary"),
    (3, 2, "mercenary"),
    (3, 3, "mercenary"),
    (3, 4, "mercenary"),
    (4, 1, "mercenary"),
    (4, 2, "mercenary"),
    (4, 3, "mercenary"),
    (4, 4, "mercenary"),
    (5, 1, "explorer"),
    (5, 3, "explorer"),
    (5, 4, "explorer"),
    (6, 2, "explorer"),
    (7, 1, "civilian"),
    (7, 2, "civilian"),
    (9, 1, "scavenger"),
    (9, 2, "mercenary"),
    (9, 3, "explorer"),
    (9, 4, "civilian"),
    (10, 2, "mercenary"),
]


def key_color(arr: np.ndarray) -> np.ndarray:
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    return np.mean(corners, axis=0)


def foreground_mask(arr: np.ndarray, key: np.ndarray) -> np.ndarray:
    g, r, b = arr[..., 1].astype(np.int16), arr[..., 0].astype(np.int16), arr[..., 2].astype(np.int16)
    dist = np.sqrt(((arr.astype(np.int16) - key) ** 2).sum(axis=2))
    greenish = (g > r + 20) & (g > b + 20) & (g > 100)
    return (dist > 45) & ~greenish


def despill(arr: np.ndarray) -> np.ndarray:
    out = arr.astype(np.int16).copy()
    g = out[..., 1]
    out[..., 1] = np.minimum(g, np.maximum(out[..., 0], out[..., 2]))
    return np.clip(out, 0, 255).astype(np.uint8)


def extract_cell(sheet_arr: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> Image.Image:
    region = sheet_arr[y0:y1, x0:x1]
    key = key_color(region)
    mask = foreground_mask(region, key)
    rgb = despill(region)
    rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    return Image.fromarray(rgba, mode="RGBA")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet = np.asarray(Image.open(SHEET_PATH).convert("RGB"))

    counts = {}
    extracted = 0

    for sheet_index, row_index, faction in KEEP_ROWS:
        counts[faction] = counts.get(faction, 0) + 1
        char_num = counts[faction]

        is_bottom_half = sheet_index > 5
        row_bounds = ROW_BOUNDS_BOTTOM if is_bottom_half else ROW_BOUNDS_TOP
        col_bounds = COL_BOUNDS[sheet_index]

        y0, y1 = row_bounds[row_index - 1], row_bounds[row_index]

        for col, facing in enumerate(FACINGS):
            x0, x1 = col_bounds[col], col_bounds[col + 1]
            crop = extract_cell(sheet, x0, y0, x1, y1)
            out_name = f"{faction}_{char_num:02d}_{facing}.png"
            crop.save(OUT_DIR / out_name)
            extracted += 1

    print(f"Extracted {extracted} images ({len(KEEP_ROWS)} characters x 4 facings) to {OUT_DIR}")
    for faction, count in counts.items():
        print(f"  {faction}: {count} characters")


if __name__ == "__main__":
    main()
