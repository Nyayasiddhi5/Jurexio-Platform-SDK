import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-nyayagraph');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';
type RelationshipType = 'AMENDS' | 'SUPERSEDES' | 'CITES' | 'OVERRULES' | 'APPLIES' | 'DISTINGUISHES' | 'DEFINES' | 'PART_OF' | 'REFERRED_IN';

export interface StatuteNode {
  id: string;
  name: string;
  jurisdiction: JurisdictionCode;
  year: number;
  type: 'act' | 'rules' | 'ordinance';
}

export interface SectionNode {
  id: string;
  statuteId: string;
  number: string;
  title: string;
  text: string;
  validFrom: Date;
  validTo?: Date;
}

export interface CaseNode {
  id: string;
  citation: string;
  court: string;
  year: number;
  judge?: string;
  outcome?: string;
  jurisdiction: JurisdictionCode;
}

export interface LegalConceptNode {
  id: string;
  name: string;
  definition: string;
  domain: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: RelationshipType;
  properties: Record<string, unknown>;
}

export interface CitationChain {
  startNode: string;
  nodes: string[];
  edges: GraphEdge[];
  hops: number;
}

export interface GraphPath {
  nodes: string[];
  edges: GraphEdge[];
  totalWeight: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
}

export class NvNyayaGraphService {
  private static instance: NvNyayaGraphService;
  private nodes: Map<string, Record<string, unknown>> = new Map();
  private edges: Map<string, GraphEdge[]> = new Map();
  private reverseEdges: Map<string, GraphEdge[]> = new Map();
  private neo4jDriver: any = null;
  private useNeo4j: boolean = false;

  private constructor() {
    const neo4jUrl = process.env.NEO4J_URL;
    if (neo4jUrl) {
      this.useNeo4j = true;
      this.initNeo4j(neo4jUrl).catch(err => {
        logger.warn({ service: 'NvNyayaGraphService', warning: 'Neo4j unavailable, using in-memory graph', error: err.message });
        this.useNeo4j = false;
      });
    }
    logger.info({ service: 'NvNyayaGraphService', backend: this.useNeo4j ? 'neo4j' : 'in-memory' });
  }

  static getInstance(): NvNyayaGraphService {
    if (!NvNyayaGraphService.instance) {
      NvNyayaGraphService.instance = new NvNyayaGraphService();
    }
    return NvNyayaGraphService.instance;
  }

  private async initNeo4j(url: string): Promise<void> {
    try {
      const neo4j = await import('neo4j-driver');
      this.neo4jDriver = neo4j.default.driver(url, neo4j.default.auth.basic(
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || ''
      ));
      await this.neo4jDriver.verifyConnectivity();
    } catch (err: any) {
      this.useNeo4j = false;
      throw err;
    }
  }

  async addStatute(statute: StatuteNode): Promise<void> {
    this.nodes.set(statute.id, { ...statute, nodeType: 'statute' });
    if (!this.edges.has(statute.id)) this.edges.set(statute.id, []);
  }

  async addSection(section: SectionNode): Promise<void> {
    this.nodes.set(section.id, { ...section, nodeType: 'section' });
    if (!this.edges.has(section.id)) this.edges.set(section.id, []);
    await this.addRelationship(section.id, section.statuteId, 'PART_OF');
  }

  async addCase(caseNode: CaseNode): Promise<void> {
    this.nodes.set(caseNode.id, { ...caseNode, nodeType: 'case' });
    if (!this.edges.has(caseNode.id)) this.edges.set(caseNode.id, []);
  }

  async addConcept(concept: LegalConceptNode): Promise<void> {
    this.nodes.set(concept.id, { ...concept, nodeType: 'concept' });
    if (!this.edges.has(concept.id)) this.edges.set(concept.id, []);
  }

  async addRelationship(from: string, to: string, type: RelationshipType, props?: Record<string, unknown>): Promise<void> {
    const edge: GraphEdge = { from, to, type, properties: props || {} };

    if (!this.edges.has(from)) this.edges.set(from, []);
    this.edges.get(from)!.push(edge);

    if (!this.reverseEdges.has(to)) this.reverseEdges.set(to, []);
    this.reverseEdges.get(to)!.push(edge);
  }

  async findCitationChain(sectionId: string, maxHops: number = 5): Promise<CitationChain> {
    const visited = new Set<string>();
    const nodes: string[] = [sectionId];
    const edges: GraphEdge[] = [];

    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: sectionId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= maxHops || visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outEdges = this.edges.get(nodeId) || [];
      for (const edge of outEdges) {
        if (['CITES', 'APPLIES', 'REFERRED_IN'].includes(edge.type)) {
          edges.push(edge);
          if (!visited.has(edge.to)) {
            nodes.push(edge.to);
            queue.push({ nodeId: edge.to, depth: depth + 1 });
          }
        }
      }
    }

    return { startNode: sectionId, nodes, edges, hops: edges.length };
  }

  async findOverruledCases(caseId: string): Promise<CaseNode[]> {
    const overruled: CaseNode[] = [];
    const outEdges = this.edges.get(caseId) || [];
    for (const edge of outEdges) {
      if (edge.type === 'OVERRULES') {
        const node = this.nodes.get(edge.to);
        if (node && (node as any).nodeType === 'case') {
          overruled.push(node as unknown as CaseNode);
        }
      }
    }
    return overruled;
  }

  async findRelatedConcepts(concept: string, jurisdiction: JurisdictionCode): Promise<LegalConceptNode[]> {
    const results: LegalConceptNode[] = [];
    for (const [, node] of this.nodes) {
      if ((node as any).nodeType === 'concept' && (node as any).name?.toLowerCase().includes(concept.toLowerCase())) {
        results.push(node as unknown as LegalConceptNode);
      }
    }
    return results;
  }

  async multiHopTraversal(startId: string, relationshipTypes: RelationshipType[], maxHops: number = 3): Promise<GraphPath[]> {
    const paths: GraphPath[] = [];
    const visited = new Set<string>();

    const dfs = (nodeId: string, currentPath: string[], currentEdges: GraphEdge[], depth: number) => {
      if (depth >= maxHops) {
        if (currentPath.length > 1) {
          paths.push({
            nodes: [...currentPath],
            edges: [...currentEdges],
            totalWeight: currentEdges.length,
          });
        }
        return;
      }

      visited.add(nodeId);
      const outEdges = this.edges.get(nodeId) || [];
      let hasChildren = false;

      for (const edge of outEdges) {
        if (relationshipTypes.includes(edge.type) && !visited.has(edge.to)) {
          hasChildren = true;
          currentPath.push(edge.to);
          currentEdges.push(edge);
          dfs(edge.to, currentPath, currentEdges, depth + 1);
          currentPath.pop();
          currentEdges.pop();
        }
      }

      if (!hasChildren && currentPath.length > 1) {
        paths.push({
          nodes: [...currentPath],
          edges: [...currentEdges],
          totalWeight: currentEdges.length,
        });
      }

      visited.delete(nodeId);
    };

    dfs(startId, [startId], [], 0);
    return paths;
  }

  async doesCitationPathExist(fromId: string, toId: string): Promise<boolean> {
    const visited = new Set<string>();
    const queue = [fromId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === toId) return true;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const outEdges = this.edges.get(nodeId) || [];
      for (const edge of outEdges) {
        if (['CITES', 'APPLIES', 'REFERRED_IN', 'AMENDS'].includes(edge.type)) {
          queue.push(edge.to);
        }
      }
    }

    return false;
  }

  async getGraphStats(): Promise<GraphStats> {
    const nodesByType: Record<string, number> = {};
    for (const [, node] of this.nodes) {
      const type = (node as any).nodeType || 'unknown';
      nodesByType[type] = (nodesByType[type] || 0) + 1;
    }

    const edgesByType: Record<string, number> = {};
    let totalEdges = 0;
    for (const [, edgeList] of this.edges) {
      for (const edge of edgeList) {
        edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
        totalEdges++;
      }
    }

    return { nodeCount: this.nodes.size, edgeCount: totalEdges, nodesByType, edgesByType };
  }
}

export const nvNyayaGraphService = NvNyayaGraphService.getInstance();
