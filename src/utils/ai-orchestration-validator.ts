import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';


const logger = createLogger('ai-orchestration-validator');

interface PlatformWiringResult {
  platform: string;
  routeFiles: string[];
  usesCallNayavigya: boolean;
  usesExecuteWithOrchestration: boolean;
  usesRealLLMServiceDirect: boolean;
  delegatesToService: boolean;
  aiCallCount: number;
  status: 'COMPLIANT' | 'PARTIAL' | 'NO_AI_CALLS' | 'BYPASS_DETECTED';
  notes: string[];
}

interface ValidationReport {
  timestamp: string;
  centralPipelineFile: string;
  centralFunctionSignature: string;
  platforms: PlatformWiringResult[];
  summary: {
    totalPlatforms: number;
    compliant: number;
    partial: number;
    noAICalls: number;
    bypassDetected: number;
  };
}

const PLATFORMS: Array<{
  name: string;
  routeGlobs: string[];
  serviceFiles: string[];
}> = [
  {
    name: 'NS Professional (Jurexio Professional)',
    routeGlobs: [
      'src/routes/ns-v1-routes.ts',
      'src/routes/ns-v1-ai-governance-routes.ts',
      'src/routes/ns-v1-approval-workflow-routes.ts',
      'src/routes/ns-v1-clause-library-routes.ts',
      'src/routes/ns-v1-conversational-drafting-routes.ts',
      'src/routes/ns-v1-document-intelligence-routes.ts',
      'src/routes/ns-v1-document-versioning-routes.ts',
      'src/routes/ns-v1-expiry-tracking-routes.ts',
      'src/routes/ns-v1-pii-security-routes.ts',
      'src/routes/ns-v1-webhook-routes.ts',
      'src/routes/nyayasiddhi-routes.ts',
      'src/routes/nyayasiddhi-lite-routes.ts',
    ],
    serviceFiles: ['src/services/nyayasiddhi-lite-service.ts'],
  },
  {
    name: 'Nyayamitra (Citizen Legal Aid)',
    routeGlobs: [
      'src/routes/nyayamitra-routes.ts',
      'src/routes/nm-chat-routes.ts',
      'src/routes/nm-casebrief-routes.ts',
      'src/routes/nm-quiz-routes.ts',
      'src/routes/nm-whatsapp-routes.ts',
      'src/routes/nm-helpline-routes.ts',
      'src/routes/nm-literacy-routes.ts',
      'src/routes/nm-script-routes.ts',
    ],
    serviceFiles: ['src/services/nyayamitra-service.ts'],
  },
  {
    name: 'Jurexio Institutional (Enterprise)',
    routeGlobs: [
      'src/routes/nyayasiddhi-enterprise-routes.ts',
      'src/routes/enterprise-admin-routes.ts',
      'src/routes/enterprise-services.ts',
    ],
    serviceFiles: ['src/services/nyayasiddhi-enterprise-service.ts'],
  },
  {
    name: 'Jurexio Ministry (Government)',
    routeGlobs: ['src/routes/nyayasiddhi-ministry-routes.ts'],
    serviceFiles: [],
  },
  {
    name: 'Jurexio Academy',
    routeGlobs: ['src/routes/nyayasiddhi-academy-routes.ts'],
    serviceFiles: [],
  },
  {
    name: 'Automation SDK',
    routeGlobs: [
      'src/routes/sdk-gateway-routes.ts',
      'src/routes/sdk-console-routes.ts',
      'src/routes/sdk-doc-pipeline-routes.ts',
      'src/routes/sdk-enterprise-routes.ts',
      'src/routes/sdk-multimodal-voice-routes.ts',
      'src/routes/sdk-protocol-analytics-routes.ts',
      'src/routes/sdk-workflow-protocol-routes.ts',
    ],
    serviceFiles: ['packages/nyayasiddhi-automation-sdk/src/utils/llm-helper.ts'],
  },
  {
    name: 'Jurexio Core (AI Engine)',
    routeGlobs: [
      'src/routes/nyayavigya-routes.ts',
      'src/routes/nyayavigya-v311-routes.ts',
      'src/routes/jrx-gateway-routes.ts',
    ],
    serviceFiles: [
      'src/services/jrx-client.ts',
      'src/services/real-llm-service.ts',
    ],
  },
];

function scanFileForPatterns(filePath: string): {
  hasCallNayavigya: boolean;
  hasExecuteWithOrchestration: boolean;
  hasRealLLMServiceDirect: boolean;
  hasDelegateToService: boolean;
  callJurexioCount: number;
  executeWithOrchestrationCount: number;
  realLLMDirectCount: number;
} {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    return {
      hasCallNayavigya: false,
      hasExecuteWithOrchestration: false,
      hasRealLLMServiceDirect: false,
      hasDelegateToService: false,
      callJurexioCount: 0,
      executeWithOrchestrationCount: 0,
      realLLMDirectCount: 0,
    };
  }

  const content = fs.readFileSync(absPath, 'utf-8');

  const callJurexioMatches = content.match(/callJurexio\s*\(/g) || [];
  const importCallNayavigya = /import\s+.*callJurexio.*from/.test(content);
  const executeWithOrchMatches = content.match(/executeWithOrchestration\s*\(/g) || [];
  const realLLMDirectMatches = content.match(/realLlmService\.executeRequest|realLLMService\.executeRequest/g) || [];
  const delegateMatches = /import\s+\{[^}]*\}\s+from\s+['"]\.\.\/services\//.test(content);

  return {
    hasCallNayavigya: importCallNayavigya || callJurexioMatches.length > 0,
    hasExecuteWithOrchestration: executeWithOrchMatches.length > 0,
    hasRealLLMServiceDirect: realLLMDirectMatches.length > 0,
    hasDelegateToService: delegateMatches,
    callJurexioCount: callJurexioMatches.length,
    executeWithOrchestrationCount: executeWithOrchMatches.length,
    realLLMDirectCount: realLLMDirectMatches.length,
  };
}

function validatePlatform(platform: typeof PLATFORMS[number]): PlatformWiringResult {
  const existingRouteFiles: string[] = [];
  let totalCallNayavigya = 0;
  let totalExecuteWithOrch = 0;
  let totalRealLLMDirect = 0;
  let anyCallNayavigya = false;
  let anyExecuteWithOrch = false;
  let anyRealLLMDirect = false;
  let anyDelegateToService = false;
  const notes: string[] = [];

  for (const routeFile of platform.routeGlobs) {
    const absPath = path.resolve(process.cwd(), routeFile);
    if (!fs.existsSync(absPath)) continue;

    existingRouteFiles.push(routeFile);
    const scan = scanFileForPatterns(routeFile);

    if (scan.hasCallNayavigya) anyCallNayavigya = true;
    if (scan.hasExecuteWithOrchestration) anyExecuteWithOrch = true;
    if (scan.hasRealLLMServiceDirect) anyRealLLMDirect = true;
    if (scan.hasDelegateToService) anyDelegateToService = true;

    totalCallNayavigya += scan.callJurexioCount;
    totalExecuteWithOrch += scan.executeWithOrchestrationCount;
    totalRealLLMDirect += scan.realLLMDirectCount;

    if (scan.hasCallNayavigya) {
      notes.push(`${routeFile}: ${scan.callJurexioCount} callJurexio() calls ✅`);
    }
    if (scan.hasExecuteWithOrchestration) {
      notes.push(`${routeFile}: ${scan.executeWithOrchestrationCount} executeWithOrchestration() calls ✅`);
    }
    if (scan.hasRealLLMServiceDirect) {
      notes.push(`${routeFile}: ${scan.realLLMDirectCount} direct realLLMService.executeRequest() calls ⚠️`);
    }
  }

  for (const serviceFile of platform.serviceFiles) {
    const scan = scanFileForPatterns(serviceFile);
    if (scan.hasCallNayavigya) {
      notes.push(`${serviceFile}: Service uses callJurexio() ✅`);
      anyCallNayavigya = true;
      totalCallNayavigya += scan.callJurexioCount;
    }
    if (scan.hasRealLLMServiceDirect) {
      notes.push(`${serviceFile}: Service uses realLLMService.executeRequest() directly ⚠️`);
      anyRealLLMDirect = true;
      totalRealLLMDirect += scan.realLLMDirectCount;
    }
  }

  const totalAICalls = totalCallNayavigya + totalExecuteWithOrch + totalRealLLMDirect;

  let status: PlatformWiringResult['status'];
  if (totalAICalls === 0) {
    if (anyDelegateToService) {
      notes.push('Routes delegate to service layer (no direct AI calls in routes)');
    } else {
      notes.push('No AI calls detected in route or service files');
    }
    status = 'NO_AI_CALLS';
  } else if (anyRealLLMDirect && !anyCallNayavigya && !anyExecuteWithOrch) {
    status = 'BYPASS_DETECTED';
  } else if (anyCallNayavigya || anyExecuteWithOrch) {
    if (anyRealLLMDirect) {
      status = 'PARTIAL';
      notes.push('Mix of centralized pipeline and direct LLM calls detected');
    } else {
      status = 'COMPLIANT';
    }
  } else {
    status = 'NO_AI_CALLS';
  }

  return {
    platform: platform.name,
    routeFiles: existingRouteFiles,
    usesCallNayavigya: anyCallNayavigya,
    usesExecuteWithOrchestration: anyExecuteWithOrch,
    usesRealLLMServiceDirect: anyRealLLMDirect,
    delegatesToService: anyDelegateToService,
    aiCallCount: totalAICalls,
    status,
    notes,
  };
}

export function validateAIOrchestrationWiring(): ValidationReport {
  const results = PLATFORMS.map(validatePlatform);

  const summary = {
    totalPlatforms: results.length,
    compliant: results.filter(r => r.status === 'COMPLIANT').length,
    partial: results.filter(r => r.status === 'PARTIAL').length,
    noAICalls: results.filter(r => r.status === 'NO_AI_CALLS').length,
    bypassDetected: results.filter(r => r.status === 'BYPASS_DETECTED').length,
  };

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    centralPipelineFile: 'src/services/jrx-client.ts',
    centralFunctionSignature:
      'callJurexio(agentKey: string, systemPrompt: string, userPrompt: string, options?: NvOrchestrationOptions): Promise<NvResponse>',
    platforms: results,
    summary,
  };

  logger.info('\n╔══════════════════════════════════════════════════════════════╗');
  logger.info('║       NYAYAVIGYA AI ORCHESTRATION WIRING AUDIT             ║');
  logger.info('╚══════════════════════════════════════════════════════════════╝');
  logger.info(`  Timestamp: ${report.timestamp}`);
  logger.info(`  Central Pipeline: ${report.centralPipelineFile}`);
  logger.info('');

  for (const platform of results) {
    const icon = platform.status === 'COMPLIANT' ? '✅' :
                 platform.status === 'PARTIAL' ? '⚠️' :
                 platform.status === 'NO_AI_CALLS' ? '➖' : '❌';
    logger.info(`  ${icon} ${platform.platform}`);
    logger.info(`     Status: ${platform.status} | AI Calls: ${platform.aiCallCount} | Route Files: ${platform.routeFiles.length}`);
    if (platform.usesCallNayavigya) logger.info('     → Uses callJurexio() pipeline');
    if (platform.usesExecuteWithOrchestration) logger.info('     → Uses executeWithOrchestration() pipeline');
    if (platform.usesRealLLMServiceDirect) logger.info('     → Direct realLLMService.executeRequest() detected');
    if (platform.delegatesToService && platform.aiCallCount === 0) logger.info('     → Delegates to service layer');
    for (const note of platform.notes) {
      logger.info(`     • ${note}`);
    }
    logger.info('');
  }

  logger.info('  ─── Summary ─────────────────────────────────────────────');
  logger.info(`  Total Platforms:    ${summary.totalPlatforms}`);
  logger.info(`  Compliant:         ${summary.compliant}`);
  logger.info(`  Partial:           ${summary.partial}`);
  logger.info(`  No AI Calls:       ${summary.noAICalls}`);
  logger.info(`  Bypass Detected:   ${summary.bypassDetected}`);
  logger.info('');

  return report;
}
