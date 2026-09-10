# PDF-gen — Spring Boot Migration Plan

**Reimplementing `07-pdfgen-dbnormal` as a Spring Boot + PostgreSQL application with Lockheed Martin authentication.**

| | |
|---|---|
| Document status | Draft for review |
| Date | 2026-09-10 |
| Source application | `07-pdfgen-dbnormal/` (Express + SQLite + vanilla HTML/Alpine.js) |
| Architecture reference | `C:\ARCHIVE\Logcards-V2\logcards-ng` (LogCards v2.8.0) |
| Target | New Spring Boot application, PostgreSQL, LM corporate auth |

---

## 1. Purpose and scope

### 1.1 What this document is

A step-by-step plan to reimplement the existing PDF-gen application as a Spring Boot service backed by PostgreSQL, conforming to Lockheed Martin platform conventions, with LM corporate authentication.

Section 13 is the core of the document: a **functionality-by-functionality migration matrix** covering every capability the current application has, each with its current implementation, target design, endpoints, tests, and acceptance criteria.

### 1.2 Scope — explicit boundaries

**In scope.** Everything `07-pdfgen-dbnormal` does today:

- The admin-maintained registry (aircraft models, document types, form types, assignment and ordering)
- The Structure Builder and the visual Form Type Editor
- Schema-driven data entry, including multi-table forms and row-capacity/overflow behaviour
- Field and form validation, and the mark-complete lifecycle
- Saved defaults
- The PDF fill engine (coordinate path), overlays, merge, and Export All
- PDF upload, classification, and field/table extraction
- Undo/redo, preview, logging

Plus four capabilities that the current application either simulates or lacks, which the migration makes real:

- LM corporate authentication and a genuine ADMIN/USER split
- Cross-document uniqueness validation
- Audit trail and optimistic locking
- A real automated-data-entry integration replacing the simulated modal

**Out of scope.** Nothing from LogCards is migrated. No LogCards code, schema, data, form definitions, Jasper templates, or features are carried over. LogCards is consulted for architecture, conventions, and platform integration patterns only.

Specifically **not** being built (all are LogCards capabilities with no PDF-gen counterpart): DA 2410 XML export to SMB, Solumina MES batch import, Excel/Access export, cross-form search, part-number/serial-number assignment, Army NSN/WUC/CAGE reference validation, and the JasperReports reporting stack.

### 1.3 The current application in numbers

| Metric | Value |
|---|---|
| Frontend | Single `index.html`, 5,158 lines (Alpine.js 3.14, pdf-lib 1.17.1, pdf.js 3.11.174 — all via CDN) |
| Backend | `server/server.js` 442 lines, `server/db.js` 160 lines (Express 4 + better-sqlite3) |
| Database tables | 12 |
| API endpoints | 10 (one `GET /api/bootstrap`, nine whole-collection `PUT`s) |
| Built-in form types | 3 (DA 2408-17, DA 2408-18, DA 2408-20) |
| Automated test coverage | **None** |

That last row is the single most important risk input to this plan. See §15.1.

---

## 2. What we take from LogCards, and what we deliberately do not

LogCards is a live production system (`com.lmco.rms.logcards` v2.8.0) built on Spring 5.3.28 / Hibernate 5.5 / Java 17, packaged as a WAR for Tomcat 9, with an Angular 16 frontend, deployed to GovCloud EC2 via GitLab CI and AWS CodeDeploy. It is the house standard.

### 2.1 Conventions adopted

| Area | LogCards practice | Adopted |
|---|---|---|
| Build | Gradle 7.5.1, multi-module, `settings.gradle` with nested `include` paths | Yes — mirror the module shape |
| Repositories | `nexus.global.lmco.com` + `lmco-art.us.lmco.com`, proxy via `proxy-zsgov.external.lmco.com:80` | Yes — copy `gradle.properties` proxy block verbatim |
| Database | PostgreSQL (`PostgreSQL95Dialect`), schema-qualified | Yes |
| Migrations | Flyway, `classpath:db/migration`, `V__`/`U__` forward+undo pairs | Yes — but a **fresh `V1` sequence**, unrelated to LogCards' 176 |
| Auditing | Hibernate Envers `@Audited`, `spring-data-envers`, `REVINFO` + `*_aud` tables | Yes |
| Security | `com.lmco.rms.cf:authentication-sdk` 3.7.0, OIDC JWT + AD LDAP fallback, group-derived roles | Yes — see §8 |
| Profiles | `local`, `lab1`, `dev`, `test`, `stage`, `prod` | Yes |
| Secrets | AWS Secrets Manager per environment (`aws.database.secretKey`) | Yes |
| API URL style | `/api/collections/forms/{id}/sections` — resource-oriented, granular | Yes — see §7 |
| CI/CD | GitLab CI, manual per-env build trigger, AWS CodeDeploy, `CodeDeployDefault.OneAtATime` | Yes |
| Quality gates | SonarQube (`sonarqube.us.lmco.com`) + Fortify SCA | Yes |
| Frontend | Angular 16 + Angular Material, NgModules, schema-driven dynamic form renderer | Yes — deferred to Phase 13, see §13.22 |

### 2.2 Conscious deviations

| Deviation | Rationale |
|---|---|
| **Add OpenAPI (springdoc)** | LogCards has no API specification of any kind. It is inexpensive, and it generates the Angular client in Phase 13 for free. |
| **No Spring HATEOAS** | LogCards uses `_links` traversal to lazily walk a deep `form → sections → fields` tree. PDF-gen loads a whole form instance in one request; hypermedia would add ceremony with no corresponding benefit. |
| **Testcontainers instead of H2** | The schema uses JSONB, partial unique indexes, and Postgres-specific constraints. H2 cannot faithfully exercise them, and a test suite that passes against a dialect the application never runs on is worse than no test suite. |
| **JSONB for form-type schemas and field layouts** | LogCards normalizes form definitions into `fd_form_def` / `fd_section_def` / `fd_field_def`. PDF-gen edits a whole schema atomically through the Structure Builder and Form Type Editor, and reads it whole at bootstrap. Normalizing buys queryability the application does not currently use, at the cost of scope beyond "reimplement 07". **Decision: JSONB.** Revisit if per-field querying is ever required. |
| **Containerized development and test environment** | LogCards has no container tooling. See §10 — this addresses a documented, recurring source of lost developer time on this network. |
| **No JasperReports** | LogCards generates its PDFs from ~150 hand-authored `.jrxml` templates. PDF-gen's entire premise is replacing developer-authored templates with an admin-maintained visual field map. Adopting Jasper would defeat the purpose. |

### 2.3 A confirmed negative result worth recording

LogCards contains **no PDFBox, no iText, and no Apache FOP**. It has no capability to fill a pre-existing PDF's AcroForm fields, and no capability to draw text at authored coordinates onto an existing template. Its only PDF path is JasperReports template rendering.

This was checked specifically to avoid rebuilding something that already existed. It does not exist. The server-side fill engine in Phase 8 is genuinely net-new work, and PDFBox is the correct choice independent of LogCards' architecture.

---

## 3. Architecture decisions

### ADR-001 — Reimplement rather than port

`07-pdfgen-dbnormal` is a proof-of-concept lineage, not a codebase to be mechanically translated. Its JavaScript fill engine, validation rules, and layout model are the **specification**; the Java implementation is written fresh against that specification, with the existing behaviour captured as golden-file tests (Phase 0) rather than as code to transliterate.

### ADR-002 — PostgreSQL as system of record

Already the intended design (`CLAUDE.md`, "Stack"), and already the LogCards production database. SQLite was always a proof-of-concept stand-in.

### ADR-003 — Two fill engines, A/B switchable, with a sunset criterion

Both the existing client-side engine (pdf-lib) and a new server-side engine (Apache PDFBox) ship, selectable at runtime, so their output can be compared against each other on real data.

Maintaining two implementations of one specification is a permanent tax. The A/B period therefore has an explicit **sunset criterion agreed before Phase 8 begins**: once the parity harness reports zero regressions across the full golden corpus for 30 consecutive days, the server engine becomes the sole engine and the client path is removed. Without this, "temporary" duplication becomes permanent.

### ADR-004 — Spring Boot version and deployment model

**This is the one decision that blocks the others, and it must be resolved in Phase 0.**

Spring Boot 3.x requires the `jakarta.*` namespace and **Tomcat 10.1 or later**. LogCards deploys WARs to **Tomcat 9** (`javax.servlet` 4.0.1, Servlet 4.0). The existing deployment path and Spring Boot 3 are therefore mutually exclusive.

| | **Option A — Boot 3.3, executable JAR** *(recommended)* | Option B — Boot 2.7, WAR |
|---|---|---|
| Servlet namespace | `jakarta`, embedded Tomcat 10.1 | `javax`, existing Tomcat 9 |
| Deployment | CodeDeploy → EC2, run as a systemd service | Identical to LogCards today; zero infrastructure change |
| Framework support | Current, actively patched | **OSS support ended November 2023** |
| Auth SDK compatibility | **Unverified** — needs Spring Security 6 | Known good (LogCards runs Spring Security 5.8) |
| Fortify/ATO posture | Defensible | Shipping new code on an end-of-life framework is difficult to justify |

**Recommendation: Option A.** The infrastructure change is modest, it is the direction the platform is already moving (the `.github/modernize/java-upgrade` Copilot App-Modernization hooks in the LogCards repository indicate an in-flight Java upgrade effort), and introducing new code on an end-of-life framework in a Fortify-scanned defense context is a poor trade.

**Blocking prerequisite:** confirm with the platform team that `com.lmco.rms.cf:authentication-sdk:3.7.0` supports Spring Security 6. If it does not, the fallback is to forgo the SDK and configure OIDC directly using `spring-boot-starter-oauth2-resource-server` plus a custom Active Directory group-to-authority mapper — the SDK is largely performing that wiring on the application's behalf, and it is reproducible. Option B is the last resort, not the default.

### ADR-005 — JSONB for schemas and layouts, relational for instance data

Form-type schemas (`sections`, validation specs) and field layouts (coordinates, styles, overlays) are stored as JSONB. They are document-shaped, edited atomically, and read whole.

Form instance data is relational: `form_instance_rows` keeps the one-row-per-data-row shape that `07` introduced and measured. This is the part that grows unbounded over an aircraft's service life, and it is the only part where storage shape has been demonstrated to matter.

### ADR-006 — Granular REST, replacing whole-collection PUT

The current wire contract sends the entire `logbooks` array on every debounced edit, and the server diffs it back apart (`syncInstanceRows`). That server-side diffing was a correct fix for a client contract that could not be changed at the time. Reimplementation removes the constraint. See §7.

---

## 4. Target stack

| Layer | Choice |
|---|---|
| Language / runtime | Java 17 (toolchain-pinned, matching LogCards) |
| Framework | Spring Boot 3.3.x *(pending ADR-004)* |
| Build | Gradle 7.5.1+, multi-module, Gradle wrapper from the Nexus mirror |
| Persistence | Spring Data JPA, Hibernate 6, PostgreSQL 15/16 |
| Migrations | Flyway |
| Auditing | Hibernate Envers + `spring-data-envers` |
| PDF (server) | Apache PDFBox 3.x |
| PDF (client) | pdf-lib 1.17.1 (existing), pdf.js 3.11.174 for preview rendering |
| API docs | springdoc-openapi 2.x |
| Mapping | MapStruct |
| Validation | Jakarta Bean Validation |
| Security | Spring Security 6 + `com.lmco.rms.cf:authentication-sdk` 3.7.0 |
| Observability | Actuator, Micrometer, Logback (structured JSON in deployed environments) |
| Testing | JUnit 5, AssertJ, Mockito, Testcontainers (PostgreSQL), Spring Security Test |
| Frontend (now) | Existing vanilla `index.html`, served as a static resource |
| Frontend (later) | Angular 16+ with Angular Material |

**Code conventions.** Constructor injection only — no field `@Autowired`. DTOs strictly separate from entities, mapped with MapStruct. `@Transactional` at the service layer only, never on controllers or repositories. RFC 7807 `ProblemDetail` responses via `@RestControllerAdvice`. Flyway owns all schema changes; `ddl-auto` is `validate` in every environment and `none` in production.

---

## 5. Module layout

Mirrors the LogCards `settings.gradle` shape.

```
08-pdfgen-spring/
├── settings.gradle
├── build.gradle
├── gradle.properties              proxy + dependency versions
├── dependencies.gradle            central version catalogue
├── containers/                    see §10
│   ├── Containerfile.dev
│   ├── Containerfile.runtime
│   ├── compose.yaml
│   └── initdb/
├── pdfgen-model/                  DTOs, enums, wire contracts. No Spring.
├── pdfgen-common/                 config, security, error handling, Flyway migrations
├── pdfgen-domain/                 JPA entities + Spring Data repositories
├── pdfgen-service/
│   ├── pdfgen-registry-service/   aircraft models, document types, form types, layouts
│   ├── pdfgen-document-service/   documents, instances, rows, defaults, validation
│   └── pdfgen-render-service/     PDFBox fill engine, merge, PDF analysis
└── pdfgen-ui/                     @RestControllers + static frontend; the deployable
```

```groovy
// settings.gradle
rootProject.name = "pdfgen"

include "pdfgen-model"
include "pdfgen-common"
include "pdfgen-domain"
include "pdfgen-service:pdfgen-registry-service"
include "pdfgen-service:pdfgen-document-service"
include "pdfgen-service:pdfgen-render-service"
include "pdfgen-ui"
```

**Design note.** The core of `pdfgen-render-service` — the fill engine itself — is deliberately free of Spring annotations and database access. It is a pure function from `(schema, layout, instance data, template bytes)` to `PDF bytes`. This makes the golden-file parity harness (§9) a plain JUnit test with no application context, which matters when it will run against a large corpus on every commit.

---

## 6. Data model

### 6.1 Table mapping

The 12 SQLite tables map to PostgreSQL as follows.

| `07` SQLite table | Target table | Change |
|---|---|---|
| `documents` | `document` | UUID PK, audited, `@Version` |
| `form_instances` | `form_instance` | UUID PK, `data_json` → JSONB (header + overlayData only), audited |
| `form_instance_rows` | `form_instance_row` | UUID PK, `data_json` → JSONB, unique `(instance_id, rows_key, row_index)`, audited |
| `defaults` | `form_default` | UUID PK (`defaults` is a reserved-ish word; renamed for clarity) |
| `default_instances` | `form_default_instance` | UUID PK, JSONB blob retained (see note) |
| `field_layouts` | `form_type_layout` | JSONB |
| `aircraft_models` | `aircraft_model` | |
| `document_types` | `document_type` | `models_json` extracted to a join table |
| — | `document_type_aircraft_model` | **New** — normalizes the many-to-many |
| `document_type_forms` | `document_type_form` | |
| `form_types` | `form_type` (`custom = false`) | Merged with the table below |
| `custom_form_types` | `form_type` (`custom = true`) | **Merged** — see note |
| — | `form_type_template` | **New** — template bytes extracted from the schema blob |
| `form_type_overrides` | `form_type_override` | |

### 6.2 The six substantive changes

**1. `TEXT` primary keys become `UUID`, server-assigned.**
The current application generates ids client-side via `uid()`. During the transition, a nullable `client_ref` column carries the original value so that migrated data and in-flight client state reconcile; it is dropped once the frontend is fully cut over (Phase 12).

**2. All `*_json TEXT` columns become `JSONB`,** mapped with `@JdbcTypeCode(SqlTypes.JSON)`. This enables GIN indexing and real querying if it is ever needed, and gives Postgres-side validation of well-formedness for free.

**3. Template bytes are extracted from the schema blob.**
Today `templateB64` lives *inside* `form_types.schema_json` — approximately 800 KB of base64 shipped to every client on every bootstrap. It moves to:

```sql
CREATE TABLE form_type_template (
  form_type_id  UUID PRIMARY KEY REFERENCES form_type(id) ON DELETE CASCADE,
  content       BYTEA        NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  page_count    INTEGER      NOT NULL,
  content_type  VARCHAR(64)  NOT NULL DEFAULT 'application/pdf',
  updated_at    TIMESTAMPTZ  NOT NULL
);
```

Served by `GET /api/form-types/{id}/template` with a strong `ETag` derived from `sha256` and long-lived `Cache-Control`. Both fill engines consume it; the client stops re-downloading it on every page load. This alone removes the great majority of bootstrap payload weight.

**4. `document_types.models_json` becomes a join table.** It is a many-to-many relationship between document types and aircraft models, and modelling it as a JSON array inside a row prevents referential integrity on a relationship the application already guards manually (`canDeleteAircraftModel`).

**5. `form_types` and `custom_form_types` merge into one `form_type` table with a `custom BOOLEAN` discriminator.**
They were separate in `07` only because they had different persistence origins (seeded file versus admin-created). Since `05-pdfgen-database` made built-in types structurally editable, the two have identical read and write paths, and two tables with identical shapes and identical handling is duplication without purpose. `custom` still governs the two behaviours that genuinely differ: delete, and replace-template.

**6. Auditing and optimistic locking.**
`@Version` on `document`, `form_instance`, and `form_instance_row`. Envers `@Audited` on the same three, producing `*_aud` tables and a shared `REVINFO`, with the revision listener capturing the authenticated principal.

### 6.3 What deliberately does not change

`form_instance_row` keeps the exact shape `07` introduced: one SQL row per data row, with the row's cell values as a JSONB object, ordered by `row_index` within `(instance_id, rows_key)`.

This was the outcome of a real, measured investigation (`CLAUDE.md`, "Row-level normalization"): editing one field of a ten-row instance produced `updated=1, skipped=9`, with untouched sibling instances producing zero writes. It is the one storage decision in this project backed by measurement rather than reasoning, and it is preserved as-is.

The alternative — LogCards' `dc_field` model, one row per individual field *value* with a `multiplicity_index` — is more normalized still. It is the right model for LogCards because its per-field defaults, assignment, and editability machinery all address individual fields. PDF-gen always reads and writes a whole row at once in order to draw it onto a PDF, so the additional decomposition would multiply row counts (a 12-column table over 1,000 rows becomes 12,000 rows rather than 1,000) for no access-pattern benefit.

**Defaults remain un-normalized.** `form_default_instance` keeps the single-JSONB-blob-per-instance shape. A default is a snapshot written once and rarely rewritten; it was never the dimension that grows, and the diffing complexity would not pay for itself. This mirrors the reasoning already recorded for `07`.

### 6.4 Flyway conventions

Migrations live in `pdfgen-common/src/main/resources/db/migration`, following LogCards' naming (`V<n>__<description>.sql`, with a matching `U<n>__<description>.sql` undo). The sequence starts at `V1` and is entirely independent of LogCards' 176 migrations. Schema is `pdfgen`.

---

## 7. API design

### 7.1 Why the contract changes

The current API is one `GET` and nine whole-collection `PUT`s. `persistLogbooks()` watches the entire `logbooks` array with `deep: true` and ships all of it on every debounced edit; the server then diffs it apart to avoid rewriting everything.

That server-side diffing (`syncInstanceRows`) was the correct fix at the time, because the client contract was fixed. Reimplementation removes that constraint, so the diff moves to where it belongs: the client sends only what changed.

### 7.2 Resource map

Following the LogCards URL idiom (`/api/collections/forms/{id}/sections`).

**Bootstrap and templates**
```
GET    /api/bootstrap                          registry + documents; no template bytes
GET    /api/form-types/{id}/template           BYTEA, ETag, long-lived cache
```

**Registry** (all `ADMIN`)
```
GET    /api/registry/aircraft-models
POST   /api/registry/aircraft-models
PATCH  /api/registry/aircraft-models/{name}
DELETE /api/registry/aircraft-models/{name}

GET    /api/registry/document-types
POST   /api/registry/document-types
PATCH  /api/registry/document-types/{id}
DELETE /api/registry/document-types/{id}
PUT    /api/registry/document-types/{id}/aircraft-models
PUT    /api/registry/document-types/{id}/form-types      ordered assignment

GET    /api/registry/form-types
POST   /api/registry/form-types
PATCH  /api/registry/form-types/{id}                     label / banner / structure
DELETE /api/registry/form-types/{id}                     custom only
PUT    /api/registry/form-types/{id}/layout              Form Type Editor save
PUT    /api/registry/form-types/{id}/override
POST   /api/registry/form-types/{id}/template            multipart upload + analysis
POST   /api/registry/form-types/analyze                  analyse without persisting
```

**Documents and data entry**
```
GET    /api/documents
POST   /api/documents                          blank, or from a default
GET    /api/documents/{id}
PATCH  /api/documents/{id}
DELETE /api/documents/{id}

POST   /api/documents/{id}/instances
PATCH  /api/instances/{id}                     name
DELETE /api/instances/{id}
PATCH  /api/instances/{id}/header               partial header field update
POST   /api/instances/{id}/complete
DELETE /api/instances/{id}/complete             mark incomplete
PUT    /api/instances/{id}/overlay-data/{overlayId}
POST   /api/instances/{id}/autofill              automated data entry

POST   /api/instances/{id}/rows                 body carries rowsKey + index
PATCH  /api/rows/{id}
DELETE /api/rows/{id}
PUT    /api/instances/{id}/rows/{rowsKey}/order reorder
```

**Defaults**
```
GET    /api/defaults
POST   /api/defaults                            snapshot a document
DELETE /api/defaults/{id}
```

**Validation and render**
```
POST   /api/validation/uniqueness               cross-document field check
POST   /api/instances/{id}/validate
POST   /api/instances/{id}/render               → application/pdf
POST   /api/documents/{id}/export               → application/pdf (merged)
```

### 7.3 Cross-cutting API conventions

- **Errors:** RFC 7807 `ProblemDetail`, with a `problems[]` extension carrying the same `{kind, location, label, message}` shape the "Cannot mark complete" dialog already renders. The frontend's existing modal binds to it directly.
- **Concurrency:** `If-Match` / `ETag` on mutating document, instance, and row operations, backed by `@Version`. A conflict returns `409` with both versions so the client can surface a meaningful message rather than silently overwriting.
- **Idempotency:** `POST` endpoints that create resources accept an optional `Idempotency-Key`, so a retried request after a network failure does not duplicate a row.
- **Paging:** `GET /api/documents` is paged from the outset. It is unpaged today because the dataset is a proof-of-concept; at real scale it will not be.

---

## 8. Security — LM authentication

Mirrors `SecurityConfig` in `logcards-common/src/main/java/com/lmco/rms/logcards/common/config/SecurityConfig.java`.

### 8.1 Mechanism

- **Primary:** OIDC / OAuth2 JWT resource server, wired through `AuthHttpConfigurer.construct()` from `com.lmco.rms.cf:authentication-sdk:3.7.0`.
- **Fallback:** Active Directory LDAP (`ldaps://us.lmco.com:636`, domain `us.lmco.com`), with authorities derived from group membership.
- **CSRF:** disabled under the `local` profile; `CookieCsrfTokenRepository.withHttpOnlyFalse()` in every other environment, matching what the Angular client will expect in Phase 13.
- **Authorization:** `/api/**` requires authentication; `@EnableMethodSecurity` with `@PreAuthorize` at the service layer.

### 8.2 Configuration keys, per environment

```properties
spring.security.oauth2.resourceserver.jwt.oauth2-client-name = eo-cf-pdfgen-auth-${env}
spring.security.oauth2.oidc.metadata.endpoint                = <per-environment OIDC discovery URL>
spring.security.oauth2.resourceserver.jwt.gc-group-name      = pdfgen.${env}.users
spring.security.oauth2.resourceserver.jwt.timeout.application-jwt-timeout = 15
spring.security.oauth2.resourceserver.jwt.timeout.default-jwt-timeout     = 120

ad.url          = ldaps://us.lmco.com:636
ad.domain       = us.lmco.com
ad.GroupPrefix  = CN=pdfgen.
```

### 8.3 Roles

The current application has an "Admin" checkbox in the header — an in-memory, unchecked-by-default simulation with no enforcement. It becomes a real authority.

| Role | AD group | Grants |
|---|---|---|
| `USER` | `pdfgen.{env}.users` | Create and edit documents, enter data, mark complete, save and apply defaults, preview and export |
| `ADMIN` | `pdfgen.{env}.admins` | All of the above, plus the entire registry: aircraft models, document types, assignment, form types, Structure Builder, Form Type Editor, template upload |

**Action required early.** Request both groups for all six environments through MyAccess in Phase 0. Group provisioning is routinely the long pole in LM environment readiness, and every deployed-environment test is blocked behind it.

### 8.4 Server-side enforcement of guards currently on the client

`canDeleteAircraftModel`, `canDeleteDocumentType`, and `canDeleteFormType` are client-side checks today — a determined caller can bypass them and leave the registry referentially inconsistent. They move into the service layer as the authoritative check, backed by real foreign-key constraints. The client keeps its copies for immediate feedback only.

---

## 9. The two fill engines and the A/B harness

### 9.1 Strategy selection

A `X-Render-Strategy: client | server` request header, a per-user default from configuration, and a visible toggle in the UI. `POST /api/instances/{id}/render` and `POST /api/documents/{id}/export` serve the server path; the existing pdf-lib code path serves the client path unchanged.

### 9.2 What must be ported to PDFBox

| `07` function | Responsibility |
|---|---|
| `getLayout` | Deep-merge saved overrides over `defaultLayout`; self-heal zero-capacity tables |
| `normalizeExtraTable` | Normalize `page1`/`page2`/`maxRows` for every table |
| `buildCoordinateCopies` | Row overflow into physical copies; front/back page capacity; repeated headers |
| `drawStyledField` | Font resolution and embedding, size, bold/italic, wrap versus unclipped overflow |
| `drawOverlays` / `drawOverlayImage` | Fixed and per-instance overlays; PNG/JPEG sniffing by data-URL prefix |
| `formatValueForType` | `toFixed(decimals)`, date reformatting, `maxLength` truncation |
| `parseLenientDate` / `formatDateForOutput` | Lenient multi-format date parsing; single-pass token substitution |
| `mergeCoordinateDocs` / `buildCombinedPdf` | Merge across instances and form types in admin-defined order |
| "Page X of Y" stamp | Drawn only when `page`/`pageOf` are layout-only keys, never when a real extracted field |

### 9.3 The parity harness

**Golden corpus,** captured in Phase 0 from the current client engine, before any Java is written:

- All three built-in form types
- Empty, partially filled, and fully filled instances
- Row counts below, exactly at, and above `maxRows` (exercising physical-copy overflow)
- Multi-table forms (DA 2408-17's Verification and Remarks fixed tables)
- Every overlay mode: fixed image, fixed text, placeholder image, placeholder text, placeholder unfilled
- Every field type and output format: text with `maxLength`, number with `decimals`, all five date formats
- `allowOverflow` true and false
- A custom, template-less form type
- A merged Export All across a multi-form-type document

**Comparison,** on every commit:

1. **Text layer** — PDFBox `PDFTextStripper` against pdf.js `getTextContent()`; exact string and ordering match.
2. **Raster** — PDFBox `PDFRenderer` to PNG at 150 DPI, per-pixel diff against the golden with a configurable tolerance; any region exceeding tolerance is emitted as a diff image CI artefact.
3. **Structural** — page count, page dimensions, embedded font set.

### 9.4 Known hard parts

- **Font metrics.** pdf-lib and PDFBox both provide the standard 14 fonts, but `07`'s wrap algorithm is hand-rolled (`maxWidth` plus `lineHeight`). It must be ported character-for-character, not approximated. This is the most likely source of A/B divergence.
- **AcroForm merge.** `CLAUDE.md` documents this at length: copying pages carries widgets but does not register them in the destination `/AcroForm`, and same-named field trees silently collapse. PDFBox's `PDFMergerUtility` does not solve this for free; the parent-chain rename and `/AcroForm` rebuild must be reimplemented.
- **Date token collision.** `formatDateForOutput` must use a single-pass regex (`/YYYY|YY|MMM|MM|DD|M|D/g` with a replacer, longest alternative first). The sequential-`replace` approach produced `"05 3AR 26"` instead of `"05 MAR 26"`, because a substituted month abbreviation was rescanned by a later token. Do not reintroduce it.
- **Non-two-page templates.** An uploaded custom template is frequently not the two-page front/back shape the built-in types assume. Page index resolution must clamp to the last real page.

### 9.5 Metrics

Micrometer timers on the server (`pdfgen.render.duration`, tagged by form type, strategy, and copy count); `performance.now()` on the client. Both emitted through the existing `logAction` taxonomy so the two are directly comparable in one place.

---

## 10. Container strategy — development, testing, and deployment

### 10.1 Why this is in the plan

The corporate network has repeatedly and expensively broken local environment setup on this project. `CLAUDE.md` documents one instance in detail: `npm install` failing with `ECONNRESET` because `better-sqlite3`'s native postinstall spawns child processes that honour only the `HTTPS_PROXY`/`HTTP_PROXY` *environment variables*, not npm's own `.npmrc` proxy settings. The same class of failure will recur with Gradle, Node, Angular CLI, PDFBox native dependencies, and Testcontainers image pulls.

A container image that has the proxy configuration, the LM certificate authority chain, and the internal repository credentials **already baked in and verified** converts a recurring multi-hour debugging exercise into a single `podman build`. That is the primary justification; reproducibility and CI/local parity are secondary benefits.

Both Docker and Podman are supported. Podman is likely the better default on LM-managed workstations — it is rootless and needs no privileged daemon — so the files are named `Containerfile` (which both tools read) rather than `Dockerfile`, and Podman-specific notes are called out below.

### 10.2 Layout

```
containers/
├── Containerfile.dev          full toolchain: build, test, run
├── Containerfile.runtime      minimal JRE image for deployment
├── compose.yaml               app + postgres (+ optional pgadmin)
├── initdb/
│   └── 01-schema.sql          creates the pdfgen schema and roles
├── certs/
│   └── README.md              how to obtain the LM CA chain (certs not committed)
└── README.md                  quick start, Podman notes, troubleshooting
```

### 10.3 The development image

`Containerfile.dev` contains everything needed to build, test, and run the application:

| Component | Purpose |
|---|---|
| JDK 17 (Temurin) | Toolchain-matched to LogCards |
| Gradle | Via the wrapper; the wrapper distribution URL points at the Nexus mirror |
| Node 20 + npm | Frontend build; Angular CLI in Phase 13 |
| `postgresql-client` | `psql` for inspection and the migration tooling |
| Flyway CLI | Optional — the application runs migrations itself, but useful for `repair` and `info` |
| `git`, `curl`, `jq` | General tooling |

**The parts that actually matter:**

1. **LM certificate authority chain**, imported into three separate trust stores, because each is consulted by a different toolchain:
   - the OS trust store (`update-ca-certificates`) — used by `curl` and native tooling
   - the Java `cacerts` keystore (`keytool -importcert`) — used by Gradle and the JVM
   - `NODE_EXTRA_CA_CERTS` — used by Node and npm

   Certificates themselves are **not committed**. `certs/README.md` documents how to obtain the LM Root CA and chain CA; the build expects them mounted or supplied as a build argument.

2. **Proxy configuration as real environment variables**, not merely tool configuration files:
   ```
   HTTP_PROXY  = http://proxy-zsgov.external.lmco.com:80
   HTTPS_PROXY = http://proxy-zsgov.external.lmco.com:80
   NO_PROXY    = 127.0.0.1,localhost,.lmco.com
   ```
   This is precisely the fix `CLAUDE.md` records for the `better-sqlite3` failure, applied pre-emptively and globally. Child processes inherit environment variables; they do not inherit `.npmrc` or `settings.gradle`.

3. **Internal repository configuration** — `nexus.global.lmco.com` and `lmco-art.us.lmco.com` for Gradle, and the corresponding npm registry mirror. Credentials arrive as environment variables (`EFOSS_PUBLISH_USER`/`PASS`, `ARTIFACTS_USER`/`PASSWORD`), never baked into the image.

4. **Base image from an approved internal registry.** In a GovCloud/ATO context, base images generally may not be pulled from Docker Hub. The concrete registry — an LM Nexus/Artifactory Docker mirror, or Iron Bank (`registry1.dso.mil/ironbank/...`) — **must be confirmed with the platform team in Phase 0**, and may require a hardened or FIPS-validated base.

### 10.4 Compose stack

`compose.yaml` brings up:

- **`db`** — PostgreSQL 16, with `initdb/01-schema.sql` creating the `pdfgen` schema and an application role, a named volume for persistence, and a `pg_isready` health check.
- **`app`** — the development image, source mounted, running with `SPRING_PROFILES_ACTIVE=local`, depending on `db` being healthy.
- **`pgadmin`** *(optional, behind a compose profile)* — for inspecting JSONB columns during development.

Runs identically under `docker compose` and `podman compose`. A `podman kube play` manifest can be generated from the same source if the platform team prefers Kubernetes-shaped artefacts.

### 10.5 Testcontainers, and the Podman wrinkle

The test suite uses Testcontainers with real PostgreSQL (§2.2). Testcontainers expects a Docker-compatible socket, which needs explicit configuration under rootless Podman:

```bash
systemctl --user enable --now podman.socket
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR}/podman/podman.sock"
export TESTCONTAINERS_RYUK_DISABLED=true   # Ryuk's reaper often cannot run rootless
```

The Testcontainers Postgres image must also come from the approved internal registry, configured through `TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX`. `containers/README.md` documents all of this; it is exactly the kind of environment-specific knowledge that is otherwise rediscovered painfully by each developer in turn.

### 10.6 The runtime image

`Containerfile.runtime` is a multi-stage build producing a minimal deployment artefact:

- **Build stage** — the development image, running `./gradlew bootJar`.
- **Runtime stage** — JRE-only base, application installed as **Spring Boot layered jar** layers (dependencies, spring-boot-loader, snapshot dependencies, application) so that a code-only change re-pushes only the final, smallest layer.
- Runs as a **non-root** user with a read-only root filesystem and an explicit writable `tmpfs`.
- `HEALTHCHECK` against `/actuator/health/readiness`.
- Memory configured via `JAVA_TOOL_OPTIONS` with container-aware ergonomics (`-XX:MaxRAMPercentage`), not a fixed `-Xmx`.
- No secrets in the image, no secrets in the environment at build time; runtime configuration arrives from AWS Secrets Manager exactly as it does for LogCards.

### 10.7 CI and deployment posture

**CI.** GitLab CI jobs run *inside the development image*, so the CI environment and the developer environment are the same environment. This removes the "works locally, fails in CI" class of problem entirely, and means proxy and certificate issues are fixed once rather than twice.

**Deployment — an honest caveat.** LogCards deploys a WAR to Tomcat 9 on EC2 via AWS CodeDeploy. There is no container runtime in that path today. A containerized deployment is therefore a **genuine deviation requiring platform approval**, not something this plan can assume. Two paths, both supported by the same build:

1. **Container deployment** *(preferred, requires approval)* — push `Containerfile.runtime` to the approved registry; deploy to whatever container platform is available in GovCloud.
2. **Executable JAR on EC2** *(fallback, no approval needed)* — the same `bootJar`, deployed through the existing CodeDeploy path and run as a systemd service. The container is then used for development, test, and CI only.

The container work is valuable under either outcome, because the development and CI benefit — which is where the recurring pain actually is — does not depend on the deployment decision at all.

---

## 11. Phase plan

| # | Phase | Size | Exit criteria |
|---|---|---|---|
| 0 | **Foundations.** ADR-004 resolved (auth SDK on Spring Security 6). MyAccess groups requested. Container image built and verified through the proxy. Gradle skeleton, Nexus, GitLab CI. **Golden PDF corpus captured from the current client engine.** | S | A developer can clone, `podman compose up`, and reach a running skeleton. Goldens committed. |
| 1 | **API seam.** Extract every `fetch()` in `index.html` behind a single `apiClient` object. No behavioural change; still Express. | S | Zero behaviour change; all network access flows through one module. |
| 2 | **Schema and data migration.** Flyway `V1`. SQLite → Postgres migration tool. | M | Round-trip `/api/bootstrap` output diffs clean against the SQLite original. |
| 3 | **Boot skeleton.** Profiles, Secrets Manager, `ProblemDetail`, OpenAPI, Envers, Actuator, Testcontainers harness, static resource serving. | M | Spring Boot serves `index.html` and `/actuator/health`; OpenAPI published. |
| 4 | **Read API.** `/api/bootstrap` plus the template endpoint and granular `GET`s. Frontend reads cut over via the seam. | M | Both stacks run side by side; reads from Spring Boot, writes still Express. |
| 5 | **Registry writes.** Models, document types, assignment, form types, overrides, layouts. Structure Builder and Form Type Editor saves. Delete-guards moved server-side. | L | All registry mutation flows through Spring Boot; Express registry endpoints dead. |
| 6 | **Documents, instances, rows.** Granular REST, optimistic locking, audit. Frontend sync layer rewritten to a dirty-entity queue. | L | Editing one field of one row issues one small `PATCH`. |
| 7 | **Validation.** Field, instance, mark-complete, and cross-document uniqueness. | M | Server is authoritative; the client copy is advisory only. |
| 8 | **Server fill engine + A/B.** PDFBox port, strategy toggle, parity harness, metrics. | XL | Parity harness green across the full golden corpus. |
| 9 | **PDF upload and analysis, server-side.** AcroForm and vector-text extraction, table clustering. | L | Uploading `A2408_18.pdf` detects its real 14-row front and 15-row back tables. |
| 10 | **Security enforced.** LM auth live; the admin checkbox becomes a real authority. | M | Unauthorized registry writes rejected server-side. |
| 11 | **Automated data entry.** Real integration replacing the simulated modal. | M | The four-stage modal drives a real request. |
| 12 | **Cutover.** Decommission Express; drop `client_ref`. | S | One deployable. |
| 13 | **Angular.** *Separate effort.* Generated client from the Phase 3 OpenAPI specification. | XL | Feature parity with the vanilla frontend. |

**Sequencing notes.** Phase 1 before Phase 4 is what makes everything after it incremental rather than a single high-risk cutover. Phase 0's golden capture must precede Phase 8 by construction — it is captured from code that Phase 12 deletes. Spring Security is wired in Phase 3 but left permissive under `local`; Phase 10 only enforces it.

---

## 12. Testing strategy

| Level | Tooling | Coverage target |
|---|---|---|
| Unit — fill engine | JUnit 5, no Spring context | Every function in §9.2, including the date-token and font-metric edge cases |
| Unit — services | JUnit 5, Mockito | Validation rules, delete-guards, layout merge and self-heal |
| Integration — persistence | Testcontainers PostgreSQL | Row diffing, cascade deletes, JSONB round-trip, optimistic-lock conflicts, Envers revisions |
| Integration — web | `@SpringBootTest` + MockMvc + Spring Security Test | Every endpoint; both roles; `ProblemDetail` shape |
| Parity — PDF | Golden-file harness (§9.3) | Full corpus, every commit |
| Contract | OpenAPI schema validation | Response shapes match the published specification |

**On the starting point.** The current application has no automated tests at all, and its 5,158-line frontend is the specification for everything being built. The golden corpus is therefore not a nice-to-have — it is the only executable statement of correct behaviour that exists. Phase 0 is not optional.

---

## 13. Functionality migration matrix

Every capability of `07-pdfgen-dbnormal`, in the same five-part structure: **Current** → **Target** → **Endpoints and data** → **Tests** → **Acceptance**.

---

### 13.1 Bootstrap and the sync queue

**Current.** `init()` fetches `/api/bootstrap` once and populates everything. `queueSync(key, endpoint, payload)` debounces writes into a keyed queue; `flushSync` sends the whole collection; `flushAllSyncsNow` fires on unload. A "Saved to server / Saving… / Save failed" pill reflects queue state.

**Target.** Bootstrap is retained as a single read — it genuinely is one screenful of state, and splitting it would cost round trips for nothing — but sheds template bytes (§6.2). Writes become a **dirty-entity queue**: the client tracks which entities changed and issues targeted requests, rather than shipping whole collections.

**Endpoints and data.** `GET /api/bootstrap`; per-resource writes throughout §7.2. The pill binds to the new queue's state unchanged.

**Tests.** Bootstrap shape matches the documented contract; queue coalesces rapid edits to one request per entity; failed requests retry with backoff and surface "Save failed"; unload flush completes.

**Acceptance.** Bootstrap payload drops below 100 KB (from roughly 800 KB). Editing one field issues one request naming one entity.

---

### 13.2 Aircraft models

**Current.** A plain string array in `localStorage`-turned-SQLite. Add, inline rename, delete. `canDeleteAircraftModel` checks references client-side. Rename uses inline editing rather than `window.prompt()`, because `prompt()` is stubbed to return `null` in Electron-based renderers including VS Code webviews.

**Target.** `aircraft_model` table. Guards move server-side and are backed by foreign keys. Inline editing retained — it is more robust regardless of environment.

**Endpoints and data.** `GET/POST/PATCH/DELETE /api/registry/aircraft-models[/{name}]`. `ADMIN` only.

**Tests.** Duplicate rejected with `409`; delete of a referenced model rejected with `409` and a `ProblemDetail` naming the referrer; rename cascades to referencing document types.

**Acceptance.** A referenced model cannot be deleted by any caller, including a direct API call bypassing the UI.

---

### 13.3 Document types

**Current.** `{id, name, models[]}`; `models` stored as a JSON array. Add, inline rename, delete, per-model checkboxes. `canDeleteDocumentType` blocks deletion when documents or defaults exist.

**Target.** `document_type` plus the `document_type_aircraft_model` join table (§6.2). The sidebar selector continues to list only document types enabled for the currently selected aircraft model.

**Endpoints and data.** `GET/POST/PATCH/DELETE /api/registry/document-types[/{id}]`; `PUT /api/registry/document-types/{id}/aircraft-models`.

**Tests.** Model association add and remove; delete blocked when documents or defaults exist; selector filtering by model.

**Acceptance.** Referential integrity is enforced by the database, not only by application logic.

---

### 13.4 Document-type → form-type assignment and ordering

**Current.** `documentTypeForms: { [docTypeId]: string[] }` — an ordered list, drag-reorderable in an "Assign & sort form types" panel. Drives sidebar listing and Export All merge order.

**Target.** `document_type_form (document_type_id, form_type_id, position)`, replaced atomically on save.

**Endpoints and data.** `PUT /api/registry/document-types/{id}/form-types` with the full ordered list.

**Tests.** Order round-trips exactly; assignment persists through reordering; assigning a new form type to a document type that already has documents does not break those documents.

**Acceptance.** Export All merges in the admin-defined order. Specifically covers the `07` bug where `addFormInstance` crashed on a form type assigned *after* documents already existed — the array is now created lazily server-side.

---

### 13.5 Form types — built-in, custom, and overrides

**Current.** Three sources: `form_types` (seeded once from `form-types.json`), `custom_form_types` (admin-created), and `form_type_overrides` (label and banner edits layered over either). Built-in types became structurally editable in `05-pdfgen-database`; delete and template-replace remain custom-only.

**Target.** One `form_type` table with a `custom` discriminator (§6.2, change 5), plus `form_type_override`. `form-types.json` remains on disk as an inert one-time seed source for a fresh database.

**Endpoints and data.** `GET/POST/PATCH /api/registry/form-types[/{id}]`; `DELETE` guarded to `custom = true`; `PUT /api/registry/form-types/{id}/override`.

**Tests.** Override layering precedence; delete rejected for a built-in type; delete rejected for a custom type still assigned to any document type; seed runs exactly once against an empty table.

**Acceptance.** Built-in and custom types are structurally editable through identical code paths; only delete and replace-template differ.

---

### 13.6 Structure Builder

**Current.** A modal shared by "+ New form type" and "Edit". Unlimited field groups (pure UI grouping — header keys stay flat) and unlimited tables. The first table with columns becomes the primary growable table (`rowsKey: "rows"`); subsequent tables become fixed-count entries in `defaultLayout.extraTables`. Every table carries **front-page rows, back-page rows, and total rows per instance**, with a "Table shows on" selector seeding a sensible split. Editing round-trips existing `sections` back into the builder, preserving real keys so Save distinguishes existing from new.

**Target.** Server-side reconciliation. The client posts the builder's model; the service reconciles `sections` and `defaultLayout` together — new entries get placeholder positions, removed entries lose theirs, existing entries keep hand-tuned positions.

**Endpoints and data.** `PATCH /api/registry/form-types/{id}` carrying `sections` + `defaultLayout` as JSONB.

**Tests.** Key preservation across an edit round trip; new field receives a placeholder position; existing field retains a hand-tuned position; row-capacity placement selector seeds correctly; **`page`/`pageOf` are carried forward from the prior layout** and not dropped.

**Acceptance.** Explicitly covers the `07` bug where the edit path silently dropped the "Page X of Y" running-stamp keys, because they are layout-only keys that were never real `sections` entries and so were absent from the rebuild.

---

### 13.7 Form Type Editor — position and style

**Current.** A pdf.js-rendered page with draggable, resizable boxes per field, a front/back page tab, and a live properties panel (x, y, width, font family, size, bold, italic, allow overflow). Header fields get a full box; table columns get a row-0 box whose vertical drag adjusts the *whole table's* shared `startY`. A per-column `independentY` redirects vertical drag to that column's own `yOffset`. On-canvas labels render inside the box in the field's own font and size. Saved as a partial override, deep-merged over `defaultLayout` by `getLayout`.

**Target.** Unchanged behaviour; the layout persists to `form_type_layout` as JSONB, and `getLayout`'s merge semantics move server-side so both fill engines resolve layouts identically. Merge rules preserved exactly: header and column entries deep-merge per key; **`overlays` is a full replace**, so removing an overlay actually removes it; zero-capacity tables self-heal at read time.

**Endpoints and data.** `PUT /api/registry/form-types/{id}/layout`.

**Tests.** Deep-merge leaves untouched fields at their defaults; overlay list replacement including the empty-list case; `yOffset` honoured in editor box positions as well as in fill output; `independentY` toggled off resets `yOffset` to zero; zero-capacity self-heal.

**Acceptance.** A save that touches one field leaves every other field byte-identical.

---

### 13.8 Field type and output formatting

**Current.** Per-field `validation` carries `type` (text/number/date), `maxLength`, `decimals`, and `dateFormat` (one of: as-entered, `M-D-YY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `DD MMM YY`). Purely a print-time concern — the stored value is never rewritten. `formatValueForType` applies it at fill time.

**Target.** Identical semantics, implemented once in `pdfgen-render-service` and consumed by both engines.

**Endpoints and data.** Part of the form-type schema JSONB.

**Tests.** Every date format, including the `"DD MMM YY"` → `"05 MAR 26"` case that the sequential-`replace` implementation corrupted to `"05 3AR 26"`; `decimals` rounding; `maxLength` truncation applied regardless of value origin (typed, sample data, saved default, import).

**Acceptance.** Stored values are never mutated by formatting. Both engines produce byte-identical formatted output.

---

### 13.9 Overlays — images and text

**Current.** Admin-placed overlays on a form type, in two modes. `mode: "fixed"` bakes content into the form type, identical on every instance. `mode: "placeholder"` reserves position only; content comes per-instance from a "Signature & attachments" card. Images are `FileReader.readAsDataURL()` strings, sniffed by `data:` prefix to choose `embedPng` versus `embedJpg`. Image overlays carry an explicit height and a second bottom-edge drag handle. Toggling the mode clears stale fixed content. Overlays repeat on every physical copy. An unfilled placeholder is skipped, not a validation error.

**Target.** Behaviour preserved. **Image bytes move to `BYTEA`** rather than base64 inside JSON — the same reasoning as templates (§6.2). Overlay definitions stay in the layout JSONB and reference the binary by id.

**Endpoints and data.** Definitions via `PUT .../layout`; binaries via a dedicated multipart endpoint; per-instance content via `PUT /api/instances/{id}/overlay-data/{overlayId}`.

**Tests.** Fixed versus placeholder rendering; mode toggle clears content; PNG and JPEG both embed correctly; unfilled placeholder skipped; overlay repeats on every physical copy; `overlayData` resets to empty on clone.

**Acceptance.** No base64 image data crosses the wire in either direction.

---

### 13.10 PDF upload, classification, and extraction

**Current.** `classifyAndExtractPdf` returns `{headerCandidates, tableCandidates, finalBytes}` by mechanical classification — no AI:
1. **Real AcroForm fields** → each text field's first widget rectangle used directly; non-text kinds skipped; form then flattened. Table columns detected by a **consecutive `_0`, `_1`, `_2` … base-name run** (LiveCycle's convention — *not* the `[n]` widget-array index, which is a constant and was an early red herring); `clusterColumnsIntoTables` merges columns sharing a page, row count, and grid.
2. **No fields but a real text layer** → items clustered into lines by y-position; an item ending in `:` is a label, and the blank space to its right becomes its field box. Table detection looks for ≥3 consecutive lines whose item x-positions align.
3. **Neither (a genuine scan)** → zero candidates, but the page still becomes the template so fields can be placed by hand against a real background.

Font sizes derived from widget rectangles are **clamped to 6–12 pt with the baseline centred**, because a form cell's box height is routinely far larger than its text.

**Target.** Ported to PDFBox in `pdfgen-render-service`. Upload to an existing custom type stays additive — new fields land in a reused "Extracted fields" section with key collisions deduped.

**Endpoints and data.** `POST /api/registry/form-types/{id}/template` (multipart); `POST /api/registry/form-types/analyze` to preview without persisting.

**Tests.** `reference-acroform/A2408_18.pdf` yields its real 14-row front and 15-row back tables, not 29 flat fields. `reference-acroform/A2408_17.pdf` yields its three tables. A `reference-plain/` file yields header candidates but **no** tables — the documented and expected limitation, since a blank template's data rows are vector line drawings invisible to text extraction. A scanned page yields zero candidates and a valid template.

**Acceptance.** Extraction results match the current implementation on the full reference corpus.

---

### 13.11 Documents

**Current.** Created blank or from a saved default, scoped to one aircraft model and one document type. `emptyLogbookForms` seeds one array per assigned form type at creation time. Listed, opened, deleted. Internally still called `logbooks`.

**Target.** `document` table, audited, `@Version`. Form instance arrays are no longer seeded at creation — instances are created on demand, which is what fixed the `07` crash when a form type was assigned after documents already existed.

**Endpoints and data.** `GET/POST/PATCH/DELETE /api/documents[/{id}]`, paged listing.

**Tests.** Blank creation; creation from a default deep-copies rather than links; delete cascades to instances and rows; a form type assigned after creation is usable immediately.

**Acceptance.** Creating a document from a default produces a fully independent copy, with `complete` and `overlayData` reset but instance `name` preserved.

---

### 13.12 Form instances

**Current.** Multiple instances per form type per document. Add, delete (blocked below one per type), inline rename with a hover pencil, per-form-type collapse in the sidebar. `instanceLabel` prefers a set name, falling back to `"<type> — Instance N"`. Unlike `complete` and `overlayData`, **`name` is carried over by `cloneInstance`** — it is an organizational label ("Left engine"), not review state.

**Target.** `form_instance` table, audited. Collapse state stays client-side and in-memory — it is view state, not data.

**Endpoints and data.** `POST /api/documents/{id}/instances`; `PATCH /api/instances/{id}`; `DELETE /api/instances/{id}`.

**Tests.** Multiple instances per type; delete blocked at one remaining; rename persists; clone preserves `name` but resets `complete` and `overlayData`.

**Acceptance.** Clone semantics match §18/§19 of `history.md` exactly.

---

### 13.13 Data entry — header fields and tables

**Current.** Generic schema-driven rendering: a "fields" section (labelled grid, bound via `:value`/`@input` because Alpine's `x-model` needs a static path) and a "table" section (repeating rows, data-driven columns). Rows support add, remove, duplicate, and drag-reorder — all suppressed for `fixedRows` tables. Each table header shows live front/back/total capacity via `tableCapacityLabel()`, read from the resolved layout rather than the raw schema.

**Target.** Rendering is unchanged. Persistence becomes granular: one `PATCH` per changed row.

**Endpoints and data.** `PATCH /api/instances/{id}/header`; `POST /api/instances/{id}/rows`; `PATCH /api/rows/{id}`; `DELETE /api/rows/{id}`; `PUT /api/instances/{id}/rows/{rowsKey}/order`.

**Tests.** Add, remove, duplicate, reorder; fixed tables reject structural changes at the API level, not only in the UI; capacity label reflects a saved layout override; **the `x-for` key over `schema.sections` is `activeFormType + ':' + index`** — unique within a schema and distinct across schemas.

**Acceptance.** Editing one field of one row in a 500-row table writes exactly one row. This is the direct end-to-end realization of the `07` normalization work, which previously stopped at the server boundary.

**Two documented failure modes this section must not regress:**
- A duplicate `x-for` `:key` breaks reactivity for the *entire page*, not just the offending list. `section.title` is not unique (auto-detected tables share a default title) and a bare index is not schema-specific.
- Switching the active form type writes `activeFormType` and `activeInstanceId` in two separate reactive operations, so for one tick the outgoing schema is evaluated against the incoming instance. Reads of `activeInstance[section.rowsKey]` must stay defensively guarded.

---

### 13.14 Validation

**Current.** `validation` per header field and table column (`required`, `type`, `minLength`, `maxLength`). Live per-field feedback via red border and `title` tooltip, recomputed every render. Required fields get a red asterisk. `validateInstance` walks everything and returns `{kind, location, label, message}` problems, where `kind` distinguishes **Pending** (required, empty) from **Incorrect** (present but malformed). Date validation is deliberately lenient — `looksLikeDate()` accepts army-style (`15 MAR 26`), ISO, and slash formats by regex, because a strict parse would reject legitimate project data.

**Target.** The server becomes authoritative; the client keeps its copy for immediate feedback only. Problem objects serialize into the `ProblemDetail` `problems[]` extension, so the existing "Cannot mark complete" modal binds without modification.

**Endpoints and data.** `POST /api/instances/{id}/validate`; also enforced within the complete transition.

**Tests.** Every rule; `kind` classification; **date leniency across all three accepted formats**; multi-table location prefixing (`"5. Verification — Row 2"` only when a schema has more than one table, so single-table wording is byte-for-byte unchanged).

**Acceptance.** Client and server produce identical problem lists for identical input.

---

### 13.15 Cross-document uniqueness

**Current.** **Not implemented.** `CLAUDE.md` identifies it as unresolvable client-side, since another in-flight edit could collide with a purely local check.

**Target.** A field's schema may declare `uniqueScope: "documentType+aircraftModel"`. Enforced at three levels: a partial unique index on the extracted value; a service-layer check; and an on-blur advisory endpoint for immediate feedback.

**Endpoints and data.** `POST /api/validation/uniqueness` with `{formTypeId, fieldKey, value, excludeInstanceId}`.

**Tests.** Collision detected within scope; the same value permitted in a different aircraft model or document type; concurrent inserts of the same value — one succeeds, one gets `409`.

**Acceptance.** Checked on blur for feedback and again inside the mark-complete transaction for correctness. The blur check is advisory; the database constraint is authoritative.

---

### 13.16 Defaults

**Current.** A saved snapshot of a whole document — every form type it contains — scoped to a document type, not global. A document type may have several. Applying one prefills the entire document; values remain fully editable and the new document is independent from creation.

**Target.** `form_default` and `form_default_instance`, retaining the single-JSONB-blob-per-instance shape. Deliberately **not** row-normalized (§6.3).

**Endpoints and data.** `GET/POST/DELETE /api/defaults[/{id}]`.

**Tests.** Snapshot captures every instance of every form type; apply produces independent copies; `complete` and `overlayData` reset while `name` is preserved; multiple defaults per document type.

**Acceptance.** A document created from a default is byte-identical to the snapshot except for ids, timestamps, `complete`, and `overlayData`.

---

### 13.17 Undo / redo

**Current.** Per-document, in-memory only, keyed by document id so switching documents does not mix histories. Snapshots taken before every structural change and on `@focus` of any text input — the latter groups an entire field edit into one undo step rather than one per keystroke. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, ignored while focus is inside an input so it does not fight the browser's native per-field undo. Restoring re-points `activeInstanceId` if the open instance no longer exists.

**Target.** **Unchanged — stays entirely client-side.** Undo history is ephemeral view state; persisting deep-cloned snapshots server-side would add storage and complexity for behaviour users do not expect across sessions. This is a deliberate non-migration.

**Tests.** Existing behaviour preserved after the sync layer rewrite — in particular, undo must issue the corresponding server writes for whatever it restores.

**Acceptance.** Undo after the Phase 6 rewrite persists correctly rather than silently diverging from the server.

---

### 13.18 Preview

**Current.** A resizable panel rendering pdf.js canvases. Chosen over an iframe specifically because mobile browsers do not render PDFs inline. "Open PDF" hands over a real blob URL in a new tab rather than triggering a download dialog. A styling or layout change deliberately invalidates the rendered preview rather than leaving stale output on screen. The standalone image-snapshot "Print" button was removed in `04-pdfgen-vanilla` as not useful.

**Target.** Unchanged rendering. Under the server strategy, the bytes come from `POST /api/instances/{id}/render`; under the client strategy, from pdf-lib as today.

**Endpoints and data.** `POST /api/instances/{id}/render` → `application/pdf`.

**Tests.** Preview renders under both strategies; a layout change invalidates it; pop-up blocking is detected and surfaced.

**Acceptance.** Preview output is visually identical under both strategies.

---

### 13.19 Export All

**Current.** Iterates the current document's document type's assigned form types in admin order, skipping any with no template, merges every instance into one PDF, renders it into the preview, and opens it in a new tab. `buildCopiesGeneric` returns unmerged per-copy documents so the merge happens once globally rather than merging per instance and then merging the results again.

**Target.** Identical semantics server-side, with the same single-pass merge. The AcroForm merge hazard (§9.4) applies to the merge routine.

**Endpoints and data.** `POST /api/documents/{id}/export` → `application/pdf`.

**Tests.** Merge order matches admin assignment; template-less types skipped silently rather than erroring; a document with no assigned types and a document with no templates both produce clear messages; merged output preserves independent values across instances sharing a template.

**Acceptance.** Byte-comparable to the client engine's merged output within the parity harness tolerance.

---

### 13.20 Automated data entry

**Current.** A **simulation.** A modal steps through four stages (request → response → parsing → data entry) as animated checklist items, then populates the active instance from the schema's own `sampleData()`. No request is made. `runAutomateWorkflow` only replaces a table's rows if `sampleData` supplies that `rowsKey`, so a fixed-count table with no corresponding entry keeps its pre-seeded empty rows.

**Target.** A real integration. The four-stage modal shell is retained — it is a good progress affordance — but each stage reflects real work: an outbound call, response mapping through a per-form-type field map, validation, then application.

**Design note.** LogCards' precedent for external integration is the Solumina service: Quartz-scheduled Spring Batch with a reader / processor / writer pipeline, pulling inbound from an external system. If PDF-gen's automated entry turns out to be **user-triggered and synchronous**, a `RestClient` with Resilience4j (timeout, retry, circuit breaker) is the better fit and the Solumina precedent does not apply. If it is **scheduled and bulk**, follow Solumina. **This requires the actual source system to be identified before Phase 11** — it is currently unspecified.

**Endpoints and data.** `POST /api/instances/{id}/autofill`; the mapping stored per form type.

**Tests.** Mapping applied correctly; malformed and missing upstream data rejected before reaching the data model; a fixed-count table without mapped data keeps its empty rows; upstream timeout surfaces a usable error.

**Acceptance.** The modal drives real work. Invalid upstream data never reaches the PDF.

---

### 13.21 Logging and observability

**Current.** `logAction(category, action, details)` on both client and server, with a shared category taxonomy (`APP`, `SYNC`, `DOC`, `FORM`, `ROW`, `EXPORT`, `EDITOR`, `ADMIN`, `AUTOFILL`, `UNDO`, `DEFAULT`, `REQUEST`, `RESPONSE`) and aligned columns — CSS `%c` in the browser, ANSI in Node.

**Target.** The taxonomy is preserved as an MDC field so the two sides remain correlatable. SLF4J/Logback with structured JSON in deployed environments. Actuator plus Micrometer for metrics, including the A/B render timers (§9.5).

**Endpoints and data.** `/actuator/health`, `/actuator/metrics`, `/actuator/prometheus`.

**Tests.** Category appears in structured output; request correlation id propagates from client through server logs.

**Acceptance.** A single user action is traceable end to end across both sides in one query.

---

### 13.22 Admin role and registry access

**Current.** A header checkbox — in-memory, unchecked by default, no enforcement — reveals three sidebar panels (Aircraft models, Document types, Form types).

**Target.** A real authority from AD group membership (§8.3). The checkbox is replaced by the authenticated user's actual role; the panels render only for `ADMIN`, and every registry write is enforced with `@PreAuthorize` regardless of what the UI shows.

**Endpoints and data.** All `/api/registry/**` writes.

**Tests.** A `USER` receives `403` on every registry write, including direct API calls; an `ADMIN` succeeds; an unauthenticated caller receives `401`.

**Acceptance.** Registry mutation is impossible without the `ADMIN` authority, by any route.

---

## 14. Frontend

**Phase 1 through 12 — vanilla.** `index.html` is retained and served by Spring Boot as a static resource. Two changes: the `apiClient` seam (Phase 1) and the sync-layer rewrite (Phase 6). The CDN-loaded libraries (Alpine, pdf-lib, pdf.js) should move to locally-served copies during Phase 3 — CDN access from GovCloud is unlikely to be permitted, and this is cheap to do early rather than discover late.

**Phase 13 — Angular.** A separate effort, against a stable and documented API.

The house pattern to follow is `logcards-ui/src/app/logcards/section-list/section-list.component`, which is already a schema-driven dynamic form renderer: it switches on field type to select the input control, and handles repeating rows through a multiplicity index. This is structurally the same problem PDF-gen's generic renderer solves, and it materially reduces the risk of the Angular phase — the pattern is proven in-house rather than invented.

Angular 16+ with Angular Material, NgModules, and an HTTP interceptor for auth and errors, per LogCards. The TypeScript client is generated from the Phase 3 OpenAPI specification.

---

## 15. Risks

### 15.1 No test coverage exists today — **highest**
5,158 lines of untested JavaScript are the specification for everything being built. **Mitigation:** the Phase 0 golden corpus, captured before any Java is written, from code that Phase 12 deletes. This is the single most important item in the plan.

### 15.2 Auth SDK / Spring Security 6 compatibility — **blocking**
Unverified, and it determines the Spring Boot version, which determines the deployment model. **Mitigation:** resolve in Phase 0 with the platform team; fallback documented in ADR-004.

### 15.3 Font metric divergence between engines — **high**
pdf-lib and PDFBox both provide the standard 14 fonts, but `07`'s wrap algorithm is hand-rolled. **Mitigation:** port character-for-character; the raster diff in the parity harness catches drift that a text-layer comparison would not.

### 15.4 AcroForm merge — **high**
Documented as recurring across libraries. `PDFMergerUtility` does not solve it. **Mitigation:** budget it explicitly in Phase 8; do not assume a library change resolves it.

### 15.5 Corporate network and repository access — **medium, certain to occur**
Gradle, Node, Testcontainers image pulls, and PDFBox dependencies will all hit the proxy and certificate issues already documented for `better-sqlite3`. **Mitigation:** §10 — resolve once, in an image, in Phase 0.

### 15.6 MyAccess group provisioning lead time — **medium**
Every deployed-environment test is blocked behind it. **Mitigation:** request in Phase 0, week one.

### 15.7 Container deployment approval — **medium**
Not an established pattern in this environment. **Mitigation:** the executable-JAR fallback (§10.7) requires no approval, and the development and CI benefit is unaffected either way.

### 15.8 Dual-engine maintenance — **medium**
**Mitigation:** ADR-003's sunset criterion, agreed before Phase 8 begins.

### 15.9 Automated data entry source is unspecified — **medium**
Phase 11 cannot be estimated until the upstream system is named (§13.20).

---

## 16. Open decisions

| # | Decision | Owner | Needed by |
|---|---|---|---|
| 1 | Spring Boot 3 + JAR, or Boot 2.7 + WAR (ADR-004) | Platform team + architecture | **Phase 0 — blocking** |
| 2 | Does `authentication-sdk` 3.7.0 support Spring Security 6? | Platform team | **Phase 0 — blocking** |
| 3 | Approved container base image registry and hardening requirement | Platform / security | Phase 0 |
| 4 | Container deployment, or executable JAR via existing CodeDeploy | Platform team | Phase 3 |
| 5 | MyAccess group names and provisioning | Requesting engineer | Phase 0 |
| 6 | Automated data entry — what is the upstream source system? | Product | Phase 11 |
| 7 | A/B sunset criterion — exact threshold and duration | Product + engineering | Before Phase 8 |
| 8 | Is Angular (Phase 13) funded as part of this effort or separately? | Management | Phase 12 |

---

## 17. Appendix A — endpoint mapping, current to target

| Current | Target |
|---|---|
| `GET /api/bootstrap` | `GET /api/bootstrap` *(template bytes removed)* |
| `PUT /api/documents` | `POST/PATCH/DELETE /api/documents[/{id}]`, `/instances`, `/rows` |
| `PUT /api/defaults` | `GET/POST/DELETE /api/defaults[/{id}]` |
| `PUT /api/field-layouts` | `PUT /api/registry/form-types/{id}/layout` |
| `PUT /api/registry/aircraft-models` | `GET/POST/PATCH/DELETE /api/registry/aircraft-models[/{name}]` |
| `PUT /api/registry/document-types` | `GET/POST/PATCH/DELETE /api/registry/document-types[/{id}]` |
| `PUT /api/registry/document-type-forms` | `PUT /api/registry/document-types/{id}/form-types` |
| `PUT /api/registry/form-types` | `GET/POST/PATCH /api/registry/form-types[/{id}]` |
| `PUT /api/registry/custom-form-types` | *(merged into the above)* |
| `PUT /api/registry/form-type-overrides` | `PUT /api/registry/form-types/{id}/override` |
| — | `GET /api/form-types/{id}/template` |
| — | `POST /api/registry/form-types/{id}/template`, `/analyze` |
| — | `POST /api/instances/{id}/render`, `POST /api/documents/{id}/export` |
| — | `POST /api/validation/uniqueness`, `POST /api/instances/{id}/validate` |
| — | `POST /api/instances/{id}/autofill` |

---

## 18. Appendix B — source material

**Application being reimplemented**
- `07-pdfgen-dbnormal/index.html` — 5,158 lines; the complete frontend and fill engine
- `07-pdfgen-dbnormal/server/server.js` — 442 lines; API and row-diffing write path
- `07-pdfgen-dbnormal/server/db.js` — 160 lines; schema and seed
- `07-pdfgen-dbnormal/form-types.json` — inert after first boot; retained as a reseed source

**Project documentation**
- `CLAUDE.md` — architecture, design decisions, and documented failure modes
- `history.md` — chronological account, including the incidents referenced throughout §13

**Architecture reference (not migrated)**
- `C:\ARCHIVE\Logcards-V2\logcards-ng` — LogCards v2.8.0
- `logcards-common/.../config/SecurityConfig.java` — the auth pattern replicated in §8
- `logcards-ui/src/app/logcards/section-list/` — the dynamic renderer pattern for Phase 13
- `build.gradle`, `gradle.properties`, `settings.gradle` — build, proxy, and module conventions
- `.gitlab-ci.yml` — CI and CodeDeploy pipeline shape

**Reference PDFs**
- `reference-acroform/` — 14 forms with AcroForm fields intact; drives extraction tests
- `reference-plain/` — the same 14, flattened; drives coordinate-path tests
