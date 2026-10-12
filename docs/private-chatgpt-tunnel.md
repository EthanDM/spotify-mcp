# Private ChatGPT tunnel on macOS

Use the existing OpenAI `tunnel-client` installation with a separate Spotify tunnel and profile. The Mac must be logged in, awake, and online. This is a private personal connection, not public distribution.

1. Run the repository verification commands, then `pnpm build`.
2. Create a dedicated Spotify tunnel in Platform and associate the personal ChatGPT workspace.
3. Store the runtime API key in a private local file referenced by the profile. Do not store literal keys in the repository, `.env`, or LaunchAgent.
4. Configure the profile's `mcp.commands` entry to launch `node --env-file=<absolute-repo-path>/.env <absolute-repo-path>/dist/server.js`. Use the existing shared-root and machine-id configuration on that Mac.
5. Run `tunnel-client doctor --profile spotify-mcp --explain`.
6. Install a separate user LaunchAgent for `tunnel-client run --profile-dir <local-profile-directory> --profile spotify-mcp`, with RunAtLoad and KeepAlive, a PATH containing Node and Python, and private local logs.
7. In ChatGPT Plugins, add a custom MCP server named Spotify MCP, choose Tunnel, select the dedicated tunnel, and create/install the personal plugin.
8. Verify all tools are discovered, call `spotify_get_workflow`, list artifacts, and read a synthetic artifact written through MCP. Verify the shared file locally and on the second Mac after sync. Refresh tools after future builds.

The server exposes workflow instructions through `spotify_get_workflow`; the agent should retrieve the relevant workflow before building or reviewing a playlist. Artifact paths are relative to the server artifact directory. Use new revision filenames rather than overwriting existing sidecars. The bundled checker is exposed as `spotify_check_playlist_constraints`; it does not require the chat environment to have Python or filesystem access.

Do not reuse the YouTube tunnel ID, run competing clients for one tunnel, copy installation ids between Macs, or share token files. A runtime key can be reused only if its existing principal is authorized for the dedicated Spotify tunnel; otherwise create a separately scoped runtime key.

See the [official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) for current account permissions and transport behavior.
