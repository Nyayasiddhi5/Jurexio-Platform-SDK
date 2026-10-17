import Anthropic from '@anthropic-ai/sdk';

const SCRIPT_MODEL = 'claude-sonnet-4-20250514';

export interface ProfessionalVideoScript {
  scenes: ProfessionalScene[];
  totalDuration: number;
  fullNarration: string;
  title: string;
  targetAudience: string;
}

export interface ProfessionalScene {
  sceneNumber: number;
  duration: number;
  title: string;
  studioName?: string;
  narration: string;
  visualDescription: string;
  onScreenText: string[];
  transitionEffect: string;
}

export class ProfessionalVideoScriptGenerator {
  private anthropic: Anthropic | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  async generateComprehensiveScript(): Promise<ProfessionalVideoScript> {
    const prompt = `Create a compelling, investor-grade 4-minute (240 seconds) video script for Nyayavigya Incubator Platform.

PLATFORM OVERVIEW:
- World's First AI-Native Accelerator
- Transforms ideas into MVPs in 14 days (6 phases)
- 188 operational AI agents (267+ total capacity)
- Nyayavigya SDK v5.0.0 with 23+ LLM providers, 752+ models
- AG-UI real-time streaming (watch agents work live)
- 10 specialized studios with 39 automated workflows
- 87% success rate in beta program
- 11 LLM providers currently active
- Full SDLC automation from ideation to deployment

10 SPECIALIZED STUDIOS:
1. Ideation Lab - Concept refinement, market validation, business model
2. Engineering Forge - Full-stack development, architecture, code generation
3. Market Intelligence - Competitor analysis, market sizing, trends
4. Product Blueprint - PRD creation, feature planning, roadmaps
5. Experience Design - UI/UX design, prototyping, user flows
6. Quality Assurance Lab - Testing automation, quality metrics
7. Growth Engine - Marketing strategy, growth hacking, analytics
8. Launch Command - Go-to-market, deployment strategy
9. Operations Hub - Team workflows, resource optimization
10. Deployment Studio - Production deployment, monitoring, scaling

Nyayavigya SDK CAPABILITIES:
- Multi-provider orchestration (OpenAI, Anthropic, Google, etc.)
- Autonomous agent coordination (L1-L4 ROMA standards)
- Real-time streaming with AG-UI protocol
- Seed propagation for reproducibility
- Fail-fast error handling
- 267+ specialized agents across all domains

UNIQUE VALUE PROPOSITIONS:
- Only platform with 100% SDLC automation
- Real-time agent visibility (AG-UI innovation)
- 14-day guaranteed MVP delivery
- Multi-provider AI orchestration
- Proven 87% success rate

TARGET AUDIENCE: Tech investors, VCs, accelerator programs, startup founders

VIDEO STRUCTURE (240 seconds = 4 minutes):
1. Opening Hook (20s) - Problem statement + platform introduction
2. Platform Overview (25s) - Nyayavigya SDK architecture, 10 studios ecosystem
3. Studio Showcase - All 10 studios (120s total, ~12s each)
   - Ideation Lab (12s)
   - Engineering Forge (12s)
   - Market Intelligence (12s)
   - Product Blueprint (12s)
   - Experience Design (12s)
   - Quality Assurance Lab (12s)
   - Growth Engine (12s)
   - Launch Command (12s)
   - Operations Hub (12s)
   - Deployment Studio (12s)
4. Technical Architecture (30s) - Nyayavigya SDK, agent orchestration, AG-UI
5. Market Differentiation (25s) - Competitive advantages, unique features
6. Success Metrics & CTA (20s) - 87% success rate, beta results, call to action

REQUIREMENTS:
- Professional, confident, investor-focused tone
- Emphasize speed (14 days), automation (267+ agents), and innovation (AG-UI)
- Include specific technical details and metrics
- Clear visual descriptions for each scene
- On-screen text suggestions for key points
- Transition effects between scenes

Format your response as JSON:
{
  "title": "Nyayavigya Incubator: The Future of Startup Acceleration",
  "targetAudience": "Investors and VCs",
  "totalDuration": 240,
  "fullNarration": "Complete script...",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 20,
      "title": "The Problem",
      "narration": "...",
      "visualDescription": "Detailed description of what should be shown",
      "onScreenText": ["Key Point 1", "Key Point 2"],
      "transitionEffect": "fade"
    }
  ]
}`;

    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured. Cannot generate video script.');
    }

    const response = await this.anthropic.messages.create({
      model: SCRIPT_MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    throw new Error('Failed to generate professional video script');
  }
}
