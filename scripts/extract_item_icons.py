"""
Extract individual item sprites from the green-chroma-key "Uncut Sheets" into
transparent PNGs, plus a contact sheet + manifest for quick visual QA.

Usage:
    python scripts/extract_item_icons.py

Input:   img/Uncut_Sheets/*.jpg   (chroma-keyed sprite sheets, uneven spacing)
Output:  img/Icons_Extracted/*.png              (one PNG per detected item, RGBA)
         img/Icons_Extracted/_contact_sheet.png (visual index for QA)
         img/Icons_Extracted/_manifest.json     (sheet/bbox metadata per file)

Approach: instead of assuming a fixed grid, we chroma-key each sheet against
its own sampled background color, then find connected foreground components
("blobs") and crop to their actual bounding boxes. This handles the uneven
spacing directly. A morphological closing pass merges components that got
accidentally split by thin details (straps/wires/antennas) without merging
genuinely separate items, which sit much farther apart.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SHEET_DIR = ROOT / "img" / "Uncut_Sheets"
OUT_DIR = ROOT / "img" / "Icons_Extracted"

MIN_COMPONENT_AREA = 400  # px, drops jpeg noise specks
CLOSING_ITERATIONS = 4  # bridges thin gaps (straps/wires) without merging separate items
PAD = 5  # px of breathing room kept around each crop
BG_DIST_THRESHOLD = 45  # euclidean RGB distance from sampled key color = "background"


def key_color(arr: np.ndarray) -> np.ndarray:
    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
    return np.mean(corners, axis=0)


def foreground_mask(arr: np.ndarray, key: np.ndarray) -> np.ndarray:
    r, g, b = arr[..., 0].astype(np.int16), arr[..., 1].astype(np.int16), arr[..., 2].astype(np.int16)
    dist = np.sqrt(((arr.astype(np.int16) - key) ** 2).sum(axis=2))
    greenish = (g > r + 20) & (g > b + 20) & (g > 100)
    return (dist > BG_DIST_THRESHOLD) & ~greenish


def despill(arr: np.ndarray) -> np.ndarray:
    """Clamp green spill on edge pixels so item outlines don't keep a green fringe."""
    out = arr.astype(np.int16).copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    g_clamped = np.minimum(g, np.maximum(r, b))
    out[..., 1] = g_clamped
    return np.clip(out, 0, 255).astype(np.uint8)


def extract_sheet(path: Path):
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

    # Order boxes reading order: split into rows at the single largest vertical gap,
    # then sort each row left-to-right. Generalizes beyond a hardcoded "2 rows".
    boxes_by_y = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    centers_y = [(b[1] + b[3]) / 2 for b in boxes_by_y]
    rows = [boxes_by_y]
    if len(centers_y) > 1:
        gaps = [centers_y[i + 1] - centers_y[i] for i in range(len(centers_y) - 1)]
        split_i = max(range(len(gaps)), key=lambda i: gaps[i])
        if gaps[split_i] > 60:  # only split if it's a real row gap, not row jitter
            rows = [boxes_by_y[: split_i + 1], boxes_by_y[split_i + 1:]]
    ordered = []
    for row in rows:
        ordered.extend(sorted(row, key=lambda b: b[0]))

    crops = []
    for (x0, y0, x1, y1) in ordered:
        region = arr[y0:y1, x0:x1]
        region_mask = mask[y0:y1, x0:x1].astype(np.float32)
        alpha = ndimage.gaussian_filter(region_mask, sigma=1.0)
        alpha = np.clip(alpha, 0.0, 1.0)

        rgb = despill(region)
        rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
        crops.append((Image.fromarray(rgba, mode="RGBA"), (x0, y0, x1, y1)))

    return crops


def build_contact_sheet(entries, out_path: Path):
    """entries: list of (filename, PIL.Image RGBA, source_sheet) for a dark-background review grid."""
    cell = 180
    cols = 10
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 22)), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("consola.ttf", 11)
    except OSError:
        font = ImageFont.load_default()

    for i, (name, im, _src) in enumerate(entries):
        col, row = i % cols, i // cols
        thumb = im.copy()
        thumb.thumbnail((cell - 16, cell - 16))
        px = col * cell + (cell - thumb.width) // 2
        py = row * (cell + 22) + (cell - thumb.height) // 2
        # checkerboard behind thumb so transparency is visible
        checker = Image.new("RGB", thumb.size, (60, 60, 64))
        cdraw = ImageDraw.Draw(checker)
        step = 8
        for cy in range(0, thumb.size[1], step):
            for cx in range(0, thumb.size[0], step):
                if (cx // step + cy // step) % 2 == 0:
                    cdraw.rectangle([cx, cy, cx + step, cy + step], fill=(90, 90, 96))
        checker.paste(thumb, (0, 0), thumb)
        sheet.paste(checker, (px, py))
        label = name.replace(".png", "")
        draw.text((col * cell + 4, row * (cell + 22) + cell + 4), label, fill=(210, 210, 215), font=font)

    sheet.save(out_path)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    contact_entries = []

    sheet_paths = sorted(SHEET_DIR.glob("*.jpg"))
    for sheet_path in sheet_paths:
        crops = extract_sheet(sheet_path)
        for idx, (crop_img, bbox) in enumerate(crops, start=1):
            out_name = f"{sheet_path.stem}_{idx:02d}.png"
            crop_img.save(OUT_DIR / out_name)
            manifest.append(
                {
                    "file": out_name,
                    "source_sheet": sheet_path.name,
                    "bbox": bbox,
                    "width": bbox[2] - bbox[0],
                    "height": bbox[3] - bbox[1],
                }
            )
            contact_entries.append((out_name, crop_img, sheet_path.name))
        print(f"{sheet_path.name}: {len(crops)} items extracted")

    with open(OUT_DIR / "_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    build_contact_sheet(contact_entries, OUT_DIR / "_contact_sheet.png")
    print(f"\nTotal items extracted: {len(manifest)}")
    print(f"Output dir: {OUT_DIR}")


if __name__ == "__main__":
    main()
