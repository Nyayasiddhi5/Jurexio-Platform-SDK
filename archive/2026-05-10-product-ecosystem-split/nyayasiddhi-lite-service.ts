/**
 * Nyayasiddhi Lite Service v5.0.0
 * 
 * Based on NYAYASIDDHI Lawyer Module Phase 1 PDD
 * 6 Modules for Solo Lawyers and Small Firms
 * 
 * Modules:
 * 1. Case, Firm & Client Core
 * 2. Document Management & Communication
 * 3. Billing, Payments & Incentives
 * 4. AI Assist, Drafting & Legal Intelligence
 * 5. Tasks, Hearings & Court Timelines
 * 6. Analytics, Reports & Audit
 */

interface LiteModule {
  id: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  status: 'active' | 'ready' | 'development';
  agentTypes: string[];
}

interface FirmProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  barCouncilId?: string;
  jurisdiction: string;
  tier: 'starter' | 'professional' | 'premium';
  createdAt: string;
}

interface Case {
  id: string;
  firmId: string;
  title: string;
  caseNumber?: string;
  caseType: string;
  court?: string;
  status: 'active' | 'pending' | 'closed' | 'archived';
  clientId: string;
  assignedLawyerId: string;
  jurisdiction: string;
  createdAt: string;
  updatedAt: string;
}

interface Document {
  id: string;
  caseId: string;
  name: string;
  type: 'court_order' | 'contract' | 'evidence' | 'correspondence' | 'draft' | 'other';
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  status: 'draft' | 'final' | 'archived';
}

interface Invoice {
  id: string;
  caseId: string;
  firmId: string;
  clientId: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  dueDate: string;
  createdAt: string;
}

interface Task {
  id: string;
  caseId: string;
  title: string;
  description?: string;
  assignedTo: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: string;
}

interface Hearing {
  id: string;
  caseId: string;
  court: string;
  date: string;
  time: string;
  purpose: string;
  status: 'scheduled' | 'completed' | 'adjourned' | 'cancelled';
  notes?: string;
}

interface AuditLog {
  id: string;
  firmId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, any>;
  timestamp: string;
  ipAddress?: string;
}

class NyayasiddhiLiteService {
  private modules: LiteModule[] = [
    {
      id: 'M1',
      name: 'Case, Firm & Client Core',
      category: 'Core Operations',
      description: 'Firm-owned case and client management with RBAC',
      features: [
        'Firm profile management',
        'User management (Lawyer, Junior, Staff)',
        'Case creation and tracking',
        'Client onboarding (invite-only)',
        'Role-based access control (RBAC)',
        'Sensitive data controls',
        'Case-centric architecture',
        'Default-deny security model'
      ],
      status: 'active',
      agentTypes: ['Legal Leadership', 'Compliance']
    },
    {
      id: 'M2',
      name: 'Document Management & Communication',
      category: 'Core Operations',
      description: 'Secure document handling with versioning and communication',
      features: [
        'Document upload pipeline with security',
        'Folder structure per case',
        'Version control and history',
        'In-app lawyer-client messaging',
        'WhatsApp Business alerts',
        'Video consultation support',
        'Sensitive keyword monitoring',
        'Document lifecycle management'
      ],
      status: 'active',
      agentTypes: ['Contract Law', 'E-Discovery']
    },
    {
      id: 'M3',
      name: 'Billing, Payments & Incentives',
      category: 'Financial',
      description: 'Transaction-first billing and payment processing',
      features: [
        'Invoice creation and management',
        'India-first payment flow (UPI, Cards)',
        'Video consultation payments',
        'Court-related payment assist',
        'Tiering and case limits',
        'Revenue policy engine',
        'Ledger and audit trail',
        'Hybrid monetization model'
      ],
      status: 'active',
      agentTypes: ['Banking & Finance']
    },
    {
      id: 'M4',
      name: 'AI Assist, Drafting & Legal Intelligence',
      category: 'AI & Intelligence',
      description: 'Guarded AI assistance with template-led drafting',
      features: [
        'AI Explain (Citizen mode)',
        'AI Assist (Lawyer mode)',
        'AI Draft (Template-led)',
        'Mentor Mode for juniors',
        'AI + Client documents integration',
        'AI credits and cost control',
        'Consent and privacy logging',
        'RAG with legal knowledge'
      ],
      status: 'active',
      agentTypes: ['All 1042 Legal Agents']
    },
    {
      id: 'M5',
      name: 'Tasks, Hearings & Court Timelines',
      category: 'Operations',
      description: 'Court-aware task and hearing management',
      features: [
        'Case timeline (canonical model)',
        'Task creation and assignment',
        'Hearing management (India-first)',
        'Pre-hearing preparation checklists',
        'Post-hearing workflow',
        'Junior supervision model',
        'Citizen visibility rules',
        'AI assist in operations'
      ],
      status: 'active',
      agentTypes: ['Litigation', 'Legal Research']
    },
    {
      id: 'M6',
      name: 'Analytics, Reports & Audit',
      category: 'Analytics',
      description: 'Role-based dashboards with audit-grade logging',
      features: [
        'FirmAdmin dashboard',
        'Lawyer performance dashboard',
        'Junior progress tracking',
        'Standard reports (revenue, efficiency)',
        'Audit log architecture',
        'Data governance and retention',
        'AI-powered analytics',
        'Govt/Institution mode (dark)'
      ],
      status: 'active',
      agentTypes: ['Compliance', 'Analytics']
    }
  ];

  private designPrinciples = [
    { id: 'P1', name: 'Firm Owns Data', description: 'Lawyer/Firm is legal custodian of all data' },
    { id: 'P2', name: 'Default Deny', description: 'Access must be explicitly granted' },
    { id: 'P3', name: 'Case-Centric', description: 'Everything attaches to case_id' },
    { id: 'P4', name: 'Assist, Not Automate', description: 'AI assists, humans decide (especially courts)' },
    { id: 'P5', name: 'Audit-First', description: 'Govt-ready by design' },
    { id: 'P6', name: 'Feature-Flagged', description: 'Full product, staged exposure' }
  ];

  private supportedJurisdictions = ['india', 'uk', 'gcc', 'singapore'];

  getStatus() {
    return {
      name: 'Nyayasiddhi Lite',
      version: '3.1.1',
      status: 'active',
      modules: this.modules.length,
      targetUsers: ['Solo Lawyers', 'Small Legal Firms', 'Senior Advocates'],
      jurisdiction: this.supportedJurisdictions,
      backend: 'Nyayavigya SDK v5.0.0',
      lastUpdated: '2026-01-30'
    };
  }

  getModules() {
    return this.modules;
  }

  getModuleById(moduleId: string) {
    return this.modules.find(m => m.id === moduleId);
  }

  getDesignPrinciples() {
    return this.designPrinciples;
  }

  getDashboard(firmId: string) {
    return {
      firmId,
      modules: this.modules.map(m => ({
        id: m.id,
        name: m.name,
        status: m.status,
        featureCount: m.features.length
      })),
      stats: {
        activeCases: 0,
        pendingTasks: 0,
        upcomingHearings: 0,
        pendingInvoices: 0,
        documentsUploaded: 0,
        aiCreditsRemaining: 1000
      },
      principles: this.designPrinciples.length,
      lastSync: new Date().toISOString()
    };
  }

  async createCase(firmId: string, caseData: Partial<Case>): Promise<Case> {
    const newCase: Case = {
      id: `case_${Date.now()}`,
      firmId,
      title: caseData.title || 'New Case',
      caseType: caseData.caseType || 'civil',
      status: 'active',
      clientId: caseData.clientId || '',
      assignedLawyerId: caseData.assignedLawyerId || '',
      jurisdiction: caseData.jurisdiction || 'india',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return newCase;
  }

  async getCases(firmId: string): Promise<Case[]> {
    return [];
  }

  async uploadDocument(caseId: string, documentData: Partial<Document>): Promise<Document> {
    const newDoc: Document = {
      id: `doc_${Date.now()}`,
      caseId,
      name: documentData.name || 'Untitled Document',
      type: documentData.type || 'other',
      version: 1,
      uploadedBy: documentData.uploadedBy || 'system',
      uploadedAt: new Date().toISOString(),
      status: 'draft'
    };
    return newDoc;
  }

  async createInvoice(firmId: string, invoiceData: Partial<Invoice>): Promise<Invoice> {
    const newInvoice: Invoice = {
      id: `inv_${Date.now()}`,
      caseId: invoiceData.caseId || '',
      firmId,
      clientId: invoiceData.clientId || '',
      amount: invoiceData.amount || 0,
      currency: invoiceData.currency || 'INR',
      status: 'draft',
      dueDate: invoiceData.dueDate || '',
      createdAt: new Date().toISOString()
    };
    return newInvoice;
  }

  async createTask(caseId: string, taskData: Partial<Task>): Promise<Task> {
    const newTask: Task = {
      id: `task_${Date.now()}`,
      caseId,
      title: taskData.title || 'New Task',
      description: taskData.description,
      assignedTo: taskData.assignedTo || '',
      dueDate: taskData.dueDate,
      priority: taskData.priority || 'medium',
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    return newTask;
  }

  async createHearing(caseId: string, hearingData: Partial<Hearing>): Promise<Hearing> {
    const newHearing: Hearing = {
      id: `hearing_${Date.now()}`,
      caseId,
      court: hearingData.court || '',
      date: hearingData.date || '',
      time: hearingData.time || '',
      purpose: hearingData.purpose || '',
      status: 'scheduled',
      notes: hearingData.notes
    };
    return newHearing;
  }

  async logAudit(firmId: string, userId: string, action: string, entityType: string, entityId: string, details: Record<string, any>): Promise<AuditLog> {
    const log: AuditLog = {
      id: `audit_${Date.now()}`,
      firmId,
      userId,
      action,
      entityType,
      entityId,
      details,
      timestamp: new Date().toISOString()
    };
    return log;
  }

  async aiExplain(query: string, context?: string): Promise<{ explanation: string; sources: string[] }> {
    return {
      explanation: `AI explanation for: ${query}`,
      sources: ['Nyayavigya SDK v5.0.0', 'Indian Legal Database']
    };
  }

  async aiAssist(query: string, caseId?: string): Promise<{ response: string; agentUsed: string; cost: number }> {
    return {
      response: `AI assistance for: ${query}`,
      agentUsed: 'Legal Research Agent',
      cost: 0.02
    };
  }

  async aiDraft(templateId: string, data: Record<string, any>): Promise<{ draft: string; template: string; status: string }> {
    return {
      draft: `Draft document generated from template ${templateId}`,
      template: templateId,
      status: 'generated'
    };
  }

  getAnalytics(firmId: string) {
    return {
      firmId,
      period: 'last_30_days',
      metrics: {
        casesCreated: 0,
        casesResolved: 0,
        documentsUploaded: 0,
        invoicesGenerated: 0,
        revenueCollected: 0,
        aiCreditsUsed: 0,
        avgResponseTime: '2.5 days',
        clientSatisfaction: 4.5
      },
      trends: {
        casesTrend: 'stable',
        revenueTrend: 'increasing',
        efficiencyTrend: 'improving'
      }
    };
  }

  getAuditLogs(firmId: string, filters?: { userId?: string; action?: string; startDate?: string; endDate?: string }) {
    return {
      firmId,
      filters,
      logs: [],
      totalCount: 0,
      exportAvailable: true
    };
  }
}

export const nyayasiddhiLiteService = new NyayasiddhiLiteService();
export type { LiteModule, FirmProfile, Case, Document, Invoice, Task, Hearing, AuditLog };
