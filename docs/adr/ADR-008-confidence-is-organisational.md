# ADR-008 — Confidence scores are organisational, not model-generated

**Date:** July 2026  
**Status:** Accepted

## Context

Knowledge Objects have a confidence score (0.0–1.0) that signals how trustworthy a finding is. There are two possible sources for this score: the LLM that generated the underlying captain run result, or the organisation's accumulated evidence about the finding over time.

LLM-generated confidence scores are available (most models can output a self-assessed confidence), but they have significant problems: they reflect the model's internal state at inference time, not the real-world accuracy of the finding; they are not calibrated across different model versions; and they create a dependency on model introspection that could break across model upgrades. More fundamentally, a high-confidence hallucination still has high model confidence.

## Decision

**Knowledge Object confidence is an organisational signal, computed from human and system evidence accumulated after promotion. It is never derived from the LLM's self-assessed confidence.**

Confidence starts at 1.0 on promotion (an engineer reviewed and approved this finding).

Confidence **increases** when:
- A second captain task independently produces a semantically similar finding (Phase 2: cosine similarity > 0.85) — corroboration
- An engineer explicitly marks the finding as "still accurate" during a review pass

Confidence **decreases** (and sets `review_flag = true`) when:
- The files referenced in the finding's citations change significantly (tracked via git diff metadata)
- A later captain run produces a finding that contradicts this one (`contradicts` edge)

The model's output confidence, if available in the API response, is stored in the captain run result for reference but is never propagated to the Knowledge Object's confidence field.

## Consequences

**Positive:**
- Confidence reflects what the organisation has verified, not what the model believes
- Confidence is stable across model upgrades — it is not recalculated when a model changes
- High-confidence Knowledge Objects are genuinely trustworthy (corroborated by multiple independent findings, not stale, no contradictions)
- The system degrades gracefully: a finding with no corroboration and unchanged files remains at 1.0 until evidence changes

**Negative:**
- A newly promoted finding starts at full confidence (1.0) even if the captain run was uncertain — this is intentional (the act of promotion is the human validation signal)
- Confidence can only decrease via system-observed signals (file changes, contradictions) or explicit human review; there is no automatic decay by time alone

**Constraint to preserve:**
Never write LLM self-assessed confidence to `knowledge_objects.confidence`. If a feature requires surfacing model uncertainty, add a separate field (e.g. `model_confidence`) to the captain run result schema, not to the Knowledge Object.
