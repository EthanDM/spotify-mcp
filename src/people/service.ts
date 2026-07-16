import { getPersonArtifactsDirectoryPath } from "../config.js";
import { PeopleStore } from "./store.js";
import type {
  PersonPlaylistRecord,
  PersonPlaylistRecordResult,
  PersonProfile,
  PersonProfileContextResult,
  PersonProfileListResult,
  PersonProfileResult,
  PersonProfileSummary,
  PersonTasteReference
} from "./types.js";

type PersonTasteReferenceInput = {
  name: string;
  spotify_id?: string;
  spotify_uri?: string;
  url?: string;
  note?: string;
};

type ProfileUpsertInput = {
  name?: string;
  relationship?: string | null;
  age?: number | null;
  age_range?: string | null;
  life_context?: string[];
  preferred_artists?: string[];
  avoided_artists?: string[];
  preferred_genres?: string[];
  avoided_genres?: string[];
  preferred_traits?: string[];
  avoided_traits?: string[];
  reference_playlists?: PersonTasteReferenceInput[];
  reference_tracks?: PersonTasteReferenceInput[];
  reference_artists?: PersonTasteReferenceInput[];
  playlist_goals?: string[];
  notes?: string[];
};

/**
 * Coordinates saved listener profiles with generated context and playlist history.
 *
 * The service is intentionally manual-context-first. It does not infer profiles
 * from Spotify automatically; it just keeps reusable taste memory structured.
 */
export class PeopleProfileService {
  constructor(private readonly store: PeopleStore) {}

  /**
   * Creates a new durable person profile from explicit listener context.
   */
  async createProfile(
    input: ProfileUpsertInput & { name: string }
  ): Promise<PersonProfileResult> {
    const id = await this.allocateProfileId(input.name);
    const now = new Date().toISOString();
    const profile = normalizeProfile({
      id,
      name: input.name,
      relationship: input.relationship ?? null,
      age: input.age ?? null,
      age_range: input.age_range ?? null,
      created_at: now,
      updated_at: now,
      life_context: input.life_context ?? [],
      preferred_artists: input.preferred_artists ?? [],
      avoided_artists: input.avoided_artists ?? [],
      preferred_genres: input.preferred_genres ?? [],
      avoided_genres: input.avoided_genres ?? [],
      preferred_traits: input.preferred_traits ?? [],
      avoided_traits: input.avoided_traits ?? [],
      reference_playlists: normalizeReferenceInputs(
        input.reference_playlists ?? []
      ),
      reference_tracks: normalizeReferenceInputs(input.reference_tracks ?? []),
      reference_artists: normalizeReferenceInputs(
        input.reference_artists ?? []
      ),
      playlist_goals: input.playlist_goals ?? [],
      notes: input.notes ?? []
    });

    await this.store.writeProfile(profile);
    await this.rebuildContext(profile.id, profile, []);

    return this.buildProfileResult(profile, 0);
  }

  /**
   * Updates an existing saved person profile.
   *
   * Omitted fields are preserved so callers can adjust one dimension of the
   * profile without reconstructing the entire listener record.
   */
  async updateProfile(
    profileId: string,
    input: ProfileUpsertInput
  ): Promise<PersonProfileResult> {
    const existing = await this.requireProfile(profileId);
    const updated = normalizeProfile({
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.relationship !== undefined
        ? { relationship: input.relationship }
        : {}),
      ...(input.age !== undefined ? { age: input.age } : {}),
      ...(input.age_range !== undefined ? { age_range: input.age_range } : {}),
      ...(input.life_context !== undefined
        ? { life_context: input.life_context }
        : {}),
      ...(input.preferred_artists !== undefined
        ? { preferred_artists: input.preferred_artists }
        : {}),
      ...(input.avoided_artists !== undefined
        ? { avoided_artists: input.avoided_artists }
        : {}),
      ...(input.preferred_genres !== undefined
        ? { preferred_genres: input.preferred_genres }
        : {}),
      ...(input.avoided_genres !== undefined
        ? { avoided_genres: input.avoided_genres }
        : {}),
      ...(input.preferred_traits !== undefined
        ? { preferred_traits: input.preferred_traits }
        : {}),
      ...(input.avoided_traits !== undefined
        ? { avoided_traits: input.avoided_traits }
        : {}),
      ...(input.reference_playlists !== undefined
        ? {
            reference_playlists: normalizeReferenceInputs(
              input.reference_playlists
            )
          }
        : {}),
      ...(input.reference_tracks !== undefined
        ? { reference_tracks: normalizeReferenceInputs(input.reference_tracks) }
        : {}),
      ...(input.reference_artists !== undefined
        ? {
            reference_artists: normalizeReferenceInputs(input.reference_artists)
          }
        : {}),
      ...(input.playlist_goals !== undefined
        ? { playlist_goals: input.playlist_goals }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updated_at: new Date().toISOString()
    });

    await this.store.writeProfile(updated);
    const history = await this.store.readPlaylistHistory(profileId);
    await this.rebuildContext(profileId, updated, history);

    return this.buildProfileResult(updated, history.length);
  }

  /**
   * Returns all saved people profiles sorted by most recently updated.
   */
  async listProfiles(): Promise<PersonProfileListResult> {
    const profiles = await this.store.readAllProfiles();
    const items = await Promise.all(
      profiles.map(async (profile) => this.buildProfileSummary(profile))
    );
    items.sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at)
    );

    return {
      items,
      total: items.length
    };
  }

  /**
   * Returns one saved profile plus the paths future agents need to use it.
   */
  async getProfile(profileId: string): Promise<PersonProfileResult> {
    const profile = await this.requireProfile(profileId);
    const historyCount = await this.store.countPlaylistHistory(profileId);
    return this.buildProfileResult(profile, historyCount);
  }

  /**
   * Returns the compact summary future agents should use before playlist work.
   */
  async getProfileContext(
    profileId: string
  ): Promise<PersonProfileContextResult> {
    const existing = await this.store.readContext(profileId);

    if (existing) {
      return existing;
    }

    const profile = await this.requireProfile(profileId);
    const history = await this.store.readPlaylistHistory(profileId);
    return this.rebuildContext(profileId, profile, history);
  }

  /**
   * Records one small durable taste learning without requiring a full profile rewrite.
   */
  async recordFeedback(input: {
    profileId: string;
    kind:
      | "artist"
      | "genre"
      | "trait"
      | "note"
      | "life_context"
      | "playlist_goal";
    sentiment?: "prefer" | "avoid";
    value: string;
  }): Promise<PersonProfileResult> {
    const profile = await this.requireProfile(input.profileId);
    const updated = applyFeedback(profile, input);

    await this.store.writeProfile(updated);
    const history = await this.store.readPlaylistHistory(input.profileId);
    await this.rebuildContext(input.profileId, updated, history);

    return this.buildProfileResult(updated, history.length);
  }

  /**
   * Records one playlist output and its outcome against a saved person profile.
   */
  async recordPlaylist(input: {
    profileId: string;
    playlist_id?: string;
    playlist_name: string;
    playlist_url?: string;
    brief?: string;
    use_case?: string;
    track_count?: number;
    runtime_minutes?: number;
    score?: number;
    verdict?: "success" | "mixed" | "reject";
    winning_traits?: string[];
    losing_traits?: string[];
    workflow_learning?: string;
    artifact_paths?: string[];
    notes?: string[];
  }): Promise<PersonPlaylistRecordResult> {
    const profile = await this.requireProfile(input.profileId);
    const record = normalizePlaylistRecord({
      entry_id: buildPlaylistRecordId(),
      recorded_at: new Date().toISOString(),
      playlist_id: input.playlist_id ?? null,
      playlist_name: input.playlist_name,
      playlist_url: input.playlist_url ?? null,
      brief: input.brief ?? null,
      use_case: input.use_case ?? null,
      track_count: input.track_count ?? null,
      runtime_minutes: input.runtime_minutes ?? null,
      score: input.score ?? null,
      verdict: input.verdict ?? null,
      winning_traits: input.winning_traits ?? [],
      losing_traits: input.losing_traits ?? [],
      workflow_learning: input.workflow_learning ?? null,
      artifact_paths: input.artifact_paths ?? [],
      notes: input.notes ?? []
    });

    await this.store.appendPlaylistRecord(input.profileId, record);
    const history = await this.store.readPlaylistHistory(input.profileId);
    await this.rebuildContext(input.profileId, profile, history);

    return {
      profile_id: input.profileId,
      entry: record,
      playlist_history_count: history.length,
      playlist_history_path: this.store.getPlaylistHistoryPath(input.profileId),
      context_path: this.store.getContextPath(input.profileId),
      artifacts_directory_path: getPersonArtifactsDirectoryPath(
        input.profileId
      ),
      rebuilt_at: record.recorded_at
    };
  }

  private async allocateProfileId(name: string): Promise<string> {
    const base = slugifyName(name);
    let suffix = 1;
    let candidate = base;

    while (await this.store.profileExists(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    return candidate;
  }

  private async requireProfile(profileId: string): Promise<PersonProfile> {
    const profile = await this.store.readProfile(profileId);

    if (!profile) {
      throw new Error(`Unknown person profile: ${profileId}`);
    }

    return profile;
  }

  private async buildProfileSummary(
    profile: PersonProfile
  ): Promise<PersonProfileSummary> {
    return {
      id: profile.id,
      name: profile.name,
      relationship: profile.relationship,
      age: profile.age,
      age_range: profile.age_range,
      playlist_goals: profile.playlist_goals,
      updated_at: profile.updated_at,
      playlist_history_count: await this.store.countPlaylistHistory(profile.id)
    };
  }

  private async buildProfileResult(
    profile: PersonProfile,
    playlistHistoryCount?: number
  ): Promise<PersonProfileResult> {
    const historyCount =
      playlistHistoryCount ??
      (await this.store.countPlaylistHistory(profile.id));

    return {
      profile,
      profile_path: this.store.getProfilePath(profile.id),
      playlist_history_path: this.store.getPlaylistHistoryPath(profile.id),
      context_path: this.store.getContextPath(profile.id),
      artifacts_directory_path: getPersonArtifactsDirectoryPath(profile.id),
      playlist_history_count: historyCount
    };
  }

  private async rebuildContext(
    profileId: string,
    profile: PersonProfile,
    history: PersonPlaylistRecord[]
  ): Promise<PersonProfileContextResult> {
    const context = buildProfileContext(profile, history);
    await this.store.writeContext(profileId, context);

    return {
      profile_id: profileId,
      context,
      context_path: this.store.getContextPath(profileId),
      rebuilt_at: profile.updated_at
    };
  }
}

function applyFeedback(
  profile: PersonProfile,
  input: {
    kind:
      | "artist"
      | "genre"
      | "trait"
      | "note"
      | "life_context"
      | "playlist_goal";
    sentiment?: "prefer" | "avoid";
    value: string;
  }
): PersonProfile {
  const updated: PersonProfile = {
    ...profile,
    life_context: [...profile.life_context],
    preferred_artists: [...profile.preferred_artists],
    avoided_artists: [...profile.avoided_artists],
    preferred_genres: [...profile.preferred_genres],
    avoided_genres: [...profile.avoided_genres],
    preferred_traits: [...profile.preferred_traits],
    avoided_traits: [...profile.avoided_traits],
    reference_playlists: [...profile.reference_playlists],
    reference_tracks: [...profile.reference_tracks],
    reference_artists: [...profile.reference_artists],
    playlist_goals: [...profile.playlist_goals],
    notes: [...profile.notes],
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
  } else if (input.kind === "trait") {
    if (input.sentiment === "prefer") {
      pushUnique(updated.preferred_traits, input.value);
      removeValue(updated.avoided_traits, input.value);
    } else {
      pushUnique(updated.avoided_traits, input.value);
      removeValue(updated.preferred_traits, input.value);
    }
  } else if (input.kind === "life_context") {
    pushUnique(updated.life_context, input.value);
  } else if (input.kind === "playlist_goal") {
    pushUnique(updated.playlist_goals, input.value);
  } else {
    pushUnique(updated.notes, input.value);
  }

  return normalizeProfile(updated);
}

function buildProfileContext(
  profile: PersonProfile,
  history: PersonPlaylistRecord[]
): string {
  const lines = [
    "# Spotify Person Profile Context",
    "",
    `Rebuilt: ${new Date().toISOString()}`,
    "",
    "## Listener",
    `- Name: ${profile.name}.`
  ];

  if (profile.relationship) {
    lines.push(`- Relationship: ${profile.relationship}.`);
  }
  if (typeof profile.age === "number") {
    lines.push(`- Age: ${profile.age}.`);
  } else if (profile.age_range) {
    lines.push(`- Age range: ${profile.age_range}.`);
  }

  lines.push("", "## Stable Context");
  lines.push(
    ...(profile.life_context.length > 0
      ? [`- Life context: ${profile.life_context.join("; ")}.`]
      : ["- No life-context constraints recorded yet."])
  );
  if (profile.notes.length > 0) {
    lines.push(`- Notes: ${profile.notes.join("; ")}.`);
  }

  lines.push("", "## Taste Cues");
  pushPreferenceLine(lines, "Preferred artists", profile.preferred_artists);
  pushPreferenceLine(lines, "Avoided artists", profile.avoided_artists);
  pushPreferenceLine(lines, "Preferred genres", profile.preferred_genres);
  pushPreferenceLine(lines, "Avoided genres", profile.avoided_genres);
  pushPreferenceLine(lines, "Preferred traits", profile.preferred_traits);
  pushPreferenceLine(lines, "Avoided traits", profile.avoided_traits);

  lines.push("", "## Reference Signals");
  pushReferenceLine(lines, "Reference playlists", profile.reference_playlists);
  pushReferenceLine(lines, "Reference tracks", profile.reference_tracks);
  pushReferenceLine(lines, "Reference artists", profile.reference_artists);

  lines.push("", "## Playlist Goals");
  lines.push(
    ...(profile.playlist_goals.length > 0
      ? [`- Goals: ${profile.playlist_goals.join("; ")}.`]
      : ["- No playlist goals recorded yet."])
  );

  lines.push("", "## Playlist History");
  if (history.length === 0) {
    lines.push("- No playlists recorded for this profile yet.");
    return lines.join("\n");
  }

  lines.push(`- Recorded playlists: ${history.length}.`);

  const latest = history.at(-1);
  if (latest) {
    const parts = [
      latest.playlist_name,
      latest.use_case ? `use_case=${latest.use_case}` : null,
      typeof latest.score === "number" ? `score=${latest.score}` : null,
      latest.verdict ? `verdict=${latest.verdict}` : null,
      typeof latest.track_count === "number"
        ? `track_count=${latest.track_count}`
        : null,
      typeof latest.runtime_minutes === "number"
        ? `runtime=${latest.runtime_minutes}m`
        : null
    ].filter(Boolean);
    lines.push(`- Latest playlist: ${parts.join("; ")}.`);
  }

  const winningTraits = countTopNames(
    history.flatMap((entry) => entry.winning_traits)
  );
  const losingTraits = countTopNames(
    history.flatMap((entry) => entry.losing_traits)
  );
  const workflowLearnings = uniqueValues(
    history
      .map((entry) => entry.workflow_learning)
      .filter((value): value is string => Boolean(value))
  );

  if (winningTraits.length > 0) {
    lines.push(
      `- Repeated winning traits: ${formatNamedCounts(winningTraits)}.`
    );
  }
  if (losingTraits.length > 0) {
    lines.push(`- Repeated losing traits: ${formatNamedCounts(losingTraits)}.`);
  }
  if (workflowLearnings.length > 0) {
    lines.push(`- Workflow learnings: ${workflowLearnings.join("; ")}.`);
  }

  return lines.join("\n");
}

function pushPreferenceLine(
  lines: string[],
  label: string,
  values: string[]
): void {
  if (values.length > 0) {
    lines.push(`- ${label}: ${values.join(", ")}.`);
  }
}

function pushReferenceLine(
  lines: string[],
  label: string,
  references: PersonTasteReference[]
): void {
  if (references.length === 0) {
    return;
  }

  const formatted = references.map((reference) => {
    const parts = [
      reference.name,
      reference.spotify_id ? `spotify_id=${reference.spotify_id}` : null,
      reference.url ? `url=${reference.url}` : null,
      reference.note ? `note=${reference.note}` : null
    ].filter(Boolean);
    return parts.join(" | ");
  });

  lines.push(`- ${label}: ${formatted.join("; ")}.`);
}

function countTopNames(
  values: string[]
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  for (const value of values.map(normalizeTextValue).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    )
    .slice(0, 5);
}

function formatNamedCounts(
  values: Array<{ name: string; count: number }>
): string {
  return values.map((value) => `${value.name} (${value.count})`).join(", ");
}

function normalizeProfile(profile: PersonProfile): PersonProfile {
  return {
    ...profile,
    name: normalizeRequiredString(profile.name, "name"),
    relationship: normalizeNullableString(profile.relationship),
    age: typeof profile.age === "number" ? profile.age : null,
    age_range: normalizeNullableString(profile.age_range),
    life_context: uniqueValues(profile.life_context),
    preferred_artists: uniqueValues(profile.preferred_artists),
    avoided_artists: uniqueValues(profile.avoided_artists),
    preferred_genres: uniqueValues(profile.preferred_genres),
    avoided_genres: uniqueValues(profile.avoided_genres),
    preferred_traits: uniqueValues(profile.preferred_traits),
    avoided_traits: uniqueValues(profile.avoided_traits),
    reference_playlists: uniqueReferences(profile.reference_playlists),
    reference_tracks: uniqueReferences(profile.reference_tracks),
    reference_artists: uniqueReferences(profile.reference_artists),
    playlist_goals: uniqueValues(profile.playlist_goals),
    notes: uniqueValues(profile.notes)
  };
}

function normalizePlaylistRecord(
  record: PersonPlaylistRecord
): PersonPlaylistRecord {
  return {
    ...record,
    playlist_name: normalizeRequiredString(
      record.playlist_name,
      "playlist_name"
    ),
    playlist_id: normalizeNullableString(record.playlist_id),
    playlist_url: normalizeNullableString(record.playlist_url),
    brief: normalizeNullableString(record.brief),
    use_case: normalizeNullableString(record.use_case),
    workflow_learning: normalizeNullableString(record.workflow_learning),
    winning_traits: uniqueValues(record.winning_traits),
    losing_traits: uniqueValues(record.losing_traits),
    artifact_paths: uniqueValues(record.artifact_paths),
    notes: uniqueValues(record.notes)
  };
}

function uniqueReferences(
  references: PersonTasteReference[]
): PersonTasteReference[] {
  const seen = new Set<string>();
  const output: PersonTasteReference[] = [];

  for (const reference of references) {
    const normalized: PersonTasteReference = {
      name: normalizeRequiredString(reference.name, "reference.name"),
      spotify_id: normalizeNullableString(reference.spotify_id),
      spotify_uri: normalizeNullableString(reference.spotify_uri),
      url: normalizeNullableString(reference.url),
      note: normalizeNullableString(reference.note)
    };
    const key = JSON.stringify(normalized);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function normalizeReferenceInputs(
  references: PersonTasteReferenceInput[]
): PersonTasteReference[] {
  return references.map((reference) => ({
    name: reference.name,
    spotify_id: reference.spotify_id ?? null,
    spotify_uri: reference.spotify_uri ?? null,
    url: reference.url ?? null,
    note: reference.note ?? null
  }));
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeTextValue(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function normalizeTextValue(value: string): string {
  return value.trim();
}

function normalizeRequiredString(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Missing required ${field}.`);
  }

  return normalized;
}

function normalizeNullableString(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function pushUnique(values: string[], value: string): void {
  const normalized = normalizeTextValue(value);

  if (!normalized || values.includes(normalized)) {
    return;
  }

  values.push(normalized);
}

function removeValue(values: string[], value: string): void {
  const normalized = normalizeTextValue(value);
  const index = values.indexOf(normalized);

  if (index >= 0) {
    values.splice(index, 1);
  }
}

function buildPlaylistRecordId(): string {
  return `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "person";
}
