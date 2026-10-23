/**
 * NV-BNSS-COURT-APPS-001 — 25 essential BNSS 2023 court applications knowledge pack.
 * Used for drafting overlays, RAG hints, and agent context. Templates live in
 * seed-templates-in-bnss-applications-2026-08.json (auto-loaded by catalog).
 */
export interface BnssCourtApplication {
  id: number;
  name: string;
  sections: string[];
  /** Sections commonly cited in practitioner lists that differ from BNSS headings */
  listAliasSections?: string[];
  category: string;
  formerCrpc: string;
  forum: string;
  useCase: string;
  sampleUse: string;
  templateSlug: string;
  /** Extra match tokens for query routing */
  keywords?: string[];
}

export const BNSS_COURT_APPLICATIONS_25: readonly BnssCourtApplication[] = [
  {
    id: 1,
    name: 'Anticipatory Bail Application',
    sections: ['482'],
    category: 'For Freedom',
    formerCrpc: 'CrPC 438',
    forum: 'Sessions Court / High Court',
    useCase: 'Pre-arrest bail when accused apprehends arrest in non-bailable offence.',
    sampleUse: 'Gurbaksh Singh Sibbia principles applied under BNSS; economic-offence twin conditions where special statutes apply.',
    templateSlug: 'in-bnss-anticipatory-bail-482',
    keywords: ['anticipatory bail', 'pre-arrest', '482 bnss'],
  },
  {
    id: 2,
    name: 'Regular Bail Application',
    sections: ['480', '483'],
    category: 'For Freedom',
    formerCrpc: 'CrPC 439 / 437',
    forum: 'Sessions / Magistrate / High Court',
    useCase: 'Release from custody pending investigation or trial.',
    sampleUse: 'Parity with co-accused; roots in society; no flight risk; charge-sheet filed.',
    templateSlug: 'in-bnss-regular-bail-480-483',
    keywords: ['regular bail', 'bail application', '480 bnss', '483 bnss'],
  },
  {
    id: 3,
    name: 'Default / Statutory Bail Application',
    sections: ['187'],
    category: 'For Freedom',
    formerCrpc: 'CrPC 167(2)',
    forum: 'Magistrate / Sessions',
    useCase: 'Right to bail when investigation not completed within statutory period.',
    sampleUse: '90/60-day default bail clock; indefeasible right until charge-sheet filed.',
    templateSlug: 'in-bnss-default-bail-1873',
    keywords: ['default bail', 'statutory bail', '167', '187(3)'],
  },
  {
    id: 4,
    name: 'Cancellation of Bail Application',
    sections: ['492'],
    listAliasSections: ['494'],
    category: 'For Freedom',
    formerCrpc: 'CrPC 439(2)',
    forum: 'Court that granted bail / superior court',
    useCase:
      'Cancel bail for misuse, absconding, or new facts. Note: practitioner list sometimes cites §494 — BNSS cancellation of bond/bail is §492.',
    sampleUse: 'Accused jumped bail / tampered with witnesses / violated conditions.',
    templateSlug: 'in-bnss-cancellation-bail-492',
    keywords: ['cancellation of bail', 'cancel bail', 'forfeit bond'],
  },
  {
    id: 5,
    name: 'Discharge Application — Sessions Case',
    sections: ['250'],
    category: 'For Dropping Charges',
    formerCrpc: 'CrPC 227',
    forum: 'Sessions / Special Court',
    useCase: 'Discharge at charge consideration for want of sufficient grounds.',
    sampleUse: 'No prima facie case on charge-sheet materials; sifting not mini-trial.',
    templateSlug: 'in-bnss-discharge-sessions-250',
    keywords: ['discharge sessions', 'section 250', 'crpc 227'],
  },
  {
    id: 6,
    name: 'Discharge Application — Warrant Case on Police Report',
    sections: ['262'],
    category: 'For Dropping Charges',
    formerCrpc: 'CrPC 239',
    forum: 'Magistrate',
    useCase: 'Discharge in warrant case instituted on police report.',
    sampleUse: 'Grounds of charge not disclosed; documents do not make out offence.',
    templateSlug: 'in-bnss-discharge-warrant-262',
    keywords: ['discharge warrant', 'section 262', 'police report discharge'],
  },
  {
    id: 7,
    name: 'Discharge Application — Complaint Case',
    sections: ['268'],
    category: 'For Dropping Charges',
    formerCrpc: 'CrPC 245',
    forum: 'Magistrate',
    useCase: 'Discharge in warrant case on complaint after evidence.',
    sampleUse: 'Complainant evidence insufficient to frame charge.',
    templateSlug: 'in-bnss-discharge-complaint-268',
    keywords: ['discharge complaint', 'section 268'],
  },
  {
    id: 8,
    name: 'Application for Alteration of Charge',
    sections: ['239'],
    category: 'For Charge Management',
    formerCrpc: 'CrPC 216',
    forum: 'Trial Court',
    useCase: 'Add, alter or amend charge during trial.',
    sampleUse: 'Evidence discloses different offence; no prejudice if opportunity to meet new charge.',
    templateSlug: 'in-bnss-alteration-charge-239',
    keywords: ['alteration of charge', 'alter charge', 'amend charge'],
  },
  {
    id: 9,
    name: 'Recall of Witness after Alteration of Charge',
    sections: ['240'],
    category: 'For Evidence',
    formerCrpc: 'CrPC 217',
    forum: 'Trial Court',
    useCase: 'Recall/re-examine witnesses after charge alteration.',
    sampleUse: 'Accused seeks further cross-examination on altered charge.',
    templateSlug: 'in-bnss-recall-witness-240',
    keywords: ['recall of witness', 'recall witness', 're-examine'],
  },
  {
    id: 10,
    name: 'Summoning Additional Accused',
    sections: ['358'],
    category: 'For Parties',
    formerCrpc: 'CrPC 319',
    forum: 'Trial Court',
    useCase: 'Summon person not accused who appears to have committed offence.',
    sampleUse: 'Witness names co-accused mid-trial; Hardeep Singh principles.',
    templateSlug: 'in-bnss-summon-additional-accused-358',
    keywords: ['additional accused', 'section 319', 'section 358', 'summon accused'],
  },
  {
    id: 11,
    name: 'Compounding of Offences Application',
    sections: ['359'],
    category: 'For Settlement',
    formerCrpc: 'CrPC 320',
    forum: 'Trial Court',
    useCase: 'Compound compoundable offences with/without court leave.',
    sampleUse: 'Parties settled; offence in compoundable table; leave of court where required.',
    templateSlug: 'in-bnss-compounding-359',
    keywords: ['compounding', 'compound offence', 'compromise'],
  },
  {
    id: 12,
    name: 'Withdrawal from Prosecution',
    sections: ['360'],
    category: 'For Settlement',
    formerCrpc: 'CrPC 321',
    forum: 'Trial Court',
    useCase: 'Public Prosecutor seeks leave to withdraw prosecution.',
    sampleUse: 'State policy / settlement / public interest grounds with court leave.',
    templateSlug: 'in-bnss-withdrawal-prosecution-360',
    keywords: ['withdrawal from prosecution', 'withdraw prosecution', 'section 321'],
  },
  {
    id: 13,
    name: 'Remand Application',
    sections: ['187'],
    category: 'For Custody',
    formerCrpc: 'CrPC 167',
    forum: 'Magistrate',
    useCase: 'Police/judicial custody remand during investigation.',
    sampleUse: 'Further custody needed for investigation; reasons recorded; 15-day / overall limits.',
    templateSlug: 'in-bnss-remand-187',
    keywords: ['remand', 'police custody', 'judicial custody', 'pc remand', 'jc remand'],
  },
  {
    id: 14,
    name: 'Production of Documents / Things',
    sections: ['94'],
    category: 'For Evidence',
    formerCrpc: 'CrPC 91',
    forum: 'Court / Officer',
    useCase: 'Compel production of document or other thing necessary for investigation/trial.',
    sampleUse: 'Bank statements / CCTV / device needed as vital evidence.',
    templateSlug: 'in-bnss-production-documents-94',
    keywords: ['production of documents', 'summons to produce', 'section 91', 'section 94'],
  },
  {
    id: 15,
    name: 'Medical Examination of Accused',
    sections: ['51', '52', '53'],
    category: 'For Investigation',
    formerCrpc: 'CrPC 53/53A/54',
    forum: 'Police / Magistrate',
    useCase: 'Medical examination of accused / rape accused / request by arrested person.',
    sampleUse: 'DNA / injury documentation; safeguards and consent where applicable.',
    templateSlug: 'in-bnss-medical-examination-51-53',
    keywords: ['medical examination', 'medico-legal', 'dna examination'],
  },
  {
    id: 16,
    name: 'Plea Bargaining Application',
    sections: ['289', '290', '291', '292', '293', '294', '295', '296', '297', '298', '299', '300'],
    category: 'For Settlement',
    formerCrpc: 'CrPC Ch.XXIA',
    forum: 'Trial Court',
    useCase: 'Voluntary plea bargaining for eligible offences.',
    sampleUse: 'Not for offences >7 years / socio-economic / against woman/child — check eligibility table.',
    templateSlug: 'in-bnss-plea-bargaining-289-300',
    keywords: ['plea bargaining', 'plea bargain', 'mutual satisfactory disposition'],
  },
  {
    id: 17,
    name: 'Adjournment Application',
    sections: ['346'],
    category: 'For Time/Delay',
    formerCrpc: 'CrPC 309',
    forum: 'Trial Court',
    useCase: 'Reschedule hearing for counsel/witness unavailability or other just cause.',
    sampleUse: 'Counsel in another court; illness; documents awaited — costs may be imposed.',
    templateSlug: 'in-bnss-adjournment-346',
    keywords: ['adjournment', 'postpone hearing', 'section 309'],
  },
  {
    id: 18,
    name: 'Summoning Material Witness',
    sections: ['348'],
    category: 'For Evidence',
    formerCrpc: 'CrPC 311',
    forum: 'Trial Court',
    useCase: 'Summon or recall any person as court witness if essential to just decision.',
    sampleUse: 'Material witness omitted; court power to examine even after arguments.',
    templateSlug: 'in-bnss-summon-material-witness-348',
    keywords: ['material witness', 'section 311', 'section 348', 'court witness'],
  },
  {
    id: 19,
    name: 'Criminal Revision Petition',
    sections: ['438', '439', '440', '441', '442', '443', '444', '445'],
    category: 'For Appellate Correction',
    formerCrpc: 'CrPC 397–401',
    forum: 'Sessions / High Court',
    useCase: 'Revise incorrect, illegal or improper findings/orders of inferior criminal court.',
    sampleUse: 'Interlocutory bar nuances; concurrent Sessions/HC revisional jurisdiction.',
    templateSlug: 'in-bnss-revision-438-445',
    keywords: ['revision petition', 'criminal revision', 'revisional'],
  },
  {
    id: 20,
    name: 'Transfer of Case by High Court',
    sections: ['447'],
    listAliasSections: ['448'],
    category: 'For Forum',
    formerCrpc: 'CrPC 407',
    forum: 'High Court',
    useCase:
      'Transfer case/appeal from one court to another by HC. Note: list sometimes cites §448 — HC transfer is §447 in BNSS.',
    sampleUse: 'Fair trial apprehension; convenience of parties; same class of cases.',
    templateSlug: 'in-bnss-transfer-hc-447',
    keywords: ['transfer high court', 'hc transfer', 'section 407'],
  },
  {
    id: 21,
    name: 'Transfer of Case by Sessions Court',
    sections: ['448'],
    listAliasSections: ['449'],
    category: 'For Forum',
    formerCrpc: 'CrPC 408',
    forum: 'Sessions Court',
    useCase:
      'Sessions Judge transfers cases among Magistrates. Note: list sometimes cites §449 for Sessions transfer — BNSS §448 is Sessions Judge transfer.',
    sampleUse: 'Balance of work; related cases; convenience.',
    templateSlug: 'in-bnss-transfer-sessions-448',
    keywords: ['transfer sessions', 'sessions transfer', 'section 408'],
  },
  {
    id: 22,
    name: 'Suspension of Sentence Pending Appeal',
    sections: ['430'],
    category: 'For Freedom',
    formerCrpc: 'CrPC 389',
    forum: 'Appellate Court',
    useCase: 'Suspend sentence / release on bail pending appeal.',
    sampleUse: 'Short sentence; arguable appeal; no flight risk — Vijay Kumar principles.',
    templateSlug: 'in-bnss-suspension-sentence-430',
    keywords: ['suspension of sentence', 'suspend sentence', 'section 389', 'bail pending appeal'],
  },
  {
    id: 23,
    name: 'Custody of Property Pending Trial',
    sections: ['497'],
    listAliasSections: ['499'],
    category: 'For Property',
    formerCrpc: 'CrPC 451',
    forum: 'Trial Court',
    useCase:
      'Interim custody of property produced before court. Note: list cites §499 — BNSS custody/disposal pending trial is §497.',
    sampleUse: 'Vehicle / seized goods to be given on superdari with bond.',
    templateSlug: 'in-bnss-custody-property-497',
    keywords: ['custody of property', 'superdari', 'interim custody', 'section 451'],
  },
  {
    id: 24,
    name: 'Disposal / Return of Property',
    sections: ['498'],
    listAliasSections: ['500'],
    category: 'For Property',
    formerCrpc: 'CrPC 452',
    forum: 'Trial Court',
    useCase:
      'Final disposal/return of property at conclusion of trial. Note: list cites §500 — conclusion disposal is §498; §500 is appeal against certain property orders.',
    sampleUse: 'Return to rightful owner after acquittal/conviction findings.',
    templateSlug: 'in-bnss-disposal-property-498',
    keywords: ['disposal of property', 'return of property', 'section 452'],
  },
  {
    id: 25,
    name: 'Proclamation & Attachment of Absconding Accused',
    sections: ['84', '85', '86', '87', '88', '89'],
    category: 'For Process',
    formerCrpc: 'CrPC 82–86',
    forum: 'Court issuing process',
    useCase: 'Proclaim absconder and attach property.',
    sampleUse: 'Warrant unexecuted; proclamation published; attachment of property.',
    templateSlug: 'in-bnss-proclamation-attachment-84-89',
    keywords: ['proclamation', 'absconding', 'attachment of property', 'proclaimed offender'],
  },
] as const;

/** Match a user query to BNSS court applications for prompt/RAG injection. */
export function matchBnssCourtApplications(query: string, limit = 5): BnssCourtApplication[] {
  const q = String(query || '').toLowerCase();
  if (!q.trim()) return [];

  const scored = BNSS_COURT_APPLICATIONS_25.map((app) => {
    let score = 0;
    const name = app.name.toLowerCase();
    const nameHead = name.split('—')[0].trim().slice(0, 18);
    if (nameHead.length >= 8 && q.includes(nameHead)) score += 6;

    for (const s of app.sections) {
      if (new RegExp(`\\b(?:bnss\\s*)?(?:§\\s*)?${s}\\b|section\\s+${s}\\b`, 'i').test(q)) {
        score += 8;
      }
    }
    for (const s of app.listAliasSections || []) {
      if (new RegExp(`\\b(?:bnss\\s*)?(?:§\\s*)?${s}\\b|section\\s+${s}\\b`, 'i').test(q)) {
        score += 4;
      }
    }
    for (const kw of app.keywords || []) {
      const kl = kw.toLowerCase();
      if (q.includes(kl)) {
        score += 7;
        continue;
      }
      // Flexible: all words of multi-word keyword present (order-insensitive)
      const parts = kl.split(/\s+/).filter((p) => p.length > 2);
      if (parts.length >= 2 && parts.every((p) => q.includes(p))) {
        score += 6;
      }
    }
    const tokens = name
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4);
    for (const k of tokens) {
      if (q.includes(k)) score += 1;
    }
    return { app, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.app);

  return scored;
}

/** Compact overlay text for system prompts / Queen leaves. */
export function formatBnssApplicationsOverlay(apps: BnssCourtApplication[]): string {
  if (!apps.length) return '';
  const lines = [
    'BNSS 2023 — matched court applications (prefer these sections & template slugs):',
    ...apps.map(
      (a) =>
        `${a.id}. ${a.name} — BNSS §§${a.sections.join(', ')} (${a.formerCrpc}) · ${a.category} · Forum: ${a.forum} · Template: ${a.templateSlug} · Use: ${a.useCase}`,
    ),
    'Draft with Indian pleading format: cause title, MOST RESPECTFULLY SHOWETH, numbered grounds, PRAYER, Verification. Prefer template body from catalog when available. Do not invent citations.',
    'Section-map notes: Cancellation=§492 (not 494); HC transfer=§447 (not 448); Sessions transfer=§448 (not 449); property custody=§497 (not 499); disposal at conclusion=§498 (not 500).',
  ];
  return lines.join('\n');
}

/** True when the query looks like a BNSS court-application drafting/advice ask. */
export function looksLikeBnssCourtApplicationQuery(query: string): boolean {
  return matchBnssCourtApplications(query, 1).length > 0;
}
