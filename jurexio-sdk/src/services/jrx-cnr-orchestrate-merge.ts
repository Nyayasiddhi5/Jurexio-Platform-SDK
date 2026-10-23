/**
 * NV-CNR-ORCHESTRATE-MERGE-001 — seed resolved CNR / matter facts into orchestrate parameters.
 *
 * When partners POST parameters.cnrFacts, parameters.caseContext, parameters.cnrResolve,
 * or top-level cnr / resolvedCnr / matterCnr, normalize into parameters.cnrFacts for
 * formatCnrCaseContext() in draft and research overlays (A-004 specialist path).
 */

type JsonRecord = Record<string, unknown>;

function parseBlock(raw: unknown): JsonRecord | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as JsonRecord;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonRecord;
      }
    } catch { /* non-fatal */ }
  }
  return null;
}

function fieldText(fields: JsonRecord | null | undefined, key: string): string {
  if (!fields || typeof fields !== 'object') return '';
  const raw = fields[key];
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const v = (raw as JsonRecord).value ?? (raw as JsonRecord).text ?? (raw as JsonRecord).display;
    if (v != null) return String(v).trim();
  }
  return '';
}

function partyNames(entries: unknown): string {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const names = entries
    .map((e) => {
      if (!e || typeof e !== 'object') return '';
      const row = e as JsonRecord;
      return String(row.name ?? row.partyName ?? row.display ?? '').trim();
    })
    .filter(Boolean);
  return names.slice(0, 3).join('; ');
}

/** Map CnrResolveData-shaped payload → flat cnrFacts for prompt injection. */
export function cnrResolveToFacts(raw: unknown): JsonRecord | null {
  const block = parseBlock(raw);
  if (!block) return null;

  const data = block.status != null || block.fields != null ? block : parseBlock(block.data);
  if (!data) return null;

  const fields = (data.fields && typeof data.fields === 'object'
    ? data.fields
    : {}) as JsonRecord;
  const caseCreate = data.caseCreate && typeof data.caseCreate === 'object'
    ? (data.caseCreate as JsonRecord)
    : null;

  const petitioner = fieldText(fields, 'petitioner')
    || partyNames(caseCreate?.clients)
    || fieldText(fields, 'petitionerName');
  const respondent = fieldText(fields, 'respondent')
    || partyNames(caseCreate?.opposingParties)
    || fieldText(fields, 'respondentName');

  const nextHearing = fieldText(fields, 'nextHearingDate')
    || fieldText(fields, 'next_hearing_date');

  const out: JsonRecord = {
    cnr: String(data.cnr ?? data.cnrNumber ?? fieldText(fields, 'cnr') ?? '').trim(),
    courtName: fieldText(fields, 'courtName') || fieldText(fields, 'court'),
    highCourt: fieldText(fields, 'highCourt') || fieldText(fields, 'high_court'),
    caseType: fieldText(fields, 'caseType') || fieldText(fields, 'case_type'),
    caseNumber: fieldText(fields, 'caseNumber') || fieldText(fields, 'case_number'),
    filingDate: fieldText(fields, 'filingDate') || fieldText(fields, 'filing_date'),
    registrationDate: fieldText(fields, 'registrationDate') || fieldText(fields, 'registration_date'),
    nextHearingDate: nextHearing,
    stage: fieldText(fields, 'stage') || fieldText(fields, 'caseStage'),
    sections: fieldText(fields, 'sections') || fieldText(fields, 'acts'),
    petitioner,
    respondent,
  };

  const cleaned = Object.fromEntries(
    Object.entries(out).filter(([, v]) => v != null && String(v).trim()),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/** Merge CNR resolve data into orchestrate body.parameters.cnrFacts (non-destructive). */
export function mergeCnrFactsIntoOrchestrateBody(body: JsonRecord): void {
  if (!body || typeof body !== 'object') return;

  const params = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? { ...(body.parameters as JsonRecord) }
    : {};

  const existing = parseBlock(params.cnrFacts) ?? parseBlock(params.caseContext);

  const candidates: unknown[] = [
    params.cnrFacts,
    params.caseContext,
    params.cnrResolve,
    params.resolvedCnr,
    params.matterCnr,
    body.cnrResolve,
    body.resolvedCnr,
    body.matterCnr,
    body.cnrData,
  ];

  if (body.cnr || body.cnrNumber || params.cnr || params.cnrNumber) {
    candidates.unshift({
      cnr: body.cnr ?? body.cnrNumber ?? params.cnr ?? params.cnrNumber,
      fields: params.cnrFields ?? body.cnrFields,
    });
  }

  let merged: JsonRecord | null = existing ? { ...existing } : null;
  for (const raw of candidates) {
    const mapped = cnrResolveToFacts(raw);
    if (mapped) merged = { ...(merged ?? {}), ...mapped };
  }

  if (merged && Object.keys(merged).length > 0) {
    params.cnrFacts = merged;
  }

  const options = body.options && typeof body.options === 'object' && !Array.isArray(body.options)
    ? (body.options as JsonRecord)
    : {};
  if (options.draftLength != null && params.draftLength == null) {
    params.draftLength = options.draftLength;
  }

  if (Object.keys(params).length > 0) {
    body.parameters = params;
  }
}
