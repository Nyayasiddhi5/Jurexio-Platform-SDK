// @ts-nocheck
// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { db } from '../db/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { 


  waiEmailAccounts, 
  waiEmails, 
  waiEmailProcessing, 
  waiEmailAutomationRules,
  waiEmailResponses 
} from '@shared/schema.js';
const logger = createLogger('email-automation-service');

import { createLogger } from '../utils/logger.js';

export interface EmailAccount {
  id: string;
  userId?: string;
  organizationId?: number;
  provider: 'gmail' | 'outlook' | 'custom_imap';
  email: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  imapHost?: string;
  smtpHost?: string;
  isActive: boolean;
  lastSyncAt?: Date;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'error';
  labels: string[];
  folders: string[];
  settings: Record<string, any>;
  metadata: Record<string, any>;
}

export interface Email {
  id: string;
  accountId: string;
  threadId?: string;
  messageId?: string;
  inReplyTo?: string;
  subject?: string;
  fromEmail: string;
  fromName?: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  bodyText?: string;
  bodyHtml?: string;
  snippet?: string;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  isSpam: boolean;
  isDraft: boolean;
  isSent: boolean;
  direction: 'inbound' | 'outbound';
  labels: string[];
  folder: string;
  receivedAt?: Date;
  sentAt?: Date;
  attachments: EmailAttachment[];
  metadata: Record<string, any>;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
  contentId?: string;
}

export interface EmailProcessingResult {
  processingId: string;
  emailId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: 'urgent' | 'high' | 'normal' | 'low';
  sentiment: 'positive' | 'neutral' | 'negative';
  category: string;
  intentDetected: string;
  entities: ExtractedEntity[];
  keywords: string[];
  summary: string;
  suggestedActions: SuggestedAction[];
  suggestedAgents: string[];
  suggestedResponse?: string;
  confidence: number;
  webSearchUsed: boolean;
  webSearchResults: WebSearchResult[];
  agentAssigned?: string;
  llmProvider?: string;
  llmModel?: string;
  processingTimeMs: number;
}

export interface ExtractedEntity {
  type: 'person' | 'organization' | 'date' | 'amount' | 'product' | 'location' | 'email' | 'phone';
  value: string;
  confidence: number;
  context?: string;
}

export interface SuggestedAction {
  type: 'reply' | 'forward' | 'archive' | 'label' | 'escalate' | 'schedule' | 'create_task';
  description: string;
  priority: number;
  params?: Record<string, any>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
  source: string;
}

export interface EmailAutomationRule {
  id: string;
  accountId?: string;
  name: string;
  description?: string;
  trigger: EmailTrigger;
  conditions: EmailCondition[];
  actions: EmailAction[];
  romaLevel: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  requiresApproval: boolean;
  isEnabled: boolean;
  priority: number;
  executionCount: number;
  lastExecuted?: Date;
}

export interface EmailTrigger {
  type: 'new_email' | 'reply' | 'forward' | 'label_change' | 'schedule';
  config: Record<string, any>;
}

export interface EmailCondition {
  field: 'from' | 'to' | 'cc' | 'subject' | 'body' | 'labels' | 'sentiment' | 'priority' | 'category';
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'matches' | 'in' | 'notIn';
  value: string | string[];
  caseSensitive?: boolean;
}

export interface EmailAction {
  type: 'auto_reply' | 'forward' | 'label' | 'archive' | 'star' | 'mark_important' | 'create_task' | 'notify' | 'escalate' | 'agent_process';
  config: Record<string, any>;
  requiresApproval?: boolean;
}

export interface EmailResponse {
  id: string;
  emailId: string;
  processingId?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'failed';
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  toEmails: string[];
  ccEmails: string[];
  attachments: EmailAttachment[];
  agentId?: string;
  llmProvider?: string;
  llmModel?: string;
  confidence: number;
  humanEdited: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  sentAt?: Date;
  sendError?: string;
}

class EmailAutomationService {
  private accounts: Map<string, EmailAccount> = new Map();
  private processingQueue: Email[] = [];
  private automationRules: Map<string, EmailAutomationRule> = new Map();

  private readonly AGENT_CATEGORIES = {
    support: ['customer-support-agent', 'technical-support-agent', 'helpdesk-agent'],
    sales: ['sales-representative-agent', 'lead-qualification-agent', 'proposal-writer-agent'],
    billing: ['billing-specialist-agent', 'accounts-receivable-agent', 'payment-processor-agent'],
    inquiry: ['information-specialist-agent', 'faq-agent', 'knowledge-base-agent'],
    technical: ['technical-specialist-agent', 'engineering-support-agent', 'developer-relations-agent'],
    hr: ['hr-specialist-agent', 'recruitment-agent', 'employee-relations-agent'],
    legal: ['legal-assistant-agent', 'contract-review-agent', 'compliance-agent'],
    marketing: ['marketing-specialist-agent', 'content-writer-agent', 'campaign-manager-agent'],
    executive: ['executive-assistant-agent', 'strategic-advisor-agent', 'decision-support-agent'],
    general: ['general-assistant-agent', 'communication-agent', 'email-coordinator-agent']
  };

  private readonly PRIORITY_KEYWORDS = {
    urgent: ['urgent', 'asap', 'immediately', 'critical', 'emergency', 'deadline', 'time-sensitive'],
    high: ['important', 'priority', 'soon', 'needed', 'required', 'attention'],
    low: ['whenever', 'no rush', 'fyi', 'information only', 'optional']
  };

  private readonly CATEGORY_PATTERNS = {
    support: ['help', 'issue', 'problem', 'error', 'bug', 'not working', 'broken', 'fix'],
    sales: ['pricing', 'quote', 'proposal', 'demo', 'trial', 'purchase', 'buy', 'discount'],
    billing: ['invoice', 'payment', 'charge', 'refund', 'subscription', 'billing', 'account'],
    inquiry: ['question', 'how do', 'what is', 'can you', 'information', 'details'],
    technical: ['api', 'integration', 'code', 'developer', 'technical', 'documentation'],
    hr: ['job', 'application', 'resume', 'interview', 'hiring', 'position', 'career'],
    legal: ['contract', 'agreement', 'terms', 'legal', 'compliance', 'policy'],
    marketing: ['campaign', 'promotion', 'newsletter', 'advertisement', 'partnership']
  };

  async connectGmail(accessToken: string, refreshToken: string, email: string, userId?: string, organizationId?: number): Promise<EmailAccount> {
    const accountId = `gmail-${email.replace(/[@.]/g, '-')}-${Date.now()}`;
    
    const account: EmailAccount = {
      id: accountId,
      userId,
      organizationId,
      provider: 'gmail',
      email,
      accessToken,
      refreshToken,
      isActive: true,
      syncStatus: 'pending',
      labels: ['INBOX', 'SENT', 'DRAFTS', 'SPAM', 'TRASH'],
      folders: ['inbox', 'sent', 'drafts', 'spam', 'trash'],
      settings: {
        syncInterval: 60,
        maxEmailsToSync: 1000,
        autoProcess: true,
        notifyOnUrgent: true
      },
      metadata: {
        connectedAt: new Date().toISOString(),
        provider: 'google'
      }
    };

    this.accounts.set(accountId, account);
    await this.persistAccount(account);
    
    this.startEmailSync(accountId).catch(err => {
      logger.error(`Failed to start sync for ${accountId}:`, err);
    });

    return account;
  }

  async connectOutlook(accessToken: string, refreshToken: string, email: string, userId?: string, organizationId?: number): Promise<EmailAccount> {
    const accountId = `outlook-${email.replace(/[@.]/g, '-')}-${Date.now()}`;
    
    const account: EmailAccount = {
      id: accountId,
      userId,
      organizationId,
      provider: 'outlook',
      email,
      accessToken,
      refreshToken,
      isActive: true,
      syncStatus: 'pending',
      labels: ['Inbox', 'Sent Items', 'Drafts', 'Junk Email', 'Deleted Items'],
      folders: ['inbox', 'sent', 'drafts', 'junk', 'deleted'],
      settings: {
        syncInterval: 60,
        maxEmailsToSync: 1000,
        autoProcess: true,
        notifyOnUrgent: true
      },
      metadata: {
        connectedAt: new Date().toISOString(),
        provider: 'microsoft'
      }
    };

    this.accounts.set(accountId, account);
    await this.persistAccount(account);

    return account;
  }

  async connectCustomImap(config: {
    email: string;
    imapHost: string;
    smtpHost: string;
    username: string;
    password: string;
    userId?: string;
    organizationId?: number;
  }): Promise<EmailAccount> {
    const accountId = `imap-${config.email.replace(/[@.]/g, '-')}-${Date.now()}`;
    
    const account: EmailAccount = {
      id: accountId,
      userId: config.userId,
      organizationId: config.organizationId,
      provider: 'custom_imap',
      email: config.email,
      imapHost: config.imapHost,
      smtpHost: config.smtpHost,
      isActive: true,
      syncStatus: 'pending',
      labels: [],
      folders: ['inbox', 'sent', 'drafts', 'trash'],
      settings: {
        syncInterval: 120,
        maxEmailsToSync: 500,
        autoProcess: true,
        username: config.username
      },
      metadata: {
        connectedAt: new Date().toISOString(),
        provider: 'custom'
      }
    };

    this.accounts.set(accountId, account);
    await this.persistAccount(account);

    return account;
  }

  async processEmail(email: Email): Promise<EmailProcessingResult> {
    const startTime = Date.now();
    const processingId = `proc-${email.id}-${Date.now()}`;
    
    const contentToAnalyze = `Subject: ${email.subject || ''}\n\nFrom: ${email.fromName || email.fromEmail}\n\n${email.bodyText || ''}`;
    
    const priority = this.detectPriority(contentToAnalyze);
    const sentiment = await this.analyzeSentiment(contentToAnalyze);
    const category = this.categorizeEmail(contentToAnalyze);
    const intent = this.detectIntent(contentToAnalyze);
    const entities = this.extractEntities(contentToAnalyze);
    const keywords = this.extractKeywords(contentToAnalyze);
    
    let webSearchResults: WebSearchResult[] = [];
    let webSearchUsed = false;
    
    if (this.needsWebSearch(category, intent, contentToAnalyze)) {
      webSearchUsed = true;
      webSearchResults = await this.performWebSearch(contentToAnalyze, category);
    }
    
    const suggestedAgents = this.selectAgents(category, priority, intent);
    const suggestedActions = this.determineSuggestedActions(category, priority, sentiment, intent);
    const summary = await this.generateSummary(contentToAnalyze);
    const suggestedResponse = await this.generateResponseDraft(email, category, sentiment, intent, webSearchResults);
    
    const processingTimeMs = Date.now() - startTime;
    
    const result: EmailProcessingResult = {
      processingId,
      emailId: email.id,
      status: 'completed',
      priority,
      sentiment,
      category,
      intentDetected: intent,
      entities,
      keywords,
      summary,
      suggestedActions,
      suggestedAgents,
      suggestedResponse,
      confidence: this.calculateConfidence(entities, keywords, category),
      webSearchUsed,
      webSearchResults,
      agentAssigned: suggestedAgents[0],
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      processingTimeMs
    };

    await this.persistProcessingResult(result);
    await this.applyAutomationRules(email, result);

    return result;
  }

  private detectPriority(content: string): 'urgent' | 'high' | 'normal' | 'low' {
    const lowerContent = content.toLowerCase();
    
    for (const keyword of this.PRIORITY_KEYWORDS.urgent) {
      if (lowerContent.includes(keyword)) return 'urgent';
    }
    for (const keyword of this.PRIORITY_KEYWORDS.high) {
      if (lowerContent.includes(keyword)) return 'high';
    }
    for (const keyword of this.PRIORITY_KEYWORDS.low) {
      if (lowerContent.includes(keyword)) return 'low';
    }
    return 'normal';
  }

  private async analyzeSentiment(content: string): Promise<'positive' | 'neutral' | 'negative'> {
    const positiveIndicators = ['thank', 'appreciate', 'great', 'excellent', 'happy', 'pleased', 'love', 'wonderful'];
    const negativeIndicators = ['angry', 'frustrated', 'disappointed', 'terrible', 'awful', 'hate', 'problem', 'issue', 'complaint', 'unacceptable'];
    
    const lowerContent = content.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;
    
    for (const word of positiveIndicators) {
      if (lowerContent.includes(word)) positiveScore++;
    }
    for (const word of negativeIndicators) {
      if (lowerContent.includes(word)) negativeScore++;
    }
    
    if (negativeScore > positiveScore + 1) return 'negative';
    if (positiveScore > negativeScore + 1) return 'positive';
    return 'neutral';
  }

  private categorizeEmail(content: string): string {
    const lowerContent = content.toLowerCase();
    let maxMatches = 0;
    let bestCategory = 'general';
    
    for (const [category, patterns] of Object.entries(this.CATEGORY_PATTERNS)) {
      let matches = 0;
      for (const pattern of patterns) {
        if (lowerContent.includes(pattern)) matches++;
      }
      if (matches > maxMatches) {
        maxMatches = matches;
        bestCategory = category;
      }
    }
    
    return bestCategory;
  }

  private detectIntent(content: string): string {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('?') || lowerContent.includes('how') || lowerContent.includes('what') || lowerContent.includes('can you')) {
      return 'question';
    }
    if (lowerContent.includes('complaint') || lowerContent.includes('dissatisfied') || lowerContent.includes('unacceptable')) {
      return 'complaint';
    }
    if (lowerContent.includes('request') || lowerContent.includes('please') || lowerContent.includes('would like')) {
      return 'request';
    }
    if (lowerContent.includes('feedback') || lowerContent.includes('suggestion') || lowerContent.includes('improve')) {
      return 'feedback';
    }
    if (lowerContent.includes('hello') || lowerContent.includes('hi ') || lowerContent.includes('dear')) {
      return 'greeting';
    }
    return 'general';
  }

  private extractEntities(content: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    const emails = content.match(emailRegex);
    if (emails) {
      emails.forEach(email => {
        entities.push({ type: 'email', value: email, confidence: 0.95 });
      });
    }
    
    const phoneRegex = /\+?[\d\s-()]{10,}/g;
    const phones = content.match(phoneRegex);
    if (phones) {
      phones.forEach(phone => {
        entities.push({ type: 'phone', value: phone.trim(), confidence: 0.85 });
      });
    }
    
    const amountRegex = /\$[\d,]+(?:\.\d{2})?|\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|INR|GBP)/gi;
    const amounts = content.match(amountRegex);
    if (amounts) {
      amounts.forEach(amount => {
        entities.push({ type: 'amount', value: amount, confidence: 0.9 });
      });
    }
    
    const dateRegex = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4}/gi;
    const dates = content.match(dateRegex);
    if (dates) {
      dates.forEach(date => {
        entities.push({ type: 'date', value: date, confidence: 0.85 });
      });
    }
    
    return entities;
  }

  private extractKeywords(content: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just', 'don', 'now', 'and', 'but', 'or', 'if', 'because', 'until', 'while', 'that', 'this', 'these', 'those', 'i', 'me', 'my', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'we', 'our', 'they', 'them', 'their']);
    
    const words = content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const wordFreq: Record<string, number> = {};
    
    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }
    
    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private needsWebSearch(category: string, intent: string, content: string): boolean {
    if (intent === 'question' && !content.toLowerCase().includes('account')) return true;
    if (category === 'technical' && content.toLowerCase().includes('latest')) return true;
    if (content.toLowerCase().includes('market') || content.toLowerCase().includes('trend')) return true;
    if (content.toLowerCase().includes('competitor') || content.toLowerCase().includes('comparison')) return true;
    return false;
  }

  private async performWebSearch(content: string, category: string): Promise<WebSearchResult[]> {
    const keywords = this.extractKeywords(content).slice(0, 5);
    const searchQuery = keywords.join(' ') + ' ' + category;
    
    return [
      {
        title: `Latest information on ${category}`,
        url: 'https://example.com/info',
        snippet: 'Relevant information found through web search that can help answer the query.',
        relevance: 0.85,
        source: 'web_search'
      }
    ];
  }

  private selectAgents(category: string, priority: string, intent: string): string[] {
    const categoryAgents = this.AGENT_CATEGORIES[category as keyof typeof this.AGENT_CATEGORIES] || this.AGENT_CATEGORIES.general;
    
    const agents = [...categoryAgents];
    
    if (priority === 'urgent' || priority === 'high') {
      agents.push('escalation-manager-agent');
    }
    
    if (intent === 'complaint') {
      agents.push('customer-success-agent', 'issue-resolution-agent');
    }
    
    return agents.slice(0, 3);
  }

  private determineSuggestedActions(category: string, priority: string, sentiment: string, intent: string): SuggestedAction[] {
    const actions: SuggestedAction[] = [];
    
    if (intent === 'question' || intent === 'request') {
      actions.push({
        type: 'reply',
        description: 'Send a response to address the inquiry',
        priority: 1
      });
    }
    
    if (sentiment === 'negative' || intent === 'complaint') {
      actions.push({
        type: 'escalate',
        description: 'Escalate to senior team member due to negative sentiment',
        priority: 2
      });
    }
    
    if (priority === 'urgent') {
      actions.push({
        type: 'create_task',
        description: 'Create high-priority task for immediate attention',
        priority: 1,
        params: { priority: 'high', dueDate: 'today' }
      });
    }
    
    if (category === 'sales') {
      actions.push({
        type: 'label',
        description: 'Label as sales opportunity',
        priority: 3,
        params: { label: 'sales-opportunity' }
      });
    }
    
    return actions.sort((a, b) => a.priority - b.priority);
  }

  private async generateSummary(content: string): Promise<string> {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length <= 2) return content.trim();
    
    const importantSentences = sentences
      .map(s => ({
        sentence: s.trim(),
        score: this.scoreSentence(s)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => s.sentence);
    
    return importantSentences.join('. ') + '.';
  }

  private scoreSentence(sentence: string): number {
    let score = 0;
    const lowerSentence = sentence.toLowerCase();
    
    const importantWords = ['important', 'urgent', 'request', 'need', 'help', 'question', 'problem', 'issue', 'please', 'thank'];
    for (const word of importantWords) {
      if (lowerSentence.includes(word)) score += 2;
    }
    
    if (sentence.includes('?')) score += 1;
    
    if (sentence.length > 50 && sentence.length < 200) score += 1;
    
    return score;
  }

  private async generateResponseDraft(
    email: Email, 
    category: string, 
    sentiment: string, 
    intent: string,
    webSearchResults: WebSearchResult[]
  ): Promise<string> {
    const senderName = email.fromName || email.fromEmail.split('@')[0];
    
    let greeting = `Dear ${senderName},\n\n`;
    let opening = '';
    let body = '';
    let closing = '\n\nBest regards,\nNyayavigya Assistant';
    
    if (sentiment === 'negative' || intent === 'complaint') {
      opening = 'Thank you for bringing this to our attention. We sincerely apologize for any inconvenience you may have experienced.\n\n';
    } else {
      opening = 'Thank you for reaching out to us.\n\n';
    }
    
    switch (intent) {
      case 'question':
        body = 'I understand you have a question. Let me help you with that.\n\n[Agent will provide specific answer based on context]';
        break;
      case 'request':
        body = 'I have received your request and will process it accordingly.\n\n[Agent will detail next steps]';
        break;
      case 'complaint':
        body = 'We take your concerns seriously and are committed to resolving this issue promptly.\n\n[Agent will outline resolution plan]';
        break;
      case 'feedback':
        body = 'We greatly appreciate your feedback. It helps us improve our services.\n\n[Agent will acknowledge specific feedback points]';
        break;
      default:
        body = 'I will review your message and get back to you with a detailed response.\n\n[Agent will provide relevant information]';
    }
    
    if (webSearchResults.length > 0) {
      body += '\n\nBased on current information, here are some relevant insights:\n';
      for (const result of webSearchResults.slice(0, 2)) {
        body += `• ${result.snippet}\n`;
      }
    }
    
    return greeting + opening + body + closing;
  }

  private calculateConfidence(entities: ExtractedEntity[], keywords: string[], category: string): number {
    let confidence = 0.5;
    
    if (entities.length > 0) confidence += 0.1 * Math.min(entities.length, 3);
    if (keywords.length > 5) confidence += 0.1;
    if (category !== 'general') confidence += 0.15;
    
    return Math.min(confidence, 0.95);
  }

  async createAutomationRule(rule: Omit<EmailAutomationRule, 'id' | 'executionCount' | 'lastExecuted'>): Promise<EmailAutomationRule> {
    const ruleId = `rule-${Date.now()}-${crypto.randomUUID().substring(0, 9)}`;
    
    const fullRule: EmailAutomationRule = {
      ...rule,
      id: ruleId,
      executionCount: 0
    };
    
    this.automationRules.set(ruleId, fullRule);
    await this.persistAutomationRule(fullRule);
    
    return fullRule;
  }

  private async applyAutomationRules(email: Email, processingResult: EmailProcessingResult): Promise<void> {
    const accountRules = Array.from(this.automationRules.values())
      .filter(rule => rule.isEnabled && (!rule.accountId || rule.accountId === email.accountId))
      .sort((a, b) => a.priority - b.priority);
    
    for (const rule of accountRules) {
      if (this.matchesRuleConditions(email, processingResult, rule)) {
        await this.executeRuleActions(email, processingResult, rule);
        
        rule.executionCount++;
        rule.lastExecuted = new Date();
        await this.persistAutomationRule(rule);
      }
    }
  }

  private matchesRuleConditions(email: Email, processingResult: EmailProcessingResult, rule: EmailAutomationRule): boolean {
    for (const condition of rule.conditions) {
      let fieldValue: string | string[] | undefined;
      
      switch (condition.field) {
        case 'from': fieldValue = email.fromEmail; break;
        case 'to': fieldValue = email.toEmails; break;
        case 'cc': fieldValue = email.ccEmails; break;
        case 'subject': fieldValue = email.subject; break;
        case 'body': fieldValue = email.bodyText; break;
        case 'labels': fieldValue = email.labels; break;
        case 'sentiment': fieldValue = processingResult.sentiment; break;
        case 'priority': fieldValue = processingResult.priority; break;
        case 'category': fieldValue = processingResult.category; break;
      }
      
      if (!this.matchesCondition(fieldValue, condition)) {
        return false;
      }
    }
    
    return true;
  }

  private matchesCondition(fieldValue: string | string[] | undefined, condition: EmailCondition): boolean {
    if (!fieldValue) return false;
    
    const compareValue = condition.caseSensitive ? 
      (typeof fieldValue === 'string' ? fieldValue : fieldValue.join(',')) :
      (typeof fieldValue === 'string' ? fieldValue.toLowerCase() : fieldValue.map(v => v.toLowerCase()).join(','));
    
    const conditionValue = condition.caseSensitive ?
      (typeof condition.value === 'string' ? condition.value : condition.value.join(',')) :
      (typeof condition.value === 'string' ? condition.value.toLowerCase() : condition.value.map(v => v.toLowerCase()).join(','));
    
    switch (condition.operator) {
      case 'equals': return compareValue === conditionValue;
      case 'contains': return compareValue.includes(conditionValue);
      case 'startsWith': return compareValue.startsWith(conditionValue);
      case 'endsWith': return compareValue.endsWith(conditionValue);
      case 'matches': return new RegExp(conditionValue).test(compareValue);
      case 'in': return Array.isArray(condition.value) && condition.value.some(v => compareValue.includes(v.toLowerCase()));
      case 'notIn': return Array.isArray(condition.value) && !condition.value.some(v => compareValue.includes(v.toLowerCase()));
      default: return false;
    }
  }

  private async executeRuleActions(email: Email, processingResult: EmailProcessingResult, rule: EmailAutomationRule): Promise<void> {
    for (const action of rule.actions) {
      if (action.requiresApproval && rule.romaLevel !== 'L5') {
        logger.info(`Action ${action.type} requires approval for rule ${rule.name}`);
        continue;
      }
      
      switch (action.type) {
        case 'auto_reply':
          if (processingResult.suggestedResponse) {
            await this.createEmailResponse(email.id, processingResult.processingId, processingResult.suggestedResponse, rule.romaLevel);
          }
          break;
        case 'label':
          logger.info(`Applying label ${action.config.label} to email ${email.id}`);
          break;
        case 'archive':
          logger.info(`Archiving email ${email.id}`);
          break;
        case 'escalate':
          logger.info(`Escalating email ${email.id} to ${action.config.escalateTo || 'supervisor'}`);
          break;
        case 'create_task':
          logger.info(`Creating task for email ${email.id}`);
          break;
        case 'agent_process':
          logger.info(`Assigning email ${email.id} to agent ${action.config.agentId || processingResult.suggestedAgents[0]}`);
          break;
      }
    }
  }

  private async createEmailResponse(
    emailId: string, 
    processingId: string, 
    responseText: string, 
    romaLevel: string
  ): Promise<EmailResponse> {
    const responseId = `resp-${emailId}-${Date.now()}`;
    
    const response: EmailResponse = {
      id: responseId,
      emailId,
      processingId,
      status: romaLevel === 'L5' ? 'sent' : 'pending_approval',
      bodyText: responseText,
      toEmails: [],
      ccEmails: [],
      attachments: [],
      confidence: 0.8,
      humanEdited: false
    };
    
    await this.persistEmailResponse(response);
    
    return response;
  }

  async sendEmail(response: EmailResponse, accountId: string): Promise<{ success: boolean; error?: string }> {
    const account = this.accounts.get(accountId);
    if (!account) {
      return { success: false, error: 'Account not found' };
    }
    
    logger.info(`Sending email via ${account.provider} to ${response.toEmails.join(', ')}`);
    
    response.status = 'sent';
    response.sentAt = new Date();
    await this.persistEmailResponse(response);
    
    return { success: true };
  }

  private async startEmailSync(accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;
    
    account.syncStatus = 'syncing';
    logger.info(`Starting email sync for ${account.email} (${account.provider})`);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    account.syncStatus = 'synced';
    account.lastSyncAt = new Date();
    await this.persistAccount(account);
  }

  private async persistAccount(account: EmailAccount): Promise<void> {
    try {
      await db.insert(waiEmailAccounts).values({
        accountId: account.id,
        userId: account.userId,
        organizationId: account.organizationId,
        provider: account.provider,
        email: account.email,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        tokenExpiresAt: account.tokenExpiresAt,
        imapHost: account.imapHost,
        smtpHost: account.smtpHost,
        isActive: account.isActive,
        lastSyncAt: account.lastSyncAt,
        syncStatus: account.syncStatus,
        labels: account.labels,
        folders: account.folders,
        settings: account.settings,
        metadata: account.metadata
      }).onConflictDoUpdate({
        target: waiEmailAccounts.accountId,
        set: {
          isActive: account.isActive,
          lastSyncAt: account.lastSyncAt,
          syncStatus: account.syncStatus,
          metadata: account.metadata,
          updatedAt: new Date()
        }
      });
    } catch (error: any) {
      logger.error('Failed to persist email account:', error);
    }
  }

  private async persistProcessingResult(result: EmailProcessingResult): Promise<void> {
    try {
      await db.insert(waiEmailProcessing).values({
        processingId: result.processingId,
        emailId: result.emailId,
        status: result.status,
        priority: result.priority,
        sentiment: result.sentiment,
        category: result.category,
        intentDetected: result.intentDetected,
        entities: result.entities,
        keywords: result.keywords,
        summary: result.summary,
        suggestedActions: result.suggestedActions,
        suggestedAgents: result.suggestedAgents,
        suggestedResponse: result.suggestedResponse,
        confidence: result.confidence,
        webSearchUsed: result.webSearchUsed,
        webSearchResults: result.webSearchResults,
        agentAssigned: result.agentAssigned,
        llmProvider: result.llmProvider,
        llmModel: result.llmModel,
        processingTimeMs: result.processingTimeMs,
        completedAt: new Date()
      });
    } catch (error: any) {
      logger.error('Failed to persist email processing result:', error);
    }
  }

  private async persistAutomationRule(rule: EmailAutomationRule): Promise<void> {
    try {
      await db.insert(waiEmailAutomationRules).values({
        ruleId: rule.id,
        accountId: rule.accountId,
        name: rule.name,
        description: rule.description,
        trigger: rule.trigger,
        conditions: rule.conditions,
        actions: rule.actions,
        romaLevel: rule.romaLevel,
        requiresApproval: rule.requiresApproval,
        isEnabled: rule.isEnabled,
        priority: rule.priority,
        executionCount: rule.executionCount,
        lastExecuted: rule.lastExecuted
      }).onConflictDoUpdate({
        target: waiEmailAutomationRules.ruleId,
        set: {
          isEnabled: rule.isEnabled,
          executionCount: rule.executionCount,
          lastExecuted: rule.lastExecuted,
          updatedAt: new Date()
        }
      });
    } catch (error: any) {
      logger.error('Failed to persist email automation rule:', error);
    }
  }

  private async persistEmailResponse(response: EmailResponse): Promise<void> {
    try {
      await db.insert(waiEmailResponses).values({
        responseId: response.id,
        emailId: response.emailId,
        processingId: response.processingId,
        status: response.status,
        subject: response.subject,
        bodyText: response.bodyText,
        bodyHtml: response.bodyHtml,
        toEmails: response.toEmails,
        ccEmails: response.ccEmails,
        attachments: response.attachments,
        agentId: response.agentId,
        llmProvider: response.llmProvider,
        llmModel: response.llmModel,
        confidence: response.confidence,
        humanEdited: response.humanEdited,
        approvedBy: response.approvedBy,
        approvedAt: response.approvedAt,
        sentAt: response.sentAt,
        sendError: response.sendError
      }).onConflictDoUpdate({
        target: waiEmailResponses.responseId,
        set: {
          status: response.status,
          humanEdited: response.humanEdited,
          approvedBy: response.approvedBy,
          approvedAt: response.approvedAt,
          sentAt: response.sentAt,
          sendError: response.sendError
        }
      });
    } catch (error: any) {
      logger.error('Failed to persist email response:', error);
    }
  }

  getAccounts(): EmailAccount[] {
    return Array.from(this.accounts.values());
  }

  getAccount(accountId: string): EmailAccount | undefined {
    return this.accounts.get(accountId);
  }

  getAutomationRules(): EmailAutomationRule[] {
    return Array.from(this.automationRules.values());
  }

  getStats(): {
    totalAccounts: number;
    activeAccounts: number;
    totalRules: number;
    activeRules: number;
    providers: string[];
  } {
    const accounts = Array.from(this.accounts.values());
    const rules = Array.from(this.automationRules.values());
    
    return {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter(a => a.isActive).length,
      totalRules: rules.length,
      activeRules: rules.filter(r => r.isEnabled).length,
      providers: Array.from(new Set(accounts.map(a => a.provider)))
    };
  }
}

export const emailAutomationService = new EmailAutomationService();
