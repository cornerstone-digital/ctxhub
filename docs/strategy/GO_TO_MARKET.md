# ctxhub — Go To Market

*How we reach the first 50 users. Everything after that gets informed by what we learn from them.*

---

## The target

Not every developer. AI power users — people already running two or more AI tools simultaneously across multiple repos, who feel the coordination and context pain daily.

They don't need convincing that the problem is real. They need to see that ctxhub solves it better than their current workaround (usually: manually re-pasting context, maintaining separate notes, accepting that agents forget everything between sessions).

Getting these 50 people is the only goal at launch. A thousand passive installs from people who never run `ctxhub index` are worth less than 10 engineers who open Mission Control every morning.

---

## Launch channels

### Hacker News — Show HN

The primary launch. Show HN posts consistently reach the right audience: developers who build tools, use AI tools, and have opinions about both.

**What makes a Show HN work:**
- A clear problem statement in the first line
- A demo that shows the thing working, not slides about the thing
- An honest "here's what it doesn't do yet" section
- The author in the comments answering questions directly

**What to lead with:** The 90-second Mission Control demo video. The event log telling a story. Captains running overnight. A finding getting promoted. The knowledge graph updating.

**Timing:** Tuesday–Thursday, 9–11am ET. Don't post on a Monday or Friday.

### GitHub

The repo itself is a distribution channel. README quality determines whether someone who lands on the repo via Hacker News, a tweet, or a Google search stays or leaves.

The README needs to answer three questions within 30 seconds:
1. What does this do?
2. Is it for me?
3. How do I try it?

The press release and vision docs belong in `docs/strategy/`, not the README. The README is for people who want to use ctxhub, not people who want to understand the strategy.

### Developer communities

Secondary channels, after Hacker News and GitHub are solid:

- **r/LocalLLaMA** — strong overlap with multi-model, local-first audience
- **r/MachineLearning** and **r/programming** — broader reach, lower signal
- **Discord servers** — Cursor, Claude, local AI communities; post in #tools or #resources, not #general
- **Twitter/X** — useful for building in public, sharing small updates; not a launch channel in itself

### Direct outreach

Find 10–15 people who visibly run multiple AI tools across multiple repos. Look for:
- People who post about context frustration on Twitter
- Open-source contributors who work across several repos
- Developers who write about AI workflow tooling

Send a short, direct message: "I built something that might help with [specific thing they complained about]. Would you try it and tell me what's wrong with it?"

Don't send a product pitch. Send an invitation to find problems.

---

## What we need before launch

### Non-negotiable

- [ ] `npm install -g ctxhub` works cleanly on macOS and Linux
- [ ] `ctxhub init && ctxhub index` completes without errors on a real repo
- [ ] The MCP server connects correctly to Claude, Codex, and Cursor
- [ ] Mission Control loads and shows real data at `localhost:7342/dashboard`
- [ ] One Captain runs overnight without failing
- [ ] README explains the install and first-run flow in under 5 minutes

### Strongly recommended

- [ ] A 90-second demo video showing Mission Control in a real workflow
- [ ] Screenshots of each Mission Control view (Fleet, Captains, Knowledge Graph)
- [ ] A `docs/quickstart.md` that gets a developer to their first `ctxhub ask` result in under 10 minutes
- [ ] A `CONTRIBUTING.md` that explains how to run the project locally

### Not needed at launch

- Cloud sync
- Team features
- RBAC
- Marketplace
- Enterprise anything

---

## What success looks like at each stage

**Week 1 post-launch**
- 200+ GitHub stars
- 10+ genuine questions or bug reports (not just spam)
- 3–5 people who say "I'm already using this daily"

**Month 1**
- 20+ people who have used ctxhub for more than one week
- Enough feedback to know what the most common first-run failure is
- One piece of user-generated content (a blog post, a tweet thread, a YouTube video) that we didn't produce

**Month 3**
- 50 active users (define active as: ran `ctxhub captain run` or used Mission Control in the last 7 days)
- Clear signal on what "Milestone 2 — Mission Control" should prioritise based on what people actually do
- A pattern of what users try to do that ctxhub doesn't support yet

---

## What not to do

- **Don't launch on Product Hunt first.** PH is for consumer apps. HN is for developer tools.
- **Don't pay for ads.** Developer tools spread through word of mouth and technical credibility, not paid acquisition.
- **Don't target enterprise before individual developers.** Enterprise sales requires a product that individual developers already love. Get the developer love first.
- **Don't promise cloud features that don't exist.** The press release correctly says Mission Control is local. Keep it that way until it's actually ready.
- **Don't optimise for installs over active use.** A high install count that masks low retention is a trap. Watch for people who use ctxhub more than once.

---

## The long game

Individual developers → small teams → medium teams → enterprise.

This is the Nx playbook and it's the right sequence. Enterprise buyers trust tools that their engineers already use personally. Selling enterprise-first without a developer community is building in the wrong order.

The goal at launch is not revenue. The goal is 50 people who would be frustrated if ctxhub disappeared tomorrow.
