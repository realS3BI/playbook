import { authorize, type Action, type Actor } from "../shared/authorization.js";

const routes: Record<string, Action> = {
  "GET /control": "lineups.read",
  "GET /nades": "lineups.read",
  "GET /nades/status": "lineups.read",
  "GET /nades/events": "lineups.read",
  "GET /nades/favorites": "lineups.read",
  "PUT /nades/favorites": "lineups.read",
  "POST /nades/entry": "lineups.read",
  "GET /nades/review/config": "lineups.read",
  "GET /users": "users.manage",
  "GET /access": "users.manage",
  "GET /settings": "server.manage",
  "PUT /settings": "server.manage",
  "PUT /control": "server.match",
  "POST /control/apply": "server.match",
  "GET /server/game": "server.match",
  "POST /server/map": "server.match",
  "POST /server/rcon": "server.rcon",
  "GET /server/status": "server.manage",
  "GET /server/diagnostics": "server.manage",
  "GET /server/logs": "server.manage",
  "POST /server/restart": "server.manage",
  "POST /server/apply": "server.manage",
  "POST /server/repair": "server.manage",
  "PUT /nades": "lineups.moderate",
  "POST /nades/import": "lineups.moderate",
  "GET /nades/export": "lineups.moderate",
  "POST /uploads/lineup-image": "lineups.create",
};
export function routeAllowed(user: Actor, method: string, path: string) {
  let action = routes[`${method} ${path}`];
  if (method === "PUT" && /^\/users\/[0-9]{17}$/.test(path))
    action = "users.manage";
  if (
    method === "GET" &&
    (/^\/uploads\/[^/]+$/.test(path) ||
      /^\/nades\/video-preview\/[\w-]{1,256}$/.test(path) ||
      /^\/map-scenes\/(?:files\/)?[\w.-]{1,96}$/.test(path))
  )
    action = "lineups.read";
  if (path.startsWith("/nades/review/") && !action) action = "lineups.moderate";
  return !!action && authorize(user, action);
}
