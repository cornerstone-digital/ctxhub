# Rebrand candidates (replacing "ctxhub")

Context: "ctxhub" collides with [andrewyng/context-hub](https://github.com/andrewyng/context-hub) (13.7k stars, real Andrew Ng project, same problem space). Real-word metaphor names (Groundcrew, Waypoint, Beacon, Callsign, Tarmac) were tried and **all disqualified** on deep-dive — see rejected list at the bottom. This list pivots to coined/invented words, which are inherently lower collision risk.

**Methodology:** every name below was checked against the npm registry (is the bare package name published?) and GitHub (is the exact string already a username or org — usernames and orgs share one namespace, so an inactive personal account still blocks you from getting that org name). The 13 names clean on *both* were then run through a general web search for existing products/companies.

**Domain check (added after initial pass):** ran `whois` (built into macOS, no MCP install needed) against .com/.io/.ai for the top 5. `.dev` couldn't be checked this way — its registry (Google/Charleston Road Registry) doesn't resolve through the standard whois referral chain, so those need a manual registrar check.

| Name | .com | .io | .dev | .ai |
|------|------|-----|------|-----|
| **kairowise** | ✅ available | ✅ available | ⚠️ unchecked | ✅ available |
| ctxmind | ❌ taken (registered 2026-03-18) | ✅ available | ⚠️ unchecked | ✅ available |
| texero | ❌ taken (registered 2008, long-held) | ✅ available | ⚠️ unchecked | ✅ available |
| knowmesh | ❌ taken (drop-caught 2024) | ✅ available | ⚠️ unchecked | ❌ taken (registered 3 days before this check) |
| mindora | ❌ taken (2004) | ❌ taken (2025) | ⚠️ unchecked | ❌ taken (2023) |

**kairowise is the only name clean across npm, GitHub, .com, .io, and .ai simultaneously.** Verify .dev manually, but this is the strongest candidate found so far.

---

## Top tier — clean on npm AND GitHub

These are the strongest candidates: no published npm package, no existing GitHub user/org with the exact name, and a general web search turned up nothing meaningful.

| Name | Root / feel | Web search finding |
|------|-------------|---------------------|
| **ctxmind** | `ctx` (kept from current brand) + mind | Nothing found |
| **mindora** | mind + -ora | Nothing found |
| **knowmesh** | knowledge + mesh (network of knowledge) | Nothing found |
| **seedmesh** | seed (knowledge that grows) + mesh | Nothing found |
| **memogrid** | memory + grid | Nothing found |
| **texero** | from Latin *texere*, "to weave" — same root as "context" itself | Nothing found |
| **truwise** | true/truth + wise | Nothing found |
| **truvault** | true/truth + vault | Nothing found |
| **lensforge** | lens (focus/clarity) + forge | Nothing found |
| **kilnwise** | kiln (where things are made durable/fired) + wise | Nothing found |
| **foundrymind** | foundry (where things are forged) + mind | Nothing found |
| **kairowise** | *kairos* (Greek: "the right/opportune moment") + wise — ties into "the loop" (right moment to promote/approve knowledge) | Nothing found |
| **guildwise** | guild (collective expertise) + wise | One weak, irrelevant hit: a small Guild Wars 2 fan chatbot on FlowGPT. Not a real product/trademark risk. |

**Updated ranking after the domain check below:**
1. **kairowise** — the only name clean on npm, GitHub, .com, .io, *and* .ai simultaneously. Also the best conceptual fit: *kairos* ("the right moment") maps directly onto your own Loop principle (Observe → Understand → Recommend → **Approve** → Remember).
2. **ctxmind** — keeps a thread of continuity with "ctxhub" (same `ctx` prefix), short, clean on npm/GitHub/.io/.ai — but `.com` is already taken (registered March 2026, likely squatted/parked).
3. **texero** — the etymological callback (context = "woven together," texero = "I weave") is a genuinely good pitch story, clean on npm/GitHub/.io/.ai — but `.com` has been held since 2008 (long-held, not a recent squat, unlikely to free up).

---

## Second tier — clean on npm, taken on GitHub (username/org blocked)

Still usable if you don't need the exact string as your GitHub org (e.g. add a suffix like `-hq`, `-labs`, `-dev`, or use a scoped npm package `@yourorg/name`), but the "everything matches exactly" version isn't available.

| Name | npm | GitHub blocker |
|------|-----|-----------------|
| ctxweave | available | taken |
| contexo | available | taken |
| weavio / weavely / weavora | available | taken |
| threadora / threadwise | available | taken |
| warpwise / weftly | available | taken |
| knowio / knowforge | available | taken |
| mindforge / mindmesh | available (mindmesh) / taken (mindforge npm) | taken |
| cogenta / cognara / gnosara / gnostik | available | taken |
| scientra / veritask | available | taken |
| grainly / graino / ringora / rootwise / graftly | available | taken |
| layerforge / bloomcore / stratamind / strataforge | available | taken |
| axiomind / axiowise / prismly / prismora | available | taken |
| scopewise / arcweave / echoforge | available | taken |
| forgemind / smithcore | available | taken |
| kelvra / novira / zentari / corvexa / alvira / quorvia | available | taken |
| mirava / solenne | available | taken |
| kairoslabs / kairolabs | available | taken |
| loomex / cortho | available | taken |
| noemis / praxora | available | taken |
| codeloom / codegrain | available | taken |

---

## Rejected — real-word metaphors that looked promising but collided

Kept for the record so we don't re-propose these later.

| Name | Why rejected |
|------|--------------|
| Groundcrew | 3+ existing AI-coding-agent tools with this exact name (ClipboardHealth/groundcrew, prolego-team/groundcrew, an MCP server named Groundcrew), plus a funded/Crunchbase-tracked 2011 startup |
| Waypoint | HashiCorp's own product — 4,725 GitHub stars, part of their commercial HCP platform |
| Beacon | "Agent Beacon" is an OSS telemetry layer that explicitly instruments Claude Code and Claude CoWork |
| Callsign | Real London identity-verification company (Callsign Ltd) — and they have an existing named partnership with **Three UK**, one of the three VF3 entities in the actual trial. Near-miss disaster if pitched as-is. |
| Tarmac | Tarmac Group — 150-year-old, 7,000-employee British construction materials company (part of CRH). Bad optics for a UK enterprise pitch. |
| Hangar / HangarHQ | No direct dev-tool collision, but an established startup branding studio (hangar.co) and a venture builder ("Hangar Worldwide") occupy the same startup-world space |
| Logbook | Clean but too generic/common a word to own distinctively |

---

## Next steps

1. Pick 2-4 favorites from the top tier.
2. Check domain availability directly on a registrar (.com, .io, .dev, .ai) — this file doesn't cover that.
3. Once a name is chosen, do one more targeted web search specifically for that name + "AI" + "coding agent" + "MCP" before committing, the same way the rejected list was caught.
4. Only then start the actual rename (package.json, CLI binary name, docs, MCP config keys, VF3 demo script, screenshots).

---

## Round 2 — plainer, less obscure names (2026-07-12)

Feedback on round 1: kairowise-style coined/Greek-root names felt too obscure for an easy brand identity. This round leans into vocabulary the product already uses internally (Fleet, Crew, Mission Control, Captains) plus a few plainer compounds, on the theory that brand/product vocabulary alignment beats a clever etymology.

**Method:** same as round 1 — `npm view <name>` for registry status, GitHub REST API (`api.github.com/users/<name>`, 404 = available) for username/org, `whois` for .com/.io/.ai, then a live-fetch check on any `.com` that came back "taken" to see if it's a real business or just an unreachable/parked registration (real collision vs. buyable-later).

28 candidates checked. Full result:

| Name | npm | GitHub | .com | .io | .ai | Notes |
|------|-----|--------|------|-----|-----|-------|
| **signalcrew** | ✅ | ✅ | taken (unreachable/likely parked) | ✅ available | ✅ available | Strongest all-rounder |
| **knowlane** | ✅ | ✅ | taken (registered Aug 2025, unreachable — likely squatted) | ✅ available | ✅ available | Plain, easy to say/spell |
| **loopcrew** | ✅ | ✅ | taken (cert mismatch on generic German host — likely parked, not a real site) | ✅ available | ✅ available | Directly names "The Loop" principle |
| **pathcrew** | ✅ | ✅ | taken (not fetch-checked) | ✅ available | ✅ available | |
| **contextcrew** | ✅ | ✅ | taken (not fetch-checked) | ✅ available | ✅ available | Keeps "context" explicitly |
| **relaybay** | ✅ | ✅ | taken (not fetch-checked) | ✅ available | ✅ available | |
| **knowbay** | ✅ | ✅ | taken (not fetch-checked) | ✅ available | ✅ available | |
| relaywise | ✅ | ✅ | taken | ✅ available | ❌ taken | Weaker — .ai gone |
| missiondeck | ✅ | ✅ | taken (unreachable — likely parked) | ❌ taken | ❌ taken | Weak — only npm/GitHub clean |
| basecrew | ✅ | ✅ | taken | ❌ taken | ✅ available | Weak — two of three domains gone |
| crewbay | ✅ | ✅ | **taken by a real, active business** (crewbay.com — yacht/sailing crew marketplace since 2004) | — | — | **Rejected: genuine collision**, not just squatted |
| fleetdeck / fleetmind / fleetwise / fleetsignal / crewmind / missionwise / relaymind / agentcrew / agentlane / pilotdeck / pilotcrew / bridgedeck / fleetbay / crewbase | ✅ (npm clean) | ❌ taken | — | — | — | Eliminated — GitHub username/org already claimed |
| crewdeck / deckhand / agentdeck / flightdeck / teamloop / workloop | ❌ taken | — | — | — | — | Eliminated — npm package already published |

**Every `.com` in this round came back registered** — at this point in domain-name history, virtually every short pronounceable two-word `.com` is claimed, whether by a real business, a squatter, or dead-and-parked. Spot-checking with a live fetch is the only way to tell which: `crewbay.com` turned out to be a genuine 20-year-old operating business (dropped), while `missiondeck.com`, `knowlane.com`, and `loopcrew.com` don't even resolve to a working site (registered but unused — likely parked/buyable, not a real collision). `pathcrew.com`, `contextcrew.com`, `relaybay.com`, `knowbay.com` are taken but weren't fetch-checked yet.

**Round 2 shortlist (clean npm + GitHub, .io and .ai both open):** signalcrew, knowlane, loopcrew, pathcrew, contextcrew, relaybay, knowbay.

Not ranked against round 1's kairowise/ctxmind/texero yet — that's the next pass, once we're actually ready to act on a rename.

---

## Status: paused

Deliberately sidetracked from product work to chase this — pausing here. **Do not act on a rename until the product is built and has a working test suite** to safely refactor package name, CLI binary, docs, and MCP config keys against. Revisit this file then:

1. Merge round 1 (kairowise, ctxmind, texero) and round 2 (signalcrew, knowlane, loopcrew, pathcrew, contextcrew, relaybay, knowbay) into one ranked shortlist.
2. Finish the live-site fetch checks on the round 2 `.com`s that weren't spot-checked yet (pathcrew, contextcrew, relaybay, knowbay).
3. Do the targeted "<name> + AI + coding agent + MCP" collision search on whatever's still standing before committing.
4. Then start the actual rename.
