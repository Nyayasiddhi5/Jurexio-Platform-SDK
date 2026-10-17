import crypto from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-nyayaforensic-service');

type ForensicVerdict = 'authentic' | 'suspicious' | 'likely-forged' | 'ai-generated';

interface DocumentInput {
  content: string;
  mimeType: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
}

interface ForensicVerificationResult {
  documentHash: string;
  aiGeneratedScore: number;
  forgeryScore: number;
  metadataConsistencyScore: number;
  fontConsistencyScore: number;
  signatureValid: boolean;
  sealAuthentic: boolean;
  chainOfCustodyValid: boolean;
  overallAuthenticityScore: number;
  verdict: ForensicVerdict;
  evidence: Record<string, unknown>;
  verifiedAt: Date;
}

interface AIDetectionResult {
  score: number;
  confidence: number;
  indicators: string[];
}

interface ForgeryResult {
  score: number;
  metadataConsistent: boolean;
  fontConsistent: boolean;
  anomalies: string[];
}

interface SignatureResult {
  valid: boolean;
  type: 'dsc' | 'aadhaar-esign' | 'docusign' | 'visual' | 'none';
  details: string;
}

interface SealResult {
  authentic: boolean;
  courtName: string | null;
  confidence: number;
}

interface ChainOfCustodyResult {
  valid: boolean;
  history: { timestamp: Date; action: string; actor: string }[];
  gaps: string[];
}

class NvNyayaForensicService {
  async verifyDocument(document: DocumentInput): Promise<ForensicVerificationResult> {
    logger.info({ method: 'verifyDocument', mimeType: document.mimeType, contentLength: document.content.length });

    const documentHash = crypto.createHash('sha256').update(document.content).digest('hex');
    const aiDetection = await this.detectAIGenerated(document.content);
    const forgeryResult = await this.detectForgery(Buffer.from(document.content), document.mimeType);
    const signatureResult = await this.verifySignature(document);
    const sealResult = await this.authenticateSeal(Buffer.alloc(0));
    const cocResult = await this.verifyChainOfCustody(documentHash);

    const weights = {
      aiGenerated: 0.30,
      forgery: 0.25,
      metadata: 0.15,
      font: 0.10,
      signature: 0.10,
      seal: 0.05,
      coc: 0.05,
    };

    const overallScore = (
      (1 - aiDetection.score) * weights.aiGenerated +
      (1 - forgeryResult.score) * weights.forgery +
      (forgeryResult.metadataConsistent ? 1 : 0) * weights.metadata +
      (forgeryResult.fontConsistent ? 1 : 0) * weights.font +
      (signatureResult.valid ? 1 : 0.5) * weights.signature +
      (sealResult.authentic ? 1 : 0.5) * weights.seal +
      (cocResult.valid ? 1 : 0.5) * weights.coc
    );

    let verdict: ForensicVerdict;
    if (aiDetection.score > 0.8) verdict = 'ai-generated';
    else if (overallScore < 0.4) verdict = 'likely-forged';
    else if (overallScore < 0.7) verdict = 'suspicious';
    else verdict = 'authentic';

    const result: ForensicVerificationResult = {
      documentHash,
      aiGeneratedScore: aiDetection.score,
      forgeryScore: forgeryResult.score,
      metadataConsistencyScore: forgeryResult.metadataConsistent ? 1.0 : 0.3,
      fontConsistencyScore: forgeryResult.fontConsistent ? 1.0 : 0.4,
      signatureValid: signatureResult.valid,
      sealAuthentic: sealResult.authentic,
      chainOfCustodyValid: cocResult.valid,
      overallAuthenticityScore: Math.round(overallScore * 100) / 100,
      verdict,
      evidence: {
        aiDetection,
        forgery: forgeryResult,
        signature: signatureResult,
        seal: sealResult,
        chainOfCustody: cocResult,
      },
      verifiedAt: new Date(),
    };

    await this.storeResult(result);
    return result;
  }

  private async detectAIGenerated(text: string): Promise<AIDetectionResult> {
    const words = text.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const lexicalDiversity = uniqueWords.size / Math.max(words.length, 1);

    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    const sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLen = sentenceLengths.reduce((a, b) => a + b, 0) / Math.max(sentenceLengths.length, 1);
    const variance = sentenceLengths.reduce((sum, l) => sum + Math.pow(l - avgLen, 2), 0) / Math.max(sentenceLengths.length, 1);
    const burstiness = Math.sqrt(variance) / Math.max(avgLen, 1);

    const indicators: string[] = [];
    let score = 0;

    if (lexicalDiversity < 0.4) {
      score += 0.3;
      indicators.push('Low lexical diversity suggests AI generation');
    }
    if (burstiness < 0.3) {
      score += 0.3;
      indicators.push('Low burstiness (uniform sentence lengths) suggests AI generation');
    }

    const fillerPhrases = ['it is important to note', 'in conclusion', 'furthermore', 'moreover', 'it should be noted'];
    const lowerText = text.toLowerCase();
    const fillerCount = fillerPhrases.filter(p => lowerText.includes(p)).length;
    if (fillerCount >= 3) {
      score += 0.2;
      indicators.push('High frequency of common AI filler phrases');
    }

    score = Math.min(score, 1.0);
    return { score, confidence: 0.7, indicators };
  }

  private async detectForgery(documentBytes: Buffer, mimeType: string): Promise<ForgeryResult> {
    const anomalies: string[] = [];
    let score = 0;

    if (documentBytes.length === 0) {
      anomalies.push('Empty document content');
      score += 0.5;
    }

    return {
      score: Math.min(score, 1.0),
      metadataConsistent: anomalies.length === 0,
      fontConsistent: true,
      anomalies,
    };
  }

  private async verifySignature(document: DocumentInput): Promise<SignatureResult> {
    return {
      valid: false,
      type: 'none',
      details: 'No digital signature found in document',
    };
  }

  private async authenticateSeal(sealImage: Buffer): Promise<SealResult> {
    return {
      authentic: false,
      courtName: null,
      confidence: 0,
    };
  }

  async verifyChainOfCustody(documentHash: string): Promise<ChainOfCustodyResult> {
    logger.info({ method: 'verifyChainOfCustody', documentHash });
    return {
      valid: true,
      history: [
        { timestamp: new Date(), action: 'initial_verification', actor: 'system' },
      ],
      gaps: [],
    };
  }

  private async storeResult(result: ForensicVerificationResult): Promise<void> {
    logger.info({
      method: 'storeResult',
      documentHash: result.documentHash,
      verdict: result.verdict,
      score: result.overallAuthenticityScore,
    });
  }
}

export const nvNyayaForensicService = new NvNyayaForensicService();
