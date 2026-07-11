export type TopologyEdgeType = 'depends_on' | 'calls' | 'owns' | 'deployed_with' | 'shares_db';

export interface TopologyRepository {
  id: string;
  name: string;
  url?: string;
  workspaceId?: string;   // linked ctxhub workspace
  language?: string;
  tags?: string[];
  addedAt: string;
  addedBy: string;
}

export interface TopologyService {
  id: string;
  name: string;
  type?: string;           // 'api' | 'worker' | 'db' | 'queue' | 'frontend' | 'infra'
  repositoryId?: string;   // which repo it lives in
  description?: string;
  tags?: string[];
  addedAt: string;
  addedBy: string;
}

export interface TopologyEdge {
  id: string;
  fromId: string;          // service or repo ID
  fromType: 'service' | 'repository';
  toId: string;
  toType: 'service' | 'repository';
  edgeType: TopologyEdgeType;
  description?: string;
  addedAt: string;
  addedBy: string;
}

export interface TopologyStore {
  version: 1;
  repositories: TopologyRepository[];
  services: TopologyService[];
  edges: TopologyEdge[];
}
