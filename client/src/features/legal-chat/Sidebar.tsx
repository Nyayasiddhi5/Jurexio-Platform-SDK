import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { legalChatApi } from '@/services/legal-chat-api';
import {
  Upload, X, FileText, Globe2, Crown, Workflow, Bot, Cpu,
  SlidersHorizontal, FolderOpen, Search, ChevronDown, Sparkles,
  Coins, Brain, Code2, Eye,
} from 'lucide-react';
import { BRAND } from './brand';
import { JRX_JURISDICTION_CATALOG } from '@shared/jrx-jurisdiction-catalog';

const JURISDICTIONS = JRX_JURISDICTION_CATALOG.map((j) => ({ code: j.code, label: j.name }));
const TIERS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'solo', label: 'Solo', hint: 'Individual practitioner' },
  { value: 'pro', label: 'Pro', hint: 'Law firm — recommended' },
  { value: 'enterprise', label: 'Enterprise', hint: 'In-house counsel' },
  { value: 'ministry', label: 'Ministry', hint: 'Government / judiciary' },
];
const MODES = [
  { value: 'chat', label: 'Free chat', hint: 'Open-ended legal Q&A' },
  { value: 'drafting', label: 'Drafting', hint: 'Contracts, notices, opinions' },
  { value: 'document-qa', label: 'Document Q&A', hint: 'Ask questions on uploads' },
  { value: 'statute-lookup', label: 'Statute lookup', hint: 'Cite-back from primary law' },
  { value: 'compliance-review', label: 'Compliance review', hint: 'Risk + remediation matrix' },
  { value: 'litigation-strategy', label: 'Litigation strategy', hint: 'Arguments + precedent map' },
];

interface AgentSummary {
  id: string;
  name?: string;
  jurisdictions?: string[];
  category?: string;
  practiceArea?: string;
}

interface ModelSummary {
  id: string;
  name?: string;
  provider?: string;
  contextLength?: number;
  costInPer1M?: number;
  costOutPer1M?: number;
}

interface UploadedFileResponse {
  id: string;
  name: string;
}

type RoutingFlag = 'preferCheaper' | 'requireReasoning' | 'requireJson' | 'requireVision';

const ROUTING_FLAGS: ReadonlyArray<{
  key: RoutingFlag;
  label: string;
  hint: string;
  Icon: typeof Coins;
}> = [
  { key: 'preferCheaper', label: 'Cost-saver', hint: 'Prefer cheaper models when quality permits', Icon: Coins },
  { key: 'requireReasoning', label: 'Deep reasoning', hint: 'Force chain-of-thought class models', Icon: Brain },
  { key: 'requireJson', label: 'Structured JSON', hint: 'Machine-parsable output', Icon: Code2 },
  { key: 'requireVision', label: 'Vision', hint: 'Allow image / scan understanding', Icon: Eye },
];

export interface SidebarState {
  jurisdictions: string[];
  tier: string;
  mode: string;
  agentId?: string;
  preferredModel?: string;
  preferCheaper: boolean;
  requireReasoning: boolean;
  requireJson: boolean;
  requireVision: boolean;
  fileIds: string[];
  uploadedFiles: { id: string; name: string }[];
}

interface SidebarProps {
  state: SidebarState;
  onChange: (next: SidebarState) => void;
}

function SectionLabel({ Icon, children, accent }: { Icon: typeof Globe2; children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-3.5 w-3.5" style={{ color: BRAND.gold }} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: BRAND.muted }}>{children}</span>
      {accent && <span className="ml-auto text-[10px] text-slate-400">{accent}</span>}
    </div>
  );
}

const SELECT_CLS =
  'w-full bg-white text-slate-800 border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm appearance-none ' +
  'focus:outline-none focus:ring-2 focus:ring-[#C7B15B]/40 focus:border-[#C7B15B] hover:border-slate-300 cursor-pointer';

function StyledSelect<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; hint?: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={SELECT_CLS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}{o.hint ? ` — ${o.hint}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

export function Sidebar({ state, onChange }: SidebarProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [filterAgent, setFilterAgent] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [uploading, setUploading] = useState(false);

  const primaryJ = state.jurisdictions[0] || 'US';
  useEffect(() => {
    legalChatApi
      .listAgents(primaryJ)
      .then((r) => setAgents((r as { agents?: AgentSummary[] } | null)?.agents ?? []))
      .catch(() => setAgents([]));
  }, [primaryJ]);
  useEffect(() => {
    legalChatApi
      .listModels()
      .then((r) => setModels((r as { models?: ModelSummary[] } | null)?.models ?? []))
      .catch(() => setModels([]));
  }, []);

  const toggleJurisdiction = (j: string) => {
    const has = state.jurisdictions.includes(j);
    onChange({ ...state, jurisdictions: has ? state.jurisdictions.filter((x) => x !== j) : [...state.jurisdictions, j] });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const r = (await legalChatApi.uploadFiles(Array.from(files))) as
        | { files?: UploadedFileResponse[] }
        | null;
      const newOnes: UploadedFileResponse[] = (r?.files ?? []).map((f) => ({
        id: f.id,
        name: f.name,
      }));
      onChange({
        ...state,
        fileIds: [...state.fileIds, ...newOnes.map((f) => f.id)],
        uploadedFiles: [...state.uploadedFiles, ...newOnes],
      });
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (id: string) => {
    onChange({
      ...state,
      fileIds: state.fileIds.filter((x) => x !== id),
      uploadedFiles: state.uploadedFiles.filter((f) => f.id !== id),
    });
  };

  const filteredAgents = agents.filter((a) =>
    !filterAgent || a.name?.toLowerCase().includes(filterAgent.toLowerCase()) || a.id?.toLowerCase().includes(filterAgent.toLowerCase()),
  ).slice(0, 50);
  const filteredModels = models.filter((m) =>
    !filterModel || m.id?.toLowerCase().includes(filterModel.toLowerCase()),
  ).slice(0, 50);

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full" style={{ background: BRAND.surface }}>
      <div>
        <SectionLabel Icon={Globe2} accent={`${state.jurisdictions.length} selected`}>Jurisdictions</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {JURISDICTIONS.map((j) => {
            const active = state.jurisdictions.includes(j.code);
            return (
              <button
                key={j.code}
                onClick={() => toggleJurisdiction(j.code)}
                title={j.label}
                aria-label={`${j.label} (${j.code})`}
                aria-pressed={active}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all ${
                  active ? 'border-transparent text-white' : 'bg-white text-slate-600 border-slate-200 hover:border-[#C7B15B]'
                }`}
                style={active ? { background: BRAND.royal } : undefined}
              >{j.code}</button>
            );
          })}
        </div>
      </div>

      <div>
        <SectionLabel Icon={Crown}>Tier</SectionLabel>
        <StyledSelect value={state.tier} onChange={(v) => onChange({ ...state, tier: v })} options={TIERS} />
      </div>

      <div>
        <SectionLabel Icon={Workflow}>Mode</SectionLabel>
        <StyledSelect value={state.mode} onChange={(v) => onChange({ ...state, mode: v })} options={MODES} />
      </div>

      <div>
        <SectionLabel Icon={Bot} accent={`${agents.length} for ${primaryJ}`}>Agent</SectionLabel>
        <div className="relative mb-2">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            placeholder="Search agents…"
            className="pl-8 bg-white border-slate-200 text-slate-800 text-sm focus-visible:ring-[#C7B15B]/40"
          />
        </div>
        <div className="relative">
          <select
            value={state.agentId || ''}
            onChange={(e) => onChange({ ...state, agentId: e.target.value || undefined })}
            className={SELECT_CLS}
          >
            <option value="">— auto-select best agent —</option>
            {filteredAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id} {a.practiceArea ? `· ${a.practiceArea}` : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div>
        <SectionLabel Icon={Cpu} accent={`${models.length} available`}>Model</SectionLabel>
        <div className="relative mb-2">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            placeholder="Search models…"
            className="pl-8 bg-white border-slate-200 text-slate-800 text-sm focus-visible:ring-[#C7B15B]/40"
          />
        </div>
        <div className="relative">
          <select
            value={state.preferredModel || ''}
            onChange={(e) => onChange({ ...state, preferredModel: e.target.value || undefined })}
            className={SELECT_CLS}
          >
            <option value="">— auto-route (recommended) —</option>
            {filteredModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider} · ${m.costInPer1M ?? '—'}/M
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div>
        <SectionLabel Icon={SlidersHorizontal}>Routing flags</SectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {ROUTING_FLAGS.map(({ key, label, hint, Icon }) => {
            const active = state[key];
            return (
              <button
                key={key}
                onClick={() => onChange({ ...state, [key]: !active })}
                title={hint}
                aria-label={`${label} — ${hint}`}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all text-left ${
                  active ? '' : 'bg-white text-slate-500 border-slate-200 hover:border-[#C7B15B]/60'
                }`}
                style={active ? { background: BRAND.goldSoft, color: '#7A6A1F', borderColor: BRAND.goldBorder } : undefined}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: active ? BRAND.gold : '#94a3b8' }} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <SectionLabel Icon={FolderOpen} accent={state.uploadedFiles.length ? `${state.uploadedFiles.length} attached` : ''}>
          Documents
        </SectionLabel>
        <label className="cursor-pointer flex flex-col items-center justify-center gap-1 px-3 py-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg text-xs hover:border-[#C7B15B] hover:bg-[#FBF9F0] transition-all text-center">
          <Upload className="h-5 w-5" style={{ color: BRAND.gold }} />
          <span className="font-medium" style={{ color: BRAND.ink }}>{uploading ? 'Uploading…' : 'Drop or click to upload'}</span>
          <span className="text-[10px] text-slate-400">pdf · docx · pptx · xlsx · csv · txt · md · jpg · png</span>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.html,.htm,.rtf,.json,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label>
        {state.uploadedFiles.length > 0 && (
          <div className="mt-2 space-y-1">
            {state.uploadedFiles.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-[11px] bg-white border border-slate-200 rounded-md px-2 py-1.5">
                <span className="flex items-center gap-1.5 truncate" style={{ color: BRAND.ink }}>
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" style={{ color: BRAND.gold }} />
                  <span className="truncate">{f.name}</span>
                </span>
                <button onClick={() => removeFile(f.id)} className="text-slate-400 hover:text-red-500 ml-2 flex-shrink-0" title="Remove">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-slate-200 text-[10px] flex items-center gap-1.5" style={{ color: BRAND.muted }}>
        <Sparkles className="h-3 w-3" style={{ color: BRAND.gold }} />
        Every run is audited & feeds the GRPO trainer.
      </div>
    </div>
  );
}
