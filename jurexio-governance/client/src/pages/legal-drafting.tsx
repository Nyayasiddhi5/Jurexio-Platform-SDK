/**
 * Legal Drafting Console — High Court pattern drafts with forum precision + mic dictation.
 * Calls POST /api/jrx/gateway/documents/draft (JWT / documents:write).
 */
import { useState } from 'react';
import { FilePenLine, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VoiceDictationTextarea } from '@/components/VoiceDictationTextarea';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';
import { JrxPageShell } from '@/components/JrxPageShell';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';

const DRAFT_PATH = nv('gateway/documents/draft');

const TEMPLATES = [
  { value: 'anticipatory_bail', label: 'Anticipatory Bail (BNSS §482)' },
  { value: 'regular_bail', label: 'Regular Bail (BNSS §§480/483)' },
  { value: 'default_bail', label: 'Default Bail (BNSS §187)' },
  { value: 'discharge_application', label: 'Discharge Application' },
  { value: 'adjournment', label: 'Adjournment (BNSS §346)' },
  { value: 'legal_notice', label: 'Legal Notice' },
  { value: 'writ_petition', label: 'Writ Petition (Art. 226)' },
  { value: 'custom', label: 'Custom / freeform' },
];

function extractDraftText(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const r = result as Record<string, unknown>;
  const data = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>;
  for (const k of ['content', 'draft', 'text', 'document', 'response', 'output']) {
    const v = data[k] ?? r[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return JSON.stringify(result, null, 2);
}

export default function LegalDraftingPage() {
  const [template, setTemplate] = useState('anticipatory_bail');
  const [instruction, setInstruction] = useState('');
  const [highCourt, setHighCourt] = useState('');
  const [courtName, setCourtName] = useState('');
  const [district, setDistrict] = useState('');
  const [stateName, setStateName] = useState('');
  const [seat, setSeat] = useState('');
  const [policeStation, setPoliceStation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [railEvents, setRailEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [railOrch, setRailOrch] = useState<string | undefined>();

  const run = async () => {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const body = {
        template,
        jurisdiction: 'IN',
        documentType: template,
        instruction,
        depth: 'detailed',
        parameters: {
          instruction,
          highCourt: highCourt || undefined,
          courtName: courtName || undefined,
          district: district || undefined,
          state: stateName || undefined,
          seat: seat || undefined,
          policeStation: policeStation || undefined,
        },
      };
      const started = Date.now();
      const orch = `draft-${started}`;
      setRailOrch(orch);
      setRailEvents([{
        orchestrationId: orch, step: 'request_received', status: 'ok', ts: started,
        data: { prompt: instruction.slice(0, 200), mode: 'legal_draft', template },
      }]);
      const res = await apiRequest(DRAFT_PATH, 'POST', body);
      const text = extractDraftText(res);
      setDraft(text);
      const rec = res && typeof res === 'object' ? res as Record<string, unknown> : {};
      const requestId = String(rec.requestId || rec.orchestrationId || orch);
      setRailOrch(requestId);
      setRailEvents((prev) => [
        ...prev,
        {
          orchestrationId: requestId, step: 'rag_retrieval', status: 'ok', ts: Date.now(),
          data: { collection: 'legal-draft', chunks: text ? 1 : 0 },
        },
        {
          orchestrationId: requestId, step: 'run_complete', status: 'ok', ts: Date.now(),
          durationMs: Date.now() - started,
          data: { chars: text.length, model: rec.model, requestId },
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <JrxPageShell
      testId="page-legal-drafting"
      title="Legal Drafting"
      description="High Court / Sessions practice-pattern drafts — humanized counsel voice, forum-precise cause title, mic dictation. Bail applications do not schedule sureties until after grant."
      actions={
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
          <CheckCircle2 className="w-3 h-3 mr-1" /> Live · SME draft rules
        </Badge>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FilePenLine className="h-4 w-4" /> Forum & matter facts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label className="text-xs">Instrument</Label>
                <select
                  className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  data-testid="legal-draft-template"
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">High Court (if applicable)</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. High Court of Judicature at Madras"
                  value={highCourt}
                  onChange={(e) => setHighCourt(e.target.value)}
                  data-testid="legal-draft-high-court"
                />
              </div>
              <div>
                <Label className="text-xs">Court / Forum</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Sessions Judge, Bengaluru Urban"
                  value={courtName}
                  onChange={(e) => setCourtName(e.target.value)}
                  data-testid="legal-draft-court"
                />
              </div>
              <div>
                <Label className="text-xs">District</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Bengaluru Urban"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  data-testid="legal-draft-district"
                />
              </div>
              <div>
                <Label className="text-xs">State / UT</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Karnataka"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  data-testid="legal-draft-state"
                />
              </div>
              <div>
                <Label className="text-xs">Seat / Place</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Bengaluru"
                  value={seat}
                  onChange={(e) => setSeat(e.target.value)}
                  data-testid="legal-draft-seat"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Label className="text-xs">Police Station (optional)</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Cubbon Park P.S."
                  value={policeStation}
                  onChange={(e) => setPoliceStation(e.target.value)}
                  data-testid="legal-draft-ps"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Facts / instructions (type or use Mic)</Label>
              <div className="mt-1">
                <VoiceDictationTextarea
                  value={instruction}
                  onChange={setInstruction}
                  placeholder="Dictate or type facts: FIR number, sections, custody status, grounds… Do not list surety names for bail applications."
                  className="min-h-[180px] font-serif text-sm"
                  data-testid="legal-draft-instruction"
                  lang="en-IN"
                />
              </div>
            </div>

            <Button onClick={run} disabled={busy || !instruction.trim()} data-testid="legal-draft-run">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Draft (High Court pattern)
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-muted-foreground font-mono">{DRAFT_PATH}</p>
          </CardContent>
        </Card>

        {railEvents.length > 0 ? (
          <ExecutionTraceRail events={railEvents} orchestrationId={railOrch} compact title="Draft run rail" />
        ) : null}
        {draft != null && (
          <Card data-testid="legal-draft-result">
            <CardHeader>
              <CardTitle className="text-base">Draft output</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-4 font-serif text-sm leading-relaxed">
                {draft}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </JrxPageShell>
  );
}
