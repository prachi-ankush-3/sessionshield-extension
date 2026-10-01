# SessionShield Chrome Extension (Project 2)

Security alert and emergency session revocation companion for the **SessionShield Risk Demonstration**.

> Educational simulation only. This extension never reads, steals or modifies real cookies, tokens or credentials. It talks to exactly one place: `http://localhost:3000`.

## The two projects

| | Project 1 | Project 2 |
|---|---|---|
| Name | SessionShield Risk Demonstration | SessionShield Chrome Extension |
| Tech | Node.js + Express | Chrome MV3, TypeScript, Vite |
| Runs at | `http://localhost:3000` | Chrome toolbar |
| Role | Source of truth: sessions, attack simulation, risk, events, revocation | Monitor, detect, alert, force logout, confirm |

```
Project 1 (localhost:3000)
      │
      │  HTTP REST API
      ▼
Project 2 (Chrome extension)  ──POST /api/session/revoke──▶  Project 1
```

The extension has no login, no database and no backend of its own. Project 1 is **not** part of this repository.

## API used

| Endpoint | Used for |
|---|---|
| `GET /api/security/risk` | Risk score and level |
| `GET /api/security/events` | Security timeline |
| `GET /api/session/browser/A` and `/B` | Identify the compromised demo session |
| `POST /api/session/revoke` | Force logout, body `{ "sessionId": "<real id from Project 1>" }` |

All HTTP lives in `src/services/api.ts` (5.5 s timeout). Response parsing is normalized there, so if Project 1's JSON field names differ slightly, adjust only that file. The base URL is in `src/config.ts`.

A session counts as compromised when `status === "ACTIVE"` and `simulationState === "COMPROMISED"` (field names are normalized in `api.ts`).

**Compatibility note:** if Project 1's `/api/session/browser/:slot` does not expose the session ID, status and simulation state, a small change to Project 1 would be needed to return them. The extension will never guess a session ID; without one it shows no Force Logout button.

## Run Project 1

```
cd session-hijack-demo
npm install
npm start
```

Open `http://localhost:3000`.

## Build Project 2

```
cd sessionshield-extension
npm install
npm run build
```

`npm run typecheck` runs the TypeScript check only. Output is in `dist/`.

## Install in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `sessionshield-extension/dist`

## Demo flow

1. Start Project 1 with `npm start`.
2. Load the extension in Chrome.
3. Open the popup: **🟢 SECURE, 10 / 100** (or whatever Project 1 currently reports).
4. In Project 1 log in as `alice / alice123`, use the Risk Lab to simulate session theft, then log in as `bob / bob123` and simulate session injection.
5. Project 1 changes to **95 / 100 CRITICAL**.
6. The extension detects this by polling `GET /api/security/risk`.
7. Chrome shows **🚨 SessionShield Security Alert**.
8. Open the popup: **🚨 POSSIBLE SESSION COMPROMISE, 95 / 100, CRITICAL** with **🚨 FORCE LOGOUT**.
9. Click Force Logout and confirm.
10. The extension sends `POST /api/session/revoke` with the actual compromised session ID.
11. Project 1 revokes the session.
12. The extension re-reads risk, events and sessions, and shows **✅ ACCOUNT SECURED**.

Tip: use **Refresh** in the popup to skip the polling wait (default 30 s, configurable in Settings).

## Behaviour summary

- **States:** SAFE, SUSPICIOUS, CRITICAL, UNKNOWN, OFFLINE, SECURED. If Project 1 says suspicious but the score is at or above the Settings threshold (default 60), it is treated as CRITICAL.
- **Notifications:** only on escalation (SAFE to SUSPICIOUS, SUSPICIOUS or SAFE to CRITICAL). Previous state is kept in `chrome.storage.local`.
- **Badge:** yellow `!` suspicious, red `!` critical, grey `×` offline, none otherwise.
- **Offline:** shows BACKEND OFFLINE with Retry. No fake score and never a false SAFE.
- **Already revoked:** treated as secured.
- **Permissions:** `storage`, `notifications`, `alarms`, plus host access to `localhost:3000` and `127.0.0.1:3000`. No cookies, webRequest or `<all_urls>`.

## Structure

```
src/
  config.ts            API_BASE_URL and constants
  services/api.ts      only file that calls fetch()
  services/monitor.ts  shared check, transition and notification logic
  background/          alarms and service worker
  popup/               alert UI and Force Logout
  options/             settings page
  types/ utils/
```
