# spotify-mcp

Local Spotify MCP server for Codex focused on personal playlist management.

This project wraps Spotify's Web API in a small MCP tool surface for managing playlists from Codex. It is designed for local, authenticated use on a single Spotify account.

## What It Does

The server exposes these tools:

- `spotify_get_my_profile`
- `spotify_list_playlists`
- `spotify_get_playlist`
- `spotify_get_playlist_items`
- `spotify_search_tracks`
- `spotify_create_playlist`
- `spotify_change_playlist_details`
- `spotify_unfollow_playlist`
- `spotify_archive_playlist`
- `spotify_add_playlist_items`
- `spotify_replace_playlist_items`
- `spotify_merge_playlists`
- `spotify_dedupe_playlist`
- `spotify_remove_playlist_items`
- `spotify_reorder_playlist_items`
- `spotify_clone_playlist`
- `spotify_refresh_personalization_state`
- `spotify_get_personalization_context`
- `spotify_get_personalization_state`
- `spotify_record_personalization_feedback`

## What It Does Not Do

- It does not support true playlist deletion. Spotify's Web API does not expose a delete-playlist endpoint.
- It does not support local-file playlist items for clone, replace, or URI-based remove flows.
- It is not intended to be a hosted multi-user service in its current form.

## Requirements

- Node.js 22+
- `pnpm`
- A Spotify app in the Spotify Developer Dashboard

## Quick Start

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add `http://127.0.0.1:8787/callback` as an allowed redirect URI.
3. Copy `.env.example` to `.env`.
4. Set `SPOTIFY_CLIENT_ID` in `.env`.
5. Install dependencies:

```bash
pnpm install
```

6. Authenticate once:

```bash
pnpm auth
```

7. Build the server:

```bash
pnpm build
```

8. Point Codex at the built server.

Most users should use the built server path above. Use `pnpm dev` only when actively developing on this repository.

## Spotify App Setup

This project uses PKCE and requests these scopes:

- `playlist-read-private`
- `playlist-read-collaborative`
- `playlist-modify-private`
- `playlist-modify-public`
- `user-library-read`
- `user-follow-read`

If you authenticated before the personalization layer was added, run `pnpm auth` again so the stored token includes the new read scopes.

The auth command:

- generates a PKCE verifier/challenge
- prints the Spotify authorization URL
- starts a temporary callback server on your local redirect URI
- exchanges the returned code for tokens
- stores tokens in `~/.config/spotify-mcp/auth.json`

Copy the printed URL into your browser to complete login.

## Running

### Stable built-server setup

Recommended for normal use:

```bash
pnpm build
pnpm start
```

`dist/` is build output. Do not assume a fresh clone already has the right compiled files. Run `pnpm build` after cloning and whenever source changes need to be picked up by the built server.

Example Codex config:

```toml
[mcp_servers.spotify]
command = "node"
args = ["--env-file=/absolute/path/to/spotify-mcp/.env", "/absolute/path/to/spotify-mcp/dist/server.js"]
```

Replace `/absolute/path/to/spotify-mcp` with your local clone path.

### Contributor setup

Useful only when editing this repo:

```bash
pnpm dev
```

This runs `tsx watch src/server.ts` so source edits hot reload automatically.

Example Codex config for contributor mode:

```toml
[mcp_servers.spotify]
command = "pnpm"
args = ["--dir", "/absolute/path/to/spotify-mcp", "dev"]
```

## Tool Notes

- New playlists default to `public: false`.
- `spotify_unfollow_playlist` removes a playlist from the current user's library. It does not delete the playlist from Spotify.
- `spotify_archive_playlist` is an opinionated cleanup flow for owned playlists: it makes the playlist private, disables collaboration, prefixes the name with `[Archived] ` by default, and can optionally clear all items.
- `spotify_replace_playlist_items`, `spotify_remove_playlist_items`, `spotify_reorder_playlist_items`, `spotify_merge_playlists`, `spotify_dedupe_playlist`, `spotify_unfollow_playlist`, and `spotify_archive_playlist` require `confirm: true`.
- Remove and reorder fetch the latest playlist snapshot before mutating.
- Clone copies items in batches and creates the destination playlist as private unless you explicitly opt into `public: true`.
- Personalization state is stored outside the repo in `~/.config/spotify-mcp/personalization/`.
- The personalization layer keeps four files separate on purpose:
  - `profile-snapshot.json` for refreshable Spotify-derived state
  - `user-preferences.json` for durable explicit preferences
  - `interaction-log.ndjson` for append-only MCP history
  - `personalization-context.md` for future-agent context

## Example Calls

Create a playlist:

```json
{
  "name": "Morning Focus",
  "description": "Low-distraction electronic and ambient tracks"
}
```

Add tracks:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M"
  ]
}
```

Archive a playlist you own:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "clearItems": true,
  "confirm": true
}
```

Replace the full playlist body:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M"
  ],
  "confirm": true
}
```

Merge playlists into a target:

```json
{
  "targetPlaylistId": "37i9dQZF1DXTARGET",
  "sourcePlaylistIds": ["37i9dQZF1DXSOURCEA", "37i9dQZF1DXSOURCEB"],
  "dedupe": true,
  "confirm": true
}
```

Refresh the personalization snapshot:

```json
{
  "playlistLimit": 250,
  "savedTracksLimit": 200,
  "savedAlbumsLimit": 100,
  "followedArtistsLimit": 100
}
```

Record explicit personalization feedback:

```json
{
  "kind": "artist",
  "sentiment": "prefer",
  "value": "Fred again..",
  "context": "Repeatedly keep this artist in late-night playlists"
}
```

## Verification

Local verification:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Live-account smoke test:

```bash
pnpm smoke
```

The smoke test:

- uses your real authenticated Spotify account
- creates temporary private playlists
- exercises create, change-details, add, replace, clear, dedupe, merge, reorder, remove, and clone
- prints the created playlist IDs so you can clean them up manually afterward

Detailed smoke polling logs are off by default. Enable them with:

```bash
SPOTIFY_SMOKE_VERBOSE=1 pnpm smoke
```

Refresh the local personalization files:

```bash
pnpm personalize:refresh
```

That command refreshes liked-track, saved-album, playlist, and followed-artist state and rebuilds the generated personalization summary future agents can use as context.

## CI

GitHub Actions runs this verification stack on pushes to `main` and on pull requests:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
