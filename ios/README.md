# Day Loop — iOS App

WKWebView wrapper loading `dayloop.me`. Native feel, always up to date.

## Requirements
- Xcode 15+
- `xcodegen`: `brew install xcodegen`
- Apple Developer account (for device builds / TestFlight)

## Local development

```bash
cd ios
xcodegen generate          # creates DayLoop.xcodeproj
open DayLoop.xcodeproj     # opens in Xcode
```

Hit ▶ to run in Simulator or on a connected device.

## First-time setup in Xcode

1. Open `DayLoop.xcodeproj`
2. Select the `DayLoop` target → Signing & Capabilities
3. Set your Team (Apple Developer account)
4. Bundle ID is `me.dayloop.app` — change if needed
5. Add an AppIcon (1024×1024 PNG) to `Assets.xcassets/AppIcon.appiconset`

## OAuth deep linking

The app registers the `dayloop://` URL scheme. Add it as an allowed redirect URL in Supabase:
- Dashboard → Authentication → URL Configuration → Redirect URLs
- Add: `dayloop://auth/callback`

## Release to TestFlight

### Via GitHub Actions (recommended)
Add these secrets to your GitHub repo:
| Secret | How to get |
|--------|-----------|
| `IOS_CERTIFICATE_BASE64` | Export .p12 from Keychain, `base64 -i cert.p12` |
| `IOS_CERTIFICATE_PASSWORD` | Password you set on the .p12 |
| `IOS_PROVISION_PROFILE_BASE64` | Download from developer.apple.com, `base64 -i profile.mobileprovision` |
| `KEYCHAIN_PASSWORD` | Any random string |
| `APPLE_TEAM_ID` | 10-char ID from developer.apple.com |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | From appleid.apple.com → App-Specific Passwords |

Then tag and push:
```bash
git tag ios-v1.0.0
git push --tags
```

### Manually from Xcode
Product → Archive → Distribute App → App Store Connect → Upload

## After TestFlight upload

1. Go to App Store Connect → TestFlight
2. Add internal testers or create a public link
3. Update the TestFlight link in `components/Dashboard.jsx`:
   ```js
   href="https://testflight.apple.com/join/YOUR_CODE"
   ```
