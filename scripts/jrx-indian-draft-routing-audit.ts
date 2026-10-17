/**
 * NV-INDIAN-DRAFT-ROUTING-AUDIT-001 — NSP wire vs NYV token/Queen resolution (no network).
 */
import type { Request } from 'express';
import {
  resolveDraftOutputTokens,
  type DraftDocumentType,
} from '../src/config/jrx-draft-length-registry.js';
import {
  applyPartnerComprehensiveAgenticUpgradeTaskType,
  isPartnerExplicitFastDraftAlias,
  isPartnerSlaFastTask,
  resolvePartnerMaxOutputTokens,
  wantsNspCounselQueen,
  wantsPartnerQualityQueenPath,
} from '../src/utils/jrx-partner-platform.js';

export type SmeCaseRef = {
  id: string;
  documentType: DraftDocumentType;
  prompt: string;
  parameters: Record<string, unknown>;
};

function nspRequest(body: Record<string, unknown>): Request {
  return {
    body,
    headers: { 'x-nyv-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

export interface RoutingAuditRow {
  caseId: string;
  documentType: string;
  fastMedium: {
    taskType: string;
    draftLength: string;
    registryTokens: number;
    partnerMaxTokens: number;
    slaFast: boolean;
    explicitFastAlias: boolean;
  };
  counselComprehensive: {
    taskType: string;
    draftLength: string;
    registryTokens: number;
    partnerMaxTokens: number;
    queenPath: boolean;
  };
  pass: boolean;
  notes: string[];
}

export function auditNspDraftRouting(caseRow: SmeCaseRef): RoutingAuditRow {
  const notes: string[] = [];
  const base = {
    prompt: caseRow.prompt,
    jurisdiction: 'IN',
    parameters: { ...caseRow.parameters, documentType: caseRow.documentType },
  };

  const fastBody = {
    ...base,
    taskType: 'legal-draft-fast',
    options: { draftLength: 'medium' },
    partnerSyncLean: true,
  };
  const fastReq = nspRequest(fastBody);
  const fastRes = resolveDraftOutputTokens({
    documentType: caseRow.documentType,
    draftLength: 'medium',
    taskType: 'legal-draft-fast',
    prompt: caseRow.prompt,
    parameters: fastBody.parameters,
    options: fastBody.options,
  });
  const fastMax = resolvePartnerMaxOutputTokens(fastReq);

  const counselBody = {
    ...base,
    taskType: 'legal-draft',
    options: { draftLength: 'comprehensive' },
  };
  const counselReq = nspRequest(counselBody);
  const counselTaskType = applyPartnerComprehensiveAgenticUpgradeTaskType(counselReq) || 'legal-draft';
  const counselRes = resolveDraftOutputTokens({
    documentType: caseRow.documentType,
    draftLength: 'comprehensive',
    taskType: counselTaskType,
    prompt: caseRow.prompt,
    parameters: counselBody.parameters,
    options: counselBody.options,
  });
  const counselMax = resolvePartnerMaxOutputTokens(counselReq);
  const queenPath = wantsPartnerQualityQueenPath(counselReq, counselTaskType)
    || wantsNspCounselQueen(counselReq);

  if (!isPartnerExplicitFastDraftAlias('legal-draft-fast')) {
    notes.push('fast alias not recognised');
  }
  if (fastRes.tier !== 'medium') notes.push(`fast tier=${fastRes.tier} expected medium`);
  if (counselRes.tier !== 'comprehensive') notes.push(`counsel tier=${counselRes.tier} expected comprehensive`);
  if (counselMax < fastMax) notes.push('counsel max tokens below fast (unexpected)');
  if (counselRes.tokens <= fastRes.tokens) notes.push('comprehensive registry tokens not above medium');

  return {
    caseId: caseRow.id,
    documentType: caseRow.documentType,
    fastMedium: {
      taskType: 'legal-draft-fast',
      draftLength: 'medium',
      registryTokens: fastRes.tokens,
      partnerMaxTokens: fastMax,
      slaFast: isPartnerSlaFastTask(fastReq, { taskType: 'legal-draft-fast' }),
      explicitFastAlias: isPartnerExplicitFastDraftAlias('legal-draft-fast'),
    },
    counselComprehensive: {
      taskType: counselTaskType,
      draftLength: 'comprehensive',
      registryTokens: counselRes.tokens,
      partnerMaxTokens: counselMax,
      queenPath,
    },
    pass: notes.length === 0,
    notes,
  };
}
