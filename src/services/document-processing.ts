export class DocumentProcessingService {
  async process(document: any, options?: any) {
    return { id: `doc_${Date.now()}`, status: 'processed', content: '', metadata: {} };
  }
}
