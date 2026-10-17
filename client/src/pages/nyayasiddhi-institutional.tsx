import React from 'react';

import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

type OrgType = 'law_firm' | 'corporate_legal' | 'judiciary' | 'government' | 'law_school' | 'legal_tech' | 'ngo' | 'other';
type Jurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GCC' | 'SG';

interface FormData {
  org_type: OrgType | '';
  org_name: string; team_size: string; jurisdiction: Jurisdiction | '';
  contact_name: string; contact_email: string; contact_phone: string;
  use_case: string; use_case_types: string[];
  integrations_needed: string[]; compliance_needs: string[];
  monthly_volume: string; go_live_timeline: string; additional_notes: string;
}

const initialForm: FormData = {
  org_type: '',
  org_name: '', team_size: '', jurisdiction: '',
  contact_name: '', contact_email: '', contact_phone: '',
  use_case: '', use_case_types: [],
  integrations_needed: [], compliance_needs: [],
  monthly_volume: '', go_live_timeline: '', additional_notes: '',
};

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const ORG_TYPES: { id: OrgType; label: string; icon: string; desc: string }[] = [
  { id: 'law_firm', label: 'Law Firm', icon: '⚖️', desc: 'Advocate offices, solicitor firms, chambers' },
  { id: 'corporate_legal', label: 'Corporate Legal', icon: '🏢', desc: 'In-house legal teams, GCs, CLOs' },
  { id: 'judiciary', label: 'Judiciary / Courts', icon: '🏛️', desc: 'District courts, High Courts, Supreme Court' },
  { id: 'government', label: 'Government / PSU', icon: '🇮🇳', desc: 'Central/state government, public sector units' },
  { id: 'law_school', label: 'Law School / University', icon: '🎓', desc: 'NLUs, law colleges, legal research institutions' },
  { id: 'legal_tech', label: 'Legal Tech Company', icon: '💡', desc: 'Companies building legal products' },
  { id: 'ngo', label: 'NGO / Public Interest', icon: '🤝', desc: 'Civil society, legal aid, public interest' },
  { id: 'other', label: 'Other Institution', icon: '🏗️', desc: 'Other institutional legal body' },
];

const USE_CASE_OPTIONS = [
  'Case management & tracking', 'Legal document drafting', 'Contract review & analysis',
  'Legal research & precedents', 'Compliance monitoring', 'Court filing assistance',
  'Client intake automation', 'Hearing notes & summaries', 'Multi-jurisdiction operations', 'Legal training & education',
];

const INTEGRATION_OPTIONS = [
  'Razorpay billing', 'WhatsApp messaging', 'Email (SMTP)', 'Slack/Teams',
  'Document management (SharePoint/Google Drive)', 'E-filing systems (courts)',
  'ERP/CRM integration', 'Custom API', 'SSO / SAML', 'On-premise deployment',
];

const COMPLIANCE_OPTIONS = [
  'DPDPA 2023 (India)', 'UK GDPR', 'SOC 2 Ready for Audit', 'ISO 27001',
  'Bar Council of India rules', 'SEBI/RBI regulations', 'Legal aid regulations', 'PCI DSS',
];

const JURISDICTIONS: { code: Jurisdiction; name: string }[] = [
  { code: 'IN', name: '🇮🇳 India' },
];

const TEAM_SIZES = ['1–10', '11–50', '51–200', '201–500', '501–1000', '1000+'];
const VOLUME_OPTIONS = ['< 100 AI queries/month', '100–500', '500–2000', '2000–10000', '10,000+'];
const TIMELINE_OPTIONS = ['Within 1 month', '1–3 months', '3–6 months', '6–12 months', 'Exploring / No timeline'];

const GOLD = '#C7B15B';
const GOLD_DIM = 'rgba(212,160,23,0.15)';
const GOLD_BORDER = 'rgba(212,160,23,0.3)';
const BG_CARD = 'rgba(255,255,255,0.04)';
const BG_CARD_HOVER = 'rgba(255,255,255,0.08)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT_MUTED = 'rgba(255,255,255,0.5)';
const TEXT_DIM = 'rgba(255,255,255,0.7)';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.06)',
  border: `1px solid ${BORDER}`, borderRadius: 8, color: '#fff', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', color: TEXT_DIM, fontSize: 12, fontWeight: 600,
  letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase',
};

const STEPS = [
  { n: 1, title: 'Organisation Type' }, { n: 2, title: 'Org Details' },
  { n: 3, title: 'Contact' }, { n: 4, title: 'Use Case' },
  { n: 5, title: 'Technical' }, { n: 6, title: 'Volume & Timeline' }, { n: 7, title: 'Review & Submit' },
];

export default function JurexioInstitutional() {
  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState<FormData>(initialForm);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [leadId, setLeadId] = React.useState('');

  const update = (field: keyof FormData, value: any) => setForm(f => ({ ...f, [field]: value }));
  const toggleArr = (field: keyof FormData, value: string) => {
    const arr = (form[field] as string[]) || [];
    update(field, arr.includes(value) ? arr.filter((v: string) => v !== value) : [...arr, value]);
  };

  const canNext = () => {
    if (step === 1) return !!form.org_type;
    if (step === 2) return !!(form.org_name && form.team_size && form.jurisdiction);
    if (step === 3) return !!(form.contact_name && form.contact_email);
    if (step === 4) return !!(form.use_case || form.use_case_types.length > 0);
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true); setError('');
    try {
      const res = await fetch(nv('institutional/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ ...form, step_completed: 7, source: 'institutional_wizard', form_data: form }),
      });
      const data = await res.json();
      if (data.success) { setLeadId(data.data?.lead_id || 'JRX-INST-' + Date.now()); setSubmitted(true); }
      else setError(data.error || 'Submission failed');
    } catch { setError('Network error — please try again'); }
    finally { setSubmitting(false); }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
        <div style={{ maxWidth: 520, textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🏛️</div>
          <h1 style={{ fontFamily: 'Merriweather, serif', color: '#fff', fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Proposal Request Received</h1>
          <p style={{ color: TEXT_DIM, fontSize: 15, marginBottom: 20 }}>Thank you, <strong style={{ color: '#fff' }}>{form.org_name}</strong>. Our institutional team will contact you at <strong style={{ color: GOLD }}>{form.contact_email}</strong> within 2 business days.</p>
          <div style={{ background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ color: GOLD, fontSize: 11, fontWeight: 600, letterSpacing: 1, marginBottom: 8 }}>REFERENCE NUMBER</div>
            <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{leadId}</div>
          </div>
          <a href="/" style={{ padding: '12px 32px', background: GOLD, borderRadius: 8, color: '#000', fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>Return to Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>
        <div className="text-center mb-8">
          <div style={{ fontSize: 44, marginBottom: 10 }}>🏛️</div>
          <h1 style={{ fontFamily: 'Merriweather, serif', fontSize: 26, fontWeight: 700, color: '#fff', margin: 0 }}>Jurexio Institutional</h1>
          <p style={{ color: TEXT_DIM, fontSize: 14, marginTop: 8 }}>India's Sovereign Legal AI for Institutions — Courts, Law Firms, Government & Universities</p>
          <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 14px',
            background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 20, color: GOLD, fontSize: 12, fontWeight: 600 }}>
            Institutional Access by Proposal Only
          </div>
        </div>

        {/* Step Progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s.n}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: s.n < step ? GOLD : s.n === step ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.06)',
                  border: s.n <= step ? `2px solid ${GOLD}` : `2px solid rgba(255,255,255,0.15)`,
                  color: s.n < step ? '#000' : s.n === step ? GOLD : 'rgba(255,255,255,0.4)' }}>
                  {s.n < step ? '✓' : s.n}
                </div>
                <span style={{ fontSize: 9, color: s.n === step ? GOLD : 'rgba(255,255,255,0.35)', marginTop: 3, textAlign: 'center', maxWidth: 60 }}>{s.title}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ flex: 2, height: 2, background: s.n < step ? GOLD : 'rgba(255,255,255,0.1)', marginBottom: 18 }} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step Content */}
        <div style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 32 }}>
          <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 20 }}>
            Step {step} of 7 — {STEPS[step - 1].title}
          </h2>

          {/* Step 1: Org Type */}
          {step === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {ORG_TYPES.map(t => (
                <button key={t.id} onClick={() => update('org_type', t.id)}
                  style={{ padding: '18px 14px', background: form.org_type === t.id ? GOLD_DIM : BG_CARD_HOVER,
                    border: `2px solid ${form.org_type === t.id ? GOLD_BORDER : BORDER}`,
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{t.icon}</div>
                  <div style={{ color: form.org_type === t.id ? GOLD : '#fff', fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{t.label}</div>
                  <div style={{ color: TEXT_MUTED, fontSize: 11 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Org Details */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div><label style={labelStyle}>Organisation Name *</label>
                <input style={inputStyle} value={form.org_name} onChange={e => update('org_name', e.target.value)} placeholder="e.g. ABC Law Associates, Ministry of Law" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div><label style={labelStyle}>Team Size *</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.team_size} onChange={e => update('team_size', e.target.value)}>
                    <option value="">Select</option>
                    {TEAM_SIZES.map(s => <option key={s} value={s}>{s} people</option>)}
                  </select></div>
                <div><label style={labelStyle}>Primary Jurisdiction *</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.jurisdiction} onChange={e => update('jurisdiction', e.target.value as Jurisdiction)}>
                    <option value="">Select</option>
                    {JURISDICTIONS.map(j => <option key={j.code} value={j.code}>{j.name}</option>)}
                  </select></div>
              </div>
            </div>
          )}

          {/* Step 3: Contact */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div><label style={labelStyle}>Contact Person's Full Name *</label>
                <input style={inputStyle} value={form.contact_name} onChange={e => update('contact_name', e.target.value)} placeholder="Managing Partner / GC / Dean" /></div>
              <div><label style={labelStyle}>Official Email *</label>
                <input style={inputStyle} type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} placeholder="name@institution.com" /></div>
              <div><label style={labelStyle}>Phone (optional)</label>
                <input style={inputStyle} type="tel" value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder="+91 XXXXX XXXXX" /></div>
            </div>
          )}

          {/* Step 4: Use Case */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div><label style={labelStyle}>Primary Use Case *</label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={form.use_case}
                  onChange={e => update('use_case', e.target.value)} placeholder="Describe how your institution plans to use Jurexio AI…" /></div>
              <div><label style={labelStyle}>Also Applicable</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {USE_CASE_OPTIONS.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                      background: form.use_case_types.includes(opt) ? GOLD_DIM : BG_CARD_HOVER,
                      border: `1px solid ${form.use_case_types.includes(opt) ? GOLD_BORDER : BORDER}`,
                      borderRadius: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.use_case_types.includes(opt)}
                        onChange={() => toggleArr('use_case_types', opt)} style={{ accentColor: GOLD }} />
                      <span style={{ color: form.use_case_types.includes(opt) ? GOLD : TEXT_DIM, fontSize: 13 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Technical */}
          {step === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div><label style={labelStyle}>Required Integrations</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {INTEGRATION_OPTIONS.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                      background: form.integrations_needed.includes(opt) ? GOLD_DIM : BG_CARD_HOVER,
                      border: `1px solid ${form.integrations_needed.includes(opt) ? GOLD_BORDER : BORDER}`,
                      borderRadius: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.integrations_needed.includes(opt)}
                        onChange={() => toggleArr('integrations_needed', opt)} style={{ accentColor: GOLD }} />
                      <span style={{ color: form.integrations_needed.includes(opt) ? GOLD : TEXT_DIM, fontSize: 13 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div><label style={labelStyle}>Compliance Requirements</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {COMPLIANCE_OPTIONS.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                      background: form.compliance_needs.includes(opt) ? GOLD_DIM : BG_CARD_HOVER,
                      border: `1px solid ${form.compliance_needs.includes(opt) ? GOLD_BORDER : BORDER}`,
                      borderRadius: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.compliance_needs.includes(opt)}
                        onChange={() => toggleArr('compliance_needs', opt)} style={{ accentColor: GOLD }} />
                      <span style={{ color: form.compliance_needs.includes(opt) ? GOLD : TEXT_DIM, fontSize: 13 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Volume & Timeline */}
          {step === 6 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div><label style={labelStyle}>Monthly AI Query Volume</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.monthly_volume} onChange={e => update('monthly_volume', e.target.value)}>
                    <option value="">Select estimate</option>
                    {VOLUME_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select></div>
                <div><label style={labelStyle}>Go-Live Timeline</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.go_live_timeline} onChange={e => update('go_live_timeline', e.target.value)}>
                    <option value="">Select</option>
                    {TIMELINE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select></div>
              </div>
              <div><label style={labelStyle}>Additional Notes</label>
                <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={form.additional_notes}
                  onChange={e => update('additional_notes', e.target.value)} placeholder="Special requirements, on-premise needs, regulatory constraints…" /></div>
            </div>
          )}

          {/* Step 7: Review */}
          {step === 7 && (
            <div>
              <div style={{ marginBottom: 16, padding: '12px 16px', background: GOLD_DIM,
                border: `1px solid ${GOLD_BORDER}`, borderRadius: 8, color: GOLD, fontSize: 13 }}>
                ℹ️ Review your details. Our institutional team will contact you within 2 business days with a tailored proposal.
              </div>
              {([
                ['Organisation Type', ORG_TYPES.find(t => t.id === form.org_type)?.label || form.org_type],
                ['Organisation Name', form.org_name], ['Team Size', form.team_size],
                ['Jurisdiction', JURISDICTIONS.find(j => j.code === form.jurisdiction)?.name || form.jurisdiction],
                ['Contact Name', form.contact_name], ['Contact Email', form.contact_email],
                ['Phone', form.contact_phone || '—'], ['Use Case', form.use_case || form.use_case_types.join(', ') || '—'],
                ['Monthly Volume', form.monthly_volume || '—'], ['Timeline', form.go_live_timeline || '—'],
                ['Integrations', form.integrations_needed.join(', ') || 'None'],
                ['Compliance', form.compliance_needs.join(', ') || 'None'],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', padding: '10px 0', borderBottom: `1px solid ${BORDER}`, gap: 16 }}>
                  <span style={{ color: TEXT_MUTED, fontSize: 13, minWidth: 150, flexShrink: 0 }}>{label}</span>
                  <span style={{ color: '#fff', fontSize: 13 }}>{value}</span>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12, color: TEXT_MUTED }}>
                By submitting, you confirm you are authorised to make this request on behalf of your institution. This is not a commercial sign-up — institutional access is granted only through a formal proposal process.
              </div>
            </div>
          )}

          {error && <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>{error}</div>}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
            {step > 1
              ? <button onClick={() => setStep(s => s - 1)} style={{ padding: '10px 22px', background: BG_CARD_HOVER, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT_DIM, fontSize: 14, cursor: 'pointer' }}>← Back</button>
              : <div />}
            {step < 7
              ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
                  style={{ padding: '11px 28px', background: canNext() ? GOLD : 'rgba(212,160,23,0.3)', border: 'none', borderRadius: 8, color: canNext() ? '#000' : TEXT_MUTED, fontSize: 14, fontWeight: 700, cursor: canNext() ? 'pointer' : 'not-allowed' }}>
                  Continue →
                </button>
              : <button onClick={handleSubmit} disabled={submitting}
                  style={{ padding: '12px 36px', background: GOLD, border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                  {submitting ? 'Submitting…' : 'Request Institutional Proposal →'}
                </button>}
          </div>
        </div>

        {/* Trust Signals */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 20 }}>
          {[['🔒', 'DPDPA 2023 Compliant', 'Indian Data Protection'], ['🛡️', 'SOC 2 Ready for Audit', 'Security'], ['⚖️', '164 Active Registry Agents', 'Domain-Specific AI'], ['🇮🇳', 'Made in India', 'Sovereign Legal AI']].map(([icon, label, sub]) => (
            <div key={label} style={{ background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 3 }}>{icon}</div>
              <div style={{ color: '#fff', fontSize: 11, fontWeight: 600 }}>{label}</div>
              <div style={{ color: TEXT_MUTED, fontSize: 10 }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
