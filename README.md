# JOY Dev Board

Internal read-only Kanban board for HelpDesk tickets belonging to the **JOY Loyalty** app.

It pulls tickets from HelpDesk into a local SQLite database, groups them into five workflow columns,
classifies each into a category, and opens a full detail drawer per ticket. The board is served from
SQLite, so it keeps working when HelpDesk does not. Nothing is ever written back to HelpDesk — every
upstream call is a `GET`.

## Layout

```
apps/api    Bun HTTP API. Owns the HelpDesk key, pulls into SQLite, classifies, assembles the board.
apps/web    React + TypeScript + Tailwind + shadcn/ui board UI.
data/       SQLite database and backups. Gitignored — it holds real merchant data.
```

## Setup

Requires [Bun](https://bun.sh) (built with 1.3.14).

```bash
bun install
cp .env.example .env      # then fill in API_KEY_HELPDESK
```

`.env` lives at the repo root, is gitignored, and is read by the API process only. The browser never
sees the key — the web dev server proxies `/api` to the Bun API.

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
bun test             # unit tests (classifier, board assembly, sync + history, search, formatting)
bun run typecheck    # tsc --noEmit across both apps
bun run build        # production build of the web app
```

## API

| Route | Purpose |
| --- | --- |
| `GET /api/tickets` | Board payload from SQLite: five columns, category groups, counts, and `lastPull`. `?refresh=1` pulls first. |
| `GET /api/tickets/:ticketId` | Full stored HelpDesk record for one ticket, plus its computed category and resolved tag names. |
| `GET /api/tickets/:ticketId/history` | That ticket's observed status changes, oldest first. |
| `POST /api/pull` | Pulls from HelpDesk into SQLite, returns `{ pulled, inserted, statusChanges }`. |
| `GET /api/health` | Liveness, stored ticket count, last pull attempt. |

Reads never touch HelpDesk. A failed pull surfaces as a `502` with a real message, and the board keeps
serving what is stored — `lastPull` carries the failure so the UI can say the data is stale instead of
going blank.

The tag directory is the one thing still read live from HelpDesk and cached in memory for
`CACHE_TTL_MS × 12`. It is a lookup table rather than part of the ticket mirror, so it has no table.
A failing tag directory degrades a detail view to raw tag ids; it never fails the request.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY_HELPDESK` | *(required)* | HelpDesk `X-API-Key`. The API exits at startup if it is missing. |
| `PORT` | `8787` | API port. |
| `CACHE_TTL_MS` | `300000` | How long the HelpDesk tag directory stays cached in memory. |
| `DATABASE_PATH` | `<repo>/data/board.db` | SQLite file. A relative value resolves against the working directory. |
| `HELPDESK_APP_NAME` | `JOY Loyalty` | App filter. |
| `HELPDESK_YEAR` | current year | Year window for the `by-date` query. |
| `HELPDESK_BASE_URL` | `https://helpdesk.avada.net/api/external` | Upstream base. |

## Storage

SQLite through `bun:sqlite`, with [Drizzle](https://orm.drizzle.team) for the schema and migrations.
The database is opened with `journal_mode = WAL` (the board keeps reading while a pull writes) and
`foreign_keys = ON` (off by default in SQLite, and set per connection).

Three tables:

- **`tickets`** — one row per ticket, upserted on every pull. Flat columns for what the board queries
  on, plus the untouched HelpDesk payload in `raw`, so no upstream field is ever lost.
- **`ticket_status_history`** — one row per *observed* status change. HelpDesk only returns a ticket's
  current state, so all that is knowable is that a change happened somewhere between two pulls:
  `observedAt` is when a pull noticed it, and `ticketUpdatedAt` is HelpDesk's own `updatedAt`. An
  unchanged ticket writes nothing, so a pull every five minutes does not append a row per ticket.
- **`pulls`** — one row per pull attempt, so the history has a known observation window. A row is
  written as `error` when the pull starts and flipped to `ok` only once the sync commits, so a process
  killed mid-pull leaves an honest record instead of a phantom success.

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

The target is a single VPS running one Bun process, which is why SQLite is enough. Two things to get
right there:

- **`data/` must be on persistent storage.** Running in Docker without a volume mounted at `data/`
  loses the database — and with it every status history row ever recorded — on each rebuild. That
  history cannot be re-pulled: HelpDesk does not expose past states.
- **One writer.** WAL allows concurrent readers, but the design assumes a single API process owns the
  file. Do not run two instances against the same database.

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
