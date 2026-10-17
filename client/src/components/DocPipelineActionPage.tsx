/**
 * Thin Console wrapper around JWT-authenticated SDK docs-pipeline routes.
 * sdkGatewayAuth accepts internal JWT (documents:write scope) — no API key required.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2 } from 'lucide-react';
import type { ElementType } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';
import { VoiceDictationTextarea } from '@/components/VoiceDictationTextarea';
import { Input } from '@/components/ui/input';

export interface DocPipelineActionPageProps {
  title: string;
  description: string;
  icon: ElementType;
  pageDataTestId: string;
  apiPath: string;
  actionLabel: string;
  buildBody: (content: string, jurisdiction: string, style?: string) => Record<string, unknown>;
  showStyleSelect?: boolean;
}

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC'] as const;
const STYLES = [
  { value: 'brief', label: 'Executive brief' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'bullets', label: 'Bullet points' },
];

const BINARY_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'docx']);

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1]! : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function readFileAsText(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    const base64 = await fileToBase64(file);
    const extracted = await apiRequest(nv('sdk/docs-pipeline/documents/extract'), 'POST', {
      base64,
      fileName: file.name,
      mimeType: file.type || undefined,
    }) as { data?: { text?: string }; text?: string };
    const text = extracted?.data?.text ?? extracted?.text;
    if (!text?.trim()) throw new Error('No text extracted from file');
    return text;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function DocPipelineActionPage({
  title,
  description,
  icon: Icon,
  pageDataTestId,
  apiPath,
  actionLabel,
  buildBody,
  showStyleSelect,
}: DocPipelineActionPageProps) {
  const [content, setContent] = useState('');
  const [jurisdiction, setJurisdiction] = useState<string>('IN');
  const [style, setStyle] = useState('brief');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [district, setDistrict] = useState('');
  const [courtName, setCourtName] = useState('');

  const run = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = buildBody(content, jurisdiction, style);
      if (jurisdiction === 'IN') {
        if (district.trim()) (body as Record<string, unknown>).district = district.trim();
        if (courtName.trim()) (body as Record<string, unknown>).courtName = courtName.trim();
      }
      const data = await apiRequest(apiPath, 'POST', body);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try {
      const text = await readFileAsText(files[0]);
      setContent(text);
    } catch {
      setError('Could not read file');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid={pageDataTestId}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-emerald-50">
          <Icon className="w-6 h-6 text-emerald-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <Badge className="bg-emerald-600">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Live
            </Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">{description}</p>
          <p className="text-xs text-slate-500 mt-1 font-mono">{apiPath}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <Label className="text-xs">Jurisdiction</Label>
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"
                data-testid="doc-pipeline-jurisdiction"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </div>
            {showStyleSelect && (
              <div>
                <Label className="text-xs">Summary style</Label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-1 block rounded-md border border-slate-200 px-3 py-2 text-sm"
                  data-testid="doc-pipeline-style"
                >
                  {STYLES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            {jurisdiction === 'IN' && (
              <>
                <div>
                  <Label className="text-xs">District (optional)</Label>
                  <Input
                    className="mt-1"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="e.g. Bengaluru Urban"
                    data-testid="doc-pipeline-district"
                  />
                </div>
                <div>
                  <Label className="text-xs">Court / Forum (optional)</Label>
                  <Input
                    className="mt-1"
                    value={courtName}
                    onChange={(e) => setCourtName(e.target.value)}
                    placeholder="e.g. Sessions Judge / High Court of …"
                    data-testid="doc-pipeline-court"
                  />
                </div>
              </>
            )}
            <div className="flex items-end">
              <label className="cursor-pointer text-sm text-[#152448] underline">
                Upload text file
                <input type="file" accept=".txt,.md,.csv,.html,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => onFile(e.target.files)} />
              </label>
            </div>
          </div>
          <VoiceDictationTextarea
            value={content}
            onChange={setContent}
            placeholder="Paste document text, upload a file, or use Mic to dictate…"
            className="min-h-[200px] font-mono text-sm"
            data-testid="doc-pipeline-content"
            lang={jurisdiction === 'IN' ? 'en-IN' : 'en-US'}
          />
          <Button onClick={run} disabled={busy || !content.trim()} data-testid="doc-pipeline-run">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {actionLabel}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {result != null && (
        <Card data-testid="doc-pipeline-result">
          <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-50 p-3 rounded overflow-auto max-h-96">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const DOCS_PARSE_PATH = nv('sdk/docs-pipeline/documents/parse');
export const DOCS_EXTRACT_PATH = nv('sdk/docs-pipeline/documents/extract');
export const DOCS_SUMMARIZE_PATH = nv('sdk/docs-pipeline/documents/summarize');
