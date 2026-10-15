import { ACTIVE_DUTY_MAPS, type MapCategory, type MapDefinition } from "../../../shared/maps.js";
export { ACTIVE_DUTY_MAPS, type MapCategory, type MapDefinition };

export type WorkshopMapInput = {
  title: string;
  mapName: string;
  workshopId: string;
  radarUrl?: string;
  radarWidth?: number;
  radarHeight?: number;
};

export type RadarPoint = {
  x: number;
  y: number;
  level?: "upper" | "lower";
};

export function isRadarPoint(value: unknown): value is RadarPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as RadarPoint;
  return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    && (point.level === undefined || point.level === "upper" || point.level === "lower");
}

export const CSNADES_REFERENCE_MAPS: MapDefinition[] = [
  { key: "overpass", name: "Overpass", mapName: "de_overpass", category: "reserve", radarUrl: "/maps/overpass.webp", radarWidth: 1274, radarHeight: 1632, sourceUrl: "https://csnades.gg/overpass" },
  { key: "train", name: "Train", mapName: "de_train", category: "reserve", radarUrl: "/maps/train.webp", radarWidth: 1638, radarHeight: 1638, sourceUrl: "https://csnades.gg/train" },
  { key: "vertigo", name: "Vertigo", mapName: "de_vertigo", category: "reserve", radarUrl: "/maps/vertigo.webp", radarWidth: 1135, radarHeight: 1219, sourceUrl: "https://csnades.gg/vertigo" },
  { key: "office", name: "Office", mapName: "cs_office", category: "reserve", radarUrl: "/maps/office.webp", radarWidth: 2048, radarHeight: 1823, sourceUrl: "https://csnades.gg/office" },
  { key: "agency", name: "Agency", mapName: "cs_agency", category: "community", radarUrl: "/maps/agency.webp", radarWidth: 1024, radarHeight: 1024, sourceUrl: "https://csnades.gg/agency" },
  { key: "grail", name: "Grail", mapName: "de_grail", category: "community", radarUrl: "/maps/grail.webp", radarWidth: 2048, radarHeight: 2048, sourceUrl: "https://csnades.gg/grail" },
  { key: "jura", name: "Jura", mapName: "de_jura", category: "community", radarUrl: "/maps/jura.webp", radarWidth: 1679, radarHeight: 1843, sourceUrl: "https://csnades.gg/jura" },
  { key: "italy", name: "Italy", mapName: "cs_italy", category: "community", radarUrl: "/maps/italy.webp", radarWidth: 1830, radarHeight: 1830, sourceUrl: "https://csnades.gg/italy" },
  { key: "thera", name: "Thera", mapName: "de_thera", category: "community", radarUrl: "/maps/thera.webp", radarWidth: 1638, radarHeight: 1638, sourceUrl: "https://csnades.gg/thera" },
  { key: "mills", name: "Mills", mapName: "de_mills", category: "community", radarUrl: "/maps/mills.webp", radarWidth: 1698, radarHeight: 1698, sourceUrl: "https://csnades.gg/mills" },
  { key: "contact", name: "Contact", mapName: "de_contact", category: "community", radarUrl: "/maps/contact.webp", radarWidth: 2048, radarHeight: 2048, sourceUrl: "https://csnades.gg/contact" }
];

// Other playable maps shipped with CS2; availability comes from the server inventory.
const extraRadars: Record<string, { radarUrl: string; radarLowerUrl?: string; radarWidth: number; radarHeight: number }> = {
  "ar_baggage": {
    "radarUrl": "/maps/ar_baggage.png",
    "radarLowerUrl": "/maps/ar_baggage-lower.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  },
  "ar_shoots": {
    "radarUrl": "/maps/ar_shoots.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  },
  "ar_shoots_night": {
    "radarUrl": "/maps/ar_shoots_night.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  },
  "de_ancient_night": {
    "radarUrl": "/maps/de_ancient_night.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  },
  "cs_shelter": {
    "radarUrl": "/maps/cs_shelter.png",
    "radarWidth": 2048,
    "radarHeight": 2048
  },
  "de_boulder": {
    "radarUrl": "/maps/de_boulder.png",
    "radarWidth": 2048,
    "radarHeight": 2048
  },
  "de_debris": {
    "radarUrl": "/maps/de_debris.png",
    "radarWidth": 2048,
    "radarHeight": 2048
  },
  "de_eldorado": {
    "radarUrl": "/maps/de_eldorado.png",
    "radarWidth": 2048,
    "radarHeight": 2048
  },
  "de_fachwerk": {
    "radarUrl": "/maps/de_fachwerk.png",
    "radarWidth": 2048,
    "radarHeight": 2048
  },
  "de_poseidon": {
    "radarUrl": "/maps/de_poseidon.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  },
  "rush_001": {
    "radarUrl": "/maps/rush_001.png",
    "radarWidth": 1024,
    "radarHeight": 1024
  }
};

export const OTHER_MAPS: MapDefinition[] = [
  ["ar_baggage", "Baggage"], ["ar_pool_day", "Pool Day"], ["ar_shoots", "Shoots"],
  ["ar_shoots_night", "Shoots (Nacht)"], ["de_ancient_night", "Ancient (Nacht)"],
  ["cs_shelter", "Shelter"], ["de_boulder", "Boulder"], ["de_debris", "Debris"],
  ["de_eldorado", "El Dorado"], ["de_fachwerk", "Fachwerk"], ["de_poseidon", "Poseidon"], ["rush_001", "Training"]
].map(([mapName, name]) => ({ key: mapName, name, mapName, category: "other", ...extraRadars[mapName] }));

export function playableMapName(name: string) {
  return /^[a-z0-9_]+$/.test(name) && !name.includes("vanity") && !name.startsWith("workshop_preview_") && !["graphics_settings", "lobby_mapveto"].includes(name);
}

export function mapsForInventory(settings, inventory?: any[]): MapDefinition[] {
  const known = [...BUILT_IN_MAPS, ...workshopMapsFromSettings(settings).filter(m => !m.mapName || playableMapName(m.mapName))];
  if (!Array.isArray(inventory)) return known;
  return inventory.filter(m => m && (m.MapName === "" && m.WorkshopId || playableMapName(m.MapName || ""))).map(m => {
    const definition = known.find(k => m.WorkshopId ? k.workshopId === m.WorkshopId : k.mapName === m.MapName)
      || known.find(k => k.mapName === m.MapName);
    return { ...definition, key: m.Key, name: m.Title, mapName: m.MapName,
      category: m.Category, available: m.Available === true,
      ...(m.WorkshopId ? { workshopId: m.WorkshopId } : {}) };
  });
}

export const BUILT_IN_MAPS = [...ACTIVE_DUTY_MAPS, ...CSNADES_REFERENCE_MAPS, ...OTHER_MAPS];

export function mapSlug(map: MapDefinition) {
  return map.workshopId ? `workshop-${map.workshopId}` : map.mapName.replace(/^(de|cs)_/, "");
}

export function mapPath(map: MapDefinition) {
  return `/maps/${encodeURIComponent(mapSlug(map))}`;
}

// Browsing includes maps absent from the server. Server map controls still use mapsForInventory.
export function mapsForLibrary(settings, inventory?: any[], nades: { map: string }[] = []): MapDefinition[] {
  const maps = new Map<string, MapDefinition>();
  for (const map of [...BUILT_IN_MAPS, ...workshopMapsFromSettings(settings)]) {
    maps.set(mapSlug(map), { ...map, ...(Array.isArray(inventory) ? { available: false } : {}) });
  }
  for (const map of mapsForInventory(settings, inventory)) {
    maps.set(mapSlug(map), map);
  }
  for (const nade of nades) {
    if (!nade.map || [...maps.values()].some(map => mapMatchesNade(map, nade.map))) continue;
    const map: MapDefinition = { key: nade.map, name: nade.map, mapName: nade.map, category: "unavailable", available: false };
    maps.set(mapSlug(map), map);
  }
  return [...maps.values()];
}

export function extractWorkshopId(value: string) {
  const normalized = String(value || "").trim();
  if (/^\d+$/.test(normalized)) return normalized;
  const match = normalized.match(/[?&]id=(\d+)(?:$|[^\d])/);
  return match?.[1] || "";
}

export function parseWorkshopIds(value: string) {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of String(value || "").split(/[\n,]+/)) {
    const id = extractWorkshopId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseCatalog(value: string): WorkshopMapInput[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const workshopId = extractWorkshopId(String(entry.workshopId || ""));
      const title = String(entry.title || "").trim();
      const mapName = String(entry.mapName || "").trim();
      const radarUrl = String(entry.radarUrl || "").trim();
      const radarWidth = Number(entry.radarWidth || 0);
      const radarHeight = Number(entry.radarHeight || 0);
      if (!workshopId || !title || !mapName) return [];
      return [{
        workshopId,
        title,
        mapName,
        ...(radarUrl && radarWidth > 0 && radarHeight > 0 ? { radarUrl, radarWidth, radarHeight } : {})
      }];
    });
  } catch {
    return [];
  }
}

export function workshopMapsFromSettings(settings): MapDefinition[] {
  const ids = parseWorkshopIds(settings?.workshopMaps || "");
  const metadata = new Map(parseCatalog(settings?.workshopMapCatalog || "[]").map((entry) => [entry.workshopId, entry]));
  return ids.map((workshopId) => {
    const entry = metadata.get(workshopId);
    return {
      key: `workshop-${workshopId}`,
      name: entry?.title || `Workshop ${workshopId}`,
      mapName: entry?.mapName || "",
      category: "workshop",
      workshopId,
      radarUrl: entry?.radarUrl,
      radarWidth: entry?.radarWidth,
      radarHeight: entry?.radarHeight
    };
  });
}

export function addWorkshopMap(settings, input: WorkshopMapInput) {
  const workshopId = extractWorkshopId(input.workshopId);
  if (!workshopId) throw new Error("Enter a valid Steam Workshop ID or item URL.");
  const title = String(input.title || "").trim();
  const mapName = String(input.mapName || "").trim();
  const radarUrl = String(input.radarUrl || "").trim();
  const radarWidth = Number(input.radarWidth || 0);
  const radarHeight = Number(input.radarHeight || 0);
  if (!title) throw new Error("Display name is required.");
  if (!/^[a-z0-9_]+$/i.test(mapName)) throw new Error("Game map name may contain only letters, numbers and underscores.");

  const ids = parseWorkshopIds(settings?.workshopMaps || "");
  if (!ids.includes(workshopId)) ids.push(workshopId);
  const catalog = parseCatalog(settings?.workshopMapCatalog || "[]").filter((entry) => entry.workshopId !== workshopId);
  catalog.push({
    workshopId,
    title,
    mapName,
    ...(radarUrl && radarWidth > 0 && radarHeight > 0 ? { radarUrl, radarWidth, radarHeight } : {})
  });
  return {
    workshopMaps: ids.join("\n"),
    workshopMapCatalog: JSON.stringify(catalog)
  };
}

export function removeWorkshopMap(settings, workshopId: string) {
  const ids = parseWorkshopIds(settings?.workshopMaps || "").filter((id) => id !== workshopId);
  const catalog = parseCatalog(settings?.workshopMapCatalog || "[]").filter((entry) => entry.workshopId !== workshopId);
  return {
    workshopMaps: ids.join("\n"),
    workshopMapCatalog: JSON.stringify(catalog)
  };
}

export function mapMatchesNade(map: MapDefinition, nadeMap: string) {
  const normalize = (value: string) => String(value || "").toLowerCase().replace(/^(de|cs)_/, "").replace(/[^a-z0-9]/g, "");
  return normalize(nadeMap) === normalize(map.mapName) || normalize(nadeMap) === normalize(map.name);
}
