# Brief: Cursor-based pagination for the reports API

## Feature / Change

Replace the offset/limit pagination on `GET /api/reports` with cursor-based
pagination. Large offsets currently do full table scans and time out; cursors
keep every page O(page size). This is a change to an existing endpoint — the
response envelope and existing query params must keep working during rollout.

## Context

- Node + TypeScript API; reports are served from Postgres via the `reports`
  repository (`src/api/reports/`), already covered by integration tests.
- The list endpoint returns `{ items, total, page, pageSize }` today. Clients
  read `items` and `total`; the web app's infinite-scroll list is the main caller.
- Reports are ordered by `created_at DESC, id DESC` (a stable, unique sort key).

## Constraints

- One sprint, one engineer. No breaking change to the current response shape —
  add `nextCursor` alongside the existing fields, don't remove them.
- Keep offset pagination working behind the scenes for one release so old
  clients don't break; remove it in a follow-up.
- No new dependencies; use the existing query builder.

## Success Criteria

- `GET /api/reports?cursor=<opaque>` returns the next page in O(page size),
  verified with an EXPLAIN that shows an index scan (no full scan).
- The response includes a `nextCursor` that round-trips to the correct next page,
  and `null` on the last page.
- Existing offset params still return correct results (back-compat).
- New unit tests cover cursor encode/decode and boundary pages; the full test
  suite passes with no regression in report list latency.
