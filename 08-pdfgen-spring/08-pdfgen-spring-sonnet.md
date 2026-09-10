# PDF-gen → Spring Boot + PostgreSQL Migration Plan

Target folder for this work: `08-pdfgen-spring/` (per `CLAUDE.md`'s "Repository
layout," reserved for the future Spring Boot backend). Functional baseline for
"what the app currently does" is **`07-pdfgen-dbnormal`** — the most current
branch, including its row-level `form_instance_rows` normalization. Reference
architecture for how this org actually builds/deploys Spring Boot apps is
**`C:\ARCHIVE\Logcards-V2\logcards-ng`** (LMCO "logcards" aircraft-logbook
app) — its real conventions are cited throughout instead of generic textbook
Spring Boot, per direct instruction.

## 1. Executive Summary & Decisions Locked In

Decisions made during planning, not to be silently revisited during
implementation without flagging it:

| Decision | Choice | Why |
|---|---|---|
| Frontend | Stay vanilla HTML/Alpine.js now; Angular later (phased) | Minimizes near-term rewrite risk; Angular phase targets the same stack `logcards-ui` already uses (Angular 16.2, Angular Material) for visual/tooling consistency across the org's apps. |
| Fill engine | **Both** — client-side `pdf-lib.js` (unchanged) and a new server-side Apache PDFBox engine, selectable per request for A/B testing | Explicit ask: compare output/perf before retiring either. |
| API shape | Redesign as proper REST resources (`GET/POST/PUT/PATCH/DELETE` on real resources), not the current whole-array `PUT` contract | Explicit ask. Deliberately diverges from `logcards-ng`'s own HATEOAS/RPC-flavored API (see §5) — noted as a conscious tradeoff, not an oversight. |
| Auth | Reuse the org's proprietary `com.lmco.rms.cf.authentication.sdk`, federated to PingFederate OIDC, authorized via AD/LDAP group membership | `logcards-ng` already solved this; a DB-backed users/roles table would be reinventing infra IT already runs. Requires a new `PDFGEN.*` AD group prefix and PingFederate client registration — external dependency, see §3 Phase 0. |
| Packaging/deploy | WAR, deployed via GitLab CI → AWS CodeDeploy → Tomcat 9, GovCloud (`us-gov-west-1`) | Matches `logcards-ng`'s actual production path. No containerized prod deploy exists in the reference app; introducing one is a platform-team decision, not assumed here. |
| Build | Gradle multi-module, Java 17, package root `com.lmco.rms.pdfgen` | Matches `logcards-ng` (`com.lmco.rms.logcards`, Gradle 7.5.1, Java 17 toolchain). |
| Cross-cutting scope | Auth & roles, cross-document uniqueness validation, real automated-data-entry plumbing (not a real integration yet), audit trail / optimistic locking — all **in scope** for this migration, not deferred | Explicit ask. |
| Dev/build/test environment | A single Docker or Podman image bundling every dependency needed to build, test, and run this `08` app locally (Java 17, Gradle, Postgres client, Node for the later Angular phase, proxy/CA trust config) — see §9 | Explicit ask: a reproducible toolchain across machines/CI. **Not** a production runtime container — prod stays WAR/Tomcat9 per the packaging/deploy decision above; this image is dev/build/test only. |

## 2. Target Architecture

### 2.1 Module map

Mirrors `logcards-ng`'s real pairing convention — a `-domain` module holding
pure JPA entities (no Spring annotations beyond `javax.persistence`) paired
with a `-service` module holding `dao/`, `service/`, and `config/` for that
same bounded context — rather than a generic
controller/service/repository/entity split invented from scratch:

```
pdfgen-common/                    # SecurityConfig (LMCO SDK wiring), PersistenceConfig,
                                   # FlywayConfig, TransactionConfig — cross-cutting only
pdfgen-registry-domain/           # Entities: AircraftModel, DocumentType, DocumentTypeForm,
                                   # FormType, CustomFormType, FormTypeOverride
pdfgen-registry-service/          # dao/, service/, config/ for the registry bounded context
pdfgen-documents-domain/          # Entities: Document, FormInstance, FormInstanceRow,
                                   # Default, DefaultInstance, FieldLayout
pdfgen-documents-service/         # dao/, service/ (incl. the row diff-sync logic — see §4),
                                   # config/
pdfgen-fillengine-service/        # NEW server-side engine only — PdfBoxFillEngine,
                                   # AcroForm merge/rename logic ported from pdf-lib,
                                   # coordinate-draw logic, fill-engine comparison/telemetry.
                                   # The client engine is NOT a Java module — it stays the
                                   # existing browser JS (buildCoordinateCopies, drawStyledField,
                                   # mergeCoordinateDocs, etc.), served as static assets.
pdfgen-automation-service/        # "Automated data entry" plumbing — isolated, Solumina-
                                   # pattern-shaped (see §6), no real external endpoint wired
pdfgen-web/                       # REST controllers + static HTML/JS/CSS assets, one
                                   # deployable WAR (mirrors logcards-ui's dual role, minus
                                   # the Angular build until Phase 7)
```

`logcards-model` was found to be an empty, effectively-unused module in the
reference app — not copied here; DTOs live in `pdfgen-web` next to the
controllers that own them, revisited only if a real cross-module DTO need
appears.

### 2.2 Fill engine (dual, for A/B testing)

```
FillEngine (interface, conceptual — client engine is JS, not Java)
├── Client: pdf-lib.js in the browser — unchanged from 07-pdfgen-dbnormal
└── Server: PdfBoxFillEngine (pdfgen-fillengine-service)
    ├── AcroFormFillStrategy   — named-field fill, port of setStyledAcroText
    ├── CoordinateFillStrategy — page.drawText-equivalent, port of drawStyledField
    └── AcroFormMergeService   — port of the field-renaming + /AcroForm-rebuild
                                  fix (see CLAUDE.md "Fill engine" — copyPages()
                                  does not register widgets in the new doc's
                                  /AcroForm, and same-named fields collapse
                                  across merged sources; both must be re-solved
                                  in PDFBox, not assumed solved by library swap)
```

A/B mechanism: a per-document (or per-session) flag selects which engine
produces the download; both paths are exercised against the same
`FormInstance`/`FormInstanceRow` data, so no dual data model is needed —
only dual *rendering*. A comparison harness (§7) diffs page count, text
content, and field values between the two outputs for the same instance.

### 2.3 Database

PostgreSQL, schema `pdfgen`, Hibernate/JPA (`hbm2ddl.auto=validate` — schema
is never auto-generated from entities, matching `logcards-ng`), Flyway for
incremental migrations. See §4 for the full table mapping.

### 2.4 API

Proper REST resources, nested-path style inspired by `logcards-ng`'s
`/api/collections/models/{modelId}/assemblies` convention but using real HTTP
verbs instead of RPC-POST, and `@ControllerAdvice` for error handling
(cleaner than `logcards-ng`'s filter-based `ExceptionHandlingFilter`, called
out as an intentional improvement, not an oversight). See §5.

## 3. Migration Phases (strangler-fig)

Spring Boot stands up alongside the existing Express server (`07-pdfgen-dbnormal/server`),
behind a reverse proxy, migrated one domain at a time. Express is only
deleted in the final phase.

- **Phase 0 — Scaffolding & external dependencies**
  - Gradle multi-module skeleton per §2.1, Postgres (local dev via Docker is
    fine — only *production* deploy must match the WAR/Tomcat9 path),
    Flyway baseline.
  - Reverse proxy in front of both Express and Spring Boot.
  - **Blocking external dependency, not schedulable by this team alone**:
    request a `PDFGEN.*` AD group prefix and a PingFederate client
    registration from IT/security, mirroring `LOGCARDS.*`. Auth work (Phase
    1b) cannot complete without this.

- **Phase 1a — Registry domain** (lowest risk, mostly CRUD)
  `aircraft_models`, `document_types`, `document_type_forms`,
  `form_type_overrides`, `custom_form_types`, `form_types` (read-only) →
  new `/api/registry/*` REST resources (see §5). Express's equivalent
  whole-array `PUT` routes are retired one at a time as each lands.

- **Phase 1b — Auth**
  Wire `pdfgen-common`'s `SecurityConfig` against the LMCO auth SDK once
  Phase 0's AD group/PingFederate registration exists. Replace the
  client-side "Admin checkbox" (currently a simulated, unenforced role) with
  real `PDFGEN.ADMIN`-gated method security on registry/admin endpoints.

- **Phase 2 — Documents & form instances**
  `documents`, `form_instances`, and the `form_instance_rows` diff-sync
  logic. Highest-risk phase — see §4 for why the diff-sync behavior
  (insert/update/skip-unchanged, not blanket delete-and-reinsert) must
  survive the JPA port, and §5 for how granular REST resources change
  *where* that diffing happens (client-side dirty-tracking vs. server-side
  diffing today).

- **Phase 3 — Defaults**
  `defaults`/`default_instances` — deliberately not normalized, simplest of
  the three data phases.

- **Phase 4 — Fill engine A/B**
  Build `PdfBoxFillEngine` per §2.2, including the AcroForm-merge fix
  parity work. Ships behind the A/B flag; client `pdf-lib.js` path keeps
  running unchanged throughout.

- **Phase 5 — Admin workflows**
  Upload-PDF classification (AcroForm / vector-text / scanned), Form Type
  Editor persistence (`field_layouts`), Structure Builder reconciliation.
  Classification logic (pdf.js today) can stay client-side or move
  server-side (PDFBox `PDFTextStripper`) — open question, see §10.

- **Phase 6 — Cross-cutting: uniqueness, audit/locking, automation plumbing**
  - Cross-document uniqueness validation (e.g. serial number unique per
    aircraft model + document type) as a real server-side check, called
    both on-blur (new validation endpoint) and again at Mark Complete /
    generate time (defense in depth) — resolves the open question
    `CLAUDE.md`'s "Validation" section left unresolved.
  - Audit trail / optimistic locking: `@Version` column on `documents`,
    `form_instances`, `form_instance_rows`, `defaults`; a new `audit_log`
    table (entity, action, actor, timestamp, diff) — no existing pattern
    for this was found in `logcards-ng`, so this is genuinely new design,
    not a port.
  - `pdfgen-automation-service` scaffolding: isolated module, external
    DTO → internal mapping/filter stage, a scheduler hook point left inert
    — shaped after `logcards-solumina-service`'s pattern (see §6) — but
    with **no real external endpoint wired**, since none is identified yet.

- **Phase 7 — Angular migration (deferred, not scheduled with this plan)**
  Replace the vanilla frontend with Angular 16+/Material, matching
  `logcards-ui`. The REST-proper API from earlier phases is what makes this
  swap low-risk later — a clean resource API is easier for Angular
  `HttpClient` services to consume than the current whole-array contract
  would have been.

- **Phase 8 — Cutover**
  Retire Express, remove the proxy, delete `07-pdfgen-dbnormal/server/`.

## 4. Database Schema Migration

Source: `07-pdfgen-dbnormal/server/db.js`. Target: Postgres, schema `pdfgen`,
snake_case (Hibernate default naming strategy, matching `logcards-ng`),
bounded-context table prefixes mirroring the `FD_`/`DC_` precedent
(`REG_` for registry, `DOC_` for documents).

| Current SQLite table | New Postgres table | Notes |
|---|---|---|
| `documents` | `pdfgen.doc_documents` | `id TEXT` → keep as `TEXT`/`UUID`? See §10 (id strategy open question). Add `version` (optimistic locking), `created_by`/`updated_by` (audit). |
| `form_instances` | `pdfgen.doc_form_instances` | `data_json TEXT` → `JSONB`. `complete INTEGER` → real `BOOLEAN`. Add `version`. |
| `form_instance_rows` | `pdfgen.doc_form_instance_rows` | `data_json TEXT` → `JSONB`. This table *is* the fix `07-pdfgen-dbnormal` added — the JPA port must preserve real diffing (insert new / update changed / skip identical), not regress to delete-and-reinsert-everything, which was the exact production bug this branch fixed. See Phase 2. |
| `defaults` | `pdfgen.doc_defaults` | Unchanged shape — deliberately not row-normalized (see `CLAUDE.md`). |
| `default_instances` | `pdfgen.doc_default_instances` | `data_json TEXT` → `JSONB`. |
| `field_layouts` | `pdfgen.reg_field_layouts` | `layout_json TEXT` → `JSONB`. |
| `aircraft_models` | `pdfgen.reg_aircraft_models` | |
| `document_types` | `pdfgen.reg_document_types` | `models_json TEXT` → `JSONB` or a real join table `reg_document_type_models` — lean toward the join table, since `models` is really a many-to-many, not opaque data. |
| `document_type_forms` | `pdfgen.reg_document_type_forms` | Composite key preserved. |
| `form_types` | `pdfgen.reg_form_types` | `schema_json TEXT` → `JSONB`. Still read-only from the app's side (no write endpoint), same as today. |
| `custom_form_types` | `pdfgen.reg_custom_form_types` | `schema_json TEXT` → `JSONB`. |
| `form_type_overrides` | `pdfgen.reg_form_type_overrides` | `overrides_json TEXT` → `JSONB`. |
| *(new)* | `pdfgen.aud_audit_log` | entity_name, entity_id, action, actor, occurred_at, diff_json — Phase 6. |
| *(new)* | `pdfgen.reg_pdfgen_ad_groups` or equivalent | only if role-to-permission mapping needs to live in the DB rather than purely in AD group names — TBD during Phase 1b. |

Migrations live under `db/migration` (Flyway). **Open question** (see §10):
reuse `logcards-ng`'s customized `U1.0.NNN__Description.sql` prefix
convention if Flyway tooling is shared platform infra, or default Flyway
`V__` naming if pdfgen's pipeline is independent. A one-time baseline DDL
set (mirroring `sql/ddl`/`sql/local-database-setup`) seeds a fresh dev DB;
Flyway owns everything incremental after that, same split as `logcards-ng`.

## 5. REST API Design

Replaces the current whole-array `PUT` contract with real resources. Current
routes (`07-pdfgen-dbnormal/server/server.js`) for reference:

`GET /api/bootstrap`, `PUT /api/documents`, `PUT /api/defaults`,
`PUT /api/field-layouts`, `PUT /api/registry/aircraft-models`,
`PUT /api/registry/document-types`, `PUT /api/registry/document-type-forms`,
`PUT /api/registry/custom-form-types`, `PUT /api/registry/form-types`,
`PUT /api/registry/form-type-overrides`.

Proposed resource design:

| Resource | Endpoints |
|---|---|
| Aircraft models | `GET/POST /api/aircraft-models`, `PUT/DELETE /api/aircraft-models/{name}` |
| Document types | `GET/POST /api/document-types`, `PUT/DELETE /api/document-types/{id}` |
| Document-type forms | `GET/PUT /api/document-types/{id}/forms` (ordered list — PUT replaces order, still resource-scoped rather than whole-registry) |
| Form types | `GET /api/form-types`, `GET /api/form-types/{type}` (read-only, matches today) |
| Custom form types | `GET/POST /api/custom-form-types`, `GET/PUT/DELETE /api/custom-form-types/{type}` |
| Form type overrides | `GET/PUT /api/form-types/{type}/overrides` |
| Field layouts | `GET/PUT /api/form-types/{type}/field-layout` |
| Documents | `GET/POST /api/documents`, `GET/PATCH/DELETE /api/documents/{id}` |
| Form instances | `GET/POST /api/documents/{docId}/instances`, `GET/PATCH/DELETE /api/instances/{id}` |
| Form instance rows | `GET/POST /api/instances/{id}/rows/{rowsKey}`, `PUT/DELETE /api/rows/{id}` — **this is the key contract change**: the client sends only the row(s) that actually changed (add/update/delete), rather than the whole `logbooks` array on every debounced edit. This moves the diff-sync work `syncInstanceRows` currently does server-side (§4) into the API contract itself — the frontend's `persistLogbooks()`-style sync layer needs real rework here, not just a URL swap, even though the UI stays vanilla JS. Flag this to whoever scopes Phase 2/5 effort — it's a bigger frontend lift than "backend swap only." |
| Defaults | `GET/POST /api/defaults`, `GET/PATCH/DELETE /api/defaults/{id}` |
| Cross-document uniqueness | `GET /api/validation/unique?field=...&value=...&model=...&docType=...&excludeDocumentId=...` (Phase 6) |
| Fill (client engine unaffected) | `POST /api/instances/{id}/fill?engine=server` → PDFBox path (Phase 4); no endpoint needed for the client engine, it's still pure browser JS |

Errors: `@ControllerAdvice` + a standard problem-detail response body.
Optimistic locking: every mutable resource returns a `version` field; a
`PUT`/`PATCH` must include it (`If-Match` header or body field — pick one
convention, apply everywhere) and gets `409 Conflict` on mismatch (Phase 6,
audit/locking scope).

## 6. Functionality-by-Functionality Migration Map

| Feature (from `CLAUDE.md`) | Migration treatment |
|---|---|
| Aircraft/document-type/form-type registry CRUD | Backend swap — Phase 1a |
| `documentTypeForms` ordering | Backend swap — Phase 1a |
| `form_type_overrides` | Backend swap — Phase 1a |
| Admin role (currently a client-side simulated checkbox) | Real enforcement — Phase 1b, AD-group-gated |
| Custom form type upload (AcroForm/vector-text/scanned classification) | Classification logic can stay client-side (pdf.js) or move server-side (PDFBox `PDFTextStripper`) — open decision, Phase 5 |
| Manual Structure Builder | Backend swap only — the builder UI itself is untouched, only its save target changes — Phase 5 |
| Form Type Editor (position/style/overlays) | Stays entirely client-side (canvas math, drag/resize) — only persistence target (`field_layouts`) changes — Phase 5 |
| Field/table validation | Server-side duplication via Bean Validation (defense-in-depth); client JS validation keeps live UX unchanged — Phase 2/5 |
| Mark complete | Backend swap; gains real cross-document uniqueness enforcement at this gate — Phase 2 + Phase 6 |
| Defaults | Backend swap — Phase 3 |
| Row-level normalization / diff-sync | Ported into `pdfgen-documents-service`; contract changes from whole-array to per-row REST (see §5) — Phase 2, highest risk |
| Undo/redo | No backend impact — stays 100% client-side, in-memory, unchanged |
| Export All / merge engine | Dual-path per the A/B decision — client `pdf-lib` merge (unchanged) and new server PDFBox merge — Phase 4 |
| Overlays (fixed/placeholder images & text) | Client-side editor unchanged; fill-time drawing ported to both engines — Phase 4/5 |
| Sidebar collapse/rename | No backend impact |
| Auth & roles | New — LMCO SDK/PingFederate/AD groups — Phase 1b |
| Cross-document uniqueness validation | New — resolves `CLAUDE.md`'s previously-open question — Phase 6 |
| Automated data entry (currently simulated via `sampleData()`) | Generic plumbing only, Solumina-pattern-shaped (isolated module, external→internal DTO mapping/filter stage, inert scheduler hook) — no real endpoint — Phase 6 |
| Audit trail / optimistic locking | New — `@Version` + `audit_log` — Phase 6 |

## 7. Testing Strategy

- **Repository/service layer**: JUnit + Testcontainers against real
  Postgres (not H2) — matches the "don't mock what a real incident already
  burned us on" caution that applies broadly to persistence-layer tests.
- **Contract tests**: assert the new REST resources' wire shapes are what
  the (unchanged, vanilla) frontend's `serializeInstance`/
  `deserializeInstance`/`documentFromWire` expect, field-for-field, so a
  server-side contract regression is caught before it reaches the browser.
- **Diff-sync parity tests** (Phase 2): reproduce the exact scenario
  `07-pdfgen-dbnormal` validated by hand (edit one field on one row of a
  10-row instance → `updated=1, skipped=9`, sibling instances untouched)
  as an automated test, not a one-time manual check.
- **Fill-engine parity tests** (Phase 4): generate the same `FormInstance`
  through both the client `pdf-lib` output and the server PDFBox output,
  diff page count / text content / field values — this *is* the A/B
  validation, not just a correctness check.
- **AcroForm-merge regression tests**: confirm the ported merge logic
  avoids both failure modes the JS version had to fix (widgets not
  registered in the merged `/AcroForm`; same-named fields collapsing
  across merged sources) — these are exactly the kind of subtle bug that
  reappears silently when a library is swapped, per `CLAUDE.md`'s own
  warning.

## 8. DevOps

- Gradle multi-module build, Gradle wrapper matching `logcards-ng`'s
  version where practical, Java 17 toolchain.
- `application-{profile}.yml` per environment (`local`, `dev`, `test`,
  `stage`, `prod`), matching `logcards-ng`'s environment naming.
- Local dev: Postgres via Docker Compose is fine (doesn't need to match
  prod packaging).
- Production: WAR, GitLab CI (`assemble` + CodeDeploy packaging steps,
  mirroring `logcards-ng`'s `.gitlab-ci.yml`), deployed to Tomcat 9 in
  GovCloud (`us-gov-west-1`) via AWS CodeDeploy — **not** a new
  containerized deploy path, unless the platform team explicitly directs
  otherwise.
- Corporate proxy notes from `07-pdfgen-dbnormal/server/README.md`
  (`HTTPS_PROXY`/`HTTP_PROXY`/`NODE_EXTRA_CA_CERTS` needed for native
  module installs) will very likely have a Gradle/Maven-dependency
  equivalent — budget time to rediscover this the same way it was
  rediscovered for `npm install`.

## 9. Development, Test & Build Container (Docker or Podman)

A single reproducible container image bundling every dependency needed to
build, test, and run the `08` app **locally and in CI** — explicitly not a
production runtime. Production stays WAR + Tomcat 9 + CodeDeploy/GovCloud
per §8; conflating the two would silently re-introduce the "new deploy
path" question §8 already deferred to the platform team. This image exists
so "works on my machine" and "works in CI" are the same guarantee.

### 9.1 Docker vs. Podman — open decision

Before building this, check what `logcards-ng`'s own GitLab CI runner
image (and any existing internal container registry) already standardizes
on, rather than introducing a second convention into the org. Worth
noting: GovCloud/defense-contractor shops sometimes mandate Podman
(daemonless, rootless-by-default) over Docker for security-posture
reasons — if no existing standard is found, treat that as a real factor in
the choice, not just a personal-preference toss-up. Whichever is picked,
the artifact should be a plain `Containerfile`/`Dockerfile` — both engines
consume the same syntax, so this decision is low-cost to reverse later if
needed.

### 9.2 What the image bundles

- **Java 17** — matching the Gradle toolchain target (§1, §8).
- **Gradle** — pinned to the same wrapper version chosen for the project
  (ideally matching `logcards-ng`'s 7.5.1 unless a reason emerges not to),
  with the wrapper's dependency cache warmed at build time so a fresh
  container isn't re-downloading the world on first use.
- **Postgres client tools only** (`psql`, `pg_dump`) — for local
  schema/data inspection. The Postgres *server* itself stays a separate
  Compose service (see §9.3), so the toolchain image and the database
  version aren't coupled to each other's release cadence.
- **Flyway CLI** — or rely solely on the Gradle Flyway plugin; pick one
  and don't maintain both, to avoid the two drifting out of sync on which
  one actually ran a given migration.
- **Node.js/npm** — not needed until Phase 7 (Angular), but included now
  so the image doesn't need a breaking rebuild/re-baseline when that phase
  starts.
- **AWS CLI / CodeDeploy packaging tooling**, if local builds need to
  produce CodeDeploy-ready artifacts matching `.gitlab-ci.yml`'s
  `copyWarToCodeDeploy` step — otherwise this step only ever needs to run
  in the real CI runner, not on a dev machine; confirm which is actually
  wanted before including it.
- **Corporate proxy / CA trust configuration** — baked into the image or
  injected via build args/environment, the same lesson `07-pdfgen-dbnormal`
  already paid for with `better-sqlite3`'s postinstall `ECONNRESET`
  failures (`HTTPS_PROXY`/`HTTP_PROXY`/`NODE_EXTRA_CA_CERTS` bypassing
  `.npmrc`-only config). Gradle's own dependency resolution against Maven
  Central / a corporate Nexus mirror is exactly the kind of direct-outbound
  call likely to hit the same firewall behavior — budget time to
  rediscover this rather than assuming Gradle is exempt.

### 9.3 Compose layout

A `docker-compose.yml` (or Podman Compose equivalent) ties the toolchain
image together with a **separate** Postgres service container for local
dev/integration-test data — not baked into the same image as the
toolchain — so the two can be versioned and torn down/recreated
independently.

### 9.4 Testcontainers interaction (nested-container concern)

§7's repository/service-layer tests run against real Postgres via
Testcontainers, not H2. If those tests execute *inside* this same
dev/build container, Testcontainers needs a container runtime to spin up
its own throwaway Postgres instance — i.e. the dev container needs access
to the host's Docker/Podman socket (or a rootless-Podman-in-Podman
equivalent). This is a real complication, not something that "just
works" by default — resolve it explicitly (socket mount, Podman's
`--userns=keep-id` + rootless nesting support, or a CI-specific
"Testcontainers runs on the bare CI runner, not inside this image" carve-
out) before relying on it, and document whichever choice is made.

### 9.5 CI reuse

The same image (or a close variant) should double as the GitLab CI runner
image for the `08` app's own pipeline stage, so a passing local build
inside this container is a genuine predictor of a passing CI build —
not two toolchains that can quietly drift apart.

## 10. Risk Register & Open Decisions

Explicitly flagged rather than silently decided:

- **Docker vs. Podman for the dev/build/test image** (§9) — depends on
  whatever `logcards-ng`'s CI runner / the org's container registry
  already standardizes on; don't default to Docker just because it's more
  familiar if Podman is the actual GovCloud-approved convention. Resolve
  before Phase 0's scaffolding work builds the image.
- **Testcontainers-in-container nesting** (§9.4) — needs an explicit
  socket-mount/rootless-nesting/CI-carve-out decision before Phase 2's
  repository-layer tests can rely on it inside the dev container.
- **AD group / PingFederate registration** (Phase 0) is an external
  dependency on IT/security, not schedulable by this team alone — likely
  the actual critical path for Phase 1b.
- **Flyway naming convention** — reuse `logcards-ng`'s customized
  `U1.0.NNN__...` prefix (if Flyway tooling/config is shared platform
  infra) or default `V__` (if pdfgen's pipeline is independent)? Needs a
  platform-team answer before Phase 0's Flyway baseline is finalized.
- **WAR vs. executable JAR** — this plan assumes WAR-on-Tomcat9 to match
  `logcards-ng`'s real deploy path; confirm this is still the intended
  target infra for a new app rather than a from-scratch containerized
  deploy.
- **ID strategy** — current ids are client-generated `uid()` strings
  (`TEXT` primary keys). Keep as `TEXT`/`UUID`, or move to server-generated
  `BIGSERIAL`? Affects both the diff-sync logic (§4) and the new REST
  resource design (§5) — resolve before Phase 2.
- **Row-sync contract change is a real frontend lift, not just a URL
  swap** — see §5's note on `form_instance_rows` — the debounced
  whole-array `persistLogbooks()` pattern needs genuine rework to track
  and send per-row deltas, even though the UI itself (vanilla JS) doesn't
  change visually. Don't scope Phase 2 as "backend only."
- **Classification logic location** (Phase 5) — client-side (pdf.js,
  unchanged) vs. server-side (PDFBox `PDFTextStripper`) for Upload PDF's
  AcroForm/vector-text/scanned detection — no strong reason yet to prefer
  one; revisit once Phase 4's PDFBox investment is further along.
- **ITAR/GovCloud dependency review** — new libraries this migration
  introduces (Apache PDFBox, Flyway, Spring Data JPA, whatever REST/error
  libraries are chosen) will very likely need the same kind of
  export-control/dependency review any new dependency gets in this
  environment — budget time for it, don't assume it's a rubber stamp.
- **No existing audit-trail/optimistic-locking pattern was found in
  `logcards-ng`** — §6's `@Version` + `audit_log` design is genuinely new,
  not a port. Worth a second look at `logcards-ng` specifically for this
  (e.g. Hibernate Envers usage, a differently-named audit mechanism) before
  finalizing, since the survey that produced this plan didn't target that
  question directly.
- **Automated data entry has no real target system yet** — Phase 6 builds
  plumbing only. When a real source is identified, expect it to look more
  like Solumina's pattern (isolated module, scheduled/batch pull) than a
  simple per-document on-demand fetch, if it turns out to be a similar
  MES/PLM-style system rather than a request/response API.
