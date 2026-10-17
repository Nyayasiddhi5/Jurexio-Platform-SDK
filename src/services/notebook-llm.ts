export class NotebookLLMService {
  async createProject(name: string, documents: any[]) {
    return { id: `proj_${Date.now()}`, name, documents: [], createdAt: new Date().toISOString() };
  }
}
