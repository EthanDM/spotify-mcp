---
name: playlist-prompt-studio
description: Turn a rough music or playlist idea into clear, copy-ready Spotify playlist prompts at different specificity levels while preserving the user's intent and labeling inferred constraints. Use when brainstorming playlist directions, refining or simplifying a playlist prompt, comparing possible musical interpretations, stress-testing an existing prompt, or creating a controlled benchmark prompt before using playlist-builder-from-context.
---

# Playlist Prompt Studio

Help the user discover and express the playlist they want. Produce choices, not one artificially authoritative expansion.

Do not create, edit, inspect, or review a Spotify playlist with this skill. Send a selected prompt to `$playlist-builder-from-context`; review the result with `$playlist-builder-quality-loop`.

## Choose the Mode

Infer the mode from the request:

- `refine`: turn a rough idea into prompt options
- `explore`: propose meaningfully different musical directions
- `stress_test`: identify ambiguity, contradictions, or excessive constraints
- `simplify`: reduce an overengineered prompt to its essential intent
- `benchmark`: create a controlled prompt for evaluating the builder

Default to `refine` when the user provides a rough idea without naming a mode.

## Workflow

1. Preserve the source idea.

- Keep the user's original words visible or faithfully paraphrased.
- Separate explicit intent from inference.
- Do not transform tentative language such as “electronic or maybe atmospheric” into a hard genre requirement.

2. Extract the prompt dimensions.

- activity or use case
- genre, era, or artist lane
- mood and energy
- setting or time cue
- functional requirements
- vocal tolerance
- duration product: single session or reusable pool
- playback mode: shuffle-first or ordered
- discovery preference
- explicit avoid signals

Leave silent dimensions unresolved. Do not fill every category merely because it exists.

3. Identify useful forks.

- Name up to three choices that would materially change the music.
- Prefer representing reasonable forks as prompt alternatives instead of blocking on follow-up questions.
- Ask a question only when the user requests one final prompt and an unresolved fork would produce substantially different results.

4. Produce distinct prompt options.

- Unless the user requests another format, return:
  - `Minimal`: preserves maximum builder judgment and personalization
  - `Balanced`: adds the most useful functional boundaries without overconstraining discovery
  - `Exploratory`: offers a more distinctive adjacent direction with an explicit tradeoff
- Make the options genuinely different. Do not pad the same prompt with progressively more adjectives.
- Recommend one and explain the tradeoff in one sentence.

5. Audit the prompts before returning them.

- Remove invented precision, redundant adjectives, and mutually conflicting instructions.
- Avoid naming BPM, track count, exact sequencing, artists, or technical audio properties unless the user supplied them or requested that level of control.
- Use negative constraints sparingly; keep only those that protect the intended function.
- Preserve room for the builder to exercise musical judgment.

## Personalization Rules

- Do not read Spotify personalization, historical playlist artifacts, or listening history by default.
- Use personalization only when the user asks for personalized prompt formulation or when the rough idea explicitly depends on prior taste.
- When personalization is used, label every material influence and keep a non-personalized alternative available.
- Do not inspect historical playlist bodies merely to make a prompt sound more specific.

## Mode Guidance

### Refine

Return the three default specificity levels. Keep the minimal option close to the source idea.

### Explore

Offer three to five different musical interpretations, such as polished, organic, cinematic, rhythmic, nostalgic, or experimental. Explain how each changes the listening experience.

### Stress Test

Return:

- preserved intent
- ambiguous or conflicting clauses
- constraints likely to reduce candidate quality
- a corrected copy-ready prompt

Do not treat ordinary creative tension, such as “calm but propulsive,” as contradictory when it describes a useful lane.

### Simplify

Keep the use case, central musical identity, and the two or three most important boundaries. Remove implementation detail the builder can infer.

### Benchmark

Write a prompt precise enough to compare builder iterations fairly:

- state the use case and musical lane
- state functional boundaries
- state duration and playback product when material
- state discovery preference
- avoid artist names unless artist anchoring is part of the test
- avoid referencing or revealing a prior benchmark playlist

## Mutation Boundaries

- This skill is read-only.
- Never call Spotify creation or mutation tools.
- Never save personalization feedback or playlist evaluations.
- Do not save an artifact unless the user explicitly asks for one.

## Output Contract

Return:

1. `What you said`: the preserved rough idea
2. `Explicit signals`: what the user actually specified
3. `Open choices`: only material unresolved forks
4. Copy-ready prompt options
5. `Recommended`: one option and its tradeoff
6. `Next step`: suggest sending the chosen prompt to `$playlist-builder-from-context`

If the user asks for one prompt only, return one copy-ready prompt plus a compact list of material assumptions.

## Good Execution Shape

- faithful to tentative language
- imaginative without invented precision
- clear about inference
- concise enough to copy directly
- differentiated alternatives
- no Spotify mutations
