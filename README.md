# JOY Dev Board

Internal read-only Kanban board for HelpDesk tickets belonging to the **JOY Loyalty** app.

v1 pulls tickets from HelpDesk, groups them into five workflow columns, classifies each into a
category, and opens a full detail drawer per ticket. Nothing is ever written back to HelpDesk —
every upstream call is a `GET`.

## Layout

```
apps/api    Bun HTTP API. Owns the HelpDesk key, proxies + caches, classifies, assembles the board.
apps/web    React + TypeScript + Tailwind + shadcn/ui board UI.
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

## Checks

```bash
bun test             # unit tests (classifier, board assembly, search)
bun run typecheck    # tsc --noEmit across both apps
bun run build        # production build of the web app
```

## API

| Route | Purpose |
| --- | --- |
| `GET /api/tickets` | Board payload: five columns, category groups, counts. `?refresh=1` bypasses the cache. |
| `GET /api/tickets/:ticketId` | Full HelpDesk record for one ticket, plus its computed category and resolved tag names. |
| `POST /api/pull` | Re-pulls from HelpDesk, refreshes the cache, returns `{ pulled, board }`. |
| `GET /api/health` | Liveness. |

HelpDesk responses are cached in memory for `CACHE_TTL_MS` (default 5 min), so a page load does not
hit HelpDesk. A HelpDesk failure surfaces as a `502` with a real message — the UI shows the error
rather than an empty board.

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY_HELPDESK` | *(required)* | HelpDesk `X-API-Key`. The API exits at startup if it is missing. |
| `PORT` | `8787` | API port. |
| `CACHE_TTL_MS` | `300000` | How long a pull stays fresh. |
| `HELPDESK_APP_NAME` | `JOY Loyalty` | App filter. |
| `HELPDESK_YEAR` | current year | Year window for the `by-date` query. |
| `HELPDESK_BASE_URL` | `https://helpdesk.avada.net/api/external` | Upstream base. |

## How the board is built

- **Source** — one request to `GET /tickets/by-date` for the whole year filtered by `appName`. It
  returns everything in a single response, so there is no pagination.
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

## Not in v1

`Push selected` / `Push all` — the board is read-only, so those controls are omitted rather than
shipped disabled. The card checkbox that exists only to feed that flow is omitted for the same reason.
