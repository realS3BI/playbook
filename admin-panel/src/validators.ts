import { assignNadeIds } from "./nade-ids.js";
import { sanitizeReviewMedia } from "./review-media.js";
import { isLineupTeam } from "../shared/lineup-teams.js";
import { validAccess, cssFlags, legacyRole } from "../shared/authorization.js";
import { CLICK_TYPES, THROW_FLAGS, THROW_ATTRIBUTE_FIELDS, MOVEMENT_FLAGS, movementType, movementPatch } from "../shared/throw-attributes.js";
import { flagsForRole, SETTING_KEYS } from "./policy.js";

const STEAM64_RE = /^[0-9]{17}$/;
const NAMES_WITHOUT_SLASHES_RE = /^[^\\/]+$/;
const VECTOR_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)\s+-?(?:\d+(?:\.\d+)?|\.\d+)\s+-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const NADE_TYPES = new Set(["", "Smoke", "Flash", "HE", "Molly", "Decoy"]);
const MAX_LINEUP_IMAGES = 10;

export function sanitizeSettings(input) {
  const output = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Settings must be an object");
  }
  const source = input;
  for (const [key, value] of Object.entries(source)) {
    if (!SETTING_KEYS.includes(key as any)) {
      throw new Error(`Unknown setting: ${key}`);
    }
    output[key] = value;
  }
  return output;
}

export function sanitizeAdmins(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Admins must be an array");
  }

  const seen = new Set();
  return entries.map((entry) => {
    const name = String(entry.name ?? "").trim();
    if (name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("Der Benutzername darf höchstens 100 Zeichen ohne Steuerzeichen enthalten.");
    const identitySteam64 = String(entry.identitySteam64 ?? "").trim();
    if (entry.access !== undefined && !validAccess(entry.access)) throw new Error("Ungültige Plattform- oder Serverrolle.");
    const role = entry.access ? legacyRole(entry.access) : String(entry.role || "player");
    const flags = entry.access ? cssFlags(entry) : [...new Set(flagsForRole(role))];

    if (!STEAM64_RE.test(identitySteam64)) {
      throw new Error(`Invalid Steam64 ID: ${identitySteam64 || "(empty)"}`);
    }
    if (seen.has(identitySteam64)) {
      throw new Error(`Duplicate Steam64 ID: ${identitySteam64}`);
    }
    seen.add(identitySteam64);

    return {
      name,
      identitySteam64,
      role,
      flags,
      ...(entry.access ? { access: entry.access } : {})
    };
  });
}

export function adminsToCssConfig(entries) {
  const config = {};
  for (const entry of sanitizeAdmins(entries)) {
    if (entry.flags.length === 0) continue;
    config[entry.identitySteam64] = {
      identity: entry.identitySteam64,
      flags: entry.flags
    };
  }
  return config;
}

export function adminsToMatchZyConfig(entries) {
  sanitizeAdmins(entries);
  return {};
}

function normalizeVector(value, fieldName) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!VECTOR_RE.test(normalized)) {
    throw new Error(`${fieldName} must contain exactly 3 numeric values`);
  }
  return normalized;
}

function normalizeOptionalVector(value, fieldName) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalizeVector(normalized, fieldName) : "";
}

function sanitizeRadarPoint(point, fieldName) {
  if (point === undefined || point === null || point === "") return null;
  if (!point || typeof point !== "object" || Array.isArray(point)) {
    throw new Error(`${fieldName} must be a point`);
  }
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    throw new Error(`${fieldName} coordinates must be between 0 and 1`);
  }
  if (point.level !== undefined && point.level !== "upper" && point.level !== "lower") {
    throw new Error(`${fieldName}: Ungültige Kartenebene.`);
  }
  return { x, y, ...(point.level !== undefined && { level: point.level }) };
}

function sanitizeLineupImages(images) {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) {
    throw new Error("Lineup images must be an array");
  }
  if (images.length > MAX_LINEUP_IMAGES) {
    throw new Error(`Lineup images must contain at most ${MAX_LINEUP_IMAGES} images`);
  }

  return images.map((image) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new Error("Lineup image must be an object");
    }

    const key = String(image.key ?? "").trim();
    const url = String(image.url ?? "").trim();
    const name = String(image.name ?? "").trim();
    const size = Number(image.size ?? 0);
    const uploadedAt = String(image.uploadedAt ?? "").trim() || new Date().toISOString();

    if (!key) {
      throw new Error("Lineup image key is required");
    }
    if (!/^https?:\/\//i.test(url) && !/^\/api\/uploads\/[0-9a-f-]+\.(?:jpg|png|webp|gif)$/i.test(url)) {
      throw new Error("Lineup image URL must be an external HTTP URL or a panel upload");
    }
    if (!name) {
      throw new Error("Lineup image name is required");
    }
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Lineup image size must be a non-negative number");
    }

    return { key, url, name, size, uploadedAt };
  });
}

export function sanitizeNades(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Nades must be an array");
  }

  const seen = new Set();
  return assignNadeIds(entries.map((entry) => {
    const name = String(entry.name ?? "").trim();
    const map = String(entry.map ?? "").trim();
    const displayName = String(entry.displayName ?? "").trim();
    for (const key of THROW_FLAGS) {
      if (entry[key] !== undefined && typeof entry[key] !== "boolean") throw new Error(`${key} muss ein Boolean sein.`);
    }
    if (entry.click_type !== undefined && !CLICK_TYPES.includes(entry.click_type)) throw new Error("Ungültige Maustaste. Erlaubt sind left, right und both.");
    if (entry.flightDuration !== undefined && (typeof entry.flightDuration !== "number" || !Number.isFinite(entry.flightDuration) || entry.flightDuration < 0))
      throw new Error("Die gemessene Flugzeit muss eine endliche, nicht negative Sekundenzahl sein.");
    if (entry.official !== undefined && typeof entry.official !== "boolean") throw new Error("Official must be a boolean");
    if (entry.reviewStatus !== undefined && !["", "pending", "approved", "rejected"].includes(entry.reviewStatus)) throw new Error("Invalid review status");
    if (entry.mustKnow !== undefined && typeof entry.mustKnow !== "boolean") {
      throw new Error("Must Know must be a boolean");
    }
    const throwTechnique = String(entry.throwTechnique ?? "").trim();
    const throwTrace = String(entry.throwTrace ?? "").trim();
    if (throwTechnique.length > 500 || throwTrace.length > 120_000) {
      throw new Error("Captured throw details are too large");
    }
    if (displayName.length > 120 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      throw new Error("Display name must be at most 120 characters without control characters");
    }
    if (entry.team !== undefined && entry.team !== "" && !isLineupTeam(entry.team)) throw new Error("Ungültige Seite. Erlaubt sind T, CT und beide Seiten.");
    const type = String(entry.type ?? "").trim();
    const desc = String(entry.desc ?? "");
    const owner = String(entry.owner ?? "default").trim() || "default";
    const lineupPos = normalizeVector(entry.lineupPos, "Lineup position");
    const lineupAng = normalizeVector(entry.lineupAng, "Lineup angle");
    const landingPos = normalizeOptionalVector(entry.landingPos, "Landing position");
    const releasePos = normalizeOptionalVector(entry.releasePos, "Release position");
    const releaseAng = normalizeOptionalVector(entry.releaseAng, "Release angle");
    const throwFromTitle = String(entry.throwFromTitle ?? "").trim();
    const throwToTitle = String(entry.throwToTitle ?? "").trim();
    const radarFrom = sanitizeRadarPoint(entry.radarFrom, "Radar start");
    const radarTo = sanitizeRadarPoint(entry.radarTo, "Radar target");
    if ([throwFromTitle, throwToTitle].some(title => title.length > 120 || /[\u0000-\u001f\u007f]/.test(title)))
      throw new Error("Positionsnamen dürfen höchstens 120 Zeichen ohne Steuerzeichen enthalten.");

    if (!name) {
      throw new Error("Nade name is required");
    }
    if (!NAMES_WITHOUT_SLASHES_RE.test(name)) {
      throw new Error(`Invalid nade name: ${name}`);
    }
    if (!map) {
      throw new Error("Nade map is required");
    }
    if (!NADE_TYPES.has(type)) {
      throw new Error(`Invalid nade type: ${type}`);
    }

    const duplicateKey = `${owner}\u0000${map}\u0000${name}`.toLowerCase();
    if (seen.has(duplicateKey)) {
      throw new Error(`Duplicate nade for ${map}: ${name}`);
    }
    seen.add(duplicateKey);

    const cleanEntry: any = {
      id: String(entry.id ?? "").trim(),
      name,
      map,
      type,
      desc,
      lineupPos,
      lineupAng,
      lineupImages: sanitizeLineupImages(entry.lineupImages),
      owner,
      updatedAt: String(entry.updatedAt ?? "").trim() || new Date().toISOString()
    };
    if (isLineupTeam(entry.team)) cleanEntry.team = entry.team;
    if (entry.reviewMedia !== undefined) cleanEntry.reviewMedia = sanitizeReviewMedia(entry.reviewMedia);
    for (const key of THROW_ATTRIBUTE_FIELDS) if (entry[key] !== undefined) cleanEntry[key] = entry[key];
    if (MOVEMENT_FLAGS.some(key => entry[key] !== undefined)) Object.assign(cleanEntry, movementPatch(movementType(entry)));
    if (entry.flightDuration !== undefined) cleanEntry.flightDuration = entry.flightDuration;
    if (throwTechnique) cleanEntry.throwTechnique = throwTechnique;
    if (throwTrace) cleanEntry.throwTrace = throwTrace;
    if (landingPos) cleanEntry.landingPos = landingPos;
    // Where the grenade left after a run-up or jump; lineupPos stays the spot to aim from.
    if (releasePos && releaseAng) Object.assign(cleanEntry, { releasePos, releaseAng });
    if (displayName) cleanEntry.displayName = displayName;
    if (entry.mustKnow !== undefined) cleanEntry.mustKnow = entry.mustKnow;
    if (entry.official !== undefined) cleanEntry.official = entry.official;
    if (entry.reviewStatus !== undefined) cleanEntry.reviewStatus = entry.reviewStatus;
    if (entry.mustKnow === true) cleanEntry.official = true;
    if (cleanEntry.official === true) cleanEntry.reviewStatus = "approved";
    if (entry.captureId) cleanEntry.captureId = String(entry.captureId);
    if (throwFromTitle) cleanEntry.throwFromTitle = throwFromTitle;
    if (throwToTitle) cleanEntry.throwToTitle = throwToTitle;
    if (radarFrom) cleanEntry.radarFrom = radarFrom;
    if (radarTo) cleanEntry.radarTo = radarTo;
    return cleanEntry;
  }));
}

export function nadesToMatchZySavedNadesConfig(entries) {
  const config = {};
  for (const entry of sanitizeNades(entries)) {
    if (!config[entry.owner]) config[entry.owner] = {};
    config[entry.owner][entry.name] = {
      Id: entry.id,
      LineupPos: entry.lineupPos,
      LineupAng: entry.lineupAng,
      Desc: entry.desc,
      Map: entry.map,
      Type: entry.type
    };
    if (entry.displayName) config[entry.owner][entry.name].DisplayName = entry.displayName;
    if (entry.mustKnow !== undefined) config[entry.owner][entry.name].MustKnow = entry.mustKnow;
    if (entry.official !== undefined) config[entry.owner][entry.name].Official = entry.official;
    if (entry.reviewStatus !== undefined) config[entry.owner][entry.name].ReviewStatus = entry.reviewStatus;
    if (entry.landingPos) config[entry.owner][entry.name].LandingPos = entry.landingPos;
    for (const key of [...THROW_ATTRIBUTE_FIELDS, "flightDuration"])
      if (entry[key] !== undefined) config[entry.owner][entry.name][key] = entry[key];
  }
  return config;
}

export function matchZySavedNadesConfigToNades(config) {
  const entries = [];
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};

  for (const [ownerKey, ownerNades] of Object.entries(source)) {
    if (!ownerNades || typeof ownerNades !== "object" || Array.isArray(ownerNades)) continue;
    const owner = String(ownerKey || "default").trim() || "default";
    for (const [name, nade] of Object.entries(ownerNades)) {
      if (!nade || typeof nade !== "object" || Array.isArray(nade)) continue;
      const entry = {
        name,
        id: nade.Id,
        displayName: nade.DisplayName,
        mustKnow: nade.MustKnow,
        official: nade.Official,
        reviewStatus: nade.ReviewStatus,
        landingPos: nade.LandingPos,
        ...Object.fromEntries([...THROW_ATTRIBUTE_FIELDS, "flightDuration", "team", "throwFromTitle", "throwToTitle", "throwTechnique"].map(key => [key, nade[key]])),
        map: nade.Map,
        type: nade.Type || "",
        desc: nade.Desc || "",
        lineupPos: nade.LineupPos,
        lineupAng: nade.LineupAng,
        owner
      };
      entries.push(entry);
    }
  }

  return sanitizeNades(entries);
}
