/**
 * Government / administrative document profiles (extends legal corpus).
 */
import type { DocTypeProfile } from "../types.js";

const ci = (s: string) => new RegExp(s, "i");

export const GOVT_DOC_TYPES: DocTypeProfile[] = [
  {
    code: "RTI_APPLICATION",
    label: "RTI Application / Appeal",
    family: "STATUTE",
    statutoryForm: "RTI Act 2005",
    anchorProfile: "AFFIDAVIT",
    cues: [
      { re: ci("right\\s+to\\s+information"), w: 12 },
      { re: ci("\\bRTI\\b"), w: 8 },
      { re: ci("information\\s+seeking\\s+application"), w: 10 },
      { re: ci("first\\s+appeal\\s+under\\s+section\\s+19"), w: 9 },
      { re: ci("public\\s+information\\s+officer"), w: 7 },
    ],
    antiCues: [{ re: ci("in\\s+the\\s+(?:high\\s+)?court\\s+of"), w: 5 }],
    expectedFields: ["parties", "dates", "govt.department", "rti.subject"],
  },
  {
    code: "GOVT_ORDER",
    label: "Government Order / Office Memorandum",
    family: "COURT_ADMIN",
    cues: [
      { re: ci("government\\s+order|\\bG\\.?O\\.?\\s*(?:No|№)"), w: 12 },
      { re: ci("office\\s+memorandum|\\bO\\.?M\\.?\\s*(?:No|№)"), w: 11 },
      { re: ci("by\\s+order\\s+of\\s+the\\s+governor"), w: 8 },
      { re: ci("department\\s+of"), w: 5 },
      { re: ci("sd/-\\s*(?:under\\s+)?secretary"), w: 6 },
    ],
    expectedFields: ["govt.orderNumber", "dates", "govt.department", "sections"],
  },
  {
    code: "GAZETTE",
    label: "Gazette Notification / Extraordinary Gazette",
    family: "STATUTE",
    cues: [
      { re: ci("gazette\\s+of\\s+india"), w: 12 },
      { re: ci("extraordinary\\s+gazette"), w: 11 },
      { re: ci("published\\s+by\\s+authority"), w: 8 },
      { re: ci("notification\\s+(?:no|number)"), w: 6 },
      { re: ci("ministry\\s+of"), w: 5 },
    ],
    expectedFields: ["gazette.number", "dates", "sections", "govt.department"],
  },
  {
    code: "TENDER_RFP",
    label: "Tender / RFP / Bid document",
    family: "OTHER",
    cues: [
      { re: ci("request\\s+for\\s+proposal|\\bRFP\\b"), w: 10 },
      { re: ci("invitation\\s+for\\s+bid|\\bIFB\\b|\\bNIT\\b"), w: 9 },
      { re: ci("tender\\s+(?:id|no|number)"), w: 10 },
      { re: ci("earnest\\s+money\\s+deposit|\\bEMD\\b"), w: 7 },
      { re: ci("bid\\s+submission\\s+deadline"), w: 8 },
    ],
    expectedFields: ["tender.id", "dates", "amounts", "govt.department"],
  },
];
