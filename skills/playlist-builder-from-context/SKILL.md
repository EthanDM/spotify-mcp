---
name: playlist-builder-from-context
description: Build or refresh a Spotify playlist from a short AI Playlist-style prompt in personalized-self, taste-neutral-self, or saved-person-profile mode, then verify the result and capture later feedback. Use for explicit playlist creation requests, blank-slate or taste-neutral experiments, longer mood or use-case briefs, existing-playlist refreshes, and playlists for saved listeners.
---

# Playlist Builder From Context

Turn Spotify context and a clear listening lane into a focused playlist.

Read `references/workflow-patterns.md` when you need:

- the fast personal workflow for short prompts
- historical AI Playlist reference selection
- candidate-pool, recent-build diversity, and fallback rules
- default build sequences for self vs person-profile workflows
- target track-count heuristics by use case
- artifact and memory follow-up patterns

Do not use this skill for generic playlist review. Use `$playlist-review`.

## Workflow

1. Establish the build frame.

- Gather the use case, desired mood, and any explicit constraints.
- Ask for missing constraints only when they materially change the build.
- Distinguish between:
  - short-prompt personal workflow
  - self playlist workflow
  - taste-neutral self workflow
  - person-profile workflow
- Set one audience mode: `self_personalized` by default, `self_neutral` only when the user explicitly asks to ignore their taste or use a blank slate, or `person_profile` when building for a saved listener.

For a short explicit request such as "make a focused evening-walk playlist," do not ask follow-up questions. Use the fast personal workflow in `references/workflow-patterns.md`.

2. Read the right context before searching.

- For `self_personalized`, use `spotify_get_personalization_context`.
- For deeper inspection, use `spotify_get_personalization_state`.
- For `self_neutral`, do not read the user's personalization context or historical playlist bodies as recommendation evidence.
- For `person_profile`, use `spotify_get_person_profile_context` and, when needed, `spotify_get_person_profile`; do not mix in the user's taste context.

3. Convert context into a tight brief.

- Name the lane in concrete terms.
- State preferred traits, avoided traits, and any known artist bias.
- State the target discovery level.
- State the audience mode and its allowed evidence sources.
- Classify three independent dimensions:
  - duration product: single-session soundtrack or reusable shuffle pool
  - curation mode: general personal build, artist/catalog build, recovered/reconstruction build, or intentional derivative such as a refresh, core cut, or sequel
  - playback mode: shuffle-first or ordered
- State the target track-count range if known or reasonably inferable.

4. Search deliberately.

- Use `spotify_search_tracks` in focused batches instead of one broad dump.
- Search by lane, artist, trait cluster, or known anchor tracks.
- Ground unfamiliar genres with high-confidence canonical or contemporary anchors before expanding into obscure discovery.
- Assemble and judge the complete candidate pool before creating a playlist.

5. Assemble the playlist.

- Create a new private playlist with `spotify_create_playlist` unless the user explicitly wants an existing playlist replaced or public.
- Add tracks with `spotify_add_playlist_items`.
- If the user wants an exact ordered body, use `spotify_replace_playlist_items`.
- Use `spotify_reorder_playlist_items` when a specific opening, midpoint, or finish sequence matters.

6. Sanity-check the result.

- Check track count against the intended use case.
- Reject weak prompt-fit or functional-fit candidates before applying diversity arithmetic.
- When the prompt constrains vocals, classify every selected track by vocal profile and enforce the documented vocal policy before creation.
- Limit uncertain search-only discovery; novelty is not evidence of quality.
- Check for duplicate or redundant artist clustering.
- Check duplicate-role versions even when their Spotify URIs differ.
- Apply only the diversity and overlap controls that belong to the selected curation mode.
- Check track and anchor-artist overlap against usable recent comparable MCP history when available.
- Use the deterministic local constraint check in `references/workflow-patterns.md` before claiming exact percentages or threshold compliance.
- Check opener strength and overall coherence.
- For activity playlists, state the intended ending behavior and verify the final three to five tracks still serve the activity; do not introduce a cooldown unless the prompt or inferred session shape calls for one.
- For ordered builds, verify every track's phase and confirm the ending supports the claimed destination.
- Inspect all credited artist appearances, not only primary-artist counts, and flag repeated reliance on one familiar musical ecosystem even when each individual artist stays under the numeric cap.
- If the playlist is noisy or bloated, tighten it before calling it done.
- Read the completed playlist back and verify the exact final count before claiming success.

7. Close the loop.

- For self workflows, record the result with `spotify_record_playlist_evaluation` when the user provides or confirms an evaluation.
- For person workflows, use `spotify_record_person_playlist`.
- If the build teaches something durable, record it with:
  - `spotify_record_personalization_feedback`, or
  - `spotify_record_person_feedback`
- For `self_neutral`, do not turn the build into durable personal-taste feedback unless the user later endorses the result or a specific learning.

8. Save a sidecar artifact for fast personal builds.

- Resolve the artifact root from `SPOTIFY_MCP_SHARED_DATA_DIR/artifacts` when shared storage is configured. Otherwise use `SPOTIFY_MCP_DATA_DIR/artifacts`, defaulting `SPOTIFY_MCP_DATA_DIR` to `~/.config/spotify-mcp`.
- Record the prompt, inferred brief, historical references, search queries, selected tracks, and verification result under `<artifact-root>/generated-playlists/`.
- Separate initial search queries from recovery-pass queries, or explicitly state that no recovery pass ran.
- For longer workflows, save notes when useful under `<artifact-root>/`.
- For person workflows, prefer `<artifact-root>/people/<profile-id>/`.

## Build Rules

- Build to the lane, not to completeness.
- Prefer fewer stronger tracks over broad but muddy coverage.
- Use explicit user feedback over weak inferred signals when they conflict.
- Treat saved-library patterns as suggestive, not authoritative.
- Treat historical AI Playlists as reference examples, not source lists to clone.
- In `self_neutral`, do not use personal taste, historical AI Playlists, or prior MCP playlists as positive evidence; establish quality from the prompt, lane evidence, and focused search results.
- Preserve personalization without repeatedly defaulting to the same anchor artists across comparable builds.
- Treat ecosystem concentration as a qualitative tradeoff, not an automatic failure: retain it when it materially improves prompt fit, but broaden the body when it merely reflects habitual defaults.
- Explicit user intent and track quality outrank diversity targets; use only the documented curation-mode or narrow-prompt exceptions and record them.
- Apply quality gates before familiarity, discovery, and overlap targets.
- For gift or person-specific playlists, bias toward hit rate and emotional coherence over novelty.
- If the user wants shuffle-first utility, reduce redundant textures and preserve hit density; judge familiar, discovery, vocal, and experimental proportions across the whole pool without relying on front, middle, or back placement.
- If the user wants a sequenced listening arc, care more about opener, midpoint turns, and close.

## Mutation Rules

- Keep explicit preview or draft requests read-only.
- Treat an explicit "make" or "create" request as authorization to create a new private playlist without another approval prompt.
- Default to creating a new playlist unless the user explicitly asks to overwrite an existing one.
- Do not replace or heavily mutate an existing playlist without the user asking for that path.
- Prefer reversible operations and explicit naming.

## Output Contract

Return:

1. Build brief

- the lane you optimized for
- the main constraints you used

2. Playlist result

- created or updated playlist name
- playlist ID or URL if available
- track count
- verification status

3. Why this build should work

- strongest traits
- any intentional tradeoffs

4. Recommended next feedback to capture

- what to listen for
- what to record if the playlist over- or under-shoots

5. If memory was updated

- which feedback or evaluation tool was used
- any artifact path saved

## Good Execution Shape

- context-first
- taste-aware
- decisive about the lane
- willing to cut candidate tracks that dilute the playlist
- explicit about what was inferred versus directly requested
