export class ContentAssetService {
  private assets = new Map();
  
  async createAsset(name: string, type: string, content: any, folderId?: string, metadata?: any) {
    const id = `asset_${Date.now()}`;
    const asset = { id, name, type, folderId, metadata, createdAt: new Date().toISOString() };
    this.assets.set(id, asset);
    return asset;
  }
  
  async getAssets(folderId?: string, type?: string) {
    let results = Array.from(this.assets.values());
    if (folderId) results = results.filter((a: any) => a.folderId === folderId);
    if (type) results = results.filter((a: any) => a.type === type);
    return results;
  }
}
