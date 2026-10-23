import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Loader2, Circle, Ban } from 'lucide-react';
import { Link } from 'wouter';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';

const STEP_LABELS: Record<string, string> = {
  request_received: '1. Request received',
  pii_redaction: '2. PII redaction',
  session_persisted: '3. Session persisted',
  agent_selection: '4. Agent selection (decomposition)',
  prompt_compiled: '5. Prompt compiled',
  rag_retrieval: '6. RAG retrieval',
  memory_injection: '7. Memory injection',
  router_decision: '8. Router decision',
  llm_stream_started: '9. LLM stream started',
  llm_stream_token: '10. LLM token',
  llm_stream_completed: '11. LLM stream completed',
  maker_checker: '12a. Maker-checker (CAM)',
  safety_verdict: '12. Safety verdict',
  citation_grounding: '13. Citation grounding',
  audit_chain: '14. Audit chain',
  response_persisted: '15. Response persisted',
  run_complete: '16. Run complete',
  run_failed: '✗ Run failed',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'failed') return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (status === 'blocked') return <Ban className="h-4 w-4 text-[#C7B15B]" />;
  if (status === 'skipped') return <Circle className="h-4 w-4 text-slate-400" />;
  if (status === 'running') return <Loader2 className="h-4 w-4 text-[#C7B15B] animate-spin" />;
  return <Circle className="h-4 w-4 text-slate-300" />;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 min-w-[80px]">{label}</span>
      <span className="text-[11px] text-slate-700 break-all">{value}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] text-[#8A7420]">{children}</span>;
}

type D = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

function renderStep(step: string, data: D): React.ReactNode {
  switch (step) {
    case 'request_received':
      return (
        <>
          <Field label="prompt" value={s(data.prompt)} />
          <Field label="jurisdictions" value={(arr(data.jurisdictions) as string[]).join(', ') || '—'} />
          <Field label="tier" value={s(data.tier)} />
          <Field label="mode" value={s(data.mode)} />
          {data.agentId ? <Field label="agent" value={<Mono>{s(data.agentId)}</Mono>} /> : null}
          {data.preferredModel ? <Field label="model hint" value={<Mono>{s(data.preferredModel)}</Mono>} /> : null}
        </>
      );
    case 'pii_redaction':
      return (
        <>
          <Field label="strategy" value={s(data.strategy)} />
          <Field label="note" value={s(data.note)} />
        </>
      );
    case 'session_persisted':
      return (
        <>
          <Field label="session" value={<Mono>{s(data.sessionId) || '—'}</Mono>} />
          <Field label="mode" value={s(data.mode) || s(data.reason)} />
        </>
      );
    case 'agent_selection': {
      const subs = arr(data.subtasks) as Array<{ id?: string; type?: string; assignedAgent?: string; description?: string }>;
      return (
        <>
          <Field label="tasks" value={s(data.tasks)} />
          <Field label="algorithm" value={s(data.algorithm)} />
          <Field label="pattern" value={<Mono>{s(data.pattern)}</Mono>} />
          <Field label="complexity" value={s(data.complexity)} />
          {data.summary ? <Field label="summary" value={s(data.summary)} /> : null}
          {subs.length > 0 ? (
            <Field
              label="agents"
              value={subs.slice(0, 6).map((t) => t.assignedAgent || t.type || t.id).filter(Boolean).join(' · ')}
            />
          ) : null}
        </>
      );
    }
    case 'prompt_compiled':
      return (
        <>
          <Field label="agent" value={<Mono>{s(data.agentName || data.agentId)}</Mono>} />
          <Field label="task" value={<Mono>{s(data.taskId)}</Mono>} />
          <Field label="type" value={s(data.subtaskType)} />
          {data.description ? <Field label="prompt" value={s(data.description)} /> : null}
          {data.romaLevel !== undefined ? <Field label="roma" value={s(data.romaLevel)} /> : null}
        </>
      );
    case 'rag_retrieval': {
      const srcs = arr(data.sources).map((x) => (typeof x === 'string' ? x : s((x as { title?: string }).title || (x as { id?: string }).id)));
      return (
        <>
          <Field label="chunks" value={s(data.chunks)} />
          <Field label="collection" value={s(data.collection || data.namespace)} />
          <Field label="top score" value={s(data.topScore)} />
          <Field label="graph hits" value={s(data.graphHits)} />
          <Field label="tiers" value={(arr(data.tiers) as string[]).join(' · ')} />
          {srcs.length > 0 ? <Field label="sources" value={srcs.slice(0, 5).join(', ')} /> : null}
        </>
      );
    }
    case 'memory_injection':
      return (
        <>
          <Field label="source" value={<Mono>{s(data.source)}</Mono>} />
          <Field label="tiers" value={(arr(data.tiers) as string[]).join(' · ')} />
          <Field label="mem0" value={data.mem0 === undefined ? '' : String(data.mem0)} />
          <Field label="hits" value={s(data.hits)} />
          <Field label="facts" value={s(data.facts)} />
        </>
      );
    case 'router_decision': {
      const seq = arr(data.sequence) as Array<{ id: string; provider: string; ctx?: number; costInPer1M?: number }>;
      return (
        <>
          <Field label="primary" value={<Mono>{s(data.primary)}</Mono>} />
          <Field label="provider" value={s(data.primaryProvider)} />
          {seq.length > 0 ? (
            <div className="mt-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">sequence</div>
              <div className="space-y-1">
                {seq.slice(0, 5).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="font-mono text-[#8A7420]">{i + 1}. {m.id}</span>
                    <span className="text-slate-500">
                      {m.provider}{m.ctx ? ` · ${m.ctx}ctx` : ''}
                      {typeof m.costInPer1M === 'number' ? ` · $${m.costInPer1M}/1M` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      );
    }
    case 'llm_stream_started':
      return <Field label="status" value="streaming…" />;
    case 'llm_stream_token':
      return <Field label="tokens" value={s(data.count)} />;
    case 'llm_stream_completed':
      return (
        <>
          <Field label="model" value={<Mono>{s(data.model)}</Mono>} />
          {data.agentId ? <Field label="agent" value={<Mono>{s(data.agentId)}</Mono>} /> : null}
          {data.tokensIn !== undefined ? <Field label="tokens in" value={s(data.tokensIn)} /> : null}
          {data.tokensOut !== undefined ? <Field label="tokens out" value={s(data.tokensOut)} /> : null}
          {data.chars !== undefined ? <Field label="chars" value={s(data.chars)} /> : null}
        </>
      );
    case 'maker_checker':
      return (
        <>
          <Field label="forced" value={data.forced ? 'yes (SME run)' : 'no'} />
          <Field label="passed" value={data.passed === undefined ? '—' : String(data.passed)} />
          <Field label="score" value={s(data.score)} />
          {data.fallback ? <Field label="fallback" value={String(data.fallback)} /> : null}
          {data.checkerNotes ? <Field label="notes" value={s(data.checkerNotes)} /> : null}
          <Field
            label="GRPO"
            value={
              <Link href="/orchestration?tab=trace">
                <span className="underline">Open CAM replay</span>
              </Link>
            }
          />
        </>
      );
    case 'safety_verdict':
      return (
        <>
          <Field label="verdict" value={<Mono>{s(data.verdict)}</Mono>} />
          {data.reason ? <Field label="reason" value={s(data.reason)} /> : null}
          {data.source ? <Field label="source" value={s(data.source)} /> : null}
          {data.confidence !== undefined ? <Field label="confidence" value={s(data.confidence)} /> : null}
        </>
      );
    case 'citation_grounding':
      return (
        <>
          <Field label="citations" value={s(data.citationCount)} />
          {data.groundedRatio !== undefined ? <Field label="grounded" value={`${(n(data.groundedRatio) * 100).toFixed(1)}%`} /> : null}
          {data.verified !== undefined ? <Field label="verified" value={s(data.verified)} /> : null}
          {data.unverifiable !== undefined ? <Field label="unverifiable" value={s(data.unverifiable)} /> : null}
        </>
      );
    case 'audit_chain':
      return (
        <>
          <Field label="entry hash" value={<Mono>{(s(data.entryHash) || '—').slice(0, 24)}{s(data.entryHash).length > 24 ? '…' : ''}</Mono>} />
          {data.prevHash ? <Field label="prev hash" value={<Mono>{s(data.prevHash).slice(0, 24)}…</Mono>} /> : null}
          <Field label="agents" value={s(data.agentsUsed)} />
          <Field label="pattern" value={<Mono>{s(data.pattern)}</Mono>} />
        </>
      );
    case 'response_persisted':
      return (
        <>
          <Field label="session" value={<Mono>{s(data.sessionId) || '—'}</Mono>} />
          <Field label="chars" value={s(data.chars)} />
          <Field label="citations" value={s(data.citations)} />
          {data.reason ? <Field label="reason" value={s(data.reason)} /> : null}
        </>
      );
    case 'run_complete':
      return (
        <>
          <Field label="model" value={<Mono>{s(data.model)}</Mono>} />
          <Field label="tokens in" value={s(data.tokensIn)} />
          <Field label="tokens out" value={s(data.tokensOut)} />
          <Field label="agents" value={s(data.agentsUsed)} />
          <Field label="citations" value={String(arr(data.citations).length)} />
          {typeof data.response === 'string' && data.response ? (
            <Field label="preview" value={`${data.response.slice(0, 240)}${data.response.length > 240 ? '…' : ''}`} />
          ) : null}
        </>
      );
    case 'run_failed':
      return <Field label="error" value={s(data.error) || s(data.message)} />;
    default:
      return null;
  }
}

export function StepCard({ event }: { event: LegalChatTimelineEvent }) {
  const label = STEP_LABELS[event.step] || event.step;
  const data = (event.data ?? {}) as D;
  const structured = renderStep(event.step, data);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 text-slate-700 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon status={event.status} />
          <span className="font-semibold text-[#152448]">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {event.durationMs !== undefined && (
            <Badge variant="outline" className="text-[10px] border-slate-200 text-[#8A7420]">
              {event.durationMs}ms
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] border-slate-200 ${
            event.status === 'ok' ? 'text-emerald-600' :
            event.status === 'failed' ? 'text-red-500' :
            event.status === 'blocked' ? 'text-[#8A7420]' : 'text-slate-500'
          }`}>{event.status}</Badge>
        </div>
      </div>
      {event.message && <p className="mt-1 text-red-500">{event.message}</p>}
      {structured ? (
        <div className="mt-2 space-y-1">{structured}</div>
      ) : (event.data && Object.keys(event.data).length > 0 ? (
        <details className="mt-2">
          <summary className="text-[10px] text-slate-400 cursor-pointer">raw payload</summary>
          <pre className="mt-1 text-[10px] text-slate-600 overflow-x-auto whitespace-pre-wrap break-words max-h-40">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </details>
      ) : null)}
    </div>
  );
}
