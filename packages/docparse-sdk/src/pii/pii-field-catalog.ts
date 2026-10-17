/**
 * PII / sensitive field catalog — masking and UI policy for legal + identity docs.
 */

export type PiiClass =
  | "AADHAAR"
  | "PAN"
  | "BANK_ACCOUNT"
  | "IFSC"
  | "PASSPORT"
  | "DL"
  | "EPIC"
  | "PHONE"
  | "EMAIL"
  | "NAME"
  | "ADDRESS"
  | "NONE";

export interface PiiFieldPolicy {
  fieldPathPattern: string;
  piiClass: PiiClass;
  /** Never pre-fill above this confidence without explicit user accept. */
  autofillCeiling?: number;
  maskInLogs: boolean;
}

const CATALOG: PiiFieldPolicy[] = [
  { fieldPathPattern: "aadhaar", piiClass: "AADHAAR", autofillCeiling: 0.85, maskInLogs: true },
  { fieldPathPattern: "pan", piiClass: "PAN", autofillCeiling: 0.85, maskInLogs: true },
  { fieldPathPattern: "bank", piiClass: "BANK_ACCOUNT", autofillCeiling: 0.8, maskInLogs: true },
  { fieldPathPattern: "ifsc", piiClass: "IFSC", maskInLogs: false },
  { fieldPathPattern: "passport", piiClass: "PASSPORT", autofillCeiling: 0.82, maskInLogs: true },
  { fieldPathPattern: "parties", piiClass: "NAME", autofillCeiling: 0.72, maskInLogs: false },
  { fieldPathPattern: "advocates", piiClass: "NAME", autofillCeiling: 0.75, maskInLogs: false },
  { fieldPathPattern: "phone", piiClass: "PHONE", autofillCeiling: 0.8, maskInLogs: true },
  { fieldPathPattern: "email", piiClass: "EMAIL", maskInLogs: true },
  { fieldPathPattern: "address", piiClass: "ADDRESS", autofillCeiling: 0.7, maskInLogs: false },
];

export function piiPolicyForFieldPath(fieldPath: string): PiiFieldPolicy | undefined {
  const lower = fieldPath.toLowerCase();
  for (const p of CATALOG) {
    if (lower.includes(p.fieldPathPattern)) return p;
  }
  return { fieldPathPattern: "*", piiClass: "NONE", maskInLogs: false };
}

export function listPiiCatalog(): readonly PiiFieldPolicy[] {
  return CATALOG;
}
