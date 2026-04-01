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
- `spotify_add_playlist_items`
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

If the browser does not open automatically, copy the printed URL into your browser.

## Run The MCP Server

For development:

```bash
pnpm dev
```

For production:

```bash
pnpm build
pnpm start
```

## Codex Configuration

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.spotify]
command = "node"
args = ["/Users/ethanmillstein/GitHub/spotify-mcp/dist/server.js"]
```

For local iteration, you can point Codex at `tsx` instead, but the built `dist/server.js` path is the stable default.

## Tool Notes

- New playlists default to `public: false`.
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
