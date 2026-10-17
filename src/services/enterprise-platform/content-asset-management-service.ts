interface Asset {
  id: string;
  name: string;
  type: string;
  url: string;
  size: number;
  tags: string[];
  createdAt: string;
  metadata: Record<string, any>;
}

class ContentAssetManagementService {
  private assets: Map<string, Asset> = new Map();

  async uploadAsset(input: { name: string; type: string; content: Buffer | string; tags?: string[]; metadata?: Record<string, any> }): Promise<Asset> {
    const id = `asset-${Date.now()}`;
    const asset: Asset = {
      id,
      name: input.name,
      type: input.type,
      url: `/assets/${id}/${input.name}`,
      size: typeof input.content === 'string' ? input.content.length : input.content.length,
      tags: input.tags || [],
      metadata: input.metadata || {},
      createdAt: new Date().toISOString(),
    };
    this.assets.set(id, asset);
    return asset;
  }

  async getAsset(assetId: string): Promise<Asset | null> {
    return this.assets.get(assetId) || null;
  }

  async listAssets(options?: { type?: string; tags?: string[]; limit?: number; offset?: number }): Promise<{ assets: Asset[]; total: number }> {
    let list = Array.from(this.assets.values());
    if (options?.type) list = list.filter(a => a.type === options.type);
    if (options?.tags?.length) list = list.filter(a => options.tags!.some(t => a.tags.includes(t)));
    const total = list.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 20;
    return { assets: list.slice(offset, offset + limit), total };
  }

  async searchAssets(query: string, options?: Record<string, any>): Promise<{ assets: Asset[]; total: number }> {
    const list = Array.from(this.assets.values()).filter(
      a => a.name.toLowerCase().includes(query.toLowerCase()) || a.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
    );
    return { assets: list, total: list.length };
  }

  async deleteAsset(assetId: string): Promise<boolean> {
    return this.assets.delete(assetId);
  }

  getStats(): { assetCount: number; totalSize: number } {
    let totalSize = 0;
    this.assets.forEach(a => { totalSize += a.size; });
    return { assetCount: this.assets.size, totalSize };
  }
}

export const contentAssetManagementService = new ContentAssetManagementService();
