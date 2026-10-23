/**
 * NV-AUTOFILL-QA-001 — Internal Console page for autofill field review.
 * Calls /api/jrx/orchestrate with inline document text and surfaces
 * RESOLVED / LOW_CONFIDENCE / CONFLICT / ABSENT buckets from courtDocFieldBlock.
 */
import { useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { VoiceDictationTextarea } from '@/components/VoiceDictationTextarea';
import { apiRequest } from '@/lib/queryClient';
import { NV_API } from '@/lib/jrx-api-paths';

type FieldRow = {
  key: string;
  label: string;
  value: string;
  confidence?: number;
  status: 'RESOLVED' | 'LOW_CONFIDENCE' | 'CONFLICT' | 'ABSENT';
};

function bucketFields(data: Record<string, unknown>): FieldRow[] {
  const resolutions = Array.isArray((data.docparseMeta as Record<string, unknown>)?.resolutions)
    ? (data.docparseMeta as Record<string, unknown>).resolutions as Array<Record<string, unknown>>
    : [];
  const resolutionByPath = new Map(
    resolutions.map((r) => [String(r.fieldPath || r.key || ''), r]),
  );

  const rawFields = Array.isArray(data.fields) ? data.fields as Array<Record<string, unknown>> : [];
  const rows: FieldRow[] = [];

  for (const f of rawFields) {
    const key = String(f.key || f.label || 'field');
    const path = String(f.path || key);
    const res = resolutionByPath.get(path);
    const statusRaw = String(res?.status || '').toUpperCase();
    let status: FieldRow['status'] = 'RESOLVED';
    if (statusRaw === 'LOW_CONFIDENCE' || statusRaw === 'CONFLICT' || statusRaw === 'ABSENT') {
      status = statusRaw as FieldRow['status'];
    } else if (!f.value) {
      status = 'ABSENT';
    } else if (typeof f.confidence === 'number' && f.confidence < 0.6) {
      status = 'LOW_CONFIDENCE';
    }
    rows.push({
      key,
      label: String(f.label || key),
      value: f.value != null ? String(f.value) : '',
      confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
      status,
    });
  }

  for (const r of resolutions) {
    const path = String(r.fieldPath || '');
    if (!path || rows.some((row) => row.key === path)) continue;
    const statusRaw = String(r.status || 'ABSENT').toUpperCase() as FieldRow['status'];
    rows.push({
      key: path,
      label: path,
      value: r.chosen && typeof r.chosen === 'object'
        ? String((r.chosen as Record<string, unknown>).value ?? '')
        : '',
      confidence: typeof (r.chosen as Record<string, unknown>)?.confidence === 'number'
        ? (r.chosen as Record<string, unknown>).confidence as number
        : undefined,
      status: statusRaw,
    });
  }

  return rows;
}

const STATUS_VARIANT: Record<FieldRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  RESOLVED: 'default',
  LOW_CONFIDENCE: 'secondary',
  CONFLICT: 'destructive',
  ABSENT: 'outline',
};

function FieldTable({ title, rows }: { title: string; rows: FieldRow[] }) {
  if (!rows.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">None</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title} ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{row.label}</span>
              <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
            </div>
            <div className="mt-1 text-muted-foreground">{row.value || '—'}</div>
            {row.confidence != null && (
              <div className="mt-1 text-xs">confidence: {(row.confidence * 100).toFixed(0)}%</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AutofillQaReviewPage() {
  const [documentText, setDocumentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);

  const runReview = async () => {
    if (!documentText.trim()) return;
    setBusy(true);
    setError(null);
    setRows([]);
    setAnalysisStatus(null);
    try {
      const resp = await apiRequest(NV_API.ORCHESTRATE.path, 'POST', {
        prompt: 'Extract court filing autofill fields from this document for QA review.',
        documentContent: documentText,
        taskType: 'document_intelligence',
        jurisdiction: 'IN',
      }) as Record<string, unknown>;
      const data = (resp.data ?? resp) as Record<string, unknown>;
      setAnalysisStatus(String(data.analysisStatus ?? 'unknown'));
      setRows(bucketFields(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  };

  const resolved = rows.filter((r) => r.status === 'RESOLVED');
  const lowConf = rows.filter((r) => r.status === 'LOW_CONFIDENCE');
  const conflicts = rows.filter((r) => r.status === 'CONFLICT');
  const absent = rows.filter((r) => r.status === 'ABSENT');

  return (
    <div className="container max-w-5xl py-8 space-y-6" data-testid="page-autofill-qa">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Autofill QA Review</h1>
          <p className="text-muted-foreground text-sm">
            Review structured filing fields — conflicts, low-confidence, and absent values.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Document text</CardTitle>
          <CardDescription>Paste filing text or OCR output (≥220 chars recommended for court cues).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="doc-text">Content</Label>
            <VoiceDictationTextarea
              id="doc-text"
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              rows={12}
              placeholder="Paste petition, order, or notice text…"
            />
          </div>
          <Button onClick={runReview} disabled={busy || !documentText.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run autofill review
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {analysisStatus && (
            <p className="text-sm">
              analysisStatus: <Badge variant="outline">{analysisStatus}</Badge>
            </p>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <FieldTable title="Resolved" rows={resolved} />
          <FieldTable title="Low confidence" rows={lowConf} />
          <FieldTable title="Conflicts" rows={conflicts} />
          <FieldTable title="Absent" rows={absent} />
        </div>
      )}
    </div>
  );
}
