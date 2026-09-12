# PDF-gen Spring Enterprise Architecture Assessment

**Assessment date:** September 11, 2026  
**Application reviewed:** `pdfgen-spring`

## Executive assessment

This is a well-considered proof of concept, but it is not yet production-ready enterprise software.

The technical foundation—Spring Boot, PostgreSQL, Flyway, JDBC, transactions, and optimistic locking—is reasonable. The main problem is not the choice of Spring or JDBC. It is that prototype-era responsibilities remain concentrated in a few very large components, while security, validation, data ownership, scalability, and automated testing are incomplete.

| Area | Assessment |
| --- | --- |
| Framework choice | Sound, but the version is overdue for migration |
| Backend structure | Functional compatibility layer, not maintainable enterprise architecture |
| Frontend structure | Major maintainability bottleneck |
| Database design | Promising start, but insufficient integrity and history controls |
| Scalability | Suitable for small datasets and limited concurrent users |
| Security | Production blocker |
| Testing and operations | Production blocker |

## 1. Framework and architectural design

### What is good

- Spring MVC with synchronous JDBC is appropriate for this workload. There is no reason to introduce reactive programming or JPA merely for architectural fashion.
- PostgreSQL and Flyway are strong enterprise choices.
- Transactions are used around mutations.
- Repeating rows are normalized rather than rewriting an entire form JSON document.
- The document version and `If-Match` mechanism are good foundations for concurrency control.
- SQL is parameterized.
- PDF templates are stored separately from schema JSON and loaded lazily.
- The application is currently stateless at the Java tier, so horizontal application scaling is theoretically possible.

### Framework concern

The application uses Spring Boot 2.7.18. That was the final open-source Spring Boot 2.x release, and Spring recommends upgrading to Boot 3. Commercial 2.7 support was extended only through the end of 2026.

A conservative enterprise migration target is the latest Spring Boot 3.5.x release rather than jumping directly from 2.7 to Boot 4. Java 17 can remain, but Tomcat must move from 9 to 10.1 and the Gradle wrapper must be upgraded from 7.5.1.

Official references:

- [Spring Boot 2.7.18 announcement](https://spring.io/blog/2023/11/23/spring-boot-2-7-18-available-now/)
- [Spring Boot 2.7 support extension](https://spring.io/blog/2024/09/27/spring-boot-2-7-support-period-extended/)
- [Spring Boot 3.5 system requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html)

### Backend concerns

The backend is effectively a transaction script. `PdfgenDataService` is 629 lines and handles documents, rows, form types, defaults, registry data, settings, seeding, mapping, serialization, audit fields, and SQL.

Controllers accept untyped `JsonNode` payloads, so Spring validation is mostly bypassed. Raw `Map<String,Object>` responses make API changes difficult to detect at compile time. All code occupies one package, with no enforceable domain boundaries.

This is acceptable as a migration bridge, but it will become increasingly fragile.

### Critical integrity defects

Two upserts can move data between aggregates:

- The instance upsert changes `document_id` when an instance ID already exists.
- The row upsert changes `instance_id` when a row ID already exists.

An existing ID must never be re-parented unless that is an explicit, authorized domain operation. The conflict update should include the expected parent or reject the request.

### Security concerns

The local security configuration intentionally permits everything, which is acceptable locally. However:

- There is no complete production security configuration.
- The OAuth resource-server dependency is present but unused.
- The Admin checkbox is only client-side state.
- Only application configuration checks `mayAdminister()`. Registry, form-type, defaults, and layout mutation routes have no server-side admin authorization.
- There is no visible tenant or record-level access control.
- Database credentials have usable fallback defaults in the base application configuration.

These are production blockers.

### Scalability concerns

`GET /api/bootstrap` loads every document, every form instance, and every repeating row into one response and one browser state. That creates startup time, memory consumption, and network transfer proportional to the total database size. It is the primary scaling wall.

Several configuration APIs also delete and recreate whole tables. Those operations permit lost updates and do not scale with multiple administrators.

### Frontend concerns

The single `index.html` is approximately 6,546 lines and 346 KB. It contains UI, state management, persistence, validation, PDF rendering, OCR, importing, layout editing, and administration.

The autosave implementation has a reliability mismatch:

- The UI says “Save failed – retrying.”
- The failure handler records an error but does not schedule a retry.
- Failed state snapshots are advanced before persistence succeeds.
- Page-hide flushing sends requests concurrently with versions that may already be stale.
- Once a document conflicts, later synchronization for it is suppressed until reload.

This can produce unsaved or confusing client state.

## 2. Recommended future structure

Keep this as a modular monolith. Microservices would add operational cost without solving the current problems.

A domain-oriented Spring structure would look like:

```text
com.lmco.rms.pdfgen
├── document
│   ├── api             Controllers and request/response DTOs
│   ├── application     Commands, queries and transaction boundaries
│   ├── domain          Document, instance, row and version rules
│   └── persistence     JDBC repositories and row mappers
├── formtype
│   ├── api
│   ├── application
│   ├── domain
│   └── persistence
├── registry
├── defaults
├── settings
├── security
├── configuration
├── observability
└── shared
    └── problem         API error contract
```

Recommended component rules:

- Controllers handle HTTP only.
- Typed DTO records define the API contract and carry Jakarta Validation annotations.
- Application services define transactions and authorization-sensitive use cases.
- Domain objects enforce invariants such as ownership, completion, archive state, and allowed transitions.
- Repository classes contain SQL and mapping only.
- Cross-module access goes through application interfaces, not another module’s repository.
- Add ArchUnit or Spring Modulith tests to enforce these boundaries.

For the frontend, retain Alpine initially but extract ES or TypeScript modules:

```text
frontend/
├── api/
├── features/documents/
├── features/form-types/
├── features/pdf-editor/
├── features/import/
├── state/
├── workers/ocr/
├── shared/
└── styles/
```

PDF generation and OCR should run in Web Workers so large documents do not freeze the UI. A move to React or Vue can be evaluated later; splitting responsibilities is more important than changing frameworks.

## 3. Changes that should be implemented

### Priority 0 — before production

1. Implement OIDC or JWT authentication and server-side authorization for every mutation.
2. Add record or tenant ownership predicates to every database read and write.
3. Fix instance and row upserts so IDs cannot be re-parented.
4. Introduce typed requests with server-side validation, payload limits, PDF signature and type validation, and schema validation.
5. Replace the bootstrap document load with paginated document-summary search, a separate document-detail endpoint, and independently cached registry and configuration endpoints.
6. Fix autosave with explicit retry and backoff, durable pending state, reconciliation after conflict, and accurate UI status.
7. Establish PostgreSQL integration tests using Testcontainers, MockMvc security and API tests, and Playwright end-to-end PDF workflows.
8. Add production secret management, HTTPS and proxy configuration, backups, restore testing, and audit logging.

### Priority 1 — architectural foundation

1. Upgrade to Spring Boot 3.5.x, Spring Security 6, Tomcat 10.1, and a supported Gradle 8 release.
2. Split `PdfgenDataService` into domain-specific application services and JDBC repositories.
3. Replace `JsonNode` and raw maps at the HTTP boundary with versioned DTOs.
4. Replace collection-wide registry updates with individual create, update, and delete operations with concurrency control.
5. Move seeding out of `GET /bootstrap`; use idempotent migration or startup initialization.
6. Strengthen the database schema with `TIMESTAMPTZ`, server-generated identifiers, constraints, foreign keys, unique row positions, and explicit schema and template revisions.
7. Version form schemas and templates. Each document instance should reference the exact form revision used to create it; otherwise editing a form type can change how historical documents render.
8. Separate the frontend into testable modules and add a managed dependency manifest for vendored JavaScript and WASM assets.

### Priority 2 — scale and operations

- Add Micrometer metrics, tracing, structured logs, correlation IDs, readiness checks, and alerting.
- Store template checksums instead of recalculating SHA-256 after loading every blob.
- Move large templates or generated artifacts to object storage if volume warrants it.
- Introduce asynchronous jobs only for genuinely long-running generation or OCR workflows.
- Add load tests and define measurable limits for document count, rows per form, concurrent editors, PDF size, preview latency, and export time.
- Prefer an executable Spring Boot container unless an external Tomcat WAR is an organizational requirement.

## Bottom line

The correct direction is a secured, domain-modular Spring monolith with a paginated API and a modular frontend—not microservices.

The immediate business risks are unauthorized administration, cross-document ID re-parenting, unreliable autosave, unbounded bootstrap loading, and absence of meaningful automated tests. Framework upgrading and code organization should follow closely, but reorganizing packages alone will not address those risks.

This assessment reflects the working tree reviewed on September 11, 2026, including the V6 through V8 migrations and the new security and error-handling classes. No application source files were changed as part of the assessment.

The Java test suite could not be executed because Java was not installed locally and the Docker daemon was stopped. At review time, the repository contained only a `contextLoads()` test.
