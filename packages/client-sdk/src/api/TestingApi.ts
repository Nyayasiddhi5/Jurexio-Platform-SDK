import type { NyvHttpClient } from '../NyvClient.js';
import type {
  NyvOracleTestReport,
  NyvAdversarialTestReport,
  NyvLlmJudgeResult,
  NyvAgentScorecard,
  NyvJurisdiction,
  NyvLegalDomain,
} from '../types/index.js';

export class TestingApi {
  constructor(private http: NyvHttpClient) {}

  async runOracleTests(jurisdiction: NyvJurisdiction, agentId?: string): Promise<NyvOracleTestReport> {
    return this.http.post('/api/jrx/testing/oracle-tests', { jurisdiction, agentId });
  }

  async runAdversarialTests(agentId?: string): Promise<NyvAdversarialTestReport> {
    return this.http.post('/api/jrx/testing/adversarial-tests', { agentId });
  }

  async evaluateWithJudge(
    response: string,
    query: string,
    jurisdiction: NyvJurisdiction,
    domain: NyvLegalDomain,
    judgeModel?: string
  ): Promise<NyvLlmJudgeResult> {
    return this.http.post('/api/jrx/testing/llm-judge', {
      response,
      query,
      jurisdiction,
      domain,
      judgeModel,
    });
  }

  async generateScorecard(jurisdiction: NyvJurisdiction): Promise<NyvAgentScorecard> {
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
    jurisdiction: NyvJurisdiction
  ): Promise<{ passed: boolean; affectedAgents: number; details: Record<string, unknown> }> {
    return this.http.post('/api/jrx/testing/amendment-regression', { amendmentId, jurisdiction });
  }
}
