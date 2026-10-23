/**
 * Task #156 — SME workspace.
 *
 * Reuses the same chat / workflow / rubric features the main console
 * exposes at /console/legal-chat, but as the ONLY surface in this shell
 * (no sidebar nav, no other features competing for the SME's attention).
 *
 * Sends to the existing /api/jrx/legal-chat/send endpoint. The route
 * detects role=sme and:
 *   - forces CAM/maker-checker ON via metadata.forceMakerChecker
 *   - pre-recalls SME preference memories from mem0 (6th tier)
 *   - post-stores the (prompt, response, model) into mem0 on completion
 *   - on /feedback, enqueues GRPO Redis stream + bumps the EMA hash
 *     that the intelligent router uses as a tie-breaker.
 *
 * NV-LEGALCHAT-HISTORY-2026-05-12: added HistoryPane (left rail) so the
 * SME can browse and reopen prior sessions; the auto-create-on-mount
 * was extracted into `createNewSession()` and reused by the New-chat
 * button. Opening a history row hydrates ChatPane via GET /sessions/:id.
 *
 * NV-SME-UX-2026-06-18: relayout to a clean, Claude-style 3-zone shell —
 * collapsible left thread rail, a dominant centered conversation, and a
 * collapsible right panel that tabs between Configure and Live workflow.
 * Migrated to the canonical light Jurexio brand (royal #152448 / gold
 * #C7B15B / emerald #1C7A4F on #F9FAFB).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Sidebar, type SidebarState } from '@/features/legal-chat/Sidebar';
import { ChatPane, type ChatMessage, type Citation } from '@/features/legal-chat/ChatPane';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import { RubricModal } from '@/features/legal-chat/RubricModal';
import { HistoryPane } from '@/features/legal-chat/HistoryPane';
import {
  legalChatApi,
  streamLegalChatSend,
  type LegalChatTimelineEvent,
} from '@/services/legal-chat-api';
import { extractReasoningTrail, type NvReasoningTrailSource } from '@/lib/jrx-reasoning-trail';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LogOut, Scale, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose,
  SlidersHorizontal, Activity, Shield, X,
} from 'lucide-react';
import { SmeAllocations } from '@/features/legal-chat/SmeAllocations';
import { BRAND, HEADING_FONT } from '@/features/legal-chat/brand';

export default function SmeWorkspace() {
  const { user, logout } = useAuth();
  const isSuperadmin = ['super_admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
  const shellBase =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/legalchat')
      ? '/legalchat'
      : '/sme';
  const [sidebar, setSidebar] = useState<SidebarState>({
    jurisdictions: ['IN'],
    tier: 'pro',
    mode: 'chat',
    preferCheaper: false,
    requireReasoning: true,
    requireJson: false,
    requireVision: false,
    fileIds: [],
    uploadedFiles: [],
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [trail, setTrail] = useState<NvReasoningTrailSource | null>(null);
  const [orchId, setOrchId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [rubric, setRubric] = useState<{ open: boolean; orchId?: string }>({ open: false });
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Layout state (Claude-style collapsible rails).
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'configure' | 'workflow'>('configure');
  const [adminOpen, setAdminOpen] = useState(false);

  const createNewSession = useCallback(async (): Promise<string | null> => {
    try {
      const r = (await legalChatApi.createSession({
        title: `SME workspace ${new Date().toISOString().slice(0, 16)}`,
        jurisdictions: sidebar.jurisdictions,
        tier: sidebar.tier,
        mode: sidebar.mode,
      } as any)) as { session?: { id: string }; id?: string } | null;
      const id = r?.session?.id || r?.id || null;
      if (id) {
        setSessionId(id);
        setHistoryReloadKey((k) => k + 1);
      }
      return id;
    } catch {
      return null;
    }
  }, [sidebar.jurisdictions, sidebar.tier, sidebar.mode]);

  useEffect(() => {
    document.title = 'Jurexio — SME LegalChat';
    let cancelled = false;
    (async () => {
      const id = await createNewSession();
      if (cancelled) return;
      void id;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNewChat = async () => {
    setMessages([]);
    setEvents([]);
    setOrchId(undefined);
    setSidebar((s) => ({ ...s, fileIds: [], uploadedFiles: [] }));
    await createNewSession();
  };

  type ServerMsg = {
    id: string | number;
    role: 'user' | 'assistant';
    content: string;
    citations?: unknown;
    orchestration_id?: string;
  };
  const onOpenSession = async (id: string) => {
    setBusy(true);
    setEvents([]);
    setOrchId(undefined);
    try {
      const r = (await legalChatApi.getSession(id)) as
        | { session?: { id: string }; messages?: ServerMsg[] }
        | null;
      const srvMsgs: ServerMsg[] = r?.messages ?? [];
      const mapped: ChatMessage[] = srvMsgs.map((m) => {
        const cites = Array.isArray(m.citations)
          ? (m.citations.filter((c) => c && typeof c === 'object') as Citation[])
          : [];
        return {
          id: String(m.id),
          role: m.role,
          content: String(m.content || ''),
          citations: cites,
          orchestrationId: m.orchestration_id,
          status: 'ok',
        };
      });
      setMessages(mapped);
      setSessionId(id);
    } catch {
      // soft fail — keep current chat
    } finally {
      setBusy(false);
    }
  };

  const onSend = async (prompt: string) => {
    if (!sessionIdRef.current) {
      const start = Date.now();
      while (!sessionIdRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sessionIdRef.current) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), role: 'assistant',
          content: '⚠ Session not ready — please retry in a moment.',
          status: 'failed',
        }]);
        return;
      }
    }
    const liveSessionId = sessionIdRef.current;
    setBusy(true);
    setEvents([]);
    setTrail(null);
    setOrchId(undefined);
    // On a fresh send, surface the live pipeline so the SME sees progress.
    setRightTab('workflow');
    const userMsgId = crypto.randomUUID();
    const asstMsgId = crypto.randomUUID();
    const attachedNames = sidebar.uploadedFiles.map((f) => f.name);
    const userPreviewSuffix = attachedNames.length
      ? `\n\n📎 Attached: ${attachedNames.join(', ')}`
      : '';
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: prompt + userPreviewSuffix },
      { id: asstMsgId, role: 'assistant', content: '', status: 'streaming' },
    ]);
    try {
      await streamLegalChatSend(
        {
          prompt,
          sessionId: liveSessionId ?? undefined,
          jurisdictions: sidebar.jurisdictions,
          tier: sidebar.tier,
          mode: sidebar.mode,
          agentId: sidebar.agentId,
          preferredModel: sidebar.preferredModel,
          preferCheaper: sidebar.preferCheaper,
          requireReasoning: sidebar.requireReasoning,
          requireJson: sidebar.requireJson,
          requireVision: sidebar.requireVision,
          fileIds: sidebar.fileIds,
        },
        (e) => {
          setEvents((prev) => [...prev, e]);
          if (e.step === 'request_received' && e.orchestrationId) setOrchId(e.orchestrationId);
          if (e.step === 'run_complete') {
            const rawCitations = e.data?.citations;
            const citations: Citation[] = Array.isArray(rawCitations)
              ? (rawCitations.filter((c: unknown) => c !== null && typeof c === 'object') as Citation[])
              : [];
            setTrail(extractReasoningTrail(e.data));
            setMessages((prev) => prev.map((m) => m.id === asstMsgId ? {
              ...m,
              content: String(e.data?.response ?? ''),
              citations,
              orchestrationId: e.orchestrationId,
              status: 'ok',
            } : m));
            // Bump history list (last_used_at moved + maybe new title) and
            // auto-prompt the rubric for SME runs.
            setHistoryReloadKey((k) => k + 1);
            if (e.orchestrationId) {
              setRubric({ open: true, orchId: e.orchestrationId });
            }
          }
          if (e.step === 'run_failed') {
            setMessages((prev) => prev.map((m) => m.id === asstMsgId ? {
              ...m, content: `❌ ${e.message || 'failed'}`, status: 'failed',
            } : m));
          }
        },
        undefined,
        { shell: 'sme' },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'request failed';
      setMessages((prev) => prev.map((m) => m.id === asstMsgId ? {
        ...m, content: `❌ ${msg}`, status: 'failed',
      } : m));
    } finally {
      setBusy(false);
    }
  };

  const headerBtn =
    'h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-[#152448] hover:bg-slate-100 transition-colors';

  return (
    <div className="h-screen flex flex-col" style={{ background: BRAND.canvas }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between gap-3 px-4 h-14 bg-white border-b flex-shrink-0"
        style={{ borderColor: BRAND.border }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setLeftOpen((v) => !v)}
            className={headerBtn}
            title={leftOpen ? 'Hide history' : 'Show history'}
            data-testid="toggle-history"
          >
            {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: BRAND.royal, color: BRAND.gold }}
          >
            <Scale className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold leading-tight" style={{ fontFamily: HEADING_FONT, color: BRAND.royal }}>
              Jurexio LegalChat
            </h1>
            <p className="text-[10.5px] truncate" style={{ color: BRAND.muted }}>
              <span style={{ color: BRAND.ink }}>{user?.email}</span>
              <span className="hidden sm:inline"> · role <span style={{ color: '#8A7420' }}>{user?.role}</span> · CAM ON · GRPO live</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isSuperadmin && (
            <Button
              variant="ghost" size="sm"
              onClick={() => setAdminOpen((v) => !v)}
              className="text-[12px] font-medium hidden sm:flex"
              style={{ color: BRAND.royal }}
              data-testid="button-admin-tools"
            >
              <Shield className="w-3.5 h-3.5 mr-1" /> Admin tools
            </Button>
          )}
          <button
            onClick={() => setRightOpen((v) => !v)}
            className={headerBtn}
            title={rightOpen ? 'Hide panel' : 'Show panel'}
            data-testid="toggle-right"
          >
            {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
          </button>
          <Button
            variant="ghost" size="sm"
            onClick={() => { logout(); window.location.href = `${shellBase}/login`; }}
            className="text-[12px] font-medium"
            style={{ color: BRAND.muted }}
            data-testid="button-sme-logout"
          >
            <LogOut className="w-3.5 h-3.5 mr-1" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {/* ── Superadmin tools (collapsible band) ─────────────────── */}
      {isSuperadmin && adminOpen && (
        <div className="border-b bg-white px-4 py-3" style={{ borderColor: BRAND.border }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: BRAND.royal }}>
              LegalChat admin controls
            </h3>
            <button onClick={() => setAdminOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-8">
              <SmeAllocations />
            </div>
            <div className="lg:col-span-4">
              <Card className="p-4 bg-white border-slate-200 space-y-2">
                <p className="text-xs" style={{ color: BRAND.muted }}>
                  Manage platform governance from LegalChat admin mode.
                </p>
                <div className="grid grid-cols-1 gap-1.5 text-xs">
                  <a className="underline font-medium" style={{ color: BRAND.royal }} href="/console/rbac-console">RBAC + role policies</a>
                  <a className="underline font-medium" style={{ color: BRAND.royal }} href="/console/hitl-decision-cards">Approvals queue</a>
                  <a className="underline font-medium" style={{ color: BRAND.royal }} href="/console/orchestration/policies">Policy management</a>
                  <a className="underline font-medium" style={{ color: BRAND.royal }} href="/console/llm-priority">Model/rate-limit strategy</a>
                  <a className="underline font-medium" style={{ color: BRAND.royal }} href="/console/customer-orgs">Multi-org tenant administration</a>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ── Body: left rail · chat · right panel ────────────────── */}
      <div className="flex-1 flex min-h-0">
        {leftOpen && (
          <aside className="w-[260px] flex-shrink-0 border-r overflow-hidden" style={{ borderColor: BRAND.border }}>
            <HistoryPane
              activeSessionId={sessionId}
              onOpenSession={onOpenSession}
              onNewChat={onNewChat}
              reloadKey={historyReloadKey}
            />
          </aside>
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          <ChatPane
            messages={messages}
            busy={busy}
            onSend={onSend}
            onRate={(orchestrationId) => setRubric({ open: true, orchId: orchestrationId })}
          />
        </main>

        {rightOpen && (
          <aside className="w-[360px] flex-shrink-0 border-l flex flex-col" style={{ borderColor: BRAND.border }}>
            <div className="flex items-center gap-1 p-2 border-b bg-white flex-shrink-0" style={{ borderColor: BRAND.border }}>
              {([
                { id: 'configure', label: 'Configure', Icon: SlidersHorizontal },
                { id: 'workflow', label: 'Workflow', Icon: Activity },
              ] as const).map(({ id, label, Icon }) => {
                const active = rightTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => setRightTab(id)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold py-1.5 rounded-lg transition-colors"
                    style={active
                      ? { background: BRAND.royalSoft, color: BRAND.royal }
                      : { color: BRAND.muted }}
                    data-testid={`right-tab-${id}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 min-h-0">
              {rightTab === 'configure'
                ? <Sidebar state={sidebar} onChange={setSidebar} />
                : <ExecutionTraceRail
                    events={events}
                    orchestrationId={orchId}
                    trail={events.some((e) => e.step === 'run_complete') ? trail : undefined}
                    trailUnavailableReason="This run finished without an audited quality envelope on the wire — LegalChat's /send stream does not carry qualityEnvelope yet. No gate outcome can be shown, and none should be assumed."
                  />}
            </div>
          </aside>
        )}
      </div>

      {/* ── GRPO footer note ────────────────────────────────────── */}
      <footer
        className="flex-shrink-0 px-4 py-1.5 text-[10.5px] text-center bg-white border-t"
        style={{ borderColor: BRAND.border, color: BRAND.muted }}
      >
        Every rating becomes a GRPO preference pair · Postgres is the durable record ·
        Redis stream <code className="font-mono">nyv:grpo:training</code> feeds the trainer ·
        per-(jurisdiction, taskKind, model) EMA boosts the router on the next run.
      </footer>

      {rubric.orchId && (
        <RubricModal
          open={rubric.open}
          orchestrationId={rubric.orchId}
          sessionId={sessionId ?? undefined}
          onClose={() => setRubric({ open: false })}
        />
      )}
    </div>
  );
}
