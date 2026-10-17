import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Send, Star, Copy, Download, Share2, Check,
  Scale, FileSignature, BookOpen, ShieldCheck,
  User as UserIcon, Sparkles, Quote,
} from 'lucide-react';
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import { BRAND, HEADING_FONT } from './brand';

export interface Citation {
  id?: string;
  title?: string;
  url?: string;
  source?: string;
  excerpt?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  orchestrationId?: string;
  status?: 'pending' | 'streaming' | 'ok' | 'failed';
}

interface ChatPaneProps {
  messages: ChatMessage[];
  onSend: (prompt: string) => void;
  onRate: (orchestrationId: string) => void;
  busy: boolean;
  /**
   * NV-GOOD-LAW-PANEL-001 — the reader asked whether a cited authority is still
   * good law. Handled by the host so the check lands in the rail beside the
   * answer rather than inline, where it would push the answer off screen.
   */
  onCheckAuthority?: (authority: string) => void;
}

const SAMPLE_PROMPTS: Array<{ Icon: typeof Scale; title: string; prompt: string }> = [
  {
    Icon: Scale,
    title: 'Explain a statute',
    prompt: 'Explain Section 138 of the Negotiable Instruments Act with leading case law.',
  },
  {
    Icon: FileSignature,
    title: 'Draft a clause',
    prompt: 'Draft a balanced limitation-of-liability clause for a B2B SaaS agreement governed by Indian law.',
  },
  {
    Icon: BookOpen,
    title: 'Compare jurisdictions',
    prompt: 'Compare GDPR (EU) vs DPDP Act 2023 (IN) on cross-border data transfer obligations.',
  },
  {
    Icon: ShieldCheck,
    title: 'Compliance check',
    prompt: 'Review this MSA for compliance gaps under Indian Contract Act and SPDI Rules. (then attach the file)',
  },
];

function buildShareUrl(orchId: string): string {
  const u = new URL(window.location.href);
  u.hash = `#orch=${orchId}`;
  return u.toString();
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function MessageActions({ message, onRate }: { message: ChatMessage; onRate: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const orchId = message.orchestrationId;
  const cites = message.citations || [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  const dl = () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const cited = cites.length
      ? `\n\n## Citations\n${cites.map((c, i) => `${i + 1}. ${c.title || c.id || c.url || JSON.stringify(c).slice(0, 120)}`).join('\n')}`
      : '';
    const md = `# Jurexio LegalChat answer\n\n_orch_: \`${orchId || 'n/a'}\`  \n_exported_: ${new Date().toISOString()}\n\n${message.content}${cited}\n`;
    downloadMarkdown(`nyv-legalchat-${ts}.md`, md);
  };
  const share = async () => {
    if (!orchId) return;
    const url = buildShareUrl(orchId);
    try {
      if (navigator.share) await navigator.share({ title: 'Jurexio LegalChat answer', url });
      else await navigator.clipboard.writeText(url);
      setShared(true); setTimeout(() => setShared(false), 1500);
    } catch { /* noop */ }
  };

  const btnCls =
    'text-[11px] flex items-center gap-1 px-2 py-1 rounded-md text-slate-500 hover:text-[#152448] hover:bg-slate-100 transition-colors';
  return (
    <div className="mt-3 pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center gap-1">
      <button onClick={copy} className={btnCls} data-testid="msg-copy">
        {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={dl} className={btnCls} data-testid="msg-download">
        <Download className="h-3 w-3" /> Download .md
      </button>
      {orchId && (
        <button onClick={share} className={btnCls} data-testid="msg-share">
          <Share2 className="h-3 w-3" /> {shared ? 'Link copied' : 'Share'}
        </button>
      )}
      {orchId && message.status === 'ok' && (
        <button
          onClick={() => onRate(orchId)}
          className="ml-auto text-[11px] flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold border transition-colors"
          style={{ background: BRAND.goldSoft, color: '#7A6A1F', borderColor: BRAND.goldBorder }}
          data-testid="msg-rate"
        >
          <Star className="h-3 w-3" /> Rate response
        </button>
      )}
    </div>
  );
}

export function ChatPane({ messages, onSend, onRate, busy, onCheckAuthority }: ChatPaneProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content?.length]);

  // Auto-grow the composer (Claude-style) up to a max height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [draft]);

  const submit = (override?: string) => {
    const v = (override ?? draft).trim();
    if (!v || busy) return;
    onSend(v);
    setDraft('');
  };

  return (
    <div className="h-full flex flex-col" style={{ background: BRAND.canvas }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="py-8">
              <div className="text-center mb-7">
                <div
                  className="inline-flex items-center justify-center h-14 w-14 rounded-2xl mb-4 shadow-sm"
                  style={{ background: BRAND.royal, color: BRAND.gold }}
                >
                  <Scale className="h-7 w-7" />
                </div>
                <h2 className="text-[28px] font-bold leading-tight" style={{ fontFamily: HEADING_FONT, color: BRAND.royal }}>
                  How can I help with your legal work?
                </h2>
                <p className="text-sm mt-2 max-w-md mx-auto leading-relaxed" style={{ color: BRAND.muted }}>
                  Ask a question, draft a document, review an upload, or compare jurisdictions.
                  Every answer is grounded, cited and audit-logged.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SAMPLE_PROMPTS.map(({ Icon, title, prompt }) => (
                  <button
                    key={title}
                    onClick={() => { setDraft(prompt); taRef.current?.focus(); }}
                    className="text-left p-3.5 rounded-xl bg-white border border-slate-200 hover:border-[#C7B15B] hover:shadow-sm transition-all group"
                    data-testid={`sample-${title.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div
                        className="h-8 w-8 rounded-lg flex items-center justify-center"
                        style={{ background: BRAND.royalSoft }}
                      >
                        <Icon className="h-4 w-4" style={{ color: BRAND.royal }} />
                      </div>
                      <span className="text-[13px] font-semibold" style={{ color: BRAND.ink }}>{title}</span>
                    </div>
                    <p className="text-[12px] leading-snug line-clamp-2" style={{ color: BRAND.muted }}>{prompt}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px]" style={{ color: BRAND.muted }}>
                <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" style={{ color: BRAND.gold }} /> {JRX_REGISTRY_RUNTIME.totalAgents} legal agents</span>
                <span>·</span>
                <span>6 jurisdictions</span>
                <span>·</span>
                <span>50+ models</span>
                <span>·</span>
                <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" style={{ color: BRAND.emerald }} /> Audit-chained</span>
              </div>
            </div>
          )}

          {messages.map((m) => (
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end gap-3" data-testid="msg-user">
                <div
                  className="max-w-[85%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap shadow-sm"
                  style={{ background: BRAND.royal, color: '#FFFFFF' }}
                >
                  {m.content}
                </div>
                <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <UserIcon className="h-4 w-4 text-slate-500" />
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start gap-3" data-testid="msg-assistant">
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5 shadow-sm"
                  style={{ background: BRAND.royal, color: BRAND.gold }}
                >N</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold mb-1" style={{ color: BRAND.royal }}>Jurexio</div>
                  <div
                    className="rounded-2xl rounded-tl-md px-4 py-3 bg-white border border-slate-200 shadow-sm"
                  >
                    <div className="text-[14px] whitespace-pre-wrap leading-relaxed" style={{ color: BRAND.ink }}>
                      {m.content || (m.status === 'streaming' ? (
                        <span className="inline-flex gap-1 items-center text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BRAND.gold }} />
                          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BRAND.gold, animationDelay: '0.15s' }} />
                          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BRAND.gold, animationDelay: '0.3s' }} />
                        </span>
                      ) : '')}
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[12px]">
                        <div className="flex items-center gap-1 font-semibold mb-1" style={{ color: BRAND.royal }}>
                          <Quote className="h-3 w-3" /> Citations ({m.citations.length})
                        </div>
                        <ul className="space-y-0.5" style={{ color: BRAND.muted }}>
                          {m.citations.slice(0, 6).map((c, i) => {
                            const authority = String(c.title || c.id || '').trim();
                            return (
                              <li key={i} className="flex gap-1.5 items-baseline">
                                <span className="font-mono font-semibold" style={{ color: BRAND.gold }}>{i + 1}.</span>
                                <span className="truncate">{c.title || c.id || c.url || JSON.stringify(c).slice(0, 80)}</span>
                                {onCheckAuthority && authority ? (
                                  <button
                                    type="button"
                                    onClick={() => onCheckAuthority(authority)}
                                    className="ml-auto flex-shrink-0 text-[11px] underline-offset-2 hover:underline"
                                    style={{ color: BRAND.info }}
                                    title="Check for adverse treatment. Not a citator — see the panel for what this can and cannot establish."
                                    data-testid="chat-citation-good-law"
                                  >
                                    still good law?
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {m.status === 'ok' && <MessageActions message={m} onRate={onRate} />}
                  </div>
                </div>
              </div>
            )
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3">
          <div
            className="flex gap-2 items-end rounded-2xl border bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-[#C7B15B] focus-within:ring-2 focus-within:ring-[#C7B15B]/30"
            style={{ borderColor: BRAND.border }}
          >
            <Textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              }}
              placeholder="Ask a legal question, request a draft, or paste statute text…"
              rows={1}
              className="flex-1 border-0 bg-transparent text-[14px] resize-none shadow-none focus-visible:ring-0 px-1 py-1.5 min-h-[24px] placeholder:text-slate-400"
              data-testid="chat-input"
            />
            <Button
              onClick={() => submit()}
              disabled={busy || !draft.trim()}
              className="rounded-xl font-semibold h-9 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: BRAND.royal, color: '#FFFFFF' }}
              data-testid="chat-send"
            >
              <Send className="h-4 w-4 sm:mr-1.5" /> <span className="hidden sm:inline">{busy ? 'Sending…' : 'Send'}</span>
            </Button>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10.5px] px-1" style={{ color: BRAND.muted }}>
            <span>⌘ / Ctrl + Enter to send</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: BRAND.emerald }} />
              Live · grounded · audit-logged
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
