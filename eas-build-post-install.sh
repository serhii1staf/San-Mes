#!/bin/bash
# Xcode 26 workaround: patch fmt to disable FMT_USE_CONSTEVAL
# This fixes the "call to consteval function" build error

FMT_BASE="ios/Pods/fmt/include/fmt/base.h"

if [ -f "$FMT_BASE" ]; then
  echo "Patching fmt for Xcode 26 compatibility..."
  sed -i '' 's/#  define FMT_USE_CONSTEVAL 1/#  define FMT_USE_CONSTEVAL 0/' "$FMT_BASE"
  echo "fmt patched successfully"
else
  echo "fmt/base.h not found, skipping patch"
fi
