/**
 * JRX Express Type Declarations — typed Express Request extensions
 * Eliminates (req as any).user, (req as any).orgId etc. across the entire codebase.
 *
 * GUARDRAIL: Any new property added to req by middleware MUST be declared here.
 * Never use (req as any).newProp — declare it in this file first.
 *
 * @file src/types/express.d.ts
 */

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        userId?: string;
        sub?: string;
        email?: string;
        username?: string;
        role?: string;
        plan?: string;
        orgId?: string;
        organizationId?: number | string | null;
        jurisdiction?: string;
        tier?: string;
        subscriptionTier?: string;
        permissions?: string[];
      };
      jurisdictionProfile?: {
        code: string;
        name: string;
        timezone?: string;
        languages?: string[];
        aiFormatRules?: Record<string, unknown>;
        [key: string]: unknown;
      };
      requestId?: string;
      jurisdiction?: string;
      templateMode?: 'STRICT' | 'GUIDED' | 'MENTOR';
      templateModeConfig?: {
        mode: 'STRICT' | 'GUIDED' | 'MENTOR';
        canRestructure: boolean;
        canSuggestImprovements: boolean;
        requiresApproval: boolean;
        aiPermissions: string[];
      };
      creditReservation?: {
        cost?: number;
        idempotencyKey?: string;
        tool: string;
        reservation_id?: string;
        amount?: number;
        userId?: string;
      };
      creditLowBalanceWarning?: {
        message: string;
        current_balance?: number;
        threshold?: number;
        warning?: boolean;
        remaining_credits?: number;
      };
      pipelineAudit?: {
        trace_id: string;
        start_time: number;
        step: number;
        injection_clear?: boolean;
        pii_types_found?: string[];
        sanitised?: boolean;
        rag_grounded?: boolean;
        confidence?: number;
        [key: string]: unknown;
      };
      riskAssessment?: {
        score: number;
        badge: 'GREEN' | 'YELLOW' | 'RED';
        blocked: boolean;
        warnings: string[];
      };
      ragConfidence?: number;
      sdkApp?: {
        id: string;
        orgId: string;
        appName: string;
        permissions: string[];
        tier: string;
      };
      sdkContext?: {
        requestId?: string;
        appId?: string;
        orgId?: string;
        [key: string]: unknown;
      };
      nvy?: {
        traceId: string;
        startMs: number;
        pattern?: string;
        agentId?: string;
        jurisdiction?: string;
      };
      serviceIdentity?: {
        platformId?: string;
        platformName?: string;
        serviceType?: string;
        [key: string]: unknown;
      };
      filterResult?: {
        allowed: boolean;
        category: string;
        confidence: number;
        reason?: string;
        suggestedResponse?: string;
        [key: string]: unknown;
      };
      logger?: {
        info(message: string, data?: Record<string, unknown>): void;
        error(message: string, data?: Record<string, unknown>): void;
        warn(message: string, data?: Record<string, unknown>): void;
        debug(message: string, data?: Record<string, unknown>): void;
        child(bindings: Record<string, unknown>): this;
      };
    }
  }
}

export {};
