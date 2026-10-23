/**
 * Jurexio Platform — HITL queue + RBAC users + Regulatory feeds + Drift events.
 * Multi-jurisdiction, multi-platform (NSP, NSPM, NSI, NSA, NSM, NYM, JRX).
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_hitl_queue': [
    'request_id', 'org_id', 'platform', 'jurisdiction', 'agent_key', 'category',
    'severity', 'payload_summary', 'status', 'assigned_to', 'sla_minutes',
    'created_at', 'decided_at',
  ],
  'public.nv_hitl_decisions': [
    'request_id', 'decision', 'decided_by', 'decided_at', 'reason', 'policy_refs',
  ],
  'public.nv_users': [
    'email', 'full_name', 'role', 'tier', 'org_id', 'is_active',
    'password_hash', 'created_at',
  ],
  'public.nv_regulatory_feeds': [
    'source_name', 'jurisdiction', 'feed_type', 'feed_url',
    'last_fetched_at', 'last_change_detected_at', 'fetch_interval_minutes',
    'is_active', 'parser_type',
  ],
} as const;
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

const PLATFORMS = ['NSP','NSPM','NSI','NSA','NSM','NYM','JRX'] as const;
const JUR_BY_PLATFORM: Record<string, string> = {
  NSP:'IN', NSPM:'IN', NSI:'IN', NSA:'IN', NSM:'IN', NYM:'IN', JRX:'US',
};
const CATEGORIES = ['contract-review','filing-prep','citation-verify','pii-disclose','high-risk-advice','jurisdictional-handoff','adversarial-suspect','statute-interpret'];
const SEVERITIES = ['critical','high','medium','low'];
const AGENT_KEYS_IN = ['NS-LRM-IN','contract-analyst-IN','litigation-strategist-IN','dpdp-compliance-IN','tax-advisor-IN','arbitration-counsel-IN'];
const AGENT_KEYS_US = ['JRX-LRM-US','clause-classifier-US','aba-512-supervisor','federal-rules-evidence-US','sox-compliance-US','hipaa-counsel-US'];

async function seedHitl() {
  console.log('  ── Seeding HITL queue + decisions ──');
  // 60 historical decided + 18 pending
  for (let i = 0; i < 78; i++) {
    const platform = PLATFORMS[i % PLATFORMS.length];
    const jurisdiction = JUR_BY_PLATFORM[platform];
    const agentPool = jurisdiction === 'US' ? AGENT_KEYS_US : AGENT_KEYS_IN;
    const agentKey = agentPool[i % agentPool.length];
    const cat = CATEGORIES[i % CATEGORIES.length];
    const sev = SEVERITIES[i % SEVERITIES.length];
    const reqId = `hitl-2026-05-${String(i+1).padStart(4,'0')}`;
    const isPending = i < 18;
    const ageHours = isPending ? (i * 0.7) : (24 + i * 6);

    const createdAt = new Date(Date.now() - ageHours * 3600 * 1000);
    const decidedAtStamp = isPending ? null : new Date(Date.now() - Math.max(0, ageHours - 2) * 3600 * 1000);
    await sql`
      INSERT INTO nv_hitl_queue
        (request_id, org_id, platform, jurisdiction, agent_key, category, severity,
         payload_summary, status, assigned_to, sla_minutes, created_at, decided_at)
      VALUES
        (${reqId}, 1, ${platform}, ${jurisdiction}, ${agentKey}, ${cat}, ${sev},
         ${`${cat} on ${platform} (${jurisdiction}) — confidence below threshold; review requested.`},
         ${isPending ? 'pending' : 'decided'},
         ${isPending ? null : 'reviewer-' + (i % 5)}, 60,
         ${createdAt.toISOString()}::timestamptz,
         ${decidedAtStamp ? decidedAtStamp.toISOString() : null}::timestamptz)
      ON CONFLICT (request_id) DO NOTHING
    `;

    if (!isPending) {
      const decision = (i % 10 === 0) ? 'reject' : (i % 7 === 0 ? 'modify' : 'approve');
      const decidedAt = new Date(Date.now() - Math.max(0, ageHours - 2) * 3600 * 1000);
      await sql`
        INSERT INTO nv_hitl_decisions
          (request_id, decision, decided_by, decided_at, reason, policy_refs)
        VALUES
          (${reqId}, ${decision}, ${'reviewer-' + (i % 5)},
           ${decidedAt.toISOString()}::timestamptz,
           ${decision === 'approve' ? 'Output meets policy thresholds.' :
             decision === 'modify'  ? 'Approved with minor citation correction.' :
                                       'Output exceeded permissible advice scope; reroute to attorney.'},
           ${JSON.stringify(['POL-AI-003','POL-LEG-001'])}::jsonb)
      `;
    }
  }
  console.log('    ✓ 78 HITL items (60 decided, 18 pending)');
}

async function seedRbacUsers() {
  console.log('  ── Seeding RBAC users (only if missing) ──');

  const has = (await sql`SELECT COUNT(*)::int c FROM nv_users`)[0].c;
  if (has >= 12) {
    console.log(`    ⊙ ${has} users already exist; skipping seed.`);
    return;
  }

  const users = [
    { email:'cto@jurexio.com',                role:'super_admin', tier:'enterprise', name:'CTO' },
    { email:'security-lead@jurexio.com',      role:'super_admin', tier:'enterprise', name:'Head of Security' },
    { email:'compliance-lead@jurexio.com',    role:'manager',     tier:'enterprise', name:'Head of Compliance' },
    { email:'platform-ops@jurexio.com',       role:'manager',     tier:'enterprise', name:'Platform Operations Lead' },
    { email:'ai-safety-lead@jurexio.com',     role:'manager',     tier:'enterprise', name:'AI Safety Lead' },
    { email:'legal-counsel-in@jurexio.com',   role:'analyst',     tier:'pro',        name:'India Legal Counsel' },
    { email:'legal-counsel-us@jurexio.com',   role:'analyst',     tier:'pro',        name:'US Legal Counsel (JRX)' },
    { email:'legal-counsel-eu@jurexio.com',   role:'analyst',     tier:'pro',        name:'EU Legal Counsel' },
    { email:'hitl-reviewer-1@jurexio.com',    role:'operator',    tier:'pro',        name:'HITL Reviewer L1' },
    { email:'hitl-reviewer-2@jurexio.com',    role:'operator',    tier:'pro',        name:'HITL Reviewer L2' },
    { email:'finops-analyst@jurexio.com',     role:'analyst',     tier:'pro',        name:'FinOps Analyst' },
    { email:'audit-readonly@jurexio.com',     role:'readonly',    tier:'pro',        name:'External Audit (read-only)' },
  ];

  for (const u of users) {
    await sql`
      INSERT INTO nv_users (email, full_name, role, tier, org_id, is_active, password_hash, created_at)
      VALUES (${u.email}, ${u.name}, ${u.role}, ${u.tier}, 1, TRUE,
              ${'$2b$12$placeholder.bcrypt.hash.no.password.set.use.sso'}, NOW() - (random() * interval '120 days'))
      ON CONFLICT (email) DO NOTHING
    `;
  }
  console.log(`    ✓ ${users.length} RBAC users seeded (idempotent)`);
}

async function seedRegulatoryFeeds() {
  console.log('  ── Seeding multi-jurisdiction regulatory feeds ──');

  const feeds = [
    // India
    { src:'MeitY DPDP Updates',           jur:'IN', type:'rss',  url:'https://www.meity.gov.in/data-protection-framework/feed', parser:'rss' },
    { src:'CERT-In Advisories',           jur:'IN', type:'rss',  url:'https://www.cert-in.org.in/rss', parser:'rss' },
    { src:'Supreme Court of India',       jur:'IN', type:'scrape', url:'https://main.sci.gov.in/judgments', parser:'sci-judgments' },
    { src:'RBI Master Directions',        jur:'IN', type:'scrape', url:'https://rbi.org.in/Scripts/NotificationUser.aspx', parser:'rbi-notif' },
    { src:'SEBI Circulars',               jur:'IN', type:'scrape', url:'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6', parser:'sebi-circ' },
    { src:'Income Tax Notifications',     jur:'IN', type:'scrape', url:'https://incometaxindia.gov.in/Pages/communications/notifications.aspx', parser:'itr-notif' },
    // US
    { src:'ABA Ethics Opinions',          jur:'US', type:'rss',   url:'https://www.americanbar.org/rss/ethics_opinions', parser:'rss' },
    { src:'NIST AI RMF Updates',          jur:'US', type:'rss',   url:'https://www.nist.gov/itl/ai-risk-management-framework/feed', parser:'rss' },
    { src:'CFPB Enforcement Actions',     jur:'US', type:'rss',   url:'https://www.consumerfinance.gov/policy-compliance/enforcement/feed', parser:'rss' },
    { src:'NYDFS Cyber Notifications',    jur:'US', type:'scrape', url:'https://www.dfs.ny.gov/industry_guidance/cyber_notifications', parser:'nydfs' },
    { src:'HHS HIPAA Breach Portal',      jur:'US', type:'scrape', url:'https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf', parser:'hhs-breach' },
    { src:'California AG CCPA Enforcement',jur:'US', type:'rss',   url:'https://oag.ca.gov/privacy/feed', parser:'rss' },
    // EU
    { src:'EDPB Decisions',               jur:'EU', type:'rss',   url:'https://www.edpb.europa.eu/news/news_en/feed', parser:'rss' },
    { src:'EU AI Office Guidance',        jur:'EU', type:'rss',   url:'https://digital-strategy.ec.europa.eu/en/policies/ai-office/feed', parser:'rss' },
    { src:'CNIL Sanctions',               jur:'EU', type:'rss',   url:'https://www.cnil.fr/en/feed', parser:'rss' },
    { src:'Irish DPC Decisions',          jur:'EU', type:'rss',   url:'https://www.dataprotection.ie/en/news-media/news/feed', parser:'rss' },
    { src:'ENISA Threat Landscape',       jur:'EU', type:'rss',   url:'https://www.enisa.europa.eu/news/feed', parser:'rss' },
    // UK
    { src:'ICO Enforcement Notices',      jur:'UK', type:'rss',   url:'https://ico.org.uk/action-weve-taken/feed', parser:'rss' },
    { src:'SRA Standards Updates',        jur:'UK', type:'rss',   url:'https://www.sra.org.uk/feeds/standards', parser:'rss' },
    { src:'NCSC UK Advisories',           jur:'UK', type:'rss',   url:'https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml', parser:'rss' },
    // SG
    { src:'PDPC Singapore Decisions',     jur:'SG', type:'rss',   url:'https://www.pdpc.gov.sg/all-commissions-decisions/feed', parser:'rss' },
    { src:'CSA Singapore Advisories',     jur:'SG', type:'rss',   url:'https://www.csa.gov.sg/alerts-advisories/feed', parser:'rss' },
    { src:'MAS Singapore Notices',        jur:'SG', type:'rss',   url:'https://www.mas.gov.sg/news/feed', parser:'rss' },
    // GCC
    { src:'UAE Data Office Guidance',     jur:'GC', type:'rss',   url:'https://u.ae/en/feed', parser:'rss' },
    { src:'SDAIA KSA Updates',            jur:'GC', type:'rss',   url:'https://sdaia.gov.sa/feed', parser:'rss' },
    { src:'SAMA Notifications',           jur:'GC', type:'scrape', url:'https://www.sama.gov.sa/en-US/News/Pages/news.aspx', parser:'sama' },
  ];

  for (const f of feeds) {
    const lastFetched = new Date(Date.now() - Math.floor(Math.random() * 6 * 60 * 60 * 1000));
    const lastChange  = new Date(Date.now() - Math.floor(Math.random() * 48 * 60 * 60 * 1000));
    await sql`
      INSERT INTO nv_regulatory_feeds
        (source_name, jurisdiction, feed_type, feed_url, last_fetched_at, last_change_detected_at,
         fetch_interval_minutes, is_active, parser_type)
      VALUES
        (${f.src}, ${f.jur}, ${f.type}, ${f.url}, ${lastFetched.toISOString()}::timestamptz,
         ${lastChange.toISOString()}::timestamptz, 60, TRUE, ${f.parser})
      ON CONFLICT DO NOTHING
    `;
  }
  console.log(`    ✓ ${feeds.length} regulatory feeds across 6 jurisdictions`);
}

async function main() {
  await assertColumns(sql, './jrx-seed-hitl-and-ops', REQUIRED_COLUMNS);
  await seedRbacUsers();
  await seedHitl();
  await seedRegulatoryFeeds();
  console.log('  ✓ HITL + RBAC + Regulatory feeds done');
}

main()
  .catch((err) => { console.error('HITL/Ops seed failed:', err); process.exit(1); })
  .finally(() => sql.end());
