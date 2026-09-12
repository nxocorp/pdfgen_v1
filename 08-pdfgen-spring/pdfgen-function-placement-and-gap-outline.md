# PDF-gen Function Placement and Implementation Gap Outline

**Status:** Proposed target design  
**Date:** September 11, 2026  
**Source reviewed:** Current `pdfgen-spring` working tree

## Purpose

This document maps the currently implemented Java and significant browser functions into the proposed modular-monolith package structure. It also identifies functions that must be added for production readiness.

The intent is not to move `PdfgenDataService` into a different directory unchanged. Many of its methods currently combine HTTP assumptions, use-case orchestration, business rules, SQL, JSON conversion, and audit behavior. Those responsibilities should be separated.

## Placement rule

| Layer | It owns | It must not own |
| --- | --- | --- |
| `api` | HTTP routes, headers, status codes, request/response DTOs, API validation | SQL, business decisions, transaction orchestration |
| `application` | Use cases, commands/queries, authorization calls, transaction boundaries, coordination | HTTP types, raw SQL, framework-specific domain rules |
| `domain` | Business state, invariants, policies, value objects, domain events | Controllers, `JdbcTemplate`, JSON wire shapes |
| `persistence` | SQL, database records, row mappers, repository implementations, optimistic update statements | HTTP responses, UI rules, authorization decisions |

Dependencies should point inward:

```text
api -> application -> domain
                 -> repository interfaces
persistence -> repository interfaces + domain
```

The application layer owns transactions because a business operation may use multiple repositories. A repository should not decide whether the caller is authorized; it should require the application service to pass the authorized scope and should enforce that scope in its SQL predicate.

---

# Proposed package tree

```text
com.lmco.rms.pdfgen
├── PdfgenApplication.java
├── document
│   ├── api
│   │   ├── DocumentController.java
│   │   ├── FormInstanceController.java
│   │   ├── FormRowController.java
│   │   ├── DocumentRequest.java
│   │   ├── DocumentResponse.java
│   │   └── DocumentApiMapper.java
│   ├── application
│   │   ├── DocumentCommandService.java
│   │   ├── DocumentQueryService.java
│   │   ├── FormInstanceService.java
│   │   ├── FormRowService.java
│   │   ├── DocumentImportService.java
│   │   └── commands and queries
│   ├── domain
│   │   ├── Document.java
│   │   ├── FormInstance.java
│   │   ├── FormRow.java
│   │   ├── DocumentId.java
│   │   ├── DocumentVersion.java
│   │   ├── DocumentStatus.java
│   │   ├── DocumentPolicy.java
│   │   └── document exceptions/events
│   └── persistence
│       ├── DocumentRepository.java
│       ├── JdbcDocumentRepository.java
│       ├── JdbcFormInstanceRepository.java
│       ├── JdbcFormRowRepository.java
│       ├── DocumentAggregateReader.java
│       └── database row mappers
├── formtype
│   ├── api
│   ├── application
│   ├── domain
│   └── persistence
├── registry
│   ├── api
│   ├── application
│   ├── domain
│   └── persistence
├── defaults
│   ├── api
│   ├── application
│   ├── domain
│   └── persistence
├── settings
│   ├── api
│   ├── application
│   ├── domain
│   └── persistence
├── security
│   ├── SecurityConfiguration.java
│   ├── LocalSecurityConfiguration.java
│   ├── CurrentPrincipal.java
│   ├── AuthorizationService.java
│   ├── Roles.java
│   └── TenantScope.java
├── configuration
│   ├── ApplicationProperties.java
│   ├── DatabaseConfiguration.java
│   ├── JacksonConfiguration.java
│   ├── TimeConfiguration.java
│   └── OpenApiConfiguration.java
├── observability
│   ├── CorrelationIdFilter.java
│   ├── AuditEventPublisher.java
│   ├── ApplicationMetrics.java
│   └── dependency health indicators
└── shared
    ├── problem
    │   ├── ApiProblemHandler.java
    │   ├── ProblemCode.java
    │   └── ValidationProblem.java
    ├── json
    │   └── JsonbMapper.java
    ├── paging
    │   └── PageResponse.java
    └── compatibility
        └── LegacyBootstrapController.java
```

`shared` must stay small. If a shared class contains business vocabulary such as document, form, aircraft, or template, it probably belongs to that business module.

---

# 1. Current controller method placement

Current source: `PdfgenApiController`.

## `document.api`

| Current method | Target | Resulting responsibility |
| --- | --- | --- |
| `document(...)` | `DocumentController.createDocument` and `DocumentController.replaceDocumentCompatibility` | Split create from update; accept typed DTOs; call an application service |
| `deleteDocument(...)` | `DocumentController.deleteDocument` | Parse path/header, invoke the delete use case, return `204` |
| `documentMetadata(...)` | `DocumentController.updateMetadata` | Map a typed metadata request to `UpdateDocumentMetadataCommand` |
| `instance(...)` | `FormInstanceController.createOrUpdateInstance` | Prefer separate create/update endpoints; retain compatibility during migration |
| `importInstance(...)` | `FormInstanceController.importInstance` | Accept already-extracted data, validate it, and invoke import policy |
| `deleteInstance(...)` | `FormInstanceController.deleteInstance` | Require document scope in the route or resolve and authorize it safely |
| `row(...)` | `FormRowController.createOrUpdateRow` | Prefer separate create/update operations and parent-scoped URLs |
| `deleteRow(...)` | `FormRowController.deleteRow` | Require document and instance scope rather than only a globally supplied row ID |

The retired `documents(JsonNode)` route should move temporarily to `shared.compatibility.LegacyDocumentEndpoint` and then be deleted after the client migration window. Retired compatibility code should not remain in the normal document controller.

## `formtype.api`

| Current method/helper | Target | Notes |
| --- | --- | --- |
| `template(...)` | `FormTemplateController.getTemplate` | Returns a specific active or requested template revision |
| `templateResponse(...)` | `FormTemplateHttpResponseFactory` or controller-local helper | HTTP cache behavior belongs at the API edge |
| `digest(...)` | Remove from controller | The checksum should be calculated when a template revision is stored and returned by the query service |
| `fieldLayouts(...)` | `FormLayoutController` | Replace collection PUT with resource-level layout revision endpoints |
| `formTypes(...)` | `FormTypeController` | Built-in/custom distinction should be a domain attribute, not separate controller behavior |
| `customFormTypes(...)` | `FormTypeController` | Merge with normal form-type operations |
| `formTypeOverrides(...)` | `FormLayoutController` or `FormTypeCustomizationController` | Decide whether an override is a layout revision or a tenant customization |

## `registry.api`

| Current method | Target |
| --- | --- |
| `aircraftModels(...)` | `AircraftModelController` |
| `documentTypes(...)` | `DocumentTypeController` |
| `documentTypeForms(...)` | `DocumentTypeFormAssignmentController` |

Collection replacement must become individual `POST`, `PUT/PATCH`, reorder, retire, and `DELETE` use cases.

## `defaults.api`

| Current method | Target |
| --- | --- |
| `defaults(...)` | `DefaultTemplateController` or `DocumentDefaultController` |

The current collection PUT should be retained only as a temporary compatibility endpoint.

## `settings.api`

| Current method | Target |
| --- | --- |
| `appConfig(...)` | `ApplicationSettingsController.updateSettings` |

A corresponding typed `getSettings` endpoint should be explicit rather than relying only on bootstrap.

## Shared HTTP support

| Current helper | Target |
| --- | --- |
| `expectedVersion(...)` | `shared.http.EntityTagVersionParser`, or a Spring argument resolver |
| `versioned(...)` | Small `VersionedResponse` DTO/response factory at the API edge |
| `ok()` | Remove; return an operation-specific typed response or `204 No Content` |

Do not expose application results as `Map<String,Object>`. Use named response records so contract changes are visible to the compiler and OpenAPI generator.

## Legacy bootstrap

`bootstrap()` currently combines every module. During migration it may live in `shared.compatibility.LegacyBootstrapController`, calling query interfaces from documents, defaults, form types, registry, and settings.

The target design should retire the document portion of bootstrap:

- `GET /api/v1/session-context` — current user and capabilities.
- `GET /api/v1/settings` — safe client settings.
- `GET /api/v1/registry` — small, cacheable reference data.
- `GET /api/v1/form-types` — pageable/filterable form metadata.
- `GET /api/v1/documents` — pageable document summaries.
- `GET /api/v1/documents/{documentId}` — one authorized aggregate/detail view.

---

# 2. Current `PdfgenDataService` method placement

## `document.application`

| Current method | Target service/use case | Required split or change |
| --- | --- | --- |
| `upsertDocument(...)` | `DocumentCommandService.createDocument` plus compatibility `replaceDocument` | Separate creation and mutation; do not infer the operation from database existence |
| `updateDocumentMetadata(...)` | `DocumentCommandService.updateMetadata`, `archive`, and `restore` | Archive/restore are explicit state transitions, not a boolean side effect of PATCH |
| `upsertInstance(...)` | `FormInstanceService.createInstance` and `updateInstance` | Validate ownership, form revision, archive/completion rules, and expected version |
| `importInstance(...)` | `DocumentImportService.importFormInstance` | Check feature setting, authorization, schema revision, extracted data, and idempotency |
| `deleteInstance(...)` | `FormInstanceService.deleteInstance` | Check parent document, authorization, record-retention policy, and version |
| `upsertRow(...)` | `FormRowService.createRow`, `updateRow`, and `reorderRows` | Do not allow row IDs to move between instances |
| `deleteRow(...)` | `FormRowService.deleteRow` | Check document/instance ownership and minimum/fixed row rules |
| `deleteDocument(...)` | `DocumentCommandService.deleteDocument` | Apply retention/legal-hold policy; hard delete may not be permitted |

Application services should receive explicit command records, for example:

```text
CreateDocumentCommand
UpdateDocumentMetadataCommand
ArchiveDocumentCommand
RestoreDocumentCommand
DeleteDocumentCommand
CreateFormInstanceCommand
UpdateFormInstanceCommand
ImportFormInstanceCommand
DeleteFormInstanceCommand
CreateFormRowCommand
UpdateFormRowCommand
ReorderFormRowsCommand
DeleteFormRowCommand
```

Each command should contain the authenticated scope, expected version where applicable, and an idempotency key for retryable create/import operations.

## `document.persistence`

| Current method | Target |
| --- | --- |
| `insertDocument(...)` | `JdbcDocumentRepository.insert` |
| `updateDocumentContent(...)` | `JdbcDocumentRepository.updateMetadataIfVersionMatches` |
| `restoreDocument(...)` | `JdbcDocumentRepository.restoreIfVersionMatches` |
| `saveInstance(...)` | `JdbcFormInstanceRepository.insert/updateWithinDocument` |
| `readDocuments()` | Split into `DocumentSummaryReader.findPage` and `DocumentAggregateReader.findById` |
| `documentVersion(...)` | `DocumentRepository.findVersion` only when genuinely needed |
| `isDocumentArchived(...)` | Part of one scoped document state query, not a repeated query |
| `touchDocument(...)` | `DocumentRepository.advanceVersion` or one atomic aggregate update |
| `documentForInstance(...)` | `FormInstanceRepository.findDocumentId`, scoped by tenant/user |
| `documentForRow(...)` | `FormRowRepository.findDocumentId`, scoped through its joins |
| `syncRows(...)` | `JdbcFormRowRepository.synchronizeForCompatibility` temporarily; later explicit row commands |
| `deleteMissing(...)` | Repository-specific compatibility helper; do not retain as generic SQL-string API |

The current read/check/write sequence should become atomic repository operations. For example, an update should include document ID, authorized tenant/scope, and expected version in the same SQL statement. If zero rows change, the application service determines whether the result is not found, forbidden, archived, or a version conflict without leaking another tenant’s record existence.

`ON CONFLICT` statements must never update a parent identifier. A safe update either:

- Uses `WHERE form_instances.document_id = :expectedDocumentId`.
- Uses a composite unique identity that includes the parent.
- Performs an insert and treats a global ID collision as a conflict.

## `defaults`

| Current method | Target |
| --- | --- |
| `replaceDefaults(...)` | `defaults.application.DefaultCommandService` plus `JdbcDefaultRepository` |
| `readDefaults()` | `defaults.application.DefaultQueryService` plus `JdbcDefaultQueryRepository` |

Replace collection replacement with:

- `createDefault`.
- `renameDefault`.
- `updateDefaultContents`.
- `deleteDefault` or `retireDefault`.
- `getDefault`.
- `listDefaults`.
- `applyDefaultToNewDocument`.
- `validateDefaultAgainstFormRevisions`.

## `formtype`

| Current method | Target |
| --- | --- |
| `template(...)` | `formtype.application.FormTemplateQueryService` + `FormTemplateRepository` |
| `replaceFieldLayouts(...)` | `FormLayoutCommandService` + `FormLayoutRepository` |
| `replaceFormTypes(...)` | `FormTypeCommandService` + `FormTypeRepository` |
| `replaceFormTypeOverrides(...)` | `FormCustomizationService` + its repository |
| `readFormTypes(...)` | `FormTypeQueryService` + query repository |
| `saveTemplate(...)` | `FormTemplateRepository.saveRevision` |

`readJsonMap(...)` is not a business function. Its queries should move into the repository that owns each table. Avoid a generic method that accepts SQL from application code.

## `registry`

| Current method | Target |
| --- | --- |
| `replaceAircraftModels(...)` | `AircraftModelService` + `AircraftModelRepository` |
| `replaceDocumentTypes(...)` | `DocumentTypeService` + `DocumentTypeRepository` |
| `replaceDocumentTypeForms(...)` | `DocumentTypeFormAssignmentService` + repository |
| `readDocumentTypes()` | `DocumentTypeQueryService` |
| `readDocumentTypeForms()` | `DocumentTypeFormAssignmentQueryService` |

The first two seed checks in `seedRegistryIfNeeded()` belong in Flyway reference-data migrations or an explicit, idempotent administrative initialization process. A GET request must not seed the database.

## `settings`

| Current method | Target |
| --- | --- |
| `readApplicationConfig()` | `ApplicationSettingsQueryService` + repository |
| `updateApplicationConfig(...)` | `ApplicationSettingsCommandService` + repository |
| `requiredConfigurationText(...)` | Typed request validation and `ApplicationSettings` domain constructor |
| `isFilledPdfImportAllowed()` | `ApplicationSettingsPolicy` or a typed settings query used by import service |

Settings changes require authorization, optimistic concurrency, audit events, and cache invalidation if settings are cached.

## `configuration`

| Current method | Target |
| --- | --- |
| `seedRegistryIfNeeded()` | Prefer Flyway migrations; otherwise `configuration.seed.ReferenceDataInitializer` |
| `serverTime()` | Remove and inject a `java.time.Clock` bean from `TimeConfiguration` |

Use `Instant.now(clock)` in application/domain logic and database-native `TIMESTAMPTZ` columns. A test-controlled clock makes audit/time behavior deterministic.

## `shared.json` or removal through typing

| Current helper | Target |
| --- | --- |
| `stringify(...)` | `JsonbMapper.write` in persistence support |
| `readTree(...)` | `JsonbMapper.read` in persistence support |
| `object(...)` | Prefer a typed JSON value/domain object; otherwise `JsonbMapper` |
| `value(...)` | Prefer typed conversion; otherwise `JsonbMapper` |
| `array(...)` | Remove when request DTOs use `List<T>` |
| `required(...)` | Replace with Bean Validation and domain constructors |
| `text(...)` | Remove through typed DTOs |
| `textOrEmpty(...)` | Replace with DTO normalization/domain value objects |
| `textOrDefault(...)` | Replace with explicit defaults in configuration/domain factories |
| `placeholders(...)` | Replace with `NamedParameterJdbcTemplate` collection binding |
| `readJsonList(...)` | Delete if unused; otherwise repository-specific query |

`ExistingRow` is a persistence record and belongs beside `JdbcFormRowRepository`. `SplitInstanceData` is a persistence compatibility shape and belongs in `DocumentPersistenceMapper`; the future typed model should make this split explicit.

---

# 3. Current security and error classes

## `security`

| Current class/method | Target | Change required |
| --- | --- | --- |
| `CurrentActor` | `security.CurrentPrincipal` | Return a typed principal with subject ID, display name, tenant/scope, and authorities |
| `CurrentActor.name()` | `CurrentPrincipal.require().subjectId/displayName` | Do not silently fall back to “Local user” outside the local profile |
| `CurrentActor.mayAdminister()` | `AuthorizationService.requirePermission(Permission.MANAGE_SETTINGS)` | Authorization should be use-case specific, not one broad boolean |
| `LocalSecurityConfig` | `security.LocalSecurityConfiguration` | Keep profile-limited; make local identity explicit and testable |

New production classes/functions:

- `SecurityConfiguration.securityFilterChain` for OIDC/JWT integration.
- `JwtAuthenticationConverter` or company SDK adapter.
- `CurrentPrincipal.requireAuthenticated`.
- `AuthorizationService.requireDocumentRead`.
- `AuthorizationService.requireDocumentEdit`.
- `AuthorizationService.requireDocumentDelete`.
- `AuthorizationService.requireFormTypeAdmin`.
- `AuthorizationService.requireRegistryAdmin`.
- `AuthorizationService.requireSettingsAdmin`.
- `AuthorizationService.requireAuditRead`.
- `TenantScope`/organizational-scope resolution.
- Tests for missing, expired, malformed, and insufficient credentials.
- Horizontal-access tests proving one authorized scope cannot access another scope’s IDs.

UI visibility can use server-returned capabilities, but hiding a button is never authorization.

## `shared.problem` and domain exceptions

`ApiExceptionHandler` should become `shared.problem.ApiProblemHandler` and return Spring `ProblemDetail` or a stable equivalent with:

- HTTP status.
- Stable application error code.
- Safe user-facing detail.
- Request/correlation ID.
- Field validation errors where applicable.
- Retryability indicator when useful.
- No stack trace, SQL, secret, or cross-tenant existence disclosure.

Exception ownership:

| Current exception | Target |
| --- | --- |
| `ResourceNotFoundException` | Module-specific `DocumentNotFound`, `FormTypeNotFound`, etc., or a narrow shared application exception |
| `OptimisticLockException` | `document.domain.DocumentVersionConflict` |
| `PreconditionRequiredException` | API/shared HTTP problem because it describes the `If-Match` contract |
| `ImportDisabledException` | `document.application.ImportNotAllowed` resulting from settings policy |
| `ForbiddenOperationException` | Prefer Spring `AccessDeniedException` or a security-layer authorization exception |
| `EndpointRetiredException` | `shared.compatibility` |
| `ArchivedDocumentException` | `document.domain.ArchivedDocumentModification` |

Add explicit mappings for authentication failure, authorization failure, validation failure, payload too large, unsupported media type, schema revision conflict, idempotency conflict, rate limiting, dependency unavailable, and service unavailable.

---

# 4. Application bootstrap and deployment classes

| Current class | Target |
| --- | --- |
| `PdfgenApplication` | Keep at package root so component scanning covers every module |
| `ServletInitializer` | `configuration.deployment.ServletInitializer`, or delete when moving to an executable Boot container |

Do not place ordinary beans at the root beside `PdfgenApplication`; use module packages so ownership remains visible.

---

# 5. Functions to implement in each business module

## `document.api`

Implement:

- `POST /api/v1/documents` — create with a server-issued ID and optional idempotency key.
- `GET /api/v1/documents` — authorized pagination, filtering, sorting, and summaries.
- `GET /api/v1/documents/{id}` — authorized aggregate/detail read.
- `PATCH /api/v1/documents/{id}` — metadata update with `If-Match`.
- `POST /api/v1/documents/{id}/archive`.
- `POST /api/v1/documents/{id}/restore`.
- `DELETE /api/v1/documents/{id}` — only when retention policy allows.
- Instance create/read/update/delete endpoints under the document ID.
- Row create/update/delete/reorder endpoints under document and instance IDs.
- `POST /api/v1/documents/{id}/imports` with idempotency and validation.
- Optional `POST /api/v1/documents/{id}/changes` to submit one ordered autosave batch atomically.
- Version/history and audit endpoints if authorized users need them.

API DTOs should separate summaries, details, commands, and results. Do not reuse database records as API contracts.

## `document.application`

Implement:

- `createDocument`.
- `searchDocuments`.
- `getDocument`.
- `updateMetadata`.
- `archiveDocument`.
- `restoreDocument`.
- `deleteDocument`.
- `duplicateDocument`.
- `createInstance`.
- `updateInstanceHeader`.
- `markInstanceComplete`.
- `reopenInstance`.
- `deleteInstance`.
- `createRow`.
- `updateRow`.
- `reorderRows`.
- `deleteRow`.
- `importInstance`.
- `applyChangeBatch`.
- `getDocumentHistory`.
- `resolveConflict` or return sufficient server state for a client reconciliation flow.

Every command use case follows this order:

1. Resolve authenticated principal and authorized scope.
2. Validate the typed command.
3. Load only the state needed for the rule.
4. Enforce ownership and permission.
5. Invoke domain behavior.
6. Persist atomically with the expected version.
7. Store/publish a business audit event.
8. Return a typed result including the new version.

## `document.domain`

Implement domain behavior such as:

- `Document.create`.
- `Document.updateMetadata`.
- `Document.archive`.
- `Document.restore`.
- `Document.canBeDeleted(retentionPolicy)`.
- `Document.addInstance`.
- `Document.removeInstance`.
- `Document.duplicate`.
- `FormInstance.createForRevision`.
- `FormInstance.updateHeader`.
- `FormInstance.markComplete(validationResult)`.
- `FormInstance.reopen`.
- `FormInstance.addRow`.
- `FormInstance.updateRow`.
- `FormInstance.reorderRows`.
- `FormInstance.removeRow`.
- `FormInstance.validateAgainst(FormSchemaRevision)`.

Invariants include:

- Archived documents are read-only except for restore and allowed retention operations.
- Completed instances are read-only until an authorized reopen operation.
- An instance belongs to exactly one document.
- A row belongs to exactly one instance.
- Form type and revision are permitted for the document type.
- Required, fixed-count, maximum-count, ordering, and field rules are enforced server-side.
- Version changes occur only after successful persistence.
- Historical form/template revision identity does not change when a form type is edited.

## `document.persistence`

Implement repository interfaces and JDBC adapters for:

- Paged document summary search.
- Aggregate/detail read by ID and authorized scope.
- Atomic create.
- Atomic update with ID + scope + expected version.
- Atomic archive/restore.
- Instance CRUD constrained by document ID.
- Row CRUD constrained by document and instance IDs.
- Batch changes in one transaction.
- History and audit read/write.
- Retention/legal-hold lookup.
- Database exception translation.

Avoid N+1 queries. The detail reader may load one document, its instances, and rows in bounded queries, while list screens load summaries only.

## `formtype.api`

Implement:

- List and get form types.
- Create a custom form type.
- Update metadata through a new revision.
- Create and validate a schema revision.
- Upload a template as a revision using a binary/multipart contract rather than Base64 in a large registry JSON payload.
- Download a specific template revision with stored checksum/ETag.
- Activate, deprecate, retire, and restore form types according to policy.
- List revision history.
- Validate compatibility before assigning or activating a revision.

## `formtype.application`

Implement:

- `createFormType`.
- `createSchemaRevision`.
- `validateSchemaRevision`.
- `storeTemplateRevision`.
- `activateRevision`.
- `deprecateFormType`.
- `retireFormType`.
- `getEffectiveFormDefinition`.
- `getTemplate`.
- `calculateAndPersistChecksum`.
- `checkRevisionUsageBeforeDeletion`.
- `migrateDraftLayout` where a controlled migration is genuinely required.

## `formtype.domain`

Implement:

- `FormType`, `FormTypeId`, and lifecycle status.
- `FormSchemaRevision` and `TemplateRevision` identities.
- Schema validation: unique field keys, unique row keys, valid references, value types, constraints, layout bounds, and import aliases.
- Revision immutability after activation.
- Compatibility rules between schema revisions.
- Assignment eligibility rules.
- Template checksum/content metadata.

## `formtype.persistence`

Implement:

- Unified form-type storage with a built-in/custom classification rather than duplicated tables where possible.
- Immutable schema and template revision repositories.
- Active-revision lookup.
- Usage/reference queries.
- Checksum and metadata queries that avoid reading/hashing the blob for every conditional request.
- Optional object-storage adapter if template volume/size justifies it.

## `registry`

Implement resource-level functions:

- Create, rename, reorder, retire, and list aircraft models.
- Create, update, reorder, retire, and list document types.
- Assign/unassign/reorder allowed form types for a document type.
- Validate that referenced records exist and are active.
- Block destructive changes that would invalidate existing documents, or require a deliberate migration.
- Version registry changes and emit administrative audit events.
- Cache read-mostly registry data with safe invalidation.

## `defaults`

Implement:

- Create, get, list, update, retire/delete, and duplicate defaults.
- Apply a default during document creation in one transaction.
- Associate defaults with exact form schema revisions.
- Validate defaults after form changes.
- Scope defaults globally, by tenant/unit, or by user according to requirements.
- Authorize who may publish shared defaults.

## `settings`

Implement:

- `getPublicClientSettings`.
- `getAdministrativeSettings`.
- `updateSettings(expectedVersion)`.
- Typed setting validation.
- Setting version/history.
- Cache invalidation.
- Administrative audit event.
- A capability/policy query for features such as filled-PDF import.

Do not return secrets or internal infrastructure configuration from application settings endpoints.

---

# 6. Cross-cutting functions to implement

## `security`

- OIDC/JWT/company-authentication integration.
- Principal, role, permission, tenant/unit, and document ownership resolution.
- Method/use-case authorization.
- Safe local-development identity under the local profile only.
- Authentication and access-denial problem responses.
- Token and permission integration tests.
- Periodic privileged-access review support.

## `configuration`

- Typed `@ConfigurationProperties` with startup validation.
- Mandatory production database and identity configuration without insecure fallbacks.
- `Clock` bean.
- ObjectMapper policy and safe JSON limits.
- Database/Flyway configuration and migration validation.
- HTTP limits, proxy/forwarded-header behavior, TLS expectations, CORS if needed, and security headers.
- OpenAPI generation and API version metadata.
- Environment/profile validation so local security cannot be activated accidentally in production.

## `observability`

- Correlation/request ID creation and propagation.
- Structured request and application logs with sensitive-data redaction.
- Metrics for request latency/errors, database pool, document operations, autosave conflicts, import outcomes, template access, and background work.
- Distributed tracing if calls cross process boundaries.
- Business audit events separate from debug/application logs.
- Liveness, readiness, database, storage, and critical-dependency health.
- Alertable service-level indicators.
- Audit-event persistence, retention, authorization, and integrity.

Technical telemetry answers “Is the service healthy?” Business audit evidence answers “Who performed this important operation, on what record, and what changed?” They should not be treated as the same dataset.

## `shared.problem`

- Stable error code catalog.
- Problem response builder/advice.
- Field-validation details.
- Correlation ID inclusion.
- Safe unexpected-error handling.
- Consistent 400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429, 503 behavior.
- Contract tests for every public problem type.

## `shared.paging`

- Bounded page-size validation.
- Stable sort specification.
- Page/cursor response types.
- Consistent filtering semantics.

---

# 7. Browser functions: what remains in the client and what moves server-side

The large `index.html` contains useful capabilities, but client behavior cannot be the only enforcement point.

## Keep in the browser

These are presentation or device-side computation concerns:

- UI state, modal behavior, selection, responsive layout, undo/redo of unsaved drafts.
- `renderPreviewPages` and display-only PDF preview behavior.
- Coordinate editing and visual form-layout manipulation.
- `buildFilledPdfGeneric`, `buildCoordinateCopies`, merging, drawing, and download/open behavior, if client-side document generation remains an approved architecture decision.
- `classifyAndExtractPdf`, AcroForm extraction, vector extraction, and OCR, if keeping source PDFs on the user device is a requirement.
- Date/value formatting for display.
- Client-side validation for immediate feedback.
- API request serialization, ideally through a generated/typed client.

Move OCR and expensive PDF work to Web Workers so it cannot freeze the main UI.

## Keep in the browser but redesign

- `queueSync`, `flushSync`, `performSync`, and page-unload handling become a tested autosave client with explicit states: clean, pending, saving, saved, retry scheduled, offline, conflict, and failed.
- Add exponential backoff with jitter for retryable failures.
- Do not retry validation, authorization, or conflict errors blindly.
- Keep a pending change until the server acknowledges its version.
- Send ordered, idempotent change batches per document.
- Reconcile a `409/412` response with server state rather than permanently suppressing future saves.
- Never display “retrying” unless a retry is actually scheduled.

## Move or duplicate on the server

| Browser behavior today | Required server owner |
| --- | --- |
| `uid`, `uniqueId`, form-type slug identity | Server-issued identifiers and uniqueness checks in application/domain/persistence |
| `emptyLogbook`, new document construction | `Document.create` and `DocumentCommandService.createDocument` |
| `cloneLogbookForms`, document duplication | `DocumentCommandService.duplicateDocument` |
| `validateFieldValue`, `validateInstance` | `FormSchemaValidator` and document domain validation; client copy remains for UX |
| `toggleComplete` validation/state change | Explicit `markInstanceComplete`/`reopenInstance` server commands |
| Archived/read-only checks | Document domain/application authorization; client checks remain for UX |
| Import-enabled check | Settings policy in `DocumentImportService` |
| `buildImportedInstance` and mapped data acceptance | Server validates all imported keys, types, row counts, form revision, and ownership |
| Admin checkbox | Server-provided capabilities and enforced permissions |
| Client `updatedAt`/`updatedBy` | Server-authoritative `Clock` and authenticated principal |
| Deletion eligibility | Domain retention/reference policy |
| Form schema/layout validity | Form-type domain validator |

The server does not need to duplicate drawing coordinates or UI layout behavior unless the organization requires authoritative server-generated PDFs. It must, however, validate all persisted data and state transitions.

---

# 8. Recommended API/application function flow

Example: update one row.

```text
FormRowController.updateRow
  -> parse path + If-Match + typed request
  -> FormRowService.updateRow(command)
       -> CurrentPrincipal.requireAuthenticated
       -> AuthorizationService.requireDocumentEdit
       -> FormTypeQuery.getSchemaRevision
       -> FormRow.validateChanges
       -> FormRowRepository.updateWithinParentIfVersionMatches
       -> AuditEventPublisher.rowUpdated
  <- UpdateRowResult(newDocumentVersion)
<- 200/204 with ETag
```

The repository SQL must constrain document ID, instance ID, row ID, authorized scope, archive/completion state as appropriate, and expected version. The controller never calls a repository directly.

Example: list documents.

```text
DocumentController.search
  -> DocumentQueryService.search(query, principal.scope)
       -> DocumentSummaryRepository.findPage
  <- PageResponse<DocumentSummaryResponse>
```

This endpoint must not load form instances, rows, templates, layouts, or audit history.

---

# 9. Refactoring sequence that avoids a big-bang rewrite

## Step 1 — Characterize current behavior

- Add PostgreSQL Testcontainers tests around every existing endpoint.
- Capture current response shapes and optimistic-lock behavior.
- Add regression tests for archive, import, instance, and row operations.
- Add failing tests that expose cross-parent ID re-parenting.

## Step 2 — Introduce package boundaries without changing the public contract

- Move error handling to `shared.problem`.
- Move `CurrentActor` to `security` and replace it with a typed principal abstraction.
- Introduce typed DTOs and API mappers behind the same URLs.
- Add repository interfaces.

## Step 3 — Extract document persistence and use cases

- Extract `JdbcDocumentRepository`, `JdbcFormInstanceRepository`, and `JdbcFormRowRepository`.
- Add separate document query and command services.
- Fix parent ownership and atomic version predicates.
- Keep compatibility adapters so the existing frontend still works.

## Step 4 — Extract the other modules

- Settings first because import/security policies depend on it.
- Form type and template revisioning.
- Registry resource operations.
- Defaults resource operations.
- Remove generic SQL/JSON helpers from the old service.

## Step 5 — Implement production security

- Integrate the approved identity provider.
- Apply server-side permissions to every use case.
- Add record/tenant-scope predicates and security tests.
- Make client capabilities reflect the authenticated principal.

## Step 6 — Replace bootstrap and collection replacement APIs

- Add paginated list/detail endpoints.
- Add resource-level admin operations.
- Migrate the browser client.
- Measure payload and query improvements.
- Retire compatibility routes after an announced window.

## Step 7 — Introduce immutable revisions and audit history

- Add schema/template revisions.
- Bind instances to revisions.
- Add data migration and reconciliation.
- Add append-only audit events and authorized history queries.

## Step 8 — Split the frontend and harden autosave

- Extract API, state, document, form-type, PDF, import, settings, and admin modules.
- Add unit and Playwright tests.
- Move compute-heavy work to workers.
- Adopt acknowledged, idempotent change batches.

## Step 9 — Remove the old compatibility layer

- Confirm no supported client calls the legacy routes.
- Delete `PdfgenApiController`, `PdfgenDataService`, legacy bootstrap, collection replacement, and untyped mapping code.
- Retain contract and migration tests for the new modules.

---

# 10. Definition of done for the restructuring

- No controller contains SQL or business rules.
- No application service returns `ResponseEntity` or depends on HTTP headers.
- No domain class imports Spring MVC or JDBC.
- No repository decides authorization or returns API DTOs.
- Every mutation has typed validation, authorization, an atomic persistence rule, a version strategy, and an audit event.
- Document list queries are bounded and paginated.
- Nested resource IDs cannot be used outside their authorized parent and scope.
- Form instances retain exact schema/template revision identity.
- Client and server display truthful save/conflict states.
- Compatibility endpoints are isolated, measured, documented, and scheduled for removal.
- Module boundaries have automated architecture tests.
- Tests cover repositories using PostgreSQL, application use cases, API contracts, authorization, concurrency, and critical browser workflows.
