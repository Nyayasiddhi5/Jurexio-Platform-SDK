/**
 * KYC / user onboarding document profiles (India).
 */
import type { DocTypeProfile } from "../types.js";
import { DOC_TYPES } from "./registry.js";

const ci = (s: string) => new RegExp(s, "i");

export const IDENTITY_EXTRA_DOC_TYPES: DocTypeProfile[] = [
  {
    code: "BAR_COUNCIL_CERT",
    label: "Bar Council enrollment certificate",
    family: "IDENTITY",
    anchorProfile: "IDENTITY_KYC",
    cues: [
      { re: ci("bar\\s+council\\s+of"), w: 14 },
      { re: ci("enrolment\\s+(?:no|number)|enrollment\\s+(?:no|number)"), w: 12 },
      { re: ci("certificate\\s+of\\s+enrolment|certificate\\s+of\\s+enrollment"), w: 13 },
      { re: ci("roll\\s+no"), w: 9 },
      { re: ci("advocate\\s+on\\s+record|advocate"), w: 6 },
    ],
    expectedFields: ["parties", "advocates.enrolmentNo", "user.fullName", "address", "govt.department"],
  },
  {
    code: "DRIVING_LICENCE",
    label: "Driving licence",
    family: "IDENTITY",
    anchorProfile: "IDENTITY_KYC",
    cues: [
      { re: ci("driving\\s+licen[cs]e|\\bDL\\s*No"), w: 12 },
      { re: ci("transport\\s+department|RTO"), w: 9 },
      { re: ci("valid\\s+till|date\\s+of\\s+issue"), w: 5 },
    ],
    expectedFields: ["parties", "ids.dl", "parties.dob", "address"],
  },
  {
    code: "VOTER_ID",
    label: "Voter ID (EPIC)",
    family: "IDENTITY",
    anchorProfile: "IDENTITY_KYC",
    cues: [
      { re: ci("election\\s+commission|\\bEPIC\\b"), w: 12 },
      { re: ci("electors?\\s+photo\\s+identity"), w: 11 },
      { re: ci("voter\\s+id"), w: 8 },
    ],
    expectedFields: ["parties", "ids.epic", "address"],
  },
];

const BASE_IDENTITY = DOC_TYPES.filter((d) => d.family === "IDENTITY");

export const IDENTITY_DOC_TYPES: DocTypeProfile[] = [
  ...BASE_IDENTITY.map((d) => ({ ...d, anchorProfile: d.anchorProfile ?? "IDENTITY_KYC" })),
  ...IDENTITY_EXTRA_DOC_TYPES,
];

export const IDENTITY_DOC_CODES = IDENTITY_DOC_TYPES.map((d) => d.code);

export function isIdentityDocType(code: string): boolean {
  return IDENTITY_DOC_CODES.includes(code);
}
