/**
 * TemplatesApi — Canonical JRX legal templates catalog (NSP / ecosystem).
 * Wraps: GET /api/jrx/templates, /catalog, /approved, reviews, /:id, POST /:id/generate|/review
 */

export interface NspTemplateVariable {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  label?: string;
  defaultValue?: string;
  choices?: string[];
}

export type TemplateApprovalStatus =
  | 'unreviewed'
  | 'platform_curated'
  | 'sme_approved'
  | 'sme_rejected'
  | 'changes_requested';

export interface TemplateSmeRubric {
  legalAccuracy: number;
  proceduralCompleteness: number;
  citationGrounding: number;
  draftingQuality: number;
  overall: number;
}

export interface NspLegalTemplate {
  id: string;
  name: string;
  title?: string;
  slug?: string;
  content: string;
  body?: string;
  markdown?: string;
  template?: string;
  description: string;
  document_type: string;
  category?: string;
  jurisdiction_code: string;
  tags: string[];
  variables: NspTemplateVariable[];
  version: string;
  complexity?: 'simple' | 'medium' | 'advanced';
  external_id?: string;
  source?: string;
  approval_status?: TemplateApprovalStatus;
  partner_approved?: boolean;
}

export interface TemplatesCatalogResponse {
  success: boolean;
  data: {
    templates: NspLegalTemplate[];
    total: number;
    categories: string[];
    practiceAreas?: string[];
    quality?: string;
    approvedOnly?: boolean;
    reviewStats?: Record<string, number>;
    provenance?: string;
    generatedAt?: string;
  };
}

export interface TemplatesListParams {
  jurisdiction?: string;
  category?: string;
  document_type?: string;
  complexity?: 'simple' | 'medium' | 'advanced' | string;
  q?: string;
  kind?: string;
  /** Default true on gateway — partner approved set only. */
  approvedOnly?: boolean;
  limit?: number;
  offset?: number;
}

function buildQs(params?: TemplatesListParams): string {
  const qs = new URLSearchParams();
  if (!params) return '';
  if (params.jurisdiction) qs.set('jurisdiction', params.jurisdiction);
  if (params.category) qs.set('category', params.category);
  if (params.document_type) qs.set('document_type', params.document_type);
  if (params.complexity) qs.set('complexity', params.complexity);
  if (params.q) qs.set('q', params.q);
  if (params.kind) qs.set('kind', params.kind);
  if (params.approvedOnly !== undefined) qs.set('approvedOnly', String(params.approvedOnly));
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  return qs.size ? `?${qs}` : '';
}

export class TemplatesApi {
  constructor(private readonly http: {
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string, body: unknown): Promise<T>;
  }) {}

  /** Canonical catalog — GET /api/jrx/templates (approved-only by default). */
  list(params?: TemplatesListParams): Promise<TemplatesCatalogResponse> {
    return this.http.get(`/api/jrx/templates${buildQs(params)}`);
  }

  catalog(params?: TemplatesListParams): Promise<TemplatesCatalogResponse> {
    return this.http.get(`/api/jrx/templates/catalog${buildQs(params)}`);
  }

  /** Explicit approved set. */
  approved(params?: TemplatesListParams): Promise<TemplatesCatalogResponse> {
    return this.http.get(`/api/jrx/templates/approved${buildQs({ ...params, approvedOnly: true })}`);
  }

  listViaGateway(params?: TemplatesListParams): Promise<TemplatesCatalogResponse> {
    return this.http.get(`/api/jrx/gateway/templates${buildQs(params)}`);
  }

  reviewStats(): Promise<{ success: boolean; data: Record<string, number> }> {
    return this.http.get('/api/jrx/templates/reviews/stats');
  }

  reviewQueue(limit?: number): Promise<unknown> {
    const qs = limit != null ? `?limit=${limit}` : '';
    return this.http.get(`/api/jrx/templates/reviews/queue${qs}`);
  }

  listReviews(params?: { status?: TemplateApprovalStatus; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    const suffix = qs.size ? `?${qs}` : '';
    return this.http.get(`/api/jrx/templates/reviews${suffix}`);
  }

  bootstrapReviews(): Promise<unknown> {
    return this.http.post('/api/jrx/templates/reviews/bootstrap', {});
  }

  submitReview(
    id: string,
    body: {
      status: TemplateApprovalStatus;
      notes?: string;
      reviewerId?: string;
      reviewerRole?: string;
      rubric?: Partial<TemplateSmeRubric>;
    },
  ): Promise<unknown> {
    return this.http.post(`/api/jrx/templates/${encodeURIComponent(id)}/review`, body);
  }

  get(id: string): Promise<{ success: boolean; data: NspLegalTemplate }> {
    return this.http.get(`/api/jrx/templates/${encodeURIComponent(id)}`);
  }

  generate(
    id: string,
    variables: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    data: {
      templateId: string;
      name: string;
      content: string;
      variables: Record<string, unknown>;
      jurisdiction_code: string;
      document_type: string;
      approval_status?: TemplateApprovalStatus;
      generatedAt: string;
    };
  }> {
    return this.http.post(`/api/jrx/templates/${encodeURIComponent(id)}/generate`, {
      variables,
    });
  }
}
