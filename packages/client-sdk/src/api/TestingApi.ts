import type { JrxHttpClient } from '../JrxClient.js';
import type {
  JrxOracleTestReport,
  JrxAdversarialTestReport,
  JrxLlmJudgeResult,
  JrxAgentScorecard,
  JrxJurisdiction,
  JrxLegalDomain,
} from '../types/index.js';

export class TestingApi {
  constructor(private http: JrxHttpClient) {}

  async runOracleTests(jurisdiction: JrxJurisdiction, agentId?: string): Promise<JrxOracleTestReport> {
    return this.http.post('/api/jrx/testing/oracle-tests', { jurisdiction, agentId });
  }

  async runAdversarialTests(agentId?: string): Promise<JrxAdversarialTestReport> {
    return this.http.post('/api/jrx/testing/adversarial-tests', { agentId });
  }

  async evaluateWithJudge(
    response: string,
    query: string,
    jurisdiction: JrxJurisdiction,
    domain: JrxLegalDomain,
    judgeModel?: string
  ): Promise<JrxLlmJudgeResult> {
    return this.http.post('/api/jrx/testing/llm-judge', {
      response,
      query,
      jurisdiction,
      domain,
      judgeModel,
    });
  }

  async generateScorecard(jurisdiction: JrxJurisdiction): Promise<JrxAgentScorecard> {
    return this.http.post('/api/jrx/testing/scorecard', { jurisdiction });
  }

  async runHitlReview(
    agentId: string,
    outputId: string,
    expertId?: string
  ): Promise<{ reviewId: string; status: string; assignedTo: string }> {
    return this.http.post('/api/jrx/testing/hitl-review', { agentId, outputId, expertId });
  }

  async runAmendmentRegression(
    amendmentId: string,
    jurisdiction: JrxJurisdiction
  ): Promise<{ passed: boolean; affectedAgents: number; details: Record<string, unknown> }> {
    return this.http.post('/api/jrx/testing/amendment-regression', { amendmentId, jurisdiction });
  }
}
