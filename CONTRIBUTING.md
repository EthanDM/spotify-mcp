# Contributing

## Scope

This project is a local Spotify MCP server for Codex with a small playlist-management surface. Keep changes focused, explicit, and easy to maintain.

## Prerequisites

- Node.js 22+
- `pnpm`
- Spotify app credentials for local auth and smoke testing

## Setup

1. Copy `.env.example` to `.env`.
2. Set `SPOTIFY_CLIENT_ID`.
3. Install dependencies:

```bash
pnpm install
```

4. Authenticate locally if you need live Spotify access:

```bash
pnpm auth
```

## Running

Use the built server path for normal usage:

```bash
pnpm build
pnpm start
```

Use contributor mode only when editing the repo:

```bash
pnpm dev
```

## Verification

Run this before opening or updating a PR:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If you changed live Spotify flows, also run:

```bash
pnpm smoke
```

The smoke test uses a real Spotify account and creates temporary playlists. Clean those up manually after the run.

## Change Guidelines

- Prefer small, direct changes over new abstraction layers.
- Keep the public MCP surface narrow unless there is a clear real-world need.
- Reuse existing playlist primitives when adding higher-level workflows.
- Keep generated user artifacts out of the repo. Store them under `~/.config/spotify-mcp/artifacts/` unless they are intentional docs or fixtures.
- Keep friend/family listener profiles separate from account personalization state. Canonical profile data belongs under `~/.config/spotify-mcp/people/`, while optional writeups still belong under `~/.config/spotify-mcp/artifacts/people/`.
- Treat `skills/` as the canonical source for the bundled Codex skills. Run `pnpm skills:check` after changing them, and never add credentials, runtime state, generated artifacts, or user-specific examples.
- Update tests alongside behavior changes.
- If Spotify behavior changes, prefer adjusting normalization and request handling over spreading special cases through call sites.

## Documentation

Keep these in sync with behavior changes:

- `README.md` for user-facing setup and usage
- `CONTRIBUTING.md` for contributor workflow
- `AGENTS.md` for repository-specific AI agent guidance

## Commits

Use conventional commits where practical:

- `feat(spotify): ...`
- `fix(spotify): ...`
- `chore(tooling): ...`
- `chore(readme): ...`
