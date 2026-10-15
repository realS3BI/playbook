// Valve's active duty pool. The website lists these maps first, and the map scene worker
// exports them even before the first lineup exists.
export type MapCategory = "active" | "reserve" | "community" | "workshop" | "other" | "unavailable";

export type MapDefinition = {
  key: string;
  name: string;
  mapName: string;
  category: MapCategory;
  available?: boolean;
  radarUrl?: string;
  radarLowerUrl?: string;
  radarWidth?: number;
  radarHeight?: number;
  sourceUrl?: string;
  workshopId?: string;
};

export const ACTIVE_DUTY_MAPS: MapDefinition[] = [
  { key: "mirage", name: "Mirage", mapName: "de_mirage", category: "active", radarUrl: "/maps/mirage.webp", radarWidth: 1374, radarHeight: 1196, sourceUrl: "https://csnades.gg/mirage" },
  { key: "dust2", name: "Dust II", mapName: "de_dust2", category: "active", radarUrl: "/maps/dust2.webp", radarWidth: 1516, radarHeight: 1619, sourceUrl: "https://csnades.gg/dust2" },
  { key: "nuke", name: "Nuke", mapName: "de_nuke", category: "active", radarUrl: "/maps/nuke.webp", radarLowerUrl: "/maps/nuke-lower.webp", radarWidth: 1558, radarHeight: 848, sourceUrl: "https://csnades.gg/nuke" },
  { key: "inferno", name: "Inferno", mapName: "de_inferno", category: "active", radarUrl: "/maps/inferno.webp", radarWidth: 1500, radarHeight: 1491, sourceUrl: "https://csnades.gg/inferno" },
  { key: "ancient", name: "Ancient", mapName: "de_ancient", category: "active", radarUrl: "/maps/ancient.webp", radarWidth: 1290, radarHeight: 1467, sourceUrl: "https://csnades.gg/ancient" },
  { key: "anubis", name: "Anubis", mapName: "de_anubis", category: "active", radarUrl: "/maps/anubis.webp", radarWidth: 2048, radarHeight: 2048, sourceUrl: "https://csnades.gg/anubis" },
  { key: "cache", name: "Cache", mapName: "de_cache", category: "active", radarUrl: "/maps/cache.webp", radarWidth: 2048, radarHeight: 1596, sourceUrl: "https://csnades.gg/cache" }
];
