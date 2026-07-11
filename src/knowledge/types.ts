export type KnowledgeObjectState = 'draft' | 'active' | 'superseded' | 'archived';

export interface KnowledgeObject {
  id: string;                    // UUID
  workspaceId: string;
  sourceChunkId?: string;        // chunk it was derived from
  title: string;
  content: string;               // the knowledge statement
  state: KnowledgeObjectState;
  confidence: number;            // 0.0–1.0
  corroborations: string[];      // IDs of other KOs that support this one
  reviewFlag?: boolean;          // flagged for human review
  tags?: string[];
  createdAt: string;             // ISO
  updatedAt: string;
  createdBy: string;             // sub
  supersededBy?: string;         // ID of the KO that replaced this one
  archiveReason?: string;
}

export type KnowledgeEdgeType = 'supports' | 'contradicts' | 'supersedes' | 'related_to' | 'derived_from';

export interface KnowledgeEdge {
  id: string;
  fromId: string;       // KnowledgeObject id
  toId: string;         // KnowledgeObject id
  edgeType: KnowledgeEdgeType;
  description?: string;
  confidence: number;   // 0–1
  createdAt: string;
  createdBy: string;
}

export interface Concept {
  id: string;
  name: string;         // e.g. "database selection", "authentication"
  description?: string;
  relatedObjectIds: string[];  // KO ids that mention this concept
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeStore {
  version: 1;
  objects: KnowledgeObject[];
  edges: KnowledgeEdge[];
  concepts: Concept[];
}
