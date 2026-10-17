#!/usr/bin/env python3
"""One-shot scrub: remove JRX/Jurexio/jrx-prod/JRX tokens from Jurexio active tree."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", "dist", ".git", "archive", "patches", "sdk-dist"}
TEXT_SUFFIX = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
    ".sh", ".sql", ".html", ".css", ".scss", ".env.example", ".txt",
}
SCAN = [
    ROOT / "src",
    ROOT / "client" / "src",
    ROOT / "packages",
    ROOT / "shared",
    ROOT / "tests",
    ROOT / "scripts",
    ROOT / "documents" / "working",
    ROOT / "config",
    ROOT / "examples",
    ROOT / ".github" / "workflows",
    ROOT / "drizzle",
]

REPLACEMENTS = [
    ("Jurexio™", "Jurexio"),
    ("Jurexio", "Jurexio"),
    ("jurexio-platform-312", "Jurexio-Platform-SDK"),
    ("jurexio.in", "jurexio.com"),
    ("nyayasiddhi.online", "jurexio.com"),
    ("/opt/Jurexio", "/opt/jurexio"),
    ("jrx-prod", "jrx-prod"),
    ("JRX SDK", "JRX SDK"),
    ("NYV_", "JRX_"),
    ("JRX", "JRX"),
    ("nyv-", "jrx-"),
    ("Nyv", "Jrx"),
    ("Nyayamitra™", "Jurexio Citizen"),
    ("Nyayamitra", "Jurexio Citizen"),
    ("nyayamitra", "jurexio-citizen"),
    ("NYS_", "JRX_ECOSYSTEM_"),
    ("NYS-", "JRX-"),
    ("/api/nys/", "/api/jrx/"),
    ("nyaya-tools", "jrx-legal-tools"),
    ("jurexio-", "jurexio-"),
]

WAI_RE = re.compile(r"\bWAI\b")


def should_skip(path: Path) -> bool:
    return any(p in SKIP for p in path.parts)


def patch_text(text: str) -> str:
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    text = re.sub(r"\bnv-", "jrx-", text)
    text = WAI_RE.sub("JRX", text)
    return text


def rename_nyv_files() -> int:
    count = 0
    for base in SCAN:
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*"), key=lambda p: len(p.parts), reverse=True):
            if should_skip(path) or not path.is_file():
                continue
            name = path.name
            new_name = name
            if name.startswith("nyv-"):
                new_name = "jrx-" + name[4:]
            elif name.startswith("Nyv"):
                new_name = "Jrx" + name[3:]
            elif "jurexio" in name.lower():
                new_name = re.sub("jurexio", "jurexio", name, flags=re.I)
            elif "nyayamitra" in name.lower():
                new_name = name.replace("nyayamitra", "jurexio-citizen")
            if new_name != name:
                dest = path.with_name(new_name)
                if not dest.exists():
                    path.rename(dest)
                    count += 1
    return count


def patch_files() -> int:
    count = 0
    for base in SCAN:
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if should_skip(path) or not path.is_file():
                continue
            if path.suffix not in TEXT_SUFFIX and path.name not in {
                "AGENTS.md", "README.md", "replit.md", "guardrails.md",
            }:
                continue
            if "documents/working/archive" in str(path):
                continue
            try:
                raw = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            patched = patch_text(raw)
            if patched != raw:
                path.write_text(patched, encoding="utf-8")
                count += 1
    for extra in [ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "replit.md", ROOT / "guardrails.md"]:
        if extra.is_file():
            raw = extra.read_text(encoding="utf-8")
            patched = patch_text(raw)
            if patched != raw:
                extra.write_text(patched, encoding="utf-8")
                count += 1
    return count


def main() -> None:
    n_renames = rename_nyv_files()
    n_patches = patch_files()
    print(f"renamed_files={n_renames} patched_files={n_patches}")


if __name__ == "__main__":
    main()
