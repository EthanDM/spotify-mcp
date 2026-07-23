import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { TokenStore } from "./auth/token-store.js";
import { getStorageConfig } from "./config.js";
import { SpotifyClient } from "./lib/spotify.js";
import { PeopleProfileService } from "./people/service.js";
import { PeopleStore } from "./people/store.js";
import { PersonalizationService } from "./personalization/service.js";
import { PersonalizationStore } from "./personalization/store.js";
import { SharedStorageGuard } from "./storage/shared.js";
import {
  addPlaylistItemsSchema,
  archivePlaylistSchema,
  changePlaylistDetailsInputSchema,
  clonePlaylistSchema,
  createPersonProfileInputSchema,
  createPlaylistInputSchema,
  createToolHandlers,
  dedupePlaylistSchema,
  getPersonalizationStateSchema,
  listPersonProfilesSchema,
  listPlaylistsSchema,
  mergePlaylistsSchema,
  personProfileIdSchema,
  playlistIdSchema,
  playlistItemsSchema,
  recordPersonFeedbackInputSchema,
  recordPersonPlaylistInputSchema,
  recordPersonalizationFeedbackInputSchema,
  recordPlaylistEvaluationInputSchema,
  refreshPersonalizationStateSchema,
  replacePlaylistItemsSchema,
  unfollowPlaylistSchema,
  removePlaylistItemsSchema,
  reorderPlaylistItemsSchema,
  searchTracksSchema,
  updatePersonProfileInputSchema
} from "./tools.js";

/**
 * MCP entrypoint that wires the validated tool layer to the Spotify client over
 * a stdio transport for local Codex use.
 */
const server = new McpServer({
  name: "spotify-mcp",
  version: "0.1.0"
});

const storage = getStorageConfig();
const sharedStorage = storage.sharedMode
  ? new SharedStorageGuard(storage)
  : null;
await sharedStorage?.claimMachineId();
const spotify = new SpotifyClient(new TokenStore(storage.tokenFile));
const personalization = new PersonalizationService(
  spotify,
  storage.sharedMode
    ? new PersonalizationStore({
        localDirectory: storage.localPersonalizationDirectory,
        sharedDirectory: storage.sharedPersonalizationDirectory,
        machineId: storage.machineId!,
        sharedMode: true,
        sharedRoot: sharedStorage!.sharedRoot,
        assertSharedWriteAvailable: () => sharedStorage!.assertWritable()
      })
    : new PersonalizationStore(storage.localPersonalizationDirectory)
);
const people = new PeopleProfileService(
  storage.sharedMode
    ? new PeopleStore({
        localDirectory: storage.localPeopleDirectory,
        sharedDirectory: storage.sharedPeopleDirectory,
        machineId: storage.machineId!,
        sharedMode: true,
        sharedRoot: sharedStorage!.sharedRoot,
        assertSharedWriteAvailable: () => sharedStorage!.assertWritable()
      })
    : new PeopleStore(storage.localPeopleDirectory)
);
const handlers = createToolHandlers(spotify, personalization, people);

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
    description:
      "Creates a new Spotify playlist. New playlists default to private.",
    inputSchema: createPlaylistInputSchema
  },
  handlers.createPlaylist
);

server.registerTool(
  "spotify_change_playlist_details",
  {
    title: "Change Spotify Playlist Details",
    description:
      "Updates playlist metadata after verifying the user can modify the playlist.",
    inputSchema: changePlaylistDetailsInputSchema
  },
  handlers.changePlaylistDetails
);

server.registerTool(
  "spotify_unfollow_playlist",
  {
    title: "Unfollow Spotify Playlist",
    description:
      "Removes a playlist from the current user's library. Requires confirm=true.",
    inputSchema: unfollowPlaylistSchema.shape
  },
  handlers.unfollowPlaylist
);

server.registerTool(
  "spotify_archive_playlist",
  {
    title: "Archive Spotify Playlist",
    description:
      "Makes a playlist private, prefixes its name, and can optionally clear items. Requires confirm=true.",
    inputSchema: archivePlaylistSchema.shape
  },
  handlers.archivePlaylist
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
    description:
      "Replaces a playlist with an exact ordered list of track URIs. Requires confirm=true.",
    inputSchema: replacePlaylistItemsSchema.shape
  },
  handlers.replacePlaylistItems
);

server.registerTool(
  "spotify_merge_playlists",
  {
    title: "Merge Spotify Playlists",
    description:
      "Merges source playlists into a target playlist. Requires confirm=true.",
    inputSchema: mergePlaylistsSchema.shape
  },
  handlers.mergePlaylists
);

server.registerTool(
  "spotify_dedupe_playlist",
  {
    title: "Dedupe Spotify Playlist",
    description:
      "Removes duplicate track URIs while preserving first occurrence order. Requires confirm=true.",
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
    description:
      "Moves one contiguous range in a playlist. Requires confirm=true.",
    inputSchema: reorderPlaylistItemsSchema.shape
  },
  handlers.reorderPlaylistItems
);

server.registerTool(
  "spotify_clone_playlist",
  {
    title: "Clone Spotify Playlist",
    description:
      "Copies a playlist into a new private playlist unless public=true is provided.",
    inputSchema: clonePlaylistSchema.shape
  },
  handlers.clonePlaylist
);

server.registerTool(
  "spotify_refresh_personalization_state",
  {
    title: "Refresh Spotify Personalization State",
    description:
      "Refreshes the local personalization snapshot from saved tracks, albums, playlists, and followed artists.",
    inputSchema: refreshPersonalizationStateSchema.shape
  },
  handlers.refreshPersonalizationState
);

server.registerTool(
  "spotify_get_personalization_context",
  {
    title: "Get Spotify Personalization Context",
    description:
      "Returns the compact generated personalization summary for future-agent context.",
    inputSchema: {}
  },
  handlers.getPersonalizationContext
);

server.registerTool(
  "spotify_get_personalization_state",
  {
    title: "Get Spotify Personalization State",
    description:
      "Returns the current personalization files, snapshot metadata, and recent interaction history.",
    inputSchema: getPersonalizationStateSchema.shape
  },
  handlers.getPersonalizationState
);

server.registerTool(
  "spotify_record_personalization_feedback",
  {
    title: "Record Spotify Personalization Feedback",
    description:
      "Records explicit taste feedback that should survive future Spotify refreshes.",
    inputSchema: recordPersonalizationFeedbackInputSchema
  },
  handlers.recordPersonalizationFeedback
);

server.registerTool(
  "spotify_record_playlist_evaluation",
  {
    title: "Record Spotify Playlist Evaluation",
    description:
      "Records a structured evaluation of a specific playlist for a specific use case.",
    inputSchema: recordPlaylistEvaluationInputSchema
  },
  handlers.recordPlaylistEvaluation
);

server.registerTool(
  "spotify_create_person_profile",
  {
    title: "Create Spotify Person Profile",
    description:
      "Creates a saved friend or family listener profile for future playlist work.",
    inputSchema: createPersonProfileInputSchema
  },
  handlers.createPersonProfile
);

server.registerTool(
  "spotify_update_person_profile",
  {
    title: "Update Spotify Person Profile",
    description:
      "Updates one saved friend or family listener profile while preserving omitted fields.",
    inputSchema: updatePersonProfileInputSchema
  },
  handlers.updatePersonProfile
);

server.registerTool(
  "spotify_list_person_profiles",
  {
    title: "List Spotify Person Profiles",
    description:
      "Lists the saved friend and family listener profiles available for playlist workflows.",
    inputSchema: listPersonProfilesSchema.shape
  },
  handlers.listPersonProfiles
);

server.registerTool(
  "spotify_get_person_profile",
  {
    title: "Get Spotify Person Profile",
    description:
      "Returns one saved friend or family listener profile plus its local state paths.",
    inputSchema: personProfileIdSchema.shape
  },
  handlers.getPersonProfile
);

server.registerTool(
  "spotify_get_person_profile_context",
  {
    title: "Get Spotify Person Profile Context",
    description:
      "Returns the compact generated summary for one saved friend or family listener profile.",
    inputSchema: personProfileIdSchema.shape
  },
  handlers.getPersonProfileContext
);

server.registerTool(
  "spotify_record_person_playlist",
  {
    title: "Record Spotify Person Playlist",
    description:
      "Records a playlist and its outcome against a saved friend or family listener profile.",
    inputSchema: recordPersonPlaylistInputSchema
  },
  handlers.recordPersonPlaylist
);

server.registerTool(
  "spotify_record_person_feedback",
  {
    title: "Record Spotify Person Feedback",
    description:
      "Records one durable taste or context learning for a saved friend or family listener profile.",
    inputSchema: recordPersonFeedbackInputSchema
  },
  handlers.recordPersonFeedback
);

const transport = new StdioServerTransport();
await server.connect(transport);
