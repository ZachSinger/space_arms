"""One-off: scans img/Icons_Extracted/Tileset recursively and writes
data/TilesetManifest.json listing every tile's load key + path, so boot.js can
bulk-load them without hand-maintaining a giant list.

Re-run this any time tiles are added/removed/renamed under Tileset/.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TILESET_DIR = ROOT / "img" / "Icons_Extracted" / "Tileset"
OUT_PATH = ROOT / "data" / "TilesetManifest.json"


def main():
    entries = []
    for path in sorted(TILESET_DIR.rglob("*.png")):
        key = path.stem
        rel_path = path.relative_to(ROOT).as_posix()
        entries.append({"key": key, "path": rel_path})

    OUT_PATH.write_text(json.dumps(entries, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
