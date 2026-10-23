/**
 * JrxChatWidget — Embeddable OpenBot™ Chat Widget
 * Jurexio Enterprise Platform 1.0.0
 *
 * Drop-in embeddable legal AI chatbot widget for any web page.
 * Self-contained: bundles its own state, API calls, styles, and governance badge.
 *
 * Usage (on any page — inside or outside the main app):
 *   <JrxChatWidget botId="CLW-DEMO001" apiBase="https://app.jurexio.com" />
 *   <JrxChatWidget botId="CLW-DEMO001" position="bottom-right" />
 *
 * Theme: defaults to `'light'` to match the Jurexio brand palette
 * (decided in task-210 — Console is light-only). Pass `theme="dark"`
 * **explicitly** when embedding into a dark host page; this is an
 * opt-in escape hatch for external partners only and is NOT used
 * anywhere inside the Console.
 *
 * Embeddable via React portal so it overlays any host page.
 *
 * @file client/src/components/JrxChatWidget.tsx
 * @version 5.0.0
 */

import React, {
  useState, useRef, useCallback, useEffect, forwardRef,
} from 'react';
import { JrxGovernanceBadge } from './JrxGovernanceBadge';

import { NV_BASE } from '../lib/jrx-api-paths';
// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type WidgetTheme   = 'dark' | 'light';
export type WidgetPos     = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface JrxChatWidgetProps {
  botId:       string;
  apiBase?:    string;
  authToken?:  string;
  jurisdiction?: string;
  theme?:      WidgetTheme;
  position?:   WidgetPos;
  greeting?:   string;
  brandColor?: string;
  poweredBy?:  boolean;
  onOpen?:     () => void;
  onClose?:    () => void;
  onMessage?:  (msg: ChatMessage) => void;
}

interface ChatMessage {
  id:          string;
  role:        'user' | 'bot' | 'system';
  content:     string;
  timestamp:   string;
  governance?: {
    risk_score:   number;
    risk_badge:   'GREEN' | 'YELLOW' | 'RED';
    risk_blocked: boolean;
    warnings?:    string[];
    pattern_key?: string;
    audit_hash?:  string;
    timestamp?:   string;
  };
  escalated?:  boolean;
  intent?:     string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function ts(): string {
  return new Date().toISOString();
}

const POSITION_CLASSES: Record<WidgetPos, string> = {
  'bottom-right': 'bottom-6 right-6',
  'bottom-left':  'bottom-6 left-6',
  'top-right':    'top-6 right-6',
  'top-left':     'top-6 left-6',
};

// ─────────────────────────────────────────────────────────────────────────────
// JrxChatWidget — main component
// ─────────────────────────────────────────────────────────────────────────────

export const JrxChatWidget = forwardRef<HTMLDivElement, JrxChatWidgetProps>(
  (
    {
      botId,
      apiBase     = '',
      authToken,
      jurisdiction = 'IN',
      theme        = 'light',
      position     = 'bottom-right',
      greeting     = 'Namaste! I am your AI legal assistant. How may I help you today?',
      brandColor   = '#C9A961',
      poweredBy    = true,
      onOpen,
      onClose,
      onMessage,
    },
    ref,
  ) => {
    const [open, setOpen]       = useState(false);
    const [messages, setMsgs]   = useState<ChatMessage[]>([]);
    const [input, setInput]     = useState('');
    const [loading, setLoading] = useState(false);
    const [sessionId, setSid]   = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const isDark = theme === 'dark';

    // Greeting on first open
    useEffect(() => {
      if (open && messages.length === 0) {
        setMsgs([{
          id:        uid(),
          role:      'bot',
          content:   greeting,
          timestamp: ts(),
          governance: {
            risk_score: 0, risk_badge: 'GREEN', risk_blocked: false,
            warnings: [], pattern_key: 'CLAWDBOT', timestamp: ts(),
          },
        }]);
      }
    }, [open, greeting, messages.length]);

    // Scroll to bottom on new message
    useEffect(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    const toggle = useCallback(() => {
      setOpen((o) => {
        const next = !o;
        next ? onOpen?.() : onClose?.();
        return next;
      });
    }, [onOpen, onClose]);

    const send = useCallback(async () => {
      const text = input.trim();
      if (!text || loading) return;
      setInput('');

      const userMsg: ChatMessage = { id: uid(), role: 'user', content: text, timestamp: ts() };
      setMsgs((prev) => [...prev, userMsg]);
      onMessage?.(userMsg);
      setLoading(true);

      try {
        const res = await fetch(`${apiBase}${NV_BASE}clawdbot/bots/${botId}/chat`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ message: text, sessionId, jurisdiction }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.success) {
          setSid(data.sessionId);
          const botMsg: ChatMessage = {
            id:         uid(),
            role:       'bot',
            content:    data.response ?? data.message ?? 'I could not process your query.',
            timestamp:  ts(),
            governance: data._nyv_governance ?? {
              risk_score: 15, risk_badge: 'GREEN', risk_blocked: false,
              pattern_key: 'CLAWDBOT', timestamp: ts(),
            },
            escalated: data.escalated ?? false,
            intent:    data.intent,
          };
          setMsgs((prev) => [...prev, botMsg]);
          onMessage?.(botMsg);
        } else {
          throw new Error(data.message ?? 'Service error');
        }
      } catch {
        const errMsg: ChatMessage = {
          id:        uid(),
          role:      'bot',
          content:   'I am temporarily unavailable. Please try again or contact a live advocate for urgent matters.',
          timestamp: ts(),
          governance: {
            risk_score: 0, risk_badge: 'GREEN', risk_blocked: false,
            warnings: ['Fallback response — offline mode'],
            pattern_key: 'CLAWDBOT', timestamp: ts(),
          },
        };
        setMsgs((prev) => [...prev, errMsg]);
      } finally {
        setLoading(false);
      }
    }, [input, loading, apiBase, botId, sessionId, jurisdiction, authToken, onMessage]);

    const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    }, [send]);

    // ── Render ───────────────────────────────────────────────────────────────

    // Light = Jurexio brand palette (content #F9FAFB / cards #FFFFFF /
    // ink #2B384C / gold #C9A961). Dark branch is preserved for opt-in
    // partner embeds against dark host pages.
    const bg      = isDark ? 'bg-[#0f0f18]' : 'bg-[#FFFFFF]';
    const border  = isDark ? 'border-white/10' : 'border-[#E5E7EB]';
    const text    = isDark ? 'text-white' : 'text-[#2B384C]';
    const muted   = isDark ? 'text-white/50' : 'text-[#6B7280]';
    const inputBg = isDark
      ? 'bg-white/5 placeholder-white/30 text-white'
      : 'bg-[#F9FAFB] placeholder-[#9CA3AF] text-[#2B384C]';

    return (
      <div
        ref={ref}
        className={`fixed z-[9999] ${POSITION_CLASSES[position]} flex flex-col items-end gap-3`}
        data-jrx-widget
        data-bot-id={botId}
        data-version="5.0.0"
      >
        {/* ── Chat panel ─────────────────────────────────────────────────── */}
        {open && (
          <div
            className={`
              ${bg} ${border} ${text}
              border rounded-2xl shadow-2xl flex flex-col overflow-hidden
              w-[380px] max-w-[calc(100vw-32px)]
              transition-all duration-300 ease-out
            `}
            style={{ height: '560px' }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ backgroundColor: brandColor }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                    <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-5h2v2h-2zm0-8h2v6h-2z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">ClaWdBot™ Legal AI</p>
                  <p className="text-[10px] text-white/70">Powered by Jurexio • {jurisdiction} Jurisdiction</p>
                </div>
              </div>
              <button
                onClick={toggle}
                className="text-white/70 hover:text-white transition-colors"
                aria-label="Close chat"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] space-y-1.5`}>
                    <div
                      className={`
                        rounded-2xl px-4 py-3 text-sm leading-relaxed
                        ${msg.role === 'user'
                          ? 'text-white rounded-br-sm'
                          : isDark
                            ? 'bg-white/8 text-white/90 rounded-bl-sm border border-white/10'
                            : 'bg-[#F9FAFB] text-[#2B384C] rounded-bl-sm border border-[#E5E7EB]'
                        }
                      `}
                      style={msg.role === 'user' ? { backgroundColor: brandColor } : {}}
                    >
                      {msg.content}
                    </div>

                    {/* Governance badge on bot messages */}
                    {msg.role === 'bot' && msg.governance && (
                      <JrxGovernanceBadge
                        compact
                        governance={msg.governance}
                        className="mt-1"
                      />
                    )}

                    {/* Escalation tag */}
                    {msg.escalated && (
                      <p className="text-[10px] text-orange-400 font-medium">
                        ⚡ Escalated to live advocate
                      </p>
                    )}

                    <p className={`text-[10px] ${muted}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className={`rounded-2xl rounded-bl-sm px-4 py-3 ${isDark ? 'bg-white/8 border border-white/10' : 'bg-[#F9FAFB] border border-[#E5E7EB] text-[#2B384C]'}`}>
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className={`shrink-0 p-3 border-t ${border}`}>
              <div className={`flex gap-2 items-end rounded-xl border ${border} p-2 ${isDark ? 'bg-white/5' : 'bg-[#F9FAFB]'}`}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask a legal question…"
                  rows={1}
                  disabled={loading}
                  className={`
                    flex-1 bg-transparent resize-none outline-none text-sm
                    ${inputBg} border-0 p-0
                    max-h-28 overflow-y-auto
                  `}
                  style={{ minHeight: '1.5rem' }}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-opacity disabled:opacity-40 hover:opacity-90"
                  style={{ backgroundColor: brandColor }}
                  aria-label="Send message"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
              </div>

              {poweredBy && (
                <p className={`text-center text-[10px] mt-2 ${muted}`}>
                  Powered by{' '}
                  <span className="font-semibold" style={{ color: brandColor }}>Jurexio™</span>
                  {' '}· AI outputs require qualified advocate review
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Launcher bubble ─────────────────────────────────────────────── */}
        <button
          onClick={toggle}
          aria-label={open ? 'Close legal assistant' : 'Open legal assistant'}
          className="w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-4 focus:ring-[#C9A961]/30"
          style={{ backgroundColor: brandColor }}
        >
          {open ? (
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-white stroke-2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
            </svg>
          )}
        </button>
      </div>
    );
  },
);

JrxChatWidget.displayName = 'JrxChatWidget';

export default JrxChatWidget;
