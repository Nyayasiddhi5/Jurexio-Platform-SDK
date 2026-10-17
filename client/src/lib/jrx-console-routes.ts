/**
 * Console route canonicalization — all authenticated console pages live under
 * `/console/*` (Wouter `<Router base="/console">`). Bare paths like
 * `/document-ai-hub` load the SPA shell but match zero routes → blank content.
 */

export const NV_CONSOLE_BASE = '/console';

/** Paths that must never be prefixed (separate shells or external). */
const EXEMPT_PREFIXES = ['/console', '/legalchat', '/sme', '/api', '/downloads', '/health', '/metrics', '/ws'];

/** All console shell paths (sidebar + redirects + deep links). */
export const NV_CONSOLE_SHELL_PATHS = new Set([
  '/dashboard', '/login', '/home', '/command-centre', '/admin', '/admin-console',
  '/document-ai-hub', '/legal-drafting', '/document-redline', '/billing/subscription', '/chat', '/agent-registry', '/agents',
  '/create-agent', '/agent-live-testing', '/my-approvals', '/orchestration',
  '/architect', '/operations', '/platform-health-map', '/sdk-hub', '/model-catalog',
  '/intelligence', '/multimodal', '/hitl-decision-cards', '/audit-chain',
  '/orchestration/policies', '/dpdpa-compliance', '/rbac-console', '/org-admin',
  '/customer-orgs', '/superadmin/overview', '/superadmin/organisations',
  '/superadmin/super-orgs', '/superadmin/platforms', '/superadmin/feature-flags',
  '/superadmin/federated-tenants', '/superadmin/provider-failover', '/superadmin/llm-budget',
  '/superadmin/agents', '/superadmin/provider-secrets', '/platform-management', '/platform-config',
  '/ocr-extraction', '/summarization', '/bulk-doc-upload',
  '/autofill-qa', '/rag-knowledge-base', '/nys-knowledge-plane', '/instant-search', '/legal-intelligence-feed',
  '/matter-vault', '/statutes-citations', '/regulatory', '/regulatory-monitor', '/live-activity-feed',
  '/orchestration/grpo', '/orchestration/a2a', '/orchestration/bmad',
  '/orchestration/memory', '/orchestration/cam', '/eu-ai-compliance',
  '/superadmin/compliance', '/superadmin/governance', '/roma-l5-admin',
]);

export function isExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

/** Returns a full redirect URL path (incl. /console prefix) or null. */
export function ensureConsoleRedirect(pathname: string, search = ''): string | null {
  if (!pathname || isExemptPath(pathname)) return null;
  const bare = pathname.split('?')[0];
  if (bare === '/') return `${NV_CONSOLE_BASE}/dashboard${search}`;
  if (NV_CONSOLE_SHELL_PATHS.has(bare)) {
    return `${NV_CONSOLE_BASE}${pathname}${search}`;
  }
  for (const p of NV_CONSOLE_SHELL_PATHS) {
    if (bare.startsWith(`${p}/`)) return `${NV_CONSOLE_BASE}${pathname}${search}`;
  }
  return null;
}

/** External shells — full page navigation, not Wouter-relative. */
export function isExternalNavPath(path: string): boolean {
  const p = path.split('?')[0];
  return p.startsWith('/legalchat') || p.startsWith('/sme') || p.startsWith('http://') || p.startsWith('https://');
}

export function navigateExternalOrConsole(path: string, navigate: (p: string) => void): void {
  if (isExternalNavPath(path)) {
    window.location.href = path;
    return;
  }
  navigate(path);
}
