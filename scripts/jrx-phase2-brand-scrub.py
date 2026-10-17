#!/usr/bin/env python3
"""Replace user-facing Nyayavigya/Nyayasiddhi strings in Jurexio product paths."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", "dist", "archive", "patches", ".git"}
ROOTS = [ROOT / "src", ROOT / "client" / "src", ROOT / "packages", ROOT / "tests"]

REPLACEMENTS = [
    ("Nyayavigya Platform 5.0.0", "Jurexio Enterprise Platform 1.0.0"),
    ("Nyayavigya Platform", "Jurexio Enterprise Platform"),
    ("Nyayavigya SDK", "Jurexio Enterprise Platform SDK"),
    ("Nyayavigya", "Jurexio"),
    ("NYV-SVC-GATEWAY", "JRX-SVC-GATEWAY"),
    ("NYV Naming Convention", "JRX Naming Convention"),
    ("@nyayavigya/", "@jurexio/"),
    ("@nyv/", "@jurexio/"),
]


def ok(p: Path) -> bool:
    return not any(s in p.parts for s in SKIP)


def main() -> None:
    n = 0
    for base in ROOTS:
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or not ok(path):
                continue
            if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".md"}:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            orig = text
            for a, b in REPLACEMENTS:
                text = text.replace(a, b)
            if text != orig:
                path.write_text(text, encoding="utf-8")
                n += 1
    print(f"jrx-brand-scrub: patched_files={n}")


if __name__ == "__main__":
    main()
