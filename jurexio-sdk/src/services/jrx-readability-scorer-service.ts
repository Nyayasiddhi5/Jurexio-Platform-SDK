import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-readability-scorer-service');

interface ReadabilityScore {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  averageSentenceLength: number;
  averageSyllablesPerWord: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  complexWordPercentage: number;
  targetRange: string;
  withinTarget: boolean;
  grade: string;
}

class NvReadabilityScorerService {
  async score(text: string): Promise<ReadabilityScore> {
    logger.info({ method: 'score', textLength: text.length });

    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

    const wordCount = words.length;
    const sentenceCount = Math.max(sentences.length, 1);
    const paragraphCount = Math.max(paragraphs.length, 1);

    const syllableCounts = words.map(w => this.countSyllables(w));
    const totalSyllables = syllableCounts.reduce((a, b) => a + b, 0);

    const avgSentenceLen = wordCount / sentenceCount;
    const avgSyllables = totalSyllables / Math.max(wordCount, 1);

    const complexWords = words.filter(w => this.countSyllables(w) >= 3);
    const complexWordPercentage = (complexWords.length / Math.max(wordCount, 1)) * 100;

    const fleschReadingEase = 206.835 - 1.015 * avgSentenceLen - 84.6 * avgSyllables;
    const fleschKincaidGrade = 0.39 * avgSentenceLen + 11.8 * avgSyllables - 15.59;

    const roundedEase = Math.round(fleschReadingEase * 10) / 10;
    const roundedGrade = Math.round(fleschKincaidGrade * 10) / 10;
    const withinTarget = roundedEase >= 30 && roundedEase <= 50;

    let grade: string;
    if (roundedEase >= 70) grade = 'Easy — may be too simple for legal documents';
    else if (roundedEase >= 50) grade = 'Moderately readable — good for client communications';
    else if (roundedEase >= 30) grade = 'Difficult — appropriate for legal documents';
    else if (roundedEase >= 10) grade = 'Very difficult — standard for statutes and judgments';
    else grade = 'Extremely complex — consider simplification';

    return {
      fleschKincaidGrade: roundedGrade,
      fleschReadingEase: roundedEase,
      averageSentenceLength: Math.round(avgSentenceLen * 10) / 10,
      averageSyllablesPerWord: Math.round(avgSyllables * 100) / 100,
      wordCount,
      sentenceCount,
      paragraphCount,
      complexWordPercentage: Math.round(complexWordPercentage * 10) / 10,
      targetRange: '30-50 (legal documents)',
      withinTarget,
      grade,
    };
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? Math.max(matches.length, 1) : 1;
  }
}

export const nvReadabilityScorerService = new NvReadabilityScorerService();
