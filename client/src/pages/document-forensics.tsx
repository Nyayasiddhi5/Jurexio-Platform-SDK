import { useState } from "react";

import { nv } from '../lib/jrx-api-paths';
export default function DocumentForensicsPage() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(nv('jrx-legal-tools/forensic/verify'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ documentContent: text }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setResults({
          aiProbability: data.data.aiGeneratedScore,
          verdict: data.data.verdict,
          indicators: data.data.evidence?.aiDetection?.indicators?.map((ind: string) => ({ indicator: ind, score: data.data.aiGeneratedScore })) || [],
          overallScore: data.data.overallAuthenticityScore,
        });
      }
    } catch { /* handled */ } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Document Forensics</h1>
        <p className="text-slate-600 mb-6">AI-generated content detection, forgery analysis, and chain of custody verification</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 className="text-lg font-semibold mb-3">AI Content Detection</h2>
            <textarea value={text} onChange={e => setText(e.target.value)}
              placeholder="Paste text to analyze for AI-generated content..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm min-h-[300px] mb-4 font-mono" />
            <button onClick={handleAnalyze} disabled={loading}
              className="bg-orange-600 hover:bg-orange-700 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 w-full">
              {loading ? "Analyzing..." : "Detect AI Content"}
            </button>
          </div>

          {results && (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <h2 className="text-lg font-semibold mb-4">Analysis Results</h2>
              <div className="space-y-4">
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">AI Probability</p>
                  <p className={`text-3xl font-bold ${results.aiProbability > 0.7 ? "text-red-400" : results.aiProbability > 0.4 ? "text-amber-400" : "text-green-400"}`}>
                    {(results.aiProbability * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-slate-800 rounded-lg p-4">
                  <p className="text-xs text-slate-600 mb-1">Verdict</p>
                  <p className="text-lg font-medium">{results.verdict}</p>
                </div>
                {results.indicators?.length > 0 && (
                  <div>
                    <p className="text-sm text-slate-600 mb-2">Detection Indicators</p>
                    <ul className="space-y-1">
                      {results.indicators.map((ind: any, i: number) => (
                        <li key={i} className="text-sm text-slate-300">
                          {ind.indicator}: <span className="text-amber-400">{(ind.score * 100).toFixed(0)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
