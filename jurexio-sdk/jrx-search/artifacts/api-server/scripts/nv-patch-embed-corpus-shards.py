#!/usr/bin/env python3
"""Patch a live embed-corpus.mjs for dc scope + EMBED_SHARDS / EMBED_SHARD."""
from __future__ import annotations

import sys
from pathlib import Path

INSERT = r"""
const shardCount = Math.max(1, Math.min(16, Math.floor(Number(process.env.EMBED_SHARDS ?? "1") || 1)));
const shardIndex = Math.floor(Number(process.env.EMBED_SHARD ?? "0") || 0);
if (shardIndex < 0 || shardIndex >= shardCount) {
  logger.error({ shardIndex, shardCount }, "invalid EMBED_SHARD");
  process.exit(1);
}
const progressScope = shardCount > 1 ? `${scope}:s${shardIndex}of${shardCount}` : scope;
"""

SQL_OLD = "FROM judgments WHERE embedding IS NULL${scopeCond} AND id > $2 ORDER BY id LIMIT $1"
SQL_NEW = (
    "FROM judgments WHERE embedding IS NULL${scopeCond} AND id > $2"
    '${shardCount > 1 ? ` AND id % $3 = $4` : ""} ORDER BY id LIMIT $1'
)
PARAMS_OLD = "[Math.min(batchSize, maxRows - done), lastId]"
PARAMS_NEW = (
    "shardCount > 1 ? [Math.min(batchSize, maxRows - done), lastId, shardCount, shardIndex]"
    " : [Math.min(batchSize, maxRows - done), lastId]"
)


def patch(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    if '["all", "sc", "hc", "dc"]' not in text:
        if '["all", "sc", "hc"]' in text:
            text = text.replace('["all", "sc", "hc"]', '["all", "sc", "hc", "dc"]')
            text = text.replace("expected all|sc|hc", "expected all|sc|hc|dc")
            notes.append("scope_dc")
    if "EMBED_SHARDS" not in text:
        needle = 'if (!["all", "sc", "hc", "dc"].includes(scope))'
        if needle not in text:
            needle = 'if (!["all", "sc", "hc"].includes(scope))'
        idx = text.find(needle)
        if idx >= 0:
            end = text.find("process.exit(1);", idx)
            end = text.find("}", end)
            if end >= 0:
                text = text[: end + 1] + INSERT + text[end + 1 :]
                notes.append("shard_env")
        text = text.replace("[scope, done, totalEmbedded, lastId]", "[progressScope, done, totalEmbedded, lastId]")
        text = text.replace("WHERE scope = $1`,\n    [scope]", "WHERE scope = $1`,\n    [progressScope]")
        if SQL_OLD in text:
            text = text.replace(SQL_OLD, SQL_NEW)
            notes.append("shard_sql")
        if PARAMS_OLD in text:
            text = text.replace(PARAMS_OLD, PARAMS_NEW)
            notes.append("shard_params")
    else:
        notes.append("already_sharded")
    return text, notes


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/nyv/api/embed-corpus.mjs")
    original = path.read_text()
    updated, notes = patch(original)
    if updated != original:
        path.write_text(updated)
        print("PATCHED", ",".join(notes) or "changed")
    else:
        print("UNCHANGED", ",".join(notes) or "no-op")
    print("HAS_SHARDS", "EMBED_SHARDS" in updated)
    print("HAS_DC", '["all", "sc", "hc", "dc"]' in updated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
