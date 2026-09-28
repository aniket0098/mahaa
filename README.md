# MahaJob mobile

The MahaJob native mobile app: **one React Native + TypeScript codebase for Android and iOS**,
built with Expo and expo-router.

It is a client of the MahaJob FastAPI backend. It adds no endpoint, changes no schema, and ships no
placeholder data.

> **Repository state (read this first).** This app is the only part of the project that still exists.
> The backend source (`apps/api`), the web client (`apps/web`), the infrastructure scripts
> (`infra/scripts/*.ps1`) and the `docs/` directory have all been removed. Every reference to them
> below is kept only as history; nothing in this repository starts or builds them. See
> [Current backend](#current-backend) for what the app can actually talk to today.

## Requirements

- **Node.js 22+** and npm 10+
- Android: Android Studio + SDK, plus a running emulator or device
- iOS: macOS with Xcode — or use EAS Build from any machine (see below)

## Setup

```powershell
Set-Location C:\mahaa            # the repository root IS the app root
npm install
Copy-Item .env.example .env      # optional; .env is already present and gitignored
```

## Current backend

The FastAPI backend runs locally on this machine and is the API these settings point at:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000   # from C:\mahajob\apps\api
```

```text
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8000/api/v1        # Android emulator
EXPO_PUBLIC_API_BASE_URL_WEB=http://localhost:8000/api/v1   # browser
```

Verified against that host:

| Endpoint | Result |
|---|---|
| `GET /api/v1/health` | `200` — `{"status":"ok","app":"MahaJob API","version":"0.1.0","environment":"development"}` |
| `OPTIONS /api/v1/auth/login` (CORS preflight) | `200` with `access-control-allow-origin: http://localhost:8081` |
| `GET /api/v1/ready` | `200` — `{"status":"ready","checks":{"database":"ok"}}` |

| `POST /auth/signup` | **`500` for every valid payload** (see below) |
| `POST /auth/login` | **`500` for every valid payload** (see below) |
| `GET /auth/me`, `/profile`, `/profile/completeness`, `/profile/privacy`, `/profile/skills`, `/profile/education`, `/profile/experience`, `/profile/projects`, `/skills/catalog`, `/companies/mine`, `/resumes` | `401` — the routes exist and need a bearer token |
| `PUT /profile/preferences` | `405` on `GET` — the path exists, `GET` is not a method it serves |
| `/jobs`, `/applications`, `/notifications`, `/messages` | `404` — these domains do not exist on the server |

**The auth router is currently broken server-side.** The failure is not a client/payload mismatch:
the app sends exactly the fields the server's own validation accepts (`name`, `email`, `password`,
`role`, optional `phone` — the server rejects anything else with `extra_forbidden`), and every
accepted payload then returns `500 {"code":"internal_error"}`. A login for a non-existent account
returns `500` too, where a correct deployment answers `401 invalid_credentials`. This is why the
Jobs, Applications, Notifications and Messages screens are honest "later stage" notices: those
routers genuinely are absent — but they are not the only thing standing behind a signed-in
experience, because no account can currently be created or signed into.

`/docs` and `/openapi.json` return `404` on this deployment, so the route inventory above was
established by probing the live host.

## Pointing the app at a different API

The app reads `EXPO_PUBLIC_API_BASE_URL` (a public build-time value only — never put a backend
secret in a mobile env file).

| Where the app runs | Base URL to use | Set in |
|---|---|---|
| Android emulator | `http://10.0.2.2:8000/api/v1` (default) — `localhost` is the emulator itself | `EXPO_PUBLIC_API_BASE_URL` |
| Browser (`expo start --web`) | `http://localhost:8000/api/v1` (default) | `EXPO_PUBLIC_API_BASE_URL_WEB` |
| iOS simulator | `http://localhost:8000/api/v1` (default) — the simulator shares the host loopback | `EXPO_PUBLIC_API_BASE_URL` |
| Physical Android device | your computer's LAN IP, e.g. `http://10.236.127.87:8000/api/v1` | `EXPO_PUBLIC_API_BASE_URL_LAN` |
| Deployed build | the real API origin, e.g. `https://mahajob-api.onrender.com/api/v1` | `eas.json` → `production.env` |

### Why there are three variables

Expo loads only `.env`, `.env.local` and `.env.<mode>` — it has **no per-platform env files** — and
`EXPO_PUBLIC_*` is inlined into the bundle, so a single value is baked into *every* platform's build.
One value cannot serve all of the targets that run on your own machine:

- the Android emulator reaches it at `10.0.2.2`;
- a browser reaches it at `localhost`;
- a **physical phone** reaches it at neither — `localhost` is the phone itself and `10.0.2.2` is the
  emulator's alias — only at your computer's LAN IP.

So the two settings that would otherwise fight over the shared value are split off by target, and
each is honoured **only** on the platform it is valid for (`src/lib/env.ts` → `resolveApiBaseUrl` in
`src/lib/apiBaseUrl.ts`):

- `EXPO_PUBLIC_API_BASE_URL_WEB` — web only. Android and iOS ignore it, so the emulator URL cannot be
  repointed by a browser-only setting. Leaving the browser on `10.0.2.2` is what made the web login
  screen at `http://localhost:8081` hang until it timed out: that address is unroutable from a desktop.
- `EXPO_PUBLIC_API_BASE_URL_LAN` — a **physical Android device** only, and only when the value is a real
  IPv4 address. A `localhost` or `10.0.2.2` value here is ignored rather than trusted, because
  honouring it would put the phone right back where it started.

Setting the phone's address in its own variable is what lets you keep the emulator and the phone
working **at the same time**, instead of editing the shared value and breaking one to fix the other.

### Reaching the API from a physical phone

A correct base URL is only half of it: the backend also has to be listening on the network, and
Windows Firewall has to allow the connection.

```powershell
# Backend + Vite, bound to 0.0.0.0 so a phone on the same Wi-Fi can connect.
C:\mahajob\run-mahajob.bat --lan
```

Without `--lan` the launcher binds `127.0.0.1`, which is loopback only and cannot be reached from a
phone. `--lan` is opt-in for that reason. The launcher auto-detects and prints your LAN IPv4 (ignoring
the WSL/Hyper-V/VirtualBox adapters, which are also in a private range but are not on your Wi-Fi), and
on success it prints the exact URL to paste into `EXPO_PUBLIC_API_BASE_URL_LAN`.

Then `npm run start:clear`, because `.env` values are inlined and a cached transform keeps the old one.

A malformed value fails fast at startup instead of producing confusing network errors. The Home
screen shows what `GET /ready` actually answered, so a wrong URL is visible immediately.

**If the app cannot reach the API.** The sign-in screen carries an **API connection panel** that
prints the exact base URL in use and can re-probe `GET /health` on demand, so the failure is
diagnosable on the device. The app also distinguishes *emulator* from *physical phone* (via
`expo-device`): if the base URL came from a platform default that cannot exist on real hardware —
for example the `10.0.2.2` emulator alias — the error names that exact cause and the variable to fix
instead of a generic "Network request failed". The three usual causes:

- **The backend is not running, or is bound to loopback only.** Check
  `http://127.0.0.1:8000/api/v1/health` first. If that fails on this computer, no target can work — and
  a phone additionally needs `run-mahajob.bat --lan`, because `127.0.0.1` is not a network address.
- **A stale Metro cache.** `EXPO_PUBLIC_*` values are inlined into the bundle when a file is
  transformed, and a transformed file stays cached. If you add or change `.env` while the dev
  server has already run once, the old value can stay baked in. **This is not theoretical** — it was
  reproduced during setup: after editing `.env`, a plain `npm run bundle:android` produced a bundle
  with no trace of the new URL, and only `npx expo export --clear` inlined it. Fix it with
  `npm run start:clear` (`expo start --clear`), or add `--clear` to an export.
- **A bundle built before `.env` existed.** If `EXPO_PUBLIC_API_BASE_URL` is unset at build time
  the value inlines as `undefined` and the app silently falls back to the Android emulator alias.
  Confirm what a build actually baked in with:

  ```powershell
  npm run bundle:android
  # then look for your API host in the produced bundle:
  Select-String -Path dist\_expo\static\js\android\*.hbc -Pattern 'mahajob-api' -SimpleMatch
  ```

  A bundle that does not contain your host will only ever try `10.0.2.2` and can never work on a
  physical phone.
- **Android cleartext blocking.** Plain `http://` is refused by a standalone Android build.
  `app.json` sets `android.usesCleartextTraffic: true` through `expo-build-properties` so
  development builds and local APKs can talk to the LAN API. Expo Go already allows it.

## Run

```powershell
npm run android     # Android emulator or connected device
npm run ios         # iOS simulator (macOS only)
npm start           # dev server; press a / i / w in the terminal
```

## Verify

```powershell
npm run typecheck        # tsc --noEmit, strict
npm test                 # Vitest — pure business logic
npm run lint
npm run bundle:android   # produces a real Android JS bundle
npm run bundle:ios       # produces a real iOS JS bundle
```

Unit tests cover the logic that must stay identical to the backend: API base-URL resolution, the
error contract and field mapping, password-rule parity, role routing and tab separation, and the
canonical status vocabulary. They run in Node, so they work on a machine with no Android SDK and no
Xcode. Rendering and navigation are verified on a real device or emulator.

## iOS

iOS cannot be compiled on Windows or Linux — it needs macOS and Xcode. From any machine, Expo's
cloud build produces the binary:

```powershell
npx eas-cli login
npm run prebuild:ios     # generates the native ios/ project (optional, for local Xcode work)
npx eas-cli build --platform ios --profile preview
```

`eas.json` defines `development`, `preview` (internal distribution), and `production` profiles.
Bundle identifiers are set to `com.mahajob.mobile` on both platforms.

## What is in this release

Real, backed by the API (route exists on the server and the binding is exercised by the
integration suite):

- Public landing screen
- Sign in (`POST /auth/login`) and account creation (`POST /auth/signup`) — **the server currently
  answers `500` to both, so these are wired and correct but not usable end to end until the auth
  router is fixed; see [Current backend](#current-backend)**
- Session resolution from `GET /auth/me`, token held in the iOS Keychain / Android Keystore
- Role-aware bottom navigation (candidate and employer tab sets, never mixed)
- Candidate home with the server-derived profile completeness
- Candidate profile from the single `GET /profile` aggregate
- Skills, education, experience and projects CRUD, the skill catalogue, privacy, preferences,
  resumes, the company workspace and membership management
- API connection status with retry, with the exact base URL and a device/emulator-aware hint

Not built, because the server has no such router (`404`, confirmed by probing the live host): jobs,
applications, saved, applicants, messages, notifications, password reset. Each of those screens
renders an explicit notice naming the missing endpoint instead of mock content. Every one of them
also carries a working Back control, so a notice is never a dead end.

There is no `jobs` or `applications` API module in `src/api/`, and none should be added until the
server exposes the corresponding router.

## Project layout

```
src/
  app/             expo-router routes: landing, login, signup, boot, (candidate)/*, (employer)/*
  api/             one API client, error contract, query client, query keys, per-domain modules
  auth/            secure token storage, auth provider, role routing
  components/ui/   shared primitives used by both platforms
  config/          role-aware navigation configuration
  features/        screen content per domain
  lib/             env resolution, password rules
  theme/           design tokens
  types/           contracts mirroring the FastAPI schemas
```

Layering: **routes → features → api → transport**. No feature module calls `fetch` directly.
