#!/bin/bash
# Xcode 26 workaround: patch fmt to disable FMT_USE_CONSTEVAL
# EAS runs this script after npm install + expo prebuild + pod install, before xcodebuild

echo "=== Running eas-build-post-install.sh ==="
echo "Current directory: $(pwd)"

PATCHED=0

# Find ALL base.h files related to fmt (follow symlinks, only patch real files)
find . -name "base.h" -path "*/fmt*" | while read -r FILE; do
  # Resolve symlink to real file
  REAL_FILE=$(realpath "$FILE" 2>/dev/null || readlink -f "$FILE" 2>/dev/null || echo "$FILE")
  
  if [ -f "$REAL_FILE" ] && grep -q "define FMT_USE_CONSTEVAL 1" "$REAL_FILE"; then
    sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" "$REAL_FILE"
    echo "Patched: $REAL_FILE (from $FILE)"
    PATCHED=$((PATCHED + 1))
  fi
done

# Also directly patch the known location in React Native source
RN_FMT="./node_modules/react-native/ReactCommon/fmt/include/fmt/base.h"
if [ -f "$RN_FMT" ]; then
  sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" "$RN_FMT"
  echo "Patched RN source: $RN_FMT"
fi

# Patch in ios/Pods if it exists (the actual source, not symlinks)
if [ -d "ios/Pods" ]; then
  find ios/Pods -name "base.h" -not -type l | while read -r FILE; do
    if grep -q "define FMT_USE_CONSTEVAL 1" "$FILE"; then
      sed -i "" "s/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/g" "$FILE"
      echo "Patched Pods file: $FILE"
    fi
  done
fi

# Verify patch
echo ""
echo "=== Verification ==="
find . -name "base.h" -path "*/fmt*" -not -type l -exec grep -l "FMT_USE_CONSTEVAL" {} \; 2>/dev/null | head -5
echo "=== Done patching fmt ==="
