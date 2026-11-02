"""
Extracts customer character sprites from img/Uncut_Sheets/SeventhGeneration/*.jpg (10
sheets, each a 2048x2048 image containing a 4x4 grid: 4 characters x 4 facings, on a solid
chroma-key green background).

Unlike extract_customer_sprites.py (SixthGeneration), this batch's grid is NOT uniform/
hardcoded -- each sheet's exact column/row boundaries are detected dynamically from the
image itself (by finding bands of columns/rows with zero foreground pixels, i.e. pure
background gutters between cells) rather than assumed from even division or copied-by-hand
pixel coordinates. This avoids the exact "bleed-through crop" bug that an earlier,
hardcoded-boundary approach hit on SixthGeneration.

Two of the ten sheets ("(6)" and "(7)") were excluded by design -- they're in a visibly
different, chunkier pixel-art sub-style than the other 8 smoother vector-style sheets, and
would look inconsistent mixed into the same customer crowd.

All 4 rows x 8 sheets (32 characters) passed review for being the SAME character
consistently across all 4 facings -- see KEEP_ROWS.

Usage: python scripts/extract_seventh_gen_sprites.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET_DIR = ROOT / "img" / "Uncut_Sheets" / "SeventhGeneration"
OUT_DIR = ROOT / "img" / "Icons_Extracted" / "Customers"

FACINGS = ["down", "up", "left", "right"]  # column order, per the resource request spec

# Maps each included sheet's filename to a letter (for readability in KEEP_ROWS below) --
# sheets (6) and (7) are deliberately omitted (different art sub-style, see module docstring).
SHEET_FILES = {
    "A": "Gemini_Generated_Image_npayr6npayr6npay.jpg",
    "B": "Gemini_Generated_Image_npayr6npayr6npay (1).jpg",
    "C": "Gemini_Generated_Image_npayr6npayr6npay (2).jpg",
    "D": "Gemini_Generated_Image_npayr6npayr6npay (3).jpg",
    "E": "Gemini_Generated_Image_npayr6npayr6npay (4).jpg",
    "F": "Gemini_Generated_Image_npayr6npayr6npay (5).jpg",
    "G": "Gemini_Generated_Image_npayr6npayr6npay (8).jpg",
    "H": "Gemini_Generated_Image_npayr6npayr6npay (9).jpg",
}

# (sheet_letter, row_index 1-4, faction) -- every row in every included sheet passed review
# (unlike SixthGeneration, nothing had to be excluded for facing-inconsistency). "faction" is
# purely an art-pipeline naming/grouping label (scavenger/mercenary/explorer/civilian/alien)
# with no gameplay binding -- see CustomerSprites.js, which only reads faction+num to build
# texture keys.
KEEP_ROWS = [
    ("A", 1, "scavenger"),
    ("A", 2, "mercenary"),
    ("A", 3, "civilian"),
    ("A", 4, "alien"),
    ("B", 1, "scavenger"),
    ("B", 2, "mercenary"),
    ("B", 3, "civilian"),
    ("B", 4, "alien"),
    ("C", 1, "mercenary"),
    ("C", 2, "mercenary"),
    ("C", 3, "mercenary"),
    ("C", 4, "mercenary"),
    ("D", 1, "mercenary"),
    ("D", 2, "explorer"),
    ("D", 3, "mercenary"),
    ("D", 4, "alien"),
    ("E", 1, "explorer"),
    ("E", 2, "explorer"),
    ("E", 3, "explorer"),
    ("E", 4, "explorer"),
    ("F", 1, "explorer"),
    ("F", 2, "explorer"),
    ("F", 3, "explorer"),
    ("F", 4, "alien"),
    ("G", 1, "scavenger"),
    ("G", 2, "mercenary"),
    ("G", 3, "mercenary"),
    ("G", 4, "civilian"),
    ("H", 1, "scavenger"),
    ("H", 2, "mercenary"),
    ("H", 3, "alien"),
    ("H", 4, "civilian"),
]


def foreground_mask_whole(arr: np.ndarray) -> np.ndarray:
    """Coarse whole-sheet mask used only to find gutter bands between cells -- doesn't need
    to be pixel-perfect, just good enough to find columns/rows with ZERO foreground."""
    g, r, b = arr[..., 1].astype(np.int16), arr[..., 0].astype(np.int16), arr[..., 2].astype(np.int16)
    greenish = (g > r + 20) & (g > b + 20) & (g > 100)
    return ~greenish


def find_gap_bands(zero_indices: np.ndarray) -> list[tuple[int, int]]:
    """Groups consecutive indices (e.g. every column with zero foreground pixels) into
    contiguous (start, end) bands."""
    if len(zero_indices) == 0:
        return []
    gaps = []
    start = prev = zero_indices[0]
    for idx in zero_indices[1:]:
        if idx - prev > 1:
            gaps.append((int(start), int(prev)))
            start = idx
        prev = idx
    gaps.append((int(start), int(prev)))
    return gaps


def detect_grid_bounds(arr: np.ndarray) -> tuple[list[int], list[int]]:
    """Returns (col_bounds, row_bounds), each a list of 5 pixel coordinates (4 cells'
    worth of boundaries), derived from this specific sheet's own content -- not assumed."""
    fg = foreground_mask_whole(arr)
    height, width = fg.shape

    col_gaps = find_gap_bands(np.where(fg.sum(axis=0) == 0)[0])
    row_gaps = find_gap_bands(fg_row_zero_indices := np.where(fg.sum(axis=1) == 0)[0])

    if len(col_gaps) != 5 or len(row_gaps) != 5:
        raise ValueError(
            f"Expected 5 gap bands per axis (4 cells), got {len(col_gaps)} col / {len(row_gaps)} row"
        )

    # Outer edges use the sheet's true boundary (0 / width); internal gaps use their
    # midpoint, landing cleanly inside background with margin on both sides of the cut.
    col_bounds = [0] + [int((a + b) / 2) for a, b in col_gaps[1:4]] + [width]
    row_bounds = [0] + [int((a + b) / 2) for a, b in row_gaps[1:4]] + [height]
    return col_bounds, row_bounds


def key_color(arr: np.ndarray) -> np.ndarray:
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    return np.mean(corners, axis=0)


def foreground_mask_cell(arr: np.ndarray, key: np.ndarray) -> np.ndarray:
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
    mask = foreground_mask_cell(region, key)
    rgb = despill(region)
    rgba = np.dstack([rgb, (mask * 255).astype(np.uint8)])
    return Image.fromarray(rgba, mode="RGBA")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sheets = {}
    for letter, filename in SHEET_FILES.items():
        arr = np.asarray(Image.open(SHEET_DIR / filename).convert("RGB"))
        col_bounds, row_bounds = detect_grid_bounds(arr)
        sheets[letter] = (arr, col_bounds, row_bounds)
        print(f"Sheet {letter}: col_bounds={col_bounds} row_bounds={row_bounds}")

    counts = {}
    extracted = 0

    for sheet_letter, row_index, faction in KEEP_ROWS:
        counts[faction] = counts.get(faction, 0) + 1
        char_num = counts[faction]

        arr, col_bounds, row_bounds = sheets[sheet_letter]
        y0, y1 = row_bounds[row_index - 1], row_bounds[row_index]

        for col, facing in enumerate(FACINGS):
            x0, x1 = col_bounds[col], col_bounds[col + 1]
            crop = extract_cell(arr, x0, y0, x1, y1)
            out_name = f"{faction}_{char_num:02d}_{facing}.png"
            crop.save(OUT_DIR / out_name)
            extracted += 1

    print(f"\nExtracted {extracted} images ({len(KEEP_ROWS)} characters x 4 facings) to {OUT_DIR}")
    for faction, count in counts.items():
        print(f"  {faction}: {count} characters")


if __name__ == "__main__":
    main()
