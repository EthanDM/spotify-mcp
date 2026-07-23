---
name: playlist-review
description: Review a Spotify playlist for sequencing, duplication, artist concentration, energy drift, and fit for a stated use case, then propose concrete edits and optionally save a sidecar writeup under the configured Spotify MCP artifact root. Use when working with spotify-mcp on playlist curation, cleanup, or quality control.
---

# Playlist Review

Use this skill when the real job is not just "show me a playlist" but "tell me whether this playlist works and what to change."

This skill is for `spotify-mcp` playlist analysis and curation workflows.

Read `references/review-patterns.md` when you need:

- concrete examples of good review verdicts
- tighter guidance on common failure modes
- artifact naming patterns for saved writeups

## Use When

- A playlist needs a quality review before sharing or reusing it
- The user wants concrete keep/remove/reorder recommendations
- The user has a use case such as workout, focus, driving, dinner, or gift playlist curation
- The user wants a writeup saved outside the repo for future reference

Do not use this skill for blind mutation. Review first, then propose changes, then mutate only if the user asks.

## Inputs To Gather

- `playlistId`
- optional intended use case
- optional constraints:
  - target track count
  - discovery level
  - explicit-content tolerance
  - preferred or avoided artists / traits
- optional personalization context or person-profile context

If the user did not provide a use case, infer the playlist's likely purpose from the title, description, and track makeup, but say that it was inferred.

## Workflow

1. Read the playlist metadata and items first.

- Use `spotify_get_playlist`.
- Use `spotify_get_playlist_items`.
- If the playlist is large, page until you have enough context to review the actual full body, not just the first handful of tracks.

2. Establish the review frame.

- State the playlist's apparent purpose.
- Note whether the use case is explicit or inferred.
- Classify it as a single-session soundtrack, reusable shuffle pool, artist/catalog playlist, recovered playlist, or another special-purpose product before judging length and variety.
- If relevant, read `spotify_get_personalization_context` or `spotify_get_person_profile_context` before judging fit.

3. Diagnose the playlist.

- Check opener strength.
- Check closer strength.
- Check sequencing continuity and abrupt transitions.
- Check artist overconcentration.
- Judge personalization strength separately from useful variety.
- Check duplicate tracks or duplicate-like redundancy.
- Check energy drift, mood drift, and pacing collapse.
- Check whether the playlist is too long, too short, or bloated for the use case.
- Check whether obvious low-fit tracks are weakening replayability.

4. Produce concrete recommendations.

- Call out the best tracks or strongest sections.
- Name specific removal candidates.
- Name specific reorder candidates.
- If the track count is too high, recommend a tighter target range.
- If confidence is high, suggest exact move/remove actions.

5. Offer optional next actions.

- `spotify_dedupe_playlist` when duplicates are present.
- `spotify_remove_playlist_items` for clearly weak candidates.
- `spotify_reorder_playlist_items` when a specific sequence fix is obvious.
- `spotify_archive_playlist` if the playlist is stale and not worth salvaging.

6. Optionally save a sidecar artifact.

- Use the MCP server's supported artifact root at `$HOME/.config/spotify-mcp/artifacts`.
- Save human-readable review notes under `<artifact-root>/`.
- Use a stable, descriptive path.
- For person-specific work, prefer `<artifact-root>/people/<profile-id>/`.
- Treat the artifact as a sidecar, not canonical memory.

## Review Heuristics

- Prefer replayability over completeness.
- A playlist with fewer stronger tracks is usually better than a long playlist with filler.
- Repeated artists are acceptable when they strengthen the lane; they are a problem when they make the playlist feel narrow or lazy.
- The first 3-5 tracks matter disproportionately.
- The last 2-3 tracks matter if the playlist is meant to feel complete instead of endless.
- Sudden jumps in intensity, era, polish, or genre should be treated as potential defects unless the playlist clearly aims for contrast.
- Gift playlists and mood playlists should bias toward coherence and hit rate over novelty.
- If the playlist use case implies a duration or attention window, optimize for that instead of maximizing coverage.
- Do not penalize an intentionally all-day, route-sized, or reusable-pool playlist merely for being long. Penalize filler, declining hit rate, or mismatch with the claimed product.
- For artist/catalog playlists, judge selection quality, internal range, version discipline, and sequencing instead of cross-artist diversity.
- For recovered playlists, separate reconstruction quality from original curation quality and do not attribute the recovered order to the recovery workflow.
- Treat personalization and useful variety as separate dimensions. Familiarity can improve fit while still creating system-level sameness.
- Reserve 9.0+ for unusually strong playlists with few meaningful compromises. Do not award an elite score solely because the concept is specific or personalized.

## Mutation Rules

- Default to analysis and recommendation only.
- Do not mutate a playlist unless the user explicitly asks.
- For destructive actions, respect the `spotify-mcp` confirmation gates.
- When proposing mutations, prefer the smallest set of changes that materially improves the playlist.

## Output Contract

Return:

1. One-line verdict

- example: strong concept, but 6-8 tracks too long and front-loaded with its best material

2. What is working

3. What is weakening the playlist

4. Concrete edit recommendations

- specific remove candidates
- specific reorder ideas
- suggested target length if relevant

5. Optional next tool actions

- only if the user wants changes applied

If saving an artifact, also return the exact artifact path.

## Good Review Shape

- decisive
- specific
- track-aware
- use-case-aware
- willing to recommend cutting good songs that do not fit the lane

Avoid vague feedback like "good vibe" or "maybe tighten it a bit." Name the actual issue and the actual change.
