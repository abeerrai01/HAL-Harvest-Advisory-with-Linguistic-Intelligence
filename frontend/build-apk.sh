#!/bin/bash

# Script to build APK using EAS
# This will build an APK for testing on Android devices

echo "🚀 Starting EAS Build for Android APK..."
echo ""
echo "This will:"
echo "1. Generate Android credentials (if needed)"
echo "2. Build the APK on EAS servers"
echo "3. Provide you with a download link"
echo ""

# Run the build command
npx eas-cli build --platform android --profile preview

echo ""
echo "✅ Build process initiated!"
echo "📱 Check your EAS dashboard or the build URL for progress"
echo "📥 Once complete, download the APK and install on your device"

