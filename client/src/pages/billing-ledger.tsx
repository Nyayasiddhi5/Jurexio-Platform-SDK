import React, { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';

import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
const GOLD = '#C7B15B';
const GOLD_DIM = 'rgba(212,160,23,0.15)';
const GOLD_BORDER = 'rgba(212,160,23,0.3)';
const BG = 'rgba(255,255,255,0.04)';
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT_MUTED = 'rgba(255,255,255,0.5)';
const TEXT_DIM = 'rgba(255,255,255,0.7)';

interface Invoice {
  invoice_id: string;
  invoice_type: string;
  issued_at: string;
  due_date: string;
  gst: {
    base_amount: number; cgst_amount: number; sgst_amount: number; igst_amount: number;
    total_tax: number; total_amount: number; is_interstate: boolean;
  };
  tds_applicable: boolean; tds_amount: number; net_payable: number;
  currency: string;
}

interface SubscriptionEvent {
  event_id?: string; event_type: string; created_at: string; payload?: any;
}

const statusColors: Record<string, string> = {
  active: '#10b981', cancelled: '#ef4444', past_due: '#ef4444', trialing: '#8b5cf6',
};

export default function BillingLedger() {
  const [subscription, setSubscription] = useState<any>(null);
  const [creditTxns, setCreditTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'credits' | 'invoices'>('overview');

  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(nv('subscription/me'), { headers }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch(nv('subscription/credits/transactions?limit=100'), { headers }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ]).then(([subData, txData]) => {
      if (subData.success) setSubscription(subData.data);
      if (txData.success) setCreditTxns(txData.data.transactions);
    }).catch((e) => setError(e instanceof Error ? e : new Error(String(e)))).finally(() => setLoading(false));
  }, [reloadKey]);

  const totalDebits = creditTxns.filter(t => t.type === 'DEBIT').reduce((s: number, t: any) => s + t.credits, 0);
  const totalCredits = creditTxns.filter(t => t.type === 'CREDIT').reduce((s: number, t: any) => s + t.credits, 0);

  if (loading) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="loading-ledger">
        <div className="max-w-6xl mx-auto space-y-4">
          <Skeleton className="h-10 w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="error-ledger">
        <div className="max-w-3xl mx-auto pt-12">
          <NyvErrorState
            variant="card"
            title="Unable to load billing ledger"
            description="We couldn't fetch your subscription and credit history."
            error={error}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'Merriweather, serif', color: '#fff', fontSize: 26, fontWeight: 700, margin: 0 }}>Billing Ledger</h1>
          <p style={{ color: TEXT_DIM, marginTop: 4 }}>Full billing history, GST invoices, and payment records</p>
        </div>

        {/* Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          {[
            { label: 'Current Plan', value: subscription?.plan?.name || 'Alpha', sub: subscription?.subscription?.status, subColor: statusColors[subscription?.subscription?.status] || TEXT_MUTED },
            { label: 'Monthly Billing', value: subscription?.subscription?.amount_inr ? `₹${Number(subscription.subscription.amount_inr).toLocaleString('en-IN')}` : 'Free', sub: subscription?.subscription?.billing_cycle || 'No billing' },
            { label: 'Credits Consumed', value: String(totalDebits), sub: `of ${totalCredits} allocated` },
            { label: 'Credits Remaining', value: String(subscription?.wallet?.available || 0), sub: subscription?.wallet?.low_balance ? '⚠️ Low balance' : 'Available for use' },
          ].map(({ label, value, sub, subColor }) => (
            <div key={label} style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18 }}>
              <div style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
              <div style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{value}</div>
              {sub && <div style={{ color: subColor || TEXT_MUTED, fontSize: 12, marginTop: 3 }}>{sub}</div>}
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${BORDER}`, paddingBottom: 0 }}>
          {([['overview', 'Overview'], ['credits', 'Credit Ledger'], ['invoices', 'GST Invoices']] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
                color: activeTab === tab ? GOLD : TEXT_MUTED, fontWeight: activeTab === tab ? 600 : 400,
                borderBottom: activeTab === tab ? `2px solid ${GOLD}` : '2px solid transparent',
                fontSize: 14, marginBottom: -1 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div>
            {/* Subscription Details */}
            {subscription?.subscription && (
              <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
                <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>Current Subscription</h3>
                {([
                  ['Plan', subscription.plan?.name || subscription.subscription.plan_id],
                  ['Status', subscription.subscription.status],
                  ['Billing Cycle', subscription.subscription.billing_cycle],
                  ['Amount', subscription.subscription.amount_inr === 0 ? 'Free' : `₹${Number(subscription.subscription.amount_inr).toLocaleString('en-IN')} + 18% GST`],
                  ['Period End', subscription.subscription.current_period_end ? new Date(subscription.subscription.current_period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', padding: '10px 0', borderBottom: `1px solid ${BORDER}`, gap: 16 }}>
                    <span style={{ color: TEXT_MUTED, fontSize: 13, minWidth: 140 }}>{label}</span>
                    <span style={{ color: '#fff', fontSize: 13 }}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* GST Information */}
            <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
              <h3 style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>GST & Tax Information</h3>
              {([
                ['Supplier', 'Jurexio Technology Private Limited'],
                ['GSTIN', '27AADCN0000A1ZV (Placeholder — update with actual)'],
                ['SAC Code', '998399 — Information Technology Services n.e.c.'],
                ['GST Rate', '18% (CGST 9% + SGST 9% intra-state / IGST 18% inter-state)'],
                ['Invoice Format', 'INV-YYYY-NNNNNN (e.g. INV-2026-000001)'],
                ['Payment Format', 'PAY-YYYY-NNNNNN (e.g. PAY-2026-000001)'],
                ['TDS', '10% TDS under §194J applicable for B2B payments ≥ ₹30,000'],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', padding: '10px 0', borderBottom: `1px solid ${BORDER}`, gap: 16 }}>
                  <span style={{ color: TEXT_MUTED, fontSize: 13, minWidth: 140, flexShrink: 0 }}>{label}</span>
                  <span style={{ color: '#fff', fontSize: 13 }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/subscription" style={{ padding: '10px 20px', background: GOLD, borderRadius: 8, color: '#000', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
                Manage Subscription →
              </a>
              <a href="/credit-wallet" style={{ padding: '10px 20px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT_DIM, textDecoration: 'none', fontSize: 13 }}>
                View Credit Wallet →
              </a>
              <a href="/institutional" style={{ padding: '10px 20px', background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 8, color: GOLD, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                Request Institutional Proposal →
              </a>
            </div>
          </div>
        )}

        {/* Credit Ledger Tab */}
        {activeTab === 'credits' && (
          <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#fff', fontWeight: 600 }}>All Credit Transactions ({creditTxns.length})</span>
              <div style={{ display: 'flex', gap: 16 }}>
                <span style={{ color: '#10b981', fontSize: 13 }}>+{totalCredits} added</span>
                <span style={{ color: '#ef4444', fontSize: 13 }}>−{totalDebits} used</span>
                <span style={{ color: GOLD, fontSize: 13, fontWeight: 600 }}>={totalCredits - totalDebits} net</span>
              </div>
            </div>
            {creditTxns.length === 0 ? (
              <div style={{ padding: 16 }}>
                <NyvEmptyState title="No transactions yet" description="Credit transactions will appear here as you use the platform." size="sm" />
              </div>
            ) : creditTxns.map(tx => (
              <div key={tx.transaction_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 20px', borderBottom: `1px solid ${BORDER}` }}>
                <div>
                  <div style={{ color: '#fff', fontSize: 13 }}>{tx.tool_name} <span style={{ color: TEXT_MUTED, fontSize: 11 }}>({tx.source})</span></div>
                  <div style={{ color: TEXT_MUTED, fontSize: 11 }}>{new Date(tx.created_at).toLocaleString('en-IN')} · Hash: {tx.immutable_hash.substring(0, 12)}…</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: tx.type === 'DEBIT' ? '#ef4444' : tx.type === 'CREDIT' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                    {tx.type === 'DEBIT' ? '−' : tx.type === 'CREDIT' ? '+' : ''}{tx.credits} cr
                  </div>
                  <div style={{ color: TEXT_MUTED, fontSize: 11 }}>{tx.type}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* GST Invoices Tab */}
        {activeTab === 'invoices' && (
          <div>
            <div style={{ background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 12, padding: '14px 20px', marginBottom: 20 }}>
              <div style={{ color: GOLD, fontSize: 13, fontWeight: 600 }}>GST Invoice Generation</div>
              <div style={{ color: TEXT_DIM, fontSize: 13, marginTop: 4 }}>
                GST tax invoices (format: INV-YYYY-NNNNNN) are auto-generated for every subscription payment. Live invoices require Razorpay integration to be activated.
              </div>
            </div>

            {/* Sample Invoice Preview */}
            <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24 }}>
              <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 4 }}>Sample Tax Invoice Structure</h3>
              <p style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 20 }}>Every subscription payment generates a tax invoice with this structure:</p>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 20, fontFamily: 'monospace', fontSize: 12, color: TEXT_DIM }}>
                <div style={{ color: '#fff', fontWeight: 600, marginBottom: 8 }}>TAX INVOICE — INV-2026-000001</div>
                <div>Supplier: Jurexio Technology Pvt Ltd | GSTIN: 27AADCN0000A1ZV</div>
                <div>SAC: 998399 | Date: 05/04/2026 | Due: 20/04/2026</div>
                <div style={{ marginTop: 12, marginBottom: 4, color: GOLD }}>Line Items:</div>
                <div>Jurexio Pro Plan — AI Legal Platform Subscription (April 2026)</div>
                <div style={{ marginLeft: 20 }}>Taxable Value: ₹9,999.00</div>
                <div style={{ marginLeft: 20 }}>CGST @9%: ₹900.00</div>
                <div style={{ marginLeft: 20 }}>SGST @9%: ₹900.00</div>
                <div style={{ marginLeft: 20, color: '#fff', fontWeight: 600 }}>Total: ₹11,799.00</div>
                <div style={{ marginTop: 8, color: TEXT_MUTED }}>TDS @10% (§194J, if B2B ≥ ₹30,000): ₹999.90 | Net Payable: ₹10,799.10</div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                <button onClick={() => {
                  fetch(nv('gst/invoice'), {
                    method: 'POST', headers,
                    body: JSON.stringify({
                      customer_name: 'Demo Customer', plan_name: subscription?.plan?.name || 'Alpha',
                      period: new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
                      base_amount: subscription?.subscription?.amount_inr || 0,
                    }),
                  }).then(r => r.json()).then(d => { if (d.success) alert(JSON.stringify(d.data, null, 2)); });
                }} style={{ padding: '10px 20px', background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 8, color: GOLD, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                  Preview Invoice JSON
                </button>
                <a href={nv('gst/rates')} target="_blank" rel="noreferrer"
                  style={{ padding: '10px 20px', background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT_DIM, textDecoration: 'none', fontSize: 13 }}>
                  GST Rate Reference →
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
