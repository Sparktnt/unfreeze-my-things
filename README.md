# Website

Static landing page for Unfreeze My Things, with the APK download. No build step: open
`index.html` or serve the folder (`python -m http.server` from here).

## Publishing on GitHub Pages

This folder is pushed to https://github.com/Sparktnt/unfreeze-my-things and served by
GitHub Pages (Settings → Pages → main / root) at https://sparktnt.github.io/unfreeze-my-things/.
To update the site, commit here and `git push`.

AdMob reads `app-ads.txt` from the domain root, which the separate `Sparktnt.github.io`
repo already serves; the copy here is just a spare.

## Shipping a new APK

1. Raise `versionCode` / `versionName` in `android/app/build.gradle`.
2. `npm run cap:sync`, then `gradlew assembleRelease` in `android/`.
3. Copy `android/app/build/outputs/apk/release/app-release.apk` to
   `downloads/unfreeze-my-things.apk`.
4. In `index.html`, update the version, the size (`MB`, three places) and the SHA-256
   (`sha256sum downloads/unfreeze-my-things.apk`).

## Browser demo (`play/`)

`play/` is the first 8 levels of the game, for iPhone and desktop visitors. It's generated:
after game changes, run `npm run build:demo` from the game repo (it rebuilds `play/` here),
then commit and push this repo.

This folder is its own git repo (the Pages repo); the game repo ignores it.
