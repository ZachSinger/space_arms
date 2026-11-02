"""One-off: scans img/Icons_Extracted/Customers and writes
data/CustomerSpriteManifest.json listing every customer sprite's load key + path, so
boot.js can bulk-load them without hand-maintaining a list.

Re-run this any time customer sprites are added/removed/renamed under Customers/.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CUSTOMERS_DIR = ROOT / "img" / "Icons_Extracted" / "Customers"
OUT_PATH = ROOT / "data" / "CustomerSpriteManifest.json"


def main():
    entries = []
    for path in sorted(CUSTOMERS_DIR.glob("*.png")):
        key = f"customer_{path.stem}"  # e.g. customer_scavenger_01_down
        rel_path = path.relative_to(ROOT).as_posix()
        entries.append({"key": key, "path": rel_path})

    OUT_PATH.write_text(json.dumps(entries, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {OUT_PATH}")


if __name__ == "__main__":
    main()
