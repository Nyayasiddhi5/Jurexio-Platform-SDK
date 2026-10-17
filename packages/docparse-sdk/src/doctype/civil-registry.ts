/**
 * Civil / company / registration documents (extends legal + gov corpus).
 */
import type { DocTypeProfile } from "../types.js";

const ci = (s: string) => new RegExp(s, "i");

export const CIVIL_DOC_TYPES: DocTypeProfile[] = [
  {
    code: "STATE_COMPANY_REGISTRATION",
    label: "State registration / Mee Seva / shop establishment certificate",
    family: "OTHER",
    anchorProfile: "COMPANY_REGISTRATION",
    cues: [
      { re: ci("mee\\s*seva"), w: 14 },
      { re: ci("\\bregistration\\b"), w: 10 },
      { re: ci("certificate\\s+of\\s+registration"), w: 12 },
      { re: ci("shop\\s+(?:and\\s+)?establishment"), w: 11 },
      { re: ci("government\\s+of"), w: 6 },
      { re: ci("telangana|maharashtra|karnataka|delhi|tamil\\s+nadu"), w: 5 },
    ],
    antiCues: [{ re: ci("in\\s+the\\s+(?:high\\s+)?court\\s+of"), w: 8 }],
    expectedFields: [
      "company.name",
      "ids.cin",
      "registration.number",
      "registered.address",
      "dates",
      "govt.department",
    ],
  },
  {
    code: "MCA_CERTIFICATE",
    label: "MCA certificate of incorporation / company master data",
    family: "OTHER",
    anchorProfile: "COMPANY_REGISTRATION",
    cues: [
      { re: ci("certificate\\s+of\\s+incorporation"), w: 14 },
      { re: ci("corporate\\s+identity\\s+number|\\bCIN\\b"), w: 12 },
      { re: ci("ministry\\s+of\\s+corporate\\s+affairs|\\bMCA\\b"), w: 10 },
      { re: ci("companies\\s+act"), w: 8 },
    ],
    expectedFields: ["company.name", "ids.cin", "registration.number", "registered.address", "dates"],
  },
  {
    code: "GST_REGISTRATION",
    label: "GST registration certificate",
    family: "OTHER",
    anchorProfile: "COMPANY_REGISTRATION",
    cues: [
      { re: ci("goods\\s+and\\s+services\\s+tax|\\bGSTIN\\b"), w: 14 },
      { re: ci("registration\\s+certificate"), w: 8 },
      { re: ci("central\\s+goods\\s+and\\s+services"), w: 10 },
    ],
    expectedFields: ["company.name", "ids.gstin", "registered.address", "registration.number", "dates"],
  },
];

export const CIVIL_COMPANY_DOC_CODES = CIVIL_DOC_TYPES.map((d) => d.code);

export function isCivilCompanyDocType(code: string): boolean {
  return CIVIL_COMPANY_DOC_CODES.includes(code);
}
