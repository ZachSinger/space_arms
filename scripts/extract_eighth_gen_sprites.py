"""
Extracts customer character sprites from img/Uncut_Sheets/EigthGeneration/*.jpg (9 sheets,
each a 2048x2048 image containing a 4x4 grid: 4 characters x 4 facings, on a solid
chroma-key green background). Same approach as extract_seventh_gen_sprites.py: each sheet's
exact column/row boundaries are detected dynamically from the image itself (zero-foreground
gutter bands) rather than assumed/hardcoded.

One of the nine sheets ("(7)") was excluded by design -- it's in the same chunkier
pixel-art sub-style excluded from Seventh Generation, which would look inconsistent mixed
into the same customer crowd as everything else.

All 4 rows x 8 sheets (32 characters) passed review for being the SAME character
consistently across all 4 facings -- see KEEP_ROWS. This ADDS to the existing roster
(continuing faction numbering from the current counts) rather than replacing it, since the
art style matches what's already live.

Usage: python scripts/extract_eighth_gen_sprites.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET_DIR = ROOT / "img" / "Uncut_Sheets" / "EigthGeneration"
OUT_DIR = ROOT / "img" / "Icons_Extracted" / "Customers"

FACINGS = ["down", "up", "left", "right"]  # column order, per the resource request spec

# Maps each included sheet's filename to a letter (for readability in KEEP_ROWS below) --
# sheet "(7)" is deliberately omitted (different art sub-style, see module docstring).
SHEET_FILES = {
    "A": "Gemini_Generated_Image_bd36d0bd36d0bd36 (1).jpg",
    "B": "Gemini_Generated_Image_bd36d0bd36d0bd36 (2).jpg",
    "C": "Gemini_Generated_Image_bd36d0bd36d0bd36 (3).jpg",
    "D": "Gemini_Generated_Image_bd36d0bd36d0bd36 (4).jpg",
    "E": "Gemini_Generated_Image_bd36d0bd36d0bd36 (5).jpg",
    "F": "Gemini_Generated_Image_bd36d0bd36d0bd36 (6).jpg",
    "H": "Gemini_Generated_Image_bd36d0bd36d0bd36 (9).jpg",
    "I": "Gemini_Generated_Image_bd36d0bd36d0bd36 (10).jpg",
}

# Continues faction numbering from the roster as it stood before this generation (checked
# via the actual extracted files, not assumed) so new characters never collide with
# existing filenames.
STARTING_COUNTS = {
    "scavenger": 4,
    "mercenary": 11,
    "civilian": 4,
    "explorer": 8,
    "alien": 5,
}

# (sheet_letter, row_index 1-4, faction) -- every row in every included sheet passed review.
# "faction" is purely an art-pipeline naming/grouping label with no gameplay binding.
KEEP_ROWS = [
    ("A", 1, "explorer"),
    ("A", 2, "explorer"),
    ("A", 3, "scavenger"),
    ("A", 4, "mercenary"),
    ("B", 1, "mercenary"),
    ("B", 2, "mercenary"),
    ("B", 3, "mercenary"),
    ("B", 4, "mercenary"),
    ("C", 1, "explorer"),
    ("C", 2, "explorer"),
    ("C", 3, "explorer"),
    ("C", 4, "explorer"),
    ("D", 1, "explorer"),
    ("D", 2, "explorer"),
    ("D", 3, "explorer"),
    ("D", 4, "explorer"),
    ("E", 1, "explorer"),
    ("E", 2, "explorer"),
    ("E", 3, "explorer"),
    ("E", 4, "explorer"),
    ("F", 1, "explorer"),
    ("F", 2, "explorer"),
    ("F", 3, "explorer"),
    ("F", 4, "explorer"),
    ("H", 1, "mercenary"),
    ("H", 2, "mercenary"),
    ("H", 3, "explorer"),
    ("H", 4, "explorer"),
    ("I", 1, "scavenger"),
    ("I", 2, "mercenary"),
    ("I", 3, "explorer"),
    ("I", 4, "explorer"),
]


def foreground_mask_whole(arr: np.ndarray) -> np.ndarray:
    """Coarse whole-sheet mask used only to find gutter bands between cells."""
    g, r, b = arr[..., 1].astype(np.int16), arr[..., 0].astype(np.int16), arr[..., 2].astype(np.int16)
    greenish = (g > r + 20) & (g > b + 20) & (g > 100)
    return ~greenish


def find_gap_bands(zero_indices: np.ndarray) -> list[tuple[int, int]]:
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
    fg = foreground_mask_whole(arr)
    height, width = fg.shape

    col_gaps = find_gap_bands(np.where(fg.sum(axis=0) == 0)[0])
    row_gaps = find_gap_bands(np.where(fg.sum(axis=1) == 0)[0])

    if len(col_gaps) != 5 or len(row_gaps) != 5:
        raise ValueError(
            f"Expected 5 gap bands per axis (4 cells), got {len(col_gaps)} col / {len(row_gaps)} row"
        )

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

    counts = dict(STARTING_COUNTS)
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
        added = count - STARTING_COUNTS.get(faction, 0)
        print(f"  {faction}: {count} total (+{added} new)")


if __name__ == "__main__":
    main()
