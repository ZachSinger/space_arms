"""Draw two complete four-direction walk sheets for every employee.

Run with Python and Pillow after editing the pixel patterns or staff art manifest.
Use the player's authored walking silhouettes for both poses, with staff uniforms
and each worker's original head. No customer or player artwork is overwritten.
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PALETTE = {
    "A": (12, 19, 32, 255),
    "B": (139, 62, 36, 255),
    "C": (231, 138, 64, 255),
    "D": (255, 202, 177, 255),
    "F": (186, 109, 102, 255),
    "N": (34, 52, 69, 255),
    "P": (59, 81, 96, 255),
    "W": (237, 228, 194, 255),
}
CHARACTERS = ROOT / "img" / "Icons_Extracted" / "Tileset" / "Characters"


def logical_sheet(path):
    source = Image.open(path).convert("RGBA")
    logical = source.resize((96, 128), Image.Resampling.NEAREST)
    assert logical.resize(source.size, Image.Resampling.NEAREST).tobytes() == source.tobytes()
    return logical


def staff_frame(original, regular, pose, row, column):
    bob = 0 if column == 1 else 1
    result = Image.new("RGBA", (32, 32))
    for y in range(32):
        for x in range(32):
            pixel = pose.getpixel((x, y))
            if not pixel[3]:
                continue
            # Above the collar only the raised arms differ; discard the template head.
            if y < 17 + bob and pixel == regular.getpixel((x, y)):
                continue
            sleeve = y < 25 + bob and (x < 13 or x > 18 or y < 19 + bob)
            colors = {
                (0, 0, 0, 255): PALETTE["A"],
                (22, 55, 85, 255): PALETTE["B" if sleeve else "N"],
                (59, 118, 143, 255): PALETTE["C" if sleeve else "P"],
                (80, 185, 235, 255): PALETTE["C"],
                (255, 204, 208, 255): PALETTE["D"],
                (195, 114, 137, 255): PALETTE["F"],
                (255, 255, 255, 255): PALETTE["P" if row == 3 else "W"],
                (255, 105, 90, 255): PALETTE["N" if row == 3 else "W"],
            }
            result.putpixel((x, y), colors[pixel])
    head = original.crop((0, 0, 32, 17 + bob))
    result.alpha_composite(head, (0, 0))
    return result


def main():
    manifest = json.loads((ROOT / "data" / "EmployeeCharacterManifest.json").read_text())
    regular = logical_sheet(CHARACTERS / "player_mechanic.png")
    carrying = logical_sheet(CHARACTERS / "player_mechanic_carry.png")
    for entry in manifest:
        logical = logical_sheet(ROOT / entry["source"])
        sheets = []
        for template, path in [(regular, entry["path"]), (carrying, entry["carryPath"])]:
            sheet = Image.new("RGBA", logical.size)
            for row in range(4):
                for column in range(3):
                    box = (column * 32, row * 32, (column + 1) * 32, (row + 1) * 32)
                    drawn = staff_frame(logical.crop(box), regular.crop(box), template.crop(box), row, column)
                    sheet.alpha_composite(drawn, (column * 32, row * 32))
            output = ROOT / path
            output.parent.mkdir(parents=True, exist_ok=True)
            sheet.resize((288, 384), Image.Resampling.NEAREST).save(output)
            sheets.append(sheet)
        for row in range(4):
            for column in range(3):
                for y in range(26, 32):
                    for x in range(32):
                        point = (column * 32 + x, row * 32 + y)
                        assert sheets[0].getpixel(point) == sheets[1].getpixel(point)
            for sheet in sheets:
                strides = [
                    sheet.crop((column * 32, row * 32 + 25, (column + 1) * 32, (row + 1) * 32)).tobytes()
                    for column in range(3)
                ]
                assert len(set(strides)) == 3, f"{entry['id']} needs three distinct strides in direction {row}"
        print(f"Created normal and carrying sheets for {entry['id']}")


if __name__ == "__main__":
    main()
