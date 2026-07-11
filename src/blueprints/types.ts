export interface BlueprintManifest {
  name: string;           // e.g. "fintech-compliance"
  version: string;        // semver
  description: string;
  author?: string;
  license?: string;
  tags?: string[];
  requires?: { runtime: string }; // semver range e.g. ">=0.5.0"
  includes?: {
    personas?: string[];         // relative paths to persona files
    captainTasks?: string[];     // relative paths to captain task files
    missionTemplates?: string[]; // relative paths
    knowledgeSources?: string[]; // paths to sample docs
  };
}

export interface InstalledBlueprint {
  name: string;
  version: string;
  installedAt: string; // ISO
  path: string;        // absolute path to installed dir
}

export interface BlueprintStore {
  version: 1;
  installed: InstalledBlueprint[];
}
