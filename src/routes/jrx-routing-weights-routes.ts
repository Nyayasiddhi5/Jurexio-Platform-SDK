import { Router, Request, Response } from 'express';
import { hierarchicalTaskAllocator } from '../services/hierarchical-task-allocator.js';
import { agentPerformanceTracker } from '../services/agent-performance-tracker.js';
import { getAllAgents } from '../services/agent-registry-service.js';

const router = Router();

/* ──────────────────────────────────────────────────────────────────────────
 * JRX-ROUTING-DASHBOARD-001 (Task #69): admin-facing HTML view of the live
 * routing weights produced by the hierarchical task allocator.
 *
 *   GET /api/jrx/admin/routing-weights
 *     ?capability=legal-research      (optional)
 *     &jurisdiction=IN                (optional)
 *     &preferredTier=2                (optional, 1..5)
 *     &limit=25                       (optional, 1..200)
 *
 * Server-side renders the same data the JSON endpoint at
 * `GET /api/jrx/routing/weights` exposes, so ops can answer
 * "why is the router avoiding agent X?" without curling the API.
 *
 * Auth: mounted behind `authenticateToken` + `requireAdmin` in `index.ts`
 * because it leaks the same live agent telemetry as the protected JSON
 * route. Do NOT mount this router on a public path.
 *
 * Saturated and degraded candidates are visually called out:
 *   - SATURATED:  concurrencyPenalty <= 0.25 (≥ 6/8 in-flight on the agent)
 *   - DEGRADED:   successRate < 0.70  OR  latencyFactor < 0.30
 * ────────────────────────────────────────────────────────────────────────── */

const SATURATED_THRESHOLD = 0.25;
const DEGRADED_SUCCESS_RATE = 0.7;
const DEGRADED_LATENCY_FACTOR = 0.3;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseBoundedInt(raw: unknown, lo: number, hi: number): number | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  return Math.max(lo, Math.min(hi, i));
}

function bar(value: number, color: string): string {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `
    <div class="meter" title="${pct}%">
      <div class="meter-fill" style="width:${pct}%;background:${color};"></div>
      <span class="meter-label">${value.toFixed(2)}</span>
    </div>
  `;
}

router.get('/', (req: Request, res: Response) => {
  try {
    const capability = typeof req.query.capability === 'string' ? req.query.capability.trim() : '';
    const jurisdiction = typeof req.query.jurisdiction === 'string' ? req.query.jurisdiction.trim() : '';
    const preferredTier = parseBoundedInt(req.query.preferredTier, 1, 5);
    const limit = parseBoundedInt(req.query.limit, 1, 200) ?? 25;

    const weights = hierarchicalTaskAllocator.getRoutingWeights(
      {
        capability: capability || undefined,
        jurisdiction: jurisdiction || undefined,
        preferredTier,
      },
      limit,
    );

    const stats = agentPerformanceTracker.listAll();
    const summary = {
      trackedAgents: stats.length,
      totalActiveExecutions: stats.reduce((s, x) => s + x.activeConcurrency, 0),
      avgSuccessRate: stats.length === 0
        ? null
        : (stats.reduce((s, x) => s + x.successRate, 0) / stats.length),
      avgP95LatencyMs: stats.length === 0
        ? null
        : Math.round(stats.reduce((s, x) => s + x.p95LatencyMs, 0) / stats.length),
    };

    // Distinct capability + jurisdiction lists for the datalist hints. Cheap
    // because the registry is in-memory and small.
    const allAgents = getAllAgents();
    const capSet = new Set<string>();
    const jurSet = new Set<string>();
    for (const a of allAgents) {
      for (const c of a.capabilities || []) capSet.add(c);
      for (const j of a.jurisdictions || []) jurSet.add(j);
    }
    const capOptions = Array.from(capSet).sort().slice(0, 200);
    const jurOptions = Array.from(jurSet).sort().slice(0, 200);

    const saturatedCount = weights.filter(w => w.concurrencyPenalty <= SATURATED_THRESHOLD).length;
    const degradedCount = weights.filter(
      w => w.successRate < DEGRADED_SUCCESS_RATE || w.latencyFactor < DEGRADED_LATENCY_FACTOR,
    ).length;

    const rows = weights.map((w, idx) => {
      const isSaturated = w.concurrencyPenalty <= SATURATED_THRESHOLD;
      const isDegraded = w.successRate < DEGRADED_SUCCESS_RATE || w.latencyFactor < DEGRADED_LATENCY_FACTOR;
      const flagBadges: string[] = [];
      if (isSaturated) flagBadges.push('<span class="flag flag-sat">SATURATED</span>');
      if (isDegraded) flagBadges.push('<span class="flag flag-deg">DEGRADED</span>');
      if (w.jurisdictionMatch === 1) flagBadges.push('<span class="flag flag-ok">JUR MATCH</span>');
      const rowClass = isSaturated ? 'row-sat' : isDegraded ? 'row-deg' : '';
      return `
        <tr class="${rowClass}">
          <td class="rank">${idx + 1}</td>
          <td class="agent-cell">
            <div class="agent-id">${escapeHtml(w.agentId)}</div>
            <div class="agent-meta">tier ${escapeHtml(w.tier)} ${flagBadges.join(' ')}</div>
          </td>
          <td class="composite">${w.composite.toFixed(4)}</td>
          <td>${bar(w.jurisdictionMatch, '#34d399')}</td>
          <td>${bar(w.tierProximity, '#60a5fa')}</td>
          <td>${bar(w.successRate, '#34d399')}</td>
          <td>${bar(w.latencyFactor, '#e5cb63')}</td>
          <td>${bar(w.concurrencyPenalty, isSaturated ? '#f87171' : '#a78bfa')}</td>
          <td>${bar(w.jurisdictionOutcome, '#60a5fa')}</td>
        </tr>
      `;
    }).join('');

    const fmtPct = (v: number | null) => v === null ? '—' : (v * 100).toFixed(1) + '%';
    const fmtMs = (v: number | null) => v === null ? '—' : `${v}ms`;

    const capDatalist = capOptions.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    const jurDatalist = jurOptions.map(j => `<option value="${escapeHtml(j)}"></option>`).join('');

    const tierOptions = [1, 2, 3, 4, 5].map(t =>
      `<option value="${t}"${preferredTier === t ? ' selected' : ''}>L${t}</option>`,
    ).join('');

    // Build the refresh-link query from the *validated* params, not from the
    // raw request URL — keeps untrusted client input out of the rendered href.
    const refreshParts = [
      capability ? `capability=${encodeURIComponent(capability)}` : '',
      jurisdiction ? `jurisdiction=${encodeURIComponent(jurisdiction)}` : '',
      preferredTier ? `preferredTier=${preferredTier}` : '',
      `limit=${limit}`,
    ].filter(Boolean);
    const refreshQuery = refreshParts.length ? `?${refreshParts.join('&amp;')}` : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NV Core — Live Routing Weights</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #0a1628; color: #e2e8f0; min-height: 100vh; }
    a { color: #60a5fa; text-decoration: none; }
    .header { background: linear-gradient(135deg, #0b3159, #1a4a7a); padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1e3a5f; }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-icon { width: 36px; height: 36px; background: linear-gradient(135deg, #e5cb63, #f0d875); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .header-title { font-size: 18px; font-weight: 700; color: #fff; }
    .header-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .header-links { display: flex; gap: 16px; }
    .header-link { font-size: 13px; color: #60a5fa; padding: 6px 14px; border: 1px solid #1e3a5f; border-radius: 6px; }
    .header-link:hover { background: #1e3a5f; }
    .main { max-width: 1400px; margin: 0 auto; padding: 32px; }
    .section-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 16px; }
    .filter-card { background: #0f2040; border: 1px solid #1e3a5f; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .filter-row { display: grid; grid-template-columns: repeat(5, 1fr) auto; gap: 14px; align-items: end; }
    .filter-field label { display: block; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .filter-field input, .filter-field select { width: 100%; background: #0a1628; color: #e2e8f0; border: 1px solid #1e3a5f; border-radius: 6px; padding: 9px 10px; font-size: 13px; font-family: inherit; }
    .filter-field input:focus, .filter-field select:focus { outline: none; border-color: #60a5fa; }
    .filter-actions { display: flex; gap: 8px; }
    .btn { background: #1e3a5f; color: #e2e8f0; border: 1px solid #2a4d7d; border-radius: 6px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .btn:hover { background: #2a4d7d; }
    .btn-primary { background: linear-gradient(135deg, #1a6abf, #0b3159); border-color: #1a6abf; }
    .btn-primary:hover { background: linear-gradient(135deg, #1e7adb, #0d3d6b); }

    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 28px; }
    .kpi-card { background: #0f2040; border: 1px solid #1e3a5f; border-radius: 12px; padding: 18px; }
    .kpi-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .kpi-value { font-size: 24px; font-weight: 700; color: #e2e8f0; }
    .kpi-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
    .kpi-card.warn .kpi-value { color: #f87171; }
    .kpi-card.gold .kpi-value { color: #e5cb63; }
    .kpi-card.success .kpi-value { color: #34d399; }
    .kpi-card.blue .kpi-value { color: #60a5fa; }

    .card { background: #0f2040; border: 1px solid #1e3a5f; border-radius: 12px; padding: 20px; }
    .card-title { font-size: 14px; font-weight: 700; color: #e2e8f0; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
    .card-sub { font-size: 12px; color: #64748b; font-weight: 400; }

    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 0 10px 10px; letter-spacing: 0.5px; white-space: nowrap; }
    th:first-child { padding-left: 0; }
    td { padding: 12px 10px; border-top: 1px solid #1e3a5f; font-size: 13px; color: #cbd5e1; vertical-align: middle; }
    td:first-child { padding-left: 0; }
    tr.row-sat { background: rgba(248, 113, 113, 0.06); }
    tr.row-deg { background: rgba(245, 158, 11, 0.05); }
    .rank { font-family: monospace; color: #64748b; font-weight: 600; width: 36px; }
    .agent-cell { min-width: 220px; }
    .agent-id { font-family: monospace; font-size: 13px; color: #e2e8f0; font-weight: 600; }
    .agent-meta { font-size: 11px; color: #64748b; margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .composite { font-family: monospace; font-weight: 700; color: #e5cb63; font-size: 14px; min-width: 80px; }

    .meter { position: relative; background: #0a1628; border-radius: 4px; height: 18px; min-width: 90px; overflow: hidden; }
    .meter-fill { height: 100%; border-radius: 4px; opacity: 0.85; transition: width 0.2s; }
    .meter-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-family: monospace; color: #fff; font-weight: 600; text-shadow: 0 0 2px rgba(0,0,0,0.6); }

    .flag { display: inline-block; padding: 1px 7px; border-radius: 100px; font-size: 9px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
    .flag-sat { background: #7f1d1d; color: #fecaca; }
    .flag-deg { background: #78350f; color: #fde68a; }
    .flag-ok { background: #064e3b; color: #6ee7b7; }

    .legend { display: flex; gap: 20px; margin-top: 14px; font-size: 11px; color: #64748b; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-swatch { width: 10px; height: 10px; border-radius: 2px; }

    .empty-state { text-align: center; color: #64748b; padding: 40px 0; font-size: 14px; }
    .timestamp { font-size: 11px; color: #64748b; text-align: right; margin-top: 24px; }
    .formula { background: #0a1628; border: 1px solid #1e3a5f; border-radius: 6px; padding: 12px 14px; font-family: monospace; font-size: 11px; color: #94a3b8; margin-top: 14px; line-height: 1.6; }
    @media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } .filter-row { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .main { padding: 16px; } .kpi-grid { grid-template-columns: 1fr; } .filter-row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <div class="header-icon">🧭</div>
      <div>
        <div class="header-title">Jurexio Core — Live Routing Weights</div>
        <div class="header-sub">Why the hierarchical allocator picks the agents it does — right now</div>
      </div>
    </div>
    <div class="header-links">
      <a class="header-link" href="/api/jrx/token-metrics">Token Metrics</a>
      <a class="header-link" href="/api/docs">Swagger UI</a>
      <a class="header-link" href="/api/jrx/routing/weights${capability || jurisdiction || preferredTier ? '?' : ''}${[
        capability ? `capability=${encodeURIComponent(capability)}` : '',
        jurisdiction ? `jurisdiction=${encodeURIComponent(jurisdiction)}` : '',
        preferredTier ? `preferredTier=${preferredTier}` : '',
      ].filter(Boolean).join('&amp;')}">Raw JSON</a>
    </div>
  </div>

  <div class="main">
    <div class="filter-card">
      <div class="section-title">Filter the candidate pool</div>
      <form method="GET" action="/api/jrx/admin/routing-weights">
        <div class="filter-row">
          <div class="filter-field">
            <label for="capability">Capability</label>
            <input id="capability" name="capability" list="cap-list" value="${escapeHtml(capability)}" placeholder="e.g. legal-research" autocomplete="off" />
            <datalist id="cap-list">${capDatalist}</datalist>
          </div>
          <div class="filter-field">
            <label for="jurisdiction">Jurisdiction</label>
            <input id="jurisdiction" name="jurisdiction" list="jur-list" value="${escapeHtml(jurisdiction)}" placeholder="e.g. India" autocomplete="off" />
            <datalist id="jur-list">${jurDatalist}</datalist>
          </div>
          <div class="filter-field">
            <label for="preferredTier">Preferred Tier</label>
            <select id="preferredTier" name="preferredTier">
              <option value="">— any —</option>
              ${tierOptions}
            </select>
          </div>
          <div class="filter-field">
            <label for="limit">Limit</label>
            <input id="limit" name="limit" type="number" min="1" max="200" value="${limit}" />
          </div>
          <div class="filter-field">
            <label>&nbsp;</label>
            <div class="filter-actions">
              <button class="btn btn-primary" type="submit">Apply</button>
              <a class="btn" href="/api/jrx/admin/routing-weights">Reset</a>
            </div>
          </div>
        </div>
      </form>
    </div>

    <div class="section-title">Snapshot — across all tracked agents</div>
    <div class="kpi-grid">
      <div class="kpi-card blue">
        <div class="kpi-label">Candidates Returned</div>
        <div class="kpi-value">${weights.length}</div>
        <div class="kpi-sub">limit ${limit}</div>
      </div>
      <div class="kpi-card warn">
        <div class="kpi-label">Saturated Now</div>
        <div class="kpi-value">${saturatedCount}</div>
        <div class="kpi-sub">≥ 6 in-flight on agent</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-label">Degraded Now</div>
        <div class="kpi-value">${degradedCount}</div>
        <div class="kpi-sub">success &lt; 70% or slow tail</div>
      </div>
      <div class="kpi-card success">
        <div class="kpi-label">Avg Success Rate</div>
        <div class="kpi-value">${fmtPct(summary.avgSuccessRate)}</div>
        <div class="kpi-sub">${summary.trackedAgents} tracked agents</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg P95 Latency</div>
        <div class="kpi-value">${fmtMs(summary.avgP95LatencyMs)}</div>
        <div class="kpi-sub">${summary.totalActiveExecutions} active calls</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        🎯 Ranked Candidates
        <span class="card-sub">filter: capability=${escapeHtml(capability || 'any')} · jurisdiction=${escapeHtml(jurisdiction || 'any')} · tier=${preferredTier ? `L${preferredTier}` : 'any'}</span>
      </div>
      ${weights.length === 0
        ? '<div class="empty-state">No candidates matched this filter.<br/>Try clearing capability or jurisdiction.</div>'
        : `<table>
            <thead>
              <tr>
                <th>#</th>
                <th>Agent</th>
                <th>Composite</th>
                <th>Jur Match</th>
                <th>Tier Prox</th>
                <th>Success</th>
                <th>Latency</th>
                <th>Concurrency</th>
                <th>Jur Outcome</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
      }
      <div class="legend">
        <div class="legend-item"><span class="flag flag-sat">SATURATED</span> agent is at or near concurrency cap</div>
        <div class="legend-item"><span class="flag flag-deg">DEGRADED</span> low success rate or slow tail latency</div>
        <div class="legend-item"><span class="flag flag-ok">JUR MATCH</span> agent registered for this jurisdiction</div>
      </div>
      <div class="formula">
        composite = 0.25·jurMatch + 0.15·tierProx + 0.25·successRate + 0.10·latencyFactor + 0.10·concurrencyPenalty + 0.15·jurOutcome
      </div>
    </div>

    <div class="timestamp">Last refreshed: ${new Date().toISOString()} · <a href="/api/jrx/admin/routing-weights${refreshQuery}">Refresh</a></div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err: any) {
    res.status(500).send(`<pre>Error: ${escapeHtml((err as Error).message)}</pre>`);
  }
});

export default router;
