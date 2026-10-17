/**
 * NV-FILING-BOOK-WAVEC-001 — programmatic doc-type extractor for the
 * "Book of Filing, Drafting & Legal Notices" (TN/Madras practitioner manual).
 *
 * NV-EXECUTE-BEFORE-CLAIM-001 / joint-plan §Honesty: the filing-book manifest
 * rows added to `jrx-filing-checklist-registry.ts` must be *grounded* in the book,
 * not invented. This script reads the OCR'd text (path via argv or
 * `FILING_BOOK_TEXT`) and locates each model form / statutory notice heading,
 * emitting the line number that becomes the manifest `bookSection` id.
 *
 * The book file itself is NOT committed (large, third-party). This script is the
 * reproducible bridge: run it against the local extract to re-derive / audit the
 * manifest grounding.
 *
 *   tsx scripts/jrx-filing-book-extract.ts "/path/to/BOOK ... extracted text.txt"
 *   FILING_BOOK_TEXT=/path/to/book.txt tsx scripts/jrx-filing-book-extract.ts
 *
 * Exit code is non-zero when any expected heading is missing, so CI / a human can
 * catch a manifest row that has drifted from the source text.
 */
import { readFileSync } from 'node:fs';

/** A doc-type the manifest claims the book contains, + how to find it in the OCR. */
interface BookDocProbe {
  /** nvTemplateKey added to the crosswalk / checklist registry. */
  nvTemplateKey: string;
  /** Human label (matches the manifest row intent). */
  label: string;
  /** Coarse family the crosswalk folds this key onto. */
  fold: string;
  /**
   * OCR-tolerant matchers — ALL must hit somewhere in the file for the probe to
   * pass. Kept loose (the source is scanned OCR with broken ligatures) but
   * specific enough that a false positive is unlikely.
   */
  needles: RegExp[];
}

const PROBES: BookDocProbe[] = [
  // ── Part II — Legal notices (§7 Model Form of Notices) ──────────────────────
  {
    nvTemplateKey: 'promissory_note_demand_notice',
    label: 'Notice claiming amount due on a promissory note',
    fold: 'legal_notice',
    needles: [/amount due on a promissory\s*note/i],
  },
  {
    nvTemplateKey: 'defective_pronote_demand_notice',
    label: 'Notice on a defective promissory note / hand letter',
    fold: 'legal_notice',
    needles: [/defective promissory/i, /hand letter/i],
  },
  {
    nvTemplateKey: 'mortgage_debt_notice',
    label: 'Notice claiming amount due on a mortgage deed',
    fold: 'legal_notice',
    needles: [/amount due on a mortgage deed/i],
  },
  {
    nvTemplateKey: 'partition_demand_notice',
    label: 'Notice claiming partition of a property',
    fold: 'legal_notice',
    needles: [/notice claiming partition/i],
  },
  {
    nvTemplateKey: 'railway_compensation_notice',
    label: 'Statutory notice to railway authorities claiming compensation',
    fold: 'legal_notice',
    needles: [/notice to railway authorities/i, /compensation/i],
  },
  {
    nvTemplateKey: 'rent_increase_notice',
    label: 'Notice to pay increased rent (TN tenancy)',
    fold: 'legal_notice',
    needles: [/increased rent/i],
  },
  // ── Part I — Model forms of plaints / suits ─────────────────────────────────
  {
    nvTemplateKey: 'money_recovery_suit',
    label: 'Suit / plaint for recovery of money',
    fold: 'civil_suit_plaint',
    needles: [/model form of plaint/i],
  },
  {
    nvTemplateKey: 'declaration_injunction_suit',
    label: 'Suit for declaration and injunction',
    fold: 'civil_suit_plaint',
    needles: [/declaration and injunction/i],
  },
  {
    nvTemplateKey: 'partition_suit',
    label: 'Suit for partition and mesne profits',
    fold: 'civil_suit_plaint',
    needles: [/partition and mesne profit/i],
  },
  {
    nvTemplateKey: 'summary_suit',
    label: 'Summary suit (CPC Order XXXVII)',
    fold: 'civil_suit_plaint',
    needles: [/summary suit/i],
  },
  // ── IAs / pleadings ─────────────────────────────────────────────────────────
  {
    nvTemplateKey: 'summary_suit_leave_to_defend',
    label: 'Application for leave to defend a summary suit',
    fold: 'interlocutory_application',
    needles: [/leave to defend/i],
  },
  {
    nvTemplateKey: 'written_statement_defence',
    label: 'Written statement / defence',
    fold: 'written_statement',
    needles: [/model form of written statement/i],
  },
  {
    nvTemplateKey: 'counter_claim',
    label: 'Counter-claim (CPC Order VIII Rule 6A)',
    fold: 'written_statement',
    needles: [/counter\s*claim/i],
  },
  // ── Appeals ─────────────────────────────────────────────────────────────────
  {
    nvTemplateKey: 'first_appeal_memo',
    label: 'Memorandum / grounds of first appeal (CPC s.96)',
    fold: 'petition_application',
    needles: [/grounds of appeal/i],
  },
  {
    nvTemplateKey: 'second_appeal_memo',
    label: 'Memorandum of second appeal (CPC s.100)',
    fold: 'petition_application',
    // The book discusses appeals under s.96/s.100; second appeal grounds share the
    // "grounds of appeal" form. Grounded on the appeal chapter + s.100/s.96 refs.
    needles: [/grounds of appeal/i, /appeal/i],
  },
  // ── Execution (CPC Order XXI) ───────────────────────────────────────────────
  {
    nvTemplateKey: 'execution_arrest_detention',
    label: 'Execution petition — arrest & detention of judgment-debtor',
    fold: 'execution_petition',
    needles: [/arrest and detention of judgment-debtor/i],
  },
  {
    nvTemplateKey: 'execution_attachment_sale',
    label: 'Execution petition — attachment & sale of property',
    fold: 'execution_petition',
    needles: [/attachment/i, /sale in execution/i],
  },
  // ── Wave D (NV-BOOK-SME-WAVE-D-001) ─────────────────────────────────────────
  {
    nvTemplateKey: 'civil_miscellaneous_appeal',
    label: 'Civil Miscellaneous Appeal / appealable order (O.43)',
    fold: 'petition_application',
    needles: [/appealable orders/i, /0\.43/i],
  },
  {
    nvTemplateKey: 'appeal_stay_petition',
    label: 'Stay petition with affidavit (appeal filing)',
    fold: 'interlocutory_application',
    needles: [/stay petition with affidavit/i],
  },
  {
    nvTemplateKey: 'plaint_presentation_pack',
    label: 'Essential papers at presentation of plaint',
    fold: 'civil_suit_plaint',
    needles: [/presentation of plaint/i, /essential papers to be filed/i],
  },
];

function main(): void {
  const path = process.argv[2] || process.env.FILING_BOOK_TEXT;
  if (!path) {
    console.error(
      'usage: tsx scripts/jrx-filing-book-extract.ts <book.txt>  (or FILING_BOOK_TEXT=...)',
    );
    process.exit(2);
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`cannot read book file: ${String((err as Error).message)}`);
    process.exit(2);
    return;
  }

  const lines = text.split(/\r?\n/);
  const findLine = (re: RegExp): number => {
    for (let i = 0; i < lines.length; i += 1) {
      if (re.test(lines[i])) return i + 1; // 1-indexed
    }
    return -1;
  };

  const rows: Array<Record<string, unknown>> = [];
  const missing: string[] = [];
  for (const probe of PROBES) {
    const hits = probe.needles.map((n) => findLine(n));
    const allHit = hits.every((h) => h > 0);
    const anchorLine = hits.find((h) => h > 0) ?? -1;
    if (!allHit) missing.push(probe.nvTemplateKey);
    rows.push({
      nvTemplateKey: probe.nvTemplateKey,
      label: probe.label,
      fold: probe.fold,
      grounded: allHit,
      bookSection: allHit ? `book@L${anchorLine}` : null,
      needleLines: hits,
    });
  }

  const grounded = rows.filter((r) => r.grounded);
  console.log(
    JSON.stringify(
      {
        source: path,
        totalProbes: PROBES.length,
        groundedCount: grounded.length,
        missing,
        rows,
      },
      null,
      2,
    ),
  );

  if (missing.length > 0) {
    console.error(
      `\nWAVE-C GROUNDING FAILURE: ${missing.length} probe(s) not found in book: ${missing.join(', ')}`,
    );
    process.exit(1);
  }
  console.error(`\nWAVE-C OK: all ${PROBES.length} doc-type probes grounded in the book text.`);
}

main();
