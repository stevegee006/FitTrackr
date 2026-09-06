#!/bin/sh
#
# Install the app icon into both asset catalogues.
#
# The generated Xcode project (apps/ios/ios) is gitignored, so anything done to
# it by hand is lost the moment it is regenerated. This script is the durable
# form of "set the app icon": the source PNG lives in the repo, and this puts it
# where Xcode expects on demand.
#
# The source MUST be 1024x1024, square, full-bleed, and WITHOUT an alpha
# channel:
#
#   - iOS applies its own squircle mask. An icon with its own rounded corners
#     and transparency outside them renders with black corners poking past the
#     mask, which looks like a bug and is easy to miss on a dark home screen.
#   - App Store validation rejects alpha outright.
#
# apps/ios/icon/AppIcon-1024.png is generated from
# packages/web/public/icons/icon-512.png with the corners filled in, so the two
# stay recognisably the same icon.
#
# Usage: sh apps/ios/scripts/install-icons.sh   (from the repo root or apps/ios)

set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/icon/AppIcon-1024.png"

[ -f "$src" ] || { echo "missing $src" >&2; exit 1; }

install_icon() {
  catalog=$1
  platform=$2

  if [ ! -d "$catalog" ]; then
    echo "skip (no catalogue): $catalog"
    return
  fi

  set=$catalog/AppIcon.appiconset
  mkdir -p "$set"
  cp "$src" "$set/AppIcon-1024.png"

  cat > "$set/Contents.json" <<JSON
{
  "images" : [
    {
      "filename" : "AppIcon-1024.png",
      "idiom" : "universal",
      "platform" : "$platform",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSON
  echo "installed: $set"
}

install_icon "$here/ios/App/App/Assets.xcassets" ios
install_icon "$here/ios/App/FitTrackrWatch Watch App/Assets.xcassets" watchos

echo "Done. Clean the build folder (Shift-Cmd-K) if Xcode keeps showing the old icon."
