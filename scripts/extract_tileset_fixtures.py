"""
Extracts Sheet2_A.jpg (shop fixtures/decor) via chroma-key blob detection, reusing
the same approach as extract_item_icons.py. Fixtures are saved with alpha
transparency (unlike the floor/wall tiles, which are opaque).

Usage: python scripts/extract_tileset_fixtures.py
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET_PATH = ROOT / "img" / "Uncut_Sheets" / "FourthGeneration" / "Sheet2_A.jpg"
OUT_DIR = ROOT / "img" / "Icons_Extracted" / "Tileset" / "Fixtures"

MIN_COMPONENT_AREA = 400
CLOSING_ITERATIONS = 4
PAD = 5
BG_DIST_THRESHOLD = 45

# Names grouped per grid row (reading order within each row: left-to-right).
# Row 5 (index 4) is a "loose small props" row (brackets/poles/crosses) that
# doesn't cleanly split into discrete named fixtures -- it's numbered generically.
ROW_NAMES = [
    ["register_01", "register_02", "register_03", "register_04", "register_05",
     "pipe_corner_01", "pipe_corner_02", "pipe_corner_03", "pipe_corner_04", "pipe_corner_05"],
    ["shelf_universal_01", "shelf_universal_02", "shelf_universal_03", "shelf_universal_04", "shelf_universal_05",
     "shelf_frame_01", "shelf_frame_02", "shelf_frame_03", "shelf_frame_04", "shelf_frame_05"],
    ["rail_bench_01", "rail_bench_02", "rail_bench_03", "rail_bench_04", "rail_bench_05",
     "mannequin_01", "mannequin_02", "mannequin_03", "mannequin_04", "mannequin_05"],
    ["crate_closed_01", "crate_closed_02", "crate_closed_03", "crate_closed_04", "crate_closed_05",
     "crate_open_01", "crate_open_02", "crate_open_03", "crate_open_04", "crate_open_05"],
    None,  # row 5: generic "prop_small_NN" numbering, filled in dynamically below
    ["sign_neon_01", "sign_neon_02", "sign_neon_03", "sign_neon_04", "sign_neon_05",
     "sign_warning_01", "sign_warning_02", "sign_warning_03", "sign_warning_04", "sign_warning_05"],
    ["light_ceiling_01", "light_ceiling_02", "light_ceiling_03", "light_ceiling_04", "light_ceiling_05",
     "camera_security_01", "camera_security_02", "camera_security_03", "camera_security_04", "camera_security_05"],
    ["monitor_crt_01", "monitor_crt_02", "monitor_crt_03", "monitor_crt_04", "monitor_crt_05",
     "plant_potted_01", "plant_potted_02", "plant_potted_03", "plant_potted_04", "plant_potted_05"],
    ["vending_machine_01", "vending_machine_02", "vending_machine_03", "vending_machine_04", "vending_machine_05",
     "bin_trash_01", "bin_trash_02", "bin_trash_03", "bin_trash_04", "bin_trash_05"],
    ["podium_octagon", "desk_office", "chair_office", "locker_storage", "server_standee",
     "workbench_drawer", "workbench_plain", "workbench_tools", "unit_hvac_01", "unit_hvac_02"],
]


def key_color(arr):
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    return np.mean(corners, axis=0)


def foreground_mask(arr, key):
    g = arr[..., 1].astype(np.int16)
    r = arr[..., 0].astype(np.int16)
    b = arr[..., 2].astype(np.int16)
    dist = np.sqrt(((arr.astype(np.int16) - key) ** 2).sum(axis=2))
    greenish = (g > r + 20) & (g > b + 20) & (g > 100)
    return (dist > BG_DIST_THRESHOLD) & ~greenish


def despill(arr):
    out = arr.astype(np.int16).copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    out[..., 1] = np.minimum(g, np.maximum(r, b))
    return np.clip(out, 0, 255).astype(np.uint8)


def extract_sheet(path):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img)
    key = key_color(arr)
    mask = foreground_mask(arr, key)

    closed = ndimage.binary_closing(mask, structure=np.ones((3, 3)), iterations=CLOSING_ITERATIONS)
    labeled, n = ndimage.label(closed)
    sizes = ndimage.sum(closed, labeled, range(1, n + 1))
    objects = ndimage.find_objects(labeled)

    boxes = []
    for sl, sz in zip(objects, sizes):
        if sl is None or sz < MIN_COMPONENT_AREA:
            continue
        ys, xs = sl
        y0, y1 = max(ys.start - PAD, 0), min(ys.stop + PAD, arr.shape[0])
        x0, x1 = max(xs.start - PAD, 0), min(xs.stop + PAD, arr.shape[1])
        boxes.append((x0, y0, x1, y1))

    # Sort into 10 rows (not just 2) since this sheet is a 10x10 grid.
    boxes_by_y = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    row_height = arr.shape[0] / 10
    rows = {}
    for b in boxes_by_y:
        row_idx = int(((b[1] + b[3]) / 2) // row_height)
        rows.setdefault(row_idx, []).append(b)

    row_boxes = [sorted(rows[r], key=lambda b: b[0]) for r in sorted(rows)]

    row_crops = []
    for boxes_in_row in row_boxes:
        crops = []
        for (x0, y0, x1, y1) in boxes_in_row:
            region = arr[y0:y1, x0:x1]
            region_mask = mask[y0:y1, x0:x1].astype(np.float32)
            alpha = np.clip(ndimage.gaussian_filter(region_mask, sigma=1.0), 0.0, 1.0)
            rgb = despill(region)
            rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
            crops.append(Image.fromarray(rgba, mode="RGBA"))
        row_crops.append(crops)

    return row_crops


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    row_crops = extract_sheet(SHEET_PATH)
    print(f"Detected {len(row_crops)} rows: {[len(r) for r in row_crops]} blobs each")

    total = 0
    for row_idx, crops in enumerate(row_crops):
        names = ROW_NAMES[row_idx] if row_idx < len(ROW_NAMES) else None
        if names is None:
            names = [f"prop_small_{i:02d}" for i in range(1, len(crops) + 1)]
        elif len(names) != len(crops):
            print(
                f"WARNING: row {row_idx} has {len(crops)} blobs but {len(names)} names "
                f"-- falling back to generic naming for this row!"
            )
            names = [f"row{row_idx}_item_{i:02d}" for i in range(1, len(crops) + 1)]

        for crop, name in zip(crops, names):
            crop.save(OUT_DIR / f"{name}.png")
            total += 1

    print(f"Saved {total} fixture images to {OUT_DIR}")


if __name__ == "__main__":
    main()

