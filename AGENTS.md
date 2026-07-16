# AGENTS.md

## Purpose

This repository is a local Spotify MCP server for Codex. Keep changes simple, explicit, and production-friendly.

## Working Rules

- Prefer the built server flow as the default user path. `pnpm dev` is contributor-only.
- Do not assume `dist/` is current after source changes. Rebuild when the built server path matters.
- Keep the MCP surface intentionally small. Add new tools only when there is a clear workflow need.
- Reuse existing Spotify client primitives before introducing new helper layers.
- Avoid broad abstractions for one-off Spotify behaviors.
- Keep generated user-specific artifacts out of the repo. They belong under `~/.config/spotify-mcp/artifacts/` unless they are deliberate example docs or test fixtures.

## Verification

After meaningful code changes, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If playlist behavior, request shapes, or Spotify API assumptions changed, also run:

```bash
pnpm smoke
```

## Spotify-Specific Guidance

- Spotify's Web API does not support true playlist deletion.
- Local-file playlist items need special handling and are intentionally unsupported in clone, replace, and URI-based remove flows.
- Prefer fixing Spotify response normalization centrally instead of scattering payload-shape branches across multiple call sites.
- Keep destructive actions confirm-gated at the tool layer.

## Docs To Maintain

If behavior changes, update the relevant docs:

- `README.md`
- `CONTRIBUTING.md`
- tool examples or notes affected by the change
