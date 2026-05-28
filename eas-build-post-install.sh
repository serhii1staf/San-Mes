#!/bin/bash
# Xcode 26 workaround: patch fmt to disable FMT_USE_CONSTEVAL
# EAS runs this script after pod install, before xcodebuild

echo "=== Running eas-build-post-install.sh ==="
echo "Current directory: $(pwd)"

# Find and patch fmt/base.h
find . -path "*/fmt/include/fmt/base.h" -exec sh -c '
  echo "Found: $1"
  sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" "$1"
  echo "Patched: $1"
' _ {} \;

# Also try format.h and core.h (older versions)
find . -path "*/fmt/include/fmt/format.h" -exec sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" {} \;
find . -path "*/fmt/include/fmt/core.h" -exec sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" {} \; 2>/dev/null

echo "=== Done patching fmt ==="
