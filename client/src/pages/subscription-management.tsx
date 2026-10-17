import React, { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvErrorState } from '@/components/NyvErrorState';
import { NyvEmptyState } from '@/components/NyvEmptyState';

import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
const GOLD = '#C7B15B';
const GOLD_DIM = 'rgba(212,160,23,0.15)';
const GOLD_BORDER = 'rgba(212,160,23,0.3)';
const BG = 'rgba(255,255,255,0.04)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT_MUTED = 'rgba(255,255,255,0.5)';
const TEXT_DIM = 'rgba(255,255,255,0.7)';

interface Plan {
  id: string; name: string; tier: string;
  price_monthly_inr: number | null; price_annual_inr: number | null;
  credits_monthly: number; features: string[];
  template_modes: string[]; jurisdictions: string[];
  max_cases: number; highlight?: boolean; badge?: string; cta?: string;
}

interface SubscriptionState {
  subscription: { plan_id: string; status: string; billing_cycle: string; amount_inr: number; current_period_end?: string } | null;
  plan: Plan | null;
  wallet: { balance: number; available: number; low_balance: boolean };
}

const statusColors: Record<string, string> = {
  active: '#10b981', paused: '#f59e0b', cancelled: '#ef4444', past_due: '#ef4444', trialing: '#8b5cf6',
};

const tierIcons: Record<string, string> = {
  alpha: '⚡', solo: '👤', standard: '⚖️', pro: '🚀', elite: '💎', enterprise: '🏢', government: '🏛️',
};

export default function SubscriptionManagement() {
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [upgrading, setUpgrading] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [msg, setMsg] = useState('');

  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetch(nv('subscription/me'), { headers }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch(nv('subscription/plans')).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ]).then(([me, plansData]) => {
      if (me.success) setState(me.data);
      if (plansData.success) setPlans(plansData.data.plans);
    }).catch((e) => setLoadError(e instanceof Error ? e : new Error(String(e)))).finally(() => setLoading(false));
  }, [reloadKey]);

  const handleUpgrade = async (planId: string) => {
    if (planId === 'enterprise') { window.location.href = '/institutional'; return; }
    setUpgrading(planId);
    try {
      const res = await fetch(nv('subscription/create'), {
        method: 'POST', headers, body: JSON.stringify({ plan_id: planId, billing_cycle: billing }),
      });
      const data = await res.json();
      if (data.success) { setMsg(`Successfully subscribed to ${planId} plan! +${data.data.credits_granted} credits added.`); window.location.reload(); }
      else setMsg(data.error || 'Upgrade failed');
    } catch { setMsg('Network error'); }
    setUpgrading('');
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(nv('subscription/cancel'), {
        method: 'POST', headers, body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json();
      if (data.success) { setMsg('Subscription cancelled. Access continues until period end.'); setShowCancel(false); window.location.reload(); }
      else setMsg(data.error || 'Cancellation failed');
    } catch { setMsg('Network error'); }
    setCancelling(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="loading-subscription">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="error-subscription">
        <div className="max-w-3xl mx-auto pt-12">
          <NyvErrorState
            variant="card"
            title="Unable to load subscription"
            description="We couldn't fetch your subscription details and plan catalog."
            error={loadError}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </div>
    );
  }

  const currentPlanId = state?.subscription?.plan_id || 'alpha';

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'Merriweather, serif', color: '#fff', fontSize: 26, fontWeight: 700, margin: 0 }}>Subscription Management</h1>
          <p style={{ color: TEXT_DIM, marginTop: 4 }}>Manage your plan, billing, and credit allocation</p>
        </div>

        {msg && (msg.includes('fail') || msg.includes('error')) ? (
          <div style={{ marginBottom: 16 }}>
            <NyvErrorState title="Subscription action failed" description={msg} variant="card" size="sm" />
          </div>
        ) : msg ? (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(16,185,129,0.15)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 8, color: '#6ee7b7', fontSize: 13 }} role="status">
            {msg}
          </div>
        ) : null}

        {/* Current Subscription Summary */}
        {state && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 32 }}>
            {[
              { label: 'Current Plan', value: `${tierIcons[currentPlanId] || '⚡'} ${state.plan?.name || currentPlanId}`, sub: state.subscription?.status },
              { label: 'Credits Available', value: String(state.wallet.available), sub: state.wallet.low_balance ? '⚠️ Low balance' : 'of ' + (state.plan?.credits_monthly || 0) + '/mo' },
              { label: 'Billing Cycle', value: state.subscription?.billing_cycle || 'Free', sub: state.subscription?.current_period_end ? `Renews ${new Date(state.subscription.current_period_end).toLocaleDateString('en-IN')}` : 'No expiry' },
            ].map(({ label, value, sub }) => (
              <div key={label} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
                <div style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ color: '#fff', fontSize: 22, fontWeight: 700, marginTop: 6 }}>{value}</div>
                {sub && <div style={{ color: state.subscription?.status ? statusColors[state.subscription.status] || TEXT_MUTED : TEXT_MUTED, fontSize: 12, marginTop: 3 }}>{sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Billing Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 24 }}>
          <span style={{ color: billing === 'monthly' ? '#fff' : TEXT_MUTED, fontWeight: billing === 'monthly' ? 600 : 400 }}>Monthly</span>
          <button onClick={() => setBilling(b => b === 'monthly' ? 'annual' : 'monthly')}
            style={{ width: 48, height: 26, borderRadius: 13, background: billing === 'annual' ? GOLD : 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: billing === 'annual' ? 25 : 3, transition: 'left 0.2s' }} />
          </button>
          <span style={{ color: billing === 'annual' ? GOLD : TEXT_MUTED, fontWeight: billing === 'annual' ? 600 : 400 }}>Annual <span style={{ fontSize: 11, background: GOLD_DIM, color: GOLD, padding: '2px 6px', borderRadius: 10 }}>Save ~17%</span></span>
        </div>

        {/* Plans Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
          {plans.filter(p => p.id !== 'enterprise').map(plan => {
            const price = billing === 'annual' ? plan.price_annual_inr : plan.price_monthly_inr;
            const isCurrent = plan.id === currentPlanId;
            return (
              <div key={plan.id} style={{ background: BG, border: `2px solid ${plan.highlight ? GOLD_BORDER : BORDER}`,
                borderRadius: 14, padding: 24, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {plan.badge && <div style={{ position: 'absolute', top: -10, right: 16, background: GOLD, color: '#000', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10 }}>{plan.badge}</div>}
                {isCurrent && <div style={{ position: 'absolute', top: -10, left: 16, background: '#10b981', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10 }}>Current Plan</div>}
                <div style={{ fontSize: 28, marginBottom: 6 }}>{tierIcons[plan.tier] || '⚡'}</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>{plan.name}</div>
                <div style={{ color: plan.highlight ? GOLD : TEXT_DIM, fontSize: 24, fontWeight: 700, margin: '10px 0 4px' }}>
                  {price === 0 ? 'Free' : price ? `₹${price.toLocaleString('en-IN')}` : 'Custom'}
                  {price && price > 0 ? <span style={{ fontSize: 13, color: TEXT_MUTED }}>/{billing === 'annual' ? 'yr' : 'mo'}</span> : null}
                </div>
                <div style={{ color: TEXT_MUTED, fontSize: 12, marginBottom: 12 }}>
                  {plan.credits_monthly === -1 ? 'Unlimited credits' : `${plan.credits_monthly} credits/month`}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, flex: 1 }}>
                  {plan.features.slice(0, 5).map(f => (
                    <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ color: GOLD, fontSize: 12, marginTop: 2 }}>✓</span>
                      <span style={{ color: TEXT_DIM, fontSize: 12 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => handleUpgrade(plan.id)} disabled={isCurrent || !!upgrading}
                  style={{ width: '100%', padding: '10px', background: isCurrent ? 'rgba(16,185,129,0.15)' : plan.highlight ? GOLD : 'rgba(255,255,255,0.1)',
                    border: isCurrent ? '1px solid #10b981' : plan.highlight ? 'none' : `1px solid ${BORDER}`,
                    borderRadius: 8, color: isCurrent ? '#10b981' : plan.highlight ? '#000' : '#fff',
                    fontWeight: 600, fontSize: 13, cursor: isCurrent || upgrading ? 'not-allowed' : 'pointer' }}>
                  {isCurrent ? 'Current Plan' : upgrading === plan.id ? 'Upgrading…' : plan.id === 'alpha' ? 'Downgrade to Free' : `Upgrade to ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Enterprise Card */}
        <div style={{ background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 14, padding: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ color: GOLD, fontWeight: 700, fontSize: 18, marginBottom: 4 }}>🏢 Enterprise & Institutional</div>
            <div style={{ color: TEXT_DIM, fontSize: 14 }}>Custom credit pools · On-premise · Multi-jurisdiction · Dedicated SLA · Compliance reporting</div>
          </div>
          <a href="/institutional" style={{ padding: '12px 24px', background: GOLD, borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Request Institutional Proposal →
          </a>
        </div>

        {/* Cancel Subscription */}
        {state?.subscription && currentPlanId !== 'alpha' && state.subscription.status === 'active' && (
          <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Cancel Subscription</h3>
            <p style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 12 }}>Access continues until the end of your current billing period.</p>
            {!showCancel ? (
              <button onClick={() => setShowCancel(true)} style={{ padding: '8px 18px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#f87171', fontSize: 13, cursor: 'pointer' }}>
                Cancel Subscription
              </button>
            ) : (
              <div>
                <textarea style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#fff', fontSize: 13, minHeight: 70, resize: 'vertical', boxSizing: 'border-box' }}
                  placeholder="Reason for cancellation (optional)" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={handleCancel} disabled={cancelling} style={{ padding: '8px 18px', background: 'rgba(239,68,68,0.8)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {cancelling ? 'Cancelling…' : 'Confirm Cancellation'}
                  </button>
                  <button onClick={() => setShowCancel(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.08)', border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT_DIM, fontSize: 13, cursor: 'pointer' }}>
                    Keep Subscription
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
