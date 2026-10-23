/**
 * Jurexio Agent Workflow Generator v10.0
 * 
 * Intelligent system that programmatically generates comprehensive workflow definitions
 * for all 267 Jurexio Enterprise Platform SDK agents based on their tier, category, capabilities, and ROMA level.
 * 
 * This generator creates production-ready workflows including:
 * - Tasks, sequences, actions, tools
 * - Communication protocols, coordination patterns
 * - Success criteria, quality metrics, performance targets
 * 
 * @version 10.0.0
 * @date November 22, 2025
 */

import { 


  AgentWorkflowDefinition, 
  AgentTask, 
  AgentSequence, 
  AgentAction, 
  AgentToolUsage,
  CommunicationProtocol,
  CoordinationPattern,
  QualityMetric,
  PerformanceTarget,
  SequenceStep,
  DecisionPoint,
  ToolUsageExample
} from './agent-workflow-definitions-v10.js';
const logger = createLogger('agent-workflow-generator-v10');

import { createLogger } from '../utils/logger.js';

// ================================================================================================
// WORKFLOW GENERATION RULES & TEMPLATES
// ================================================================================================

interface AgentProfile {
  id: string;
  name: string;
  tier: 'executive' | 'development' | 'creative' | 'qa' | 'devops' | 'domain';
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4';
  category: string;
  capabilities: string[];
  model?: string;
  description?: string;
}

export class AgentWorkflowGenerator {
  
  /**
   * Generate complete workflow definition for any agent
   */
  public generateWorkflow(agent: AgentProfile): AgentWorkflowDefinition {
    return {
      agentId: agent.id,
      agentName: agent.name,
      tier: agent.tier,
      romaLevel: agent.romaLevel,
      tasks: this.generateTasks(agent),
      sequences: this.generateSequences(agent),
      actions: this.generateActions(agent),
      tools: this.generateToolUsage(agent),
      communicationProtocols: this.generateCommunicationProtocols(agent),
      coordinationPatterns: this.generateCoordinationPatterns(agent),
      successCriteria: this.generateSuccessCriteria(agent),
      qualityMetrics: this.generateQualityMetrics(agent),
      performanceTargets: this.generatePerformanceTargets(agent)
    };
  }

  /**
   * Generate all workflows for a list of agents
   */
  public generateAllWorkflows(agents: AgentProfile[]): Map<string, AgentWorkflowDefinition> {
    const workflows = new Map<string, AgentWorkflowDefinition>();
    
    logger.info(`🔄 Generating workflows for ${agents.length} agents...`);
    
    agents.forEach(agent => {
      try {
        const workflow = this.generateWorkflow(agent);
        workflows.set(agent.id, workflow);
      } catch (error: any) {
        logger.error(`❌ Error generating workflow for ${agent.id}:`, error);
      }
    });
    
    logger.info(`✅ Generated ${workflows.size} workflow definitions`);
    return workflows;
  }

  // ================================================================================================
  // TASK GENERATION
  // ================================================================================================

  private generateTasks(agent: AgentProfile): AgentTask[] {
    const tasks: AgentTask[] = [];
    
    // Generate tier-specific tasks
    const tierTasks = this.getTierSpecificTasks(agent.tier, agent.capabilities);
    tasks.push(...tierTasks);
    
    // Generate capability-specific tasks
    const capabilityTasks = this.getCapabilitySpecificTasks(agent.capabilities);
    tasks.push(...capabilityTasks);
    
    // Generate ROMA-level appropriate tasks
    const romaTasks = this.getROMALevelTasks(agent.romaLevel);
    tasks.push(...romaTasks);
    
    return tasks;
  }

  private getTierSpecificTasks(tier: string, capabilities: string[]): AgentTask[] {
    const tierTaskMap: Record<string, AgentTask[]> = {
      'executive': [
        {
          id: 'strategic-decision-making',
          name: 'Strategic Decision Making',
          description: 'Make high-level strategic decisions with long-term impact',
          complexity: 'expert',
          estimatedDuration: '30-60 minutes',
          prerequisites: ['Market data', 'Business objectives', 'Resource constraints'],
          outputs: ['Strategic decision', 'Rationale document', 'Implementation plan'],
          examples: ['Decide market entry strategy', 'Set quarterly OKRs', 'Allocate budget across initiatives']
        },
        {
          id: 'stakeholder-alignment',
          name: 'Stakeholder Alignment',
          description: 'Ensure all stakeholders are aligned on strategic direction',
          complexity: 'complex',
          estimatedDuration: '20-40 minutes',
          prerequisites: ['Stakeholder list', 'Strategic plan', 'Communication strategy'],
          outputs: ['Alignment plan', 'Stakeholder buy-in', 'Communication materials'],
          examples: ['Align exec team on roadmap', 'Get investor approval', 'Communicate to all-hands']
        }
      ],
      'development': [
        {
          id: 'code-implementation',
          name: 'Code Implementation',
          description: 'Implement features, fix bugs, refactor code',
          complexity: 'moderate',
          estimatedDuration: '15-90 minutes',
          prerequisites: ['Requirements', 'Architecture design', 'Test plan'],
          outputs: ['Working code', 'Tests', 'Documentation'],
          examples: ['Implement user authentication', 'Fix memory leak', 'Refactor to microservices']
        },
        {
          id: 'technical-design',
          name: 'Technical Design',
          description: 'Design system architecture and technical solutions',
          complexity: 'complex',
          estimatedDuration: '30-60 minutes',
          prerequisites: ['Requirements', 'Constraints', 'Technology stack'],
          outputs: ['Architecture diagram', 'Technical specification', 'Risk analysis'],
          examples: ['Design scalable API', 'Plan database schema', 'Design caching strategy']
        }
      ],
      'creative': [
        {
          id: 'content-creation',
          name: 'Content Creation',
          description: 'Create engaging content across multiple formats',
          complexity: 'moderate',
          estimatedDuration: '20-60 minutes',
          prerequisites: ['Content brief', 'Target audience', 'Brand guidelines'],
          outputs: ['Content piece', 'Visual assets', 'Distribution plan'],
          examples: ['Write blog post', 'Design marketing campaign', 'Create video script']
        },
        {
          id: 'design-implementation',
          name: 'Design Implementation',
          description: 'Design user interfaces and visual experiences',
          complexity: 'moderate',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Design brief', 'User research', 'Design system'],
          outputs: ['Design mockups', 'Prototypes', 'Design specifications'],
          examples: ['Design dashboard UI', 'Create design system', 'Redesign landing page']
        }
      ],
      'qa': [
        {
          id: 'quality-assurance',
          name: 'Quality Assurance Testing',
          description: 'Test software for bugs, performance, and usability',
          complexity: 'moderate',
          estimatedDuration: '15-60 minutes',
          prerequisites: ['Test plan', 'Test environment', 'Acceptance criteria'],
          outputs: ['Test results', 'Bug reports', 'Quality metrics'],
          examples: ['Run regression tests', 'Perform load testing', 'Execute E2E tests']
        },
        {
          id: 'test-automation',
          name: 'Test Automation',
          description: 'Create and maintain automated test suites',
          complexity: 'complex',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Testing framework', 'Test scenarios', 'CI/CD pipeline'],
          outputs: ['Automated tests', 'Test reports', 'Coverage metrics'],
          examples: ['Write integration tests', 'Create E2E test suite', 'Set up visual regression tests']
        }
      ],
      'devops': [
        {
          id: 'infrastructure-automation',
          name: 'Infrastructure Automation',
          description: 'Automate infrastructure provisioning and management',
          complexity: 'complex',
          estimatedDuration: '30-120 minutes',
          prerequisites: ['Infrastructure requirements', 'IaC tools', 'Cloud platform'],
          outputs: ['Infrastructure code', 'Deployment scripts', 'Monitoring setup'],
          examples: ['Write Terraform modules', 'Set up Kubernetes cluster', 'Configure CI/CD pipeline']
        },
        {
          id: 'monitoring-alerting',
          name: 'Monitoring & Alerting',
          description: 'Set up monitoring, logging, and alerting systems',
          complexity: 'moderate',
          estimatedDuration: '20-60 minutes',
          prerequisites: ['Monitoring tools', 'SLOs', 'Alert channels'],
          outputs: ['Monitoring dashboards', 'Alert rules', 'Runbooks'],
          examples: ['Configure Prometheus', 'Set up error tracking', 'Create SLO dashboards']
        }
      ],
      'domain': [
        {
          id: 'domain-expertise',
          name: 'Domain-Specific Problem Solving',
          description: 'Apply deep domain knowledge to solve specialized problems',
          complexity: 'expert',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Domain knowledge', 'Problem context', 'Constraints'],
          outputs: ['Domain solution', 'Analysis report', 'Recommendations'],
          examples: ['Optimize ML model', 'Design security architecture', 'Analyze financial data']
        }
      ]
    };

    return tierTaskMap[tier] || [];
  }

  private getCapabilitySpecificTasks(capabilities: string[]): AgentTask[] {
    const tasks: AgentTask[] = [];
    
    // Generate tasks based on capabilities
    capabilities.forEach(capability => {
      const capabilityTask = this.getTaskForCapability(capability);
      if (capabilityTask) {
        tasks.push(capabilityTask);
      }
    });
    
    return tasks;
  }

  private getTaskForCapability(capability: string): AgentTask | null {
    const capabilityTaskMap: Record<string, AgentTask> = {
      'api-design': {
        id: 'api-design-task',
        name: 'API Design & Implementation',
        description: 'Design RESTful APIs with proper endpoints and documentation',
        complexity: 'moderate',
        estimatedDuration: '20-60 minutes',
        prerequisites: ['API requirements', 'Data models', 'Authentication strategy'],
        outputs: ['API specification', 'Endpoint implementation', 'API documentation'],
        examples: ['Design user management API', 'Create payment API', 'Build search API']
      },
      'database-schema': {
        id: 'database-schema-task',
        name: 'Database Schema Design',
        description: 'Design efficient and scalable database schemas',
        complexity: 'complex',
        estimatedDuration: '30-90 minutes',
        prerequisites: ['Data requirements', 'Query patterns', 'Scaling requirements'],
        outputs: ['Database schema', 'Migrations', 'Indexes'],
        examples: ['Design user data schema', 'Create multi-tenant schema', 'Optimize query performance']
      },
      'testing': {
        id: 'testing-task',
        name: 'Comprehensive Testing',
        description: 'Write and execute tests across all levels',
        complexity: 'moderate',
        estimatedDuration: '15-45 minutes',
        prerequisites: ['Test framework', 'Test scenarios', 'Acceptance criteria'],
        outputs: ['Test suite', 'Test reports', 'Coverage metrics'],
        examples: ['Write unit tests', 'Create integration tests', 'Perform E2E testing']
      },
      'ui-design': {
        id: 'ui-design-task',
        name: 'User Interface Design',
        description: 'Design intuitive and accessible user interfaces',
        complexity: 'moderate',
        estimatedDuration: '30-90 minutes',
        prerequisites: ['User research', 'Design system', 'Accessibility guidelines'],
        outputs: ['UI mockups', 'Interactive prototypes', 'Design specifications'],
        examples: ['Design dashboard', 'Create mobile app UI', 'Redesign checkout flow']
      },
      'kubernetes': {
        id: 'kubernetes-task',
        name: 'Kubernetes Orchestration',
        description: 'Deploy and manage containerized applications on Kubernetes',
        complexity: 'complex',
        estimatedDuration: '30-120 minutes',
        prerequisites: ['Container images', 'Cluster access', 'Deployment requirements'],
        outputs: ['Kubernetes manifests', 'Helm charts', 'Deployment pipeline'],
        examples: ['Deploy microservices', 'Set up auto-scaling', 'Configure service mesh']
      }
    };

    return capabilityTaskMap[capability] || null;
  }

  private getROMALevelTasks(romaLevel: string): AgentTask[] {
    const romaTaskMap: Record<string, AgentTask[]> = {
      'L1': [
        {
          id: 'basic-execution',
          name: 'Basic Task Execution',
          description: 'Execute simple, well-defined tasks with clear instructions',
          complexity: 'simple',
          estimatedDuration: '5-15 minutes',
          prerequisites: ['Clear instructions', 'Required inputs'],
          outputs: ['Task completion', 'Status report'],
          examples: ['Read file', 'Execute command', 'Format data']
        }
      ],
      'L2': [
        {
          id: 'tactical-problem-solving',
          name: 'Tactical Problem Solving',
          description: 'Solve multi-step problems with basic decision-making',
          complexity: 'moderate',
          estimatedDuration: '15-45 minutes',
          prerequisites: ['Problem definition', 'Available tools', 'Success criteria'],
          outputs: ['Problem solution', 'Execution report'],
          examples: ['Debug issue', 'Implement feature', 'Optimize query']
        }
      ],
      'L3': [
        {
          id: 'strategic-execution',
          name: 'Strategic Task Execution',
          description: 'Plan and execute complex tasks with strategic thinking',
          complexity: 'complex',
          estimatedDuration: '30-90 minutes',
          prerequisites: ['Requirements', 'Constraints', 'Quality standards'],
          outputs: ['Complete solution', 'Documentation', 'Quality report'],
          examples: ['Implement full feature', 'Refactor architecture', 'Design system']
        }
      ],
      'L4': [
        {
          id: 'autonomous-operation',
          name: 'Autonomous Operation',
          description: 'Operate fully autonomously with self-directed improvements',
          complexity: 'expert',
          estimatedDuration: '60-180 minutes',
          prerequisites: ['Mission objectives', 'Success metrics', 'Resources'],
          outputs: ['Mission completion', 'Continuous improvements', 'Strategic recommendations'],
          examples: ['Lead project end-to-end', 'Optimize entire system', 'Innovate new solutions']
        }
      ]
    };

    return romaTaskMap[romaLevel] || [];
  }

  // ================================================================================================
  // SEQUENCE GENERATION
  // ================================================================================================

  private generateSequences(agent: AgentProfile): AgentSequence[] {
    const sequences: AgentSequence[] = [];
    
    // Generate primary workflow sequence
    sequences.push(this.generatePrimarySequence(agent));
    
    // Generate error handling sequence
    sequences.push(this.generateErrorHandlingSequence(agent));
    
    // Generate optimization sequence for L3+ agents
    if (agent.romaLevel === 'L3' || agent.romaLevel === 'L4') {
      sequences.push(this.generateOptimizationSequence(agent));
    }
    
    return sequences;
  }

  private generatePrimarySequence(agent: AgentProfile): AgentSequence {
    const steps = this.generateSequenceSteps(agent);
    const decisionPoints = this.generateDecisionPoints(agent, steps);
    
    return {
      id: `${agent.id}-primary-sequence`,
      name: `${agent.name} Primary Workflow`,
      description: `Main workflow for ${agent.name} agent`,
      steps,
      decisionPoints,
      fallbackStrategy: this.generateFallbackStrategy(agent)
    };
  }

  private generateSequenceSteps(agent: AgentProfile): SequenceStep[] {
    // Base steps for all agents
    const baseSteps: SequenceStep[] = [
      {
        order: 1,
        name: 'Understand Task',
        action: 'Analyze task requirements and gather context',
        tools: ['codebase-search', 'grep-search', 'read'],
        expectedOutput: 'Clear understanding of task requirements',
        successCriteria: 'All requirements understood, context gathered',
        errorHandling: 'Ask user for clarification if requirements unclear',
        parallelizable: false
      },
      {
        order: 2,
        name: 'Plan Approach',
        action: 'Create execution plan with step-by-step approach',
        tools: [],
        expectedOutput: 'Detailed execution plan',
        successCriteria: 'Plan covers all requirements and edge cases',
        errorHandling: 'Revise plan if gaps identified',
        parallelizable: false
      }
    ];

    // Add tier-specific steps
    const tierSteps = this.getTierSpecificSteps(agent.tier);
    
    // Add completion steps
    const completionSteps: SequenceStep[] = [
      {
        order: baseSteps.length + tierSteps.length + 1,
        name: 'Verify Results',
        action: 'Test and verify implementation',
        tools: ['bash', 'refresh_all_logs', 'get_latest_lsp_diagnostics'],
        expectedOutput: 'Verified working solution',
        successCriteria: 'All tests pass, no errors in logs',
        errorHandling: 'Fix issues and re-verify',
        parallelizable: false
      },
      {
        order: baseSteps.length + tierSteps.length + 2,
        name: 'Quality Review',
        action: 'Get architect review of implementation',
        tools: ['architect'],
        expectedOutput: 'Quality approval',
        successCriteria: 'Architect approves or provides fixable feedback',
        errorHandling: 'Address feedback and request re-review',
        parallelizable: false
      }
    ];

    // Combine all steps with proper ordering
    const allSteps = [...baseSteps, ...tierSteps, ...completionSteps];
    return allSteps.map((step, index) => ({ ...step, order: index + 1 }));
  }

  private getTierSpecificSteps(tier: string): SequenceStep[] {
    const tierStepMap: Record<string, SequenceStep[]> = {
      'executive': [
        {
          order: 3,
          name: 'Gather Strategic Data',
          action: 'Research market, competitors, and internal data',
          tools: ['web_search', 'web_fetch', 'codebase-search'],
          expectedOutput: 'Comprehensive data for decision-making',
          successCriteria: 'Sufficient data to make informed decision',
          errorHandling: 'Identify data gaps and request additional information',
          parallelizable: true
        },
        {
          order: 4,
          name: 'Analyze & Decide',
          action: 'Apply decision framework and make strategic decision',
          tools: [],
          expectedOutput: 'Strategic decision with clear rationale',
          successCriteria: 'Decision aligns with business objectives',
          errorHandling: 'Re-evaluate if decision conflicts with constraints',
          parallelizable: false
        },
        {
          order: 5,
          name: 'Document Strategy',
          action: 'Create strategic plan document',
          tools: ['write'],
          expectedOutput: 'Comprehensive strategic plan',
          successCriteria: 'All stakeholders can understand and act on plan',
          errorHandling: 'Clarify ambiguous sections',
          parallelizable: false
        }
      ],
      'development': [
        {
          order: 3,
          name: 'Design Solution',
          action: 'Design technical solution architecture',
          tools: ['read', 'grep-search'],
          expectedOutput: 'Technical design document',
          successCriteria: 'Design follows best practices and existing patterns',
          errorHandling: 'Revise design based on constraints',
          parallelizable: false
        },
        {
          order: 4,
          name: 'Implement Code',
          action: 'Write code implementation',
          tools: ['edit', 'write', 'packager_tool'],
          expectedOutput: 'Working code implementation',
          successCriteria: 'Code compiles, follows style guide, type-safe',
          errorHandling: 'Fix compilation errors, address LSP diagnostics',
          parallelizable: false
        },
        {
          order: 5,
          name: 'Write Tests',
          action: 'Create test suite for new code',
          tools: ['write', 'edit'],
          expectedOutput: 'Comprehensive test coverage',
          successCriteria: 'Tests cover main scenarios and edge cases',
          errorHandling: 'Add missing test cases',
          parallelizable: true
        }
      ],
      'creative': [
        {
          order: 3,
          name: 'Research & Ideate',
          action: 'Research trends and generate creative ideas',
          tools: ['web_search', 'stock_image_tool'],
          expectedOutput: 'Creative concepts and ideas',
          successCriteria: 'Ideas are original and on-brand',
          errorHandling: 'Generate alternative concepts',
          parallelizable: true
        },
        {
          order: 4,
          name: 'Create Content',
          action: 'Produce content/design assets',
          tools: ['write', 'edit'],
          expectedOutput: 'Polished content ready for use',
          successCriteria: 'Content meets quality standards and brand guidelines',
          errorHandling: 'Revise based on feedback',
          parallelizable: false
        }
      ],
      'qa': [
        {
          order: 3,
          name: 'Create Test Plan',
          action: 'Design comprehensive test plan',
          tools: ['read', 'codebase-search'],
          expectedOutput: 'Detailed test plan',
          successCriteria: 'Test plan covers all requirements',
          errorHandling: 'Add missing test scenarios',
          parallelizable: false
        },
        {
          order: 4,
          name: 'Execute Tests',
          action: 'Run tests and collect results',
          tools: ['bash', 'refresh_all_logs'],
          expectedOutput: 'Test results and reports',
          successCriteria: 'All tests executed successfully',
          errorHandling: 'Investigate and report test failures',
          parallelizable: true
        }
      ],
      'devops': [
        {
          order: 3,
          name: 'Design Infrastructure',
          action: 'Design infrastructure architecture',
          tools: ['read', 'codebase-search'],
          expectedOutput: 'Infrastructure design document',
          successCriteria: 'Design meets scalability and reliability requirements',
          errorHandling: 'Revise design based on constraints',
          parallelizable: false
        },
        {
          order: 4,
          name: 'Implement Automation',
          action: 'Write infrastructure as code and automation scripts',
          tools: ['write', 'edit'],
          expectedOutput: 'Infrastructure code and scripts',
          successCriteria: 'Code is idempotent and follows IaC best practices',
          errorHandling: 'Fix syntax errors and validate configs',
          parallelizable: false
        }
      ],
      'domain': [
        {
          order: 3,
          name: 'Apply Domain Expertise',
          action: 'Apply specialized domain knowledge to problem',
          tools: ['web_search', 'read'],
          expectedOutput: 'Domain-specific solution',
          successCriteria: 'Solution leverages domain best practices',
          errorHandling: 'Consult additional domain resources',
          parallelizable: false
        }
      ]
    };

    return tierStepMap[tier] || [];
  }

  private generateDecisionPoints(agent: AgentProfile, steps: SequenceStep[]): DecisionPoint[] {
    const decisionPoints: DecisionPoint[] = [];
    
    // Add decision point after understanding task
    decisionPoints.push({
      step: 1,
      condition: 'Requirements clear and complete?',
      ifTrue: 'Proceed to planning',
      ifFalse: 'Ask user for clarification',
      escalationPath: 'Request detailed requirements document'
    });
    
    // Add tier-specific decision points
    if (agent.tier === 'development') {
      decisionPoints.push({
        step: 4,
        condition: 'Code compiles without errors?',
        ifTrue: 'Proceed to testing',
        ifFalse: 'Fix compilation errors and retry',
        escalationPath: 'Use architect for debugging assistance'
      });
    }
    
    // Add decision point before completion
    const lastStep = steps.length;
    decisionPoints.push({
      step: lastStep - 1,
      condition: 'All tests passing and quality verified?',
      ifTrue: 'Mark task complete',
      ifFalse: 'Fix issues and re-verify'
    });
    
    return decisionPoints;
  }

  private generateErrorHandlingSequence(agent: AgentProfile): AgentSequence {
    return {
      id: `${agent.id}-error-handling`,
      name: 'Error Handling & Recovery',
      description: 'Handle errors and recover gracefully',
      steps: [
        {
          order: 1,
          name: 'Detect Error',
          action: 'Identify error from logs or diagnostics',
          tools: ['refresh_all_logs', 'get_latest_lsp_diagnostics'],
          expectedOutput: 'Clear understanding of error',
          successCriteria: 'Error type and location identified',
          errorHandling: 'Escalate to architect if cannot identify',
          parallelizable: false
        },
        {
          order: 2,
          name: 'Analyze Root Cause',
          action: 'Investigate root cause of error',
          tools: ['read', 'grep-search', 'codebase-search'],
          expectedOutput: 'Root cause identified',
          successCriteria: 'Clear explanation of why error occurred',
          errorHandling: 'Use architect debugging assistance if stuck',
          parallelizable: false
        },
        {
          order: 3,
          name: 'Implement Fix',
          action: 'Apply minimal fix to resolve error',
          tools: ['edit', 'write'],
          expectedOutput: 'Error resolved',
          successCriteria: 'Error no longer occurs',
          errorHandling: 'Try alternative fix approach',
          parallelizable: false
        },
        {
          order: 4,
          name: 'Verify Fix',
          action: 'Confirm error is resolved',
          tools: ['bash', 'refresh_all_logs'],
          expectedOutput: 'Clean execution without errors',
          successCriteria: 'Original error no longer reproducible',
          errorHandling: 'Repeat fix cycle if error persists',
          parallelizable: false
        }
      ],
      decisionPoints: [
        {
          step: 2,
          condition: 'Root cause identified?',
          ifTrue: 'Implement fix',
          ifFalse: 'Use architect debugging tool',
          escalationPath: 'Request user assistance if still stuck'
        }
      ],
      fallbackStrategy: 'If unable to fix error after 3 attempts, document issue and request user assistance'
    };
  }

  private generateOptimizationSequence(agent: AgentProfile): AgentSequence {
    return {
      id: `${agent.id}-optimization`,
      name: 'Continuous Optimization',
      description: 'Continuously improve implementation quality and performance',
      steps: [
        {
          order: 1,
          name: 'Identify Improvements',
          action: 'Analyze code for optimization opportunities',
          tools: ['read', 'grep-search', 'get_latest_lsp_diagnostics'],
          expectedOutput: 'List of potential improvements',
          successCriteria: 'Actionable improvements identified',
          errorHandling: 'Focus on high-impact improvements only',
          parallelizable: false
        },
        {
          order: 2,
          name: 'Implement Optimizations',
          action: 'Apply optimizations systematically',
          tools: ['edit', 'write'],
          expectedOutput: 'Optimized code',
          successCriteria: 'Measurable improvement in metrics',
          errorHandling: 'Revert if optimization causes issues',
          parallelizable: false
        },
        {
          order: 3,
          name: 'Measure Impact',
          action: 'Verify optimization improved performance',
          tools: ['bash', 'refresh_all_logs'],
          expectedOutput: 'Performance metrics',
          successCriteria: 'Metrics show improvement',
          errorHandling: 'Iterate with different optimizations',
          parallelizable: false
        }
      ],
      decisionPoints: [
        {
          step: 2,
          condition: 'Optimization worth the complexity?',
          ifTrue: 'Apply optimization',
          ifFalse: 'Skip and move to next improvement'
        }
      ],
      fallbackStrategy: 'Prioritize simplicity over minor performance gains'
    };
  }

  private generateFallbackStrategy(agent: AgentProfile): string {
    const romaFallback: Record<string, string> = {
      'L1': 'If unable to execute basic task, report error to user with details',
      'L2': 'If unable to solve problem, break down into simpler steps or escalate to L3 agent',
      'L3': 'If unable to complete complex task, provide partial solution with clear documentation of what\'s missing',
      'L4': 'If unable to achieve mission, analyze blockers, propose alternative approaches, and adapt strategy'
    };

    return romaFallback[agent.romaLevel] || 'Request user assistance if blocked';
  }

  // ================================================================================================
  // ACTION GENERATION
  // ================================================================================================

  private generateActions(agent: AgentProfile): AgentAction[] {
    const actions: AgentAction[] = [
      {
        id: 'read-information',
        name: 'Read Information',
        description: 'Read files, search codebase, gather context',
        category: 'read',
        riskLevel: 'low',
        requiresApproval: false,
        reversible: true
      },
      {
        id: 'analyze-data',
        name: 'Analyze Data',
        description: 'Analyze code, data, or system behavior',
        category: 'analyze',
        riskLevel: 'low',
        requiresApproval: false,
        reversible: true
      }
    ];

    // Add tier-specific actions
    if (agent.tier === 'executive') {
      actions.push({
        id: 'make-strategic-decision',
        name: 'Make Strategic Decision',
        description: 'Make high-level strategic decisions',
        category: 'analyze',
        riskLevel: 'high',
        requiresApproval: true,
        reversible: true
      });
    }

    if (agent.tier === 'development' || agent.tier === 'devops') {
      actions.push(
        {
          id: 'write-code',
          name: 'Write Code',
          description: 'Create or modify code files',
          category: 'write',
          riskLevel: 'medium',
          requiresApproval: false,
          reversible: true
        },
        {
          id: 'execute-commands',
          name: 'Execute Commands',
          description: 'Run shell commands, tests, builds',
          category: 'execute',
          riskLevel: 'medium',
          requiresApproval: false,
          reversible: true
        }
      );
    }

    if (agent.tier === 'devops') {
      actions.push({
        id: 'deploy-infrastructure',
        name: 'Deploy Infrastructure',
        description: 'Deploy or modify infrastructure',
        category: 'execute',
        riskLevel: 'high',
        requiresApproval: true,
        reversible: false
      });
    }

    return actions;
  }

  // ================================================================================================
  // TOOL USAGE GENERATION
  // ================================================================================================

  private generateToolUsage(agent: AgentProfile): AgentToolUsage[] {
    // All agents have access to basic tools
    const basicTools: AgentToolUsage[] = [
      {
        toolName: 'codebase-search',
        useCases: ['Find relevant files', 'Understand architecture', 'Locate implementations'],
        whenToUse: ['Don\'t know which files to read', 'Need architectural overview', 'Looking for patterns'],
        whenNotToUse: ['Know exact file (use read)', 'Searching for specific symbol (use grep)'],
        examples: [{
          scenario: 'Find authentication implementation',
          input: { query: 'Where is user authentication handled?' },
          expectedOutput: 'Files handling authentication',
          reasoning: 'Broad search to understand auth architecture'
        }],
        constraints: ['Limited to codebase files']
      },
      {
        toolName: 'read',
        useCases: ['Read file content', 'Get context before editing', 'Understand implementation'],
        whenToUse: ['Need to read specific file', 'Before editing file', 'Understanding code'],
        whenNotToUse: ['Don\'t know which file (use codebase-search)', 'Searching across files (use grep)'],
        examples: [{
          scenario: 'Read auth service',
          input: { file_path: 'server/auth.ts' },
          expectedOutput: 'Complete file content',
          reasoning: 'Need full context before making changes'
        }],
        constraints: ['Max 1000 lines per read']
      }
    ];

    // Add tier-specific tools
    const tierTools = this.getTierSpecificTools(agent.tier);
    
    // Add capability-specific tools
    const capabilityTools = this.getCapabilitySpecificTools(agent.capabilities);
    
    return [...basicTools, ...tierTools, ...capabilityTools];
  }

  private getTierSpecificTools(tier: string): AgentToolUsage[] {
    const tierToolMap: Record<string, AgentToolUsage[]> = {
      'executive': [
        {
          toolName: 'web_search',
          useCases: ['Market research', 'Competitor analysis', 'Industry trends'],
          whenToUse: ['Need latest market data', 'Researching competitors', 'Finding best practices'],
          whenNotToUse: ['Internal data needed', 'Historical company data'],
          examples: [{
            scenario: 'Research market trends',
            input: { query: 'AI startup market trends 2025' },
            expectedOutput: 'Market data and trends',
            reasoning: 'Need latest market intelligence for strategy'
          }],
          constraints: ['Public information only']
        }
      ],
      'development': [
        {
          toolName: 'edit',
          useCases: ['Modify code', 'Fix bugs', 'Refactor'],
          whenToUse: ['Small to medium changes', 'After reading file', 'Targeted updates'],
          whenNotToUse: ['Creating new file (use write)', 'Haven\'t read file yet'],
          examples: [{
            scenario: 'Fix function',
            input: { file_path: 'server/auth.ts', old_string: 'old code', new_string: 'new code' },
            expectedOutput: 'File updated',
            reasoning: 'Targeted fix to specific function'
          }],
          constraints: ['Must read file first', 'old_string must match exactly']
        },
        {
          toolName: 'bash',
          useCases: ['Run tests', 'Build code', 'Execute scripts'],
          whenToUse: ['Need to run command', 'Testing code', 'Building project'],
          whenNotToUse: ['Long-running servers (use restart_workflow)'],
          examples: [{
            scenario: 'Run tests',
            input: { command: 'npm test', timeout: 60000, description: 'Run test suite' },
            expectedOutput: 'Test results',
            reasoning: 'Verify code works correctly'
          }],
          constraints: ['Max 10 minute timeout']
        }
      ],
      'creative': [
        {
          toolName: 'stock_image_tool',
          useCases: ['Find images for content', 'Visual assets', 'Design elements'],
          whenToUse: ['Need stock photos', 'Creating visual content'],
          whenNotToUse: ['Custom illustrations needed', 'Brand-specific images'],
          examples: [{
            scenario: 'Get hero image',
            input: { description: 'modern office workspace', limit: 1 },
            expectedOutput: 'Stock image downloaded',
            reasoning: 'Need professional photo for website'
          }],
          constraints: ['Stock images only, no custom generation']
        }
      ],
      'devops': [
        {
          toolName: 'restart_workflow',
          useCases: ['Restart server', 'Apply config changes', 'Deploy updates'],
          whenToUse: ['After code changes', 'Config updates', 'Need to restart service'],
          whenNotToUse: ['Just running tests (use bash)'],
          examples: [{
            scenario: 'Restart after code change',
            input: { name: 'Start application', workflow_timeout: 30 },
            expectedOutput: 'Workflow restarted',
            reasoning: 'Apply latest code changes'
          }],
          constraints: ['May cause brief downtime']
        }
      ],
      'qa': [
        {
          toolName: 'mark_completed_and_get_feedback',
          useCases: ['Get user verification', 'Screenshot testing', 'Final approval'],
          whenToUse: ['Work complete', 'Ready for user testing', 'Need visual confirmation'],
          whenNotToUse: ['Work incomplete', 'Tests failing'],
          examples: [{
            scenario: 'Get user approval',
            input: { query: 'Feature complete. Does it work as expected?', workflow_name: 'Start application' },
            expectedOutput: 'Screenshot + user feedback',
            reasoning: 'User needs to verify functionality'
          }],
          constraints: ['Only when truly ready']
        }
      ],
      'domain': []
    };

    return tierToolMap[tier] || [];
  }

  private getCapabilitySpecificTools(capabilities: string[]): AgentToolUsage[] {
    // Return tools based on specific capabilities
    // This could be expanded with a comprehensive capability→tool mapping
    return [];
  }

  // ================================================================================================
  // COMMUNICATION PROTOCOL GENERATION
  // ================================================================================================

  private generateCommunicationProtocols(agent: AgentProfile): CommunicationProtocol[] {
    return [
      {
        type: 'user',
        format: agent.tier === 'executive' ? 'Executive Summary + Analysis' : 'Technical Summary',
        frequency: 'significant-actions',
        template: agent.tier === 'executive' 
          ? '## Summary\n[High-level overview]\n\n## Analysis\n[Data-driven insights]\n\n## Recommendation\n[Action items]'
          : '## Changes\n[What was done]\n\n## Technical Details\n[How it was done]\n\n## Next Steps\n[What\'s next]',
        examples: [
          `${agent.name} completed task successfully.`,
          `Implemented ${agent.capabilities[0] || 'feature'} with full testing.`
        ]
      },
      {
        type: 'agent',
        format: 'Structured coordination',
        frequency: 'always',
        template: 'Task: [task] | Status: [status] | Required: [requirements]',
        examples: ['Task: Implement auth | Status: In Progress | Required: API key']
      }
    ];
  }

  // ================================================================================================
  // COORDINATION PATTERN GENERATION
  // ================================================================================================

  private generateCoordinationPatterns(agent: AgentProfile): CoordinationPattern[] {
    const patterns: CoordinationPattern[] = [];

    // Tier-based coordination patterns
    if (agent.tier === 'executive') {
      patterns.push({
        patternType: 'sequential',
        description: 'Executive sets strategy → Teams execute',
        participants: ['development-agents', 'creative-agents', 'devops-agents'],
        dataFlow: 'Strategic plan → Implementation tasks → Progress updates',
        synchronizationPoints: ['Plan approval', 'Milestone reviews', 'Quarterly reviews'],
        conflictResolution: 'Executive has final authority'
      });
    } else if (agent.tier === 'development') {
      patterns.push({
        patternType: 'collaborative',
        description: 'Developers collaborate on features',
        participants: ['other-developers', 'qa-agents'],
        dataFlow: 'Code changes → Review → Testing → Deployment',
        synchronizationPoints: ['Code review', 'Test completion', 'Deployment'],
        conflictResolution: 'Technical review and consensus'
      });
    } else if (agent.tier === 'qa') {
      patterns.push({
        patternType: 'validation',
        description: 'QA validates developer work',
        participants: ['development-agents'],
        dataFlow: 'Code submission → Testing → Feedback → Approval',
        synchronizationPoints: ['Test completion', 'Bug reports', 'Quality sign-off'],
        conflictResolution: 'Quality standards enforcement'
      });
    } else if (agent.tier === 'creative') {
      patterns.push({
        patternType: 'collaborative',
        description: 'Creative collaboration with stakeholders',
        participants: ['executive-agents', 'development-agents'],
        dataFlow: 'Brief → Ideation → Creation → Feedback → Refinement',
        synchronizationPoints: ['Creative brief approval', 'Concept review', 'Final delivery'],
        conflictResolution: 'Creative director approval with stakeholder input'
      });
    } else if (agent.tier === 'devops') {
      patterns.push({
        patternType: 'sequential',
        description: 'DevOps pipeline automation',
        participants: ['development-agents', 'qa-agents'],
        dataFlow: 'Code commit → Build → Test → Deploy → Monitor',
        synchronizationPoints: ['Build completion', 'Test pass', 'Deployment success'],
        conflictResolution: 'Automated rollback on failure'
      });
    } else if (agent.tier === 'domain') {
      patterns.push({
        patternType: 'collaborative',
        description: 'Domain expert consultation',
        participants: ['development-agents', 'executive-agents'],
        dataFlow: 'Problem definition → Expert analysis → Solution recommendation → Implementation guidance',
        synchronizationPoints: ['Problem understanding', 'Solution approval', 'Implementation review'],
        conflictResolution: 'Domain expert has final say on domain-specific decisions'
      });
    }

    // Always include a default collaborative pattern if no tier-specific pattern
    if (patterns.length === 0) {
      patterns.push({
        patternType: 'collaborative',
        description: 'General agent collaboration',
        participants: ['other-agents'],
        dataFlow: 'Task assignment → Execution → Review → Completion',
        synchronizationPoints: ['Task start', 'Task completion'],
        conflictResolution: 'Consensus-based decision making'
      });
    }

    return patterns;
  }

  // ================================================================================================
  // SUCCESS CRITERIA GENERATION
  // ================================================================================================

  private generateSuccessCriteria(agent: AgentProfile): string[] {
    const baseCriteria = [
      'Task completed as specified',
      'Quality standards met',
      'No errors or warnings',
      'User confirms success'
    ];

    const tierCriteria: Record<string, string[]> = {
      'executive': ['Strategic alignment verified', 'Stakeholder buy-in achieved', 'ROI clearly defined'],
      'development': ['Code is type-safe', 'All tests pass', 'Follows coding standards', 'Architect review approved'],
      'creative': ['Brand guidelines followed', 'Accessibility standards met', 'User feedback positive'],
      'qa': ['Test coverage adequate', 'All bugs documented', 'Quality metrics met'],
      'devops': ['Infrastructure stable', 'Monitoring in place', 'Rollback plan defined'],
      'domain': ['Domain best practices applied', 'Expert validation obtained']
    };

    return [...baseCriteria, ...(tierCriteria[agent.tier] || [])];
  }

  // ================================================================================================
  // QUALITY METRICS GENERATION
  // ================================================================================================

  private generateQualityMetrics(agent: AgentProfile): QualityMetric[] {
    const metrics: QualityMetric[] = [
      {
        name: 'Task Completion Quality',
        target: 0.90,
        measurement: 'User satisfaction score',
        acceptableRange: '0.85-1.0'
      }
    ];

    if (agent.tier === 'development') {
      metrics.push(
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
      );
    }

    if (agent.tier === 'qa') {
      metrics.push({
        name: 'Bug Detection Rate',
        target: 0.95,
        measurement: 'Percentage of bugs found before production',
        acceptableRange: '0.90-1.0'
      });
    }

    return metrics;
  }

  // ================================================================================================
  // PERFORMANCE TARGET GENERATION
  // ================================================================================================

  private generatePerformanceTargets(agent: AgentProfile): PerformanceTarget {
    const romaBased: Record<string, PerformanceTarget> = {
      'L1': {
        avgResponseTime: 500,
        maxResponseTime: 2000,
        successRate: 0.98,
        errorRate: 0.02,
        costPerExecution: '$0.10-$0.50'
      },
      'L2': {
        avgResponseTime: 1500,
        maxResponseTime: 5000,
        successRate: 0.95,
        errorRate: 0.05,
        costPerExecution: '$0.50-$2.00'
      },
      'L3': {
        avgResponseTime: 3000,
        maxResponseTime: 10000,
        successRate: 0.92,
        errorRate: 0.08,
        costPerExecution: '$1.00-$5.00'
      },
      'L4': {
        avgResponseTime: 5000,
        maxResponseTime: 15000,
        successRate: 0.95,
        errorRate: 0.05,
        costPerExecution: '$2.00-$10.00'
      }
    };

    return romaBased[agent.romaLevel] || romaBased['L2'];
  }
}

// Export singleton instance
export const workflowGenerator = new AgentWorkflowGenerator();
