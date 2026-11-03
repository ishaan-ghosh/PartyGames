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
