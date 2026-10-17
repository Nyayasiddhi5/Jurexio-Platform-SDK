/**
 * 14-group Case Detail layout — mirrors NSP-CASE-SEARCH-INTEGRATION §20.
 * Keys align with NYV 56-field resolve envelope (SDK 5.2.0).
 */
export type CnrFieldGroupDef = {
  id: string;
  title: string;
  description?: string;
  fields: Array<{ key: string; label: string; wide?: boolean }>;
};

export const CNR_FIELD_GROUPS: CnrFieldGroupDef[] = [
  {
    id: "identification",
    title: "Identification",
    fields: [
      { key: "cnr", label: "CNR" },
      { key: "caseNo", label: "Case number" },
      { key: "caseType", label: "Case type code" },
      { key: "caseTypeDisplay", label: "Case type (display)" },
      { key: "caseTitle", label: "Title", wide: true },
      { key: "citation", label: "Citation" },
      { key: "filingNumber", label: "Filing number" },
      { key: "registrationNumber", label: "Registration number" },
      { key: "registrationYear", label: "Registration year" },
      { key: "diaryNumber", label: "Diary number" },
    ],
  },
  {
    id: "status",
    title: "Status & dates",
    fields: [
      { key: "caseStatus", label: "Case status" },
      { key: "disposalNature", label: "Disposal nature" },
      { key: "filingDate", label: "Filing date" },
      { key: "registrationDate", label: "Registration date" },
      { key: "firstHearingDate", label: "First hearing" },
      { key: "decisionDate", label: "Decision date" },
      { key: "nextHearingDate", label: "Next hearing" },
    ],
  },
  {
    id: "bench",
    title: "Bench & venue",
    fields: [
      { key: "courtName", label: "Court" },
      { key: "courtType", label: "Court tier" },
      { key: "courtCode", label: "Court code" },
      { key: "complexCode", label: "Complex code" },
      { key: "complexName", label: "Complex" },
      { key: "stateName", label: "State" },
      { key: "districtName", label: "District" },
      { key: "judges", label: "Judges" },
      { key: "benchComposition", label: "Bench composition" },
      { key: "judicialSection", label: "Judicial section" },
      { key: "coram", label: "Coram" },
    ],
  },
  {
    id: "parties",
    title: "Parties & advocates",
    fields: [
      { key: "petitioner", label: "Petitioner" },
      { key: "respondent", label: "Respondent" },
      { key: "petitioners", label: "Petitioners (list)" },
      { key: "respondents", label: "Respondents (list)" },
      { key: "partyDetails", label: "Party details (PII)", wide: true },
      { key: "advocates", label: "Advocates" },
    ],
  },
  {
    id: "legal",
    title: "Acts & sections",
    fields: [{ key: "actsSections", label: "Acts & sections", wide: true }],
  },
  {
    id: "category",
    title: "Category",
    fields: [
      { key: "hcCategoryDetails", label: "HC category", wide: true },
      { key: "caseCategory", label: "SC case category", wide: true },
    ],
  },
  {
    id: "interlocutory",
    title: "Interlocutory applications",
    fields: [
      { key: "iaFilings", label: "IA filings (HC)", wide: true },
      { key: "interlocutoryApplications", label: "Interlocutory (SC)", wide: true },
    ],
  },
  {
    id: "hearings",
    title: "Hearing history",
    fields: [{ key: "hearings", label: "Hearings", wide: true }],
  },
  {
    id: "orders",
    title: "Orders & judgments",
    description:
      "HC order filenames are relative paths — not presigned until NV-HC-ORDER-PRESIGN-001. Judgment PDFs are in Documents below.",
    fields: [
      { key: "finalOrders", label: "Final orders", wide: true },
      { key: "interimOrders", label: "Interim orders", wide: true },
    ],
  },
  {
    id: "lower",
    title: "Lower / earlier courts",
    fields: [
      { key: "lowerCourtReference", label: "Lower court reference", wide: true },
      { key: "earlierCourtDetails", label: "Earlier court details (SC)", wide: true },
    ],
  },
  {
    id: "fir",
    title: "FIR & incident",
    fields: [
      { key: "firNo", label: "FIR number" },
      { key: "firYear", label: "FIR year" },
      { key: "policeStation", label: "Police station" },
      { key: "incidentDate", label: "Incident date" },
    ],
  },
  {
    id: "linked",
    title: "Linked matters",
    fields: [{ key: "linkedMatters", label: "Linked / connected cases", wide: true }],
  },
  {
    id: "other",
    title: "Other details",
    fields: [{ key: "summary", label: "Summary", wide: true }],
  },
  {
    id: "registry",
    title: "Registry & honesty",
    fields: [
      { key: "registryObjections", label: "Registry objections", wide: true },
      { key: "registryDefects", label: "Registry defects (SC)", wide: true },
    ],
  },
];
