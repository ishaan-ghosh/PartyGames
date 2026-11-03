# Party Platform + Doodle Dash — Design

- **Date:** 2026-11-03
- **Status:** Draft for review
- **Scope:** The shared party-game platform and its first game, Doodle Dash (drawing & guessing).

## 1. Purpose

A clean, good-looking party-game website for playing with friends at home. One optional
shared screen (a laptop on the TV) shows the shared view; phones are controllers. Any
device mix works: screen + phones, or phones only. It is hosted online, so friends can
also join remotely with a room code.

All games are **original designs inspired by genres** (drawing/guessing, fill-in-the-blank
cards, prompt-and-vote, property trading). They are not recreations of existing games:
we use our own names, rules, and content.

### Success criteria

1. The host opens the site on a laptop connected to the TV, and 3+ friends join by scanning a QR code.
2. A full game of Doodle Dash is playable in **screen + phones** mode and in **phones-only** mode.
3. A phone that sleeps or refreshes mid-game rejoins its seat with its score intact.
4. The site is deployed at a public URL on Cloudflare's free plan.

### Non-goals (v1)

Pass-and-play / single shared input device (tracked in [#1](https://github.com/ishaan-ghosh/PartyGames/issues/1)), accounts
or logins, public matchmaking, more than one game, team mode, saved drawings or
history, moderation tools.

## 2. Architecture

### Stack

- **Frontend:** Vite + React + TypeScript, a single web app for both screen and phone views.
  react-three-fiber (three.js) for 3D, which v1 uses only for an optional lobby background.
- **Backend:** Cloudflare Workers + Durable Objects via PartyServer. One Durable Object per room.
  The web app is served from Workers static assets.
- **Monorepo:** pnpm workspaces.

```
apps/web            React app. Routes: /  (host/join)  /room/:code
party/              Worker entry + Room Durable Object
games/doodle-dash   Game module: rules (pure) + screen/phone React views
shared/             Protocol message types, game-module interface, design tokens
```

### Authoritative room

The Room Durable Object is the **single source of truth**. Clients send *actions* and
receive *views*. Clients never change game state themselves.

### Game-module interface

Each game is a module with pure, network-free functions plus React views:

```ts
interface GameModule<State, Action, Settings> {
  id: string;
  meta: { name: string; minPlayers: number; maxPlayers: number; accent: string };
  defaultSettings: Settings;
  setup(players: Player[], settings: Settings, rng: Rng): State;
  onAction(state: State, playerId: string, action: Action, now: number): State;
  onTimer(state: State, now: number): State;      // room schedules via Durable Object alarms
  nextTimerAt(state: State): number | null;
  onPlayerLeft(state: State, playerId: string): State;
  view(state: State, viewer: Viewer): unknown;    // per-viewer redacted view
  isOver(state: State): boolean;
}
type Viewer = { kind: "screen" } | { kind: "player"; playerId: string };
```

As built, the interface lives in `shared/src/game.ts`: `onAction` returns `{state, events?, quiet?}`,
`onPlayerLeft` became `onPresence`, and there are `onSkip`, `parseSettings`, `parseAction`, `results`
plus the optional hooks `sync`, `publicSettings`, `splitSave` and `joinSave`.

`view()` is the only path for state to reach a client, so hidden information (the secret
word, card hands, and so on) never leaves the server for viewers who shouldn't see it.

Time is passed in as `now`, and randomness as `rng`, so the rules are deterministic and
unit-testable.

### Device roles

- **Screen:** shows the shared view. It is **never a player**.
- **Player:** a nickname plus avatar. Sees their private view and controls.
- **Host:** the device that created the room (a screen or the first player). Picks the
  game, edits settings, and starts or skips rounds. If the host leaves, host passes to the
  longest-connected player.

### Modes (derived automatically)

- **Screen + phones:** at least one screen is connected. Phones show controls only.
- **Phones only:** no screen is connected. Each phone shows a compact shared view above its controls.

The mode is recomputed live. Connecting or disconnecting a screen mid-game reshapes the
phone UIs without interrupting play.

### Protocol (WebSocket, JSON)

Client → server:
- `hello {role, token?, hostKey?, name?, avatar?}`
- `action {payload}`
- `host {cmd: selectGame|updateSettings|start|skip|endGame|kick}`
- `resync` — ask again for the game's full-picture event (throttled to once a second)

Server → client:
- `welcome {token, you}`
- `room {room: {code, players, screens, hostId, mode, phase, gameId, settings, lastResults, belowMin}, now}` — `settings` may be redacted per device (Doodle Dash hides custom words from all but a host phone outside play; during play and on the TV only their count is sent)
- `view {payload, now}`
- `event {payload}` — game events (e.g. stroke ops), not part of the view
- `error {code, message}`

High-frequency data (drawing strokes) goes from `action` to `event` ops, never through `view` (see §3).
Messages are validated with zod schemas in `shared/`.

### Identity and reconnection

- On first `hello`, the room issues a random token. The client stores it in `localStorage`, keyed by room code.
- Reconnecting with the token reclaims the same seat, score, and host status.
- Disconnected players are kept for the rest of the game. A disconnected drawer's turn is skipped.
- The room keeps its state for **10 minutes** after the last device leaves, then is discarded.

### Room codes

- 4 letters from an alphabet without ambiguous characters (no O/0, I/1/L).
- The Worker routes `/parties/room/:code` to the Durable Object of that name.
- Creating a room picks a random unused code.

## 3. Doodle Dash

### Flow

1. **Lobby:** the host sets rounds (default 3), draw time (default 80 s), word difficulty, and optional custom words.
2. **Round:** each connected player draws once, in turn order.
3. **Choose:** the drawer gets 3 word options and has 15 s to pick, after which one is auto-picked.
4. **Draw:** the drawer draws. Guessers type guesses. Letter hints are revealed at about 50% and 75% of the time.
5. **Reveal:** the turn ends at timeout or when everyone has guessed. The word is shown for 5 s along with the points gained.
6. **End:** final scoreboard, then back to the lobby.

### Guessing

- Matching ignores case and surrounding whitespace.
- A **close** guess (edit distance 1, word length ≥ 4) shows "close!" to that guesser only.
- After guessing correctly, a player's chat is visible only to the drawer and other correct guessers.
- A correct guess is never broadcast as text.

### Scoring

- Guesser: `round(500 × (timeLeft / drawTime)) + 50`.
- Drawer: `min(100 × correctGuessers, 600)`.

### Drawing tools

- Pen, 12-color palette, 3 brush sizes, eraser, flood fill, undo, clear.
- The canvas uses `touch-action: none` and blocks page scroll and zoom while drawing.

### Real-time strokes

- Coordinates are normalized to a 4:3 canvas (0–1).
- The drawer batches points about every 40 ms: `strokeBegin {id, tool, color, size, points}`, then `strokeAppend {id, points}`; also `fill {color, x, y}`, `undo`, `clear`.
- The room appends each batch to the turn's stroke list and relays it to the other devices as a versioned op event (`begin`/`append`/`undo`/`clear`, each with `seq`).
- Views carry only the stroke version and a shape signature. Late joiners and reconnects get the full list as a `sync {seq, strokes}` event; a client that sees a gap or mismatch sends `resync`.
- Strokes are saved in chunks beside the room record, so a save after a guess doesn't rewrite the ink.

### Views

- **Screen:** large canvas, live guess feed, timer ring, hint letters, scoreboard, and an animated end-of-turn round-up.
- **Drawer phone:** word, canvas, and tools.
- **Guesser phone:** guess input and feed, plus the canvas in phones-only mode.

### Words

Our own bundled lists (easy, medium, hard), plus host custom words (comma-separated,
mixed into the pool).

## 4. Look, feel, and joining

### Visual style

- Bold and playful: a dark base, saturated accents, large rounded type, soft shadows.
- Quick, springy motion.
- A shared design-token system (colors, type, spacing, radii) lives in `shared/`. Each game adds its accent color.

### Screen

- Readable from across the room: large type, high contrast, a 5% safe margin at the edges.
- An optional subtle three.js lobby background.

### Phone

- One-thumb use, touch targets ≥ 48 px, no scrolling during play.
- Screen Wake Lock during games, where the browser supports it.

### Join flow

1. The home page offers **Host on this screen** and **Join** (code input). The `/room/:code` URL also joins directly.
2. A screen host shows the room code, a QR code (to `/room/:code`), and the players as they arrive.
3. Players enter a nickname and pick a color or emoji avatar.
4. In phones-only mode, the creating phone is the host and can show the code and QR on demand.
5. The host picks a game from the **game library**: Doodle Dash, plus "coming soon" cards for future games.

### Sound

Short sound effects (correct guess, tick, turn end). They play on the screen, or on phones
when no screen is connected. There is a mute toggle.

## 5. Error handling

- Invalid or out-of-turn actions are ignored by the rules and logged. The client gets an `error` only for user-fixable cases (name taken, room full, room not found).
- If the WebSocket drops, the client reconnects automatically with backoff and shows a "Reconnecting…" banner. The server state stays authoritative.
- If the drawer disconnects, they have a 10 s grace period, then their turn is skipped.
- If players drop below `minPlayers` mid-game, the host can continue or end the game.
- The room is limited to 12 players and 4 screens.

## 6. Testing

- **Rules (Vitest):** turn order, choose-timeout auto-pick, hint timing, close-guess detection, scoring, word redaction in `view()`, end-of-turn when everyone has guessed, the player-left and drawer-left cases.
- **Room (Vitest + Cloudflare workers pool):** join, token reconnection, host-only commands, screen-vs-player roles, mode switching, the empty-room timeout.
- **End to end (Playwright):** one screen context plus three mobile-viewport contexts play a full turn. The test asserts that strokes render on the screen and that scores update.
- **Manual:** real phones on home Wi-Fi against `pnpm dev`, before the work is declared done.
- **CI:** GitHub Actions runs typecheck, unit/room tests, and end-to-end tests on every push.

## 7. Deployment

- `pnpm dev` runs Vite and `wrangler dev`. Phones on the LAN connect through the laptop's IP.
- `wrangler deploy` publishes to the owner's Cloudflare account (free plan, SQLite-backed Durable Objects).
- No secrets are needed in v1.

## 8. Future work

- **Next game (own spec): Puff Up.** An original hot-potato prompt game inspired by Krillion.
  - Players sit in a 3D ring around a pufferfish that acts as the timer. It points at a player
    and inflates until that player gives a valid, not-yet-used answer to the prompt ("name a fish"),
    or it pops and they lose a life (3 lives). The last player standing wins.
  - The prompt changes when someone loses a life, or when everyone has answered twice
    ("Fresh Waters"). Each new prompt brings a faster speed curve.
  - Twists: deep-cut rare answers fully deflate the puffer and let the player aim it;
    Riptide reverses the turn order; sudden death at 2 players; eliminated ghosts vote on
    disputes and throw emoji reactions.
  - Validation: curated answer lists first (these also set rarity), with Claude Haiku as the
    fallback. The API key is stored as a Cloudflare secret, and the server makes the calls.
- Later games: fill-in-the-blank cards, prompt-and-vote, a 3D property-trading board game.
- Pass-and-play mode: [#1](https://github.com/ishaan-ghosh/PartyGames/issues/1).
- Team mode for Doodle Dash.
- Automatic deploys from CI.
