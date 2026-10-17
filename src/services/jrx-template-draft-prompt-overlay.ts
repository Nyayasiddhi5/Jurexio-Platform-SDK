/**
 * NV-TEMPLATE-DRAFT-OVERLAY-001 — inject catalog template skeleton into draft prompts
 * when partners pass parameters.templateId (Option B / Phase 3).
 */
import { fillTemplate, getTemplateById } from './jrx-templates-catalog-service.js';

const MAX_OVERLAY_CHARS = 6_000;

function pickTemplateId(parameters?: Record<string, unknown>): string {
  if (!parameters || typeof parameters !== 'object') return '';
  const raw = parameters.templateId
    ?? parameters.nvTemplateId
    ?? parameters.templateCatalogId
    ?? parameters.catalogTemplateId;
  return raw == null ? '' : String(raw).trim();
}

function pickTemplateVariables(parameters?: Record<string, unknown>): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object') return {};
  const block = parameters.templateVariables
    ?? parameters.templateFields
    ?? parameters.templateVars;
  if (block && typeof block === 'object' && !Array.isArray(block)) {
    return block as Record<string, unknown>;
  }
  return {};
}

/** SME-approved catalog body as structural anchor (not a substitute for completion). */
export function formatTemplateDraftOverlay(parameters?: Record<string, unknown>): string {
  const id = pickTemplateId(parameters);
  if (!id) return '';

  const filled = fillTemplate(id, pickTemplateVariables(parameters), { indiaOnly: true });
  const meta = filled?.template ?? getTemplateById(id, { indiaOnly: true });
  if (!meta && !filled) return '';

  const body = (filled?.content ?? meta?.content ?? '').trim();
  if (!body) return '';

  const clipped = body.length > MAX_OVERLAY_CHARS
    ? `${body.slice(0, MAX_OVERLAY_CHARS)}\n\n[… template truncated for prompt budget …]`
    : body;

  const name = meta?.name ?? id;
  const docType = meta?.documentTypeKey ?? meta?.document_type ?? '';
  return [
    'CATALOG TEMPLATE ANCHOR (follow section order and headings; expand with case facts — do not leave placeholders unfilled where facts exist):',
    `Template id: ${id}${docType ? ` · document_type: ${docType}` : ''} · title: ${name}`,
    clipped,
  ].join('\n\n');
}
