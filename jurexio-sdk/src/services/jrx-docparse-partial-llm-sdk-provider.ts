/**
 * NV-DOCPARSE-PARTIAL-LLM-SDK-001 — snippet-only LLM recovery for @jurexio/docparse-sdk runComplete.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { createLogger } from '../utils/logger.js';
import type {
  PartialFieldRecoveryInput,
  PartialFieldRecoveryPatch,
  PartialFieldRecoveryProvider,
} from '../../packages/docparse-sdk/src/recovery/partial-field-recovery.js';
import {
  partialKeyToFieldPath,
  type PartialRecoverySchemaId,
} from '@jurexio/docparse-sdk';

const logger = createLogger('./jrx-docparse-partial-llm-sdk');

const COURT_FIELD_SCHEMA = z
  .object({
    cnr: z.string().optional(),
    court: z.string().optional(),
    case_type: z.string().optional(),
    case_year: z.string().optional(),
    filing_number: z.string().optional(),
    fir_number: z.string().optional(),
    police_station: z.string().optional(),
    statutes_invoked: z.string().optional(),
    petitioner: z.string().optional(),
    respondent: z.string().optional(),
    advocate: z.string().optional(),
    document_type: z.string().optional(),
  })
  .partial();

const COMPANY_FIELD_SCHEMA = z
  .object({
    company_name: z.string().optional(),
    cin: z.string().optional(),
    registration_number: z.string().optional(),
    registered_address: z.string().optional(),
    gstin: z.string().optional(),
    date_of_incorporation: z.string().optional(),
    state: z.string().optional(),
    department: z.string().optional(),
  })
  .partial();

const IDENTITY_FIELD_SCHEMA = z
  .object({
    full_name: z.string().optional(),
    pan: z.string().optional(),
    aadhaar_last4: z.string().optional(),
    address: z.string().optional(),
    dob: z.string().optional(),
    document_number: z.string().optional(),
  })
  .partial();

function schemaForPartialRecovery(schemaId?: string) {
  if (schemaId === 'legal-in-civil-company') return COMPANY_FIELD_SCHEMA;
  if (schemaId === 'legal-in-identity') return IDENTITY_FIELD_SCHEMA;
  return COURT_FIELD_SCHEMA;
}

const NOVA_MICRO_PRIMARY = 'apac.amazon.nova-micro-v1:0';

function pathToKey(fieldPath: string): string {
  return fieldPath.split('.').pop() ?? fieldPath;
}

function buildSnippetPrompt(
  snippets: Record<string, string>,
  fieldPaths: string[],
  schemaId?: string,
): string {
  const blocks = fieldPaths.map((p) => {
    const snip = snippets[p] ?? snippets[pathToKey(p)] ?? '';
    return `### ${pathToKey(p)}\n${snip.slice(0, 900)}`;
  });
  const task =
    schemaId === 'legal-in-identity'
      ? 'Extract Indian identity/KYC fields from these SNIPPETS ONLY. For Aadhaar return aadhaar_last4 only (never full number).'
      : schemaId === 'legal-in-civil-company'
        ? 'Extract company/registration fields from these SNIPPETS ONLY.'
        : 'Extract Indian court metadata from these SNIPPETS ONLY.';
  return [
    task,
    'Return minified JSON with keys you can verify verbatim in the snippets.',
    'Omit unknown fields. Never guess.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

export function createJrxPartialFieldRecoveryProvider(): PartialFieldRecoveryProvider | undefined {
  if (!isJrxFeatureOn('docparseLlmFallback')) return undefined;
  return {
    id: 'jrx-nova-micro-partial',
    async recover(input: PartialFieldRecoveryInput): Promise<PartialFieldRecoveryPatch> {
      try {
        const keys = input.fieldPaths.map(pathToKey);
        const prompt = buildSnippetPrompt(input.snippets, input.fieldPaths, input.schemaId);
        const { realLLMService } = await import('./real-llm-service.js');
        const resp = await realLLMService.executeRequest({
          id: randomUUID(),
          userId: 'system',
          prompt,
          systemPrompt: 'Output valid JSON only. Snippet-bound extraction.',
          model: NOVA_MICRO_PRIMARY,
          maxTokens: 768,
          temperature: 0,
          tier: 'plus',
          taskKind: 'extraction',
          jurisdiction: input.jurisdiction,
          expectJson: true,
          maxCostUsd: Number(process.env.JRX_DOCPARSE_LLM_FALLBACK_MAX_COST_USD || 0.015),
          requirements: {
            complexity: 'simple',
            domain: 'analytical',
            priority: 'low',
            costBudget: 'minimal',
            responseTime: 'fastest',
            qualityLevel: 'standard',
          },
          fallbackLevels: 1,
          timestamp: new Date(),
        } as Parameters<typeof realLLMService.executeRequest>[0]);
        const raw = String(resp?.content || '');
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return { applied: false, values: {}, notes: ['no json'] };
        }
        const fieldSchema = schemaForPartialRecovery(input.schemaId);
        const parsed = fieldSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (!parsed.success) {
          return { applied: false, values: {}, notes: ['schema fail'] };
        }
        const values: PartialFieldRecoveryPatch['values'] = {};
        const schemaId = (input.schemaId ?? 'legal-in-court') as PartialRecoverySchemaId;
        for (const [jsonKey, rawVal] of Object.entries(parsed.data)) {
          if (!rawVal || !String(rawVal).trim()) continue;
          const mappedPath = partialKeyToFieldPath(jsonKey, schemaId);
          const target =
            input.fieldPaths.find((p) => p === mappedPath) ??
            input.fieldPaths.find((p) => pathToKey(p) === jsonKey);
          if (!target) continue;
          values[target] = { value: String(rawVal).trim().slice(0, 400), confidence: 0.6 };
        }
        if (Object.keys(values).length === 0) {
          return { applied: false, values: {}, notes: ['empty extract'] };
        }
        return {
          applied: true,
          model: NOVA_MICRO_PRIMARY,
          values,
          notes: [`recovered ${Object.keys(values).length} fields from snippets`, `keys=${keys.join(',')}`],
        };
      } catch (e) {
        logger.warn('partial llm recovery failed', { err: e instanceof Error ? e.message : String(e) });
        return { applied: false, values: {}, notes: ['error'] };
      }
    },
  };
}
