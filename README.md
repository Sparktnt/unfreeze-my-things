# Website

Static landing page for Unfreeze My Things, with the APK download. No build step: open
`index.html` or serve the folder (`python -m http.server` from here).

## Publishing on GitHub Pages

Create a repo named `<your-username>.github.io` and push the contents of this folder
(including `downloads/unfreeze-my-things.apk`) to it. The site goes live at
`https://<your-username>.github.io/`. A user site is used so `app-ads.txt` sits at the
domain root, where AdMob looks for it. Add that URL as the developer website in the Play
Console store listing.

## Shipping a new APK

1. Raise `versionCode` / `versionName` in `android/app/build.gradle`.
2. `npm run cap:sync`, then `gradlew assembleRelease` in `android/`.
3. Copy `android/app/build/outputs/apk/release/app-release.apk` to
   `downloads/unfreeze-my-things.apk`.
4. In `index.html`, update the version, the size (`MB`, three places) and the SHA-256
   (`sha256sum downloads/unfreeze-my-things.apk`).

This folder is its own git repo (the Pages repo); the game repo ignores it.
