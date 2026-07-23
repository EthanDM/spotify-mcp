# Review Patterns

Use this file only when you need extra specificity while writing a playlist review.

## Common Verdict Shapes

Good verdicts are short, decisive, and tied to the actual defect.

Examples:

- Strong lane, but 5 tracks too long and noticeably weaker after the midpoint.
- Good source material, but the opener sequence is flat and the playlist peaks too early.
- Coherent mood, but artist repetition makes it feel narrower than it should.
- Thoughtful gift playlist, but it needs a cleaner emotional arc and a stronger finish.
- Functional focus playlist, but too many vocal-heavy tracks break concentration.

Avoid:

- good vibes overall
- pretty solid, maybe tighten it
- some songs do not fit

## Score Calibration

When the user requests numeric ratings, use the full scale consistently:

- 9.0-10: unusually strong and highly usable, with few meaningful compromises
- 8.0-8.9: good to excellent, with identifiable but limited tradeoffs
- 7.0-7.9: useful concept with material cohesion, sizing, variety, or replayability problems
- below 7.0: the playlist regularly breaks its stated contract or needs substantial rebuilding

Keep dimensions separate. Use-case fit, cohesion, useful variety, replayability, artist concentration, runtime appropriateness, and sequencing should not all inherit the same impression. Score sequencing only when order is claimed or materially important.

Do not express false statistical precision. A numeric rating is structured judgment unless it comes from an explicit measured model.

## Common Failure Modes

### Front-loaded quality

Symptoms:

- best tracks are clustered in the first quarter
- back half feels like leftovers

What to recommend:

- move one or two anchor tracks deeper into the body
- cut the weakest late tracks
- reduce total count if quality drops sharply after the midpoint

### Artist overconcentration

Symptoms:

- one artist appears often enough to make the playlist feel accidental or lazy
- repeated artists reduce the sense of discovery or range

What to recommend:

- keep only the strongest representative tracks
- cut redundant tracks serving the same role
- if repeats are intentional, say why they still work

### Mood drift

Symptoms:

- tracks gradually leave the stated lane
- isolated songs break the emotional contract of the playlist

What to recommend:

- remove obvious out-of-lane tracks
- tighten the playlist around the clearest mood center
- describe the lane explicitly when the current title is too vague

### Energy whiplash

Symptoms:

- abrupt jumps in intensity, polish, tempo, or genre
- transitions feel random instead of intentional

What to recommend:

- reorder for smoother ramps
- group similar energy zones
- cut tracks that force a jarring reset without payoff

### Bloated track count

Symptoms:

- the concept is good but the playlist asks for more attention than the use case deserves
- the hit rate drops because too many merely acceptable tracks remain

What to recommend:

- suggest a target range, not just "shorter"
- cut filler before touching anchor tracks

Suggested ranges by use case:

- short drive: roughly 15-25 tracks
- workout lane: roughly 20-35 tracks
- dinner / background mood: roughly 20-40 tracks
- gift playlist: usually tighter than a personal utility playlist

Treat these as heuristics, not hard rules.

Before calling a playlist bloated, classify it:

- Single-session soundtrack: compare runtime with the actual session or route.
- Reusable shuffle pool: allow added duration when hit rate remains high across repeated use.
- All-day or background program: judge phase coverage, durability, and transitions rather than applying short-session ranges.
- Artist/catalog playlist: judge completeness against replayability and the stated catalog purpose.
- Recovered playlist: judge fidelity and availability gaps separately from musical curation.

Length is evidence of bloat only when it creates filler, weakens the lane, or contradicts the intended product.

### Cross-playlist sameness

Symptoms:

- different playlists repeatedly rely on the same anchor artists or adjacent ecosystem
- personalization produces high individual fit but low system-level discovery
- exact tracks recur across comparable playlists without an explicit derivative relationship

What to recommend:

- preserve the strongest personalized anchors while replacing redundant supporting tracks
- add discovery outside the recurring ecosystem, not merely different songs by the same neighboring artists
- distinguish an intentional core cut, refresh, or sequel from accidental reuse

## Concrete Recommendation Style

Prefer:

- Remove tracks that duplicate the same emotional role as the stronger opener.
- Cut 4-6 tracks from the back half where replayability clearly drops.
- Move one of the biggest hooks into the middle third so the playlist does not empty out after track 5.
- Keep the concept, but tighten around the polished melodic lane and drop the softer float tracks.

Avoid:

- maybe delete some weaker songs
- reorder a bit
- it could use more variety

## Artifact Path Patterns

Use stable, descriptive paths under the configured artifact root. Resolve it from `SPOTIFY_MCP_SHARED_DATA_DIR/artifacts` when configured; otherwise use `SPOTIFY_MCP_DATA_DIR/artifacts`, with `~/.config/spotify-mcp` as the default data directory.

Examples:

- `<artifact-root>/playlist-reviews/<playlist-name-slug>-review.md`
- `<artifact-root>/playlist-reviews/<yyyy-mm-dd>-<playlist-name-slug>.md`
- `<artifact-root>/people/<profile-id>/<playlist-name-slug>-review.md`

Prefer names that make the artifact easy to find later without opening it.
