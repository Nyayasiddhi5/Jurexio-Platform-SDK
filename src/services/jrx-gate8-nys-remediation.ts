/**
 * NV-GATE8-JRX-001 — Old-law remediation via NYS IPC↔BNS / CrPC↔BNSS / IEA↔BSA.
 * Used by citation/hallucination gates when Gate 8 blocks post-2024 IPC cites.
 */
import { nysCompareOldNew } from './jrx-nys-knowledge-retriever.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';

export async function suggestModernEquivalent(citationText: string): Promise<{
  fromCode?: 'IPC' | 'CrPC' | 'IEA';
  section?: string;
  suggestion?: unknown;
  source: string;
} | null> {
  if (!isJrxFeatureOn('nysKnowledgePlane')) return null;

  const ipc = citationText.match(/\b(?:IPC|Indian\s+Penal\s+Code)\b.*?(\d+[A-Za-z]?)/i)
    || citationText.match(/Section\s+(\d+[A-Za-z]?)\s+IPC/i);
  if (ipc?.[1]) {
    const suggestion = await nysCompareOldNew({ fromCode: 'IPC', section: ipc[1] });
    return { fromCode: 'IPC', section: ipc[1], suggestion, source: 'nys-compare' };
  }

  const crpc = citationText.match(/\b(?:CrPC|Cr\.?\s*P\.?\s*C\.?)\b.*?(\d+[A-Za-z]?)/i)
    || citationText.match(/Section\s+(\d+[A-Za-z]?)\s+CrPC/i);
  if (crpc?.[1]) {
    const suggestion = await nysCompareOldNew({ fromCode: 'CrPC', section: crpc[1] });
    return { fromCode: 'CrPC', section: crpc[1], suggestion, source: 'nys-compare' };
  }

  const iea = citationText.match(/\b(?:IEA|Evidence\s+Act)\b.*?(\d+[A-Za-z]?)/i)
    || citationText.match(/Section\s+(\d+[A-Za-z]?)\s+IEA/i);
  if (iea?.[1]) {
    const suggestion = await nysCompareOldNew({ fromCode: 'IEA', section: iea[1] });
    return { fromCode: 'IEA', section: iea[1], suggestion, source: 'nys-compare' };
  }

  return null;
}
