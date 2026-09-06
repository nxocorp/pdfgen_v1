# PDF-gen

See `history.md` for a detailed, chronological account of how this
project got here — the reasoning behind decisions below, dead ends
that were investigated and ruled out, and things discussed but not yet
formalized into a file (e.g. a draft Postgres schema).

## Repository layout

This project spans six sibling folders under `DEVELOPMENT/`:

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
- **`pdfgen-spring/`** — empty, reserved for the future Spring Boot
  backend.

## Four vanilla POC tracks — why there are four `NN-pdfgen-vanilla*` folders

None of these are a superseded-vs-current pair — each is deliberately
answering a different question, and all four are worth keeping:

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

If a future change only concerns one of these questions, it likely
only needs one of the four folders touched. `02-pdfgen-vanilla-image` and
`03-pdfgen-vanilla-json` in particular track each other closely (the
latter is a near-direct fork of the former) — a fix to the shared app
shell (undo/redo, Defaults, preview panel, etc.) found in one should
usually be checked against the other.

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

## UI architecture: schema-driven forms (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`)

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
`01-pdfgen-vanilla-multi`'s version specifically — `02-pdfgen-vanilla-image` and
`03-pdfgen-vanilla-json` evolved the same gear icon into a full **Form Type
Editor** (below) that edits field *position* as well as styling, since the
coordinate fill path actually needs both.

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

## Form Type Editor (`02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`)

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

## Field & form validation, and Mark complete (`03-pdfgen-vanilla-json`)

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

## Overlays: images and text boxes on the Form Type Editor (`03-pdfgen-vanilla-json`)

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

## Sidebar: collapsible instance lists and inline rename (`03-pdfgen-vanilla-json`)

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

## Export All (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`)

The header button originally named "Print All" (still called that in
`00-pdfgen-vanilla` only) was renamed **"Export All"** in the other three
folders and given one more step: after merging every form instance into
one combined PDF and rendering it into the preview panel (unchanged
behavior), it now also immediately calls the same action "Open PDF"
performs — opening the merged PDF in a new tab via a blob URL — so
exporting the whole document is one click instead of two
(`exportAll()`, formerly `printAllPreview()`).

## Undo/redo (`01-pdfgen-vanilla-multi`, `02-pdfgen-vanilla-image`, `03-pdfgen-vanilla-json`)

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

## Non-goals (for now)

- Automatic field detection (OCR/heuristics) — the placement UI is manual
  first; auto-suggestion can layer on top later, not replace it.
- Round-trip import from a filled flat PDF — there are no fields left to
  read back after drawing text, so the app's own data model is the source
  of truth, not the PDF.
