import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { TokenStore } from "./auth/token-store.js";
import { getTokenFilePath } from "./config.js";
import { SpotifyClient } from "./lib/spotify.js";
import {
  addPlaylistItemsSchema,
  changePlaylistDetailsSchema,
  changePlaylistDetailsInputSchema,
  clonePlaylistSchema,
  createPlaylistSchema,
  createPlaylistInputSchema,
  createToolHandlers,
  dedupePlaylistSchema,
  listPlaylistsSchema,
  mergePlaylistsSchema,
  playlistIdSchema,
  playlistItemsSchema,
  replacePlaylistItemsSchema,
  unfollowPlaylistSchema,
  removePlaylistItemsSchema,
  reorderPlaylistItemsSchema,
  searchTracksSchema
} from "./tools.js";

/**
 * MCP entrypoint that wires the validated tool layer to the Spotify client over
 * a stdio transport for local Codex use.
 */
const server = new McpServer({
  name: "spotify-mcp",
  version: "0.1.0"
});

const spotify = new SpotifyClient(new TokenStore(getTokenFilePath()));
const handlers = createToolHandlers(spotify);

server.registerTool(
  "spotify_get_my_profile",
  {
    title: "Get My Spotify Profile",
    description: "Returns the authenticated Spotify user's basic profile.",
    inputSchema: {}
  },
  async () => handlers.getMyProfile()
);

server.registerTool(
  "spotify_list_playlists",
  {
    title: "List Spotify Playlists",
    description: "Lists the authenticated user's playlists.",
    inputSchema: listPlaylistsSchema.shape
  },
  handlers.listPlaylists
);

server.registerTool(
  "spotify_get_playlist",
  {
    title: "Get Spotify Playlist",
    description: "Returns normalized metadata for a playlist.",
    inputSchema: playlistIdSchema.shape
  },
  handlers.getPlaylist
);

server.registerTool(
  "spotify_get_playlist_items",
  {
    title: "Get Spotify Playlist Items",
    description: "Returns normalized tracks for a playlist page.",
    inputSchema: playlistItemsSchema.shape
  },
  handlers.getPlaylistItems
);

server.registerTool(
  "spotify_search_tracks",
  {
    title: "Search Spotify Tracks",
    description: "Searches Spotify tracks for playlist-building workflows.",
    inputSchema: searchTracksSchema.shape
  },
  handlers.searchTracks
);

server.registerTool(
  "spotify_create_playlist",
  {
    title: "Create Spotify Playlist",
    description: "Creates a new Spotify playlist. New playlists default to private.",
    inputSchema: createPlaylistInputSchema
  },
  handlers.createPlaylist
);

server.registerTool(
  "spotify_change_playlist_details",
  {
    title: "Change Spotify Playlist Details",
    description: "Updates playlist metadata after verifying the user can modify the playlist.",
    inputSchema: changePlaylistDetailsInputSchema
  },
  handlers.changePlaylistDetails
);

server.registerTool(
  "spotify_unfollow_playlist",
  {
    title: "Unfollow Spotify Playlist",
    description: "Removes a playlist from the current user's library. Requires confirm=true.",
    inputSchema: unfollowPlaylistSchema.shape
  },
  handlers.unfollowPlaylist
);

server.registerTool(
  "spotify_add_playlist_items",
  {
    title: "Add Spotify Playlist Items",
    description: "Adds one or more track URIs to a playlist.",
    inputSchema: addPlaylistItemsSchema.shape
  },
  handlers.addPlaylistItems
);

server.registerTool(
  "spotify_replace_playlist_items",
  {
    title: "Replace Spotify Playlist Items",
    description: "Replaces a playlist with an exact ordered list of track URIs. Requires confirm=true.",
    inputSchema: replacePlaylistItemsSchema.shape
  },
  handlers.replacePlaylistItems
);

server.registerTool(
  "spotify_merge_playlists",
  {
    title: "Merge Spotify Playlists",
    description: "Merges source playlists into a target playlist. Requires confirm=true.",
    inputSchema: mergePlaylistsSchema.shape
  },
  handlers.mergePlaylists
);

server.registerTool(
  "spotify_dedupe_playlist",
  {
    title: "Dedupe Spotify Playlist",
    description: "Removes duplicate track URIs while preserving first occurrence order. Requires confirm=true.",
    inputSchema: dedupePlaylistSchema.shape
  },
  handlers.dedupePlaylist
);

server.registerTool(
  "spotify_remove_playlist_items",
  {
    title: "Remove Spotify Playlist Items",
    description: "Removes track URIs from a playlist. Requires confirm=true.",
    inputSchema: removePlaylistItemsSchema.shape
  },
  handlers.removePlaylistItems
);

server.registerTool(
  "spotify_reorder_playlist_items",
  {
    title: "Reorder Spotify Playlist Items",
    description: "Moves one contiguous range in a playlist. Requires confirm=true.",
    inputSchema: reorderPlaylistItemsSchema.shape
  },
  handlers.reorderPlaylistItems
);

server.registerTool(
  "spotify_clone_playlist",
  {
    title: "Clone Spotify Playlist",
    description: "Copies a playlist into a new private playlist unless public=true is provided.",
    inputSchema: clonePlaylistSchema.shape
  },
  handlers.clonePlaylist
);

const transport = new StdioServerTransport();
await server.connect(transport);
