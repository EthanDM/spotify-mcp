import { z } from "zod";

import { formatErrorMessage } from "./errors.js";
import type { SpotifyClient } from "./lib/spotify.js";
import { SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT } from "./lib/spotify-shared.js";
import type { PersonalizationService } from "./personalization/service.js";

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
  limit: z
    .number()
    .int()
    .min(1)
    .max(SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT)
    .default(SPOTIFY_PLAYLIST_ITEMS_PAGE_LIMIT),
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

export const createPlaylistSchema = z
  .object(createPlaylistFields)
  .refine((input) => !(input.public === true && input.collaborative === true), {
    message: "Collaborative playlists must not be public.",
    path: ["collaborative"]
  });

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

export const changePlaylistDetailsSchema = z
  .object(changePlaylistDetailsFields)
  .refine((input) => !(input.public === true && input.collaborative === true), {
    message: "Collaborative playlists must not be public.",
    path: ["collaborative"]
  });

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

/**
 * Rebuilds the local personalization snapshot from Spotify library state.
 */
export const refreshPersonalizationStateSchema = z.object({
  playlistLimit: z.number().int().min(1).max(500).default(250),
  savedTracksLimit: z.number().int().min(1).max(500).default(200),
  savedAlbumsLimit: z.number().int().min(1).max(250).default(100),
  followedArtistsLimit: z.number().int().min(1).max(250).default(100)
});

/**
 * Small inspection input for personalization state reads.
 */
export const getPersonalizationStateSchema = z.object({
  recentEventLimit: z.number().int().min(1).max(100).default(20)
});

/**
 * Explicit taste feedback that should survive future Spotify refreshes.
 */
const recordPersonalizationFeedbackFields = {
  kind: z.enum(["artist", "genre", "note", "discovery_level"]),
  sentiment: z.enum(["prefer", "avoid"]).optional(),
  value: z.string().min(1),
  context: z.string().optional()
};

export const recordPersonalizationFeedbackSchema = z
  .object(recordPersonalizationFeedbackFields)
  .superRefine((input, refinement) => {
    if (
      (input.kind === "artist" || input.kind === "genre") &&
      !input.sentiment
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Artist and genre feedback require a sentiment.",
        path: ["sentiment"]
      });
    }

    if (
      input.kind === "discovery_level" &&
      !["low", "medium", "high"].includes(input.value)
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Discovery level must be one of: low, medium, high.",
        path: ["value"]
      });
    }
  });

export const createPlaylistInputSchema = createPlaylistFields;
export const changePlaylistDetailsInputSchema = changePlaylistDetailsFields;
export const recordPersonalizationFeedbackInputSchema =
  recordPersonalizationFeedbackFields;

/**
 * Produces testable handler functions so validation, normalization, and error
 * behavior can be exercised without booting an MCP transport.
 */
export function createToolHandlers(
  spotify: SpotifyClient,
  personalization?: PersonalizationService
) {
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
      return withParsedArgs(playlistIdSchema, args, (input) =>
        spotify.getPlaylist(input.playlistId)
      );
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
      return withParsedArgsAndEffect(
        createPlaylistSchema,
        args,
        (input) => spotify.createPlaylist(input),
        (_input, result) =>
          logPersonalizationEvent(personalization, "playlist_created", {
            playlistId: result.id,
            playlistName: result.name,
            public: result.public ?? false
          })
      );
    },

    async changePlaylistDetails(args: unknown) {
      return withParsedArgsAndEffect(
        changePlaylistDetailsSchema,
        args,
        (input) => spotify.changePlaylistDetails(input),
        (input, result) =>
          logPersonalizationEvent(personalization, "playlist_details_changed", {
            playlistId: input.playlistId,
            playlistName: result.name,
            public: result.public ?? false
          })
      );
    },

    async unfollowPlaylist(args: unknown) {
      return withParsedArgsAndEffect(
        unfollowPlaylistSchema,
        args,
        (input) => spotify.unfollowPlaylist(input.playlistId),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_unfollowed", {
            playlistId: input.playlistId
          })
      );
    },

    async archivePlaylist(args: unknown) {
      return withParsedArgsAndEffect(
        archivePlaylistSchema,
        args,
        (input) =>
          spotify.archivePlaylist({
            playlistId: input.playlistId,
            clearItems: input.clearItems,
            prefix: input.prefix
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_archived", {
            playlistId: input.playlistId,
            clearItems: input.clearItems ?? false
          })
      );
    },

    async addPlaylistItems(args: unknown) {
      return withParsedArgsAndEffect(
        addPlaylistItemsSchema,
        args,
        (input) => spotify.addPlaylistItems(input),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_items_added", {
            playlistId: input.playlistId,
            addedCount: input.uris.length
          })
      );
    },

    async replacePlaylistItems(args: unknown) {
      return withParsedArgsAndEffect(
        replacePlaylistItemsSchema,
        args,
        (input) =>
          spotify.replacePlaylistItems({
            playlistId: input.playlistId,
            uris: input.uris
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_items_replaced", {
            playlistId: input.playlistId,
            finalCount: input.uris.length
          })
      );
    },

    async mergePlaylists(args: unknown) {
      return withParsedArgsAndEffect(
        mergePlaylistsSchema,
        args,
        (input) =>
          spotify.mergePlaylists({
            targetPlaylistId: input.targetPlaylistId,
            sourcePlaylistIds: input.sourcePlaylistIds,
            dedupe: input.dedupe
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_merged", {
            playlistId: input.targetPlaylistId,
            sourcePlaylistIds: input.sourcePlaylistIds,
            dedupe: input.dedupe ?? false
          })
      );
    },

    async dedupePlaylist(args: unknown) {
      return withParsedArgsAndEffect(
        dedupePlaylistSchema,
        args,
        (input) =>
          spotify.dedupePlaylist({
            playlistId: input.playlistId
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_deduped", {
            playlistId: input.playlistId
          })
      );
    },

    async removePlaylistItems(args: unknown) {
      return withParsedArgsAndEffect(
        removePlaylistItemsSchema,
        args,
        (input) =>
          spotify.removePlaylistItems({
            playlistId: input.playlistId,
            uris: input.uris
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_items_removed", {
            playlistId: input.playlistId,
            removedCount: input.uris.length
          })
      );
    },

    async reorderPlaylistItems(args: unknown) {
      return withParsedArgsAndEffect(
        reorderPlaylistItemsSchema,
        args,
        (input) =>
          spotify.reorderPlaylistItems({
            playlistId: input.playlistId,
            rangeStart: input.range_start,
            insertBefore: input.insert_before,
            rangeLength: input.range_length
          }),
        (input) =>
          logPersonalizationEvent(personalization, "playlist_items_reordered", {
            playlistId: input.playlistId,
            rangeStart: input.range_start,
            insertBefore: input.insert_before,
            rangeLength: input.range_length ?? 1
          })
      );
    },

    async clonePlaylist(args: unknown) {
      return withParsedArgsAndEffect(
        clonePlaylistSchema,
        args,
        (input) => spotify.clonePlaylist(input),
        (input, result) =>
          logPersonalizationEvent(personalization, "playlist_cloned", {
            sourcePlaylistId: input.sourcePlaylistId,
            clonePlaylistId: result.id
          })
      );
    },

    async refreshPersonalizationState(args: unknown) {
      if (!personalization) {
        return toolError(
          new Error("Personalization service is not configured.")
        );
      }

      return withParsedArgs(refreshPersonalizationStateSchema, args, (input) =>
        personalization.refreshState(input)
      );
    },

    async getPersonalizationContext() {
      if (!personalization) {
        return toolError(
          new Error("Personalization service is not configured.")
        );
      }

      return toolSuccess(await personalization.getContext());
    },

    async getPersonalizationState(args: unknown) {
      if (!personalization) {
        return toolError(
          new Error("Personalization service is not configured.")
        );
      }

      return withParsedArgs(getPersonalizationStateSchema, args, (input) =>
        personalization.getState(input)
      );
    },

    async recordPersonalizationFeedback(args: unknown) {
      if (!personalization) {
        return toolError(
          new Error("Personalization service is not configured.")
        );
      }

      return withParsedArgs(
        recordPersonalizationFeedbackSchema,
        args,
        (input) => personalization.recordFeedback(input)
      );
    }
  };
}

async function logPersonalizationEvent(
  personalization: PersonalizationService | undefined,
  type: string,
  details: Record<string, string | number | boolean | string[]>
): Promise<void> {
  if (!personalization) {
    return;
  }

  await personalization.recordEvent(type, details);
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
 * Equivalent to `withParsedArgs`, but also runs a post-success side effect for
 * cases like personalization event logging.
 */
async function withParsedArgsAndEffect<TSchema extends z.ZodTypeAny, TResult>(
  schema: TSchema,
  args: unknown,
  handler: (input: z.infer<TSchema>) => Promise<TResult>,
  effect: (input: z.infer<TSchema>, result: TResult) => Promise<void>
) {
  try {
    const parsed = schema.parse(args);
    const result = await handler(parsed);
    await effect(parsed, result);
    return toolSuccess(result);
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
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
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
