/**
 * FROZEN SNAPSHOT — do not "fix" this file.
 *
 * Verbatim copy of the class body of `src/services/memory/graph-memory-service.ts`
 * as it stood before NV-MEM-TENANT-001 / NV-MEM-DECAY-001 / NV-MEM-LIMIT-001 /
 * NV-MEM-GRAPHRAG-001. It exists solely so
 * `tests/unit/jrx-graph-memory-prefix-defects.test.ts` can demonstrate that the
 * regression suite in `jrx-graph-memory-tenant-isolation.test.ts` fails without
 * the fix. It is never imported by src/.
 *
 * The only edits vs the original are: the module-level singleton is replaced by
 * a factory (so each test gets a clean graph), the decay `setInterval` is
 * removed (it would keep the vitest process alive), and `@ts-expect-error` is
 * relaxed to `@ts-ignore` because the snapshot is not type-checked against the
 * current MemoryEdge shape.
 */
import { v4 as uuidv4 } from 'uuid';

export interface MemoryNode {
  id: string;
  type: 'entity' | 'concept' | 'event' | 'fact' | 'preference' | 'skill';
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  decayScore: number;
  importance: number;
  source: string;
  userId?: string;
  sessionId?: string;
}

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  metadata: Record<string, any>;
  createdAt: Date;
  lastReinforced: Date;
  reinforcementCount: number;
}

export interface MemoryQuery {
  query: string;
  userId?: string;
  sessionId?: string;
  memoryTypes?: MemoryNode['type'][];
  limit?: number;
  minImportance?: number;
  includeRelated?: boolean;
  maxHops?: number;
}

export interface MemoryResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  relevanceScores: Map<string, number>;
  totalTokensSaved: number;
  retrievalTime: number;
}

export type MemoryCategory = 'episodic' | 'semantic' | 'procedural';

interface EpisodicMemory {
  id: string;
  event: string;
  timestamp: Date;
  context: Record<string, any>;
  emotionalValence: number;
  participants: string[];
  location?: string;
}

interface SemanticMemory {
  id: string;
  concept: string;
  definition: string;
  relationships: Array<{ concept: string; relation: string }>;
  confidence: number;
  sources: string[];
}

interface ProceduralMemory {
  id: string;
  skill: string;
  steps: string[];
  prerequisites: string[];
  successRate: number;
  executionCount: number;
}

export class GraphMemoryService {
  private nodes: Map<string, MemoryNode> = new Map();
  private edges: Map<string, MemoryEdge> = new Map();
  private episodicMemories: Map<string, EpisodicMemory> = new Map();
  private semanticMemories: Map<string, SemanticMemory> = new Map();
  private proceduralMemories: Map<string, ProceduralMemory> = new Map();
  
  private readonly DECAY_RATE = 0.05;
  private readonly MIN_DECAY_SCORE = 0.1;
  private readonly MAX_MEMORY_SIZE = 10000;
  private readonly IMPORTANCE_THRESHOLD = 0.3;
  
  private userGraphs: Map<string, Set<string>> = new Map();
  private sessionGraphs: Map<string, Set<string>> = new Map();

  constructor() {
    this.startDecayProcess();
  }

  async addMemory(
    content: string,
    type: MemoryNode['type'],
    metadata: Record<string, any> = {},
    options: {
      userId?: string;
      sessionId?: string;
      source?: string;
      importance?: number;
      relationships?: Array<{ targetId: string; relationship: string; weight?: number }>;
    } = {}
  ): Promise<MemoryNode> {
    const conflictingNode = await this.findConflictingMemory(content, options.userId);
    if (conflictingNode) {
      return await this.resolveConflict(conflictingNode, content, metadata);
    }

    const node: MemoryNode = {
      id: uuidv4(),
      type,
      content,
      metadata,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 1,
      decayScore: 1.0,
      importance: options.importance ?? this.calculateImportance(content, type),
      source: options.source ?? 'user_input',
      userId: options.userId,
      sessionId: options.sessionId
    };

    this.nodes.set(node.id, node);

    if (options.userId) {
      if (!this.userGraphs.has(options.userId)) {
        this.userGraphs.set(options.userId, new Set());
      }
      this.userGraphs.get(options.userId)!.add(node.id);
    }

    if (options.sessionId) {
      if (!this.sessionGraphs.has(options.sessionId)) {
        this.sessionGraphs.set(options.sessionId, new Set());
      }
      this.sessionGraphs.get(options.sessionId)!.add(node.id);
    }

    if (options.relationships) {
      for (const rel of options.relationships) {
        await this.addEdge(node.id, rel.targetId, rel.relationship, rel.weight ?? 1.0);
      }
    }

    await this.enforceMemoryLimit();

    return node;
  }

  async addEdge(
    sourceId: string,
    targetId: string,
    relationship: string,
    weight: number = 1.0,
    metadata: Record<string, any> = {}
  ): Promise<MemoryEdge> {
    const existingEdge = Array.from(this.edges.values()).find(
      e => e.sourceId === sourceId && e.targetId === targetId && e.relationship === relationship
    );

    if (existingEdge) {
      existingEdge.weight = Math.min(existingEdge.weight + 0.1, 2.0);
      existingEdge.reinforcementCount++;
      existingEdge.lastReinforced = new Date();
      return existingEdge;
    }

    const edge: MemoryEdge = {
      id: uuidv4(),
      sourceId,
      targetId,
      relationship,
      weight,
      metadata,
      createdAt: new Date(),
      lastReinforced: new Date(),
      reinforcementCount: 1
    };

    this.edges.set(edge.id, edge);
    return edge;
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryResult> {
    const startTime = Date.now();
    const results: MemoryNode[] = [];
    const relevanceScores = new Map<string, number>();

    let candidateNodes = Array.from(this.nodes.values());

    if (query.userId) {
      const userNodeIds = this.userGraphs.get(query.userId);
      if (userNodeIds) {
        candidateNodes = candidateNodes.filter(n => userNodeIds.has(n.id) || !n.userId);
      }
    }

    if (query.memoryTypes && query.memoryTypes.length > 0) {
      candidateNodes = candidateNodes.filter(n => query.memoryTypes!.includes(n.type));
    }

    if (query.minImportance !== undefined) {
      candidateNodes = candidateNodes.filter(n => n.importance >= query.minImportance!);
    }

    candidateNodes = candidateNodes.filter(n => n.decayScore >= this.MIN_DECAY_SCORE);

    const queryTerms = query.query.toLowerCase().split(/\s+/);
    const scoredNodes = candidateNodes.map(node => {
      const contentLower = node.content.toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          score += 1;
        }
      }

      score *= node.decayScore;
      score *= (1 + node.importance);
      score *= (1 + Math.log10(node.accessCount + 1) * 0.1);

      return { node, score };
    });

    scoredNodes.sort((a, b) => b.score - a.score);

    const limit = query.limit ?? 10;
    const topNodes = scoredNodes.slice(0, limit);

    for (const { node, score } of topNodes) {
      results.push(node);
      relevanceScores.set(node.id, score);
      
      node.lastAccessedAt = new Date();
      node.accessCount++;
    }

    const relatedEdges: MemoryEdge[] = [];
    if (query.includeRelated) {
      const nodeIds = new Set(results.map(n => n.id));
      const maxHops = query.maxHops ?? 2;
      
      await this.expandGraph(nodeIds, relatedEdges, maxHops);
      
      for (const nodeId of Array.from(nodeIds)) {
        if (!results.find(n => n.id === nodeId)) {
          const node = this.nodes.get(nodeId);
          if (node) {
            results.push(node);
            relevanceScores.set(nodeId, 0.5);
          }
        }
      }
    }

    const originalTokens = results.reduce((sum, n) => sum + this.estimateTokens(n.content), 0);
    const compressedTokens = Math.floor(originalTokens * 0.1);
    const tokensSaved = originalTokens - compressedTokens;

    return {
      nodes: results,
      edges: relatedEdges,
      relevanceScores,
      totalTokensSaved: tokensSaved,
      retrievalTime: Date.now() - startTime
    };
  }

  async addEpisodicMemory(
    event: string,
    context: Record<string, any>,
    options: {
      userId?: string;
      emotionalValence?: number;
      participants?: string[];
      location?: string;
    } = {}
  ): Promise<EpisodicMemory> {
    const memory: EpisodicMemory = {
      id: uuidv4(),
      event,
      timestamp: new Date(),
      context,
      emotionalValence: options.emotionalValence ?? 0,
      participants: options.participants ?? [],
      location: options.location
    };

    this.episodicMemories.set(memory.id, memory);

    await this.addMemory(
      `Event: ${event}`,
      'event',
      { episodicId: memory.id, ...context },
      { userId: options.userId, importance: Math.abs(memory.emotionalValence) }
    );

    return memory;
  }

  async addSemanticMemory(
    concept: string,
    definition: string,
    relationships: Array<{ concept: string; relation: string }> = [],
    options: { userId?: string; confidence?: number; sources?: string[] } = {}
  ): Promise<SemanticMemory> {
    const memory: SemanticMemory = {
      id: uuidv4(),
      concept,
      definition,
      relationships,
      confidence: options.confidence ?? 0.8,
      sources: options.sources ?? []
    };

    this.semanticMemories.set(memory.id, memory);

    const node = await this.addMemory(
      `${concept}: ${definition}`,
      'concept',
      { semanticId: memory.id, confidence: memory.confidence },
      { userId: options.userId, importance: memory.confidence }
    );

    for (const rel of relationships) {
      const targetNode = Array.from(this.nodes.values()).find(
        n => n.content.toLowerCase().includes(rel.concept.toLowerCase())
      );
      if (targetNode) {
        await this.addEdge(node.id, targetNode.id, rel.relation);
      }
    }

    return memory;
  }

  async addProceduralMemory(
    skill: string,
    steps: string[],
    options: { userId?: string; prerequisites?: string[] } = {}
  ): Promise<ProceduralMemory> {
    const memory: ProceduralMemory = {
      id: uuidv4(),
      skill,
      steps,
      prerequisites: options.prerequisites ?? [],
      successRate: 1.0,
      executionCount: 0
    };

    this.proceduralMemories.set(memory.id, memory);

    await this.addMemory(
      `Skill: ${skill}\nSteps: ${steps.join(' -> ')}`,
      'skill',
      { proceduralId: memory.id, stepCount: steps.length },
      { userId: options.userId, importance: 0.9 }
    );

    return memory;
  }

  async updateProceduralSuccess(memoryId: string, success: boolean): Promise<void> {
    const memory = this.proceduralMemories.get(memoryId);
    if (memory) {
      memory.executionCount++;
      const currentWeight = memory.successRate * (memory.executionCount - 1);
      memory.successRate = (currentWeight + (success ? 1 : 0)) / memory.executionCount;
    }
  }

  private async findConflictingMemory(content: string, userId?: string): Promise<MemoryNode | null> {
    const contentLower = content.toLowerCase();
    
    for (const node of Array.from(this.nodes.values())) {
      if (userId && node.userId !== userId) continue;
      
      const similarity = this.calculateSimilarity(contentLower, node.content.toLowerCase());
      if (similarity > 0.85) {
        return node;
      }
    }
    
    return null;
  }

  private async resolveConflict(
    existingNode: MemoryNode,
    newContent: string,
    newMetadata: Record<string, any>
  ): Promise<MemoryNode> {
    const existingDate = existingNode.createdAt;
    const newDate = new Date();
    
    if (newDate > existingDate) {
      existingNode.content = newContent;
      existingNode.metadata = { ...existingNode.metadata, ...newMetadata };
      existingNode.lastAccessedAt = new Date();
      existingNode.accessCount++;
    } else {
      existingNode.accessCount++;
      existingNode.lastAccessedAt = new Date();
    }
    
    return existingNode;
  }

  private calculateSimilarity(a: string, b: string): number {
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));
    
    let intersection = 0;
    for (const word of Array.from(aWords)) {
      if (bWords.has(word)) intersection++;
    }
    
    const aArray = Array.from(aWords);
    const bArray = Array.from(bWords);
    const union = new Set([...aArray, ...bArray]).size;
    return intersection / union;
  }

  private calculateImportance(content: string, type: MemoryNode['type']): number {
    let importance = 0.5;

    const importantKeywords = ['critical', 'important', 'remember', 'always', 'never', 'must', 'key', 'essential'];
    for (const keyword of importantKeywords) {
      if (content.toLowerCase().includes(keyword)) {
        importance += 0.1;
      }
    }

    const typeWeights: Record<MemoryNode['type'], number> = {
      'preference': 0.8,
      'skill': 0.9,
      'fact': 0.7,
      'event': 0.6,
      'entity': 0.5,
      'concept': 0.7
    };
    importance *= typeWeights[type] ?? 1;

    return Math.min(importance, 1.0);
  }

  private async expandGraph(
    nodeIds: Set<string>,
    edges: MemoryEdge[],
    remainingHops: number
  ): Promise<void> {
    if (remainingHops <= 0) return;

    const newNodeIds = new Set<string>();

    for (const edge of Array.from(this.edges.values())) {
      if (nodeIds.has(edge.sourceId) && !nodeIds.has(edge.targetId)) {
        edges.push(edge);
        newNodeIds.add(edge.targetId);
      } else if (nodeIds.has(edge.targetId) && !nodeIds.has(edge.sourceId)) {
        edges.push(edge);
        newNodeIds.add(edge.sourceId);
      }
    }

    for (const id of Array.from(newNodeIds)) {
      nodeIds.add(id);
    }

    if (newNodeIds.size > 0) {
      await this.expandGraph(nodeIds, edges, remainingHops - 1);
    }
  }

  private startDecayProcess(): void {
    // Snapshot: timer removed so vitest can exit. applyDecay() is called
    // directly by the proof test.
  }

  private applyDecay(): void {
    const now = Date.now();
    
    for (const node of Array.from(this.nodes.values())) {
      const hoursSinceAccess = (now - node.lastAccessedAt.getTime()) / (1000 * 60 * 60);
      
      const decayFactor = Math.exp(-this.DECAY_RATE * hoursSinceAccess / 24);
      const importanceBoost = 1 + (node.importance * 0.5);
      const accessBoost = 1 + (Math.log10(node.accessCount + 1) * 0.2);
      
      node.decayScore = Math.max(
        this.MIN_DECAY_SCORE,
        decayFactor * importanceBoost * accessBoost
      );
    }
  }

  private async enforceMemoryLimit(): Promise<void> {
    if (this.nodes.size <= this.MAX_MEMORY_SIZE) return;

    const sortedNodes = Array.from(this.nodes.values())
      .sort((a, b) => {
        const scoreA = a.decayScore * a.importance;
        const scoreB = b.decayScore * b.importance;
        return scoreA - scoreB;
      });

    const nodesToRemove = sortedNodes.slice(0, this.nodes.size - this.MAX_MEMORY_SIZE);
    
    for (const node of nodesToRemove) {
      this.nodes.delete(node.id);
      
      for (const [edgeId, edge] of Array.from(this.edges.entries())) {
        if (edge.sourceId === node.id || edge.targetId === node.id) {
          this.edges.delete(edgeId);
        }
      }
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async extractSalientFacts(content: string, maxFacts: number = 5): Promise<string[]> {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    const scoredSentences = sentences.map(sentence => {
      let score = 0;
      
      const importantWords = ['is', 'are', 'means', 'defined', 'equals', 'always', 'never', 'must'];
      for (const word of importantWords) {
        if (sentence.toLowerCase().includes(word)) score += 1;
      }
      
      if (sentence.length > 20 && sentence.length < 200) score += 1;
      if (/\d/.test(sentence)) score += 0.5;
      
      return { sentence: sentence.trim(), score };
    });

    scoredSentences.sort((a, b) => b.score - a.score);
    
    return scoredSentences.slice(0, maxFacts).map(s => s.sentence);
  }

  getStats(): {
    totalNodes: number;
    totalEdges: number;
    episodicCount: number;
    semanticCount: number;
    proceduralCount: number;
    averageDecayScore: number;
    userCount: number;
  } {
    const decayScores = Array.from(this.nodes.values()).map(n => n.decayScore);
    const averageDecayScore = decayScores.length > 0
      ? decayScores.reduce((a, b) => a + b, 0) / decayScores.length
      : 0;

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      episodicCount: this.episodicMemories.size,
      semanticCount: this.semanticMemories.size,
      proceduralCount: this.proceduralMemories.size,
      averageDecayScore,
      userCount: this.userGraphs.size
    };
  }

  // GAP-003: GraphRAG traversal — returns entity-relationship chains as supplementary context
  async traverseEntityGraph(
    query: string,
    options: { userId?: string; maxHops?: number; maxChains?: number } = {}
  ): Promise<{ chains: string[]; nodeCount: number; edgeCount: number }> {
    const maxHops = options.maxHops ?? 3;
    const maxChains = options.maxChains ?? 8;

    const memoryResult = await this.queryMemory({
      query,
      userId: options.userId,
      limit: 6,
      includeRelated: true,
      maxHops,
    });

    const { nodes, edges, relevanceScores } = memoryResult;
    if (nodes.length === 0) {
      return { chains: [], nodeCount: 0, edgeCount: 0 };
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const chains: string[] = [];

    // Build chains: source → [relationship] → target
    for (const edge of edges.slice(0, maxChains * 2)) {
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (src && tgt) {
        // @ts-ignore snapshot is not type-checked against the current MemoryEdge
        const relLabel = edge.type || 'relates_to';
        const chain = `${src.content.slice(0, 80)} —[${relLabel}]→ ${tgt.content.slice(0, 80)}`;
        chains.push(chain);
        if (chains.length >= maxChains) break;
      }
    }

    // Fallback: include top-scored isolated nodes as graph context
    if (chains.length === 0 && nodes.length > 0) {
      const sorted = nodes.slice().sort((a, b) =>
        (relevanceScores.get(b.id) ?? 0) - (relevanceScores.get(a.id) ?? 0)
      );
      for (const node of sorted.slice(0, 4)) {
        chains.push(`[${node.type}] ${node.content.slice(0, 120)}`);
      }
    }

    return { chains, nodeCount: nodes.length, edgeCount: edges.length };
  }

  async clearUserMemory(userId: string): Promise<number> {
    const nodeIds = this.userGraphs.get(userId);
    if (!nodeIds) return 0;

    let removed = 0;
    for (const nodeId of Array.from(nodeIds)) {
      this.nodes.delete(nodeId);
      removed++;

      for (const [edgeId, edge] of Array.from(this.edges.entries())) {
        if (edge.sourceId === nodeId || edge.targetId === nodeId) {
          this.edges.delete(edgeId);
        }
      }
    }

    this.userGraphs.delete(userId);
    return removed;
  }
}

export function graphMemoryServicePreFix(): GraphMemoryService {
  return new GraphMemoryService();
}
