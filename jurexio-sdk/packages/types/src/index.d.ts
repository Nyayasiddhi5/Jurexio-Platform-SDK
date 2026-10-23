/**
 * @jurexio/types v3.1.2
 * Jurexio Enterprise Platform 312 — Shared TypeScript Types
 *
 * Exports all types used by:
 *  - @jurexio/client-sdk
 *  - JRX Gateway API
 *  - All 5 Jurexio platforms
 *  - ROMA L5 agents
 */
export type JrxJurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';
export type JrxSubscriptionTier = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'government' | 'internal';
export type JrxTemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';
export type JrxPlatform = 'jurexio-citizen' | 'nys-professional' | 'nys-institutional' | 'nys-academy' | 'nys-ministry';
export type JrxPatternKey = 'P01_REACT' | 'P02_COT' | 'P03_TOT' | 'P04_REFLECT' | 'P05_PLAN_EXEC' | 'P06_REFINE' | 'P07_MAKER_CHECKER' | 'P08_TOOL_RETRY' | 'P09_FUNCTION_ROUTER' | 'P10_MCP_CHAIN' | 'P11_NYAYARAG' | 'P12_GRAPHRAG' | 'P13_MEM0' | 'P14_SEMANTIC_CACHE' | 'P15_HTA' | 'P16_SWARM' | 'P17_ACONIC' | 'P18_MOAT' | 'P19_ADAPT' | 'P20_COMPUTER_USE' | 'P21_GRPO' | 'P22_DIGITAL_TWIN';
export interface JrxPatternRequest {
    task: string;
    jurisdiction?: JrxJurisdiction;
    agentId?: string;
    template_mode?: JrxTemplateMode;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ragConfidence?: number;
}
export interface JrxPatternResponse {
    success: boolean;
    data?: {
        result: string;
        pattern: JrxPatternKey;
        agentId?: string;
        jurisdiction?: JrxJurisdiction;
        executionTime?: number;
    };
    ai_metadata?: JrxAIMetadataBlock;
    grpoTelemetry?: JrxGRPOTelemetry;
    credit_warning?: JrxCreditWarning;
    error?: string;
}
export interface JrxRiskComponents {
    jurisdiction_mismatch: number;
    clause_absence: number;
    structural_deviation: number;
    hallucination_probability: number;
    unsupported_references: number;
}
export interface JrxRiskScore {
    score: number;
    blocked: boolean;
    block_reason: string | null;
    confidence: number;
    components: JrxRiskComponents;
    prompt_hash: string;
}
export interface JrxAIMetadataBlock {
    trace_id: string;
    generated_at: string;
    jurisdiction: {
        code: JrxJurisdiction;
        name: string;
        currency: string;
        legal_system: string;
        disclosure_appended: boolean;
    };
    template_mode: JrxTemplateMode;
    strict_mode_violations: string[];
    risk: JrxRiskScore;
    model: {
        provider: string;
        model: string;
        tokens_used: number;
        latency_ms: number;
    };
    governance: {
        jurisdiction_validated: boolean;
        jurisdiction_code: JrxJurisdiction;
        jurisdiction_name: string;
        currency: string;
        legal_system: string;
        disclosure_appended: boolean;
    };
    disclosure: string;
    nyv_version: string;
}
export interface JrxGRPOTelemetry {
    patternKey: string;
    agentId: string;
    jurisdiction: JrxJurisdiction;
    episodeCount: number;
    avgReward: number;
    policyUpdates: number;
    note?: string;
}
export interface JrxCreditWallet {
    wallet_id: string;
    user_id: string;
    credits_balance: number;
    reserved_credits: number;
    available_credits: number;
    credits_expiry: string | null;
    last_updated: string;
}
export type JrxCreditTransactionType = 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE';
export type JrxCreditTransactionSource = 'AI_TOOL' | 'PURCHASE' | 'REFUND' | 'MANUAL' | 'SYSTEM';
export interface JrxCreditTransaction {
    transaction_id: string;
    user_id: string;
    type: JrxCreditTransactionType;
    credits: number;
    source: JrxCreditTransactionSource;
    tool_name: string;
    reference_id: string | null;
    immutable_hash: string;
    created_at: string;
}
export interface JrxCreditWarning {
    warning: boolean;
    remaining_credits: number;
    message: string;
}
export type JrxSubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'trialing';
export type JrxBillingCycle = 'monthly' | 'quarterly' | 'annual';
export interface JrxSubscription {
    subscription_id: string;
    user_id: string;
    plan_id: JrxSubscriptionTier;
    status: JrxSubscriptionStatus;
    billing_cycle: JrxBillingCycle;
    amount_inr: number;
    currency: 'INR';
    razorpay_sub_id?: string;
    current_period_start: string;
    current_period_end: string;
    trial_end?: string;
    cancelled_at?: string;
    cancel_reason?: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}
export type JrxCaseUpdateType = 'HEARING' | 'FILING' | 'DOCUMENT' | 'COMMUNICATION' | 'TASK' | 'NOTE';
export interface JrxCaseUpdate {
    update_id: string;
    case_id: string;
    user_id: string;
    update_type: JrxCaseUpdateType;
    title: string;
    description: string;
    metadata: Record<string, unknown>;
    locked: boolean;
    locked_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface JrxGSTBreakdown {
    base_amount: number;
    cgst_rate: number;
    cgst_amount: number;
    sgst_rate: number;
    sgst_amount: number;
    igst_rate: number;
    igst_amount: number;
    total_tax: number;
    total_amount: number;
    is_interstate: boolean;
}
export interface JrxInvoice {
    invoice_id: string;
    invoice_type: 'TAX_INVOICE' | 'PROFORMA' | 'CREDIT_NOTE';
    gst: JrxGSTBreakdown;
    tds_applicable: boolean;
    tds_amount: number;
    net_payable: number;
    issued_at: string;
    due_date: string;
    currency: 'INR';
}
export type JrxOrgType = 'law_firm' | 'corporate_legal' | 'judiciary' | 'government' | 'law_school' | 'legal_tech' | 'ngo' | 'other';
export interface JrxInstitutionalLead {
    lead_id: string;
    org_name: string;
    org_type: JrxOrgType;
    contact_name: string;
    contact_email: string;
    contact_phone?: string;
    jurisdiction: JrxJurisdiction;
    team_size?: string;
    use_case: string;
    monthly_volume?: string;
    integrations_needed?: string[];
    compliance_needs?: string[];
    step_completed: number;
    form_data: Record<string, unknown>;
    status: 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'won' | 'lost';
    source: string;
    created_at: string;
    updated_at: string;
}
export interface JrxAgent {
    agentId: string;
    name: string;
    domain: string;
    jurisdiction: JrxJurisdiction[];
    tier: string;
    romaLevel: number;
    capabilities: string[];
    languages: string[];
    status: 'active' | 'maintenance' | 'deprecated';
}
export interface JrxClientConfig {
    apiKey: string;
    baseUrl?: string;
    jurisdiction?: JrxJurisdiction;
    timeout?: number;
    retries?: number;
    defaultTemplateMode?: JrxTemplateMode;
    enableStreaming?: boolean;
}
export interface JrxApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
    ai_metadata?: JrxAIMetadataBlock;
    grpoTelemetry?: JrxGRPOTelemetry;
}
//# sourceMappingURL=index.d.ts.map