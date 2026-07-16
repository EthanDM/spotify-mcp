import type { SpotifyClient } from "../lib/spotify.js";
import type { PlaylistSummary, TrackResult } from "../types.js";
import {
  createEmptyUseCasePreferences,
  PersonalizationStore
} from "./store.js";
import type {
  NamedCount,
  PlaylistEvaluationDetails,
  PersonalizationArtist,
  PersonalizationContextResult,
  PersonalizationEvent,
  PersonalizationFeedbackResult,
  PersonalizationPlaylistEvaluationResult,
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
    kind:
      | "artist"
      | "genre"
      | "trait"
      | "note"
      | "discovery_level"
      | "playback_mode"
      | "ideal_track_count_range";
    sentiment?: "prefer" | "avoid";
    value?: string;
    context?: string;
    use_case?: string;
    playback_mode?: "shuffle" | "ordered" | "either";
    min_count?: number;
    max_count?: number;
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
        value: input.value ?? null,
        context: input.context ?? null,
        use_case: input.use_case ?? null,
        playback_mode: input.playback_mode ?? null,
        min_count: input.min_count ?? null,
        max_count: input.max_count ?? null
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
   * Records a structured evaluation of a concrete playlist for a specific use case.
   */
  async recordPlaylistEvaluation(
    input: PlaylistEvaluationDetails
  ): Promise<PersonalizationPlaylistEvaluationResult> {
    await this.store.appendEvent({
      ts: new Date().toISOString(),
      type: "playlist_evaluation",
      details: {
        playlistId: input.playlistId,
        use_case: input.use_case,
        verdict: input.verdict,
        score: input.score ?? null,
        winning_traits: input.winning_traits,
        losing_traits: input.losing_traits ?? [],
        workflow_learning: input.workflow_learning ?? null
      }
    });

    const rebuilt = await this.rebuildContextFromStoredState();

    return {
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
    kind:
      | "artist"
      | "genre"
      | "trait"
      | "note"
      | "discovery_level"
      | "playback_mode"
      | "ideal_track_count_range";
    sentiment?: "prefer" | "avoid";
    value?: string;
    use_case?: string;
    playback_mode?: "shuffle" | "ordered" | "either";
    min_count?: number;
    max_count?: number;
  }
): PersonalizationPreferences {
  const updated: PersonalizationPreferences = {
    ...preferences,
    preferred_artists: [...preferences.preferred_artists],
    avoided_artists: [...preferences.avoided_artists],
    preferred_genres: [...preferences.preferred_genres],
    avoided_genres: [...preferences.avoided_genres],
    preferred_traits: [...preferences.preferred_traits],
    avoided_traits: [...preferences.avoided_traits],
    notes: [...preferences.notes],
    use_cases: Object.fromEntries(
      Object.entries(preferences.use_cases).map(([name, useCase]) => [
        name,
        {
          ...useCase,
          preferred_artists: [...useCase.preferred_artists],
          avoided_artists: [...useCase.avoided_artists],
          preferred_genres: [...useCase.preferred_genres],
          avoided_genres: [...useCase.avoided_genres],
          preferred_traits: [...useCase.preferred_traits],
          avoided_traits: [...useCase.avoided_traits],
          playback_mode: useCase.playback_mode,
          ideal_track_count_range: useCase.ideal_track_count_range
            ? { ...useCase.ideal_track_count_range }
            : null,
          notes: [...useCase.notes]
        }
      ])
    ),
    updated_at: new Date().toISOString()
  };
  const target = input.use_case
    ? (updated.use_cases[input.use_case] ??= {
        ...createEmptyUseCasePreferences(),
        updated_at: updated.updated_at
      })
    : updated;

  if (input.kind === "artist") {
    if (input.sentiment === "prefer") {
      pushUnique(target.preferred_artists, input.value ?? "");
      removeValue(target.avoided_artists, input.value ?? "");
    } else {
      pushUnique(target.avoided_artists, input.value ?? "");
      removeValue(target.preferred_artists, input.value ?? "");
    }
  } else if (input.kind === "genre") {
    if (input.sentiment === "prefer") {
      pushUnique(target.preferred_genres, input.value ?? "");
      removeValue(target.avoided_genres, input.value ?? "");
    } else {
      pushUnique(target.avoided_genres, input.value ?? "");
      removeValue(target.preferred_genres, input.value ?? "");
    }
  } else if (input.kind === "trait") {
    if (input.sentiment === "prefer") {
      pushUnique(target.preferred_traits, input.value ?? "");
      removeValue(target.avoided_traits, input.value ?? "");
    } else {
      pushUnique(target.avoided_traits, input.value ?? "");
      removeValue(target.preferred_traits, input.value ?? "");
    }
  } else if (input.kind === "discovery_level") {
    target.discovery_level = input.value as "low" | "medium" | "high";
  } else if (input.kind === "playback_mode") {
    if (input.use_case) {
      updated.use_cases[input.use_case].playback_mode =
        input.playback_mode ?? null;
    }
  } else if (input.kind === "ideal_track_count_range") {
    if (input.use_case) {
      updated.use_cases[input.use_case].ideal_track_count_range =
        typeof input.min_count === "number" &&
        typeof input.max_count === "number"
          ? {
              min: input.min_count,
              max: input.max_count
            }
          : null;
    }
  } else {
    pushUnique(target.notes, input.value ?? "");
  }

  if (input.use_case) {
    target.updated_at = updated.updated_at;
  }

  return updated;
}

function buildPersonalizationContext(input: {
  snapshot: PersonalizationSnapshot | null;
  preferences: PersonalizationPreferences;
  events: PersonalizationEvent[];
}): string {
  const eventStats = summarizeBehavior(input.events);
  const snapshotCoverage = input.snapshot
    ? calculateCoverageRatio(
        input.snapshot.saved_tracks.items.length,
        input.snapshot.saved_tracks.total_available
      )
    : null;
  const inferredArtists = input.snapshot
    ? inferArtists(input.snapshot, input.preferences)
    : [];
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
  const useCasePreferences = summarizeUseCasePreferences(input.preferences);
  if (useCasePreferences.length > 0) {
    lines.push("", "## Use-Case Preferences", ...useCasePreferences);
  }
  lines.push("", "## Weighted Signals");

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

    if (snapshotCoverage !== null) {
      lines.push(
        `- Saved-track sample coverage: ${Math.round(snapshotCoverage * 100)}% of the total liked-song library.`
      );

      if (snapshotCoverage < 0.5) {
        lines.push(
          "- Treat saved-track artist frequencies as weak evidence until a larger refresh sample or stronger behavioral feedback exists."
        );
      }
    }

    if (inferredArtists.length > 0) {
      lines.push(
        `- Stronger inferred artist signals: ${formatWeightedSignals(inferredArtists)}.`
      );
    } else {
      lines.push(
        "- No strong inferred artist signals yet beyond explicit preferences and recent behavior."
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

  lines.push("", "## Behavior-Derived Signals");
  lines.push(
    ...(eventStats.length > 0
      ? eventStats
      : [
          "- Not enough repeated MCP behavior yet to infer stable workflow preferences."
        ])
  );

  lines.push("", "## Guidance For Future Agents");
  lines.push(...buildGuidance(input, inferredArtists, snapshotCoverage));

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

  if (preferences.preferred_traits.length > 0) {
    lines.push(
      `- Preferred traits: ${preferences.preferred_traits.join(", ")}.`
    );
  }

  if (preferences.avoided_traits.length > 0) {
    lines.push(`- Avoid traits: ${preferences.avoided_traits.join(", ")}.`);
  }

  if (preferences.notes.length > 0) {
    lines.push(...preferences.notes.map((note) => `- Note: ${note}.`));
  }

  return lines;
}

function summarizeUseCasePreferences(
  preferences: PersonalizationPreferences
): string[] {
  return Object.entries(preferences.use_cases)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([useCase, scoped]) => {
      const parts: string[] = [];

      if (scoped.preferred_artists.length > 0) {
        parts.push(`prefer artists=${scoped.preferred_artists.join(", ")}`);
      }

      if (scoped.avoided_artists.length > 0) {
        parts.push(`avoid artists=${scoped.avoided_artists.join(", ")}`);
      }

      if (scoped.preferred_genres.length > 0) {
        parts.push(`prefer genres=${scoped.preferred_genres.join(", ")}`);
      }

      if (scoped.avoided_genres.length > 0) {
        parts.push(`avoid genres=${scoped.avoided_genres.join(", ")}`);
      }

      if (scoped.preferred_traits.length > 0) {
        parts.push(`prefer traits=${scoped.preferred_traits.join(", ")}`);
      }

      if (scoped.avoided_traits.length > 0) {
        parts.push(`avoid traits=${scoped.avoided_traits.join(", ")}`);
      }

      if (scoped.discovery_level) {
        parts.push(`discovery=${scoped.discovery_level}`);
      }

      if (scoped.playback_mode) {
        parts.push(`playback=${scoped.playback_mode}`);
      }

      if (scoped.ideal_track_count_range) {
        parts.push(
          `track_count=${scoped.ideal_track_count_range.min}-${scoped.ideal_track_count_range.max}`
        );
      }

      if (scoped.notes.length > 0) {
        parts.push(`notes=${scoped.notes.join(" | ")}`);
      }

      return `- ${useCase}: ${
        parts.length > 0 ? parts.join("; ") : "no scoped preferences yet"
      }.`;
    });
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

function buildGuidance(
  input: {
    snapshot: PersonalizationSnapshot | null;
    preferences: PersonalizationPreferences;
    events: PersonalizationEvent[];
  },
  inferredArtists: WeightedSignal[],
  snapshotCoverage: number | null
): string[] {
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

  if (input.preferences.preferred_traits.length > 0) {
    lines.push(
      `- Prefer global listening traits such as: ${input.preferences.preferred_traits.join(", ")}.`
    );
  }

  if (input.preferences.avoided_traits.length > 0) {
    lines.push(
      `- Avoid global listening traits such as: ${input.preferences.avoided_traits.join(", ")}.`
    );
  }

  for (const [useCase, scoped] of Object.entries(input.preferences.use_cases)) {
    const preferredTraits = scoped.preferred_traits.join(", ");
    const avoidedTraits = scoped.avoided_traits.join(", ");
    const scopedNotes = scoped.notes.join(" | ");
    const clauses = [
      preferredTraits ? `prefer ${preferredTraits}` : null,
      avoidedTraits ? `avoid ${avoidedTraits}` : null,
      scoped.playback_mode
        ? `default to ${scoped.playback_mode} playback`
        : null,
      scoped.ideal_track_count_range
        ? `target ${scoped.ideal_track_count_range.min}-${scoped.ideal_track_count_range.max} tracks`
        : null,
      scoped.discovery_level
        ? `start at ${scoped.discovery_level} discovery`
        : null,
      scopedNotes ? `remember ${scopedNotes}` : null
    ].filter(Boolean);

    if (clauses.length > 0) {
      lines.push(`- For use cases like "${useCase}", ${clauses.join("; ")}.`);
    }
  }

  if (
    inferredArtists.length > 0 &&
    input.preferences.preferred_artists.length === 0
  ) {
    lines.push(
      `- Use ${inferredArtists
        .slice(0, 3)
        .map((artist) => artist.name)
        .join(
          ", "
        )} as optional seed artists, but keep them below explicit user feedback in priority.`
    );
  }

  if (countEventsOfType(input.events, "playlist_deduped") >= 2) {
    lines.push(
      "- Repeated dedupe behavior suggests low tolerance for duplicates or repetitive sequencing."
    );
  }

  if (countEventsOfType(input.events, "playlist_items_removed") >= 2) {
    lines.push(
      "- Frequent remove actions suggest the user prefers iterative pruning after a first pass."
    );
  }

  if (countEventsOfType(input.events, "playlist_archived") >= 1) {
    lines.push(
      "- Recent archive actions suggest stale playlists should not be extended blindly."
    );
  }

  if (snapshotCoverage !== null && snapshotCoverage < 0.5) {
    lines.push(
      "- Because the liked-track snapshot is partial, prefer explicit feedback and observed MCP behavior over raw library artist counts."
    );
  }

  return lines;
}

type WeightedSignal = {
  name: string;
  score: number;
  reasons: string[];
};

function inferArtists(
  snapshot: PersonalizationSnapshot,
  preferences: PersonalizationPreferences
): WeightedSignal[] {
  const artistSignals = new Map<string, WeightedSignal>();
  const trackCoverage = calculateCoverageRatio(
    snapshot.saved_tracks.items.length,
    snapshot.saved_tracks.total_available
  );
  const safeCoverage = clamp(trackCoverage, 0.15, 1);

  for (const artist of preferences.preferred_artists) {
    upsertSignal(artistSignals, artist, 100, "explicit preferred artist");
  }

  for (const artist of preferences.avoided_artists) {
    upsertSignal(artistSignals, artist, -100, "explicit avoided artist");
  }

  for (const artist of snapshot.saved_tracks.top_artists) {
    if (artist.count < 4) {
      continue;
    }

    upsertSignal(
      artistSignals,
      artist.name,
      artist.count * safeCoverage * 1.5,
      `saved tracks (${artist.count})`
    );
  }

  for (const artist of snapshot.saved_albums.top_artists) {
    if (artist.count < 2) {
      continue;
    }

    upsertSignal(
      artistSignals,
      artist.name,
      artist.count * 1.25,
      `saved albums (${artist.count})`
    );
  }

  for (const artist of snapshot.followed_artists.items) {
    upsertSignal(artistSignals, artist.name, 2, "followed artist");
  }

  return Array.from(artistSignals.values())
    .filter((signal) => signal.score >= 4)
    .sort(
      (left, right) =>
        right.score - left.score || left.name.localeCompare(right.name)
    )
    .slice(0, 5);
}

function summarizeBehavior(events: PersonalizationEvent[]): string[] {
  const lines: string[] = [];
  const dedupeCount = countEventsOfType(events, "playlist_deduped");
  const removeCount = countEventsOfType(events, "playlist_items_removed");
  const mergeCount = countEventsOfType(events, "playlist_merged");
  const archiveCount = countEventsOfType(events, "playlist_archived");
  const feedbackCount = countEventsOfType(
    events,
    "personalization_feedback_recorded"
  );
  const playlistEvaluations = events.filter(
    (event) => event.type === "playlist_evaluation"
  );

  if (feedbackCount > 0) {
    lines.push(`- Explicit feedback events recorded: ${feedbackCount}.`);
  }

  if (dedupeCount > 0) {
    lines.push(
      `- Playlist dedupe actions: ${dedupeCount}${dedupeCount >= 2 ? " (strong repetition-avoidance signal)" : ""}.`
    );
  }

  if (removeCount > 0) {
    lines.push(
      `- Playlist remove actions: ${removeCount}${removeCount >= 2 ? " (suggests iterative pruning)" : ""}.`
    );
  }

  if (mergeCount > 0) {
    lines.push(
      `- Playlist merge actions: ${mergeCount}${mergeCount >= 2 ? " (user likely values recombining existing libraries)" : ""}.`
    );
  }

  if (archiveCount > 0) {
    lines.push(
      `- Playlist archive actions: ${archiveCount}${archiveCount >= 1 ? " (stale playlists are not sacred)" : ""}.`
    );
  }

  if (playlistEvaluations.length > 0) {
    lines.push(
      `- Playlist evaluations recorded: ${playlistEvaluations.length}.`
    );

    const latestDefault = [...playlistEvaluations]
      .reverse()
      .find((event) => event.details.verdict === "default");

    if (latestDefault) {
      const useCase = String(latestDefault.details.use_case);
      const winningTraits = Array.isArray(latestDefault.details.winning_traits)
        ? latestDefault.details.winning_traits.join(", ")
        : "";
      const workflowLearning =
        typeof latestDefault.details.workflow_learning === "string"
          ? latestDefault.details.workflow_learning
          : "";
      const parts = [
        winningTraits ? `winning traits: ${winningTraits}` : null,
        workflowLearning ? `workflow: ${workflowLearning}` : null
      ].filter(Boolean);

      lines.push(
        `- Latest default playlist evaluation for "${useCase}"${parts.length > 0 ? ` (${parts.join("; ")})` : ""}.`
      );
    }
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

function formatWeightedSignals(items: WeightedSignal[]): string {
  return items
    .map((item) => `${item.name} [${formatSignalStrength(item.score)}]`)
    .join(", ");
}

function calculateExplicitRatio(tracks: TrackResult[]): number | null {
  if (tracks.length === 0) {
    return null;
  }

  const explicitCount = tracks.filter((track) => track.explicit).length;
  return explicitCount / tracks.length;
}

function calculateCoverageRatio(captured: number, total: number): number {
  if (total <= 0) {
    return captured > 0 ? 1 : 0;
  }

  return captured / total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function upsertSignal(
  signals: Map<string, WeightedSignal>,
  name: string,
  scoreDelta: number,
  reason: string
): void {
  const existing = signals.get(name);

  if (existing) {
    existing.score += scoreDelta;
    if (!existing.reasons.includes(reason)) {
      existing.reasons.push(reason);
    }
    return;
  }

  signals.set(name, {
    name,
    score: scoreDelta,
    reasons: [reason]
  });
}

function formatSignalStrength(score: number): string {
  if (score >= 20) {
    return "strong";
  }

  if (score >= 8) {
    return "medium";
  }

  return "light";
}

function countEventsOfType(
  events: PersonalizationEvent[],
  type: string
): number {
  return events.filter((event) => event.type === type).length;
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
    preferences.preferred_traits.length === 0 &&
    preferences.avoided_traits.length === 0 &&
    preferences.discovery_level === null &&
    preferences.notes.length === 0 &&
    Object.keys(preferences.use_cases).length === 0
  );
}
