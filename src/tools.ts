import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { SpotifyClient } from "./lib/spotify.js";
import { SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT } from "./lib/spotify-shared.js";

/**
 * Shared validation for paginated playlist listing.
 */
export const listPlaylistsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0)
});

/**
 * Single-playlist identifier used by read-oriented tools.
 */
export const playlistIdSchema = z.object({
  playlistId: z.string().min(1)
});

/**
 * Validation for reading one page of playlist items.
 */
export const playlistItemsSchema = z.object({
  playlistId: z.string().min(1),
  limit: z.number().int().min(1).max(SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT).default(SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT),
  offset: z.number().int().min(0).default(0)
});

/**
 * Track search inputs for playlist-building workflows.
 */
export const searchTracksSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(10)
});

/**
 * Playlist creation inputs. Public playlists require an explicit opt-in.
 */
const createPlaylistFields = {
  name: z.string().min(1),
  description: z.string().optional(),
  public: z.boolean().optional(),
  collaborative: z.boolean().optional()
};

export const createPlaylistSchema = z.object(createPlaylistFields).refine(
  (input) => !(input.public === true && input.collaborative === true),
  {
    message: "Collaborative playlists must not be public.",
    path: ["collaborative"]
  }
);

/**
 * Metadata fields that can be changed on an existing playlist.
 */
const changePlaylistDetailsFields = {
  playlistId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  public: z.boolean().optional(),
  collaborative: z.boolean().optional()
};

export const changePlaylistDetailsSchema = z.object(changePlaylistDetailsFields).refine(
  (input) => !(input.public === true && input.collaborative === true),
  {
    message: "Collaborative playlists must not be public.",
    path: ["collaborative"]
  }
);

/**
 * Input for appending or inserting track URIs into a playlist.
 */
export const addPlaylistItemsSchema = z.object({
  playlistId: z.string().min(1),
  uris: z.array(z.string().startsWith("spotify:")).min(1),
  position: z.number().int().min(0).optional()
});

/**
 * Destructive replace input for setting an exact ordered playlist body.
 */
export const replacePlaylistItemsSchema = z.object({
  playlistId: z.string().min(1),
  uris: z.array(z.string().startsWith("spotify:")),
  confirm: z.literal(true)
});

/**
 * Merge one or more source playlists into a target playlist, preserving order.
 */
export const mergePlaylistsSchema = z.object({
  targetPlaylistId: z.string().min(1),
  sourcePlaylistIds: z.array(z.string().min(1)).min(1),
  dedupe: z.boolean().optional(),
  confirm: z.literal(true)
});

/**
 * Remove duplicate track URIs from a playlist while preserving first occurrence order.
 */
export const dedupePlaylistSchema = z.object({
  playlistId: z.string().min(1),
  confirm: z.literal(true)
});

/**
 * Destructive remove input. `confirm: true` is required so accidental tool
 * calls fail validation before any Spotify request is sent.
 */
export const removePlaylistItemsSchema = z.object({
  playlistId: z.string().min(1),
  uris: z.array(z.string().startsWith("spotify:")).min(1),
  confirm: z.literal(true)
});

/**
 * Destructive reorder input for one contiguous range move.
 */
export const reorderPlaylistItemsSchema = z.object({
  playlistId: z.string().min(1),
  range_start: z.number().int().min(0),
  insert_before: z.number().int().min(0),
  range_length: z.number().int().min(1).optional(),
  confirm: z.literal(true)
});

/**
 * Input for copying one playlist into a new playlist owned by the current user.
 */
export const clonePlaylistSchema = z.object({
  sourcePlaylistId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  public: z.boolean().optional()
});

/**
 * Destructive playlist-library removal input. This unfollows the playlist for
 * the current user; it does not delete the playlist itself.
 */
export const unfollowPlaylistSchema = z.object({
  playlistId: z.string().min(1),
  confirm: z.literal(true)
});

/**
 * Opinionated archive workflow input for playlists the current user owns.
 */
export const archivePlaylistSchema = z.object({
  playlistId: z.string().min(1),
  clearItems: z.boolean().optional(),
  prefix: z.string().min(1).optional(),
  confirm: z.literal(true)
});

export const createPlaylistInputSchema = createPlaylistFields;
export const changePlaylistDetailsInputSchema = changePlaylistDetailsFields;

/**
 * Produces testable handler functions so validation, normalization, and error
 * behavior can be exercised without booting an MCP transport.
 */
export function createToolHandlers(spotify: SpotifyClient) {
  return {
    async getMyProfile() {
      return toolSuccess(await spotify.getMyProfile());
    },

    async listPlaylists(args: unknown) {
      return withParsedArgs(listPlaylistsSchema, args, (input) =>
        spotify.listPlaylists(input.limit, input.offset)
      );
    },

    async getPlaylist(args: unknown) {
      return withParsedArgs(playlistIdSchema, args, (input) => spotify.getPlaylist(input.playlistId));
    },

    async getPlaylistItems(args: unknown) {
      return withParsedArgs(playlistItemsSchema, args, (input) =>
        spotify.getPlaylistItems(input.playlistId, input.limit, input.offset)
      );
    },

    async searchTracks(args: unknown) {
      return withParsedArgs(searchTracksSchema, args, (input) =>
        spotify.searchTracks(input.query, input.limit)
      );
    },

    async createPlaylist(args: unknown) {
      return withParsedArgs(createPlaylistSchema, args, (input) => spotify.createPlaylist(input));
    },

    async changePlaylistDetails(args: unknown) {
      return withParsedArgs(changePlaylistDetailsSchema, args, (input) =>
        spotify.changePlaylistDetails(input)
      );
    },

    async unfollowPlaylist(args: unknown) {
      return withParsedArgs(unfollowPlaylistSchema, args, (input) =>
        spotify.unfollowPlaylist(input.playlistId)
      );
    },

    async archivePlaylist(args: unknown) {
      return withParsedArgs(archivePlaylistSchema, args, (input) =>
        spotify.archivePlaylist({
          playlistId: input.playlistId,
          clearItems: input.clearItems,
          prefix: input.prefix
        })
      );
    },

    async addPlaylistItems(args: unknown) {
      return withParsedArgs(addPlaylistItemsSchema, args, (input) => spotify.addPlaylistItems(input));
    },

    async replacePlaylistItems(args: unknown) {
      return withParsedArgs(replacePlaylistItemsSchema, args, (input) =>
        spotify.replacePlaylistItems({
          playlistId: input.playlistId,
          uris: input.uris
        })
      );
    },

    async mergePlaylists(args: unknown) {
      return withParsedArgs(mergePlaylistsSchema, args, (input) =>
        spotify.mergePlaylists({
          targetPlaylistId: input.targetPlaylistId,
          sourcePlaylistIds: input.sourcePlaylistIds,
          dedupe: input.dedupe
        })
      );
    },

    async dedupePlaylist(args: unknown) {
      return withParsedArgs(dedupePlaylistSchema, args, (input) =>
        spotify.dedupePlaylist({
          playlistId: input.playlistId
        })
      );
    },

    async removePlaylistItems(args: unknown) {
      return withParsedArgs(removePlaylistItemsSchema, args, (input) =>
        spotify.removePlaylistItems({
          playlistId: input.playlistId,
          uris: input.uris
        })
      );
    },

    async reorderPlaylistItems(args: unknown) {
      return withParsedArgs(reorderPlaylistItemsSchema, args, (input) =>
        spotify.reorderPlaylistItems({
          playlistId: input.playlistId,
          rangeStart: input.range_start,
          insertBefore: input.insert_before,
          rangeLength: input.range_length
        })
      );
    },

    async clonePlaylist(args: unknown) {
      return withParsedArgs(clonePlaylistSchema, args, (input) => spotify.clonePlaylist(input));
    }
  };
}

/**
 * Parses tool args before invoking the underlying Spotify client and converts
 * both validation and runtime failures into MCP-compatible text errors.
 */
async function withParsedArgs<TSchema extends z.ZodTypeAny, TResult>(
  schema: TSchema,
  args: unknown,
  handler: (input: z.infer<TSchema>) => Promise<TResult>
) {
  try {
    const parsed = schema.parse(args);
    return toolSuccess(await handler(parsed));
  } catch (error) {
    return toolError(error);
  }
}

/**
 * Produces a success response shape accepted by the MCP SDK.
 *
 * `structuredContent` is only attached for object-like payloads because the SDK
 * expects a record there, not arbitrary JSON values.
 */
function toolSuccess(result: unknown) {
  const response: {
    isError?: false;
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };

  if (isRecord(result)) {
    response.structuredContent = result;
  }

  return response;
}

/**
 * Narrows values that are valid for MCP `structuredContent`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Produces a plain-text MCP error response without leaking implementation details.
 */
function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: formatErrorMessage(error) }]
  };
}
