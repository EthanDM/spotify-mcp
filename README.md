# spotify-mcp

Local Spotify MCP server for Codex focused on personal playlist management.

## Happy Path

1. Create a Spotify app in the developer dashboard.
2. Add `http://127.0.0.1:8787/callback` as an allowed redirect URI.
3. Copy `.env.example` to `.env` and set `SPOTIFY_CLIENT_ID`.
4. Install dependencies:

```bash
pnpm install
```

5. Authenticate once:

```bash
pnpm auth
```

6. Configure Codex to run the server locally:

```toml
[mcp_servers.spotify]
command = "pnpm"
args = ["--dir", "/Users/ethanmillstein/GitHub/spotify-mcp", "dev"]
```

7. Run a live smoke pass against your Spotify account:

```bash
pnpm smoke
```

## What It Does

The server exposes a small playlist-oriented tool surface:

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

## Setup

Requirements:

- Node.js 22+
- `pnpm`
- Spotify app credentials

Auth uses PKCE and requests:

- `playlist-read-private`
- `playlist-read-collaborative`
- `playlist-modify-private`
- `playlist-modify-public`

The auth command:

- generates a PKCE verifier/challenge
- prints the Spotify authorization URL
- starts a temporary callback server on your local redirect URI
- exchanges the returned code for tokens
- stores tokens in `~/.config/spotify-mcp/auth.json`

Copy the printed URL into your browser to complete the login.

## Running

For local iteration:

```bash
pnpm dev
```

This runs `tsx watch src/server.ts`, so source edits hot reload automatically.

For a built server:

```bash
pnpm build
pnpm start
```

Stable built-server Codex config:

```toml
[mcp_servers.spotify]
command = "node"
args = ["--env-file=/Users/ethanmillstein/GitHub/spotify-mcp/.env", "/Users/ethanmillstein/GitHub/spotify-mcp/dist/server.js"]
```

## Tool Notes

- New playlists default to `public: false`.
- `spotify_unfollow_playlist` removes a playlist from the current user's library. It does not delete the playlist from Spotify.
- `spotify_archive_playlist` is an opinionated cleanup flow for owned playlists: it makes the playlist private, disables collaboration, prefixes the name with `[Archived] ` by default, and can optionally clear all items.
- `spotify_replace_playlist_items`, `spotify_remove_playlist_items`, `spotify_reorder_playlist_items`, `spotify_merge_playlists`, `spotify_dedupe_playlist`, `spotify_unfollow_playlist`, and `spotify_archive_playlist` require `confirm: true`.
- Remove and reorder fetch the latest playlist snapshot before mutating.
- Clone copies items in batches and creates the destination playlist as private unless you explicitly opt into `public: true`.
- Spotify does not expose true playlist deletion in the Web API.

## Example Calls

Create a playlist:

```json
{
  "name": "Scottsdale Run",
  "description": "Mid-tempo spring running playlist"
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

## Verification

Local verification:

```bash
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

## CI

GitHub Actions runs this verification stack on pushes to `main` and on pull requests:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
