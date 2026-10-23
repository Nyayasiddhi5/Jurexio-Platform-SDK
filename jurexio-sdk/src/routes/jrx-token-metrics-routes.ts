// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { pool as _raw_pool } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
const pool = lazyRequire(() => _raw_pool, 'pool');
const router = Router();

// NV-RBAC-GAP-001: this HTML dashboard renders cross-org token/cost usage — it
// must not be world-readable. Gate behind auth + analyst (hierarchy-aware), so
// only analyst/manager/org_admin/super_admin can view aggregate spend.
/* ── GET /api/token-metrics — HTML Dashboard ─────────────────────────────── */
router.get('/', authenticateToken, requireRole('analyst'), async (_req: Request, res: Response) => {
  try {
    const client = await pool.connect();
    let stats: any = {};
    let byAgent: any[] = [];
    let byDay: any[] = [];
    let byModel: any[] = [];

    try {
      const statsRes = await client.query(`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS total_tokens,
          COALESCE(SUM(tokens_in), 0)::bigint AS prompt_tokens,
          COALESCE(SUM(tokens_out), 0)::bigint AS completion_tokens,
          0::int AS avg_latency_ms,
          0::int AS min_latency_ms,
          0::int AS max_latency_ms,
          COUNT(*)::int AS success_count,
          0::int AS error_count
        FROM nv_token_metrics
        WHERE recorded_at > NOW() - INTERVAL '30 days'
      `);
      stats = statsRes.rows[0] || {};

      const agentRes = await client.query(`
        SELECT agent_id AS agent_key, COUNT(*)::int AS requests,
          COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS tokens,
          0::int AS avg_latency
        FROM nv_token_metrics
        WHERE recorded_at > NOW() - INTERVAL '30 days'
        GROUP BY agent_id
        ORDER BY requests DESC
        LIMIT 10
      `);
      byAgent = agentRes.rows;

      const dayRes = await client.query(`
        SELECT DATE(recorded_at) AS day,
          COUNT(*)::int AS requests,
          COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS tokens
        FROM nv_token_metrics
        WHERE recorded_at > NOW() - INTERVAL '14 days'
        GROUP BY DATE(recorded_at)
        ORDER BY day ASC
      `);
      byDay = dayRes.rows;

      const modelRes = await client.query(`
        SELECT model_id AS model, COUNT(*)::int AS requests,
          COALESCE(SUM(tokens_in + tokens_out), 0)::bigint AS tokens
        FROM nv_token_metrics
        WHERE recorded_at > NOW() - INTERVAL '30 days'
        GROUP BY model_id
        ORDER BY requests DESC
        LIMIT 8
      `);
      byModel = modelRes.rows;
    } finally {
      client.release();
    }

    const successRate = stats.total_requests > 0
      ? ((stats.success_count / stats.total_requests) * 100).toFixed(1)
      : '100.0';

    const fmtNum = (n: any) => {
      const v = Number(n) || 0;
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
      if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
      return String(v);
    };

    const agentRows = byAgent.map(a => `
      <tr>
        <td><span class="agent-badge">${a.agent_key || 'unknown'}</span></td>
        <td>${fmtNum(a.requests)}</td>
        <td>${fmtNum(a.tokens)}</td>
        <td>${a.avg_latency}ms</td>
      </tr>
    `).join('');

    const modelRows = byModel.map(m => `
      <tr>
        <td><span class="model-name">${m.model || 'unknown'}</span></td>
        <td>${fmtNum(m.requests)}</td>
        <td>${fmtNum(m.tokens)}</td>
      </tr>
    `).join('');

    const maxDayTokens = Math.max(...byDay.map((d: any) => Number(d.tokens) || 0), 1);
    const dayBars = byDay.map((d: any) => {
      const pct = Math.max(4, Math.round((Number(d.tokens) / maxDayTokens) * 100));
      const label = String(d.day).substring(5);
      return `
        <div class="bar-group">
          <div class="bar" style="height:${pct}%" title="${fmtNum(d.tokens)} tokens on ${d.day}"></div>
          <div class="bar-label">${label}</div>
        </div>
      `;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NV Core — Token Metering Dashboard</title>
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
    .main { max-width: 1200px; margin: 0 auto; padding: 32px; }
    .section-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 16px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .kpi-card { background: #0f2040; border: 1px solid #1e3a5f; border-radius: 12px; padding: 20px; }
    .kpi-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .kpi-value { font-size: 28px; font-weight: 700; color: #e2e8f0; margin-bottom: 4px; }
    .kpi-sub { font-size: 12px; color: #64748b; }
    .kpi-card.success .kpi-value { color: #34d399; }
    .kpi-card.gold .kpi-value { color: #e5cb63; }
    .kpi-card.blue .kpi-value { color: #60a5fa; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
    .card { background: #0f2040; border: 1px solid #1e3a5f; border-radius: 12px; padding: 24px; }
    .card-title { font-size: 14px; font-weight: 700; color: #e2e8f0; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 0 0 10px; letter-spacing: 0.5px; }
    td { padding: 10px 0; border-top: 1px solid #1e3a5f; font-size: 13px; color: #cbd5e1; }
    .agent-badge { background: #1e3a5f; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; font-weight: 600; }
    .model-name { font-family: monospace; font-size: 12px; color: #94a3b8; }
    .chart-area { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin-top: 8px; }
    .bar-group { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; }
    .bar { width: 100%; background: linear-gradient(to top, #0b3159, #1a6abf); border-radius: 3px 3px 0 0; min-height: 4px; transition: opacity 0.2s; }
    .bar:hover { opacity: 0.8; }
    .bar-label { font-size: 9px; color: #64748b; margin-top: 4px; }
    .empty-state { text-align: center; color: #64748b; padding: 40px 0; font-size: 14px; }
    .badge-ok { background: #065f46; color: #34d399; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 600; }
    .timestamp { font-size: 11px; color: #64748b; text-align: right; margin-top: 24px; }
    @media (max-width: 768px) { .kpi-grid { grid-template-columns: 1fr 1fr; } .grid-2 { grid-template-columns: 1fr; } .main { padding: 16px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <div class="header-icon">⚡</div>
      <div>
        <div class="header-title">Jurexio Core — Token Metering</div>
        <div class="header-sub">Model performance & usage intelligence — last 30 days</div>
      </div>
    </div>
    <div class="header-links">
      <a class="header-link" href="/api/docs">Swagger UI</a>
      <a class="header-link" href="/health/full">Health Check</a>
      <a class="header-link" href="/api/jrx/analytics/stats">Raw JSON</a>
    </div>
  </div>

  <div class="main">
    <div class="section-title">Key Performance Indicators — 30 Day Window</div>
    <div class="kpi-grid">
      <div class="kpi-card blue">
        <div class="kpi-label">Total Requests</div>
        <div class="kpi-value">${fmtNum(stats.total_requests || 0)}</div>
        <div class="kpi-sub">All agents combined</div>
      </div>
      <div class="kpi-card gold">
        <div class="kpi-label">Total Tokens</div>
        <div class="kpi-value">${fmtNum(stats.total_tokens || 0)}</div>
        <div class="kpi-sub">${fmtNum(stats.prompt_tokens || 0)} prompt / ${fmtNum(stats.completion_tokens || 0)} completion</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Avg Latency</div>
        <div class="kpi-value">${stats.avg_latency_ms || 0}<span style="font-size:14px;color:#64748b">ms</span></div>
        <div class="kpi-sub">min ${stats.min_latency_ms || 0}ms / max ${stats.max_latency_ms || 0}ms</div>
      </div>
      <div class="kpi-card success">
        <div class="kpi-label">Success Rate</div>
        <div class="kpi-value">${successRate}<span style="font-size:14px;color:#34d399">%</span></div>
        <div class="kpi-sub">${fmtNum(stats.success_count || 0)} ok / ${fmtNum(stats.error_count || 0)} errors</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-title">📊 Daily Token Usage — Last 14 Days</div>
        ${byDay.length === 0
          ? '<div class="empty-state">No usage data yet.<br/>Start making API calls to see trends.</div>'
          : `<div class="chart-area">${dayBars}</div>`
        }
      </div>
      <div class="card">
        <div class="card-title">🤖 Top Models by Usage</div>
        ${byModel.length === 0
          ? '<div class="empty-state">No model usage data yet.</div>'
          : `<table><thead><tr><th>Model</th><th>Requests</th><th>Tokens</th></tr></thead><tbody>${modelRows}</tbody></table>`
        }
      </div>
    </div>

    <div class="card">
      <div class="card-title">🎯 Agent Usage Breakdown — Top 10 by Request Volume</div>
      ${byAgent.length === 0
        ? '<div class="empty-state">No agent usage data yet.<br/>Once API calls are made through the gateway, usage will appear here.</div>'
        : `<table><thead><tr><th>Agent</th><th>Requests</th><th>Tokens</th><th>Avg Latency</th></tr></thead><tbody>${agentRows}</tbody></table>`
      }
    </div>

    <div class="timestamp">Last refreshed: ${new Date().toISOString()} · <a href="/api/token-metrics">Refresh</a></div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    res.status(500).send(`<pre>Error: ${(err as Error).message}</pre>`);
  }
});

export default router;
