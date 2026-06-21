import type { Citation, CitationAuditResult, RetrievalMetadata } from '@/types';

export type KnowledgeMapNodeType = 'concept' | 'method' | 'finding' | 'question' | 'source' | 'term';
export type KnowledgeMapEdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export interface KnowledgeMapNode {
  id: string;
  label: string;
  type: KnowledgeMapNodeType;
  summary: string;
  community: string;
  sourceId?: string;
  sourceTitle?: string;
  sourceLocation?: string;
  citationNumbers: number[];
  degree: number;
  focal?: boolean;
}

export interface KnowledgeMapEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: KnowledgeMapEdgeConfidence;
  evidence: string;
  citationNumbers: number[];
}

export interface KnowledgeMapCommunity {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface KnowledgeMapAnalysis {
  hubNodes: Array<{ id: string; label: string; degree: number }>;
  bridgeEdges: Array<{
    source: string;
    target: string;
    relation: string;
    confidence: KnowledgeMapEdgeConfidence;
    why: string;
  }>;
  suggestedQuestions: string[];
}

export interface KnowledgeMapData {
  schemaVersion: 1;
  title: string;
  generatedAt: string;
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
  communities: KnowledgeMapCommunity[];
  analysis: KnowledgeMapAnalysis;
}

export interface KnowledgeMapResponse {
  map: KnowledgeMapData;
  citations: Citation[];
  retrieval: RetrievalMetadata;
  citationAudit: CitationAuditResult;
}
