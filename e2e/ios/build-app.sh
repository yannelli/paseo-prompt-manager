#!/usr/bin/env bash
# Builds an unsigned Release Paseo.app for the iOS simulator from getpaseo/paseo at a tag.
# Usage: build-app.sh <paseo-version> <output-dir>
# JS is bundled into the app (Release), so no Metro server is needed at test time.
set -euo pipefail

version="${1:?paseo version}"
out="${2:?output dir}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${PASEO_SRC_DIR:-${RUNNER_TEMP:-/tmp}/paseo-src}"

rm -rf "$work"
git clone --depth 1 --branch "v${version}" https://github.com/getpaseo/paseo.git "$work"
cd "$work"

node "$here/patch-host.mjs" "$work"
node scripts/npm-retry.mjs ci
npm run build:app-deps

cd packages/app
export APP_VARIANT=production
export CI=1
npx expo prebuild --platform ios --non-interactive --no-install
(cd ios && pod install)

workspace="$(ls -d ios/*.xcworkspace | head -1)"
scheme="$(basename "$workspace" .xcworkspace)"
derived="$work/derived"

xcodebuild \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$derived" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  EXCLUDED_ARCHS=x86_64 \
  ONLY_ACTIVE_ARCH=NO \
  build >"$work/xcodebuild.log" 2>&1 || { tail -n 200 "$work/xcodebuild.log"; exit 1; }

app="$(find "$derived/Build/Products/Release-iphonesimulator" -maxdepth 1 -name '*.app' | head -1)"
test -n "$app" || { echo "no .app produced" >&2; exit 1; }
mkdir -p "$out"
rm -rf "$out"/*.app
cp -R "$app" "$out/"
echo "Built $(basename "$app")"
