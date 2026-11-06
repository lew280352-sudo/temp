# StockLens Free Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing StockLens Node/Docker app on Render Free with durable account data in Turso Free, without a running user computer.

**Architecture:** Introduce one asynchronous database port, with native SQLite for local use and an official Turso SDK for remote primary access. Initialize schema before listening, convert every database consumer to await the port, and keep security-sensitive mutations atomic. Render runs one disposable instance with all durable data remote.

**Tech Stack:** Node.js 24+, plain JavaScript ESM, node:sqlite, official Turso SDK, Docker, Render Free, Playwright.

**Spec:** ../specs/2026-11-01-stocklens-free-cloud-design.md

## Global Constraints

- Node.js 24+; plain HTML/CSS/JavaScript, no frontend framework migration.
- Zero paid services, no paid disk/domain, no automatic upgrade/overages, no synthetic keep-alive traffic.
- Render sleeps after 15 idle minutes; wake may take about one minute; background news/Push stops while asleep.
- Preserve existing HTTP contracts, scrypt password hashes, TOTP and recovery, and account isolation.
- No credentials in Git, images, frontend responses, fixtures or logs; no local fallback when remote is configured.
- Render Free deploy keeps EMAIL_LOGIN_OTP_ENABLED=false because its standard SMTP ports are blocked.

## Review Focus

- Remote outage/token error must fail startup/requests rather than create a new local account database (Tasks 1–2).
- Concurrent recovery/OTP/TOTP use must admit at most one success, and remote transactions must roll back as a unit (Task 2).
- Two requests with the same revision must not silently overwrite each other; pending work after account deletion must not leak private data (Task 2).
- Process replacement must keep account data and important auth throttles; forwarded headers must not allow bypass (Tasks 2–3).
- Legacy import must refuse a nonempty destination, preserve password hashes and not resurrect old sessions (Task 3).

## File map

- New database.mjs: async port and driver adapters; schema.mjs: one-time schema/migrations; rate-limit.mjs: persistent auth buckets.
- Modify server.mjs and DB-consuming ai/feeds/quotes/forecast/push/email-verification/login-otp modules: await port, preserve API responses.
- New scripts/import-database.mjs and test/database.test.mjs, test/cloud-persistence.test.mjs, test/remote-failure.test.mjs.
- Update existing test fixtures/runners to await async startup and service methods; use an isolated local libSQL server for real HTTP driver tests.
- New render.yaml and docs/FREE_CLOUD.md; update Docker/Compose/env/backup/privacy scripts and operations docs.

### Task 1: A database port with real transaction semantics

**Files:** database.mjs; schema.mjs; package.json/package-lock.json; test/database.test.mjs.

**Interfaces:** `openDatabase({databasePath, databaseUrl, authToken, remoteClientFactory?}): Promise<Database>`; `initializeSchema(db): Promise<void>`. `Database` exposes async `get(sql,args=[])`, `all(sql,args=[])`, `run(sql,args=[]) -> {changes,lastInsertRowid}`, `exec(statements:string[])`, `transaction(async tx => result)`, `close()`. The transaction handle exposes get/all/run/exec, not a nested transaction factory. Arguments use parameter binding.

- [ ] Write tests `local file persists after reopen`, `transaction rollback leaves no partial user`, `unrelated async query does not join another transaction`, `remote configuration failure never opens local path`, and `remote driver maps rowsAffected to changes`. Pin assertions to persisted rows and a recorded local-open factory count of zero on remote failure.
- [ ] Run `node --test test/database.test.mjs`; verify missing-port tests fail.
- [ ] Implement the local node:sqlite adapter with a serialized queue and scoped transaction operations. Implement remote access using the SDK matching the provisioned Turso engine: @libsql/client for a libSQL database, or @tursodatabase/serverless for a new Turso database. Inspect the actual published SDK API before wiring transactions; use the remote SDK's scoped transaction, never separate HTTP BEGIN/COMMIT. Keep the SDK choice inside database.mjs.
- [ ] Extract all existing table/index creation and data migrations from server/services to schema.mjs; execute individual SQL statements, not a SQL string splitter. Apply migration versions transactionally and retain the old holdings-to-watchlist migration.
- [ ] Run database tests against native SQLite and the selected official remote driver with an isolated protocol server or disposable test database; mock-only tests are not remote compatibility evidence. Commit this unused port independently.

### Task 2: Move application storage onto the async port

**Files:** server.mjs; ai.mjs; feeds.mjs; quotes.mjs; forecast.mjs; push.mjs; email-verification.mjs; login-otp.mjs; rate-limit.mjs; schema.mjs; all test callers of these interfaces; scripts/audit-privacy.mjs.

**Interfaces:** `createApp(options): Promise<http.Server & {shutdown():Promise<void>}>` accepts existing options plus databaseUrl/authToken. DB-backed service methods return Promises; pure research/parsing/crypto APIs remain as they are. `createAuthLimiter(db,{trustedProxyHops=0}).consume({peerAddress,forwardedFor,email,now})` persists hashed account/IP bucket keys.

- [ ] Extend API tests with concurrent revision updates (one 200, one 409), recovery reuse (one success), account deletion during a pending API request (no returned private data), OTP/TOTP replay, and commit failure with no partial account. Update startup callers to await createApp; validate invalid origins with assert.rejects.
- [ ] Run affected tests to see their failures before changing storage consumers.
- [ ] Initialize the database/schema before listening; await all get/all/run calls, service status/snapshot calls and callbacks such as selectedFeeds. Replace manual BEGIN/COMMIT blocks with scoped transactions. Do not hold a write transaction while hashing a password or contacting SMTP/AI/Push; revalidate state using conditional mutations inside the transaction.
- [ ] Make token consumption and its required session/recovery mutations atomic. Preserve current optimistic revision checks and recheck session/account state after external awaits. Map database failures to a generic 503/500 without exposing SQL or tokens, and propagate schema failures to startup.
- [ ] Persist auth throttles using atomic SQL mutations; preserve the existing 15-minute window and account/IP thresholds. Derive client IP with opt-in trusted hop count only after verifying Render's forwarding topology; test forged headers in untrusted mode and shared proxy clients. Avoid trusting the leftmost forwarded header directly.
- [ ] Implement shutdown() to stop HTTP, timers and transports, then await pending storage work and close the database; convert fixture cleanup to await it.
- [ ] Run `npm test` plus remote-driver integration tests. Verify old password hashes and legacy migration data remain readable; commit when both local and remote behavior pass.

### Task 3: Free deployment, safe migration and operations

**Files:** render.yaml; .env.example; compose.yaml; Dockerfile; scripts/backup.mjs; scripts/import-database.mjs; docs/FREE_CLOUD.md; docs/OPERATIONS.md; docs/KNOWN_LIMITATIONS.md; README.md; test/cloud-persistence.test.mjs; test/remote-failure.test.mjs; .github/workflows/test.yml.

**Interfaces:** Environment TURSO_DATABASE_URL/TURSO_AUTH_TOKEN selects remote primary; missing token or failed remote connection never falls back. `scripts/import-database.mjs --source <sqlite-path>` reads credentials from environment, requires an empty destination, excludes sessions/login challenges, preserves account/MFA/recovery/preferences, and prints counts only.

- [ ] Test startup with remote URL and invalid token; assert no local SQLite file is created. Test importing fixtures into an empty remote target, rejecting a nonempty target, preserved scrypt hashes, dropped sessions/challenges, and rollback on failure. Test process restart against the same remote DB retaining a saved watchlist.
- [ ] Add a Render Blueprint with runtime docker, plan free, one instance, /api/health, autoDeployTrigger checksPass, required remote secrets via sync:false and no disk/paid datastore/cron. Bind PORT from platform; resolve APP_ORIGIN from the actual assigned HTTPS URL without exposing secrets. Keep local Compose support and add the remote env variables there.
- [ ] Keep local SQLite backup working. When remote is selected, backup must explicitly direct the operator to the provider export procedure rather than back up an unrelated local file. Document official Turso export/import and a restore rehearsal, stable MFA/VAPID secrets, quota errors, SMTP restrictions, wake delay and paused background work.
- [ ] Add CI remote integration isolation and existing Docker smoke test. Do not read production tokens for tests; a live disposable database check is run only via an approved credential channel and is reported separately from local protocol tests.
- [ ] Run `npm test`, Docker build/Compose smoke, remote restart/import/error tests. Check render.yaml has explicit plan:free and no paid resources. Commit.

### Task 4: Deploy and verify after the implementation is reviewable

**Files:** docs/FREE_CLOUD.md (actual deployment handoff notes, no credentials); PR description.

**Interfaces:** Connected Render tools and owner-created/connected Turso Free database; no secrets in conversation.

- [ ] Finish code, tests and PR first. Request only missing account access/credentials through supported secure setup, and explicit merge/publication authorization when not already supplied. Never select paid plans to bypass quota/access problems.
- [ ] Confirm whether there is an existing database to migrate before first production startup; migrate a verified copy or explicitly confirm a fresh account database. Keep rollback/export ready.
- [ ] Create only the free web service using the validated config. Configure secrets in provider settings, deploy the reviewed commit and record its actual URL.
- [ ] Check HTTPS and /api/health, register/Login, save and reload watchlist, restart/redeploy and verify persistence, then delete temporary test account. Confirm secret-free logs and truthful unavailable states for unconfigured providers.
- [ ] Report the verified URL and limitations. A prepared Blueprint or PR alone is not a completed deployment.
