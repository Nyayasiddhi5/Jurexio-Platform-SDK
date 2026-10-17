import { Request, Response, NextFunction } from 'express';

const ORCHESTRATION_ROUTE_PATTERNS: RegExp[] = [
  /^\/api\/v3\/documents\//,
  /^\/api\/v3\/cases\//,
  /^\/api\/v3\/drafting\//,
  /^\/api\/v1\/sdk\//,
];

const TASK_TYPE_AGENT_MAP: Record<string, string> = {
  'document-parsing': 'doc-intelligence-agent',
  'ocr': 'doc-intelligence-agent',
  'identity-extraction': 'identity-extraction-agent',
  'case-analysis': 'case-analysis-agent',
  'legal-drafting': 'legal-drafting-agent',
  'summarization': 'summarization-agent',
  'entity-extraction': 'entity-extraction-agent',
};

const DOC_TYPE_AGENT_MAP: Record<string, string> = {
  'pdf': 'doc-intelligence-agent',
  'image': 'doc-intelligence-agent',
  'scan': 'doc-intelligence-agent',
  'ocr': 'doc-intelligence-agent',
  'identity': 'identity-extraction-agent',
  'aadhaar': 'identity-extraction-agent',
  'passport': 'identity-extraction-agent',
  'pan': 'identity-extraction-agent',
  'license': 'identity-extraction-agent',
  'contract': 'doc-intelligence-agent',
  'legal-notice': 'doc-intelligence-agent',
  'judgment': 'doc-intelligence-agent',
  'petition': 'doc-intelligence-agent',
};

function isOrchestrationRoute(path: string): boolean {
  return ORCHESTRATION_ROUTE_PATTERNS.some(pattern => pattern.test(path));
}

export function validateOrchestrationCompliance(req: Request, res: Response, next: NextFunction): void {
  if (isOrchestrationRoute(req.path)) {
    res.setHeader('X-Orchestration-Enforced', 'true');
  }
  next();
}

export class OrchestrationGuardrails {
  static ensureAgentRouting(taskType: string): string {
    const normalizedType = taskType.toLowerCase().trim();
    const agentId = TASK_TYPE_AGENT_MAP[normalizedType];
    if (agentId) {
      return agentId;
    }
    for (const [key, value] of Object.entries(TASK_TYPE_AGENT_MAP)) {
      if (normalizedType.includes(key)) {
        return value;
      }
    }
    return 'doc-intelligence-agent';
  }

  static validateLLMRequest(request: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request || typeof request !== 'object') {
      return { valid: false, errors: ['Request must be a non-null object'] };
    }

    if (!request.agentId) {
      errors.push('Missing required field: agentId. All LLM requests must be routed through the agent registry.');
    }

    if (!request.jurisdiction) {
      errors.push('Missing required field: jurisdiction. Jurisdiction context is required for legal AI processing.');
    }

    if (!request.taskType) {
      errors.push('Missing required field: taskType. Task type is required for proper agent routing.');
    }

    return { valid: errors.length === 0, errors };
  }

  static getDocumentProcessingAgent(docType: string): string {
    const normalizedType = docType.toLowerCase().trim();
    const agentId = DOC_TYPE_AGENT_MAP[normalizedType];
    if (agentId) {
      return agentId;
    }
    return 'doc-intelligence-agent';
  }

  static getCaseAnalysisAgent(jurisdiction: string): string {
    const normalizedJurisdiction = jurisdiction.toUpperCase().trim();
    return `case-analysis-agent-${normalizedJurisdiction}`;
  }

  static getDraftingAgent(jurisdiction: string, docType: string): string {
    const normalizedJurisdiction = jurisdiction.toUpperCase().trim();
    return `legal-drafting-agent-${normalizedJurisdiction}`;
  }
}
