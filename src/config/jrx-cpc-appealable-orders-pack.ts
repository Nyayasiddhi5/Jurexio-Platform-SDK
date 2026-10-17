/**
 * NV-CPC-APPEALABLE-ORDERS-001 — book-grounded O.43 R.1 appealable-order index
 * (practitioner manual *Book of Filing…* §First Appeal / CMA, OCR L4857+).
 *
 * Advisory data only — not a maintainability guarantee. SME must confirm against
 * the current CPC and High Court amendments before filing.
 */

export interface AppealableOrderEntry {
  /** Stable slug for `filingContext.appealableOrderKey`. */
  id: string;
  label: string;
  /** CPC / section reference as stated in the book. */
  cpcBasis: string;
}

/**
 * Subset of the book's "Following are appealable orders" list (O.43 R.1 practice).
 * Extend only from book extract + SME sign-off (NV-NO-STUB-001).
 */
export const CPC_APPEALABLE_ORDERS_BOOK: readonly AppealableOrderEntry[] = [
  {
    id: 'compensatory-costs-35a',
    label: 'Order on compensatory costs for false or vexatious claims or defences',
    cpcBasis: 'CPC Section 35-A',
  },
  {
    id: 'refusal-leave-s91-s92',
    label: 'Order refusing leave to institute a suit under Section 91 or 92',
    cpcBasis: 'CPC Sections 91–92',
  },
  {
    id: 'compensation-s95',
    label: 'Compensation for arrest, attachment or injunction on insufficient grounds',
    cpcBasis: 'CPC Section 95',
  },
  {
    id: 'fine-arrest-detention-s104h',
    label: 'Order imposing fine or directing arrest/detention (except execution arrest)',
    cpcBasis: 'CPC Section 104(h)',
  },
  {
    id: 'return-plaint-o7-r10',
    label: 'Order under Order VII Rule 10 returning plaint to proper court',
    cpcBasis: 'CPC Order VII Rule 10',
  },
  {
    id: 'set-aside-dismissal-o9-r9',
    label: 'Order setting aside dismissal of suit under Order IX Rule 9',
    cpcBasis: 'CPC Order IX Rule 9',
  },
  {
    id: 'execution-sale-objection-o21',
    label: 'Order under Order XXI Rule 72 or 92 setting aside or refusing to set aside a sale',
    cpcBasis: 'CPC Order XXI Rules 72, 92',
  },
  {
    id: 'reject-o21-r106',
    label: 'Order rejecting application under Order XXI Rule 106(1) (where original R.105 order appealable)',
    cpcBasis: 'CPC Order XXI Rules 105–106',
  },
  {
    id: 'abatement-o22-r9',
    label: 'Order under Order XXII Rule 9 refusing to set aside abatement or dismissal',
    cpcBasis: 'CPC Order XXII Rule 9',
  },
  {
    id: 'leave-o22-r10',
    label: 'Order under Order XXII Rule 10 giving or refusing leave',
    cpcBasis: 'CPC Order XXII Rule 10',
  },
  {
    id: 'indigent-o33',
    label: 'Order under Order XXXIII Rule 5 or 7 rejecting permission to sue as indigent person',
    cpcBasis: 'CPC Order XXXIII Rules 5, 7',
  },
  {
    id: 'interpleader-o35',
    label: 'Orders in interpleader suits under Order XXXV Rules 3, 4 or 6',
    cpcBasis: 'CPC Order XXXV Rules 3, 4, 6',
  },
  {
    id: 'attachment-before-judgment-o38',
    label: 'Order under Order XXXVIII Rules 2, 3 or 6',
    cpcBasis: 'CPC Order XXXVIII Rules 2, 3, 6',
  },
  {
    id: 'injunction-o39',
    label: 'Order under Order XXXIX Rules 1, 2, 2-A, 4 or 10',
    cpcBasis: 'CPC Order XXXIX Rules 1, 2, 2-A, 4, 10',
  },
  {
    id: 'receiver-o40',
    label: 'Order under Order XL Rules 1 or 4',
    cpcBasis: 'CPC Order XL Rules 1, 4',
  },
  {
    id: 'refusal-readmit-o41',
    label: 'Order of refusal under Order XLI Rule 19 to re-admit or Rule 21 to re-hear appeal',
    cpcBasis: 'CPC Order XLI Rules 19, 21',
  },
  {
    id: 'remand-o41',
    label: 'Order under Order XLI Rule 23 or 23-A remanding a case (where appeal lies from appellate decree)',
    cpcBasis: 'CPC Order XLI Rules 23, 23-A',
  },
  {
    id: 'review-o47-r4',
    label: 'Order under Order XLVII Rule 4 granting application for review',
    cpcBasis: 'CPC Order XLVII Rule 4',
  },
] as const;

export type AppealableOrderKey = (typeof CPC_APPEALABLE_ORDERS_BOOK)[number]['id'];

const BY_ID = new Map(CPC_APPEALABLE_ORDERS_BOOK.map((e) => [e.id, e]));

/** Lookup a book-indexed appealable order id (normalized kebab). */
export function resolveAppealableOrderEntry(raw: unknown): AppealableOrderEntry | undefined {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return key ? BY_ID.get(key as AppealableOrderKey) : undefined;
}

export interface AppealMaintainabilityHint {
  recognized: boolean;
  order?: AppealableOrderEntry;
  note: string;
}

/**
 * Advisory maintainability hint when NSP supplies `appealableOrderKey` on
 * `filingContext`. Does not inspect draft text — data-pack match only.
 */
export function hintAppealMaintainability(rawKey: unknown): AppealMaintainabilityHint {
  const entry = resolveAppealableOrderEntry(rawKey);
  if (!entry) {
    return {
      recognized: false,
      note:
        'Appealable-order key not in the book O.43 R.1 index — verify maintainability against CPC Order XLIII and counsel before filing a CMA.',
    };
  }
  return {
    recognized: true,
    order: entry,
    note: `Book-indexed appealable order (${entry.cpcBasis}). Prefer Civil Miscellaneous Appeal (O.43 R.2); confirm limitation and court-fee with registry.`,
  };
}
