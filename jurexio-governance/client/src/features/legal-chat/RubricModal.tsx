import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { legalChatApi } from '@/services/legal-chat-api';
import { BRAND } from './brand';

const CRITERIA = [
  { key: 'legalAccuracy', label: 'Legal accuracy' },
  { key: 'jurisdictionalFit', label: 'Jurisdictional fit' },
  { key: 'draftingQuality', label: 'Drafting quality' },
  { key: 'citationGrounding', label: 'Citation grounding' },
  { key: 'reasoningDepth', label: 'Reasoning depth' },
];

interface RubricModalProps {
  open: boolean;
  onClose: () => void;
  orchestrationId?: string;
  sessionId?: string;
}

export function RubricModal({ open, onClose, orchestrationId, sessionId }: RubricModalProps) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [thumb, setThumb] = useState<'up' | 'down' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!orchestrationId) return;
    setBusy(true);
    try {
      await legalChatApi.postFeedback({
        orchestrationId,
        sessionId,
        ratings: { ...ratings, thumb: thumb || '' },
        comment: comment.trim() || undefined,
      });
      setDone(true);
      setTimeout(() => { onClose(); setDone(false); setRatings({}); setComment(''); setThumb(null); }, 800);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-white border-slate-200 text-slate-800 max-w-lg">
        <DialogHeader>
          <DialogTitle style={{ color: BRAND.royal }}>Rate this answer</DialogTitle>
          <p className="text-xs" style={{ color: BRAND.muted }}>
            Score 1–5 across each criterion. Feeds the offline GRPO retrainer.
            {orchestrationId ? <span className="font-mono"> · {orchestrationId.slice(0, 12)}…</span> : null}
          </p>
        </DialogHeader>
        <div className="space-y-3">
          {CRITERIA.map(({ key, label }) => (
            <div key={key}>
              <Label className="text-xs" style={{ color: BRAND.ink }}>{label}</Label>
              <div className="flex gap-2 mt-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = ratings[key] === n;
                  return (
                    <button
                      key={n}
                      onClick={() => setRatings({ ...ratings, [key]: n })}
                      className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors ${
                        active ? 'border-transparent text-white' : 'bg-white text-slate-600 border-slate-200 hover:border-[#C7B15B]'
                      }`}
                      style={active ? { background: BRAND.royal } : undefined}
                    >{n}</button>
                  );
                })}
              </div>
            </div>
          ))}
          <div>
            <Label className="text-xs" style={{ color: BRAND.ink }}>Overall</Label>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setThumb('up')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors ${
                  thumb === 'up' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-400'
                }`}
              ><ThumbsUp className="h-4 w-4" /> Up</button>
              <button
                onClick={() => setThumb('down')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors ${
                  thumb === 'down' ? 'bg-red-500 border-red-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-red-400'
                }`}
              ><ThumbsDown className="h-4 w-4" /> Down</button>
            </div>
          </div>
          <div>
            <Label className="text-xs" style={{ color: BRAND.ink }}>Comment (optional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What was wrong / what should have been said?"
              className="mt-1 bg-white border-slate-200 text-slate-800 text-sm"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</Button>
          <Button
            onClick={submit}
            disabled={busy || !orchestrationId}
            className="font-semibold text-white"
            style={{ background: BRAND.royal }}
          >
            {busy ? 'Saving…' : done ? 'Saved ✓' : 'Submit feedback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
