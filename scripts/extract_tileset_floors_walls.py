"""
Extracts Sheet1_A.jpg (modular floor/wall tiles) via fixed 256x256 grid slicing
(no chroma-key needed -- these tiles are meant to be fully opaque and tile
seamlessly edge-to-edge, per the resource request spec).

Usage: python scripts/extract_tileset_floors_walls.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET_PATH = ROOT / "img" / "Uncut_Sheets" / "FifthGeneration" / "Sheet1_A_Regen_1.jpg"
OUT_DIR = ROOT / "img" / "Icons_Extracted" / "Tileset"

TILE_SIZE = 256

# Row-major names for the 8x8 grid (reading order, left-to-right, top-to-bottom).
# Grouped by the thematic row runs visible in the sheet.
NAMES = [
    # Row 1: light/white floor tiles, increasingly worn/dirty, then cracked
    "floor_light_clean_01", "floor_light_speckled_02", "floor_light_scratched_03",
    "floor_light_mint_accent_04", "floor_light_teal_glow_05", "floor_light_stained_06",
    "floor_light_grimy_07", "floor_light_cracked_08",
    # Row 2: grey floor tiles + metal grate floors
    "floor_grey_clean_01", "floor_grey_scratched_02", "floor_grey_scuffed_03",
    "floor_grey_grimy_04", "floor_grate_01", "floor_grate_02", "floor_grate_03", "floor_grate_04",
    # Row 3: concrete / riveted plate floors + hazard-stripe floors
    "floor_concrete_clean_01", "floor_concrete_marked_02", "floor_plate_riveted_01",
    "floor_plate_riveted_02", "floor_hazard_top_01", "floor_hazard_top_bottom_02",
    "floor_hazard_sides_01", "floor_hazard_right_01",
    # Row 4: dark ridged floor + dark textured floor
    "floor_ridged_thick_01", "floor_ridged_thin_brass_01", "floor_ridged_thick_02",
    "floor_ridged_thin_brass_02", "floor_dark_textured_circuit", "floor_dark_textured_tools",
    "floor_dark_textured_seams", "floor_dark_textured_plain",
    # Row 5: light wall panels + beam/cross-brace walls
    "wall_light_panel_01", "wall_light_panel_02", "wall_light_panel_03", "wall_light_panel_04",
    "wall_beam_center_01", "wall_beam_frame_02", "wall_brace_x_01", "wall_brace_x_02",
    # Row 6: dark riveted walls + starfield windows
    "wall_dark_riveted_01", "wall_dark_riveted_02", "wall_dark_riveted_seam_03",
    "wall_dark_riveted_split_04", "wall_window_star_narrow", "wall_window_star_02",
    "wall_window_star_wide", "wall_window_star_widest",
    # Row 7: blast doors + plain light doors
    "door_blast_keypad_01", "door_blast_keypad_02", "door_blast_plain_01",
    "door_blast_single_small", "door_light_blank_01", "door_light_blank_02",
    "door_light_blank_03", "door_light_blank_wide",
    # Row 8: shop awning + plain dark wall base + exposed pipe wall
    "awning_shop_left", "awning_shop_right", "wall_base_arch_01", "wall_base_arch_02",
    "wall_base_plain_01", "wall_base_plain_02", "wall_pipes_left", "wall_pipes_junction_right",
]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SHEET_PATH).convert("RGB")

    assert sheet.size == (2048, 2048), f"Unexpected sheet size: {sheet.size}"
    assert len(NAMES) == 64, f"Expected 64 names, got {len(NAMES)}"

    idx = 0
    for row in range(8):
        for col in range(8):
            x0, y0 = col * TILE_SIZE, row * TILE_SIZE
            tile = sheet.crop((x0, y0, x0 + TILE_SIZE, y0 + TILE_SIZE))
            tile.save(OUT_DIR / f"{NAMES[idx]}.png")
            idx += 1

    print(f"Extracted {idx} tiles to {OUT_DIR}")


if __name__ == "__main__":
    main()
