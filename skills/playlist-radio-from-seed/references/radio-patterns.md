# Radio Patterns

Use these rules with `$playlist-builder-from-context`; do not duplicate its complete assembly workflow here.

## Similarity Modes

Classify every non-seed selection by its relationship to the seed:

- `direct`: same artist, close collaborator, producer, remix lineage, or a clearly connected project with strong musical continuity
- `core`: preserves most defining traits without requiring a direct personnel connection
- `adjacent`: changes one meaningful dimension while retaining the seed's central appeal
- `stretch`: changes multiple dimensions but supplies a defensible bridge

Use these planning mixes for the non-seed body. Treat them as targets after quality filtering, not quotas that justify weak tracks.

| Mode        | Direct + core |  Adjacent |         Stretch |
| ----------- | ------------: | --------: | --------------: |
| `faithful`  |     about 80% | about 20% | none by default |
| `balanced`  |     about 65% | about 30% |      at most 5% |
| `discovery` |     about 45% | about 45% |     at most 10% |

Default to `balanced`. Use `faithful` for language such as "very similar," "keep this exact vibe," or "more songs like this." Use `discovery` for language such as "use this as a jumping-off point," "surprise me," or "broaden outward."

Do not confuse personalization familiarity with seed similarity. A favorite track can still be a weak radio candidate.

## Seed Identity

Write a compact identity card before searching:

- exact track and version
- primary and credited artists
- essential mood or emotional posture
- essential rhythmic or energy behavior
- vocal role when known
- production, instrumentation, genre, or era traits only when supported
- likely listening function, only when requested or strongly implied
- traits that can vary without breaking the radio

If reliable evidence is thin, keep the identity card narrow and rely more heavily on direct and well-established core relationships.

## Search Plan

Use five to eight focused searches under the MCP's result limit:

1. Exact seed resolution when the input is not already a track URI
2. Seed artist plus the seed's defining lane
3. Direct collaborators, remixers, producers, featured artists, or related projects when known
4. One search for the seed's essential mood and genre traits
5. One search for its rhythmic, energy, vocal, or functional behavior
6. One or two adjacent-lane searches
7. One recovery search family only if the quality-filtered pool is undersized

Keep queries meaningfully different. Do not issue cosmetic rewrites of the same broad genre query.

Search cannot prove similarity. Corroborate unfamiliar candidates through artist or collaborator context, repeated relevant results, reliable knowledge, or a clearly established adjacent lane. Apply the shared builder's uncertain-candidate cap.

## Candidate Controls

- Include the seed exactly once by default.
- Count the seed toward its primary artist's normal cap.
- Allow up to three tracks by the seed artist under the general builder rule. Exceed that only when the user explicitly wants an artist-heavy radio.
- Avoid filling `direct` with same-artist catalog tracks. Direct connection and musical fit are both required.
- Reject redundant remixes, edits, live versions, remasters, and duplicate recordings unless each version has a distinct requested role.
- Apply vocal constraints to every track, including direct relationships.
- For shuffle-first radio, every track must work beside the seed without depending on sequence.
- For ordered radio, explain the requested arc separately; seed similarity does not itself imply an ordered playlist.

## Audience Modes

- `self_personalized`: use taste history to break ties, choose among equally valid adjacent lanes, and avoid known dislikes. Do not let habitual favorite artists displace closer seed matches.
- `self_neutral`: use no personal evidence before candidate selection. Build from the seed, canonical lane evidence, and focused search results.
- `person_profile`: use only the saved listener's evidence, again as a secondary filter after seed fit.

Record which personalized decisions were genuine tie-breakers. Do not claim the whole playlist is personalized merely because context was loaded.

## Track Count

- Default static radio: 30 tracks
- Narrow or highly faithful seed: 20-30 tracks
- General reusable radio pool: 30-40 tracks
- Extended background or all-day use: 40-60 tracks only when the request supports the length

Prefer a shorter high-confidence playlist when the seed occupies a narrow lane. Still follow the builder rule against knowingly creating a partial target: lower the target before creation only when the narrower product is explicitly justified in the brief.

## Refresh Behavior

Treat a refresh as an intentional derivative:

- preserve the exact seed unless the user requests otherwise
- preserve the radio mode and defining identity card
- review the current live body and prior sidecar
- remove unavailable, redundant, weak-fit, or negatively reviewed tracks first
- default to retaining roughly half to two thirds of a successful body
- introduce enough new material for the refresh to feel meaningful
- keep overlap thresholds report-only under the builder's derivative rules
- do not change the title, description, count, or ordering strategy without reason
- create a new playlist by default; overwrite the existing radio only when explicitly requested

If the user asks for a fresh snapshot rather than a refinement, rebuild from the seed and use the old body only for overlap reporting.

## Sidecar Fields

Add these fields to the shared generated-playlist artifact:

- seed track title, credited artists, URI, and version
- seed identity card
- similarity mode
- requested and achieved relationship mix
- selected tracks' `seed_relationship` values
- personalization tie-breakers actually used
- seed included exactly once: pass/fail
- static-playlist disclosure
- refresh source and retained/new counts when applicable

Do not claim exact relationship percentages unless every track has been classified and counted.
