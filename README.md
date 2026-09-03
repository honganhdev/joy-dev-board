# JOY Dev Board

Internal read-only Kanban board for HelpDesk tickets belonging to the **JOY Loyalty** app.

It pulls tickets from HelpDesk into a local SQLite database, groups them into five workflow columns,
classifies each into a category, and opens a full detail drawer per ticket. The board is served from
SQLite, so it keeps working when HelpDesk does not. Nothing is ever written back to HelpDesk — every
upstream call is a `GET`.

It shows merchant emails, shop domains, internal Crisp links and member names, so ticket data sits
behind a login. Health and the HMAC-guarded Avada webhook deliberately bypass the session gate; the
auth routes manage that session.

## Layout

```
apps/api    Bun HTTP API. Owns the HelpDesk key and the login, pulls into SQLite, assembles the board.
apps/web    React + TypeScript + Tailwind + shadcn/ui board UI, plus the login screen.
deploy/     compose.yaml for the VPS container.
data/       SQLite database and backups. Gitignored — it holds real merchant data.
```

## Setup

Requires [Bun](https://bun.sh) (built with 1.3.14).

```bash
bun install
cp .env.example .env               # then fill in the HelpDesk key, webhook secret and login
bun run auth:hash                  # paste the AUTH_PASSWORD_HASH line it prints into .env
echo 'COOKIE_SECURE=false' >> .env # local dev is http, and a Secure cookie is never sent over http
```

`.env` lives at the repo root, is gitignored, and is read by the API process only. The browser never
sees the key — the web dev server proxies `/api` to the Bun API.

### The login password

```bash
bun run auth:hash                  # prompts, reads stdin, echoes nothing
echo -n 'your password' | bun run auth:hash
bun run auth:hash 'your password'  # convenient, but your shell keeps a copy
```

It prints one line to paste into `.env` and never prints the password itself. There is no
user-management UI and no signup: accounts are configured in the environment. Keep the existing
`AUTH_USERNAME` / `AUTH_PASSWORD_HASH` pair as entry 1, then add numbered pairs for teammates:

```dotenv
AUTH_USER_2_NAME=teammate
AUTH_USER_2_HASH=<base64 hash from auth:hash>
```

**Mint every hash with the same tool and the same argon2 parameters.** A login against an unknown
username is verified against entry 1's hash so that it costs the same as a wrong password; if a
later entry were hashed more cheaply, the response time would say which of the two the caller got
wrong. An entry whose `$argon2id$v=..$m=..,t=..,p=..` prefix differs from entry 1's is logged with
the offending key and skipped, so a mismatch costs that one account, not the board. In practice this
means running `bun run auth:hash` on this build for all of them, rather than pasting in a hash
minted on another machine or an older Bun.

The hash is emitted **base64-encoded**, not as the raw `$argon2id$...` string. `bun --env-file`
expands `$argon2id`, `$v` and `$m` as shell variables — inside single quotes too — so a pasted PHC
string arrives mangled and every login fails with an unsupported-algorithm error, while Docker's
`env_file` expands nothing and no single escaping works in both. Base64 has no `$` and so means the
same thing everywhere. Paste the whole printed line, unquoted.

The API refuses to start without entry 1 (`AUTH_USERNAME` and `AUTH_PASSWORD_HASH`), the same way it
refuses to start without `API_KEY_HELPDESK`. A board with real customer data and no login should not
come up at all. Numbered entries 2 through 20 fail safely: a missing partner key or unusable hash is
logged with the exact offending key and that account is skipped. Duplicate usernames keep the first
entry and log the losing name key, so a typo cannot take the board down for everyone.

## Run

Two terminals, or one command:

```bash
bun run dev          # api on :8787 and web on :5173 together
bun run dev:api      # api only
bun run dev:web      # web only
```

Open http://localhost:5173.

The first start creates `data/board.db`, applies the migrations and pulls from HelpDesk. Every start
after that serves the stored board immediately and only talks to HelpDesk when a pull is asked for.

## Checks

The API tests read a fixture of real HelpDesk tickets. It carries merchant domains, shop names and
Crisp session links, so it is gitignored — pull your own copy once after cloning:

```bash
bun run fixture:pull   # writes apps/api/tests/fixtures/sample-joy-open-tickets.json
```

```bash
bun test             # unit tests (auth, classifier, board assembly, sync + history, search, formatting)
bun run typecheck    # tsc --noEmit across both apps
bun run build        # production build of the web app
```

## API

| Route | Purpose |
| --- | --- |
| `GET /api/tickets` | Board payload from SQLite: five columns, category groups, counts, and `lastPull`. `?refresh=1` starts a pull and returns the board as it stands. |
| `GET /api/tickets/:ticketId` | Full stored HelpDesk record for one ticket, plus its computed category and resolved tag names. |
| `GET /api/tickets/:ticketId/history` | That ticket's observed status changes, oldest first. |
| `GET /api/report/weekly` | Weekly issue report from SQLite: one entry per week in range with created, done, outstanding and their category, priority and status breakdowns, plus every label and caption the page renders. It also carries two lifetime-scoped resolution clocks over every dated ticket, which the range parameter does not affect. `?weeks=` picks 4, 12, 26 or 52 and is clamped to what the mirror covers. |
| `POST /api/pull` | Starts a HelpDesk pull and returns `202` with the current pull summary; the client follows it on `GET /api/pull/status`. |
| `GET /api/pull/status` | The last pull attempt: `startedAt`, `finishedAt`, `ticketCount`, `inserted`, `statusChanges`, `status` (`running` / `ok` / `error`), `error`. |
| `GET /api/health` | Liveness, stored ticket count, last pull attempt. Unauthenticated, but returns no ticket content. |
| `POST /api/webhooks/avada-ticket` | Accepts Avada ticket deliveries guarded by the raw-body HMAC and timestamp freshness. Returns only a fixed acknowledgement; it serves no board data. |
| `POST /api/auth/login` | `{username, password}` → sets the session cookie, returns `{username}`. |
| `POST /api/auth/logout` | Deletes the session row and clears the cookie. |
| `GET /api/auth/me` | `{username}`, or `401` when there is no session. |
| `POST /api/mcp` | Stateless Streamable HTTP MCP endpoint. Requires a personal bearer token and emits no CORS headers. |

The MCP path uses only its bearer token; the remaining protected `/api/` routes use only a valid
session. In the container the API also serves the built web app on the same port, with a
client-side-routing fallback to `index.html`.

Reads never touch HelpDesk. A failed pull is reported by `GET /api/pull/status` as a `200` summary
with `status: "error"` and a real message — the `POST` answered `202` long before it failed — and the
board keeps serving what is stored: `lastPull` carries the failure so the UI can say the data is stale
instead of going blank.

The tag directory is the one thing still read live from HelpDesk and cached in memory for
`CACHE_TTL_MS × 12`. It is a lookup table rather than part of the ticket mirror, so it has no table.
A failing tag directory degrades a detail view to raw tag ids; it never fails the request.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY_HELPDESK` | *(required)* | HelpDesk `X-API-Key`. The API exits at startup if it is missing. |
| `WEBHOOK_SECRET` | *(required)* | Avada webhook signing secret. The API exits at startup if it is missing. |
| `PORT` | `8787` | API port. |
| `CACHE_TTL_MS` | `300000` | How long the HelpDesk tag directory stays cached in memory. |
| `DATABASE_PATH` | `<repo>/data/board.db` | SQLite file. A relative value resolves against the working directory. |
| `HELPDESK_APP_NAME` | `JOY Loyalty` | App filter. |
| `HELPDESK_YEAR` | current year | Year window for the `by-date` query. |
| `HELPDESK_BASE_URL` | `https://helpdesk.avada.net/api/external` | Upstream base. |
| `AUTH_USERNAME` | *(required)* | Entry 1 username. The existing login keeps these keys unchanged. |
| `AUTH_PASSWORD_HASH` | *(required)* | Entry 1 base64 argon2id hash. From `bun run auth:hash`. |
| `AUTH_USER_2_NAME` … `AUTH_USER_20_NAME` | *(optional)* | Additional usernames, paired by number with a hash. |
| `AUTH_USER_2_HASH` … `AUTH_USER_20_HASH` | *(optional)* | Additional base64 argon2id hashes. Must share entry 1's argon2 parameters. Invalid, half-configured or mismatched entries are logged and skipped. |
| `SESSION_TTL_MS` | `604800000` (7d) | Session lifetime, refreshed on every authenticated request. |
| `COOKIE_SECURE` | `true` | `Secure` on the session cookie. Set to `false` **only** for local http — over plain http a `Secure` cookie is never sent and no login will stick. |
| `TRUST_PROXY` | `false` | Believe `X-Forwarded-For`. Set `true` **only** behind a real reverse proxy; otherwise a client can set the header itself and get a fresh bucket for every login guess. |
| `WEB_DIST_PATH` | `apps/web/dist` | Built web app to serve next to `/api`. Absent in a source checkout, set by the Dockerfile. |

## Authentication

- **Server-side sessions in SQLite**, not JWT. A session is a row, so logout actually withdraws it
  and a restart of the API leaves everyone signed in. The cookie carries an opaque 256-bit id from
  `crypto.getRandomValues` and nothing else — no username, no claim.
- **`board_session`** cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` unless `COOKIE_SECURE=false`.
- **Sliding expiry.** Reading a session pushes `expiresAt` forward, so the 7 days run from last use.
  Expired rows are deleted on read and on login; there is no cron.
- **Removing an account is the revocation.** Every authenticated request checks the session's
  username against the configured account list, the same check MCP tokens already made, so deleting
  someone's `.env` pair ends their open browser too. A refused session is not slid forward, and its
  row is left to expire on its own. Deleting rows is still how you end a session for an account that
  remains configured.
- **Passwords** are hashed with `Bun.password` (argon2id, built into Bun — no crypto dependency).
- **Rate limited.** Failures are counted per username *and* per client IP; five inside fifteen minutes
  lock that key out for fifteen. A wrong password, an unknown username and a lockout all return the
  same message and the same body — nothing in the response says which one it was. The counters are in
  memory, so restarting the API clears them; the alternative is a SQLite write per failed guess,
  which is its own denial-of-service surface. With `TRUST_PROXY=true` behind Caddy, failures against
  one teammate's username do not lock out another teammate from a different address.
- Passwords, session ids and cookie headers are never logged, at any level.

The `Access-Control-Allow-Origin: *` on the API is deliberate and safe here: without
`Allow-Credentials` a browser will not attach the session cookie to a cross-origin request, so a
third-party page gets a `401` and nothing else.

## MCP access

The API serves a stateless, read-only MCP endpoint at `https://issue.anhth.cc/api/mcp`. It uses a
personal bearer token, not the browser session cookie, and exposes four tools:

- `find_ticket` searches open tickets using the board's id, link, text, and Vietnamese-diacritic
  matching. It cannot enumerate closed tickets. Its corpus is exactly the board's: a ticket in a
  status nobody has enabled as a board column is invisible to MCP too, so enable the column to make
  those tickets searchable.
- `get_ticket` reads a ticket by exact id, including a closed ticket, matching the existing detail
  route.
- `get_ticket_history` reads that ticket's observed status changes.
- `list_open` returns complete status/category counts plus a filtered, paged open-ticket list.

Every tool result includes the last successful mirror timestamp, latest pull status, and stored
ticket count. `find_ticket` and `list_open` currently parse the complete mirror on every call. At
this board's size that is acceptable; measure after deploy and revisit if a call exceeds 150 ms or
agent use visibly stalls the board.

Issue and revoke tokens from inside the running container (the VPS host has no Bun):

```bash
bun run mcp:issue -- --user teammate --label "claude code"
bun run mcp:revoke                    # list live token metadata, never secrets
bun run mcp:revoke -- --id <public-id>
bun run mcp:revoke -- --user teammate # revoke all of one person's tokens
```

`mcp:issue` prints the credential once; only its SHA-256 digest is stored. Deliver that one line out
of band and never put it in a ticket, report, shell transcript, or repository. Tokens have no default
expiry: this small, stable team uses explicit revocation and the offboarding procedure instead of
surprising client outages. `expiresAt` remains nullable for deliberately time-bounded credentials;
revisit a 90-day default before a token is kept on a device without full-disk encryption or in a
cloud-synced config directory.

Configure a client with a placeholder—not a real token—like this:

```json
{
  "mcpServers": {
    "issue-board": {
      "type": "http",
      "url": "https://issue.anhth.cc/api/mcp",
      "headers": { "Authorization": "Bearer jbmcp_<public-id>.<secret>" }
    }
  }
}
```

The protocol implementation is pinned exactly to `@modelcontextprotocol/sdk@1.30.0` (with its
already-resolved `zod@4.5.4` peer pinned for Bun workspace resolution). Review the pin by
2026-12-03, whenever the real-client check stops negotiating successfully, or before deliberately
upgrading teammate MCP clients. Upgrades are reviewed lockfile changes, never floating deploy-time
updates.

The MCP bearer surface is weaker than the board cookie surface in five specific ways:

1. Possession is authorization. Anyone holding the token is authenticated; it is not bound to a
   browser or device.
2. Tokens are long-lived until expiry or revocation, while browser sessions slide for seven days
   and die on logout.
3. A token sits in plaintext in a local client config that may be backed up, synced, or committed by
   mistake; a cookie stays in the browser jar.
4. Bearer tokens are replayable. TLS at Caddy is the only protection in flight; there is no in-app
   equivalent of `COOKIE_SECURE` for an authorization header.
5. `lastUsedAt` identifies use, not whether the owner or a thief used it. The API therefore also logs
   sanitized public token ids, usernames, and client IPs on success, and sanitized ids/IPs on
   rejection. It never logs the token or secret.

Failed MCP requests are throttled by client IP only, and only with `TRUST_PROXY=true`. There is no
per-token counter: the public id is printed in those log lines and by `mcp:revoke`, so a lockout
keyed on it let anyone who had read a log refuse the owner's own token for fifteen minutes at a
time. The secret is 32 CSPRNG bytes — entropy, not a counter, is what makes it unguessable.

Bearer tokens are immune to CSRF. A stolen token can read the complete open-ticket corpus and fetch
any known ticket id, including merchant names, subjects, and Slack/Crisp links. It cannot write to
HelpDesk, change the board, create a browser session, read a password, or read `.env`.

Everyone with a token sees the same open-ticket corpus as the board, and the initial teammates are
the same people who already share its password. Visibility scoping is therefore deferred, but not
forgotten: revisit it for the first person who should not see all merchants (for example a
contractor, agency, partner, or probationary hire). The retrofit must thread a viewer through the
four read functions and every web/report/MCP caller; one missed call site would leak silently, so it
belongs in a deliberate access-control change rather than this rollout.

The endpoint adds no environment variable. Deployment, offboarding, rollback ordering, and the
required real-client gate are in [`docs/mcp-deploy.md`](docs/mcp-deploy.md).

### Content-Security-Policy

The served documents carry `default-src 'self'; script-src 'self'` with no `unsafe-inline` and no
`unsafe-eval`, plus `frame-ancestors 'none'`, `object-src 'none'` and `connect-src 'self'`.
`style-src` does allow inline, because Radix positions and animates its overlays through the `style`
attribute — that is a styling hole, not a code-execution one.

Verified against the production build in headless Chrome over CDP: the login screen, a signed-in
board, an open detail sheet and sign-out all raise zero CSP violations, and an inline `<script>`
injected into the page is refused by Chrome. The bundle contains no `eval`, no `new Function`, no
inline handlers and no remote hosts.

## Storage

SQLite through `bun:sqlite`, with [Drizzle](https://orm.drizzle.team) for the schema and migrations.
The database is opened with `journal_mode = WAL` (the board keeps reading while a pull writes) and
`foreign_keys = ON` (off by default in SQLite, and set per connection).

Six tables:

- **`sessions`** — one row per signed-in session. On disk rather than in memory so a restart of the
  API does not sign everyone out, and deletable so logout is a real revocation.
- **`tickets`** — one row per ticket, upserted on every pull. Flat columns for what the board queries
  on, plus the untouched HelpDesk payload in `raw`, so no upstream field is ever lost.
- **`ticket_status_history`** — one row per *observed* status change. HelpDesk only returns a ticket's
  current state, so all that is knowable is that a change happened somewhere between observations:
  `observedAt` is when this board noticed it, and `ticketUpdatedAt` is HelpDesk's own `updatedAt`. An
  unchanged ticket writes nothing, so a pull every five minutes does not append a row per ticket.
- **`pulls`** — one row per pull attempt, so the history has a known observation window. A row is
  written as `running` when the pull starts and flipped to `ok` only once the sync commits. Any row
  still `running` at the next boot is swept to `error`, so a killed process still leaves an honest
  record instead of a phantom success.
- **`board_column_settings`** — the shared enabled-column preference and its optimistic-lock version.
- **`mcp_tokens`** — personal MCP token metadata and SHA-256 secret digests. Plaintext bearer
  secrets are never stored.

Ticket upserts and their history rows are written in one transaction: a crash mid-pull cannot leave
tickets updated with their history missing.

Changing the schema:

```bash
bun run db:generate   # regenerates apps/api/drizzle/*.sql from src/db/schema.ts
```

Migrations are committed and applied on startup, so a fresh clone with no `data/` comes up on its own.

### Backups

```bash
bun run db:backup                 # data/backups/board-<timestamp>.db
bun run db:backup /path/to/x.db   # or an explicit destination
```

It uses `VACUUM INTO`, which writes a consistent copy while the API is running, and then reopens the
copy to check it. A plain `cp` of a live SQLite file can capture a torn write or miss the WAL, which
produces a backup that only fails when it is needed.

### Deploying

The target is a single VPS running one container, which is why SQLite is enough. Two things to get
right there:

Before the first webhook deploy, run `bun run db:backup` and put `WEBHOOK_SECRET` in the VPS `.env`
**before** restarting the container. The API requires it at startup, so deploying the code first
leaves the board in a restart loop until the environment is corrected. Create the webhook in Avada
admin with destination `/api/webhooks/avada-ticket` only after the code is live.

- **`/app/data` must be a mounted volume.** Running in Docker without one loses the database — and
  with it every status history row ever recorded — on each rebuild. That history cannot be re-pulled:
  HelpDesk does not expose past states. `deploy/compose.yaml` mounts the `board-data` named volume;
  do not remove it, and do not `docker compose down -v`.
- **One writer.** WAL allows concurrent readers, but the design assumes a single API process owns the
  file. Do not run two instances against the same database.

After this deploy, ask anyone with an open board tab to reload so it picks up the new pull response.

## Container

One image, one process: a multi-stage build compiles the web app with Vite, and the Bun API serves
both `/api/*` and the built `dist/` from a single port. The previous deployment ran a static
container next to a second API container; nothing here needs two.

```bash
docker compose -f deploy/compose.yaml up -d --build   # from the repo root
docker compose -f deploy/compose.yaml logs -f
```

- Listens on `PORT` (8787) inside the container, published as **`127.0.0.1:4184`**. Publishing on
  `0.0.0.0` would put the board on the public internet beside Caddy rather than behind it — and with
  Caddy bypassed there is no TLS, so `Secure` would stop the login working at all.
- Caddy on the VPS terminates TLS for `issue.anhth.cc` and proxies to `127.0.0.1:4184`.
- `env_file: ../.env`. On the VPS that file needs `API_KEY_HELPDESK`, `AUTH_USERNAME`,
  `AUTH_PASSWORD_HASH`, `WEBHOOK_SECRET` and `TRUST_PROXY=true`. Leave `COOKIE_SECURE` unset — it
  defaults to on, which is what you want behind TLS.
- Healthcheck hits `/api/health` every 30s; it is unauthenticated and returns no ticket content.
- Migrations run at startup, so a fresh container on an empty volume comes up clean.
- The build context excludes `.env`, `data/` and the test fixture — none of them can reach a layer.
- Runs as the unprivileged `bun` user. `/app/data` is created owned by `bun` so a fresh **named**
  volume inherits that ownership. A **bind mount** does not inherit it: `chown -R 1000:1000` the host
  directory first, or the process cannot write the database.

## How the board is built

- **Source** — one request to `GET /tickets/by-date` for the whole year filtered by `appName`. It
  returns everything in a single response, so there is no pagination. A pull writes to SQLite; the
  board reads only from SQLite.
- **Columns** — only `ticketStatus === "open"` tickets, split by `tsStatus` into `DEV FIXING`,
  `DOING`, `WAITING CUSTOMER`, `DEV DONE`, `DONE`. `tsStatus` is **not** a closed enum, so any other
  or unknown value is counted in `otherStatuses` and shown in the page footer rather than dropped.
- **Categories** — HelpDesk has no category field for these tickets, so the API derives one from the
  ticket text with a keyword table in `apps/api/src/board/categories.ts`. That file is plain data and
  is meant to be tuned; the matching rules are documented at the top of it. Anything unmatched lands
  in `OTHER`.
- **Search** — client-side, across ticket id, subject, shop name and domain. A pasted ticket URL or
  bare id, or a Crisp/Slack link, resolves to the ticket it belongs to. Matching ignores case and
  Vietnamese diacritics, so `gio hang` finds `giỏ hàng`.
- **Status history** — every pull compares each ticket's stored `tsStatus` against the incoming one
  and appends a row only when it moved. The detail drawer shows that timeline and how long the current
  status has held. The timestamps are observations, not HelpDesk change times, and the drawer says so.

## Not in v1

`Push selected` / `Push all` — the board is read-only, so those controls are omitted rather than
shipped disabled. The card checkbox that exists only to feed that flow is omitted for the same reason.

Local-only fields (category overrides, notes, manual ordering) are also out: the database is a mirror
of HelpDesk plus history, nothing more.
