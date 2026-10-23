import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Sidebar, type SidebarState } from '@/features/legal-chat/Sidebar';
import { ChatPane, type ChatMessage, type Citation } from '@/features/legal-chat/ChatPane';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import { RubricModal } from '@/features/legal-chat/RubricModal';
import { SmeAllocations } from '@/features/legal-chat/SmeAllocations';
import {
  legalChatApi,
  streamLegalChatSend,
  type LegalChatTimelineEvent,
} from '@/services/legal-chat-api';
import { extractReasoningTrail, type NvReasoningTrailSource } from '@/lib/jrx-reasoning-trail';
import { useNvRegistryMeta } from '@/hooks/useNvRegistryMeta';
import { Card } from '@/components/ui/card';

const ADMIN_ROLES = new Set(['superadmin', 'super_admin', 'admin', 'org_admin']);

export default function LegalChatPage() {
  const { user } = useAuth();
  const isAdmin = user && ADMIN_ROLES.has((user.role || '').toLowerCase());
  const [tab, setTab] = useState<'chat' | 'allocations'>('chat');

  const [sidebar, setSidebar] = useState<SidebarState>({
    jurisdictions: ['US', 'IN'],
    tier: 'pro',
    mode: 'chat',
    preferCheaper: false,
    requireReasoning: false,
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
  /* NV-GOOD-LAW-PANEL-001 — authority the reader clicked "still good law?" on.
   * Lives on the page, not in ChatPane, so the verdict renders in the rail
   * beside the answer instead of pushing the answer off screen. */
  const [goodLawAuthority, setGoodLawAuthority] = useState<string | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  const { totalAgents, registryVersion } = useNvRegistryMeta();

  const createNewSession = useCallback(async (): Promise<string | null> => {
    try {
      const r = (await legalChatApi.createSession({
        title: `Legal chat ${new Date().toISOString().slice(0, 16)}`,
        jurisdictions: sidebar.jurisdictions,
        tier: sidebar.tier,
        mode: sidebar.mode,
      } as Parameters<typeof legalChatApi.createSession>[0])) as
        | { session?: { id: string }; id?: string }
        | null;
      const id = r?.session?.id || r?.id || null;
      if (id) setSessionId(id);
      return id;
    } catch {
      return null;
    }
  }, [sidebar.jurisdictions, sidebar.tier, sidebar.mode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await createNewSession();
      if (!cancelled) void id;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session bootstrapped once on mount
  }, []);

  const onSend = async (prompt: string) => {
    if (!sessionIdRef.current) {
      const start = Date.now();
      while (!sessionIdRef.current && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sessionIdRef.current) {
        await createNewSession();
      }
      if (!sessionIdRef.current) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
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
    const userMsgId = crypto.randomUUID();
    const asstMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: prompt },
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
              ? (rawCitations.filter((c) => c !== null && typeof c === 'object') as Citation[])
              : [];
            /* Reads the envelope off the finished run when the wire carries one.
             * `/api/jrx/legal-chat/send` does not today (it drives the Queen
             * directly and never builds a QualityEnvelope), so this resolves to
             * null and the panel reports "not captured" instead of implying the
             * gates passed. No client change is needed once the route emits it. */
            setTrail(extractReasoningTrail(e.data));
            setMessages((prev) => prev.map((m) => m.id === asstMsgId ? {
              ...m,
              content: String(e.data?.response ?? ''),
              citations,
              orchestrationId: e.orchestrationId,
              status: 'ok',
            } : m));
          }
          if (e.step === 'run_failed') {
            setMessages((prev) => prev.map((m) => m.id === asstMsgId ? {
              ...m, content: `❌ ${e.message || 'failed'}`, status: 'failed',
            } : m));
          }
        },
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

  return (
    <div
      className="min-h-screen text-white p-4"
      style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}
    >
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-300 to-amber-500 text-[#152448] flex items-center justify-center font-bold text-lg shadow-lg shadow-amber-500/30">
            N
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white leading-tight" style={{ fontFamily: 'Merriweather, serif' }}>
              LegalChat <span className="text-amber-300">·</span> <span className="text-base font-medium text-slate-300">Jurexio AI</span>
            </h1>
            <p className="text-[12px] text-slate-300 mt-0.5">
              Grounded answers from the active {totalAgents}-agent v{registryVersion} registry — every run cited & audit-logged.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-emerald-200 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
          </span>
          {isAdmin && (
            <div className="inline-flex rounded-lg border border-[#23407C] bg-[#091F4D] p-0.5">
              <button
                onClick={() => setTab('chat')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  tab === 'chat' ? 'bg-amber-400 text-[#152448] shadow' : 'text-slate-200 hover:text-white'
                }`}
              >Chat</button>
              <button
                onClick={() => setTab('allocations')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  tab === 'allocations' ? 'bg-amber-400 text-[#152448] shadow' : 'text-slate-200 hover:text-white'
                }`}
              >SME Allocations</button>
            </div>
          )}
        </div>
      </div>

      {tab === 'allocations' ? (
        <SmeAllocations />
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3"
          style={{ minHeight: 'calc(100vh - 140px)' }}
        >
          <div className="lg:col-span-3 lg:h-[calc(100vh-140px)] order-2 lg:order-1 h-[420px]">
            <Sidebar state={sidebar} onChange={setSidebar} />
          </div>
          <div className="lg:col-span-5 md:col-span-2 lg:h-[calc(100vh-140px)] order-1 lg:order-2 h-[560px]">
            <ChatPane
              messages={messages}
              onSend={onSend}
              onRate={(id) => setRubric({ open: true, orchId: id })}
              onCheckAuthority={setGoodLawAuthority}
              busy={busy}
            />
          </div>
          <div className="lg:col-span-4 lg:h-[calc(100vh-140px)] order-3 h-[420px]">
            <ExecutionTraceRail
              events={events}
              orchestrationId={orchId}
              goodLawCitation={goodLawAuthority}
              trail={events.some((e) => e.step === 'run_complete') ? trail : undefined}
              trailUnavailableReason="This run finished without an audited quality envelope on the wire — LegalChat's /send stream does not carry qualityEnvelope yet. No gate outcome can be shown, and none should be assumed."
            />
          </div>
        </div>
      )}

      <RubricModal
        open={rubric.open}
        onClose={() => setRubric({ open: false })}
        orchestrationId={rubric.orchId}
        sessionId={sessionId ?? undefined}
      />
    </div>
  );
}
