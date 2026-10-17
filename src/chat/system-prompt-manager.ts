export type SystemPrompt = { id: string; name: string; content: string; jurisdiction?: string };
export type PromptVersion = { version: string; content: string; createdAt: Date };
export type PromptTemplate = { id: string; template: string; variables: string[] };
export type PromptVariable = { name: string; type: string; required: boolean };
export type PromptConfig = { jurisdiction?: string; language?: string; platform?: string };
export const DEFAULT_PROMPTS: SystemPrompt[] = [];
export const PROMPT_TEMPLATES: PromptTemplate[] = [];
export class SystemPromptManager {
  getPrompt(id: string): SystemPrompt | undefined {
    return DEFAULT_PROMPTS.find(p => p.id === id);
  }
  buildPrompt(template: PromptTemplate, vars: Record<string, string>): string {
    let result = template.template;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{{${k}}}`, v);
    }
    return result;
  }
}
export const systemPromptManager = new SystemPromptManager();
