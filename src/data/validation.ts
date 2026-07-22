import type {
  PersonPlaylistRecord,
  PersonProfile,
  PersonTasteReference
} from "../people/types.js";
import type {
  PersonalizationEvent,
  PersonalizationPreferences,
  PersonalizationUseCasePreferences
} from "../personalization/types.js";

export function validatePersonalizationEventDocument(
  value: unknown
): PersonalizationEvent {
  const event = requireObject(value, "personalization event");
  requireString(event.ts, "personalization event.ts");
  requireString(event.type, "personalization event.type");
  requireObject(event.details, "personalization event.details");
  if (event.event_id !== undefined)
    requireString(event.event_id, "personalization event.event_id");
  if (event.machine_id !== undefined)
    requireString(event.machine_id, "personalization event.machine_id");
  if (event.schema_version !== undefined && event.schema_version !== 1)
    throw new Error("personalization event.schema_version must be 1.");
  return value as PersonalizationEvent;
}

export function validatePersonPlaylistRecordDocument(
  value: unknown
): PersonPlaylistRecord {
  const record = requireObject(value, "playlist history record");
  for (const field of ["entry_id", "recorded_at", "playlist_name"])
    requireString(record[field], `playlist history record.${field}`);
  for (const field of [
    "playlist_id",
    "playlist_url",
    "brief",
    "use_case",
    "workflow_learning"
  ])
    requireNullableString(record[field], `playlist history record.${field}`);
  for (const field of ["track_count", "runtime_minutes", "score"])
    requireNullableNumber(record[field], `playlist history record.${field}`);
  if (
    record.verdict !== null &&
    !["success", "mixed", "reject"].includes(String(record.verdict))
  )
    throw new Error("playlist history record.verdict is invalid.");
  for (const field of [
    "winning_traits",
    "losing_traits",
    "artifact_paths",
    "notes"
  ])
    requireStringArray(record[field], `playlist history record.${field}`);
  return value as PersonPlaylistRecord;
}

export function validatePreferencesDocument(
  value: unknown
): PersonalizationPreferences {
  const document = requireObject(value, "preferences");
  for (const field of [
    "preferred_artists",
    "avoided_artists",
    "preferred_genres",
    "avoided_genres",
    "preferred_traits",
    "avoided_traits",
    "notes"
  ]) {
    requireStringArray(document[field], `preferences.${field}`);
  }
  if (
    document.discovery_level !== null &&
    !["low", "medium", "high"].includes(String(document.discovery_level))
  )
    throw new Error("preferences.discovery_level is invalid.");
  requireNullableString(document.updated_at, "preferences.updated_at");
  const useCases = requireObject(document.use_cases, "preferences.use_cases");
  for (const [name, useCase] of Object.entries(useCases))
    validateUseCase(useCase, `preferences.use_cases.${name}`);
  return value as PersonalizationPreferences;
}

export function validatePersonProfileDocument(
  value: unknown,
  expectedId: string
): PersonProfile {
  const document = requireObject(value, "person profile");
  if (document.id !== expectedId)
    throw new Error(`Person profile id must be ${expectedId}.`);
  for (const field of ["name", "created_at", "updated_at"])
    requireString(document[field], `person profile.${field}`);
  requireNullableString(document.relationship, "person profile.relationship");
  if (document.age !== null && typeof document.age !== "number")
    throw new Error("person profile.age must be a number or null.");
  requireNullableString(document.age_range, "person profile.age_range");
  for (const field of [
    "life_context",
    "preferred_artists",
    "avoided_artists",
    "preferred_genres",
    "avoided_genres",
    "preferred_traits",
    "avoided_traits",
    "playlist_goals",
    "notes"
  ]) {
    requireStringArray(document[field], `person profile.${field}`);
  }
  for (const field of [
    "reference_playlists",
    "reference_tracks",
    "reference_artists"
  ]) {
    if (!Array.isArray(document[field]))
      throw new Error(`person profile.${field} must be an array.`);
    document[field].forEach((reference, index) =>
      validateReference(reference, `person profile.${field}[${index}]`)
    );
  }
  return value as PersonProfile;
}

function validateUseCase(value: unknown, label: string): void {
  const useCase = requireObject(
    value,
    label
  ) as PersonalizationUseCasePreferences;
  for (const field of [
    "preferred_artists",
    "avoided_artists",
    "preferred_genres",
    "avoided_genres",
    "preferred_traits",
    "avoided_traits",
    "notes"
  ])
    requireStringArray(
      useCase[field as keyof PersonalizationUseCasePreferences],
      `${label}.${field}`
    );
  if (
    useCase.playback_mode !== null &&
    !["shuffle", "ordered", "either"].includes(String(useCase.playback_mode))
  )
    throw new Error(`${label}.playback_mode is invalid.`);
  if (
    useCase.discovery_level !== null &&
    !["low", "medium", "high"].includes(String(useCase.discovery_level))
  )
    throw new Error(`${label}.discovery_level is invalid.`);
  requireNullableString(useCase.updated_at, `${label}.updated_at`);
  if (useCase.ideal_track_count_range !== null) {
    const range = requireObject(
      useCase.ideal_track_count_range,
      `${label}.ideal_track_count_range`
    );
    if (typeof range.min !== "number" || typeof range.max !== "number")
      throw new Error(
        `${label}.ideal_track_count_range must contain numeric min and max.`
      );
  }
}

function validateReference(value: unknown, label: string): void {
  const reference = requireObject(value, label) as PersonTasteReference;
  requireString(reference.name, `${label}.name`);
  for (const field of ["spotify_id", "spotify_uri", "url", "note"])
    requireNullableString(
      reference[field as keyof PersonTasteReference],
      `${label}.${field}`
    );
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requireString(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
}
function requireNullableString(value: unknown, label: string): void {
  if (value !== null && typeof value !== "string")
    throw new Error(`${label} must be a string or null.`);
}
function requireNullableNumber(value: unknown, label: string): void {
  if (value !== null && typeof value !== "number")
    throw new Error(`${label} must be a number or null.`);
}
function requireStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings.`);
}
