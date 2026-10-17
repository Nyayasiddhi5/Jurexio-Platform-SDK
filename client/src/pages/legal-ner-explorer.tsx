import { useState } from "react";

import { nv } from '../lib/jrx-api-paths';
export default function LegalNerExplorer() {
  const [text, setText] = useState("");
  const [jurisdiction, setJurisdiction] = useState("IN");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleExtract = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(nv('intelligence/legal-ner'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, jurisdiction }),
      });
      const data = await res.json();
      setResult(data.data);
    } catch { /* handled */ } finally { setLoading(false); }
  };

  const entityColor: Record<string, string> = {
    SECTION_REF: "bg-blue-900/50 text-blue-300",
    CASE_NUMBER: "bg-purple-900/50 text-purple-300",
    COURT: "bg-green-900/50 text-green-300",
    JUDGE: "bg-amber-900/50 text-amber-300",
    DATE: "bg-cyan-900/50 text-cyan-300",
    AMOUNT: "bg-red-900/50 text-red-300",
    ORG: "bg-orange-900/50 text-orange-300",
    PARTY_ROLE: "bg-pink-900/50 text-pink-300",
    DEFINED_TERM: "bg-indigo-900/50 text-indigo-300",
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Legal NER Explorer</h1>
        <p className="text-slate-600 mb-6">Named Entity Recognition for legal documents — statutes, cases, courts, parties, dates, amounts</p>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-6">
          <div className="flex gap-4 mb-4">
            <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm">
              <option value="IN">India</option><option value="UK">UK</option>
              <option value="EU">EU</option><option value="US">US</option>
            </select>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Paste legal text for entity extraction..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-4 text-sm min-h-[150px] mb-4" />
          <button onClick={handleExtract} disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? "Extracting..." : "Extract Entities"}
          </button>
        </div>

        {result && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Entities Found ({result.entities.length})</h2>
                <span className="text-sm text-slate-600">Model: {result.model} | Confidence: {(result.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(result.entityCounts).map(([type, count]) => (
                  <span key={type} className={`px-2 py-1 rounded text-xs ${entityColor[type] || "bg-slate-700 text-slate-300"}`}>
                    {type}: {count as number}
                  </span>
                ))}
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {result.entities.map((e: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-800 rounded-lg px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-mono ${entityColor[e.type] || "bg-slate-700 text-slate-300"}`}>{e.type}</span>
                    <span className="text-sm flex-1">{e.text}</span>
                    <span className="text-xs text-slate-700">{(e.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
