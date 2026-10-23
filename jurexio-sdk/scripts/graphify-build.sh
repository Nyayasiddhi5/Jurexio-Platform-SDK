#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════════════"
echo "  Graphify — Jurexio Platform 3.1.2 Knowledge Graph"
echo "═══════════════════════════════════════════════════════════"

python3 << 'PYEOF'
from graphify.extract import collect_files, extract
from graphify.build import build
from graphify.cluster import cluster
from graphify.export import to_json, to_obsidian, to_graphml
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate as generate_report
from pathlib import Path
import json, os, networkx as nx

src_files = collect_files(Path('src'))
script_files = collect_files(Path('scripts'))
shared_files = collect_files(Path('shared'))
all_files = src_files + script_files + shared_files
print(f"  Files: {len(all_files)}")

result = extract(all_files)
print(f"  Nodes: {len(result.get('nodes',[]))}, Edges: {len(result.get('edges',[]))}")

G = build([result], directed=True)
print(f"  Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

communities = cluster(G)
print(f"  Communities: {len(communities)}")

god_node_list = god_nodes(G, top_n=15)
surprise_list = surprising_connections(G, communities, top_n=10)

community_labels = {}
for cid, members in communities.items():
    if members:
        top = sorted(members, key=lambda n: G.degree(n) if n in G else 0, reverse=True)[:3]
        community_labels[cid] = ' / '.join(top[:3])

suggested = suggest_questions(G, communities, community_labels, top_n=7)
cohesion_scores = {}
for cid, members in communities.items():
    sg = G.subgraph(members)
    cohesion_scores[cid] = nx.density(sg) if sg.number_of_nodes() > 1 else 1.0

out_dir = Path('graphify-out')
out_dir.mkdir(exist_ok=True)

to_json(G, communities, str(out_dir / 'graph.json'))
to_graphml(G, communities, str(out_dir / 'graph.graphml'))
to_obsidian(G, communities, str(out_dir / 'obsidian'))

total_words = sum(f.stat().st_size // 5 for f in all_files if f.exists())
raw_tokens = sum(f.stat().st_size for f in all_files if f.exists()) // 4
graph_tokens = G.number_of_nodes() * 10

detection_result = {
    'algorithm': 'leiden', 'num_communities': len(communities),
    'total_files': len(all_files), 'total_words': total_words,
    'total_nodes': G.number_of_nodes(), 'total_edges': G.number_of_edges(),
}
token_cost = {'graph_tokens': graph_tokens, 'raw_tokens': raw_tokens, 'reduction': raw_tokens / max(graph_tokens, 1)}

report = generate_report(G, communities, cohesion_scores, community_labels,
    god_node_list, surprise_list, detection_result, token_cost,
    root=str(Path('.').resolve()), suggested_questions=suggested)
(out_dir / 'GRAPH_REPORT.md').write_text(report)

reduction = token_cost['reduction']
print(f"\n  Token reduction: {reduction:.1f}x ({raw_tokens:,} → {graph_tokens:,})")
print(f"  Output: graphify-out/")
print(f"    graph.json      ({os.path.getsize(out_dir / 'graph.json') / 1024:.0f} KB)")
print(f"    graph.graphml   ({os.path.getsize(out_dir / 'graph.graphml') / 1024:.0f} KB)")
print(f"    GRAPH_REPORT.md ({len(report):,} chars)")
obs_count = len(list((out_dir / 'obsidian').rglob('*.md')))
print(f"    obsidian/       ({obs_count} files)")
PYEOF

echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Done! Query with: graphify query \"your question\""
echo "═══════════════════════════════════════════════════════════"
