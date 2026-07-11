export interface ScimUser {
  id: string;
  externalId?: string;
  userName: string;   // email
  displayName?: string;
  active: boolean;
  emails?: Array<{ value: string; primary?: boolean }>;
  groups?: Array<{ value: string; display?: string }>;
  meta: { resourceType: 'User'; created: string; lastModified: string; location: string };
}

export interface ScimGroup {
  id: string;
  externalId?: string;
  displayName: string;
  members?: Array<{ value: string; display?: string }>;
  meta: { resourceType: 'Group'; created: string; lastModified: string; location: string };
}

export interface ScimListResponse<T> {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimError {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'];
  status: string;
  detail: string;
}

export interface ScimStore {
  version: 1;
  users: ScimUser[];
  groups: ScimGroup[];
}
