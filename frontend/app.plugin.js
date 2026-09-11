const { withInfoPlist } = require('@expo/config-plugins');

/**
 * Expo config plugin for LiveKit React Native
 * This plugin configures the necessary native dependencies for LiveKit
 */
const withLiveKit = (config) => {
  // Add iOS Info.plist permissions
  config = withInfoPlist(config, (config) => {
    // Microphone permission (already in app.json, but ensure it's set)
    if (!config.modResults.NSMicrophoneUsageDescription) {
      config.modResults.NSMicrophoneUsageDescription = 
        'We need microphone access to let you ask questions by voice for pest & disease advisory.';
    }
    
    // Camera permission (for future use)
    if (!config.modResults.NSCameraUsageDescription) {
      config.modResults.NSCameraUsageDescription = 
        'We need camera access for video features.';
    }
    
    return config;
  });

  return config;
};

module.exports = withLiveKit;
