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

interface Wallet {
  wallet_id: string; user_id: string;
  credits_balance: number; reserved_credits: number; available_credits: number;
  credits_expiry: string | null; last_updated: string;
}

interface Transaction {
  transaction_id: string; user_id: string;
  type: 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE';
  credits: number; source: string; tool_name: string;
  reference_id: string | null; immutable_hash: string; created_at: string;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  DEBIT:   { label: 'Used', color: '#ef4444', icon: '−' },
  CREDIT:  { label: 'Added', color: '#10b981', icon: '+' },
  RESERVE: { label: 'Reserved', color: '#f59e0b', icon: '🔒' },
  RELEASE: { label: 'Released', color: '#8b5cf6', icon: '↩' },
};

const TOOL_LABELS: Record<string, string> = {
  case_stage_explanation: 'Case Stage Explanation (1 cr)',
  hearing_notes_summary: 'Hearing Notes Summary (2 cr)',
  fact_extraction: 'Fact Extraction (2 cr)',
  draft_legal_notice: 'Legal Notice Draft (5 cr)',
  draft_petition: 'Petition Draft (6 cr)',
  document_analysis: 'Document Analysis (3 cr)',
  risk_assessment: 'Risk Assessment (2 cr)',
  clause_comparison: 'Clause Comparison (4 cr)',
};

export default function CreditWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');

  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(nv('subscription/credits/wallet'), { headers }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch(nv('subscription/credits/transactions'), { headers }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch(nv('subscription/credits/costs')).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ]).then(([walletData, txData, costsData]) => {
      if (walletData.success) setWallet(walletData.data);
      if (txData.success) setTransactions(txData.data.transactions);
      if (costsData.success) setCosts(costsData.data.costs);
    }).catch((e) => setError(e instanceof Error ? e : new Error(String(e)))).finally(() => setLoading(false));
  }, [reloadKey]);

  const filteredTx = transactions.filter(t => filter === 'ALL' || t.type === filter);
  const totalUsed = transactions.filter(t => t.type === 'DEBIT').reduce((s, t) => s + t.credits, 0);
  const totalAdded = transactions.filter(t => t.type === 'CREDIT').reduce((s, t) => s + t.credits, 0);
  const usedPercent = wallet ? Math.min(100, Math.round((totalUsed / (totalAdded || 1)) * 100)) : 0;

  if (loading) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="loading-wallet">
        <div className="max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-10 w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }} data-testid="error-wallet">
        <div className="max-w-3xl mx-auto pt-12">
          <NyvErrorState
            variant="card"
            title="Unable to load credit wallet"
            description="We couldn't fetch your wallet balance and transaction history."
            error={error}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0E1830 0%, #152448 40%, #152448 100%)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
        {/* Header */}
        <div className="mb-8">
          <h1 style={{ fontFamily: 'Merriweather, serif', color: '#fff', fontSize: 26, fontWeight: 700, margin: 0 }}>Credit Wallet</h1>
          <p style={{ color: TEXT_DIM, marginTop: 4 }}>Track your AI credit balance and usage history</p>
        </div>

        {/* Wallet Balance Card */}
        {wallet && (
          <div style={{ background: `linear-gradient(135deg, rgba(212,160,23,0.15) 0%, rgba(10,42,102,0.5) 100%)`,
            border: `1px solid ${GOLD_BORDER}`, borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
              <div>
                <div style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Available Credits</div>
                <div style={{ color: GOLD, fontSize: 44, fontWeight: 700, marginTop: 6 }}>{wallet.available_credits}</div>
                {wallet.available_credits < 10 && (
                  <div style={{ color: '#f87171', fontSize: 12, marginTop: 4 }}>⚠️ Low balance — top up to continue AI tools</div>
                )}
              </div>
              <div>
                <div style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Total Balance</div>
                <div style={{ color: '#fff', fontSize: 36, fontWeight: 700, marginTop: 6 }}>{wallet.credits_balance}</div>
                <div style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4 }}>
                  {wallet.reserved_credits > 0 ? `${wallet.reserved_credits} reserved` : 'No active reservations'}
                </div>
              </div>
              <div>
                <div style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Usage</div>
                <div style={{ color: '#fff', fontSize: 28, fontWeight: 700, marginTop: 6 }}>{totalUsed} used</div>
                <div style={{ marginTop: 8, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${usedPercent}%`, background: usedPercent > 80 ? '#ef4444' : GOLD, borderRadius: 3, transition: 'width 0.5s' }} />
                </div>
                <div style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 4 }}>{usedPercent}% of allocated credits used</div>
              </div>
            </div>
          </div>
        )}

        {/* Wallet Zero State */}
        {wallet && wallet.available_credits <= 0 && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 14 }}>All AI tools are disabled — zero credit balance</div>
              <div style={{ color: TEXT_MUTED, fontSize: 13 }}>Upgrade your plan to receive more credits</div>
            </div>
            <a href="/subscription" style={{ padding: '10px 20px', background: GOLD, borderRadius: 8, color: '#000', fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>Top Up Now</a>
          </div>
        )}

        {/* Two-Column Layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'flex-start' }}>
          {/* Transactions */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 600, margin: 0 }}>Transaction Ledger</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['ALL', 'DEBIT', 'CREDIT'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    style={{ padding: '5px 12px', background: filter === f ? GOLD_DIM : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${filter === f ? GOLD_BORDER : BORDER}`, borderRadius: 6,
                      color: filter === f ? GOLD : TEXT_MUTED, fontSize: 12, cursor: 'pointer', fontWeight: filter === f ? 600 : 400 }}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              {filteredTx.length === 0 ? (
                <div style={{ padding: 16 }}>
                  <NyvEmptyState title="No transactions yet" description="Wallet activity will appear here as you spend or top up credits." size="sm" />
                </div>
              ) : (
                filteredTx.map(tx => {
                  const cfg = TYPE_CONFIG[tx.type] || { label: tx.type, color: TEXT_MUTED, icon: '?' };
                  const toolLabel = TOOL_LABELS[tx.tool_name] || tx.tool_name;
                  return (
                    <div key={tx.transaction_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 18px', borderBottom: `1px solid ${BORDER}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${cfg.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: cfg.color }}>
                          {cfg.icon}
                        </div>
                        <div>
                          <div style={{ color: '#fff', fontSize: 14 }}>{toolLabel}</div>
                          <div style={{ color: TEXT_MUTED, fontSize: 11 }}>
                            {new Date(tx.created_at).toLocaleString('en-IN')} · {tx.source}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: cfg.color, fontWeight: 700, fontSize: 16 }}>
                          {tx.type === 'DEBIT' ? '−' : tx.type === 'CREDIT' ? '+' : ''}{tx.credits} cr
                        </div>
                        <div style={{ color: TEXT_MUTED, fontSize: 11 }}>{cfg.label}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Tool Costs Reference */}
          <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ color: '#fff', fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 16 }}>AI Tool Credit Costs</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {Object.entries({
                'Case Stage': 1, 'Hearing Notes': 2, 'Fact Extract': 2,
                'Legal Notice': 5, 'Petition Draft': 6, 'Doc Analysis': 3,
                'Risk Assessment': 2, 'Clause Compare': 4,
              }).map(([tool, cost]) => (
                <div key={tool} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px 0', borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ color: TEXT_DIM, fontSize: 13 }}>{tool}</span>
                  <span style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>{cost} cr</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 11, color: TEXT_MUTED, lineHeight: 1.6 }}>
              Credits are only deducted for successful AI executions. Failed executions are not charged. Zero balance disables all AI tools immediately.
            </div>
            <a href="/subscription" style={{ display: 'block', marginTop: 14, padding: '10px', background: GOLD, borderRadius: 8, color: '#000', fontWeight: 700, textDecoration: 'none', textAlign: 'center', fontSize: 13 }}>
              Upgrade for More Credits →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
