import { useState } from "react";

import { nv } from '../lib/jrx-api-paths';
export default function LlmJudgeConsole() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [jurisdiction, setJurisdiction] = useState("IN");
  const [domain, setDomain] = useState("criminal");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleEvaluate = async () => {
    if (!query.trim() || !response.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(nv('testing/llm-judge'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query, response, jurisdiction, domain }),
      });
      const data = await res.json();
      setResult(data.data);
    } catch { /* handled */ } finally { setLoading(false); }
  };

  const scoreBar = (label: string, score: number) => (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-300">{label}</span>
        <span className={score >= 8 ? "text-green-400" : score >= 6 ? "text-amber-400" : "text-red-400"}>{score}/10</span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2">
        <div className={`h-2 rounded-full ${score >= 8 ? "bg-green-500" : score >= 6 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${score * 10}%` }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">LLM-as-Judge Console</h1>
        <p className="text-slate-600 mb-6">Evaluate AI response quality across 5 legal dimensions</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-4">
            <div className="flex gap-3">
              <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm flex-1">
                <option value="IN">India</option><option value="UK">UK</option>
                <option value="EU">EU</option><option value="US">US</option>
              </select>
              <select value={domain} onChange={e => setDomain(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm flex-1">
                <option value="criminal">Criminal</option><option value="civil">Civil</option>
                <option value="corporate">Corporate</option><option value="tax">Tax</option>
                <option value="ip">IP</option><option value="family">Family</option>
                <option value="constitutional">Constitutional</option>
              </select>
            </div>
            <textarea value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Legal query..." className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm min-h-[80px]" />
            <textarea value={response} onChange={e => setResponse(e.target.value)}
              placeholder="AI response to evaluate..." className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm min-h-[200px]" />
            <button onClick={handleEvaluate} disabled={loading}
              className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 w-full">
              {loading ? "Evaluating..." : "Run LLM Judge"}
            </button>
          </div>

          {result && (
            <div className="space-y-4">
              <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">Scores</h2>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${result.passedThreshold ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"}`}>
                    {result.weightedTotal}/10 — {result.passedThreshold ? "PASS" : "FAIL"}
                  </span>
                </div>
                {scoreBar("Legal Accuracy (30%)", result.scores.legalAccuracy)}
                {scoreBar("Citation Quality (25%)", result.scores.citationQuality)}
                {scoreBar("Jurisdiction (20%)", result.scores.jurisdictionCorrectness)}
                {scoreBar("Bias Absence (15%)", result.scores.biasAbsence)}
                {scoreBar("Actionability (10%)", result.scores.actionability)}
              </div>

              {result.flaggedIssues?.length > 0 && (
                <div className="bg-slate-900 rounded-xl border border-red-900/50 p-6">
                  <h3 className="text-lg font-semibold text-red-400 mb-3">Flagged Issues</h3>
                  <ul className="space-y-2">
                    {result.flaggedIssues.map((issue: string, i: number) => (
                      <li key={i} className="text-sm text-red-300">⚠ {issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
