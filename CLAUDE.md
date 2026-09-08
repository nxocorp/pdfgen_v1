# PDF-gen

See `history.md` for a detailed, chronological account of how this
project got here — the reasoning behind decisions below, dead ends
that were investigated and ruled out, and things discussed but not yet
formalized into a file (e.g. a draft Postgres schema).

## Repository layout

This project spans nine sibling folders under `DEVELOPMENT/`:

- **`PDF-gen/`** (this folder) — design docs, the visual mockup source
  (`mockup/`), and the reference PDF sets (`reference-acroform/`,
  `reference-plain/`).
- **`00-pdfgen-vanilla/`** — the original working proof of concept: a
  single self-contained `index.html` (Alpine.js + pdf-lib.js + pdf.js
  via CDN, `localStorage` persistence), with each form type's field
  map/model/fill-engine split into its own `js/form-XXXX.js` file
  (`index.html` keeps only the app shell + hardcoded per-form-type
  markup). Deliberately narrow scope — only the UH-60R aircraft model,
  only the Logbook document type — but proves out both fill paths for
  real: DA 2408-20 (coordinate-based, against a flattened template)
  and DA 2408-18 (AcroForm named-field). Also has: collapsible
  sidebar, a Print Preview panel (pdf.js canvas rendering +
  image-based printing, chosen specifically because mobile browsers
  don't render PDFs inline in an iframe), a header-level "Print All"
  that merges every form type into one combined PDF, Defaults (blank
  vs. saved-default logbook creation), and per-row duplicate +
  drag-to-reorder. Single-instance-per-form-type only (superseded on
  that specific point by the other `00-pdfgen-vanilla-*` folders below)
  and its output PDFs are flattened (fine for 2408-20's coordinate
  path, since there were never fields to preserve there; not
  revisited for 2408-18 in this folder). Still the only folder whose
  header button is literally named "Print All" — the other three
  `00-pdfgen-vanilla-*` folders below renamed theirs to **"Export All"**
  and changed its behavior (see "Export All" below).
- **`01-pdfgen-vanilla-multi/`** — a second POC exploring the *structural*
  shape a production, many-form-types/many-document-types app would
  need, kept deliberately separate from `00-pdfgen-vanilla/` rather than
  rewriting it in place. Same stack (Alpine.js + pdf-lib.js + pdf.js,
  `localStorage`), but: **both** form types use the AcroForm
  named-field path (no coordinate path in this folder at all — see
  "Four vanilla POC tracks" below); a document can hold *multiple
  instances* of a given form type, not just one; and the UI is
  schema-driven and generic (see "UI architecture" below) rather than
  hardcoding each form type's markup. Generated PDFs are genuine,
  still-interactive AcroForm documents, never flattened (see "Fill
  engine" below for why that's harder than just skipping
  `form.flatten()`). Also has: a resizable Print Preview panel, an
  "Open PDF" action that hands the customer the real AcroForm PDF via
  a blob URL in a new tab (not a save-file-dialog download), a
  per-form-type "Auto-fill from source" action that simulates the
  Automated data-entry workflow (see "Data entry workflows" below)
  end to end, a per-form-type "Configure" gear icon for per-field
  export styling (see "Export styling" below), per-logbook undo/redo
  (see "Undo/redo" below), and "Export All" (see below).
- **`02-pdfgen-vanilla-image/`** — a third POC, forked from
  `01-pdfgen-vanilla-multi/` (same app shell: logbooks, Defaults, sidebar,
  resizable preview, Open PDF, Auto-fill simulation, undo/redo, Export
  All), but swaps the AcroForm fill path for the **coordinate** path
  against the *flattened* templates (`reference-plain/`, 0 fields) —
  the inverse of `01-pdfgen-vanilla-multi`'s scope. Upgrades the
  styling-only Configure modal into a real **Form Type Editor** (see
  below): a pdf.js-rendered canvas with draggable/resizable field
  boxes, not just a list of style dropdowns.
- **`03-pdfgen-vanilla-json/`** — a fourth POC, forked from
  `02-pdfgen-vanilla-image/`, that moves each form type's definition
  (`sections`, field layout, sample data, template bytes) out of
  hardcoded `js/form-XXXX.js` files and into **`form-types.json`**,
  fetched at load — simulating the database-backed `form_types`
  registry already sketched in "Stack" below, without standing up
  Postgres. See "Form-type registry as data" below. Also has: per-field
  validation rules (required/type/length) carried in that same
  `form-types.json`, live inline error styling, a whole-form validation
  check, and a header-level "Mark complete" action that locks a form
  instance read-only once it passes — see "Field & form validation, and
  Mark complete" below — plus a Form Type Editor extended to add
  images/text boxes (fixed, or per-document "signature" placeholders) —
  see "Overlays: images and text boxes on the Form Type Editor" below.
  Also has a third form type, DA 2408-17, and the multi-table engine
  support it needed (a schema can now declare more than one table
  section, including fixed-row-count tables that never grow/shrink) —
  see "Multi-table support, and DA 2408-17" below.
- **`04-pdfgen-vanilla/`** — forked from `03-pdfgen-vanilla-json/`, but
  answering a different kind of question than the original four (see
  "Five vanilla tracks" below): instead of proving out an engine
  capability, it replaces every hardcoded/fake piece of the registry
  (aircraft models, document types, which form types belong to a
  document type and in what order, the form types themselves) with
  something genuinely admin-maintained *through the app* — see "Admin-
  maintained registry" below. A custom (admin-created) form type can be
  built with a manual schema builder or by uploading a real PDF
  (classified as AcroForm/vector-text/scanned-image and extracted
  accordingly) — see "Upload PDF workflow" and "Manual form-type
  structure builder" below — and everything it needed from the shared
  Form Type Editor/fill engine to support that is documented there too.
- **`05-pdfgen-database/`** — forked from `04-pdfgen-vanilla/`, answering a
  different kind of question again: not an engine or registry capability,
  but whether the *persistence* layer can move off `localStorage` onto a
  real server + database, per the "Stack" section's `localStorage`-as-
  cache design — see "Database backend, and table authoring inside the
  Form Type Editor" below for the Express/SQLite backend (`server/`) and
  the two custom-form-type workflow gaps closed alongside it.
- **`06-pdfgen_v1.0.0/`** — **the official Version 1 release** — see
  "Version 1" below. An exact fork of `05-pdfgen-database/` at the point
  it was deemed ready, with every "POC"/scope-disclaimer mention removed
  from user-facing text and code comments, and its database reset to a
  clean seed (no leftover dev/test data from `05`'s own active
  development). `05-pdfgen-database/` keeps developing independently past
  this point — the two are not required to stay in sync.
- **`07-pdfgen-dbnormal/`** — forked from `05-pdfgen-database/` (on its own
  git branch, `07-pdfgen-dbnormal`), answering a production-scaling
  question raised directly by the user: with 15+ form types per document
  type, up to 10 instances each, and potentially thousands of data rows
  per instance over an aircraft's service life, does the document-level
  JSON blob storage `05`/`06` both use hold up? See "Row-level
  normalization" below for the `form_instance_rows` table this fork adds
  and the real, measured write-amplification fix that came with it.
- **`pdfgen-spring/`** — empty, reserved for the future Spring Boot
  backend.

## Five vanilla tracks — why there are five `NN-pdfgen-vanilla*` folders

None of these are a superseded-vs-current pair — each is deliberately
answering a different question, and all five are worth keeping. The
first four answer an *engine* question (does this capability work at
all); the fifth answers a *registry* question (can the data those
engines run against be maintained without more AI-assisted coding):

- `00-pdfgen-vanilla/` proves the **two fill paths** (coordinate vs.
  AcroForm) can coexist in one app, against the narrowest possible
  scope (one form type per path, single instance only).
- `01-pdfgen-vanilla-multi/` proves the **structural shape** the real app
  needs once "many form types, many document types" stops being
  hypothetical: a generic schema-driven UI, multiple instances of a
  form type per document, and AcroForm output that survives being
  merged with other filled copies without losing interactivity.
- `02-pdfgen-vanilla-image/` proves the **other** fill path at that same
  structural scale — coordinate-based fill (flat, fieldless templates)
  with multiple instances, a generic schema-driven UI, *and* a real
  visual field-placement editor, not just AcroForm.
- `03-pdfgen-vanilla-json/` proves the **data source** can move — the
  exact same generic engine and UI, but form-type definitions come
  from a fetched JSON payload instead of being hardcoded in JS,
  proving the shape that would eventually come from Postgres.
- `04-pdfgen-vanilla/` proves the **registry** can move too, one step
  further than `03`'s read-only fetched JSON: aircraft models, document
  types, and form types (including their field/table shape, built
  manually or extracted from an uploaded PDF) are all created, edited,
  and assigned through the app itself, by an admin, with no code change
  and no AI assistance required to add e.g. a new aircraft's new
  document type.

If a future change only concerns one of these questions, it likely
only needs one of the five folders touched. `02-pdfgen-vanilla-image` and
`03-pdfgen-vanilla-json` in particular track each other closely (the
latter is a near-direct fork of the former), and `04-pdfgen-vanilla` tracks
`03` the same way — a fix to the shared app shell (undo/redo, Defaults,
preview panel, etc.) found in one should usually be checked against the
others.

## Version 1 — `06-pdfgen_v1.0.0/` is the official release

`00-pdfgen-vanilla/` through `05-pdfgen-database/` are the exploratory
lineage this file calls the "`NN-pdfgen-vanilla*`"/POC tracks above — each
answering one architectural question in isolation (a fill path, a
structural shape, the registry, the persistence layer), never meant to be
"the product" on its own. **`06-pdfgen_v1.0.0/` is where that lineage
turns into the first official, shippable Version 1** — every design
decision documented throughout this file (the two-path fill engine, the
schema-driven UI, the admin-maintained registry, the Express/SQLite
backend, the unified table row-capacity model, field-type output
formatting) is present and working together in this one folder, not
scattered across five different POC scopes.

Concretely, `06-pdfgen_v1.0.0/` is an exact fork of `05-pdfgen-database/`
at the point it was judged ready, with two changes on top:

- **Every "POC" mention removed** — the browser tab title, the header
  subtitle, an admin-facing alert, the Automate-entry modal's caption, the
  three built-in form types' `bannerNote` text, and every code comment
  that referenced "this POC" — reworded to read as a real, released app
  rather than a proof of concept with caveats. Nothing about the actual
  behavior changed; this was a wording pass only.
- **Database reset to a clean seed** — `05-pdfgen-database/` had
  accumulated real dev/test data from its own active development (custom
  form types, registry entries, documents) by the time this fork happened;
  none of that belongs in an official Version 1 baseline, so
  `06-pdfgen_v1.0.0/`'s database starts empty and reseeds fresh from
  `form-types.json`/`server/db.js` on first boot (3 built-in form types,
  default registry, 0 documents/custom types) — the same reseed mechanism
  `05-pdfgen-database/` itself has always used, just run once more against
  the corrected seed text.

`05-pdfgen-database/` is not superseded or frozen by this — it keeps
being the active development folder for whatever comes next; the two
folders are independent from this point on, and a fix made in one isn't
automatically expected to be ported to the other unless it's a real bug
in shared logic (in which case, check both, same as the five-vanilla-
tracks note above already advises for that folder family).

## Row-level normalization (`07-pdfgen-dbnormal`)

`05-pdfgen-database`/`06-pdfgen_v1.0.0` store a form instance's entire
data — header **and every table row** — as one JSON blob
(`form_instances.data_json`). Asked directly whether this holds up in
production at real scale (15+ form types per document type, up to 10
instances each, potentially thousands of rows per instance accumulated
over an aircraft's service life): no, for two separate reasons, only one
of which is the obvious one.

- **Storage shape** — rows are the unbounded-growth dimension (a header
  is a handful of fixed fields; a table can grow for years), so blobbing
  them together means adding one row re-serializes and rewrites
  everything already there.
- **The write path — the one that actually bites first.** `server.js`'s
  `/api/documents` handler deleted and reinserted **every document's
  every instance's every row**, on **every single save**, regardless of
  which one field on which one row actually changed (`persistLogbooks()`
  sends the whole `logbooks` array on every debounced edit, matching the
  cache-plus-flush-queue design in "Stack" above — but the server then
  wrote all of it back out unconditionally). At real scale this is the
  dominant cost, not blob size.

**Fix, entirely server-side — nothing in `index.html`'s data model, wire
format, or persistence calls changed:**

- **New table**: `form_instance_rows` (`id`, `instance_id`, `rows_key` —
  which of a schema's tables this row belongs to, since a schema can
  declare more than one, see "Multi-table support" — `row_index`,
  `data_json`), one real SQL row per data row instead of an array entry
  inside a growing blob. `form_instances.data_json` shrinks to just
  `{ header, overlayData }`.
- **Read path** (`readDocuments`) reassembles the exact same
  `{ header, overlayData, rows, verifRows, ... }` shape the client has
  always sent/expected (`serializeInstance`/`deserializeInstance` in
  `index.html`) by merging the small blob with rows fetched from the new
  table, grouped by `rows_key` — this is *why* the client needs zero
  changes.
- **Write path** (`replaceDocuments`) — real diffing, not blanket
  delete-then-reinsert, at every level:
  - `documents`/`form_instances`: upsert-by-id, delete only whatever
    id is genuinely missing from the incoming set (still a full-list
    comparison each save, but cheap — these two tables stay small even
    at real scale; a document/instance *count* in the hundreds is not
    the problem, unbounded *row* growth per instance is).
  - `form_instance_rows` (`syncInstanceRows`): a real content diff per
    row — new rows are inserted, a row whose position or content
    actually changed is updated, and a byte-identical row is **skipped
    entirely, zero SQL executed for it**. Verified directly (temporary
    write-count instrumentation, removed after confirming): editing one
    field on one row of a 10-row instance produced exactly
    `updated=1, skipped=9` — not a 10-row rewrite — while two sibling
    instances in the same document, untouched, produced `skipped=3` and
    `skipped=1` with zero writes.
- **Defaults are deliberately NOT normalized this way** — `defaults`/
  `default_instances` keep the original single-blob-per-instance shape.
  A default is a snapshot saved once and rarely re-saved; it was never
  the thing growing unbounded, so the extra complexity wouldn't pay for
  itself there.

**Verified**: a full round trip through the real app — created an
instance, added rows, full **page reload** (forcing a fresh
`/api/bootstrap` fetch and `documentFromWire` reconstruction from the
now-normalized tables), confirmed every row came back in the correct
order with the correct values, then ran the actual coordinate fill engine
against the reloaded instance and confirmed the produced PDF's text layer
contained the right values — the storage change is invisible from the
fill engine's side, exactly as intended.

## Design mockup

A multi-screen static mockup (Main workspace, Request-data dialog,
visual field editor, blank-PDF intake dialog, a dark-theme variant of
Main) exists as a published Claude Artifact/design canvas; its source
lives in `mockup/` (`.dc.html` files + `canvas.json`). Ask for the link
if it's needed again — canvases aren't guaranteed to keep a stable ID
across sessions the way a file path does.

## Vision

Any PDF or scanned document image can become a fillable, data-driven form —
not just PDFs that already ship with AcroForm fields.

## Mission

Build a tool that takes a generic document (flat PDF or image) with no
existing form fields, and produces a coordinate-based field map that lets
an app programmatically render values onto that document — text placed at
authored (page, x, y) positions rather than into named AcroForm fields.

This generalizes the approach already proven in `react_vite_app` (DA forms
app), which fills named AcroForm fields via a `FillContext` abstraction in
`field-customization.ts`. PDF-gen extends that same call shape
(`setText(key, value, itemKey)` / `finalize()`) to documents that have no
fields to name — the field map (authored once per document via a visual
placement UI) plays the role the AcroForm's field names used to play.

## Domain model & customer workflow

Vocabulary, most general to most specific:

- **Aircraft model** — e.g. UH-60M, AH-64.
- **Document type** — a category of paperwork for a model (e.g.
  "Logbook", "Maintenance Record"). Defines which **forms** a document
  of that type contains.
- **Document** — one instance the user is working on: a named
  collection of **forms** (each form = one document-mapped PDF/field
  map, per "Core pieces" below) and PDF reports, scoped to one aircraft
  model and one document type.
- **Form** — a single field-mapped document within a Document (what
  the rest of this file otherwise calls "a form"/"a document" — see
  the disambiguation this section adds).

Customer flow:

1. Pick an **aircraft model**.
2. Pick a **document type** for that model.
3. Choose to start the new **document** blank, or from a saved
   **default** (see "Defaults" below) for that document type.
4. Enter data across the document's forms (manual and/or automated —
   see "Data entry workflows").
5. Generate the document's PDFs — one fill pass per form, per "Fill
   engine" below.

## Validation

Two different kinds, both must pass before generation:

- **Field-level** — per-field rules on the form's own data (format,
  required, min/max, etc.), checked against that field alone.
- **Cross-document uniqueness** — some fields (e.g. serial number)
  must be unique across all documents of the *same document type and
  aircraft*, not just within the current document. This requires a
  query against already-saved documents (Postgres), not a purely
  client-side check — it can't be fully resolved against the
  localStorage cache alone, since another in-flight/queued edit
  elsewhere could collide with it. Needs a decision later on when this
  check runs (on field blur against the server, only at generate time,
  or both) and how a conflict is surfaced to the user.

## Stack (tentative)

- **Frontend:** company is leaning Angular — not set in stone yet.
- **Backend:** company is leaning Spring Boot — not set in stone yet.
- **Database:** PostgreSQL is the system of record — field maps and
  filled form data live there, not just client-side like the
  `react_vite_app` prototype. Schema TBD once the field-map JSON shape
  stabilizes.
- **Local storage:** used as a frontend cache, not the source of truth.
  Pattern: pull data from the DB into memory/localStorage on load, the
  user works against that local copy (snappy, no round-trip per
  keystroke), and edits are queued and flushed to the backend
  asynchronously. Implies a sync/queue layer (dirty-tracking, retry,
  conflict handling on reconnect) between localStorage and Postgres.

## Data entry workflows

Two ways data reaches the fill engine; both feed the same underlying
per-document data model, so the fill engine itself doesn't care which
path populated it.

1. **Manual** — a user enters values directly into fields, either
   one-by-one against the rendered document or through a structured
   form/abstraction over the field map (e.g. a typed schema per document,
   similar to the `types.ts` + `Editor.tsx` pattern in `react_vite_app`).
2. **Automated** — an external API is called, its response is parsed and
   mapped onto the document's data model (API field → form field key),
   and the fill engine renders it without a human touching individual
   fields. Needs: a per-document mapping (API response shape → field-map
   keys), and validation/error handling for missing or malformed API
   data before it hits the PDF.

   `01-pdfgen-vanilla-multi` has a POC-scope **simulation** of this path:
   an "Auto-fill from source" button on every form type opens a modal
   that steps through the four stages a real integration would go
   through (request → response → parsing → data entry, each shown as a
   checklist item that animates from pending to done), then populates
   the active instance from that form type's own `sampleData()`
   (schema-level, per "UI architecture" above) — no real request is
   made. It's generic over whichever schema is active, same as the
   rest of the schema-driven UI; a real implementation would swap
   `sampleData()` for an actual fetch + the mapping/validation layer
   described above, without the modal/workflow shell needing to change.

## Defaults

Naming note: "template" elsewhere in this doc means the *structural*
template — a document + its field map. This is a different concept —
saved *data* — so it's called a **default**, not a template, to avoid
collision.

A user fills out an instance of a form (manually or via automated
fetch) and can mark that filled instance as a default for its document
type. Creating a new form of that type offers the default's saved
values as a starting point, prefilling matching fields before the
user edits anything. Notes:

- A default is scoped to a document type, not global — and it bundles
  *every form type* that document type contains, not just one. Saving
  a default snapshots all of the document's forms together (e.g. both
  DA 2408-20 and DA 2408-18 for a UH-60R Logbook), so applying it
  prefills the whole document at once, not one form at a time. This
  was an open question earlier (scope it to a single form type, or the
  whole document type) — resolved in favor of the document type,
  confirmed by the `00-pdfgen-vanilla` POC.
- A document type can have more than one default (e.g. "Standard
  UH-60M header" vs. "Standard AH-64 header"); the user picks one (or
  none) at creation time.
- Prefilled values are a starting point, not a lock — every field
  stays editable after the default applies; the new form is its own
  independent instance from the moment it's created, not linked back
  to the default.
- Needs its own persistence: defaults are saved data (Postgres, per
  document type), not just a client-side convenience — so they follow
  the same DB-is-source-of-truth / localStorage-cache pattern as
  everything else here.

## Core pieces

1. **Render** — load a PDF (pdf.js) or image, display it page by page.
2. **Field placement UI** — draw/resize/name rectangles over the rendered
   page; assign each a type (text, checkbox, date) and style (font, size,
   alignment). Output: a JSON field map (`{key, page, x, y, width, height,
   fontSize, ...}[]`).
3. **Fill engine** — two paths, same data model:
   - **AcroForm path** — `form.getTextField(name).setText(value)` against
     the PDF's own named fields (the `react_vite_app` approach).
   - **Coordinate path** — `page.drawText(value, {x, y, ...})` at the
     authored field map's positions, for documents with no fields to name.
   The app must support both, since real source PDFs arrive both ways —
   it isn't a migration off AcroForms, it's handling whichever a given
   document actually has.

   **Generated PDFs must stay interactive** — a filled AcroForm PDF is
   the deliverable, and it must open in any standard PDF viewer as a
   genuine, still-fillable form, not a flattened/static rendering.
   `01-pdfgen-vanilla-multi` initially got this wrong by calling
   `form.flatten()` after filling (pdf-lib's own idiom for "bake values
   in"), which is the wrong default for this app even though it made
   the in-app pdf.js canvas preview trivially correct. Once fixed
   (fields left live), a real complication showed up wherever more
   than one already-filled AcroForm document gets merged into a single
   output PDF — row overflow onto extra physical copies of the *same*
   form instance, and "Export All" combining *separate* instances/form
   types:
   - `PDFDocument.copyPages()` (pdf-lib) carries a page's field/widget
     objects over correctly, but does **not** register them in the new
     document's own `/AcroForm` — with nothing done about it, the
     merged PDF has visually-correct-looking boxes that no viewer
     treats as interactive fields (effectively the same dead end as
     flattening, just by omission instead of intent).
   - If two merged documents share a template (two copies of the same
     form, or two instances of the same form type), their fields also
     share identical fully-qualified names once merged — real viewers
     can collapse same-named field trees into one shared field,
     silently losing the second copy's independent values.
   - Both are fixed together in one merge routine: after copying
     pages, walk each copied field up its `/Parent` chain to its
     top-level ancestor, rename every source's ancestor after the
     first so the merged names stay unique, then attach a proper
     `/AcroForm` whose `/Fields` lists every source's (now-unique)
     top-level field. This is specific to `pdf-lib`/`01-pdfgen-vanilla-multi`'s
     implementation, but the underlying constraint — a real PDF forms
     library will not merge two independently-filled AcroForm PDFs
     into one interactive document for free — will very likely recur
     against whatever library the Spring Boot backend ends up using
     (e.g. Apache PDFBox), so don't assume it's solved by switching
     libraries.
   pdf.js's plain canvas rendering (no separate annotation layer) does
   render a non-flattened field's baked appearance stream correctly on
   its own, confirmed directly — so leaving fields live doesn't cost
   anything on the in-app preview path.

## UI architecture: schema-driven forms (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

To scale to "many form types, many document types" without every new
form type requiring hand-written markup, each of these three folders
represents a form type as one **schema** object rather than giving it
its own hardcoded HTML block. `index.html` renders whichever schema is
active through two generic partials — a "fields" section (a labeled
grid of inputs bound via `:value`/`@input`, since Alpine's `x-model`
sugar needs a static path and these keys are data-driven) and a
"table" section (a repeating-row grid, column list also data-driven)
— plus one shared Alpine app shell (sidebar, logbook/instance
selection, preview, Export All, the automate-entry modal). A schema
carries:

- `type`/`label`/`bannerNote` — identity and the in-UI explanation of
  which fill path this form type uses and its row-overflow behavior.
- `sections` — an ordered list of `{kind: "fields", ...}` /
  `{kind: "table", ...}` blocks, i.e. the entire visible form layout,
  data instead of markup.
- `sampleData` — a dummy-payload generator for the simulated
  "Auto-fill from source" workflow (see "Data entry workflows" below);
  optional in principle, since nothing about the generic renderer
  requires a schema to have a fill engine or sample data at all — the
  same fields/table renderer could just as well drive a data structure
  with no PDF behind it (e.g. app-only notes), which is the concrete
  form the earlier "a data structure not tied to a form type" question
  would take, not yet built.

**`01-pdfgen-vanilla-multi` and `02-pdfgen-vanilla-image`** attach the rest
directly to the schema object as functions: `empty`/`clone`/`newRow`
(model factories — blank instance, clone for Defaults, blank row) and
`build`/`buildCopies` (fill engine entry points: `build` returns one
finished, possibly multi-copy-merged PDF for this instance alone;
`buildCopies` returns the not-yet-merged per-copy documents, which
"Export All" collects across every instance/type and merges once, in
a single global pass, rather than merging per-instance and then
merging those merged results again). Adding a form type means adding
one sibling `js/form-XXXX.js` exporting an object shaped like this and
listing it in `index.html`'s `FORM_TYPES` array (also the single
source of truth for numeric-order sidebar listing and Export All's
per-type grouping) — no other file needs to change.

**`03-pdfgen-vanilla-json`** can't do that — a schema fetched from
`form-types.json` is pure data, no functions survive JSON. Its
`empty`/`clone`/`newRow`/`build`/`buildCopies` became **generic
top-level functions** in `index.html` instead (`emptyInstance`,
`cloneInstance`, `emptyRowFor`, `buildFilledPdfGeneric`,
`buildCopiesGeneric`), each taking the schema as a plain argument and
deriving header/row keys from `sections` itself — see "Form-type
registry as data" below. This turned out to be a strict simplification,
not a workaround: nothing about the fill engine was ever genuinely
form-type-specific, so the generic versions are what `-multi`/`-image`
"should" have had all along, just not forced into existing until a
schema stopped being able to carry functions.

A document's instances of each form type are stored as an array
(`forms2408_20`, `forms2408_18`, ...), not a single object — a
document can hold more than one instance of a given form type (e.g.
two separate Oil Analysis Logs), each independently addable/deletable
from a "Forms in this document" sidebar section, in numeric order by
form type.

## Export styling (`01-pdfgen-vanilla-multi`)

Every field/column a schema declares (per "UI architecture" above) can have
its export appearance configured independently of the data itself — font,
size, bold/italic, and whether long text is allowed to wrap onto multiple
lines. A gear icon in the sidebar, immediately left of a form type's "+"
(add instance), opens a "Configure `<form type>`" modal listing one row per
header field and table column (label taken straight from the schema, so no
extra config needed when a new form type or field is added). This is
`01-pdfgen-vanilla-multi`'s version specifically — `02-pdfgen-vanilla-image`,
`03-pdfgen-vanilla-json`, and `04-pdfgen-vanilla` evolved the same gear icon
into a full **Form Type Editor** (below) that edits field *position* as
well as styling, since the coordinate fill path actually needs both.

- **Data model**: a `localStorage` key (`01-pdfgen-vanilla-multi-fieldstyles`)
  holds `{ [formType]: { [fieldKey]: { fontFamily, bold, italic, fontSize,
  allowOverflow } } }`. `fieldKey` reuses the same key the schema/fill-engine
  already address that field by — no new key namespace. A field with no
  saved entry falls back to `DEFAULT_FIELD_STYLE` (Helvetica, 12pt, single
  line).
- **Alignment was deliberately dropped**: an early version of this feature
  included a justification control (and a follow-up ask specifically to
  split it into separate horizontal/vertical align controls), but pdf-lib's
  AcroForm text fields only support horizontal alignment natively — there's
  no vertical-alignment API without hand-writing a custom appearance-stream
  provider (out of scope for this POC). Rather than ship a vertical-align
  control that silently does nothing, alignment was removed from the
  config UI entirely; every field renders left-aligned.
- **Fill engine wiring**: the old blanket `acroForm.updateFieldAppearances
  (font)` call (one font for every field) was replaced with a per-field
  `setStyledAcroText` that sets each field's value, font size (0 = pdf-lib
  auto-fits to the box), multiline flag (the "allow overflow" toggle), and
  resolves + embeds the right `StandardFonts` variant (Helvetica/Times/
  Courier × bold × italic — pdf-lib's only fonts that don't need a real
  font file embedded), caching each embedded font per physical copy so the
  same combination isn't re-embedded per field. `buildAcroFormCopies`,
  `buildCombinedPdf`, `regeneratePreview`, and `exportAll` all thread
  the relevant form type's saved styles through to generation.
- A styling change intentionally invalidates any currently-rendered
  preview for that form type (the preview no longer reflects what Save
  produced), rather than silently leaving stale output on screen.

## Form Type Editor (`02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

The coordinate fill path needs a real (page, x, y, width) per field, not
just styling — so these two folders replaced the Configure modal with a
visual editor: a pdf.js-rendered page (front/back tab) with one
draggable/resizable box per field overlaid on it, plus a properties panel
(x, y, width, font family, size, bold, italic, allow overflow) that updates
live as a box is dragged, and vice versa. This is the "visual field editor"
from the original design mockup (`mockup/`), now actually built.

- **Header fields** get a full box: drag moves it (x/y), a right-edge
  handle resizes width. **Table columns** get one box representing that
  column's row 0 on the page currently shown — dragging it horizontally
  changes the column's `x`; dragging it vertically changes the *whole
  page's* row-grid `startY` (shared across every column on that page, so
  one column's box moving vertically visibly drags every other column's
  box with it — an intentional, honest representation of the real shared
  data, not a bug). A separate small "Row grid" panel exposes `startY` and
  `spacing` directly as numbers once a column is selected.
- **Default field layout**: each schema carries a `defaultLayout` —
  `{ header: {...}, cols: {...}, page1: {rows, startY, spacing}, page2:
  {...}, repeatingHeaderExclude: [...] }` — seeded from real coordinates,
  not guessed:
  - DA 2408-20 reuses `00-pdfgen-vanilla`'s already-validated
    `HEADER_FIELDS`/`ROW_COLS`/`PAGE1_ROW_Y`/`PAGE2_ROW_Y`, refit from
    literal per-row Y values to a uniform `{startY, spacing}` pair (a
    plain average of the real deltas — under 1pt max drift from the
    original literal values, imperceptible at this row height, and the
    editor lets it be hand-tuned further regardless).
  - DA 2408-18 had **no** existing coordinate map anywhere in this
    project — `00-pdfgen-vanilla` only ever filled it via AcroForm. Derived
    fresh via a `pdf-lib` probe script against
    `reference-acroform/A2408_18.pdf`'s real widget rectangles (each
    row's baseline = widget `y` + 6), same technique as the rest of this
    project's field-name/position inspection work.
- **Overrides** persist to `localStorage`
  (`02-pdfgen-vanilla-image-fieldlayouts` / `03-pdfgen-vanilla-json-fieldlayouts`)
  as `{ [formType]: <partial layout> }`, deep-merged over `defaultLayout`
  at read time (`getLayout(schema, savedLayouts)`) — an untouched field
  keeps rendering exactly as its default.
- **`allowOverflow` means something different here than in the AcroForm
  Export styling** (above): `true` draws one unclipped line that may run
  past the box width (matches every field's original un-configurable
  behavior in `00-pdfgen-vanilla`); `false` wraps within the box width instead
  (`page.drawText(..., {maxWidth, lineHeight})`) — exactly what
  `00-pdfgen-vanilla`'s original 2408-20 "remarks" field already did.
  Alignment/justification isn't offered here either, for the same reason
  as the AcroForm version — see "Export styling" above.

## Form-type registry as data (`03-pdfgen-vanilla-json`)

Forked from `02-pdfgen-vanilla-image`, moving each form type's `sections`,
`defaultLayout`, `sampleData`, and `templateB64` (the flat PDF, base64) out
of hardcoded `js/form-XXXX.js` files and into **`form-types.json`**,
fetched once at load (`loadFormTypes()`) — simulating the database-backed
`form_types` table already sketched in "Stack" above (`field_map jsonb` +
`version`) without standing up Postgres. `FORM_TYPES` starts as an empty
array and is `push()`-populated once the fetch resolves; `init()` awaits
`loadFormTypes()` before anything else runs, so by the time a user could
reach any code path that needs it (e.g. creating a logbook), it's already
populated. Requires the page to be served over http(s) — unlike the other
three folders' `<script src>` tags, `fetch()` of a local file is blocked
under `file://`.

Since a JSON-fetched schema is pure data (no functions survive
`JSON.stringify`), this folder's `empty`/`clone`/`newRow`/`build`/
`buildCopies` became the generic top-level functions described in "UI
architecture" above — see that section for why this ended up being a
simplification, not a workaround.

`04-pdfgen-vanilla` forks this folder and takes the same idea one step
further: `form-types.json` here stays read-only (still fetched the same
way), but `FORM_TYPES` also gets *admin-created* entries pushed in from a
separate, mutable, `localStorage`-backed store — see "Admin-maintained
registry" below for the full registry (aircraft models, document types,
form types, and which form types belong to which document type) that
grew up around this.

**A real bug this surfaced, worth remembering**: Alpine automatically
calls a data object's `init()` method if it has one — `<body
x-data="pdfgenApp()" x-init="init()">`'s explicit `x-init` call was
therefore calling `init()` *twice* in every `00-pdfgen-vanilla-*` folder, all
along. Harmless everywhere `init()`'s work was idempotent (`this.load()`
just reassigns), but the first time `init()` did something *additive*
(`FORM_TYPES.push(...)` here), the second call duplicated both form types,
producing duplicate `x-for` `:key`s — which crashes Alpine's internal
DOM-diffing and leaves the *entire page's* reactivity broken (symptom: no
input anywhere accepts typing, not just the one tied to the duplicated
data). Fixed by removing the redundant `x-init="init()"` in all four
`NN-pdfgen-vanilla*` folders (Alpine's automatic `init()` call is enough on
its own), plus a defensive guard in `loadFormTypes()` against any future
double-population.

## Field & form validation, and Mark complete (`03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

Validation rules travel with the schema itself — a `validation` object per
header field / table column (`{ required, type: "text"|"number"|"date",
minLength, maxLength }`), fetched from `form-types.json` alongside
`sections`/`defaultLayout`/`sampleData`/`templateB64`. Same "simulated
database" registry as the rest of this folder (see "Form-type registry as
data" above) — a real `form_types` table would carry these the same way,
not as a separate mechanism.

- **Live, per-field feedback**: an invalid field gets a red border and a
  native tooltip (`title`) with the specific problem(s), recomputed on every
  render via `headerFieldErrors(key)`/`rowFieldErrors(section, row, key)` —
  cheap enough at this form's scale that no separate dirty-tracking or
  memoization was needed. A required field's label/column header also gets
  a red asterisk, driven straight off `validation.required`.
- **Date validation is deliberately lenient**: this project's own sample
  data mixes army-style dates ("15 MAR 26"), ISO (`2026-03-05`), and slash
  dates — a strict `Date.parse()` would flag legitimate values as invalid,
  so `looksLikeDate()` accepts all three shapes via regex instead.
  (`04-pdfgen-vanilla` renders a native `<input type="date">` for any
  `type: "date"` field/column — but a native date input only *displays* a
  value already in ISO `yyyy-mm-dd` form, so an existing non-ISO value
  shows blank in the picker until re-entered; the stored string itself,
  and `looksLikeDate()`'s leniency, are both untouched by this.)
- **Whole-form validation** (`validateInstance(schema, instance)`) walks
  every header field and every row's columns against the schema's
  validation specs, producing a flat list of `"Label: problem"` strings — 0
  length means the instance is clean. A toolbar banner shows a live count
  of currently-invalid fields whenever there are any.
- **Mark complete / Mark incomplete** — a header button (per active form
  instance, alongside Export All — see "Header vs. per-instance toolbar
  actions" below) runs `validateInstance()` and refuses if anything fails;
  there is no validation gate going the other way; unmarking complete
  always succeeds. `complete` is a boolean on the instance itself
  (`emptyInstance`/`cloneInstance` both default it to `false` — a clone of
  an already-complete instance, e.g. from a saved Default, still starts
  incomplete, since completeness tracks review of *that* instance's data,
  not whatever state the source was in).
- **The refusal is a real modal, not a native `alert()`** — a "Cannot mark
  complete" dialog lists every failing field as one row each: a badge
  (**Pending** for a required field with no value yet, **Incorrect** for a
  field that has a value but fails a format/length check — distinguished
  by `validateInstance()`'s `kind` on each problem, not just a flat string
  list) plus the field's location (`Header` / `Row N`), label, and the
  specific message. Dismisses via its Close button or a backdrop click,
  matching every other modal in this folder (Save as default, Form Type
  Editor, etc.) instead of a one-off blocking browser dialog.
- **What "complete" locks**: while `instance.complete` is true, that
  instance's header/row inputs become `readonly`, and its row-structural
  actions (add/remove/duplicate/reorder row) and "Auto-fill from source"
  are disabled — both in the UI (`:disabled`/`:readonly` bindings) and
  defensively inside the mutator functions themselves (`addRow`,
  `removeRow`, `duplicateRow`, `dropRow`, `openAutomateModal` all
  short-circuit if `activeInstance.complete`). Undo/redo and unmarking
  complete are deliberately exempt — a completed form can still be
  reopened or rolled back, per the fill-out-then-lock model this is
  simulating (think a submitted paper form vs. a shredded one).
- **Per-instance, not per-logbook**: "complete" lives on each form
  instance, since that's the unit `toggleComplete()` operates on. The
  sidebar's per-instance rows show a small green checkmark for completed
  instances; a logbook (which bundles every form type's instances) is
  itself only "Complete" once *all* of its instances are — computed by
  `isLogbookComplete(lb)`, never stored, so it can't drift out of sync with
  the instances it's derived from.

### Header vs. per-instance toolbar actions

"Save as default" (logbook-wide) and "Mark complete" (active-instance-only)
live in the top header bar next to "Export All", not the center-pane
toolbar — despite one being logbook-scoped and the other instance-scoped,
both read as document-level, "I'm done with this" actions the user reaches
for from the same spot regardless of which form/instance is currently open.
The center-pane toolbar keeps only the actions that only make sense while
looking at one specific form instance: Undo/Redo, Auto-fill from source,
and Print Preview.

## Overlays: images and text boxes on the Form Type Editor (`03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

The Form Type Editor (see "Form Type Editor" above) was extended to let a
user add arbitrary **overlay** elements on top of a form type's existing
schema-bound fields — an uploaded image (e.g. a signature graphic, a
company stamp, a logo) or a free-form text box — position/resize them the
same way as any other field box, and persist them alongside the rest of
that form type's layout in `fieldLayouts` (the same `localStorage`
"simulated DB" override store `confirmSaveEditor()` already wrote
header/column position overrides to). `getLayout()`'s merge rule for
`overlays` is a full replace, not a per-key deep-merge like header/cols —
a saved overlay list (even `[]`) always wins over `defaultLayout.overlays`,
so removing an overlay in the editor actually removes it.

- **Two scopes for one overlay, chosen with a single "Fill per document"
  checkbox** — this was the resolved design question for the feature (a
  signature is inherently per-document, but the editor that places it is
  inherently per-form-type):
  - **`mode: "fixed"`** (the default) — the overlay's image/text is baked
    into the form type itself and appears identically on every instance's
    generated PDF, e.g. a standard letterhead or boilerplate note.
  - **`mode: "placeholder"`** — the editor only reserves the box's
    position/size; the actual image or text comes from each form
    *instance* individually, entered in a new "Signature & attachments"
    card that appears in the center pane below the schema-driven renderer
    whenever the active form type has any placeholder overlays
    (`placeholderOverlays()`). Content lives on the instance itself
    (`instance.overlayData[overlayId] = { imageB64 }` or `{ text }`),
    guarded by the same `readonly`/disabled treatment "Mark complete"
    already applies to every other instance-level input, and resets to
    `{}` on clone (same precedent as `complete` — a signature is
    specific to *this* instance's review, not something a saved Default
    or a cloned copy should carry forward).
  - Toggling the checkbox clears whatever fixed content the overlay was
    carrying (`setOverlayPlaceholder()`) — switching to "fill per
    document" with a stale baked-in image/text left behind would be
    confusing, and the fill engine only reads instance data for
    placeholder-mode overlays in the first place, so it would never
    surface anyway.
- **Image uploads** go through `FileReader.readAsDataURL()`, stored as a
  full `data:image/png;base64,...` / `data:image/jpeg;base64,...` string
  — directly usable both as an `<img src>` preview (editor and per-instance
  alike) and, at fill time, sniffed by its `data:` prefix to pick pdf-lib's
  `embedPng` vs `embedJpg` (`drawOverlayImage()`). An image overlay carries
  an explicit `height` (unlike every other box kind, which derives box
  height from `fontSize`) since pdf-lib's `drawImage` needs one — the
  canvas box gets a second, bottom-edge drag handle (`.editor-box-resize-v`)
  just for this.
- **A text overlay reuses the exact same style controls** header/column
  fields already have (font family, size, bold, italic, allow overflow) —
  it's drawn through the same `drawStyledField()` the rest of the fill
  engine uses, just with a fixed or per-instance `text` value instead of
  one pulled from `form.header`/a row.
- **Fill engine wiring**: `drawOverlays(doc, pages, fontCache, layout,
  form, copyIndex)` runs once per physical copy inside
  `buildCoordinateCopies()` (both `Print Preview` and `Export All` share
  this path), after header/row fields — every overlay repeats on every
  physical copy of a row-overflowed instance (same default behavior as
  header fields), with no per-overlay exclude-list yet (unlike
  `repeatingHeaderExclude` for header fields) since it wasn't asked for. A
  placeholder overlay with nothing filled in for that instance is simply
  skipped — signing is optional, not validation-gated.
- **Editor UI**: "+ Add image" (triggers a hidden file input) and "+ Add
  text box" buttons sit above the page tabs; new overlays appear in a
  third "Overlays" group in the field list (with a small × to remove them
  — the only removable items in the list, since header/column boxes are
  intrinsic to the schema) and as draggable/resizable boxes on the canvas,
  reusing `startBoxDrag`/`startBoxResize` (extended with an `"overlay"`
  branch alongside the existing `"header"`/`"col"` ones) plus a new
  `startBoxResizeHeight` for the image-only height handle.

## Sidebar: collapsible instance lists and inline rename (`03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

Two small usability additions to the "Forms in this document" sidebar
section (see "UI architecture" above), aimed at documents with several
instances of the same form type:

- **Per-form-type collapse** — a chevron button on the left of each form
  type's header (`▾`/`▸`) toggles that type's instance list, tracked in
  `collapsedFormTypes` (in-memory only, like undo/redo — resets on
  reload, and deliberately per form type rather than one global
  "collapse all," since the ask was to collapse "all form instances of a
  type," not the whole sidebar section).
- **Inline rename** — each instance carries an optional `name` (added to
  `emptyInstance`/`cloneInstance`, default `""`). A small pencil button
  (visible on row hover, same treatment as the existing delete ×) swaps
  the label `<div>` for a text `<input>`; Enter or blur commits the trimmed
  value via `commitRename()`, Escape cancels via `cancelRename()` without
  touching the stored name. `instanceLabel(ft, inst, idx)` prefers a set
  name and falls back to the original auto-generated `"<type> — Instance
  N"` label — unrenamed instances look exactly as they did before this
  feature. The center-pane toolbar caption picks up the same custom name.
  Unlike `complete`/`overlayData` (§18/§19 in `history.md`), **`name` is
  carried over by `cloneInstance`** — it's an organizational label (e.g.
  "Left engine" vs. "Right engine"), not per-instance review/signing
  state, so a document created from a saved Default keeps its instances'
  names rather than resetting them.

## Multi-table support, and DA 2408-17 (`03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

A third form type, **DA 2408-17 (Aircraft Inventory Record)**, was added
against `reference-plain/A2408_17.pdf` (coordinate path, same as this
folder's other two form types). Unlike them, its real layout doesn't fit
"one header + one growable table": page 1 is a 12-row-per-copy **Equipment
Checklist** (Item No./Nomenclature/Qty Req + 12 monthly "Check number"
columns — grows/reorders/overflows exactly like DA 2408-20/18's tables),
but page 2 holds a **Verification log** (6 signature slots) and a
**Location/Remarks list** (13 slots) — both fixed physical row counts that
never grow, shrink, or reorder, unlike every table this app had built
before. Real widget positions for all three were derived the same way as
every other form/field-map in this project — a pdf-lib probe against
`reference-acroform/A2408_17.pdf`'s 259 AcroForm widgets, cross-checked
against the rendered page text (pdf.js text-content extraction) for real
labels ("4. EQUIPMENT CHECKLIST", "5. VERIFICATION", "6. LOCATION OR
REMARKS", etc.) — never guessed.

This required generalizing the shared engine (previously hardcoded to
exactly one table section per schema) to genuinely support more than one —
chosen deliberately over the cheaper alternative (flattening the 74 fixed
slots into plain "fields" grids) because the fixed tables are real tables
in the source form, not incidental data. All changes are additive/
backward-compatible — DA 2408-20/18 needed zero migration:

- **A table section can carry `fixedRows: N`** (schema-level, in
  `sections`) — marks it as a fixed physical row count instead of the
  default growable table (starts at 1 row, add/remove/duplicate/reorder
  freely). `emptyInstance` seeds it with exactly `N` empty rows instead of
  1; the UI hides the drag handle, duplicate/remove buttons, and "+ Add
  row" for that section's table (`x-show="!section.fixedRows"` at each
  spot) — both in markup and defensively inside `addRow`/`removeRow`/
  `duplicateRow`/`dropRow` themselves, same precedent as "Mark complete"'s
  read-only guards.
- **`tableSectionsOf(schema)`** (plural) replaces the old singular
  `tableSectionOf` everywhere that needs to walk every table a schema
  declares — `emptyInstance`, `validateInstance`, and
  `runAutomateWorkflow`'s sample-data pass. `cloneInstance` needed no
  schema parameter at all: it now finds row arrays by duck-typing (any
  own array-valued property — header/overlayData are always plain
  objects), which generalizes to however many `rowsKey`s an instance
  carries with no schema awareness.
- **Fill engine**: the primary table's columns can carry an optional
  `yOffset` (default 0) added to the row's computed Y — needed because DA
  2408-17's Item/Nomenclature/Qty and its 12 check-number columns print on
  two different physical lines within what's logically one row, not side
  by side on one line like every previous table. `yOffset` alone got the
  *fill engine's* output right immediately, but a follow-up bug report
  showed the **Form Type Editor** was still ignoring it — every column in
  a row rendered at the same `y` on the editor's canvas regardless of its
  `yOffset`, so Item No./Nomenclature visually overlapped the check
  columns there even though the generated PDF already placed them
  correctly. Fixed by including `yOffset` in the editor's own box-position
  math (`editorBoxesForCurrentPage()`), for both the primary table and any
  extra table's columns.
  That same report asked for a way to drag a column like this
  independently, since vertical drag on a normal column moves the whole
  table's shared `startY` — added a per-column `independentY` boolean
  (a "Move independently of this table's row grid" checkbox in the
  properties panel, shown for any selected `'col'` box) that, when set,
  redirects vertical drag to adjust that column's own `yOffset` instead of
  the shared grid, plus a direct numeric "Y offset" input for fine-tuning
  without dragging. Turning the checkbox back off resets `yOffset` to 0 —
  otherwise a hidden nonzero offset would keep shifting the column even
  after the UI no longer showed any way to see or change it. `independentY`
  defaults to unset/false, so every pre-existing column in every form type
  behaves exactly as before unless a user explicitly opts a column in.

  A schema's fixed tables live in `defaultLayout.extraTables` (array, one
  entry per `rowsKey`) —
  each carries its own single `page`/`startY`/`spacing`/`rows` (no
  page1/page2 split, since a fixed table never overflows) plus its own
  `cols`. `buildCoordinateCopies` draws every extra table's rows once, on
  `copyIndex === 0` only — a verification log or remarks list is
  document-level content, not per-physical-copy, so (unlike header fields,
  which repeat every copy unless individually listed in
  `repeatingHeaderExclude`) extra tables never repeat at all.
- **`getLayout()`** merges `extraTables` the same way it already merged
  `cols` — per-column overrides deep-merge over the default, table-level
  properties (`startY`/`spacing`/`page`) merge at the table level — so a
  Form Type Editor save that only touched one field leaves everything else
  exactly at its default.
- **Form Type Editor**: reuses the *existing* `'col'` box kind for extra-
  table columns rather than adding a parallel kind, since column keys are
  unique across a schema's table sections by convention — `findColBucket()`
  /`findExtraTableForColKey()` locate the right `cols` object (primary
  `layout.cols` vs. an extra table's own) by key alone. This meant
  `editorBoxesForCurrentPage`, `editorSelectedSpec`, `editorCurrentGrid`,
  `selectEditorField`, `startBoxDrag`, and `startBoxResize` needed small
  lookups swapped in, but no new markup, no new Alpine state, and no
  duplicated drag/resize/select code paths — dragging a Verification
  column vertically adjusts *that table's own* `startY` the same way
  dragging a primary-table column adjusts `page1`/`page2`'s `startY`.
- **`validateInstance`** only prefixes a validation problem's location
  with its table's title (`"5. Verification — Row 2"`) when a schema has
  more than one table section — every existing single-table form's
  `"Row N"` wording is byte-for-byte unchanged.
- **A real transient-render bug surfaced while adding this**: switching
  the active form type sets `activeFormType` and `activeInstanceId` in two
  separate reactive writes, so Alpine can re-evaluate the *outgoing*
  schema's table sections against the *new* instance for one tick before
  the DOM settles. Invisible for two years of this project's life because
  every schema used the same `rowsKey` ("rows"), so a mismatched
  schema/instance pair still happened to find `instance.rows`. DA
  2408-17's `verifRows`/`remarksRows` don't exist on a 2408-18/20
  instance, so the same transient mismatch now threw
  (`Cannot read properties of undefined (reading 'length')`) every time a
  user switched *away* from 2408-17. Fixed with a defensive
  `(activeInstance[section.rowsKey] || [])` at both read sites (the
  section-title row count, and the row `x-for` itself) — once schema and
  instance settle back into a matching pair on the next tick, behavior is
  identical; this only guards the one-tick window in between.
- **`sampleData`** for the "Auto-fill from source" simulation supplies
  entries for all three tables now — `verifRows` (exactly 6, `fixedRows`
  fixed-count invariant preserved) and `remarksRows` (exactly 13, only the
  first few populated, rest blank — realistic, since a real inventory
  record rarely uses every remarks slot). `runAutomateWorkflow` only
  replaces a table's rows if `sampleData` actually supplies that
  `rowsKey` — a fixed-count table with no corresponding sampleData entry
  (hypothetically) would simply keep its pre-seeded empty rows rather than
  erroring.

## Export All (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

The header button originally named "Print All" (still called that in
`00-pdfgen-vanilla` only) was renamed **"Export All"** in the other folders
and given one more step: after merging every form instance into one
combined PDF and rendering it into the preview panel (unchanged behavior),
it now also immediately calls the same action "Open PDF" performs —
opening the merged PDF in a new tab via a blob URL — so exporting the
whole document is one click instead of two (`exportAll()`, formerly
`printAllPreview()`).

`04-pdfgen-vanilla` generalizes which form types get merged: instead of
iterating the whole `FORM_TYPES` registry, it iterates the current
document's own document type's assigned form types (`documentTypeForms`,
in admin-sorted order — see "Admin-maintained registry" above), and
silently skips any assigned type with no PDF template yet (a template-
less custom type contributes nothing to export, not an error). The
preview panel's own standalone "Print" button (image-snapshot printing,
separate from "Export All"/"Open PDF") was removed from this folder —
reported as not useful — along with its now-dead `printRenderedPages()`
helper; "Open PDF" is the only preview-panel action left besides Refresh.

## Undo/redo (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`, `04-pdfgen-vanilla`)

Per-logbook undo/redo, in-memory only (not persisted — a page reload
starts a fresh history, which is standard for undo stacks and avoids
`localStorage` bloat from deep-cloned snapshots).

- `snapshotBeforeChange()` deep-clones the current logbook onto that
  logbook's undo stack (keyed by logbook id, so switching logbooks doesn't
  mix histories) and clears its redo stack, same as any standard undo
  model. It's called before every row add/remove/duplicate/reorder, form
  instance add/delete, "Auto-fill from source" run, and on `@focus` of any
  header/table text input — the last one groups an entire in-progress edit
  of one field into a single undo step instead of one per keystroke.
- Undo/Redo buttons sit in the toolbar next to "Auto-fill from source",
  disabled via `canUndo()`/`canRedo()`. A global Ctrl+Z / Ctrl+Shift+Z (or
  Ctrl+Y) shortcut also works, but is ignored while focus is inside an
  input/textarea/select so it doesn't fight the browser's own native
  per-field undo while actively typing. (This shortcut is also why the
  double-`init()` bug described in "Form-type registry as data" above was
  worth fixing everywhere, not just where it crashed visibly — a
  duplicated keydown listener means every Ctrl+Z press was silently
  undoing twice.)
- Restoring a snapshot re-points `activeInstanceId` at the restored data's
  first instance of the active form type if the instance that was open no
  longer exists there (e.g. undoing past the point it was created), and
  clears any stale preview.

## Reference documents

Two folders, split by whether the source PDF has real AcroForm fields —
the app needs to prove out both fill paths, so both need concrete
examples:

- `reference-acroform/` — PDFs with their original, working AcroForm
  fields intact (field names, widget rects). Drives the named-field
  fill path.
- `reference-plain/` — the *same* forms, same filenames, with the
  AcroForm flattened out (`form.flatten()` — fields removed, visual
  layout untouched, 0 fields). Drives the coordinate-based fill path.
  These aren't independently-sourced "generic" PDFs; they're the
  acroform copies deliberately stripped, so a field map built against
  one can be checked against the other's real widget positions.

Both folders hold the same 14 forms: A2408_5, A2408_5_1, A2408_12,
A2408_13, A2408_13_1, A2408_14, A2408_15, A2408_16, A2408_16_1,
A2408_17, A2408_18, A2408_19_2, A2408_20, A2410.

**Source note (don't re-waste time on this):** every one of these came
from `react_vite_app/public/*.pdf`, except `A2410.pdf` which came from
`DAForms_Vanilla/army-forms-pdfs/`. The *other* files under
`DAForms_Vanilla/army-forms-pdfs/` are corrupted at the PDF structure
level — pdf-lib fails on `getPageCount()` for every one of them
(`Expected instance of PDFDict, but got instance of undefined`), not
just missing fields. They are not usable as either AcroForm or plain
references; the `react_vite_app` copies are the good originals.

`01-pdfgen-vanilla-multi/assets/A2408_20_acroform.pdf` is a copy of this
folder's `A2408_20.pdf` (unmodified) — used there because that POC
needs 2408-20's *unflattened* AcroForm fields, unlike `00-pdfgen-vanilla`
which deliberately flattens it for the coordinate-fill path. Its field
names were inspected with pdf-lib and cross-checked against
`00-pdfgen-vanilla`'s already-validated coordinate map (every field's
widget rectangle matched the corresponding `HEADER_FIELDS`/`ROW_COLS`
position exactly) rather than re-deriving positions from scratch.

`02-pdfgen-vanilla-image/assets/A2408_18_flat.pdf` and `A2408_20_flat.pdf`
are copies of this folder's `reference-plain/` versions (0 fields,
confirmed via a pdf-lib probe) — that POC's whole point is the
coordinate path, so it needs the flattened templates, the mirror image
of `01-pdfgen-vanilla-multi`'s choice above. See "Form Type Editor" above
for how each form type's coordinate field map was sourced (2408-20
reused, 2408-18 freshly derived from `reference-acroform/`'s widget
rects). `03-pdfgen-vanilla-json` reuses these same bytes, just moved into
`form-types.json` instead of embedded in JS.

## Admin-maintained registry (`04-pdfgen-vanilla`)

`03-pdfgen-vanilla-json` fetches `form-types.json` read-only and hardcodes
fake `AIRCRAFT_MODELS`/`DOCUMENT_TYPES` arrays with only UH-60R + Logbook
actually wired up. `04-pdfgen-vanilla` replaces all of that with a mutable,
`localStorage`-backed registry, editable through the app by an admin
instead of by adding more code:

- **`aircraftModels`** — a plain string array.
- **`documentTypes`** — `{id, name, models: string[]}`; `models` is which
  aircraft models this document type applies to (the sidebar's document-
  type `<select>` only ever lists ones enabled for whichever model is
  currently picked).
- **`documentTypeForms`** — `{ [docTypeId]: string[] }`, an *ordered* list
  of form-type keys — which form types a document of this type contains,
  and in what order (sidebar listing, Export All grouping/merge order).
  Replaces `03`'s implicit assumption that every document contains every
  entry in `FORM_TYPES`.
- **`formTypeOverrides`** — label/banner-note edits, keyed by form-type,
  layered on top of whatever `form-types.json`/a custom type otherwise
  says (so editing a *built-in* type's label doesn't mean rewriting
  `form-types.json`).
- Admin-created form types themselves (`custom: true`, see the next two
  sections) persist separately from the fetched, still-read-only
  `form-types.json`.

An **"Admin" checkbox** in the header (simulated role check, in-memory
only, unchecked by default) reveals three sidebar panels: Aircraft models
(add/rename/delete), Document types (add/rename/delete, per-model
checkboxes, plus an "Assign & sort form types" sub-panel per type —
include/exclude + drag-to-reorder), and Form types (list, "+ New form
type," and — for a custom type — "Upload/Replace PDF"; see the next two
sections). The header's "+ New logbook" button/modal read "+ New
{document type}" — cosmetic only; the underlying `logbooks` array,
`openLogbook()`, the `STORAGE_KEY`, etc. all keep their names.

**A rename/edit gotcha worth remembering for any future admin UI in this
project**: `window.prompt()` is stubbed to always return `null` in
Electron-based renderers — which includes VS Code's own webviews —
while `alert()`/`confirm()` are patched to real dialogs there. A
`prompt()`-based rename will silently no-op in that environment with no
error at all. Every rename/edit flow in this folder (aircraft model,
document type, form-type label/banner) uses inline editing instead, the
same pattern this project already used for instance rename — not a
workaround specific to one environment, a strictly more robust default.

## Upload PDF workflow (`04-pdfgen-vanilla`)

A custom form type's field/table shape can come from a manual schema
builder (next section) or from uploading a real PDF, classified
mechanically (no AI/LLM involved) by what the file actually contains:

1. **Has real AcroForm fields** (`pdf-lib`: `form.getFields().length >
   0`) → each `PDFTextField`'s first widget rectangle is used directly —
   already an exact position, no guessing. Non-text field kinds
   (checkbox/dropdown/radio) are skipped; this app's schema model has no
   field kind for them yet. The form is then `flatten()`'d so the
   resulting template has zero live fields — this folder's fill engine is
   coordinate-draw only, so a leftover live field would just be dead
   weight, not a second fill path.
2. **No fields, but a real text layer** (`pdf.js`: any page's
   `getTextContent().items.length > 0` — true for a flattened/exported
   PDF like this project's own `reference-plain/` set, where the fields
   are gone but the original vector text/lines are still real) → text
   items are clustered into lines by y-position; any item ending in `:`
   is treated as a label, and the blank space to its right on that same
   line (capped at a max width) becomes its field box.
3. **Neither** (a genuinely scanned/photographed page) → zero candidates,
   but the real uploaded page still becomes the template, so the Form
   Type Editor opens with a real visual background to place fields
   against by hand rather than a blank canvas. Real OCR-based extraction
   for this case was discussed and deliberately deferred, not attempted.

Both extraction paths deliberately skip table/repeating-row detection
entirely — every candidate becomes a one-off header field; a real table
still requires the manual structure builder's "+ Add table." All three
paths converge on the same place: a new (or, via "Upload/Replace PDF" on
an *existing* custom type, an updated) form type with `templateB64` set,
landing in the Form Type Editor for review. Uploading to an existing type
is additive — new fields land in a single, reused "Extracted fields"
section rather than replacing anything already there, with key collisions
deduped.

Since extraction always misses some fields and invents some false ones,
the Form Type Editor gained an add/remove capability for header fields
("+ Add field", a per-field ×) — scoped to `custom: true` types only; a
built-in type's fields stay structurally fixed **in this folder**
(`05-pdfgen-database` later removes this restriction — see "Database
backend..." below). Saving a custom type's
editor session writes `editorDraft` straight into `schema.defaultLayout`
(replacing it wholesale) rather than layering it as an override the way
a built-in type's `fieldLayouts` entry does — a custom type has no
separate "real PDF original" layout worth protecting, so there's nothing
to layer on top of.

**Real bugs this surfaced, worth remembering** (all only reachable once a
form type has zero table/zero real page-2 the way a template-less custom
type commonly does — none of the built-in types ever exercised these
paths): `buildCoordinateCopies` assumed every schema has a `rows` array
and nonzero per-page row capacity (crashed on a header-only type — fixed
by defaulting to exactly one physical copy when capacity is zero); the
running "Page X of Y" stamp assumed every schema's layout has
`header.page`/`header.pageOf` keys, true only for the three built-in
types (fixed by only drawing it when they exist); and `drawStyledField`/
`drawOverlayImage`/the editor's page renderer all assumed a 2-page
front/back template, which a custom type's attached PDF is now often not
(fixed by clamping to the last real page instead of throwing).

## Manual form-type structure builder (`04-pdfgen-vanilla`)

A custom form type's fields/tables can also be authored directly, without
a PDF at all (or alongside one — see above), via one builder shared by
"+ New form type" (create) and a custom type's "Edit" (full structure,
not just label/banner — a built-in type's "Edit" still only touches
label/banner **in this folder**, since its structure is load-bearing
against real PDF-derived positions; `05-pdfgen-database` later removes
this restriction too — see "Database backend..." below):

- **Unlimited field groups** — pure UI grouping; a schema's header keys
  stay flat regardless of how many groups they're split across.
- **Unlimited tables** — the first table with any columns becomes the
  primary, growable one (`rowsKey: "rows"`, overflows onto extra physical
  copies once a template exists, exactly like every built-in type's main
  table); any table after that is a fixed row count instead, stored in
  `defaultLayout.extraTables` — reusing the exact multi-table machinery
  "Multi-table support, and DA 2408-17" above already proved out, not a
  parallel mechanism.
- **Editing** round-trips an existing type's current `sections` back into
  the builder, keeping every field/column's real key (and a table's real
  `rowsKey`) so Save can tell "already existed" from "new" and only
  regenerates keys for genuinely new rows. Save reconciles both
  `sections` and `defaultLayout` together — new rows get a placeholder
  position (same defaults the editor's own "+ Add field" uses), removed
  ones lose theirs, existing ones keep whatever position they already had
  (including anything already hand-tuned in the Form Type Editor).

A newly-added table's page-1 row capacity has no template to derive real
numbers from, so it starts at a placeholder — self-healed to a generous
default (`rows: 20, startY: 700, spacing: 20`) inside `getLayout()`
itself (read time, not just at creation), specifically so an
already-existing type with the old broken `rows: 0` placeholder starts
drawing its row data again the moment its layout is next read, with no
manual re-save required.

## Database backend, and table authoring inside the Form Type Editor (`05-pdfgen-database`)

`05-pdfgen-database` is a fork of `04-pdfgen-vanilla` (see "Repository
layout" above) that replaces `localStorage` with a real server + database
— see `server/` (Express, `better-sqlite3`) and its own `db.js` for the
schema. The frontend's persistence layer (`load()`/`loadRegistry()`/the
8 `persist*()` functions in `index.html`) now syncs to `/api/*` endpoints
via a small debounced `queueSync()` helper instead of `localStorage.setItem`
— everything else (the schema-driven UI, fill engine, admin registry) is
untouched. A "Saved to server / Saving… / Save failed" pill in the header
reflects the sync queue's live state.

**The built-in form types moved into the database too**, on request, after
first shipping this fork with them left as a static `form-types.json` (837KB
of schemas + base64 PDF bytes) — a deliberate scope decision at the time,
since nothing in the app ever writes to that data. A `form_types` table
(`server/db.js`) is seeded from `form-types.json` once, on first boot, if the
table is empty; the file is never read again after that (by the server or by
the browser — `index.html` no longer fetches it directly, `loadFormTypes()`
now reads `boot.formTypes` off the same `/api/bootstrap` response as
everything else). Still read-only from the app's own side, same as before —
no `PUT` endpoint for this table; a built-in type's label/banner override
still goes through `form_type_overrides`, and its structure still can't be
edited (only a `custom: true` type's can). `form-types.json` itself is left
in place on disk (harmless, just inert after the first boot) rather than
deleted, in case it's ever needed to reseed a fresh database.

This fork also closes two gaps in the custom-form-type workflow that only
existed in `04-pdfgen-vanilla`:

- **"+ Add table" in the Form Type Editor** — previously, adding a table to
  a custom type required leaving the visual editor for the separate
  Structure Builder modal. The editor's toolbar now has its own
  `+ Add table` (custom types only, same `editorSchema.custom` guard as
  `+ Add field`), plus a per-table `+ Add column` and a remove `×` on both
  table and column, in the field list (now grouped by table —
  `editorTableGroups()` — instead of one flat "Table columns" list). A
  table added this way is always a fixed-row "extra" table (the shape DA
  2408-17's Verification/Remarks lists use), never the primary growable
  table — the Structure Builder still owns that case. `confirmSaveEditor`
  reconciles these back into the schema's own `sections` via
  `reconcileCustomFormTypeTables`, mirroring `reconcileCustomFormTypeFields`
  for header keys — including the same "don't bake a disambiguation prefix
  into the saved label" trap that function already existed to avoid: an
  earlier version of this feature prefixed a multi-table custom type's
  column labels with their table's title for on-screen disambiguation
  (matching a precedent from `validateInstance`), but since a Save
  round-trips `editorLabels` straight back into `schema.sections`, that
  prefix was getting permanently baked into the stored label on every
  edit. Fixed by not prefixing custom types at all (matching the header
  field precedent) — the per-table grouping in the field list already
  disambiguates on screen, so the prefix was redundant besides being
  destructive.
- **Automatic table detection on "Upload PDF"** — `classifyAndExtractPdf`
  now returns `{ headerCandidates, tableCandidates, finalBytes }` instead
  of one flat candidate list, for both extraction paths:
  - **AcroForm** — reliable, confirmed against this project's own
    `reference-acroform/A2408_18.pdf` and `A2408_17.pdf`: a real repeating
    row shows up as multiple fields sharing a base name with a numeric
    suffix (LiveCycle's own convention — `InspNo`, `InspNo_1`, `InspNo_2`,
    ...; *not* the `[n]` widget-array index, which every field carries
    unconditionally as a constant instance suffix and was a red herring
    initially assumed to be the row signal). `extractAcroFormCandidates`
    groups fields by (page, base name), requires a *consecutive* 0,1,2,...
    run of that suffix to treat a group as a real column (ruling out a
    coincidentally `_N`-suffixed unrelated field), derives `startY`/
    `spacing` from the run's real Y positions, and `clusterColumnsIntoTables`
    merges columns sharing the same page/row-count/grid into one table.
    Verified end to end: uploading `A2408_18.pdf` correctly detects its
    real 14-row front-page and 15-row back-page tables (matching "Multi-table
    support" above's documented ground truth) instead of 29 flat fields.
  - **Vector-text (flattened) PDFs** — fuzzier by nature (no field names
    survive flattening at all): `extractVectorPdfCandidates` looks for a
    run of ≥3 consecutive text lines (outside anything already claimed by
    the existing label/blank extraction) whose item x-positions align
    within a few points, treating the first as a column-header row. This
    works and was verified against synthetic aligned text — but **finds
    nothing on this project's own `reference-plain/` files**, because a
    blank fillable template's data rows are empty ruled boxes (vector line
    drawing, invisible to text-content extraction), not text — there is
    nothing for a text-alignment heuristic to align against. It still
    helps for a flattened PDF whose table cells *do* contain visible text
    (e.g. sample/placeholder values). Detecting a purely blank grid would
    need a materially different approach (parsing the PDF content stream's
    line/rect drawing operators via `page.getOperatorList()`, not just
    `getTextContent()`) — not attempted here.

**Rendering rules these features had to learn the hard way** (see `history.md`
§27 for the full incidents):

- **A widget's box height is not its font size.** Form cells are routinely far
  taller than their text; the AcroForm extractor clamps derived font sizes to
  6–12pt and centres the baseline in the box, rather than trusting
  `height * 0.7` and `rect.y` raw.
- **`page`/`pageOf` are only the running "Page X of Y" stamp when they're
  layout-only keys.** An uploaded form's *extracted* fields very often include
  a real "PAGE" box; stamping into that spec overprints the user's own value.
- **An `x-for` `:key` over `schema.sections` must be unique within a schema
  AND different across schemas.** `section.title` isn't unique (auto-detected
  tables share a default title) and a bare index isn't schema-specific (Alpine
  then reuses one section kind's DOM node for another). It's keyed on
  `activeFormType + ':' + index`. A duplicate key here breaks reactivity for
  the *entire page*, not just the offending list — the same catastrophic
  failure mode "Form-type registry as data" above documents for `FORM_TYPES`.

**Built-in types (DA 2408-17/18/20) are now structurally editable the same
way a custom type is** — "Edit" always opens the full Structure Builder
(fields, tables, columns), and the Form Type Editor's `+ Add field`/
`+ Add table`/remove controls work for any type. Delete and Upload/Replace
PDF stay custom-only (a built-in type must not become deletable, and
swapping its real template is a separate, riskier action than structural
editing). Turned out to need almost no new code — `confirmFormTypeBuilder`'s
edit path and `openFormTypeBuilderForEdit` were already fully generic, keyed
by type, not a `.custom` flag; they already correctly preserved an existing
field/column's real position and a built-in type's real page-capacity when
only *some* fields change. The actual work was removing the `.custom` gates,
adding a `PUT /api/registry/form-types` write endpoint (`form_types`
mirrored `custom_form_types`'s read path but had no write one yet), and — the
harder part — three real bugs the extension surfaced, none reachable while
this only ever ran against custom types (see `history.md` §30):

- **The Structure Builder's edit path silently dropped the "Page X of Y"
  running-stamp keys.** It rebuilds `defaultLayout.header` purely from
  whatever's in the builder's own field-group list — but `page`/`pageOf`
  are layout-only keys that were never real `sections.fields` entries to
  begin with (see the rendering rule above), so they simply weren't in that
  rebuild. Every custom type never had these keys, so this never fired
  before. Fixed by carrying them forward from the prior layout untouched,
  same treatment as `page1`/`page2`/`overlays`.
- **A pre-existing, unrelated Alpine crash**, exposed only because editing
  a built-in type is the first thing that made this exact path (Form Types
  list → "Edit"/"+ New form type") get exercised thoroughly: two full-screen
  `.modal-backdrop` overlays were staying mounted simultaneously (the
  Structure Builder never closed the Form Types list modal underneath it —
  "Upload PDF" already did this correctly, "Edit"/"+ New form type" didn't).
  Fixed for consistency, but wasn't the actual cause of the crash itself.
- **The real cause**: a `<template x-if>` added for this feature's own
  template-risk warning text wrapped bare text directly, with no element
  child. Alpine's `x-if`/`x-for` need a `<template>`'s singular child to be
  an *element* (`template.content.firstElementChild`); a bare text node
  makes that lookup return `null`, and Alpine mounting onto that `null`
  threw `Cannot set properties of null (setting '_x_dataStack')` — every
  `<template x-if>`/`x-for` elsewhere in this file already wraps its content
  in a real element for exactly this reason. Fixed by wrapping the new
  warning text in `<span>`.

## Unified table row-capacity model: front/back/total, for every table (`05-pdfgen-database`)

Every table a schema declares — the primary (growable) table and any
fixed-count "extra" table alike — now carries the same three properties,
editable from both the admin **Structure Builder** and the visual **Form
Type Editor**, because real forms routinely run a table from the front
page onto the back: **max rows on the front page**, **max rows on the
back page**, and **total rows per instance** (the cap that decides when a
table's data needs another physical copy of the whole form, header
repeated — see "Fill engine" below). This generalizes what "Database
backend..." above already gave fixed-count tables alone (their own
`page1`/`page2` split, added when the auto form analyser's detected
tables needed manual fixing) to the *primary* table too, and unifies the
fill engine so any table can overflow, not just the one designated primary.

- **Schema shape**: `defaultLayout` gained a top-level `maxRows` (the
  primary table's own total-rows-per-instance cap), alongside its existing
  `page1`/`page2`. Defaults to `page1.rows + page2.rows` when unset — same
  self-heal precedent as `page1`'s own 0-capacity default just above.
  `normalizeExtraTable()` (unchanged) still normalizes an extra table's
  `page1`/`page2`/`maxRows` the same way.
- **Fill engine (`buildCoordinateCopies`) unified**: the primary table and
  every extra table are now walked as one list (`allTables`), each
  contributing to the document's physical-copy count via its own
  `maxRows` — `Math.ceil(tableRows.length / table.maxRows)`, maxed across
  every table. A table whose data never exceeds its own cap (every
  fixed-count table in practice, since none has an "add row" control)
  naturally has nothing to draw on copies past the first — no more
  special-cased `copyIndex === 0` gate for extra tables; a table simply
  slices an empty chunk once its rows are exhausted. This is a genuine
  simplification, not just new capability: the same per-table
  `page1`/`page2` splitting logic that extra tables already had now
  literally *is* how the primary table's overflow works too, instead of
  two parallel code paths.
- **Admin Structure Builder** ("+ New form type"/"Edit"): a table's single
  "Fixed rows" number was replaced with four controls, for *every* table
  (primary or fixed) — **Table shows on** (Front page / Back page / Both
  pages, a friendly selector that seeds a sensible front/back split — all-
  front, all-back, or an even split respectively) plus the three raw
  numbers themselves (front, back, total), independently fine-tunable
  afterward. Real per-page `startY`/`spacing` positioning stays the Form
  Type Editor's job, same division of labor as before (Structure Builder =
  shape, Form Type Editor = position/style) — editing row counts here
  never disturbs whatever position a table already had.
- **Form Type Editor's Row Grid panel unified**: previously the primary
  table's per-page row count was a read-only caption ("N rows on this
  page, fixed by the physical form layout") while only fixed-count extra
  tables got editable front/back/total fields (added when "Database
  backend..." first gave extra tables a page1/page2 split). Since built-in
  types are now fully structurally editable anyway (the "Built-in types...
  structurally editable" section above), the primary table's row counts
  are editable here too now, through the exact same three fields —
  `editorCurrentTable()` resolves to whichever table a selected column
  belongs to (an extra table's own record, or `editorDraft` itself for the
  primary table, since both carry `page1`/`page2`/`maxRows` in the same
  shape) so one code path, one panel, serves both.
- **Document data-entry view**: each table section's header now shows its
  own front/back/total counts at the top right (`tableCapacityLabel()`,
  reading the active schema's real layout via `getLayout()`, not just the
  schema definition — a saved Form Type Editor override changes what's
  shown here without touching `sections`), so a user filling in a table
  can see, at a glance, how close they are to triggering a new physical
  copy.
- **Scope decisions confirmed before building** (both matter for anyone
  extending this further): exceeding "total rows per instance" generates
  another **physical copy of the same Form instance** (header repeated,
  "Page X of Y" increments) — not a brand-new separate instance in the
  sidebar; and a column's **style** (font family/size/bold/italic/allow-
  overflow) stays shared across its front-page and back-page printing —
  only *position*/spacing differ per page, not appearance.

## Form Type Editor: on-canvas labels reflect real position and style (`05-pdfgen-database`)

A field/column's label used to float in a small fixed-style tag *above*
its box (`.editor-box-label`, always 9px bold, editor-chrome colored) —
readable, but telling you nothing about how the field will actually
print. It now renders *inside* the box itself, in the field's own font
family, size, weight, and italic setting (`editorBoxStyle()` maps the same
`fontFamily`/`bold`/`italic` values the fill engine draws with to real
CSS — `Helvetica`→a sans stack, `TimesRoman`→a serif stack, `Courier`→a
monospace stack — clamped to a legible minimum size for the editor UI).
Lets an admin see, directly on the rendered PDF background, both *where*
a field sits and roughly *how* it will look, in one glance instead of two.

## Form Type Editor: field type + output formatting (`05-pdfgen-database`)

A header field or table column's data **type** (text/number/date) and its
type-specific output options are now editable directly in the Form Type
Editor's properties panel — previously this was only settable through the
separate admin Structure Builder, and two of the three sub-options (max
characters was invisible everywhere; decimal places and a date output
format didn't exist at all) had no UI anywhere in the project.

- **New properties on a field/column's `validation` spec**: `maxLength`
  (text — already existed, just newly surfaced here), `decimals` (number
  — new), `dateFormat` (date — new, one of a handful of presets: "As
  entered" i.e. no reformatting, `M-D-YY`, `MM/DD/YYYY`, `YYYY-MM-DD`,
  `DD MMM YY`). Purely a **fill-time/print** concern — the stored value
  itself is never rewritten, same precedent as the native date input
  (`looksLikeDate()`'s leniency is untouched): a field always keeps
  whatever string the user actually typed; only what gets *drawn onto the
  PDF* changes.
- **`editorValidation`** (`{ header: {}, col: {} }`) is a new piece of
  editor-session state mirroring `editorLabels` exactly — seeded from the
  schema's current `validation` when the editor opens, edited via
  `editorSelectedValidation()` in the properties panel, reconciled back
  into `schema.sections` on Save by the same functions that already
  reconcile labels (`reconcileFormTypeFields`, `reconcileFormTypeTables`)
  plus a new **`reconcilePrimaryTableColumns`** — the primary (growable)
  table's own columns had *no* reconciliation path back into
  `schema.sections` at all before this (its key set can't change from
  this editor, so nothing needed one), meaning a label or type edit on a
  primary column would previously have been silently lost on Save.
- **Fill engine**: `buildCoordinateCopies` now takes the `schema` itself
  (not just its `templateB64`) so it can look up each field/column's
  `validation` (`headerFieldSpec`/the new schema-wide `columnSpecByKey`)
  and run the value through `formatValueForType()` before drawing —
  `toFixed(decimals)` for a number, a parsed-and-reformatted date via
  `parseLenientDate()`/`formatDateForOutput()` for a date with a real
  output format configured, a defensive `slice(0, maxLength)` for text
  (the data-entry input's own `:maxlength` is the primary guard; this
  just guarantees the same cap regardless of how a value got there —
  sample data, a saved Default, an import — matching this project's own
  AcroForm-path precedent for the identical guarantee, history.md §6).

**Two real bugs found by testing this, both fixed**:

- **Date-format token collision.** `formatDateForOutput` originally chained
  sequential `.replace()` calls (YYYY, then YY, then MMM, then MM, DD, M,
  D) — but a month abbreviation can itself contain a letter a *later*
  token in that chain would also match (`"MAR"` has a bare M, `"DEC"` has
  a bare D), so a previously-substituted month name got corrupted by a
  later pass: `"DD MMM YY"` produced `"05 3AR 26"`, not `"05 MAR 26"`.
  Fixed with a single regex pass (`/YYYY|YY|MMM|MM|DD|M|D/g` with a
  replacer callback, longest-alternative-first) — each character position
  is consumed exactly once, so substituted text can never be re-scanned.
- **`reconcileFormTypeFields` was promoting `page`/`pageOf` into real
  schema fields on every Save, for every type.** These two are the
  running "Page X of Y" stamp's layout-only keys (see "Fill engine" in
  "Database backend..." above) — always present in `editorDraft.header`
  (the stamp needs a position) but never meant to be real
  `schema.sections` fields unless a type genuinely has one (e.g.
  extracted from an uploaded PDF's real "PAGE" box). The reconcile
  function blindly turned *every* `editorDraft.header` key into a real
  field, which — caught only by actually saving through the visual editor
  for a built-in type, not by re-reading the code — then makes
  `emptyInstance()` seed `form.header.page`/`.pageOf` with real
  (empty-string) data, and `buildCoordinateCopies` only draws the
  automatic stamp when that key is *absent* from `form.header`. Net
  effect: saving *any* field edit through this editor, for any type,
  silently disabled the running page stamp for every instance created
  afterward. Fixed by excluding `page`/`pageOf` from promotion unless one
  already was a real field before this reconcile ran.

## Bug: adding a form type to a document type after documents already exist (`05-pdfgen-database`)

A form type's data lives on each document as one array per form type
(`forms<Type>`, per "UI architecture" above), created once — by
`emptyLogbookForms` — at the moment a document is first made, seeded only
for whichever form types were assigned to its document type *at that
time*. "Forms in this document" (the sidebar list) is driven by a
document type's *current* assignment (`documentTypeForms`, via
`formTypesFor`/`formTypesInCurrent()`), independent of what arrays a given
document actually has — so assigning a form type to a document type
*after* documents of that type already exist correctly makes the new type
show up in every one of them, with its sidebar count sitting at "(0)" (`
instancesOf()` already defended with `|| []`). But `addFormInstance` (the
"+" button) assumed the array already existed and called `.push()`
straight on it, crashing (`Cannot read properties of undefined
(reading 'push')`) the moment anyone tried to actually create the first
instance of that newly-assigned type on a pre-existing document. Fixed by
having `addFormInstance` lazily create the array on first use if missing
(`deleteFormInstance` got the same defensive fallback, though it isn't
reachable in practice — deleting requires an instance to already exist,
which requires `addFormInstance` to have succeeded first).

## Non-goals (for now)

- OCR-based field detection for a scanned/photographed PDF with no real
  text layer — `04-pdfgen-vanilla`'s "Upload PDF workflow" (above) does now
  do automatic extraction for the other two cases (real AcroForm fields;
  a flattened/vector PDF's real text layer), both deterministic and
  AI-free, but a genuine scan still just opens the placement UI manually,
  against the real page as a visual reference.
- Automatic table/repeating-row detection during PDF upload, in
  `04-pdfgen-vanilla` — every extracted candidate is still a one-off
  header field there; a real table still needs the manual structure
  builder's "+ Add table." (`05-pdfgen-database` no longer has this
  limitation — see "Database backend, and table authoring inside the Form
  Type Editor" above, though its vector-text detection has its own real
  limitation described there.)
- Round-trip import from a filled flat PDF — there are no fields left to
  read back after drawing text, so the app's own data model is the source
  of truth, not the PDF.
