/**
 * Domain pack — configuration surface for legal-in today, arbitrary domains later.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocparseConfig, DocTypeProfile } from "../types.js";
import { DOC_TYPES } from "../doctype/registry.js";
import { GOVT_DOC_TYPES } from "../doctype/gov-registry.js";
import { CIVIL_DOC_TYPES } from "../doctype/civil-registry.js";
import { IDENTITY_DOC_TYPES } from "../doctype/identity-registry.js";
import { EVIDENCE_DOC_TYPES } from "../doctype/evidence-registry.js";

const PACK_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../domain-packs");

export interface DomainPackJson {
  id: string;
  label: string;
  version: string;
  jurisdiction: string;
  docTypes: Array<{
    code: string;
    label: string;
    family: DocTypeProfile["family"];
    statutoryForm?: string;
    anchorProfile?: DocTypeProfile["anchorProfile"];
    cues: Array<{ re: string; w: number }>;
    antiCues?: Array<{ re: string; w: number }>;
    expectedFields?: string[];
  }>;
  configOverrides?: Partial<DocparseConfig>;
}

function hydrateDocTypes(raw: DomainPackJson["docTypes"]): DocTypeProfile[] {
  return raw.map((d) => ({
    code: d.code,
    label: d.label,
    family: d.family,
    ...(d.statutoryForm ? { statutoryForm: d.statutoryForm } : {}),
    ...(d.anchorProfile ? { anchorProfile: d.anchorProfile } : {}),
    cues: d.cues.map((c) => ({ re: new RegExp(c.re, "i"), w: c.w })),
    ...(d.antiCues
      ? { antiCues: d.antiCues.map((c) => ({ re: new RegExp(c.re, "i"), w: c.w })) }
      : {}),
    expectedFields: d.expectedFields ?? [],
  }));
}

/** Load a JSON domain pack from disk (Phase 4). */
export async function loadDomainPackFromFile(filePath: string): Promise<DomainPack> {
  const resolved = isAbsolute(filePath) ? filePath : join(PACK_ROOT, filePath);
  const raw = JSON.parse(await readFile(resolved, "utf8")) as DomainPackJson;
  return {
    id: raw.id,
    label: raw.label,
    version: raw.version,
    jurisdiction: raw.jurisdiction,
    docTypes: hydrateDocTypes(raw.docTypes),
    configOverrides: raw.configOverrides,
  };
}

export interface DomainPack {
  id: string;
  label: string;
  version: string;
  jurisdiction: string;
  docTypes: DocTypeProfile[];
  configOverrides?: Partial<DocparseConfig>;
}

export function mergeDomainPack(base: DomainPack, extension: Partial<DomainPack>): DomainPack {
  return {
    ...base,
    ...extension,
    docTypes: extension.docTypes ?? base.docTypes,
    configOverrides: { ...base.configOverrides, ...extension.configOverrides },
  };
}

/** Load pack by id — built-ins + JSON POC packs. */
export function loadDomainPack(packId: string): DomainPack {
  switch (packId) {
    case "legal-in":
      return LEGAL_IN_PACK;
    case "legal-in-gov":
      return LEGAL_IN_GOV_PACK;
    case "legal-in-civil":
      return LEGAL_IN_CIVIL_PACK;
    case "legal-in-identity":
      return LEGAL_IN_IDENTITY_PACK;
    case "legal-in-evidence":
      return LEGAL_IN_EVIDENCE_PACK;
    case "insurance-fnol":
      return loadDomainPackSync("insurance-fnol.json");
    default:
      throw new Error(`Unknown domain pack: ${packId}`);
  }
}

function loadDomainPackSync(fileName: string): DomainPack {
  const raw = JSON.parse(readFileSync(join(PACK_ROOT, fileName), "utf8")) as DomainPackJson;
  return {
    id: raw.id,
    label: raw.label,
    version: raw.version,
    jurisdiction: raw.jurisdiction,
    docTypes: hydrateDocTypes(raw.docTypes),
    configOverrides: raw.configOverrides,
  };
}

export const LEGAL_IN_PACK: DomainPack = {
  id: "legal-in",
  label: "India Legal (courts + police + deeds)",
  version: "1.0.0-alpha.1",
  jurisdiction: "IN",
  docTypes: DOC_TYPES,
};

export const LEGAL_IN_GOV_PACK: DomainPack = {
  id: "legal-in-gov",
  label: "India Legal + Government administrative",
  version: "1.0.0-alpha.1",
  jurisdiction: "IN",
  docTypes: [...DOC_TYPES, ...GOVT_DOC_TYPES],
};

export const LEGAL_IN_CIVIL_PACK: DomainPack = {
  id: "legal-in-civil",
  label: "India Legal + Government + Civil registration & company",
  version: "1.0.0-alpha.1",
  jurisdiction: "IN",
  docTypes: [...DOC_TYPES, ...GOVT_DOC_TYPES, ...CIVIL_DOC_TYPES],
};

export const LEGAL_IN_IDENTITY_PACK: DomainPack = {
  id: "legal-in-identity",
  label: "India user onboarding — identity / KYC",
  version: "1.0.0-alpha.1",
  jurisdiction: "IN",
  docTypes: IDENTITY_DOC_TYPES,
};

const MLC_PROFILES = DOC_TYPES.filter((d) => d.code === "MLC" || d.code === "POST_MORTEM");

export const LEGAL_IN_EVIDENCE_PACK: DomainPack = {
  id: "legal-in-evidence",
  label: "India case evidence — photos, imaging, screenshots",
  version: "1.0.0-alpha.1",
  jurisdiction: "IN",
  docTypes: [...EVIDENCE_DOC_TYPES, ...MLC_PROFILES],
};

export interface DomainPackCatalogEntry {
  id: string;
  label: string;
  version: string;
  jurisdiction: string;
  /** Built-in TypeScript pack vs JSON file under domain-packs/. */
  source: "builtin" | "json";
}

/** Partner/registry listing — no docType payloads (keep responses small). */
export function listDomainPacks(): DomainPackCatalogEntry[] {
  const fnol = loadDomainPackSync("insurance-fnol.json");
  return [
    { id: LEGAL_IN_PACK.id, label: LEGAL_IN_PACK.label, version: LEGAL_IN_PACK.version, jurisdiction: LEGAL_IN_PACK.jurisdiction, source: "builtin" },
    { id: LEGAL_IN_GOV_PACK.id, label: LEGAL_IN_GOV_PACK.label, version: LEGAL_IN_GOV_PACK.version, jurisdiction: LEGAL_IN_GOV_PACK.jurisdiction, source: "builtin" },
    { id: LEGAL_IN_CIVIL_PACK.id, label: LEGAL_IN_CIVIL_PACK.label, version: LEGAL_IN_CIVIL_PACK.version, jurisdiction: LEGAL_IN_CIVIL_PACK.jurisdiction, source: "builtin" },
    { id: LEGAL_IN_IDENTITY_PACK.id, label: LEGAL_IN_IDENTITY_PACK.label, version: LEGAL_IN_IDENTITY_PACK.version, jurisdiction: LEGAL_IN_IDENTITY_PACK.jurisdiction, source: "builtin" },
    { id: LEGAL_IN_EVIDENCE_PACK.id, label: LEGAL_IN_EVIDENCE_PACK.label, version: LEGAL_IN_EVIDENCE_PACK.version, jurisdiction: LEGAL_IN_EVIDENCE_PACK.jurisdiction, source: "builtin" },
    { id: fnol.id, label: fnol.label, version: fnol.version, jurisdiction: fnol.jurisdiction, source: "json" },
  ];
}
