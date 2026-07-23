# Spotify Skills

This directory is the canonical source for the Codex skills that operate against this Spotify MCP server:

- `playlist-builder-from-context`
- `playlist-builder-quality-loop`
- `playlist-prompt-studio`
- `playlist-review`

The packages contain workflow instructions, reference material, agent metadata, and deterministic validation code only. Do not add OAuth credentials, environment files, personalization state, people profiles, playlist histories, generated manifests, or artifacts.

Preview installation into the active Codex home:

```bash
pnpm skills:install
```

Apply it:

```bash
pnpm skills:install -- --apply
```

`CODEX_HOME` may select another absolute Codex directory. The installer copies only the four allowlisted skill packages and does not read or copy Spotify runtime data.

Artifact instructions in these skills honor the current Spotify MCP storage contract and use `$HOME/.config/spotify-mcp/artifacts`.
