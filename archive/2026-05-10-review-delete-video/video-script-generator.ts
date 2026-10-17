import Anthropic from '@anthropic-ai/sdk';

export interface VideoScript {
  scenes: Scene[];
  totalDuration: number;
  narration: string;
}

export interface Scene {
  sceneNumber: number;
  duration: number;
  studioName: string;
  action: string;
  narration: string;
  visualNotes: string;
}

export class VideoScriptGenerator {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generateScript(): Promise<VideoScript> {
    const prompt = `Create a compelling 3-minute video script for Nyayavigya Incubator Platform.

PLATFORM OVERVIEW:
- World's First AI-Native Accelerator
- Transforms ideas into MVPs in 14 days
- 188 active AI agents (267+ on roadmap)
- 10 specialized studios (Ideation Lab, Engineering Forge, Market Intelligence, Product Blueprint, Experience Design, QA Lab, Growth Engine, Launch Command, Operations Hub, Deployment Studio)
- AG-UI real-time streaming (watch agents work live)
- 11 LLM providers active (23+ integrated)
- 87% success rate in beta program

TARGET AUDIENCE: Investors & startup founders

IMPORTANT: You must create EXACTLY 5 scenes matching these studios:
1. Ideation Lab (30 seconds)
2. Engineering Forge (40 seconds)
3. Market Intelligence (35 seconds)
4. Product Blueprint (40 seconds)
5. Experience Design (35 seconds)

VIDEO STRUCTURE (180 seconds total):
1. Scene 1 - Ideation Lab (30s): Hook + problem statement, show concept refinement
2. Scene 2 - Engineering Forge (40s): Solution + platform power, show app generation
3. Scene 3 - Market Intelligence (35s): Market validation, show competitor analysis
4. Scene 4 - Product Blueprint (40s): Product planning, show PRD creation
5. Scene 5 - Experience Design (35s): Results + CTA, show UI/UX generation

REQUIREMENTS:
- Professional, confident tone
- Investor-focused language
- Emphasize speed (14 days) & automation (AI agents)
- Highlight AG-UI innovation (real-time visibility)
- Include specific metrics (87% success rate, 188 agents, 39 workflows)
- Clear, concise narration that fits EXACTLY the duration specified
- Each scene narration should be timed for its exact duration

Format your response as JSON:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 30,
      "studioName": "Ideation Lab",
      "action": "Show concept refinement workflow",
      "narration": "Full narration text here...",
      "visualNotes": "Text overlays, graphics to show"
    }
  ],
  "totalDuration": 180,
  "narration": "Complete narration script..."
}`;

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      // Extract JSON from response (Claude may wrap in markdown)
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    }

    throw new Error('Failed to generate video script');
  }
}
