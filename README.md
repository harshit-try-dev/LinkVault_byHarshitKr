# LinkVault

LinkVault is a MERN URL shortener and click analytics application. The client and server are intentionally independent npm projects.

## Stage 2 through multi-user foundation

The server includes validated configuration loading, MongoDB connection lifecycle management, Mongoose `User`, `Link`, and `Click` models, reusable URL and expiry validation, a database-aware health endpoint, authenticated link management APIs, safe stored-destination redirects, click persistence, and aggregation-based analytics. The React + Vite client provides registration, role-aware login, personal/admin link workspaces, creation, library, copy and soft-delete actions, detail view, and real UTC analytics.

## Stage 3 API

Management endpoints return JSON in the form `{ data: ... }` on success and `{ error: { code, message } }` on failure:

- `POST /api/links` — create a link from `originalUrl` and optional `expiresAt`.
- `GET /api/links?page=&limit=` — list active links with bounded pagination and click totals derived from `Click` records.
- `GET /api/links/:id` — retrieve one active link and its derived click total.
- `GET /api/links/:id/analytics?from=&to=` — retrieve bounded, UTC date-grouped click analytics.
- `DELETE /api/links/:id` — soft-delete a link while preserving click history.
- `GET /:shortCode` — redirect only to the stored validated destination; unknown/deleted links return `404`, expired links return `410`.

## Stage 4 click tracking and analytics

Redirects persist exactly one `Click` document before sending a `302` response. If persistence fails, the API returns `503` and does not redirect. Clicks are not recorded for missing, deleted, expired, or invalid stored links.

`GET /api/links/:id/analytics?from=&to=` returns totals and UTC calendar-day counts derived only from `Click` documents. The `from` boundary is inclusive and `to` is exclusive. A supplied range may span at most 366 days; when both boundaries are omitted, the default range is the previous 30 days up to the current time. The metric counts recorded redirect events, not unique visitors.

## Client configuration and access control

The client reads its API base URL from `VITE_API_BASE_URL`, defaulting to `http://localhost:5000/api` for local development. It does not embed a management token in the browser bundle.

The dashboard uses an authenticated server-side session. The browser sends the HttpOnly session cookie with API requests; it never receives `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, MongoDB credentials, or a management bearer token. The configured admin and registered users share the login form but receive separate session roles and dashboards.

`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, and `GET /api/auth/csrf-token` provide the authentication flow. Registered users can manage only links they create; the admin can manage the complete link inventory, including legacy links without an owner. Link management and analytics require the session; health and public short-link redirects do not.

User passwords are hashed with bcrypt cost 12 or higher. Usernames are normalized to lowercase, validated before registration, and the configured admin username is reserved. Registration, login, logout, link creation, and deletion retain CSRF and trusted-origin protection.

The session store is MongoDB-backed and uses a separate `sessions` collection. Cookies are HttpOnly, SameSite=Lax, and Secure outside development/test. State-changing requests require a synchronizer CSRF token and an exact trusted Origin. `CORS_ORIGIN` must be the exact frontend origin outside development and test environments.

If the client shows `Cannot GET /api/links` or `Cannot GET /api/health`, the process on the configured API port is not the LinkVault server (or is stale). Start the server from `server/` with its environment configured, then verify `/api/health` returns LinkVault's JSON status. A `503` JSON health response means the correct server is running but MongoDB is unavailable; it is different from a route-level 404.

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- MongoDB running locally or an accessible MongoDB deployment

## Local development

Install dependencies in each project:

```powershell
cd client
npm install
cd ..\server
npm install
```

Create local environment files from the examples. The examples contain placeholders only:

```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

Set a real local MongoDB connection string in `server/.env` before starting the server. Then set `ADMIN_USERNAME`, generate an `ADMIN_PASSWORD_HASH`, and set a random `SESSION_SECRET` of at least 32 characters. The server requires these values and exits with a clear error when configuration is missing or weak. Connection strings, cookies, password hashes, and secret values are never logged.

Generate a password hash without placing the password in a command line or file:

```powershell
cd server
npm run generate-password-hash
```

Copy only the resulting bcrypt hash into the private `ADMIN_PASSWORD_HASH` environment variable. Generate a session secret with a password manager or a local cryptographic tool, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, and store it only in the backend environment. Remove any old `MANAGEMENT_TOKEN` or `ALLOW_UNAUTHENTICATED_MANAGEMENT` settings; they are no longer used.

Start the client and server in separate terminals:

```powershell
cd client
npm run dev
```

```powershell
cd server
npm run dev
```

The client uses Vite's default development port. The server uses the port configured in `server/.env`.

From `client/`, the production checks are:

```powershell
npm run lint
npm run build
```

## Server checks

From `server/`:

```powershell
npm run check
npm test
npm start
```

`npm run check` validates all current server source files. `npm test` runs mocked service, click-tracking, analytics, validation, authentication, CSRF, CORS, and health-handler tests. The authentication tests use an isolated in-memory session store; they are not real MongoDB session-store integration tests. `npm start` requires a valid `MONGODB_URI`, a reachable database, and creates the persistent `sessions` store from the existing MongoDB connection; it does not start in a degraded database-less state.

The health endpoint is available at `GET /api/health` once the server has connected to MongoDB. It returns `200` with a connected database status or `503` when the database is unavailable.

## MongoDB Atlas on Windows

The server entrypoint preloads a Windows-only DNS workaround before importing the database module. It configures Node's c-ares resolver to use Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`) so Atlas `mongodb+srv://` SRV lookups work around the affected Node.js Windows resolver regression. Upgrading Node.js to a release containing the upstream fix is preferred; remove the workaround after upgrading if the normal resolver works. Public DNS can bypass enterprise or VPN split-DNS policy, so review that tradeoff before production use.

## Ownership and migration behavior

New links store the authenticated ordinary user's `ownerId`. Existing links remain valid with a nullable owner and are treated as admin/legacy links. Ordinary users cannot discover or access links with no owner, while the admin retains the existing dashboard view. Click documents remain unchanged and analytics continue to derive from click events through the owning link.

## Planned architecture

- MongoDB with Mongoose models for links and click events.
- Express REST API for link management, redirects, and analytics.
- React + Vite frontend with plain CSS and an API service module.
- Click events as the analytics source of truth; no cached counter in the MVP.
- Management routes use a MongoDB-backed session. The configured admin uses the backend password hash; ordinary accounts use the `users` collection with bcrypt password hashes. Production deployment must provide an explicit HTTPS frontend origin, a strong session secret, a bcrypt cost-12-or-higher admin hash, and a least-privilege MongoDB application user.

