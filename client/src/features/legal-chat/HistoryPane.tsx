/**
 * HistoryPane — sidebar list of the SME's prior LegalChat sessions.
 * Click to load the message history into the active ChatPane.
 * Pulls from GET /api/jrx/legal-chat/sessions; load uses GET /sessions/:id.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { legalChatApi } from '@/services/legal-chat-api';
import { Plus, MessageSquare, RefreshCw, Clock } from 'lucide-react';
import { BRAND } from './brand';

export interface SessionRow {
  id: string;
  title: string;
  jurisdictions?: string[];
  tier?: string;
  mode?: string;
  last_used_at?: string;
  created_at?: string;
}

interface HistoryPaneProps {
  activeSessionId: string | null;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  reloadKey?: number;
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function HistoryPane({ activeSessionId, onOpenSession, onNewChat, reloadKey }: HistoryPaneProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = (await legalChatApi.listSessions()) as { sessions?: SessionRow[] } | null;
      setSessions(r?.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reloadKey]);

  return (
    <div className="h-full flex flex-col p-3" style={{ background: BRAND.surface }}>
      <Button
        onClick={onNewChat}
        className="w-full mb-3 font-semibold rounded-xl"
        style={{ background: BRAND.royal, color: '#FFFFFF' }}
        data-testid="history-new"
      >
        <Plus className="h-4 w-4 mr-1.5" /> New chat
      </Button>

      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3" style={{ color: BRAND.gold }} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: BRAND.muted }}>History</span>
          <span className="text-[10px] text-slate-400">({sessions.length})</span>
        </div>
        <button
          onClick={load}
          className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:text-[#152448] hover:bg-slate-100"
          data-testid="history-refresh"
          title="Refresh"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 -mr-1 pr-1">
        {sessions.length === 0 && !loading && (
          <div className="text-center py-8 px-3">
            <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <div className="text-[11px] text-slate-400 leading-relaxed">
              No prior chats yet. Start a new conversation above.
            </div>
          </div>
        )}
        {sessions.map((s) => {
          const active = s.id === activeSessionId;
          return (
            <button
              key={s.id}
              onClick={() => onOpenSession(s.id)}
              data-testid={`history-item-${s.id}`}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-start gap-2 border transition-all ${
                active
                  ? 'border-transparent'
                  : 'bg-white border-slate-200 hover:border-[#C7B15B] hover:bg-slate-50'
              }`}
              style={active ? { background: BRAND.royalSoft, borderColor: BRAND.royal } : undefined}
            >
              <MessageSquare className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" style={{ color: active ? BRAND.royal : BRAND.gold }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate font-semibold" style={{ color: BRAND.ink }}>
                  {s.title || s.id.slice(0, 8)}
                </span>
                <span className="block text-[10px] mt-0.5" style={{ color: BRAND.muted }}>
                  <span className="inline-block px-1.5 py-0.5 rounded mr-1 font-mono bg-slate-100">
                    {(s.jurisdictions || []).join(',') || '—'}
                  </span>
                  {s.mode || 'chat'} · {timeAgo(s.last_used_at)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
