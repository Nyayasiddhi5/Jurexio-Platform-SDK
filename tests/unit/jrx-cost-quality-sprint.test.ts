/**
 * NYV cost + quality sprint (2026-08-18) — regression guards.
 *
 * Each block below pins a behaviour that was MEASURED to be broken, so a future refactor
 * cannot quietly restore the defect. The measurements are named in each test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');

/**
 * Read a file with comments stripped.
 *
 * These fixes are documented by comments that quote the OLD broken form verbatim ("it
 * previously ran `db.execute(sql.raw(sqlText))`…"), so a whole-file `not.toContain` matches
 * the explanation and fails on correct code. Assert against CODE only. This is the same
 * class of false positive that an earlier guard hit when it flagged its own comment.
 */
const readCode = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');       // line comments

describe('NV-PERSIST-UPSERT-001 — upsertRow must bind parameters', () => {
  const src = readCode('src/services/persistence/jrx-persistence-helper.ts');

  it('does not run an unparameterised sql.raw before the real query', () => {
    /*
     * The original ran `db.execute(sql.raw(sqlText))` with `$1..$n` unbound. Postgres
     * rejects that ("there is no parameter $1" — verified live), its own catch swallowed the
     * error, and `pool.query` was never reached. Both openbot tables held 0 rows.
     */
    expect(src).not.toContain('db.execute(sql.raw(sqlText)');
  });

  it('still uses the parameter-binding pool query', () => {
    expect(src).toContain('query(sqlText, params)');
  });

  it('builds one placeholder per column', () => {
    expect(src).toContain('cols.map((_, i) => `$${i + 1}`)');
  });
});

describe('NV-GRAPH-MEMORY-DURABLE-001 — the graph tier must persist', () => {
  const src = readCode('src/services/memory/graph-memory-service.ts');

  it('writes through on addMemory', () => {
    expect(src).toContain('void this.persistNode(node)');
  });

  it('targets memory_entries, not the integer-keyed knowledge_graph tables', () => {
    // knowledge_graph_entities keys on `integer`; these nodes are uuid strings.
    expect(src).toContain("'nv_schema.memory_entries'");
    expect(src).not.toContain('nv_schema.knowledge_graph_entities');
  });

  it('exposes boot hydration and rebuilds the scope indexes', () => {
    expect(src).toContain('async hydrateFromDb(');
    // A hydrated node absent from these maps is invisible to scoped recall.
    expect(src).toContain('this.userGraphs.set(');
    expect(src).toContain('this.sessionGraphs.set(');
  });

  it('hydration is wired into platform startup', () => {
    const startup = read('src/startup/jrx-start-platform-jobs.ts');
    expect(startup).toContain('hydrateFromDb()');
  });
});

describe('NV-DEPLOY-DRAIN-001 — SIGTERM must drain, not just stop jobs', () => {
  const src = read('src/index.ts');

  it('closes the HTTP server on shutdown', () => {
    expect(src).toContain('srv.close(');
  });

  it('flips readiness before draining', () => {
    expect(src).toContain('setPlatformDraining(true)');
  });

  it('force-closes keep-alive sockets when the grace period expires', () => {
    // server.close() alone hangs indefinitely on keep-alive connections.
    expect(src).toContain('closeAllConnections');
  });

  it('readiness reports 503 while draining without waiting on probes', () => {
    const health = read('src/routes/jrx-health-full-routes.ts');
    expect(health).toContain('isPlatformDraining()');
    expect(health).toContain('draining: true');
  });
});

describe('NV-RAG-MMR-001 — diversity must be applied on the retrieval path', () => {
  const src = readCode('src/services/jrx-auto-rag-router.ts');

  it('calls applyMMR after the cross-encoder rerank', () => {
    expect(src).toContain('nvLegalRerankerService.applyMMR(');
  });

  it('does NOT call rerankResults, which would fuse a second time', () => {
    // rerankResults runs its own RRF over a bm25/vector split; this path is pre-fused.
    expect(src).not.toContain('rerankResults(');
  });

  it('reports mmr in retrievalMethods so the effect is observable', () => {
    expect(src).toContain("'mmr:diversity'");
  });
});

describe('NV-QUEEN-LEAF-BUDGET-ENFORCE-001 — the ceiling must bite on exploration leaves', () => {
  const src = read('src/orchestration/jrx-queen-leaf-prompt.ts');

  it('trims only exploration leaves, never the synthesis leg', () => {
    /*
     * 8 of 9 live hops logged overBudget:true (cap=8000 assembled=11069). Synthesis authors
     * the user-visible answer, so trimming it is a quality change needing the legal eval.
     */
    expect(src).toContain("policy.role === 'exploration'");
    expect(src).toContain('exploration brief truncated to budget');
  });

  it('is reversible by env', () => {
    expect(src).toContain('NYV_QUEEN_LEAF_BUDGET_ENFORCE');
  });

  it('recomputes tokens after trimming so overBudget is not stale', () => {
    expect(src).toContain('let systemPromptTokens');
  });
});

describe('NV-GEMINI-CACHE-001 — implicit cache must be observed, not double-counted', () => {
  const src = readCode('src/services/intelligent-router/llm-orchestrator.ts');

  it('reads cachedContentTokenCount', () => {
    expect(src).toContain('cachedContentTokenCount');
  });

  it('does not add cached tokens to tokensIn (promptTokenCount already includes them)', () => {
    expect(src).not.toContain('promptTokenCount ?? 0) + (json.usageMetadata?.cachedContentTokenCount');
  });
});

describe('NV-PLATFORM-CAPABILITY-PROMPT-001 — the model must be told what it stands on', () => {
  const src = read('src/services/jrx-legal-intelligence-overlay.ts');

  it('names the capability classes it can rely on', () => {
    expect(src).toContain('verified statute mapping');
  });

  it('forbids inventing citations explicitly', () => {
    expect(src.toLowerCase()).toContain('never invent a case name');
  });

  it('warns that a section number can exist in both codes', () => {
    // The BNS-138-vs-NI-138 error class NSP reported.
    expect(src).toContain('exists in both codes');
  });

  it('is present in the compact tier too', () => {
    // A cheap hop that hallucinates is worse than one costing ~90 more tokens.
    expect(src).toContain('GROUNDING DISCIPLINE');
  });
});

describe('NV-COMPARE-SLUG-ALIAS-001 — partner slug names must resolve', () => {
  const src = read('src/routes/jrx-knowledge-plane-routes.ts');

  it('aliases the reverse-mapping names partners actually send', () => {
    // Verified live: bns-ipc / new-to-old / bnss-crpc / bsa-iea all 404'd on NYS.
    for (const slug of ['bns-ipc', 'new-to-old', 'bnss-crpc', 'bsa-iea']) {
      expect(src).toContain(`'${slug}'`);
    }
  });

  it('maps them to the slug NYS actually implements', () => {
    expect(src).toContain("'new-old'");
  });

  it('infers `from` when the slug names the source code', () => {
    expect(src).toContain("'bnss-crpc': 'BNSS'");
  });

  it('passes unknown slugs through unchanged', () => {
    expect(src).toContain('COMPARE_SLUG_ALIASES[key] ?? key');
  });
});
