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

# A single 1024 for the watch too, which Xcode derives every size from.
#
# A full sixteen-size watchOS set was tried and reverted: it was written to fix
# the grey placeholder in the ongoing-session indicator at the top of the watch
# face, and it did not. The icon was already correct in the app grid, in
# Fitness, and on the iPhone — so that indicator is not reading our asset at
# all. Most likely a development-signed app never reaches that surface, since
# it skips the App Store processing that populates paired-device metadata.
#
# Left as one file rather than seventeen, since the seventeen bought nothing.

# ── Launch screen ────────────────────────────────────────────────────────────
#
# The shell loads the web app over the network, so there is a real gap between
# tapping the icon and the first paint — longer than a local app, and longer
# still on a cold cellular connection. Without a launch screen that gap is a
# blank window, which reads as a hang.
#
# A storyboard rather than a static image: one asset cannot fit every device,
# and iOS stopped accepting per-size launch images long ago. The logo sits at a
# fixed 200pt, centred, over the app's own background colour, so it is correct
# on every screen without a single device-specific file.
#
# The image is the wordmark lifted from the PWA's own splash screens, at native
# resolution, so the native shell and the installed PWA open identically.

catalog="$here/ios/App/App/Assets.xcassets"
storyboard="$here/ios/App/App/Base.lproj/LaunchScreen.storyboard"

if [ -d "$catalog" ]; then
  set="$catalog/Splash.imageset"
  mkdir -p "$set"
  # Capacitor ships its own splash-2732x2732*.png in here. Left behind they are
  # unreferenced by the Contents.json below — dead weight in the bundle, and
  # confusing to anyone reading the catalogue later.
  rm -f "$set"/*.png
  cp "$here/icon/Splash.png" "$here/icon/Splash@2x.png" "$here/icon/Splash@3x.png" "$set/"
  cat > "$set/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "Splash.png",    "idiom" : "universal", "scale" : "1x" },
    { "filename" : "Splash@2x.png", "idiom" : "universal", "scale" : "2x" },
    { "filename" : "Splash@3x.png", "idiom" : "universal", "scale" : "3x" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
  echo "installed: $set"
fi

if [ -f "$storyboard" ]; then
  # Keep Capacitor's original once, so a bad edit is recoverable without
  # regenerating the whole project.
  [ -f "$storyboard.orig" ] || cp "$storyboard" "$storyboard.orig"

  cat > "$storyboard" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="22154" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <dependencies>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="22131"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" horizontalHuggingPriority="251" verticalHuggingPriority="251" image="Splash" translatesAutoresizingMaskIntoConstraints="NO" id="spl-as-h01">
                                <rect key="frame" x="96.5" y="345" width="200" height="162"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="200" id="spl-wid"/>
                                    <constraint firstAttribute="height" constant="162" id="spl-hei"/>
                                </constraints>
                            </imageView>
                        </subviews>
                        <viewLayoutGuide key="safeArea" id="Bcu-3y-fUS"/>
                        <color key="backgroundColor" red="0.011764705882352941" green="0.027450980392156863" blue="0.070588235294117646" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <constraints>
                            <constraint firstItem="spl-as-h01" firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX" id="spl-ctx"/>
                            <constraint firstItem="spl-as-h01" firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY" id="spl-cty"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="0.0" y="0.0"/>
        </scene>
    </scenes>
    <resources>
        <image name="Splash" width="200" height="162"/>
    </resources>
</document>
XML
  echo "installed: $storyboard (original kept at $storyboard.orig)"
fi

echo "Done. Clean the build folder (Shift-Cmd-K) if Xcode keeps showing the old icon."
