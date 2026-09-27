# Enbox for Android

A native Android app (React Native + Expo, JavaScript) that mirrors the mobile web client
screen for screen: the same layouts, colours, light/dark themes, chat themes and wallpapers,
and the same features. It talks to the same Enbox server as the web app. The app uses the
server's REST API and Socket.IO events, and compiles the shared contracts
(`packages/shared`) straight from source.

## What's in it

- **Chats:**
  - Chat list with filters, search, pinned and archived chats, and starred messages.
  - Conversation with replies, reactions, edits, forwarding, pinning, selection, polls,
    locations, contacts, files, voice notes, photos and videos, disappearing messages and
    mentions.
  - All four bubble styles (classic, rounded, minimal, cozy).
- **Emoji panel:** it replaces the keyboard instead of covering it. On the mobile web, the
  picker opened on top of the soft keyboard in a fixed 8-column box. In the app:
  - The panel opens at the keyboard's height, so switching 😀 ⇄ ⌨ doesn't move the
    conversation.
  - The grid is responsive: the column count follows the screen width (phones, tablets,
    landscape, split screen).
  - Recents, keyword search (a compact strip above the keyboard), skin tones, a category bar
    that follows the scroll position, and a backspace key.
- **Info panels:**
  - Contact info: banner, media, starred messages, mute, disappearing messages, chat theme,
    groups in common, block, and clear/delete.
  - Group info: members, admin roles, add members, invite link, group settings and exit.
  - Channel info.
- **Updates:** status (text, photo and video; viewer, replies, privacy) and channels (feed,
  discover, create, follow, admin tools).
- **Communities:** home, announcements, groups, members, add/link groups, and create a
  community.
- **Calls:**
  - 1:1 and group voice/video calls over WebRTC (`react-native-webrtc`).
  - Incoming-call screen with ringtone and vibration.
  - Draggable picture-in-picture, a minimised call window, and a speaker/earpiece toggle.
  - Call history and "new call".
- **Settings:** account, privacy, chats (themes, wallpapers, animations), notifications,
  devices, storage, help, and profile (photo, banner, colours, bio, pronouns, share link).
- **Links:**
  - `/new`, `/archived`, `/starred`, `/u/<username>` and `/join/<code>` open inside the app.
  - Enbox links tapped in messages open in the app as well.

## Run it

```bash
cd mobile
npm install
npm run web        # quick preview in a browser (Expo web)
npm run android    # dev build on a device/emulator (needs the Android SDK)
```

When the app starts, pick the server on the sign-in screen with **Server**, for example
`https://chat.example.com` or `http://192.168.1.20:4000` on your LAN. It is saved on the
device. To bake in a default, set `EXPO_PUBLIC_API_URL` at build time:

```bash
EXPO_PUBLIC_API_URL=https://chat.example.com npm run build:apk
```

## Build the APK

`android/` is generated from `app.json` (Expo Continuous Native Generation) and is not
committed.

```bash
cd mobile
npm ci
npm run check:native   # every native module matches the Expo SDK version
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# → android/app/build/outputs/apk/release/app-release.apk (~70 MB)
```

`check:native` catches native modules installed at a version for a different Expo SDK. npm can
do that through a peer dependency, and such a module crashes the app on launch.

The `-PreactNativeArchitectures` flag limits the build to phone CPUs. Without it the APK also
carries x86/x86_64 libraries for PC emulators and is about twice the size.

Build requirements:

- JDK 17.
- The Android SDK, via `ANDROID_HOME` or `android/local.properties` with `sdk.dir=…`.

Signing:

- The generated project signs release builds with the debug keystore. That is fine for
  sideloading.
- For the Play Store, configure your own keystore in `android/app/build.gradle`, or build
  with EAS.

The [Android APK workflow](../.github/workflows/android.yml) builds the APK:

- It runs on every change under `mobile/` or `packages/shared/`.
- The APK is uploaded as the `enbox-android-apk` artifact.
- Run it manually (**Actions → Android APK → Run workflow**) to bake in a server address.

## Server notes

- Use HTTPS in production. Cleartext HTTP is allowed so you can test against a LAN server.
- Calls need a TURN server (`TURN_URLS` / `TURN_SECRET`) to connect reliably across mobile
  networks.
- Set `PUBLIC_URL` on the server so invite and profile links point at your domain. The app
  opens those links in-app.

## Differences from the web app

- **Notifications:**
  - The server only supports Web Push. The app shows local notifications for messages and
    calls while it is running (including in the background, until Android stops it).
  - There is no push delivery while the app is closed.
- **Calls:** there is no active-speaker highlight in group calls.
- **Links from outside the app:** Android doesn't open web links in the app. Invite and
  profile links shared outside the app open in the browser. In the app, the `enbox://`
  scheme (for example `enbox://join/<code>`) works.
