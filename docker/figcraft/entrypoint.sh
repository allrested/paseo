#!/bin/bash
# Starts figcraft-server and Caddy in one container. FIGCRAFT_PUBLIC_URL (wss://host/) and
# FIGCRAFT_WEB_URL (https://host/app/) name this deploy. The server key lives in /data; read it
# with `docker exec figcraft figcraft-server --config /tmp/server.toml key`.
set -euo pipefail
: "${FIGCRAFT_PUBLIC_URL:?set FIGCRAFT_PUBLIC_URL, e.g. wss://figcraft.dev.mtapp.dev/}"
: "${FIGCRAFT_WEB_URL:?set FIGCRAFT_WEB_URL, e.g. https://figcraft.dev.mtapp.dev/app/}"

cp /etc/figcraft/server.toml /tmp/server.toml
printf 'public_url = "%s"\nweb_url = "%s"\n' "${FIGCRAFT_PUBLIC_URL}" "${FIGCRAFT_WEB_URL}" >>/tmp/server.toml

# The browser build names its server in a meta tag. Rewritten from the pristine copy on every
# start, so a restart does not add a second tag. Never put the key here: the page is public.
sed "s#<meta charset=\"utf-8\">#<meta charset=\"utf-8\"><meta name=\"figcraft-server\" content=\"${FIGCRAFT_PUBLIC_URL}\">#" \
  /srv/figcraft-web/index.html.orig >/srv/figcraft-web/index.html

figcraft-server --config /tmp/server.toml &
server=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
proxy=$!
trap 'kill -TERM "${server}" "${proxy}" 2>/dev/null' TERM INT
# Either one ending ends the container, so Docker's restart policy brings both back.
wait -n "${server}" "${proxy}" || true
kill -TERM "${server}" "${proxy}" 2>/dev/null || true
wait
