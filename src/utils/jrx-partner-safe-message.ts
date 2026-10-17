/**
 * NV-PARTNER-SAFE-MESSAGE-001 — user-facing copy for NSP/BFF responses.
 * Never echo env flags, upstream product names, tier tags, or internal tool ids.
 * Log technical detail server-side only.
 */

export const partnerSafeMessage = {
  caseLookupUnavailable:
    'Case lookup is temporarily unavailable. Please try again in a few minutes.',
  caseSearchUnavailable:
    'Case search is temporarily unavailable. Please try again in a few minutes.',
  caseSearchNotConfigured:
    'Case search is not available on this environment. Contact your administrator.',
  documentBundleUnavailable:
    'Documents for this case could not be loaded right now. Try again or open documents from the matter summary.',
  cnrResolveFailed: 'We could not complete case lookup. Please try again.',
  cnrNotFoundAfterCascade:
    'We could not find this case in our indexed records. Check the identifier or try a different search.',
  filingRefNotFound: 'No matching case found for this filing reference.',
  liveCourtFetchDisabled:
    'Live court registry lookup is not enabled. Use corpus search or enter details manually.',
  liveCourtFetchFailed: 'Live court lookup could not be started. Please try again later.',
  nysUpstreamGeneric: 'Court records service is temporarily unavailable.',
} as const;

export type PartnerSafeMessageKey = keyof typeof partnerSafeMessage;
