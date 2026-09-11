# Salpakan — Implementation Plan

A browser-only, two-player **Game of the Generals** (Salpakan) hosted on GitHub Pages.
No servers we operate. A player creates a room and gets a 5-letter code; a friend joins by
typing the code or opening a share link. All art is AI-generated SVG, hand-authored as
vector code, built on one shared insignia set so the visual style can be swapped with CSS.

Status: **v1 built (2026-09-11)**, deploying to https://aundreka.github.io/salpakan/. Decisions below are locked; see §8 for what remains.

---

## 1. Decisions (locked 2026-09-11)

Chosen: Firebase Realtime Database, Flat Tactical on a lighter warm-grey board, title **Salpakan**, repo `aundreka/salpakan`, turn timer in v1 (no spectators), flag wins on reaching the far row by default with the tournament rule as a room setting.

| # | Decision | Options | Outcome |
|---|----------|---------|----------------|
| 1 | **Networking on static hosting** | A. PeerJS (WebRTC) via free public signaling. B. Firebase Realtime Database free tier. C. Trystero (WebRTC, signaling over public torrent trackers / Nostr). | **B. Firebase.** Most reliable, works on every network, reconnection and presence for free, spectators are trivial. Costs a 5-minute Firebase project setup with a Google account. A or C if you want zero accounts at all, accepting ~5–10% of connections failing without a TURN relay. Built behind a `Transport` interface either way, so it is a one-file swap. |
| 2 | **Hidden-information fidelity** | A. Clients exchange only the two ranks involved in a challenge; UI shows only the outcome. B. Commit-reveal hashes on top of A so a cheater is detected. C. A true third-party arbiter (tiny serverless function) so ranks never reach the opponent's device. | **A for v1, B as a later milestone.** C means running something outside GitHub Pages. With A and B a determined player can read the opponent's rank in devtools during a challenge only. Fine for friends. |
| 3 | **Art style** | Flat Tactical / Soft Tabletop / Neon Command. Samples in `design/art-styles.html`. | **Flat Tactical.** Cleanest read at phone sizes, fastest to produce, easiest to keep consistent across 15 ranks and UI. |
| 4 | **Team colors** | Traditional white vs black, or two hues. | Two hues (navy vs crimson in the flat sample). Better contrast on any board color. |
| 5 | **Flag-reaches-last-row rule** | Immediate win, or win only if it survives the opponent's next turn. | Tournament rule: immediate win if no enemy piece is adjacent, otherwise it must survive one opponent turn. Exposed as a room setting. |
| 6 | **Extras in scope for v1** | Turn timer, spectators, chat, rematch, move log, sounds, bot opponent. | Rematch and move log in v1. Timer and spectators in polish. Bot and chat out of scope unless requested. |
| 7 | **Title** | "Game of the Generals" is a registered trademark (Sofronio Pasola). | Ship as **Salpakan** or a custom name, described as "a Game of the Generals–style strategy game". |
| 8 | **Repo** | `~/gog` is empty and sits inside the home-dir git repo (remote: an unrelated HPL-MIP project). | `git init` inside `gog` as its own repo, push to a new personal GitHub repo, enable Pages via Actions. |
| 9 | **Stack** | Vanilla TS, Preact, Svelte, React. | Vite + TypeScript, no UI framework. Board and pieces rendered as SVG/DOM. Small enough that a framework adds more than it saves. |

---

## 2. Rules the engine implements

**Board.** 9 columns × 8 rows, uniform squares (no checker pattern). Each side sets up on its
own 3 back rows (27 squares) with 21 pieces in any arrangement. Six squares stay empty.

**Pieces (21 per side).**

| Code | Piece | Count | Insignia |
|------|-------|-------|----------|
| G5 | 5-star General | 1 | 5 stars |
| G4 | 4-star General | 1 | 4 stars |
| G3 | 3-star General | 1 | 3 stars |
| G2 | 2-star General | 1 | 2 stars |
| G1 | 1-star General | 1 | 1 star |
| COL | Colonel | 1 | 3 sun-triangles |
| LTC | Lt. Colonel | 1 | 2 sun-triangles |
| MAJ | Major | 1 | 1 sun-triangle |
| CPT | Captain | 1 | 3 bars |
| LT1 | 1st Lieutenant | 1 | 2 bars |
| LT2 | 2nd Lieutenant | 1 | 1 bar |
| SGT | Sergeant | 1 | 3 chevrons |
| PVT | Private | 6 | 1 chevron |
| SPY | Spy | 2 | two eyes |
| FLG | Flag | 1 | flag |

**Movement.** Any piece moves exactly one square orthogonally onto an empty square or onto an
enemy piece (a challenge). No diagonals, no jumping. Players alternate; first mover is decided
by a fair coin flip seeded from both players' nonces.

**Challenge resolution** (`resolveChallenge(attacker, defender)`):

- Higher rank eliminates lower. Order: G5 > G4 > G3 > G2 > G1 > COL > LTC > MAJ > CPT > LT1 > LT2 > SGT > PVT.
- **Spy** eliminates every officer (SGT through G5) and the Flag. **Private** eliminates the Spy.
- **Equal ranks:** both eliminated.
- **Flag vs Flag:** the attacking flag wins.
- **Any piece vs Flag:** the flag is captured.
- Only the outcome is shown to the players, not the ranks.

**Win conditions** (`checkWin`):

1. Opponent's flag is captured.
2. Your flag reaches the opponent's back row and either no enemy piece is adjacent to it, or it survives the opponent's next turn.
3. Opponent resigns, disconnects past the grace period, or runs out of clock (if timer enabled).
4. Opponent has no legal move (extremely rare; counted as a loss for them).

**Setup validation.** Exactly 21 pieces with the counts above, all inside the owner's 3 rows.

---

## 3. Architecture

```
gog/
  index.html
  vite.config.ts               # base: '/<repo-name>/'
  src/
    engine/                    # pure functions, zero DOM, fully unit-tested
      types.ts                 # Team, Rank, Piece, Pos, State, Move
      rules.ts                 # RANK_ORDER, resolveChallenge, legalMoves
      state.ts                 # createGame, applyMove, checkWin, validateSetup
      random.ts                # seeded RNG for fair coin flip, random setup
    net/
      transport.ts             # interface Transport { host(), join(code), send(), onMessage() }
      firebase.ts              # RTDB implementation
      peer.ts                  # PeerJS implementation (fallback / optional)
      protocol.ts              # message types + validation + room-code generator
      session.ts               # glue: turns local intents into messages, remote messages into engine calls
    ui/
      app.ts                   # screen router: home → lobby → setup → play → end
      board.ts                 # SVG board, cells, pieces, highlights, animations
      setup.ts                 # placement UI, presets, shuffle, remember last setup
      hud.ts                   # turn indicator, captured tray, move log, timer
      screens/                 # home, lobby (code + share link), end/rematch
    assets/
      sprite.svg               # <symbol> per insignia + tile faces + UI icons
      theme.css                # CSS custom properties per style + team
      logo.svg, favicon.svg, og.png
    main.ts
  design/
    art-styles.html            # the three style proposals (this exploration)
  tests/
    engine/*.test.ts           # Vitest
  .github/workflows/deploy.yml # build + deploy to Pages on push to main
```

**Layer rule:** `engine` imports nothing. `net` imports `engine` types only. `ui` imports both.
Same engine runs on both clients; each client validates every incoming move before applying it
and compares a state hash each turn to catch desync.

### 3.1 Game state machine

```
home ──create──▶ lobby(host, waiting) ──peer joined──▶ setup
home ──join(code)──▶ lobby(guest) ─────────────────────▶ setup
setup (both placing; each presses Ready) ──both ready──▶ playing
playing: turn A ⇄ turn B, sub-state awaitingReveal during a challenge
playing ──flag captured | flag home | resign | timeout──▶ ended
ended ──both accept rematch──▶ setup (teams swap)
any ──peer disconnect──▶ reconnecting (60 s grace) ──▶ resume | ended(forfeit)
```

### 3.2 Message protocol (JSON, versioned)

| Message | Sender | Payload |
|---------|--------|---------|
| `hello` | both | `{ name, protocolVersion, nonce }` |
| `seat` | host | `{ yourTeam, firstMoverSeed }` |
| `ready` | both | `{ pieceIds: string[27] \| null[] }` — positions carry opaque piece ids, never ranks |
| `move` | mover | `{ turn, from, to, stateHash }` |
| `reveal` | both | `{ turn, pieceId, rank }` — sent only when the move is a challenge; both sides reveal the one piece involved |
| `resign` / `rematchOffer` / `rematchAccept` | either | `{}` |
| `ping` / `pong` | both | `{ t }` for presence when transport lacks it |

Milestone 6 adds `commit: { pieceId, sha256(rank + salt) }[]` alongside `ready`, and `salt`
to `reveal`, so a false reveal is detected and treated as a forfeit.

### 3.3 Room codes and links

- Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), 5 characters, ~33M combinations.
- Firebase: room lives at `/rooms/<CODE>` with security rules that allow writes only from the two
  seated anonymous-auth users, and a TTL cleanup of rooms older than 24 h.
- PeerJS variant: host peer id is `salpakan-<CODE>`.
- Share link: `https://<user>.github.io/<repo>/?room=ABCDE` auto-opens the join flow.

### 3.4 Rendering and input

- Board is one `<svg>` with a `<g>` per cell; pieces are `<use href="#insignia-G5">` inside a
  tile group. CSS transitions on `transform` animate moves (150 ms). Hidden enemy pieces render
  the team's tile back.
- Input: tap piece → legal squares highlight → tap destination. Drag also supported via pointer
  events. Keyboard: arrows + Enter, for accessibility and because it is nearly free with DOM.
- **Mobile:** the board stays 9 wide and shrinks; rank labels hide under ~460 px of board width.
  Rotating to 8 × 9 was dropped: the gain is one cell size and it puts "your side" on an edge.
- Setup screen: your 3 rows highlighted, a tray of 21 pieces, tap-to-place, plus **Random**,
  **Clear**, two presets, and "remember my last setup" in `localStorage`.

### 3.5 Build, test, deploy

- Vite + TypeScript. Vitest for the engine: full 15×15 challenge matrix, flag rules, move
  legality, setup validation, win detection. Optional Playwright two-tab smoke test for rooms.
- GitHub Actions: on push to `main`, `npm ci && npm run build`, upload `dist`, deploy to Pages.
- No runtime dependencies besides the transport SDK (Firebase modular SDK, tree-shaken, or PeerJS).

---

## 4. Art direction

### 4.1 System, not pictures

Every piece is **one insignia glyph + one tile face**. The 15 insignia are drawn once as SVG
symbols using `currentColor`; team and style are CSS custom properties. Switching from one
proposed style to another is a stylesheet change, not a redraw. The samples page is built
exactly this way, so it doubles as the rendering prototype.

### 4.2 Three proposals (see `design/art-styles.html`)

| Style | Look | Mood | Effort | Watch out for |
|-------|------|------|--------|---------------|
| **1. Flat Tactical** (recommended) | Saturated team tiles, gold/ivory filled insignia, hard offset shadow, sand board with thin grid | Board-game app, confident, friendly | Lowest | Can feel generic if the UI chrome is not equally considered |
| **2. Soft Tabletop** | Ivory vs charcoal tokens with sheen and soft drop shadow on a deep-green felt board | Premium physical set, calm | Medium | Lower contrast for the ivory team on light backgrounds; needs care on phones |
| **3. Neon Command** | Dark slate, thin-line insignia with cyan vs coral glow, grid like a war-room table | Tactical, techy, dramatic | Medium | Dark UI everywhere, thin lines get faint at small sizes |

### 4.3 Asset inventory (all SVG unless noted)

- 15 insignia glyphs (shared across teams and styles).
- Tile faces: team A, team B, hidden back A, hidden back B, captured-tray mini variant.
- Board: base, grid, setup-zone tint, selected cell, legal-move dot, challenge target ring,
  last-move trail, flag-goal row marker.
- Effects: clash burst, capture fade, flag-home celebration.
- UI: logo and wordmark, favicon, 1200×630 share image (PNG rendered from SVG), ~10 icons
  (copy, share, settings, sound, help, resign, rematch, flip, back, close), buttons and panels.
- Background: subtle gradient or pattern behind the board.
- Sound (optional, no files): short WebAudio-synthesized clicks for move, clash, win.

---

## 5. Milestones

Each milestone ends with something deployed and clickable on Pages.

| # | Milestone | Deliverable | Done when |
|---|-----------|-------------|-----------|
| M0 | **Repo and deploy skeleton** | `git init`, Vite + TS, Pages workflow, "hello board" live | Pushing to `main` updates the live URL |
| M1 | **Rules engine** | `src/engine` with full test suite | All tests green; 100% of challenge matrix covered |
| M2 | **Local hotseat UI** | Setup screen, board, moves, challenges, win screen, placeholder art | Two people can finish a game on one device |
| M3 | **Art pass** | Chosen style applied: sprite, board, tiles, UI chrome, logo, favicon, animations | No placeholder art remains; looks right on phone and desktop |
| M4 | **Multiplayer rooms** | Create/join by code, share link, lobby, synced game, resign, rematch, reconnection grace | Two devices on different networks finish a game |
| M5 | **Polish** | Mobile layout, captured tray, move log, turn timer, how-to-play, sounds, share image | Friends can play without explanation |
| M6 | **Optional** | Commit-reveal anti-cheat, spectators, PeerJS fallback, simple bot for solo play | Each as requested |

---

## 6. Risks

- **WebRTC connectivity** (only if PeerJS/Trystero is chosen): symmetric NAT and the public
  signaling server. Mitigation: Open Relay free TURN, or choose Firebase.
- **Client-side arbitration**: ranks are visible in devtools during a challenge. Mitigation:
  commit-reveal (M6); a real arbiter needs a server.
- **Firebase key in client**: normal for Firebase; enforce security rules and room TTL so the
  free quota cannot be drained by strangers.
- **Trademark**: do not title the app "Game of the Generals". Use Salpakan or a custom name.
- **Home-directory git repo**: `gog` must be its own repository or commits land in the wrong project.
- **Desync**: same deterministic engine on both sides plus a per-turn state hash; on mismatch,
  the host's state wins and the guest re-syncs.

---

## 7. Answers received (2026-09-11)

1. Firebase, config supplied in `.env` (converted to `VITE_FIREBASE_CONFIG` in `.env.local` and a repo secret).
2. Flat Tactical, with a lighter and less yellow board. Board is now #E9E4D9 on a #F3F1EC ground.
3. Salpakan.
4. `aundreka/salpakan`, created and pushed.
5. Turn timer yes (default 60 s, host-configurable), spectators no.
6. Flag wins on reaching the far row by default; tournament rule is a room setting.

## 8. Remaining work

Done in v1: M0 skeleton and deploy, M1 engine with tests, M2 setup and play UI, M3 Flat Tactical art, M4 rooms with
codes, share links, reconnection by replay, resign, rematch, turn timer. Practice mode against a bot replaces hotseat.

Needs the project owner (cannot be done from this machine):
- Firebase console: enable **Anonymous** sign-in; paste `database.rules.json` into Realtime Database rules.

Added after v1 (2026-09-11): interactive landing hero, invite screen for shared links, host-editable room
settings in the lobby (sent through the log as a `rules` message), drag-and-drop setup, illustrated How to play,
combat animations (impact burst, recoil, shatter), five color palettes, and sound effects from `src/assets/sfx`.

Next polish candidates: a share image, keyboard navigation on the board, drag-to-move during play,
a "claim win" after a long disconnect when the clock is off, and commit-reveal anti-cheat (M6).
