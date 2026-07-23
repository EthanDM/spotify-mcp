# Workflow Patterns

Use this file only when the main skill needs more concrete build guidance.

## Fast Personal Workflow

Use this path when the user explicitly asks to make or create a playlist from a minimal prompt such as "focused evening walk." Keep explicit preview or draft requests read-only.

1. Preserve the original prompt and infer a compact brief:

- audience mode: `self_personalized`, `self_neutral`, or `person_profile`
- activity or use case
- genre or era
- mood and energy
- setting or time cue
- duration or track-count cue
- duration product: single-session soundtrack or reusable shuffle pool
- curation mode: general personal build, artist/catalog build, recovered/reconstruction build, or intentional derivative such as a refresh, core cut, or sequel
- playback mode: shuffle-first or ordered
- ending intent for activity playlists: sustain utility, deliberate cooldown, or atmospheric resolution
- vocal policy when the prompt constrains vocals: unrestricted, mostly instrumental, or instrumental only

Do not invent a constraint when the prompt and saved context are silent.

Default a short self request to `self_personalized`. Use `self_neutral` only for explicit language such as “taste neutral,” “blank slate,” or “ignore my taste.” Use `person_profile` when the user names a saved listener or supplies a profile ID.

2. Load only the audience-appropriate context.

- For `self_personalized`, read `spotify_get_personalization_context`.
- Apply explicit use-case preferences first.
- Use `spotify_get_personalization_state` only when the compact context cannot resolve a material choice.
- Use a saved use-case track-count range when present; otherwise target 30 tracks.
- Default to moderate discovery and shuffle-first playback.
- For `self_neutral`, do not call either personalization tool. Infer track count and playback mode from the prompt and general heuristics; otherwise use the same 30-track, moderate-discovery, shuffle-first defaults.
- For `person_profile`, read `spotify_get_person_profile_context` and inspect `spotify_get_person_profile` only when needed. Never substitute the user's personalization context for missing person data.

3. Select historical reference examples.

- Apply this step only to `self_personalized`.
- Use the MCP server's supported artifact root at `$HOME/.config/spotify-mcp/artifacts`.
- Read `<artifact-root>/ai-playlists/README.md` when it exists.
- Choose one to three playlists with the closest semantic use case, energy, genre, setting, or era.
- Read only those exported tracklist files.
- Extract successful anchors, supporting lanes, artist-concentration risks, and obvious drift.
- Never bulk-copy a reference playlist or treat historical inclusion as proof that a track belongs.
- Continue from personalization context alone when the historical artifact is unavailable.
- For `self_neutral`, select no historical personal references. For `person_profile`, use only references stored on that person's profile or prior person-specific artifacts.

4. Check recent comparable MCP builds.

- Prefer URI-complete build records under `<artifact-root>/generated-playlists/`.
- If those records provide no usable comparable history, read `<artifact-root>/mcp-playlists/README.md` when it exists and use URI-complete exported playlists as a read-only fallback.
- Shortlist by title, description, use case, and date, then inspect at most 10 semantically comparable records or exports. A build is comparable when it matches the new build on at least two of: activity/use case, genre or artist lane, mood/energy, setting/era, or an explicit derivative relationship.
- A comparison item is usable only when it contains the complete track URI list and credited artists. Use the first credited artist as the primary artist. When a fallback export lacks a build date, use its track `Added` timestamps only as a recency proxy.
- Extract recent track URIs, primary artists, and intentional derivative relationships.
- Treat history as usable when at least one semantically comparable URI-complete item exists. Otherwise mark comparison history `insufficient`.
- When history is insufficient, do not claim compliance with the new-primary-artist or recent exact-overlap targets. Record those metrics as `unknown` and continue with current-build quality, deduplication, and artist-cap controls.
- For `self_neutral`, do not inspect recent personal builds until the final candidate body has been assembled. Then calculate exact overlap for reporting only; do not use prior tracks, artists, or ecosystem patterns to seed, reject, or replace candidates.
- For `person_profile`, inspect only that person's prior build records when available. Do not use the user's generated-playlist history as positive or negative selection evidence.
- For an explicit refresh or overwrite, call `spotify_get_playlist` and page `spotify_get_playlist_items` through the complete current body before candidate search. Preserve intentional anchors unless the request says otherwise. If any item is a local file, do not replace the playlist because URI-based replacement cannot safely retain local-file entries; explain the limitation or offer a new playlist.

5. Build a candidate pool with five to eight focused `spotify_search_tracks` calls.

- Request at most 10 results per call; the MCP schema rejects larger limits.
- Include a literal prompt search.
- Include proven artist or lane searches grounded in personalization and the selected references.
- Include use-case, mood, genre, era, or setting searches that cover distinct parts of the brief.
- Include one or two adjacent-discovery searches.
- For a general personal build, include at least one non-artist query seeded only by use case, mood, genre, era, or setting. It must not name an artist from selected historical references or recent comparable builds.
- When personalization and historical references provide no useful evidence for the requested genre, first establish 5-10 high-confidence canonical or contemporary genre anchors. Use them to define the lane; do not classify the entire build as undifferentiated discovery.
- Keep the searches complementary; do not repeat the same broad query with cosmetic wording changes.
- In `self_neutral`, replace personalized artist searches with high-confidence canonical or contemporary lane searches. Do not name artists sourced from the user's context or artifacts.

6. Assemble the complete body before creating anything.

Apply controls by curation mode:

- **General personal build:** apply all controls below. Ordered general builds use the same controls plus sequence design.
- **Artist/catalog build:** the new-primary-artist target, primary-artist cap, historical-carryover caps, and recent exact-overlap cap do not apply when they conflict with the requested catalog scope. Still deduplicate and report the measured overlap.
- **Intentional derivative:** for a refresh, core cut, sequel, or explicitly related variant, treat the new-primary-artist target, historical-carryover caps, and recent exact-overlap cap as report-only. Keep the three-track artist cap unless the request is artist-specific.
- **Recovered/reconstruction build:** diversity and carryover controls do not apply. Optimize for fidelity, version discipline, ordering evidence, and transparent availability gaps.

Use these definitions and thresholds for a general personal build with final count `N`:

- Audience mode is independent from curation mode. `general`, `artist_catalog`, `derivative`, and `recovered` describe what is being built; `self_personalized`, `self_neutral`, and `person_profile` describe whose evidence is allowed.
- A track belongs to exactly one planning bucket. `Familiar/proven` means the track or its primary artist has direct positive evidence in personalization context, selected historical references, or prior confirmed evaluations. `Discovery` means it lacks that direct evidence.
- Aim for roughly 70% familiar/proven and 30% discovery. For `N=30`, this is 21 familiar/proven and 9 discovery. This is a planning target, not permission to keep a weaker track.
- In `self_neutral`, use `established` instead of `familiar`: high-confidence canonical or contemporary lane evidence independent of the user. Aim for roughly 70% established and 30% adjacent discovery. Never label a neutral candidate familiar or use personal familiarity as evidence.
- Assign every candidate an evidence tier before selection:
  - `anchor`: direct personalization or confirmed-evaluation evidence, inclusion in a selected high-quality reference, or high-confidence canonical/contemporary genre evidence
  - `supported`: unfamiliar, but corroborated by a recognized artist or collaborator, multiple relevant searches, or a clearly established adjacent lane
  - `uncertain`: search-only evidence with no meaningful corroboration
- Assign every candidate `prompt_fit` and `functional_fit` as `strong`, `acceptable`, or `weak`. Reject any candidate rated `weak` on either dimension before applying diversity arithmetic.
- When the prompt explicitly requests mostly instrumental, minimal vocals, no distracting vocals, or instrumental-only playback, assign each candidate a `vocal_profile` of `instrumental`, `sparse`, `forward`, or `unknown`. Use direct track/version evidence when available; do not infer instrumental status merely because Spotify metadata omits a featured vocalist.
- Set `vocal_policy` to `mostly_instrumental` for mostly-instrumental or minimal-vocal prompts. Reject `forward` tracks, cap `sparse` tracks at `floor(0.20 × N)`, and cap `unknown` tracks at `max(1, floor(0.10 × N))`. Set `vocal_policy` to `instrumental_only` only when the user explicitly requests it; then retain only `instrumental` tracks. Leave the policy `unrestricted` when vocals are not constrained.
- For a general 30-track build, include at least 9 anchors and no more than 3 uncertain tracks. For another final count `N`, require at least `ceil(0.30 × N)` anchors and allow at most `max(1, floor(0.10 × N))` uncertain tracks.
- Do not retain an uncertain candidate merely to satisfy discovery, new-artist, carryover, or overlap targets. If the quality-filtered pool becomes undersized, use the recovery search step.
- A `primary artist` is the first credited artist returned by Spotify. Featured or secondary artists do not affect the numeric artist cap or new-primary-artist calculation, but can still be flagged for qualitative repetition.
- When comparison history is usable, aim for at least `ceil(0.30 × N)` tracks whose primary artists are absent from the union of recent comparable builds. Prefer to satisfy this from the discovery bucket.
- Treat the new-primary-artist and recent exact-overlap thresholds as report-only in `self_neutral`; the neutral result must not be shaped by the user's history.
- Keep exact URI carryover from all selected historical AI references below one third of the final body: at most `ceil(N / 3) - 1`. Keep carryover from any single reference at or below `max(1, floor(N / 5))`. For `N=30`, the limits are 9 total and 6 from one reference.
- Deduplicate by Spotify track URI.
- Remove duplicate recordings, remasters, sped-up versions, or remixes that fill the same role unless the prompt specifically calls for them.
- Review normalized title families for original/remix/edit/live/acoustic/remaster duplication. Treat the helper's version-family output as a warning; keep multiple versions only when each has a distinct intentional role and record why.
- Cap a primary artist at three tracks unless an applicable curation-mode exception says otherwise.
- When comparison history is usable, keep exact URI overlap with any one recent comparable MCP build at or below `floor(N / 4)`. For `N=30`, the limit is 7 tracks.
- Also report exact URI overlap with the union of all recent comparable builds. Keep this report-only in V1; it reveals mosaic reuse that a per-playlist cap can miss without adding another hard threshold.
- Separately count all credited artist appearances and flag repeated reliance on the same anchor artists even when they are featured or the exact songs differ.
- Judge broader ecosystem concentration qualitatively: identify when several distinct artists occupy the same repeatedly used personalization lane. Do not reject a strong playlist solely for ecosystem concentration, but broaden it when the concentration is habitual rather than necessary for prompt fit.
- Separately inspect primary-artist presence across up to 10 recent general MCP builds, even when they are not semantically comparable. Report artists appearing in multiple recent builds; keep this ecosystem check qualitative in V1.
- Prefer standalone hit rate and texture distribution for shuffle-first playlists. Measure familiar, discovery, vocal-profile, and experimental-lane proportions across the complete body; never justify a shuffle pool using an opening third, back half, or other positional allocation.
- For an ordered build, assign each track one phase: `opening`, `development`, `peak`, `descent`, or `close`. Keep phases in that order, require a closing phase, and verify the final five tracks support the claimed ending. Sequence quality outranks filling a phase mechanically.
- For any ordered activity playlist, declare an `ending_intent` of `sustain`, `cooldown`, or `resolve`. Review the final three to five tracks as a functional unit. When the activity is expected to continue through the end, reject tracks whose intros, energy drop, or emotional turn materially interrupt utility. Use `cooldown` only when the prompt, duration, or inferred session shape supports it; emotional coherence alone does not justify weakening the activity finish.

7. Recover from an undersized pool once.

- If fewer than the target number survive, run a second pass of two to four new searches that broaden the weakest query dimensions.
- Complete this recovery pass for previews as well as live builds.
- Do not relax explicit avoid signals, duplicate rules, or the primary-artist cap merely to fill the list.
- For a non-derivative narrow prompt, relax the new-primary-artist or recent-overlap target only after the recovery pass shows that compliance would require lower-fit tracks. Record the achieved value and the specific `narrow_new_primary` and/or `narrow_recent_overlap` exception. Do not use this exception to clone a historical reference.
- Do not create a partial playlist. Report the limitation if the second pass and any applicable documented exception still cannot fill the target.

8. Run a deterministic constraint check before creation.

- Create a temporary JSON manifest containing the final tracks with `uri`, `name`, `primary_artist`, `bucket`, `evidence_tier`, `prompt_fit`, `functional_fit`, and ordered `phase` when applicable; either `target_track_count` or `target_track_count_range` with numeric `min` and `max`; `audience_mode`; `personalization_sources`; `person_profile_id` when applicable; selected historical references; recent comparable builds; up to 10 recent general builds for ecosystem reporting; playback mode; curation mode; the boolean `artist_specific` flag; and documented exceptions. Set `artist_specific` only when an artist-scoped derivative should bypass the normal three-track primary-artist cap. When vocals are constrained, also include manifest-level `vocal_policy` and per-track `vocal_profile`. Keep the full credited-artist list alongside the manifest or candidate notes for the qualitative ecosystem review; the deterministic helper intentionally uses primary artists for its numeric rules.
- Run `python3 scripts/check_playlist_constraints.py <manifest.json>` from the skill directory.
- Fix hard violations before creation. If comparison history is insufficient, preserve `null`/`unknown` history metrics rather than treating them as zero.
- Recommendation judgment remains in the agent. The script only performs URI-set arithmetic, counts, rounding, and threshold checks.

9. Create and verify.

- Generate a concise title that preserves the prompt's intent.
- Generate a one-sentence description naming the functional lane without claiming unsupported precision.
- For a new request, create the playlist private unless the user explicitly requests public visibility, then add the exact selected URI list.
- For a requested refresh or overwrite, keep the existing playlist and replace its items with the exact selected URI list regardless of playback mode.
- Read the playlist metadata and every item page back.
- Verify the title is present, the description is nonempty, and the fetched count equals both the intended count and Spotify's reported total.
- Verify exact order for ordered builds. For private requests, report Spotify's returned visibility without claiming stronger privacy than the readback supports.
- If verification fails, report the exact mismatch and do not claim completion.

10. Save the build record.

- Write `<artifact-root>/generated-playlists/<yyyy-mm-dd>-<playlist-slug>--<playlist-id>.md`.
- Include the original prompt, inferred brief, duration product, curation mode, target count, playback mode, historical references, comparison-history status and sources, search queries, ordered selected tracks, playlist ID, and count verification.
- Group search queries under `Initial search pass` and `Recovery search pass`. When no recovery was needed, record `Recovery search pass: not run`. When recovery ran, state why the initial quality-filtered pool was undersized.
- Include audience mode, allowed evidence sources, personalization sources actually used, and person profile ID when applicable.
- Include the deterministic check output: unique-primary-artist count, familiar/discovery allocation, new-primary-artist track percentage or `unknown`, historical carryover, maximum exact overlap with one recent comparable build or `unknown`, union exact overlap across recent comparable builds or `unknown`, artist-cap result, and every exception.
- Include anchor/supported/uncertain counts, rejected weak candidates, potential duplicate-version families and their decisions, ordered-phase result when applicable, and recurring artists across recent general builds.
- When vocals are constrained, include the vocal policy, vocal-profile counts and vocal-gate result. For shuffle-first builds, describe whole-pool proportions rather than positional distribution.
- For ordered activity playlists, include the ending intent and a short final-segment utility verdict. For shuffle-first activity pools, report whole-pool utility without assigning meaning to the final stored tracks. Include notable all-credit artist repetition and any accepted ecosystem-concentration tradeoff.
- Keep the artifact as a sidecar. Do not treat it as canonical personalization memory.

11. Close the feedback loop later.

- Do not record an evaluation or durable preference at creation time.
- After the user listens and provides feedback, use `spotify_record_playlist_evaluation`.
- Record durable use-case learning with `spotify_record_personalization_feedback` only when the user states or confirms it.

## Self Workflow Default

1. Read `spotify_get_personalization_context`
2. Extract:

- preferred traits
- avoided traits
- preferred / avoided artists
- relevant use-case preferences
- track-count and playback-mode guidance if present

3. Search in focused batches
4. Inspect recent comparable build records or URI-complete fallback exports when available
5. Build a candidate set with the same applicable recent-overlap and discovery controls used by fast personal mode
6. Tighten weak or redundant tracks
7. Run the deterministic constraint check
8. Create a new private playlist
9. Return the playlist and suggest evaluation criteria
10. Record feedback later once the user has listened

Use `spotify_get_personalization_state` only when the compact context is not enough.

## Taste-Neutral Self Workflow

1. Record `audience_mode: self_neutral`
2. Do not read personalization context, AI Playlist bodies, MCP playlist bodies, or saved-library signals before candidate selection
3. Infer the brief from the prompt and general use-case heuristics
4. Establish canonical or contemporary lane anchors through focused searches
5. Plan roughly 70% established lane evidence and 30% adjacent discovery
6. Apply prompt-fit, functional-fit, vocal, duplicate, version, artist-cap, playback, and quality gates normally
7. After the body is complete, inspect recent URI-complete builds only to report accidental overlap; do not revise the body from that history
8. Run the deterministic constraint check with an empty `personalization_sources` list and no historical references
9. Create and verify the playlist normally
10. Record durable personal feedback only after the user explicitly endorses a result or learning

## Person Workflow Default

1. Record `audience_mode: person_profile` and the profile ID
2. Read `spotify_get_person_profile_context`
3. If needed, inspect `spotify_get_person_profile` for extra factual detail
4. Build for that listener's stated goals, not the user's default taste
5. Use only that person's references and prior person-specific artifacts
6. Bias toward coherence, generosity, and replayability
7. Tighten weak or redundant tracks and run the deterministic constraint check
8. Create the playlist only after every applicable check passes
9. Save any human-readable notes if helpful
10. Record the outcome with `spotify_record_person_playlist`
11. If the result reveals a durable taste learning, record it with `spotify_record_person_feedback`

## Track Count Heuristics

Use these as defaults when the context does not already define a target:

- short drive / repeatable errand playlist: roughly 15-25 tracks
- general utility shuffle lane: roughly 35-65 tracks
- focused workout lane: roughly 20-35 tracks
- gift playlist: often better at 15-30 tracks than at utility-playlist length
- dinner / background lane: roughly 20-40 tracks

Treat these as heuristics. Context-specific evidence should override them.

Classify duration before applying the ranges:

- A single-session soundtrack should fit the stated or inferred outing and may be long when the activity is genuinely long, such as an all-day house soundtrack, long flight, or route-sized hike.
- A reusable shuffle pool may exceed one session when added breadth improves repeat use without lowering hit rate.
- Do not penalize length by itself. Penalize unsupported length, filler, or a mismatch between runtime and the claimed product.

For fast personal prompts, default to 30 tracks instead of the general utility range unless saved use-case context provides a better range.

## Search Pattern Guidance

Prefer multiple tight searches over one broad search.

Good search batches:

- one for anchor artists
- one for supporting artists
- one for trait phrases or adjacent genres
- one for specific recovery needs such as "brighter opener" or "less soft float"

Avoid dumping a large search result set straight into a playlist.

## Evaluation Follow-Up

For self workflows, encourage the user to capture:

- score
- verdict
- winning traits
- losing traits
- workflow learning

For person workflows, capture:

- whether the playlist actually landed
- whether the track count felt right
- whether any trait turned out stronger or weaker than expected

## Artifact Path Patterns

Examples:

- `<artifact-root>/generated-playlists/<yyyy-mm-dd>-<playlist-slug>--<playlist-id>.md`
- `<artifact-root>/playlist-builds/<playlist-name-slug>-brief.md`
- `<artifact-root>/people/<profile-id>/<playlist-name-slug>-brief.md`

Keep artifact names descriptive enough that the user can find them quickly later.
