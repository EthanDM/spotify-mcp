import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { SpotifyClient } from "./lib/spotify.js";

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
  limit: z.number().int().min(1).max(100).default(100),
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

    async addPlaylistItems(args: unknown) {
      return withParsedArgs(addPlaylistItemsSchema, args, (input) => spotify.addPlaylistItems(input));
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
