# Building iOS App on Physical Device

## Prerequisites

1. **Install Xcode** (from App Store - ~12-15 GB)
2. **Open Xcode once** to accept license and install components
3. **Set command line tools:**
   ```bash
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   ```
4. **Add Apple ID to Xcode:**
   - Open Xcode → Settings (⌘,) → Accounts
   - Click "+" → Add Apple ID
   - Sign in with your Apple ID (free account works)

## Steps to Build on Physical Device

### 1. Connect Your iPhone
- Connect iPhone via USB cable
- Unlock your iPhone
- Trust this computer if prompted

### 2. Build and Install
```bash
# Navigate to project directory
cd hal-app

# Build and install on connected device
npx expo run:ios --device
```

### 3. First Time Setup on iPhone
- If prompted, go to: **Settings → General → VPN & Device Management**
- Trust your developer certificate
- The app will launch automatically

### 4. Trust Developer Certificate (if needed)
On your iPhone:
1. Settings → General → VPN & Device Management
2. Find your Apple ID/Developer certificate
3. Tap "Trust [Your Name]"
4. Confirm

## Troubleshooting

### "No devices found"
- Make sure iPhone is connected via USB
- Unlock your iPhone
- Trust the computer on iPhone
- Try: `xcrun xctrace list devices` to see connected devices

### "Signing for [App] requires a development team"
- Open Xcode → Settings → Accounts
- Select your Apple ID → Download Manual Profiles
- Or set team in Xcode project settings

### "Could not find Developer Disk Image"
- Update Xcode to match your iOS version
- Or update your iPhone iOS version

### Build fails with LiveKit errors
- Make sure you've run: `npx expo prebuild --clean`
- Or delete `ios` folder and rebuild

## Alternative: Use iOS Simulator

If you don't have a physical device or want to test quickly:

```bash
npx expo run:ios
```

This will:
- Build for iOS Simulator
- Launch simulator automatically
- Install and run the app

## Notes

- **First build takes 5-15 minutes** (installs dependencies)
- **Subsequent builds are faster** (1-3 minutes)
- **You need to rebuild** if you change native code or add new native modules
- **For LiveKit to work**, you MUST use a development build (not Expo Go)

