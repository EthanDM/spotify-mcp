# spotify-mcp

A local Spotify MCP server for Codex focused on personal playlist management.

## What It Does

This MVP exposes a small playlist-oriented tool surface over Spotify's Web API:

- `spotify_get_my_profile`
- `spotify_list_playlists`
- `spotify_get_playlist`
- `spotify_get_playlist_items`
- `spotify_search_tracks`
- `spotify_create_playlist`
- `spotify_change_playlist_details`
- `spotify_unfollow_playlist`
- `spotify_add_playlist_items`
- `spotify_replace_playlist_items`
- `spotify_merge_playlists`
- `spotify_dedupe_playlist`
- `spotify_remove_playlist_items`
- `spotify_reorder_playlist_items`
- `spotify_clone_playlist`

The server runs over stdio so Codex can spawn it locally. Authentication is handled once through a PKCE CLI flow and the resulting tokens are stored outside the repo.

## Requirements

- Node.js 22+
- `pnpm`
- A Spotify app with a redirect URI allowlisted

## Spotify App Setup

1. Create an app in the Spotify developer dashboard.
2. Add `http://127.0.0.1:8787/callback` as a redirect URI.
3. Copy `.env.example` to `.env`.
4. Set `SPOTIFY_CLIENT_ID`.
5. Optionally override `SPOTIFY_REDIRECT_URI` if you are using a different local callback URL.

The auth flow requests these scopes:

- `playlist-read-private`
- `playlist-read-collaborative`
- `playlist-modify-private`
- `playlist-modify-public`

## Install

```bash
pnpm install
```

## Authenticate

Run:

```bash
pnpm auth
```

This command:

- generates a PKCE verifier/challenge
- prints the Spotify authorization URL
- starts a temporary callback server on your local redirect URI
- exchanges the returned code for tokens
- stores tokens in `~/.config/spotify-mcp/auth.json`

Copy the printed URL into your browser to complete the login.

## Run The MCP Server

For development:

```bash
pnpm dev
```

This runs the source server under `tsx watch`, so local edits hot reload automatically.

For production:

```bash
pnpm build
pnpm start
```

## Codex Configuration

Recommended local iteration setup:

```toml
[mcp_servers.spotify]
command = "pnpm"
args = ["--dir", "/Users/ethanmillstein/GitHub/spotify-mcp", "dev"]
```

Stable built-server setup:

```toml
[mcp_servers.spotify]
command = "node"
args = ["--env-file=/Users/ethanmillstein/GitHub/spotify-mcp/.env", "/Users/ethanmillstein/GitHub/spotify-mcp/dist/server.js"]
```

## Tool Notes

- New playlists default to `public: false`.
- `spotify_unfollow_playlist` removes a playlist from the current user's library. It does not delete the playlist from Spotify.
- `spotify_replace_playlist_items` requires `confirm: true` and treats the input URI list as the exact final playlist order.
- `spotify_merge_playlists` keeps the target playlist first, then appends source playlists in the order you provide.
- `spotify_dedupe_playlist` keeps the first occurrence of each track URI and removes later duplicates.
- `spotify_remove_playlist_items` and `spotify_reorder_playlist_items` require `confirm: true`.
- Remove and reorder fetch the latest playlist snapshot before mutating.
- Clone copies items in batches and creates the destination playlist as private unless you explicitly opt into `public: true`.

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

Unfollow a playlist from your library:

```json
{
  "playlistId": "37i9dQZF1DX...",
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
  "sourcePlaylistIds": [
    "37i9dQZF1DXSOURCEA",
    "37i9dQZF1DXSOURCEB"
  ],
  "dedupe": true,
  "confirm": true
}
```

Dedupe a playlist:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "confirm": true
}
```

Remove tracks:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "uris": [
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
  ],
  "confirm": true
}
```

Reorder tracks:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "range_start": 8,
  "insert_before": 2,
  "confirm": true
}
```

## Testing

Run:

```bash
pnpm test
```

## Smoke Test

Run:

```bash
pnpm smoke
```

This command uses your real authenticated Spotify account and will:

- list a few of your playlists
- create temporary private playlists
- exercise create, change-details, add, replace, clear, dedupe, merge, reorder, remove, and clone
- print the created playlist IDs so you can clean them up manually afterward

It is intentionally a live-account regression check, not a CI test.

## Smoke Checklist

Run these once after setup to verify the local server against your real account:

1. `spotify_get_my_profile`
2. `spotify_list_playlists` with `limit: 5`, `offset: 0`
3. `spotify_create_playlist` with a temporary private name
4. `spotify_search_tracks` with a simple query like `ODESZA`
5. `spotify_add_playlist_items` with one returned track URI
6. `spotify_replace_playlist_items` with two known track URIs and `confirm: true`
7. `spotify_replace_playlist_items` with an empty `uris` array and `confirm: true` to verify playlist clear
8. `spotify_merge_playlists` into a temporary target playlist with `confirm: true`
9. `spotify_dedupe_playlist` on a playlist that contains a duplicate track
10. `spotify_remove_playlist_items` with one URI and `confirm: true`
11. `spotify_reorder_playlist_items` with `confirm: true`
12. `spotify_clone_playlist` on a small source playlist

If those pass, the personal local workflow is in good shape end to end.
