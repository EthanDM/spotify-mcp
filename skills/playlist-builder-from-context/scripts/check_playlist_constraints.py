#!/usr/bin/env python3
"""Compute deterministic playlist constraint metrics from a JSON manifest.

No third-party dependencies. This script does not judge track quality or semantic
comparability; it only performs counts, URI-set overlap, rounding, and checks.
"""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise SystemExit(message)


def require_list(value: Any, name: str) -> list[Any]:
    if not isinstance(value, list):
        fail(f"{name} must be a list")
    return value


def require_nonempty_strings(value: Any, name: str) -> list[str]:
    items = require_list(value, name)
    if not items or any(
        not isinstance(item, str) or not item.strip() for item in items
    ):
        fail(f"{name} must contain non-empty strings")
    return items


TRACK_URI_PATTERN = re.compile(r"spotify:track:[A-Za-z0-9]{22}")


def require_track_uris(value: Any, name: str) -> list[str]:
    items = require_nonempty_strings(value, name)
    if any(not TRACK_URI_PATTERN.fullmatch(item) for item in items):
        fail(f"{name} must contain supported Spotify track URIs")
    return items


VERSION_TERMS = re.compile(
    r"\b(remix|remaster(?:ed)?|radio edit|edit|live|acoustic|sped up|slowed|version|mix)\b",
    re.IGNORECASE,
)


def normalized_title_family(title: str) -> str:
    """Reduce common alternate-version labels to a report-only title family."""
    value = title.strip()
    value = re.sub(
        r"\s*[\(\[]([^\)\]]+)[\)\]]",
        lambda match: "" if VERSION_TERMS.search(match.group(1)) else match.group(0),
        value,
    )
    parts = re.split(r"\s+-\s+", value)
    if len(parts) > 1 and VERSION_TERMS.search(" - ".join(parts[1:])):
        value = parts[0]
    value = unicodedata.normalize("NFC", value).casefold()
    value = re.sub(r"[\W_]+", " ", value).strip()
    return value


def normalized_artist(artist: str) -> str:
    return unicodedata.normalize("NFC", artist.strip()).casefold()


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: check_playlist_constraints.py <manifest.json>")

    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    tracks = require_list(manifest.get("tracks"), "tracks")
    references = require_list(manifest.get("historical_references", []), "historical_references")
    recent = require_list(manifest.get("recent_comparable_builds", []), "recent_comparable_builds")
    recent_general = require_list(manifest.get("recent_general_builds", []), "recent_general_builds")
    personalization_sources = require_list(manifest.get("personalization_sources", []), "personalization_sources")
    mode = manifest.get("curation_mode")
    audience_mode = manifest.get("audience_mode")
    person_profile_id = manifest.get("person_profile_id")
    playback_mode = manifest.get("playback_mode")
    vocal_policy = manifest.get("vocal_policy", "unrestricted")
    exceptions = set(require_list(manifest.get("exceptions", []), "exceptions"))
    artist_specific = manifest.get("artist_specific", False)
    target_track_count = manifest.get("target_track_count")
    target_track_count_range = manifest.get("target_track_count_range")

    if mode not in {"general", "artist_catalog", "derivative", "recovered"}:
        fail("curation_mode is required and must be general, artist_catalog, derivative, or recovered")
    if audience_mode not in {"self_personalized", "self_neutral", "person_profile"}:
        fail("audience_mode is required and must be self_personalized, self_neutral, or person_profile")
    if playback_mode not in {"shuffle", "ordered"}:
        fail("playback_mode is required and must be shuffle or ordered")
    if vocal_policy not in {"unrestricted", "mostly_instrumental", "instrumental_only"}:
        fail("vocal_policy must be unrestricted, mostly_instrumental, or instrumental_only")
    if not isinstance(artist_specific, bool):
        fail("artist_specific must be a boolean")
    if target_track_count is not None and target_track_count_range is not None:
        fail("use either target_track_count or target_track_count_range, not both")
    if target_track_count is None and target_track_count_range is None:
        fail("target_track_count or target_track_count_range is required")
    if target_track_count is not None and (
        not isinstance(target_track_count, int)
        or isinstance(target_track_count, bool)
        or target_track_count < 1
    ):
        fail("target_track_count must be a positive integer")
    target_min = target_track_count
    target_max = target_track_count
    if target_track_count_range is not None:
        if not isinstance(target_track_count_range, dict):
            fail("target_track_count_range must be an object")
        target_min = target_track_count_range.get("min")
        target_max = target_track_count_range.get("max")
        if (
            not isinstance(target_min, int)
            or isinstance(target_min, bool)
            or not isinstance(target_max, int)
            or isinstance(target_max, bool)
            or target_min < 1
            or target_max < target_min
        ):
            fail("target_track_count_range must contain positive integer min and max")

    uris: list[str] = []
    names: list[str] = []
    artists: list[str] = []
    buckets: list[str] = []
    evidence_tiers: list[str] = []
    prompt_fits: list[str] = []
    functional_fits: list[str] = []
    vocal_profiles: list[str] = []
    phases: list[Any] = []
    for index, track in enumerate(tracks, start=1):
        if not isinstance(track, dict):
            fail(f"tracks[{index}] must be an object")
        uri = track.get("uri")
        name = track.get("name")
        artist = track.get("primary_artist")
        bucket = track.get("bucket")
        evidence_tier = track.get("evidence_tier")
        prompt_fit = track.get("prompt_fit")
        functional_fit = track.get("functional_fit")
        vocal_profile = track.get("vocal_profile")
        phase = track.get("phase")
        if not isinstance(uri, str) or not uri:
            fail(f"tracks[{index}].uri is required")
        if not TRACK_URI_PATTERN.fullmatch(uri):
            fail(f"tracks[{index}].uri must be a supported Spotify track URI")
        if not isinstance(name, str) or not name.strip():
            fail(f"tracks[{index}].name is required")
        if not isinstance(artist, str) or not artist.strip():
            fail(f"tracks[{index}].primary_artist is required")
        allowed_buckets = {"established", "discovery"} if audience_mode == "self_neutral" else {"familiar", "discovery"}
        if bucket not in allowed_buckets:
            expected = "established or discovery" if audience_mode == "self_neutral" else "familiar or discovery"
            fail(f"tracks[{index}].bucket must be {expected} for {audience_mode}")
        if evidence_tier not in {"anchor", "supported", "uncertain"}:
            fail(f"tracks[{index}].evidence_tier must be anchor, supported, or uncertain")
        if prompt_fit not in {"strong", "acceptable", "weak"}:
            fail(f"tracks[{index}].prompt_fit must be strong, acceptable, or weak")
        if functional_fit not in {"strong", "acceptable", "weak"}:
            fail(f"tracks[{index}].functional_fit must be strong, acceptable, or weak")
        if vocal_policy != "unrestricted" and vocal_profile not in {"instrumental", "sparse", "forward", "unknown"}:
            fail(
                f"tracks[{index}].vocal_profile must be instrumental, sparse, forward, or unknown "
                "when vocal_policy constrains vocals"
            )
        if playback_mode == "ordered" and phase not in {"opening", "development", "peak", "descent", "close"}:
            fail(f"tracks[{index}].phase is required for ordered playback")
        uris.append(uri)
        names.append(name)
        artists.append(normalized_artist(artist))
        buckets.append(bucket)
        evidence_tiers.append(evidence_tier)
        prompt_fits.append(prompt_fit)
        functional_fits.append(functional_fit)
        if vocal_policy != "unrestricted":
            vocal_profiles.append(vocal_profile)
        phases.append(phase)

    n = len(tracks)
    uri_counts = Counter(uris)
    artist_counts = Counter(artists)
    duplicate_uris = sorted(uri for uri, count in uri_counts.items() if count > 1)

    title_families: dict[str, list[dict[str, str]]] = {}
    for uri, name, artist in zip(uris, names, artists):
        family = normalized_title_family(name)
        title_families.setdefault(family, []).append({"uri": uri, "name": name, "primary_artist": artist})
    potential_version_families = [
        {"normalized_title": family, "tracks": family_tracks}
        for family, family_tracks in sorted(title_families.items())
        if family and len(family_tracks) > 1
    ]

    familiar_count = buckets.count("familiar")
    established_count = buckets.count("established")
    discovery_count = buckets.count("discovery")
    evidence_counts = Counter(evidence_tiers)
    anchor_target = math.ceil(0.30 * n)
    uncertain_limit = max(1, math.floor(0.10 * n)) if n else 0
    weak_prompt_indexes = [index + 1 for index, value in enumerate(prompt_fits) if value == "weak"]
    weak_functional_indexes = [index + 1 for index, value in enumerate(functional_fits) if value == "weak"]
    vocal_profile_counts = Counter(vocal_profiles)
    sparse_vocal_limit = math.floor(0.20 * n)
    unknown_vocal_limit = max(1, math.floor(0.10 * n)) if n else 0

    phase_order = {"opening": 0, "development": 1, "peak": 2, "descent": 3, "close": 4}
    phase_counts = Counter(phase for phase in phases if phase is not None)
    ordered_phase_valid = None
    if playback_mode == "ordered":
        phase_values = [phase_order[str(phase)] for phase in phases]
        ordered_phase_valid = (
            all(current <= following for current, following in zip(phase_values, phase_values[1:]))
            and phase_counts["close"] > 0
            and phases[-1] == "close"
        )

    total_history_limit = max(0, math.ceil(n / 3) - 1)
    single_reference_limit = max(1, math.floor(n / 5)) if n else 0
    recent_overlap_limit = math.floor(n / 4)
    new_primary_target = math.ceil(0.30 * n)

    final_uri_set = set(uris)
    reference_overlaps: list[dict[str, Any]] = []
    historical_union: set[str] = set()
    for index, ref in enumerate(references, start=1):
        if not isinstance(ref, dict):
            fail(f"historical_references[{index}] must be an object")
        ref_id = str(ref.get("id", f"reference-{index}"))
        ref_uri_list = require_track_uris(
            ref.get("track_uris"), f"historical_references[{index}].track_uris"
        )
        ref_uris = set(ref_uri_list)
        overlap = final_uri_set & ref_uris
        historical_union |= ref_uris
        reference_overlaps.append({"id": ref_id, "count": len(overlap)})

    historical_total = len(final_uri_set & historical_union)
    max_reference_overlap = max((row["count"] for row in reference_overlaps), default=0)

    history_usable = len(recent) > 0
    recent_overlaps: list[dict[str, Any]] = []
    recent_uri_union: set[str] = set()
    prior_primary_artists: set[str] = set()
    for index, build in enumerate(recent, start=1):
        if not isinstance(build, dict):
            fail(f"recent_comparable_builds[{index}] must be an object")
        build_id = str(build.get("id", f"recent-{index}"))
        build_uris = set(
            require_track_uris(
                build.get("track_uris", []),
                f"recent_comparable_builds[{index}].track_uris",
            )
        )
        build_artists = {
            normalized_artist(artist)
            for artist in require_nonempty_strings(
                build.get("primary_artists", []),
                f"recent_comparable_builds[{index}].primary_artists",
            )
        }
        prior_primary_artists |= build_artists
        recent_uri_union |= build_uris
        overlap_count = len(final_uri_set & build_uris)
        recent_overlaps.append({
            "id": build_id,
            "count": overlap_count,
            "percent": round(overlap_count / n, 4) if n else 0.0,
        })

    recent_general_artist_build_counts: Counter[str] = Counter()
    for index, build in enumerate(recent_general, start=1):
        if not isinstance(build, dict):
            fail(f"recent_general_builds[{index}] must be an object")
        build_artists = {
            normalized_artist(artist)
            for artist in require_nonempty_strings(
                build.get("primary_artists", []),
                f"recent_general_builds[{index}].primary_artists",
            )
        }
        recent_general_artist_build_counts.update(build_artists)
    recurring_recent_general_artists = {
        artist: count
        for artist, count in sorted(recent_general_artist_build_counts.items())
        if count > 1
    }

    if history_usable:
        new_primary_count = sum(1 for artist in artists if artist not in prior_primary_artists)
        new_primary_percent = round(new_primary_count / n, 4) if n else 0.0
        max_recent = max(recent_overlaps, key=lambda row: row["count"], default={"id": None, "count": 0, "percent": 0.0})
        recent_union_overlap_count = len(final_uri_set & recent_uri_union)
        recent_union_overlap_percent = round(recent_union_overlap_count / n, 4) if n else 0.0
    else:
        new_primary_count = None
        new_primary_percent = None
        max_recent = {"id": None, "count": None, "percent": None}
        recent_union_overlap_count = None
        recent_union_overlap_percent = None

    enforce_general_diversity = mode == "general" and audience_mode != "self_neutral"
    enforce_artist_cap = mode == "general" or (mode == "derivative" and not artist_specific)
    relax_new_primary = "narrow_new_primary" in exceptions
    relax_recent_overlap = "narrow_recent_overlap" in exceptions

    violations: list[str] = []
    if not target_min <= n <= target_max:
        violations.append("target_track_count")
    if duplicate_uris:
        violations.append("duplicate_track_uri")
    if audience_mode == "self_neutral" and personalization_sources:
        violations.append("neutral_personalization_source")
    if audience_mode == "self_neutral" and references:
        violations.append("neutral_historical_reference")
    if audience_mode == "person_profile" and (
        not isinstance(person_profile_id, str) or not person_profile_id.strip()
    ):
        violations.append("person_profile_id_required")
    if weak_prompt_indexes:
        violations.append("weak_prompt_fit")
    if weak_functional_indexes:
        violations.append("weak_functional_fit")
    if vocal_policy == "mostly_instrumental":
        if vocal_profile_counts["forward"]:
            violations.append("vocal_forward_track")
        if vocal_profile_counts["sparse"] > sparse_vocal_limit:
            violations.append("sparse_vocal_limit")
        if vocal_profile_counts["unknown"] > unknown_vocal_limit:
            violations.append("unknown_vocal_limit")
    if vocal_policy == "instrumental_only" and any(profile != "instrumental" for profile in vocal_profiles):
        violations.append("instrumental_only_policy")
    if mode == "general" and evidence_counts["anchor"] < anchor_target:
        violations.append("anchor_floor")
    if mode == "general" and evidence_counts["uncertain"] > uncertain_limit:
        violations.append("uncertain_track_limit")
    if playback_mode == "ordered" and not ordered_phase_valid:
        violations.append("ordered_phase_progression")
    if enforce_artist_cap and any(count > 3 for count in artist_counts.values()):
        violations.append("primary_artist_cap")
    if enforce_general_diversity:
        if historical_total > total_history_limit:
            violations.append("historical_carryover_total")
        if max_reference_overlap > single_reference_limit:
            violations.append("historical_carryover_single_reference")
        if history_usable:
            if not relax_new_primary and new_primary_count is not None and new_primary_count < new_primary_target:
                violations.append("new_primary_artist_target")
            if not relax_recent_overlap and max_recent["count"] is not None and max_recent["count"] > recent_overlap_limit:
                violations.append("recent_exact_overlap")

    output = {
        "audience_mode": audience_mode,
        "person_profile_id": person_profile_id,
        "personalization_sources": personalization_sources,
        "curation_mode": mode,
        "track_count": n,
        "target_track_count": target_track_count,
        "target_track_count_range": target_track_count_range,
        "duplicate_track_uris": duplicate_uris,
        "potential_version_families": potential_version_families,
        "unique_primary_artists": len(artist_counts),
        "primary_artist_counts": dict(sorted(artist_counts.items())),
        "artists_over_three": {artist: count for artist, count in sorted(artist_counts.items()) if count > 3},
        "familiar_count": familiar_count,
        "established_count": established_count,
        "discovery_count": discovery_count,
        "familiar_percent": round(familiar_count / n, 4) if n else 0.0,
        "established_percent": round(established_count / n, 4) if n else 0.0,
        "discovery_percent": round(discovery_count / n, 4) if n else 0.0,
        "evidence_tier_counts": dict(sorted(evidence_counts.items())),
        "anchor_target_count": anchor_target,
        "uncertain_track_limit": uncertain_limit,
        "weak_prompt_fit_positions": weak_prompt_indexes,
        "weak_functional_fit_positions": weak_functional_indexes,
        "vocal_policy": vocal_policy,
        "vocal_profile_counts": dict(sorted(vocal_profile_counts.items())),
        "sparse_vocal_limit": sparse_vocal_limit if vocal_policy == "mostly_instrumental" else None,
        "unknown_vocal_limit": unknown_vocal_limit if vocal_policy == "mostly_instrumental" else None,
        "playback_mode": playback_mode,
        "phase_counts": dict(sorted(phase_counts.items())),
        "ordered_phase_progression_valid": ordered_phase_valid,
        "new_primary_artist_track_count": new_primary_count,
        "new_primary_artist_track_percent": new_primary_percent,
        "new_primary_artist_target_count": new_primary_target,
        "historical_carryover_total": historical_total,
        "historical_carryover_total_limit": total_history_limit,
        "historical_reference_overlaps": reference_overlaps,
        "historical_single_reference_limit": single_reference_limit,
        "recent_history_usable": history_usable,
        "recent_build_overlaps": recent_overlaps,
        "max_recent_overlap": max_recent,
        "recent_union_overlap_count": recent_union_overlap_count,
        "recent_union_overlap_percent": recent_union_overlap_percent,
        "recurring_recent_general_artists": recurring_recent_general_artists,
        "recent_overlap_limit": recent_overlap_limit,
        "recent_overlap_enforced": enforce_general_diversity,
        "exceptions": sorted(exceptions),
        "violations": violations,
        "passes_applicable_hard_checks": not violations,
    }
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
