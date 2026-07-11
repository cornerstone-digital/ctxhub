# ctxhub Identity Model
Architecture Design Document
*Status: Draft  ·  July 2026*

## 1. Purpose
The Identity Model is the canonical reference for every entity that can authenticate, own data, take actions, or be governed by permissions in ctxhub Cloud. Without it, four capabilities that become table-stakes at enterprise — SSO, SCIM, RBAC, and data ownership — each invent their own identity abstraction and they never quite agree.
This document defines: the identity hierarchy, principal types with schemas, the role model and permission matrix, token types, SSO and SCIM integration, data ownership lifecycle, and the audit trail.

Rule: every future feature that touches authentication, authorisation, or data governance must be consistent with this model. Changes to the model require a decision record.

## 2. Identity Hierarchy
The identity hierarchy is a tree. Every entity in ctxhub Cloud belongs to exactly one position in this tree. The tree is the authorisation scope boundary: permissions flow downward; data is owned at the level it was created.

```
Organisation                  ← billing scope, RBAC root
  ├── Members                 ← engineers with roles
  ├── Workspaces              ← registered ctxhub workspaces
  │     ├── Repositories      ← repos within a workspace
  │     ├── Machines          ← local runtimes syncing this workspace
  │     │     └── Captains    ← tasks running on a machine
  │     └── KnowledgeObjects  ← findings promoted from this workspace
  └── Blueprints              ← team-level task/persona/profile bundles
```

### Key properties
- Organisation is the root. No data exists outside an org. Every query is org-scoped.
- Workspace is the unit of technical identity — it maps to a codebase or service boundary.
- Machine is the unit of runtime identity — one machine token per developer machine.
- Member is the unit of human identity — one member record per engineer, regardless of how many machines or workspaces they have.
- Knowledge Objects are owned by the Workspace where they were discovered, not by the Member who promoted them. Members are provenanced, not owners.

## 3. Principal Types
### Organisation
The top-level billing and governance entity. Every other entity in ctxhub Cloud belongs to exactly one Organisation.
```
organisations {
  id          uuid PK
  slug        text UNIQUE          -- "mycompany" (URL-safe, immutable)
  name        text                 -- "My Company Ltd"
  plan        text                 -- free | team | enterprise
  created_at  timestamptz
  sso_config  jsonb (nullable)     -- OIDC/SAML config if SSO enabled
  scim_token  text (nullable)      -- hashed; present if SCIM enabled
}
```

### Member
A human engineer who has been invited to or provisioned into an Organisation. A Member has exactly one role per Organisation. A person may be a Member of multiple Organisations with different roles in each.
```
members {
  id              uuid PK
  org_id          uuid FK organisations
  external_id     text             -- IdP subject (GitHub user ID, OIDC sub)
  email           text
  display_name    text
  avatar_url      text (nullable)
  role            text             -- owner | admin | member | reader
  status          text             -- active | deactivated | pending
  invited_by      uuid FK members (nullable)
  joined_at       timestamptz (nullable)
  deactivated_at  timestamptz (nullable)
  created_at      timestamptz
}
```

### Machine
A registered local runtime. One machine corresponds to one developer laptop or CI agent running ctxhub service. A Machine belongs to one Organisation and is registered by one Member, but it may sync events for any Workspace in that Organisation.
```
machines {
  id              uuid PK
  org_id          uuid FK organisations
  registered_by   uuid FK members
  name            text             -- "martin-mbp", "ci-runner-prod"
  token_hash      text             -- bcrypt of machine token
  last_seen       timestamptz
  status          text             -- active | revoked
  revoked_at      timestamptz (nullable)
  revoked_by      uuid FK members (nullable)
  created_at      timestamptz
}
```

### Workspace
A registered ctxhub workspace — the technical boundary for a codebase or service. Workspaces are identified by a stable UUID generated at ctxhub init; name and path are mutable.
```
workspaces {
  id              uuid PK
  org_id          uuid FK organisations
  local_uuid      uuid UNIQUE      -- from ctxhub init, immutable
  name            text
  repo_names      text[]           -- ["api", "web"] — names only, no paths
  registered_by   uuid FK members
  created_at      timestamptz
}
```

### Blueprint
A versioned, distributable bundle of captain tasks, personas, and execution profiles. Blueprints are org-level entities distributed to all Machines in the Organisation on sync. Blueprint authorship is attributed to a Member.
```
blueprints {
  id              uuid PK
  org_id          uuid FK organisations
  name            text
  version         text             -- semver: "1.2.0"
  captain_tasks   jsonb            -- []CaptainTaskDefinition
  personas        jsonb            -- []PersonaDefinition
  profiles        jsonb            -- Record<string, ExecutionProfile>
  created_by      uuid FK members
  created_at      timestamptz
  published_at    timestamptz (nullable)
}
```

## 4. Role-Based Access Control
### Roles

| **Role** | **Description** | **Who holds it** |
| --- | --- | --- |
| owner | Full control: billing, member management, org deletion, all admin actions | Org creator; transferable |
| admin | Manage workspaces, machines, team tasks, blueprints, RBAC assignments. Cannot access billing. | Senior engineers, eng managers |
| member | Promote findings, create machine-level captain tasks, read all org data | All engineers |
| reader | Read-only access to org data. Cannot promote or modify anything. | Stakeholders, product, leadership |
| machine | Service account role for local runtimes. Sync only — push events, pull team tasks. No human-facing actions. | Machine tokens (not assigned to Members) |

### Permission matrix

| **Action** | **Owner** | **Admin** | **Member** | **Reader** | **Machine** |
| --- | --- | --- | --- | --- | --- |
| Manage billing / plan | ✓ |  |  |  |  |
| Invite members | ✓ | ✓ |  |  |  |
| Remove / deactivate members | ✓ | ✓ |  |  |  |
| Assign / change roles | ✓ |  |  |  |  |
| Delete organisation | ✓ |  |  |  |  |
| Register workspace | ✓ | ✓ | ✓ |  |  |
| Remove workspace | ✓ | ✓ |  |  |  |
| Register machine | ✓ | ✓ | ✓ |  |  |
| Revoke machine | ✓ | ✓ |  |  |  |
| Create team captain tasks | ✓ | ✓ |  |  |  |
| Edit / delete team captain tasks | ✓ | ✓ |  |  |  |
| Create / publish blueprints | ✓ | ✓ |  |  |  |
| Configure cascade rules | ✓ | ✓ |  |  |  |
| Configure SSO / SCIM | ✓ |  |  |  |  |
| Promote findings | ✓ | ✓ | ✓ |  |  |
| Supersede knowledge objects | ✓ | ✓ | ✓ |  |  |
| Archive knowledge objects | ✓ | ✓ |  |  |  |
| Flag knowledge object for review | ✓ | ✓ | ✓ |  |  |
| Read org timeline / captains / graph | ✓ | ✓ | ✓ | ✓ |  |
| Push sync batch |  |  |  |  | ✓ |
| Pull team tasks / blueprints |  |  |  |  | ✓ |

### Role assignment rules
- Only an Owner may assign the owner role (ownership transfer).
- An Admin may assign admin, member, or reader roles but not owner.
- A Member may not assign any role.
- The machine role is not assignable to Members — it is implicit in machine tokens.
- Every Organisation must have at least one active Owner at all times. The last Owner cannot be deactivated or have their role changed.

## 5. Token Types

| **Token type** | **Issued by** | **Lifetime** | **Scope** | **Revocable** |
| --- | --- | --- | --- | --- |
| User JWT (access) | OAuth / SSO login | 1 hour | Member permissions in one org | Via blocklist (Redis); or revoke refresh token |
| User JWT (refresh) | OAuth / SSO login | 30 days | Exchange for new access JWT | Via blocklist; or member deactivation |
| Machine token | ctxhub cloud login | 1 year | machine role in one org, one machine | Admin / owner revokes machine |
| Webhook token | ctxhub webhook create | Non-expiring | Trigger one named job | Owner / admin deletes webhook |
| Service token (enterprise) | Admin-issued | Configurable (30–365 days) | Configurable subset of member permissions | Admin revokes |
| SCIM token | Owner-generated | Non-expiring | SCIM provisioning endpoints only | Owner rotates or deletes |

### Machine token format
Machine tokens are opaque random strings (32 bytes, hex-encoded) prefixed with ctxm_ for easy identification in logs and credential scanners. The token itself is never stored — only its bcrypt hash is persisted in the machines table.
```
ctxm_a3f8b2e1c9d04721f6a8b3c2d1e0f9a87654321098abcdef1234567890abcdef
```

### User JWT claims
```
{
  "sub":    "usr_abc123",         // Member.id
  "org":    "org_xyz456",         // Organisation.id
  "role":   "member",             // RBAC role
  "email":  "martin@example.com",
  "iat":    1720000000,
  "exp":    1720003600            // 1 hour
}
```

## 6. SSO / OIDC Integration
### Phased rollout

| **Phase** | **Mechanism** | **Trigger** |
| --- | --- | --- |
| Phase 1 (MVP) | GitHub OAuth 2.0 only | Day one — all engineers have GitHub |
| Phase 2 | Generic OIDC (Google, Okta, Azure AD, Auth0) | First org requesting Google Workspace or Okta |
| Phase 3 (Enterprise) | SAML 2.0 | First deal requiring legacy enterprise IdP |

### OIDC claims mapping
When a user authenticates via OIDC, the following claims are mapped to the Member record. Existing members are matched by external_id; new members are provisioned if JIT provisioning is enabled for the org.

| **OIDC claim** | **Member field** | **Notes** |
| --- | --- | --- |
| sub | external_id | Stable IdP subject; used as the matching key |
| email | email | Updated on every login |
| name / preferred_username | display_name | Updated on every login |
| picture | avatar_url | Updated on every login |
| groups (custom) | role | Only if org has group-to-role mapping configured |

### JIT provisioning
When enabled for an org, a user authenticating via SSO for the first time is automatically created as a Member with the member role. This removes the need for explicit invitations in orgs with an IdP managing all engineers. JIT provisioning is configurable per org and disabled by default.

### SSO enforcement
Orgs with SSO configured may enforce SSO exclusively — disabling GitHub OAuth and password-based login. When enforced: existing sessions using non-SSO methods are invalidated on next token refresh. Machine tokens are not affected (they authenticate separately).

## 7. SCIM Provisioning
SCIM 2.0 allows an organisation's IdP (Okta, Azure AD, etc.) to automatically provision and deprovision Members, and to assign roles via group mappings. SCIM is an enterprise-tier feature.

### Endpoints

| **Method** | **Path** | **Description** |
| --- | --- | --- |
| GET | /scim/v2/Users | List provisioned Members |
| POST | /scim/v2/Users | Provision a new Member (creates with status=pending until first login) |
| GET | /scim/v2/Users/:id | Get a Member by SCIM id (maps to Member.external_id) |
| PUT | /scim/v2/Users/:id | Replace Member attributes (email, display_name) |
| PATCH | /scim/v2/Users/:id | Partial update (typically used to activate or deactivate) |
| DELETE | /scim/v2/Users/:id | Deprovision — sets status=deactivated, revokes tokens |
| GET | /scim/v2/Groups | List group-to-role mappings |
| POST | /scim/v2/Groups | Create a group mapping (e.g. "ctxhub-admins" → admin role) |
| DELETE | /scim/v2/Groups/:id | Remove a group mapping |

### Deprovisioning behaviour
When SCIM deprovisions a Member (DELETE or active=false PATCH), the following happens atomically:
- Member.status → deactivated, deactivated_at = now()
- All User JWTs and refresh tokens for this member are invalidated (Redis blocklist)
- All Machine tokens registered by this member are revoked
- Knowledge Objects promoted by this member are not deleted — promoted_by retains the member reference for audit purposes. The objects remain active.
- Captain runs attributed to machines registered by this member are preserved.
- If the deprovisioned member was the last Owner, deprovision is rejected with a 409 Conflict.

## 8. Data Ownership and Lifecycle
Data ownership determines what happens to entities when their associated principal is removed. The key design principle: data survives the people who created it. Audit provenance is preserved even after deprovisioning.

| **Entity** | **Owner** | **On workspace removed** | **On member deactivated** | **On org deleted** |
| --- | --- | --- | --- | --- |
| Knowledge Object | Workspace | Soft-deleted after 90-day grace period | promoted_by preserved; object stays active | Hard-deleted (data export offered first) |
| Captain Run | Machine + Workspace | Preserved (run_id + workspace_id kept) | machine.registered_by preserved; runs kept | Hard-deleted |
| Machine | Member (registered_by) | N/A | Machine revoked; runs preserved | Hard-deleted |
| Blueprint | Member (created_by) | N/A | created_by preserved; blueprint stays published | Hard-deleted |
| Team Captain Task | Org | N/A | N/A | Hard-deleted |
| Event log | Org | Events for workspace preserved for 90 days | Events preserved | Hard-deleted |

### Workspace removal grace period
Removing a workspace begins a 90-day soft-delete grace period. During this period: the workspace is hidden from Mission Control, no new sync events are accepted, but Knowledge Objects and captain run history remain queryable by admins. After 90 days the workspace and all its data are hard-deleted. Admins may cancel the removal or force immediate deletion during the grace period.

### Organisation deletion
Org deletion is a destructive, irreversible operation available only to Owners. Before deletion, the Cloud API generates a complete data export (Knowledge Objects, captain run history, event log, blueprints) in JSON format and delivers it to the Owner by email. The deletion is queued for 24 hours and may be cancelled during that window.

## 9. Audit Trail
Every action that changes authentication state, role assignment, or data ownership is written to an immutable audit log. The audit log is append-only and scoped to the Organisation.

### Audited events

| **Event type** | **Triggered by** | **Recorded fields** |
| --- | --- | --- |
| member.invited | Admin / owner invites | inviter_id, invitee_email, role |
| member.joined | Member accepts invite or SSO JIT | member_id, method (invite\|jit\|scim) |
| member.role_changed | Owner / admin | member_id, old_role, new_role, changed_by |
| member.deactivated | Admin / owner / SCIM | member_id, reason (manual\|scim\|inactivity) |
| machine.registered | Member runs cloud login | machine_id, machine_name, registered_by |
| machine.revoked | Admin / owner | machine_id, revoked_by |
| workspace.registered | Member | workspace_id, workspace_name, registered_by |
| workspace.removed | Admin / owner | workspace_id, removed_by |
| knowledge_object.promoted | Member | object_id, workspace_id, promoted_by |
| knowledge_object.superseded | Member | object_id, successor_id, actioned_by |
| knowledge_object.archived | Admin / owner | object_id, reason, actioned_by |
| sso.login | Member | member_id, method, ip_address |
| sso.login_failed | IdP rejection | email_attempted, reason, ip_address |
| sso.config_changed | Owner | changed_by, change_summary |
| scim.provisioned | IdP SCIM | member_id, scim_external_id |
| scim.deprovisioned | IdP SCIM | member_id |
| blueprint.published | Admin / owner | blueprint_id, version, published_by |
| rbac.cascade_rule_created | Admin / owner | rule_id, source_ws, target_ws, created_by |

### Audit log schema
```
audit_log {
  id          uuid PK
  org_id      uuid FK organisations
  event_type  text
  actor_id    uuid (nullable)      -- Member.id; null for system events
  actor_type  text                 -- member | machine | scim | system
  target_id   uuid (nullable)      -- the affected entity
  target_type text (nullable)      -- member | machine | workspace | knowledge_object | ...
  metadata    jsonb                -- event-specific fields
  ip_address  inet (nullable)
  user_agent  text (nullable)
  at          timestamptz
}
```

### Retention and access
- Audit log is retained for 2 years on Team plan, 7 years on Enterprise.
- Readable by Owner and Admin roles only. Not accessible to Member or Reader.
- Exportable to CSV or JSON via GET /orgs/:slug/audit-log?from=&to= (admin+).
- Not modifiable or deletable — append-only enforced at the database level (no DELETE/UPDATE grants on audit_log table).

## 10. Implementation Phases

| **Phase** | **Deliverable** | **Trigger** |
| --- | --- | --- |
| Phase 1 — MVP | GitHub OAuth, machine tokens, owner/member roles, basic audit log. No SSO, no SCIM, no reader role. | Day one with first org |
| Phase 2 — Team tier | Admin role, reader role, machine revocation, token management UI, full audit log, 90-day workspace grace period. | First org with > 5 engineers |
| Phase 3 — SSO | Generic OIDC (Okta, Azure AD, Google), JIT provisioning, SSO enforcement, group-to-role mapping. | First org requesting SSO |
| Phase 4 — SCIM | SCIM 2.0 provisioning, deprovision behaviour, SCIM token rotation. | First deal requiring automated provisioning |
| Phase 5 — Enterprise | SAML 2.0, service tokens, 7-year audit retention, per-org audit export, ownership transfer UI, single-tenant isolation. | First deal that cannot close without it |

### What the Identity Model protects
Every future feature must ask: which principal initiates this action, and does the permission matrix allow it? If the answer is unclear, the Identity Model needs updating before the feature ships. This prevents the common failure mode where authorisation is bolted on as an afterthought when an enterprise prospect first asks "who can see what?"

*ctxhub Identity Model · Draft · July 2026*
