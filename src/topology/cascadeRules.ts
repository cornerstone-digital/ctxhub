export type CascadeBasis = 'topology' | 'manual';

export interface CascadeRule {
  id: string;
  name: string;
  description?: string;
  triggerOrgId: string;        // finding in this org triggers...
  targetOrgId: string;         // ...a run in this org
  triggerTags?: string[];      // only cascade if finding has these tags
  targetWorkspace?: string;    // run captain in this workspace
  basis: CascadeBasis;         // 'topology' = auto from depends_on; 'manual' = explicit
  topologyEdgeId?: string;     // if basis='topology', which edge created this
  createdAt: string;
  createdBy: string;
  active: boolean;
}

export interface CascadeRuleStore {
  version: 1;
  rules: CascadeRule[];
}
