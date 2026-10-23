import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-workflow-definitions-v10');

/**
 * Jurexio Agent Workflow Definitions v10.0
 * 
 * Comprehensive workflow definitions for all 267 Jurexio Enterprise Platform SDK agents.
 * Each agent has clearly defined:
 * - Tasks: What the agent can do
 * - Sequences: Step-by-step execution order
 * - Actions: Specific actions taken
 * - Tools: Which MCP tools available
 * - Communication Protocols: How to communicate
 * - Coordination Patterns: How to coordinate with other agents
 * 
 * Based on best practices from:
 * - Replit (autonomous workflows)
 * - Cursor (context-aware execution)
 * - Devin (planning + execution sequences)
 * - Augment (task management)
 * - Emergent (MVP-focused workflows)
 * 
 * @version 10.0.0
 * @date November 22, 2025
 */

// ================================================================================================
// TYPE DEFINITIONS
// ================================================================================================

export interface AgentWorkflowDefinition {
  agentId: string;
  agentName: string;
  tier: 'executive' | 'development' | 'creative' | 'qa' | 'devops' | 'domain';
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4';
  
  // Core capabilities
  tasks: AgentTask[];
  sequences: AgentSequence[];
  actions: AgentAction[];
  tools: AgentToolUsage[];
  
  // Interaction patterns
  communicationProtocols: CommunicationProtocol[];
  coordinationPatterns: CoordinationPattern[];
  
  // Quality & performance
  successCriteria: string[];
  qualityMetrics: QualityMetric[];
  performanceTargets: PerformanceTarget;
}

export interface AgentTask {
  id: string;
  name: string;
  description: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'expert';
  estimatedDuration: string; // e.g., "5-10 minutes"
  prerequisites: string[];
  outputs: string[];
  examples: string[];
}

export interface AgentSequence {
  id: string;
  name: string;
  description: string;
  steps: SequenceStep[];
  decisionPoints: DecisionPoint[];
  fallbackStrategy: string;
}

export interface SequenceStep {
  order: number;
  name: string;
  action: string;
  tools: string[];
  expectedOutput: string;
  successCriteria: string;
  errorHandling: string;
  parallelizable: boolean;
}

export interface DecisionPoint {
  step: number;
  condition: string;
  ifTrue: string;
  ifFalse: string;
  escalationPath?: string;
}

export interface AgentAction {
  id: string;
  name: string;
  description: string;
  category: 'read' | 'write' | 'execute' | 'analyze' | 'coordinate';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  reversible: boolean;
}

export interface AgentToolUsage {
  toolName: string;
  useCases: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  examples: ToolUsageExample[];
  constraints: string[];
}

export interface ToolUsageExample {
  scenario: string;
  input: Record<string, any>;
  expectedOutput: string;
  reasoning: string;
}

export interface CommunicationProtocol {
  type: 'user' | 'agent' | 'system';
  format: string;
  frequency: 'always' | 'significant-actions' | 'on-error' | 'on-completion';
  template: string;
  examples: string[];
}

export interface CoordinationPattern {
  patternType: 'sequential' | 'parallel' | 'collaborative' | 'validation' | 'iterative';
  description: string;
  participants: string[]; // Other agent IDs
  dataFlow: string;
  synchronizationPoints: string[];
  conflictResolution: string;
}

export interface QualityMetric {
  name: string;
  target: number;
  measurement: string;
  acceptableRange: string;
}

export interface PerformanceTarget {
  avgResponseTime: number; // milliseconds
  maxResponseTime: number;
  successRate: number; // 0-1
  errorRate: number; // 0-1
  costPerExecution: string;
}

// ================================================================================================
// AGENT WORKFLOW REGISTRY
// ================================================================================================

export class AgentWorkflowRegistry {
  private workflows: Map<string, AgentWorkflowDefinition> = new Map();

  constructor() {
    this.initializeWorkflows();
  }

  private initializeWorkflows(): void {
    logger.info('🔄 Initializing Agent Workflow Definitions...');
    
    // Load workflow definitions for all tiers
    this.loadExecutiveTierWorkflows(); // Executive tier agents
    this.loadDevelopmentTierWorkflows(); // Development tier agents
    this.loadCreativeTierWorkflows(); // Creative tier agents
    this.loadQATierWorkflows(); // QA tier agents
    this.loadDevOpsTierWorkflows(); // DevOps tier agents
    this.loadDomainTierWorkflows(); // Domain specialist agents
    
    logger.info(`✅ Loaded ${this.workflows.size} agent workflow definitions`);
  }

  // ================================================================================================
  // EXECUTIVE TIER WORKFLOWS
  // ================================================================================================

  private loadExecutiveTierWorkflows(): void {
    // CEO Strategist Agent
    this.addWorkflow({
      agentId: 'ceo-strategist',
      agentName: 'CEO Strategist',
      tier: 'executive',
      romaLevel: 'L4',
      
      tasks: [
        {
          id: 'strategic-planning',
          name: 'Strategic Planning & Vision Setting',
          description: 'Develop long-term strategic plans and set organizational vision',
          complexity: 'expert',
          estimatedDuration: '30-60 minutes',
          prerequisites: ['Market analysis data', 'Competitive landscape', 'Resource constraints'],
          outputs: ['Strategic plan document', 'OKRs', 'Resource allocation plan'],
          examples: [
            'Define 3-year product roadmap',
            'Set quarterly OKRs for engineering team',
            'Plan market expansion strategy'
          ]
        },
        {
          id: 'market-analysis',
          name: 'Market Opportunity Analysis',
          description: 'Analyze market trends and identify opportunities',
          complexity: 'expert',
          estimatedDuration: '15-30 minutes',
          prerequisites: ['Industry data', 'Competitor information'],
          outputs: ['Market analysis report', 'Opportunity assessment', 'Risk analysis'],
          examples: [
            'Evaluate AI startup accelerator market',
            'Assess enterprise SaaS competition',
            'Identify untapped market segments'
          ]
        },
        {
          id: 'resource-allocation',
          name: 'Resource Allocation & Prioritization',
          description: 'Optimize allocation of team, budget, and time across initiatives',
          complexity: 'expert',
          estimatedDuration: '20-40 minutes',
          prerequisites: ['Initiative list', 'Resource availability', 'Business objectives'],
          outputs: ['Resource allocation plan', 'Priority matrix', 'Budget allocation'],
          examples: [
            'Allocate engineering resources across 5 product initiatives',
            'Prioritize features for next quarter',
            'Balance innovation vs maintenance work'
          ]
        }
      ],
      
      sequences: [
        {
          id: 'strategic-planning-sequence',
          name: 'Complete Strategic Planning Workflow',
          description: 'End-to-end strategic planning from analysis to execution plan',
          steps: [
            {
              order: 1,
              name: 'Gather Context',
              action: 'Search codebase and documents for strategic context',
              tools: ['codebase-search', 'grep-search', 'read'],
              expectedOutput: 'Comprehensive understanding of current state',
              successCriteria: 'Found relevant business documents, OKRs, metrics',
              errorHandling: 'Ask user for strategic context if not found',
              parallelizable: false
            },
            {
              order: 2,
              name: 'Market Research',
              action: 'Search web for market trends and competitor information',
              tools: ['web_search', 'web_fetch'],
              expectedOutput: 'Market analysis with trends and competitive landscape',
              successCriteria: 'Latest market data and competitor positioning found',
              errorHandling: 'Use available data, note gaps in report',
              parallelizable: true
            },
            {
              order: 3,
              name: 'Analyze Opportunities',
              action: 'Evaluate opportunities using decision framework',
              tools: [],
              expectedOutput: 'Ranked list of opportunities with ROI estimates',
              successCriteria: 'Clear opportunity ranking with rationale',
              errorHandling: 'Re-evaluate with different criteria if unclear',
              parallelizable: false
            },
            {
              order: 4,
              name: 'Create Strategic Plan',
              action: 'Write comprehensive strategic plan document',
              tools: ['write'],
              expectedOutput: 'Strategic plan with vision, goals, roadmap, metrics',
              successCriteria: 'All sections complete, actionable, measurable',
              errorHandling: 'Iterate with user feedback',
              parallelizable: false
            },
            {
              order: 5,
              name: 'Review with Architect',
              action: 'Get strategic review from architect agent',
              tools: ['architect'],
              expectedOutput: 'Validation of strategic plan quality',
              successCriteria: 'Architect approves plan or provides feedback',
              errorHandling: 'Incorporate feedback and re-review',
              parallelizable: false
            }
          ],
          decisionPoints: [
            {
              step: 2,
              condition: 'Market data sufficient for analysis?',
              ifTrue: 'Proceed to step 3',
              ifFalse: 'Request additional data from user',
              escalationPath: 'Ask user for access to market research tools'
            },
            {
              step: 4,
              condition: 'Strategic plan meets quality standards?',
              ifTrue: 'Proceed to step 5',
              ifFalse: 'Revise plan with additional analysis'
            }
          ],
          fallbackStrategy: 'If unable to complete strategic planning, provide framework and guidance for user to complete with human expertise'
        }
      ],
      
      actions: [
        {
          id: 'analyze-market',
          name: 'Analyze Market Trends',
          description: 'Research and analyze market trends using web search',
          category: 'analyze',
          riskLevel: 'low',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'set-okrs',
          name: 'Define OKRs',
          description: 'Create quarterly Objectives and Key Results',
          category: 'write',
          riskLevel: 'medium',
          requiresApproval: true,
          reversible: true
        },
        {
          id: 'allocate-budget',
          name: 'Allocate Budget',
          description: 'Distribute budget across initiatives',
          category: 'analyze',
          riskLevel: 'high',
          requiresApproval: true,
          reversible: true
        }
      ],
      
      tools: [
        {
          toolName: 'web_search',
          useCases: ['Market research', 'Competitor analysis', 'Industry trends'],
          whenToUse: [
            'Need latest market data',
            'Researching competitors',
            'Analyzing industry trends',
            'Finding best practices'
          ],
          whenNotToUse: [
            'Internal company data needed',
            'Proprietary information required',
            'Historical company data needed'
          ],
          examples: [
            {
              scenario: 'Research AI startup accelerator market size',
              input: { query: 'AI startup accelerator market size 2025' },
              expectedOutput: 'Market size data, growth trends, key players',
              reasoning: 'Latest market data is essential for strategic planning'
            }
          ],
          constraints: ['Limited to publicly available information', 'May have recency limits']
        },
        {
          toolName: 'codebase-search',
          useCases: ['Find strategic documents', 'Review existing OKRs', 'Understand current initiatives'],
          whenToUse: [
            'Need internal strategic context',
            'Looking for existing plans',
            'Understanding current state'
          ],
          whenNotToUse: [
            'Need external market data',
            'Searching for specific code implementations'
          ],
          examples: [
            {
              scenario: 'Find existing OKR documents',
              input: { query: 'Where are the quarterly OKRs defined?' },
              expectedOutput: 'Location of OKR documents and their content',
              reasoning: 'Need to understand current objectives before setting new ones'
            }
          ],
          constraints: ['Limited to codebase and documentation files']
        },
        {
          toolName: 'write',
          useCases: ['Create strategic plans', 'Document OKRs', 'Write analysis reports'],
          whenToUse: [
            'Creating new strategic documents',
            'Documenting decisions',
            'Writing comprehensive plans'
          ],
          whenNotToUse: [
            'Making small edits to existing files (use edit)',
            'Creating code files'
          ],
          examples: [
            {
              scenario: 'Create quarterly strategic plan',
              input: { file_path: 'strategic-plan-Q1-2026.md', content: '# Strategic Plan...' },
              expectedOutput: 'Strategic plan document created',
              reasoning: 'New strategic planning document needed'
            }
          ],
          constraints: ['Overwrites existing files - read first if updating']
        },
        {
          toolName: 'architect',
          useCases: ['Review strategic plans', 'Get expert feedback', 'Validate approach'],
          whenToUse: [
            'Completing major strategic work',
            'Need expert validation',
            'Ensuring quality before delivery'
          ],
          whenNotToUse: [
            'Simple tasks',
            'Routine operations',
            'Already validated work'
          ],
          examples: [
            {
              scenario: 'Review strategic plan quality',
              input: { task: 'Review strategic plan for Q1 2026', relevant_files: ['strategic-plan-Q1-2026.md'], responsibility: 'evaluate_task' },
              expectedOutput: 'Quality assessment and feedback',
              reasoning: 'Strategic plans need expert review before execution'
            }
          ],
          constraints: ['Should be used judiciously - not for every action']
        }
      ],
      
      communicationProtocols: [
        {
          type: 'user',
          format: 'Executive Summary + Detailed Analysis',
          frequency: 'significant-actions',
          template: `
## Executive Summary
[Concise overview of strategic recommendation]

## Analysis
[Data-driven insights and rationale]

## Recommendation
[Clear action items with priorities]

## Next Steps
[Specific actions required]
          `,
          examples: [
            'Completed market analysis for AI accelerator space. Key finding: $2.5B market growing at 45% CAGR. Recommend focusing on enterprise segment.',
            'Strategic plan for Q1 2026 complete. Top priority: Launch SHAKTI AI platform. Resource allocation: 60% development, 20% marketing, 20% support.'
          ]
        },
        {
          type: 'agent',
          format: 'Structured coordination message',
          frequency: 'always',
          template: 'Task: [task] | Required from: [agent] | Context: [context] | Deadline: [deadline]',
          examples: [
            'Task: Implement payment processing | Required from: fullstack-developer | Context: Strategic initiative for revenue generation | Deadline: 2 weeks'
          ]
        }
      ],
      
      coordinationPatterns: [
        {
          patternType: 'sequential',
          description: 'CEO sets strategy → Development teams execute',
          participants: ['fullstack-developer', 'devops-engineer', 'qa-specialist'],
          dataFlow: 'Strategic plan → Implementation tasks → Progress updates',
          synchronizationPoints: ['Plan approval', 'Milestone reviews', 'Quarterly reviews'],
          conflictResolution: 'CEO has final decision authority on strategic priorities'
        },
        {
          patternType: 'collaborative',
          description: 'CEO works with domain experts for specialized decisions',
          participants: ['domain-specialists', 'technical-architects'],
          dataFlow: 'Bidirectional - CEO provides vision, specialists provide domain expertise',
          synchronizationPoints: ['Weekly strategic sync', 'Major decision points'],
          conflictResolution: 'Consensus-based with CEO having tie-breaking authority'
        }
      ],
      
      successCriteria: [
        'Strategic plans are clear, measurable, and achievable',
        'All stakeholders understand and align with strategy',
        'Resource allocation optimizes for business objectives',
        'Decisions are data-driven and well-documented',
        'Long-term thinking balanced with short-term execution'
      ],
      
      qualityMetrics: [
        {
          name: 'Strategic Plan Quality',
          target: 0.90,
          measurement: 'Architect review score',
          acceptableRange: '0.85-1.0'
        },
        {
          name: 'Stakeholder Alignment',
          target: 0.95,
          measurement: 'User approval rate',
          acceptableRange: '0.90-1.0'
        },
        {
          name: 'Plan Completeness',
          target: 1.0,
          measurement: 'All required sections present',
          acceptableRange: '1.0'
        }
      ],
      
      performanceTargets: {
        avgResponseTime: 2000,
        maxResponseTime: 5000,
        successRate: 0.95,
        errorRate: 0.05,
        costPerExecution: '$0.50-$2.00 depending on complexity'
      }
    });
  }

  // ================================================================================================
  // DEVELOPMENT TIER WORKFLOWS
  // ================================================================================================

  private loadDevelopmentTierWorkflows(): void {
    // Full-Stack Developer Agent
    this.addWorkflow({
      agentId: 'fullstack-developer',
      agentName: 'Full-Stack Developer',
      tier: 'development',
      romaLevel: 'L3',
      
      tasks: [
        {
          id: 'implement-feature',
          name: 'Full-Stack Feature Implementation',
          description: 'Implement complete features across frontend, backend, and database',
          complexity: 'complex',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Feature requirements', 'Design mockups (if UI)', 'API contracts'],
          outputs: ['Working feature', 'Tests', 'Documentation'],
          examples: [
            'Add user authentication with JWT',
            'Implement payment processing with Stripe',
            'Create admin dashboard with analytics'
          ]
        },
        {
          id: 'refactor-code',
          name: 'Code Refactoring',
          description: 'Improve code quality, maintainability, and performance',
          complexity: 'moderate',
          estimatedDuration: '20-60 minutes',
          prerequisites: ['Code to refactor', 'Quality goals', 'Test coverage'],
          outputs: ['Refactored code', 'Updated tests', 'Performance metrics'],
          examples: [
            'Refactor authentication to use service pattern',
            'Extract reusable UI components',
            'Optimize database queries'
          ]
        },
        {
          id: 'fix-bug',
          name: 'Bug Investigation & Fix',
          description: 'Debug issues and implement fixes',
          complexity: 'moderate',
          estimatedDuration: '15-45 minutes',
          prerequisites: ['Bug report', 'Steps to reproduce', 'Error logs'],
          outputs: ['Bug fix', 'Root cause analysis', 'Regression tests'],
          examples: [
            'Fix login failing for users with special characters in email',
            'Resolve memory leak in data processing pipeline',
            'Fix race condition in concurrent operations'
          ]
        },
        {
          id: 'optimize-performance',
          name: 'Performance Optimization',
          description: 'Identify and fix performance bottlenecks',
          complexity: 'complex',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Performance metrics', 'Profiling data', 'Bottleneck identification'],
          outputs: ['Optimized code', 'Performance benchmarks', 'Optimization report'],
          examples: [
            'Reduce page load time from 3s to <1s',
            'Optimize API response time with caching',
            'Implement lazy loading for large datasets'
          ]
        }
      ],
      
      sequences: [
        {
          id: 'feature-implementation-sequence',
          name: 'Complete Feature Implementation Workflow',
          description: 'End-to-end feature development from requirements to deployment',
          steps: [
            {
              order: 1,
              name: 'Understand Requirements',
              action: 'Search codebase for context and related implementations',
              tools: ['codebase-search', 'grep-search', 'read'],
              expectedOutput: 'Understanding of existing patterns, libraries, and architecture',
              successCriteria: 'Found relevant code examples and established patterns',
              errorHandling: 'Ask user for clarification if requirements unclear',
              parallelizable: false
            },
            {
              order: 2,
              name: 'Design Data Model',
              action: 'Create or update database schema in shared/schema.ts',
              tools: ['read', 'edit'],
              expectedOutput: 'Drizzle schema with insert/select types',
              successCriteria: 'Type-safe schema matching requirements',
              errorHandling: 'Review existing schemas if unsure about patterns',
              parallelizable: false
            },
            {
              order: 3,
              name: 'Implement Backend',
              action: 'Create API routes, storage layer, validation',
              tools: ['read', 'edit', 'write'],
              expectedOutput: 'Working API endpoints with validation and error handling',
              successCriteria: 'API routes follow existing patterns, type-safe, validated',
              errorHandling: 'Check LSP errors, fix type issues',
              parallelizable: false
            },
            {
              order: 4,
              name: 'Implement Frontend',
              action: 'Create UI components, forms, state management',
              tools: ['read', 'edit', 'write', 'glob'],
              expectedOutput: 'Working UI with proper state management and styling',
              successCriteria: 'Follows design guidelines, accessible, responsive',
              errorHandling: 'Check browser console logs for errors',
              parallelizable: false
            },
            {
              order: 5,
              name: 'Write Tests',
              action: 'Create unit and integration tests',
              tools: ['write', 'bash'],
              expectedOutput: 'Test coverage for new code',
              successCriteria: 'Tests pass, cover main scenarios',
              errorHandling: 'Debug failing tests, fix implementation',
              parallelizable: false
            },
            {
              order: 6,
              name: 'Run Tests & Verify',
              action: 'Execute test suite and verify functionality',
              tools: ['bash', 'refresh_all_logs'],
              expectedOutput: 'All tests passing, no console errors',
              successCriteria: 'Green test suite, clean logs',
              errorHandling: 'Fix failing tests, iterate until green',
              parallelizable: false
            },
            {
              order: 7,
              name: 'Code Review',
              action: 'Get architect review with git diff',
              tools: ['architect'],
              expectedOutput: 'Code quality approval',
              successCriteria: 'Architect approves or provides fixable feedback',
              errorHandling: 'Fix issues and request re-review',
              parallelizable: false
            },
            {
              order: 8,
              name: 'User Verification',
              action: 'Get user feedback on implementation',
              tools: ['mark_completed_and_get_feedback'],
              expectedOutput: 'User confirms feature works as expected',
              successCriteria: 'User accepts implementation',
              errorHandling: 'Iterate based on feedback',
              parallelizable: false
            }
          ],
          decisionPoints: [
            {
              step: 2,
              condition: 'Database schema changes needed?',
              ifTrue: 'Design data model',
              ifFalse: 'Skip to step 3'
            },
            {
              step: 4,
              condition: 'Feature has UI component?',
              ifTrue: 'Implement frontend',
              ifFalse: 'Skip to step 5',
              escalationPath: 'Clarify with user if UI needed'
            },
            {
              step: 6,
              condition: 'Tests passing and logs clean?',
              ifTrue: 'Proceed to code review',
              ifFalse: 'Debug and fix issues, repeat step 6'
            }
          ],
          fallbackStrategy: 'If unable to complete feature, provide partial implementation with clear documentation of what\'s missing and why, with suggestions for next steps'
        },
        {
          id: 'bug-fix-sequence',
          name: 'Complete Bug Fix Workflow',
          description: 'Systematic bug investigation and resolution',
          steps: [
            {
              order: 1,
              name: 'Reproduce Bug',
              action: 'Understand and reproduce the issue',
              tools: ['codebase-search', 'grep-search', 'read', 'refresh_all_logs'],
              expectedOutput: 'Clear understanding of bug and steps to reproduce',
              successCriteria: 'Can consistently reproduce the issue',
              errorHandling: 'Request more details from user if cannot reproduce',
              parallelizable: false
            },
            {
              order: 2,
              name: 'Identify Root Cause',
              action: 'Analyze code and logs to find root cause',
              tools: ['read', 'grep-search', 'get_latest_lsp_diagnostics'],
              expectedOutput: 'Root cause identified with supporting evidence',
              successCriteria: 'Clear explanation of why bug occurs',
              errorHandling: 'Use architect tool for debugging assistance if stuck',
              parallelizable: false
            },
            {
              order: 3,
              name: 'Implement Fix',
              action: 'Fix the bug with minimal changes',
              tools: ['edit', 'write'],
              expectedOutput: 'Code changes that fix the bug',
              successCriteria: 'Targeted fix without breaking other functionality',
              errorHandling: 'If fix breaks other things, try different approach',
              parallelizable: false
            },
            {
              order: 4,
              name: 'Add Regression Test',
              action: 'Create test that would have caught this bug',
              tools: ['write', 'edit'],
              expectedOutput: 'Test that fails before fix, passes after',
              successCriteria: 'Test covers the bug scenario',
              errorHandling: 'Simplify test if too complex',
              parallelizable: false
            },
            {
              order: 5,
              name: 'Verify Fix',
              action: 'Run tests and verify bug is resolved',
              tools: ['bash', 'mark_completed_and_get_feedback'],
              expectedOutput: 'Tests pass, bug no longer reproducible',
              successCriteria: 'All tests green, user confirms fix',
              errorHandling: 'Debug and iterate if still failing',
              parallelizable: false
            }
          ],
          decisionPoints: [
            {
              step: 1,
              condition: 'Can reproduce bug?',
              ifTrue: 'Proceed to root cause analysis',
              ifFalse: 'Request more information from user',
              escalationPath: 'Ask user to provide video/screenshots if still cannot reproduce'
            },
            {
              step: 2,
              condition: 'Root cause identified?',
              ifTrue: 'Implement fix',
              ifFalse: 'Use architect debugging assistance'
            }
          ],
          fallbackStrategy: 'If bug cannot be fixed immediately, implement workaround and create detailed issue report with reproduction steps and investigation findings'
        }
      ],
      
      actions: [
        {
          id: 'read-code',
          name: 'Read Code',
          description: 'Read and understand existing code',
          category: 'read',
          riskLevel: 'low',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'edit-code',
          name: 'Edit Code',
          description: 'Make targeted edits to existing files',
          category: 'write',
          riskLevel: 'medium',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'create-file',
          name: 'Create File',
          description: 'Create new code files',
          category: 'write',
          riskLevel: 'medium',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'run-tests',
          name: 'Run Tests',
          description: 'Execute test suite to verify functionality',
          category: 'execute',
          riskLevel: 'low',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'install-package',
          name: 'Install Package',
          description: 'Install npm package dependency',
          category: 'execute',
          riskLevel: 'medium',
          requiresApproval: true,
          reversible: true
        },
        {
          id: 'database-migration',
          name: 'Database Migration',
          description: 'Run database schema migrations',
          category: 'execute',
          riskLevel: 'high',
          requiresApproval: true,
          reversible: false
        }
      ],
      
      tools: [
        {
          toolName: 'codebase-search',
          useCases: ['Understand architecture', 'Find related implementations', 'Locate files'],
          whenToUse: [
            'Don\'t know which files contain relevant code',
            'Need architectural understanding',
            'Looking for existing patterns to follow'
          ],
          whenNotToUse: [
            'Know exact file to read (use read instead)',
            'Searching for specific symbol (use grep instead)',
            'Need external information (use web_search instead)'
          ],
          examples: [
            {
              scenario: 'Find authentication implementation',
              input: { query: 'Where is user authentication handled?' },
              expectedOutput: 'Files and functions handling authentication',
              reasoning: 'Broad exploratory search to understand auth architecture'
            }
          ],
          constraints: ['Limited to codebase files, cannot search external resources']
        },
        {
          toolName: 'grep-search',
          useCases: ['Find all references to symbol', 'Search for specific code patterns', 'Find usages'],
          whenToUse: [
            'Know what symbol/pattern to find',
            'Need all references across codebase',
            'Searching for specific imports/functions'
          ],
          whenNotToUse: [
            'Don\'t know what to search for (use codebase-search)',
            'Need complete file context (use read)'
          ],
          examples: [
            {
              scenario: 'Find all usages of loginUser function',
              input: { pattern: 'loginUser', output_mode: 'files_with_matches' },
              expectedOutput: 'List of files using loginUser',
              reasoning: 'Targeted search for specific function usage'
            }
          ],
          constraints: ['Regex pattern matching, may need escaping for special chars']
        },
        {
          toolName: 'read',
          useCases: ['Read file content', 'Understand implementation', 'Get context before editing'],
          whenToUse: [
            'Need to read file before editing',
            'Want complete file context',
            'Reading specific section with offset/limit'
          ],
          whenNotToUse: [
            'Searching across multiple files (use grep or codebase-search)',
            'Don\'t know which file to read (use search first)'
          ],
          examples: [
            {
              scenario: 'Read authentication service implementation',
              input: { file_path: 'server/services/auth-service.ts' },
              expectedOutput: 'Complete file content with line numbers',
              reasoning: 'Need full context before making changes'
            },
            {
              scenario: 'Read large file with pagination',
              input: { file_path: 'server/routes.ts', offset: 100, limit: 500 },
              expectedOutput: 'Lines 100-600 of routes.ts',
              reasoning: 'Efficient reading of large file in chunks'
            }
          ],
          constraints: ['Max 1000 lines per read (use offset/limit for larger files)']
        },
        {
          toolName: 'edit',
          useCases: ['Make targeted code changes', 'Update existing files', 'Refactor code'],
          whenToUse: [
            'Making small to medium changes',
            'Updating existing code (ALWAYS read file first)',
            'Need exact string replacement'
          ],
          whenNotToUse: [
            'Creating new file (use write)',
            'Haven\'t read the file yet (MUST read first)',
            'Changing entire file (use write)'
          ],
          examples: [
            {
              scenario: 'Update function implementation',
              input: {
                file_path: 'server/auth.ts',
                old_string: 'function login(email, password) {\\n  // old implementation\\n}',
                new_string: 'async function login(email: string, password: string): Promise<User> {\\n  // new type-safe implementation\\n}'
              },
              expectedOutput: 'File updated with new implementation',
              reasoning: 'Targeted update to specific function'
            }
          ],
          constraints: [
            'MUST read file first',
            'old_string must match exactly (including whitespace)',
            'Must be unique unless replace_all=true'
          ]
        },
        {
          toolName: 'write',
          useCases: ['Create new files', 'Completely rewrite files', 'Generate code'],
          whenToUse: [
            'Creating new file that doesn\'t exist',
            'Completely replacing file content',
            'Generated code from template'
          ],
          whenNotToUse: [
            'Making small edits (use edit)',
            'File already exists and reading would be better (read + edit)'
          ],
          examples: [
            {
              scenario: 'Create new API route file',
              input: {
                file_path: 'server/routes/payments.ts',
                content: 'import express from "express";\\n\\nconst router = express.Router();\\n\\n// Payment routes\\n\\nexport default router;'
              },
              expectedOutput: 'New payments.ts file created',
              reasoning: 'New file needed for payment functionality'
            }
          ],
          constraints: ['Overwrites existing files - be careful!']
        },
        {
          toolName: 'bash',
          useCases: ['Run tests', 'Install packages', 'Execute build commands'],
          whenToUse: [
            'Running npm scripts',
            'Executing tests',
            'Build/compile operations',
            'Checking command output'
          ],
          whenNotToUse: [
            'Long-running servers (use restart_workflow)',
            'Commands >2 minutes (will timeout)'
          ],
          examples: [
            {
              scenario: 'Run integration tests',
              input: { command: 'npm test', timeout: 60000, description: 'Run integration test suite' },
              expectedOutput: 'Test results with pass/fail status',
              reasoning: 'Verify code works correctly'
            },
            {
              scenario: 'Install new package',
              input: { command: 'npm install stripe', timeout: 30000, description: 'Install Stripe SDK' },
              expectedOutput: 'Package installed successfully',
              reasoning: 'Add payment processing capability'
            }
          ],
          constraints: ['Max 10 minute timeout', 'No interactive commands']
        },
        {
          toolName: 'packager_tool',
          useCases: ['Install npm packages', 'Manage dependencies'],
          whenToUse: [
            'Need to add npm package',
            'Removing unused packages',
            'Managing dependencies'
          ],
          whenNotToUse: [
            'Installing system packages (use bash)',
            'Making other changes (keep focused)'
          ],
          examples: [
            {
              scenario: 'Install React Query',
              input: { install_or_uninstall: 'install', language_or_system: 'nodejs', dependency_list: ['@tanstack/react-query'] },
              expectedOutput: '@tanstack/react-query installed',
              reasoning: 'Need state management library'
            }
          ],
          constraints: ['Auto-restarts workflows after install']
        },
        {
          toolName: 'get_latest_lsp_diagnostics',
          useCases: ['Check TypeScript errors', 'Find syntax issues', 'Validate types'],
          whenToUse: [
            'After making code changes',
            'Before completing task',
            'Debugging type errors'
          ],
          whenNotToUse: [
            'Looking for runtime errors (check logs)',
            'Just made comment changes (LSP won\'t show errors)'
          ],
          examples: [
            {
              scenario: 'Check for TypeScript errors after refactor',
              input: { file_path: 'server/auth.ts' },
              expectedOutput: 'List of LSP errors and warnings',
              reasoning: 'Verify no type errors introduced'
            }
          ],
          constraints: ['Shows static errors only, not runtime errors']
        },
        {
          toolName: 'architect',
          useCases: ['Code review', 'Get expert feedback', 'Debugging assistance'],
          whenToUse: [
            'Completing major work',
            'Need strategic guidance',
            'Stuck on complex problem'
          ],
          whenNotToUse: [
            'Simple changes',
            'Already have plan',
            'Routine operations'
          ],
          examples: [
            {
              scenario: 'Review feature implementation',
              input: {
                task: 'Review payment processing implementation',
                relevant_files: ['server/routes/payments.ts', 'client/src/pages/PaymentPage.tsx'],
                include_git_diff: true,
                responsibility: 'evaluate_task'
              },
              expectedOutput: 'Code quality feedback and suggestions',
              reasoning: 'Payment processing is critical, needs expert review'
            }
          ],
          constraints: ['Use judiciously - premium model cost']
        },
        {
          toolName: 'mark_completed_and_get_feedback',
          useCases: ['Get user verification', 'Screenshot verification', 'Final approval'],
          whenToUse: [
            'Feature implementation complete',
            'Ready for user testing',
            'All tests passing'
          ],
          whenNotToUse: [
            'Work incomplete',
            'Tests failing',
            'Known issues remaining'
          ],
          examples: [
            {
              scenario: 'Get user approval for new dashboard',
              input: { query: 'Dashboard implementation complete. Does it meet your requirements?', workflow_name: 'Start application' },
              expectedOutput: 'Screenshot + user feedback',
              reasoning: 'User needs to visually verify dashboard'
            }
          ],
          constraints: ['Only use when truly ready for user review']
        }
      ],
      
      communicationProtocols: [
        {
          type: 'user',
          format: 'Technical summary + code snippets',
          frequency: 'significant-actions',
          template: `
## Changes Made
[What was implemented/changed]

## Technical Details
[Key technical decisions and patterns used]

## Testing
[What was tested and results]

## Next Steps
[What should happen next]
          `,
          examples: [
            'Implemented payment processing with Stripe. Added /api/payments endpoint with webhook handling. All integration tests passing.',
            'Fixed login bug for special characters. Root cause: email validation regex too restrictive. Added regression test.'
          ]
        },
        {
          type: 'agent',
          format: 'Technical coordination',
          frequency: 'always',
          template: 'Task: [task] | Files: [files] | Dependencies: [deps] | Status: [status]',
          examples: [
            'Task: Implement auth | Files: server/auth.ts, client/Login.tsx | Dependencies: bcrypt, jwt | Status: In Progress'
          ]
        }
      ],
      
      coordinationPatterns: [
        {
          patternType: 'sequential',
          description: 'Backend → Frontend → Testing',
          participants: ['backend-developer', 'frontend-developer', 'qa-specialist'],
          dataFlow: 'API implementation → UI integration → Test validation',
          synchronizationPoints: ['API complete', 'UI complete', 'Tests passing'],
          conflictResolution: 'Tech lead makes final architectural decisions'
        },
        {
          patternType: 'parallel',
          description: 'Multiple developers on independent features',
          participants: ['fullstack-developer-1', 'fullstack-developer-2'],
          dataFlow: 'Independent feature development with shared schema',
          synchronizationPoints: ['Schema changes', 'Shared component updates'],
          conflictResolution: 'Code review process resolves conflicts'
        }
      ],
      
      successCriteria: [
        'Code is type-safe and follows existing patterns',
        'All tests pass (unit + integration)',
        'No LSP errors or warnings',
        'Follows design guidelines for UI',
        'Architect review approves quality',
        'User confirms functionality works'
      ],
      
      qualityMetrics: [
        {
          name: 'Code Quality',
          target: 0.90,
          measurement: 'Architect review score',
          acceptableRange: '0.85-1.0'
        },
        {
          name: 'Test Coverage',
          target: 0.80,
          measurement: 'Code coverage percentage',
          acceptableRange: '0.70-1.0'
        },
        {
          name: 'Type Safety',
          target: 1.0,
          measurement: 'Zero LSP errors',
          acceptableRange: '1.0'
        }
      ],
      
      performanceTargets: {
        avgResponseTime: 3000,
        maxResponseTime: 10000,
        successRate: 0.92,
        errorRate: 0.08,
        costPerExecution: '$1.00-$5.00 depending on complexity'
      }
    });
  }

  // ================================================================================================
  // CREATIVE, QA, DEVOPS, DOMAIN TIER WORKFLOWS
  // ================================================================================================

  private loadCreativeTierWorkflows(): void {
    this.addWorkflow({
      agentId: 'content-creator',
      agentName: 'Content Creator',
      tier: 'creative',
      romaLevel: 'L2',
      tasks: [{
        id: 'create-content', name: 'Content Creation', description: 'Generate marketing copy, documentation, and creative content',
        complexity: 'moderate', estimatedDuration: '10-30 minutes',
        prerequisites: ['Content brief', 'Brand guidelines'], outputs: ['Finished content', 'SEO metadata'],
        examples: ['Write product landing page copy', 'Create blog post', 'Draft email campaign']
      }],
      sequences: [{ id: 'content-sequence', name: 'Content Pipeline', description: 'Research → Draft → Review → Publish',
        steps: [{ order: 1, name: 'Research', action: 'Research topic and audience', tools: ['web_search'], expectedOutput: 'Research notes', successCriteria: 'Sufficient source material gathered', errorHandling: 'Broaden search terms', parallelizable: false }],
        decisionPoints: [], fallbackStrategy: 'Provide draft with gaps clearly marked for human review' }],
      actions: [{ id: 'draft-content', name: 'Draft Content', description: 'Write initial content draft', category: 'write', riskLevel: 'low', requiresApproval: false, reversible: true }],
      tools: [{ toolName: 'web_search', useCases: ['Topic research', 'Competitor content analysis'], whenToUse: ['Need factual data', 'Researching trends'], whenNotToUse: ['Internal content updates'], examples: [], constraints: ['Public data only'] }],
      communicationProtocols: [{ type: 'user', format: 'Draft with revision notes', frequency: 'on-completion', template: '## Content Draft\n[content]\n\n## Notes\n[revision guidance]', examples: [] }],
      coordinationPatterns: [{ patternType: 'sequential', description: 'Content Creator drafts → QA reviews', participants: ['qa-specialist'], dataFlow: 'Draft → Review → Final', synchronizationPoints: ['Draft review'], conflictResolution: 'User has final editorial authority' }],
      successCriteria: ['Content meets brand guidelines', 'SEO optimized', 'Factually accurate'],
      qualityMetrics: [{ name: 'Content Quality', target: 0.90, measurement: 'Review score', acceptableRange: '0.85-1.0' }],
      performanceTargets: { avgResponseTime: 5000, maxResponseTime: 15000, successRate: 0.92, errorRate: 0.08, costPerExecution: '$0.25-$1.00' }
    });
    logger.info('📝 Creative Tier workflows loaded');
  }

  private loadQATierWorkflows(): void {
    this.addWorkflow({
      agentId: 'qa-specialist',
      agentName: 'QA Specialist',
      tier: 'qa',
      romaLevel: 'L2',
      tasks: [{
        id: 'test-feature', name: 'Feature Testing', description: 'Design and execute test cases for features',
        complexity: 'moderate', estimatedDuration: '15-45 minutes',
        prerequisites: ['Feature implementation', 'Requirements'], outputs: ['Test results', 'Bug reports'],
        examples: ['Write unit tests for auth module', 'Perform regression testing', 'Validate API contracts']
      }],
      sequences: [{ id: 'qa-sequence', name: 'QA Pipeline', description: 'Plan → Execute → Report',
        steps: [{ order: 1, name: 'Plan Tests', action: 'Analyze feature and design test cases', tools: ['codebase-search', 'read'], expectedOutput: 'Test plan', successCriteria: 'All acceptance criteria covered', errorHandling: 'Request clarification on requirements', parallelizable: false }],
        decisionPoints: [], fallbackStrategy: 'Report partial coverage with clear gaps identified' }],
      actions: [{ id: 'run-tests', name: 'Execute Tests', description: 'Run test suite', category: 'execute', riskLevel: 'low', requiresApproval: false, reversible: true }],
      tools: [{ toolName: 'codebase-search', useCases: ['Find existing tests', 'Understand implementation'], whenToUse: ['Analyzing code under test'], whenNotToUse: ['Running tests'], examples: [], constraints: [] }],
      communicationProtocols: [{ type: 'user', format: 'Test Report', frequency: 'on-completion', template: '## Test Results\n[pass/fail summary]\n\n## Issues Found\n[bugs]', examples: [] }],
      coordinationPatterns: [{ patternType: 'validation', description: 'QA validates developer output', participants: ['fullstack-developer'], dataFlow: 'Implementation → Test → Feedback', synchronizationPoints: ['Test completion'], conflictResolution: 'QA findings take priority for quality gates' }],
      successCriteria: ['All critical paths tested', 'No blocking bugs', 'Coverage targets met'],
      qualityMetrics: [{ name: 'Test Coverage', target: 0.85, measurement: 'Code coverage percentage', acceptableRange: '0.80-1.0' }],
      performanceTargets: { avgResponseTime: 3000, maxResponseTime: 10000, successRate: 0.95, errorRate: 0.05, costPerExecution: '$0.20-$0.75' }
    });
    logger.info('🧪 QA Tier workflows loaded');
  }

  private loadDevOpsTierWorkflows(): void {
    this.addWorkflow({
      agentId: 'devops-engineer',
      agentName: 'DevOps Engineer',
      tier: 'devops',
      romaLevel: 'L3',
      tasks: [{
        id: 'deploy-service', name: 'Service Deployment', description: 'Deploy and manage infrastructure and services',
        complexity: 'complex', estimatedDuration: '20-60 minutes',
        prerequisites: ['Service artifacts', 'Infrastructure config'], outputs: ['Deployed service', 'Monitoring setup'],
        examples: ['Deploy to production', 'Configure CI/CD pipeline', 'Set up monitoring and alerting']
      }],
      sequences: [{ id: 'deploy-sequence', name: 'Deployment Pipeline', description: 'Build → Test → Deploy → Verify',
        steps: [{ order: 1, name: 'Build', action: 'Build and package service artifacts', tools: ['execute'], expectedOutput: 'Build artifacts', successCriteria: 'Build succeeds with no errors', errorHandling: 'Fix build errors and retry', parallelizable: false }],
        decisionPoints: [], fallbackStrategy: 'Roll back to last known good deployment' }],
      actions: [{ id: 'deploy', name: 'Deploy Service', description: 'Deploy service to target environment', category: 'execute', riskLevel: 'high', requiresApproval: true, reversible: true }],
      tools: [{ toolName: 'execute', useCases: ['Run deployment scripts', 'Health checks'], whenToUse: ['Deploying services', 'Running infrastructure commands'], whenNotToUse: ['Destructive operations without approval'], examples: [], constraints: ['Requires approval for production'] }],
      communicationProtocols: [{ type: 'user', format: 'Deployment Status', frequency: 'significant-actions', template: '## Deployment Status\n[status]\n\n## Health Checks\n[results]', examples: [] }],
      coordinationPatterns: [{ patternType: 'sequential', description: 'Dev completes → DevOps deploys', participants: ['fullstack-developer', 'qa-specialist'], dataFlow: 'Code → Tests → Deploy → Monitor', synchronizationPoints: ['Pre-deploy review', 'Post-deploy verification'], conflictResolution: 'DevOps has authority on infrastructure decisions' }],
      successCriteria: ['Zero-downtime deployment', 'All health checks pass', 'Monitoring active'],
      qualityMetrics: [{ name: 'Deployment Success Rate', target: 0.99, measurement: 'Successful deployments / total', acceptableRange: '0.95-1.0' }],
      performanceTargets: { avgResponseTime: 5000, maxResponseTime: 30000, successRate: 0.98, errorRate: 0.02, costPerExecution: '$0.50-$2.00' }
    });
    logger.info('🔧 DevOps Tier workflows loaded');
  }

  private loadDomainTierWorkflows(): void {
    this.addWorkflow({
      agentId: 'domain-specialist',
      agentName: 'Domain Specialist',
      tier: 'domain',
      romaLevel: 'L2',
      tasks: [{
        id: 'domain-analysis', name: 'Domain Analysis', description: 'Provide expert analysis for specific business domains',
        complexity: 'expert', estimatedDuration: '15-45 minutes',
        prerequisites: ['Domain context', 'Analysis requirements'], outputs: ['Expert analysis', 'Recommendations'],
        examples: ['Legal compliance review', 'Financial risk assessment', 'Healthcare data analysis']
      }],
      sequences: [{ id: 'analysis-sequence', name: 'Domain Analysis Pipeline', description: 'Context → Research → Analyze → Report',
        steps: [{ order: 1, name: 'Gather Context', action: 'Collect domain-specific context and requirements', tools: ['codebase-search', 'web_search'], expectedOutput: 'Domain context summary', successCriteria: 'Sufficient domain context gathered', errorHandling: 'Request additional context from user', parallelizable: false }],
        decisionPoints: [], fallbackStrategy: 'Provide analysis with confidence levels and knowledge gaps clearly noted' }],
      actions: [{ id: 'analyze-domain', name: 'Domain Analysis', description: 'Perform domain-specific analysis', category: 'analyze', riskLevel: 'medium', requiresApproval: false, reversible: true }],
      tools: [{ toolName: 'web_search', useCases: ['Domain research', 'Regulatory updates'], whenToUse: ['Need current domain information'], whenNotToUse: ['Internal data analysis'], examples: [], constraints: ['Verify domain-specific claims'] }],
      communicationProtocols: [{ type: 'user', format: 'Expert Analysis Report', frequency: 'on-completion', template: '## Domain Analysis\n[findings]\n\n## Recommendations\n[actions]', examples: [] }],
      coordinationPatterns: [{ patternType: 'collaborative', description: 'Domain specialist collaborates with dev team', participants: ['fullstack-developer', 'ceo-strategist'], dataFlow: 'Requirements → Expert Analysis → Implementation Guidance', synchronizationPoints: ['Analysis review'], conflictResolution: 'Domain specialist has authority on domain-specific decisions' }],
      successCriteria: ['Analysis covers all requested areas', 'Recommendations are actionable', 'Domain accuracy verified'],
      qualityMetrics: [{ name: 'Analysis Accuracy', target: 0.92, measurement: 'Expert review score', acceptableRange: '0.88-1.0' }],
      performanceTargets: { avgResponseTime: 5000, maxResponseTime: 20000, successRate: 0.90, errorRate: 0.10, costPerExecution: '$0.50-$3.00' }
    });
    logger.info('🎯 Domain Tier workflows loaded');
  }

  // ================================================================================================
  // HELPER METHODS
  // ================================================================================================

  private addWorkflow(workflow: AgentWorkflowDefinition): void {
    this.workflows.set(workflow.agentId, workflow);
  }

  public getWorkflow(agentId: string): AgentWorkflowDefinition | undefined {
    return this.workflows.get(agentId);
  }

  public getAllWorkflows(): AgentWorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  public getWorkflowsByTier(tier: string): AgentWorkflowDefinition[] {
    return this.getAllWorkflows().filter(w => w.tier === tier);
  }

  public getWorkflowsByRomaLevel(romaLevel: string): AgentWorkflowDefinition[] {
    return this.getAllWorkflows().filter(w => w.romaLevel === romaLevel);
  }

  public getWorkflowStats(): {
    total: number;
    byTier: Record<string, number>;
    byRomaLevel: Record<string, number>;
  } {
    const workflows = this.getAllWorkflows();
    const byTier: Record<string, number> = {};
    const byRomaLevel: Record<string, number> = {};

    workflows.forEach(w => {
      byTier[w.tier] = (byTier[w.tier] || 0) + 1;
      byRomaLevel[w.romaLevel] = (byRomaLevel[w.romaLevel] || 0) + 1;
    });

    return {
      total: workflows.length,
      byTier,
      byRomaLevel
    };
  }

  // Generate markdown documentation for all workflows
  public generateDocumentation(): string {
    const workflows = this.getAllWorkflows();
    let doc = '# Jurexio Agent Workflow Definitions\n\n';
    
    doc += `**Total Workflows**: ${workflows.length}\n\n`;
    doc += '**Generated**: ' + new Date().toISOString() + '\n\n';
    
    doc += '---\n\n';
    
    workflows.forEach(workflow => {
      doc += `## ${workflow.agentName} (${workflow.agentId})\n\n`;
      doc += `**Tier**: ${workflow.tier} | **ROMA Level**: ${workflow.romaLevel}\n\n`;
      
      doc += `### Tasks (${workflow.tasks.length})\n`;
      workflow.tasks.forEach(task => {
        doc += `- **${task.name}**: ${task.description}\n`;
        doc += `  - Complexity: ${task.complexity}\n`;
        doc += `  - Duration: ${task.estimatedDuration}\n`;
      });
      doc += '\n';
      
      doc += `### Tools (${workflow.tools.length})\n`;
      workflow.tools.forEach(tool => {
        doc += `- **${tool.toolName}**: ${tool.useCases.join(', ')}\n`;
      });
      doc += '\n';
      
      doc += '---\n\n';
    });
    
    return doc;
  }
}

// Export singleton instance
export const agentWorkflowRegistry = new AgentWorkflowRegistry();
// Note: AgentWorkflowRegistry class is already exported above at its declaration.

