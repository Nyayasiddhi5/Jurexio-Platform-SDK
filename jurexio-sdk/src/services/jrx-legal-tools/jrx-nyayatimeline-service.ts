import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-nyayatimeline-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface LimitationResult {
  causeOfAction: string;
  jurisdiction: JurisdictionCode;
  limitationPeriod: string;
  expiryDate: Date;
  daysRemaining: number;
  legalBasis: string;
  warnings: string[];
  isExpired: boolean;
}

interface ProceduralChecklist {
  caseType: string;
  court: string;
  jurisdiction: JurisdictionCode;
  steps: ProceduralStep[];
  estimatedDurationDays: number;
  lastUpdated: Date;
}

interface ProceduralStep {
  stepNumber: number;
  name: string;
  description: string;
  typicalDurationDays: number;
  deadlineType: 'mandatory' | 'directory' | 'court-discretion';
  legalBasis: string;
  prerequisites: number[];
}

interface CourtSchedule {
  courtCode: string;
  caseNumber: string;
  nextHearingDate: Date | null;
  hearingHistory: { date: Date; purpose: string; outcome: string }[];
  estimatedDisposalDate: Date | null;
}

interface DeadlineRisk {
  matterId: string;
  deadlineDate: Date;
  daysRemaining: number;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  legalConsequence: string;
}

interface TimelineData {
  matterId: string;
  events: TimelineEvent[];
  upcomingDeadlines: DeadlineRisk[];
  milestones: { name: string; date: Date; completed: boolean }[];
}

interface TimelineEvent {
  date: Date;
  type: string;
  description: string;
  documents: string[];
}

interface MissedDeadlineAlert {
  matterId: string;
  deadline: string;
  missedBy: number;
  consequence: string;
  remedialAction: string;
}

const LIMITATION_PERIODS: Record<string, Record<string, { years: number; basis: string }>> = {
  'IN': {
    'contract-breach': { years: 3, basis: 'Limitation Act 1963, Article 55' },
    'tort': { years: 3, basis: 'Limitation Act 1963, Article 36' },
    'recovery-of-money': { years: 3, basis: 'Limitation Act 1963, Article 35' },
    'defamation': { years: 1, basis: 'Limitation Act 1963, Article 75' },
    'specific-performance': { years: 3, basis: 'Limitation Act 1963, Article 54' },
    'motor-accident': { years: 6, basis: 'Limitation Act 1963, Article 137' },
    'cheque-bounce': { years: 1, basis: 'NI Act 1881, Section 142(b)' },
    'consumer-complaint': { years: 2, basis: 'Consumer Protection Act 2019, Section 69' },
    'divorce': { years: 0, basis: 'No limitation (Hindu Marriage Act 1955)' },
    'property-possession': { years: 12, basis: 'Limitation Act 1963, Article 65' },
    // NV-TIMELINE-LIMITATION-EXPAND-001 — book-grounded civil causes of action
    // (Limitation Act 1963 schedule). Year-based substantive suit/notice limits
    // that the draftProfile limitation assembler resolves from documentType.
    'money-recovery': { years: 3, basis: 'Limitation Act 1963, Article 35' },
    'rent-arrears': { years: 3, basis: 'Limitation Act 1963, Article 52' },
    'declaration': { years: 3, basis: 'Limitation Act 1963, Article 58' },
    'account': { years: 3, basis: 'Limitation Act 1963, Article 3' },
    'partition': { years: 12, basis: 'Limitation Act 1963, Article 110' },
    'mortgage-recovery': { years: 12, basis: 'Limitation Act 1963, Article 62' },
    'eviction-suit': { years: 12, basis: 'Limitation Act 1963, Article 65 (possession on title)' },
    'execution-of-decree': { years: 12, basis: 'Limitation Act 1963, Article 136' },
    'set-aside-transfer': { years: 3, basis: 'Limitation Act 1963, Article 59' },
    'mandatory-injunction-enforcement': {
      years: 3,
      basis: 'Limitation Act 1963, Article 135 — enforcement of mandatory injunction decree (book §6 item 2)',
    },
  },
  'UK': {
    'contract-breach': { years: 6, basis: 'Limitation Act 1980, s.5' },
    'tort': { years: 6, basis: 'Limitation Act 1980, s.2' },
    'personal-injury': { years: 3, basis: 'Limitation Act 1980, s.11' },
    'defamation': { years: 1, basis: 'Limitation Act 1980, s.4A' },
    'recovery-of-money': { years: 6, basis: 'Limitation Act 1980, s.5' },
  },
  'EU': {
    'contract-breach': { years: 5, basis: 'Varies by member state — common: 5 years' },
    'tort': { years: 3, basis: 'Varies by member state — common: 3 years' },
    'gdpr-claim': { years: 3, basis: 'GDPR Art. 82 + national implementation' },
  },
  'US': {
    'contract-breach': { years: 4, basis: 'UCC §2-725 (sale of goods); varies by state for others' },
    'tort': { years: 2, basis: 'Varies by state — common: 2-3 years' },
    'personal-injury': { years: 2, basis: 'Varies by state — common: 2-3 years' },
    'defamation': { years: 1, basis: 'Varies by state — common: 1-2 years' },
    'fraud': { years: 6, basis: 'Varies by state — common: 3-6 years' },
  },
  'GCC': {
    'contract-breach': { years: 10, basis: 'UAE Civil Code Art. 473 (commercial: 10 years)' },
    'tort': { years: 3, basis: 'UAE Civil Code Art. 298' },
    'labour-dispute': { years: 1, basis: 'UAE Labour Law Art. 6' },
  },
  'SG': {
    'contract-breach': { years: 6, basis: 'Limitation Act (Cap 163), s.6' },
    'tort': { years: 6, basis: 'Limitation Act (Cap 163), s.6' },
    'personal-injury': { years: 3, basis: 'Limitation Act (Cap 163), s.24A' },
  },
};

const PROCEDURAL_TEMPLATES: Record<string, Record<string, ProceduralStep[]>> = {
  'IN': {
    'criminal': [
      { stepNumber: 1, name: 'FIR/Complaint', description: 'Filing of First Information Report or complaint', typicalDurationDays: 1, deadlineType: 'mandatory', legalBasis: 'BNSS 2023, Section 173', prerequisites: [] },
      { stepNumber: 2, name: 'Investigation', description: 'Police investigation and evidence collection', typicalDurationDays: 60, deadlineType: 'directory', legalBasis: 'BNSS 2023, Section 193', prerequisites: [1] },
      { stepNumber: 3, name: 'Chargesheet', description: 'Filing of chargesheet/final report', typicalDurationDays: 90, deadlineType: 'mandatory', legalBasis: 'BNSS 2023, Section 193', prerequisites: [2] },
      { stepNumber: 4, name: 'Cognizance', description: 'Court takes cognizance of offence', typicalDurationDays: 14, deadlineType: 'court-discretion', legalBasis: 'BNSS 2023, Section 230', prerequisites: [3] },
      { stepNumber: 5, name: 'Charge Framing', description: 'Framing of formal charges', typicalDurationDays: 30, deadlineType: 'court-discretion', legalBasis: 'BNSS 2023, Section 251', prerequisites: [4] },
      { stepNumber: 6, name: 'Trial', description: 'Prosecution and defence evidence', typicalDurationDays: 180, deadlineType: 'court-discretion', legalBasis: 'BNSS 2023, Chapter XXIV', prerequisites: [5] },
      { stepNumber: 7, name: 'Arguments', description: 'Final arguments by both sides', typicalDurationDays: 30, deadlineType: 'court-discretion', legalBasis: 'BNSS 2023, Section 281', prerequisites: [6] },
      { stepNumber: 8, name: 'Judgment', description: 'Court pronounces judgment', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'BNSS 2023, Section 285', prerequisites: [7] },
    ],
    'civil': [
      { stepNumber: 1, name: 'Plaint Filing', description: 'Filing of plaint/suit', typicalDurationDays: 1, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order VII', prerequisites: [] },
      { stepNumber: 2, name: 'Summons', description: 'Service of summons to defendant', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order V', prerequisites: [1] },
      { stepNumber: 3, name: 'Written Statement', description: 'Filing of written statement by defendant', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order VIII', prerequisites: [2] },
      { stepNumber: 4, name: 'Issues Framing', description: 'Court frames issues for trial', typicalDurationDays: 14, deadlineType: 'court-discretion', legalBasis: 'CPC 1908, Order XIV', prerequisites: [3] },
      { stepNumber: 5, name: 'Evidence', description: 'Recording of evidence by both parties', typicalDurationDays: 120, deadlineType: 'court-discretion', legalBasis: 'BSA 2023', prerequisites: [4] },
      { stepNumber: 6, name: 'Arguments', description: 'Final arguments', typicalDurationDays: 30, deadlineType: 'court-discretion', legalBasis: 'CPC 1908, Order XVIII', prerequisites: [5] },
      { stepNumber: 7, name: 'Judgment', description: 'Court pronounces judgment', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order XX', prerequisites: [6] },
    ],
    // NV-TIMELINE-PROCEDURAL-EXPAND-001 — book-grounded additional procedural
    // pipelines (consumer / writ / execution) so getProceduralChecklist is not
    // a criminal+civil-only stub for the common filing pathways.
    'consumer': [
      { stepNumber: 1, name: 'Pre-litigation Notice', description: 'Statutory notice to opposite party (advisable)', typicalDurationDays: 15, deadlineType: 'directory', legalBasis: 'Consumer Protection Act 2019', prerequisites: [] },
      { stepNumber: 2, name: 'Complaint Filing', description: 'File complaint before District/State/National Commission', typicalDurationDays: 1, deadlineType: 'mandatory', legalBasis: 'Consumer Protection Act 2019, Section 35', prerequisites: [1] },
      { stepNumber: 3, name: 'Admission & Notice', description: 'Admission of complaint and notice to opposite party', typicalDurationDays: 21, deadlineType: 'mandatory', legalBasis: 'Consumer Protection Act 2019, Section 38', prerequisites: [2] },
      { stepNumber: 4, name: 'Written Version', description: 'Opposite party files written version', typicalDurationDays: 45, deadlineType: 'mandatory', legalBasis: 'Consumer Protection Act 2019, Section 38(2)(a)', prerequisites: [3] },
      { stepNumber: 5, name: 'Evidence & Arguments', description: 'Affidavit evidence and hearing', typicalDurationDays: 90, deadlineType: 'court-discretion', legalBasis: 'Consumer Protection Act 2019, Section 38', prerequisites: [4] },
      { stepNumber: 6, name: 'Order', description: 'Commission pronounces order', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'Consumer Protection Act 2019, Section 38(7)', prerequisites: [5] },
    ],
    'writ': [
      { stepNumber: 1, name: 'Petition Filing', description: 'File writ petition under Article 226/227 (HC) or 32 (SC)', typicalDurationDays: 1, deadlineType: 'mandatory', legalBasis: 'Constitution of India, Article 226', prerequisites: [] },
      { stepNumber: 2, name: 'Admission Hearing', description: 'Court admits and issues notice / rule nisi', typicalDurationDays: 21, deadlineType: 'court-discretion', legalBasis: 'Writ practice — admission', prerequisites: [1] },
      { stepNumber: 3, name: 'Counter-Affidavit', description: 'Respondent files counter-affidavit', typicalDurationDays: 45, deadlineType: 'court-discretion', legalBasis: 'Writ practice — pleadings', prerequisites: [2] },
      { stepNumber: 4, name: 'Rejoinder', description: 'Petitioner files rejoinder (if any)', typicalDurationDays: 30, deadlineType: 'court-discretion', legalBasis: 'Writ practice — pleadings', prerequisites: [3] },
      { stepNumber: 5, name: 'Final Hearing', description: 'Arguments on merits', typicalDurationDays: 60, deadlineType: 'court-discretion', legalBasis: 'Writ practice — final hearing', prerequisites: [4] },
      { stepNumber: 6, name: 'Judgment', description: 'Court pronounces judgment', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'Writ practice — judgment', prerequisites: [5] },
    ],
    'execution': [
      { stepNumber: 1, name: 'Execution Petition', description: 'File execution petition (Order XXI Rule 11)', typicalDurationDays: 1, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order XXI Rule 11', prerequisites: [] },
      { stepNumber: 2, name: 'Notice to JD', description: 'Notice to judgment-debtor (Order XXI Rule 22 where applicable)', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order XXI Rule 22', prerequisites: [1] },
      { stepNumber: 3, name: 'Mode of Execution', description: 'Attachment / arrest / sale / delivery as ordered', typicalDurationDays: 90, deadlineType: 'court-discretion', legalBasis: 'CPC 1908, Order XXI', prerequisites: [2] },
      { stepNumber: 4, name: 'Satisfaction', description: 'Recording of full satisfaction of decree', typicalDurationDays: 30, deadlineType: 'mandatory', legalBasis: 'CPC 1908, Order XXI Rule 2', prerequisites: [3] },
    ],
  },
};

/**
 * NV-TIMELINE-LIMITATION-EXPAND-001 — synchronous, date-free limitation RULE
 * resolver used by the draftProfile assembler (which has no cause-accrual date).
 *
 * Returns the applicable statutory period + basis WITHOUT computing an expiry
 * (that needs an accrual date; use {@link NvNyayaTimelineService.calculateLimitation}
 * for the dated computation). `recognized:false` when the cause is not in the
 * schedule — the caller must state the limit as advisory, never invent one.
 */
export interface LimitationRule {
  causeOfAction: string;
  jurisdiction: JurisdictionCode;
  /** Statutory years (0 ⇒ no limitation applies, e.g. matrimonial relief). */
  limitationPeriodYears: number;
  /** Day-based procedural windows (appeal/caveat/revision) when set. */
  limitationPeriodDays?: number;
  kind?: 'substantive' | 'procedural';
  /** Human period string, e.g. "3 years", or "No limitation period applies". */
  limitationPeriod: string;
  legalBasis: string;
  recognized: boolean;
}

/**
 * NV-TIMELINE-PROCEDURAL-LIMITATION-001 — book-grounded *procedural* windows
 * (days, not years) from the practitioner manual ready-reference (appeal 30/90d,
 * cross-objection, revision, caveat life, review). Extend only — never invent fees.
 */
const PROCEDURAL_LIMITATION_DAYS: Record<
  string,
  Record<string, { days: number; basis: string }>
> = {
  IN: {
    'first-appeal-district': {
      days: 30,
      basis: 'Limitation Act 1963, Article 116 — appeal from original decree (district/subordinate court)',
    },
    'first-appeal-high-court': {
      days: 90,
      basis: 'Limitation Act 1963, Article 156 — appeal to High Court from subordinate court decree/order',
    },
    'cross-objection': {
      days: 30,
      basis: 'CPC 1908, Order XLI Rule 22 — cross-objection from service of notice of appeal',
    },
    'civil-revision': {
      days: 90,
      basis: 'Limitation Act 1963, Article 131 — application for revision (CPC s.115)',
    },
    'caveat': {
      days: 90,
      basis: 'CPC 1908, Order XLII Rule 3 — caveat remains in force for ninety days from lodging',
    },
    'review-petition': {
      days: 30,
      basis: 'Limitation Act 1963, Article 124 — review of judgment (CPC Order XLVII Rule 1)',
    },
    'restoration-application': {
      days: 30,
      basis: 'Limitation Act 1963, Article 181 — application to restore dismissed suit (directory — verify facts)',
    },
    // NV-BOOK-SME-WAVE-D-001 — book §5 ready reference (procedural windows).
    'second-appeal': {
      days: 90,
      basis: 'Limitation Act 1963, Article 116 — second appeal to High Court (book §5–§6)',
    },
    'amend-pleading': {
      days: 14,
      basis: 'Book §5 ready reference — to amend pleadings (verify court extension / Order VI Rule 17)',
    },
    'set-aside-interrogatories': {
      days: 7,
      basis: 'Book §5 ready reference — to set aside / strike out interrogatories (verify Order XI)',
    },
    'set-aside-sale': {
      days: 60,
      basis: 'Book §5 ready reference — to set aside a sale in execution (Limitation Act Art. 134 / Order XXI — verify)',
    },
    'implead-lrs': {
      days: 90,
      basis: 'Book §5 ready reference — to implead legal representatives (from date of death; Order XXII)',
    },
    'summary-leave-to-defend': {
      days: 10,
      basis: 'Book §5 ready reference — for leave to appear and defend summary suit (Order XXXVII — verify)',
    },
    'criminal-appeal-death-sentence': {
      days: 30,
      basis: 'Limitation Act 1963, Article 134 — appeal from death sentence (book §5 criminal table)',
    },
    'criminal-appeal-high-court': {
      days: 60,
      basis: 'Limitation Act 1963, Article 114 — appeal to High Court from other sentence (book §5)',
    },
    'criminal-appeal-other-court': {
      days: 30,
      basis: 'Book §5 criminal table — appeal to other court (verify Article 115 / BNSS)',
    },
    'criminal-revision': {
      days: 90,
      basis: 'Limitation Act 1963, Article 131 — criminal revision (book §5)',
    },
    'criminal-appeal-supreme-court': {
      days: 60,
      basis: 'Limitation Act 1963, Article 112 — appeal to Supreme Court (book §5)',
    },
    'criminal-slp-after-hc-refusal': {
      days: 60,
      basis: 'Book §5 — special leave on refusal by High Court (verify Art. 136 practice)',
    },
    'criminal-slp-other': {
      days: 90,
      basis: 'Book §5 — special leave / other criminal appellate window (verify facts)',
    },
  },
};

export function resolveLimitationRule(
  causeOfAction: string,
  jurisdiction: JurisdictionCode = 'IN',
): LimitationRule {
  const procedural = (PROCEDURAL_LIMITATION_DAYS[jurisdiction] || {})[causeOfAction];
  if (procedural) {
    return {
      causeOfAction,
      jurisdiction,
      limitationPeriodYears: 0,
      limitationPeriodDays: procedural.days,
      kind: 'procedural',
      limitationPeriod: `${procedural.days} day${procedural.days > 1 ? 's' : ''}`,
      legalBasis: procedural.basis,
      recognized: true,
    };
  }

  const period = (LIMITATION_PERIODS[jurisdiction] || {})[causeOfAction];
  if (!period) {
    return {
      causeOfAction,
      jurisdiction,
      limitationPeriodYears: -1,
      limitationPeriod: 'Unknown',
      legalBasis: 'Cause of action not found in limitation schedule — consult counsel',
      recognized: false,
    };
  }
  if (period.years === 0) {
    return {
      causeOfAction,
      jurisdiction,
      limitationPeriodYears: 0,
      kind: 'substantive',
      limitationPeriod: 'No limitation period applies',
      legalBasis: period.basis,
      recognized: true,
    };
  }
  return {
    causeOfAction,
    jurisdiction,
    limitationPeriodYears: period.years,
    kind: 'substantive',
    limitationPeriod: `${period.years} year${period.years > 1 ? 's' : ''}`,
    legalBasis: period.basis,
    recognized: true,
  };
}

/** Recognised limitation causes of action for a jurisdiction (introspection/tests). */
export function listLimitationCauses(jurisdiction: JurisdictionCode = 'IN'): string[] {
  return Object.keys(LIMITATION_PERIODS[jurisdiction] || {});
}

class NvNyayaTimelineService {
  async calculateLimitation(causeOfAction: string, jurisdiction: JurisdictionCode, eventDate: Date): Promise<LimitationResult> {
    logger.info({ method: 'calculateLimitation', causeOfAction, jurisdiction });

    const jurisdictionPeriods = LIMITATION_PERIODS[jurisdiction] || {};
    const period = jurisdictionPeriods[causeOfAction];

    if (!period) {
      return {
        causeOfAction,
        jurisdiction,
        limitationPeriod: 'Unknown',
        expiryDate: new Date(),
        daysRemaining: 0,
        legalBasis: 'Cause of action not found in database — consult legal counsel',
        warnings: ['Cause of action not recognized. Manual verification required.'],
        isExpired: false,
      };
    }

    const expiryDate = new Date(eventDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + period.years);
    const now = new Date();
    const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isExpired = daysRemaining < 0;

    const warnings: string[] = [];
    if (isExpired) {
      warnings.push('LIMITATION PERIOD HAS EXPIRED — filing may be time-barred');
    } else if (daysRemaining <= 30) {
      warnings.push(`URGENT: Only ${daysRemaining} days remaining — immediate action required`);
    } else if (daysRemaining <= 90) {
      warnings.push(`${daysRemaining} days remaining — plan filing promptly`);
    }

    if (period.years === 0) {
      return {
        causeOfAction,
        jurisdiction,
        limitationPeriod: 'No limitation period applies',
        expiryDate: new Date('9999-12-31'),
        daysRemaining: 999999,
        legalBasis: period.basis,
        warnings: [],
        isExpired: false,
      };
    }

    return {
      causeOfAction,
      jurisdiction,
      limitationPeriod: `${period.years} year${period.years > 1 ? 's' : ''}`,
      expiryDate,
      daysRemaining: Math.max(daysRemaining, 0),
      legalBasis: period.basis,
      warnings,
      isExpired,
    };
  }

  async getProceduralChecklist(caseType: string, court: string, jurisdiction: JurisdictionCode): Promise<ProceduralChecklist> {
    logger.info({ method: 'getProceduralChecklist', caseType, court, jurisdiction });

    const jurisdictionTemplates = PROCEDURAL_TEMPLATES[jurisdiction] || {};
    const steps = jurisdictionTemplates[caseType] || [{
      stepNumber: 1,
      name: 'Filing',
      description: `File ${caseType} case at ${court}`,
      typicalDurationDays: 1,
      deadlineType: 'mandatory' as const,
      legalBasis: 'Consult procedural law for jurisdiction',
      prerequisites: [],
    }];

    const estimatedDuration = steps.reduce((sum, s) => sum + s.typicalDurationDays, 0);

    return {
      caseType,
      court,
      jurisdiction,
      steps,
      estimatedDurationDays: estimatedDuration,
      lastUpdated: new Date(),
    };
  }

  async getCourtSchedule(courtCode: string, caseNumber: string): Promise<CourtSchedule> {
    logger.info({ method: 'getCourtSchedule', courtCode, caseNumber });
    return {
      courtCode,
      caseNumber,
      nextHearingDate: null,
      hearingHistory: [],
      estimatedDisposalDate: null,
    };
  }

  async calculateDeadlineRisk(matterId: string, upcomingDays: number): Promise<DeadlineRisk[]> {
    logger.info({ method: 'calculateDeadlineRisk', matterId, upcomingDays });
    return [];
  }

  async getMatterTimeline(matterId: string): Promise<TimelineData> {
    logger.info({ method: 'getMatterTimeline', matterId });
    return {
      matterId,
      events: [],
      upcomingDeadlines: [],
      milestones: [],
    };
  }

  async checkMissedDeadlines(): Promise<MissedDeadlineAlert[]> {
    logger.info({ method: 'checkMissedDeadlines' });
    return [];
  }
}

export const nvNyayaTimelineService = new NvNyayaTimelineService();
