---
name: playlist-radio-from-seed
description: Build or refresh a static Spotify radio-style playlist from one seed song while controlling similarity, discovery, personalization, length, and replayability. Use when the user asks for song radio, a playlist based on or similar to one track, a stable copy-like alternative to Spotify Song Radio, or a refreshed radio playlist derived from a seed track.
---

# Playlist Radio From Seed

Turn one song into a focused, reusable playlist. Treat the seed's musical identity as the primary instruction and personalization as a secondary tie-breaker.

Read `references/radio-patterns.md` for similarity modes, search lanes, candidate controls, refresh behavior, and artifact fields.

Also read `$playlist-builder-from-context` and its `references/workflow-patterns.md`. Reuse its audience modes, candidate-quality gates, deterministic constraint checker, mutation rules, verification steps, and build-record requirements. When this skill conflicts with a generic builder default, follow this skill for seed-radio semantics.

## Workflow

1. Resolve the seed.

- Accept a Spotify track URL or URI, or an unambiguous title and artist.
- For a Spotify URL or URI, extract the track ID and resolve it with `spotify_get_track`. Reject non-track Spotify entities.
- Use `spotify_search_tracks` to resolve text input and versions.
- Ask for clarification only when multiple plausible recordings would materially change the radio.
- Record the exact seed URI, title, credited artists, version, and duration.

2. Set the radio brief.

- Default to `balanced` similarity.
- Support `faithful`, `balanced`, and `discovery` similarity modes.
- Default to `self_personalized`; use `self_neutral` or `person_profile` only under the builder's audience-mode rules.
- Infer activity, vocal tolerance, energy direction, era tolerance, playback mode, and track count only when supported by the request.
- Default to a 30-track, shuffle-first, static playlist.
- Include the seed exactly once unless the user explicitly requests otherwise.

3. Establish the seed's identity.

- Describe only traits supported by available metadata, reliable musical knowledge, or user-provided context.
- Separate essential seed traits from incidental traits.
- Do not invent BPM, key, energy scores, instrumentation, vocal density, or production facts.
- State uncertainty when the seed cannot be characterized confidently.

4. Search by relationship, not merely by genre.

- Run complementary searches across the seed artist's ecosystem, the seed's core musical lane, functional or mood traits, and adjacent discovery.
- Use the search plan for the selected similarity mode in `references/radio-patterns.md`.
- Treat search rank as candidate evidence, not proof of similarity.
- Assemble the complete candidate pool before creating anything.

5. Build with the shared builder controls.

- Apply the builder's quality, evidence-tier, vocal, duplicate-version, artist-cap, overlap, audience-evidence, and deterministic-check rules.
- Add a `seed_relationship` of `seed`, `direct`, `core`, `adjacent`, or `stretch` to candidate notes and the sidecar build record.
- Reject tracks connected only by a broad genre label when they do not preserve the seed's defining character.
- Prefer fewer strong relationships over artificial breadth.

6. Create or refresh safely.

- Keep preview requests read-only.
- Treat an explicit create or make request as authorization for a new private playlist.
- Refresh an existing radio playlist only when the user explicitly requests it.
- For refreshes, use the builder's intentional-derivative mode, preserve the seed, and follow the refresh guidance in `references/radio-patterns.md`.

7. Verify and record.

- Read back metadata and every playlist-item page.
- Verify the exact selected body, count, seed inclusion, duplicate status, and order when ordered.
- Save the standard generated-playlist sidecar with the additional radio fields from `references/radio-patterns.md`.
- Record durable feedback only after the user listens and responds.

## Mutation Rules

- Never claim to create, access, or reproduce Spotify's proprietary Song Radio.
- Create a static playlist inspired by the seed; explain that it will not update automatically.
- Do not modify a saved Spotify Radio or an existing playlist unless the user explicitly requests that target.
- Default new playlists to private and report Spotify's returned visibility accurately.
- Never knowingly create a partial playlist.

## Output Contract

Return:

1. Seed and radio mode
2. Inferred musical and functional brief
3. Created or proposed playlist, count, and verification status
4. Why the selected relationship mix should work
5. Any uncertainty or intentional stretch
6. The most useful listening feedback for a future refresh

## Good Execution Shape

- seed-first
- relationship-aware
- explicit about similarity radius
- conservative about unsupported musical claims
- stable and shuffle-safe by default
- personalized without turning into a generic personal-taste playlist
