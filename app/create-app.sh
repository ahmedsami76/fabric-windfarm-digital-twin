#!/usr/bin/env bash
# Creates the Fabric app of Phase 4 next to this script, in app/windfarm-twin, from three parts:
#   1. the Universal App template of Rayfin, written by Microsoft's scaffolder at a pinned version,
#   2. the functions pack of that template,
#   3. the files of app/overlay: the 3D twin, its panels and its four functions.
# Nothing here touches Fabric. Deploying is the next step: docs/11-deployment-guide-phase4.md.
#
#   bash app/create-app.sh             create the app, or bring an existing app/windfarm-twin up to date
#   bash app/create-app.sh --overlay   only copy the files of app/overlay again (after a repository update)
#
# Run it on the workstation, as yourself (not with sudo). It needs Node.js 22.13 or newer.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/windfarm-twin"
RAYFIN_VERSION="${RAYFIN_VERSION:-2.0.1}"   # the version the overlay was written and checked against
THREE_VERSION="0.187.0"
MODE="${1:-all}"

say()  { printf '\n==> %s\n' "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

case "$MODE" in all|--overlay) ;; *) stop "Unknown option $MODE. Use no option, or --overlay.";; esac
[[ -z "${SUDO_USER:-}" ]] || stop "Do not run this with sudo: the app would belong to root and the sign-in of Rayfin would be root's."

copy_overlay() {
  [[ -f "$APP/rayfin/rayfin.yml" ]] || stop "$APP is not a Rayfin project (no rayfin/rayfin.yml)."
  [[ -d "$APP/packages/functions" ]] || stop "$APP has no packages/functions. Run this script without --overlay."
  cp -R "$HERE/overlay/." "$APP/"
  # The tab of the browser: the template calls every app "Fabric App".
  if [[ -f "$APP/packages/frontend/index.html" ]]; then
    sed -i.bak 's|<title>Fabric App</title>|<title>Northwind Ridge Wind Farm</title>|' "$APP/packages/frontend/index.html" && rm -f "$APP/packages/frontend/index.html.bak"
  fi
  echo "Copied the twin into ${APP#"$HERE"/}: packages/frontend/src/App.tsx, packages/frontend/src/twin, packages/functions/src."
}

if [[ "$MODE" == "--overlay" ]]; then
  say "Copying the files of app/overlay"
  copy_overlay
  echo "Now run, in $APP: npm run typecheck, then npx rayfin up"
  exit 0
fi

say "Checking Node.js and npm"
command -v node >/dev/null || stop "Node.js is not installed. Install version 22.13 or newer (https://nodejs.org), then run this again."
NODE_VERSION="$(node --version)"; NODE_VERSION="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_VERSION%%.*}"; NODE_REST="${NODE_VERSION#*.}"; NODE_MINOR="${NODE_REST%%.*}"
if (( NODE_MAJOR < 22 )) || (( NODE_MAJOR == 22 && NODE_MINOR < 13 )); then
  stop "Node.js $NODE_VERSION is too old: the Rayfin template needs 22.13 or newer."
fi
NPM_VERSION="$(npm --version)"
echo "Node.js $NODE_VERSION, npm $NPM_VERSION"
if (( ${NPM_VERSION%%.*} < 11 )); then
  echo "Note: with npm 10.9.9 the install of this template stopped with \"Cannot read properties of null (reading 'edgesOut')\""
  echo "      when it was tried for this guide; npm 12 installed it. If you see that message: npm install -g npm@latest"
fi

if [[ -f "$APP/rayfin/rayfin.yml" ]]; then
  say "Found an existing app in ${APP#"$HERE"/}: keeping it"
else
  [[ ! -e "$APP" ]] || stop "$APP exists but is not a Rayfin project. Move it away, then run this again."
  say "Creating the app from the Rayfin template (create-rayfin $RAYFIN_VERSION)"
  echo "If it asks a question, accept what it proposes."
  (cd "$HERE" && npx -y "@microsoft/create-rayfin@$RAYFIN_VERSION" --project-name windfarm-twin --template blankapp)
  [[ -f "$APP/rayfin/rayfin.yml" ]] || stop "The scaffolder ended without creating $APP/rayfin/rayfin.yml. Send me what it printed."
fi

if [[ -d "$APP/packages/functions" ]]; then
  say "The functions pack is already there"
else
  [[ -f "$APP/scripts/scaffold.mjs" ]] || stop "This app has no scripts/scaffold.mjs: it was not made from the Universal App template (blankapp)."
  say "Adding the functions pack of the template"
  (cd "$APP" && npm run pack:add -- functions)
  [[ -d "$APP/packages/functions" ]] || stop "The functions pack did not create packages/functions. Send me what it printed."
fi

say "Copying the files of app/overlay"
copy_overlay

if grep -q '"three"' "$APP/packages/frontend/package.json"; then
  say "three.js is already a dependency"
else
  say "Adding three.js $THREE_VERSION to the frontend"
  (cd "$APP" && npm install --no-audit --no-fund -w @rayfin-app/frontend "three@$THREE_VERSION")
  (cd "$APP" && npm install --no-audit --no-fund -D -w @rayfin-app/frontend "@types/three@$THREE_VERSION")
fi

say "Checking the app: functions against their generated types, then every package with the compiler"
if ! (cd "$APP" && npm run typecheck); then
  stop "The check failed, so the app is not ready to deploy. The lines above name the file. Send them to me."
fi

cat <<EOF

The app is ready in ${APP#"$HERE"/}. It has not been deployed. Next, from that folder:

  cd "$APP"
  npx rayfin login
  npx rayfin up --workspace WindFarmDigitalTwin --item-name WindFarmTwin

docs/11-deployment-guide-phase4.md, step 4, goes on from here.
EOF
