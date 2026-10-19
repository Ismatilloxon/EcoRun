# EcoRun

EcoRun is a social running app for Tashkent with an eco layer. Runners find group runs and partners nearby, check in at meeting points, record runs, pick up litter while running (plogging), and earn eco-points they can spend on rewards from partner businesses.

This repository holds the MVP from the technical specification:

| Part | Folder | Tech |
|---|---|---|
| API + realtime + scheduler | `server/` | Node 22 (runs TypeScript directly), Fastify 5, PostgreSQL 16, WebSocket |
| Runner app (installable PWA) + Admin / Organizer / Partner cabinets | `web/` | React 18, Vite, Leaflet + OpenStreetMap, UZ / RU / EN, light and dark mode |
| iOS app | `web/ios/` | Capacitor 8 wrapper around the same web app |
| Telegram bot | `bot/` | grammY |

The visual language comes from the design canvas you shared: Apple HIG grouped lists, white 22 px cards on `#F2F2F7`, a floating glass tab bar, and the green accent `#1E7A38`.

---

## Quick start (on this Mac)

```bash
npm install          # once
npm run setup        # creates .env with fresh secrets, creates the `ecorun` database, migrates and seeds demo data
npm start            # builds the web app if needed, runs the API on http://localhost:8080 and the Telegram bot
```

Open **http://localhost:8080**. The API docs (OpenAPI / Swagger) are at **http://localhost:8080/docs**.

For development with hot reload, run `npm run dev`. That starts the Vite dev server at http://localhost:5173, the API in watch mode, and the bot.

### Demo accounts (seeded)

Log in with a phone number. In dev mode, when no SMS gateway is configured, the 6-digit code is shown on the login screen. This only happens for requests from this computer; other devices find the code in the server log.

| Phone | Who | Role |
|---|---|---|
| +998 90 000 00 01 | Admin EcoRun | super admin → `/admin` |
| +998 90 000 00 02 | Malika | moderator → `/admin` |
| +998 90 000 00 03 | Jasur | club organizer (Yunusobod Runners) → `/organizer` |
| +998 90 000 00 04 | Green Bean Partner | partner → `/partner` |
| +998 90 000 00 05 | Dilnoza | club organizer (Chilonzor Plogging Crew) |
| +998 90 000 00 06 … 11 | runners | runner (07 Aziza has points to try a reward) |
| +998 90 000 00 12 | Otabek | event organizer |

To reset the demo data, run `npm run db:reset`.

### MVP acceptance flows (all verified locally)

1. **Group run.** A user signs up, creates a run, another user finds it on the map, joins and checks in (geo-fence 150 m or the organizer's QR code), and both get points. The organizer bonus is paid once 5 participants have checked in.
2. **Plogging.** A runner checks in to a plogging run and submits bags plus a photo. The location, time and photo EXIF are checked against the run. A moderator (Admin → Moderation) or the run organizer (in the app or in Telegram) approves it. Points go from *pending* to *confirmed*.
3. **Reward.** A runner claims a reward and gets a one-time code and QR. The partner scans it or types it in (Partner → Redeem code, or in the bot). The code is redeemed and stock goes down. Double redemption is blocked, and expired codes are refunded automatically.

---

## Telegram bot

1. In Telegram, message **@BotFather** and send `/newbot`. It gives you a token.
2. Put the token in `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_BOT_USERNAME=YourBotName
   TELEGRAM_CHANNEL_ID=@your_channel   # optional: new public runs are announced here
   ```
3. Restart with `npm start`.

What the bot does:
- **Login with Telegram.** The app shows "Continue with Telegram", the bot asks for confirmation, and the app logs in.
- **Link an account.** Profile → Settings → Telegram → Connect. Phone linking uses Telegram's verified contact button.
- **Nearby runs.** Share your location and get the runs nearest to you, with a Join button.
- **Check-in.** Share your location at the meeting point.
- **My runs and eco-points.** Shows your balance, level and impact.
- **Partner staff can redeem codes.** Send the 8-character code, or the text from scanning the QR, then confirm.
- **Organizers approve or reject plogging reports** with inline buttons.
- **Notifications.** Reminders 24 h and 1 h before a run, join approvals, cancellations, announcements, OTP codes, approvals, challenge completions and admin push campaigns.

Without a token the bot exits quietly and everything else keeps working.

## iOS app (Simulator)

```bash
cd web
npm run build:mobile && npx cap sync ios     # bundles the app with API = http://localhost:8080
npx cap open ios                             # opens Xcode; press Run on an iPhone simulator
```

The simulator reaches the API on `localhost`. For a real phone, set `MOBILE_API_URL=https://your-server` before `build:mobile`, and serve the API over HTTPS.

The PWA also installs on Android and iOS from the browser via "Add to Home Screen".

---

## Configuration (`.env`)

| Key | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (`postgres://localhost:5432/ecorun`) |
| `JWT_SECRET`, `BOT_INTERNAL_SECRET` | generated by `npm run setup` |
| `HOST` | `127.0.0.1` (default, this Mac only) or `0.0.0.0` to test from a phone on Wi-Fi |
| `PUBLIC_URL` | public HTTPS URL; used for bot buttons, calendar links and the Strava callback |
| `ESKIZ_EMAIL/PASSWORD/FROM` | Eskiz.uz SMS gateway for OTP. When empty, the server runs in dev mode |
| `TELEGRAM_*` | bot token, username, announcement channel |
| `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID` | enable Google / Apple ID-token login endpoints |
| `STRAVA_CLIENT_ID/SECRET` | Strava OAuth, verified-runner badge and activity import |
| `VAPID_*` | Web Push (generated by setup) |
| `PAYME_* / CLICK_* / UZUM_*` | paid event registration (phase 2) |

All eco-points values, caps, CO₂ and kg coefficients, check-in radius, anti-cheat limits and level thresholds are editable in **Admin → Eco-points engine**. They are stored in the database, and every change is written to the audit log.

---

## What's implemented (spec section → status)

**Accounts (3.1).**
- Phone + SMS OTP. Telegram login. Google and Apple endpoints work once you add their client IDs.
- Full profile and onboarding, UZ / RU / EN switching, a location-permission explainer and privacy settings.
- Data export (JSON) and account deletion (anonymized).
- Strava linking and import (needs API keys).

**Group runs (3.2).**
- Create a run with a map pin, a drawn or GPX route, pace groups, capacity, level, type, women-only and approval options, and a cover photo.
- Weekly recurring series for clubs.
- Map and list discovery with filters for date, distance, pace, level, district, type and club.
- Join, leave, waitlist (auto-promoted when a spot opens) and organizer approval.
- Realtime chat and announcements.
- Geo-fence or QR check-in.
- Rating after the run.
- Google Calendar link and `.ics` export. Reminders 24 h and 1 h before.
- New runs are pushed to nearby runners who opted in.

**Connections (3.3).** Follow, activity feed, buddy suggestions, 1-to-1 messages (only between mutual followers or people who shared a run), report and block.

**Tracking (3.4).**
- GPS tracker with time, distance, pace, splits and a route map; pause and resume. The screen stays awake (Wake Lock).
- Runs recorded offline are queued and synced later.
- Weekly and monthly stats, week streaks, and personal bests for 1K, 5K, 10K and 21K.
- Anti-cheat: average speed over 25 km/h or GPS jumps flag the run, and flagged runs earn no points and stay off leaderboards.

**Clubs (3.5).** Club page, gallery, members and co-organizers, moderator-verified badge, club leaderboard filter.

**Events (3.6).**
- Catalog, free registration with an e-ticket QR, registrations list with CSV export.
- Paid entry returns "not configured" until merchant keys are set (phase 2).

**Gamification (3.7).** Monthly and sponsored challenges, badges, levels, and a city leaderboard by week, month and all time, by km or eco-points.

**Notifications (3.8).** In-app (realtime), Web Push and Telegram.

**Eco layer (4).**
- Plogging runs with supplies and drop-off info.
- Eco-action log with photo, EXIF and geo checks.
- Organizer or moderator approval. Solo plogging can be auto-approved up to a configurable daily cap.
- Dirty-spot map: report a spot, plan a cleanup run on it, and the spot is marked cleaned after a verified action.
- Points engine with daily and weekly caps and pending / confirmed / rejected history.
- Impact dashboard, city counter and a shareable impact card (PNG for Instagram or Telegram stories).
- Rewards marketplace and point donations to tree planting.

**Cabinets (5).**
- **Admin:** DAU / WAU / MAU and other KPIs with 30-day charts; users (search, block, roles, points adjust/reset, partner linking); moderation queue (reports, eco photos, dirty spots, club verification, sponsored challenges); runs and clubs (hide, feature, verify); points engine settings; partners and rewards; challenges; segmented and scheduled push campaigns; content (banners, FAQ, terms, privacy) in three languages; events and revenue; audit log; TOTP 2FA for staff.
- **Organizer:** clubs, members and co-organizers, recurring runs, attendance and CSV, events.
- **Partner:** rewards CRUD, QR camera or manual redemption, history, monthly report, proposing sponsored challenges.

**Security (6.4).**
- JWT access tokens (15 min) with rotating refresh tokens. The MFA state is tied to the refresh-token chain.
- Rate limits. Every route validates its input with JSON Schema.
- Role-based access. Admin endpoints require 2FA once it is enabled.
- Uploads are checked by magic bytes; no SVG uploads.
- Women-only runs are hidden from everyone else on the server, in lists, detail pages, the calendar file and club pages.
- A 200 m privacy zone is trimmed from routes shown to other people. Exact home location is never stored; only a coarse ~110 m grid for "runs near me".
- CSV formula-injection guard. The bot talks to the API only with an internal secret.

## Deviations from the recommended stack (with reasons)

- **Fastify instead of NestJS.** It is lighter, faster, and Node 22 runs the TypeScript directly with no build step. The routes keep the same REST + WebSocket shape.
- **`cube` + `earthdistance` instead of PostGIS.** These ship with PostgreSQL and give indexed radius search. PostGIS was not installed on this Mac. The geo queries sit in a few SQL fragments, so switching to PostGIS later is a small change.
- **No Redis yet.** Leaderboards and counters are SQL aggregates, which is fine at MVP scale. Add Redis for caching and leaderboards before load testing at 5,000 concurrent users.
- **Photos are stored on local disk** (`server/uploads`). `saveImage()` in `server/src/uploads.ts` is the single place to plug in S3-compatible storage with a CDN.
- **Mobile = PWA + Capacitor iOS shell** sharing one codebase. Recording with the screen off, Apple Health / Google Fit / Garmin import, and an Android build need native plugins in the next phase.
- **The OpenStreetMap tile server is for development only.** Switch to Yandex or Google tiles, or a paid OSM tile provider, for production.

## Still open (needs the product owner or external accounts)

- Real SMS (Eskiz), Telegram bot token, Google / Apple / Strava keys, Payme / Click / Uzum merchant agreements.
- Final KPI targets, eco-points values, and documented sources for the CO₂ (170 g/km placeholder) and kg-per-bag coefficients.
- Legal texts (terms and privacy are placeholders) and a legal review of personal-data storage. Production hosting must be in Uzbekistan.
- Load test, App Store / Play publishing, and a Figma file. The design reference used here is the shared design canvas.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | `.env`, database, migrations, demo data |
| `npm start` | API + built web app + bot (restarted on crash) |
| `npm run dev` | hot-reload development |
| `npm test` | server unit tests (geo, anti-cheat, TOTP, CSV, EXIF…) |
| `npm run typecheck` | TypeScript checks for all three packages |
| `npm run db:reset` | wipe and reseed |
# EcoRun
