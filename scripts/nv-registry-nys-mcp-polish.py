#!/usr/bin/env python3
"""Add nys_* MCP tools to research-capable agents in format-b registries.

Does NOT rewrite full systemPrompt blobs (Queen/Auto-RAG already inject retrieval policy).
Updates mcpToolsAllowed metadata so explicit MCP invoke lists NYS tools.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REG_DIR = ROOT / "config" / "agent-registries"

NYS_TOOLS = [
    "nys_search_caselaw",
    "nys_search_statutes",
    "nys_get_statute",
    "nys_compare_ipc_bns",
    "nys_retrieve",
    "nys_check_citations",
    "nys_perform_legal_work",
    "nys_chat_action",
    "nys_athena_search",
]

TRIGGER = {
    "legal-research",
    "statute-verification",
    "citation-formatter",
    "matter-manager",
}

RETRIEVAL_MARK = "SECTION 0 — RETRIEVAL POLICY"
RETRIEVAL_SNIPPET = """
<section_retrieval_policy>
§ RETRIEVAL POLICY (MANDATORY)
1) NYS Knowledge Plane FIRST — statutes, caselaw, retrieve, Athena (prefer nys_* tools / Auto-RAG nys_global).
2) Tenant RAG / org knowledge base SECOND.
3) Matter memory THIRD (NYV L1–L5).
4) LLM LAST — synthesize only from retrieved context; never invent citations.
Never claim SCC Online / live eCourts scrape unless those tools returned hits.
</section_retrieval_policy>
""".strip()


def should_patch(agent: dict) -> bool:
    mt = set(agent.get("mcpToolsAllowed") or [])
    if mt & TRIGGER:
        return True
    name = (agent.get("name") or "").lower()
    group = (agent.get("group") or "").lower()
    return any(x in name or x in group for x in ("queen", "research", "rag", "statute", "caselaw"))


def patch_file(path: Path) -> tuple[int, int]:
    data = json.loads(path.read_text())
    agents = data.get("agents") or []
    touched_mcp = 0
    touched_prompt = 0
    for a in agents:
        if not should_patch(a):
            continue
        mt = list(a.get("mcpToolsAllowed") or [])
        before = len(mt)
        for t in NYS_TOOLS:
            if t not in mt:
                mt.append(t)
        if len(mt) != before:
            a["mcpToolsAllowed"] = mt
            touched_mcp += 1
        sp = a.get("systemPrompt") or ""
        if isinstance(sp, str) and sp and RETRIEVAL_MARK not in sp and "<section_0_security_constitution>" in sp:
            # Insert after security constitution open block — append before end for safety
            a["systemPrompt"] = sp.rstrip() + "\n\n" + RETRIEVAL_SNIPPET + "\n"
            touched_prompt += 1
    data["sdkVersion"] = "NYV-SDK-v5.0.0"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return touched_mcp, touched_prompt


def main() -> None:
    files = sorted(REG_DIR.glob("Nyayavigya-Legal-registry-*.json"))
    files = [f for f in files if "archive" not in str(f)]
    for f in files:
        m, p = patch_file(f)
        print(f"{f.name}: mcp+={m} prompt+={p}")


if __name__ == "__main__":
    main()
