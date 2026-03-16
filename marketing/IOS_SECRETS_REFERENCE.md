# iOS Build Secrets Reference

## Reusable across all apps (same Apple Developer account)

| Secret | Value | Where to find |
|--------|-------|---------------|
| `IOS_P12_BASE64` | Base64 of your Apple Distribution .p12 cert | Keychain Access → export cert → `base64 -w 0 cert.p12` |
| `IOS_P12_PASSWORD` | `Faith12#` | Password set when exporting .p12 |
| `IOS_TEAM_ID` | `7P9RL25WP5` | developer.apple.com → Account → Membership |
| `APPSTORE_ISSUER_ID` | *(your issuer ID)* | App Store Connect → Users and Access → Integrations → Keys (top of page) |
| `APPSTORE_KEY_ID` | *(your key ID)* | Same page, short ID next to your key name |
| `APPSTORE_PRIVATE_KEY` | Full .p8 text including BEGIN/END lines | Created once in App Store Connect, download is one-time |

## Per-app (must create new for each app)

| Secret | How to create |
|--------|---------------|
| `IOS_PROVISION_PROFILE_BASE64` | 1. Register App ID at developer.apple.com/account/resources/identifiers<br>2. Create App Store Distribution profile at developer.apple.com/account/resources/profiles<br>3. Download .mobileprovision<br>4. `base64 -w 0 profile.mobileprovision > output.txt` |
| `IOS_PROVISION_PROFILE_NAME` | The name you gave the profile (e.g. `SpawnWars_AppStore`) |

## Also needed per app (not secrets)

- **App icon**: 1024x1024 PNG, RGB, no transparency → `public/icons/app-icon-1024.png`
- **App Store Connect listing**: Create at appstoreconnect.apple.com with matching bundle ID
- **capacitor.config.ts**: Set `appId` to match bundle ID
- **ExportOptions.plist in workflow**: Update bundle ID in provisioning profiles dict

## Current values for reference

| App | Bundle ID | Profile Name |
|-----|-----------|-------------|
| Sling Party | `com.krool.slingparty` | `SlingParty_AppStore` |
| Lanecraft | `com.krool.spawnwars` | `SpawnWars_AppStore` |

## P12 cert expiry

The Apple Distribution cert expires **2027-03-04**. When you renew, update `IOS_P12_BASE64` and `IOS_P12_PASSWORD` in all app repos.
