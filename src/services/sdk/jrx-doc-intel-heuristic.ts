/**
 * NV-NSP-INTEL-HEURISTIC-001 — deterministic entity seed when LLM JSON is empty.
 * Pure helpers (no DB) so unit tests stay light.
 */

export function heuristicDocumentIntelligence(documentText: string): {
  entities: Record<string, Array<Record<string, unknown>>>;
  summary: { overallRiskLevel: string; confidence: number; note: string };
} {
  const text = String(documentText || '');
  const entities: Record<string, Array<Record<string, unknown>>> = {
    obligations: [],
    risks: [],
    deadlines: [],
    entities: [],
  };

  const partyRe =
    /(?:between|among)\s+([^;\n]+?)\s+and\s+([^;\n(]+?)(?:\s*\(|,|\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = partyRe.exec(text)) !== null) {
    entities.entities.push({ name: m[1].replace(/["']/g, '').trim(), role: 'party' });
    entities.entities.push({ name: m[2].replace(/["']/g, '').trim(), role: 'party' });
  }
  const corpRe =
    /\b([A-Z][A-Za-z0-9&.'\-\s]{2,60}?(?:Pvt\.?\s*Ltd\.?|Private Limited|Ltd\.?|LLP|Inc\.?|LLC))\b/g;
  while ((m = corpRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (!entities.entities.some((e) => String(e.name).toLowerCase() === name.toLowerCase())) {
      entities.entities.push({ name, role: 'organization' });
    }
  }

  const shallRe = /([^.!?\n]{10,180}?\b(?:shall|must|agrees to|is required to)\b[^.!?\n]{5,160})/gi;
  while ((m = shallRe.exec(text)) !== null && entities.obligations.length < 12) {
    entities.obligations.push({ text: m[1].trim(), type: 'obligation' });
  }

  const riskHints = [
    /indemnif\w+[^.!?\n]{0,120}/gi,
    /gross negligence[^.!?\n]{0,80}/gi,
    /wilful misconduct[^.!?\n]{0,80}/gi,
    /material breach[^.!?\n]{0,80}/gi,
    /liquidated damages[^.!?\n]{0,80}/gi,
  ];
  for (const re of riskHints) {
    while ((m = re.exec(text)) !== null && entities.risks.length < 12) {
      entities.risks.push({ text: m[0].trim(), severity: 'medium' });
    }
  }

  const deadlineRe =
    /\b(\d+\s*(?:years?|months?|days?))\b|\((\d+)\)\s*(?:years?|months?|days?)\b|\b(?:three|twenty-four|twenty four|twelve|six|thirty)\s*(?:\((\d+)\))?\s*(?:years?|months?|days?)\b|\bwithin\s+(\d+\s*(?:years?|months?|days?))\b/gi;
  while ((m = deadlineRe.exec(text)) !== null && entities.deadlines.length < 12) {
    const label = (m[1] || m[2] || m[3] || m[4] || m[0]).toString().trim();
    entities.deadlines.push({
      text: label,
      type: 'duration',
    });
  }
  if (/governing law[^.!?\n]{0,80}/i.test(text)) {
    const g = text.match(/governing law[^.!?\n]{0,100}/i);
    if (g) entities.entities.push({ name: g[0].trim(), role: 'governing_law' });
  }

  const riskCount = entities.risks.length;
  return {
    entities,
    summary: {
      overallRiskLevel: riskCount >= 3 ? 'high' : riskCount >= 1 ? 'medium' : 'low',
      confidence: 0.62,
      note: 'Heuristic extraction seeded structured fields for NSP ai-summary cache.',
    },
  };
}

export function parseIntelligenceJson(content: string): Record<string, any> | null {
  const raw = String(content || '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function mergeEntityArrays(
  primary: Record<string, any>,
  fallback: Record<string, Array<Record<string, unknown>>>,
  analysisTypes: string[],
): Record<string, any> {
  const out: Record<string, any> = { ...primary };
  for (const type of analysisTypes) {
    const a = Array.isArray(out[type]) ? out[type] : [];
    const b = Array.isArray(fallback[type]) ? fallback[type] : [];
    out[type] = a.length ? a : b;
  }
  return out;
}
