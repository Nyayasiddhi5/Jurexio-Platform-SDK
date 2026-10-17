import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Enterprise Platform SDK API Tester — Postman-style
 * Auto-injects SDK key, full response inspector, template library.
 */

import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Send, Plus, Trash2, Copy, CheckCircle2, Clock, Code2,
  ChevronDown, ChevronRight, Beaker, Zap, RefreshCw,
  Activity, FileText,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Header { key: string; value: string; enabled: boolean; }
interface ApiResponse { status: number; statusText: string; headers: Record<string, string>; body: string; duration: number; }
interface Template { label: string; method: HttpMethod; path: string; body?: string; category: string; }

const TEMPLATES: Template[] = [
  { label: 'Health Check', method: 'GET', path: nv('health'), category: 'Core' },
  { label: 'Full Health', method: 'GET', path: nv('health/full'), category: 'Core' },
  { label: 'List Agents', method: 'GET', path: nv('agents'), category: 'Agents' },
  { label: 'List Platforms', method: 'GET', path: nv('platforms'), category: 'Platforms' },
  { label: 'SDK Keys Status', method: 'GET', path: nv('sdk/keys/{appId}/status'), category: 'SDK' },
  { label: 'Validate SDK Key', method: 'POST', path: nv('sdk/provision/validate'), body: '{"api_key":"nyv_test_sk_..."}', category: 'SDK' },
  { label: 'List LLM Models', method: 'GET', path: nv('models'), category: 'LLM' },
  { label: 'LLM Priority', method: 'GET', path: nv('llm/priority'), category: 'LLM' },
  { label: 'Dashboard Insights (E1)', method: 'POST', path: nv('v1/sdk/intelligence/dashboard-insights'), body: '{"firm_data":{"firm_name":"Test Firm","active_cases":25,"pending_hearings":5,"overdue_tasks":2,"revenue_ytd_inr":2000000,"jurisdiction":"IN"}}', category: 'Intelligence' },
  { label: 'Portfolio Risk (E10)', method: 'POST', path: nv('v1/sdk/intelligence/portfolio-risk-analysis'), body: '{"firm_name":"Test Firm","total_cases":25,"active_matters":20,"cases_summary":[],"jurisdiction":"IN"}', category: 'Intelligence' },
  { label: 'Case Risk (E2)', method: 'POST', path: nv('v1/sdk/intelligence/case-risk-analysis'), body: '{"case_id":"C-001","case_type":"Civil","jurisdiction":"IN","filing_date":"2025-01-01","parties":{"plaintiff":"A","defendant":"B"},"case_summary":"Contract dispute"}', category: 'Intelligence' },
  { label: 'Legal Research (E8)', method: 'POST', path: nv('v1/sdk/intelligence/legal-research'), body: '{"query":"Section 138 Negotiable Instruments Act","jurisdiction":"IN","depth":"standard"}', category: 'Intelligence' },
  { label: 'AI Completions', method: 'POST', path: nv('completions'), body: '{"prompt":"Explain Article 21 of the Indian Constitution in simple terms.","agentKey":"legal-researcher-v5","jurisdiction":"IN","stream":false}', category: 'Core' },
  { label: 'List Tenants', method: 'GET', path: nv('tenants'), category: 'Admin' },
  { label: 'Feature Flags', method: 'GET', path: nv('flags'), category: 'Admin' },
];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/20 text-emerald-300',
  POST: 'bg-blue-500/20 text-blue-300',
  PUT: 'bg-amber-500/20 text-amber-300',
  PATCH: 'bg-orange-500/20 text-orange-300',
  DELETE: 'bg-red-500/20 text-red-300',
};

const STATUS_COLORS: Record<string, string> = {
  '2': 'text-emerald-400',
  '3': 'text-amber-400',
  '4': 'text-orange-400',
  '5': 'text-red-400',
};

export default function SdkApiTester() {
  const { toast } = useToast();
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [url, setUrl] = useState(nv('health'));
  const [headers, setHeaders] = useState<Header[]>([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ method: HttpMethod; url: string; status: number; duration: number }>>([]);
  const [selectedCat, setSelectedCat] = useState('All');
  const [autoInjectKey, setAutoInjectKey] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const { data: profile } = useQuery({
    queryKey: ['auth-me-tester'],
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) return null;
      let r = await fetch('/api/jrx/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 404) {
        r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      }
      return r.ok ? r.json() : null;
    },
  });

  const buildHeaders = (): Record<string, string> => {
    const result: Record<string, string> = {};
    headers.filter(h => h.enabled && h.key).forEach(h => { result[h.key] = h.value; });
    if (autoInjectKey) {
      const token = getAuthToken();
      if (token) result['Authorization'] = `Bearer ${token}`;
    }
    return result;
  };

  const sendRequest = async () => {
    setLoading(true);
    const start = Date.now();
    try {
      const opts: RequestInit = {
        method,
        headers: buildHeaders(),
      };
      if (['POST', 'PUT', 'PATCH'].includes(method) && body.trim()) {
        opts.body = body;
      }
      const resp = await fetch(url, opts);
      const duration = Date.now() - start;
      const respText = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((val, key) => { respHeaders[key] = val; });

      let prettyBody = respText;
      try { prettyBody = JSON.stringify(JSON.parse(respText), null, 2); } catch {}

      const result: ApiResponse = { status: resp.status, statusText: resp.statusText, headers: respHeaders, body: prettyBody, duration };
      setResponse(result);
      setHistory(prev => [{ method, url, status: resp.status, duration }, ...prev.slice(0, 19)]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResponse({ status: 0, statusText: 'Network Error', headers: {}, body: JSON.stringify({ error: msg }, null, 2), duration: Date.now() - start });
    } finally {
      setLoading(false);
    }
  };

  const applyTemplate = (t: Template) => {
    setMethod(t.method);
    setUrl(t.path);
    if (t.body) setBody(JSON.stringify(JSON.parse(t.body), null, 2));
    else setBody('');
  };

  const addHeader = () => setHeaders(h => [...h, { key: '', value: '', enabled: true }]);
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: keyof Header, val: string | boolean) =>
    setHeaders(h => h.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const cats = ['All', ...Array.from(new Set(TEMPLATES.map(t => t.category)))];
  const filteredTemplates = selectedCat === 'All' ? TEMPLATES : TEMPLATES.filter(t => t.category === selectedCat);

  const statusColor = response ? (STATUS_COLORS[String(response.status)[0]] ?? 'text-slate-600') : 'text-slate-600';

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4" aria-label="API Tester">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#152448] to-green-900">
            <Beaker className="w-4 h-4 text-[#C7B15B]" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-[#152448]">API Tester</h1>
          <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs">Postman-style</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={autoInjectKey}
            onChange={e => setAutoInjectKey(e.target.checked)}
            id="auto-inject"
            className="accent-[#152448]"
            aria-label="Auto-inject authorization header"
          />
          <label htmlFor="auto-inject" className="cursor-pointer">Auto-inject Auth</label>
          {profile?.user?.name && <Badge className="bg-slate-200 text-slate-700 text-[10px]">Signed in as {profile.user.name}</Badge>}
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4 h-[calc(100vh-130px)]">
        {/* Sidebar: Templates + History */}
        <div className="md:col-span-1 space-y-3 overflow-y-auto">
          {/* Template Library */}
          <Card className="bg-white border-slate-200/50">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs text-white flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" /> Templates
              </CardTitle>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {cats.map(c => (
                  <button
                    key={c}
                    onClick={() => setSelectedCat(c)}
                    className={cn('text-[9px] px-1.5 py-0.5 rounded font-medium transition-all', selectedCat === c ? 'bg-[#152448] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                    aria-pressed={selectedCat === c}
                    aria-label={`Filter by ${c}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1">
              {filteredTemplates.map((t, i) => (
                <button
                  key={i}
                  onClick={() => applyTemplate(t)}
                  className="w-full text-left flex items-center gap-2 p-1.5 rounded hover:bg-slate-100 transition-colors"
                  aria-label={`Load template: ${t.label}`}
                >
                  <span className={cn('text-[9px] px-1 rounded font-bold flex-shrink-0', METHOD_COLORS[t.method] ?? 'bg-slate-500/20 text-slate-700')} aria-label={`Method: ${t.method}`}>{t.method}</span>
                  <span className="text-xs text-slate-700 truncate">{t.label}</span>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* History */}
          {history.length > 0 && (
            <Card className="bg-white border-slate-200/50">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs text-white flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" /> History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-1">
                {history.slice(0, 8).map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span className={cn('px-1 rounded text-[9px] font-bold flex-shrink-0', METHOD_COLORS[h.method] ?? '')} aria-label={`Method: ${h.method}`}>{h.method}</span>
                    <span className={cn('font-bold flex-shrink-0', STATUS_COLORS[String(h.status)[0]] ?? 'text-slate-600')} aria-label={`Status: ${h.status}`}>{h.status}</span>
                    <span className="text-slate-700 truncate">{h.url}</span>
                    <span className="text-slate-600 flex-shrink-0 ml-auto">{h.duration}ms</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main: Request + Response */}
        <div className="md:col-span-3 flex flex-col gap-3">
          {/* URL Bar */}
          <div className="flex items-center gap-2">
            <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
              <SelectTrigger className={cn('w-28 border-slate-200 text-xs font-bold', METHOD_COLORS[method])} aria-label="HTTP method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-100 border-slate-200">
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map(m => (
                  <SelectItem key={m} value={m} className={METHOD_COLORS[m]}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendRequest(); }}
              placeholder={nv('...')}
              className="flex-1 bg-slate-100 border-slate-200 text-[#152448] font-mono text-sm"
              aria-label="Request URL"
            />
            <Button
              onClick={sendRequest}
              disabled={loading || !url}
              className="bg-[#152448] hover:bg-[#0a3580] text-white"
              aria-label="Send request"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
            </Button>
          </div>

          {/* Request Config Tabs */}
          <Card className="bg-white border-slate-200/50">
            <Tabs defaultValue="headers">
              <TabsList className="bg-slate-100 m-1">
                <TabsTrigger value="headers" className="text-xs">Headers ({headers.filter(h => h.enabled).length})</TabsTrigger>
                <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
              </TabsList>
              <TabsContent value="headers" className="p-3 pt-0">
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={h.enabled}
                        onChange={e => updateHeader(i, 'enabled', e.target.checked)}
                        className="accent-[#152448] flex-shrink-0"
                        aria-label={`Enable header ${h.key}`}
                      />
                      <Input value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)} placeholder="Header-Name" className="bg-slate-100 border-slate-200 text-slate-800 text-xs h-7 flex-1" aria-label="Header name" />
                      <Input value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)} placeholder="value" className="bg-slate-100 border-slate-200 text-slate-800 text-xs h-7 flex-1" aria-label="Header value" />
                      <Button size="sm" variant="ghost" onClick={() => removeHeader(i)} className="h-7 w-7 p-0 text-slate-700 hover:text-red-400" aria-label={`Remove header ${h.key}`}><Trash2 className="w-3 h-3" aria-hidden="true" /></Button>
                    </div>
                  ))}
                </div>
                <Button onClick={addHeader} variant="ghost" className="mt-2 h-7 text-xs text-slate-600 hover:text-white" aria-label="Add header">
                  <Plus className="w-3 h-3 mr-1" aria-hidden="true" /> Add Header
                </Button>
              </TabsContent>
              <TabsContent value="body" className="p-3 pt-0">
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder='{"key": "value"}'
                  className="w-full h-32 bg-slate-100 border border-slate-200 rounded-md text-[#152448] font-mono text-xs p-3 resize-none focus:outline-none focus:border-[#152448]"
                  aria-label="Request body (JSON)"
                />
                {body && (
                  <Button
                    variant="ghost"
                    className="mt-1 h-6 text-[10px] text-slate-600"
                    onClick={() => { try { setBody(JSON.stringify(JSON.parse(body), null, 2)); } catch {} }}
                    aria-label="Format JSON body"
                  >
                    Format JSON
                  </Button>
                )}
              </TabsContent>
            </Tabs>
          </Card>

          {/* Response Panel */}
          <Card className="bg-white border-slate-200/50 flex-1 min-h-0">
            <CardHeader className="pb-2 flex flex-row items-center gap-3">
              <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-400" aria-hidden="true" /> Response
              </CardTitle>
              {response && (
                <div className="flex items-center gap-3 ml-2">
                  <span className={cn('text-sm font-bold', statusColor)} aria-label={`HTTP status: ${response.status}`}>{response.status} {response.statusText}</span>
                  <span className="text-xs text-slate-600 flex items-center gap-1" aria-label={`Duration: ${response.duration}ms`}>
                    <Clock className="w-3 h-3" aria-hidden="true" />{response.duration}ms
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-slate-600"
                    onClick={() => navigator.clipboard.writeText(response.body).then(() => toast({ title: 'Copied' }))}
                    aria-label="Copy response body"
                  >
                    <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0 h-full overflow-hidden">
              {!response && !loading && (
                <div className="flex items-center justify-center h-32 text-slate-700 text-sm">
                  Send a request to see the response
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw className="w-6 h-6 text-[#152448] animate-spin" aria-hidden="true" />
                </div>
              )}
              {response && !loading && (
                <Tabs defaultValue="body" className="h-full">
                  <TabsList className="bg-slate-100 mx-3 mb-1">
                    <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
                    <TabsTrigger value="headers" className="text-xs">Headers ({Object.keys(response.headers).length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="body" className="m-0 h-full">
                    <pre className="overflow-auto p-3 text-xs font-mono text-slate-700 h-48 max-h-64" aria-label="Response body">{response.body}</pre>
                  </TabsContent>
                  <TabsContent value="headers" className="p-3">
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(response.headers).map(([k, v]) => (
                        <div key={k} className="flex items-start gap-2 text-xs">
                          <span className="text-slate-600 font-medium min-w-32 flex-shrink-0">{k}</span>
                          <span className="text-slate-700 break-all">{v}</span>
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
