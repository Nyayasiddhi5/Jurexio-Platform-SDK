import { Request, Response } from 'express';
import { PLATFORM_VERSION } from '../config/platform-config.js';
import { NYV_REGISTRY_TOTALS } from '../constants/jrx-registry-stats.js';

export function servePlatformHomepage(req: Request, res: Response) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jurexio — Global Legal Operating System</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #FAFAF5;
      color: #1A1446;
      min-height: 100vh;
    }

    /* Header */
    .header {
      text-align: center;
      padding: 48px 24px 40px;
      background: linear-gradient(180deg, #0A2A66 0%, #1A1446 100%);
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.08) 0%, transparent 60%);
    }
    .header-content { position: relative; z-index: 1; }
    .logo-container {
      width: 80px; height: 80px;
      margin: 0 auto 16px;
      border-radius: 16px;
      overflow: hidden;
      border: 2px solid rgba(212,160,23,0.3);
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .logo-container img {
      width: 100%; height: 100%;
      object-fit: cover;
    }
    .header h1 {
      font-family: 'Playfair Display', serif;
      font-size: 2.8rem;
      font-weight: 800;
      color: #FFFFFF;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }
    .header .subtitle {
      font-size: 0.95rem;
      color: rgba(255,255,255,0.7);
      font-weight: 400;
      letter-spacing: 3px;
      text-transform: uppercase;
    }
    .header .tagline {
      font-family: 'Playfair Display', serif;
      font-size: 1rem;
      color: #D4A017;
      margin-top: 12px;
      font-style: italic;
    }
    .version-badge {
      display: inline-block;
      background: rgba(212,160,23,0.12);
      border: 1px solid rgba(212,160,23,0.35);
      color: #D4A017;
      padding: 6px 16px;
      border-radius: 24px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-top: 16px;
      letter-spacing: 0.5px;
    }

    /* Section titles */
    .section-header {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 24px 8px;
    }
    .section-header h2 {
      font-family: 'Playfair Display', serif;
      font-size: 1.6rem;
      color: #0A2A66;
      font-weight: 700;
    }
    .section-header p {
      color: #64748B;
      font-size: 0.9rem;
      margin-top: 4px;
    }

    /* Grid */
    .grid {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px 24px;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .grid-3 {
      grid-template-columns: repeat(3, 1fr);
    }

    /* Card */
    .card-link {
      text-decoration: none;
      color: inherit;
      display: block;
      border-radius: 16px;
      transition: all 0.3s ease;
    }
    .card-link:hover { transform: translateY(-4px); }
    .card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 16px;
      padding: 28px;
      height: 100%;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    .card-link:hover .card {
      border-color: var(--accent);
      box-shadow: 0 12px 40px rgba(0,0,0,0.08), 0 0 0 1px var(--accent);
    }
    .card-top-bar {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--accent);
    }
    .card-icon {
      width: 52px; height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      background: var(--icon-bg);
    }
    .card-icon svg {
      width: 26px; height: 26px;
      stroke: var(--accent);
      stroke-width: 1.8;
      fill: none;
    }
    .card h3 {
      font-size: 1.2rem;
      font-weight: 700;
      color: #0A2A66;
      margin-bottom: 2px;
    }
    .card .product-tag {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 10px;
      display: block;
    }
    .card p {
      font-size: 0.85rem;
      color: #64748B;
      line-height: 1.65;
      margin-bottom: 16px;
    }
    .card .stats {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .card .stat {
      font-size: 0.73rem;
      color: #94A3B8;
    }
    .card .stat strong {
      color: #0A2A66;
      font-weight: 700;
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-live { background: rgba(28,122,79,0.1); color: #1C7A4F; border: 1px solid rgba(28,122,79,0.25); }
    .badge-beta { background: rgba(212,160,23,0.1); color: #B8860B; border: 1px solid rgba(212,160,23,0.25); }
    .badge-sdk { background: rgba(10,42,102,0.08); color: #0A2A66; border: 1px solid rgba(10,42,102,0.2); }
    .features {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 12px;
    }
    .feature-tag {
      font-size: 0.68rem;
      padding: 3px 8px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      color: #64748B;
    }
    .enter-arrow {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 14px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    .card-link:hover .enter-arrow { opacity: 1; }
    .enter-arrow svg { width: 16px; height: 16px; stroke: var(--accent); fill: none; }

    /* API table */
    .api-section {
      max-width: 1200px;
      margin: 0 auto;
      padding: 8px 24px 48px;
    }
    .api-table {
      width: 100%;
      border-collapse: collapse;
      background: #FFFFFF;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #E2E8F0;
    }
    .api-table th {
      text-align: left;
      padding: 14px 16px;
      background: #F8FAFC;
      font-size: 0.72rem;
      color: #64748B;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 1px solid #E2E8F0;
    }
    .api-table td {
      padding: 11px 16px;
      font-size: 0.82rem;
      color: #475569;
      border-top: 1px solid #F1F5F9;
    }
    .api-table td code {
      background: rgba(10,42,102,0.06);
      color: #0A2A66;
      padding: 2px 7px;
      border-radius: 4px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.72rem;
      font-weight: 500;
    }
    .api-table tr:hover td { background: #FAFBFD; }

    /* Footer */
    .footer {
      text-align: center;
      padding: 32px 24px;
      color: #94A3B8;
      font-size: 0.78rem;
      background: #0A2A66;
      color: rgba(255,255,255,0.5);
    }
    .footer strong { color: #D4A017; font-weight: 600; }

    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .grid-3 { grid-template-columns: 1fr; }
      .header h1 { font-size: 2rem; }
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <div class="header">
    <div class="header-content">
      <div class="logo-container">
        <img src="/console/nyayasiddhi-icon.png" alt="Jurexio — Eagle with Scales of Justice" onerror="this.onerror=null;this.src='/console/nyayasiddhi-logo.png';">
      </div>
      <h1>Jurexio</h1>
      <div class="subtitle">Global Legal Operating System</div>
      <div class="tagline">"Justice. Powered by Precision."</div>
      <div class="version-badge">v${PLATFORM_VERSION} &nbsp;|&nbsp; ${NYV_REGISTRY_TOTALS.totalAgents} Agents &nbsp;|&nbsp; ${NYV_REGISTRY_TOTALS.jurisdictions} Jurisdictions: IN, UK, GCC, EU, USA, SG</div>
    </div>
  </div>

  <!-- PRODUCTION PLATFORMS -->
  <div class="section-header">
    <h2>Platform Ecosystem</h2>
    <p>7 independent platforms sharing the Jurexio Intelligence Core</p>
  </div>
  <div class="grid">

    <!-- 1. Nyayamitra -->
    <a href="/nyayamitra" class="card-link">
      <div class="card" style="--accent: #2563EB; --icon-bg: rgba(37,99,235,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h3>Nyayamitra</h3>
        <span class="product-tag">Citizen Legal Assistance</span>
        <p>AI-powered legal awareness for every citizen. Understand your rights, connect with verified lawyers, and access justice through 14 microservices.</p>
        <div class="stats">
          <span class="stat"><strong>15</strong> pages</span>
          <span class="stat"><strong>14</strong> microservices</span>
          <span class="stat"><strong>122</strong> endpoints</span>
        </div>
        <span class="badge badge-live">Live — 88%</span>
        <div class="features">
          <span class="feature-tag">AI Legal Chat</span>
          <span class="feature-tag">Intake Wizard</span>
          <span class="feature-tag">Lawyer Discovery</span>
          <span class="feature-tag">Legal Literacy</span>
          <span class="feature-tag">Emergency Helplines</span>
          <span class="feature-tag">Razorpay Payments</span>
        </div>
        <div class="enter-arrow">Open Platform <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>

    <!-- 2. Jurexio Professional -->
    <a href="/professional" class="card-link">
      <div class="card" style="--accent: #0A2A66; --icon-bg: rgba(10,42,102,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        </div>
        <h3>Jurexio Professional&trade;</h3>
        <span class="product-tag">Practice OS</span>
        <p>Enterprise-grade platform for lawyers and law firms. Manage cases, clients, billing, documents, and leverage ${NYV_REGISTRY_TOTALS.totalAgents} AI legal agents across Solo, Plus, and Pro tiers.</p>
        <div class="stats">
          <span class="stat"><strong>18</strong> pages</span>
          <span class="stat"><strong>30</strong> route modules</span>
          <span class="stat"><strong>289</strong> endpoints</span>
        </div>
        <span class="badge badge-live">Live — 90%</span>
        <div class="features">
          <span class="feature-tag">Case Management</span>
          <span class="feature-tag">AI Drafting</span>
          <span class="feature-tag">Billing &amp; Razorpay</span>
          <span class="feature-tag">Tier Gating</span>
          <span class="feature-tag">Knowledge Base</span>
        </div>
        <div class="enter-arrow">Open Platform <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>

    <!-- 3. Jurexio Console -->
    <a href="/console" class="card-link">
      <div class="card" style="--accent: #1A1446; --icon-bg: rgba(26,20,70,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <h3>Jurexio Intelligence</h3>
        <span class="product-tag">Core AI Backbone &amp; SDK Console</span>
        <p>Central intelligence layer powering all platforms. ${NYV_REGISTRY_TOTALS.totalAgents} legal agents, orchestration engine, model catalog, developer console, and enterprise analytics.</p>
        <div class="stats">
          <span class="stat"><strong>183</strong> services</span>
          <span class="stat"><strong>${NYV_REGISTRY_TOTALS.totalAgents}</strong> agents</span>
          <span class="stat"><strong>23+</strong> LLM providers</span>
        </div>
        <span class="badge badge-sdk">SDK — 92%</span>
        <div class="features">
          <span class="feature-tag">Agent Registry</span>
          <span class="feature-tag">Orchestration</span>
          <span class="feature-tag">Model Catalog</span>
          <span class="feature-tag">SDK Playground</span>
          <span class="feature-tag">Analytics</span>
        </div>
        <div class="enter-arrow">Open Console <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>

    <!-- 4. Automation SDK -->
    <a href="/console/automation" class="card-link">
      <div class="card" style="--accent: #7C3AED; --icon-bg: rgba(124,58,237,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <h3>Jurexio Automation SDK</h3>
        <span class="product-tag">Document Automation Package</span>
        <p>Enterprise-grade legal document automation with 21 services, 12 AI agents, clause library, compliance controls, and PII security across 6 jurisdictions.</p>
        <div class="stats">
          <span class="stat"><strong>120+</strong> endpoints</span>
          <span class="stat"><strong>12</strong> AI agents</span>
          <span class="stat"><strong>25</strong> clause templates</span>
        </div>
        <span class="badge badge-sdk">SDK — 82%</span>
        <div class="features">
          <span class="feature-tag">Document Generation</span>
          <span class="feature-tag">Clause Library</span>
          <span class="feature-tag">Compliance Controls</span>
          <span class="feature-tag">PII Redaction</span>
        </div>
        <div class="enter-arrow">Open SDK <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>
  </div>

  <!-- PHASE 2 PLATFORMS -->
  <div class="section-header">
    <h2>Expanding Platforms</h2>
    <p>Backend APIs operational — full frontends in Phase 2</p>
  </div>
  <div class="grid grid-3">

    <!-- 5. Institutional -->
    <a href="/console/nyayasiddhi-institutional" class="card-link">
      <div class="card" style="--accent: #1C7A4F; --icon-bg: rgba(28,122,79,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-4h6v4"/><path d="M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/></svg>
        </div>
        <h3>Jurexio Institutional&trade;</h3>
        <span class="product-tag">Legal Governance Platform</span>
        <p>Governance for large firms. Ethical walls, matter lifecycle, AI kill-switch, multi-branch support, SSO, and time/billing.</p>
        <div class="stats">
          <span class="stat"><strong>18</strong> DB tables</span>
          <span class="stat"><strong>16</strong> endpoints</span>
        </div>
        <span class="badge badge-beta">Beta — 65%</span>
        <div class="features">
          <span class="feature-tag">Ethical Walls</span>
          <span class="feature-tag">Matter Lifecycle</span>
          <span class="feature-tag">AI Kill-Switch</span>
          <span class="feature-tag">SSO</span>
        </div>
        <div class="enter-arrow">Open Dashboard <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>

    <!-- 6. Ministry -->
    <a href="/console/ministry" class="card-link">
      <div class="card" style="--accent: #DC2626; --icon-bg: rgba(220,38,38,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L3 7v2h18V7L12 2z"/><path d="M3 19h18v2H3z"/><path d="M5 9v10M9 9v10M15 9v10M19 9v10"/></svg>
        </div>
        <h3>Jurexio Ministry&trade;</h3>
        <span class="product-tag">Regulatory Infrastructure</span>
        <p>Sovereign regulatory governance for ministries. Rule &amp; Act engine, DPDPA compliance, and WORM audit trail.</p>
        <div class="stats">
          <span class="stat"><strong>10</strong> DB tables</span>
          <span class="stat"><strong>14</strong> endpoints</span>
        </div>
        <span class="badge badge-beta">Beta — 60%</span>
        <div class="features">
          <span class="feature-tag">Rule Engine</span>
          <span class="feature-tag">DPDPA</span>
          <span class="feature-tag">WORM Audit</span>
        </div>
        <div class="enter-arrow">Open Dashboard <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>

    <!-- 7. Academy -->
    <a href="/console/academy" class="card-link">
      <div class="card" style="--accent: #D97706; --icon-bg: rgba(217,119,6,0.08);">
        <div class="card-top-bar"></div>
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5"/></svg>
        </div>
        <h3>Jurexio Academy&trade;</h3>
        <span class="product-tag">Legal Intelligence Training</span>
        <p>Legal training with AI mentor, draft simulation, risk lab, certification, and CPD tracking.</p>
        <div class="stats">
          <span class="stat"><strong>10</strong> DB tables</span>
          <span class="stat"><strong>16</strong> endpoints</span>
        </div>
        <span class="badge badge-beta">Beta — 60%</span>
        <div class="features">
          <span class="feature-tag">AI Mentor</span>
          <span class="feature-tag">Draft Simulation</span>
          <span class="feature-tag">Risk Lab</span>
          <span class="feature-tag">CPD Tracking</span>
        </div>
        <div class="enter-arrow">Open Dashboard <svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>
      </div>
    </a>
  </div>

  <!-- API ROUTE MAP -->
  <div class="section-header">
    <h2>API Route Map</h2>
    <p>All routes authenticated via JWT + RBAC except /health</p>
  </div>
  <div class="api-section">
    <table class="api-table">
      <thead>
        <tr>
          <th>Platform</th>
          <th>API Prefix</th>
          <th>Frontend</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Nyayamitra</td>
          <td><code>/api/nm/*</code></td>
          <td><code>/nyayamitra</code></td>
          <td><span class="badge badge-live">Live</span></td>
        </tr>
        <tr>
          <td>Jurexio Professional&trade;</td>
          <td><code>/ns/v1/*</code></td>
          <td><code>/professional</code></td>
          <td><span class="badge badge-live">Live</span></td>
        </tr>
        <tr>
          <td>Jurexio Intelligence</td>
          <td><code>/api/jrx/*</code> &nbsp; <code>/api/v1/sdk/*</code></td>
          <td><code>/console</code></td>
          <td><span class="badge badge-sdk">SDK</span></td>
        </tr>
        <tr>
          <td>Automation SDK</td>
          <td><code>/api/v3/automation/*</code></td>
          <td><code>/console/automation</code></td>
          <td><span class="badge badge-sdk">SDK</span></td>
        </tr>
        <tr>
          <td>Jurexio Institutional&trade;</td>
          <td><code>/api/ni/*</code></td>
          <td><code>/console/nyayasiddhi-institutional</code></td>
          <td><span class="badge badge-beta">Beta</span></td>
        </tr>
        <tr>
          <td>Jurexio Ministry&trade;</td>
          <td><code>/api/nmin/*</code></td>
          <td><code>/console/ministry</code></td>
          <td><span class="badge badge-beta">Beta</span></td>
        </tr>
        <tr>
          <td>Jurexio Academy&trade;</td>
          <td><code>/api/nacad/*</code></td>
          <td><code>/console/academy</code></td>
          <td><span class="badge badge-beta">Beta</span></td>
        </tr>
        <tr>
          <td>Authentication</td>
          <td><code>/api/auth/*</code></td>
          <td>—</td>
          <td><span class="badge badge-live">Live</span></td>
        </tr>
        <tr>
          <td>Health Check</td>
          <td><code>/health</code></td>
          <td>—</td>
          <td><span class="badge badge-live">Public</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    &copy; 2026 <strong>Jurexio</strong> Global Legal Operating System v${PLATFORM_VERSION} &nbsp;|&nbsp; Justice. Powered by Precision. &nbsp;|&nbsp; 498 tables &nbsp;|&nbsp; 6 jurisdictions
  </div>

</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(html);
}
