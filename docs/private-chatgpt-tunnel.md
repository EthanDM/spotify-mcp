# Private Spotify MCP connection to ChatGPT

Run the existing built stdio server on the host Mac through an outbound OpenAI Secure MCP Tunnel. The Mac must be logged in, awake, and online. Use the `private-chatgpt-mcp` skill from the personal codex-skills collection for the reusable setup procedure and configuration templates.

## Server and persistent connection

1. Run the repository checks and `pnpm build`. Keep `dist/server.js` current.
2. Create a dedicated Spotify tunnel associated with the intended personal ChatGPT workspace.
3. Store a suitably authorized runtime API key privately and reference its file from the local tunnel profile. Keep credentials, profiles, environment files, and LaunchAgents outside this repository.
4. Configure the profile to launch `node --env-file=<absolute-repo-path>/.env <absolute-repo-path>/dist/server.js` with the host's existing storage settings.
5. Validate the profile with `tunnel-client doctor`. Install a distinct user LaunchAgent with the required Node/Python PATH, private logs, RunAtLoad, and KeepAlive.
6. Confirm running service state, health, readiness, and a successful control-plane poll. These checks do not establish downstream tool readiness by themselves.
7. In ChatGPT Plugins, add a custom MCP server named Spotify MCP, choose the dedicated Tunnel, and complete creation and installation. The private tunnel can use No authentication on the MCP connection while downstream Spotify OAuth stays local.
8. Verify Installed/Connected, discovered tools, and direct plugin behavior as described below.

Use the current official client and verify its release checksum. Keep other working MCP connections intact. Do not reuse another server's tunnel ID or run competing clients for it. See the [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for current account permissions and client configuration.

## Workflows and artifacts

All existing Spotify, personalization, listener-profile, and history tools remain available. The server's instructions direct agents to retrieve the relevant workflow before building or reviewing playlists.

- `spotify_get_workflow` returns one of the five bundled skills plus its Markdown references.
- `spotify_check_playlist_constraints` runs the existing bundled Python checker on a supplied manifest without requiring shell access in the chat environment.
- `spotify_list_artifacts`, `spotify_read_artifact`, and `spotify_write_artifact` expose sidecars under the configured artifact root.

Artifact tool paths are relative to that root. Text artifacts and checker inputs are capped at 512 KiB. Writes support md/txt/json/csv/html, reject traversal and symlinks, and do not overwrite existing files. Save revisions with new filenames. Returned `artifacts/...` references can be recorded in durable playlist history. Read tools return content; they do not automatically create downloadable attachments or public URLs.

## Shared data and host identity

The tunnel must load the same local `.env` as the host's ordinary server. Preserve `SPOTIFY_MCP_DATA_DIR`, `SPOTIFY_MCP_SHARED_DATA_DIR`, and `SPOTIFY_MCP_MACHINE_ID` when configured.

Calls from another computer execute on the tunnel host and append to that host's history stream. Keep the second Mac's distinct identity and local credentials. iCloud synchronization remains responsible for cross-machine availability. Never copy installation IDs, share token files, or move generated snapshots/contexts into shared storage. Missing configured shared storage must fail explicitly.

Account IDs, machine-specific paths, credential references, installation history, and screenshots belong in the host's private local `~/.config/spotify-mcp/artifacts/installation/` directory. Keep these records local even when ordinary playlist artifacts use shared storage.

## Acceptance and maintenance

Verify the built server's discovery and adapted tools with synthetic storage, then verify live authentication with a read-only Spotify call. Test artifact save/read/list through the installed ChatGPT plugin directly, using unique synthetic content. Independently confirm exact file contents under the configured shared root and absence of a local-only shadow copy. Verify arrival on the second Mac separately before claiming that synchronization was observed.

After source changes, rebuild and restart only the Spotify service. Refresh tools in ChatGPT after changing names, schemas, descriptions, or server instructions. Workflow files are read from this repository at call time; refresh installed Codex skill copies through the supported installer when their instructions change.
