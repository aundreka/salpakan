# Salpakan

A two-player, browser-only Game of the Generals. Create a room, share the five-letter code, and play.
Static site on GitHub Pages; rooms live in a Firebase Realtime Database on the free tier.

Live: https://aundreka.github.io/salpakan/

## Develop

```sh
npm install
cp .env.example .env.local   # paste your Firebase web config as one JSON object
npm run dev                  # http://localhost:5173/salpakan/
npm test                     # rules engine tests
npm run build                # type-check + production build into dist/
```

Without `VITE_FIREBASE_CONFIG` the site still runs: the practice mode against the bot works, online rooms are disabled.

## Firebase setup (one time)

1. Create a project and a **Realtime Database**.
2. **Authentication → Sign-in method → Anonymous → Enable.**
3. **Realtime Database → Rules**: paste the contents of `database.rules.json` and publish.
4. **Project settings → Your apps → Web app**: copy the config object, add `databaseURL`, and put it in `.env.local` as `VITE_FIREBASE_CONFIG`.
5. For deploys, store the same JSON as the repository secret `VITE_FIREBASE_CONFIG`.

## How it works

- `src/engine` is the pure rules engine (board, moves, challenge resolution, win conditions). Fully unit-tested.
- `src/net` turns a room into an append-only message log. Both clients derive state only from that log, so a page reload is a replay. Own piece ranks never travel over the wire except the two involved in a challenge.
- `src/ui` renders the board as SVG with keyed piece elements so moves animate, plus the home, lobby, setup and play screens.
- `src/assets/sprite.ts` holds the 15 insignia as SVG symbols; `src/style.css` is the whole visual theme.

## Deploy

Pushing to `main` runs tests, builds, and publishes `dist/` to GitHub Pages via `.github/workflows/deploy.yml`.
