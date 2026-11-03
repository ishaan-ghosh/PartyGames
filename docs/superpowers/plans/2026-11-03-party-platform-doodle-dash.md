# Party Platform + Doodle Dash Implementation Plan

> **For agentic workers:** The orchestrator executes this plan task by task. Each task is implemented by a `dev-setup:worker` subagent (or inline by the orchestrator), and the orchestrator reviews and verifies between tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted party-game platform where devices join rooms by code or QR, either as a shared screen or as a player's phone, and ship its first game, Doodle Dash: drawing and guessing.

**Architecture:**
- Each room is a Cloudflare Durable Object (via PartyServer). It wraps a pure, Cloudflare-free `RoomCore` class that owns members, host, mode, timers and game routing.
- Games are deterministic modules (`GameModule`). They take actions and time, and return state plus per-viewer redacted views. All rules are unit-tested without a network.
- A single Vite + React app renders the screen view or the phone view, depending on the device's role.

**Tech Stack:**
- TypeScript (strict), pnpm workspaces
- Cloudflare Workers + Durable Objects (SQLite-backed) via `partyserver`; `partysocket` on the client
- zod
- React 19, wouter, qrcode.react, three + @react-three/fiber
- Vitest, @cloudflare/vitest-pool-workers, Playwright

**Spec:** `docs/superpowers/specs/2026-11-03-party-platform-design.md`. Read it before starting any task.

## Refinements to the spec

These decisions were made while planning. Where the spec and the plan differ, the plan wins.

1. **`GameModule` interface:**
   - `setup` takes a numeric `seed`. Games keep the seed in their state and use `Rng` from `@party/shared`, which keeps randomness resumable after a save and restore.
   - `onAction` returns `ActionResult` (`{ state, events?, quiet? }`). Drawing strokes are relayed as `events` and marked `quiet`, so they don't trigger a full view rebroadcast.
   - `onPlayerLeft` becomes `onPresence(state, id, connected, now)`, which handles both disconnects and reconnects.
   - New members: `onSkip`, `parseSettings`, `parseAction`, `results`.
   - Game functions may mutate the state they're given and must return it. They do no I/O and read no clock (time comes in as `now`).
2. **New package `@party/ui`.** It holds React UI pieces shared by the web app and game clients: Button, PlayerChip, TimerRing, sound, wake lock, and the `ClientGame` types. `@party/shared` stays free of React.
3. **Host handoff:**
   - Host passes to the earliest-joined connected device after **15 s** of host absence.
   - The room creator always reclaims host when it reconnects, because its hello carries the `hostKey` from room creation.
   - If no host was ever claimed, the first device to say hello becomes host.
4. **Late joiners:** players who join mid-game become spectators until the next game.
5. **Room tests:**
   - Most room tests target `RoomCore` with plain Vitest.
   - A small Cloudflare workers-pool suite smoke-tests the Durable Object wiring: create, hello, unknown room, non-JSON.

## Protocol as built (post-v1)

The task listings below are the original plan. The code has since moved on; the current message and action shapes are (source of truth: `shared/src/protocol.ts`, `shared/src/game.ts`, `games/doodle-dash/src/rules/types.ts`):

- **Client → room:** `hello {role, token?, hostKey?, name?, avatar?}`, `action {payload}`, `host {cmd}` with `selectGame {gameId}` | `updateSettings {settings}` | `start` | `skip` | `endGame` | `kick {playerId}`, and `resync` (asks for the game's sync event again; answered at most once a second per member).
- **Room → client:** `welcome {token, you}`, `room {room, now}`, `view {payload, now}`, `event {payload}`, `error {code, message}` (codes include `KICKED` and `REPLACED`). `room.settings` is per connection (see `publicSettings` below).
- **Optional `GameModule` hooks:** `sync(state, viewer)` (full-picture event sent on (re)join mid-game and on `resync`), `publicSettings(settings, {isHost, kind, phase})`, `parseSettings(input, prev?)`, `splitSave`/`joinSave` (bulky state stored under its own keys, rewritten only when its `rev` changes).
- **Doodle Dash actions:** `choose {index}`, `guess {text}`, `strokeBegin {id, tool, color, size, points}`, `strokeAppend {id, points}` (`id` is the drawer's own stroke key; an append only extends the stroke begun with that id), `fill {color, x, y}`, `undo`, `clear`.
- **Doodle Dash stroke channel (`event` payloads, `StrokeOp`):** `begin {seq, stroke}`, `append {seq, strokeId, points}`, `undo {seq}`, `clear {seq}`, `sync {seq, strokes}`. `seq` is the stroke version (`opSeq`), which also moves on a new turn's wipe. Views carry no strokes, only `opSeq` and `strokeSig` (`"count:numbers"`); clients ask for `resync` on a gap or mismatch. The drawer's view also has `fillsLeft` (fills capped per turn).
- **Doodle Dash settings:** custom words go only to a host on a phone, and only outside play (lobby/results); during play the host phone, like everyone else and every TV, gets `customWordCount`. An update without `customWords` keeps the current list; `addCustomWords` appends.

## Global Constraints

- Node ≥ 22. pnpm is pinned via the `packageManager` field.
- TypeScript `strict` and `noUncheckedIndexedAccess` in every package.
- Room code: 4 letters from `ABCDEFGHJKMNPQRSTUVWXYZ` (no I, L, O, digits).
- Limits:
  - 12 players and 4 screens per room
  - player names 1–16 characters, unique per room ignoring case
- Timers:
  - word choice: 15 s
  - draw time: default 80 s, range 30–180 s
  - reveal: 5 s
  - drawer reconnect grace: 10 s
  - host grace: 15 s
  - empty room is discarded after 10 min
- Scoring:
  - guesser: `round(500 × timeLeft / drawTime) + 50`
  - drawer: `min(100 × correctGuessers, 600)`
- Close guess: Levenshtein distance exactly 1 and word length ≥ 4. Only the guesser sees "close!".
- A correct guess's text is never shown to anyone.
- Canvas:
  - coordinates normalized to 0–1 on a 4:3 canvas, rendered at 800×600 internally
  - the drawer batches points about every 40 ms, at most 400 values per batch
- A screen is never a player. If no screen is connected, the mode is phones-only.
- No accounts, logins or secrets in v1. Deploy target is the Cloudflare free plan.
- No CDN assets. Fonts come from `@fontsource-variable/*` packages.
- Phones: touch targets ≥ 48 px and no page scrolling while drawing. Screen: important UI stays inside a 5% edge margin.
- All game names and content are original.

## Review Focus

1. **Drawer's phone sleeps mid-turn.** The turn must not hang. It ends 10 s after the drawer disconnects, unless they're back. Tested in Task 5 (presence tests).
2. **The same player opens a second tab or device using their token.** The newest connection takes the seat and the old one is closed, with no duplicate player. Tested in Task 6 (token reclaim test).
3. **The host's device leaves and never comes back.** Host passes to someone connected after 15 s, so the game can still be started or ended. The creator gets host back on return. Tested in Task 6 (host grace tests).
4. **Someone joins in the middle of a game.** They become a spectator who can't guess or draw, sees the drawing, and plays next game. Tested in Task 5 (spectator test) and Task 6 (late-join test).
5. **Garbage input from a client:**
   - non-JSON
   - unknown message types
   - out-of-range coordinates
   - oversized stroke batches
   - endless ink

   The room ignores it or answers `BAD_MESSAGE` and keeps running. Tested in Task 2 (schema), Task 5 (parseAction and ink limit), Task 6 (BAD_MESSAGE) and Task 7 (non-JSON over a real socket).

## Execution Strategy: Parallel Lanes

The goal is the most throughput possible without lowering quality. Every task gets an independent review, and the integrated branch must stay green after every merge.

### Dependency graph

```
T1 scaffold+utils ─► T2 protocol ─┬─► T3 turns ─► T4 guessing/view ─► T5 strokes/module ─┬─► T7 DO adapter ──┐
                                  ├─► T6 RoomCore ───────────────────────────────────────┘                  │
                                  └─► T8 UI kit ─┬─► T9 web shell ─► T10 lobby/stage ──────────────────────┤
                                                 └──────────────── (with T5) ─► T11 doodle client ─────────┴─► T12 integration + e2e
```

### Waves

Tasks in the same wave run at the same time, each in its own git worktree:

| Wave | Lane A: game rules | Lane B: server | Lane C: web/UI |
|---|---|---|---|
| 0 | T1 → T2 (one worker, in sequence) | | |
| 1 | T3 | T6 | T8 |
| 2 | T4 | (idle) | T9 |
| 3 | T5 | (idle) | T10 |
| 4 | T11 (needs T5 and T8) | T7 (needs T5 and T6) | (idle) |
| 5 | T12 (integration, single worker) | | |

The critical path is T1 → T2 → T3 → T4 → T5 → T7/T11 → T12, which is 7 steps instead of 12.

### What makes the parallel work safe

- **Frozen contracts.** Each task's **Interfaces** block is the contract. A worker must not change a name or signature that another task consumes. If one seems wrong, the worker stops and reports back instead of changing it.
- **No shared-file churn.** Task 1 creates every `package.json` and `tsconfig.json` and installs every dependency. Later tasks only add files in their own directories, so parallel branches never conflict on the lockfile. The only planned cross-lane edits are `apps/web/src/games.ts` and `RoomPage.tsx`, and those are owned by sequential tasks in one lane (T9 → T10 → T12).
- **Decoupled lanes.** RoomCore (T6) is tested against a fake game, so it doesn't wait for Doodle Dash. The lobby (T10) ships with an empty game registry, and T12 registers Doodle Dash.

### Quality gate for every task

1. **Implement.** A fresh `dev-setup:worker` (opus) works in an isolated worktree branched from the integration branch `feat/v1`. It gets the plan path, the spec path, the full task text and its Interfaces block. It follows TDD: red, green, then commit.
2. **Verify independently.** The orchestrator re-runs the task's verification commands in the worktree. It doesn't take the worker's word for them.
3. **Review.** A fresh `dev-setup:reviewer` (opus), read-only and never the writer, reviews that task's diff against the plan, the spec, the Global Constraints and the Review Focus. It reports findings by severity.
4. **Fix.** Findings go back to the same worker (resumed) to fix, and the same reviewer re-reviews. Which findings get fixed without asking is a standing rule the user approves. See the hand-off question.
5. **Merge and re-verify.** The orchestrator merges the task branch into `feat/v1` and runs `pnpm typecheck && pnpm test` on the merged result before anything else merges. A red integration stops the wave.

### At the end

- A fresh whole-branch `dev-setup:reviewer` pass.
- `pnpm e2e`.
- The user's real-phone check (T12 Step 8).
- Then the user decides on pushing, opening a PR and deploying. Each of those needs its own approval.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .nvmrc, playwright.config.ts, README.md
.github/workflows/ci.yml
shared/                      @party/shared — no React, no Cloudflare
  src/rng.ts                 seeded PRNG (resumable)
  src/codes.ts               room code alphabet/generation/validation
  src/text.ts                Levenshtein (normalizeGuess/isCloseGuess were removed post-v1; Doodle Dash has matchGuess)
  src/protocol.ts            zod ClientMsg schema, ServerMsg/RoomSnapshot types, LIMITS
  src/game.ts                GameModule interface + PlayerInfo/Viewer/GameEvent types
  src/tokens.css             design tokens (CSS variables)
  src/index.ts
ui/                          @party/ui — React UI kit shared by web + games
  src/{Button,PlayerChip,Banner,TimerRing,MuteToggle}.tsx
  src/{avatars,sound,useWakeLock,game-client}.ts
  src/{base,ui}.css, src/index.ts
games/doodle-dash/           @party/doodle-dash
  src/rules/{types,settings,words,turns,guess,strokes,view,index,testkit}.ts (+ *.test.ts)
  src/client/{strokes.ts,useStrokes.ts,useDoodleSounds.ts,CanvasView,DrawPad,DoodleScreen,DoodlePhone,parts,DoodleSettingsForm}.tsx, doodle.css, index.ts
party/                       @party/server — Worker + Durable Object
  src/room-core.ts (+ test)  RoomCore: pure room logic
  src/room.ts                Room Durable Object adapter (PartyServer)
  src/games.ts, src/env.ts, src/index.ts
  test/worker/room.worker.test.ts
  wrangler.jsonc (deploy, with assets), wrangler.local.jsonc (dev/test, no assets)
apps/web/                    @party/web — Vite React app
  src/main.tsx, App.tsx, app.css, env.d.ts, games.ts
  src/lib/{storage,origin}.ts
  src/net/{roomState.ts (+test), useRoom.ts}
  src/pages/{Home,JoinForm,RoomPage,Fatal}.tsx
  src/lobby/{ScreenLobby,PhoneLobby,HostPanel,GameLibrary,Results,LobbyBackground}.tsx
  src/stage/{GameStage,HostBar}.tsx
e2e/doodle.spec.ts
```

---

### Task 1: Workspace scaffold and shared utilities

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `{shared,ui,games/doodle-dash,party,apps/web}/{package.json,tsconfig.json}`, `shared/src/{rng,codes,text,index}.ts`
- Test: `shared/src/{rng,codes,text}.test.ts`

**Interfaces:**
- Produces: `class Rng { seed: number; constructor(seed: number); next(): number; int(maxExclusive: number): number; pick<T>(items: readonly T[]): T; sample<T>(items: readonly T[], n: number): T[] }`
- Produces: `CODE_ALPHABET: string; makeRoomCode(random?: () => number): string; normalizeRoomCode(input: string): string; isRoomCode(input: string): boolean`
- Produces: `normalizeGuess(s: string): string; levenshtein(a: string, b: string): number; isCloseGuess(guess: string, word: string): boolean` (as built: only `levenshtein` remains; guess matching lives in `games/doodle-dash/src/rules/chars.ts`)

- [ ] **Step 1: Make sure pnpm is available** (this needs the user's approval because it's a global install)

Run: `pnpm -v || npm install -g pnpm@10`, then `pnpm -v`.
Expected: prints a 10.x version.

- [ ] **Step 2: Create the root files**

`package.json`:
```json
{
  "name": "party-games",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --parallel --filter @party/web --filter @party/server dev",
    "build": "pnpm --filter @party/web build",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test",
    "e2e": "playwright test",
    "cf:deploy": "pnpm build && pnpm --filter @party/server cf:deploy"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "games/*"
  - "party"
  - "shared"
  - "ui"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

`.gitignore`:
```
node_modules
dist
.wrangler
.dev.vars
test-results
playwright-report
*.log
.DS_Store
```

`.nvmrc`:
```
22
```

- [ ] **Step 3: Pin pnpm and install the test toolchain**

Run:
```bash
npm pkg set packageManager="pnpm@$(pnpm -v)"
pnpm view @cloudflare/vitest-pool-workers peerDependencies
```
Note which `vitest` range the second command prints. Then install a version inside that range, so the same Vitest works with the workers pool in Task 7. For example, if it prints `"vitest": "2.0.x - 3.2.x"`:
```bash
pnpm add -Dw typescript "vitest@3.2"
```

- [ ] **Step 4: Create every workspace package manifest and install all dependencies now**

All dependencies are installed in this task so that later tasks, which run in parallel, never edit `package.json` or `pnpm-lock.yaml`. Later tasks only add source files. If a later task finds it needs a new dependency, it stops and reports back instead of installing it.

`shared/package.json`:
```json
{
  "name": "@party/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./tokens.css": "./src/tokens.css" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```
`ui/package.json`:
```json
{
  "name": "@party/ui",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@party/shared": "workspace:*" }
}
```
`games/doodle-dash/package.json`:
```json
{
  "name": "@party/doodle-dash",
  "private": true,
  "type": "module",
  "exports": { "./rules": "./src/rules/index.ts", "./client": "./src/client/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@party/shared": "workspace:*", "@party/ui": "workspace:*" }
}
```
`party/package.json`:
```json
{
  "name": "@party/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev -c wrangler.local.jsonc --port 8787",
    "cf:deploy": "wrangler deploy",
    "test": "vitest run && vitest run -c vitest.workers.config.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "@party/shared": "workspace:*", "@party/doodle-dash": "workspace:*" }
}
```
`apps/web/package.json`:
```json
{
  "name": "@party/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@party/shared": "workspace:*",
    "@party/ui": "workspace:*",
    "@party/doodle-dash": "workspace:*"
  }
}
```

Each package's tsconfig:
- `shared/tsconfig.json`, `ui/tsconfig.json`:
  ```json
  { "extends": "../tsconfig.base.json", "include": ["src"] }
  ```
- `games/doodle-dash/tsconfig.json`:
  ```json
  { "extends": "../../tsconfig.base.json", "include": ["src"] }
  ```
- `apps/web/tsconfig.json`:
  ```json
  { "extends": "../../tsconfig.base.json", "compilerOptions": { "types": ["vite/client"] }, "include": ["src", "vite.config.ts"] }
  ```
- `party/tsconfig.json`:
  ```json
  {
    "extends": "../tsconfig.base.json",
    "compilerOptions": { "lib": ["ES2022"], "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"] },
    "include": ["src", "test"]
  }
  ```

Install everything. React lives at the root so there is exactly one copy:
```bash
pnpm add -w react react-dom
pnpm add -Dw @types/react @types/react-dom @playwright/test
pnpm --filter @party/shared add zod
pnpm --filter @party/doodle-dash add zod
pnpm --filter @party/ui add @fontsource-variable/fredoka @fontsource-variable/inter
pnpm --filter @party/server add partyserver
pnpm --filter @party/server add -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers
pnpm --filter @party/web add partysocket wouter qrcode.react three @react-three/fiber
pnpm --filter @party/web add -D vite @vitejs/plugin-react @types/three
pnpm install
```
Expected: the install finishes with no peer-dependency errors. Check that `@react-three/fiber`'s major version matches React's (fiber v9 needs React 19). If they don't match, pin the matching fiber major.

- [ ] **Step 5: Write the failing tests**

`shared/src/rng.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it("returns values in [0, 1)", () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("advances its seed so it can be saved and resumed", () => {
    const a = new Rng(9);
    a.next();
    const resumed = new Rng(a.seed);
    expect(resumed.next()).toBe(a.next());
  });
  it("samples distinct items", () => {
    const s = new Rng(3).sample(["a", "b", "c", "d", "e"], 3);
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
  });
  it("returns every item when asked for more than exist", () => {
    expect(new Rng(3).sample([1, 2], 5).sort()).toEqual([1, 2]);
  });
});
```

`shared/src/codes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isRoomCode, makeRoomCode, normalizeRoomCode } from "./codes";
import { Rng } from "./rng";

describe("room codes", () => {
  it("makes 4-letter codes without ambiguous characters", () => {
    const r = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const c = makeRoomCode(() => r.next());
      expect(isRoomCode(c)).toBe(true);
      expect(c).not.toMatch(/[ILO0-9]/);
    }
  });
  it("normalizes user input", () => {
    expect(normalizeRoomCode("  abcd ")).toBe("ABCD");
  });
  it("rejects ambiguous or wrong-length codes", () => {
    for (const bad of ["ABCO", "ABCI", "ABC", "ABCDE", "AB1D", "abcd"]) expect(isRoomCode(bad)).toBe(false);
  });
});
```

`shared/src/text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isCloseGuess, levenshtein, normalizeGuess } from "./text";

describe("text helpers", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeGuess("  Hot   AIR balloon ")).toBe("hot air balloon");
  });
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
  it("flags guesses one edit away from words of 4+ letters", () => {
    expect(isCloseGuess("banan", "banana")).toBe(true);
    expect(isCloseGuess("bananas", "banana")).toBe(true);
    expect(isCloseGuess("Banana", "banana")).toBe(false); // exact match is not "close"
    expect(isCloseGuess("car", "cat")).toBe(false); // word too short
    expect(isCloseGuess("apple", "orange")).toBe(false);
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run: `pnpm --filter @party/shared test`
Expected: FAIL, with errors that the modules can't be found (`./rng`, `./codes`, `./text`).

- [ ] **Step 7: Implement**

`shared/src/rng.ts`:
```ts
/** Seeded PRNG (mulberry32). `seed` advances on every call so state can be persisted and resumed. */
export class Rng {
  constructor(public seed: number) {}

  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty list");
    return items[this.int(items.length)]!;
  }

  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    const count = Math.min(n, copy.length);
    for (let i = 0; i < count; i++) {
      const j = i + this.int(copy.length - i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, count);
  }
}
```

`shared/src/codes.ts`:
```ts
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no I, L, O, no digits

export function makeRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase();
}

export function isRoomCode(input: string): boolean {
  return /^[A-HJKMNP-Z]{4}$/.test(input);
}
```

`shared/src/text.ts`:
```ts
export function normalizeGuess(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function isCloseGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  return w.length >= 4 && g !== w && levenshtein(g, w) === 1;
}
```

`shared/src/index.ts`:
```ts
export * from "./rng";
export * from "./codes";
export * from "./text";
```

- [ ] **Step 8: Run the tests and the type check**

Run: `pnpm --filter @party/shared test && pnpm --filter @party/shared typecheck`
Expected: all tests pass and `tsc` reports no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore .nvmrc shared ui games apps party
git commit -m "feat: scaffold pnpm workspace, all package manifests and shared utilities"
```

---

### Task 2: Protocol schemas and the game-module interface

**Files:**
- Create: `shared/src/protocol.ts`, `shared/src/game.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/src/protocol.test.ts`

**Interfaces:**
- Consumes: nothing beyond zod.
- Produces (from `protocol.ts`):
  - `LIMITS`
  - `Avatar` (zod schema + type)
  - `ClientMsg` (zod) with types `ClientMessage`, `HelloMessage`, `HostCommand`
  - `ErrorCode`, `PublicPlayer`, `PublicScreen`, `RoomSnapshot`, `You`, `GameResult`, `ServerMsg`
- Produces (from `game.ts`): `PlayerInfo`, `Viewer`, `GameEvent`, `ActionResult<S>`, `GameMeta`, `GameModule<S, A, Settings>`, with exactly the shapes in the code below.

- [ ] **Step 1: Write the failing test**

`shared/src/protocol.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ClientMsg } from "./protocol";

const ok = (v: unknown) => ClientMsg.safeParse(v).success;

describe("ClientMsg", () => {
  it("accepts a player hello", () => {
    expect(ok({ type: "hello", role: "player", name: "Ana", avatar: { emoji: "🦊", color: "#ff8906" } })).toBe(true);
  });
  it("accepts a screen hello with token and host key", () => {
    expect(ok({ type: "hello", role: "screen", token: "t", hostKey: "k" })).toBe(true);
  });
  it("accepts actions with any payload", () => {
    expect(ok({ type: "action", payload: { t: "guess", text: "x" } })).toBe(true);
  });
  it("accepts host commands", () => {
    expect(ok({ type: "host", cmd: { cmd: "start" } })).toBe(true);
    expect(ok({ type: "host", cmd: { cmd: "kick", playerId: "p1" } })).toBe(true);
    expect(ok({ type: "host", cmd: { cmd: "selectGame", gameId: "doodle-dash" } })).toBe(true);
  });
  it("rejects garbage", () => {
    expect(ok(null)).toBe(false);
    expect(ok("hello")).toBe(false);
    expect(ok({ type: "nope" })).toBe(false);
    expect(ok({ type: "hello", role: "admin" })).toBe(false);
    expect(ok({ type: "hello", role: "player", avatar: { emoji: "🦊", color: "red" } })).toBe(false);
    expect(ok({ type: "host", cmd: { cmd: "explode" } })).toBe(false);
    expect(ok({ type: "hello", role: "player", token: "x".repeat(65) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @party/shared test -- protocol`
Expected: FAIL, with an error that `./protocol` can't be found.

- [ ] **Step 3: Implement**

`shared/src/protocol.ts`:
```ts
import { z } from "zod";

export const LIMITS = {
  maxPlayers: 12,
  maxScreens: 4,
  nameMax: 16,
  hostGraceMs: 15_000,
  emptyRoomTtlMs: 10 * 60_000,
} as const;

export const Avatar = z.object({
  emoji: z.string().min(1).max(8),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Avatar = z.infer<typeof Avatar>;

const HostCmd = z.discriminatedUnion("cmd", [
  z.object({ cmd: z.literal("selectGame"), gameId: z.string().max(40) }),
  z.object({ cmd: z.literal("updateSettings"), settings: z.unknown() }),
  z.object({ cmd: z.literal("start") }),
  z.object({ cmd: z.literal("skip") }),
  z.object({ cmd: z.literal("endGame") }),
  z.object({ cmd: z.literal("kick"), playerId: z.string().max(64) }),
]);

export const ClientMsg = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    role: z.enum(["screen", "player"]),
    token: z.string().max(64).optional(),
    hostKey: z.string().max(64).optional(),
    name: z.string().max(40).optional(),
    avatar: Avatar.optional(),
  }),
  z.object({ type: z.literal("action"), payload: z.unknown() }),
  z.object({ type: z.literal("host"), cmd: HostCmd }),
]);
export type ClientMessage = z.infer<typeof ClientMsg>;
export type HelloMessage = Extract<ClientMessage, { type: "hello" }>;
export type HostCommand = z.infer<typeof HostCmd>;

export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "SCREENS_FULL"
  | "NAME_TAKEN"
  | "BAD_MESSAGE"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "KICKED";

export interface PublicPlayer { id: string; name: string; avatar: Avatar; connected: boolean; isHost: boolean }
export interface PublicScreen { id: string; connected: boolean; isHost: boolean }
export interface GameResult { playerId: string; name: string; score: number }

export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  mode: "screen" | "phones";
  phase: "lobby" | "playing";
  gameId: string;
  settings: unknown;
  players: PublicPlayer[];
  screens: PublicScreen[];
  lastResults: GameResult[] | null;
  belowMin: boolean;
}

export interface You { kind: "screen" | "player"; id: string }

export type ServerMsg =
  | { type: "welcome"; token: string; you: You }
  | { type: "room"; room: RoomSnapshot; now: number }
  | { type: "view"; payload: unknown; now: number }
  | { type: "event"; payload: unknown }
  | { type: "error"; code: ErrorCode; message: string };
```

`shared/src/game.ts`:
```ts
import type { Avatar, GameResult } from "./protocol";

export interface PlayerInfo { id: string; name: string; avatar: Avatar; connected: boolean }
export type Viewer = { kind: "screen" } | { kind: "player"; playerId: string };
/** "others" = every connected device except the one that sent the action. */
export interface GameEvent { to: "all" | "others"; payload: unknown }
/** quiet: true → the room relays `events` but does NOT rebroadcast views or persist. */
export interface ActionResult<S> { state: S; events?: GameEvent[]; quiet?: boolean }
export interface GameMeta { name: string; tagline: string; minPlayers: number; maxPlayers: number; accent: string }

/**
 * A game's rules. Functions are deterministic and do no I/O: time arrives as `now`,
 * randomness comes from `seed`. They may mutate the state they are given and must return it.
 */
export interface GameModule<S, A, Settings> {
  id: string;
  meta: GameMeta;
  defaultSettings: Settings;
  parseSettings(input: unknown): Settings;
  parseAction(input: unknown): A | null;
  setup(players: PlayerInfo[], settings: Settings, seed: number, now: number): S;
  onAction(state: S, playerId: string, action: A, now: number): ActionResult<S>;
  onTimer(state: S, now: number): S;
  nextTimerAt(state: S): number | null;
  onPresence(state: S, playerId: string, connected: boolean, now: number): S;
  onSkip(state: S, now: number): S;
  view(state: S, viewer: Viewer): unknown;
  isOver(state: S): boolean;
  results(state: S): GameResult[];
}
```

Replace `shared/src/index.ts` with:
```ts
export * from "./rng";
export * from "./codes";
export * from "./text";
export * from "./protocol";
export * from "./game";
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm --filter @party/shared test && pnpm --filter @party/shared typecheck`
Expected: all tests pass and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): protocol schemas and game module interface"
```

---

### Task 3: Doodle Dash rules: settings, words and turn flow

**Files:**
- Create: `games/doodle-dash/src/rules/{types,settings,words,turns,testkit}.ts`
- Test: `games/doodle-dash/src/rules/{settings,turns}.test.ts`

**Interfaces:**
- Consumes: `Rng`, `PlayerInfo`, `ActionResult` from `@party/shared`.
- Produces (`types.ts`):
  - constants `PALETTE`, `BRUSH_SIZES`, `CHOOSE_MS = 15000`, `REVEAL_MS = 5000`, `DRAWER_GRACE_MS = 10000`, `MAX_POINTS_PER_BATCH = 400`, `INK_LIMIT = 200000`, `FEED_KEEP = 60`
  - types `Difficulty`, `DoodleSettings`, `DoodlePlayer`, `Phase`, `Audience`, `FeedItem`, `Stroke`, `StrokeOp`, `StrokeAction`, `DoodleAction`, `DoodleState`
- Produces (`settings.ts`): `defaultSettings`, `parseSettings(input: unknown): DoodleSettings`, `wordPool(settings): string[]`
- Produces (`turns.ts`):
  - `setup(players, settings, seed, now)`
  - `startTurn(s, now)`, `chooseWord(s, index, now)`, `onChoose(s, playerId, index, now): ActionResult<DoodleState>`
  - `endTurn(s, now)`, `nextTurn(s, now)`, `onTimer(s, now)`, `nextTimerAt(s)`, `onSkip(s, now)`
  - `allGuessed(s)`, `revealHint(s)`, `hintSchedule(word, start, durationMs)`, `letterIndices(word)`, `nameOf(s, id)`
  - `pushFeed(s, item: Omit<FeedItem, "id">)`
- Produces (`testkit.ts`, test-only): `players(n, disconnected?)`, `start(n?, settings?, opts?)`, `drawing(word, n?, settings?)`

- [ ] **Step 1: Confirm the scaffold.** The package manifest and tsconfig already exist from Task 1. Don't edit `package.json`.

- [ ] **Step 2: Write `types.ts` and `words.ts`.** These are types and data only, so there's nothing to test-drive.

`games/doodle-dash/src/rules/types.ts`:
```ts
import type { Avatar } from "@party/shared";

export const PALETTE = [
  "#1a1a2e", "#ffffff", "#9ca3af", "#ef4444", "#f97316", "#facc15",
  "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#92400e",
] as const;
export const BRUSH_SIZES = [4, 10, 24] as const; // px on the 800×600 canvas
export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 5_000;
export const DRAWER_GRACE_MS = 10_000;
export const MAX_POINTS_PER_BATCH = 400; // numbers (x,y pairs × 2)
export const INK_LIMIT = 200_000; // numbers per turn
export const FEED_KEEP = 60;

export type Difficulty = "easy" | "medium" | "hard" | "mixed";
export interface DoodleSettings { rounds: number; drawTime: number; difficulty: Difficulty; customWords: string[] }
export interface DoodlePlayer { id: string; name: string; avatar: Avatar }
export type Phase = "choosing" | "drawing" | "reveal" | "over";
export type Audience = "all" | "solvers" | { only: string };
export interface FeedItem {
  id: number;
  kind: "chat" | "correct" | "close" | "system";
  playerId: string | null;
  text: string;
  audience: Audience;
}

export type Stroke =
  | { id: number; tool: "pen" | "eraser"; color: number; size: number; points: number[] }
  | { id: number; tool: "fill"; color: number; x: number; y: number };

export type StrokeOp =
  | { op: "begin"; seq: number; stroke: Stroke }
  | { op: "append"; seq: number; strokeId: number; points: number[] }
  | { op: "undo"; seq: number }
  | { op: "clear"; seq: number }
  | { op: "sync"; seq: number; strokes: Stroke[] }; // added post-v1: full list for one connection

export type StrokeAction =
  | { t: "strokeBegin"; id: number; tool: "pen" | "eraser"; color: number; size: number; points: number[] }
  | { t: "strokeAppend"; id: number; points: number[] }
  | { t: "fill"; color: number; x: number; y: number }
  | { t: "undo" }
  | { t: "clear" };

export type DoodleAction = { t: "choose"; index: number } | { t: "guess"; text: string } | StrokeAction;

export interface DoodleState {
  seed: number;
  settings: DoodleSettings;
  players: DoodlePlayer[]; // fixed at setup, join order
  scores: Record<string, number>;
  connected: Record<string, boolean>;
  round: number; // 1-based
  turnOrder: string[];
  turnIndex: number;
  drawerId: string;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  choices: string[];
  word: string | null;
  revealed: number[]; // indices into word
  hintTimes: number[]; // absolute times of pending hint reveals
  solvers: string[]; // in order of guessing
  turnPoints: Record<string, number>;
  strokes: Stroke[];
  opSeq: number; // stroke version: +1 per accepted stroke op and per turn wipe
  nextStrokeId: number;
  openStroke: { key: number; strokeId: number } | null; // last strokeBegin's client id → server stroke
  ink: number; // numbers received this turn
  fills: number; // fills accepted this turn (capped at MAX_FILLS)
  feed: FeedItem[];
  nextFeedId: number;
  usedWords: string[];
  drawerGoneAt: number | null;
  paused: boolean; // waiting in reveal for enough players to reconnect
}
```

`games/doodle-dash/src/rules/words.ts`:
```ts
export const EASY = [
  "apple", "banana", "cat", "dog", "sun", "moon", "star", "tree", "house", "car",
  "fish", "bird", "cake", "hat", "shoe", "ball", "book", "chair", "cloud", "flower",
  "snake", "pizza", "rainbow", "boat", "clock", "cup", "door", "egg", "eye", "frog",
  "ghost", "heart", "key", "lamp", "nose", "pig", "rocket", "spoon", "train", "umbrella",
];
export const MEDIUM = [
  "astronaut", "backpack", "campfire", "dinosaur", "dragon", "elevator", "fireworks", "giraffe",
  "hamburger", "igloo", "jellyfish", "kangaroo", "lighthouse", "mermaid", "ninja", "octopus",
  "parachute", "pirate", "robot", "sandcastle", "scarecrow", "skateboard", "snowman", "submarine",
  "sunflower", "telescope", "tornado", "treasure", "unicorn", "vampire", "volcano", "waterfall",
  "windmill", "wizard", "yo-yo", "zombie", "hot air balloon", "roller coaster", "toothbrush", "traffic light",
];
export const HARD = [
  "gravity", "nostalgia", "echo", "jet lag", "inflation", "karaoke", "migration", "photosynthesis",
  "quarantine", "recycling", "sarcasm", "shadow", "sleepwalking", "stock market", "time travel", "traffic jam",
  "villain", "wifi", "brainstorm", "campaign", "democracy", "evolution", "hibernation", "hypnosis",
  "insomnia", "invisible", "laundry day", "meditation", "multitasking", "overtime", "password", "peer pressure",
  "reflection", "rush hour", "self-checkout", "social media", "spoiler", "sunburn", "teamwork", "virtual reality",
];
```

- [ ] **Step 3: Write the failing tests**

`games/doodle-dash/src/rules/testkit.ts`:
```ts
import type { PlayerInfo } from "@party/shared";
import { defaultSettings } from "./settings";
import { hintSchedule, onChoose, setup } from "./turns";
import type { DoodleSettings, DoodleState } from "./types";

export function players(n: number, disconnected: number[] = []): PlayerInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    avatar: { emoji: "🦊", color: "#ff8906" },
    connected: !disconnected.includes(i + 1),
  }));
}

export function start(
  n = 3,
  settings: Partial<DoodleSettings> = {},
  opts: { disconnected?: number[]; now?: number } = {},
): DoodleState {
  return setup(players(n, opts.disconnected), { ...defaultSettings, ...settings }, 42, opts.now ?? 0);
}

/** A game where p1 chose a word at t=0 and is drawing; the word is forced to `word`. */
export function drawing(word: string, n = 3, settings: Partial<DoodleSettings> = {}): DoodleState {
  const s = start(n, settings);
  onChoose(s, "p1", 0, 0);
  s.word = word;
  s.usedWords = [word];
  s.revealed = [];
  s.hintTimes = hintSchedule(word, 0, s.settings.drawTime * 1000);
  return s;
}
```

`games/doodle-dash/src/rules/settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, wordPool } from "./settings";

describe("settings", () => {
  it("clamps and cleans input", () => {
    expect(
      parseSettings({ rounds: 99, drawTime: 5, difficulty: "nope", customWords: [" Cat ", "cat", "", "x".repeat(31), 7] }),
    ).toEqual({ rounds: 6, drawTime: 30, difficulty: "mixed", customWords: ["Cat"] });
  });
  it("falls back to defaults for junk", () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings("x")).toEqual(defaultSettings);
  });
  it("mixes custom words into the chosen difficulty", () => {
    const pool = wordPool({ ...defaultSettings, difficulty: "easy", customWords: ["Grandma's lasagna", "Apple"] });
    expect(pool).toContain("Grandma's lasagna");
    expect(pool).toContain("apple");
    expect(pool.filter((w) => w.toLowerCase() === "apple")).toHaveLength(1);
    expect(pool).not.toContain("astronaut");
  });
});
```

`games/doodle-dash/src/rules/turns.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { start } from "./testkit";
import { nextTimerAt, onChoose, onSkip, onTimer } from "./turns";

describe("turn flow", () => {
  it("starts with the first connected player choosing from 3 distinct words", () => {
    const s = start(3);
    expect(s.drawerId).toBe("p1");
    expect(s.phase).toBe("choosing");
    expect(new Set(s.choices).size).toBe(3);
    expect(s.phaseEndsAt).toBe(15_000);
  });

  it("skips a disconnected drawer at turn start", () => {
    expect(start(3, {}, { disconnected: [1] }).drawerId).toBe("p2");
  });

  it("lets only the drawer choose", () => {
    const s = start(3);
    expect(onChoose(s, "p2", 0, 1000).quiet).toBe(true);
    expect(s.phase).toBe("choosing");
    const picked = s.choices[1];
    onChoose(s, "p1", 1, 1000);
    expect(s.phase).toBe("drawing");
    expect(s.word).toBe(picked);
    expect(s.phaseEndsAt).toBe(81_000);
  });

  it("auto-picks a word when the drawer doesn't choose within 15s", () => {
    const s = start(3);
    const choices = [...s.choices];
    onTimer(s, 15_000);
    expect(s.phase).toBe("drawing");
    expect(choices).toContain(s.word);
  });

  it("rotates drawers and ends after the last round", () => {
    let s = start(2, { rounds: 1 });
    expect(s.drawerId).toBe("p1");
    s = onSkip(s, 1000);
    expect(s.phase).toBe("reveal");
    s = onTimer(s, 6000);
    expect(s.drawerId).toBe("p2");
    expect(s.phase).toBe("choosing");
    s = onSkip(s, 7000);
    s = onTimer(s, 12_000);
    expect(s.phase).toBe("over");
    expect(nextTimerAt(s)).toBeNull();
  });

  it("plays the configured number of rounds", () => {
    let s = start(2, { rounds: 2 });
    const drawers: string[] = [];
    let t = 0;
    while (s.phase !== "over") {
      drawers.push(s.drawerId);
      t += 1000;
      s = onSkip(s, t);
      t += 5000;
      s = onTimer(s, t);
    }
    expect(drawers).toEqual(["p1", "p2", "p1", "p2"]);
  });

  it("never plays the same word twice in a game", () => {
    let s = start(3, { rounds: 6 });
    const chosen: string[] = [];
    let t = 0;
    while (s.phase !== "over") {
      onChoose(s, s.drawerId, 0, t);
      chosen.push(s.word!);
      s = onSkip(s, (t += 1000));
      s = onTimer(s, (t += 5000));
    }
    expect(chosen).toHaveLength(18);
    expect(new Set(chosen).size).toBe(18);
  });

  it("schedules the next timer at the phase end", () => {
    const s = start(3);
    expect(nextTimerAt(s)).toBe(15_000);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `pnpm --filter @party/doodle-dash test`
Expected: FAIL, with errors that `./settings` and `./turns` can't be found.

- [ ] **Step 5: Implement `settings.ts` and `turns.ts`**

`games/doodle-dash/src/rules/settings.ts`:
```ts
import type { Difficulty, DoodleSettings } from "./types";
import { EASY, HARD, MEDIUM } from "./words";

export const defaultSettings: DoodleSettings = { rounds: 3, drawTime: 80, difficulty: "mixed", customWords: [] };
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "mixed"];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

export function parseSettings(input: unknown): DoodleSettings {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const difficulty = DIFFICULTIES.includes(o.difficulty as Difficulty)
    ? (o.difficulty as Difficulty)
    : defaultSettings.difficulty;
  const seen = new Set<string>();
  const customWords: string[] = [];
  for (const w of Array.isArray(o.customWords) ? o.customWords : []) {
    if (typeof w !== "string") continue;
    const t = w.trim().replace(/\s+/g, " ");
    const k = t.toLowerCase();
    if (t.length < 1 || t.length > 30 || seen.has(k)) continue;
    seen.add(k);
    customWords.push(t);
    if (customWords.length >= 200) break;
  }
  return {
    rounds: clampInt(o.rounds, 1, 6, defaultSettings.rounds),
    drawTime: clampInt(o.drawTime, 30, 180, defaultSettings.drawTime),
    difficulty,
    customWords,
  };
}

export function wordPool(settings: DoodleSettings): string[] {
  const base =
    settings.difficulty === "easy" ? EASY
    : settings.difficulty === "medium" ? MEDIUM
    : settings.difficulty === "hard" ? HARD
    : [...EASY, ...MEDIUM, ...HARD];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...base, ...settings.customWords]) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}
```

`games/doodle-dash/src/rules/turns.ts`:
```ts
import { Rng, type ActionResult, type PlayerInfo } from "@party/shared";
import { wordPool } from "./settings";
import {
  CHOOSE_MS, DRAWER_GRACE_MS, FEED_KEEP, REVEAL_MS,
  type DoodleSettings, type DoodleState, type FeedItem,
} from "./types";

export function nameOf(s: DoodleState, id: string): string {
  return s.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function pushFeed(s: DoodleState, item: Omit<FeedItem, "id">): void {
  s.feed.push({ id: s.nextFeedId++, ...item });
  if (s.feed.length > FEED_KEEP) s.feed.splice(0, s.feed.length - FEED_KEEP);
}

export function letterIndices(word: string): number[] {
  return [...word].flatMap((ch, i) => (/[a-z0-9]/i.test(ch) ? [i] : []));
}

export function hintSchedule(word: string, start: number, durationMs: number): number[] {
  const n = letterIndices(word).length;
  const count = n >= 4 ? 2 : n >= 2 ? 1 : 0;
  return [0.5, 0.75].slice(0, count).map((f) => start + Math.round(durationMs * f));
}

export function setup(players: PlayerInfo[], settings: DoodleSettings, seed: number, now: number): DoodleState {
  const s: DoodleState = {
    seed,
    settings,
    players: players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    connected: Object.fromEntries(players.map((p) => [p.id, p.connected])),
    round: 1,
    turnOrder: players.map((p) => p.id),
    turnIndex: 0,
    drawerId: "",
    phase: "choosing",
    phaseStartedAt: now,
    phaseEndsAt: now,
    choices: [],
    word: null,
    revealed: [],
    hintTimes: [],
    solvers: [],
    turnPoints: {},
    strokes: [],
    opSeq: 0,
    nextStrokeId: 1,
    ink: 0,
    feed: [],
    nextFeedId: 1,
    usedWords: [],
    drawerGoneAt: null,
  };
  return startTurn(s, now);
}

function availableWords(s: DoodleState): string[] {
  const used = new Set(s.usedWords.map((w) => w.toLowerCase()));
  const pool = wordPool(s.settings);
  const fresh = pool.filter((w) => !used.has(w.toLowerCase()));
  if (fresh.length >= 3) return fresh;
  s.usedWords = [];
  return pool;
}

export function startTurn(s: DoodleState, now: number): DoodleState {
  for (;;) {
    if (s.turnIndex >= s.turnOrder.length) {
      if (s.round >= s.settings.rounds) {
        s.phase = "over";
        s.choices = [];
        return s;
      }
      s.round += 1;
      s.turnIndex = 0;
      s.turnOrder = s.players.map((p) => p.id);
      continue;
    }
    if (s.connected[s.turnOrder[s.turnIndex]!]) break;
    s.turnIndex += 1;
  }
  const drawerId = s.turnOrder[s.turnIndex]!;
  const rng = new Rng(s.seed);
  s.choices = rng.sample(availableWords(s), 3);
  s.seed = rng.seed;
  s.drawerId = drawerId;
  s.phase = "choosing";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + CHOOSE_MS;
  s.word = null;
  s.revealed = [];
  s.hintTimes = [];
  s.solvers = [];
  s.turnPoints = {};
  s.strokes = [];
  s.ink = 0;
  s.drawerGoneAt = null;
  pushFeed(s, { kind: "system", playerId: null, text: `${nameOf(s, drawerId)} is choosing a word`, audience: "all" });
  return s;
}

export function chooseWord(s: DoodleState, index: number, now: number): DoodleState {
  const word = s.choices[index];
  if (!word) return s;
  const durationMs = s.settings.drawTime * 1000;
  s.word = word;
  s.usedWords.push(word);
  s.choices = [];
  s.phase = "drawing";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + durationMs;
  s.hintTimes = hintSchedule(word, now, durationMs);
  pushFeed(s, { kind: "system", playerId: null, text: `${nameOf(s, s.drawerId)} is drawing!`, audience: "all" });
  return s;
}

export function onChoose(s: DoodleState, playerId: string, index: number, now: number): ActionResult<DoodleState> {
  if (s.phase !== "choosing" || playerId !== s.drawerId || !s.choices[index]) return { state: s, quiet: true };
  return { state: chooseWord(s, index, now) };
}

export function endTurn(s: DoodleState, now: number): DoodleState {
  const drawerPoints = Math.min(100 * s.solvers.length, 600);
  if (drawerPoints > 0) {
    s.scores[s.drawerId] = (s.scores[s.drawerId] ?? 0) + drawerPoints;
    s.turnPoints[s.drawerId] = drawerPoints;
  }
  pushFeed(s, {
    kind: "system",
    playerId: null,
    text: s.word ? `The word was "${s.word}"` : `${nameOf(s, s.drawerId)}'s turn was skipped`,
    audience: "all",
  });
  s.phase = "reveal";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + REVEAL_MS;
  s.hintTimes = [];
  s.choices = [];
  s.drawerGoneAt = null;
  return s;
}

export function nextTurn(s: DoodleState, now: number): DoodleState {
  s.turnIndex += 1;
  return startTurn(s, now);
}

export function allGuessed(s: DoodleState): boolean {
  const guessers = s.players.filter((p) => p.id !== s.drawerId && s.connected[p.id]);
  return guessers.length > 0 && guessers.every((p) => s.solvers.includes(p.id));
}

/** Reveal one random hidden letter, always leaving at least one hidden. */
export function revealHint(s: DoodleState): void {
  const hidden = letterIndices(s.word ?? "").filter((i) => !s.revealed.includes(i));
  if (hidden.length <= 1) return;
  const rng = new Rng(s.seed);
  s.revealed.push(rng.pick(hidden));
  s.seed = rng.seed;
}

export function nextTimerAt(s: DoodleState): number | null {
  if (s.phase === "over") return null;
  const times = [s.phaseEndsAt];
  if (s.phase === "drawing" && s.hintTimes.length) times.push(s.hintTimes[0]!);
  if (s.drawerGoneAt !== null && (s.phase === "choosing" || s.phase === "drawing")) {
    times.push(s.drawerGoneAt + DRAWER_GRACE_MS);
  }
  return Math.min(...times);
}

function step(s: DoodleState, now: number): DoodleState {
  const active = s.phase === "choosing" || s.phase === "drawing";
  if (active && s.drawerGoneAt !== null && now >= s.drawerGoneAt + DRAWER_GRACE_MS) return endTurn(s, now);
  if (s.phase === "choosing" && now >= s.phaseEndsAt) {
    const rng = new Rng(s.seed);
    const i = rng.int(s.choices.length);
    s.seed = rng.seed;
    return chooseWord(s, i, now);
  }
  if (s.phase === "drawing") {
    if (now >= s.phaseEndsAt) return endTurn(s, now);
    if (s.hintTimes.length && s.hintTimes[0]! <= now) {
      s.hintTimes.shift();
      revealHint(s);
      return s;
    }
  }
  if (s.phase === "reveal" && now >= s.phaseEndsAt) return nextTurn(s, now);
  return s;
}

export function onTimer(s: DoodleState, now: number): DoodleState {
  for (let guard = 0; guard < 20; guard++) {
    const at = nextTimerAt(s);
    if (at === null || at > now) break;
    s = step(s, now);
  }
  return s;
}

export function onSkip(s: DoodleState, now: number): DoodleState {
  if (s.phase === "choosing" || s.phase === "drawing") return endTurn(s, now);
  if (s.phase === "reveal") return nextTurn(s, now);
  return s;
}
```

- [ ] **Step 6: Run the tests and the type check**

Run: `pnpm --filter @party/doodle-dash test && pnpm --filter @party/doodle-dash exec tsc --noEmit`
Expected: all tests pass and there are no type errors.

- [ ] **Step 7: Commit**

```bash
git add games/doodle-dash/src
git commit -m "feat(doodle): settings, word lists and turn flow"
```

---

### Task 4: Doodle Dash rules: guessing, scoring, hints and per-viewer views

**Files:**
- Create: `games/doodle-dash/src/rules/{guess,view}.ts`
- Test: `games/doodle-dash/src/rules/guess.test.ts`

**Interfaces:**
- Consumes: from Task 3, `pushFeed`, `nameOf`, `endTurn`, `allGuessed`, `onTimer`, `drawing()`, and the types in `types.ts`.
- Produces:
  - `handleGuess(s, playerId, text, now): ActionResult<DoodleState>`
  - `makeHint(word, revealed): string`
  - `view(s, viewer: Viewer): DoodleView`
  - `type ViewFeedItem = Omit<FeedItem, "audience">`
  - `interface DoodleView` with these fields:
    - `turnKey: string`, `phase`, `round`, `rounds`, `drawTime`, `phaseEndsAt`, `drawerId`
    - `players: { id, name, avatar, score, connected, solved, turnPoints }[]`
    - `word: string | null`, `hint: string | null`, `choices: string[] | null`
    - `you: { id: string; role: "drawer" | "guesser" | "solver" | "spectator" } | null`
    - `feed: ViewFeedItem[]`, `strokes: Stroke[]`, `opSeq: number`
    - As built: `strokes` was replaced by `strokeSig: string` (strokes travel as `StrokeOp` events), and the view gained `waiting?: boolean` and the drawer-only `fillsLeft?: number`.

- [ ] **Step 1: Write the failing tests**

`games/doodle-dash/src/rules/guess.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { drawing, start } from "./testkit";
import { onTimer } from "./turns";
import { view } from "./view";

const screen = { kind: "screen" } as const;
const as = (playerId: string) => ({ kind: "player", playerId }) as const;
const guess = (s: ReturnType<typeof drawing>, id: string, text: string, now = 0) => handleGuess(s, id, text, now);

describe("guessing and scoring", () => {
  it("scores a correct guess by speed", () => {
    const s = drawing("banana");
    guess(s, "p2", "banana", 40_000);
    expect(s.scores.p2).toBe(300);
    expect(s.solvers).toEqual(["p2"]);
  });

  it("ignores case and extra spaces", () => {
    const s = drawing("hot air balloon");
    guess(s, "p2", "  Hot  AIR balloon ", 0);
    expect(s.scores.p2).toBe(550);
  });

  it("never shows the correct guess text to anyone", () => {
    const s = drawing("banana", 4);
    guess(s, "p2", "BANANA", 1000);
    for (const v of [screen, as("p1"), as("p2"), as("p3")]) {
      expect(JSON.stringify(view(s, v).feed)).not.toMatch(/banana/i);
    }
    expect(view(s, screen).feed.at(-1)).toMatchObject({ kind: "correct", text: "P2 guessed it!" });
  });

  it("tells only the guesser when they are close", () => {
    const s = drawing("banana");
    guess(s, "p2", "banan", 1000);
    expect(view(s, as("p2")).feed.some((f) => f.kind === "close")).toBe(true);
    expect(view(s, as("p3")).feed.some((f) => f.kind === "close")).toBe(false);
    expect(view(s, screen).feed.some((f) => f.kind === "close")).toBe(false);
    expect(view(s, as("p3")).feed.at(-1)).toMatchObject({ kind: "chat", text: "banan", playerId: "p2" });
  });

  it("hides solver chat from people still guessing", () => {
    const s = drawing("banana", 4);
    guess(s, "p2", "banana", 1000);
    guess(s, "p2", "so easy", 2000);
    expect(view(s, as("p3")).feed.some((f) => f.text === "so easy")).toBe(false);
    expect(view(s, screen).feed.some((f) => f.text === "so easy")).toBe(false);
    expect(view(s, as("p1")).feed.some((f) => f.text === "so easy")).toBe(true);
  });

  it("does not let the drawer guess or chat while drawing", () => {
    const s = drawing("banana");
    expect(guess(s, "p1", "banana", 1000).quiet).toBe(true);
    expect(s.scores.p1).toBe(0);
  });

  it("ignores empty guesses", () => {
    const s = drawing("banana");
    const before = s.feed.length;
    expect(guess(s, "p2", "   ").quiet).toBe(true);
    expect(s.feed.length).toBe(before);
  });

  it("allows chat while the drawer is choosing", () => {
    const s = start(3);
    guess(s, "p2", "good luck", 1000);
    expect(view(s, screen).feed.at(-1)).toMatchObject({ kind: "chat", text: "good luck" });
  });

  it("ends the turn when everyone has guessed and pays the drawer", () => {
    const s = drawing("banana");
    guess(s, "p2", "banana");
    guess(s, "p3", "banana");
    expect(s.phase).toBe("reveal");
    expect(s.scores.p1).toBe(200);
    expect(view(s, screen).word).toBe("banana");
  });

  it("caps drawer points at 600", () => {
    const s = drawing("banana", 8);
    for (let i = 2; i <= 8; i++) guess(s, `p${i}`, "banana");
    expect(s.scores.p1).toBe(600);
  });

  it("ends the turn when time runs out, revealing the word", () => {
    const s = drawing("banana");
    onTimer(s, 80_000);
    expect(s.phase).toBe("reveal");
    expect(s.scores.p1).toBe(0);
    expect(view(s, screen).word).toBe("banana");
  });
});

describe("hints", () => {
  const shown = (h: string | null) => [...(h ?? "")].filter((c) => c !== "_").length;

  it("reveals one letter at 50% and another at 75% of the draw time", () => {
    const s = drawing("banana");
    expect(view(s, screen).hint).toBe("______");
    onTimer(s, 40_000);
    expect(shown(view(s, screen).hint)).toBe(1);
    onTimer(s, 60_000);
    expect(shown(view(s, screen).hint)).toBe(2);
  });

  it("keeps spaces and punctuation visible", () => {
    expect(view(drawing("yo-yo"), screen).hint).toBe("__-__");
    expect(view(drawing("hot air balloon"), screen).hint).toBe("___ ___ _______");
  });

  it("shows the full word to the drawer and to solvers", () => {
    const s = drawing("banana");
    expect(view(s, as("p1")).hint).toBe("banana");
    guess(s, "p2", "banana");
    expect(view(s, as("p2")).word).toBe("banana");
    expect(view(s, as("p3")).word).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @party/doodle-dash test -- guess`
Expected: FAIL, with errors that `./guess` and `./view` can't be found.

- [ ] **Step 3: Implement**

`games/doodle-dash/src/rules/guess.ts`:
```ts
import { isCloseGuess, normalizeGuess, type ActionResult } from "@party/shared";
import { allGuessed, endTurn, nameOf, pushFeed } from "./turns";
import type { DoodleState } from "./types";

export function handleGuess(s: DoodleState, playerId: string, text: string, now: number): ActionResult<DoodleState> {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean || !(playerId in s.scores)) return { state: s, quiet: true };

  if (s.phase !== "drawing" || !s.word) {
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: "all" });
    return { state: s };
  }
  if (playerId === s.drawerId) return { state: s, quiet: true };
  if (s.solvers.includes(playerId)) {
    pushFeed(s, { kind: "chat", playerId, text: clean, audience: "solvers" });
    return { state: s };
  }
  if (normalizeGuess(clean) === normalizeGuess(s.word)) {
    const timeLeft = Math.max(0, s.phaseEndsAt - now);
    const points = Math.round(500 * (timeLeft / (s.settings.drawTime * 1000))) + 50;
    s.scores[playerId] = (s.scores[playerId] ?? 0) + points;
    s.turnPoints[playerId] = points;
    s.solvers.push(playerId);
    pushFeed(s, { kind: "correct", playerId, text: `${nameOf(s, playerId)} guessed it!`, audience: "all" });
    if (allGuessed(s)) endTurn(s, now);
    return { state: s };
  }
  pushFeed(s, { kind: "chat", playerId, text: clean, audience: "all" });
  if (isCloseGuess(clean, s.word)) {
    pushFeed(s, { kind: "close", playerId, text: `"${clean}" is close!`, audience: { only: playerId } });
  }
  return { state: s };
}
```

`games/doodle-dash/src/rules/view.ts`:
```ts
import type { Avatar, Viewer } from "@party/shared";
import type { Audience, DoodleState, FeedItem, Phase, Stroke } from "./types";

export type ViewFeedItem = Omit<FeedItem, "audience">;
export interface DoodleView {
  turnKey: string;
  phase: Phase;
  round: number;
  rounds: number;
  drawTime: number;
  phaseEndsAt: number;
  drawerId: string;
  players: { id: string; name: string; avatar: Avatar; score: number; connected: boolean; solved: boolean; turnPoints: number }[];
  word: string | null;
  hint: string | null;
  choices: string[] | null;
  you: { id: string; role: "drawer" | "guesser" | "solver" | "spectator" } | null;
  feed: ViewFeedItem[];
  strokes: Stroke[];
  opSeq: number;
}

export function makeHint(word: string, revealed: number[]): string {
  return [...word].map((ch, i) => (/[a-z0-9]/i.test(ch) && !revealed.includes(i) ? "_" : ch)).join("");
}

export function view(s: DoodleState, viewer: Viewer): DoodleView {
  const playerId = viewer.kind === "player" ? viewer.playerId : null;
  const inGame = playerId !== null && playerId in s.scores;
  const isDrawer = inGame && playerId === s.drawerId;
  const solved = playerId !== null && inGame && s.solvers.includes(playerId);
  const turnOver = s.phase === "reveal" || s.phase === "over";
  const knowsWord = turnOver || isDrawer || solved;
  const canSee = (a: Audience) =>
    a === "all" || (a === "solvers" && (isDrawer || solved)) || (typeof a === "object" && a.only === playerId);

  return {
    turnKey: `${s.round}:${s.turnIndex}`,
    phase: s.phase,
    round: s.round,
    rounds: s.settings.rounds,
    drawTime: s.settings.drawTime,
    phaseEndsAt: s.phaseEndsAt,
    drawerId: s.drawerId,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: s.scores[p.id] ?? 0,
      connected: s.connected[p.id] ?? false,
      solved: s.solvers.includes(p.id),
      turnPoints: s.turnPoints[p.id] ?? 0,
    })),
    word: s.word && knowsWord ? s.word : null,
    hint: s.word ? (knowsWord ? s.word : makeHint(s.word, s.revealed)) : null,
    choices: isDrawer && s.phase === "choosing" ? [...s.choices] : null,
    you:
      playerId === null
        ? null
        : { id: playerId, role: !inGame ? "spectator" : isDrawer ? "drawer" : solved ? "solver" : "guesser" },
    feed: s.feed.filter((f) => canSee(f.audience)).slice(-30).map(({ audience: _hidden, ...rest }) => rest),
    strokes: s.strokes,
    opSeq: s.opSeq,
  };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `pnpm --filter @party/doodle-dash test && pnpm --filter @party/doodle-dash typecheck`
Expected: all tests pass and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add games/doodle-dash
git commit -m "feat(doodle): guessing, scoring, hints and redacted views"
```

---

### Task 5: Doodle Dash rules: strokes, presence, action parsing and the module

**Files:**
- Create: `games/doodle-dash/src/rules/{strokes,presence,actions,index}.ts`
- Test: `games/doodle-dash/src/rules/{strokes,presence,module}.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4 functions; `GameModule` from `@party/shared`.
- Produces:
  - `handleStroke(s, playerId, action: StrokeAction): ActionResult<DoodleState>`. Results are always `quiet` and carry one `{ to: "others", payload: StrokeOp }` event when accepted.
  - `onPresence(s, playerId, connected, now)`
  - `parseAction(input: unknown): DoodleAction | null`
  - `export const doodleDash: GameModule<DoodleState, DoodleAction, DoodleSettings>` with `id: "doodle-dash"`, `meta.minPlayers: 2`, `meta.accent: "#7f5af0"`
  - re-exports from `./rules`: the types (`DoodleState`, `DoodleAction`, `DoodleSettings`, `Stroke`, `StrokeOp`, `DoodleView`, `ViewFeedItem`) and the constants (`PALETTE`, `BRUSH_SIZES`, `CHOOSE_MS`, `REVEAL_MS`, `MAX_POINTS_PER_BATCH`)

- [ ] **Step 1: Write the failing tests**

`games/doodle-dash/src/rules/strokes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { handleStroke } from "./strokes";
import { drawing, start } from "./testkit";
import { onSkip, onTimer } from "./turns";
import { INK_LIMIT } from "./types";
import { view } from "./view";

describe("strokes", () => {
  it("relays drawer strokes to others as ordered ops", () => {
    const s = drawing("banana");
    const r1 = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 3, size: 1, points: [0.1, 0.1] });
    const r2 = handleStroke(s, "p1", { t: "strokeAppend", points: [0.2, 0.2, 0.3, 0.3] });
    expect(r1.quiet).toBe(true);
    expect(r1.events).toEqual([
      { to: "others", payload: { op: "begin", seq: 1, stroke: { id: 1, tool: "pen", color: 3, size: 1, points: [0.1, 0.1] } } },
    ]);
    expect(r2.events?.[0]?.payload).toEqual({ op: "append", seq: 2, strokeId: 1, points: [0.2, 0.2, 0.3, 0.3] });
    expect(s.strokes[0]).toMatchObject({ points: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] });
  });

  it("ignores strokes from non-drawers and outside the drawing phase", () => {
    const s = drawing("banana");
    expect(handleStroke(s, "p2", { t: "clear" }).events).toBeUndefined();
    const c = start(3); // choosing
    expect(handleStroke(c, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }).events).toBeUndefined();
    expect(c.strokes).toEqual([]);
  });

  it("supports fill, undo and clear", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.5, 0.5] });
    handleStroke(s, "p1", { t: "fill", color: 4, x: 0.1, y: 0.1 });
    expect(s.strokes.map((x) => x.tool)).toEqual(["pen", "fill"]);
    expect(handleStroke(s, "p1", { t: "undo" }).events?.[0]?.payload).toEqual({ op: "undo", seq: 3 });
    expect(s.strokes).toHaveLength(1);
    handleStroke(s, "p1", { t: "clear" });
    expect(s.strokes).toEqual([]);
    expect(handleStroke(s, "p1", { t: "undo" }).events).toBeUndefined(); // nothing to undo
  });

  it("stops accepting ink after the per-turn limit", () => {
    const s = drawing("banana");
    s.ink = INK_LIMIT;
    const r = handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    expect(r.events).toBeUndefined();
    expect(s.strokes).toEqual([]);
  });

  it("clears the canvas and ink for the next turn", () => {
    let s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    s = onSkip(s, 1000);
    s = onTimer(s, 6000);
    expect(s.drawerId).toBe("p2");
    expect(s.strokes).toEqual([]);
    expect(s.ink).toBe(0);
  });

  it("includes all strokes in every view so late joiners see the drawing", () => {
    const s = drawing("banana");
    handleStroke(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] });
    const v = view(s, { kind: "player", playerId: "late" });
    expect(v.strokes).toHaveLength(1);
    expect(v.opSeq).toBe(1);
  });
});
```

`games/doodle-dash/src/rules/presence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { handleGuess } from "./guess";
import { onPresence } from "./presence";
import { drawing } from "./testkit";
import { nextTimerAt, onTimer } from "./turns";

describe("presence", () => {
  it("ends the turn 10s after the drawer disconnects", () => {
    const s = drawing("banana");
    onPresence(s, "p1", false, 5000);
    expect(nextTimerAt(s)).toBe(15_000);
    onTimer(s, 15_000);
    expect(s.phase).toBe("reveal");
  });

  it("keeps the turn if the drawer is back within 10s", () => {
    const s = drawing("banana");
    onPresence(s, "p1", false, 5000);
    onPresence(s, "p1", true, 8000);
    expect(nextTimerAt(s)).toBe(40_000); // first hint
    onTimer(s, 15_000);
    expect(s.phase).toBe("drawing");
  });

  it("ends the turn when the last unsolved guesser leaves", () => {
    const s = drawing("banana");
    handleGuess(s, "p2", "banana", 1000);
    onPresence(s, "p3", false, 2000);
    expect(s.phase).toBe("reveal");
  });

  it("ignores unknown players", () => {
    const s = drawing("banana");
    onPresence(s, "nobody", false, 1000);
    expect(s.connected).not.toHaveProperty("nobody");
    expect(s.phase).toBe("drawing");
  });
});
```

`games/doodle-dash/src/rules/module.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { doodleDash } from "./index";
import { drawing, start } from "./testkit";

const { parseAction, view, onAction, results } = doodleDash;

describe("doodleDash module", () => {
  it("parses valid actions", () => {
    expect(parseAction({ t: "guess", text: "hi" })).toEqual({ t: "guess", text: "hi" });
    expect(parseAction({ t: "strokeBegin", tool: "pen", color: 0, size: 2, points: [0, 1] })).not.toBeNull();
    expect(parseAction({ t: "fill", color: 11, x: 0.5, y: 0.5 })).not.toBeNull();
  });

  it("rejects malformed actions", () => {
    const bad = [
      null,
      "garbage",
      { t: "nope" },
      { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [1.5, 0] },
      { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0.1] },
      { t: "strokeBegin", tool: "pen", color: 12, size: 0, points: [0, 0] },
      { t: "strokeBegin", tool: "spray", color: 0, size: 0, points: [0, 0] },
      { t: "strokeAppend", points: Array(402).fill(0.5) },
      { t: "choose", index: 3 },
      { t: "guess", text: "x".repeat(201) },
    ];
    for (const b of bad) expect(parseAction(b)).toBeNull();
  });

  it("shows word choices only to the drawer", () => {
    const s = start(3);
    expect(view(s, { kind: "player", playerId: "p1" })).toMatchObject({ choices: s.choices, you: { role: "drawer" } });
    expect(view(s, { kind: "player", playerId: "p2" })).toMatchObject({ choices: null, word: null, hint: null });
    expect(view(s, { kind: "screen" })).toMatchObject({ choices: null, you: null });
  });

  it("hides the word from the screen and guessers while drawing", () => {
    const s = drawing("banana");
    expect(view(s, { kind: "screen" })).toMatchObject({ word: null, hint: "______" });
    expect(view(s, { kind: "player", playerId: "p2" })).toMatchObject({ word: null, you: { role: "guesser" } });
    expect(view(s, { kind: "player", playerId: "p1" })).toMatchObject({ word: "banana" });
  });

  it("treats unknown players as spectators who cannot guess", () => {
    const s = drawing("banana");
    expect(view(s, { kind: "player", playerId: "zz" }).you).toEqual({ id: "zz", role: "spectator" });
    expect(onAction(s, "zz", { t: "guess", text: "banana" }, 0).quiet).toBe(true);
    expect(s.solvers).toEqual([]);
  });

  it("routes actions by type", () => {
    const s = start(3);
    onAction(s, "p1", { t: "choose", index: 0 }, 0);
    expect(s.phase).toBe("drawing");
    const r = onAction(s, "p1", { t: "strokeBegin", tool: "pen", color: 0, size: 0, points: [0, 0] }, 0);
    expect(r.events).toHaveLength(1);
  });

  it("returns results sorted by score with names", () => {
    const s = drawing("banana");
    onAction(s, "p3", { t: "guess", text: "banana" }, 0);
    expect(results(s)[0]).toEqual({ playerId: "p3", name: "P3", score: 550 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @party/doodle-dash test`
Expected: FAIL, with errors that `./strokes`, `./presence` and `./index` can't be found.

- [ ] **Step 3: Implement**

`games/doodle-dash/src/rules/strokes.ts`:
```ts
import type { ActionResult } from "@party/shared";
import { INK_LIMIT, type DoodleState, type Stroke, type StrokeAction, type StrokeOp } from "./types";

export function handleStroke(s: DoodleState, playerId: string, action: StrokeAction): ActionResult<DoodleState> {
  const ignore: ActionResult<DoodleState> = { state: s, quiet: true };
  if (s.phase !== "drawing" || playerId !== s.drawerId) return ignore;
  let op: StrokeOp;
  switch (action.t) {
    case "strokeBegin": {
      if (s.ink + action.points.length > INK_LIMIT) return ignore;
      s.ink += action.points.length;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: action.tool, color: action.color, size: action.size, points: [...action.points] };
      s.strokes.push(stroke);
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke, points: [...stroke.points] } };
      break;
    }
    case "strokeAppend": {
      const last = s.strokes.at(-1);
      if (!last || last.tool === "fill" || s.ink + action.points.length > INK_LIMIT) return ignore;
      s.ink += action.points.length;
      last.points.push(...action.points);
      op = { op: "append", seq: ++s.opSeq, strokeId: last.id, points: [...action.points] };
      break;
    }
    case "fill": {
      if (s.ink + 2 > INK_LIMIT) return ignore;
      s.ink += 2;
      const stroke: Stroke = { id: s.nextStrokeId++, tool: "fill", color: action.color, x: action.x, y: action.y };
      s.strokes.push(stroke);
      op = { op: "begin", seq: ++s.opSeq, stroke: { ...stroke } };
      break;
    }
    case "undo": {
      if (s.strokes.length === 0) return ignore;
      s.strokes.pop();
      op = { op: "undo", seq: ++s.opSeq };
      break;
    }
    case "clear": {
      if (s.strokes.length === 0) return ignore;
      s.strokes = [];
      op = { op: "clear", seq: ++s.opSeq };
      break;
    }
    default:
      return ignore;
  }
  return { state: s, quiet: true, events: [{ to: "others", payload: op }] };
}
```

`games/doodle-dash/src/rules/presence.ts`:
```ts
import { allGuessed, endTurn } from "./turns";
import type { DoodleState } from "./types";

export function onPresence(s: DoodleState, playerId: string, connected: boolean, now: number): DoodleState {
  if (!(playerId in s.connected)) return s;
  s.connected[playerId] = connected;
  const active = s.phase === "choosing" || s.phase === "drawing";
  if (playerId === s.drawerId && active) {
    s.drawerGoneAt = connected ? null : now;
  } else if (!connected && s.phase === "drawing" && allGuessed(s)) {
    endTurn(s, now);
  }
  return s;
}
```

`games/doodle-dash/src/rules/actions.ts`:
```ts
import { z } from "zod";
import { BRUSH_SIZES, MAX_POINTS_PER_BATCH, PALETTE, type DoodleAction } from "./types";

const coord = z.number().min(0).max(1);
const color = z.number().int().min(0).max(PALETTE.length - 1);
const points = (min: number) =>
  z.array(coord).min(min).max(MAX_POINTS_PER_BATCH).refine((a) => a.length % 2 === 0, "points must be x,y pairs");

const Action = z.discriminatedUnion("t", [
  z.object({ t: z.literal("choose"), index: z.number().int().min(0).max(2) }),
  z.object({ t: z.literal("guess"), text: z.string().max(200) }),
  z.object({
    t: z.literal("strokeBegin"),
    tool: z.enum(["pen", "eraser"]),
    color,
    size: z.number().int().min(0).max(BRUSH_SIZES.length - 1),
    points: points(2),
  }),
  z.object({ t: z.literal("strokeAppend"), points: points(2) }),
  z.object({ t: z.literal("fill"), color, x: coord, y: coord }),
  z.object({ t: z.literal("undo") }),
  z.object({ t: z.literal("clear") }),
]);

export function parseAction(input: unknown): DoodleAction | null {
  const r = Action.safeParse(input);
  return r.success ? (r.data as DoodleAction) : null;
}
```

`games/doodle-dash/src/rules/index.ts`:
```ts
import type { GameModule } from "@party/shared";
import { parseAction } from "./actions";
import { handleGuess } from "./guess";
import { onPresence } from "./presence";
import { defaultSettings, parseSettings } from "./settings";
import { handleStroke } from "./strokes";
import { nextTimerAt, onChoose, onSkip, onTimer, setup } from "./turns";
import type { DoodleAction, DoodleSettings, DoodleState } from "./types";
import { view } from "./view";

export const doodleDash: GameModule<DoodleState, DoodleAction, DoodleSettings> = {
  id: "doodle-dash",
  meta: { name: "Doodle Dash", tagline: "Draw fast. Guess faster.", minPlayers: 2, maxPlayers: 12, accent: "#7f5af0" },
  defaultSettings,
  parseSettings,
  parseAction,
  setup,
  onAction(state, playerId, action, now) {
    switch (action.t) {
      case "choose":
        return onChoose(state, playerId, action.index, now);
      case "guess":
        return handleGuess(state, playerId, action.text, now);
      default:
        return handleStroke(state, playerId, action);
    }
  },
  onTimer,
  nextTimerAt,
  onPresence,
  onSkip,
  view,
  isOver: (s) => s.phase === "over",
  results: (s) =>
    s.players
      .map((p) => ({ playerId: p.id, name: p.name, score: s.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score),
};

export type { DoodleAction, DoodleSettings, DoodleState, Stroke, StrokeOp } from "./types";
export type { DoodleView, ViewFeedItem } from "./view";
export { BRUSH_SIZES, CHOOSE_MS, MAX_POINTS_PER_BATCH, PALETTE, REVEAL_MS } from "./types";
```

- [ ] **Step 4: Run all the doodle tests and the type check**

Run: `pnpm --filter @party/doodle-dash test && pnpm --filter @party/doodle-dash typecheck`
Expected: all tests pass, including the Task 3–4 tests, and there are no type errors.

- [ ] **Step 5: Commit**

```bash
git add games/doodle-dash
git commit -m "feat(doodle): strokes, presence, action parsing and game module"
```

---

### Task 6: RoomCore: members, host, modes, timers and game routing

**Files:**
- Create: `party/vitest.config.ts`
- Create: `party/src/room-core.ts`
- Test: `party/src/room-core.test.ts`

**Interfaces:**
- Consumes: `ClientMsg`, `LIMITS`, `GameModule`, `ServerMsg`, `RoomSnapshot`, `HostCommand`, `HelloMessage` and the other types from `@party/shared` (Task 2).
- Produces:
  - `interface Outbox { send(connId: string, msg: ServerMsg): void; close(connId: string): void }`
  - `type AnyGame = GameModule<any, any, any>`
  - `interface CoreDeps { newId(): string; newSeed(): number; games: Record<string, AnyGame>; defaultGameId: string }`
  - `interface SavedRoom` (JSON-serializable)
  - `interface Handled { persist: boolean }`
  - `class RoomCore`:
    - `constructor(code: string, deps: CoreDeps, out: Outbox, restore?: { saved: SavedRoom; now: number })`
    - `created: boolean` (getter)
    - `create(hostKey: string, now: number): boolean`
    - `message(connId: string, raw: unknown, now: number): Handled`
    - `disconnect(connId: string, now: number): Handled`
    - `tick(now: number): void`
    - `nextAlarmAt(): number | null`
    - `shouldDiscard(now: number): boolean`
    - `serialize(): SavedRoom`
    - `snapshot(): RoomSnapshot`

- [ ] **Step 1: Add the plain-Node Vitest config.** The manifest and tsconfig already exist from Task 1. Don't edit `package.json`.

`party/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 2: Write the failing tests**

`party/src/room-core.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { GameModule, ServerMsg } from "@party/shared";
import { RoomCore, type CoreDeps, type Outbox } from "./room-core";

interface CState { count: number; target: number; endsAt: number | null; players: string[]; names: Record<string, string>; presence: Record<string, boolean> }
type CAction = { t: "inc" } | { t: "ping" };

/** Tiny fake game so room behavior is tested independently of Doodle Dash. */
const counter: GameModule<CState, CAction, { target: number }> = {
  id: "counter",
  meta: { name: "Counter", tagline: "test game", minPlayers: 2, maxPlayers: 12, accent: "#ffffff" },
  defaultSettings: { target: 3 },
  parseSettings: (input) => {
    const t = (input as { target?: unknown } | null)?.target;
    return { target: typeof t === "number" ? t : 3 };
  },
  parseAction: (input) => {
    const t = (input as { t?: unknown } | null)?.t;
    return t === "inc" || t === "ping" ? { t } : null;
  },
  setup: (players, settings, _seed, now) => ({
    count: 0,
    target: settings.target,
    endsAt: now + 1000,
    players: players.map((p) => p.id),
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    presence: {},
  }),
  onAction: (s, _id, a) =>
    a.t === "ping" ? { state: s, quiet: true, events: [{ to: "others", payload: "pong" }] } : { state: { ...s, count: s.count + 1 } },
  onTimer: (s, now) => (s.endsAt !== null && now >= s.endsAt ? { ...s, count: s.count + 1, endsAt: null } : s),
  nextTimerAt: (s) => s.endsAt,
  onPresence: (s, id, connected) => ({ ...s, presence: { ...s.presence, [id]: connected } }),
  onSkip: (s) => ({ ...s, count: s.target }),
  view: (s, v) => ({ count: s.count, viewer: v.kind === "screen" ? "screen" : v.playerId }),
  isOver: (s) => s.count >= s.target,
  results: (s) => s.players.map((id) => ({ playerId: id, name: s.names[id] ?? "?", score: s.count })),
};

function setup(opts: { created?: boolean } = {}) {
  const sent: { to: string; msg: ServerMsg }[] = [];
  const closed: string[] = [];
  let n = 0;
  const deps: CoreDeps = { newId: () => `id${++n}`, newSeed: () => 7, games: { counter }, defaultGameId: "counter" };
  const out: Outbox = { send: (to, msg) => sent.push({ to, msg }), close: (c) => closed.push(c) };
  const core = new RoomCore("ABCD", deps, out);
  if (opts.created !== false) core.create("HOSTKEY", 0);
  const msgs = (to: string, type?: ServerMsg["type"]) =>
    sent.filter((s) => s.to === to && (!type || s.msg.type === type)).map((s) => s.msg);
  const last = <T extends ServerMsg["type"]>(to: string, type: T) =>
    msgs(to, type).at(-1) as Extract<ServerMsg, { type: T }> | undefined;
  const id = (conn: string) => last(conn, "welcome")!.you.id;
  const player = (conn: string, name: string, extra: Record<string, unknown> = {}, now = 0) =>
    core.message(conn, { type: "hello", role: "player", name, ...extra }, now);
  const screen = (conn: string, extra: Record<string, unknown> = {}, now = 0) =>
    core.message(conn, { type: "hello", role: "screen", ...extra }, now);
  const host = (conn: string, cmd: object, now = 0) => core.message(conn, { type: "host", cmd }, now);
  return { core, sent, closed, msgs, last, id, player, screen, host, deps };
}

/** Screen s1 is host (has the host key); Ana (c1) and Ben (c2) are in the lobby. */
function lobby() {
  const h = setup();
  h.screen("s1", { hostKey: "HOSTKEY" });
  h.player("c1", "Ana");
  h.player("c2", "Ben");
  return h;
}

function started() {
  const h = lobby();
  h.host("s1", { cmd: "start" }, 0);
  return h;
}

describe("RoomCore: joining", () => {
  it("rejects hellos for a room that was never created", () => {
    const h = setup({ created: false });
    h.player("c1", "Ana");
    expect(h.last("c1", "error")?.code).toBe("ROOM_NOT_FOUND");
    expect(h.closed).toEqual(["c1"]);
  });

  it("welcomes a player and makes the creator host", () => {
    const h = setup();
    expect(h.player("c1", "Ana", { hostKey: "HOSTKEY" })).toEqual({ persist: true });
    const w = h.last("c1", "welcome")!;
    expect(w.you.kind).toBe("player");
    const room = h.last("c1", "room")!.room;
    expect(room.hostId).toBe(w.you.id);
    expect(room.mode).toBe("phones");
    expect(room.players.map((p) => p.name)).toEqual(["Ana"]);
  });

  it("makes the first device host when nobody presents the host key", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.player("c2", "Ben");
    expect(h.last("c2", "room")!.room.hostId).toBe(h.id("c1"));
  });

  it("switches between screen and phones mode as screens come and go", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.screen("s1");
    expect(h.last("s1", "welcome")!.you.kind).toBe("screen");
    expect(h.last("c1", "room")!.room.mode).toBe("screen");
    h.core.disconnect("s1", 10);
    expect(h.last("c1", "room")!.room.mode).toBe("phones");
  });

  it("rejects duplicate names regardless of case or spacing", () => {
    const h = setup();
    h.player("c1", "Ana");
    h.player("c2", "  ana ");
    expect(h.last("c2", "error")?.code).toBe("NAME_TAKEN");
    expect(h.closed).not.toContain("c2");
    expect(h.last("c1", "room")!.room.players).toHaveLength(1);
  });

  it("requires a name for new players", () => {
    const h = setup();
    h.player("c1", "   ");
    expect(h.last("c1", "error")?.code).toBe("BAD_MESSAGE");
  });

  it("caps players at 12 and screens at 4", () => {
    const h = setup();
    for (let i = 0; i < 12; i++) h.player(`c${i}`, `P${i}`);
    h.player("c12", "Late");
    expect(h.last("c12", "error")?.code).toBe("ROOM_FULL");
    expect(h.closed).toContain("c12");
    for (let i = 0; i < 4; i++) h.screen(`s${i}`);
    h.screen("s4");
    expect(h.last("s4", "error")?.code).toBe("SCREENS_FULL");
  });

  it("reclaims the same seat with a token and drops the old connection", () => {
    const h = setup();
    h.player("c1", "Ana");
    const { token, you } = h.last("c1", "welcome")!;
    h.core.message("c2", { type: "hello", role: "player", token }, 5);
    expect(h.last("c2", "welcome")!.you.id).toBe(you.id);
    expect(h.closed).toContain("c1");
    expect(h.last("c2", "room")!.room.players).toHaveLength(1);
    h.core.disconnect("c1", 6); // the stale socket closing later must not drop the seat
    expect(h.last("c2", "room")!.room.players[0]!.connected).toBe(true);
  });

  it("answers malformed messages with BAD_MESSAGE", () => {
    const h = setup();
    for (const junk of [null, "junk", { type: "hello" }, { type: "action", payload: 1 }]) h.core.message("c1", junk, 0);
    expect(h.msgs("c1", "error").map((m) => (m as { code: string }).code)).toEqual([
      "BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE", "BAD_MESSAGE",
    ]);
  });
});

describe("RoomCore: host commands and games", () => {
  it("only lets the host run host commands", () => {
    const h = lobby();
    h.host("c2", { cmd: "start" });
    expect(h.last("c2", "error")?.code).toBe("NOT_HOST");
  });

  it("requires enough connected players to start", () => {
    const h = setup();
    h.screen("s1", { hostKey: "HOSTKEY" });
    h.player("c1", "Ana");
    h.host("s1", { cmd: "start" });
    expect(h.last("s1", "error")?.code).toBe("NOT_ENOUGH_PLAYERS");
    h.player("c2", "Ben");
    h.host("s1", { cmd: "start" });
    expect(h.last("s1", "room")!.room.phase).toBe("playing");
    expect(h.last("s1", "view")!.payload).toEqual({ count: 0, viewer: "screen" });
    expect(h.last("c1", "view")!.payload).toEqual({ count: 0, viewer: h.id("c1") });
  });

  it("applies settings through the game's parser", () => {
    const h = lobby();
    h.host("s1", { cmd: "updateSettings", settings: { target: 5 } });
    expect(h.last("c1", "room")!.room.settings).toEqual({ target: 5 });
  });

  it("routes actions and rebroadcasts views", () => {
    const h = started();
    expect(h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1)).toEqual({ persist: true });
    expect(h.last("c2", "view")!.payload).toMatchObject({ count: 1 });
  });

  it("relays quiet events to everyone but the sender without persisting", () => {
    const h = started();
    const viewsBefore = h.msgs("c2", "view").length;
    expect(h.core.message("c1", { type: "action", payload: { t: "ping" } }, 1)).toEqual({ persist: false });
    expect(h.last("c2", "event")?.payload).toBe("pong");
    expect(h.last("s1", "event")?.payload).toBe("pong");
    expect(h.last("c1", "event")).toBeUndefined();
    expect(h.msgs("c2", "view")).toHaveLength(viewsBefore);
  });

  it("ignores actions from screens and invalid payloads", () => {
    const h = started();
    expect(h.core.message("s1", { type: "action", payload: { t: "inc" } }, 1)).toEqual({ persist: false });
    expect(h.core.message("c1", { type: "action", payload: { t: "boom" } }, 1)).toEqual({ persist: false });
    expect(h.last("c1", "view")!.payload).toMatchObject({ count: 0 });
  });

  it("returns to the lobby with results when the game ends", () => {
    const h = started();
    for (let i = 0; i < 3; i++) h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1);
    const room = h.last("c1", "room")!.room;
    expect(room.phase).toBe("lobby");
    expect(room.lastResults).toEqual([
      { playerId: h.id("c1"), name: "Ana", score: 3 },
      { playerId: h.id("c2"), name: "Ben", score: 3 },
    ]);
  });

  it("lets the host skip and end the game", () => {
    const a = started();
    a.host("s1", { cmd: "skip" });
    expect(a.last("c1", "room")!.room.phase).toBe("lobby");
    const b = started();
    b.host("s1", { cmd: "endGame" });
    expect(b.last("c1", "room")!.room).toMatchObject({ phase: "lobby", lastResults: expect.any(Array) });
  });

  it("runs game timers through tick and reports the next alarm", () => {
    const h = started();
    expect(h.core.nextAlarmAt()).toBe(1000);
    h.core.tick(1000);
    expect(h.last("c1", "view")!.payload).toMatchObject({ count: 1 });
    expect(h.core.nextAlarmAt()).toBeNull();
  });

  it("lets late joiners watch the game as non-players", () => {
    const h = started();
    h.player("c3", "Cy", {}, 2);
    expect(h.last("c3", "view")!.payload).toEqual({ count: 0, viewer: h.id("c3") });
    expect((h.core.serialize().gameState as CState).players).not.toContain(h.id("c3"));
  });

  it("flags when too few players remain mid-game", () => {
    const h = started();
    h.core.disconnect("c2", 5);
    expect(h.last("c1", "room")!.room.belowMin).toBe(true);
  });

  it("kicks a player but never the host", () => {
    const h = lobby();
    h.host("s1", { cmd: "kick", playerId: h.id("c2") });
    expect(h.last("c2", "error")?.code).toBe("KICKED");
    expect(h.closed).toContain("c2");
    expect(h.last("c1", "room")!.room.players.map((p) => p.name)).toEqual(["Ana"]);
    h.host("s1", { cmd: "kick", playerId: h.id("s1") });
    expect(h.closed).not.toContain("s1");
  });
});

describe("RoomCore: host handoff and lifetime", () => {
  it("passes host to the earliest connected member after 15s", () => {
    const h = lobby();
    h.core.disconnect("s1", 1000);
    expect(h.core.nextAlarmAt()).toBe(16_000);
    h.core.tick(15_999);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("c1"));
  });

  it("keeps host if they come back within the grace period", () => {
    const h = lobby();
    const { token } = h.last("s1", "welcome")!;
    h.core.disconnect("s1", 1000);
    h.core.message("s1b", { type: "hello", role: "screen", token, hostKey: "HOSTKEY" }, 5000);
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
  });

  it("gives host back to the creator when they return later", () => {
    const h = lobby();
    const { token } = h.last("s1", "welcome")!;
    h.core.disconnect("s1", 1000);
    h.core.tick(16_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("c1"));
    h.core.message("s1b", { type: "hello", role: "screen", token, hostKey: "HOSTKEY" }, 20_000);
    expect(h.last("c1", "room")!.room.hostId).toBe(h.id("s1"));
  });

  it("discards the room 10 minutes after everyone leaves", () => {
    const h = setup();
    h.player("c1", "Ana", {}, 0);
    h.core.disconnect("c1", 1000);
    h.core.tick(16_000); // host grace expires with nobody to hand to
    expect(h.core.nextAlarmAt()).toBe(601_000);
    expect(h.core.shouldDiscard(600_999)).toBe(false);
    expect(h.core.shouldDiscard(601_000)).toBe(true);
  });

  it("discards a created room nobody ever joined", () => {
    const h = setup();
    expect(h.core.nextAlarmAt()).toBe(600_000);
    expect(h.core.shouldDiscard(600_000)).toBe(true);
  });

  it("stops the empty-room countdown when someone joins", () => {
    const h = setup();
    h.player("c1", "Ana", {}, 5);
    expect(h.core.shouldDiscard(10 * 60_000 + 5)).toBe(false);
  });

  it("survives a save and restore", () => {
    const h = started();
    h.core.message("c1", { type: "action", payload: { t: "inc" } }, 1);
    const { token } = h.last("c1", "welcome")!;
    const saved = h.core.serialize();
    const sent2: { to: string; msg: ServerMsg }[] = [];
    const out2: Outbox = { send: (to, msg) => sent2.push({ to, msg }), close: () => {} };
    const restored = new RoomCore("ABCD", h.deps, out2, { saved, now: 5000 });
    expect((restored.serialize().gameState as CState).presence).toMatchObject({
      [h.id("c1")]: false,
      [h.id("c2")]: false,
    });
    restored.message("n1", { type: "hello", role: "player", token }, 6000);
    expect(sent2.find((s) => s.to === "n1" && s.msg.type === "welcome")).toMatchObject({ msg: { you: { id: h.id("c1") } } });
    expect(sent2.filter((s) => s.to === "n1" && s.msg.type === "view").at(-1)?.msg).toMatchObject({ payload: { count: 1 } });
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter @party/server exec vitest run`
Expected: FAIL, with an error that `./room-core` can't be found.

- [ ] **Step 4: Implement**

`party/src/room-core.ts`:
```ts
import {
  ClientMsg,
  LIMITS,
  type Avatar,
  type ErrorCode,
  type GameModule,
  type GameResult,
  type HelloMessage,
  type HostCommand,
  type PlayerInfo,
  type RoomSnapshot,
  type ServerMsg,
  type Viewer,
} from "@party/shared";

export interface Outbox {
  send(connId: string, msg: ServerMsg): void;
  close(connId: string): void;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameModule<any, any, any>;
export interface CoreDeps {
  newId(): string;
  newSeed(): number;
  games: Record<string, AnyGame>;
  defaultGameId: string;
}

interface Member {
  id: string;
  token: string;
  kind: "screen" | "player";
  name: string;
  avatar: Avatar;
  connId: string | null;
  joinSeq: number;
}

export interface SavedRoom {
  v: 1;
  code: string;
  created: boolean;
  hostKey: string | null;
  hostId: string | null;
  hostGoneAt: number | null;
  members: Member[];
  joinSeq: number;
  gameId: string;
  settings: unknown;
  phase: "lobby" | "playing";
  gameState: unknown;
  lastResults: GameResult[] | null;
  emptySince: number | null;
}

export interface Handled { persist: boolean }
const YES: Handled = { persist: true };
const NO: Handled = { persist: false };
const DEFAULT_AVATAR: Avatar = { emoji: "🙂", color: "#7f5af0" };

/** All room behavior, free of Cloudflare APIs. The Durable Object adapter feeds it messages and time. */
export class RoomCore {
  private s: SavedRoom;

  constructor(
    code: string,
    private readonly deps: CoreDeps,
    private readonly out: Outbox,
    restore?: { saved: SavedRoom; now: number },
  ) {
    if (restore) {
      this.s = structuredClone(restore.saved);
      for (const m of this.s.members) m.connId = null;
      this.s.emptySince ??= restore.now;
      if (this.s.phase === "playing") {
        for (const m of this.s.members) {
          if (m.kind === "player") this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, restore.now);
        }
      }
    } else {
      const game = deps.games[deps.defaultGameId];
      if (!game) throw new Error(`Unknown default game ${deps.defaultGameId}`);
      this.s = {
        v: 1, code, created: false, hostKey: null, hostId: null, hostGoneAt: null,
        members: [], joinSeq: 0, gameId: deps.defaultGameId, settings: game.defaultSettings,
        phase: "lobby", gameState: null, lastResults: null, emptySince: null,
      };
    }
  }

  get created(): boolean {
    return this.s.created;
  }

  create(hostKey: string, now: number): boolean {
    if (this.s.created) return false;
    this.s.created = true;
    this.s.hostKey = hostKey;
    this.s.emptySince = now;
    return true;
  }

  serialize(): SavedRoom {
    return structuredClone(this.s);
  }

  message(connId: string, raw: unknown, now: number): Handled {
    const parsed = ClientMsg.safeParse(raw);
    if (!parsed.success) {
      this.error(connId, "BAD_MESSAGE", "Unrecognized message.");
      return NO;
    }
    const msg = parsed.data;
    if (msg.type === "hello") return this.hello(connId, msg, now);
    const m = this.memberByConn(connId);
    if (!m) {
      this.error(connId, "BAD_MESSAGE", "Say hello first.");
      return NO;
    }
    return msg.type === "action" ? this.action(m, msg.payload, now) : this.hostCmd(m, msg.cmd, now);
  }

  disconnect(connId: string, now: number): Handled {
    const m = this.memberByConn(connId);
    if (!m) return NO;
    m.connId = null;
    if (m.id === this.s.hostId) this.s.hostGoneAt = now;
    if (this.s.phase === "playing" && m.kind === "player") {
      this.s.gameState = this.game.onPresence(this.s.gameState, m.id, false, now);
      this.checkOver();
    }
    if (this.connected().length === 0) this.s.emptySince = now;
    this.broadcast(now);
    return YES;
  }

  tick(now: number): void {
    if (this.s.hostGoneAt !== null && now >= this.s.hostGoneAt + LIMITS.hostGraceMs) this.transferHost();
    if (this.s.phase === "playing") {
      this.s.gameState = this.game.onTimer(this.s.gameState, now);
      this.checkOver();
    }
    this.broadcast(now);
  }

  nextAlarmAt(): number | null {
    const times: number[] = [];
    if (this.s.hostGoneAt !== null) times.push(this.s.hostGoneAt + LIMITS.hostGraceMs);
    if (this.s.emptySince !== null) times.push(this.s.emptySince + LIMITS.emptyRoomTtlMs);
    if (this.s.phase === "playing") {
      const t = this.game.nextTimerAt(this.s.gameState);
      if (t !== null) times.push(t);
    }
    return times.length ? Math.min(...times) : null;
  }

  shouldDiscard(now: number): boolean {
    return this.s.emptySince !== null && now >= this.s.emptySince + LIMITS.emptyRoomTtlMs;
  }

  snapshot(): RoomSnapshot {
    const hostId = this.s.hostId;
    const sorted = [...this.s.members].sort((a, b) => a.joinSeq - b.joinSeq);
    return {
      code: this.s.code,
      hostId,
      mode: this.connected("screen").length > 0 ? "screen" : "phones",
      phase: this.s.phase,
      gameId: this.s.gameId,
      settings: this.s.settings,
      players: sorted
        .filter((m) => m.kind === "player")
        .map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, connected: m.connId !== null, isHost: m.id === hostId })),
      screens: sorted
        .filter((m) => m.kind === "screen")
        .map((m) => ({ id: m.id, connected: m.connId !== null, isHost: m.id === hostId })),
      lastResults: this.s.lastResults,
      belowMin: this.s.phase === "playing" && this.connected("player").length < this.game.meta.minPlayers,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private get game(): AnyGame {
    return this.deps.games[this.s.gameId]!;
  }

  private connected(kind?: Member["kind"]): Member[] {
    return this.s.members.filter((m) => m.connId !== null && (!kind || m.kind === kind));
  }

  private memberByConn(connId: string): Member | undefined {
    return this.s.members.find((m) => m.connId === connId);
  }

  private error(connId: string, code: ErrorCode, message: string): void {
    this.out.send(connId, { type: "error", code, message });
  }

  private hello(connId: string, msg: HelloMessage, now: number): Handled {
    if (!this.s.created) {
      this.error(connId, "ROOM_NOT_FOUND", "That room doesn't exist or has closed.");
      this.out.close(connId);
      return NO;
    }
    if (this.memberByConn(connId)) return NO; // duplicate hello on one socket

    let m = msg.token ? this.s.members.find((x) => x.token === msg.token) : undefined;
    if (m) {
      if (m.connId && m.connId !== connId) this.out.close(m.connId);
      m.connId = connId;
    } else {
      m = this.addMember(connId, msg);
      if (!m) return NO;
    }

    if (msg.hostKey && msg.hostKey === this.s.hostKey) this.s.hostId = m.id;
    else if (this.s.hostId === null) this.s.hostId = m.id;
    if (this.s.hostId === m.id) {
      this.s.hostGoneAt = null;
    } else {
      const host = this.s.members.find((x) => x.id === this.s.hostId);
      if (host && host.connId === null && this.s.hostGoneAt === null) this.s.hostGoneAt = now;
    }
    this.s.emptySince = null;

    this.out.send(connId, { type: "welcome", token: m.token, you: { kind: m.kind, id: m.id } });
    if (this.s.phase === "playing" && m.kind === "player") {
      this.s.gameState = this.game.onPresence(this.s.gameState, m.id, true, now);
    }
    this.broadcast(now);
    return YES;
  }

  private addMember(connId: string, msg: HelloMessage): Member | null {
    let name = "Screen";
    if (msg.role === "player") {
      name = (msg.name ?? "").trim().replace(/\s+/g, " ").slice(0, LIMITS.nameMax);
      if (!name) {
        this.error(connId, "BAD_MESSAGE", "Pick a name first.");
        return null;
      }
      const players = this.s.members.filter((x) => x.kind === "player");
      if (players.length >= LIMITS.maxPlayers) {
        this.error(connId, "ROOM_FULL", `This room is full (${LIMITS.maxPlayers} players).`);
        this.out.close(connId);
        return null;
      }
      if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        this.error(connId, "NAME_TAKEN", `Someone here is already called ${name}.`);
        return null;
      }
    } else if (this.s.members.filter((x) => x.kind === "screen").length >= LIMITS.maxScreens) {
      this.error(connId, "SCREENS_FULL", `This room already has ${LIMITS.maxScreens} screens.`);
      this.out.close(connId);
      return null;
    }
    const m: Member = {
      id: this.deps.newId(),
      token: this.deps.newId(),
      kind: msg.role,
      name,
      avatar: msg.avatar ?? DEFAULT_AVATAR,
      connId,
      joinSeq: ++this.s.joinSeq,
    };
    this.s.members.push(m);
    return m;
  }

  private action(m: Member, payload: unknown, now: number): Handled {
    if (this.s.phase !== "playing" || m.kind !== "player") return NO;
    const action = this.game.parseAction(payload);
    if (action === null) return NO;
    const res = this.game.onAction(this.s.gameState, m.id, action, now);
    this.s.gameState = res.state;
    for (const ev of res.events ?? []) {
      for (const c of this.connected()) {
        if (ev.to === "all" || c.id !== m.id) this.out.send(c.connId!, { type: "event", payload: ev.payload });
      }
    }
    if (res.quiet) return NO;
    this.checkOver();
    this.broadcast(now);
    return YES;
  }

  private hostCmd(m: Member, cmd: HostCommand, now: number): Handled {
    if (m.id !== this.s.hostId) {
      this.error(m.connId!, "NOT_HOST", "Only the host can do that.");
      return NO;
    }
    const s = this.s;
    switch (cmd.cmd) {
      case "selectGame": {
        const game = this.deps.games[cmd.gameId];
        if (s.phase !== "lobby" || !game) return NO;
        s.gameId = cmd.gameId;
        s.settings = game.defaultSettings;
        break;
      }
      case "updateSettings":
        if (s.phase !== "lobby") return NO;
        s.settings = this.game.parseSettings(cmd.settings);
        break;
      case "start": {
        if (s.phase !== "lobby") return NO;
        const players = this.connected("player").sort((a, b) => a.joinSeq - b.joinSeq);
        const min = this.game.meta.minPlayers;
        if (players.length < min) {
          this.error(m.connId!, "NOT_ENOUGH_PLAYERS", `${this.game.meta.name} needs at least ${min} players.`);
          return NO;
        }
        const infos: PlayerInfo[] = players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: true }));
        s.gameState = this.game.setup(infos, s.settings, this.deps.newSeed(), now);
        s.phase = "playing";
        s.lastResults = null;
        this.checkOver();
        break;
      }
      case "skip":
        if (s.phase !== "playing") return NO;
        s.gameState = this.game.onSkip(s.gameState, now);
        this.checkOver();
        break;
      case "endGame":
        if (s.phase !== "playing") return NO;
        this.finish();
        break;
      case "kick": {
        const target = s.members.find((x) => x.id === cmd.playerId);
        if (!target || target.id === s.hostId) return NO;
        s.members = s.members.filter((x) => x !== target);
        if (target.connId) {
          this.error(target.connId, "KICKED", "You were removed from the room.");
          this.out.close(target.connId);
        }
        if (s.phase === "playing" && target.kind === "player") {
          s.gameState = this.game.onPresence(s.gameState, target.id, false, now);
          this.checkOver();
        }
        break;
      }
    }
    this.broadcast(now);
    return YES;
  }

  private transferHost(): void {
    const next = this.connected().sort((a, b) => a.joinSeq - b.joinSeq)[0];
    if (next) this.s.hostId = next.id;
    this.s.hostGoneAt = null;
  }

  private finish(): void {
    this.s.lastResults = this.game.results(this.s.gameState);
    this.s.phase = "lobby";
    this.s.gameState = null;
  }

  private checkOver(): void {
    if (this.s.phase === "playing" && this.game.isOver(this.s.gameState)) this.finish();
  }

  private broadcast(now: number): void {
    const room = this.snapshot();
    for (const c of this.connected()) {
      this.out.send(c.connId!, { type: "room", room, now });
      if (this.s.phase === "playing") {
        const viewer: Viewer = c.kind === "screen" ? { kind: "screen" } : { kind: "player", playerId: c.id };
        this.out.send(c.connId!, { type: "view", payload: this.game.view(this.s.gameState, viewer), now });
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @party/server exec vitest run`
Expected: all RoomCore tests pass. The workers suite and `tsc` come in Task 7.

- [ ] **Step 6: Commit**

```bash
git add party/src party/vitest.config.ts
git commit -m "feat(server): RoomCore with members, host handoff, modes and game routing"
```

---

### Task 7: Durable Object adapter, Worker entry and room creation

**Files:**
- Create: `party/src/{env,games,room,index}.ts`
- Create: `party/wrangler.jsonc`, `party/wrangler.local.jsonc`, `party/vitest.workers.config.ts`, `party/test/worker/env.d.ts`
- Test: `party/test/worker/room.worker.test.ts`

**Interfaces:**
- Consumes: `RoomCore`, `SavedRoom`, `CoreDeps` (Task 6); `doodleDash` from `@party/doodle-dash/rules` (Task 5); `makeRoomCode` (Task 1).
- Produces:
  - HTTP `POST /api/rooms` → `200 { code: string, hostKey: string }`, or `503 { error }` after 8 collisions
  - WebSocket at `/parties/room/:code`, speaking the `ClientMsg`/`ServerMsg` protocol
  - Durable Object class `Room`, bound as `Room`
  - `env.ts`: `interface Env { Room: DurableObjectNamespace<Room> }`

- [ ] **Step 1: Check the PartyServer API.** Dependencies were installed in Task 1.

```bash
grep -nE "onAlarm|getServerByName|routePartykitRequest|getConnection\b" party/node_modules/partyserver/dist/index.d.ts
```
Expected: all four names appear. If `onAlarm` is missing, implement `async alarm()` instead of `onAlarm()` in `room.ts`, with the same body.

- [ ] **Step 2: Write the config files**

`party/wrangler.jsonc` (for deploy; it serves the built web app):
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "party-games",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "../apps/web/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/parties/*", "/api/*"]
  },
  "durable_objects": { "bindings": [{ "name": "Room", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
}
```
`party/wrangler.local.jsonc` (for dev and tests; no assets, because Vite serves the web app in dev):
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "party-games-local",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "durable_objects": { "bindings": [{ "name": "Room", "class_name": "Room" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
}
```
If `wrangler dev` rejects `compatibility_date` as newer than its runtime, set it to the date wrangler prints.

`party/vitest.workers.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/worker/**/*.test.ts"],
    poolOptions: {
      workers: {
        // WebSockets to Durable Objects don't work with per-test isolated storage.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: "./wrangler.local.jsonc" },
      },
    },
  },
});
```
If the installed version's README shows a different config API (for example a Vite plugin), follow the README and keep the same `include` and wrangler config path.

`party/test/worker/env.d.ts`:
```ts
import type { Env } from "../../src/env";
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
```

(The `test` script and tsconfig types were already set in Task 1.)

- [ ] **Step 3: Write the failing worker test**

`party/test/worker/room.worker.test.ts`:
```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

type Msg = { type: string; [k: string]: unknown };

async function open(code: string) {
  const res = await SELF.fetch(`https://party.test/parties/room/${code}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`expected a websocket, got status ${res.status}`);
  ws.accept();
  const messages: Msg[] = [];
  ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data))));
  return { ws, messages };
}

async function createRoom() {
  const res = await SELF.fetch("https://party.test/api/rooms", { method: "POST" });
  expect(res.status).toBe(200);
  return res.json<{ code: string; hostKey: string }>();
}

describe("worker", () => {
  it("creates a room and welcomes its host over a websocket", async () => {
    const { code, hostKey } = await createRoom();
    expect(code).toMatch(/^[A-HJKMNP-Z]{4}$/);
    const { ws, messages } = await open(code);
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana", hostKey }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "room")).toBe(true));
    const welcome = messages.find((m) => m.type === "welcome") as { you: { id: string } };
    const room = messages.findLast((m) => m.type === "room") as { room: { hostId: string; gameId: string } };
    expect(room.room.hostId).toBe(welcome.you.id);
    expect(room.room.gameId).toBe("doodle-dash");
    ws.close();
  });

  it("refuses rooms that were never created", async () => {
    const { ws, messages } = await open("QQQQ");
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "ROOM_NOT_FOUND" }));
  });

  it("answers non-JSON with BAD_MESSAGE and keeps the room usable", async () => {
    const { code } = await createRoom();
    const { ws, messages } = await open(code);
    ws.send("not json {");
    await vi.waitFor(() => expect(messages[0]).toMatchObject({ type: "error", code: "BAD_MESSAGE" }));
    ws.send(JSON.stringify({ type: "hello", role: "player", name: "Ana" }));
    await vi.waitFor(() => expect(messages.some((m) => m.type === "welcome")).toBe(true));
    ws.close();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm --filter @party/server exec vitest run -c vitest.workers.config.ts`
Expected: FAIL, because `src/index.ts` doesn't exist yet.

- [ ] **Step 5: Implement the adapter and entry point**

`party/src/env.ts`:
```ts
import type { Room } from "./room";
export interface Env {
  Room: DurableObjectNamespace<Room>;
}
```

`party/src/games.ts`:
```ts
import { doodleDash } from "@party/doodle-dash/rules";
import type { AnyGame } from "./room-core";

export const games: Record<string, AnyGame> = { [doodleDash.id]: doodleDash };
export const DEFAULT_GAME_ID = doodleDash.id;
```

`party/src/room.ts`:
```ts
import { Server, type Connection, type WSMessage } from "partyserver";
import type { Env } from "./env";
import { DEFAULT_GAME_ID, games } from "./games";
import { RoomCore, type SavedRoom } from "./room-core";

const KEY = "room";

/** Thin Durable Object adapter: transport, persistence and alarms. All behavior lives in RoomCore. */
export class Room extends Server<Env> {
  private core!: RoomCore;
  private scheduled: number | null = null;

  async onStart() {
    const saved = await this.ctx.storage.get<SavedRoom>(KEY);
    this.core = this.makeCore(saved);
    this.scheduled = await this.ctx.storage.getAlarm();
  }

  private makeCore(saved?: SavedRoom): RoomCore {
    return new RoomCore(
      this.name,
      {
        newId: () => crypto.randomUUID(),
        newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
        games,
        defaultGameId: DEFAULT_GAME_ID,
      },
      {
        send: (id, msg) => this.getConnection(id)?.send(JSON.stringify(msg)),
        close: (id) => this.getConnection(id)?.close(4000, "closed by room"),
      },
      saved ? { saved, now: Date.now() } : undefined,
    );
  }

  onMessage(conn: Connection, message: WSMessage) {
    let data: unknown = null;
    if (typeof message === "string") {
      try {
        data = JSON.parse(message);
      } catch {
        data = null;
      }
    }
    const r = this.core.message(conn.id, data, Date.now());
    void this.after(r.persist);
  }

  onClose(conn: Connection) {
    void this.after(this.core.disconnect(conn.id, Date.now()).persist);
  }

  onError(conn: Connection) {
    void this.after(this.core.disconnect(conn.id, Date.now()).persist);
  }

  async onRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { hostKey } = await req.json<{ hostKey: string }>();
    const ok = this.core.create(hostKey, Date.now());
    if (ok) await this.after(true);
    return Response.json({ ok });
  }

  async onAlarm() {
    const now = Date.now();
    this.scheduled = null;
    if (this.core.shouldDiscard(now)) {
      await this.ctx.storage.delete(KEY);
      this.core = this.makeCore();
      return;
    }
    this.core.tick(now);
    await this.after(true);
  }

  private async after(persist: boolean) {
    if (persist) await this.ctx.storage.put(KEY, this.core.serialize());
    const at = this.core.nextAlarmAt();
    if (at === this.scheduled) return;
    this.scheduled = at;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }
}
```

`party/src/index.ts`:
```ts
import { makeRoomCode } from "@party/shared";
import { getServerByName, routePartykitRequest } from "partyserver";
import type { Env } from "./env";

export { Room } from "./room";

async function createRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeRoomCode();
    const hostKey = crypto.randomUUID();
    const stub = await getServerByName(env.Room, code);
    const res = await stub.fetch(
      new Request("https://room.internal/create", {
        method: "POST",
        headers: { "content-type": "application/json", "x-partykit-room": code },
        body: JSON.stringify({ hostKey }),
      }),
    );
    const { ok } = await res.json<{ ok: boolean }>();
    if (ok) return Response.json({ code, hostKey });
  }
  return Response.json({ error: "Couldn't find a free room code. Try again." }, { status: 503 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/rooms" && req.method === "POST") return createRoom(env);
    return (await routePartykitRequest(req, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Run all server tests and the type check**

Run: `pnpm --filter @party/server test && pnpm --filter @party/server typecheck`
Expected: the RoomCore tests and all 3 worker tests pass, with no type errors.

- [ ] **Step 7: Smoke-test `wrangler dev` by hand**

Run `pnpm --filter @party/server dev` in the background, then:
```bash
curl -s -X POST http://localhost:8787/api/rooms
```
Expected: JSON like `{"code":"KXQB","hostKey":"…"}`. Stop the dev server afterwards.

- [ ] **Step 8: Commit**

```bash
git add party
git commit -m "feat(server): Durable Object room adapter, room creation endpoint and worker tests"
```

---

### Task 8: Design tokens and the `@party/ui` kit

**Files:**
- Create: `shared/src/tokens.css`
- Create: `ui/src/{index.ts,base.css,ui.css,Button.tsx,PlayerChip.tsx,Banner.tsx,TimerRing.tsx,MuteToggle.tsx,avatars.ts,sound.ts,useWakeLock.ts,game-client.ts}`

**Interfaces:**
- Consumes: `Avatar`, `GameMeta`, `RoomSnapshot`, `You` from `@party/shared`.
- Produces:
  - Components:
    - `Button(props: ButtonHTMLAttributes & { variant?: "primary"|"secondary"|"ghost"|"danger"; size?: "md"|"lg"|"xl" })`
    - `PlayerChip({ name, avatar, dim?, badge?, size?: "md"|"lg", ...divProps })`
    - `Banner({ tone?: "info"|"warn"|"bad"|"good", floating?, action?, children })`
    - `TimerRing({ endsAt, totalMs, serverNow, size? })`, which renders `data-testid="timer"`
    - `MuteToggle({ floating? })`
  - Avatars: `AVATAR_EMOJI: string[]`, `AVATAR_COLORS: string[]`, `randomAvatar(): Avatar`
  - Sound: `type SoundName = "join"|"correct"|"tick"|"turnEnd"`, `playSound(name)`, `isMuted()`, `setMuted(m)`
  - `useWakeLock(active: boolean): void`
  - Game client types:
    - `interface GameClientProps<V> { view: V; room: RoomSnapshot; you: You; isHost: boolean; mode: "screen"|"phones"; send(action: unknown): void; onEvent(cb: (payload: unknown) => void): () => void; serverNow(): number; soundOn: boolean }`
    - `interface SettingsFormProps<S> { settings: S; onChange(next: S): void; disabled: boolean }`
    - `interface ClientGame { id: string; meta: GameMeta; emoji: string; Screen: ComponentType<GameClientProps<any>>; Phone: ComponentType<GameClientProps<any>>; Settings: ComponentType<SettingsFormProps<any>> }`
  - Importing `@party/ui` loads the fonts, the tokens, base styles and the kit's CSS as a side effect.

This task is presentational, so it has no unit tests. Its gate is the type check here, plus the visual check in Task 9.

- [ ] **Step 1: Write the tokens and styles**

`shared/src/tokens.css`:
```css
:root {
  color-scheme: dark;
  --bg: #0f0e17;
  --bg-raised: #1a1926;
  --bg-raised-2: #24223a;
  --bg-sunken: #0a0911;
  --line: rgba(255, 255, 255, 0.09);
  --text: #fffffe;
  --text-dim: #a7a9be;
  --accent: #ff8906;
  --accent-deep: #b85d00;
  --on-accent: #1a0d00;
  --violet: #7f5af0;
  --pink: #e53170;
  --good: #2cb67d;
  --warn: #ffd803;
  --bad: #ef4565;
  --focus: #ffd803;
  --radius-sm: 10px;
  --radius: 16px;
  --radius-lg: 28px;
  --shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  --font-display: "Fredoka Variable", ui-rounded, system-ui, sans-serif;
  --font-body: "Inter Variable", system-ui, sans-serif;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 40px;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --game-accent: var(--violet);
}
```

`ui/src/base.css`:
```css
*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background:
    radial-gradient(1200px 800px at 15% -10%, #2a1f4d 0%, transparent 60%),
    radial-gradient(900px 700px at 110% 110%, #3a1630 0%, transparent 55%),
    var(--bg);
  background-attachment: fixed;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; margin: 0; line-height: 1.1; }
p { margin: 0; }
input, textarea, select {
  font: inherit;
  color: var(--text);
  background: var(--bg-sunken);
  border: 2px solid var(--line);
  border-radius: var(--radius);
  padding: var(--space-3) var(--space-4);
  min-height: 48px;
  width: 100%;
}
input:focus-visible, textarea:focus-visible, select:focus-visible { outline: none; border-color: var(--focus); }
label { display: grid; gap: var(--space-2); font-weight: 600; color: var(--text-dim); }
.center { min-height: 100%; display: grid; place-items: center; padding: var(--space-5); text-align: center; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.8rem; color: var(--text-dim); font-weight: 700; }
.error { color: var(--bad); font-weight: 600; }
.link { background: none; border: 0; color: var(--text-dim); text-decoration: underline; font: inherit; cursor: pointer; min-height: 48px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

`ui/src/ui.css`:
```css
.btn {
  appearance: none; border: 0; cursor: pointer; color: var(--text);
  font: 600 1.05rem/1 var(--font-display); letter-spacing: 0.01em;
  border-radius: var(--radius); padding: 0 var(--space-5); min-height: 48px;
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  transition: transform 0.15s var(--ease-spring), box-shadow 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
.btn-primary { background: var(--accent); color: var(--on-accent); box-shadow: 0 5px 0 var(--accent-deep); }
.btn-primary:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 1px 0 var(--accent-deep); }
.btn-secondary { background: var(--bg-raised-2); box-shadow: inset 0 0 0 2px var(--line); }
.btn-secondary:active:not(:disabled), .btn-ghost:active:not(:disabled), .btn-danger:active:not(:disabled) { transform: scale(0.96); }
.btn-ghost { background: transparent; color: var(--text-dim); }
.btn-danger { background: var(--bad); color: #fff; }
.btn-lg { min-height: 56px; font-size: 1.2rem; }
.btn-xl { min-height: 64px; font-size: 1.4rem; width: 100%; }

.card { background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: var(--space-5); box-shadow: var(--shadow); }

.chip { display: inline-flex; align-items: center; gap: var(--space-2); padding: 6px 14px 6px 6px; border-radius: 999px; background: var(--bg-raised-2); font-weight: 600; animation: chip-in 0.4s var(--ease-spring); }
.chip-avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 1.25rem; }
.chip-lg { padding: 8px 20px 8px 8px; font-size: 1.25rem; }
.chip-lg .chip-avatar { width: 52px; height: 52px; font-size: 1.8rem; }
.chip-dim { opacity: 0.4; }
.chip-badge { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; background: var(--accent); color: var(--on-accent); padding: 3px 8px; border-radius: 999px; }
@keyframes chip-in { from { transform: scale(0.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.banner { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius); font-weight: 600; background: var(--bg-raised-2); }
.banner-warn { background: #3d3510; color: var(--warn); }
.banner-bad { background: #3d1220; color: #ffb3c1; }
.banner-good { background: #0f3324; color: #8ff0c4; }
.banner-floating { position: fixed; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); z-index: 50; box-shadow: var(--shadow); max-width: calc(100% - 32px); }

.timer { position: relative; display: grid; place-items: center; flex: none; }
.timer svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.timer-track { fill: none; stroke: var(--line); stroke-width: 6; }
.timer-fill { fill: none; stroke: var(--game-accent); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 0.2s linear; }
.timer span { font: 700 1.3rem var(--font-display); }
.timer-low .timer-fill { stroke: var(--bad); }
.timer-low span { color: var(--bad); animation: pulse 1s infinite; }
@keyframes pulse { 50% { transform: scale(1.15); } }

.mute-toggle { width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--bg-raised-2); font-size: 1.3rem; cursor: pointer; }
.mute-floating { position: fixed; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); z-index: 40; opacity: 0.7; }
```

- [ ] **Step 2: Write the components and hooks**

`ui/src/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg" | "xl";
}

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} btn-${size} ${className}`} {...rest} />;
}
```

`ui/src/PlayerChip.tsx`:
```tsx
import type { Avatar } from "@party/shared";
import type { HTMLAttributes, ReactNode } from "react";

export interface PlayerChipProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  avatar: Avatar;
  dim?: boolean;
  badge?: ReactNode;
  size?: "md" | "lg";
}

export function PlayerChip({ name, avatar, dim = false, badge, size = "md", className = "", ...rest }: PlayerChipProps) {
  return (
    <div className={`chip chip-${size} ${dim ? "chip-dim" : ""} ${className}`} {...rest}>
      <span className="chip-avatar" style={{ background: avatar.color }} aria-hidden>{avatar.emoji}</span>
      <span className="chip-name">{name}</span>
      {badge && <span className="chip-badge">{badge}</span>}
    </div>
  );
}
```

`ui/src/Banner.tsx`:
```tsx
import type { ReactNode } from "react";

export function Banner({ tone = "info", floating = false, action, children }: {
  tone?: "info" | "warn" | "bad" | "good";
  floating?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="status" className={`banner banner-${tone} ${floating ? "banner-floating" : ""}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}
```

`ui/src/TimerRing.tsx`:
```tsx
import { useEffect, useState } from "react";

export function TimerRing({ endsAt, totalMs, serverNow, size = 64 }: {
  endsAt: number;
  totalMs: number;
  serverNow: () => number;
  size?: number;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, endsAt - serverNow());
  const frac = totalMs > 0 ? Math.min(1, left / totalMs) : 0;
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <div className={`timer ${left > 0 && left <= 10_000 ? "timer-low" : ""}`} style={{ width: size, height: size }} data-testid="timer">
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <circle cx="32" cy="32" r={r} className="timer-track" />
        <circle cx="32" cy="32" r={r} className="timer-fill" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span aria-label="seconds left">{Math.ceil(left / 1000)}</span>
    </div>
  );
}
```

`ui/src/avatars.ts`:
```ts
import type { Avatar } from "@party/shared";

export const AVATAR_EMOJI = ["🦊", "🐙", "🐸", "🦄", "🐼", "🐯", "🐧", "🦖", "🐝", "🦉", "🐳", "🌵", "🍕", "👾", "🤖", "🎃"];
export const AVATAR_COLORS = ["#7f5af0", "#ff8906", "#e53170", "#2cb67d", "#3da9fc", "#ffd803", "#ef4565", "#94a1b2"];

export function randomAvatar(): Avatar {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  return { emoji: pick(AVATAR_EMOJI), color: pick(AVATAR_COLORS) };
}
```

`ui/src/sound.ts`:
```ts
export type SoundName = "join" | "correct" | "tick" | "turnEnd";

const KEY = "pg:muted";
const NOTES: Record<SoundName, [freq: number, at: number][]> = {
  join: [[523, 0], [784, 0.08]],
  correct: [[659, 0], [880, 0.09], [1319, 0.18]],
  tick: [[1200, 0]],
  turnEnd: [[784, 0], [587, 0.12], [392, 0.24]],
};
let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable: mute just won't persist */
  }
}

/** Tiny synthesized sound effects — no audio files to load. */
export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    const tick = name === "tick";
    const dur = tick ? 0.05 : 0.16;
    for (const [freq, at] of NOTES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tick ? "square" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(tick ? 0.04 : 0.18, t0 + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
    }
  } catch {
    /* audio unavailable */
  }
}
```

`ui/src/MuteToggle.tsx`:
```tsx
import { useState } from "react";
import { isMuted, setMuted } from "./sound";

export function MuteToggle({ floating = false }: { floating?: boolean }) {
  const [muted, setState] = useState(isMuted);
  return (
    <button
      type="button"
      className={`mute-toggle ${floating ? "mute-floating" : ""}`}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      aria-pressed={muted}
      onClick={() => {
        setMuted(!muted);
        setState(!muted);
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
```

`ui/src/useWakeLock.ts`:
```ts
import { useEffect } from "react";

/** Keep the screen awake while `active`; re-acquire after the tab becomes visible again. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* denied or unsupported: ignore */
      }
    };
    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
```

`ui/src/game-client.ts`:
```ts
import type { GameMeta, RoomSnapshot, You } from "@party/shared";
import type { ComponentType } from "react";

export interface GameClientProps<V = unknown> {
  view: V;
  room: RoomSnapshot;
  you: You;
  isHost: boolean;
  mode: "screen" | "phones";
  send(action: unknown): void;
  onEvent(cb: (payload: unknown) => void): () => void;
  serverNow(): number;
  soundOn: boolean;
}

export interface SettingsFormProps<S = unknown> {
  settings: S;
  onChange(next: S): void;
  disabled: boolean;
}

export interface ClientGame {
  id: string;
  meta: GameMeta;
  emoji: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Screen: ComponentType<GameClientProps<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Phone: ComponentType<GameClientProps<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Settings: ComponentType<SettingsFormProps<any>>;
}
```

`ui/src/index.ts`:
```ts
import "@fontsource-variable/fredoka";
import "@fontsource-variable/inter";
import "@party/shared/tokens.css";
import "./base.css";
import "./ui.css";

export { Button, type ButtonProps } from "./Button";
export { PlayerChip, type PlayerChipProps } from "./PlayerChip";
export { Banner } from "./Banner";
export { TimerRing } from "./TimerRing";
export { MuteToggle } from "./MuteToggle";
export { AVATAR_COLORS, AVATAR_EMOJI, randomAvatar } from "./avatars";
export { isMuted, playSound, setMuted, type SoundName } from "./sound";
export { useWakeLock } from "./useWakeLock";
export type { ClientGame, GameClientProps, SettingsFormProps } from "./game-client";
```

`ui/src/env.d.ts` (TypeScript needs this for CSS side-effect imports):
```ts
declare module "*.css";
declare module "@fontsource-variable/fredoka";
declare module "@fontsource-variable/inter";
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @party/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/src/tokens.css ui/src
git commit -m "feat(ui): design tokens and shared React UI kit"
```

---

### Task 9: Web app shell: home, join form and room connection

**Files:**
- Create: `apps/web/{index.html,vite.config.ts}`
- Create: `apps/web/src/{main.tsx,App.tsx,app.css,env.d.ts}`
- Create: `apps/web/src/lib/{storage,origin}.ts`
- Create: `apps/web/src/net/{roomState,useRoom}.ts`
- Create: `apps/web/src/pages/{Home,JoinForm,Fatal,RoomPage}.tsx`
- Test: `apps/web/src/net/roomState.test.ts`

**Interfaces:**
- Consumes:
  - From `@party/shared`: `ServerMsg`, `RoomSnapshot`, `You`, `ErrorCode`, `HostCommand`, `Avatar`, `isRoomCode`, `normalizeRoomCode`
  - From `@party/ui`: `Button`, `Banner`, `PlayerChip`, `MuteToggle`, `AVATAR_EMOJI`, `AVATAR_COLORS`, `randomAvatar`
  - The server endpoints from Task 7
- Produces:
  - `storage` (`lib/storage.ts`): `getToken`/`setToken`/`clearToken(code)`, `getHostKey`/`setHostKey(code)`, `getRole`/`setRole(code)` (`"screen"|"player"|null`), `getProfile()`/`setProfile(p: Profile)`, plus `interface Profile { name: string; avatar: Avatar }`
  - `publicOrigin(): string` (`lib/origin.ts`)
  - From `net/roomState.ts`: `FATAL_ERRORS: Set<ErrorCode>`, `interface ClientRoomState`, `initialRoomState`, `reduceServerMsg(state, msg, localNow)`
  - From `net/useRoom.ts`: `interface HelloInfo { role: "screen"|"player"; name?: string; avatar?: Avatar }`, `interface RoomConnection extends ClientRoomState { sendAction(payload: unknown): void; sendHost(cmd: HostCommand): void; onEvent(cb): () => void; serverNow(): number }`, `useRoom(code, hello)`
  - Pages: `Home`, `JoinForm`, `Fatal`, `RoomPage`
  - Test ids: `host-screen`, `host-phone`, `join-code`, `join-go`, `name-input`, `join-submit`, `lobby-player`

- [ ] **Step 1: Write the failing reducer test**

`apps/web/src/net/roomState.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@party/shared";
import { initialRoomState, reduceServerMsg } from "./roomState";

const room = (phase: "lobby" | "playing"): RoomSnapshot => ({
  code: "ABCD", hostId: "a", mode: "phones", phase, gameId: "doodle-dash", settings: {},
  players: [], screens: [], lastResults: null, belowMin: false,
});

describe("reduceServerMsg", () => {
  it("records who we are", () => {
    const s = reduceServerMsg(initialRoomState, { type: "welcome", token: "t", you: { kind: "player", id: "a" } }, 0);
    expect(s.you).toEqual({ kind: "player", id: "a" });
  });

  it("tracks the server clock offset", () => {
    const s = reduceServerMsg(initialRoomState, { type: "room", room: room("lobby"), now: 10_500 }, 10_000);
    expect(s.clockOffset).toBe(500);
  });

  it("drops the game view when the room returns to the lobby", () => {
    let s = reduceServerMsg(initialRoomState, { type: "view", payload: { x: 1 }, now: 0 }, 0);
    expect(s.view).toEqual({ x: 1 });
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.view).toBeNull();
  });

  it("marks fatal errors as closed and keeps them", () => {
    let s = reduceServerMsg(initialRoomState, { type: "error", code: "ROOM_NOT_FOUND", message: "gone" }, 0);
    expect(s.status).toBe("closed");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error?.code).toBe("ROOM_NOT_FOUND");
  });

  it("clears transient errors on the next room update", () => {
    let s = reduceServerMsg(initialRoomState, { type: "error", code: "NOT_HOST", message: "nope" }, 0);
    expect(s.status).toBe("connecting");
    s = reduceServerMsg(s, { type: "room", room: room("lobby"), now: 0 }, 0);
    expect(s.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @party/web test`
Expected: FAIL, with an error that `./roomState` can't be found.

- [ ] **Step 3: Implement the connection layer**

`apps/web/src/net/roomState.ts`:
```ts
import type { ErrorCode, RoomSnapshot, ServerMsg, You } from "@party/shared";

export const FATAL_ERRORS = new Set<ErrorCode>(["ROOM_NOT_FOUND", "ROOM_FULL", "SCREENS_FULL", "KICKED"]);

export interface ClientRoomState {
  status: "connecting" | "open" | "reconnecting" | "closed";
  you: You | null;
  room: RoomSnapshot | null;
  view: unknown | null;
  clockOffset: number;
  error: { code: ErrorCode; message: string } | null;
}

export const initialRoomState: ClientRoomState = {
  status: "connecting", you: null, room: null, view: null, clockOffset: 0, error: null,
};

export function reduceServerMsg(s: ClientRoomState, msg: ServerMsg, localNow: number): ClientRoomState {
  switch (msg.type) {
    case "welcome":
      return { ...s, you: msg.you, error: null };
    case "room":
      return {
        ...s,
        room: msg.room,
        view: msg.room.phase === "lobby" ? null : s.view,
        clockOffset: msg.now - localNow,
        error: s.error && FATAL_ERRORS.has(s.error.code) ? s.error : null,
      };
    case "view":
      return { ...s, view: msg.payload, clockOffset: msg.now - localNow };
    case "error":
      return {
        ...s,
        error: { code: msg.code, message: msg.message },
        status: FATAL_ERRORS.has(msg.code) ? "closed" : s.status,
      };
    case "event":
      return s;
  }
}
```

`apps/web/src/lib/storage.ts`:
```ts
import type { Avatar } from "@party/shared";

export interface Profile { name: string; avatar: Avatar }

const safe = {
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string): void {
    try { localStorage.setItem(k, v); } catch { /* private mode etc. */ }
  },
  del(k: string): void {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

export const storage = {
  getToken: (code: string) => safe.get(`pg:token:${code}`),
  setToken: (code: string, token: string) => safe.set(`pg:token:${code}`, token),
  clearToken: (code: string) => safe.del(`pg:token:${code}`),
  getHostKey: (code: string) => safe.get(`pg:hostKey:${code}`),
  setHostKey: (code: string, key: string) => safe.set(`pg:hostKey:${code}`, key),
  getRole(code: string): "screen" | "player" | null {
    const v = safe.get(`pg:role:${code}`);
    return v === "screen" || v === "player" ? v : null;
  },
  setRole: (code: string, role: "screen" | "player") => safe.set(`pg:role:${code}`, role),
  getProfile(): Profile | null {
    try {
      const p = JSON.parse(safe.get("pg:profile") ?? "null") as Profile | null;
      return p && typeof p.name === "string" && p.avatar ? p : null;
    } catch {
      return null;
    }
  },
  setProfile: (p: Profile) => safe.set("pg:profile", JSON.stringify(p)),
};
```

`apps/web/src/lib/origin.ts`:
```ts
/** Origin phones should use. In dev on the laptop (localhost), point phones at the LAN address instead. */
export function publicOrigin(): string {
  const { hostname, origin } = window.location;
  if (__LAN_ORIGIN__ && (hostname === "localhost" || hostname === "127.0.0.1")) return __LAN_ORIGIN__;
  return origin;
}
```

`apps/web/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
declare const __LAN_ORIGIN__: string;
```

`apps/web/src/net/useRoom.ts`:
```ts
import type { Avatar, HostCommand, ServerMsg } from "@party/shared";
import PartySocket from "partysocket";
import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "../lib/storage";
import { FATAL_ERRORS, initialRoomState, reduceServerMsg, type ClientRoomState } from "./roomState";

export interface HelloInfo { role: "screen" | "player"; name?: string; avatar?: Avatar }
export interface RoomConnection extends ClientRoomState {
  sendAction(payload: unknown): void;
  sendHost(cmd: HostCommand): void;
  onEvent(cb: (payload: unknown) => void): () => void;
  serverNow(): number;
}

export function useRoom(code: string, hello: HelloInfo | null): RoomConnection {
  const [state, setState] = useState<ClientRoomState>(initialRoomState);
  const wsRef = useRef<PartySocket | null>(null);
  const listeners = useRef(new Set<(payload: unknown) => void>());
  const offset = useRef(0);
  offset.current = state.clockOffset;
  const helloKey = hello
    ? [hello.role, hello.name ?? "", hello.avatar?.emoji ?? "", hello.avatar?.color ?? ""].join("|")
    : null;

  useEffect(() => {
    if (!hello) return;
    setState(initialRoomState);
    const ws = new PartySocket({
      host: window.location.host,
      protocol: window.location.protocol === "https:" ? "wss" : "ws",
      party: "room",
      room: code,
    });
    wsRef.current = ws;
    // Every (re)connect re-introduces us with our token, so the server returns us to our seat.
    const onOpen = () => {
      setState((s) => (s.status === "closed" ? s : { ...s, status: "open" }));
      ws.send(JSON.stringify({
        type: "hello",
        role: hello.role,
        token: storage.getToken(code) ?? undefined,
        hostKey: storage.getHostKey(code) ?? undefined,
        name: hello.name,
        avatar: hello.avatar,
      }));
    };
    const onClose = () => setState((s) => (s.status === "closed" ? s : { ...s, status: "reconnecting" }));
    const onMessage = (e: MessageEvent) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.type === "event") {
        for (const l of listeners.current) l(msg.payload);
        return;
      }
      if (msg.type === "welcome") storage.setToken(code, msg.token);
      if (msg.type === "error" && FATAL_ERRORS.has(msg.code)) {
        if (msg.code === "KICKED") storage.clearToken(code);
        ws.close(); // stops PartySocket from reconnecting
      }
      setState((s) => reduceServerMsg(s, msg, Date.now()));
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onClose);
    ws.addEventListener("message", onMessage);
    return () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("message", onMessage);
      ws.close();
      wsRef.current = null;
    };
    // `hello` is captured via helloKey on purpose: reconnect only when identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, helloKey]);

  const sendAction = useCallback((payload: unknown) => {
    wsRef.current?.send(JSON.stringify({ type: "action", payload }));
  }, []);
  const sendHost = useCallback((cmd: HostCommand) => {
    wsRef.current?.send(JSON.stringify({ type: "host", cmd }));
  }, []);
  const onEvent = useCallback((cb: (payload: unknown) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { ...state, sendAction, sendHost, onEvent, serverNow };
}
```

- [ ] **Step 4: Run the reducer test**

Run: `pnpm --filter @party/web test`
Expected: 5 tests pass.

- [ ] **Step 5: Write the app shell, pages and styles**

`apps/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";

function lanOrigin(port: number): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return `http://${i.address}:${port}`;
  }
  return "";
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: { __LAN_ORIGIN__: JSON.stringify(command === "serve" ? lanOrigin(5173) : "") },
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/parties": { target: "http://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
}));
```
If `test` gives a type error in `defineConfig`, add `/// <reference types="vitest/config" />` at the top of the file.

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0f0e17" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎉</text></svg>" />
    <title>Party Games</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import "@party/ui";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/web/src/App.tsx`:
```tsx
import { MuteToggle } from "@party/ui";
import { Route, Switch } from "wouter";
import { Fatal } from "./pages/Fatal";
import { Home } from "./pages/Home";
import { RoomPage } from "./pages/RoomPage";

export function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/room/:code">{(params) => <RoomPage key={params.code} code={params.code} />}</Route>
        <Route>
          <Fatal message="Page not found." />
        </Route>
      </Switch>
      <MuteToggle floating />
    </>
  );
}
```

`apps/web/src/pages/Fatal.tsx`:
```tsx
export function Fatal({ message }: { message: string }) {
  return (
    <main className="center">
      <div className="card fatal">
        <p className="fatal-emoji" aria-hidden>🫠</p>
        <h1>{message}</h1>
        <a className="btn btn-primary btn-lg" href="/">Back to start</a>
      </div>
    </main>
  );
}
```

`apps/web/src/pages/Home.tsx`:
```tsx
import { isRoomCode, normalizeRoomCode } from "@party/shared";
import { Button } from "@party/ui";
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { storage } from "../lib/storage";

export function Home() {
  const [, navigate] = useLocation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function host(role: "screen" | "player") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { code: newCode, hostKey } = (await res.json()) as { code: string; hostKey: string };
      storage.setHostKey(newCode, hostKey);
      storage.setRole(newCode, role);
      navigate(`/room/${newCode}`);
    } catch {
      setError("Couldn't create a room. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (!isRoomCode(c)) {
      setError("Room codes are 4 letters.");
      return;
    }
    storage.setRole(c, "player");
    navigate(`/room/${c}`);
  }

  return (
    <main className="home">
      <h1 className="logo">Party<span>Games</span></h1>
      <p className="tagline">One screen. Everyone's phones. Zero chill.</p>
      <form className="card join-card" onSubmit={join}>
        <label>
          Got a room code?
          <input
            data-testid="join-code"
            className="code-input"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <Button type="submit" size="xl" data-testid="join-go">Join</Button>
      </form>
      <div className="host-row">
        <Button size="lg" variant="secondary" data-testid="host-screen" disabled={busy} onClick={() => host("screen")}>
          📺 Host on this screen
        </Button>
        <Button size="lg" variant="ghost" data-testid="host-phone" disabled={busy} onClick={() => host("player")}>
          📱 Start from my phone
        </Button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
```

`apps/web/src/pages/JoinForm.tsx`:
```tsx
import type { Avatar } from "@party/shared";
import { AVATAR_COLORS, AVATAR_EMOJI, Button, randomAvatar } from "@party/ui";
import { useState } from "react";
import type { Profile } from "../lib/storage";

export function JoinForm({ code, initial, error, onJoin, onScreen }: {
  code: string;
  initial: Profile | null;
  error: string | null;
  onJoin(p: Profile): void;
  onScreen(): void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState<Avatar>(initial?.avatar ?? randomAvatar);
  const trimmed = name.trim();
  return (
    <main className="join">
      <p className="eyebrow">Joining room</p>
      <h1 className="room-code-md">{code}</h1>
      <form
        className="card join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onJoin({ name: trimmed.slice(0, 16), avatar });
        }}
      >
        <label>
          Your name
          <input
            data-testid="name-input"
            value={name}
            maxLength={16}
            autoFocus
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="emoji-grid" role="radiogroup" aria-label="Avatar">
          {AVATAR_EMOJI.map((em) => (
            <button
              type="button"
              key={em}
              role="radio"
              aria-checked={avatar.emoji === em}
              className={`emoji-btn ${avatar.emoji === em ? "on" : ""}`}
              style={avatar.emoji === em ? { background: avatar.color } : undefined}
              onClick={() => setAvatar((a) => ({ ...a, emoji: em }))}
            >
              {em}
            </button>
          ))}
        </div>
        <div className="color-row" role="radiogroup" aria-label="Color">
          {AVATAR_COLORS.map((c) => (
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={avatar.color === c}
              aria-label={`Color ${c}`}
              className={`color-dot ${avatar.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setAvatar((a) => ({ ...a, color: c }))}
            />
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" size="xl" data-testid="join-submit" disabled={!trimmed}>Join</Button>
      </form>
      <button type="button" className="link" onClick={onScreen}>Use this device as a shared screen instead</button>
    </main>
  );
}
```

`apps/web/src/pages/RoomPage.tsx`: this is the interim version. Task 10 replaces the connected branch with the real lobby and game stage.
```tsx
import { isRoomCode, normalizeRoomCode } from "@party/shared";
import { Banner, PlayerChip } from "@party/ui";
import { useEffect, useState } from "react";
import { storage } from "../lib/storage";
import { FATAL_ERRORS } from "../net/roomState";
import { useRoom, type HelloInfo } from "../net/useRoom";
import { Fatal } from "./Fatal";
import { JoinForm } from "./JoinForm";

function initialHello(code: string): HelloInfo | null {
  if (storage.getRole(code) === "screen") return { role: "screen" };
  const profile = storage.getProfile();
  return storage.getToken(code) && profile ? { role: "player", ...profile } : null;
}

export function RoomPage({ code: raw }: { code: string }) {
  const code = normalizeRoomCode(raw);
  const [hello, setHello] = useState<HelloInfo | null>(() => initialHello(code));
  const [nameError, setNameError] = useState<string | null>(null);
  const r = useRoom(code, isRoomCode(code) ? hello : null);

  useEffect(() => {
    if (!r.error || r.you) return;
    if (r.error.code === "NAME_TAKEN" || r.error.code === "BAD_MESSAGE") {
      setNameError(r.error.message);
      setHello(null);
    }
  }, [r.error, r.you]);

  if (!isRoomCode(code)) return <Fatal message="That isn't a valid room code." />;
  if (!hello) {
    return (
      <JoinForm
        code={code}
        initial={storage.getProfile()}
        error={nameError}
        onJoin={(p) => {
          storage.setProfile(p);
          storage.setRole(code, "player");
          setNameError(null);
          setHello({ role: "player", ...p });
        }}
        onScreen={() => {
          storage.setRole(code, "screen");
          setHello({ role: "screen" });
        }}
      />
    );
  }
  if (r.error && FATAL_ERRORS.has(r.error.code)) return <Fatal message={r.error.message} />;
  if (!r.room || !r.you) return <div className="center"><p className="loading">Connecting…</p></div>;

  return (
    <main className="center">
      {r.status === "reconnecting" && <Banner tone="warn" floating>Reconnecting…</Banner>}
      <div className="card">
        <h1>Room {r.room.code}</h1>
        {r.room.players.map((p) => (
          <PlayerChip key={p.id} data-testid="lobby-player" name={p.name} avatar={p.avatar} dim={!p.connected} />
        ))}
      </div>
    </main>
  );
}
```

`apps/web/src/app.css`:
```css
.home, .join { min-height: 100%; display: grid; align-content: center; justify-items: center; gap: var(--space-5); padding: var(--space-6) var(--space-4); max-width: 520px; margin: 0 auto; text-align: center; }
.logo { font-size: clamp(3rem, 12vw, 5.5rem); letter-spacing: -0.02em; }
.logo span { color: var(--accent); }
.tagline { color: var(--text-dim); font-size: 1.15rem; }
.join-card, .join-form { width: 100%; display: grid; gap: var(--space-4); text-align: left; }
.code-input { font: 700 2.2rem var(--font-display); letter-spacing: 0.4em; text-align: center; text-transform: uppercase; }
.host-row { display: grid; gap: var(--space-3); width: 100%; }
.room-code-md { font-size: 3rem; letter-spacing: 0.2em; }
.emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: var(--space-2); }
.emoji-btn { aspect-ratio: 1; min-height: 40px; border-radius: 50%; border: 0; background: var(--bg-raised-2); font-size: 1.4rem; cursor: pointer; transition: transform 0.2s var(--ease-spring); }
.emoji-btn.on { transform: scale(1.15); }
.color-row { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; }
.color-dot { width: 40px; height: 40px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; }
.color-dot.on { border-color: var(--text); }
.fatal { display: grid; gap: var(--space-4); justify-items: center; max-width: 420px; }
.fatal-emoji { font-size: 3rem; }
.loading { color: var(--text-dim); font: 600 1.4rem var(--font-display); }
@media (max-width: 380px) { .emoji-grid { grid-template-columns: repeat(4, 1fr); } }
```

- [ ] **Step 6: Run the type check, tests and build**

Run: `pnpm --filter @party/web typecheck && pnpm --filter @party/web test && pnpm --filter @party/web build`
Expected: all three succeed. `apps/web/dist/index.html` exists.

- [ ] **Step 7: Check in a browser**

Run `pnpm dev` in the background. Then:
1. Open `http://localhost:5173` and click "Host on this screen". The URL should become `/room/XXXX` and show "Room XXXX".
2. In a second (private) window, open `/room/XXXX`, enter a name and join. Both windows should list the player.
3. Reload the player window. It should rejoin without the form, and there should still be one player.

Take a screenshot of the home page at 390×844 and at 1280×720 to confirm the layout. Stop `pnpm dev` when done.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): app shell, home, join form and room connection"
```

---

### Task 10: Lobby, host controls, game stage and client game registry

**Files:**
- Create: `apps/web/src/games.ts`
- Create: `apps/web/src/lobby/{ScreenLobby,PhoneLobby,HostPanel,GameLibrary,Results,LobbyBackground}.tsx`, `apps/web/src/lobby/lobby.css`
- Create: `apps/web/src/stage/{GameStage,HostBar}.tsx`
- Modify: `apps/web/src/pages/RoomPage.tsx` (replace the connected branch)

**Interfaces:**
- Consumes:
  - `RoomConnection` and `useRoom` (Task 9)
  - From `@party/ui` (Task 8): `ClientGame`, `GameClientProps`, `Button`, `Banner`, `PlayerChip`, `playSound`, `useWakeLock`
  - `RoomSnapshot`, `You`, `HostCommand`, `GameResult` from `@party/shared`
- Produces:
  - From `games.ts`:
    - `clientGames: Record<string, ClientGame>`. It is **empty in this task**; Task 12 registers Doodle Dash.
    - `comingSoon: { id: string; name: string; tagline: string; emoji: string; accent: string }[]`
  - Test ids: `room-code`, `lobby-player`, `phone-lobby`, `start-game`, `host-skip`, `host-end`
  - `GameStage` renders the registered game's `Screen` or `Phone` component with `GameClientProps`.

- [ ] **Step 1: Write the registry and lobby components**

`apps/web/src/games.ts`:
```ts
import type { ClientGame } from "@party/ui";

/** Playable games, keyed by id. Games register here (Doodle Dash is added in Task 12). */
export const clientGames: Record<string, ClientGame> = {};

export const comingSoon = [
  { id: "puff-up", name: "Puff Up", tagline: "Answer before it pops.", emoji: "🐡", accent: "#ff8906" },
  { id: "blank-slate", name: "Blank Slate", tagline: "Fill the blank. Win the room.", emoji: "🃏", accent: "#e53170" },
  { id: "head-to-head", name: "Head to Head", tagline: "Two answers enter. One leaves.", emoji: "⚔️", accent: "#3da9fc" },
  { id: "property-rush", name: "Property Rush", tagline: "Buy low. Gloat high.", emoji: "🏙️", accent: "#2cb67d" },
];
```

`apps/web/src/lobby/GameLibrary.tsx`:
```tsx
import type { CSSProperties } from "react";
import { clientGames, comingSoon } from "../games";

export function GameLibrary({ selected, onSelect }: { selected: string; onSelect(id: string): void }) {
  return (
    <div className="game-library" role="radiogroup" aria-label="Game">
      {Object.values(clientGames).map((g) => (
        <button
          key={g.id}
          type="button"
          role="radio"
          aria-checked={selected === g.id}
          className={`game-card ${selected === g.id ? "on" : ""}`}
          style={{ "--card-accent": g.meta.accent } as CSSProperties}
          onClick={() => onSelect(g.id)}
        >
          <span className="game-emoji" aria-hidden>{g.emoji}</span>
          <strong>{g.meta.name}</strong>
          <span className="game-tagline">{g.meta.tagline}</span>
        </button>
      ))}
      {comingSoon.map((g) => (
        <div key={g.id} className="game-card game-card-soon" style={{ "--card-accent": g.accent } as CSSProperties}>
          <span className="game-emoji" aria-hidden>{g.emoji}</span>
          <strong>{g.name}</strong>
          <span className="game-tagline">Coming soon</span>
        </div>
      ))}
    </div>
  );
}
```

`apps/web/src/lobby/HostPanel.tsx`:
```tsx
import type { HostCommand, RoomSnapshot } from "@party/shared";
import { Button } from "@party/ui";
import { clientGames } from "../games";
import { GameLibrary } from "./GameLibrary";

export function HostPanel({ room, sendHost }: { room: RoomSnapshot; sendHost(cmd: HostCommand): void }) {
  const game = clientGames[room.gameId];
  const ready = room.players.filter((p) => p.connected).length;
  const min = game?.meta.minPlayers ?? 2;
  const missing = Math.max(0, min - ready);
  return (
    <section className="host-panel card">
      <h2>Pick a game</h2>
      <GameLibrary selected={room.gameId} onSelect={(gameId) => sendHost({ cmd: "selectGame", gameId })} />
      {game && (
        <>
          <h3>Settings</h3>
          <game.Settings
            settings={room.settings}
            onChange={(settings) => sendHost({ cmd: "updateSettings", settings })}
            disabled={false}
          />
        </>
      )}
      <Button
        size="xl"
        data-testid="start-game"
        disabled={!game || missing > 0}
        onClick={() => sendHost({ cmd: "start" })}
      >
        {!game ? "Pick a game" : missing > 0 ? `Need ${missing} more player${missing === 1 ? "" : "s"}` : `Start ${game.meta.name}`}
      </Button>
    </section>
  );
}
```

`apps/web/src/lobby/Results.tsx`:
```tsx
import type { GameResult } from "@party/shared";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Results({ results }: { results: GameResult[] }) {
  return (
    <section className="results card" aria-label="Last game results">
      <h2>Last game</h2>
      <ol>
        {results.map((r, i) => (
          <li key={r.playerId} style={{ animationDelay: `${i * 80}ms` }}>
            <span className="medal" aria-hidden>{MEDALS[i] ?? `${i + 1}.`}</span>
            <span className="results-name">{r.name}</span>
            <span className="results-score">{r.score}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

`apps/web/src/lobby/LobbyBackground.tsx`:
```tsx
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";

const COLORS = ["#7f5af0", "#ff8906", "#e53170", "#2cb67d"];
const SHAPES = Array.from({ length: 14 }, (_, i) => ({
  pos: [((i * 7) % 13) - 6, ((i * 5) % 9) - 4, -3 - (i % 4)] as [number, number, number],
  color: COLORS[i % COLORS.length]!,
  speed: 0.15 + (i % 5) * 0.06,
  kind: i % 3,
}));

function Shape({ pos, color, speed, kind }: (typeof SHAPES)[number]) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime * speed;
    m.rotation.set(t, t * 0.7, 0);
    m.position.y = pos[1] + Math.sin(t * 2) * 0.4;
  });
  return (
    <mesh ref={ref} position={pos}>
      {kind === 0 ? <icosahedronGeometry args={[0.6, 0]} /> : kind === 1 ? <torusGeometry args={[0.5, 0.18, 16, 32]} /> : <octahedronGeometry args={[0.6, 0]} />}
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
    </mesh>
  );
}

/** Subtle floating shapes behind the screen lobby. Lazy-loaded; skipped for reduced motion. */
export default function LobbyBackground() {
  return (
    <div className="lobby-bg" aria-hidden>
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={1.2} />
        {SHAPES.map((s, i) => <Shape key={i} {...s} />)}
      </Canvas>
    </div>
  );
}
```

`apps/web/src/lobby/ScreenLobby.tsx`:
```tsx
import type { HostCommand, RoomSnapshot } from "@party/shared";
import { PlayerChip, playSound } from "@party/ui";
import { QRCodeSVG } from "qrcode.react";
import { lazy, Suspense, useEffect, useRef } from "react";
import { publicOrigin } from "../lib/origin";
import { HostPanel } from "./HostPanel";
import { Results } from "./Results";

const LobbyBackground = lazy(() => import("./LobbyBackground"));
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function ScreenLobby({ room, isHost, sendHost }: { room: RoomSnapshot; isHost: boolean; sendHost(cmd: HostCommand): void }) {
  const url = `${publicOrigin()}/room/${room.code}`;
  const count = room.players.length;
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) playSound("join");
    prev.current = count;
  }, [count]);

  return (
    <div className="lobby-screen">
      {!reducedMotion() && (
        <Suspense fallback={null}>
          <LobbyBackground />
        </Suspense>
      )}
      <section className="code-panel card">
        <p className="eyebrow">Join at <strong>{new URL(url).host}</strong></p>
        <div className="room-code" data-testid="room-code">{room.code}</div>
        <div className="qr">
          <QRCodeSVG value={url} size={220} bgColor="#ffffff" fgColor="#0f0e17" marginSize={2} />
        </div>
        <p className="code-hint">Scan with your phone camera</p>
      </section>
      <section className="players-panel">
        <h2>{count ? `${count} player${count === 1 ? "" : "s"} in` : "Waiting for players…"}</h2>
        <div className="players-grid">
          {room.players.map((p) => (
            <PlayerChip key={p.id} data-testid="lobby-player" size="lg" name={p.name} avatar={p.avatar} dim={!p.connected} badge={p.isHost ? "host" : undefined} />
          ))}
        </div>
        {room.lastResults && <Results results={room.lastResults} />}
        {isHost ? <HostPanel room={room} sendHost={sendHost} /> : <p className="waiting">Waiting for the host to start…</p>}
      </section>
    </div>
  );
}
```

`apps/web/src/lobby/PhoneLobby.tsx`:
```tsx
import type { HostCommand, RoomSnapshot, You } from "@party/shared";
import { Button, PlayerChip } from "@party/ui";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { clientGames } from "../games";
import { publicOrigin } from "../lib/origin";
import { HostPanel } from "./HostPanel";
import { Results } from "./Results";

export function PhoneLobby({ room, you, isHost, sendHost }: { room: RoomSnapshot; you: You; isHost: boolean; sendHost(cmd: HostCommand): void }) {
  const me = room.players.find((p) => p.id === you.id);
  const game = clientGames[room.gameId];
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="phone phone-lobby" data-testid="phone-lobby">
      <header className="phone-header">
        <span className="eyebrow">Room</span>
        <strong className="room-code-sm">{room.code}</strong>
      </header>
      {me && <PlayerChip size="lg" name={me.name} avatar={me.avatar} badge={isHost ? "host" : undefined} />}
      {room.lastResults && <Results results={room.lastResults} />}
      {isHost ? (
        <>
          {room.mode === "phones" && (
            <Button variant="secondary" onClick={() => setShowCode((s) => !s)}>
              {showCode ? "Hide join code" : "Show join code"}
            </Button>
          )}
          {showCode && (
            <div className="qr qr-phone card">
              <QRCodeSVG value={`${publicOrigin()}/room/${room.code}`} size={180} bgColor="#ffffff" fgColor="#0f0e17" marginSize={2} />
              <strong className="room-code-sm">{room.code}</strong>
            </div>
          )}
          <HostPanel room={room} sendHost={sendHost} />
        </>
      ) : (
        <div className="card waiting-card">
          {game && <p className="waiting-game">{game.emoji} {game.meta.name}</p>}
          <p>Waiting for the host to start…</p>
        </div>
      )}
      <h3>Players</h3>
      <div className="players-list">
        {room.players.map((p) => (
          <PlayerChip key={p.id} data-testid="lobby-player" name={p.name} avatar={p.avatar} dim={!p.connected} badge={p.isHost ? "host" : undefined} />
        ))}
      </div>
    </div>
  );
}
```

`apps/web/src/stage/HostBar.tsx`:
```tsx
export function HostBar({ onSkip, onEnd }: { onSkip(): void; onEnd(): void }) {
  return (
    <div className="host-bar" aria-label="Host controls">
      <button type="button" data-testid="host-skip" onClick={onSkip}>⏭ Skip</button>
      <button
        type="button"
        data-testid="host-end"
        onClick={() => {
          if (window.confirm("End the game for everyone?")) onEnd();
        }}
      >
        ⏹ End
      </button>
    </div>
  );
}
```

`apps/web/src/stage/GameStage.tsx`:
```tsx
import { Banner, Button, useWakeLock, type GameClientProps } from "@party/ui";
import type { CSSProperties } from "react";
import { clientGames } from "../games";
import type { RoomConnection } from "../net/useRoom";
import { HostBar } from "./HostBar";

export function GameStage({ r, isHost }: { r: RoomConnection; isHost: boolean }) {
  useWakeLock(true);
  const room = r.room!;
  const you = r.you!;
  const game = clientGames[room.gameId];
  if (!game) return <div className="center"><Banner tone="bad">This game isn't available on this device.</Banner></div>;
  if (r.view === null) return <div className="center"><p className="loading">Loading game…</p></div>;

  const props: GameClientProps = {
    view: r.view,
    room,
    you,
    isHost,
    mode: room.mode,
    send: r.sendAction,
    onEvent: r.onEvent,
    serverNow: r.serverNow,
    soundOn: you.kind === "screen" || room.mode === "phones",
  };
  const View = you.kind === "screen" ? game.Screen : game.Phone;
  return (
    <div className={`stage stage-${you.kind}`} style={{ "--game-accent": game.meta.accent } as CSSProperties}>
      {room.belowMin && (
        <Banner
          tone="warn"
          floating
          action={isHost ? <Button variant="secondary" onClick={() => r.sendHost({ cmd: "endGame" })}>End game</Button> : undefined}
        >
          Not enough players connected.
        </Banner>
      )}
      <View {...props} />
      {isHost && <HostBar onSkip={() => r.sendHost({ cmd: "skip" })} onEnd={() => r.sendHost({ cmd: "endGame" })} />}
    </div>
  );
}
```

`apps/web/src/lobby/lobby.css`:
```css
.lobby-bg { position: fixed; inset: 0; z-index: -1; opacity: 0.55; }
.lobby-screen { min-height: 100%; display: grid; grid-template-columns: minmax(320px, 1fr) 2fr; gap: var(--space-6); padding: 5vh 5vw; align-items: start; }
.code-panel { display: grid; justify-items: center; gap: var(--space-4); text-align: center; position: sticky; top: 5vh; }
.room-code { font: 700 clamp(4rem, 9vw, 8rem)/1 var(--font-display); letter-spacing: 0.12em; color: var(--accent); }
.qr { background: #fff; padding: var(--space-3); border-radius: var(--radius); line-height: 0; }
.code-hint { color: var(--text-dim); }
.players-panel { display: grid; gap: var(--space-5); }
.players-panel h2 { font-size: clamp(2rem, 3.5vw, 3rem); }
.players-grid { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.waiting { color: var(--text-dim); font: 600 1.5rem var(--font-display); }
.host-panel { display: grid; gap: var(--space-4); }
.game-library { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--space-3); }
.game-card { --card-accent: var(--violet); display: grid; gap: var(--space-1); justify-items: start; text-align: left; padding: var(--space-4); border-radius: var(--radius); border: 2px solid var(--line); background: var(--bg-raised-2); color: var(--text); font: inherit; cursor: pointer; transition: transform 0.2s var(--ease-spring), border-color 0.2s; }
.game-card.on { border-color: var(--card-accent); transform: translateY(-3px); box-shadow: 0 8px 24px color-mix(in srgb, var(--card-accent) 35%, transparent); }
.game-card strong { font: 600 1.15rem var(--font-display); }
.game-emoji { font-size: 2rem; }
.game-tagline { color: var(--text-dim); font-size: 0.9rem; }
.game-card-soon { opacity: 0.45; cursor: default; }
.results ol { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.results li { display: grid; grid-template-columns: 2.5rem 1fr auto; align-items: center; font: 600 1.2rem var(--font-display); animation: chip-in 0.4s var(--ease-spring) both; }
.results-score { color: var(--accent); }
.phone { min-height: 100%; display: grid; align-content: start; gap: var(--space-4); padding: max(var(--space-4), env(safe-area-inset-top)) var(--space-4) calc(var(--space-6) + env(safe-area-inset-bottom)); max-width: 560px; margin: 0 auto; }
.phone-header { display: flex; align-items: baseline; gap: var(--space-2); }
.room-code-sm { font: 700 1.6rem var(--font-display); letter-spacing: 0.15em; color: var(--accent); }
.qr-phone { display: grid; justify-items: center; gap: var(--space-2); background: #fff; color: #0f0e17; }
.waiting-card { display: grid; gap: var(--space-2); text-align: center; }
.waiting-game { font: 600 1.4rem var(--font-display); }
.players-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.stage { min-height: 100%; }
.host-bar { position: fixed; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); display: flex; gap: var(--space-2); z-index: 40; opacity: 0.6; transition: opacity 0.2s; }
.host-bar:hover, .host-bar:focus-within { opacity: 1; }
.host-bar button { min-height: 48px; padding: 0 var(--space-4); border-radius: 999px; border: 0; background: var(--bg-raised-2); color: var(--text); font: 600 0.95rem var(--font-display); cursor: pointer; }
@media (max-width: 900px) {
  .lobby-screen { grid-template-columns: 1fr; }
  .code-panel { position: static; }
}
```

- [ ] **Step 2: Replace the connected branch of `RoomPage.tsx`**

In `apps/web/src/pages/RoomPage.tsx`:
1. Replace the imports of `Banner, PlayerChip` with:
   ```tsx
   import { Banner } from "@party/ui";
   import "../lobby/lobby.css";
   import { PhoneLobby } from "../lobby/PhoneLobby";
   import { ScreenLobby } from "../lobby/ScreenLobby";
   import { GameStage } from "../stage/GameStage";
   ```
2. Replace the final `return (...)` with:
   ```tsx
   const isHost = r.room.hostId === r.you.id;
   return (
     <>
       {r.status === "reconnecting" && <Banner tone="warn" floating>Reconnecting…</Banner>}
       {r.error && <Banner tone="bad" floating>{r.error.message}</Banner>}
       {r.room.phase === "lobby" ? (
         r.you.kind === "screen" ? (
           <ScreenLobby room={r.room} isHost={isHost} sendHost={r.sendHost} />
         ) : (
           <PhoneLobby room={r.room} you={r.you} isHost={isHost} sendHost={r.sendHost} />
         )
       ) : (
         <GameStage r={r} isHost={isHost} />
       )}
     </>
   );
   ```

- [ ] **Step 3: Type-check, test and build**

Run: `pnpm --filter @party/web typecheck && pnpm --filter @party/web test && pnpm --filter @party/web build`
Expected: all succeed.

- [ ] **Step 4: Check in a browser**

With `pnpm dev` running:
1. Host on a 1280×720 window. You should see the large code, a scannable QR (try it with a real phone on the same Wi-Fi if one is available), and the coming-soon cards.
2. Join from a 390×844 window. The player chip should animate in on the screen, and the phone lobby should show "Waiting for the host…".
3. Reload the screen. It should rejoin as host.
4. Host from a phone-sized window ("Start from my phone"). "Show join code" should reveal the QR.

Take screenshots of both lobbies. Stop `pnpm dev`.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): screen and phone lobbies, host panel, game stage and registry"
```

---

### Task 11: Doodle Dash client: canvas, drawing pad, screen and phone views

**Files:**
- Create: `games/doodle-dash/src/client/{strokes.ts,useStrokes.ts,useDoodleSounds.ts,env.d.ts,doodle.css,index.ts}`
- Create: `games/doodle-dash/src/client/{CanvasView,DrawPad,parts,DoodleScreen,DoodlePhone,DoodleSettingsForm}.tsx`
- Test: `games/doodle-dash/src/client/strokes.test.ts`

**Interfaces:**
- Consumes:
  - From `../rules` (Task 5): `DoodleView`, `ViewFeedItem`, `DoodleSettings`, `DoodleAction`, `Stroke`, `StrokeOp`, `PALETTE`, `BRUSH_SIZES`, `CHOOSE_MS`, `REVEAL_MS`, `MAX_POINTS_PER_BATCH`, `doodleDash`
  - From `@party/ui` (Task 8): `GameClientProps`, `SettingsFormProps`, `ClientGame`, `Button`, `PlayerChip`, `TimerRing`, `playSound`
- Produces:
  - `export const doodleClient: ClientGame` from `@party/doodle-dash/client`, with `emoji: "🎨"`
  - Pure helpers: `applyOp(strokes, op): Stroke[]`, `floodFillData(data, w, h, x, y, rgb, tolerance?)`, `hexToRgb(hex)`, `renderStrokes(ctx, strokes)`, `CANVAS_W = 800`, `CANVAS_H = 600`
  - Test ids: `screen-canvas`, `phone-canvas`, `draw-canvas`, `word-choice`, `secret-word`, `guess-input`, `my-score`, `score-<Name>`, `reveal`

- [ ] **Step 1: Write the failing tests for the pure drawing helpers**

`games/doodle-dash/src/client/strokes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Stroke } from "../rules";
import { applyOp, floodFillData, hexToRgb } from "./strokes";

const pen = (id: number, points: number[]): Stroke => ({ id, tool: "pen", color: 0, size: 0, points });

describe("applyOp", () => {
  it("begins, appends, undoes and clears without mutating input", () => {
    const a: Stroke[] = [];
    const b = applyOp(a, { op: "begin", seq: 1, stroke: pen(1, [0, 0]) });
    const c = applyOp(b, { op: "append", seq: 2, strokeId: 1, points: [0.5, 0.5] });
    expect(a).toEqual([]);
    expect(b[0]).toMatchObject({ points: [0, 0] });
    expect(c[0]).toMatchObject({ points: [0, 0, 0.5, 0.5] });
    expect(applyOp(c, { op: "undo", seq: 3 })).toEqual([]);
    expect(applyOp(c, { op: "clear", seq: 3 })).toEqual([]);
  });

  it("ignores appends for a stroke that is not the latest", () => {
    const s = [pen(1, [0, 0]), pen(2, [1, 1])];
    expect(applyOp(s, { op: "append", seq: 3, strokeId: 1, points: [0.5, 0.5] })).toBe(s);
  });
});

describe("floodFillData", () => {
  it("fills the connected region and stops at walls", () => {
    // 3x3 white image with a black vertical wall in the middle column
    const w = 3, h = 3;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) data.set([0, 0, 0, 255], (y * w + 1) * 4);
    floodFillData(data, w, h, 0, 0, [255, 0, 0]);
    const px = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    expect(px(0, 2)).toEqual([255, 0, 0]);
    expect(px(1, 1)).toEqual([0, 0, 0]);
    expect(px(2, 0)).toEqual([255, 255, 255]);
  });

  it("does nothing when filling with the same color", () => {
    const data = new Uint8ClampedArray(4).fill(255);
    floodFillData(data, 1, 1, 0, 0, [255, 255, 255]);
    expect(Array.from(data)).toEqual([255, 255, 255, 255]);
  });

  it("parses hex colors", () => {
    expect(hexToRgb("#ff8906")).toEqual([255, 137, 6]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm --filter @party/doodle-dash test -- client`
Expected: FAIL, with an error that `./strokes` can't be found.

- [ ] **Step 3: Implement the pure helpers**

`games/doodle-dash/src/client/strokes.ts`:
```ts
import { BRUSH_SIZES, PALETTE, type Stroke, type StrokeOp } from "../rules";

export const CANVAS_W = 800;
export const CANVAS_H = 600;

export function applyOp(strokes: Stroke[], op: StrokeOp): Stroke[] {
  switch (op.op) {
    case "begin":
      return [...strokes, op.stroke];
    case "append": {
      const last = strokes.at(-1);
      if (!last || last.id !== op.strokeId || last.tool === "fill") return strokes;
      return [...strokes.slice(0, -1), { ...last, points: [...last.points, ...op.points] }];
    }
    case "undo":
      return strokes.slice(0, -1);
    case "clear":
      return [];
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function floodFillData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  tolerance = 48,
): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i0 = (y * w + x) * 4;
  const [tr, tg, tb] = [data[i0]!, data[i0 + 1]!, data[i0 + 2]!];
  if (tr === rgb[0] && tg === rgb[1] && tb === rgb[2]) return;
  const matches = (i: number) =>
    Math.abs(data[i]! - tr) + Math.abs(data[i + 1]! - tg) + Math.abs(data[i + 2]! - tb) <= tolerance;
  const seen = new Uint8Array(w * h);
  const stack = [y * w + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
    const px = p % w;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
}

export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[]): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const s of strokes) {
    if (s.tool === "fill") {
      const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const x = Math.min(CANVAS_W - 1, Math.floor(s.x * CANVAS_W));
      const y = Math.min(CANVAS_H - 1, Math.floor(s.y * CANVAS_H));
      floodFillData(img.data, CANVAS_W, CANVAS_H, x, y, hexToRgb(PALETTE[s.color] ?? "#000000"));
      ctx.putImageData(img, 0, 0);
      continue;
    }
    const p = s.points;
    if (p.length < 2) continue;
    ctx.strokeStyle = s.tool === "eraser" ? "#ffffff" : (PALETTE[s.color] ?? "#000000");
    ctx.lineWidth = BRUSH_SIZES[s.size] ?? 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p[0]! * CANVAS_W, p[1]! * CANVAS_H);
    if (p.length === 2) ctx.lineTo(p[0]! * CANVAS_W + 0.1, p[1]! * CANVAS_H); // a tap draws a dot
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]! * CANVAS_W, p[i + 1]! * CANVAS_H);
    ctx.stroke();
  }
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm --filter @party/doodle-dash test`
Expected: all rules and client tests pass.

- [ ] **Step 5: Write the hooks and components**

`games/doodle-dash/src/client/env.d.ts`:
```ts
declare module "*.css";
```

`games/doodle-dash/src/client/useStrokes.ts`:
```ts
import { useEffect, useRef, useState } from "react";
import type { DoodleView, Stroke, StrokeOp } from "../rules";
import { applyOp } from "./strokes";

/**
 * Local stroke list. Views are authoritative snapshots; events are live ops with increasing `seq`.
 * The drawer (`ownsCanvas`) keeps its optimistic local list for the current turn instead of
 * replacing it with every view, so in-flight points never flicker away.
 */
export function useStrokes(view: DoodleView, onEvent: (cb: (payload: unknown) => void) => () => void, ownsCanvas: boolean) {
  const [strokes, setStrokes] = useState<Stroke[]>(view.strokes);
  const seq = useRef(view.opSeq);
  const turn = useRef(view.turnKey);

  useEffect(() => {
    if (ownsCanvas && turn.current === view.turnKey) return;
    turn.current = view.turnKey;
    seq.current = view.opSeq;
    setStrokes(view.strokes);
  }, [view, ownsCanvas]);

  useEffect(
    () =>
      onEvent((payload) => {
        const op = payload as StrokeOp;
        if (typeof op?.seq !== "number" || op.seq <= seq.current) return;
        seq.current = op.seq;
        setStrokes((s) => applyOp(s, op));
      }),
    [onEvent],
  );

  return [strokes, setStrokes] as const;
}
```

`games/doodle-dash/src/client/useDoodleSounds.ts`:
```ts
import { playSound } from "@party/ui";
import { useEffect, useRef } from "react";
import type { DoodleView } from "../rules";

const lastCorrectId = (v: DoodleView) => v.feed.reduce((m, f) => (f.kind === "correct" ? Math.max(m, f.id) : m), 0);

export function useDoodleSounds(view: DoodleView, enabled: boolean, serverNow: () => number): void {
  const prev = useRef({ phase: view.phase, correct: lastCorrectId(view) });

  useEffect(() => {
    const p = prev.current;
    const correct = lastCorrectId(view);
    if (enabled) {
      if (correct > p.correct) playSound("correct");
      if (view.phase === "reveal" && p.phase !== "reveal") playSound("turnEnd");
    }
    prev.current = { phase: view.phase, correct };
  }, [view, enabled]);

  useEffect(() => {
    if (!enabled || view.phase !== "drawing") return;
    let lastSecond = -1;
    const id = setInterval(() => {
      const left = Math.ceil((view.phaseEndsAt - serverNow()) / 1000);
      if (left > 0 && left <= 5 && left !== lastSecond) {
        lastSecond = left;
        playSound("tick");
      }
    }, 200);
    return () => clearInterval(id);
  }, [enabled, view.phase, view.phaseEndsAt, serverNow]);
}
```

`games/doodle-dash/src/client/CanvasView.tsx`:
```tsx
import { useEffect, useRef, type CanvasHTMLAttributes } from "react";
import type { Stroke } from "../rules";
import { CANVAS_H, CANVAS_W, renderStrokes } from "./strokes";

type PointerProps = Pick<CanvasHTMLAttributes<HTMLCanvasElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel">;

/** Fixed 800×600 backing store, CSS-scaled, so every device renders identical pixels. */
export function CanvasView({ strokes, testId, className = "", ...pointer }: { strokes: readonly Stroke[]; testId?: string; className?: string } & PointerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(strokes);
  const frame = useRef(0);
  latest.current = strokes;

  useEffect(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const ctx = ref.current?.getContext("2d", { willReadFrequently: true });
      if (ctx) renderStrokes(ctx, latest.current);
    });
  }, [strokes]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} data-testid={testId} className={`dd-canvas ${className}`} {...pointer} />;
}
```

`games/doodle-dash/src/client/DrawPad.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from "react";
import { BRUSH_SIZES, MAX_POINTS_PER_BATCH, PALETTE, type DoodleAction, type Stroke } from "../rules";
import { CanvasView } from "./CanvasView";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
type Tool = "pen" | "eraser" | "fill";
const TOOL_ICONS: Record<Tool, string> = { pen: "✏️", eraser: "🧽", fill: "🪣" };

export function DrawPad({ strokes, setStrokes, send }: {
  strokes: Stroke[];
  setStrokes: Dispatch<SetStateAction<Stroke[]>>;
  send(action: DoodleAction): void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(1);
  const drawing = useRef(false);
  const pending = useRef<number[]>([]);
  const last = useRef<[number, number]>([0, 0]);
  const localId = useRef(-1); // negative ids never collide with server ids

  const flush = useCallback(() => {
    while (pending.current.length) send({ t: "strokeAppend", points: pending.current.splice(0, MAX_POINTS_PER_BATCH) });
  }, [send]);
  useEffect(() => {
    const id = setInterval(flush, 40);
    return () => clearInterval(id);
  }, [flush]);

  const pos = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const [x, y] = pos(e);
    if (tool === "fill") {
      send({ t: "fill", color, x, y });
      setStrokes((s) => [...s, { id: localId.current--, tool: "fill", color, x, y }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = [x, y];
    const id = localId.current--;
    send({ t: "strokeBegin", tool, color, size, points: [x, y] });
    setStrokes((s) => [...s, { id, tool, color, size, points: [x, y] }]);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const [x, y] = pos(e);
    if (Math.hypot(x - last.current[0], y - last.current[1]) < 0.002) return;
    last.current = [x, y];
    pending.current.push(x, y);
    setStrokes((s) => {
      const tail = s.at(-1);
      if (!tail || tail.tool === "fill") return s;
      return [...s.slice(0, -1), { ...tail, points: [...tail.points, x, y] }];
    });
  };

  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    flush();
  };

  return (
    <div className="dd-pad">
      <CanvasView strokes={strokes} testId="draw-canvas" className="dd-canvas-draw" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="dd-tools">
        <div className="dd-palette" role="radiogroup" aria-label="Color">
          {PALETTE.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === i}
              aria-label={`Color ${i + 1}`}
              className={`dd-swatch ${color === i ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(i);
                if (tool === "eraser") setTool("pen");
              }}
            />
          ))}
        </div>
        <div className="dd-toolrow">
          {(Object.keys(TOOL_ICONS) as Tool[]).map((t) => (
            <button key={t} type="button" aria-label={t} aria-pressed={tool === t} className={`dd-tool ${tool === t ? "on" : ""}`} onClick={() => setTool(t)}>
              {TOOL_ICONS[t]}
            </button>
          ))}
          {BRUSH_SIZES.map((px, i) => (
            <button key={px} type="button" aria-label={`Brush size ${i + 1}`} aria-pressed={size === i} className={`dd-size ${size === i ? "on" : ""}`} onClick={() => setSize(i)}>
              <span style={{ width: 6 + i * 7, height: 6 + i * 7 }} />
            </button>
          ))}
          <button type="button" className="dd-tool" aria-label="Undo" onClick={() => { send({ t: "undo" }); setStrokes((s) => s.slice(0, -1)); }}>↩️</button>
          <button type="button" className="dd-tool" aria-label="Clear" onClick={() => { send({ t: "clear" }); setStrokes([]); }}>🗑️</button>
        </div>
      </div>
    </div>
  );
}
```

`games/doodle-dash/src/client/parts.tsx`:
```tsx
import { Button } from "@party/ui";
import { useEffect, useRef, useState } from "react";
import type { DoodleView, ViewFeedItem } from "../rules";

export function Hint({ hint, big = false }: { hint: string | null; big?: boolean }) {
  if (!hint) return null;
  return (
    <div className={`dd-hint ${big ? "dd-hint-big" : ""}`} aria-label={`Hint: ${hint.replace(/_/g, "blank ")}`}>
      {[...hint].map((ch, i) => (
        <span key={i} className={ch === " " ? "dd-gap" : "dd-letter"}>{ch === "_" || ch === " " ? " " : ch}</span>
      ))}
    </div>
  );
}

export function Feed({ items, players, compact = false }: { items: ViewFeedItem[]; players: DoodleView["players"]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [items]);
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";
  return (
    <div ref={ref} className={`dd-feed ${compact ? "dd-feed-compact" : ""}`} aria-live="polite">
      {items.map((f) => (
        <p key={f.id} className={`dd-feed-item dd-feed-${f.kind}`}>
          {f.kind === "chat" && <b>{nameOf(f.playerId)}: </b>}
          {f.text}
        </p>
      ))}
    </div>
  );
}

export function Scoreboard({ view }: { view: DoodleView }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  return (
    <ol className="dd-scores">
      {sorted.map((p) => (
        <li key={p.id} className={`dd-score-row ${p.solved ? "solved" : ""} ${p.id === view.drawerId ? "drawer" : ""} ${p.connected ? "" : "chip-dim"}`}>
          <span className="dd-score-name">
            <span aria-hidden>{p.avatar.emoji}</span> {p.name} {p.id === view.drawerId && <span aria-label="drawing">✏️</span>}
            {p.solved && <span aria-label="guessed">✅</span>}
          </span>
          <span className="dd-score-num" data-testid={`score-${p.name}`}>{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

export function Reveal({ view }: { view: DoodleView }) {
  const gains = view.players.filter((p) => p.turnPoints > 0).sort((a, b) => b.turnPoints - a.turnPoints);
  return (
    <div className="dd-overlay" data-testid="reveal">
      <p>The word was</p>
      <p className="dd-reveal-word">{view.word}</p>
      <ul className="dd-gains">
        {gains.length === 0 && <li>Nobody got it 😬</li>}
        {gains.map((p) => (
          <li key={p.id}>{p.avatar.emoji} {p.name} <strong>+{p.turnPoints}</strong></li>
        ))}
      </ul>
    </div>
  );
}

export function GuessForm({ placeholder, onSubmit }: { placeholder: string; onSubmit(text: string): void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="dd-guess"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSubmit(t);
        setText("");
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        data-testid="guess-input"
        value={text}
        maxLength={60}
        placeholder={placeholder}
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <Button type="submit">Send</Button>
    </form>
  );
}
```

`games/doodle-dash/src/client/DoodleScreen.tsx`:
```tsx
import { PlayerChip, TimerRing, type GameClientProps } from "@party/ui";
import { CHOOSE_MS, REVEAL_MS, type DoodleView } from "../rules";
import { CanvasView } from "./CanvasView";
import { Feed, Hint, Reveal, Scoreboard } from "./parts";
import { useDoodleSounds } from "./useDoodleSounds";
import { useStrokes } from "./useStrokes";

export const phaseTotal = (v: DoodleView) =>
  v.phase === "choosing" ? CHOOSE_MS : v.phase === "drawing" ? v.drawTime * 1000 : REVEAL_MS;

export function DoodleScreen(p: GameClientProps<DoodleView>) {
  const { view, serverNow, onEvent } = p;
  const [strokes] = useStrokes(view, onEvent, false);
  useDoodleSounds(view, p.soundOn, serverNow);
  const drawer = view.players.find((x) => x.id === view.drawerId);
  return (
    <div className="dd-screen">
      <header className="dd-top">
        <span className="dd-round">Round {view.round} / {view.rounds}</span>
        <Hint hint={view.hint} big />
        <TimerRing endsAt={view.phaseEndsAt} totalMs={phaseTotal(view)} serverNow={serverNow} size={88} />
      </header>
      <main className="dd-stage">
        <div className="dd-canvas-wrap">
          <CanvasView strokes={strokes} testId="screen-canvas" />
          {view.phase === "choosing" && drawer && (
            <div className="dd-overlay">
              <PlayerChip size="lg" name={drawer.name} avatar={drawer.avatar} />
              <p>is choosing a word…</p>
            </div>
          )}
          {view.phase === "reveal" && <Reveal view={view} />}
        </div>
        <aside className="dd-side">
          <Scoreboard view={view} />
          <Feed items={view.feed} players={view.players} />
        </aside>
      </main>
    </div>
  );
}
```

`games/doodle-dash/src/client/DoodlePhone.tsx`:
```tsx
import { Button, TimerRing, type GameClientProps } from "@party/ui";
import type { DoodleAction, DoodleView } from "../rules";
import { CanvasView } from "./CanvasView";
import { phaseTotal } from "./DoodleScreen";
import { DrawPad } from "./DrawPad";
import { Feed, GuessForm, Hint, Reveal } from "./parts";
import { useDoodleSounds } from "./useDoodleSounds";
import { useStrokes } from "./useStrokes";

export function DoodlePhone(p: GameClientProps<DoodleView>) {
  const { view, serverNow, mode, onEvent } = p;
  const send = (a: DoodleAction) => p.send(a);
  const role = view.you?.role ?? "spectator";
  const isDrawer = role === "drawer";
  const [strokes, setStrokes] = useStrokes(view, onEvent, isDrawer && view.phase === "drawing");
  useDoodleSounds(view, p.soundOn, serverNow);
  const me = view.players.find((x) => x.id === p.you.id);
  const drawer = view.players.find((x) => x.id === view.drawerId);
  const showCanvas = mode === "phones";

  const header = (
    <header className="dd-phone-top">
      <span className="dd-round">R{view.round}/{view.rounds}</span>
      <span className="dd-myscore">⭐ <span data-testid="my-score">{me?.score ?? 0}</span></span>
      <TimerRing endsAt={view.phaseEndsAt} totalMs={phaseTotal(view)} serverNow={serverNow} size={52} />
    </header>
  );

  if (role === "spectator") {
    return (
      <div className="phone dd-phone">
        {header}
        <p className="dd-note">You joined mid-game. You'll be in the next one!</p>
        {showCanvas && <CanvasView strokes={strokes} testId="phone-canvas" />}
      </div>
    );
  }

  if (isDrawer && view.phase === "choosing") {
    return (
      <div className="phone dd-phone">
        {header}
        <h2 className="dd-title">Pick a word to draw</h2>
        <div className="dd-choices">
          {view.choices?.map((w, i) => (
            <Button key={w} size="xl" variant="secondary" data-testid="word-choice" onClick={() => send({ t: "choose", index: i })}>{w}</Button>
          ))}
        </div>
      </div>
    );
  }

  if (isDrawer && view.phase === "drawing") {
    return (
      <div className="phone dd-phone dd-phone-draw">
        {header}
        <p className="dd-secret">Draw: <strong data-testid="secret-word">{view.word}</strong></p>
        <DrawPad strokes={strokes} setStrokes={setStrokes} send={send} />
      </div>
    );
  }

  const solved = role === "solver";
  return (
    <div className="phone dd-phone">
      {header}
      {view.phase === "choosing" && <p className="dd-note">{drawer?.name ?? "Someone"} is choosing a word…</p>}
      {showCanvas && (
        <div className="dd-canvas-wrap">
          <CanvasView strokes={strokes} testId="phone-canvas" />
          {view.phase === "reveal" && <Reveal view={view} />}
        </div>
      )}
      {!showCanvas && view.phase === "reveal" && (
        <p className="dd-note">The word was <strong>{view.word}</strong></p>
      )}
      {view.phase === "drawing" && <Hint hint={view.hint} />}
      {solved && view.phase === "drawing" && <div className="dd-solved">✅ You got it! +{me?.turnPoints ?? 0}</div>}
      <Feed items={view.feed} players={view.players} compact />
      {!isDrawer && <GuessForm placeholder={solved ? "Chat with players who got it" : "Type your guess"} onSubmit={(text) => send({ t: "guess", text })} />}
    </div>
  );
}
```

`games/doodle-dash/src/client/DoodleSettingsForm.tsx`:
```tsx
import type { SettingsFormProps } from "@party/ui";
import { useEffect, useState } from "react";
import type { DoodleSettings } from "../rules";

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];
const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const splitWords = (text: string) => text.split(",").map((w) => w.trim()).filter(Boolean);
const sameWords = (text: string, list: string[]) => splitWords(text).join("|").toLowerCase() === list.join("|").toLowerCase();

export function DoodleSettingsForm({ settings, onChange, disabled }: SettingsFormProps<DoodleSettings>) {
  const [words, setWords] = useState(settings.customWords.join(", "));
  useEffect(() => {
    setWords((w) => (sameWords(w, settings.customWords) ? w : settings.customWords.join(", ")));
  }, [settings.customWords]);

  return (
    <div className="dd-settings">
      <div className="dd-field">
        <span className="dd-field-label">Rounds</span>
        <div className="stepper">
          <button type="button" aria-label="Fewer rounds" disabled={disabled || settings.rounds <= 1} onClick={() => onChange({ ...settings, rounds: settings.rounds - 1 })}>−</button>
          <span>{settings.rounds}</span>
          <button type="button" aria-label="More rounds" disabled={disabled || settings.rounds >= 6} onClick={() => onChange({ ...settings, rounds: settings.rounds + 1 })}>+</button>
        </div>
      </div>
      <label>
        Draw time
        <select value={settings.drawTime} disabled={disabled} onChange={(e) => onChange({ ...settings, drawTime: Number(e.target.value) })}>
          {DRAW_TIMES.map((s) => <option key={s} value={s}>{s} seconds</option>)}
        </select>
      </label>
      <div className="dd-field">
        <span className="dd-field-label">Words</span>
        <div className="segmented" role="radiogroup" aria-label="Word difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={settings.difficulty === d} className={settings.difficulty === d ? "on" : ""} disabled={disabled} onClick={() => onChange({ ...settings, difficulty: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <label>
        Custom words <span className="dd-hint-text">comma-separated, mixed into the pool</span>
        <textarea
          rows={2}
          value={words}
          disabled={disabled}
          placeholder="grandma's lasagna, the group chat"
          onChange={(e) => setWords(e.target.value)}
          onBlur={() => onChange({ ...settings, customWords: splitWords(words) })}
        />
      </label>
    </div>
  );
}
```

`games/doodle-dash/src/client/index.ts`:
```ts
import "./doodle.css";
import type { ClientGame } from "@party/ui";
import { doodleDash } from "../rules";
import { DoodlePhone } from "./DoodlePhone";
import { DoodleScreen } from "./DoodleScreen";
import { DoodleSettingsForm } from "./DoodleSettingsForm";

export const doodleClient: ClientGame = {
  id: doodleDash.id,
  meta: doodleDash.meta,
  emoji: "🎨",
  Screen: DoodleScreen,
  Phone: DoodlePhone,
  Settings: DoodleSettingsForm,
};
```

`games/doodle-dash/src/client/doodle.css`:
```css
.dd-screen { height: 100vh; display: grid; grid-template-rows: auto 1fr; gap: 2vh; padding: 5vh 5vw; }
.dd-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); }
.dd-round { font: 600 1.3rem var(--font-display); color: var(--text-dim); }
.dd-hint { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.3em; font: 700 1.6rem var(--font-display); }
.dd-hint-big { font-size: clamp(2rem, 3.4vw, 3.2rem); }
.dd-letter { min-width: 0.85em; text-align: center; border-bottom: 0.12em solid var(--game-accent); line-height: 1.25; }
.dd-gap { width: 0.6em; }
.dd-stage { display: grid; grid-template-columns: 1fr minmax(280px, 26vw); gap: 2vw; min-height: 0; }
.dd-canvas-wrap { position: relative; width: 100%; max-width: calc((100vh - 22vh) * 4 / 3); margin: 0 auto; align-self: center; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow); background: #fff; }
.dd-canvas { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; background: #fff; }
.dd-canvas-draw { touch-action: none; border-radius: var(--radius); box-shadow: var(--shadow); cursor: crosshair; }
.dd-overlay { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: var(--space-3); padding: var(--space-4); text-align: center; background: rgba(15, 14, 23, 0.84); font: 600 1.5rem var(--font-display); animation: dd-fade 0.3s ease-out; }
.dd-reveal-word { font: 700 clamp(2.4rem, 5vw, 4.5rem) var(--font-display); color: var(--warn); animation: chip-in 0.5s var(--ease-spring); }
.dd-gains { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); font-size: 1.15rem; }
.dd-gains strong { color: var(--good); }
.dd-side { display: grid; grid-template-rows: auto 1fr; gap: var(--space-4); min-height: 0; }
.dd-scores { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.dd-score-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-2) var(--space-4); border-radius: var(--radius); background: var(--bg-raised); font: 600 1.15rem var(--font-display); }
.dd-score-row.solved { background: #0f3324; }
.dd-score-row.drawer { box-shadow: inset 0 0 0 2px var(--game-accent); }
.dd-score-num { font-weight: 700; font-size: 1.3rem; }
.dd-feed { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: var(--space-3); background: var(--bg-sunken); border-radius: var(--radius); }
.dd-feed-compact { max-height: 30vh; min-height: 96px; }
.dd-feed-item { line-height: 1.35; overflow-wrap: anywhere; }
.dd-feed-item b { color: var(--text-dim); }
.dd-feed-correct { color: var(--good); font-weight: 700; }
.dd-feed-close { color: var(--warn); font-weight: 600; }
.dd-feed-system { color: var(--text-dim); font-style: italic; }
.dd-phone { gap: var(--space-3); }
.dd-phone-top { display: flex; align-items: center; justify-content: space-between; }
.dd-myscore { font: 700 1.3rem var(--font-display); }
.dd-phone-draw { overscroll-behavior: none; }
.dd-secret { text-align: center; font: 600 1.15rem var(--font-display); }
.dd-secret strong { color: var(--warn); font-size: 1.6rem; }
.dd-title { text-align: center; }
.dd-choices { display: grid; gap: var(--space-3); }
.dd-note { text-align: center; color: var(--text-dim); font: 600 1.15rem var(--font-display); }
.dd-solved { text-align: center; background: #0f3324; color: #8ff0c4; padding: var(--space-3); border-radius: var(--radius); font-weight: 700; }
.dd-guess { position: sticky; bottom: 0; display: grid; grid-template-columns: 1fr auto; gap: var(--space-2); padding: var(--space-2) 0 env(safe-area-inset-bottom); background: var(--bg); }
.dd-pad { display: grid; gap: var(--space-3); }
.dd-tools { display: grid; gap: var(--space-2); }
.dd-palette { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.dd-swatch { min-height: 48px; border-radius: var(--radius-sm); border: 3px solid transparent; cursor: pointer; transition: transform 0.15s var(--ease-spring); }
.dd-swatch.on { border-color: var(--text); transform: scale(1.06); }
.dd-toolrow { display: flex; flex-wrap: wrap; gap: 6px; }
.dd-tool, .dd-size { min-width: 48px; min-height: 48px; display: grid; place-items: center; border: 0; border-radius: var(--radius-sm); background: var(--bg-raised-2); color: var(--text); font-size: 1.3rem; cursor: pointer; }
.dd-tool.on, .dd-size.on { background: var(--game-accent); }
.dd-size span { display: block; border-radius: 50%; background: var(--text); }
.dd-settings { display: grid; gap: var(--space-4); }
.dd-field { display: grid; gap: var(--space-2); }
.dd-field-label { font-weight: 600; color: var(--text-dim); }
.dd-hint-text { font-weight: 400; font-size: 0.85rem; }
.stepper { display: flex; align-items: center; gap: var(--space-3); }
.stepper button { width: 48px; height: 48px; border-radius: 50%; border: 0; background: var(--bg-raised-2); color: var(--text); font-size: 1.5rem; cursor: pointer; }
.stepper button:disabled { opacity: 0.4; }
.stepper span { min-width: 2ch; text-align: center; font: 700 1.5rem var(--font-display); }
.segmented { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px; background: var(--bg-sunken); border-radius: var(--radius); }
.segmented button { min-height: 48px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-dim); font: 600 0.95rem var(--font-display); text-transform: capitalize; cursor: pointer; }
.segmented button.on { background: var(--game-accent); color: #fff; }
@keyframes dd-fade { from { opacity: 0; } }
@media (max-width: 900px) {
  .dd-screen { height: auto; min-height: 100vh; }
  .dd-stage { grid-template-columns: 1fr; }
}
```

- [ ] **Step 6: Type-check and test**

Run: `pnpm --filter @party/doodle-dash typecheck && pnpm --filter @party/doodle-dash test`
Expected: no type errors, and all tests pass.

- [ ] **Step 7: Commit**

```bash
git add games/doodle-dash/src/client
git commit -m "feat(doodle): canvas renderer, drawing pad and screen/phone views"
```

---

### Task 12: Integration: register Doodle Dash, end-to-end tests, CI and README

**Files:**
- Modify: `apps/web/src/games.ts` (register `doodleClient`)
- Create: `playwright.config.ts`, `e2e/doodle.spec.ts`, `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything. This task tests the whole system, including the test ids listed in Tasks 9–11.
- Produces: green `pnpm typecheck && pnpm test && pnpm e2e`, CI on every push, and a README with dev and deploy instructions.

- [ ] **Step 1: Register the game**

In `apps/web/src/games.ts`, change the registry to:
```ts
import { doodleClient } from "@party/doodle-dash/client";
import type { ClientGame } from "@party/ui";

/** Playable games, keyed by id. */
export const clientGames: Record<string, ClientGame> = { [doodleClient.id]: doodleClient };
```
Leave `comingSoon` unchanged.

- [ ] **Step 2: Write the end-to-end tests**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:8787", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production-like: built web app served by the real Worker + Durable Objects.
    command: "pnpm build && pnpm --filter @party/server exec wrangler dev --port 8787",
    url: "http://localhost:8787",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

`e2e/doodle.spec.ts`:
```ts
import { devices, expect, test, type Browser, type Page } from "@playwright/test";

async function joinPhone(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await page.goto(`/room/${code}`);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("join-submit").click();
  await expect(page.getByTestId("phone-lobby")).toBeVisible();
  return page;
}

async function inkedPixels(page: Page): Promise<number> {
  return page.getByTestId("screen-canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 250 || d[i + 1]! < 250 || d[i + 2]! < 250) n++;
    return n;
  });
}

test("screen + 3 phones play a turn, and a reloaded phone keeps its score", async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto("/");
  await screen.getByTestId("host-screen").click();
  const code = (await screen.getByTestId("room-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);

  const ana = await joinPhone(browser, code, "Ana");
  const ben = await joinPhone(browser, code, "Ben");
  const cy = await joinPhone(browser, code, "Cy");
  await expect(screen.getByTestId("lobby-player")).toHaveCount(3);

  await screen.getByTestId("start-game").click();

  // Ana joined first, so she draws first.
  await ana.getByTestId("word-choice").first().click();
  const word = (await ana.getByTestId("secret-word").innerText()).trim();

  const box = (await ana.getByTestId("draw-canvas").boundingBox())!;
  await ana.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await ana.mouse.down();
  for (let i = 1; i <= 12; i++) await ana.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.2 + i * 0.04));
  await ana.mouse.up();
  await expect.poll(() => inkedPixels(screen), { timeout: 5000 }).toBeGreaterThan(200);

  // Ben's correct guess scores but its text never appears on the screen feed.
  await ben.getByTestId("guess-input").fill(word);
  await ben.getByTestId("guess-input").press("Enter");
  await expect(screen.getByTestId("score-Ben")).not.toHaveText("0");
  await expect(screen.locator(".dd-feed")).not.toContainText(word);

  await cy.getByTestId("guess-input").fill(word);
  await cy.getByTestId("guess-input").press("Enter");
  await expect(screen.getByTestId("reveal")).toContainText(word);
  await expect(screen.getByTestId("score-Ana")).toHaveText("200");

  const benScore = await screen.getByTestId("score-Ben").innerText();
  await ben.reload();
  await expect(ben.getByTestId("my-score")).toHaveText(benScore);
  await expect(screen.getByTestId("lobby-player")).toHaveCount(0); // still in game, not lobby
});

test("phones-only: the host starts from a phone and guessers see the canvas", async ({ browser }) => {
  const host = await (await browser.newContext({ ...devices["Pixel 7"] })).newPage();
  await host.goto("/");
  await host.getByTestId("host-phone").click();
  await host.getByTestId("name-input").fill("Host");
  await host.getByTestId("join-submit").click();
  await expect(host.getByTestId("phone-lobby")).toBeVisible();
  const code = new URL(host.url()).pathname.split("/").pop()!;

  const guest = await joinPhone(browser, code, "Guest");
  await host.getByTestId("start-game").click();

  await expect(host.getByTestId("word-choice")).toHaveCount(3);
  await expect(guest.getByTestId("phone-canvas")).toBeVisible();
});
```

- [ ] **Step 3: Install the browser and run the tests**

Run:
```bash
pnpm exec playwright install chromium
pnpm e2e
```
Expected: 2 tests pass. If a test fails, debug with `pnpm exec playwright show-trace test-results/**/trace.zip`. Fix the product code, not the assertions, unless the assertion contradicts the spec.

- [ ] **Step 4: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results
```

- [ ] **Step 5: Write the README**

Replace `README.md` with:
````markdown
# PartyGames

Party games for one shared screen and everyone's phones. Host on a laptop hooked to the TV, and friends join by scanning a QR code. No screen? Everyone plays from their phones.

**Games:** Doodle Dash (draw and guess). More are coming. See `docs/superpowers/specs/`.

## Develop

```bash
pnpm install
pnpm dev            # web on :5173 (also on your LAN IP), rooms on :8787
```
Open http://localhost:5173 on the laptop and click **Host on this screen**. Phones on the same Wi-Fi scan the QR code.

```bash
pnpm typecheck && pnpm test   # unit + room + worker tests
pnpm e2e                      # Playwright: real Worker, real Durable Objects
```

## Deploy (Cloudflare free plan)

```bash
pnpm --filter @party/server exec wrangler login   # once
pnpm cf:deploy
```

## Layout

| Path | What |
|---|---|
| `shared/` | protocol, game-module interface, utilities, design tokens |
| `ui/` | React UI kit shared by the app and games |
| `party/` | Cloudflare Worker + `Room` Durable Object (`RoomCore` holds the logic) |
| `games/doodle-dash/` | rules (`src/rules`) and screen/phone views (`src/client`) |
| `apps/web/` | the website: home, join, lobbies, game stage |
````

- [ ] **Step 6: Run the full verification**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: everything passes. Record the test counts in the hand-off.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/games.ts playwright.config.ts e2e .github README.md
git commit -m "feat: register Doodle Dash, add e2e tests, CI and README"
```

- [ ] **Step 8: Manual check on real phones (the orchestrator asks the user)**

The user runs `pnpm dev`, opens the site on the laptop connected to the TV, and plays one round with 2 or more real phones in screen+phones mode and then in phones-only mode. Check the drawing feel, the QR scan, the readability from across the room, and a phone sleeping and coming back mid-turn.

**Deploying (`pnpm cf:deploy`) is not part of this task.** It's a third-party write that needs the user's explicit approval and their Cloudflare login.

