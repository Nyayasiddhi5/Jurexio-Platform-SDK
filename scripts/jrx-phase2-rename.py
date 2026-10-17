#!/usr/bin/env python3
"""
JRX-PHASE2-RENAME — mechanical nv-* → jrx-* file renames + import path updates (Jurexio repo only).
Run from repo root: python3 scripts/jrx-phase2-rename.py
"""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIR_NAMES = {
    "node_modules",
    "dist",
    ".git",
    "archive",
    "patches",
    "sdk-dist",
}
SCAN_ROOTS = [
    ROOT / "src",
    ROOT / "tests",
    ROOT / "client" / "src",
    ROOT / "scripts",
    ROOT / "shared",
    ROOT / "startup",
    ROOT / "orchestration",
    ROOT / "eslint-rules",
    ROOT / "e2e",
]

IMPORT_NV = re.compile(r"(['\"])([^'\"]*)/nv-")
IMPORT_NV2 = re.compile(r"(['\"])\.?/?nv-")


def should_skip(path: Path) -> bool:
    return any(part in SKIP_DIR_NAMES for part in path.parts)


def rename_nv_files() -> int:
    count = 0
    for base in SCAN_ROOTS:
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("nv-*")):
            if should_skip(path) or not path.is_file():
                continue
            if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
                continue
            new_name = "jrx-" + path.name[3:]
            dest = path.with_name(new_name)
            if dest.exists():
                continue
            path.rename(dest)
            count += 1
    return count


def patch_file_text(text: str) -> str:
    text = text.replace("/api/nv/", "/api/jrx/")
    text = text.replace("'/api/nv'", "'/api/jrx'")
    text = text.replace('"/api/nv"', '"/api/jrx"')
    text = IMPORT_NV.sub(r"\1\2/jrx-", text)
    text = IMPORT_NV2.sub(r"\1./jrx-", text)
    text = text.replace("/nv-", "/jrx-")
    text = text.replace("nv-agents-registry", "jrx-agents-registry")
    text = text.replace("NYS-Agentic-AI", "jrx-search")
    return text


def patch_sources() -> int:
    count = 0
    for base in [ROOT, *SCAN_ROOTS]:
        if base == ROOT:
            files = [ROOT / "src" / "index.ts", ROOT / "package.json", ROOT / "vite.config.ts"]
        elif not base.is_dir():
            continue
        else:
            files = [
                p
                for p in base.rglob("*")
                if p.is_file()
                and p.suffix in {".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".yml", ".yaml", ".sh"}
                and not should_skip(p)
            ]
        for path in files:
            try:
                raw = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            patched = patch_file_text(raw)
            if patched != raw:
                path.write_text(patched, encoding="utf-8")
                count += 1
    return count


def copy_agents_registry() -> None:
    src = ROOT / "src" / "data" / "nv-agents-registry.json"
    if not src.is_file():
        src = ROOT / "src" / "data" / "jrx-agents-registry.json"
        return
    dest = ROOT / "src" / "data" / "jrx-agents-registry.json"
    if dest.exists():
        return
    text = src.read_text(encoding="utf-8")
    text = text.replace("Nyayavigya SDK", "Jurexio Enterprise Platform SDK")
    text = text.replace("Nyayavigya", "Jurexio")
    text = text.replace("Nyayasiddhi", "Jurexio")
    text = text.replace("jurexioModule", "jrxModule")
    dest.write_text(text, encoding="utf-8")


def main() -> None:
    os.chdir(ROOT)
    n_files = rename_nv_files()
    n_patches = patch_sources()
    copy_agents_registry()
    print(f"jrx-phase2-rename: renamed_files={n_files} patched_files={n_patches}")


if __name__ == "__main__":
    main()
