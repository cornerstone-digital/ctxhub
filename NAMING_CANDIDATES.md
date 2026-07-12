# Rebrand candidates (replacing "ctxhub")

Context: "ctxhub" collides with [andrewyng/context-hub](https://github.com/andrewyng/context-hub) (13.7k stars, real Andrew Ng project, same problem space). This is now confirmed independently by two separate research passes done on 2026-07-12: our own npm/GitHub/domain sweep (Rounds 1–2 below) and a second, independently-run ChatGPT deep-research pass (Round 3 below) that reached the same conclusion from a different angle — and additionally flagged that several of the *obvious* fallback names (RepoLoom, RecallForge, SignalForge, etc.) are already live products or GitHub orgs too.

Real-word metaphor names (Groundcrew, Waypoint, Beacon, Callsign, Tarmac) were tried in Round 1 and **all disqualified** on deep-dive — see rejected list below.

---

## Round 1 — coined/invented words (2026-07-12)

**Methodology:** every name below was checked against the npm registry (is the bare package name published?) and GitHub (is the exact string already a username or org — usernames and orgs share one namespace, so an inactive personal account still blocks you from getting that org name). The 13 names clean on *both* were then run through a general web search for existing products/companies.

**Domain check:** ran `whois` (built into macOS, no MCP install needed) against .com/.io/.ai for the top 5. `.dev` couldn't be checked this way — its registry (Google/Charleston Road Registry) doesn't resolve through the standard whois referral chain, so those need a manual registrar check.

| Name | .com | .io | .dev | .ai |
|------|------|-----|------|-----|
| **kairowise** | ✅ available | ✅ available | ⚠️ unchecked | ✅ available |
| ctxmind | ❌ taken (registered 2026-03-18) | ✅ available | ⚠️ unchecked | ✅ available |
| texero | ❌ taken (registered 2008, long-held) | ✅ available | ⚠️ unchecked | ✅ available |
| knowmesh | ❌ taken (drop-caught 2024) | ✅ available | ⚠️ unchecked | ❌ taken (registered 3 days before this check) |
| mindora | ❌ taken (2004) | ❌ taken (2025) | ⚠️ unchecked | ❌ taken (2023) |

**kairowise is the only name clean across npm, GitHub, .com, .io, and .ai simultaneously.** Verify .dev manually, but this is the strongest Round 1 candidate.

### Top tier — clean on npm AND GitHub

These are the strongest Round 1 candidates: no published npm package, no existing GitHub user/org with the exact name, and a general web search turned up nothing meaningful.

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

**Round 1 ranking after the domain check:**
1. **kairowise** — the only name clean on npm, GitHub, .com, .io, *and* .ai simultaneously. Also the best conceptual fit: *kairos* ("the right moment") maps directly onto ctxhub's own Loop principle (Observe → Understand → Recommend → **Approve** → Remember).
2. **ctxmind** — keeps a thread of continuity with "ctxhub" (same `ctx` prefix), short, clean on npm/GitHub/.io/.ai — but `.com` is already taken (registered March 2026, likely squatted/parked).
3. **texero** — the etymological callback (context = "woven together," texero = "I weave") is a genuinely good pitch story, clean on npm/GitHub/.io/.ai — but `.com` has been held since 2008 (long-held, not a recent squat, unlikely to free up).

### Second tier — clean on npm, taken on GitHub (username/org blocked)

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

### Round 1 rejected — real-word metaphors that looked promising but collided

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

## Round 2 — plainer, less obscure names (2026-07-12)

Feedback on Round 1: kairowise-style coined/Greek-root names felt too obscure for an easy brand identity. This round leans into vocabulary the product already uses internally (Fleet, Crew, Mission Control, Captains) plus a few plainer compounds, on the theory that brand/product vocabulary alignment beats a clever etymology.

**Method:** same as Round 1 — `npm view <name>` for registry status, GitHub REST API (`api.github.com/users/<name>`, 404 = available) for username/org, `whois` for .com/.io/.ai, then a live-fetch check on any `.com` that came back "taken" to see if it's a real business or just an unreachable/parked registration (real collision vs. buyable-later).

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

---

## Round 3 — external research: ChatGPT deep research (2026-07-12)

Independently commissioned research (via ChatGPT, not this session), checking a different candidate set with a different methodology: live browser fetches to GitHub/domain/X URLs, plus exact-phrase web search screening, run 09:52–10:20 BST on 2026-07-12. Source: `deep-research-report.md` (now merged here and removed as a standalone file).

**Caveat, in the report's own words:** GitHub 404s are a reasonably strong "likely available" signal, but domain/npm/trademark results are explicitly "screening", not registry-grade or legal proof — every "unsurfaced" cell below still needs a real registrar checkout and (for the eventual winner) real trademark counsel before anything is announced.

### Rejected — obvious fallbacks that turned out already taken

| Name | Why rejected |
|------|--------------|
| RepoLoom | Live repository security scanner with its own `.com` site |
| RecallForge | Live learning platform |
| RepoSignal | Live open-source issue-discovery product |
| SignalForge | Live GitHub organisation, points to `signalforge.io` |
| MemoryForge | Live GitHub organisation, tied to an existing media site |
| GraphLoom | `.com` registered and parked for sale |
| TraceLoom | Live developer-infrastructure product (distributed Playwright testing) — too close in category/audience |
| SignalLoom / StackLoom | Both already exist on GitHub |
| ProofLoop | Already the name of a published technical system in recent research |

### Ranked shortlist

| Name | Tagline | GitHub | Trademark risk | Notes |
|---|---|---|---|---|
| **RecallLoop** | Closes the loop between AI work and institutional recall. | Not surfaced (promising) | Low | Best *company-level* brand — maps to "knowledge that compounds," not pinned to repo/chat/architecture. Risk: could read as memory/edtech software out of context. |
| **RepoWeave** | Weaves every repo interaction into reusable engineering knowledge. | **404** (likely available) | Medium-Low | Best *product-level* name — communicates "repo activity → persistent knowledge" directly. Risk: more repo-scoped than where the roadmap ultimately goes. |
| **RepoThread** | Keeps a continuous thread of context through every change. | Not surfaced | Medium-Low | Best *fallback* — easiest to explain in one line, least likely to be mangled in speech. Risk: "thread" can evoke comments/discussion more than infra. |
| **RepoFabric** | Makes shared engineering memory part of the infrastructure layer. | Not surfaced | Medium | Sounds enterprise/infrastructural, strong governance story. Risk: "fabric" is heavily used in software branding already. |
| **TracePulse** | Turns traces and activity into a living pulse of team knowledge. | Not surfaced | Medium | Good runtime feel, fits Mission Control story. Leans observability over org memory. |
| **TraceOrbit** | Keeps agents orbiting the same evidence, context and decisions. | Not surfaced | Medium | Memorable coordination metaphor, more abstract. |
| **RepoHaven** | Gives agents a safe home for trusted repo knowledge. | Not surfaced | Medium-Low | Friendlier tone, less "serious infra" than RepoWeave/RepoFabric. |
| **RepoNest** | A home base where repo context accumulates and stays useful. | Not surfaced | Medium-Low | Most approachable, slightly consumer-ish. |
| **MemoryLoop** | Each AI interaction feeds memory back into engineering. | Not surfaced | Medium | Clear concept, but generic — risks reading as note-taking/edtech. |
| **TrustLoop** | Turns evidence into trusted knowledge one reviewed loop at a time. | Not surfaced | Medium | Forward-facing enterprise/governance story; "trust" is a crowded word. |
| **ObserveLoop** | Observe work, review it, and keep the learning. | Not surfaced | Medium-High | Philosophically closest to ctxhub's Loop, but most descriptive/least ownable. |

**Report's own top pick if deciding today:** RecallLoop for the strongest long-term company brand, RepoWeave for the strongest OSS/dev-infra brand right now, RepoThread as the immediate fallback if either fails final registrar/namespace checkout.

Brand-line pairings the report proposed for the top three (kept for later, not evaluated here): RecallLoop → *"Observe. Recall. Compound."*; RepoWeave → *"Capture. Weave. Reuse."*; RepoThread → *"Track. Thread. Remember."*

---

## Master shortlist across all three rounds

Not yet ranked against each other — that's the next pass, once we're actually ready to act on a rename. Carrying forward only names that came back clean (or "unsurfaced/likely available") on GitHub in their respective round:

- **Round 1:** kairowise, ctxmind, texero
- **Round 2:** signalcrew, knowlane, loopcrew, pathcrew, contextcrew, relaybay, knowbay
- **Round 3:** RecallLoop, RepoWeave, RepoThread (+ RepoFabric, RepoHaven, RepoNest as weaker fallbacks)

Three rounds, three very different naming directions (coined words / product-vocabulary compounds / plain descriptive names) — worth discussing which *direction* fits the brand before narrowing to a single name.

---

## Next steps

1. Discuss the three directions above and narrow to 2-4 favorites total.
2. Check domain availability directly on a registrar (.com, .io, .dev, .ai) for whichever survive — none of the three rounds' domain checks are registry-grade proof.
3. Finish the live-site fetch checks Round 2 didn't get to (pathcrew, contextcrew, relaybay, knowbay).
4. Once a name is chosen, do one more targeted web search specifically for that name + "AI" + "coding agent" + "MCP" before committing, the same way the rejected lists above were caught — then real trademark counsel (USPTO, UK IPO, EUIPO) before any public announcement.
5. Only then start the actual rename (package.json, CLI binary name, docs, MCP config keys, VF3 demo script, screenshots).

## Status: paused

Deliberately sidetracked from product work to chase this — pausing here. **Do not act on a rename until the product is built and has a working test suite** to safely refactor package name, CLI binary, docs, and MCP config keys against.

**Reframing to pick up when this resumes (2026-07-12):** see `docs/platform_runtime_architecture.md`. If ctxhub ends up being one *application* on a shared platform runtime (alongside DealLedger and possibly others) rather than the whole company's identity, this becomes two naming questions instead of one — a domain-neutral platform/runtime name, and a separate product name for the engineering application that "ctxhub" itself could plausibly just keep. All three rounds above optimized for "sounds like a coding/dev tool," which is the wrong target for the platform name specifically if that reframing holds. Don't restart the search from these three rounds' criteria without re-reading that document first.
