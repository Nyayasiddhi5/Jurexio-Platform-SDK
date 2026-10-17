import { useState } from "react";
import { nv } from '../lib/jrx-api-paths';

type FailedOracleCase = { question: string; actual: string; expected: string };
type FailedAdversarialCase = { category: string; prompt: string; reason: string };

interface Scorecard {
  jurisdiction: string;
  agentId?: string;
  oracleAccuracy: number;
  citationHallucinationRate: number;
  adversarialResistance: number;
  biasScore: number;
  latencyP99Ms: number;
  grpoRewardScore: number;
  overallPass: boolean;
  score: number;
  overall: 'PASS' | 'FAIL';
  passThreshold: number;
  breakdown?: {
    oracle: { passed: number; total: number; accuracy: number };
    adversarial: { passed: number; total: number; resistance: number };
    failedOracleCases: FailedOracleCase[];
    failedAdversarialCases: FailedAdversarialCase[];
  };
}

export default function AgentScorecard() {
  const [jurisdiction, setJurisdiction] = useState("IN");
  const [agentId, setAgentId] = useState("");
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token") || "";
      const body: Record<string, string> = { jurisdiction };
      if (agentId.trim()) body.agentId = agentId.trim();
      const res = await fetch(nv('testing/scorecard'), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        setScorecard(null);
      } else {
        setScorecard(data.data ?? data);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const metric = (label: string, value: number | string, target: string, pass: boolean, testid: string) => (
    <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm" data-testid={testid}>
      <p className="text-xs text-slate-700 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${pass ? "text-green-600" : "text-red-600"}`}>
        {typeof value === "number" ? (value * 100).toFixed(1) + "%" : value}
      </p>
      <p className="text-xs text-slate-600 mt-1">Target: {target}</p>
    </div>
  );

  const overall = scorecard?.overall ?? (scorecard?.overallPass ? 'PASS' : 'FAIL');
  const overallPass = overall === 'PASS';

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-slate-900 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2" data-testid="page-title">Agent Scorecard</h1>
        <p className="text-slate-600 mb-4">Comprehensive agent quality assessment — Oracle, Adversarial, Bias, Latency, GRPO</p>

        <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-900 mb-1">How this works</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Pick a <strong>jurisdiction</strong>, optionally scope to a single <strong>agent ID</strong> (otherwise the bench evaluates a sampled fixture for that jurisdiction).</li>
            <li>Click <strong>Generate Scorecard</strong> — runs Oracle (canonical Q/A), Adversarial (prompt-injection &amp; jailbreak), Bias, p99 latency, and GRPO reward suites.</li>
            <li>Composite <strong>score</strong> (equal-weight average of the six normalized sub-metrics) is returned. <strong>OVERALL = PASS</strong> when score ≥ 70%.</li>
            <li>Per-suite breakdown and the actual failed cases (oracle &amp; adversarial) are listed below for triage.</li>
          </ol>
        </div>

        <div className="flex flex-wrap gap-3 mb-6 items-center">
          <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
            data-testid="select-jurisdiction"
            className="bg-white border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm">
            <option value="IN">India</option>
            <option value="US">United States</option>
            <option value="UK">United Kingdom</option>
            <option value="EU">European Union</option>
            <option value="SG">Singapore</option>
            <option value="GC">GCC</option>
          </select>
          <input
            type="text"
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            placeholder="Agent ID (optional, e.g. in-chief-legal-officer)"
            data-testid="input-agent-id"
            className="bg-white border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm flex-1 min-w-[280px]"
          />
          <button onClick={handleGenerate} disabled={loading}
            data-testid="button-generate"
            className="bg-[#2B384C] hover:bg-[#1f2a3a] text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? "Generating..." : "Generate Scorecard"}
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" data-testid="error-banner">
            {error}
          </div>
        )}

        {scorecard && (
          <>
            <div
              data-testid="overall-verdict"
              className={`p-4 rounded-xl mb-6 text-center ${overallPass ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              <p className="text-2xl font-bold">OVERALL {overall}</p>
              <p className="text-sm text-slate-600 mt-1">
                Score: <span className="font-semibold">{scorecard.score}</span> / 100
                {' · '}Threshold: {scorecard.passThreshold ?? 70}
                {' · '}Jurisdiction: {scorecard.jurisdiction}
                {scorecard.agentId ? <> · Agent: <code>{scorecard.agentId}</code></> : null}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {metric("Oracle Accuracy", scorecard.oracleAccuracy, "higher is better", scorecard.oracleAccuracy >= 0.7, 'metric-oracle')}
              {metric("Citation Hallucination", scorecard.citationHallucinationRate, "lower is better", scorecard.citationHallucinationRate <= 0.3, 'metric-hallucination')}
              {metric("Adversarial Resistance", scorecard.adversarialResistance, "higher is better", scorecard.adversarialResistance >= 0.7, 'metric-adversarial')}
              {metric("Bias Score", scorecard.biasScore, "lower is better", scorecard.biasScore <= 0.3, 'metric-bias')}
              {metric("P99 Latency", scorecard.latencyP99Ms + "ms", "lower is better", scorecard.latencyP99Ms < 3000, 'metric-latency')}
              {metric("GRPO Reward", scorecard.grpoRewardScore, "higher is better", scorecard.grpoRewardScore >= 0.7, 'metric-grpo')}
            </div>

            {scorecard.breakdown && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6" data-testid="breakdown-summary">
                <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900 mb-1">Oracle suite</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {scorecard.breakdown.oracle.passed} / {scorecard.breakdown.oracle.total}
                  </p>
                  <p className="text-xs text-slate-700 mt-1">
                    Accuracy: {(scorecard.breakdown.oracle.accuracy * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900 mb-1">Adversarial suite</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {scorecard.breakdown.adversarial.passed} / {scorecard.breakdown.adversarial.total}
                  </p>
                  <p className="text-xs text-slate-700 mt-1">
                    Resistance: {(scorecard.breakdown.adversarial.resistance * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            )}

            {scorecard.breakdown && scorecard.breakdown.failedOracleCases.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm mb-4" data-testid="failed-oracle-cases">
                <p className="text-sm font-semibold text-slate-900 mb-2">
                  Failed oracle cases ({scorecard.breakdown.failedOracleCases.length})
                </p>
                <ul className="space-y-2 text-sm">
                  {scorecard.breakdown.failedOracleCases.map((c, i) => (
                    <li key={i} className="border-l-2 border-red-300 pl-3">
                      <p className="font-medium text-slate-900">{c.question}</p>
                      <p className="text-xs text-slate-700"><span className="font-semibold">Expected:</span> {c.expected}</p>
                      <p className="text-xs text-slate-700"><span className="font-semibold">Actual:</span> {c.actual}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {scorecard.breakdown && scorecard.breakdown.failedAdversarialCases.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm" data-testid="failed-adversarial-cases">
                <p className="text-sm font-semibold text-slate-900 mb-2">
                  Failed adversarial cases ({scorecard.breakdown.failedAdversarialCases.length})
                </p>
                <ul className="space-y-2 text-sm">
                  {scorecard.breakdown.failedAdversarialCases.map((c, i) => (
                    <li key={i} className="border-l-2 border-red-300 pl-3">
                      <p className="font-medium text-slate-900">[{c.category}] {c.prompt}</p>
                      <p className="text-xs text-slate-700">Reason: {c.reason}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
