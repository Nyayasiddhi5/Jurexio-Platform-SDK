/**
 * NSP case-create intake profile — maps corpus metadata to New Case form sections.
 * Never invents PII (phone, email, father name); leaves blanks for manual entry.
 */

type CnrFieldValue = {
  value: unknown;
  source: string | null;
  confidence: number;
  note?: string;
};

export type CnrTimelineEntry = {
  date: string | null;
  purpose: string | null;
  judge: string | null;
  status: string | null;
  source: string;
  confidence: number;
};

export type CnrPartyEntry = {
  partyType: "Individual" | "Organisation";
  name: string | null;
  fatherName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  advocate: string | null;
  source: string;
  confidence: number;
};

export type CnrWitnessEntry = {
  partyType: "Individual" | "Organisation";
  name: string | null;
  address: string | null;
  advocate: string | null;
  source: string;
  confidence: number;
};

export type CnrFieldManifest = {
  complete: string[];
  partial: string[];
  missing: string[];
  manualRecommended: string[];
};

export type CnrCaseCreateProfile = {
  header: {
    caseTitle: CnrFieldValue;
    cnr: CnrFieldValue;
    filingDate: CnrFieldValue;
    nextHearingDate: CnrFieldValue;
    caseStatus: CnrFieldValue;
    policeStation: CnrFieldValue;
  };
  timeline: CnrTimelineEntry[];
  summary: CnrFieldValue;
  clients: CnrPartyEntry[];
  opposingParties: CnrPartyEntry[];
  witnesses: CnrWitnessEntry[];
  fieldManifest: CnrFieldManifest;
};

export type CaseCreateSourceRow = {
  title?: string | null;
  petitioner?: string | null;
  respondent?: string | null;
  pet_advocate?: string | null;
  res_advocate?: string | null;
  filing_date?: string | null;
  decision_date?: string | null;
  case_status?: string | null;
  disposal_nature?: string | null;
  fir_no?: string | null;
  purpose_name?: string | null;
  description?: string | null;
  judges?: string | null;
  hearings?: unknown;
};

function fv(
  value: unknown,
  source: string | null,
  confidence: number,
  note?: string,
): CnrFieldValue {
  return { value, source, confidence, ...(note ? { note } : {}) };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 && s.toLowerCase() !== "null" ? s : null;
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Normalize vanga mobile hearing rows to NSP timeline shape. */
export function hearingsToTimeline(
  raw: unknown,
  source: string,
): CnrTimelineEntry[] {
  let rows: unknown[] = [];
  if (Array.isArray(raw)) {
    rows = raw;
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {
      rows = [];
    }
  }
  const out: CnrTimelineEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const date =
      dateOnly(
        o.hearing_date ??
          o.business_on_date ??
          o.date ??
          o.hearingDate ??
          o.next_date,
      ) ?? null;
    const purpose = str(
      o.purpose ?? o.purpose_name ?? o.purposeName ?? o.business,
    );
    const judge = str(o.judge ?? o.judge_name ?? o.judges ?? o.court_no);
    const status = str(o.status ?? o.stage ?? o.hearing_status ?? o.case_status);
    if (!date && !purpose && !judge && !status) continue;
    out.push({
      date,
      purpose,
      judge,
      status,
      source,
      confidence: date ? 0.85 : 0.65,
    });
  }
  return out;
}

export function buildCaseTitle(row: CaseCreateSourceRow): string | null {
  const t = str(row.title);
  if (t && !/^CNR\s/i.test(t)) return t;
  const p = str(row.petitioner);
  const r = str(row.respondent);
  if (p && r) return `${p} vs ${r}`;
  return p ?? r ?? t;
}

export function inferOrganisation(name: string | null): "Individual" | "Organisation" {
  if (!name) return "Individual";
  if (
    /\b(Pvt\.?\s*Ltd|Limited|LLP|Inc\.?|Corporation|Company|State of|Union of India|Government|Dept\.?|Department|Authority|Board|Commission|Bank|Municipal|Council)\b/i.test(
      name,
    )
  ) {
    return "Organisation";
  }
  return "Individual";
}

function partyFromName(
  name: string | null,
  advocate: string | null,
  source: string,
): CnrPartyEntry {
  return {
    partyType: inferOrganisation(name),
    name,
    fatherName: null,
    address: null,
    phone: null,
    email: null,
    advocate,
    source,
    confidence: name ? 0.9 : 0,
  };
}

export function timelineFromJudgmentOrders(
  orders: Array<{
    decision_date: string | null;
    purpose_name: string | null;
    judges: string | null;
    disposal_nature: string | null;
  }>,
  source: string,
): CnrTimelineEntry[] {
  const out: CnrTimelineEntry[] = [];
  for (const o of orders) {
    if (!o.decision_date && !o.purpose_name) continue;
    out.push({
      date: o.decision_date,
      purpose: o.purpose_name ?? "Order / judgment",
      judge: o.judges,
      status: o.disposal_nature ?? "Recorded",
      source,
      confidence: 0.75,
    });
  }
  return out;
}

export function mergeTimelines(
  ...lists: CnrTimelineEntry[][]
): CnrTimelineEntry[] {
  const seen = new Set<string>();
  const out: CnrTimelineEntry[] = [];
  for (const list of lists) {
    for (const e of list) {
      const key = `${e.date ?? ""}|${e.purpose ?? ""}|${e.judge ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

export function buildFieldManifest(profile: {
  header: CnrCaseCreateProfile["header"];
  timeline: CnrTimelineEntry[];
  summary: CnrFieldValue;
  clients: CnrPartyEntry[];
  opposingParties: CnrPartyEntry[];
  witnesses: CnrWitnessEntry[];
}): CnrFieldManifest {
  const complete: string[] = ["cnr"];
  const partial: string[] = [];
  const missing: string[] = [];
  const manualRecommended: string[] = [
    "nextHearingDate",
    "clientPhone",
    "clientEmail",
    "clientFatherName",
    "clientAddress",
    "witnessDetails",
  ];

  const check = (key: string, val: unknown, partialOk = false) => {
    const empty =
      val === null ||
      val === undefined ||
      val === "" ||
      (Array.isArray(val) && val.length === 0);
    if (empty) missing.push(key);
    else if (partialOk) partial.push(key);
    else complete.push(key);
  };

  check("caseTitle", profile.header.caseTitle.value);
  check("filingDate", profile.header.filingDate.value, true);
  check("caseStatus", profile.header.caseStatus.value, true);
  check("policeStation", profile.header.policeStation.value);
  check("timeline", profile.timeline.length > 0 ? profile.timeline : null);
  check("summary", profile.summary.value);
  check("clients", profile.clients.some((c) => c.name) ? profile.clients : null);
  check(
    "opposingParties",
    profile.opposingParties.some((c) => c.name) ? profile.opposingParties : null,
  );
  check("witnesses", profile.witnesses.length > 0 ? profile.witnesses : null);

  if (profile.header.nextHearingDate.value === null) {
    missing.push("nextHearingDate");
  }

  return { complete, partial, missing, manualRecommended };
}

export function buildCaseCreateProfile(input: {
  cnr: string;
  source: string;
  detailsSource: string;
  row: CaseCreateSourceRow;
  orders?: Array<{
    decision_date: string | null;
    purpose_name: string | null;
    judges: string | null;
    disposal_nature: string | null;
  }>;
  policeStation?: string | null;
  policeSource?: string | null;
  summaryOverride?: string | null;
  summarySource?: string | null;
}): CnrCaseCreateProfile {
  const { row, source, detailsSource } = input;
  const caseTitle = buildCaseTitle(row);
  const caseStatus =
    str(row.case_status) ??
    (row.disposal_nature || row.decision_date ? "DISPOSED" : null);

  const hearingTimeline = hearingsToTimeline(row.hearings, detailsSource);
  const orderTimeline = input.orders?.length
    ? timelineFromJudgmentOrders(input.orders, source)
    : [];
  const timeline = mergeTimelines(hearingTimeline, orderTimeline);

  const summaryText =
    input.summaryOverride ??
    str(row.description) ??
    null;

  const header = {
    caseTitle: fv(caseTitle, caseTitle ? source : null, caseTitle ? 0.95 : 0),
    cnr: fv(input.cnr, source, 1),
    filingDate: fv(
      row.filing_date ?? null,
      row.filing_date ? detailsSource : null,
      row.filing_date ? 0.8 : 0,
      row.filing_date ? undefined : "often absent in judgment metadata",
    ),
    nextHearingDate: fv(
      null,
      null,
      0,
      "requires live docket — not in judgment corpus",
    ),
    caseStatus: fv(
      caseStatus,
      caseStatus ? source : null,
      caseStatus ? 0.7 : 0,
      caseStatus === "DISPOSED"
        ? "inferred from disposal / decision date when present"
        : undefined,
    ),
    policeStation: fv(
      input.policeStation ?? null,
      input.policeStation ? (input.policeSource ?? source) : null,
      input.policeStation ? 0.75 : 0,
    ),
  };

  const clients = [
    partyFromName(str(row.petitioner), str(row.pet_advocate), detailsSource),
  ].filter((c) => c.name);

  const opposingParties = [
    partyFromName(str(row.respondent), str(row.res_advocate), detailsSource),
  ].filter((c) => c.name);

  const summary = fv(
    summaryText,
    summaryText ? (input.summarySource ?? source) : null,
    summaryText ? 0.7 : 0,
    !summaryText ? "use document extract or manual entry" : undefined,
  );

  const profile: CnrCaseCreateProfile = {
    header,
    timeline,
    summary,
    clients,
    opposingParties,
    witnesses: [],
    fieldManifest: { complete: [], partial: [], missing: [], manualRecommended: [] },
  };
  profile.fieldManifest = buildFieldManifest(profile);
  return profile;
}

const POLICE_STATION_RE =
  /\bat\s+([A-Z][\w.\-]*(?:\s+[A-Z][\w.\-]*){0,4})\s+Police\s+Station\b/i;

export function extractPoliceStationFromText(text: string): string | null {
  const m = POLICE_STATION_RE.exec(text);
  return m?.[1] ? `${m[1].trim()} Police Station` : null;
}

export function caseDetailsNeedsColdPath(
  details: { hearings?: unknown; filing_date?: string | null; case_status?: string | null } | null,
): boolean {
  if (!details) return true;
  const hearings = hearingsToTimeline(details.hearings, "probe");
  if (hearings.length === 0) return true;
  if (!details.filing_date && !details.case_status) return true;
  return false;
}
