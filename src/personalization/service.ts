import type { SpotifyClient } from "../lib/spotify.js";
import type { PlaylistSummary, TrackResult } from "../types.js";
import { PersonalizationStore } from "./store.js";
import type {
  NamedCount,
  PersonalizationArtist,
  PersonalizationContextResult,
  PersonalizationEvent,
  PersonalizationFeedbackResult,
  PersonalizationPreferences,
  PersonalizationRefreshResult,
  PersonalizationSavedAlbum,
  PersonalizationSavedTrack,
  PersonalizationSnapshot,
  PersonalizationStateResult
} from "./types.js";

/**
 * Coordinates refreshable Spotify-derived taste state with explicit
 * user-maintained preferences and append-only interaction history.
 */
export class PersonalizationService {
  constructor(
    private readonly spotify: SpotifyClient,
    private readonly store: PersonalizationStore
  ) {}

  /**
   * Rebuilds the Spotify-derived snapshot and agent-facing context summary.
   *
   * Refreshes intentionally cap each source so the local summary stays compact
   * and quick to rebuild, even for users with large libraries.
   */
  async refreshState(input: {
    playlistLimit: number;
    savedTracksLimit: number;
    savedAlbumsLimit: number;
    followedArtistsLimit: number;
  }): Promise<PersonalizationRefreshResult> {
    const [profile, playlists, savedTracks, savedAlbums, followedArtists] =
      await Promise.all([
        this.spotify.getMyProfile(),
        this.collectPlaylists(input.playlistLimit),
        this.collectSavedTracks(input.savedTracksLimit),
        this.collectSavedAlbums(input.savedAlbumsLimit),
        this.collectFollowedArtists(input.followedArtistsLimit)
      ]);

    const snapshot: PersonalizationSnapshot = {
      refreshed_at: new Date().toISOString(),
      profile,
      playlists: {
        total_available: playlists.totalAvailable,
        owned_count: playlists.items.filter(
          (playlist) => playlist.owner.id === profile.id
        ).length,
        followed_count: playlists.items.filter(
          (playlist) => playlist.owner.id !== profile.id
        ).length,
        items: playlists.items
      },
      saved_tracks: {
        total_available: savedTracks.totalAvailable,
        items: savedTracks.items,
        top_artists: countTopNames(
          savedTracks.items.flatMap((item) => item.track.artists)
        ),
        explicit_ratio: calculateExplicitRatio(
          savedTracks.items.map((item) => item.track)
        )
      },
      saved_albums: {
        total_available: savedAlbums.totalAvailable,
        items: savedAlbums.items,
        top_artists: countTopNames(
          savedAlbums.items.flatMap((item) => item.artists)
        )
      },
      followed_artists: {
        fetched_count: followedArtists.items.length,
        has_more: followedArtists.hasMore,
        items: followedArtists.items,
        top_genres: countTopNames(
          followedArtists.items.flatMap((artist) => artist.genres)
        )
      }
    };

    await this.store.writeSnapshot(snapshot);
    await this.store.appendEvent({
      ts: new Date().toISOString(),
      type: "personalization_refreshed",
      details: {
        playlist_count: snapshot.playlists.items.length,
        saved_track_count: snapshot.saved_tracks.items.length,
        saved_album_count: snapshot.saved_albums.items.length,
        followed_artist_count: snapshot.followed_artists.items.length
      }
    });

    await this.rebuildContextFromStoredState(snapshot);

    return {
      refreshed_at: snapshot.refreshed_at,
      snapshot_path: this.store.snapshotPath,
      context_path: this.store.contextPath,
      playlist_count: snapshot.playlists.items.length,
      saved_track_count: snapshot.saved_tracks.items.length,
      saved_album_count: snapshot.saved_albums.items.length,
      followed_artist_count: snapshot.followed_artists.items.length
    };
  }

  /**
   * Returns the current agent-facing summary, rebuilding it on demand when possible.
   */
  async getContext(): Promise<PersonalizationContextResult> {
    const existing = await this.store.readContext();

    if (existing) {
      return existing;
    }

    const rebuilt = await this.rebuildContextFromStoredState();

    if (rebuilt) {
      return rebuilt;
    }

    const emptyContext = buildPersonalizationContext({
      snapshot: null,
      preferences: await this.store.readPreferences(),
      events: []
    });
    await this.store.writeContext(emptyContext);

    return {
      context: emptyContext,
      context_path: this.store.contextPath,
      rebuilt_at: null
    };
  }

  /**
   * Returns a compact inspectable view of the current personalization files.
   */
  async getState(input: {
    recentEventLimit: number;
  }): Promise<PersonalizationStateResult> {
    const [snapshot, preferences, recentEvents, eventCount, context] =
      await Promise.all([
        this.store.readSnapshot(),
        this.store.readPreferences(),
        this.store.readRecentEvents(input.recentEventLimit),
        this.store.countEvents(),
        this.store.readContext()
      ]);

    return {
      snapshot_path: this.store.snapshotPath,
      preferences_path: this.store.preferencesPath,
      interaction_log_path: this.store.interactionLogPath,
      context_path: this.store.contextPath,
      snapshot,
      preferences,
      interaction_event_count: eventCount,
      recent_events: recentEvents,
      context: context?.context ?? null
    };
  }

  /**
   * Records explicit taste feedback and rebuilds the compact context summary.
   */
  async recordFeedback(input: {
    kind: "artist" | "genre" | "note" | "discovery_level";
    sentiment?: "prefer" | "avoid";
    value: string;
    context?: string;
  }): Promise<PersonalizationFeedbackResult> {
    const preferences = await this.store.readPreferences();
    const updated = applyFeedback(preferences, input);

    await this.store.writePreferences(updated);
    await this.store.appendEvent({
      ts: new Date().toISOString(),
      type: "personalization_feedback_recorded",
      details: {
        kind: input.kind,
        sentiment: input.sentiment ?? null,
        value: input.value,
        context: input.context ?? null
      }
    });

    const rebuilt = await this.rebuildContextFromStoredState();

    return {
      preferences: updated,
      context_path: this.store.contextPath,
      rebuilt_at: rebuilt?.rebuilt_at ?? null
    };
  }

  /**
   * Appends an interaction event so later agents can see how this MCP was used.
   *
   * This does not talk to Spotify. It only updates local state and refreshes the
   * compact summary so recent behavior becomes available to future agents.
   */
  async recordEvent(
    type: string,
    details: PersonalizationEvent["details"]
  ): Promise<void> {
    await this.store.appendEvent({
      ts: new Date().toISOString(),
      type,
      details
    });
    await this.rebuildContextFromStoredState();
  }

  /**
   * Rebuilds the context summary from whatever local state is currently available.
   */
  private async rebuildContextFromStoredState(
    snapshotOverride?: PersonalizationSnapshot
  ): Promise<PersonalizationContextResult | null> {
    const [snapshot, preferences, events] = await Promise.all([
      snapshotOverride
        ? Promise.resolve(snapshotOverride)
        : this.store.readSnapshot(),
      this.store.readPreferences(),
      this.store.readRecentEvents(50)
    ]);

    if (!snapshot && events.length === 0 && isPreferencesEmpty(preferences)) {
      return null;
    }

    const context = buildPersonalizationContext({
      snapshot,
      preferences,
      events
    });

    await this.store.writeContext(context);

    return {
      context,
      context_path: this.store.contextPath,
      rebuilt_at: snapshot?.refreshed_at ?? null
    };
  }

  private async collectPlaylists(limitTotal: number): Promise<{
    totalAvailable: number;
    items: PlaylistSummary[];
  }> {
    const items: PlaylistSummary[] = [];
    let offset = 0;
    let totalAvailable = 0;

    while (items.length < limitTotal) {
      const limit = Math.min(50, limitTotal - items.length);
      const page = await this.spotify.listPlaylists(limit, offset);

      totalAvailable = page.total;
      items.push(...page.items);

      if (page.next_offset === null) {
        break;
      }

      offset = page.next_offset;
    }

    return {
      totalAvailable,
      items
    };
  }

  private async collectSavedTracks(limitTotal: number): Promise<{
    totalAvailable: number;
    items: PersonalizationSavedTrack[];
  }> {
    const items: PersonalizationSavedTrack[] = [];
    let offset = 0;
    let totalAvailable = 0;

    while (items.length < limitTotal) {
      const limit = Math.min(50, limitTotal - items.length);
      const page = await this.spotify.getSavedTracks(limit, offset);

      totalAvailable = page.total;
      items.push(...page.items);

      if (page.next_offset === null) {
        break;
      }

      offset = page.next_offset;
    }

    return {
      totalAvailable,
      items
    };
  }

  private async collectSavedAlbums(limitTotal: number): Promise<{
    totalAvailable: number;
    items: PersonalizationSavedAlbum[];
  }> {
    const items: PersonalizationSavedAlbum[] = [];
    let offset = 0;
    let totalAvailable = 0;

    while (items.length < limitTotal) {
      const limit = Math.min(50, limitTotal - items.length);
      const page = await this.spotify.getSavedAlbums(limit, offset);

      totalAvailable = page.total;
      items.push(...page.items);

      if (page.next_offset === null) {
        break;
      }

      offset = page.next_offset;
    }

    return {
      totalAvailable,
      items
    };
  }

  private async collectFollowedArtists(limitTotal: number): Promise<{
    hasMore: boolean;
    items: PersonalizationArtist[];
  }> {
    const items: PersonalizationArtist[] = [];
    let after: string | undefined;
    let hasMore = false;

    while (items.length < limitTotal) {
      const limit = Math.min(50, limitTotal - items.length);
      const page = await this.spotify.getFollowedArtists(limit, after);

      items.push(...page.items);
      hasMore = page.next_after !== null;

      if (page.next_after === null) {
        break;
      }

      after = page.next_after;
    }

    return {
      hasMore,
      items
    };
  }
}

function applyFeedback(
  preferences: PersonalizationPreferences,
  input: {
    kind: "artist" | "genre" | "note" | "discovery_level";
    sentiment?: "prefer" | "avoid";
    value: string;
  }
): PersonalizationPreferences {
  const updated: PersonalizationPreferences = {
    ...preferences,
    preferred_artists: [...preferences.preferred_artists],
    avoided_artists: [...preferences.avoided_artists],
    preferred_genres: [...preferences.preferred_genres],
    avoided_genres: [...preferences.avoided_genres],
    notes: [...preferences.notes],
    updated_at: new Date().toISOString()
  };

  if (input.kind === "artist") {
    if (input.sentiment === "prefer") {
      pushUnique(updated.preferred_artists, input.value);
      removeValue(updated.avoided_artists, input.value);
    } else {
      pushUnique(updated.avoided_artists, input.value);
      removeValue(updated.preferred_artists, input.value);
    }
  } else if (input.kind === "genre") {
    if (input.sentiment === "prefer") {
      pushUnique(updated.preferred_genres, input.value);
      removeValue(updated.avoided_genres, input.value);
    } else {
      pushUnique(updated.avoided_genres, input.value);
      removeValue(updated.preferred_genres, input.value);
    }
  } else if (input.kind === "discovery_level") {
    updated.discovery_level = input.value as "low" | "medium" | "high";
  } else {
    pushUnique(updated.notes, input.value);
  }

  return updated;
}

function buildPersonalizationContext(input: {
  snapshot: PersonalizationSnapshot | null;
  preferences: PersonalizationPreferences;
  events: PersonalizationEvent[];
}): string {
  const lines = [
    "# Spotify Personalization Context",
    "",
    `Rebuilt: ${new Date().toISOString()}`,
    "",
    "## Stable Preferences"
  ];

  const stablePreferences = summarizePreferences(input.preferences);
  lines.push(
    ...(stablePreferences.length > 0
      ? stablePreferences
      : ["- None recorded yet."])
  );
  lines.push("", "## Library Snapshot");

  if (!input.snapshot) {
    lines.push("- No Spotify-derived snapshot has been refreshed yet.");
  } else {
    lines.push(
      `- Snapshot refreshed at ${input.snapshot.refreshed_at}.`,
      `- Saved tracks captured: ${input.snapshot.saved_tracks.items.length} of ${input.snapshot.saved_tracks.total_available}.`,
      `- Saved albums captured: ${input.snapshot.saved_albums.items.length} of ${input.snapshot.saved_albums.total_available}.`,
      `- Playlists captured: ${input.snapshot.playlists.items.length} of ${input.snapshot.playlists.total_available}.`,
      `- Owned playlists: ${input.snapshot.playlists.owned_count}. Followed playlists: ${input.snapshot.playlists.followed_count}.`,
      `- Followed artists captured: ${input.snapshot.followed_artists.items.length}${input.snapshot.followed_artists.has_more ? "+" : ""}.`
    );

    const topTrackArtists = formatNamedCounts(
      input.snapshot.saved_tracks.top_artists
    );
    if (topTrackArtists) {
      lines.push(`- Top artists across saved tracks: ${topTrackArtists}.`);
    }

    const topAlbumArtists = formatNamedCounts(
      input.snapshot.saved_albums.top_artists
    );
    if (topAlbumArtists) {
      lines.push(`- Top artists across saved albums: ${topAlbumArtists}.`);
    }

    const topGenres = formatNamedCounts(
      input.snapshot.followed_artists.top_genres
    );
    if (topGenres) {
      lines.push(`- Followed-artist genre concentration: ${topGenres}.`);
    }

    if (typeof input.snapshot.saved_tracks.explicit_ratio === "number") {
      lines.push(
        `- Saved-track explicit ratio: ${Math.round(
          input.snapshot.saved_tracks.explicit_ratio * 100
        )}%.`
      );
    }
  }

  lines.push("", "## Recent MCP Interaction Patterns");
  const eventSummary = summarizeEvents(input.events);
  lines.push(
    ...(eventSummary.length > 0
      ? eventSummary
      : ["- No recorded MCP interaction history yet."])
  );

  lines.push("", "## Guidance For Future Agents");
  lines.push(...buildGuidance(input));

  return lines.join("\n");
}

function summarizePreferences(
  preferences: PersonalizationPreferences
): string[] {
  const lines: string[] = [];

  if (preferences.discovery_level) {
    lines.push(`- Discovery level: ${preferences.discovery_level}.`);
  }

  if (preferences.preferred_artists.length > 0) {
    lines.push(
      `- Preferred artists: ${preferences.preferred_artists.join(", ")}.`
    );
  }

  if (preferences.avoided_artists.length > 0) {
    lines.push(`- Avoid artists: ${preferences.avoided_artists.join(", ")}.`);
  }

  if (preferences.preferred_genres.length > 0) {
    lines.push(
      `- Preferred genres: ${preferences.preferred_genres.join(", ")}.`
    );
  }

  if (preferences.avoided_genres.length > 0) {
    lines.push(`- Avoid genres: ${preferences.avoided_genres.join(", ")}.`);
  }

  if (preferences.notes.length > 0) {
    lines.push(...preferences.notes.map((note) => `- Note: ${note}.`));
  }

  return lines;
}

function summarizeEvents(events: PersonalizationEvent[]): string[] {
  if (events.length === 0) {
    return [];
  }

  return events
    .slice(-10)
    .reverse()
    .map((event) => {
      const detailPairs = Object.entries(event.details)
        .filter(([, value]) => value !== null && value !== "")
        .map(
          ([key, value]) =>
            `${key}=${Array.isArray(value) ? value.join("|") : String(value)}`
        );

      return `- ${event.ts}: ${event.type}${
        detailPairs.length > 0 ? ` (${detailPairs.join(", ")})` : ""
      }.`;
    });
}

function buildGuidance(input: {
  snapshot: PersonalizationSnapshot | null;
  preferences: PersonalizationPreferences;
  events: PersonalizationEvent[];
}): string[] {
  const lines: string[] = [];

  if (input.preferences.discovery_level) {
    lines.push(
      `- Start recommendations at ${input.preferences.discovery_level} discovery unless the user asks otherwise.`
    );
  } else {
    lines.push(
      "- Start with moderate discovery and narrow the set based on explicit feedback."
    );
  }

  if (input.preferences.preferred_artists.length > 0) {
    lines.push(
      `- Bias toward artists with explicit positive preference signals: ${input.preferences.preferred_artists.join(", ")}.`
    );
  }

  if (input.preferences.avoided_artists.length > 0) {
    lines.push(
      `- Avoid artists with explicit negative preference signals: ${input.preferences.avoided_artists.join(", ")}.`
    );
  }

  if (
    input.snapshot &&
    input.snapshot.saved_tracks.top_artists.length > 0 &&
    input.preferences.preferred_artists.length === 0
  ) {
    lines.push(
      `- Saved-track history suggests recurring affinity for ${input.snapshot.saved_tracks.top_artists
        .slice(0, 3)
        .map((artist) => artist.name)
        .join(", ")}.`
    );
  }

  if (input.events.some((event) => event.type === "playlist_deduped")) {
    lines.push(
      "- Recent usage suggests low tolerance for duplicates or repetitive sequencing."
    );
  }

  if (input.events.some((event) => event.type === "playlist_archived")) {
    lines.push(
      "- Recent archive actions suggest stale playlists should not be extended blindly."
    );
  }

  return lines;
}

function countTopNames(values: string[]): NamedCount[] {
  const counts = new Map<string, number>();

  for (const value of values.map((value) => value.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .slice(0, 10)
    .map(([name, count]) => ({
      name,
      count
    }));
}

function formatNamedCounts(items: NamedCount[]): string | null {
  if (items.length === 0) {
    return null;
  }

  return items
    .slice(0, 5)
    .map((item) => `${item.name} (${item.count})`)
    .join(", ");
}

function calculateExplicitRatio(tracks: TrackResult[]): number | null {
  if (tracks.length === 0) {
    return null;
  }

  const explicitCount = tracks.filter((track) => track.explicit).length;
  return explicitCount / tracks.length;
}

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function removeValue(items: string[], value: string): void {
  const index = items.indexOf(value);

  if (index >= 0) {
    items.splice(index, 1);
  }
}

function isPreferencesEmpty(preferences: PersonalizationPreferences): boolean {
  return (
    preferences.preferred_artists.length === 0 &&
    preferences.avoided_artists.length === 0 &&
    preferences.preferred_genres.length === 0 &&
    preferences.avoided_genres.length === 0 &&
    preferences.discovery_level === null &&
    preferences.notes.length === 0
  );
}
