# Evaluation Patterns

## Score Calibration

- `9.0-10`: unusually strong and highly usable, with few meaningful compromises
- `8.0-8.9`: good to excellent, with identifiable but limited tradeoffs
- `7.0-7.9`: useful concept with material fit, cohesion, sizing, or replayability problems
- below `7.0`: regularly breaks the prompt or needs substantial rebuilding

Treat scores as structured judgment unless an explicit measured model produced them. Explain material disagreement with an independent score instead of averaging automatically.

Recommended dimensions:

- prompt fit
- functional reliability
- cohesion
- useful discovery
- replayability
- artist and ecosystem diversity
- runtime appropriateness
- sequencing, only when order matters

## Finding Classification

| Type                        | Use when                                                                          | Typical response                                |
| --------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `playlist_specific`         | A track, transition, or local judgment missed, but no reusable rule is absent     | Propose track edits; leave builder unchanged    |
| `builder_rule_gap`          | The builder lacks reusable guidance needed to honor the prompt                    | Propose the smallest instruction change         |
| `deterministic_check_gap`   | Manifest arithmetic or an explicit machine-checkable contract should have failed  | Patch the checker after approval                |
| `historical_artifact_issue` | A weak, old, recovered, or superseded record may be treated as positive evidence  | Add lineage and reference-treatment metadata    |
| `mcp_or_spotify_issue`      | Creation, metadata, visibility, paging, normalization, or verification misbehaved | Diagnose MCP/API separately from curation       |
| `insufficient_evidence`     | Metadata or model knowledge cannot establish the musical claim                    | Request listening feedback or stronger evidence |

Choose one primary type per finding. Mention secondary effects in the explanation rather than duplicating the finding.

## Evidence Thresholds

### One build is enough

- explicit prompt constraint violated
- duplicate URI or redundant version escaped a declared rule
- deterministic count or overlap claim is wrong
- ordered logic was used to justify a shuffle-first body
- playlist creation or verification was falsely reported
- current instructions are internally contradictory

### Seek recurrence or listening confirmation

- a lane feels too safe or too adventurous
- a familiar ecosystem appears too often
- a candidate may be sleepy, distracting, harsh, or emotionally off
- the target length feels excessive without demonstrated filler
- a discovery percentage seems suboptimal but still satisfies the prompt

Two ratings of the same artifact are corroboration, not two independent build failures.

## Recommendation Ladder

Prefer the lowest sufficient intervention:

1. no change
2. listening feedback request
3. playlist edits
4. artifact annotation
5. builder wording refinement
6. deterministic checker change
7. spotify-mcp code change

Do not add a numeric rule when qualitative guidance is sufficient. Do not leave arithmetic or explicit threshold enforcement to prose when a deterministic check is practical.

## Review Report Shape

```markdown
# <Playlist> Quality Loop Review

- Playlist ID:
- Original prompt:
- Build artifact:
- Live verification:
- Overall score:

## Playlist verdict

## Strongest evidence

## Track-level findings

## Builder findings

| Finding | Classification | Evidence | Recommendation |
| ------- | -------------- | -------- | -------------- |

## System recommendation

- Action:
- Evidence level:
- Exact proposed change:

## Listening feedback to collect
```

## Common Mistakes

- Treating a build artifact's `passed` statement as independent verification
- Recommending a builder change that the current skill already contains
- Converting one questionable song into a universal prohibition
- Calling visibility failure a playlist-quality defect
- Evaluating a shuffle pool by its opening, midpoint, or ending
- Claiming a track is instrumental, high-energy, or a specific BPM without evidence
- Editing Spotify or system files during a review-only request
