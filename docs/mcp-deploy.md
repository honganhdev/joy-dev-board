# MCP and multi-user deployment note

This is a Manager-run procedure. The implementation phase does not deploy, issue real credentials,
or edit the VPS environment.

## Before deployment

1. Confirm the VPS `.env` has `TRUST_PROXY=true`. If it does not, set it before exposing MCP: Caddy's
   address would otherwise collapse the client-IP bucket and make the MCP surface easy to deny.
2. Confirm Caddy serves `issue.anhth.cc` over HTTPS only and there is no public plain-HTTP route to
   `127.0.0.1:4184`. TLS is the only in-flight protection for bearer tokens.
3. From inside the current container, run `bun run db:backup`. Record the output counts for
   `tickets` and `ticket_status_history` and keep the `VACUUM INTO` snapshot. This is required before
   the image containing migration `0007` starts.
4. The separate rehearsal of migration `0007` against a real VPS snapshot must also be recorded as
   complete before deployment. In-memory migration tests do not replace it.

Migration `0007` runs automatically when the API opens SQLite. It creates only `mcp_tokens`; it must
not alter the two recorded row counts.

## Rollout

1. Deploy the image through the existing Compose procedure and verify the healthcheck and logs.
2. Verify entry 1 can still log in. Then verify each numbered account. A malformed numbered entry is
   skipped with its exact key in stderr; entry 1 still hard-fails startup when missing.
3. Run `mcp:issue` inside the container for one teammate only and deliver the printed token out of
   band.
4. Connect that teammate's real MCP client to `https://issue.anhth.cc/api/mcp`. It must initialize,
   list exactly four tools, call each tool successfully, and receive an SSE response. Check that
   `GET`/`DELETE` behavior and the API's 45-second idle timeout do not break that client.
5. Only after the real-client check passes, issue tokens for the remaining teammates.
6. Measure the stored ticket count and one `find_ticket` wall time. Revisit the full-mirror parse if
   it exceeds 150 ms or visibly stalls the board.

## Offboarding

Run these in this order, before editing `.env`:

1. Delete every browser session for the person:

   ```sql
   DELETE FROM sessions WHERE username = ?;
   ```

2. Revoke all of that person's MCP tokens inside the container:

   ```bash
   bun run mcp:revoke -- --user <name>
   ```

3. Remove their numbered `.env` pair and restart. Token verification also rejects usernames absent
   from the configured list, but explicit revocation prevents old rows becoming valid after a future
   re-add.

## Incident response and rollback

- Suspected token leak: revoke that public id immediately. Broad MCP incident: run
  `mcp:revoke -- --user <name>` for each configured user before changing code.
- Token/auth code rollback: revoke rows **before** reverting. Reverting first removes the revocation
  CLI and can orphan credentials that become valid if the code is later reapplied.
- Multi-user rollback or account removal: delete affected `sessions` rows before reverting or
  removing accounts; active sessions otherwise keep sliding their expiry.
- Route rollback after the MCP server exists requires reverting the server/route change together.
  There is deliberately no `501` fallback surface; without the route, `/api/mcp` stays unavailable.
- Reverting the dependency-only commit removes the exact SDK and Zod peer pins while retaining any
  earlier CLI scripts. Revoke tokens first.
- Do not down-migrate `mcp_tokens`. An unused table is inert, while dropping a live SQLite table adds
  needless recovery risk.
