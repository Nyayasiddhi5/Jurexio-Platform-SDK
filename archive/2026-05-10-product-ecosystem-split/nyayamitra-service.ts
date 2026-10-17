import jwt from 'jsonwebtoken';
import { eq, and, or, desc, asc, like, ilike, sql } from 'drizzle-orm';
import {
  db,
  nmUsers, nmOtpSessions, nmTokens, nmRolePermissions, nmConsentRecords,
  nmIntakeSessions, nmIntakeResponses, nmWorkflowDefinitions, nmCaseBriefs,
  nmLawyers, nmLawyerAvailability, nmLawyerLeads, nmLawyerQualityIndex,
  nmConsultations, nmConsultReminders, nmConsultMessages,
  nmDocuments, nmLegalTemplates,
  nmAuditLogs, nmComplianceBreaches,
  nmLegalCategories, nmLiteracyTopics, nmHelplines, nmBannedKeywords, nmDisclaimerScripts
} from '../db/index.js';
import { SERVER_CONFIG, SECURITY_CONFIG, NYAYAMITRA_CONFIG } from '../config/platform-config.js';
import { createLogger } from '../utils/logger.js';
import { secureRandom, secureRandomInt, secureRandomBool, secureRandomChoice } from '../utils/nv-secure-random.js';


const logger = createLogger('nyayamitra-service');

const JWT_SECRET = (process.env.NYV_JWT_SECRET || process.env.JWT_SECRET || process.env.NS_JWT_SECRET)!;
const JWT_EXPIRY = `${SECURITY_CONFIG.session.jwtExpiryHours}h`;
const OTP_EXPIRY_MINUTES = SECURITY_CONFIG.session.otpExpiryMinutes;
const NYAYAVIGYA_BASE = SERVER_CONFIG.nyayavigyaApiBase;

const FALLBACK_CATEGORIES = [
  { id: 'criminal', name: 'Criminal Law', icon: 'gavel', color: '#dc2626' },
  { id: 'civil', name: 'Civil Disputes', icon: 'balance-scale', color: '#2563eb' },
  { id: 'family', name: 'Family Law', icon: 'users', color: '#7c3aed' },
  { id: 'property', name: 'Property Law', icon: 'home', color: '#059669' },
  { id: 'labor', name: 'Labor & Employment', icon: 'briefcase', color: '#d97706' },
  { id: 'consumer', name: 'Consumer Protection', icon: 'shopping-cart', color: '#0891b2' },
  { id: 'corporate', name: 'Corporate & Business', icon: 'building', color: '#4f46e5' },
  { id: 'tax', name: 'Tax Law', icon: 'file-invoice', color: '#be185d' },
  { id: 'constitutional', name: 'Constitutional Rights', icon: 'landmark', color: '#b45309' },
  { id: 'cyber', name: 'Cyber Law', icon: 'shield', color: '#0d9488' },
  { id: 'environmental', name: 'Environmental Law', icon: 'leaf', color: '#16a34a' },
  { id: 'ip', name: 'Intellectual Property', icon: 'lightbulb', color: '#9333ea' },
];

interface PIIRedactionResult {
  redacted: string;
  piiMap: Map<string, string>;
}

export class NyayamitraService {

  // ============================================================
  // 1. PII REDACTION MODULE
  // ============================================================

  redactPII(text: string): PIIRedactionResult {
    const piiMap = new Map<string, string>();
    let redacted = text;
    let counters: Record<string, number> = {};

    const nextToken = (type: string): string => {
      counters[type] = (counters[type] || 0) + 1;
      return `[${type}_${counters[type]}]`;
    };

    const patterns: Array<{ type: string; regex: RegExp }> = [
      { type: 'AADHAAR', regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
      { type: 'PAN', regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
      { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
      { type: 'PHONE', regex: /(?:\+91[\s\-]?)?(?:\d[\s\-]?){10}\b/g },
      { type: 'BANK_ACCOUNT', regex: /\b\d{9,18}\b/g },
      { type: 'IFSC', regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
      { type: 'ADDRESS', regex: /\b(?:H\.?\s*No\.?|Plot|Flat|House|Street|Road|Lane|Colony|Nagar|Sector|Block)\s*[\w\s,\-\.#\/]{5,60}(?:,\s*\w+){0,3}\b/gi },
    ];

    for (const { type, regex } of patterns) {
      redacted = redacted.replace(regex, (match) => {
        const token = nextToken(type);
        piiMap.set(token, match);
        return token;
      });
    }

    return { redacted, piiMap };
  }

  restorePII(text: string, piiMap: Map<string, string>): string {
    let restored = text;
    for (const [token, original] of piiMap.entries()) {
      restored = restored.split(token).join(original);
    }
    return restored;
  }

  // ============================================================
  // 2. AUTHENTICATION SERVICE (IAM)
  // ============================================================

  async registerCitizen(phoneNumber: string, fullName: string, email?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const existing = await db.select().from(nmUsers).where(eq(nmUsers.phoneNumber, phoneNumber)).limit(1);
      if (existing.length > 0) {
        return { success: false, error: 'Phone number already registered', user: existing[0] };
      }
      const [user] = await db.insert(nmUsers).values({
        phoneNumber,
        fullName,
        email: email || null,
        role: 'citizen',
        isActive: true,
        languagePreference: 'en',
      }).returning();
      return { success: true, user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async sendOtp(phoneNumber: string) {
    try {
      if (!db) throw new Error('Database not available');
      const otpCode = Math.floor(100000 + secureRandom() * 900000).toString();
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      const users = await db.select().from(nmUsers).where(eq(nmUsers.phoneNumber, phoneNumber)).limit(1);
      const userId = users.length > 0 ? users[0].userId : null;

      const [session] = await db.insert(nmOtpSessions).values({
        userId,
        otpCode,
        phoneNumber,
        expiresAt,
        verified: false,
      }).returning();

      const smsResult = await this.deliverOtpViaSms(phoneNumber, otpCode);
      logger.info(`[NM-OTP] OTP ${smsResult.delivered ? 'sent' : 'logged'} for ${phoneNumber.slice(0, 4)}****`);

      return { success: true, sessionId: session.sessionId, expiresAt, delivered: smsResult.delivered };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async deliverOtpViaSms(phoneNumber: string, otpCode: string): Promise<{ delivered: boolean; provider?: string }> {
    const smsProvider = process.env.SMS_PROVIDER || 'log';
    const message = `Your Nyayamitra verification code is: ${otpCode}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share with anyone.`;

    if (smsProvider === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
        const authStr = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

        const response = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authStr}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: phoneNumber,
            From: process.env.TWILIO_FROM_NUMBER,
            Body: message,
          }).toString(),
        });

        const result = await response.json() as any;
        if (response.ok && result.sid) {
          return { delivered: true, provider: 'twilio' };
        }
        logger.warn('[NM-OTP] Twilio send failed:', result.message);
      } catch (err: any) {
        logger.error('[NM-OTP] Twilio error:', err.message);
      }
    }

    if (smsProvider === 'msg91' && process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
      try {
        const response = await fetch('https://api.msg91.com/api/v5/otp', {
          method: 'POST',
          headers: {
            'authkey': process.env.MSG91_AUTH_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            template_id: process.env.MSG91_TEMPLATE_ID,
            mobile: phoneNumber.replace(/^\+/, ''),
            otp: otpCode,
          }),
        });

        const result = await response.json() as any;
        if (response.ok && result.type === 'success') {
          return { delivered: true, provider: 'msg91' };
        }
        logger.warn('[NM-OTP] MSG91 send failed:', result.message);
      } catch (err: any) {
        logger.error('[NM-OTP] MSG91 error:', err.message);
      }
    }

    logger.info(`[NM-OTP] [LOG MODE] OTP for ${phoneNumber}: ${otpCode} (expires in ${OTP_EXPIRY_MINUTES} min)`);
    return { delivered: false, provider: 'log' };
  }

  async verifyOtp(phoneNumber: string, otpCode: string) {
    try {
      if (!db) throw new Error('Database not available');
      const sessions = await db
        .select()
        .from(nmOtpSessions)
        .where(
          and(
            eq(nmOtpSessions.phoneNumber, phoneNumber),
            eq(nmOtpSessions.otpCode, otpCode),
            eq(nmOtpSessions.verified, false)
          )
        )
        .orderBy(desc(nmOtpSessions.createdAt))
        .limit(1);

      if (sessions.length === 0) {
        return { success: false, error: 'Invalid OTP' };
      }

      const session = sessions[0];
      if (new Date() > session.expiresAt) {
        return { success: false, error: 'OTP expired' };
      }

      await db.update(nmOtpSessions).set({ verified: true }).where(eq(nmOtpSessions.sessionId, session.sessionId));

      let users = await db.select().from(nmUsers).where(eq(nmUsers.phoneNumber, phoneNumber)).limit(1);
      if (users.length === 0) {
        const [newUser] = await db.insert(nmUsers).values({
          phoneNumber,
          role: 'citizen',
          isActive: true,
        }).returning();
        users = [newUser];
      }

      const user = users[0];
      const tokenResult = await this.generateToken(user.userId);
      return { success: true, user, ...tokenResult };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async generateToken(userId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const users = await db.select().from(nmUsers).where(eq(nmUsers.userId, userId)).limit(1);
      if (users.length === 0) throw new Error('User not found');

      const user = users[0];
      const accessToken = jwt.sign(
        { userId: user.userId, role: user.role, phoneNumber: user.phoneNumber },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );
      const refreshToken = jwt.sign(
        { userId: user.userId, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.insert(nmTokens).values({
        userId: user.userId,
        accessToken,
        refreshToken,
        expiresAt,
      });

      return { accessToken, refreshToken, expiresAt };
    } catch (error: any) {
      return { accessToken: null, refreshToken: null, expiresAt: null, error: error.message };
    }
  }

  validateToken(token: string) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; phoneNumber: string };
      return { valid: true, userId: decoded.userId, role: decoded.role, phoneNumber: decoded.phoneNumber };
    } catch {
      return { valid: false, userId: null, role: null, phoneNumber: null };
    }
  }

  async getProfile(userId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const users = await db.select().from(nmUsers).where(eq(nmUsers.userId, userId)).limit(1);
      if (users.length === 0) return null;
      return users[0];
    } catch {
      return null;
    }
  }

  async updateProfile(userId: string, updates: { fullName?: string; email?: string; languagePreference?: string; profileImage?: string }) {
    try {
      if (!db) throw new Error('Database not available');
      const [updated] = await db
        .update(nmUsers)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(nmUsers.userId, userId))
        .returning();
      return { success: true, user: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async recordConsent(userId: string, consentType: string, consentText?: string, ipAddress?: string, userAgent?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [record] = await db.insert(nmConsentRecords).values({
        userId,
        consentType,
        consentText: consentText || null,
        given: true,
        givenAt: new Date(),
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      }).returning();
      return { success: true, consent: record };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // 3. INTAKE SERVICE
  // ============================================================

  async startIntakeSession(citizenId: string, category: string, language: string = 'en') {
    try {
      if (!db) throw new Error('Database not available');
      const [session] = await db.insert(nmIntakeSessions).values({
        citizenId,
        category,
        currentStep: 'introduction',
        status: 'in_progress',
        language,
        consentGiven: false,
        piiRedacted: false,
      }).returning();
      return { success: true, session };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async saveIntakeResponse(sessionId: string, stepName: string, question: string, answer: string) {
    try {
      if (!db) throw new Error('Database not available');
      const { redacted } = this.redactPII(answer);

      const [response] = await db.insert(nmIntakeResponses).values({
        sessionId,
        stepName,
        question,
        answer,
        answerRedacted: redacted,
        inputType: 'text',
      }).returning();

      await db.update(nmIntakeSessions).set({
        currentStep: stepName,
        piiRedacted: true,
        updatedAt: new Date(),
      }).where(eq(nmIntakeSessions.sessionId, sessionId));

      return { success: true, response };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getIntakeSession(sessionId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const sessions = await db.select().from(nmIntakeSessions).where(eq(nmIntakeSessions.sessionId, sessionId)).limit(1);
      if (sessions.length === 0) return null;

      const responses = await db
        .select()
        .from(nmIntakeResponses)
        .where(eq(nmIntakeResponses.sessionId, sessionId))
        .orderBy(asc(nmIntakeResponses.createdAt));

      return { ...sessions[0], responses };
    } catch {
      return null;
    }
  }

  async completeIntakeSession(sessionId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [updated] = await db
        .update(nmIntakeSessions)
        .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(nmIntakeSessions.sessionId, sessionId))
        .returning();
      return { success: true, session: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getActiveSessionsForCitizen(citizenId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const sessions = await db
        .select()
        .from(nmIntakeSessions)
        .where(
          and(
            eq(nmIntakeSessions.citizenId, citizenId),
            eq(nmIntakeSessions.status, 'in_progress')
          )
        )
        .orderBy(desc(nmIntakeSessions.createdAt));
      return sessions;
    } catch {
      return [];
    }
  }

  async getCategoryWorkflow(category: string) {
    try {
      if (!db) throw new Error('Database not available');
      const workflows = await db
        .select()
        .from(nmWorkflowDefinitions)
        .where(
          and(
            eq(nmWorkflowDefinitions.category, category),
            eq(nmWorkflowDefinitions.isActive, true)
          )
        )
        .limit(1);
      return workflows.length > 0 ? workflows[0] : null;
    } catch {
      return null;
    }
  }

  // ============================================================
  // 4. AI GATEWAY (with PII protection)
  // ============================================================

  async processChat(sessionId: string, citizenId: string, message: string, category: string, jurisdiction: string = 'India') {
    try {
      if (!db) throw new Error('Database not available');
      const { redacted, piiMap } = this.redactPII(message);

      let aiResponse: string;
      try {
        const res = await fetch(`${NYAYAVIGYA_BASE}/legal-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: redacted,
            jurisdiction,
            category,
            sessionId,
          }),
        });
        const data = await res.json() as Record<string, any>;
        aiResponse = data.response || data.message || JSON.stringify(data);
      } catch {
        aiResponse = `Thank you for your query regarding ${category}. Based on your message, I can help you understand your rights and guide you through the legal process. Please provide more details or proceed with a detailed intake.`;
      }

      await db.insert(nmIntakeResponses).values({
        sessionId,
        stepName: 'ai_chat',
        question: message,
        answer: aiResponse,
        answerRedacted: this.redactPII(aiResponse).redacted,
        inputType: 'text',
      });

      await this.logAction(citizenId, 'ai_chat', 'intake_session', sessionId, { category, jurisdiction, piiRedacted: true });

      const displayResponse = this.restorePII(aiResponse, piiMap);

      return { success: true, response: displayResponse, sessionId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async generateCaseBrief(sessionId: string, citizenId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const responses = await db
        .select()
        .from(nmIntakeResponses)
        .where(eq(nmIntakeResponses.sessionId, sessionId))
        .orderBy(asc(nmIntakeResponses.createdAt));

      const session = await db.select().from(nmIntakeSessions).where(eq(nmIntakeSessions.sessionId, sessionId)).limit(1);
      if (session.length === 0) return { success: false, error: 'Session not found' };

      const combinedText = responses.map(r => `Q: ${r.question}\nA: ${r.answerRedacted || r.answer}`).join('\n\n');
      const { redacted } = this.redactPII(combinedText);

      let analysisResult: any = {};
      try {
        const res = await fetch(`${NYAYAVIGYA_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: redacted,
            type: 'case_brief',
            jurisdiction: 'India',
          }),
        });
        analysisResult = await res.json();
      } catch {
        analysisResult = {
          summary: `Case brief for ${session[0].category} matter based on ${responses.length} intake responses.`,
          keyIssues: ['Matter requires legal consultation'],
          potentialOutcomes: ['Settlement', 'Litigation', 'Mediation'],
          nextSteps: ['Consult with a lawyer', 'Gather evidence'],
          relevantStatutes: [],
        };
      }

      const [brief] = await db.insert(nmCaseBriefs).values({
        sessionId,
        citizenId,
        summary: analysisResult.summary || `Case brief for ${session[0].category}`,
        legalCategory: session[0].category,
        practiceArea: analysisResult.practiceArea || session[0].category,
        relevantStatutes: analysisResult.relevantStatutes || [],
        keyIssues: analysisResult.keyIssues || [],
        potentialOutcomes: analysisResult.potentialOutcomes || [],
        nextSteps: analysisResult.nextSteps || [],
        estimatedComplexity: analysisResult.complexity || 'moderate',
        urgencyLevel: analysisResult.urgency || 'medium',
        estimatedTimeline: analysisResult.timeline || '3-6 months',
        recommendedAgents: analysisResult.recommendedAgents || [],
        aiConfidenceScore: analysisResult.confidence?.toString() || null,
        version: 1,
      }).returning();

      await this.logAction(citizenId, 'generate_case_brief', 'case_brief', brief.briefId, { sessionId, piiRedacted: true });

      return { success: true, brief };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async analyzeDocument(documentId: string, citizenId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const docs = await db.select().from(nmDocuments).where(eq(nmDocuments.documentId, documentId)).limit(1);
      if (docs.length === 0) return { success: false, error: 'Document not found' };

      const doc = docs[0];
      const ocrText = doc.ocrText || '';
      if (!ocrText) return { success: false, error: 'No OCR text available for analysis' };

      const { redacted, piiMap } = this.redactPII(ocrText);

      let analysis: any = {};
      try {
        const res = await fetch(`${NYAYAVIGYA_BASE}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: redacted,
            type: 'document',
            jurisdiction: 'India',
          }),
        });
        analysis = await res.json();
      } catch {
        analysis = { summary: 'Document analysis pending. OCR text has been processed.', type: doc.fileType };
      }

      const aiSummary = analysis.summary || 'Analysis completed';
      const { redacted: summaryRedacted } = this.redactPII(aiSummary);

      await db.update(nmDocuments).set({
        aiSummary,
        aiSummaryRedacted: summaryRedacted,
        updatedAt: new Date(),
      }).where(eq(nmDocuments.documentId, documentId));

      await this.logAction(citizenId, 'analyze_document', 'document', documentId, { piiRedacted: true });

      return { success: true, analysis: { ...analysis, summary: this.restorePII(aiSummary, piiMap) }, documentId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // 5. LAWYER SERVICE
  // ============================================================

  async searchLawyers(filters: { practiceArea?: string; jurisdiction?: string; language?: string; mode?: string }) {
    try {
      if (!db) throw new Error('Database not available');
      const conditions = [
        eq(nmLawyers.isActive, true),
        eq(nmLawyers.verificationStatus, 'verified'),
      ];

      let query = db.select({
        lawyerId: nmLawyers.lawyerId,
        fullName: nmLawyers.fullName,
        profileImage: nmLawyers.profileImage,
        bio: nmLawyers.bio,
        experienceYears: nmLawyers.experienceYears,
        practiceAreas: nmLawyers.practiceAreas,
        jurisdictions: nmLawyers.jurisdictions,
        languages: nmLawyers.languages,
        consultationFee: nmLawyers.consultationFee,
        consultationModes: nmLawyers.consultationModes,
        totalConsultations: nmLawyers.totalConsultations,
        courts: nmLawyers.courts,
        education: nmLawyers.education,
      }).from(nmLawyers).where(and(...conditions));

      const lawyers = await query;

      let filtered = lawyers;
      if (filters.practiceArea) {
        filtered = filtered.filter((l: any) => {
          const areas = Array.isArray(l.practiceAreas) ? l.practiceAreas : [];
          return areas.some((a: string) => a.toLowerCase().includes(filters.practiceArea!.toLowerCase()));
        });
      }
      if (filters.jurisdiction) {
        filtered = filtered.filter((l: any) => {
          const jurisdictions = Array.isArray(l.jurisdictions) ? l.jurisdictions : [];
          return jurisdictions.some((j: string) => j.toLowerCase().includes(filters.jurisdiction!.toLowerCase()));
        });
      }
      if (filters.language) {
        filtered = filtered.filter((l: any) => {
          const languages = Array.isArray(l.languages) ? l.languages : [];
          return languages.some((lang: string) => lang.toLowerCase().includes(filters.language!.toLowerCase()));
        });
      }
      if (filters.mode) {
        filtered = filtered.filter((l: any) => {
          const modes = Array.isArray(l.consultationModes) ? l.consultationModes : [];
          return modes.some((m: string) => m.toLowerCase() === filters.mode!.toLowerCase());
        });
      }

      return filtered;
    } catch {
      return [];
    }
  }

  async getLawyerProfile(lawyerId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const lawyers = await db.select({
        lawyerId: nmLawyers.lawyerId,
        fullName: nmLawyers.fullName,
        email: nmLawyers.email,
        phone: nmLawyers.phone,
        profileImage: nmLawyers.profileImage,
        bio: nmLawyers.bio,
        experienceYears: nmLawyers.experienceYears,
        practiceAreas: nmLawyers.practiceAreas,
        jurisdictions: nmLawyers.jurisdictions,
        courts: nmLawyers.courts,
        languages: nmLawyers.languages,
        education: nmLawyers.education,
        consultationFee: nmLawyers.consultationFee,
        consultationModes: nmLawyers.consultationModes,
        totalConsultations: nmLawyers.totalConsultations,
        verificationStatus: nmLawyers.verificationStatus,
        barCouncilId: nmLawyers.barCouncilId,
        isActive: nmLawyers.isActive,
      }).from(nmLawyers).where(eq(nmLawyers.lawyerId, lawyerId)).limit(1);
      return lawyers.length > 0 ? lawyers[0] : null;
    } catch {
      return null;
    }
  }

  async getLawyerAvailability(lawyerId: string, date: string) {
    try {
      if (!db) throw new Error('Database not available');
      const targetDate = new Date(date);
      const dayOfWeek = targetDate.getDay();

      const slots = await db
        .select()
        .from(nmLawyerAvailability)
        .where(
          and(
            eq(nmLawyerAvailability.lawyerId, lawyerId),
            eq(nmLawyerAvailability.dayOfWeek, dayOfWeek),
            eq(nmLawyerAvailability.isAvailable, true)
          )
        )
        .orderBy(asc(nmLawyerAvailability.startTime));

      return slots;
    } catch {
      return [];
    }
  }

  async createLead(lawyerId: string, citizenId: string, caseBriefId?: string, matchScore?: number) {
    try {
      if (!db) throw new Error('Database not available');
      const [lead] = await db.insert(nmLawyerLeads).values({
        lawyerId,
        citizenId,
        caseBriefId: caseBriefId || null,
        source: 'intake',
        status: 'new',
        matchScore: matchScore?.toString() || null,
      }).returning();
      return { success: true, lead };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async matchLawyersForCase(caseBriefId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const briefs = await db.select().from(nmCaseBriefs).where(eq(nmCaseBriefs.briefId, caseBriefId)).limit(1);
      if (briefs.length === 0) return [];

      const brief = briefs[0];
      const practiceArea = brief.practiceArea || brief.legalCategory || '';

      const lawyers = await this.searchLawyers({ practiceArea });

      return lawyers.map((l: any) => ({
        ...l,
        matchScore: this.calculateMatchScore(l, brief),
      })).sort((a: any, b: any) => b.matchScore - a.matchScore);
    } catch {
      return [];
    }
  }

  private calculateMatchScore(lawyer: any, brief: any): number {
    let score = 50;
    const areas = Array.isArray(lawyer.practiceAreas) ? lawyer.practiceAreas : [];
    if (areas.some((a: string) => a.toLowerCase().includes((brief.practiceArea || '').toLowerCase()))) {
      score += 30;
    }
    if ((lawyer.experienceYears || 0) > 5) score += 10;
    if ((lawyer.totalConsultations || 0) > 10) score += 10;
    return Math.min(score, 100);
  }

  // ============================================================
  // 6. CONSULTATION SERVICE
  // ============================================================

  async bookConsultation(citizenId: string, lawyerId: string, scheduledDate: string, mode: string, caseBriefId?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [consultation] = await db.insert(nmConsultations).values({
        citizenId,
        lawyerId,
        caseBriefId: caseBriefId || null,
        scheduledDate: new Date(scheduledDate),
        mode,
        status: 'pending',
        paymentStatus: 'pending',
        durationMinutes: 30,
      }).returning();

      await this.logAction(citizenId, 'book_consultation', 'consultation', consultation.consultationId, { lawyerId, mode });

      return { success: true, consultation };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getConsultation(consultationId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const results = await db.select().from(nmConsultations).where(eq(nmConsultations.consultationId, consultationId)).limit(1);
      return results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }

  async getCitizenConsultations(citizenId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const consultations = await db
        .select()
        .from(nmConsultations)
        .where(eq(nmConsultations.citizenId, citizenId))
        .orderBy(desc(nmConsultations.createdAt));
      return consultations;
    } catch {
      return [];
    }
  }

  async updateConsultationStatus(consultationId: string, status: string) {
    try {
      if (!db) throw new Error('Database not available');
      const updates: any = { status, updatedAt: new Date() };
      if (status === 'completed') updates.completedAt = new Date();

      const [updated] = await db
        .update(nmConsultations)
        .set(updates)
        .where(eq(nmConsultations.consultationId, consultationId))
        .returning();
      return { success: true, consultation: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async submitFeedback(consultationId: string, rating: number, feedback: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [updated] = await db
        .update(nmConsultations)
        .set({
          citizenRating: rating,
          citizenFeedback: feedback,
          updatedAt: new Date(),
        })
        .where(eq(nmConsultations.consultationId, consultationId))
        .returning();
      return { success: true, consultation: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async sendMessage(consultationId: string, senderId: string, senderRole: string, content: string) {
    try {
      if (!db) throw new Error('Database not available');
      const { redacted } = this.redactPII(content);

      const [message] = await db.insert(nmConsultMessages).values({
        consultationId,
        senderId,
        senderRole,
        content,
        contentRedacted: redacted,
        isRead: false,
      }).returning();
      return { success: true, message };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getMessages(consultationId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const messages = await db
        .select()
        .from(nmConsultMessages)
        .where(eq(nmConsultMessages.consultationId, consultationId))
        .orderBy(asc(nmConsultMessages.createdAt));
      return messages;
    } catch {
      return [];
    }
  }

  // ============================================================
  // 7. DOCUMENT SERVICE
  // ============================================================

  async uploadDocument(citizenId: string, fileName: string, fileType: string, fileSize: number, mimeType: string, sessionId?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [doc] = await db.insert(nmDocuments).values({
        citizenId,
        fileName,
        fileType,
        fileSize,
        mimeType,
        intakeSessionId: sessionId || null,
        uploadStatus: 'uploaded',
        ocrStatus: 'pending',
        isSensitive: false,
      }).returning();

      await this.logAction(citizenId, 'upload_document', 'document', doc.documentId, { fileName, fileType });

      return { success: true, document: doc };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getDocument(documentId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const docs = await db.select().from(nmDocuments).where(eq(nmDocuments.documentId, documentId)).limit(1);
      return docs.length > 0 ? docs[0] : null;
    } catch {
      return null;
    }
  }

  async getCitizenDocuments(citizenId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const docs = await db
        .select()
        .from(nmDocuments)
        .where(eq(nmDocuments.citizenId, citizenId))
        .orderBy(desc(nmDocuments.createdAt));
      return docs;
    } catch {
      return [];
    }
  }

  async updateDocumentOcr(documentId: string, ocrText: string) {
    try {
      if (!db) throw new Error('Database not available');
      const [updated] = await db
        .update(nmDocuments)
        .set({ ocrText, ocrStatus: 'completed', updatedAt: new Date() })
        .where(eq(nmDocuments.documentId, documentId))
        .returning();
      return { success: true, document: updated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // 8. LEGAL LITERACY SERVICE
  // ============================================================

  async getTopics(category?: string, language?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const conditions = [eq(nmLiteracyTopics.isActive, true)];
      if (category) conditions.push(eq(nmLiteracyTopics.category, category));
      if (language) conditions.push(eq(nmLiteracyTopics.language, language));

      const topics = await db
        .select()
        .from(nmLiteracyTopics)
        .where(and(...conditions))
        .orderBy(asc(nmLiteracyTopics.title));
      return topics;
    } catch {
      return [];
    }
  }

  async getTopicById(topicId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const topics = await db.select().from(nmLiteracyTopics).where(eq(nmLiteracyTopics.topicId, topicId)).limit(1);
      return topics.length > 0 ? topics[0] : null;
    } catch {
      return null;
    }
  }

  async searchTopics(query: string) {
    try {
      if (!db) throw new Error('Database not available');
      const topics = await db
        .select()
        .from(nmLiteracyTopics)
        .where(
          and(
            eq(nmLiteracyTopics.isActive, true),
            or(
              ilike(nmLiteracyTopics.title, `%${query}%`),
              ilike(nmLiteracyTopics.content, `%${query}%`)
            )
          )
        )
        .orderBy(asc(nmLiteracyTopics.title));
      return topics;
    } catch {
      return [];
    }
  }

  // ============================================================
  // 9. HELPLINE SERVICE
  // ============================================================

  async getHelplines(category?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const conditions = [eq(nmHelplines.isActive, true)];
      if (category) conditions.push(eq(nmHelplines.category, category));

      const helplines = await db
        .select()
        .from(nmHelplines)
        .where(and(...conditions));
      return helplines;
    } catch {
      return [];
    }
  }

  // ============================================================
  // 10. LEGAL TEMPLATES SERVICE
  // ============================================================

  async getTemplates(category?: string, jurisdiction?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const conditions = [eq(nmLegalTemplates.isActive, true)];
      if (category) conditions.push(eq(nmLegalTemplates.category, category));
      if (jurisdiction) conditions.push(eq(nmLegalTemplates.jurisdiction, jurisdiction));

      const templates = await db
        .select()
        .from(nmLegalTemplates)
        .where(and(...conditions))
        .orderBy(asc(nmLegalTemplates.title));
      return templates;
    } catch {
      return [];
    }
  }

  async getTemplate(templateId: string) {
    try {
      if (!db) throw new Error('Database not available');
      const templates = await db.select().from(nmLegalTemplates).where(eq(nmLegalTemplates.templateId, templateId)).limit(1);
      if (templates.length === 0) return null;

      await db.update(nmLegalTemplates).set({
        downloadCount: sql`${nmLegalTemplates.downloadCount} + 1`,
      }).where(eq(nmLegalTemplates.templateId, templateId));

      return templates[0];
    } catch {
      return null;
    }
  }

  // ============================================================
  // 11. AUDIT SERVICE
  // ============================================================

  async logAction(userId: string | null, action: string, resource: string, resourceId?: string, details?: any, ipAddress?: string, userAgent?: string) {
    try {
      if (!db) return;
      await db.insert(nmAuditLogs).values({
        userId,
        action,
        resource,
        resourceId: resourceId || null,
        details: details || {},
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        piiAccessed: false,
      });
    } catch {
      // Audit logging should not throw
    }
  }

  async logComplianceBreach(userId: string | null, breachType: string, severity: string, description: string) {
    try {
      if (!db) return;
      await db.insert(nmComplianceBreaches).values({
        userId,
        breachType,
        severity,
        description,
        resolved: false,
      });
    } catch {
      // Compliance logging should not throw
    }
  }

  // ============================================================
  // 12. CATEGORIES & CONFIG
  // ============================================================

  async getLegalCategories() {
    try {
      if (!db) return FALLBACK_CATEGORIES;
      const categories = await db
        .select()
        .from(nmLegalCategories)
        .where(eq(nmLegalCategories.isActive, true))
        .orderBy(asc(nmLegalCategories.sortOrder));

      if (categories.length === 0) return FALLBACK_CATEGORIES;
      return categories;
    } catch {
      return FALLBACK_CATEGORIES;
    }
  }

  async getDisclaimerScripts(stage: string, language?: string) {
    try {
      if (!db) throw new Error('Database not available');
      const conditions = [
        eq(nmDisclaimerScripts.stage, stage),
        eq(nmDisclaimerScripts.isActive, true),
      ];
      if (language) conditions.push(eq(nmDisclaimerScripts.language, language));

      const scripts = await db
        .select()
        .from(nmDisclaimerScripts)
        .where(and(...conditions))
        .orderBy(asc(nmDisclaimerScripts.sortOrder));
      return scripts;
    } catch {
      return [];
    }
  }

  async getBannedKeywords() {
    try {
      if (!db) throw new Error('Database not available');
      const keywords = await db
        .select()
        .from(nmBannedKeywords)
        .where(eq(nmBannedKeywords.isActive, true));
      return keywords;
    } catch {
      return [];
    }
  }

  async checkForBannedContent(text: string): Promise<{ hasBanned: boolean; matches: string[] }> {
    try {
      const keywords = await this.getBannedKeywords();
      const lowerText = text.toLowerCase();
      const matches: string[] = [];

      for (const kw of keywords) {
        if (lowerText.includes(kw.keyword.toLowerCase())) {
          matches.push(kw.keyword);
        }
      }

      if (matches.length > 0) {
        await this.logComplianceBreach(null, 'banned_content', 'high', `Banned content detected: ${matches.join(', ')}`);
      }

      return { hasBanned: matches.length > 0, matches };
    } catch {
      return { hasBanned: false, matches: [] };
    }
  }

  getAvatarConfig() {
    return {
      name: 'Nyayamitra',
      title: 'Your Legal Guide',
      avatar: '/assets/nyayamitra-avatar.png',
      greeting: 'Namaste! I am Nyayamitra, your legal guide. How can I assist you today?',
      languages: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Bengali', 'Gujarati'],
      capabilities: [
        'Understand your legal situation',
        'Identify relevant laws and rights',
        'Generate a case brief',
        'Connect you with appropriate lawyers',
        'Provide legal literacy resources',
        'Guide through government helplines',
      ],
    };
  }
}

export const nyayamitraService = new NyayamitraService();
