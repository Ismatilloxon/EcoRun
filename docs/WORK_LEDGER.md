# Work ledger

## 2026-10-19 — Build and test verification

- **Outcome:** Build and runtime verification for the EcoRun web, server, and bot workspaces.
- **Build:** `npm run build` passed (Vite production bundle, 119 modules).
- **Mobile build:** `npm run build:mobile -w web` passed.
- **Type checks:** `npm run typecheck` passed for web, server, and bot.
- **Tests:** `npm test` passed all 9 server tests.
- **Runtime:** Existing local API on `http://127.0.0.1:8080` returned 200 for `/api/v1/health` (`db: true`) and `/docs`.
- **Production-style start:** `PORT=8090 npm start` started the API and returned 200 from `/api/v1/health`; the bot exited cleanly with the expected missing-token message.
- **Browser smoke:** Welcome page, guest runs list, map view, and run detail rendered in the in-app browser with no console errors.
- **Blockers:** None for local verification. Telegram remains disabled because no bot token is configured, as expected in development.
