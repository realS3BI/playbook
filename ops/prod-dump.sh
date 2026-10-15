#!/bin/sh
# Forced command for the read-only key used by pull-prod.mjs. Only three requests are allowed:
#   mongo     gzip mongodump archive of the Playbook database, without sessions
#   uploads   tar of the uploaded lineup images
#   nades     tar of the MatchZy lineup files the nades sync imports into MongoDB
set -eu

fail() { echo "prod-dump: $*" >&2; exit 1; }

only() {
  ids=$(docker ps -q "$@")
  [ -n "$ids" ] || fail "Container nicht gefunden ($*)."
  [ "$(echo "$ids" | wc -l)" -eq 1 ] || fail "Mehrere Container gefunden ($*)."
  echo "$ids"
}

app=$(only --filter label=com.docker.compose.service=admin-panel)
project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$app")
mongo=$(only --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=mongodb)

case "${SSH_ORIGINAL_COMMAND:-${1:-}}" in
  mongo) exec docker exec "$mongo" mongodump --quiet --db=cs2_admin_panel --excludeCollection=sessions --archive --gzip ;;
  uploads) exec docker exec -w /uploads "$app" tar -cf - . ;;
  nades) exec docker exec -w /cs2-data/game/csgo/cfg/MatchZy "$app" sh -c \
    'tar -cf - $(ls savednades.json savednades.captures.json savednades.capture-receipts.json savednades.maps.json savednades.metadata.json 2>/dev/null)' ;;
  *) fail "Erlaubt sind nur: mongo, uploads, nades." ;;
esac
