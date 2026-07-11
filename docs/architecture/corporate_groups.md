# Corporate Groups

Architecture Design Document
*Status: Draft · July 2026*

*Related: [Identity Model](../ctxhub_identity_model.docx) · [Trust Model](../trust_model.md) · [Org Graph](../org_graph_architecture.md) · [Federation ADR (M13)](../adr/)*

---

## 1. Problem Statement

ctxhub currently models identity at two levels: a **Workspace** (a single engineer's local instance) and an **Org** (an organisation with a shared ctxhub tenant). For most organisations, this is sufficient: all members share one Entra tenant, one data boundary, one governance policy.

The VodafoneThree UK situation does not fit this model. Vodafone UK Engineering and Three UK Engineering are distinct legal entities: separate Entra tenants, separate compliance obligations, separate data residency postures. They cannot and should not share a single ctxhub Org — conflating them would violate the compliance boundary that each entity is legally required to maintain.

The obvious alternative — **Federation (M13)** — is also a poor fit. Federation is designed for peer-to-peer relationships between independent organisations that have no common parent and no pre-existing trust hierarchy. It is symmetric, requires both sides to explicitly initiate a connection, and provides no mechanism for a corporate parent to govern or audit knowledge sharing. Two subsidiaries of the same corporate group need a different model: one where the parent entity can define the trust relationship, both organisations can be onboarded to a shared topology, and knowledge crosses the boundary only under explicit, auditable conditions.

**Corporate Groups** is that model.

The design goals are:
- Maintain hard data residency and compliance boundaries between legal entities
- Allow a corporate parent to define a knowledge-sharing topology without either subsidiary ceding control of their own data
- Ensure only promoted, high-trust knowledge crosses org boundaries — raw indexed files never leave the org that owns them
- Be strictly opt-in: existing single-org deployments are unaffected

---

## 2. Data Model

### 2.1 CorporateGroup

The parent entity. Created and owned by a designated administrator (typically a platform or security team at the corporate parent level).

```json
{
  "id": "cg_01jwx9k3b0f3vg",
  "displayName": "VodafoneThree UK",
  "ownerTenantId": "vodafonethree-group-tenant-id",
  "createdAt": "2026-07-11T09:00:00Z",
  "createdBy": "admin@vodafonethreegroup.co.uk"
}
```

A `CorporateGroup` is purely an organisational container — it holds no data of its own. Its sole function is to provide a shared identity under which member Orgs can establish sharing relationships.

### 2.2 Org

A legal entity or distinct business unit within the group. An Org maps to an existing ctxhub tenant, identified by an Entra tenant ID plus an optional group filter (for organisations that use a single Entra tenant but need to distinguish sub-populations by Entra group membership).

```json
{
  "id": "org_01jwy2n4m8q7rh",
  "displayName": "Vodafone UK Engineering",
  "corporateGroupId": "cg_01jwx9k3b0f3vg",
  "entraTenantId": "vodafone-uk-tenant-id",
  "entraGroupFilter": null,
  "createdAt": "2026-07-11T09:05:00Z"
}
```

The `entraGroupFilter` field is optional. When set, only users who are members of the specified Entra group (by object ID) are treated as members of this Org within the Corporate Group context. This supports scenarios where a single Entra tenant spans multiple legal entities.

### 2.3 GroupMembership

The relationship between an Org and a CorporateGroup, with an explicit trust tier.

```json
{
  "id": "gm_01jwy3p5n9r8si",
  "corporateGroupId": "cg_01jwx9k3b0f3vg",
  "orgId": "org_01jwy2n4m8q7rh",
  "trustTier": "participant",
  "addedAt": "2026-07-11T09:05:00Z",
  "addedBy": "admin@vodafonethreegroup.co.uk"
}
```

**Trust tiers:**

| Tier | Meaning |
|---|---|
| `observer` | Org can see the group topology (which other orgs are members) but cannot participate in knowledge sharing |
| `participant` | Org can participate in knowledge sharing, subject to per-pair sharing modes |
| `trusted` | Org is designated as a trust anchor; future use for group-level governance delegation |

---

## 3. Knowledge Sharing Model

Sharing is configured per Org pair within a group. The default for any pair is `none`. A group administrator can elevate this to `read` or `bidirectional`.

| Mode | Meaning |
|---|---|
| `none` | No cross-org visibility. Default for all new pairs. |
| `read` | Org A can search Org B's promoted knowledge. Unidirectional. |
| `bidirectional` | Both orgs can search each other's promoted knowledge. |

**Sharing is always pull, never push.** When a user in Org A issues a cross-org search, ctxhub queries Org B's index on their behalf and returns results attributed to their source. There is no replication of data: nothing from Org B is copied into Org A's index. The data never leaves Org B's storage boundary.

**Only promoted knowledge crosses org boundaries.** The eligible set for cross-org search is restricted to chunks where `trustTier >= institutional`. In practice this means:

- `Unverified` — not eligible
- `Reviewed` — not eligible
- `Promoted` — not eligible
- `Institutional Knowledge` — eligible
- `Canonical` — eligible

This is a deliberate design choice. Raw captain output, individual promoted notes, and draft findings are internal artefacts that may contain speculation, provisional conclusions, or sensitive internal context. Only knowledge that has aged into the `Institutional Knowledge` tier — meaning it has been promoted, referenced, and implicitly re-validated over time — is considered safe for cross-boundary exposure.

---

## 4. Identity and Access

### Org membership resolution

At login time, ctxhub inspects the user's Entra token claims:

1. Extract the `tid` (tenant ID) claim.
2. Query whether this tenant ID matches any Org in a CorporateGroup.
3. If an `entraGroupFilter` is configured for that Org, additionally verify the user is a member of the specified Entra group (via the token's `groups` claim or a graph API call at login time).
4. If both conditions are met, the user's session carries an `orgMembership` claim identifying their Org within the Corporate Group.

### Cross-org search authorisation

When a request arrives with `cross-org=true`:

1. Resolve the requesting user's Org (from session `orgMembership`).
2. For each other Org in the same CorporateGroup, check the sharing mode.
3. Fan out the search query to Orgs where the mode is `read` or `bidirectional` (and the requesting Org's side permits it).
4. Merge results, annotating each with `sourceOrg`.

### Isolation guarantees

- No user from Org A ever appears in Org B's user list, audit log, or member directory.
- Cross-org search results do not expose the identity of the engineer who promoted a knowledge object — only the Org and the knowledge object content.
- A user who is simultaneously a member of both Org A and Org B (e.g. a contractor with accounts in both Entra tenants) is treated as two separate identities. There is no session merging.

---

## 5. API Design

These are the server routes needed to support Corporate Groups. They are sketched here for design review; full OpenAPI specs will be written at implementation time.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/group` | Create a new CorporateGroup. Caller must be authenticated as a group-level admin. |
| `POST` | `/group/:id/org` | Add an Org to a group. Body: `{ orgId, trustTier }`. |
| `GET` | `/group/:id` | Return the group topology: member orgs, their trust tiers, and sharing modes between all pairs. |
| `PATCH` | `/group/:id/org/:orgId/sharing` | Update the sharing mode between two orgs. Body: `{ targetOrgId, mode }`. Requires group admin. |
| `GET` | `/search?q=...&cross-org=true` | Existing search route, extended to fan out to permitted orgs when `cross-org=true` is set and the user's Org has participant-level membership in a CorporateGroup. |

The `/search` extension is designed to be transparent to existing clients: the `cross-org` flag is opt-in, the response shape is unchanged except for the addition of `sourceOrg` on each result, and all existing single-org search behaviour is unaffected.

---

## 6. Trust Boundary Enforcement

The indexer and search layer enforce the following invariants:

**At index time:** Every chunk written to the vector store includes a `trustTier` field, derived from the Trust Model lifecycle state of the containing Knowledge Object. This field is updated in place when a Knowledge Object transitions between trust tiers (e.g. from `promoted` to `institutional`).

**At cross-org search time:**
1. The search query is issued against the target Org's index.
2. A mandatory filter `trustTier IN ('institutional', 'canonical')` is applied before any semantic similarity ranking.
3. Results are returned to the requesting Org's search layer with a `sourceOrg` annotation.
4. The requesting Org's search layer merges and re-ranks results from all orgs.

**What is never exposed across the boundary:**
- Raw indexed file contents
- Captain run output (unreviewed findings)
- Promoted notes that have not reached `institutional` tier
- User identities (who promoted what)
- Internal Org metadata (workspace names, repository names, captain task configurations)

The `sourceOrg` field on cross-org results contains only the Org's `displayName` and `id` — sufficient for the user to understand provenance without exposing internal structure.

---

## 7. Rollout Sequence

Corporate Groups is an additive, opt-in feature. The rollout is designed so that no existing deployment is affected until an administrator explicitly creates a CorporateGroup.

**M1–M5 (current):** All deployments are single-org. There is no CorporateGroup concept. No migration required.

**M6 — VF3 trial:** The M6 design partner trial with VodafoneThree UK is a single-org deployment under whichever legal entity sponsors the trial. No CorporateGroup is created. This is deliberate: M6 validates the core indexing and knowledge promotion loop before introducing cross-boundary complexity.

**Post-M6 — Corporate Groups GA:** If VodafoneThree UK wants to extend the trial to both Vodafone UK Engineering and Three UK Engineering with cross-org knowledge sharing:
1. A group administrator creates a CorporateGroup (`VodafoneThree UK`).
2. Both Orgs are added as `participant` members.
3. Sharing mode between the two Orgs is set to `bidirectional` (or `read`, per their governance decision).
4. Engineers in either Org gain the ability to issue `cross-org=true` search queries.

**For all other deployments:** Creating a CorporateGroup is not required and changes nothing. Single-org deployments remain single-org indefinitely.

---

## 8. Open Questions

1. **Conflict resolution across org boundaries.** If the same internal document (e.g. a shared ADR or architectural pattern) has been indexed and promoted independently in both Org A and Org B, a cross-org search will return two semantically near-identical results with different provenance. The current model returns both; it does not attempt to deduplicate or merge them. Is this the right behaviour, or should the search layer detect near-duplicates in cross-org results and surface provenance information to help the user choose?

2. **Audit trail for cross-org reads.** When a user in Org A reads a knowledge object from Org B via cross-org search, this is currently not recorded in Org B's audit log (since the query is issued on behalf of Org A's search layer, not a user of Org B). Should cross-org reads generate an audit event in the target org's event log? This has GDPR implications (see below) but may be required for regulatory compliance in financial services deployments.

3. **GDPR and cross-boundary search results.** Knowledge objects in ctxhub do not currently contain PII by design — they represent engineering findings, not personal data. However, promoted findings about an engineer's work (e.g. "Alice's service has a known race condition") could indirectly identify individuals. Before cross-org search is enabled for any deployment, a data protection assessment should determine whether promoted knowledge objects constitute personal data under UK GDPR, and if so, what the legal basis for cross-boundary sharing is.

4. **Trust tier staleness across org boundaries.** When a knowledge object in Org B is promoted to `institutional` tier and becomes eligible for cross-org search, then later transitions to `superseded` or `archived` within Org B, the cross-org search layer must stop returning it. This requires either a synchronous check against Org B's current trust tier at query time (adds latency, adds coupling) or a cache invalidation mechanism (adds complexity). The right approach depends on how frequently knowledge objects are superseded in practice.

5. **Group administrator role and governance.** The current design assumes a group-level administrator role distinct from Org-level admins. The mechanism for bootstrapping this role — who creates the first CorporateGroup and how their authority is verified — is not yet defined. In a corporate context, this likely requires out-of-band verification (e.g. a signed agreement between the ctxhub account team and the corporate parent). The in-product mechanism for representing and verifying this authority needs design.
