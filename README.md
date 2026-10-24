# LinkVault — URL Shortener & Analytics

LinkVault is a full-stack URL shortener that creates shareable short links, redirects visitors to their original destinations, and records click events for analytics.

**Live demo:** https://link-vault-by-harshit-kr.vercel.app  
**Repository:** https://github.com/harshit-try-dev/LinkVault_byHarshitKr

## Features

- **Short-link generation:** Create a short code for a validated destination URL.
- **Redirection:** Resolve short codes to their stored destinations.
- **Click analytics:** Persist click events and view totals and UTC day-by-day activity.
- **Link management:** Create, browse, inspect, copy, and soft-delete links.
- **Optional expiry:** Supports link expiry when an expiry time is provided.
- **Authentication and access control:** Registration and login with separate ordinary-user and admin workspaces.
- **Persistent storage:** MongoDB stores users, links, click events, and sessions.

## Tech stack

- **Frontend:** React, Vite, plain CSS
- **Backend:** Node.js, Express
- **Database / ODM:** MongoDB Atlas or local MongoDB, Mongoose
- **Authentication:** Server-side sessions, bcrypt password hashing
- **Deployment:** Vercel (frontend), Render (backend), MongoDB Atlas (database)

## How it works

1. An authenticated user submits a destination URL.
2. The API validates the input, generates a short code, and stores the link in MongoDB.
3. A visitor opens `https://link-vault-by-harshit-kr.onrender.com/<shortCode>`.
4. The server looks up the code, checks that the link is active and unexpired, records a click event, and returns a `302` redirect.
5. The dashboard retrieves link information and analytics derived from stored click events.

Click analytics count **recorded redirect events**, not unique visitors. A redirect is sent only after the click event has been persisted; if persistence fails, the API returns `503` rather than redirecting without recording the event.

## Architecture

- **React client:** Registration, login, user/admin workspaces, link management, and analytics views.
- **Express API:** Configuration validation, authentication, link management, redirect handling, and analytics endpoints.
- **MongoDB:** Mongoose models for users, links, click events, and a separate session collection.

## Security and design decisions

- User passwords are hashed with bcrypt using a cost factor of 12 or higher.
- The browser uses an **HttpOnly session cookie**; session secrets, database credentials, password hashes, and management tokens are not sent to the client.
- State-changing requests use CSRF-token and trusted-origin protection.
- `CORS_ORIGIN` must be the exact frontend origin in production; wildcard origins are not supported.
- Ordinary users can manage only links they own. The admin can manage the full link inventory, including legacy links without an owner.
- Link deletion is soft deletion, preserving click history.
- Analytics are derived from `Click` records rather than a cached counter.

## API reference

Management endpoints return `{ "data": ... }` on success and `{ "error": { "code": "...", "message": "..." } }` on failure.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Register an ordinary user |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/session` | Read the current session |
| `GET` | `/api/auth/csrf-token` | Obtain a CSRF token |
| `POST` | `/api/links` | Create a link from `originalUrl` and optional `expiresAt` |
| `GET` | `/api/links?page=&limit=` | List active links with bounded pagination and click totals |
| `GET` | `/api/links/:id` | Retrieve one active link and its click total |
| `GET` | `/api/links/:id/analytics?from=&to=` | Retrieve click totals and UTC day-grouped analytics |
| `DELETE` | `/api/links/:id` | Soft-delete a link |
| `GET` | `/:shortCode` | Redirect to the stored destination |

**Redirect behavior:** Unknown or deleted links return `404`; expired links return `410`. Health checks and public redirects do not require a logged-in session; link management and analytics do.

**Analytics date range:** `from` is inclusive and `to` is exclusive. A supplied range may span at most 366 days. If both are omitted, the default is the previous 30 days up to the current time.

## Local development

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- A local MongoDB instance or an accessible MongoDB deployment

The client and server are independent npm projects. Run the commands below from the project root unless a different directory is shown.

### 1. Install dependencies

```powershell
cd client
npm install
cd ..\server
npm install
cd ..
```

### 2. Create environment files

```powershell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env
```

Set a valid local MongoDB connection string in `server/.env`. Configure the required backend variables using the example file as a guide, including:

- `MONGODB_URI`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET` (at least 32 characters)
- `CORS_ORIGIN` (the exact frontend origin outside development/test)

Keep real credentials in local/private environment files. Do not commit `.env` files or publish real secrets.

### 3. Generate the admin password hash

From `server/`:

```powershell
npm run generate-password-hash
```

Copy the resulting bcrypt hash into the private `ADMIN_PASSWORD_HASH` setting. Generate a random session secret with a password manager or a local cryptographic tool, for example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store the generated value only in the backend environment. Remove obsolete `MANAGEMENT_TOKEN` or `ALLOW_UNAUTHENTICATED_MANAGEMENT` settings if present; they are no longer used.

### 4. Start the client and server

Run each command in a separate terminal.

**Terminal 1 — client**

```powershell
cd client
npm run dev
```

The client uses Vite's default development port. Its API base URL is read from `VITE_API_BASE_URL`, defaulting to `http://localhost:5000/api` for local development.

**Terminal 2 — server**

```powershell
cd server
npm run dev
```

The server uses the port configured in `server/.env`. The server requires valid configuration and a reachable MongoDB database; it does not start in a database-less degraded mode.

## Testing and checks

**Client** — run from `client/`:

```powershell
npm run lint
npm run build
```

**Server** — run from `server/`:

```powershell
npm run check
npm test
npm start
```

`npm run check` validates the server source files. `npm test` covers mocked service behavior, click tracking, analytics, validation, authentication, CSRF, CORS, and health handling. Authentication tests use an isolated in-memory session store; they are not integration tests of the real MongoDB session store.

After the server connects to MongoDB, `GET /api/health` returns `200` with a connected database status. A `503` JSON response means the LinkVault server is running but the database is unavailable.

## Data ownership and legacy links

New links store the authenticated ordinary user's `ownerId`. Existing links may have a nullable owner and are treated as admin/legacy links. Ordinary users cannot discover or access links without their ownership; the admin retains access to the complete inventory. Click records remain associated with their link, and analytics are calculated from those events.

## Troubleshooting and implementation notes

### `Cannot GET /api/links` or `Cannot GET /api/health`

This usually means the process on the configured API port is not the LinkVault server or is stale. Start the server from `server/` with its environment configured, then check `GET /api/health`. A route-level `404` is different from a JSON `503` indicating a database connection problem.

### MongoDB Atlas DNS on Windows

The server entrypoint preloads a Windows-only DNS workaround for an affected Node.js Windows resolver issue with MongoDB Atlas `mongodb+srv://` SRV lookups. It configures Node's c-ares resolver to use Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`). Upgrading Node.js to a release containing the upstream fix is preferred; remove the workaround after upgrading if the normal resolver works. Public DNS can bypass enterprise or VPN split-DNS policies, so consider that trade-off before production use.

## Production deployment checklist

- Set the production `VITE_API_BASE_URL` to the deployed backend API URL.
- Set `CORS_ORIGIN` to the exact HTTPS frontend origin, without a trailing slash or path.
- Use a strong, private `SESSION_SECRET` and a bcrypt cost-12-or-higher admin password hash.
- Use a least-privilege MongoDB application user and review Atlas network access rules.
- Keep credentials out of source control and rotate any secret that may have been exposed.

---

Built as a full-stack project to explore URL shortening, session-based access control, persistent click-event analytics, and deployment across separate frontend, backend, and database services.
