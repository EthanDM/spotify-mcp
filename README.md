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
- `spotify_record_playlist_evaluation`
- `spotify_create_person_profile`
- `spotify_update_person_profile`
- `spotify_list_person_profiles`
- `spotify_get_person_profile`
- `spotify_get_person_profile_context`
- `spotify_record_person_playlist`
- `spotify_record_person_feedback`

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
- Friend/family listener profiles are stored separately in `~/.config/spotify-mcp/people/`.
- Generated user-specific artifacts should also stay outside the repo in `~/.config/spotify-mcp/artifacts/`.
- The personalization layer keeps four files separate on purpose:
  - `profile-snapshot.json` for refreshable Spotify-derived state
  - `user-preferences.json` for durable explicit preferences
  - `interaction-log.ndjson` for append-only MCP history
  - `personalization-context.md` for future-agent context
- The people-profile layer keeps one directory per saved listener under `~/.config/spotify-mcp/people/<profile-id>/`:
  - `profile.json` for canonical listener context and taste cues
  - `playlist-history.ndjson` for structured playlist history and outcomes
  - `profile-context.md` for the compact future-agent summary for that person
- Human-readable playlist writeups are optional sidecar artifacts, not canonical personalization memory. Keep the reusable learning in personalization state and store the writeups under the artifacts directory when you want to preserve them.
- Human-readable writeups for people profiles are also optional sidecars. Keep canonical listener state in `profile.json` and structured playlist outcomes in `playlist-history.ndjson`, then store review notes under `~/.config/spotify-mcp/artifacts/people/<profile-id>/`.
- `spotify_record_personalization_feedback` also supports scoped `use_case` feedback so future agents can retain lessons like "focused work prefers steady instrumental music and avoids abrupt vocals."
- Scoped use-case preferences can also store playback mode and ideal track-count range.
- `spotify_record_playlist_evaluation` captures evidence about specific playlist outputs, including score, verdict, winning traits, losing traits, and workflow learnings.
- Friend/family profiles are manual-context-first in v1. Create or update the person profile, read their generated context, build the playlist with the normal Spotify tools, then record the resulting playlist back against the profile.

### Sharing durable state between Macs

Shared mode is opt-in. Keep authentication and generated state local while putting durable preferences, people profiles, history, and artifacts in iCloud:

```dotenv
SPOTIFY_MCP_DATA_DIR=~/.config/spotify-mcp
SPOTIFY_MCP_SHARED_DATA_DIR=~/Library/Mobile Documents/com~apple~CloudDocs/App Data/spotify-mcp
SPOTIFY_MCP_MACHINE_ID=desktop
```

Use a different stable lowercase id such as `neo` on the other Mac. On first use, Spotify MCP creates a private local `installation-id` and reserves the machine id under the shared `machines/` directory. A machine id can belong to only one installation, so do not copy `installation-id` between Macs or reuse an id after configuring another Mac.

Never move or symlink the entire `~/.config/spotify-mcp` directory: `auth.json`, Spotify snapshots, generated contexts, `.env`, and Codex configuration must remain machine-local. Spotify MCP rechecks the iCloud root and machine reservation before each shared write. If the configured root disappears, the write fails instead of recreating a local shadow directory or falling back to local storage.

Migrate the desktop first after iCloud is available:

```bash
pnpm data:migrate
pnpm data:migrate -- --apply
```

The first command is read-only. Create the configured directory in iCloud before applying the migration. The applied migration reserves the machine id, preserves the original local files, excludes credentials and generated state, and can be rerun without duplicating records. Allow iCloud to finish syncing before configuring or migrating Neo. If Neo has different preferences or profiles, migration imports them as explicit revision forks while still migrating its histories and artifacts; resolve those forks afterward.

Preferences and person profiles retain immutable revisions. If offline edits create multiple tips, normal access refuses to choose one. Inspect and resolve the conflict explicitly:

```bash
pnpm data:resolve -- --document preferences
pnpm data:resolve -- --document preferences --from-revision <revision-id> --apply
pnpm data:resolve -- --document people/<profile-id> --from-file /absolute/path/to/merged-profile.json --apply
```

Resolution preserves all earlier revisions. Removing the shared variables restores legacy local behavior using the untouched local files; newer shared activity is not copied back automatically. Give shared artifacts unique or timestamped names because differing files at the same relative path are treated as collisions during migration.

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
  "value": "Artist A",
  "context": "Example durable artist preference"
}
```

Record use-case-specific trait feedback:

```json
{
  "kind": "trait",
  "sentiment": "prefer",
  "value": "steady instrumental electronic",
  "use_case": "focused work",
  "context": "Keeps attention steady during focused work"
}
```

Record a use-case playback preference:

```json
{
  "kind": "playback_mode",
  "use_case": "focused work",
  "playback_mode": "shuffle",
  "context": "Shuffle works for long background sessions"
}
```

Record an ideal use-case track-count range:

```json
{
  "kind": "ideal_track_count_range",
  "use_case": "focused work",
  "min_count": 55,
  "max_count": 65,
  "context": "This range balances variety and repeatability"
}
```

Record a playlist evaluation:

```json
{
  "playlistId": "37i9dQZF1DX...",
  "use_case": "focused work",
  "verdict": "default",
  "score": 9.2,
  "winning_traits": [
    "steady instrumental electronic",
    "consistent tempo",
    "low distraction"
  ],
  "losing_traits": ["abrupt vocals", "redundant texture"],
  "workflow_learning": "A broad draft followed by a focused trim improves consistency"
}
```

Create a saved listener profile:

```json
{
  "name": "Sample Listener",
  "relationship": "friend",
  "age": 30,
  "life_context": ["prefers morning listening", "often listens while cooking"],
  "preferred_traits": ["bright", "warm", "upbeat indie-pop"],
  "avoided_traits": ["harsh drops", "abrasive bass"],
  "playlist_goals": ["upbeat background music"],
  "notes": ["Keep recommendations easy and replayable"]
}
```

Read the generated context for one saved listener:

```json
{
  "profileId": "sample-listener"
}
```

Record a playlist made for one saved listener:

```json
{
  "profileId": "sample-listener",
  "playlist_id": "37i9dQZF1DX...",
  "playlist_name": "Sample Listener - Upbeat Background",
  "playlist_url": "https://open.spotify.com/playlist/37i9dQZF1DX...",
  "use_case": "upbeat background music",
  "track_count": 22,
  "runtime_minutes": 78,
  "score": 9,
  "verdict": "success",
  "winning_traits": ["bright", "warm", "comforting"],
  "workflow_learning": "Tightening to roughly 22 tracks improved hit rate and replayability",
  "artifact_paths": [
    "~/.config/spotify-mcp/artifacts/people/sample-listener/review.md"
  ]
}
```

Record one new durable learning for a saved listener:

```json
{
  "profileId": "sample-listener",
  "kind": "trait",
  "sentiment": "avoid",
  "value": "festival emotional"
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
