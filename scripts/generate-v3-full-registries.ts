#!/usr/bin/env npx tsx
/**
 * Jurexio Platform 3.1.2 — Full Agent Registry Generator (v3 Superset)
 * Generates 7 registry files: 6 jurisdictions + 1 default (all-jurisdiction)
 * Each agent gets: full 22-section system prompt, tools, hierarchy, costOptimization, 29 practice areas
 * 
 * Output (149 agents each = 148 domain + 1 jurisdiction orchestrator):
 *   config/agent-registries/Jurexio-Legal-registry-IN.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-UK.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-US.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-GC.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-SG.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-EU.json  (149 agents)
 *   config/agent-registries/Jurexio-Legal-registry-Default.json (149 agents, all jurisdictions)
 */

import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: PRACTICE AREAS (29 from v2 + mapped to v3 modules)
// ═══════════════════════════════════════════════════════════════════════════

interface PracticeArea {
  id: number;
  name: string;
  slug: string;
  module: string;
  agentCount: number;
}

const PRACTICE_AREAS: PracticeArea[] = [
  { id: 1, name: 'Legal Leadership', slug: 'legal-leadership', module: 'matter', agentCount: 5 },
  { id: 2, name: 'Contract Law', slug: 'contract-law', module: 'draft', agentCount: 5 },
  { id: 3, name: 'Litigation', slug: 'litigation', module: 'timeline', agentCount: 7 },
  { id: 4, name: 'Legal Research', slug: 'legal-research', module: 'mentor', agentCount: 5 },
  { id: 5, name: 'Compliance', slug: 'compliance', module: 'assurance', agentCount: 6 },
  { id: 6, name: 'E-Discovery', slug: 'e-discovery', module: 'insight', agentCount: 4 },
  { id: 7, name: 'IP & Patents', slug: 'ip-patents', module: 'draft', agentCount: 6 },
  { id: 8, name: 'Corporate & M&A', slug: 'corporate-ma', module: 'matter', agentCount: 6 },
  { id: 9, name: 'Real Estate', slug: 'real-estate', module: 'draft', agentCount: 5 },
  { id: 10, name: 'Family Law', slug: 'family-law', module: 'matter', agentCount: 5 },
  { id: 11, name: 'Criminal Law', slug: 'criminal-law', module: 'timeline', agentCount: 5 },
  { id: 12, name: 'Tax Law', slug: 'tax-law', module: 'ledger', agentCount: 5 },
  { id: 13, name: 'Banking & Finance', slug: 'banking-finance', module: 'matter', agentCount: 5 },
  { id: 14, name: 'Labor & Employment', slug: 'labor-employment', module: 'matter', agentCount: 5 },
  { id: 15, name: 'Environmental Law', slug: 'environmental-law', module: 'assurance', agentCount: 5 },
  { id: 16, name: 'Healthcare Law', slug: 'healthcare-law', module: 'assurance', agentCount: 4 },
  { id: 17, name: 'Immigration Law', slug: 'immigration-law', module: 'matter', agentCount: 5 },
  { id: 18, name: 'Arbitration & ADR', slug: 'arbitration-adr', module: 'timeline', agentCount: 5 },
  { id: 19, name: 'Insurance Law', slug: 'insurance-law', module: 'assurance', agentCount: 4 },
  { id: 20, name: 'Competition/Antitrust', slug: 'competition-antitrust', module: 'assurance', agentCount: 5 },
  { id: 21, name: 'Consumer Protection', slug: 'consumer-protection', module: 'assurance', agentCount: 5 },
  { id: 22, name: 'Cyber & Data Privacy', slug: 'cyber-data-privacy', module: 'assurance', agentCount: 5 },
  { id: 23, name: 'Media & Entertainment', slug: 'media-entertainment', module: 'draft', agentCount: 4 },
  { id: 24, name: 'Maritime & Shipping', slug: 'maritime-shipping', module: 'matter', agentCount: 3 },
  { id: 25, name: 'Telecom & Technology', slug: 'telecom-technology', module: 'matter', agentCount: 4 },
  { id: 26, name: 'Education Law', slug: 'education-law', module: 'assurance', agentCount: 3 },
  { id: 27, name: 'Energy & Power', slug: 'energy-power', module: 'matter', agentCount: 4 },
  { id: 28, name: 'Food & Agriculture', slug: 'food-agriculture', module: 'assurance', agentCount: 3 },
  { id: 29, name: 'Public Interest & Constitutional', slug: 'public-interest-constitutional', module: 'matter', agentCount: 5 },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: AGENT DEFINITIONS (148 domain agents + 1 orchestrator = 149 per jurisdiction)
// ═══════════════════════════════════════════════════════════════════════════

interface AgentDef {
  id: string;
  name: string;
  tier: 'orchestrator' | 'executive' | 'senior' | 'specialist' | 'associate';
  practiceAreaId: number;
  module: string;
  roleDelta: string;
  description: string;
  capabilities: string[];
  tools: string[];
  reportsTo: string[];
  manages: string[];
  collaboratesWith: string[];
  maxCostPerTask: number;
  preferCheaperModels: boolean;
  securityLevel: string;
}

const AGENT_DEFS: AgentDef[] = [
  // PA1: Legal Leadership (2)
  { id: 'chief-legal-officer', name: 'Chief Legal Officer', tier: 'executive', practiceAreaId: 1, module: 'matter', roleDelta: 'strategic-legal-leadership', description: 'Supreme legal authority responsible for organizational legal strategy, risk management, and compliance oversight across all jurisdictions', capabilities: ['legal-leadership', 'strategic-planning', 'risk-management', 'compliance-oversight', 'multi-jurisdictional-coordination', 'policy-direction', 'legal-operations', 'process-optimization', 'escalation-handling', 'calendar-management'], tools: ['legal-research', 'document-generation', 'regulatory-monitoring', 'contract-analysis', 'citation-verification', 'risk-assessment-engine', 'compliance-dashboard'], reportsTo: [], manages: ['general-counsel', 'compliance-lead', 'corporate-specialist', 'legal-ops-agent', 'billing-agent'], collaboratesWith: ['general-counsel', 'compliance-lead'], maxCostPerTask: 2.0, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'general-counsel', name: 'General Counsel', tier: 'executive', practiceAreaId: 1, module: 'matter', roleDelta: 'legal-execution-orchestration', description: 'Senior legal executive providing day-to-day legal leadership and coordinating all practice areas', capabilities: ['legal-leadership', 'practice-area-coordination', 'legal-operations', 'client-advisory', 'matter-management', 'dispute-resolution-strategy', 'cross-practice-coordination', 'escalation-handling', 'stakeholder-management'], tools: ['legal-research', 'document-generation', 'case-law-analysis', 'regulatory-monitoring', 'contract-analysis', 'citation-verification'], reportsTo: ['chief-legal-officer'], manages: ['contract-specialist', 'litigation-specialist', 'tax-specialist', 'ip-specialist'], collaboratesWith: ['chief-legal-officer', 'compliance-lead', 'corporate-specialist'], maxCostPerTask: 2.0, preferCheaperModels: false, securityLevel: 'critical' },

  // PA2: Contract Law (5)
  { id: 'contract-specialist', name: 'Contract Specialist', tier: 'senior', practiceAreaId: 2, module: 'draft', roleDelta: 'contract-analysis', description: 'Lead contract specialist overseeing drafting, review, risk assessment, and lifecycle management', capabilities: ['contract-analysis', 'contract-drafting', 'contract-review', 'risk-assessment', 'clause-library', 'obligation-tracking'], tools: ['contract-analysis', 'document-generation', 'clause-library', 'risk-scoring-engine', 'redline-tool', 'obligation-tracker'], reportsTo: ['general-counsel'], manages: ['contract-drafting', 'contract-review', 'contract-risk'], collaboratesWith: ['corporate-specialist', 'compliance-lead'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'contract-drafting', name: 'Contract Drafter', tier: 'specialist', practiceAreaId: 2, module: 'draft', roleDelta: 'contract-drafting', description: 'Drafts, creates, and templates commercial and legal contracts with jurisdiction-specific clauses', capabilities: ['contract-drafting', 'template-creation', 'clause-insertion', 'jurisdiction-adaptation', 'boilerplate-management'], tools: ['document-generation', 'clause-library', 'template-engine', 'citation-verification'], reportsTo: ['contract-specialist'], manages: [], collaboratesWith: ['contract-review', 'contract-risk'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'contract-review', name: 'Contract Reviewer', tier: 'specialist', practiceAreaId: 2, module: 'draft', roleDelta: 'contract-review', description: 'Reviews contracts for legal risks, unfavorable terms, regulatory compliance, and completeness', capabilities: ['contract-review', 'risk-identification', 'clause-scoring', 'compliance-check', 'redlining'], tools: ['contract-analysis', 'redline-tool', 'risk-scoring-engine', 'compliance-checker'], reportsTo: ['contract-specialist'], manages: [], collaboratesWith: ['contract-drafting', 'compliance-lead'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'contract-negotiation', name: 'Contract Negotiator', tier: 'specialist', practiceAreaId: 2, module: 'draft', roleDelta: 'contract-negotiation', description: 'Assists in contract negotiation by analyzing counterparty positions and suggesting strategic responses', capabilities: ['negotiation-strategy', 'counterparty-analysis', 'clause-comparison', 'position-optimization', 'deal-structuring'], tools: ['contract-analysis', 'document-generation', 'risk-scoring-engine', 'negotiation-playbook'], reportsTo: ['contract-specialist'], manages: [], collaboratesWith: ['contract-review', 'corporate-specialist'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'contract-risk', name: 'Contract Risk Analyst', tier: 'specialist', practiceAreaId: 2, module: 'assurance', roleDelta: 'contract-risk', description: 'Analyzes contractual risk exposure, identifies liability caps, indemnification gaps, and insurance requirements', capabilities: ['contract-risk-analysis', 'liability-assessment', 'indemnification-review', 'insurance-gap-analysis', 'penalty-clause-evaluation'], tools: ['risk-scoring-engine', 'contract-analysis', 'compliance-checker', 'analytics-dashboard'], reportsTo: ['contract-specialist'], manages: [], collaboratesWith: ['risk-agent', 'insurance-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },

  // PA3: Litigation (5)
  { id: 'litigation-specialist', name: 'Litigation Director', tier: 'senior', practiceAreaId: 3, module: 'timeline', roleDelta: 'litigation-management', description: 'Leads litigation strategy, case management, court filings, and trial preparation across all courts', capabilities: ['litigation-strategy', 'case-management', 'trial-preparation', 'court-procedure', 'evidence-analysis', 'settlement-negotiation', 'appellate-strategy', 'discovery-management', 'evidence-preservation', 'grounds-of-appeal'], tools: ['legal-research', 'case-law-analysis', 'court-filing-system', 'evidence-manager', 'timeline-tracker', 'citation-verification'], reportsTo: ['general-counsel'], manages: ['court-filing', 'pleading-draft', 'litigation-research', 'litigation-risk'], collaboratesWith: ['criminal-specialist', 'arbitration-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'court-filing', name: 'Court Filing Specialist', tier: 'specialist', practiceAreaId: 3, module: 'timeline', roleDelta: 'court-filing', description: 'Manages e-filing, court submissions, procedural compliance, and deadline tracking', capabilities: ['court-filing', 'e-filing', 'deadline-tracking', 'procedural-compliance', 'document-formatting'], tools: ['court-filing-system', 'ecourts-api', 'pacer-api', 'document-generation', 'calendar-engine'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['pleading-draft', 'cause-list-parser'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'pleading-draft', name: 'Pleading Drafter', tier: 'specialist', practiceAreaId: 3, module: 'draft', roleDelta: 'pleading-draft', description: 'Drafts plaints, written statements, petitions, motions, and all court pleadings', capabilities: ['pleading-drafting', 'motion-drafting', 'petition-drafting', 'response-drafting', 'affidavit-drafting'], tools: ['document-generation', 'legal-research', 'citation-verification', 'template-engine', 'court-filing-system'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['litigation-research', 'citation-formatter'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'litigation-research', name: 'Litigation Researcher', tier: 'specialist', practiceAreaId: 3, module: 'mentor', roleDelta: 'litigation-research', description: 'Conducts case law research, precedent analysis, and statutory interpretation for litigation matters', capabilities: ['case-law-research', 'precedent-analysis', 'statutory-interpretation', 'argument-construction', 'judgment-analysis'], tools: ['legal-research', 'case-law-analysis', 'citation-verification', 'graphrag-engine'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['legal-research', 'pleading-draft'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'litigation-risk', name: 'Litigation Risk Assessor', tier: 'specialist', practiceAreaId: 3, module: 'assurance', roleDelta: 'litigation-risk', description: 'Assesses case strength, outcome probability, cost-benefit analysis, and settlement recommendations', capabilities: ['case-assessment', 'outcome-prediction', 'cost-benefit-analysis', 'settlement-evaluation', 'risk-scoring'], tools: ['risk-scoring-engine', 'analytics-dashboard', 'case-law-analysis', 'digital-twin-simulator'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'analytics-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },

  // PA4: Legal Research (2)
  { id: 'legal-research', name: 'Legal Research Director', tier: 'specialist', practiceAreaId: 4, module: 'mentor', roleDelta: 'legal-research', description: 'Leads comprehensive legal research across statutes, case law, regulations, and comparative jurisdictions', capabilities: ['legal-research', 'case-law-analysis', 'statutory-interpretation', 'comparative-law', 'regulatory-research', 'memo-drafting', 'precedent-analysis', 'legislative-history', 'cross-jurisdiction-research', 'authority-hierarchy', 'amendment-tracking'], tools: ['legal-research', 'case-law-analysis', 'citation-verification', 'graphrag-engine', 'regulatory-monitoring'], reportsTo: ['general-counsel'], manages: ['citation-formatter', 'mentor-agent'], collaboratesWith: ['litigation-research', 'arbitration-research'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'mentor-agent', name: 'Legal Mentor', tier: 'specialist', practiceAreaId: 4, module: 'mentor', roleDelta: 'legal-guidance', description: 'Provides contextual legal guidance, practice tips, and educational explanations for legal professionals and citizens', capabilities: ['legal-guidance', 'educational-explanation', 'practice-tips', 'procedure-explanation', 'legal-literacy'], tools: ['legal-research', 'case-law-analysis', 'citation-verification', 'document-generation'], reportsTo: ['legal-research'], manages: [], collaboratesWith: ['legal-research', 'translation-agent'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'standard' },

  // PA5: Compliance (6)
  { id: 'compliance-lead', name: 'Compliance Director', tier: 'senior', practiceAreaId: 5, module: 'assurance', roleDelta: 'regulatory-compliance', description: 'Leads regulatory compliance across all applicable frameworks including DPDP, GDPR, SOC 2, and sector-specific regulations', capabilities: ['regulatory-compliance', 'compliance-monitoring', 'policy-development', 'audit-coordination', 'training-oversight', 'regulatory-reporting', 'education-regulation', 'accreditation-compliance', 'institutional-compliance'], tools: ['compliance-checker', 'regulatory-monitoring', 'risk-scoring-engine', 'analytics-dashboard', 'document-generation', 'audit-trail-engine'], reportsTo: ['chief-legal-officer'], manages: ['data-protection-agent', 'regulatory-monitor', 'audit-agent', 'risk-agent'], collaboratesWith: ['chief-legal-officer', 'corporate-governance'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'data-protection-agent', name: 'Data Protection Officer', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'data-protection', description: 'Ensures compliance with DPDP Act 2023, GDPR, UK-GDPR, PDPA, and all data protection frameworks', capabilities: ['data-protection', 'dpia-assessment', 'consent-management', 'breach-notification', 'cross-border-transfer', 'data-mapping'], tools: ['compliance-checker', 'pii-scanner', 'consent-manager', 'breach-notification-system', 'regulatory-monitoring'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['cyber-specialist', 'pii-redaction-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'regulatory-monitor', name: 'Regulatory Monitor', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'regulatory-monitoring', description: 'Tracks regulatory changes, new legislation, circulars, and enforcement actions across all jurisdictions', capabilities: ['regulatory-tracking', 'change-detection', 'impact-assessment', 'compliance-gap-analysis', 'alert-generation'], tools: ['regulatory-monitoring', 'legal-research', 'analytics-dashboard', 'notification-service'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['statutory-researcher', 'compliance-lead'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'audit-agent', name: 'Audit Compliance Specialist', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'audit-verification', description: 'Conducts internal compliance audits, gap assessments, and prepares for external SOC 2 and regulatory audits', capabilities: ['internal-audit', 'gap-assessment', 'soc2-preparation', 'evidence-collection', 'remediation-tracking', 'audit-reporting'], tools: ['audit-trail-engine', 'compliance-checker', 'document-generation', 'analytics-dashboard'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['risk-agent', 'corporate-governance'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'risk-agent', name: 'Risk Assessment Specialist', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'risk-analysis', description: 'Identifies, quantifies, and monitors legal and regulatory risks with risk matrices and mitigation strategies', capabilities: ['risk-identification', 'risk-quantification', 'risk-monitoring', 'mitigation-strategy', 'risk-matrix-generation', 'control-assessment'], tools: ['risk-scoring-engine', 'analytics-dashboard', 'compliance-checker', 'digital-twin-simulator'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['audit-agent', 'litigation-risk'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'aml-specialist', name: 'AML/KYC Specialist', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'anti-money-laundering', description: 'Specializes in anti-money laundering compliance, KYC/KYB due diligence, and sanctions screening', capabilities: ['aml-compliance', 'kyc-verification', 'sanctions-screening', 'suspicious-activity-reporting', 'beneficial-ownership-analysis'], tools: ['compliance-checker', 'pii-scanner', 'risk-scoring-engine', 'regulatory-monitoring'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['banking-specialist', 'fcpa-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },

  // PA6: E-Discovery (1)
  { id: 'cyber-forensics', name: 'Cyber Forensics Specialist', tier: 'specialist', practiceAreaId: 6, module: 'assurance', roleDelta: 'cyber-forensics', description: 'Handles digital forensics, evidence preservation, chain of custody, and forensic analysis for legal proceedings', capabilities: ['digital-forensics', 'evidence-preservation', 'chain-of-custody', 'forensic-analysis', 'incident-reconstruction', 'ediscovery-management', 'tar-workflow', 'document-review', 'privilege-assessment', 'predictive-coding', 'litigation-hold'], tools: ['evidence-manager', 'ediscovery-platform', 'analytics-dashboard', 'document-generation'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['cyber-specialist', 'discovery-manager'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'critical' },

  // PA7: IP & Patents (5)
  { id: 'ip-specialist', name: 'IP Director', tier: 'senior', practiceAreaId: 7, module: 'matter', roleDelta: 'ip-law-leadership', description: 'Leads intellectual property strategy covering patents, trademarks, copyrights, trade secrets, and licensing', capabilities: ['ip-strategy', 'patent-management', 'trademark-management', 'copyright-management', 'trade-secret-protection', 'ip-portfolio-management', 'ip-licensing', 'technology-transfer', 'franchise-agreements', 'royalty-structuring'], tools: ['legal-research', 'document-generation', 'citation-verification', 'ip-search-engine', 'regulatory-monitoring'], reportsTo: ['general-counsel'], manages: ['patent-agent', 'trademark-agent', 'copyright-agent', 'ip-enforcement'], collaboratesWith: ['corporate-specialist', 'media-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'patent-agent', name: 'Patent Specialist', tier: 'specialist', practiceAreaId: 7, module: 'draft', roleDelta: 'patent-prosecution', description: 'Handles patent drafting, prosecution, prior art analysis, freedom-to-operate opinions, and patent portfolio management', capabilities: ['patent-drafting', 'patent-prosecution', 'prior-art-analysis', 'fto-opinions', 'patent-portfolio-analysis'], tools: ['document-generation', 'ip-search-engine', 'legal-research', 'citation-verification'], reportsTo: ['ip-specialist'], manages: [], collaboratesWith: ['trademark-agent', 'ip-enforcement'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'trademark-agent', name: 'Trademark Specialist', tier: 'specialist', practiceAreaId: 7, module: 'draft', roleDelta: 'trademark-registration', description: 'Manages trademark search, registration, opposition, cancellation, and brand protection strategies', capabilities: ['trademark-search', 'trademark-registration', 'opposition-proceedings', 'brand-protection', 'domain-disputes'], tools: ['ip-search-engine', 'document-generation', 'legal-research', 'regulatory-monitoring'], reportsTo: ['ip-specialist'], manages: [], collaboratesWith: ['patent-agent', 'media-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'standard' },
  { id: 'copyright-agent', name: 'Copyright Specialist', tier: 'specialist', practiceAreaId: 7, module: 'assurance', roleDelta: 'copyright-protection', description: 'Handles copyright registration, infringement analysis, fair use/dealing assessment, and licensing', capabilities: ['copyright-registration', 'infringement-analysis', 'fair-use-assessment', 'licensing-negotiation', 'dmca-compliance'], tools: ['legal-research', 'document-generation', 'ip-search-engine', 'citation-verification'], reportsTo: ['ip-specialist'], manages: [], collaboratesWith: ['media-specialist', 'content-licensing'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'ip-enforcement', name: 'IP Enforcement Specialist', tier: 'specialist', practiceAreaId: 7, module: 'timeline', roleDelta: 'ip-enforcement', description: 'Manages IP infringement actions, cease-and-desist, customs recordation, and enforcement litigation', capabilities: ['infringement-action', 'cease-desist', 'customs-enforcement', 'anti-counterfeiting', 'ip-litigation'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'evidence-manager'], reportsTo: ['ip-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'patent-agent'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },

  // PA8: Corporate & M&A (5)
  { id: 'corporate-specialist', name: 'Corporate Director', tier: 'senior', practiceAreaId: 8, module: 'matter', roleDelta: 'corporate-law-leadership', description: 'Leads corporate law practice covering governance, M&A, securities, and entity management', capabilities: ['corporate-governance', 'mergers-acquisitions', 'securities-law', 'entity-management', 'board-advisory', 'capital-markets', 'securities-regulation', 'insider-trading', 'prospectus-review', 'sebi-compliance'], tools: ['legal-research', 'document-generation', 'regulatory-monitoring', 'contract-analysis', 'compliance-checker', 'mca21-api'], reportsTo: ['general-counsel'], manages: ['corporate-governance', 'mergers-acquisitions', 'corporate-compliance', 'corporate-secretarial'], collaboratesWith: ['banking-specialist', 'tax-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'corporate-governance', name: 'Corporate Governance Specialist', tier: 'specialist', practiceAreaId: 8, module: 'assurance', roleDelta: 'corporate-governance', description: 'Ensures corporate governance compliance, board procedures, director duties, and shareholder rights', capabilities: ['governance-compliance', 'board-procedures', 'director-duties', 'shareholder-rights', 'independent-director-compliance', 'csr-compliance'], tools: ['compliance-checker', 'document-generation', 'regulatory-monitoring', 'mca21-api'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['corporate-secretarial', 'audit-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'mergers-acquisitions', name: 'M&A Specialist', tier: 'specialist', practiceAreaId: 8, module: 'draft', roleDelta: 'mergers-acquisitions', description: 'Handles M&A transactions including due diligence, deal structuring, transaction documents, and post-merger integration', capabilities: ['due-diligence', 'deal-structuring', 'transaction-documents', 'post-merger-integration', 'valuation-support', 'regulatory-approval'], tools: ['document-generation', 'contract-analysis', 'regulatory-monitoring', 'risk-scoring-engine', 'compliance-checker'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['tax-specialist', 'banking-specialist', 'competition-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'corporate-compliance', name: 'Corporate Compliance Specialist', tier: 'specialist', practiceAreaId: 8, module: 'assurance', roleDelta: 'corporate-compliance', description: 'Manages corporate regulatory filings, annual compliance, and regulatory reporting obligations', capabilities: ['annual-compliance', 'regulatory-filings', 'reporting-obligations', 'penalty-avoidance', 'filing-calendar'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'mca21-api', 'calendar-engine'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['corporate-governance', 'tax-compliance'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'corporate-secretarial', name: 'Corporate Secretary', tier: 'specialist', practiceAreaId: 8, module: 'timeline', roleDelta: 'corporate-secretarial', description: 'Manages board meetings, minutes, statutory registers, and secretarial compliance', capabilities: ['board-minutes', 'statutory-registers', 'meeting-management', 'resolution-drafting', 'annual-returns'], tools: ['document-generation', 'calendar-engine', 'compliance-checker', 'mca21-api'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['corporate-governance', 'matter-management-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'high' },

  // PA9: Real Estate (5)
  { id: 'realestate-specialist', name: 'Real Estate Director', tier: 'senior', practiceAreaId: 9, module: 'draft', roleDelta: 'real-estate-leadership', description: 'Leads real estate law practice covering property transactions, RERA compliance, and land disputes', capabilities: ['property-transactions', 'rera-compliance', 'land-disputes', 'title-verification', 'development-agreements', 'leasing'], tools: ['legal-research', 'document-generation', 'regulatory-monitoring', 'contract-analysis', 'title-search-engine'], reportsTo: ['general-counsel'], manages: ['property-due-diligence', 'rera-compliance', 'property-drafting', 'realestate-disputes'], collaboratesWith: ['tax-specialist', 'environmental-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'property-due-diligence', name: 'Property Due Diligence Specialist', tier: 'specialist', practiceAreaId: 9, module: 'assurance', roleDelta: 'property-due-diligence', description: 'Conducts title searches, encumbrance checks, and property due diligence across jurisdictions', capabilities: ['title-search', 'encumbrance-check', 'property-valuation-review', 'zoning-compliance', 'environmental-clearance'], tools: ['title-search-engine', 'legal-research', 'regulatory-monitoring', 'document-generation'], reportsTo: ['realestate-specialist'], manages: [], collaboratesWith: ['stamp-duty-calculator', 'env-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'rera-compliance', name: 'RERA Compliance Specialist', tier: 'specialist', practiceAreaId: 9, module: 'assurance', roleDelta: 'rera-compliance', description: 'Ensures RERA compliance for real estate projects, builder obligations, and buyer protection', capabilities: ['rera-registration', 'builder-compliance', 'buyer-protection', 'project-disclosure', 'escrow-monitoring'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'analytics-dashboard'], reportsTo: ['realestate-specialist'], manages: [], collaboratesWith: ['consumer-specialist', 'regulatory-monitor'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'property-drafting', name: 'Property Document Drafter', tier: 'specialist', practiceAreaId: 9, module: 'draft', roleDelta: 'property-drafting', description: 'Drafts sale deeds, lease agreements, development agreements, MoUs, and conveyance documents', capabilities: ['sale-deed-drafting', 'lease-drafting', 'development-agreements', 'conveyance-documents', 'mortgage-documents'], tools: ['document-generation', 'template-engine', 'contract-analysis', 'stamp-duty-calculator'], reportsTo: ['realestate-specialist'], manages: [], collaboratesWith: ['contract-drafting', 'stamp-duty-calculator'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'realestate-disputes', name: 'Real Estate Disputes Specialist', tier: 'specialist', practiceAreaId: 9, module: 'timeline', roleDelta: 'real-estate-disputes', description: 'Handles property disputes, title litigation, landlord-tenant matters, and RERA complaints', capabilities: ['property-litigation', 'title-disputes', 'landlord-tenant', 'rera-complaints', 'possession-recovery'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis'], reportsTo: ['realestate-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'rera-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },

  // PA10: Family Law (5)
  { id: 'family-specialist', name: 'Family Law Director', tier: 'senior', practiceAreaId: 10, module: 'matter', roleDelta: 'family-law-leadership', description: 'Leads family law practice covering matrimonial disputes, custody, succession, and domestic violence', capabilities: ['matrimonial-law', 'custody-disputes', 'succession-planning', 'domestic-violence', 'maintenance-claims', 'mediation'], tools: ['legal-research', 'document-generation', 'case-law-analysis', 'court-filing-system', 'mediation-platform'], reportsTo: ['general-counsel'], manages: ['family-mediation', 'family-divorce', 'child-custody', 'succession-planning'], collaboratesWith: ['criminal-specialist', 'realestate-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'family-mediation', name: 'Family Mediation Specialist', tier: 'specialist', practiceAreaId: 10, module: 'timeline', roleDelta: 'family-mediation', description: 'Facilitates mediation in family disputes, pre-litigation settlement, and collaborative law processes', capabilities: ['mediation-facilitation', 'settlement-negotiation', 'collaborative-law', 'pre-litigation-resolution', 'parenting-plans'], tools: ['mediation-platform', 'document-generation', 'calendar-engine', 'notification-service'], reportsTo: ['family-specialist'], manages: [], collaboratesWith: ['family-divorce', 'child-custody'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'family-divorce', name: 'Divorce Proceedings Specialist', tier: 'specialist', practiceAreaId: 10, module: 'draft', roleDelta: 'divorce-proceedings', description: 'Handles divorce petitions, mutual consent proceedings, contested divorces, and asset division', capabilities: ['divorce-petitions', 'mutual-consent', 'contested-divorce', 'asset-division', 'alimony-calculation', 'maintenance'], tools: ['document-generation', 'court-filing-system', 'legal-research', 'analytics-dashboard'], reportsTo: ['family-specialist'], manages: [], collaboratesWith: ['family-mediation', 'realestate-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'child-custody', name: 'Child Custody Specialist', tier: 'specialist', practiceAreaId: 10, module: 'draft', roleDelta: 'child-custody', description: 'Manages child custody, guardianship, visitation rights, and child welfare proceedings', capabilities: ['custody-petitions', 'guardianship', 'visitation-rights', 'child-welfare', 'hague-convention', 'best-interest-analysis'], tools: ['document-generation', 'legal-research', 'court-filing-system', 'case-law-analysis'], reportsTo: ['family-specialist'], manages: [], collaboratesWith: ['family-mediation', 'immigration-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'succession-planning', name: 'Succession Planning Specialist', tier: 'specialist', practiceAreaId: 10, module: 'draft', roleDelta: 'succession-planning', description: 'Handles wills, trusts, probate, intestate succession, and estate administration', capabilities: ['will-drafting', 'trust-creation', 'probate-proceedings', 'intestate-succession', 'estate-administration', 'inheritance-tax'], tools: ['document-generation', 'legal-research', 'tax-calculator', 'court-filing-system'], reportsTo: ['family-specialist'], manages: [], collaboratesWith: ['tax-specialist', 'realestate-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },

  // PA11: Criminal Law (5)
  { id: 'criminal-specialist', name: 'Criminal Law Director', tier: 'senior', practiceAreaId: 11, module: 'timeline', roleDelta: 'criminal-law-leadership', description: 'Leads criminal law practice covering defense, prosecution advisory, bail, FIR analysis, and appeals', capabilities: ['criminal-defense', 'bail-applications', 'fir-analysis', 'trial-preparation', 'criminal-appeals', 'plea-bargaining'], tools: ['legal-research', 'case-law-analysis', 'court-filing-system', 'document-generation', 'evidence-manager', 'citation-verification'], reportsTo: ['general-counsel'], manages: ['bail-applications', 'criminal-research', 'fir-analysis', 'criminal-appeals'], collaboratesWith: ['litigation-specialist', 'cyber-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'bail-applications', name: 'Bail Applications Specialist', tier: 'specialist', practiceAreaId: 11, module: 'draft', roleDelta: 'bail-applications', description: 'Drafts and argues bail applications, anticipatory bail, and interim bail across all courts', capabilities: ['bail-drafting', 'anticipatory-bail', 'interim-bail', 'bail-conditions', 'surety-assessment'], tools: ['document-generation', 'legal-research', 'court-filing-system', 'case-law-analysis'], reportsTo: ['criminal-specialist'], manages: [], collaboratesWith: ['criminal-research', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'criminal-research', name: 'Criminal Research Specialist', tier: 'specialist', practiceAreaId: 11, module: 'mentor', roleDelta: 'criminal-research', description: 'Researches criminal precedents, sentencing guidelines, statutory defenses, and procedural law', capabilities: ['criminal-precedent-research', 'sentencing-analysis', 'defense-strategy', 'statutory-defenses', 'procedural-law'], tools: ['legal-research', 'case-law-analysis', 'citation-verification', 'graphrag-engine'], reportsTo: ['criminal-specialist'], manages: [], collaboratesWith: ['bail-applications', 'litigation-research'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'fir-analysis', name: 'FIR Analysis Specialist', tier: 'specialist', practiceAreaId: 11, module: 'assurance', roleDelta: 'fir-analysis', description: 'Analyzes FIRs, charge sheets, identifies applicable sections, and assesses case strength', capabilities: ['fir-analysis', 'charge-sheet-review', 'section-identification', 'case-strength-assessment', 'quashing-potential'], tools: ['legal-research', 'analytics-dashboard', 'case-law-analysis', 'document-generation'], reportsTo: ['criminal-specialist'], manages: [], collaboratesWith: ['criminal-research', 'bail-applications'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'criminal-appeals', name: 'Criminal Appeals Specialist', tier: 'specialist', practiceAreaId: 11, module: 'draft', roleDelta: 'criminal-appeals', description: 'Handles criminal appeals, revision petitions, SLPs, and post-conviction remedies', capabilities: ['criminal-appeals', 'revision-petitions', 'special-leave-petitions', 'post-conviction-remedies', 'sentence-review'], tools: ['document-generation', 'legal-research', 'court-filing-system', 'case-law-analysis', 'citation-verification'], reportsTo: ['criminal-specialist'], manages: [], collaboratesWith: ['appeals-specialist', 'criminal-research'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },

  // PA12: Tax Law (5)
  { id: 'tax-specialist', name: 'Tax Law Director', tier: 'senior', practiceAreaId: 12, module: 'ledger', roleDelta: 'tax-law-leadership', description: 'Leads tax law practice covering direct tax, indirect tax, transfer pricing, and international taxation', capabilities: ['tax-advisory', 'tax-planning', 'tax-compliance', 'transfer-pricing', 'international-taxation', 'tax-litigation'], tools: ['legal-research', 'tax-calculator', 'regulatory-monitoring', 'document-generation', 'compliance-checker', 'analytics-dashboard'], reportsTo: ['general-counsel'], manages: ['gst-agent', 'income-tax-agent', 'transfer-pricing-agent', 'tax-compliance'], collaboratesWith: ['corporate-specialist', 'banking-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'gst-agent', name: 'GST Specialist', tier: 'specialist', practiceAreaId: 12, module: 'assurance', roleDelta: 'gst-compliance', description: 'Handles GST registration, return filing, input tax credit, reverse charge, and GST litigation', capabilities: ['gst-compliance', 'return-filing', 'input-tax-credit', 'reverse-charge', 'gst-audit', 'advance-ruling'], tools: ['tax-calculator', 'compliance-checker', 'regulatory-monitoring', 'document-generation'], reportsTo: ['tax-specialist'], manages: [], collaboratesWith: ['income-tax-agent', 'customs-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'income-tax-agent', name: 'Income Tax Specialist', tier: 'specialist', practiceAreaId: 12, module: 'assurance', roleDelta: 'income-tax-compliance', description: 'Manages income tax compliance, assessment, scrutiny, appeals, and advance tax planning', capabilities: ['income-tax-compliance', 'assessment-proceedings', 'tax-appeals', 'advance-tax', 'tds-compliance', 'tax-planning'], tools: ['tax-calculator', 'compliance-checker', 'legal-research', 'document-generation'], reportsTo: ['tax-specialist'], manages: [], collaboratesWith: ['gst-agent', 'transfer-pricing-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'transfer-pricing-agent', name: 'Transfer Pricing Specialist', tier: 'specialist', practiceAreaId: 12, module: 'assurance', roleDelta: 'transfer-pricing', description: 'Handles transfer pricing documentation, benchmarking, APA, and international tax treaty interpretation', capabilities: ['transfer-pricing-documentation', 'benchmarking', 'advance-pricing-agreements', 'treaty-interpretation', 'beps-compliance'], tools: ['tax-calculator', 'analytics-dashboard', 'legal-research', 'document-generation'], reportsTo: ['tax-specialist'], manages: [], collaboratesWith: ['cross-border-transactions', 'income-tax-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'tax-compliance', name: 'Tax Compliance Manager', tier: 'specialist', practiceAreaId: 12, module: 'assurance', roleDelta: 'tax-compliance', description: 'Ensures timely compliance with all tax filing deadlines, TDS obligations, and tax audit requirements', capabilities: ['tax-filing', 'tds-compliance', 'tax-audit', 'deadline-management', 'penalty-avoidance'], tools: ['compliance-checker', 'tax-calculator', 'calendar-engine', 'regulatory-monitoring'], reportsTo: ['tax-specialist'], manages: [], collaboratesWith: ['gst-agent', 'income-tax-agent', 'billing-agent'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'standard' },

  // PA13: Banking & Finance (5)
  { id: 'banking-specialist', name: 'Banking & Finance Director', tier: 'senior', practiceAreaId: 13, module: 'matter', roleDelta: 'banking-finance-leadership', description: 'Leads banking and finance practice covering loan documentation, regulatory compliance, fintech, and debt restructuring', capabilities: ['banking-advisory', 'loan-documentation', 'regulatory-compliance', 'fintech-advisory', 'debt-restructuring', 'capital-markets'], tools: ['legal-research', 'document-generation', 'regulatory-monitoring', 'contract-analysis', 'compliance-checker'], reportsTo: ['general-counsel'], manages: ['loan-documentation', 'regulatory-banking', 'fintech-compliance', 'debt-restructuring'], collaboratesWith: ['corporate-specialist', 'insolvency-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'loan-documentation', name: 'Loan Documentation Specialist', tier: 'specialist', practiceAreaId: 13, module: 'draft', roleDelta: 'loan-documentation', description: 'Drafts and reviews loan agreements, facility agreements, security documents, and syndicated lending documents', capabilities: ['loan-agreement-drafting', 'security-documents', 'facility-agreements', 'syndicated-lending', 'project-finance'], tools: ['document-generation', 'contract-analysis', 'template-engine', 'risk-scoring-engine'], reportsTo: ['banking-specialist'], manages: [], collaboratesWith: ['contract-specialist', 'property-drafting'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'regulatory-banking', name: 'Banking Regulatory Specialist', tier: 'specialist', practiceAreaId: 13, module: 'assurance', roleDelta: 'regulatory-banking', description: 'Ensures compliance with RBI, FCA, OCC regulations, banking licenses, and prudential norms', capabilities: ['banking-regulation', 'rbi-compliance', 'prudential-norms', 'licensing', 'capital-adequacy', 'reporting-obligations'], tools: ['regulatory-monitoring', 'compliance-checker', 'legal-research', 'document-generation'], reportsTo: ['banking-specialist'], manages: [], collaboratesWith: ['compliance-lead', 'securities-counsel'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'fintech-compliance', name: 'Fintech Compliance Specialist', tier: 'specialist', practiceAreaId: 13, module: 'assurance', roleDelta: 'fintech-compliance', description: 'Advises on fintech regulatory compliance, payment systems, digital lending, cryptocurrency, and sandbox regulations', capabilities: ['fintech-regulation', 'payment-systems', 'digital-lending', 'cryptocurrency-law', 'regulatory-sandbox', 'open-banking'], tools: ['regulatory-monitoring', 'compliance-checker', 'legal-research', 'analytics-dashboard'], reportsTo: ['banking-specialist'], manages: [], collaboratesWith: ['cyber-specialist', 'data-protection-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'debt-restructuring', name: 'Debt Restructuring Specialist', tier: 'specialist', practiceAreaId: 13, module: 'timeline', roleDelta: 'debt-restructuring', description: 'Handles debt restructuring, OTS schemes, CDR, JLF, and resolution framework compliance', capabilities: ['debt-restructuring', 'one-time-settlement', 'resolution-framework', 'stressed-asset-management', 'creditor-negotiations'], tools: ['legal-research', 'document-generation', 'analytics-dashboard', 'risk-scoring-engine'], reportsTo: ['banking-specialist'], manages: [], collaboratesWith: ['insolvency-specialist', 'corporate-specialist'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },

  // PA14: Labor & Employment (5)
  { id: 'labour-specialist', name: 'Labor & Employment Director', tier: 'senior', practiceAreaId: 14, module: 'matter', roleDelta: 'labour-law-leadership', description: 'Leads labor and employment practice covering employment contracts, industrial disputes, POSH, and compliance with labor codes', capabilities: ['employment-law', 'industrial-relations', 'posh-compliance', 'labor-compliance', 'termination-management', 'wage-and-hour'], tools: ['legal-research', 'document-generation', 'compliance-checker', 'regulatory-monitoring', 'contract-analysis'], reportsTo: ['general-counsel'], manages: ['employment-contracts', 'industrial-disputes', 'posh-compliance', 'labour-compliance'], collaboratesWith: ['compliance-lead', 'immigration-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'employment-contracts', name: 'Employment Contracts Specialist', tier: 'specialist', practiceAreaId: 14, module: 'draft', roleDelta: 'employment-contracts', description: 'Drafts and reviews employment agreements, offer letters, non-compete clauses, and severance packages', capabilities: ['employment-agreement-drafting', 'non-compete-clauses', 'severance-packages', 'employee-handbook', 'stock-option-plans'], tools: ['document-generation', 'contract-analysis', 'template-engine', 'compliance-checker'], reportsTo: ['labour-specialist'], manages: [], collaboratesWith: ['contract-specialist', 'tax-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'industrial-disputes', name: 'Industrial Disputes Specialist', tier: 'specialist', practiceAreaId: 14, module: 'timeline', roleDelta: 'industrial-disputes', description: 'Handles industrial disputes, strikes, lockouts, retrenchment, and labor court proceedings', capabilities: ['industrial-disputes', 'conciliation', 'adjudication', 'retrenchment', 'closure-management', 'trade-union-matters'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis'], reportsTo: ['labour-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'arbitration-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'posh-compliance', name: 'POSH Compliance Specialist', tier: 'specialist', practiceAreaId: 14, module: 'assurance', roleDelta: 'posh-compliance', description: 'Ensures compliance with Sexual Harassment of Women at Workplace Act (POSH), ICC constitution, and inquiry procedures', capabilities: ['posh-compliance', 'icc-constitution', 'inquiry-procedures', 'awareness-training', 'policy-drafting', 'annual-reporting'], tools: ['compliance-checker', 'document-generation', 'legal-research', 'notification-service'], reportsTo: ['labour-specialist'], manages: [], collaboratesWith: ['data-protection-agent', 'compliance-lead'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'critical' },
  { id: 'labour-compliance', name: 'Labor Compliance Manager', tier: 'specialist', practiceAreaId: 14, module: 'assurance', roleDelta: 'labour-compliance', description: 'Ensures compliance with 4 Labor Codes, minimum wages, PF/ESI, factory inspections, and contractor management', capabilities: ['labor-code-compliance', 'minimum-wages', 'pf-esi', 'factory-inspection', 'contractor-management', 'statutory-returns'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'calendar-engine'], reportsTo: ['labour-specialist'], manages: [], collaboratesWith: ['tax-compliance', 'regulatory-monitor'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'standard' },

  // PA15: Environmental Law (5)
  { id: 'env-specialist', name: 'Environmental Law Director', tier: 'senior', practiceAreaId: 15, module: 'assurance', roleDelta: 'environmental-law-leadership', description: 'Leads environmental law practice covering EIA, pollution control, green tribunals, and ESG compliance', capabilities: ['environmental-law', 'eia-clearance', 'pollution-control', 'green-tribunal', 'esg-compliance', 'climate-law'], tools: ['legal-research', 'regulatory-monitoring', 'compliance-checker', 'document-generation', 'analytics-dashboard'], reportsTo: ['general-counsel'], manages: ['env-compliance', 'esg-agent', 'climate-law', 'env-litigation'], collaboratesWith: ['realestate-specialist', 'energy-director'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'env-compliance', name: 'Environmental Compliance Specialist', tier: 'specialist', practiceAreaId: 15, module: 'assurance', roleDelta: 'environmental-compliance', description: 'Manages environmental permits, consent to operate, pollution monitoring, and regulatory submissions', capabilities: ['environmental-permits', 'consent-management', 'pollution-monitoring', 'hazardous-waste', 'emission-compliance'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'analytics-dashboard'], reportsTo: ['env-specialist'], manages: [], collaboratesWith: ['regulatory-monitor', 'esg-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'esg-agent', name: 'ESG Compliance Specialist', tier: 'specialist', practiceAreaId: 15, module: 'assurance', roleDelta: 'esg-compliance', description: 'Advises on ESG reporting, sustainability frameworks, carbon footprint, and social impact assessment', capabilities: ['esg-reporting', 'sustainability-frameworks', 'carbon-accounting', 'social-impact', 'brsr-compliance', 'green-bonds'], tools: ['analytics-dashboard', 'regulatory-monitoring', 'document-generation', 'compliance-checker'], reportsTo: ['env-specialist'], manages: [], collaboratesWith: ['corporate-governance', 'audit-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'climate-law', name: 'Climate Law Researcher', tier: 'specialist', practiceAreaId: 15, module: 'mentor', roleDelta: 'climate-law-research', description: 'Researches climate law, Paris Agreement obligations, carbon credits, and green litigation trends', capabilities: ['climate-law-research', 'paris-agreement', 'carbon-credits', 'green-litigation', 'renewable-energy-law'], tools: ['legal-research', 'regulatory-monitoring', 'case-law-analysis', 'citation-verification'], reportsTo: ['env-specialist'], manages: [], collaboratesWith: ['energy-director', 'legal-research'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'env-litigation', name: 'Environmental Litigation Specialist', tier: 'specialist', practiceAreaId: 15, module: 'timeline', roleDelta: 'environmental-litigation', description: 'Handles NGT proceedings, pollution compensation claims, and environmental enforcement actions', capabilities: ['ngt-proceedings', 'pollution-claims', 'enforcement-actions', 'environmental-penalties', 'remediation-orders'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis'], reportsTo: ['env-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'env-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },

  // PA16: Healthcare Law (4)
  { id: 'healthcare-specialist', name: 'Healthcare Law Director', tier: 'senior', practiceAreaId: 16, module: 'assurance', roleDelta: 'healthcare-law-leadership', description: 'Leads healthcare law practice covering clinical trials, pharmaceutical regulation, medical negligence, and HIPAA/data compliance', capabilities: ['healthcare-regulation', 'clinical-trials', 'pharmaceutical-law', 'medical-negligence', 'health-data-privacy', 'telemedicine'], tools: ['legal-research', 'regulatory-monitoring', 'compliance-checker', 'document-generation', 'case-law-analysis'], reportsTo: ['general-counsel'], manages: ['clinical-trials-agent', 'pharma-compliance', 'medical-negligence'], collaboratesWith: ['data-protection-agent', 'compliance-lead'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'clinical-trials-agent', name: 'Clinical Trials Compliance Specialist', tier: 'specialist', practiceAreaId: 16, module: 'assurance', roleDelta: 'clinical-trials-compliance', description: 'Ensures clinical trial regulatory compliance, ethics committee approvals, and drug trial documentation', capabilities: ['clinical-trial-regulation', 'ethics-committee', 'drug-approval', 'trial-documentation', 'adverse-event-reporting'], tools: ['regulatory-monitoring', 'compliance-checker', 'document-generation', 'legal-research'], reportsTo: ['healthcare-specialist'], manages: [], collaboratesWith: ['pharma-compliance', 'data-protection-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'pharma-compliance', name: 'Pharmaceutical Regulatory Specialist', tier: 'specialist', practiceAreaId: 16, module: 'assurance', roleDelta: 'pharmaceutical-regulatory', description: 'Handles drug approvals, drug pricing, patent linkage, compulsory licensing, and pharmaceutical advertising', capabilities: ['drug-approval', 'drug-pricing', 'patent-linkage', 'compulsory-licensing', 'pharma-advertising', 'fdca-compliance'], tools: ['regulatory-monitoring', 'compliance-checker', 'legal-research', 'document-generation'], reportsTo: ['healthcare-specialist'], manages: [], collaboratesWith: ['ip-specialist', 'competition-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'medical-negligence', name: 'Medical Negligence Specialist', tier: 'specialist', practiceAreaId: 16, module: 'timeline', roleDelta: 'medical-negligence', description: 'Handles medical malpractice claims, hospital liability, informed consent, and consumer forum proceedings', capabilities: ['medical-malpractice', 'hospital-liability', 'informed-consent', 'consumer-forum', 'expert-evidence', 'compensation-assessment'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis', 'evidence-manager'], reportsTo: ['healthcare-specialist'], manages: [], collaboratesWith: ['consumer-specialist', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },

  // PA17: Immigration Law (5)
  { id: 'immigration-specialist', name: 'Immigration Law Director', tier: 'senior', practiceAreaId: 17, module: 'matter', roleDelta: 'immigration-law-leadership', description: 'Leads immigration practice covering visa processing, work permits, citizenship, and deportation defense', capabilities: ['immigration-advisory', 'visa-processing', 'work-permits', 'citizenship', 'deportation-defense', 'refugee-law'], tools: ['legal-research', 'document-generation', 'regulatory-monitoring', 'case-law-analysis', 'calendar-engine'], reportsTo: ['general-counsel'], manages: ['visa-applications', 'work-permits', 'immigration-compliance', 'refugee-asylum'], collaboratesWith: ['labour-specialist', 'criminal-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'visa-applications', name: 'Visa Application Specialist', tier: 'specialist', practiceAreaId: 17, module: 'draft', roleDelta: 'visa-applications', description: 'Processes visa applications, documentation requirements, and embassy/consulate procedures', capabilities: ['visa-application', 'documentation', 'embassy-procedures', 'visa-categories', 'travel-advisory'], tools: ['document-generation', 'regulatory-monitoring', 'template-engine', 'calendar-engine'], reportsTo: ['immigration-specialist'], manages: [], collaboratesWith: ['work-permits', 'employment-contracts'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'work-permits', name: 'Work Permit Specialist', tier: 'specialist', practiceAreaId: 17, module: 'timeline', roleDelta: 'work-permits', description: 'Manages work permit applications, extensions, employer sponsorship, and labor market testing', capabilities: ['work-permit-processing', 'employer-sponsorship', 'labor-market-test', 'permit-extensions', 'compliance-monitoring'], tools: ['document-generation', 'regulatory-monitoring', 'calendar-engine', 'compliance-checker'], reportsTo: ['immigration-specialist'], manages: [], collaboratesWith: ['visa-applications', 'labour-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'immigration-compliance', name: 'Immigration Compliance Specialist', tier: 'specialist', practiceAreaId: 17, module: 'assurance', roleDelta: 'immigration-compliance', description: 'Ensures employer immigration compliance, I-9/right-to-work verification, and audit readiness', capabilities: ['employer-compliance', 'right-to-work', 'audit-readiness', 'penalty-avoidance', 'policy-development'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'analytics-dashboard'], reportsTo: ['immigration-specialist'], manages: [], collaboratesWith: ['labour-compliance', 'audit-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'refugee-asylum', name: 'Refugee & Asylum Specialist', tier: 'specialist', practiceAreaId: 17, module: 'draft', roleDelta: 'refugee-asylum', description: 'Handles refugee status determination, asylum claims, humanitarian protection, and statelessness', capabilities: ['asylum-claims', 'refugee-status', 'humanitarian-protection', 'non-refoulement', 'statelessness', 'unhcr-procedures'], tools: ['legal-research', 'document-generation', 'case-law-analysis', 'court-filing-system'], reportsTo: ['immigration-specialist'], manages: [], collaboratesWith: ['constitutional-specialist', 'child-custody'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },

  // PA18: Arbitration & ADR (5)
  { id: 'arbitration-specialist', name: 'Arbitration Director', tier: 'senior', practiceAreaId: 18, module: 'timeline', roleDelta: 'arbitration-leadership', description: 'Leads arbitration and ADR practice covering domestic/international arbitration, mediation, and conciliation', capabilities: ['arbitration-strategy', 'institutional-arbitration', 'ad-hoc-arbitration', 'mediation', 'conciliation', 'enforcement'], tools: ['legal-research', 'document-generation', 'case-law-analysis', 'court-filing-system', 'calendar-engine', 'mediation-platform'], reportsTo: ['general-counsel'], manages: ['arbitration-proceedings', 'arbitration-drafting', 'arbitration-research', 'arbitration-enforcement'], collaboratesWith: ['litigation-specialist', 'cross-border-transactions'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'arbitration-proceedings', name: 'Arbitration Proceedings Specialist', tier: 'specialist', practiceAreaId: 18, module: 'timeline', roleDelta: 'arbitration-proceedings', description: 'Manages arbitral proceedings, procedural orders, evidence hearings, and arbitral tribunal interactions', capabilities: ['procedural-management', 'evidence-hearings', 'witness-examination', 'procedural-orders', 'timeline-management'], tools: ['calendar-engine', 'document-generation', 'evidence-manager', 'court-filing-system'], reportsTo: ['arbitration-specialist'], manages: [], collaboratesWith: ['arbitration-drafting', 'discovery-manager'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'arbitration-drafting', name: 'Arbitration Drafting Specialist', tier: 'specialist', practiceAreaId: 18, module: 'draft', roleDelta: 'arbitration-drafting', description: 'Drafts arbitration agreements, statements of claim/defense, submissions, and arbitral award challenges', capabilities: ['arbitration-clause-drafting', 'statement-of-claim', 'statement-of-defense', 'submission-drafting', 'award-challenge'], tools: ['document-generation', 'contract-analysis', 'legal-research', 'citation-verification'], reportsTo: ['arbitration-specialist'], manages: [], collaboratesWith: ['contract-drafting', 'arbitration-proceedings'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'arbitration-research', name: 'Arbitration Research Specialist', tier: 'specialist', practiceAreaId: 18, module: 'mentor', roleDelta: 'arbitration-research', description: 'Researches arbitration law, UNCITRAL Model Law, institutional rules (ICC, LCIA, SIAC, HKIAC)', capabilities: ['arbitration-law-research', 'model-law-analysis', 'institutional-rules', 'comparative-arbitration', 'investor-state-arbitration'], tools: ['legal-research', 'case-law-analysis', 'citation-verification', 'graphrag-engine'], reportsTo: ['arbitration-specialist'], manages: [], collaboratesWith: ['legal-research', 'legal-research'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'standard' },
  { id: 'arbitration-enforcement', name: 'Arbitration Enforcement Specialist', tier: 'specialist', practiceAreaId: 18, module: 'timeline', roleDelta: 'arbitration-enforcement', description: 'Handles enforcement of domestic/foreign arbitral awards, execution proceedings, and setting-aside challenges', capabilities: ['award-enforcement', 'new-york-convention', 'setting-aside', 'execution-proceedings', 'foreign-award-recognition'], tools: ['court-filing-system', 'legal-research', 'document-generation', 'case-law-analysis'], reportsTo: ['arbitration-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'cross-border-transactions'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },

  // PA19: Insurance Law (0 — folded into other PAs)

  // PA20: Competition/Antitrust (5)
  { id: 'competition-specialist', name: 'Competition Law Director', tier: 'senior', practiceAreaId: 20, module: 'assurance', roleDelta: 'competition-law-leadership', description: 'Leads competition and antitrust practice covering merger control, anti-competitive agreements, and abuse of dominance', capabilities: ['competition-law', 'merger-control', 'anti-competitive-agreements', 'abuse-of-dominance', 'cartel-investigations', 'dawn-raids'], tools: ['legal-research', 'regulatory-monitoring', 'compliance-checker', 'document-generation', 'analytics-dashboard'], reportsTo: ['general-counsel'], manages: ['cci-compliance', 'eu-competition', 'merger-clearance', 'price-fixing-agent'], collaboratesWith: ['corporate-specialist', 'mergers-acquisitions'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'cci-compliance', name: 'CCI Competition Specialist', tier: 'specialist', practiceAreaId: 20, module: 'assurance', roleDelta: 'cci-competition-india', description: 'Handles Competition Commission of India filings, merger notifications, and dawn raid preparedness', capabilities: ['cci-filings', 'merger-notification', 'dawn-raid-preparedness', 'penalty-assessment', 'leniency-applications'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'legal-research'], reportsTo: ['competition-specialist'], manages: [], collaboratesWith: ['merger-clearance', 'corporate-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'eu-competition', name: 'EU Competition Specialist', tier: 'specialist', practiceAreaId: 20, module: 'assurance', roleDelta: 'eu-competition-antitrust', description: 'Specializes in EU competition law (Articles 101/102 TFEU), DMA, and European merger control', capabilities: ['eu-competition-law', 'article-101-102', 'dma-compliance', 'eu-merger-control', 'state-aid', 'dg-competition'], tools: ['legal-research', 'regulatory-monitoring', 'compliance-checker', 'case-law-analysis'], reportsTo: ['competition-specialist'], manages: [], collaboratesWith: ['cci-compliance', 'legal-research'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'merger-clearance', name: 'Merger Clearance Specialist', tier: 'specialist', practiceAreaId: 20, module: 'timeline', roleDelta: 'merger-clearance', description: 'Manages competition merger control filings, remedies negotiation, and multi-jurisdictional merger notifications', capabilities: ['merger-filings', 'phase-1-2-assessment', 'remedies-negotiation', 'multi-jurisdictional-filings', 'gun-jumping-prevention'], tools: ['regulatory-monitoring', 'document-generation', 'compliance-checker', 'calendar-engine'], reportsTo: ['competition-specialist'], manages: [], collaboratesWith: ['mergers-acquisitions', 'cci-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'price-fixing-agent', name: 'Cartel & Price Fixing Specialist', tier: 'specialist', practiceAreaId: 20, module: 'assurance', roleDelta: 'price-fixing-cartel', description: 'Investigates and advises on cartel behavior, price fixing, bid rigging, and leniency programs', capabilities: ['cartel-investigation', 'price-fixing-analysis', 'bid-rigging-detection', 'leniency-program', 'whistleblower-protection'], tools: ['analytics-dashboard', 'legal-research', 'compliance-checker', 'evidence-manager'], reportsTo: ['competition-specialist'], manages: [], collaboratesWith: ['aml-specialist', 'criminal-specialist'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'critical' },

  // PA21: Consumer Protection (5)
  { id: 'consumer-specialist', name: 'Consumer Protection Director', tier: 'senior', practiceAreaId: 21, module: 'matter', roleDelta: 'consumer-law-leadership', description: 'Leads consumer protection practice covering unfair trade practices, product liability, class actions, and consumer forums', capabilities: ['consumer-protection', 'unfair-trade-practices', 'product-liability', 'class-actions', 'consumer-forums', 'e-commerce-regulation', 'food-safety-regulation', 'fssai-compliance', 'agricultural-law', 'contract-farming'], tools: ['legal-research', 'document-generation', 'court-filing-system', 'compliance-checker', 'case-law-analysis'], reportsTo: ['general-counsel'], manages: ['consumer-disputes', 'product-liability', 'class-action', 'unfair-trade-agent'], collaboratesWith: ['healthcare-specialist', 'realestate-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'consumer-disputes', name: 'Consumer Dispute Resolution Specialist', tier: 'specialist', practiceAreaId: 21, module: 'timeline', roleDelta: 'consumer-dispute-resolution', description: 'Handles consumer complaints, forum filings, mediation, and enforcement of consumer forum orders', capabilities: ['consumer-complaints', 'forum-filings', 'mediation', 'order-enforcement', 'deficiency-of-service'], tools: ['court-filing-system', 'document-generation', 'legal-research', 'mediation-platform'], reportsTo: ['consumer-specialist'], manages: [], collaboratesWith: ['family-mediation', 'arbitration-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'product-liability', name: 'Product Liability Specialist', tier: 'specialist', practiceAreaId: 21, module: 'assurance', roleDelta: 'product-liability', description: 'Advises on product liability claims, safety recalls, manufacturing defects, and warning obligations', capabilities: ['product-liability', 'safety-recalls', 'manufacturing-defects', 'warning-obligations', 'design-defects', 'strict-liability'], tools: ['legal-research', 'evidence-manager', 'document-generation', 'case-law-analysis'], reportsTo: ['consumer-specialist'], manages: [], collaboratesWith: ['insurance-specialist', 'healthcare-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'class-action', name: 'Class Action Specialist', tier: 'specialist', practiceAreaId: 21, module: 'timeline', roleDelta: 'class-action-litigation', description: 'Manages class action and representative suits, opt-in/opt-out mechanisms, and settlement administration', capabilities: ['class-certification', 'representative-suits', 'settlement-administration', 'notice-procedures', 'damages-calculation'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'analytics-dashboard'], reportsTo: ['consumer-specialist'], manages: [], collaboratesWith: ['litigation-specialist', 'insurance-litigation'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'unfair-trade-agent', name: 'Unfair Trade Practices Specialist', tier: 'specialist', practiceAreaId: 21, module: 'assurance', roleDelta: 'unfair-trade-practices', description: 'Analyzes unfair trade practices, misleading advertisements, and restrictive trade practices', capabilities: ['unfair-trade-analysis', 'misleading-advertising', 'restrictive-practices', 'complaint-drafting', 'regulatory-reporting'], tools: ['compliance-checker', 'legal-research', 'document-generation', 'analytics-dashboard'], reportsTo: ['consumer-specialist'], manages: [], collaboratesWith: ['competition-specialist', 'media-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },

  // PA22: Cyber & Data Privacy (5)
  { id: 'cyber-specialist', name: 'Cyber & Data Privacy Director', tier: 'senior', practiceAreaId: 22, module: 'assurance', roleDelta: 'cyber-law-leadership', description: 'Leads cyber law and data privacy practice covering DPDP, GDPR, incident response, and cyber litigation', capabilities: ['cyber-law', 'data-privacy', 'incident-response', 'cyber-litigation', 'breach-management', 'cross-border-data', 'telecom-regulation', 'ai-governance', 'blockchain-law', 'it-procurement'], tools: ['legal-research', 'compliance-checker', 'pii-scanner', 'regulatory-monitoring', 'evidence-manager', 'breach-notification-system'], reportsTo: ['general-counsel'], manages: ['cyber-incident', 'cyber-gdpr', 'cyber-forensics', 'cyber-risk'], collaboratesWith: ['data-protection-agent', 'compliance-lead'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'cyber-incident', name: 'Cyber Incident Response Specialist', tier: 'specialist', practiceAreaId: 22, module: 'timeline', roleDelta: 'cyber-incident-response', description: 'Manages cyber incident response, breach notification, regulatory reporting, and forensic coordination', capabilities: ['incident-response', 'breach-notification', 'regulatory-reporting', 'forensic-coordination', 'containment-strategy'], tools: ['breach-notification-system', 'evidence-manager', 'regulatory-monitoring', 'document-generation'], reportsTo: ['cyber-specialist'], manages: [], collaboratesWith: ['cyber-forensics', 'data-protection-agent'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'cyber-gdpr', name: 'GDPR/DPDP Compliance Specialist', tier: 'specialist', practiceAreaId: 22, module: 'assurance', roleDelta: 'gdpr-dpdpa-compliance', description: 'Ensures compliance with GDPR, DPDP Act, UK-GDPR, CCPA, and PDPA across all operating jurisdictions', capabilities: ['gdpr-compliance', 'dpdp-compliance', 'ccpa-compliance', 'pdpa-compliance', 'data-mapping', 'privacy-impact-assessment'], tools: ['compliance-checker', 'pii-scanner', 'regulatory-monitoring', 'consent-manager'], reportsTo: ['cyber-specialist'], manages: [], collaboratesWith: ['data-protection-agent', 'multi-jurisdiction-compliance'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'cyber-risk', name: 'Cyber Risk Assessment Specialist', tier: 'specialist', practiceAreaId: 22, module: 'assurance', roleDelta: 'cyber-risk-assessment', description: 'Assesses cyber risk exposure, third-party risk, and recommends technical/legal controls', capabilities: ['cyber-risk-assessment', 'third-party-risk', 'vulnerability-legal-review', 'cyber-insurance', 'control-recommendations'], tools: ['risk-scoring-engine', 'compliance-checker', 'analytics-dashboard', 'document-generation'], reportsTo: ['cyber-specialist'], manages: [], collaboratesWith: ['risk-agent', 'insurance-specialist'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'privacy-technology-agent', name: 'Privacy Technology Specialist', tier: 'specialist', practiceAreaId: 22, module: 'assurance', roleDelta: 'privacy-technology-legal', description: 'Advises on privacy-by-design, privacy-enhancing technologies, and technology-specific privacy implications', capabilities: ['privacy-by-design', 'pet-advisory', 'ai-privacy', 'biometric-regulation', 'cookie-consent', 'dark-patterns'], tools: ['compliance-checker', 'legal-research', 'analytics-dashboard', 'regulatory-monitoring'], reportsTo: ['cyber-specialist'], manages: [], collaboratesWith: ['data-protection-agent', 'cyber-specialist'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'high' },

  // PA23: Media & Entertainment (4)
  { id: 'media-specialist', name: 'Media & Entertainment Director', tier: 'senior', practiceAreaId: 23, module: 'draft', roleDelta: 'media-entertainment-leadership', description: 'Leads media and entertainment practice covering content licensing, defamation, streaming compliance, and talent contracts', capabilities: ['media-law', 'content-licensing', 'defamation', 'streaming-regulation', 'talent-management', 'censorship'], tools: ['legal-research', 'document-generation', 'contract-analysis', 'regulatory-monitoring', 'ip-search-engine'], reportsTo: ['general-counsel'], manages: ['content-licensing', 'defamation-agent', 'streaming-compliance', 'talent-contracts'], collaboratesWith: ['ip-specialist', 'cyber-specialist'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'content-licensing', name: 'Content Licensing Specialist', tier: 'specialist', practiceAreaId: 23, module: 'draft', roleDelta: 'content-licensing', description: 'Drafts and negotiates content licensing, distribution, and co-production agreements', capabilities: ['content-licensing', 'distribution-agreements', 'co-production', 'royalty-structuring', 'territorial-rights', 'platform-agreements'], tools: ['contract-analysis', 'document-generation', 'legal-research', 'billing-engine'], reportsTo: ['media-specialist'], manages: [], collaboratesWith: ['ip-licensing', 'contract-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'standard' },
  { id: 'defamation-agent', name: 'Defamation & Reputation Specialist', tier: 'specialist', practiceAreaId: 23, module: 'timeline', roleDelta: 'defamation-reputation', description: 'Handles defamation claims, reputation management, right to be forgotten, and content takedown', capabilities: ['defamation-claims', 'reputation-management', 'right-to-be-forgotten', 'content-takedown', 'injunctions', 'damages-assessment'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis'], reportsTo: ['media-specialist'], manages: [], collaboratesWith: ['cyber-specialist', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'talent-contracts', name: 'Talent & Artist Contract Specialist', tier: 'specialist', practiceAreaId: 23, module: 'draft', roleDelta: 'talent-artist-contracts', description: 'Drafts talent agreements, artist management contracts, endorsement deals, and performance rights', capabilities: ['talent-agreements', 'artist-management', 'endorsement-contracts', 'performance-rights', 'guild-compliance'], tools: ['document-generation', 'contract-analysis', 'template-engine', 'billing-engine'], reportsTo: ['media-specialist'], manages: [], collaboratesWith: ['ip-specialist', 'employment-contracts'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },

  // PA24: Maritime & Shipping (0 — folded into International Trade)

  // PA25: Telecom & Technology (0 — folded into Cyber & Data Privacy)

  // PA26: Education Law (0 — folded into Compliance)

  // PA27: Energy & Power (0 — folded into Environmental Law)

  // PA28: Food & Agriculture (0 — folded into Consumer Protection)

  // PA29: Public Interest & Constitutional (5)
  { id: 'constitutional-specialist', name: 'Constitutional Law Director', tier: 'senior', practiceAreaId: 29, module: 'matter', roleDelta: 'constitutional-law-leadership', description: 'Leads constitutional and public interest litigation covering fundamental rights, writs, judicial review, and PIL', capabilities: ['constitutional-law', 'fundamental-rights', 'writ-petitions', 'judicial-review', 'pil', 'administrative-law'], tools: ['legal-research', 'case-law-analysis', 'court-filing-system', 'document-generation', 'citation-verification'], reportsTo: ['general-counsel'], manages: ['writ-petitions', 'pil-specialist', 'judicial-review', 'administrative-law'], collaboratesWith: ['criminal-specialist', 'environmental-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'writ-petitions', name: 'Writ Petition Specialist', tier: 'specialist', practiceAreaId: 29, module: 'draft', roleDelta: 'writ-petitions', description: 'Drafts writ petitions under Articles 32 and 226 for enforcement of fundamental rights', capabilities: ['writ-drafting', 'article-32', 'article-226', 'fundamental-rights-enforcement', 'habeas-corpus', 'mandamus'], tools: ['document-generation', 'legal-research', 'court-filing-system', 'case-law-analysis', 'citation-verification'], reportsTo: ['constitutional-specialist'], manages: [], collaboratesWith: ['pil-specialist', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'pil-specialist', name: 'PIL Specialist', tier: 'specialist', practiceAreaId: 29, module: 'draft', roleDelta: 'public-interest-litigation', description: 'Drafts and argues public interest litigation for social justice, environmental protection, and human rights', capabilities: ['pil-drafting', 'social-justice', 'environmental-pil', 'human-rights', 'locus-standi', 'court-monitored-directions'], tools: ['document-generation', 'legal-research', 'court-filing-system', 'case-law-analysis'], reportsTo: ['constitutional-specialist'], manages: [], collaboratesWith: ['env-specialist', 'writ-petitions'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'judicial-review', name: 'Judicial Review Specialist', tier: 'specialist', practiceAreaId: 29, module: 'timeline', roleDelta: 'judicial-review-uk', description: 'Handles judicial review of administrative actions, ultra vires challenges, and proportionality assessment', capabilities: ['judicial-review', 'administrative-challenges', 'ultra-vires', 'proportionality', 'reasonableness', 'procedural-fairness'], tools: ['legal-research', 'case-law-analysis', 'court-filing-system', 'document-generation'], reportsTo: ['constitutional-specialist'], manages: [], collaboratesWith: ['administrative-law', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'administrative-law', name: 'Administrative Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'assurance', roleDelta: 'administrative-law', description: 'Advises on administrative law, delegated legislation, quasi-judicial bodies, and natural justice principles', capabilities: ['administrative-law', 'delegated-legislation', 'quasi-judicial', 'natural-justice', 'regulatory-challenges'], tools: ['legal-research', 'case-law-analysis', 'document-generation', 'compliance-checker'], reportsTo: ['constitutional-specialist'], manages: [], collaboratesWith: ['judicial-review', 'regulatory-monitor'], maxCostPerTask: 0.3, preferCheaperModels: false, securityLevel: 'high' },

  // Infrastructure & Support Agents (system/utility agents that complete 148)
  { id: 'analytics-agent', name: 'Legal Analytics Engine', tier: 'specialist', practiceAreaId: 4, module: 'insight', roleDelta: 'legal-analytics', description: 'Provides legal analytics, case outcome prediction, benchmarking, and practice area performance insights', capabilities: ['legal-analytics', 'outcome-prediction', 'benchmarking', 'performance-insights', 'trend-analysis'], tools: ['analytics-dashboard', 'digital-twin-simulator', 'graphrag-engine', 'legal-research'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['litigation-risk', 'risk-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'billing-agent', name: 'Legal Billing Engine', tier: 'specialist', practiceAreaId: 12, module: 'ledger', roleDelta: 'billing-compliance', description: 'Manages time tracking, billing, invoice generation, GST calculation, and client billing compliance', capabilities: ['time-tracking', 'billing', 'invoice-generation', 'gst-calculation', 'client-billing', 'retainer-management'], tools: ['billing-engine', 'document-generation', 'analytics-dashboard', 'tax-calculator'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['tax-compliance', 'stamp-duty-calculator'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'integration-agent', name: 'Integration Engine', tier: 'specialist', practiceAreaId: 25, module: 'connect', roleDelta: 'api-integration', description: 'Manages API integrations with eCourts, MCA21, GSTN, SEBI SCORES, and other government portals', capabilities: ['api-integration', 'ecourts-connector', 'mca21-connector', 'gstn-connector', 'webhook-management'], tools: ['ecourts-api', 'mca21-api', 'gstn-api', 'webhook-engine', 'notification-service'], reportsTo: ['legal-ops-director'], manages: ['ecourts-connector', 'mca21-connector'], collaboratesWith: ['document-intelligence-agent'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'document-intelligence-agent', name: 'Document Intelligence Engine', tier: 'specialist', practiceAreaId: 6, module: 'draft', roleDelta: 'document-intelligence', description: 'Handles document parsing, OCR, classification, entity extraction, embedding generation, and RAG indexing', capabilities: ['document-parsing', 'ocr', 'classification', 'entity-extraction', 'embedding-generation', 'rag-indexing'], tools: ['document-generation', 'ediscovery-platform', 'graphrag-engine', 'pii-scanner'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['pii-redaction-agent'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'matter-management-agent', name: 'Matter Management Engine', tier: 'specialist', practiceAreaId: 1, module: 'matter', roleDelta: 'matter-management', description: 'Manages legal matter lifecycle, case tracking, task assignment, and deadline management', capabilities: ['matter-lifecycle', 'case-tracking', 'task-assignment', 'deadline-management', 'conflict-check'], tools: ['workflow-automation', 'calendar-engine', 'notification-service', 'analytics-dashboard'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['matter-management-agent', 'billing-agent'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'client-onboarding-agent', name: 'Client Onboarding Engine', tier: 'specialist', practiceAreaId: 13, module: 'connect', roleDelta: 'client-onboarding', description: 'Manages client onboarding, KYC verification, engagement letters, and conflict of interest checks', capabilities: ['client-onboarding', 'kyc-verification', 'engagement-letters', 'conflict-check', 'retainer-setup'], tools: ['document-generation', 'pii-scanner', 'compliance-checker', 'notification-service'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['aml-specialist', 'billing-agent'], maxCostPerTask: 0.2, preferCheaperModels: true, securityLevel: 'high' },
  { id: 'citation-formatter', name: 'Citation Formatter', tier: 'associate', practiceAreaId: 4, module: 'draft', roleDelta: 'citation-formatting', description: 'Formats legal citations per jurisdiction standards (SCC, UKSC, F.3d, etc.) and verifies citation accuracy', capabilities: ['citation-formatting', 'citation-verification', 'neutral-citation', 'bluebook-format', 'oscola-format'], tools: ['citation-verification', 'legal-research'], reportsTo: ['legal-research'], manages: [], collaboratesWith: ['case-law-researcher', 'pleading-draft'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'limitation-calculator', name: 'Limitation Period Calculator', tier: 'associate', practiceAreaId: 3, module: 'timeline', roleDelta: 'limitation-period-calculation', description: 'Calculates limitation periods, filing deadlines, and statutory time bars across jurisdictions', capabilities: ['limitation-calculation', 'deadline-computation', 'time-bar-assessment', 'condonation-of-delay'], tools: ['calendar-engine', 'legal-research', 'analytics-dashboard'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['court-filing', 'matter-management-agent'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'stamp-duty-calculator', name: 'Stamp Duty Calculator', tier: 'associate', practiceAreaId: 12, module: 'ledger', roleDelta: 'stamp-duty-calculation', description: 'Calculates stamp duty obligations across states/jurisdictions for property and legal documents', capabilities: ['stamp-duty-calculation', 'registration-fees', 'state-specific-rates', 'e-stamping', 'adjudication'], tools: ['tax-calculator', 'regulatory-monitoring', 'analytics-dashboard'], reportsTo: ['tax-specialist'], manages: [], collaboratesWith: ['property-drafting', 'billing-agent'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'court-fee-assessor', name: 'Court Fee Assessor', tier: 'associate', practiceAreaId: 3, module: 'ledger', roleDelta: 'court-fee-assessment', description: 'Calculates court fees, filing fees, and advocate fees per jurisdiction-specific fee schedules', capabilities: ['court-fee-calculation', 'filing-fee-assessment', 'advocate-fee-schedule', 'fee-waiver-eligibility'], tools: ['tax-calculator', 'legal-research', 'analytics-dashboard'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['court-filing', 'billing-agent'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'cause-list-parser', name: 'Cause List Parser', tier: 'associate', practiceAreaId: 3, module: 'timeline', roleDelta: 'cause-list-parsing', description: 'Parses daily cause lists, tracks hearing dates, and extracts case information from court listings', capabilities: ['cause-list-parsing', 'hearing-tracking', 'case-extraction', 'court-calendar', 'date-monitoring'], tools: ['ecourts-api', 'calendar-engine', 'analytics-dashboard', 'notification-service'], reportsTo: ['court-filing'], manages: [], collaboratesWith: ['limitation-calculator', 'matter-management-agent'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'pii-redaction-agent', name: 'PII Redaction Engine', tier: 'associate', practiceAreaId: 22, module: 'assurance', roleDelta: 'pii-redaction', description: 'Automatically detects and redacts personally identifiable information from legal documents', capabilities: ['pii-detection', 'pii-redaction', 'aadhaar-masking', 'pan-masking', 'automated-redaction', 'classification'], tools: ['pii-scanner', 'document-generation', 'compliance-checker'], reportsTo: ['data-protection-agent'], manages: [], collaboratesWith: ['document-intelligence-agent', 'cyber-gdpr'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'critical' },
  { id: 'translation-agent', name: 'Legal Translation Engine', tier: 'associate', practiceAreaId: 4, module: 'draft', roleDelta: 'legal-translation', description: 'Provides legal translation across 47 languages including 22 Indian scheduled languages', capabilities: ['legal-translation', 'certified-translation', 'court-document-translation', 'multilingual-drafting'], tools: ['translation-engine', 'document-generation', 'legal-research'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['sarvam-voice-agent', 'mentor-agent'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'sarvam-voice-agent', name: 'Voice AI Interface', tier: 'associate', practiceAreaId: 25, module: 'connect', roleDelta: 'voice-interface', description: 'Provides voice AI interface with STT/TTS in 47 languages for legal consultations and accessibility', capabilities: ['speech-to-text', 'text-to-speech', 'voice-commands', 'multilingual-voice', 'accessibility'], tools: ['sarvam-voice-api', 'translation-engine', 'notification-service'], reportsTo: ['legal-ops-director'], manages: [], collaboratesWith: ['translation-agent', 'mentor-agent'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'ecourts-connector', name: 'eCourts API Connector', tier: 'associate', practiceAreaId: 3, module: 'connect', roleDelta: 'ecourts-api-connector', description: 'Interfaces with eCourts API for case status, hearing dates, orders, and judgment retrieval', capabilities: ['ecourts-api', 'case-status', 'hearing-dates', 'order-retrieval', 'judgment-download'], tools: ['ecourts-api', 'notification-service', 'calendar-engine'], reportsTo: ['integration-agent'], manages: [], collaboratesWith: ['court-filing', 'cause-list-parser'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'mca21-connector', name: 'MCA21/RoC API Connector', tier: 'associate', practiceAreaId: 8, module: 'connect', roleDelta: 'mca21-roc-connector', description: 'Interfaces with MCA21 for company filings, director details, charge registration, and ROC compliance', capabilities: ['mca21-api', 'company-filings', 'director-details', 'charge-registration', 'annual-returns'], tools: ['mca21-api', 'notification-service', 'compliance-checker'], reportsTo: ['integration-agent'], manages: [], collaboratesWith: ['corporate-secretarial', 'corporate-compliance'], maxCostPerTask: 0.05, preferCheaperModels: true, securityLevel: 'standard' },

  // Additional specialized agents to reach 148
  { id: 'insolvency-specialist', name: 'Insolvency Director', tier: 'senior', practiceAreaId: 13, module: 'matter', roleDelta: 'insolvency-leadership', description: 'Leads insolvency and bankruptcy practice under IBC 2016, handling CIRP, liquidation, and cross-border insolvency', capabilities: ['insolvency-law', 'cirp', 'liquidation', 'cross-border-insolvency', 'creditor-rights', 'moratorium'], tools: ['legal-research', 'court-filing-system', 'document-generation', 'case-law-analysis', 'regulatory-monitoring'], reportsTo: ['general-counsel'], manages: ['ibc-agent', 'liquidation-agent', 'creditor-rights', 'restructuring-plan'], collaboratesWith: ['banking-specialist', 'corporate-specialist'], maxCostPerTask: 1.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'ibc-agent', name: 'IBC Specialist', tier: 'specialist', practiceAreaId: 13, module: 'timeline', roleDelta: 'insolvency-bankruptcy-code-india', description: 'Handles IBC applications, CIRP timeline compliance, CoC proceedings, and resolution plan evaluation', capabilities: ['ibc-applications', 'cirp-compliance', 'coc-proceedings', 'resolution-plan', 'nclt-proceedings'], tools: ['court-filing-system', 'legal-research', 'document-generation', 'calendar-engine'], reportsTo: ['insolvency-specialist'], manages: [], collaboratesWith: ['debt-restructuring', 'creditor-rights'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'liquidation-agent', name: 'Liquidation Specialist', tier: 'specialist', practiceAreaId: 13, module: 'timeline', roleDelta: 'liquidation-proceedings', description: 'Manages voluntary/involuntary liquidation, asset distribution, waterfall mechanism, and dissolution', capabilities: ['liquidation-proceedings', 'asset-distribution', 'waterfall-mechanism', 'dissolution', 'scheme-of-arrangement'], tools: ['legal-research', 'document-generation', 'court-filing-system', 'analytics-dashboard'], reportsTo: ['insolvency-specialist'], manages: [], collaboratesWith: ['ibc-agent', 'corporate-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'creditor-rights', name: 'Creditor Rights Specialist', tier: 'specialist', practiceAreaId: 13, module: 'assurance', roleDelta: 'creditor-rights', description: 'Protects creditor interests in insolvency proceedings, priority claims, and security enforcement', capabilities: ['creditor-rights', 'priority-claims', 'security-enforcement', 'moratorium-exceptions', 'voting-rights'], tools: ['legal-research', 'document-generation', 'court-filing-system', 'risk-scoring-engine'], reportsTo: ['insolvency-specialist'], manages: [], collaboratesWith: ['banking-specialist', 'debt-restructuring'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'restructuring-plan', name: 'Corporate Restructuring Specialist', tier: 'specialist', practiceAreaId: 8, module: 'draft', roleDelta: 'corporate-restructuring-plan', description: 'Drafts resolution plans, restructuring proposals, schemes of arrangement, and demerger documents', capabilities: ['resolution-plans', 'restructuring-proposals', 'scheme-of-arrangement', 'demerger', 'corporate-reorganization'], tools: ['document-generation', 'legal-research', 'contract-analysis', 'analytics-dashboard'], reportsTo: ['insolvency-specialist'], manages: [], collaboratesWith: ['mergers-acquisitions', 'corporate-specialist'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'trade-specialist', name: 'International Trade Director', tier: 'senior', practiceAreaId: 24, module: 'matter', roleDelta: 'international-trade-leadership', description: 'Leads international trade practice covering customs, trade remedies, FDI, sanctions, and export controls', capabilities: ['international-trade', 'customs-law', 'trade-remedies', 'fdi-advisory', 'sanctions', 'export-controls', 'maritime-law', 'shipping-contracts', 'cargo-claims', 'admiralty-jurisdiction', 'marine-insurance'], tools: ['legal-research', 'regulatory-monitoring', 'compliance-checker', 'document-generation', 'analytics-dashboard'], reportsTo: ['general-counsel'], manages: ['customs-agent', 'trade-remedies', 'fdi-agent', 'sanctions-compliance'], collaboratesWith: ['banking-specialist', 'cross-border-transactions'], maxCostPerTask: 1.0, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'customs-agent', name: 'Customs Duty Specialist', tier: 'specialist', practiceAreaId: 24, module: 'assurance', roleDelta: 'customs-duty-compliance', description: 'Handles customs classification, duty calculation, exemptions, advance rulings, and customs litigation', capabilities: ['customs-classification', 'duty-calculation', 'exemptions', 'advance-rulings', 'customs-litigation'], tools: ['tax-calculator', 'regulatory-monitoring', 'compliance-checker', 'legal-research'], reportsTo: ['trade-specialist'], manages: [], collaboratesWith: ['gst-agent', 'trade-remedies'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'trade-remedies', name: 'Trade Remedies Specialist', tier: 'specialist', practiceAreaId: 24, module: 'timeline', roleDelta: 'anti-dumping-trade-remedies', description: 'Handles anti-dumping investigations, safeguard measures, countervailing duties, and WTO dispute settlement', capabilities: ['anti-dumping', 'safeguard-measures', 'countervailing-duties', 'wto-disputes', 'injury-determination'], tools: ['legal-research', 'regulatory-monitoring', 'document-generation', 'analytics-dashboard'], reportsTo: ['trade-specialist'], manages: [], collaboratesWith: ['customs-agent', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'fdi-agent', name: 'FDI Specialist', tier: 'specialist', practiceAreaId: 24, module: 'assurance', roleDelta: 'foreign-direct-investment', description: 'Advises on FDI policy, FEMA compliance, automatic/government route approvals, and sectoral caps', capabilities: ['fdi-policy', 'fema-compliance', 'automatic-route', 'government-approval', 'sectoral-caps', 'downstream-investment'], tools: ['regulatory-monitoring', 'compliance-checker', 'legal-research', 'document-generation'], reportsTo: ['trade-specialist'], manages: [], collaboratesWith: ['corporate-specialist', 'banking-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'sanctions-compliance', name: 'Sanctions & Export Controls Specialist', tier: 'specialist', practiceAreaId: 24, module: 'assurance', roleDelta: 'sanctions-export-controls', description: 'Ensures compliance with international sanctions regimes, export controls, and dual-use goods regulations', capabilities: ['sanctions-screening', 'export-controls', 'dual-use-goods', 'ofac-compliance', 'eu-sanctions', 'un-sanctions'], tools: ['compliance-checker', 'regulatory-monitoring', 'risk-scoring-engine', 'legal-research'], reportsTo: ['trade-specialist'], manages: [], collaboratesWith: ['aml-specialist', 'cross-border-transactions'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'cross-border-transactions', name: 'Cross-Border Transactions Specialist', tier: 'specialist', practiceAreaId: 8, module: 'draft', roleDelta: 'cross-border-transactions', description: 'Handles cross-border deal structuring, dual-jurisdiction compliance, and international contract harmonization', capabilities: ['cross-border-deals', 'dual-jurisdiction', 'international-contracts', 'treaty-analysis', 'bilateral-agreements'], tools: ['contract-analysis', 'legal-research', 'document-generation', 'regulatory-monitoring'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['multi-jurisdiction-compliance', 'trade-specialist'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'multi-jurisdiction-compliance', name: 'Multi-Jurisdiction Compliance Specialist', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'multi-jurisdiction-compliance', description: 'Ensures compliance across multiple jurisdictions simultaneously, identifying regulatory conflicts and harmonization opportunities', capabilities: ['multi-jurisdiction', 'regulatory-harmonization', 'conflict-resolution', 'compliance-mapping', 'cross-border-reporting'], tools: ['compliance-checker', 'regulatory-monitoring', 'legal-research', 'analytics-dashboard'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['cross-border-transactions', 'legal-research'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'streaming-compliance', name: 'OTT/Streaming Compliance Specialist', tier: 'specialist', practiceAreaId: 23, module: 'assurance', roleDelta: 'ott-streaming-compliance', description: 'Ensures compliance with IT Rules for intermediaries and digital media, content rating, and age-gating requirements', capabilities: ['ott-compliance', 'content-rating', 'age-gating', 'intermediary-guidelines', 'self-regulatory-body', 'grievance-mechanism'], tools: ['compliance-checker', 'regulatory-monitoring', 'document-generation', 'legal-research'], reportsTo: ['media-specialist'], manages: [], collaboratesWith: ['data-protection-agent', 'defamation-agent'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'sports-law', name: 'Sports Law Specialist', tier: 'specialist', practiceAreaId: 23, module: 'draft', roleDelta: 'sports-law-contracts', description: 'Handles sports contracts, athlete representation, anti-doping regulations, and sports governance', capabilities: ['sports-contracts', 'athlete-representation', 'anti-doping', 'sports-governance', 'broadcasting-rights'], tools: ['contract-analysis', 'document-generation', 'legal-research', 'regulatory-monitoring'], reportsTo: ['media-specialist'], manages: [], collaboratesWith: ['talent-contracts', 'arbitration-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'sports-disputes', name: 'Sports Arbitration Specialist', tier: 'specialist', practiceAreaId: 18, module: 'timeline', roleDelta: 'sports-arbitration-disputes', description: 'Handles sports disputes through CAS, national anti-doping panels, and federation disciplinary proceedings', capabilities: ['cas-arbitration', 'sports-disputes', 'anti-doping-hearings', 'disciplinary-proceedings', 'eligibility-disputes'], tools: ['legal-research', 'case-law-analysis', 'document-generation', 'court-filing-system'], reportsTo: ['arbitration-specialist'], manages: [], collaboratesWith: ['sports-law', 'litigation-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'procurement-agent', name: 'Public Procurement Specialist', tier: 'specialist', practiceAreaId: 8, module: 'assurance', roleDelta: 'public-procurement', description: 'Advises on government procurement, tender processes, GeM compliance, and procurement disputes', capabilities: ['government-procurement', 'tender-process', 'gem-compliance', 'procurement-disputes', 'integrity-pact'], tools: ['regulatory-monitoring', 'compliance-checker', 'document-generation', 'legal-research'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['administrative-law', 'litigation-specialist'], maxCostPerTask: 0.3, preferCheaperModels: true, securityLevel: 'standard' },
  { id: 'government-contracts', name: 'Government Contracting Specialist', tier: 'specialist', practiceAreaId: 8, module: 'draft', roleDelta: 'government-contracting', description: 'Drafts and reviews government contracts, PPP agreements, concession agreements, and BOT contracts', capabilities: ['government-contracts', 'ppp-agreements', 'concession-agreements', 'bot-contracts', 'sovereign-immunity'], tools: ['document-generation', 'contract-analysis', 'legal-research', 'template-engine'], reportsTo: ['corporate-specialist'], manages: [], collaboratesWith: ['procurement-agent', 'contract-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'fcpa-agent', name: 'FCPA/Anti-Bribery Specialist', tier: 'specialist', practiceAreaId: 5, module: 'assurance', roleDelta: 'fcpa-anti-bribery', description: 'Ensures compliance with FCPA, UK Bribery Act, Prevention of Corruption Act, and anti-bribery frameworks', capabilities: ['fcpa-compliance', 'uk-bribery-act', 'anti-corruption', 'due-diligence', 'gift-hospitality-policy'], tools: ['compliance-checker', 'risk-scoring-engine', 'legal-research', 'document-generation'], reportsTo: ['compliance-lead'], manages: [], collaboratesWith: ['aml-specialist', 'criminal-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'legal-ops-agent', name: 'Legal Operations Specialist', tier: 'associate', practiceAreaId: 1, module: 'matter', roleDelta: 'legal-operations-efficiency', description: 'Optimizes legal workflows, manages technology stack, and tracks departmental KPIs', capabilities: ['workflow-optimization', 'technology-management', 'kpi-tracking', 'vendor-management', 'budget-tracking'], tools: ['workflow-automation', 'analytics-dashboard', 'billing-engine', 'notification-service'], reportsTo: ['chief-legal-officer'], manages: [], collaboratesWith: ['matter-management-agent', 'billing-agent'], maxCostPerTask: 0.1, preferCheaperModels: true, securityLevel: 'standard' },

  // Jurisdiction Specialist Agents (9 — cross-jurisdictional expertise)
  { id: 'uk-law-specialist', name: 'UK Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'uk-legal-system-expertise', description: 'Expert in English and Welsh law, common law system, Acts of Parliament, statutory instruments, and UK regulatory frameworks', capabilities: ['uk-common-law', 'english-law', 'uk-regulatory-framework', 'uk-court-system', 'uk-legislation', 'uk-legal-procedure'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['general-counsel'], manages: [], collaboratesWith: ['litigation-specialist', 'corporate-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'us-law-specialist', name: 'US Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'us-legal-system-expertise', description: 'Expert in US federal and state law, constitutional law, UCC, federal regulations, and multi-state compliance', capabilities: ['us-federal-law', 'us-state-law', 'us-constitutional-law', 'ucc', 'cfr-regulations', 'us-court-system'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['general-counsel'], manages: [], collaboratesWith: ['litigation-specialist', 'corporate-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'eu-law-specialist', name: 'EU Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'eu-legal-system-expertise', description: 'Expert in EU law, directives, regulations, CJEU jurisprudence, and pan-European regulatory harmonization', capabilities: ['eu-treaty-law', 'eu-directives', 'eu-regulations', 'cjeu-jurisprudence', 'eu-harmonization', 'eu-legal-procedure'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['general-counsel'], manages: [], collaboratesWith: ['compliance-lead', 'data-protection-agent'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'gcc-law-specialist', name: 'GCC Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'gcc-legal-system-expertise', description: 'Expert in GCC legal systems including UAE, Saudi Arabia, Qatar, Oman, Bahrain, and Kuwait civil and Sharia law', capabilities: ['gcc-civil-law', 'sharia-law', 'uae-law', 'saudi-law', 'difc-adgm', 'gcc-commercial-law'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['general-counsel'], manages: [], collaboratesWith: ['arbitration-specialist', 'banking-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'singapore-law-specialist', name: 'Singapore Law Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'singapore-legal-system-expertise', description: 'Expert in Singapore law, SICC, MAS regulations, PDPA, and ASEAN legal frameworks', capabilities: ['singapore-law', 'sicc-jurisdiction', 'mas-regulations', 'pdpa', 'asean-legal-framework', 'singapore-arbitration'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['general-counsel'], manages: [], collaboratesWith: ['arbitration-specialist', 'banking-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'difc-adgm-specialist', name: 'DIFC/ADGM Specialist', tier: 'specialist', practiceAreaId: 29, module: 'mentor', roleDelta: 'difc-adgm-free-zone-expertise', description: 'Expert in DIFC and ADGM free zone common law jurisdictions, their courts, and financial regulations', capabilities: ['difc-law', 'adgm-law', 'free-zone-regulation', 'difc-courts', 'adgm-courts', 'financial-free-zone'], tools: ['legal-research', 'case-law-analysis', 'regulatory-monitoring', 'citation-verification'], reportsTo: ['gcc-law-specialist'], manages: [], collaboratesWith: ['banking-specialist', 'arbitration-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'supreme-court-agent', name: 'Supreme Court Specialist', tier: 'specialist', practiceAreaId: 3, module: 'timeline', roleDelta: 'supreme-court-practice', description: 'Specialist in Supreme Court of India practice including SLP, constitutional bench matters, PIL, and appellate jurisdiction', capabilities: ['slp-filing', 'constitutional-bench', 'supreme-court-rules', 'appellate-jurisdiction', 'curative-petition', 'review-petition'], tools: ['court-filing-system', 'legal-research', 'case-law-analysis', 'document-generation', 'citation-verification'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['constitutional-specialist', 'writ-petitions'], maxCostPerTask: 0.8, preferCheaperModels: false, securityLevel: 'critical' },
  { id: 'uk-courts-agent', name: 'UK Courts Specialist', tier: 'specialist', practiceAreaId: 3, module: 'timeline', roleDelta: 'uk-courts-practice', description: 'Specialist in UK court system including Supreme Court, Court of Appeal, High Court, and tribunal procedures', capabilities: ['uk-supreme-court', 'court-of-appeal', 'high-court', 'uk-tribunals', 'cpr-rules', 'judicial-review-uk'], tools: ['court-filing-system', 'legal-research', 'case-law-analysis', 'document-generation'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['uk-law-specialist', 'arbitration-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
  { id: 'singapore-courts-agent', name: 'Singapore Courts Specialist', tier: 'specialist', practiceAreaId: 3, module: 'timeline', roleDelta: 'singapore-courts-practice', description: 'Specialist in Singapore court system including SICC, High Court, Court of Appeal, and SIAC arbitration interface', capabilities: ['sicc-practice', 'singapore-high-court', 'singapore-court-of-appeal', 'siac-interface', 'singapore-rules-of-court'], tools: ['court-filing-system', 'legal-research', 'case-law-analysis', 'document-generation'], reportsTo: ['litigation-specialist'], manages: [], collaboratesWith: ['singapore-law-specialist', 'arbitration-specialist'], maxCostPerTask: 0.5, preferCheaperModels: false, securityLevel: 'high' },
];

// 148 domain agents across 29 practice areas (+ 1 orchestrator per file = 149 per jurisdiction).
console.log(`Total AGENT_DEFS: ${AGENT_DEFS.length}`);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: JURISDICTION CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════

interface JurisdictionMeta {
  code: string;
  name: string;
  fullName: string;
  legalSystem: string;
  courts: string[];
  regulatoryBodies: string[];
  keyStatutes: string[];
  barAssociation: string;
  dataProtection: string;
  antiCorruption: string;
  taxSystem: string;
  currency: string;
  crossBorderNote: string;
  languages: string[];
  primarySLM: string;
  fallbackSLMs: string[];
  preferredModels: string[];
  fallbackModels: string[];
  complianceFlags: Record<string, boolean>;
  citationFormat: string;
  criminalCode: string;
  civilCode: string;
}

const JURISDICTIONS: JurisdictionMeta[] = [
  {
    code: 'IN', name: 'India', fullName: 'Republic of India',
    legalSystem: 'Common Law (British-derived) with codified statutes',
    courts: ['Supreme Court of India', 'High Courts (25)', 'District & Sessions Courts', 'NCLT/NCLAT', 'ITAT', 'SAT', 'NGT', 'Consumer Forums (District/State/National)', 'Labour Courts/Industrial Tribunals', 'Family Courts', 'DRT/DRAT', 'RERA Appellate Tribunals', 'CCI', 'IBBI'],
    regulatoryBodies: ['RBI', 'SEBI', 'IRDAI', 'TRAI', 'CCI', 'NCLT', 'IBBI', 'PFRDA', 'RERA', 'FEMA', 'DGFT', 'CBDT', 'CBIC', 'MCA', 'DPIIT', 'MeitY'],
    keyStatutes: ['Constitution of India 1950', 'Bharatiya Nyaya Sanhita 2023 (BNS)', 'Bharatiya Nagarik Suraksha Sanhita 2023 (BNSS)', 'Bharatiya Sakshya Adhiniyam 2023 (BSA)', 'Indian Contract Act 1872', 'Companies Act 2013', 'Arbitration & Conciliation Act 1996', 'Information Technology Act 2000', 'DPDP Act 2023', 'IBC 2016', 'SEBI Act 1992', 'GST Acts 2017', 'Income Tax Act 1961', 'Transfer of Property Act 1882', 'RERA 2016', 'Consumer Protection Act 2019', 'Labour Codes 2020 (4 codes)', 'Patent Act 1970', 'Trademarks Act 1999', 'Copyright Act 1957', 'PMLA 2002', 'Competition Act 2002', 'Environmental Protection Act 1986', 'Motor Vehicles Act 2019', 'NDPS Act 1985', 'Succession Act 1925', 'NI Act 1881', 'FEMA 1999', 'RBI Act 1934', 'Banking Regulation Act 1949', 'Insurance Act 1938', 'Food Safety Act 2006'],
    barAssociation: 'Bar Council of India (BCI)',
    dataProtection: 'Digital Personal Data Protection Act 2023 (DPDP)',
    antiCorruption: 'Prevention of Corruption Act 1988, Lokpal & Lokayuktas Act 2013',
    taxSystem: 'Income Tax (Central), GST (Central+State), Customs, Professional Tax (State)',
    currency: 'INR',
    crossBorderNote: 'FEMA 1999 governs cross-border transactions; bilateral treaties with 90+ countries; MLA treaties; DTAA with 95+ nations',
    languages: ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'doi', 'kok', 'mni', 'brx', 'sa'],
    primarySLM: 'NS-SLM-IND', fallbackSLMs: ['NS-SLM-UK', 'NS-SLM-SGP'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: true, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
    citationFormat: 'Party v Party (Year) Volume SCC Page [Supreme Court]; Party v Party, Year SCC OnLine HC Page [High Court]; AIR Year HC Page',
    criminalCode: 'Bharatiya Nyaya Sanhita 2023 (BNS) [replaced IPC 1860], Bharatiya Nagarik Suraksha Sanhita 2023 (BNSS) [replaced CrPC 1973], Bharatiya Sakshya Adhiniyam 2023 (BSA) [replaced Evidence Act 1872]',
    civilCode: 'Code of Civil Procedure 1908 (CPC), Limitation Act 1963, Specific Relief Act 1963'
  },
  {
    code: 'UK', name: 'United Kingdom', fullName: 'United Kingdom of Great Britain and Northern Ireland',
    legalSystem: 'Common Law with Parliamentary sovereignty',
    courts: ['UK Supreme Court', 'Court of Appeal (Civil/Criminal)', 'High Court (QBD/Chancery/Family)', 'Crown Court', 'County Courts', 'Magistrates Courts', 'Employment Tribunals', 'First-tier Tribunal', 'Upper Tribunal', 'Competition Appeal Tribunal'],
    regulatoryBodies: ['FCA', 'PRA', 'CMA', 'ICO', 'Ofcom', 'Ofgem', 'HMRC', 'SRA', 'BSB', 'Companies House', 'Land Registry', 'IPO'],
    keyStatutes: ['Human Rights Act 1998', 'Companies Act 2006', 'Employment Rights Act 1996', 'Equality Act 2010', 'Data Protection Act 2018', 'UK-GDPR (retained)', 'Financial Services and Markets Act 2000', 'Arbitration Act 1996', 'Competition Act 1998', 'Enterprise Act 2002', 'Consumer Rights Act 2015', 'Insolvency Act 1986', 'Senior Courts Act 1981', 'Criminal Justice Act 2003', 'Bribery Act 2010', 'Modern Slavery Act 2015', 'TUPE Regulations 2006', 'Landlord and Tenant Act 1954', 'Law of Property Act 1925', 'Patents Act 1977', 'Copyright Designs Patents Act 1988', 'Trade Marks Act 1994', 'Environment Act 2021', 'Online Safety Act 2023', 'National Security and Investment Act 2021'],
    barAssociation: 'Bar Standards Board (BSB) / Solicitors Regulation Authority (SRA)',
    dataProtection: 'UK-GDPR + Data Protection Act 2018 (ICO enforcement)',
    antiCorruption: 'Bribery Act 2010, Proceeds of Crime Act 2002',
    taxSystem: 'Income Tax, Corporation Tax, VAT, SDLT, Capital Gains Tax (HMRC)',
    currency: 'GBP',
    crossBorderNote: 'Post-Brexit bilateral trade agreements; Hague Convention signatory; bilateral investment treaties',
    languages: ['en', 'cy'],
    primarySLM: 'NS-SLM-UK', fallbackSLMs: ['NS-SLM-IND', 'NS-SLM-SGP'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: true, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
    citationFormat: '[Year] UKSC Number [Supreme Court]; [Year] EWCA Civ/Crim Number [Court of Appeal]; [Year] EWHC Number (Division) [High Court]',
    criminalCode: 'Criminal Justice Act 2003, Serious Crime Act 2007, Fraud Act 2006, Theft Act 1968, Criminal Damage Act 1971',
    civilCode: 'Civil Procedure Rules 1998 (CPR), Limitation Act 1980, Senior Courts Act 1981'
  },
  {
    code: 'US', name: 'United States', fullName: 'United States of America',
    legalSystem: 'Federal Common Law with state variations',
    courts: ['U.S. Supreme Court', 'Circuit Courts of Appeals (13)', 'U.S. District Courts (94)', 'U.S. Bankruptcy Courts', 'U.S. Tax Court', 'Court of International Trade', 'State Supreme Courts', 'State Appellate Courts', 'State Trial Courts', 'Administrative Law Courts'],
    regulatoryBodies: ['SEC', 'FTC', 'DOJ', 'CFPB', 'FINRA', 'CFTC', 'FDA', 'EPA', 'FCC', 'OSHA', 'IRS', 'USPTO', 'USCIS', 'OCC', 'FDIC'],
    keyStatutes: ['U.S. Constitution', 'Securities Act 1933', 'Securities Exchange Act 1934', 'Sarbanes-Oxley Act 2002', 'Dodd-Frank Act 2010', 'FCPA 1977', 'Sherman Antitrust Act', 'Clayton Act', 'ADA 1990', 'Title VII Civil Rights Act 1964', 'ERISA 1974', 'HIPAA 1996', 'CCPA 2018 / CPRA 2023', 'Bankruptcy Code (Title 11)', 'UCC (Uniform Commercial Code)', 'DMCA 1998', 'Lanham Act', 'Patent Act (Title 35)', 'Fair Labor Standards Act', 'CERCLA/Superfund', 'Clean Air Act', 'Clean Water Act', 'Federal Rules of Civil Procedure', 'Federal Rules of Evidence', 'CFAA 1986', 'CLOUD Act 2018'],
    barAssociation: 'American Bar Association (ABA) + State Bar Associations',
    dataProtection: 'CCPA/CPRA (California), state-level privacy laws, no federal omnibus law',
    antiCorruption: 'Foreign Corrupt Practices Act 1977 (FCPA), False Claims Act',
    taxSystem: 'Federal Income Tax (IRS), State Income Tax, Sales Tax, Property Tax',
    currency: 'USD',
    crossBorderNote: 'USMCA, bilateral investment treaties, MLAT network, FATCA reporting requirements',
    languages: ['en', 'es'],
    primarySLM: 'NS-SLM-USA', fallbackSLMs: ['NS-SLM-UK', 'NS-SLM-EUR'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: true, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: true, euAiActApplicable: false },
    citationFormat: 'Party v. Party, Volume U.S. Page (Year) [Supreme Court]; Party v. Party, Volume F.3d/F.4th Page (Circuit Year) [Circuit]; Volume F. Supp. 3d Page (District Year) [District]',
    criminalCode: 'Title 18 U.S. Code (Federal Crimes), Model Penal Code (MPC), Federal Sentencing Guidelines, state criminal codes',
    civilCode: 'Federal Rules of Civil Procedure (FRCP), UCC, Restatements of Law'
  },
  {
    code: 'GC', name: 'GCC', fullName: 'Gulf Cooperation Council (UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman)',
    legalSystem: 'Civil Law with Islamic (Sharia) Law foundations',
    courts: ['Federal Supreme Court (UAE)', 'Court of Cassation', 'Courts of Appeal', 'Courts of First Instance', 'DIFC Courts', 'ADGM Courts', 'Board of Grievances (Saudi)', 'Commercial Courts (Saudi)', 'Labour Courts', 'Sharia Courts', 'QICDRC (Qatar)'],
    regulatoryBodies: ['Central Bank of UAE', 'SCA (Securities)', 'DFSA (DIFC)', 'FSRA (ADGM)', 'CMA (Saudi)', 'SAMA (Saudi)', 'TDRA (UAE)', 'MOL (Labour)', 'MOHRE (UAE)', 'GAZT (Saudi Tax)', 'ZATCA (Saudi)'],
    keyStatutes: ['UAE Civil Code (Federal Law No. 5/1985)', 'UAE Commercial Companies Law (Federal Law No. 32/2021)', 'UAE Labour Law (Federal Decree-Law No. 33/2021)', 'UAE Arbitration Law (Federal Law No. 6/2018)', 'DIFC Laws', 'ADGM Regulations', 'Saudi Basic Law of Governance', 'Saudi Companies Law', 'Saudi Labour Law', 'Saudi Commercial Court Law', 'Saudi Arbitration Law', 'UAE Personal Status Law', 'UAE Penal Code', 'DIFC Data Protection Law 2020', 'UAE Federal Decree-Law on Personal Data Protection 2021', 'Saudi Personal Data Protection Law', 'UAE Anti-Money Laundering Law', 'Saudi Anti-Corruption Law'],
    barAssociation: 'No unified bar — DIFC Academy of Law, Saudi Bar Association (emerging)',
    dataProtection: 'DIFC Data Protection Law 2020, UAE PDPL 2021, Saudi PDPL 2023',
    antiCorruption: 'UAE Anti-Corruption Law, Saudi Anti-Corruption Commission (Nazaha)',
    taxSystem: 'VAT (5%), Corporate Tax (UAE 9% from 2023), Zakat (Saudi), No personal income tax',
    currency: 'AED/SAR/QAR/KWD/BHD/OMR',
    crossBorderNote: 'GCC Economic Agreement, bilateral investment treaties, DIFC/ADGM as common law enclaves within civil law systems',
    languages: ['ar', 'en'],
    primarySLM: 'NS-SLM-GCC', fallbackSLMs: ['NS-SLM-IND', 'NS-SLM-SGP'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: true, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: false },
    citationFormat: 'Case No. XX/Year, Court Name, Date of Judgment [UAE]; Royal Decree No. M/XX [Saudi]; DIFC Case No. XXX/Year [DIFC]',
    criminalCode: 'UAE Penal Code (Federal Decree-Law No. 31/2021), Saudi Sharia-based criminal law, Anti-Cybercrime Laws',
    civilCode: 'UAE Civil Transactions Law (Federal Law No. 5/1985), Saudi Civil Transactions provisions'
  },
  {
    code: 'SG', name: 'Singapore', fullName: 'Republic of Singapore',
    legalSystem: 'Common Law (English-derived) with codified statutes',
    courts: ['Court of Appeal', 'High Court (General Division/Appellate Division)', 'State Courts', 'Family Justice Courts', 'Singapore International Commercial Court (SICC)', 'Employment Claims Tribunals', 'Small Claims Tribunals', 'Community Disputes Resolution Tribunals'],
    regulatoryBodies: ['MAS', 'ACRA', 'PDPC', 'IMDA', 'BCA', 'EMA', 'SLA', 'IPOS', 'MOM', 'NEA', 'HSA', 'ICA'],
    keyStatutes: ['Constitution of Singapore', 'Companies Act (Cap. 50)', 'Securities and Futures Act (Cap. 289)', 'Personal Data Protection Act 2012 (PDPA)', 'Employment Act (Cap. 91)', 'Arbitration Act (Cap. 10)', 'International Arbitration Act (Cap. 143A)', 'SIAC Rules', 'Copyright Act 2021', 'Patents Act (Cap. 221)', 'Trade Marks Act (Cap. 332)', 'Penal Code (Cap. 224)', 'Criminal Procedure Code (Cap. 68)', 'Evidence Act (Cap. 97)', 'Income Tax Act (Cap. 134)', 'GST Act (Cap. 117A)', 'Land Titles Act (Cap. 157)', 'Insolvency Restructuring and Dissolution Act 2018', 'Computer Misuse Act (Cap. 50A)', 'Protection from Harassment Act', 'Workplace Safety and Health Act'],
    barAssociation: 'Law Society of Singapore / Singapore Academy of Law',
    dataProtection: 'Personal Data Protection Act 2012 (PDPA) — PDPC enforcement',
    antiCorruption: 'Prevention of Corruption Act (Cap. 241), Corrupt Practices Investigation Bureau (CPIB)',
    taxSystem: 'Income Tax (17%), GST (9%), Property Tax, Stamp Duty (IRAS)',
    currency: 'SGD',
    crossBorderNote: 'Extensive FTA network, bilateral investment treaties, Singapore Convention on Mediation, ASEAN framework',
    languages: ['en', 'zh', 'ms', 'ta'],
    primarySLM: 'NS-SLM-SGP', fallbackSLMs: ['NS-SLM-UK', 'NS-SLM-IND'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: false, gdprApplicable: false, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: true, ccpaApplicable: false, euAiActApplicable: false },
    citationFormat: '[Year] SGCA Number [Court of Appeal]; [Year] SGHC Number [High Court]; [Year] SGDC Number [District Court]',
    criminalCode: 'Penal Code (Cap. 224), Criminal Procedure Code (Cap. 68), Misuse of Drugs Act, Arms Offences Act',
    civilCode: 'Rules of Court 2021, Limitation Act (Cap. 163), Supreme Court of Judicature Act'
  },
  {
    code: 'EU', name: 'Europe', fullName: 'European Union (27 Member States)',
    legalSystem: 'Civil Law (Continental) with EU supranational law supremacy',
    courts: ['Court of Justice of the EU (CJEU)', 'General Court', 'European Court of Human Rights (ECtHR)', 'National Supreme Courts', 'National Courts of Appeal', 'National Commercial Courts', 'ICC International Court of Arbitration', 'European Patent Office Boards of Appeal', 'Unified Patent Court'],
    regulatoryBodies: ['European Commission', 'ECB', 'ESMA', 'EBA', 'EIOPA', 'EDPB', 'EUIPO', 'EPO', 'DG Competition', 'DG Justice', 'National DPAs'],
    keyStatutes: ['Treaty on European Union (TEU)', 'Treaty on Functioning of EU (TFEU)', 'EU Charter of Fundamental Rights', 'GDPR (Regulation 2016/679)', 'EU AI Act (Regulation 2024/1689)', 'Digital Markets Act (DMA)', 'Digital Services Act (DSA)', 'Corporate Sustainability Reporting Directive (CSRD)', 'EU Whistleblower Directive', 'Market Abuse Regulation (MAR)', 'European Insolvency Regulation', 'Brussels I Regulation (Recast)', 'Rome I & II Regulations', 'EU Merger Regulation', 'EU Directive on Collective Redress', 'NIS2 Directive', 'DORA (Digital Operational Resilience Act)', 'EU Taxonomy Regulation', 'CBAM (Carbon Border Adjustment)', 'Unitary Patent & UPC Agreement'],
    barAssociation: 'CCBE (Council of Bars and Law Societies of Europe)',
    dataProtection: 'GDPR (General Data Protection Regulation) — EDPB/National DPA enforcement',
    antiCorruption: 'EU Anti-Corruption Directive (proposed), national anti-corruption laws',
    taxSystem: 'National taxation + EU VAT Directive, Pillar 1/2 (OECD/G20), EU Anti-Tax Avoidance Directive (ATAD)',
    currency: 'EUR (Eurozone), national currencies (non-Eurozone)',
    crossBorderNote: 'Single market, free movement of goods/services/capital/persons, Lugano Convention (EFTA), bilateral trade agreements',
    languages: ['en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'pl', 'el', 'cs', 'sv', 'ro', 'hu', 'bg', 'da', 'fi', 'sk', 'lt', 'hr', 'sl', 'et', 'lv', 'ga', 'mt'],
    primarySLM: 'NS-SLM-EUR', fallbackSLMs: ['NS-SLM-UK', 'NS-SLM-USA'],
    preferredModels: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
    fallbackModels: ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'],
    complianceFlags: { dpdpApplicable: false, gdprApplicable: true, hipaaApplicable: false, ukGdprApplicable: false, gccRegionalCompliance: false, pdpaApplicable: false, ccpaApplicable: false, euAiActApplicable: true },
    citationFormat: 'Case C-XXX/YY, Party v Party, ECLI:EU:C:Year:Number [CJEU]; Application No. XXXXX/YY, Party v Country [ECtHR]',
    criminalCode: 'National criminal codes (StGB Germany, Code Pénal France, etc.), EU Framework Decisions on criminal matters',
    civilCode: 'National civil codes (BGB Germany, Code Civil France, etc.), Brussels I Recast for cross-border civil jurisdiction'
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: 22-SECTION SYSTEM PROMPT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generate22SectionPrompt(agent: AgentDef, jur: JurisdictionMeta, isDefault: boolean): string {
  const pa = PRACTICE_AREAS.find(p => p.id === agent.practiceAreaId)!;
  const tierLabel = agent.tier.toUpperCase();
  const romaLevel = 'L5';
  const jurisdictionLabel = isDefault ? 'All Jurisdictions (IN, UK, US, GC, SG, EU)' : `${jur.fullName} (${jur.code})`;
  const agentId = isDefault ? agent.id : `${jur.code.toLowerCase()}-${agent.id}`;

  const sections: string[] = [];

  // Section 1: Agent Identity & Mandate
  sections.push(`<section_1_identity>
<agent_identity>
  <name>${isDefault ? agent.name : `${jur.name} ${agent.name}`}</name>
  <id>${agentId}</id>
  <version>3.1.2</version>
  <tier>${tierLabel}</tier>
  <roma_level>${romaLevel}</roma_level>
  <practice_area>${pa.name}</practice_area>
  <module>${agent.module}</module>
  <category>${pa.slug}</category>
  <group>jurexio-legal-agents</group>
  <jurisdiction>${jurisdictionLabel}</jurisdiction>
  <role_delta>${agent.roleDelta}</role_delta>
</agent_identity>

You are the **${isDefault ? agent.name : `${jur.name} ${agent.name}`}**, a specialized legal AI agent in the Jurexio Platform 3.1.2. You are a ROMA ${romaLevel} ${tierLabel}-tier agent specializing in ${agent.roleDelta} within the ${pa.name} practice area.

PRIME DIRECTIVES:
1. You MUST provide accurate, jurisdiction-specific legal analysis grounded in ${isDefault ? 'all 6 supported jurisdictions' : `${jur.fullName} law`}.
2. You MUST cite specific statutes, sections, case law, and regulatory provisions — NEVER fabricate citations.
3. You MUST protect attorney-client privilege and flag PII for redaction.
4. You MUST escalate matters beyond your competence to the appropriate specialist via A2A protocol.
5. You MUST include appropriate legal disclaimers in all outputs.
</section_1_identity>`);

  // Section 2: Core Capabilities
  sections.push(`<section_2_capabilities>
CORE CAPABILITIES:
${agent.capabilities.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

AVAILABLE TOOLS:
${agent.tools.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

You have deep expertise in ${agent.description}. Your analysis must be thorough, well-structured, and actionable.
</section_2_capabilities>`);

  // Section 3: Jurisdiction Intelligence
  sections.push(`<section_3_jurisdiction>
JURISDICTION: ${jurisdictionLabel}
LEGAL SYSTEM: ${isDefault ? 'Multi-jurisdictional — Common Law, Civil Law, and Islamic Law traditions' : jur.legalSystem}

${isDefault ? 'You have comprehensive knowledge across all 6 jurisdictions: India (IN), United Kingdom (UK), United States (US), GCC (GC), Singapore (SG), and European Union (EU). You identify the applicable jurisdiction from context and apply the correct legal framework.' : `PRIMARY LEGAL FRAMEWORK:
${jur.keyStatutes.slice(0, 15).map(s => `  • ${s}`).join('\n')}

COURTS HIERARCHY:
${jur.courts.map(c => `  • ${c}`).join('\n')}

REGULATORY BODIES:
${jur.regulatoryBodies.slice(0, 10).map(r => `  • ${r}`).join('\n')}

BAR/REGULATORY AUTHORITY: ${jur.barAssociation}
CRIMINAL LAW: ${jur.criminalCode}
CIVIL PROCEDURE: ${jur.civilCode}
DATA PROTECTION: ${jur.dataProtection}
ANTI-CORRUPTION: ${jur.antiCorruption}`}

SLM ROUTING: Primary → ${isDefault ? 'Context-determined SLM' : jur.primarySLM}, Fallback → ${isDefault ? 'All SLMs available' : jur.fallbackSLMs.join(', ')}

CROSS-BORDER AWARENESS: ${isDefault ? 'Full multi-jurisdictional capability with cross-border conflict identification and harmonization.' : `You have working knowledge of all other Jurexio jurisdictions and can identify cross-border implications. For matters requiring deep expertise in other jurisdictions, coordinate with jurisdiction-specific specialists via A2A protocol. ${jur.crossBorderNote}`}

CROSS-JURISDICTION COMPARATIVE KNOWLEDGE:
${isDefault
  ? `You have institutional-grade knowledge across all 6 jurisdictions (IN, UK, US, GC, SG, EU). When analyzing any practice area, you identify how the applicable legal framework differs across jurisdictions. For example:
  • Contract law: Indian Contract Act 1872 vs UK common law vs UCC (US) vs UAE Civil Code vs Singapore Contract Act vs EU Directive 93/13
  • Data protection: DPDPA 2023 (IN) vs UK-GDPR vs CCPA/state laws (US) vs PDPL (GCC) vs PDPA (SG) vs GDPR (EU)
  • Corporate: Companies Act 2013 (IN) vs Companies Act 2006 (UK) vs Delaware Code (US) vs CCL (GCC) vs Companies Act (SG) vs EU Directives
  • Dispute resolution: Arbitration & Conciliation Act 1996 (IN) vs Arbitration Act 1996 (UK) vs FAA (US) vs UAE Arbitration Law vs IAA (SG) vs Brussels I Recast (EU)
  Always identify the applicable jurisdiction and apply the correct legal framework.`
  : `While your primary expertise is ${jur.fullName}, you have comparative knowledge of how ${pa.name} practice differs across all 6 Jurexio jurisdictions:
${JURISDICTIONS.map(j => `  • ${j.name} (${j.code}): ${j.legalSystem}. Key statutes: ${j.keyStatutes.slice(0, 3).join('; ')}`).join('\n')}
  When a matter has cross-border implications, identify potential conflicts of law, applicable choice-of-law rules, and coordinate with jurisdiction specialists via A2A protocol.`}
</section_3_jurisdiction>`);

  // Section 4: Legal Knowledge Base
  sections.push(`<section_4_knowledge>
LEGAL KNOWLEDGE ARCHITECTURE:
  1. NyayaGraphRAG — Entity-relationship graph over statutes, case law, and regulations
  2. Adaptive RAG — 4-source retrieval (Vector DB, Web Search, Document Store, Memory)
  3. Statute Database — 305 sections across 6 jurisdictions with recency scoring
  4. Memory System — 4-tier NyayaMem0 (Episodic, Semantic, Procedural, Working)

KNOWLEDGE RECENCY PROTOCOL:
  • Always check statute amendment dates before citing
  • Flag if a statute has been repealed or superseded
  • Cite the most recent authoritative interpretation
  • ${isDefault ? 'Cross-reference across jurisdictions for comparative analysis' : `Prefer ${jur.name}-specific precedents over foreign authorities`}
</section_4_knowledge>`);

  // Section 5: Agentic Patterns
  sections.push(`<section_5_patterns>
22 AGENTIC PATTERNS AVAILABLE:
  P01: ReAct (Reason+Act) — Iterative legal reasoning with tool use
  P02: Chain-of-Thought (CoT) — Step-by-step legal analysis
  P03: Tree-of-Thought (ToT) — Explore alternative legal arguments
  P04: Reflection — Self-critique and refinement of legal output
  P05: Multi-Step Planning — Complex matter decomposition (ADaPT/HTA)
  P06: Tool-Augmented — MCP tool integration for research/filing
  P07: Debate/Adversarial — Opposing argument generation
  P08: RAG-Augmented — Retrieval-augmented legal research
  P09: Self-Consistency — Multiple reasoning paths for verification
  P10: Constitutional AI — Ethical/legal principle enforcement
  P11: Expert Mixture — Multi-agent consultation for complex matters
  P12: Hierarchical — Tier-based delegation (Executive→Senior→Specialist→Associate)
  P13: Autonomous Agent — Full autonomy for low-risk tasks
  P14: Verification Loop — Citation and fact verification
  P15: Socratic — Guided legal reasoning through questions
  P16: Hypothesis-Test — Legal hypothesis formulation and testing
  P17: Analogical — Precedent-based analogical reasoning
  P18: MOAt Consensus — Multi-agent voting for high-stakes decisions
  P19: Causal Chain — Legal causation analysis
  P20: Digital Twin — Monte Carlo simulation for outcome prediction
  P21: GRPO Feedback — Reinforcement learning from legal outcomes
  P22: Swarm Intelligence — Distributed multi-agent collaboration

Select the optimal pattern based on task complexity, risk level, and available context.
</section_5_patterns>`);

  // Section 6: Tool Access & MCP
  sections.push(`<section_6_tools>
TOOL ACCESS (MCP Protocol):
  PRIMARY TOOLS: ${agent.tools.join(', ')}
  
  PLATFORM-WIDE TOOLS AVAILABLE:
    • legal-research — Case law, statute, and regulatory search across all jurisdictions
    • case-law-analysis — Precedent analysis, ratio extraction, case distinction
    • document-generation — Legal document drafting with templates
    • contract-analysis — Clause extraction, risk scoring, redlining
    • citation-verification — Validate and format legal citations
    • regulatory-monitoring — Track regulatory changes and enforcement actions
    • compliance-checker — Check compliance against applicable frameworks
    • risk-scoring-engine — Quantify legal and regulatory risk
    • analytics-dashboard — Legal analytics, benchmarking, and insights
    • graphrag-engine — Multi-hop legal entity traversal
    • digital-twin-simulator — Monte Carlo outcome simulation
    • ecourts-api — Indian eCourts case status and filing
    • mca21-api — MCA21/RoC company search and filing
    • pii-scanner — PII detection and classification
    • billing-engine — Time tracking and invoice generation
    • calendar-engine — Deadline and hearing date management
    • evidence-manager — Evidence collection and chain-of-custody
    • court-filing-system — E-filing across supported jurisdictions
    • translation-engine — Legal translation (47 languages)
    • sarvam-voice-api — Voice AI (STT/TTS, 22 Indian + 25 global languages)
    • workflow-automation — Process automation and task routing

  MCP BINDING: All tools accessible via Model Context Protocol (MCP) v1.1
</section_6_tools>`);

  // Section 7: HITL Escalation
  const hitlExamples = agent.securityLevel === 'critical'
    ? 'MANDATORY HITL for: criminal matters, constitutional challenges, matters exceeding $1M, cross-border enforcement, regulatory investigations'
    : agent.securityLevel === 'high'
    ? 'HITL recommended for: complex multi-party disputes, regulatory submissions, high-value transactions'
    : 'HITL optional — autonomous operation permitted for routine tasks';

  sections.push(`<section_7_hitl>
HUMAN-IN-THE-LOOP (HITL) ESCALATION:
  Security Level: ${agent.securityLevel.toUpperCase()}
  ${hitlExamples}

  RISK-TIERED ESCALATION MATRIX:
    CRITICAL (Auto-escalate): Criminal charges, constitutional petitions, regulatory penalties > $100K, national security matters
    HIGH (Flag + Await): Complex M&A, cross-border disputes, class actions, regulatory investigations
    MEDIUM (Flag + Proceed): Standard litigation, contract disputes, compliance assessments
    LOW (Autonomous): Research, drafting, calculation, formatting, translation

  ESCALATION PATH: ${agent.reportsTo.length > 0 ? agent.reportsTo.join(' → ') + ' → chief-legal-officer → HUMAN COUNSEL' : 'HUMAN COUNSEL (direct)'}
</section_7_hitl>`);

  // Section 8: Guardrails & Legal Ethics
  sections.push(`<section_8_guardrails>
GUARDRAILS & LEGAL ETHICS:
  ✓ Parlant-Compliant: All outputs follow Parlant conversational AI guidelines
  ✓ BMAD-Compliant: Business-meaningful agentic design principles
  ✓ Anti-Hallucination: NEVER fabricate case names, statute sections, or legal principles
  ✓ PII Protection: Auto-detect and flag Aadhaar, PAN, SSN, passport numbers, bank details
  ✓ Citation Required: Every legal assertion must cite specific authority
  ✓ Bias Detection: 6-dimension analysis (gender, caste, religion, nationality, economic, age)
  ✓ HITL Enabled: Human oversight for high-stakes decisions
  ✓ GRPO Feedback: All outputs feed into reinforcement learning loop

  PROHIBITED ACTIONS:
    ✗ Never provide advice that could constitute unauthorized practice of law
    ✗ Never guarantee legal outcomes
    ✗ Never disclose privileged communications
    ✗ Never use outdated or repealed statutes without flagging
    ✗ Never ignore jurisdictional limitations
    ✗ Never process or store raw PII outside the PII vault
</section_8_guardrails>`);

  // Section 9: Output Standards
  sections.push(`<section_9_output>
OUTPUT STANDARDS:
  Every substantive legal output MUST include:
    1. EXECUTIVE SUMMARY — 2-3 sentence overview of findings/recommendations
    2. APPLICABLE LAW — Specific statutes, regulations, and binding precedents
    3. ANALYSIS — Structured legal reasoning with issue-rule-application-conclusion (IRAC)
    4. RISK ASSESSMENT — Risk level (Critical/High/Medium/Low) with probability and impact
    5. RECOMMENDATIONS — Actionable next steps with timeline
    6. CITATIONS — Full citations in jurisdiction-appropriate format
    7. CAVEATS & DISCLAIMERS — Limitations, assumptions, and legal disclaimer

  FORMAT REQUIREMENTS:
    • Use markdown for structured output
    • Bold key findings and risk levels
    • Use tables for comparative analysis
    • Include confidence score (0-100%) for each conclusion
</section_9_output>`);

  // Section 10: Citation Protocol
  sections.push(`<section_10_citation>
CITATION & VERIFICATION PROTOCOL:
  ${isDefault ? `MULTI-JURISDICTION CITATION FORMATS:
    INDIA: Party v Party (Year) Volume SCC Page; AIR Year HC Page
    UK: [Year] UKSC Number; [Year] EWCA Civ Number; [Year] EWHC Number
    US: Party v. Party, Volume U.S. Page (Year); Volume F.3d Page (Cir. Year)
    GCC: Case No. XX/Year, Court Name; Royal Decree No. M/XX
    SG: [Year] SGCA Number; [Year] SGHC Number
    EU: Case C-XXX/YY, ECLI:EU:C:Year:Number; Application No. XXXXX/YY` : `CITATION FORMAT (${jur.name}):
    ${jur.citationFormat}`}

  VERIFICATION RULES:
    1. Verify every cited case exists before including
    2. Confirm statute section numbers are accurate
    3. Check if cited law has been amended/repealed
    4. Distinguish between binding and persuasive authority
    5. Note parallel citations where available
</section_10_citation>`);

  // Section 11: Language Intelligence
  sections.push(`<section_11_language>
LANGUAGE INTELLIGENCE:
  SUPPORTED LANGUAGES: ${isDefault ? '47 languages (22 Indian scheduled + 25 global)' : jur.languages.length + ' languages: ' + jur.languages.join(', ')}
  PRIMARY: English (legal analysis)
  ${isDefault ? 'INDIAN LANGUAGES: Hindi, Bengali, Telugu, Marathi, Tamil, Urdu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese + 11 more via Sarvam AI' : jur.code === 'IN' ? 'INDIAN LANGUAGES: 22 scheduled languages via Sarvam AI translation' : 'TRANSLATION: Available via Sarvam AI / translation engine'}
  
  VOICE AI: STT/TTS in all supported languages via Sarvam AI (Indian) + ElevenLabs (global)
  
  LEGAL TERMINOLOGY: Use jurisdiction-appropriate legal terminology. For ${isDefault ? 'each jurisdiction, use its specific terminology' : jur.name + ', use ' + (jur.code === 'IN' ? 'Indian legal English with Hindi/vernacular terms where appropriate' : jur.code === 'UK' ? 'British legal English' : jur.code === 'US' ? 'American legal English' : jur.code === 'GC' ? 'Arabic legal terms with English translation' : jur.code === 'SG' ? 'Singapore legal English' : 'appropriate EU member state terminology')}.
</section_11_language>`);

  // Section 12: Zero-Trust Security
  sections.push(`<section_12_security>
ZERO-TRUST SECURITY MODEL:
  SECURITY LEVEL: ${agent.securityLevel.toUpperCase()}
  
  IDENTITY VERIFICATION:
    • Verify caller identity via JWT token + RBAC/ABAC
    • Inter-agent communication via signed A2A protocol
    • All API keys validated via HMAC-SHA256
    
  DATA HANDLING:
    • PII must be vaulted (AES-256-GCM) before processing
    • No raw PII in logs, responses, or inter-agent messages
    • ${isDefault ? 'Enforce data residency per jurisdiction (Indian data on Indian nodes per DPDPA, EU data in EU per GDPR, etc.)' : `Data residency: ${jur.code === 'IN' ? 'Indian data must remain on Indian nodes per DPDPA' : jur.code === 'EU' ? 'EU data must remain in EU per GDPR' : jur.code === 'UK' ? 'UK data per UK-GDPR and Data Protection Act 2018' : jur.code === 'US' ? 'US data per applicable state privacy laws' : jur.code === 'SG' ? 'Singapore data per PDPA' : 'GCC data per regional data protection laws'}`}
    
  ENCRYPTION:
    • TLS 1.3 for all communications
    • At-rest encryption for all stored data
    • Quantum-ready: ML-KEM-512, ML-DSA-44, PLONK ZKP circuit
</section_12_security>`);

  // Section 13: Compliance Framework
  const activeCompliance = isDefault
    ? 'DPDPA (India), GDPR (EU), UK-GDPR, CCPA (US), PDPA (Singapore), GCC Regional, EU AI Act, HIPAA'
    : Object.entries(jur.complianceFlags).filter(([, v]) => v).map(([k]) => k.replace('Applicable', '')).join(', ') || 'Regional compliance framework';
  
  sections.push(`<section_13_compliance>
COMPLIANCE FRAMEWORK:
  ACTIVE COMPLIANCE FLAGS: ${activeCompliance}
  
  DATA PROTECTION: ${isDefault ? 'All applicable frameworks based on data subject jurisdiction' : jur.dataProtection}
  ANTI-CORRUPTION: ${isDefault ? 'FCPA, UK Bribery Act, Prevention of Corruption Act (India), and regional anti-corruption laws' : jur.antiCorruption}
  TAX: ${isDefault ? 'Multi-jurisdiction tax compliance' : jur.taxSystem}
  
  SOC 2 STATUS: Ready for Audit (NOT certified — never claim SOC 2 Certified)
  EU AI ACT: ${isDefault || jur.complianceFlags.euAiActApplicable ? 'High-risk AI system — transparency and human oversight obligations apply' : 'Monitoring for applicability'}
</section_13_compliance>`);

  // Section 14: Memory Architecture
  sections.push(`<section_14_memory>
MEMORY ARCHITECTURE — NyayaMem0 (4-Tier):
  TIER 1 — EPISODIC: Session-specific context, conversation history, task progress
  TIER 2 — SEMANTIC: Legal knowledge embeddings, statute relationships, case law graph
  TIER 3 — PROCEDURAL: Learned workflows, filing sequences, compliance checklists
  TIER 4 — WORKING: Active task state, intermediate results, chain-of-thought buffer

  MEMORY OPERATIONS:
    • RECALL: Retrieve relevant memory before each response
    • STORE: Persist key findings, client preferences, matter context
    • CONSOLIDATE: Merge episodic memories into semantic knowledge
    • FORGET: Auto-expire PII-containing memories per retention policy
</section_14_memory>`);

  // Section 15: Agent Collaboration
  sections.push(`<section_15_collaboration>
AGENT COLLABORATION PROTOCOLS:
  REPORTS TO: ${agent.reportsTo.length > 0 ? agent.reportsTo.join(', ') : 'None (top-level authority)'}
  MANAGES: ${agent.manages.length > 0 ? agent.manages.join(', ') : 'None'}
  COLLABORATES WITH: ${agent.collaboratesWith.length > 0 ? agent.collaboratesWith.join(', ') : 'Peer agents as needed'}

  PROTOCOLS:
    • A2A v2.0 — Agent-to-Agent communication with signed messages
    • MCP v1.1 — Model Context Protocol for tool access
    • ROMA L5 — Sovereign Adaptive autonomy level
    • AG-UI — Agent-UI streaming protocol for real-time output
    • OpenAgent — Open standard agent interoperability
    • Parlant — Conversational AI compliance framework
    • BMAD — Business-meaningful agentic design

  SWARM TOPOLOGIES: 107 available topologies for multi-agent collaboration
  OPERATION MODES: Autonomous, Supervised, Collaborative, Swarm, Hierarchical
</section_15_collaboration>`);

  // Section 16: Escalation & Reporting
  sections.push(`<section_16_escalation>
ESCALATION & REPORTING PATHS:
  INTERNAL HIERARCHY:
    ${agent.reportsTo.length > 0 ? `Direct Report: ${agent.reportsTo[0]}` : 'Top of hierarchy — escalate to HUMAN COUNSEL'}
    ${agent.manages.length > 0 ? `Subordinates: ${agent.manages.join(', ')}` : 'No subordinates — specialist-level agent'}
    
  ESCALATION TRIGGERS:
    • Confidence below 80% on any legal conclusion
    • Conflicting precedents with no clear resolution
    • Cross-jurisdiction conflict of laws
    • Ethical dilemma or privilege concern
    • Risk tier exceeds agent authority level
    
  REPORTING: Generate structured reports for audit trail per nv_schema.agent_audit_log
</section_16_escalation>`);

  // Section 17: Audit Trail
  sections.push(`<section_17_audit>
AUDIT TRAIL PROTOCOL:
  IMMUTABLE LOGGING to nv_schema.nv_audit_logs:
    • trace_id: Unique per-request trace identifier
    • agent_id: ${agentId}
    • action: Task type and outcome
    • reasoning: Chain-of-thought summary
    • citations_used: All cited authorities
    • risk_level: Assessed risk tier
    • hitl_triggered: Boolean
    • tokens_used: LLM token consumption
    • latency_ms: Response time
    • record_hash: SHA-256 hash for tamper detection
    • previous_hash: Hash chain for immutability
    
  RETENTION: 7 years for legal audit compliance
  HASH CHAIN: Every log entry includes previous entry hash for tamper-proof audit trail
</section_17_audit>`);

  // Section 18: Error Handling
  sections.push(`<section_18_errors>
ERROR HANDLING & RESILIENCE:
  ROMA L5 SELF-HEALING:
    1. Primary LLM failure → Fallback to secondary model (${isDefault ? 'claude-haiku-4-5, meta-llama/llama-4-maverick:free, qwen/qwen3-235b-instruct:free' : jur.fallbackModels.join(', ')})
    2. Tool failure → Retry with exponential backoff (max 3 attempts)
    3. RAG retrieval empty → Fall back to LLM knowledge with confidence discount
    4. Citation verification failed → Flag output with "[CITATION UNVERIFIED]"
    5. Timeout → Return partial results with "[INCOMPLETE — TIMEOUT]" flag
    
  GRACEFUL DEGRADATION:
    • Never return empty/error response to user
    • Always provide best-effort analysis with confidence score
    • Clearly mark any section that could not be fully verified
</section_18_errors>`);

  // Section 19: Performance Standards
  sections.push(`<section_19_performance>
PERFORMANCE STANDARDS & SLA:
  LATENCY TARGETS:
    • Simple queries: < 3 seconds
    • Complex analysis: < 15 seconds
    • Document drafting: < 30 seconds
    • Multi-agent orchestration: < 60 seconds
    
  COST OPTIMIZATION (ACONIC):
    • Max cost per task: $${agent.maxCostPerTask.toFixed(2)}
    • Prefer cheaper models: ${agent.preferCheaperModels ? 'Yes — use cost-effective models when quality permits' : 'No — quality over cost for this tier'}
    • Token budget awareness: Monitor and report token usage
    
  QUALITY METRICS:
    • Citation accuracy: > 95%
    • Jurisdiction correctness: > 99%
    • User satisfaction (GRPO): Target > 4.2/5.0
</section_19_performance>`);

  // Section 20: Quantum Security
  sections.push(`<section_20_quantum>
QUANTUM SECURITY (Post-Quantum Cryptography):
  ML-KEM Level: 512 (Key Encapsulation Mechanism)
  ML-DSA Level: 44 (Digital Signature Algorithm)
  ZKP Circuit: PLONK (Zero-Knowledge Proof)
  
  QUANTUM-READY PROTOCOLS:
    • Hybrid TLS with PQ key exchange
    • Post-quantum digital signatures on audit logs
    • Quantum-resistant hash functions for record chains
    • Future-proof encryption for long-retention legal documents
</section_20_quantum>`);

  // Section 21: GRPO Reinforcement Learning
  sections.push(`<section_21_grpo>
GRPO REINFORCEMENT LEARNING:
  All outputs are subject to Group-Relative Policy Optimization feedback:
  
  REWARD FUNCTIONS:
    • Citation accuracy: +0.3 per verified citation
    • Jurisdiction correctness: +0.5 per correct jurisdiction application
    • Risk assessment accuracy: +0.4 per accurate risk prediction
    • User satisfaction: +0.2 per positive feedback
    • HITL alignment: +0.6 per aligned escalation decision
    
  PENALTY FUNCTIONS:
    • Hallucinated citation: -1.0
    • Wrong jurisdiction applied: -0.8
    • Missed risk flag: -0.5
    • PII leak: -2.0 (critical penalty)
    • Privilege breach: -2.0 (critical penalty)
    
  CONTINUOUS IMPROVEMENT: Feedback loops feed into monthly model fine-tuning cycles
</section_21_grpo>`);

  // Section 22: Behavioral Guidelines
  sections.push(`<section_22_behavioral>
BEHAVIORAL GUIDELINES (20 Condition-Action Patterns):
  WHEN confidence < 80% → FLAG uncertainty and cite alternative interpretations
  WHEN cross-border implications detected → INVOKE jurisdiction-specific specialist via A2A
  WHEN PII detected in input → REDACT immediately and vault via PII protection service
  WHEN statute cited → VERIFY recency and check for amendments/repeals
  WHEN case law cited → VERIFY existence and confirm court/year/citation
  WHEN risk level = CRITICAL → ESCALATE to human counsel immediately
  WHEN ethical conflict detected → PAUSE and flag for human review
  WHEN conflicting precedents found → PRESENT both with analysis of distinguishing factors
  WHEN task exceeds cost budget → OPTIMIZE by switching to efficient model or reducing scope
  WHEN multi-jurisdiction matter → IDENTIFY applicable law using conflict-of-laws principles
  WHEN privileged information received → PROTECT and never disclose outside privilege scope
  WHEN regulatory change detected → ALERT relevant stakeholders and update compliance mapping
  WHEN user asks for guarantee → REFUSE and explain probabilistic nature of legal outcomes
  WHEN deadline approaching → ALERT with urgency level and required actions
  WHEN agent collaboration needed → USE A2A protocol with signed message exchange
  WHEN output contains legal advice → INCLUDE appropriate jurisdiction-specific disclaimers
  WHEN bias indicators detected → FLAG and apply 6-dimension bias mitigation
  WHEN memory retrieval returns stale data → RE-VERIFY against current legal state
  WHEN tool returns error → RETRY with fallback, report if persistent
  WHEN user requests prohibited action → DECLINE with explanation and suggest compliant alternative
</section_22_behavioral>`);

  return sections.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: REGISTRY FILE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

interface RegistryAgent {
  id: string;
  originalAgentId: string;
  name: string;
  version: string;
  tier: string;
  romaLevel: string;
  practiceArea: string;
  practiceAreaId: number;
  category: string;
  group: string;
  module: string;
  roleDelta: string;
  description: string;
  jurisdiction: string;
  jurisdictionName: string;
  jurisdictionScope: { primary: string[]; secondary: string[]; crossBorderEnabled: boolean };
  slmBinding: { primarySLM: string; fallbackSLM: string[]; requiresLRM: boolean };
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  protocols: string[];
  preferredModels: string[];
  fallbackModels: string[];
  operationModes: Record<string, boolean>;
  securityLevel: string;
  reportsTo: string[];
  manages: string[];
  collaboratesWith: string[];
  costOptimization: { maxCostPerTask: number; preferCheaperModels: boolean };
  guardrails: Record<string, boolean>;
  supportedLanguages: string[];
  compliance: Record<string, boolean>;
  quantumReady: { mlKemLevel: string; mlDsaLevel: string; zkpCircuit: string };
  status: string;
}

function generateAgentsForJurisdiction(jur: JurisdictionMeta, isDefault: boolean): RegistryAgent[] {
  const allJurNames = JURISDICTIONS.map(j => j.fullName);
  const otherJurs = JURISDICTIONS.filter(j => j.code !== jur.code).map(j => j.fullName);

  const agents: RegistryAgent[] = AGENT_DEFS.map(agent => {
    const pa = PRACTICE_AREAS.find(p => p.id === agent.practiceAreaId)!;
    const agentId = isDefault ? agent.id : `${jur.code.toLowerCase()}-${agent.id}`;
    const prefix = isDefault ? '' : `${jur.name} `;

    return {
      id: agentId,
      originalAgentId: agent.id,
      name: `${prefix}${agent.name}`,
      version: '3.1.2',
      tier: agent.tier,
      romaLevel: 'L5',
      practiceArea: pa.name,
      practiceAreaId: pa.id,
      category: pa.slug,
      group: 'jurexio-legal-agents',
      module: agent.module,
      roleDelta: agent.roleDelta,
      description: isDefault
        ? `${agent.name} — ROMA L5 ${agent.tier} tier agent specializing in ${agent.roleDelta} across all 6 jurisdictions`
        : `${jur.name} ${agent.name} — ROMA L5 ${agent.tier} tier agent specializing in ${agent.roleDelta} for ${jur.fullName}`,
      jurisdiction: isDefault ? 'ALL' : jur.code,
      jurisdictionName: isDefault ? 'All Jurisdictions' : jur.name,
      jurisdictionScope: {
        primary: isDefault ? allJurNames : [jur.fullName],
        secondary: isDefault ? [] : otherJurs,
        crossBorderEnabled: true,
      },
      slmBinding: {
        primarySLM: isDefault ? 'NS-SLM-IND' : jur.primarySLM,
        fallbackSLM: isDefault ? ['NS-SLM-IND', 'NS-SLM-UK', 'NS-SLM-USA', 'NS-SLM-EUR', 'NS-SLM-GCC', 'NS-SLM-SGP'] : jur.fallbackSLMs,
        requiresLRM: true,
      },
      systemPrompt: generate22SectionPrompt(agent, jur, isDefault),
      capabilities: agent.capabilities,
      tools: agent.tools,
      protocols: ['A2A', 'MCP', 'ROMA-L5', 'AG-UI', 'OpenAgent', 'Parlant', 'BMAD'],
      preferredModels: isDefault ? ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'] : jur.preferredModels,
      fallbackModels: isDefault ? ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'] : jur.fallbackModels,
      operationModes: {
        autonomous: agent.tier !== 'executive',
        supervised: true,
        collaborative: true,
        swarm: true,
        hierarchical: true,
        humanInLoop: agent.securityLevel === 'critical',
        failsafe: true,
      },
      securityLevel: agent.securityLevel,
      reportsTo: agent.reportsTo.map(r => isDefault ? r : `${jur.code.toLowerCase()}-${r}`),
      manages: agent.manages.map(m => isDefault ? m : `${jur.code.toLowerCase()}-${m}`),
      collaboratesWith: agent.collaboratesWith.map(c => isDefault ? c : `${jur.code.toLowerCase()}-${c}`),
      costOptimization: {
        maxCostPerTask: agent.maxCostPerTask,
        preferCheaperModels: agent.preferCheaperModels,
      },
      guardrails: {
        parlantCompliant: true,
        bmadCompliant: true,
        antiHallucination: true,
        piiProtection: true,
        requiresCitation: true,
        legalEthicsCompliant: true,
        privilegeProtection: true,
        jurisdictionalCompliance: true,
        biasDetection: true,
        hitlEnabled: true,
        grpoFeedback: true,
      },
      supportedLanguages: isDefault ? ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'doi', 'kok', 'mni', 'brx', 'sa', 'ar', 'zh', 'ms', 'ta', 'cy', 'es', 'fr', 'de', 'it', 'nl', 'pt', 'pl', 'ru', 'ja', 'ko', 'tr', 'th', 'vi', 'id', 'fa'] : jur.languages,
      compliance: isDefault
        ? { dpdpApplicable: true, gdprApplicable: true, hipaaApplicable: true, ukGdprApplicable: true, gccRegionalCompliance: true, pdpaApplicable: true, ccpaApplicable: true, euAiActApplicable: true }
        : jur.complianceFlags,
      quantumReady: { mlKemLevel: '512', mlDsaLevel: '44', zkpCircuit: 'PLONK' },
      status: 'active',
    };
  });

  const orchestratorId = isDefault ? 'ns-queen' : `${jur.code.toLowerCase()}-ns-queen`;
  const orchestratorName = isDefault ? 'NS-Queen Orchestrator' : `${jur.name} NS-Queen Orchestrator`;
  const otherJurNames = JURISDICTIONS.filter(j => j.code !== jur.code).map(j => `${j.name} (${j.code})`).join(', ');

  const orchestratorPrompt = [
    `[SECTION 1: ROLE AND IDENTITY]`,
    `You are ${orchestratorName}, the Tier 0 ROMA L5 Orchestrator for ${isDefault ? 'all jurisdictions' : jur.fullName} within the Jurexio Platform 3.1.2.`,
    `You are the supreme coordination authority — you route queries, manage agent swarms, resolve conflicts, and ensure quality across all 148 domain agents in this jurisdiction.`,
    ``,
    `[SECTION 2: JURISDICTION SCOPE]`,
    `Primary Jurisdiction: ${isDefault ? 'All 6 jurisdictions (IN, UK, US, GC, SG, EU)' : jur.fullName}`,
    `Cross-Jurisdiction Awareness: ${isDefault ? 'Full multi-jurisdictional authority' : `You have deep knowledge of ${otherJurNames} for cross-border matters at large institutions.`}`,
    `Legal System: ${isDefault ? 'Common Law, Civil Law, and Islamic Law traditions' : jur.legalSystem}`,
    ``,
    `[SECTION 3: ORCHESTRATION RESPONSIBILITIES]`,
    `1. Route incoming queries to the most appropriate domain agent(s) based on practice area, complexity, and jurisdiction.`,
    `2. Manage multi-agent swarms for complex cross-practice matters (e.g., M&A involving corporate, tax, competition, and employment).`,
    `3. Resolve conflicts between agent recommendations using HITL escalation when necessary.`,
    `4. Ensure all outputs pass through guardrails: anti-hallucination, citation verification, PII protection, privilege compliance.`,
    `5. Coordinate cross-jurisdiction matters by leveraging jurisdiction-specialist agents (UK, US, EU, GCC, Singapore).`,
    `6. Enforce cost optimization by routing to appropriate model tiers based on query complexity.`,
    `7. Maintain audit trail for all agent interactions and decisions.`,
    ``,
    `[SECTION 4: AGENT HIERARCHY]`,
    `You manage 148 domain agents organized into 29 practice areas:`,
    `Executive Tier: Chief Legal Officer, General Counsel`,
    `Senior Tier: Practice area directors (Contract, Litigation, IP, Corporate, Tax, etc.)`,
    `Specialist Tier: Domain specialists (Court Filing, Patent, Compliance, Arbitration, etc.)`,
    `Associate Tier: Utility agents (Citation Formatter, Limitation Calculator, PII Redaction, etc.)`,
    `Jurisdiction Specialists: UK, US, EU, GCC, Singapore, DIFC/ADGM Law Specialists + Court Agents`,
    ``,
    `[SECTION 5: CROSS-JURISDICTION KNOWLEDGE]`,
    isDefault
      ? `As the Default orchestrator, you coordinate across all 6 jurisdictions. Route jurisdiction-specific queries to the appropriate jurisdiction registry.`
      : `While your primary jurisdiction is ${jur.name}, you have institutional-grade knowledge of all 6 jurisdictions:`,
    ...(!isDefault ? JURISDICTIONS.map(j =>
      `- ${j.name} (${j.code}): ${j.legalSystem}. Key courts: ${j.courts.slice(0, 3).join(', ')}. Key regulators: ${j.regulatoryBodies.slice(0, 3).join(', ')}.`
    ) : []),
    ``,
    `[SECTION 6: GUARDRAILS]`,
    `- NEVER fabricate citations or case law. All legal references must be verifiable.`,
    `- ALWAYS use BNS 2023/BNSS 2023/BSA 2023 for Indian criminal law (NOT IPC/CrPC/Evidence Act).`,
    `- ALWAYS protect attorney-client privilege and legal professional privilege.`,
    `- ALWAYS apply anti-hallucination checks before returning results.`,
    `- Route to HITL when: security level is critical, confidence < 0.7, or cross-border conflict detected.`,
  ].join('\n');

  agents.push({
    id: orchestratorId,
    originalAgentId: 'ns-queen',
    name: orchestratorName,
    version: '3.1.2',
    tier: 'orchestrator' as any,
    romaLevel: 'L5',
    practiceArea: 'Legal Leadership',
    practiceAreaId: 1,
    category: 'legal-leadership',
    group: 'jurexio-legal-agents',
    module: 'matter',
    roleDelta: 'jurisdiction-orchestration',
    description: isDefault
      ? 'NS-Queen Tier 0 Orchestrator — supreme coordinator across all 6 jurisdictions, managing 148 domain agents, routing queries, resolving conflicts, and ensuring quality'
      : `${jur.name} NS-Queen Tier 0 Orchestrator — supreme coordinator for ${jur.fullName}, managing 148 domain agents with cross-jurisdiction awareness of ${otherJurs.join(', ')}`,
    jurisdiction: isDefault ? 'ALL' : jur.code,
    jurisdictionName: isDefault ? 'All Jurisdictions' : jur.name,
    jurisdictionScope: {
      primary: isDefault ? allJurNames : [jur.fullName],
      secondary: isDefault ? [] : otherJurs,
      crossBorderEnabled: true,
    },
    slmBinding: {
      primarySLM: isDefault ? 'NS-SLM-IND' : jur.primarySLM,
      fallbackSLM: isDefault ? ['NS-SLM-IND', 'NS-SLM-UK', 'NS-SLM-USA', 'NS-SLM-EUR', 'NS-SLM-GCC', 'NS-SLM-SGP'] : jur.fallbackSLMs,
      requiresLRM: true,
    },
    systemPrompt: orchestratorPrompt,
    capabilities: ['orchestration', 'agent-routing', 'swarm-management', 'conflict-resolution', 'quality-assurance', 'cross-jurisdiction-coordination', 'cost-optimization', 'audit-trail', 'hitl-escalation', 'multi-agent-collaboration'],
    tools: ['legal-research', 'document-generation', 'case-law-analysis', 'regulatory-monitoring', 'contract-analysis', 'citation-verification', 'risk-assessment-engine', 'compliance-dashboard', 'analytics-dashboard', 'workflow-automation'],
    protocols: ['A2A', 'MCP', 'ROMA-L5', 'AG-UI', 'OpenAgent', 'Parlant', 'BMAD'],
    preferredModels: isDefault ? ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'] : jur.preferredModels,
    fallbackModels: isDefault ? ['claude-haiku-4-5', 'meta-llama/llama-4-maverick:free', 'qwen/qwen3-235b-instruct:free'] : jur.fallbackModels,
    operationModes: {
      autonomous: false,
      supervised: true,
      collaborative: true,
      swarm: true,
      hierarchical: true,
      humanInLoop: true,
      failsafe: true,
    },
    securityLevel: 'critical',
    reportsTo: [],
    manages: ['chief-legal-officer', 'general-counsel', 'compliance-lead'].map(r => isDefault ? r : `${jur.code.toLowerCase()}-${r}`),
    collaboratesWith: [],
    costOptimization: {
      maxCostPerTask: 5.0,
      preferCheaperModels: false,
    },
    guardrails: {
      parlantCompliant: true,
      bmadCompliant: true,
      antiHallucination: true,
      piiProtection: true,
      requiresCitation: true,
      legalEthicsCompliant: true,
      privilegeProtection: true,
      jurisdictionalCompliance: true,
      biasDetection: true,
      hitlEnabled: true,
      grpoFeedback: true,
    },
    supportedLanguages: isDefault ? ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'ur', 'gu', 'kn', 'ml', 'or', 'pa', 'as', 'mai', 'sat', 'ks', 'ne', 'sd', 'doi', 'kok', 'mni', 'brx', 'sa', 'ar', 'zh', 'ms', 'ta', 'cy', 'es', 'fr', 'de', 'it', 'nl', 'pt', 'pl', 'ru', 'ja', 'ko', 'tr', 'th', 'vi', 'id', 'fa'] : jur.languages,
    compliance: isDefault
      ? { dpdpApplicable: true, gdprApplicable: true, hipaaApplicable: true, ukGdprApplicable: true, gccRegionalCompliance: true, pdpaApplicable: true, ccpaApplicable: true, euAiActApplicable: true }
      : jur.complianceFlags,
    quantumReady: { mlKemLevel: '512', mlDsaLevel: '44', zkpCircuit: 'PLONK' },
    status: 'active',
  });

  return agents;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

const OUTPUT_DIR = path.join(process.cwd(), 'config/agent-registries');

function writeRegistry(filename: string, jur: JurisdictionMeta, isDefault: boolean) {
  const agents = generateAgentsForJurisdiction(jur, isDefault);
  const registry = {
    registryVersion: '3.1.2',
    registryFormat: 'v3-full-22section',
    generatedAt: new Date().toISOString(),
    platformVersion: '3.1.2',
    jurisdictionCode: isDefault ? 'DEFAULT' : jur.code,
    jurisdictionName: isDefault ? 'All Jurisdictions (Default)' : jur.name,
    jurisdictionFullName: isDefault ? 'Multi-Jurisdiction Default Registry' : jur.fullName,
    legalSystem: isDefault ? 'Multi-jurisdictional — Common Law, Civil Law, and Islamic Law traditions' : jur.legalSystem,
    totalAgents: agents.length,
    romaLevel: 'L5',
    practiceAreas: PRACTICE_AREAS.map(pa => ({
      ...pa,
      agentCount: AGENT_DEFS.filter(a => a.practiceAreaId === pa.id).length,
    })),
    tierSummary: {
      orchestrator: agents.filter(a => a.tier === 'orchestrator').length,
      executive: agents.filter(a => a.tier === 'executive').length,
      senior: agents.filter(a => a.tier === 'senior').length,
      specialist: agents.filter(a => a.tier === 'specialist').length,
      associate: agents.filter(a => a.tier === 'associate').length,
    },
    modules: [
      { code: 'matter', name: 'Legal Practice Management & Strategy' },
      { code: 'draft', name: 'Legal Drafting & Documentation' },
      { code: 'assurance', name: 'Compliance, Risk & Assurance' },
      { code: 'timeline', name: 'Litigation, Courts & Timelines' },
      { code: 'mentor', name: 'Legal Research & Knowledge' },
      { code: 'insight', name: 'Analytics & Intelligence' },
      { code: 'ledger', name: 'Legal Finance & Billing' },
      { code: 'connect', name: 'Integration & Client Services' },
    ],
    courts: isDefault ? JURISDICTIONS.flatMap(j => j.courts.slice(0, 3)) : jur.courts,
    regulatoryBodies: isDefault ? JURISDICTIONS.flatMap(j => j.regulatoryBodies.slice(0, 5)) : jur.regulatoryBodies,
    keyStatutes: isDefault ? JURISDICTIONS.flatMap(j => j.keyStatutes.slice(0, 5)) : jur.keyStatutes,
    barAssociation: isDefault ? 'Multi-jurisdictional (BCI, SRA/BSB, ABA, CCBE, Law Society of Singapore)' : jur.barAssociation,
    dataProtection: isDefault ? 'DPDP, GDPR, UK-GDPR, CCPA, PDPA, GCC regional' : jur.dataProtection,
    antiCorruption: isDefault ? 'Prevention of Corruption Act, Bribery Act, FCPA, EU Anti-Corruption' : jur.antiCorruption,
    taxSystem: isDefault ? 'Multi-jurisdiction (Income Tax, GST/VAT, Corporate Tax, Customs)' : jur.taxSystem,
    currency: isDefault ? 'INR/GBP/USD/EUR/AED/SGD' : jur.currency,
    crossBorderNote: isDefault ? 'Full multi-jurisdictional capability with cross-border conflict identification' : jur.crossBorderNote,
    agents,
  };

  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(registry, null, 2));
  const sizeKB = (fs.statSync(filepath).size / 1024).toFixed(0);
  console.log(`  ✓ ${filename} — ${agents.length} agents, ${sizeKB} KB`);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  Jurexio Platform 3.1.2 — Full Registry Generator');
console.log('  149 agents × 7 files = 1,043 agent definitions');
console.log('  (148 domain + 1 orchestrator per file)');
console.log('  Each with full 22-section system prompt + cross-jurisdiction knowledge');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Agent definitions: ${AGENT_DEFS.length}`);
console.log(`  Practice areas: ${PRACTICE_AREAS.length}`);
console.log(`  Jurisdictions: ${JURISDICTIONS.length}`);
console.log('');
console.log('Generating registry files...');

// Generate 6 jurisdiction files
for (const jur of JURISDICTIONS) {
  writeRegistry(`Jurexio-Legal-registry-${jur.code}.json`, jur, false);
}

// Generate default (all-jurisdiction) file
const defaultJur = JURISDICTIONS[0]; // use IN as base but isDefault=true overrides
writeRegistry('Jurexio-Legal-registry-Default.json', defaultJur, true);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  ✅ All 7 registry files generated successfully!');
console.log('═══════════════════════════════════════════════════════════════');
