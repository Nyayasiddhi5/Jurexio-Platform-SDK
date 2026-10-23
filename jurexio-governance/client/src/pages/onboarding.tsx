import { useState } from 'react';
import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import {
  CheckCircle2, ChevronRight, ChevronLeft, User, Building2,
  Globe, Key, Sparkles, ArrowRight, Copy, Eye, EyeOff, MapPin
} from 'lucide-react';

const STEPS = [
  { id: 'welcome', label: 'Welcome', icon: Sparkles },
  { id: 'profile', label: 'Profile Setup', icon: User },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'jurisdiction', label: 'Jurisdiction', icon: Globe },
  { id: 'apikey', label: 'API Key', icon: Key },
  { id: 'complete', label: 'Tour Complete', icon: CheckCircle2 },
];

// v5.0.0: India is the only active jurisdiction. UAE/Saudi/Singapore/USA/UK/EU
// were legacy v3.1.2 jurisdictions removed per platform readiness pass.
const JURISDICTIONS = [
  { code: 'IN', name: 'India', courts: ['Supreme Court', 'High Courts', 'District Courts', 'NCLT', 'NCLAT'] },
];

const ORG_TYPES = ['Law Firm', 'Corporate Legal', 'Government', 'Judiciary', 'Academic', 'NGO / Non-Profit', 'Individual Practitioner'];

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [profile, setProfile] = useState({ fullName: '', designation: '', phone: '', barCouncilId: '' });
  const [org, setOrg] = useState({ name: '', type: '', size: '', website: '' });
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<string[]>([]);
  const [apiKey] = useState('nyv_live_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 10));
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const progress = ((currentStep) / (STEPS.length - 1)) * 100;

  const toggleJurisdiction = (code: string) => {
    setSelectedJurisdictions(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const copyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: return true;
      case 1: return profile.fullName.trim().length > 0;
      case 2: return org.name.trim().length > 0 && org.type.length > 0;
      case 3: return selectedJurisdictions.length > 0;
      case 4: return true;
      case 5: return true;
      default: return true;
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        <div className="text-center mb-8">
          <h1 style={{ fontFamily: 'Merriweather, serif', color: '#fff', fontSize: 28, fontWeight: 700 }}>
            NyayaVigya Platform Setup
          </h1>
          <p style={{ color: '#C7B15B', fontSize: 14, marginTop: 4 }}>
            Configure your legal AI workspace in a few simple steps
          </p>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = i === currentStep;
              const isCompleted = i < currentStep;
              return (
                <div key={step.id} className="flex flex-col items-center" style={{ flex: 1 }}>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-all"
                    style={{
                      background: isCompleted ? '#C7B15B' : isActive ? 'rgba(212,160,23,0.3)' : 'rgba(255,255,255,0.06)',
                      border: isActive ? '2px solid #C7B15B' : '2px solid transparent',
                    }}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-5 w-5" style={{ color: '#152448' }} />
                    ) : (
                      <Icon className="h-4 w-4" style={{ color: isActive ? '#C7B15B' : 'rgba(255,255,255,0.4)' }} />
                    )}
                  </div>
                  <span style={{ color: isActive ? '#C7B15B' : 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: isActive ? 600 : 400 }}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#C7B15B', borderRadius: 2, transition: 'width 0.3s ease' }} />
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32, minHeight: 400 }}>
          {currentStep === 0 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6" style={{ background: 'rgba(212,160,23,0.15)', border: '1px solid rgba(212,160,23,0.3)' }}>
                <Sparkles className="h-10 w-10" style={{ color: '#C7B15B' }} />
              </div>
              <h2 style={{ color: '#fff', fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Welcome to NyayaVigya</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
                India's Sovereign Legal AI Platform. Set up your workspace to access {JRX_REGISTRY_RUNTIME.totalAgents}+ AI agents,
                multi-jurisdiction legal intelligence, and enterprise-grade compliance tools.
              </p>
              <div className="grid grid-cols-3 gap-4 mt-8 max-w-md mx-auto">
                {[
                  { label: 'AI Agents', value: `${JRX_REGISTRY_RUNTIME.totalAgents}+` },
                  { label: 'Jurisdictions', value: '7+' },
                  { label: 'Legal Tools', value: '50+' },
                ].map(item => (
                  <div key={item.label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ color: '#C7B15B', fontSize: 22, fontWeight: 700 }}>{item.value}</div>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Profile Setup</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>Tell us about yourself to personalize your experience</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Full Name *', key: 'fullName', placeholder: 'Adv. Rajesh Kumar' },
                  { label: 'Designation', key: 'designation', placeholder: 'Senior Partner' },
                  { label: 'Phone', key: 'phone', placeholder: '+91 98765 43210' },
                  { label: 'Bar Council ID', key: 'barCouncilId', placeholder: 'BCI/DEL/12345' },
                ].map(field => (
                  <div key={field.key}>
                    <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>{field.label}</label>
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={(profile as any)[field.key]}
                      onChange={e => setProfile(prev => ({ ...prev, [field.key]: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14, color: '#fff',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Organization Details</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>Set up your organization for team collaboration</p>
              <div className="space-y-4">
                <div>
                  <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Organization Name *</label>
                  <input
                    type="text" placeholder="e.g. Kumar & Associates LLP"
                    value={org.name} onChange={e => setOrg(prev => ({ ...prev, name: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Organization Type *</label>
                  <div className="flex flex-wrap gap-2">
                    {ORG_TYPES.map(type => (
                      <button key={type} onClick={() => setOrg(prev => ({ ...prev, type }))}
                        style={{
                          padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
                          background: org.type === type ? 'rgba(212,160,23,0.2)' : 'rgba(255,255,255,0.04)',
                          border: org.type === type ? '1px solid #C7B15B' : '1px solid rgba(255,255,255,0.08)',
                          color: org.type === type ? '#C7B15B' : 'rgba(255,255,255,0.6)',
                        }}
                      >{type}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Team Size</label>
                    <select value={org.size} onChange={e => setOrg(prev => ({ ...prev, size: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}>
                      <option value="">Select size</option>
                      <option value="1-5">1-5</option>
                      <option value="6-25">6-25</option>
                      <option value="26-100">26-100</option>
                      <option value="100+">100+</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Website</label>
                    <input type="text" placeholder="https://yourfirm.com"
                      value={org.website} onChange={e => setOrg(prev => ({ ...prev, website: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14, color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Select Jurisdictions</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>Choose the jurisdictions relevant to your practice</p>
              <div className="grid grid-cols-2 gap-3">
                {JURISDICTIONS.map(j => {
                  const selected = selectedJurisdictions.includes(j.code);
                  return (
                    <button key={j.code} onClick={() => toggleJurisdiction(j.code)}
                      style={{
                        padding: 16, borderRadius: 12, textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                        background: selected ? 'rgba(212,160,23,0.15)' : 'rgba(255,255,255,0.04)',
                        border: selected ? '1px solid #C7B15B' : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4" style={{ color: selected ? '#C7B15B' : 'rgba(255,255,255,0.4)' }} />
                        <span style={{ color: selected ? '#C7B15B' : '#fff', fontWeight: 600, fontSize: 14 }}>{j.name}</span>
                        {selected && <CheckCircle2 className="h-4 w-4 ml-auto" style={{ color: '#C7B15B' }} />}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                        {j.courts.slice(0, 3).join(', ')}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 12 }}>
                Selected: {selectedJurisdictions.length} jurisdiction{selectedJurisdictions.length !== 1 ? 's' : ''}
              </p>
            </div>
          )}

          {currentStep === 4 && (
            <div>
              <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>API Key Generation</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>Your API key for programmatic access to NyayaVigya SDK</p>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, display: 'block', marginBottom: 8 }}>
                  Live API Key
                </label>
                <div className="flex items-center gap-3">
                  <code style={{ flex: 1, padding: '12px 16px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#C7B15B', fontSize: 14, fontFamily: 'monospace', letterSpacing: 0.5 }}>
                    {showKey ? apiKey : apiKey.substring(0, 12) + '••••••••••••••••••'}
                  </code>
                  <button onClick={() => setShowKey(!showKey)}
                    style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button onClick={copyKey}
                    style={{ padding: 10, borderRadius: 8, background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(212,160,23,0.15)', border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(212,160,23,0.3)'}`, cursor: 'pointer', color: copied ? '#10b981' : '#C7B15B' }}>
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div style={{ background: 'rgba(212,160,23,0.08)', border: '1px solid rgba(212,160,23,0.2)', borderRadius: 12, padding: 16 }}>
                <p style={{ color: '#C7B15B', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Quick Start</p>
                <pre style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
{`import { NyayaVigya } from '@jurexio/sdk';

const client = new NyayaVigya({
  apiKey: '${showKey ? apiKey : 'nyv_live_••••••'}',
  jurisdiction: '${selectedJurisdictions[0] || 'IN'}'
});

const result = await client.analyze({
  document: 'contract.pdf',
  type: 'contract-review'
});`}
                </pre>
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.3)' }}>
                <CheckCircle2 className="h-10 w-10" style={{ color: '#10b981' }} />
              </div>
              <h2 style={{ color: '#fff', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Setup Complete!</h2>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, maxWidth: 450, margin: '0 auto 24px', lineHeight: 1.6 }}>
                Your NyayaVigya workspace is ready. Explore the platform to start using AI-powered legal tools.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto mb-8">
                {[
                  { label: 'Dashboard', path: '/console/dashboard' },
                  { label: 'SDK Console', path: '/console/sdk-console' },
                  { label: 'AI Legal Chat', path: '/console/legal-chat' },
                  { label: 'Central Intelligence', path: '/console/intelligence/dashboard' },
                ].map(link => (
                  <a key={link.label} href={link.path}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '12px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff',
                    }}
                  >
                    {link.label} <ArrowRight className="h-3 w-3" style={{ color: '#C7B15B' }} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))}
            disabled={currentStep === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: currentStep === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.7)',
              opacity: currentStep === 0 ? 0.5 : 1,
            }}
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={() => setCurrentStep(prev => Math.min(STEPS.length - 1, prev + 1))}
              disabled={!canProceed()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 10,
                fontSize: 14, fontWeight: 700, cursor: canProceed() ? 'pointer' : 'not-allowed',
                background: canProceed() ? '#C7B15B' : 'rgba(212,160,23,0.3)', color: '#152448',
                border: 'none', opacity: canProceed() ? 1 : 0.5,
              }}
            >
              Continue <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <a href="/console/dashboard"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 10,
                fontSize: 14, fontWeight: 700, textDecoration: 'none',
                background: '#C7B15B', color: '#152448', border: 'none',
              }}
            >
              Go to Dashboard <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
