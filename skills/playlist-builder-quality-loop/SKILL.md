---
name: playlist-builder-quality-loop
description: Audit a playlist produced by the Spotify playlist builder, rate its real use-case quality, propose track-level improvements, and decide whether the evidence warrants changing the builder skill, deterministic checker, historical artifacts, or spotify-mcp. Use after a generated playlist is created, when reviewing a generated-playlist artifact, when comparing builder iterations, or when asking what the playlist teaches about the generation system.
---

# Playlist Builder Quality Loop

Review the output and the system separately. A playlist flaw is not automatically a builder flaw.

Read `references/evaluation-patterns.md` for scoring calibration, finding classification, evidence thresholds, and the recommended report shape.

Use `$playlist-review` instead when the user only wants curation feedback and does not want builder-level diagnosis.

## Workflow

1. Establish the evaluation frame.

- Identify the original prompt, playlist ID, build artifact, intended use case, duration product, curation mode, and playback mode.
- Treat the build artifact as the builder's claim, not proof that the live playlist or musical judgments are correct.
- If the user supplies an independent review, reconcile it with the evidence rather than adopting its score automatically.

2. Verify the live output.

- Read playlist metadata with `spotify_get_playlist`.
- Read every item page with `spotify_get_playlist_items`; do not review only the first page.
- Compare the live title, description, visibility, count, URI body, and order with the artifact.
- Separate Spotify visibility or mutation failures from recommendation-quality failures.
- Keep this step read-only.

3. Review playlist quality.

- Apply the use-case-aware principles from `$playlist-review`.
- Rate prompt fit, functional reliability, cohesion, useful variety, replayability, artist concentration, and sequencing when order matters.
- For shuffle-first pools, judge proportions across the whole body; positional clusters do not contain playback risk.
- Check duplicate URIs, redundant versions, exact recent reuse, all-credit artist repetition, and ecosystem concentration.
- Name concrete strong tracks and concrete edit candidates.
- Do not invent BPM, energy, vocal density, key, or audio characteristics when the available evidence does not support them. Mark uncertain judgments and identify what listening feedback would resolve them.

4. Audit the build record.

- Check whether its inferred brief matches the prompt.
- Recalculate or spot-check material numeric claims when source URIs are available.
- Check whether selected references, comparison history, search strategies, evidence tiers, functional-fit decisions, and exceptions support the result.
- Identify claims that misuse ordered-playlist reasoning for a shuffle pool or otherwise contradict the declared product.

5. Attribute each finding.

- Classify every material finding as exactly one primary type:
  - `playlist_specific`: a local curation judgment or track choice
  - `builder_rule_gap`: a reusable missing or inadequate generation rule
  - `deterministic_check_gap`: arithmetic or manifest validation should enforce it
  - `historical_artifact_issue`: a reference needs lineage, quality, or supersession metadata
  - `mcp_or_spotify_issue`: tool behavior, API normalization, mutation, or verification failed
  - `insufficient_evidence`: metadata cannot establish the suspected problem
- State why the classification fits and what evidence would change it.

6. Check the current system before recommending changes.

- Read the current `playlist-builder-from-context` instructions and relevant checker code only when a finding may affect them.
- Compare the build timestamp and lineage with the current implementation. Do not recommend a fix that was already added after the playlist was built.
- Search recent generated-playlist artifacts for recurrence before turning a subjective miss into a global rule.
- Prefer the smallest intervention that addresses the demonstrated failure.

7. Apply the evidence threshold.

- One example can justify fixing an explicit prompt-contract violation, broken deterministic calculation, unsafe mutation, or false verification claim.
- Require recurrence across at least two independent builds, or explicit user listening feedback, before codifying a softer taste preference or narrowing the builder globally.
- Do not use multiple reviews of the same playlist as independent recurrence evidence.
- Treat `no builder change` and `artifact annotation only` as successful conclusions.

8. Recommend, then stop.

- Choose one primary system recommendation:
  - no change
  - playlist edits only
  - artifact annotation
  - builder instruction refinement
  - deterministic checker change
  - spotify-mcp code change
- Provide exact proposed edits when confidence is high.
- Do not mutate Spotify, builder files, checker code, artifacts, or personalization state without explicit user approval.
- Record evaluations or durable taste feedback only after the user supplies or confirms listening feedback.

## Mutation Boundaries

- Default to read-only diagnosis.
- A request to review, rate, or identify lessons does not authorize playlist or system changes.
- After explicit approval, apply only the already-proposed narrow change and verify it.
- Keep generated personal artifacts outside the public repository. Resolve the artifact root from `SPOTIFY_MCP_SHARED_DATA_DIR/artifacts` when configured; otherwise use `SPOTIFY_MCP_DATA_DIR/artifacts`, with `~/.config/spotify-mcp` as the default data directory.

## Output Contract

Return:

1. Verdict and calibrated overall score
2. What works
3. Playlist weaknesses and concrete edit candidates
4. Builder diagnosis, with every material finding classified
5. Recommended system action and evidence level
6. Any live verification or privacy mismatch
7. The next listening feedback that would be most informative

When useful, save a review under:

`<artifact-root>/playlist-quality-loops/<yyyy-mm-dd>-<playlist-slug>.md`

Do not silently alter the original build artifact. Propose a lineage or known-issue annotation first.

## Good Execution Shape

- live-output-first
- track-aware and use-case-aware
- skeptical of artifact self-reporting
- explicit about uncertainty
- conservative about global builder rules
- decisive when an explicit contract or deterministic check failed
