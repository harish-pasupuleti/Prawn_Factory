# Prawn Factory Management System

Full-stack application for a prawn processing factory. **This release covers Phases 2-5**:
database foundation, authentication, farmer registration, procurement requests with purchase review, amendments,
audit logging, role-based access for all seven roles, **field inspection, transport/collection, and now the factory floor: arrival slots, gate entry, reception and weighing, discrepancy exceptions and the processing queue with persistent timers**.
Grading, packing, box/seal traceability and notifications are **not implemented yet** (see [Scope](#scope)).

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, TypeScript, React Router 6, Tailwind CSS 4, React Hook Form + Zod, TanStack Query 5, Recharts |
| Backend | Node.js (>= 20.19), Express 5, TypeScript, Zod, Prisma 6.19 |
| Database | Neon PostgreSQL (free plan) configured through environment variables; local PostgreSQL also works |
| Auth | Argon2id, 15-minute JWT access token (kept in browser memory), rotating single-use refresh token in an HttpOnly cookie |
| Tests | Vitest, Supertest, React Testing Library |

Currency is INR (₹), weights are kilograms. There is no image functionality, and no paid service is required.

---

## Run it on Windows (PowerShell) with Neon (free)

You do **not** need to install PostgreSQL. The database lives on Neon and the app reads its address from environment variables.

### 0. Prerequisites

1. **Node.js 22 LTS** from <https://nodejs.org> (check with `node -v`; it must be 20.19 or newer).
2. A free **Neon** account at <https://neon.com> (sign up with email, GitHub or Google).

### 1. Create the Neon database (about 3 minutes)

1. In the Neon console choose **Create project**. Name it `prawn-factory` and pick the region nearest to you.
2. **Create a second database for tests.** Open your project, go to **Branches**, select the default branch, open the **Databases** tab, and add a database named `prawn_test` (owner: the default role, usually `neondb_owner`). The automated tests delete everything in their database, so they must never share one with your real data.
3. Copy the two connection strings. On the project dashboard click **Connect**:
   - Turn **Connection pooling ON** and copy the string. The host contains `-pooler`. This is your **`DATABASE_URL`**.
   - Turn **Connection pooling OFF** and copy the string again. This is your **`DIRECT_URL`**.

   Both strings end in `/neondb?sslmode=require`. Add `&connect_timeout=15` to the end of each (it gives a sleeping database time to wake up). If a string contains `channel_binding=require`, delete that part.

Treat these strings like passwords: they contain your database password. Never paste them into source files, chat, or screenshots.

### 2. Install dependencies

From the project folder (the one containing this README):

```powershell
npm install
```

This also downloads Prisma's engines, so it needs internet access.

### 3. Configure environment variables

```powershell
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\api\.env.example apps\api\.env.test
```

Generate two different random secrets, one for each file. Run this command twice and keep both outputs:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

Open `apps\api\.env` (for example `notepad apps\api\.env`) and set these four values, leaving the rest as they are:

```
NODE_ENV=development
DATABASE_URL=<pooled string from Neon, database neondb>
DIRECT_URL=<direct string from Neon, database neondb>
JWT_ACCESS_SECRET=<first generated secret>
```

Open `apps\api\.env.test` and set the same kind of values, but **use the database `prawn_test`** (replace `/neondb?` with `/prawn_test?` in both strings) and the **second** secret:

```
NODE_ENV=test
DATABASE_URL=<pooled string, ending /prawn_test?sslmode=require&connect_timeout=15>
DIRECT_URL=<direct string, ending /prawn_test?sslmode=require&connect_timeout=15>
JWT_ACCESS_SECRET=<second generated secret>
LOGIN_RATE_LIMIT_MAX=1000
REGISTER_RATE_LIMIT_MAX=1000
```

`.env` files are git-ignored. Never commit them. The frontend needs no secrets.

### 4. Generate the Prisma client and create the tables on Neon

```powershell
npm run db:generate -w @prawn/api
npm run db:deploy -w @prawn/api
```

`db:deploy` applies the migrations through `DIRECT_URL`. The first request after Neon has been idle for 5 minutes is slow while the database wakes up; if a command times out, simply run it again.

### 5. Create the first administrator (safely)

The password is typed at a prompt, held only in this PowerShell session, and removed afterwards. Nothing is hard-coded.

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_NAME = "System Administrator"
$sec = Read-Host "Admin password (min 12 characters)" -AsSecureString
$env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
npm run db:seed -w @prawn/api
Remove-Item Env:ADMIN_PASSWORD, Env:ADMIN_EMAIL, Env:ADMIN_NAME
```

The seed never overwrites an existing account. Sign in as this administrator, then create the other six roles on the **Users** page. Farmers register themselves on the sign-in page.

### 6. Start the application

Open two PowerShell windows in the project folder.

```powershell
# Window 1: API on http://localhost:5000
npm run api:dev
```

```powershell
# Window 2: frontend on http://localhost:5173
npm run web:dev
```

Open <http://localhost:5173>. Vite forwards `/api` to the API, so the refresh cookie stays first-party.
Health check (also tests the Neon connection): <http://localhost:5000/api/v1/health>.
At startup the API prints a warning if the Neon strings look wrong (not pooled, no SSL, direct string missing).

### 7. Tests, type checks and production builds

```powershell
npm run test:unit -w @prawn/api      # backend unit tests, no database needed (still needs .env.test)
npm run api:test                     # ALL backend tests incl. database integration tests (resets the test database)
npm run web:test                     # frontend tests
npm run typecheck                    # backend + frontend (run db:generate first)
npm run api:build                    # compiles the API to apps\api\dist
npm run web:build                    # type-checks and builds the frontend to apps\web\dist
```

`npm run api:test` first runs a safety check and **refuses to start unless the database name in `.env.test` contains "test"**, then wipes that database and re-applies the migrations. Integration tests make many small queries, so on Neon they are slower than on a local database and use a little of your free compute.

---

## Upgrading an existing installation

Each phase adds one migration and optional environment variables. Existing data is never touched.

```powershell
npm install
npm run db:generate -w @prawn/api
npm run db:deploy -w @prawn/api
```

- **Phase 4** (`20260201000000_phase4_inspection_transport`): optional `QUANTITY_VARIANCE_THRESHOLD_PCT=10`.
- **Phase 5** (`20260301000000_phase5_factory_operations`): optional `RECEPTION_VARIANCE_THRESHOLD_PCT=5`, `PROCESSING_MINUTES_PER_TONNE=120`, `PROCESSING_MIN_MINUTES=30`, `GATE_EARLY_GRACE_MIN=60`, `GATE_LATE_GRACE_MIN=30` (all have defaults, see `.env.example`).

After upgrading to Phase 5, sign in as the administrator and set up the factory floor:

1. **Users**: create a Security Officer and a Factory Operator (and a Purchase Manager, Field Officer and Transport Officer if you have not already).
2. **Vehicles**: add at least one vehicle.
3. **Slots & stations**: add at least one processing station and one arrival slot (the Purchase Manager can also add slots).

Then the flow is: manager assigns inspection and transport, then **books an arrival slot** from the collection page; the driver collects and dispatches; the security officer works the **Gate**; the factory operator weighs, completes reception and releases to the **Processing queue**.

## Neon free plan: what to expect

Figures from Neon's pricing and FAQ pages as of 20 October 2026. **Check <https://neon.com/pricing> yourself; Neon can change them at any time, and a free tier is never guaranteed to stay free.**

- Per project, per month: 100 compute-hours (CU-hours) and 0.5 GB storage. Up to 100 projects, 10 branches per project, 5 GB network transfer.
- The database goes to sleep after 5 minutes without queries (this cannot be disabled on Free). The next request wakes it, which takes a moment. `connect_timeout=15` in the connection strings is there for this.
- When the monthly compute allowance runs out, the database stops until the next billing month. This project's data volume is far below 0.5 GB for demonstration use.
- Because the application only needs a standard PostgreSQL URL, you can move to another provider or to a local PostgreSQL later by changing `DATABASE_URL` and `DIRECT_URL` and running `npm run db:deploy -w @prawn/api`.

If the pooled connection ever gives prepared-statement errors, add `&pgbouncer=true` to `DATABASE_URL` (Prisma documentation).

<details>
<summary>Optional: use a local PostgreSQL instead of Neon</summary>

Install PostgreSQL 16 for Windows, then:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
psql -U postgres -c "CREATE USER prawn WITH PASSWORD 'CHOOSE_A_DB_PASSWORD' CREATEDB;"
psql -U postgres -c "CREATE DATABASE prawn_dev OWNER prawn;"
psql -U postgres -c "CREATE DATABASE prawn_test OWNER prawn;"
```

Then set both `DATABASE_URL` and `DIRECT_URL` to `postgresql://prawn:CHOOSE_A_DB_PASSWORD@localhost:5432/prawn_dev` (and `.../prawn_test` in `.env.test`), and follow the same steps from section 4.
</details>

---

## Scope

**Implemented**

- 7 roles: Farmer, Purchase Manager, Field Officer, Transport Officer, Security Officer, Factory Operator, Administrator.
- Farmer self-registration; administrator-created staff accounts; account disable and role change with immediate session revocation.
- **Procurement:** submit, list (filter, sort, paginate), view, approve, reject, request clarification, resubmit, cancel, amend, dashboard counts. The original declaration is immutable; amendments store field, old value, new value, reason, actor and time.
- **Field inspection (Phase 4):** the Purchase Manager assigns an active Field Officer to an approved request. The officer starts the inspection and records outcome (pass / fail / review), observed species and size, inspected quantity, quality observations and discrepancy notes. A PASS whose quantity or species differs from the declaration is refused unless the discrepancy is explained. A FAIL or REVIEW blocks the request until the Purchase Manager records an explicit decision with a reason (proceed with exception, reject, or re-inspect); the decision is stored permanently.
- **Transport and collection (Phase 4):** after a PASS the Purchase Manager assigns a Transport Officer and a vehicle. The officer records pickup, loaded quantity, dispatch, arrival and handover, each timestamped by the server, in that fixed order. Loading is refused above the vehicle's capacity, and a note is required if the collected quantity differs from the inspected quantity. Delays, damage and breakdowns are recorded as append-only incidents. Overdue collections are flagged from stored times.
- **Arrival slots and bookings (Phase 5):** slots have a time window and a capacity. The Purchase Manager books a collection job into a slot; capacity is enforced under a database row lock (two simultaneous bookings for the last place cannot both succeed). Bookings can be rescheduled (the old one is kept as history), cancelled with a reason, or marked no-show after the slot and grace period end. Each booking creates a shipment with a unique code (`SH-YYYY-000001`).
- **Gate (Phase 5):** the Security Officer records arrival, verifies the registration number, places a vehicle on hold or refuses entry (each with a reason), admits it, and records its exit. Steps cannot be skipped. Admission outside the booked window needs a Purchase Manager's override with a reason, and only a manager can release a hold. A refusal opens an exception for the manager. Gate events are append-only.
- **Reception and weighing (Phase 5):** the Factory Operator records gross and tare weights once the vehicle is admitted; net = gross − tare is calculated exactly. Weights are never overwritten: a Purchase Manager or Administrator corrects one by adding a new record that points at the old one with a reason, so the original value, reason, user and time are always kept. Reception completes after both weights are recorded and the driver has recorded the handover.
- **Discrepancy exceptions (Phase 5):** the received weight is compared with the collected quantity. Above `RECEPTION_VARIANCE_THRESHOLD_PCT` an exception is raised, with a full history of notes and its resolution, and the shipment cannot be released to processing until the Purchase Manager resolves it with a reason. Operators never see the earlier quantities, so they weigh without bias.
- **Processing queue (Phase 5):** released shipments queue in arrival order with a position. The operator starts an entry on an active station (one running entry per station) and completes it explicitly. The countdown is **computed from the server-recorded start time**, the target duration (from the received weight) and the server clock, so it is identical after a refresh or reconnect. A timer reaching zero only marks the entry **overdue**; it never completes anything.
- **Quantities are never overwritten:** declared (request), inspected (inspection) and collected (collection job) are separate stored values. Percentage differences are computed with exact integer arithmetic.
- **Vehicles:** the Administrator manages them; a vehicle or transport officer can hold only one active job (enforced by the database).
- Audit log written in the same database transaction as every change; the audit, decision and incident tables are insert-only (database triggers reject UPDATE and DELETE).
- Role-specific navigation and dashboards backed by real data; loading, empty, error and confirmation states; keyboard-accessible dialogs.

**Not implemented yet (later phases)**

Grading and reconciliation, packing, box and seal traceability, in-app notifications, audit-log viewer UI, OpenAPI/Swagger document, ESLint configuration, Playwright end-to-end tests, idempotency keys. Because notifications are not built, officers see new assignments only when they open their list (the gate and queue screens refresh by themselves every 15–30 seconds).

### Permission matrix

| Capability | Farmer | Purchase Mgr | Field Officer | Transport Officer | Admin | Security / Factory Operator |
|---|---|---|---|---|---|---|
| Submit / resubmit request | own | no | no | no | no | no |
| View requests | own only | all | no | no | all | no |
| Approve / reject / clarify | no | yes | no | no | no | no |
| Cancel request | own, before inspection starts | until goods are in transit | no | no | until goods are in transit | no |
| Amend declaration (before decision) | own | yes | no | no | yes | no |
| Assign field officer / transport | no | yes | no | no | no | no |
| View inspections | outcome on own request | all | own assignments | no | all | no |
| Start / complete inspection | no | no | own assignments | no | no | no |
| Decide on FAIL / REVIEW | no | yes | no | no | no | no |
| View collection jobs | progress on own request | all | no | own jobs | all | no |
| Pickup / load / dispatch / arrive / handover / incidents | no | no | no | own jobs | no | no |
| Cancel collection (before dispatch) | no | yes | no | no | no | no |
| Manage vehicles | no | read | no | no | yes | no |
| Create / edit arrival slots | no | yes | no | no | yes | no |
| Book, reschedule, cancel arrival bookings | no | yes | no | no | no | no |
| Gate: arrive, verify, hold, refuse, admit, exit | no | no | no | no | no | Security only |
| Release a hold / authorise entry outside the window | no | yes | no | no | no | no |
| Record gross and tare weights | no | no | no | no | no | Factory Operator only |
| Correct a recorded weight (with reason) | no | yes | no | no | yes | no |
| Complete reception, release to processing | no | no | no | no | no | Factory Operator only |
| See collected quantity and variance | farmer sees received quantity only | yes | no | no | yes | no |
| Read / add notes to exceptions | no | yes | no | no | yes | no |
| Resolve an exception | no | yes | no | no | no | no |
| Manage processing stations | no | read | no | no | yes | read (operator) |
| Start / complete processing | no | no | no | no | no | Factory Operator only |
| View the processing queue | no | yes | no | no | yes | Factory Operator |
| Manage users | no | no | no | no | yes | no |

Every rule is enforced on the server (route role check **plus** ownership scoping inside the service). Requesting someone else's record returns `404`, not `403`. The frontend only mirrors these rules. Field and transport officers never receive the farmer's expected price, and farmers never see internal inspection variance, decisions, cancel reasons or incidents.

### Deviations from the original brief (deliberate)

- Refresh tokens are opaque random values stored as SHA-256 hashes, so no `JWT_REFRESH_SECRET` exists.
- Farmers may amend their own declaration (with a reason) while the request is still `SUBMITTED` or `CLARIFICATION_REQUESTED`; the original is always preserved.
- Only the latest status change is stored on a request; full status history lives in the audit log.
- The brief's "no overlapping jobs" rule is implemented as one active job per vehicle and per transport officer at a time (no time-window overlap logic), enforced by partial unique indexes.
- The Purchase Manager, not the Administrator, assigns inspections and transport and decides on exceptions (separation of duties).
- The driver's "arrived" and "handover" steps are still recorded by the Transport Officer. The gate and reception build on them: a vehicle can be verified once dispatched, and reception completes only after the driver's handover.
- A shipment's stored states are EXPECTED, ADMITTED, RECEIVED and RELEASED. "Weighing" is not a separate state; it is derived from which weights exist.
- The processing target duration is computed from the received weight with two environment settings rather than an administrator screen.
- Weight corrections after release do not change the target duration of a queue entry that already exists.

## Security notes and limitations

Implemented: Argon2id (19 MiB, 2 passes); account lockout (5 failures, 15 minutes); identical responses for unknown email, wrong password, locked and disabled accounts; access token held in memory only; refresh token HttpOnly + SameSite=Strict + path-scoped, single-use with reuse detection (reuse revokes all of the user's sessions); custom-header CSRF check on cookie endpoints; strict CORS; Helmet; rate limits on login, register and refresh; request bodies capped at 100 KB; Zod allow-list schemas (unknown fields are rejected, preventing mass assignment); role and status always read from the database, never from the token; log redaction of credentials; audit rows scrubbed of password and token fields.

Honest limitations of this demonstration system:

- No MFA, email verification or password reset. Because there is no email verification, registration reveals whether an email address is already registered (mitigated only by rate limiting).
- `SameSite=Strict` means the frontend and API must be served from the same site (one domain, or a reverse proxy). A frontend and API on unrelated domains will not keep sessions.
- Refresh tokens are single-use. Two tabs refreshing at the same instant can trigger reuse detection and sign the user out of every device. They then simply sign in again.
- Behind a reverse proxy set `TRUST_PROXY=true`, otherwise every client shares one rate-limit bucket.
- Not penetration tested; no WAF; no secrets manager. Rotate `JWT_ACCESS_SECRET` if it is ever exposed (this signs everyone out).
- `npm audit` reports 6 findings in development tooling (`tinypool` via Vitest 3, `deepmerge-ts` via the Prisma 6 CLI). They are not in the runtime bundle; fixing them requires major upgrades (Vitest 5, Prisma 7) that were out of scope.

## Troubleshooting

- **Integration tests are very slow or fail with `Test timed out`**: each test makes many sequential queries, so they are limited by the network distance to your database. A Neon project in `us-east-1` is slow from India. For a much faster run, create the Neon project in the region nearest you (for example Asia Pacific / Singapore if offered), or run the tests against a local PostgreSQL (see the optional section above). The timeout is 180 seconds per test; set `TEST_TIMEOUT_MS` to change it. Failures that remain after raising the timeout are real: send me the test name and the error lines.

- **Timeout or `Can't reach database server` on Neon**: the free database may be waking from sleep; retry once. Check that both strings still end with `sslmode=require`, that `DATABASE_URL` has `-pooler` and `DIRECT_URL` does not, and that you removed `channel_binding=require` if present.
- **`Refusing to run tests ... does not contain "test"`**: this is the safety check. Point `apps\api\.env.test` at the `prawn_test` database.
- **Password rejected**: copy the string again from Neon (**Connect**); if you reset the role password, update both `.env` files.

- **`Invalid environment configuration`** on start: the message lists the variable names that are wrong. Compare with `apps\api\.env.example`.
- **`@prisma/client did not initialize yet`**: run `npm run db:generate -w @prawn/api`.
- **Port in use**: change `PORT` in `apps\api\.env` and set `API_PROXY_TARGET` for the frontend (see `apps\web\.env.example`).
- **`npm run db:migrate` proposes dropping a partial index** (`procurement_open_duplicate_uniq`, `field_inspection_one_active_per_request`, `collection_job_one_active_per_request`, `..._per_vehicle`, `..._per_officer`): Prisma's schema language cannot express partial indexes. Delete those `DROP INDEX` lines from the generated migration before applying it. The migrations also contain hand-written SQL (sequence, `CHECK` constraints, triggers) which Prisma does not manage.
- **Assigning transport says a vehicle or officer is busy**: each can have one active job. Finish (hand over) or cancel the existing job first.
- **No vehicles or officers in the pickers**: an administrator must create them first (Vehicles, Users).
- **"No upcoming slots" when booking**: add a slot under Slots first. Slots in the past or marked inactive cannot be booked.
- **The gate will not admit a vehicle**: it needs arrival, then verification, then an on-time arrival (or a manager's override), and no hold. The screen tells you which.
- **Reception will not complete**: both weights must be recorded and the driver must have recorded the handover.
- **A shipment cannot be released to processing**: an open weight discrepancy must be resolved by a Purchase Manager first (Exceptions).
- **Countdowns look wrong after changing the PC clock**: they follow the server's clock, not the PC's, and correct themselves on the next refresh.

More detail: [docs/API.md](docs/API.md).
#   P r a w n _ F a c t o r y  
 