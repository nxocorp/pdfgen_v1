# PDF-gen — Conversation History

A detailed record of how this project came together, in the order it
happened. `CLAUDE.md` holds the current state/decisions; this file holds
the narrative — why things are the way they are, and what was tried
along the way.

## 1. Origin — reading a blank DA form

The conversation started with a simple question: can Claude read a blank
PDF (`A2408_5_1.pdf`, DA Form 2408-5-1, Equipment Modification Record).
It could — that led to a broader question: is there a tool to add
fillable fields to a PDF (or image) that doesn't have any.

## 2. Scoping the idea

Recommended a **render → detect → place** pipeline (pdf.js render,
OCR/heuristic suggestions as an assist rather than the primary
mechanism, a human-in-the-loop box-placement UI, pdf-lib to write real
AcroForm fields). Landed on: build it as a browser app, since an
existing project (`react_vite_app`, a DA-forms logbook app) already
proved out filling named AcroForm fields via a `FillContext`
abstraction (`field-customization.ts`) — the new idea, PDF-gen,
generalizes that to PDFs that never had fields to begin with, using a
coordinate-based field map instead of field names.

Then pivoted to: "I already built a frontend for AcroForm PDFs — I want
to upgrade it for generic PDFs." Reviewed `react_vite_app`'s actual
architecture (`types.ts` + `Editor.tsx` + `pdf-fill.ts` per form type,
`field-customization.ts` as the shared `FillContext`) and proposed
extending it with a parallel coordinate-based `FillContext` variant,
plus a visual field-placement tool to author the coordinate maps (since
there's no AcroForm to introspect for a generic PDF).

## 3. Project scaffolding

Created `D:\WORKSPACE\DEVELOPMENT\PDF-gen\` with a `CLAUDE.md` capturing
vision/mission. Iteratively refined it as decisions were made:

- **Stack**: Angular + Spring Boot leaning (not final), PostgreSQL as
  system of record, localStorage as a frontend cache (pull on load,
  edit locally, queue+flush to backend — not the source of truth).
- **Domain model**: Aircraft Model → Document Type → Document → Forms.
  A Document Type (e.g. "Logbook") defines which Form types it
  contains; a Document is one instance (a specific aircraft's logbook);
  a Form is one field-mapped PDF within it. Customer flow: pick model →
  pick document type → pick a Document (existing) or create new
  (blank or from a saved Default) → enter data across the document's
  forms → generate PDFs.
- **Validation**: field-level (per-field rules) vs. cross-document
  uniqueness (e.g. serial numbers unique per document-type+aircraft —
  flagged as needing a server round-trip, not resolvable from the
  localStorage cache alone).
- **Defaults**: renamed from "template" (which was already taken for
  the structural PDF+field-map concept) to **Default** — a saved,
  reusable snapshot of filled-in data. Initially scoped ambiguously
  (per form type or per document type?); later resolved in favor of
  **document type**, confirmed once `00-pdfgen-vanilla` actually
  implemented it — a Default now bundles every form type in the
  document, not just one.
- **Two-path fill engine**: recognized explicitly that the app must
  support both AcroForm named-field fill (`react_vite_app`'s approach)
  and coordinate-based fill (drawing text at authored x/y positions) —
  real source PDFs arrive both ways, and it's not a migration off one
  approach, it's handling whichever a given document has.

Reference PDFs were copied in for concrete test cases as the
conversation progressed (`A2410.pdf`, `A2408_20.pdf`, then the full DA
2408 series from `DAForms_Vanilla/army-forms-pdfs/`).

**Important discovery**: the PDFs under
`DAForms_Vanilla/army-forms-pdfs/` are corrupted at the structural
level — pdf-lib fails on `getPageCount()` for every one of them except
`A2410.pdf` (`Expected instance of PDFDict, but got instance of
undefined`). The *working* originals for the rest of the DA 2408 series
live in `react_vite_app/public/*.pdf`. This cost some backtracking
(the first-copied `A2408_20.pdf` reference was the broken version) and
is now called out explicitly in `CLAUDE.md` so it isn't re-discovered
the hard way again.

Once this was clear, the reference PDFs were reorganized into two
folders: `reference-acroform/` (the 14 working PDFs with their real
AcroForm fields intact) and `reference-plain/` (the same 14 forms,
same filenames, with `form.flatten()` applied — fields stripped,
layout untouched) — because the app needs concrete examples for *both*
fill paths, not just one.

## 4. Visual mockup

Before writing app code, built a static design mockup (Claude Design
canvas / Artifact) of what the app could look like: left sidebar
(organization/navigation), center (form entry), right (PDF preview) —
per the user's steer. Iterated across several rounds:

1. **Main workspace** — sidebar with template list, center form entry
   (DA 2408-17 as the example), right PDF preview panel.
2. **Request data dialog** — the automated-workflow entry point,
   triggered from inside the manual form (not a separate mode toggle),
   asking for a data source + params before fetching.
3. **Visual field editor** — the coordinate field-placement tool
   itself: page canvas with draggable/resizable field boxes, a
   properties panel (key, type, x/y/w/h, font/size/alignment), a
   fields list grouped by page/row.
4. **Intake dialog** — upload a blank PDF, see an analysis checklist
   (reading file, rendering pages, detecting page size, suggesting
   field candidates), then hand off to the visual editor.
5. **Dark theme** — added for the Main workspace only (chrome goes
   dark, the "paper" — the form sheet and PDF preview page — stays
   white, matching how document editors like Acrobat/Word handle dark
   mode).
6. **Missing step added**: a **Documents** picker between the
   Document Type select and the forms list — list of existing
   document instances for the selected model+type (with an "OPEN"
   badge on the current one) plus a "+ New document" button; the
   existing forms list was relabeled "Forms in this document" and the
   old "New template" button renamed "New form template" to
   disambiguate from "New document."
7. **Aircraft Model / Document Type selects** added to the sidebar
   with fake test values, plus a lightweight hint at a future
   folder-organization step for document types ("Records / Logbook").

The mockup is published as a Claude Artifact (multi-artboard canvas);
its working `.dc.html` source files and `canvas.json` live in
`PDF-gen/mockup/`.

## 5. Database schema discussion (design only — no file created)

Walked through a concrete Postgres schema recommendation in chat,
grounded directly in the domain model above:

- `aircraft_models`, `aircraft` (a specific tail number, not just the
  model), `document_types` (self-referencing `parent_folder_id` for
  the folder-organization idea), `model_document_types`.
- `form_types` (one row per form type, e.g. DA 2408-20, holding
  `field_map jsonb` + `version`), `document_type_forms` (the
  composition — which form types a document type contains, with
  `min_instances`/`max_instances` for cardinality).
- `documents`, `form_instances` (`header_data jsonb` for the
  non-repeating fields + a `form_type_version` stamp so old documents
  keep rendering correctly even after a field map moves on later).
- **Key resolved design point**: row-overflow across PDF pages (e.g.
  DA 2408-20's 20-row table) is a *fill-time computation*, not a new
  database row. All rows for one logical form instance live in a
  `form_instance_rows` child table (`row_number`, `data jsonb`); the
  fill engine decides how many physical page-copies to render based on
  the form type's per-page row capacity. This was validated against
  the user's own example (25 rows → a second physical copy, sharing
  the same header) and later confirmed for real against DA 2408-20's
  *actual* field layout: **12 rows on the front page, 8 on the back**
  (not the 9/11 the user had estimated from memory).
- **Cross-document uniqueness** is enforced via a narrow side table,
  `indexed_field_values` (populated only for fields the field map
  flags `unique: true`), rather than full EAV — a real DB unique
  constraint gives `ON CONFLICT` enforcement at write/sync time without
  forcing every field into a relational column.
- Worked through example queries: "all records for this form type for
  a given aircraft" and "all data for an aircraft's logbook" (the
  latter using a `LEFT JOIN` from `document_type_forms` so form types
  with no data yet still show up as empty, for completeness checks).
- Showed an example `header_data` / row `data` JSONB shape for DA
  2408-20, using the same dotted field-map keys the fill engine
  already uses (`endItem.serialNumber`, `hours.component`, etc.) so
  there's no translation layer between stored data and the fill loop.

None of this was written to a schema file — it's a design conversation,
captured here for reference. **Not yet folded into `CLAUDE.md`** as a
formal schema section; worth doing once the schema is actually
implemented, or if asked again.

## 6. `00-pdfgen-vanilla` — the functional POC

Created two new sibling folders under `DEVELOPMENT/`:
`pdfgen-spring/` (empty, reserved for the future Spring Boot backend)
and `00-pdfgen-vanilla/` (a working proof of concept).

**Initial build** — a single self-contained `index.html` (Alpine.js +
pdf-lib.js via CDN, `localStorage` persistence), scoped deliberately
narrow: only the **UH-60R** aircraft model, only the **Logbook**
document type, only the **DA 2408-20** (Oil Analysis Log) form type.

Getting the fill engine right took real investigation:

- Confirmed via pdf-lib that `DAForms_Vanilla`'s `A2408_20.pdf` has 0
  usable fields and is structurally broken (see §3) — used
  `react_vite_app/public/A2408_20.pdf` (a working AcroForm copy, 172
  fields) instead.
- Extracted that PDF's **real widget coordinates** via pdf-lib
  (`getWidgets()` → rectangles), then called `form.flatten()` on it to
  produce a genuinely non-fillable "generic" PDF — so the POC
  authentically demonstrates PDF-gen's actual mission (coordinate-fill
  on a PDF with no fields), using real, pixel-accurate positions rather
  than guessed ones.
- Built the field map (header fields + a repeating-row template, front
  page 12 rows / back page 8 rows = 20 per copy) and a fill engine that
  chunks rows into additional 2-page copies as needed, stamping shared
  header data and computed `Page X of Y` on each. Verified with a
  25-row smoke test (correctly produced 2 copies, 20 + 5 rows split).
- The blank flattened template is embedded in the HTML as base64 so
  the file works fully offline (aside from the two CDN script tags).

**Iteration 1 — layout + Defaults**: rebuilt the UI to the 3-pane
sidebar/center/preview layout (matching the earlier mockup, which the
first pass had missed), and added a "new logbook: blank or from a
saved Default" flow plus a "Save as default" action.

**Iteration 2 — collapsible panels, Aircraft Model/Document Type
selects**: made the left sidebar collapsible (slim toggle strip) and
changed the right preview panel to be hidden by default, only opening
via a renamed **Print Preview** button (with its own Refresh / Print /
close controls inside). Added the Aircraft Model and Document Type
`<select>` fields to the sidebar with fake test options (UH-60R/UH-60M/
MH-60R/MH-60M/AH-64D/AH-64E; Logbook/SN Book/Maintenance Record/
Historical Record) — only UH-60R + Logbook is actually wired up; any
other combination shows a "not implemented in this POC" note instead
of the logbook list.

**Bug found and fixed — mobile preview/print**: on a phone (Android
Chrome), the PDF preview showed a generic black "Open" card instead of
the document, and Print did nothing. Root cause: mobile browsers don't
have an inline PDF renderer for `<iframe src="blob:...">` — that card
*is* Chrome's native "can't display this" fallback, and
`iframe.contentWindow.print()` had nothing real to print. Fixed by
rendering each page to a `<canvas>` via **pdf.js** (works identically
on every platform) and reimplementing Print as a small popup window
built from `<img>` tags (canvas → `toDataURL()`) with `window.print()`
— no dependency on any browser's native PDF viewer.

**Feature — a second form type, `00-pdfgen-vanilla` proves both fill
paths**: added **DA 2408-18** (Equipment Inspection List) as a second
form type in the UH-60R Logbook, deliberately using the *AcroForm*
named-field path (vs. 2408-20's coordinate path) — the app now
exercises both fill engines for real, not just in theory. A tab bar
switches between the two forms. Investigation notes:

- Inspected the real field names via pdf-lib: header (`Page`,
  `Pageof`, `Nomen`, `Model`, `SerNo`) + a 14-row front-page table
  (`InspNo`/`Item`/`REF`/`FREQ`/`NextDue`/`CompAt`) + a 15-row
  back-page table that — a quirk of how the original LiveCycle form
  was authored — reuses *different* field base names
  (`ModelA`/`ItemA`/`REF_A`/`FREQ_A`/`NextDueA`/`CompAtA`) for the
  *same* visual columns. Confirmed this by reading the actual rendered
  page text, not just guessing from field names (14 + 15 = 29 rows per
  copy).
- **Real bug caught during smoke-testing**: pdf-lib **throws** (not
  truncates) when a value exceeds a text field's `maxLength` — the
  `InspNo` field has `maxLength: 5`, and test values like `"INS-10"`
  (6 chars) were silently swallowed by an overly broad `try/catch`.
  Fixed with an explicit truncate-to-`maxLength` helper (matching the
  precedent already established in `react_vite_app`'s
  `field-customization.ts`), verified by re-running the 35-row smoke
  test and visually confirming every row's value now appears correctly
  across both copies.
- Resolved the "Defaults" scoping question from §3/CLAUDE.md
  concretely: a saved Default now snapshots *both* forms together
  (`cloneLogbookForms`), not one form type at a time.

**Feature — Print All**: a button in the top header (not the per-form
toolbar) that runs both forms' fill engines independently, then merges
their output pages into one combined PDF via `PDFDocument.copyPages` —
shown in the same right-hand preview panel. Verified: produces the
2408-20 pages followed by the 2408-18 pages, values correct in both.

**Feature — row duplicate + drag-reorder**: both row tables (2408-20
and 2408-18) got a drag handle (⋮⋮, native HTML5 drag/drop — on a
dedicated handle cell, not the whole row, so it doesn't fight with
text-input selection) and a duplicate-row icon next to delete.
Generalized `addRow`/`removeRow`/`duplicateRow`/drag handlers to
operate on "whichever form tab is currently active" via an
`activeFormKey()` helper, rather than hardcoding `form2408_20`.

**Debugging detour — apparent broken rendering**: the user reported the
live page (via VS Code Live Server) showing raw JS source text
rendered as page content, starting partway through `printRenderedPages`.
Investigated thoroughly: searched the raw file for a stray `</script`
(the only mechanism that could make a browser's HTML parser stop
treating `<script>` content as code and start rendering it as text) —
found exactly 4 occurrences, all legitimate (3 CDN tags + the one real
closing tag). Re-ran the full inline script through Node's syntax
checker (clean) and checked tag-balance counts (`div`/`template`/
`aside`/`table`/`tbody`/`tr`, all matched). Concluded the file itself
is not structurally broken and the symptom was most likely a stale
cached copy in that browser tab (this file has been rewritten via Live
Server many times in one session) — recommended a hard reload and
offered to dig further if it recurs after that.

## 7. `00-pdfgen-vanilla` — splitting form-type code into `js/` files

Purely structural, no behavior change: asked to move each form type's
implementation out of the single inline `<script>` in `index.html` and
into its own file. Extracted per form type into `js/form2408-20.js`
and `js/form2408-18.js` — each holding that type's embedded base64
template, field map (coordinates for 2408-20, AcroForm field names for
2408-18), empty/clone model factories, and its own fill-engine
function — while the shared app shell (Alpine state, storage keys,
logbook-level model, preview rendering, `buildCombinedPdf`) stayed
inline in `index.html`. Loaded via two `<script src="js/...">` tags
ahead of the main inline script; load order doesn't actually matter
since the only cross-file dependency (`b64ToBytes`, defined inline) is
referenced inside function bodies, not at parse time. Extracting the
two giant base64 template strings without pushing their content
through the conversation took a small technique worth remembering: an
empty-directory `Write` with a placeholder string, then a `sed`/`awk`
patch that copies the real base64 line from the original file straight
into the new file on disk — the actual PDF bytes never appear in the
chat transcript. Verified with Node's `--check` on all three scripts
and a full Playwright smoke test (create logbook, fill both form
types, Print Preview each, Print All, add/reorder rows) against a
local `python -m http.server`, confirming byte-identical behavior to
the pre-refactor file.

## 8. Sidebar-driven form types + multi-instance forms (`00-pdfgen-vanilla`)

Three related requests, all against the still-single-instance
`00-pdfgen-vanilla`:

1. **Form-type tabs moved from the center pane into the sidebar**,
   listed in numeric order (2408-18 before 2408-20) below the logbooks
   list, matching the earlier design mockup's "Forms in this document"
   pattern (§4) that the original build had missed.
2. **Multiple instances per form type** — the data model changed from
   `current.form2408_20` (a single object) to `current.forms2408_20`
   (an array), same for 2408-18, with a migration step in `load()` so
   existing localStorage data in the old shape doesn't break. The
   sidebar's "Forms in this document" section shows each type's
   instance count and a `+`/`×` to add/remove instances; the center
   pane edits whichever instance is selected via `activeFormType` +
   `activeInstanceId` rather than a single `activeForm` string.
3. **Print All grouped by form type in numeric order** (all 2408-18
   instances, then all 2408-20 instances, each type's own instances in
   sidebar order) — `buildCombinedPdf` rewritten to iterate `FORM_TYPES`
   (numeric order) then each type's instance array, instead of one
   hardcoded call per type.

Verified with Playwright: added two instances of each type, confirmed
sidebar counts, confirmed the combined "Print All" page count matched
the expected total across all instances, confirmed the correct
grouping order in the rendered preview.

## 9. Drag-to-resize Print Preview panel (`01-pdfgen-vanilla-multi`, later ported conceptually)

A thin `.preview-resizer` handle between the center pane and the
preview panel, driven by a plain `mousedown`/`mousemove`/`mouseup`
drag (no library) updating an Alpine `previewWidth` bound via inline
`style`, clamped 260–900px. Verified by scripting an actual
mouse-drag sequence in Playwright and reading back the panel's
bounding-box width before/after/at the clamp limits.

## 10. Architecture discussion — moving toward a schema-driven UI

Asked whether the (by-then duplicated, one card per form type)
center-pane markup could move into each form type's `js/` file
instead. Pushed back on a straight HTML-into-JS move (Alpine needs
directives present in the DOM at parse time; moving markup into JS
strings would mean manual `Alpine.initTree()` injection for no real
gain, since the CSS in question wasn't actually form-specific).

The user's own counter-proposal — informed by the real constraint that
the production app needs to support **many form types and many
document types**, and possibly **data structures not tied to a form
type at all** — was better: instead of moving HTML, replace the
hardcoded per-form-type cards with **one generic fields/table renderer**
driven by a **declarative schema** per form type (sections, field
lists, column lists), colocated with that form type's model/fill-engine
in its own file. Agreed this was the right direction: it directly
serves the "many form types" scaling need, and a schema with no
attached fill engine is trivially able to describe an app-only data
structure later, which a hardcoded-markup approach couldn't do for
free.

## 11. `01-pdfgen-vanilla-multi` — the schema-driven, AcroForm-only, multi-instance POC

A **new sibling folder**, not a rewrite of `00-pdfgen-vanilla` in place —
deliberately kept separate since the two POCs answer different
questions (see "Two POC tracks" in `CLAUDE.md`). Built from scratch
with everything `00-pdfgen-vanilla` already had (logbooks, Defaults,
Print Preview/Print All, collapsible sidebar, row duplicate/reorder),
plus the new architecture, with two scope changes requested up front:

- **Both form types use the AcroForm named-field path** — no
  coordinate path in this folder at all. This meant 2408-20 (which
  `00-pdfgen-vanilla` only ever used in its *flattened* coordinate form)
  needed its real, unflattened AcroForm fields for the first time.
  Copied `PDF-gen/reference-acroform/A2408_20.pdf` in as
  `assets/A2408_20_acroform.pdf`, then inspected its field names with
  pdf-lib in a throwaway probe page (driven headlessly via the
  already-installed Playwright/Chromium, no npm install needed) and
  cross-checked every field's widget rectangle against `00-pdfgen-vanilla`'s
  already-validated coordinate map (`HEADER_FIELDS`/`ROW_COLS`/
  `PAGE1_ROW_Y`/`PAGE2_ROW_Y`) — every position matched exactly,
  confirming the field-name mapping without re-deriving positions from
  scratch. Found the same LiveCycle row-numbering quirk as 2408-18
  (front-page columns and back-page columns use different base names
  for the same visual column, e.g. `COMP` front / `COMP_A` back).
- **Only the AcroForm versions** of both source PDFs are used (no
  `A2408_18_acroform`/flattened split like `00-pdfgen-vanilla`'s
  `reference-acroform`/`reference-plain`) — matches the "both form
  types use the AcroForm path" scope above.

**Schema-driven UI, generalized once for both form types**: each
`js/form-XXXX.js` now exports a schema object (see "UI architecture"
in `CLAUDE.md`) instead of hardcoded markup; `index.html` renders it
through two generic partials (a "fields" section, a "table" section).
A side effect worth noting: Alpine's `x-model` sugar needs a static
binding path, so the generic renderer binds header/row inputs via
`:value` + `@input` instead — functionally equivalent, just more
verbose per field. Also generalized the AcroForm fill engine itself:
since both form types now share the exact same "set named fields,
handle row overflow via extra copies" shape, that whole loop lives
once as `buildAcroFormCopies`/`mergeAcroFormDocs` in `index.html`,
and each form type's file supplies only its field-name config (~20
lines) rather than its own copy of the loop.

**Multi-instance data model carried over from §8**, generalized further:
`emptyLogbookForms`/`cloneLogbookForms`/`emptyLogbook` now iterate the
`FORM_TYPES` registry instead of hardcoding the two current form
types, so a new form type needs zero changes to the logbook-level
model code.

**Bug found and fixed — generated PDFs were flattened.** The user
noticed the "AcroForm-only" scope wasn't actually producing
interactive PDFs — every output was flattened, contradicting the
whole point of using the AcroForm path. Root cause: the fill engine
called `form.flatten()` after setting values (a leftover habit from
wanting the in-app pdf.js canvas preview to render correctly without
extra work). Investigated properly before just deleting the call:

- Confirmed via a pdf-lib probe that `PDFDocument.copyPages()` alone
  (needed to merge row-overflow copies, or several instances for
  "Print All") copies a page's field/widget objects but does **not**
  register them in the new document's `/AcroForm` — so simply removing
  `flatten()` would have produced a PDF whose fields are inert
  (present but not interactive), no better than flattening in effect.
- Confirmed a second, sharper problem: if two merged sources share a
  template (two overflow copies of one instance, or two instances of
  the same type in "Print All"), their fields end up with **identical
  fully-qualified names** once merged — demonstrated concretely that
  `getTextField()` on the merged, reloaded PDF always resolved to the
  *first* match, silently losing the second copy's independent value.
- Fixed both together: after `copyPages()`, walk each copied
  field/widget up its `/Parent` chain to find its top-level field
  ancestor, rename every source's ancestor after the first (so merged
  names stay unique), then attach a proper `/AcroForm` dict whose
  `/Fields` lists every source's top-level field. Verified directly
  (not just via the UI): a 32-row 2408-18 instance correctly produces
  2 physical copies with 358 live, independently-addressable fields
  (`form1[0].Page1[0].Item[0]` = `"ITEM-0"`, its renamed sibling
  `form1[0]__f1.Page1[0].Item[0]` = `"ITEM-29"`); a combined "Print
  All" across two 2408-18 instances plus one 2408-20 instance produced
  530 live fields with three independently correct `Nomen[0]` values.
- Also confirmed, before committing to this fix, that pdf.js's plain
  canvas rendering (`page.render({canvasContext, viewport})`, no
  annotation layer) **does** paint a non-flattened field's baked
  appearance stream by default — the original concern that motivated
  `flatten()` in the first place wasn't actually a real constraint.
- Refactored the fill engines so each form type exposes both `build`
  (one instance, merged+saved) and `buildCopies` (the raw, unmerged
  per-copy documents); "Print All" collects every instance's
  `buildCopies()` output across all types into one flat list and merges
  it in a single pass, rather than merging per-instance and then
  merging those already-merged PDFs again (which would need two
  separate levels of name disambiguation instead of one).

**Feature — "Open PDF" instead of a download.** Added a way to
actually get the real, interactive PDF out of the app (until this
point only the image-based preview/print existed) — a "Download PDF"
button using a Blob + `<a download>`. The user then asked for it to
open in a new window/tab instead of the save-file dialog. Switched to
`window.open(URL.createObjectURL(blob), "_blank")`. Verified two ways:
Playwright's own bundled Chromium doesn't ship the PDF-viewer plugin,
so it turns any `application/pdf` navigation into a forced download
regardless of how it's opened — a known Playwright/headless-testing
limitation, not an app bug — confirmed by re-running the same test
against the machine's actual installed Chrome via Playwright's
`channel: 'chrome'` launch option, which opened the blob URL correctly
in a new tab through Chrome's native viewer, with the filled field
visibly highlighted in Chrome's own "this is an interactive field"
blue-outline style — direct visual confirmation the output PDF was
genuinely still fillable, not flattened.

**Feature — simulated "Auto-fill from source."** Every form type gets
an "Auto-fill from source" toolbar button (generic, not per-type) that
opens a modal simulating the app's own documented "Automated" data
entry workflow: four sequential stages (request → response → parsing →
data entry), each a checklist item that animates pending → active
(pulsing) → done, then the active instance's header + rows are
replaced with that form type's own `sampleData()` (a new schema field,
alongside `empty`/`clone`/`newRow`/`build`/`buildCopies`). Verified for
both form types via Playwright (step checklist completes, header and
row values match the dummy payload) and visually via screenshot.

## 12. Per-field export styling + undo/redo (`01-pdfgen-vanilla-multi`)

**Configure form type (per-field export styling).** Asked for a
configuration page per form type covering each field's export appearance
(font, size, text style, justification, overflow). Added a gear-icon
button in the sidebar, immediately left of each form type's "+" (add
instance), opening a "Configure `<form type>`" modal — one row per header
field/table column, derived straight from that type's existing schema
(`sections`) so no extra per-field config was needed elsewhere. Settings
persist to a new `localStorage` key (`01-pdfgen-vanilla-multi-fieldstyles`),
keyed by form type then field key (the same key the schema/fill-engine
already use to address that field).

Implementation required rewiring the fill engine, not just adding UI: the
old code stamped every field with one blanket
`acroForm.updateFieldAppearances(font)` call (always Helvetica). Replaced
with a per-field `setStyledAcroText` that also sets font size (0 = pdf-lib
auto-fits), a multiline flag ("allow overflow"), and resolves/embeds the
right `StandardFonts` variant per field — Helvetica/Times/Courier crossed
with bold/italic, the only fonts pdf-lib ships without needing a real font
file — caching each embedded font per physical copy. `buildAcroFormCopies`,
`buildCombinedPdf`, `regeneratePreview`, and `printAllPreview` all gained a
`styles` parameter threading the active form type's saved styles through
to generation. Verified via Playwright: gear button positioned correctly
for both form types, modal opens/lists all fields, style changes persist
across modal close/reopen, and both PDF generation paths (Print Preview,
Print All) still succeed with the new per-field code path, zero console
errors.

**Dialog sizing bugs, twice.** First ask: the modal was too small — set to
`75vw`/`75vh` initially, but a screenshot showed no visible change at all.
Root cause: the new `.modal-wide` CSS rule was declared *before* the base
`.modal { width: 440px; ... }` rule in the stylesheet — same selector
specificity, so the *later* rule (the base one) won the cascade regardless
of which class was more "specific-sounding." Fixed by moving `.modal-wide`
to right after `.modal` and sizing it more generously (85vw/85vh) so field
labels wouldn't need to truncate either.

**Justification, added then removed.** Initially shipped a single "Align"
dropdown (left/center/right). Follow-up ask: split it into separate
horizontal and vertical align controls. Before building that, checked
pdf-lib's actual `PDFTextField` API — it only exposes `setAlignment` for
horizontal quadding; there's no vertical-alignment method, and getting
real vertical positioning would mean hand-writing a custom appearance-
stream provider instead of relying on `updateAppearances()`. Surfaced this
tradeoff to the user directly (ship a vertical-align control that's
UI-only and does nothing vs. build the real custom renderer) rather than
silently faking it. The user's answer was simpler than either option:
drop alignment configuration entirely, for all form types — every field
just stays left-aligned. Removed the Align column and its select entirely
from the modal; the fill engine still calls `setAlignment` internally
(always "left" via `DEFAULT_FIELD_STYLE`), just with nothing left to
configure it from.

**Default font size.** Separately asked to default the font size to 12
instead of pdf-lib's auto-fit (`fontSize: 0`). Changed
`DEFAULT_FIELD_STYLE.fontSize` to `12` — this is the fallback for *every*
unconfigured field, so it was a real (intentional) behavior change, not
just a config-UI default; updated the in-code comments and the modal's own
caption text to stop claiming "auto-sized" once this landed.

**Undo/redo.** Added per-logbook undo/redo, in-memory only (not persisted
— resets on reload, standard for undo stacks, and avoids `localStorage`
bloat from deep-cloned snapshots). `snapshotBeforeChange()` deep-clones the
current logbook onto a per-logbook-id undo stack and clears its redo stack
before every row add/remove/duplicate/reorder, form-instance add/delete,
"Auto-fill from source" run, and on `@focus` of any header/table input —
grouping an entire in-progress field edit into one undo step rather than
one per keystroke. Undo/Redo buttons added to the toolbar; a global
Ctrl+Z/Ctrl+Shift+Z (or Ctrl+Y) shortcut also works but is deliberately
ignored while focus is inside an input/textarea/select, so it doesn't
fight the browser's own native per-field undo while actively typing.
Verified via Playwright (26 checks): buttons start disabled, field edits
and row operations each undo/redo as one clean step, switching form types
mid-logbook doesn't corrupt history, keyboard shortcuts work correctly
when not focused in a field — zero console errors.

**Deliverable**: `pdfgen-vanilla-multi.zip` sent to the user, including
both features above.

## 13. `02-pdfgen-vanilla-image` — the coordinate-fill counterpart, with a real visual field editor

Asked for a new folder implementing everything `01-pdfgen-vanilla-multi` had,
but using the *flat* (0-field) templates instead of AcroForm, and
upgrading the per-field styling "Configure" modal into a real "form type
editor." A large build, done in one pass (confirmed the plan first, agreed
to defer the end-of-task Playwright verification pass until asked):

- **Scaffolded** as a fork of `01-pdfgen-vanilla-multi`'s app shell (logbooks,
  Defaults, sidebar, resizable Print Preview, Open PDF, Auto-fill
  simulation, undo/redo all carried over unchanged) with the AcroForm fill
  engine swapped for coordinate-based (`page.drawText`).
- **Field maps sourced, not guessed**: DA 2408-20 reused `00-pdfgen-vanilla`'s
  already-validated `HEADER_FIELDS`/`ROW_COLS`/`PAGE1_ROW_Y`/`PAGE2_ROW_Y`.
  DA 2408-18 had no coordinate map anywhere in this project (`00-pdfgen-vanilla`
  only ever filled it via AcroForm) — derived fresh via a small Node script
  (a scratch `pdf-lib` install, not a browser) that walked
  `reference-acroform/A2408_18.pdf`'s AcroForm widgets and printed each
  one's page/x/y/width/height, sorted top-to-bottom. Both forms' per-row Y
  values were refit from literal arrays to a uniform `{startY, spacing}`
  pair (plain average of the real deltas, under 1pt max drift) so the new
  editor only needs to expose two numbers per page instead of one per row.
- **Merge is simpler than AcroForm's**: coordinate-drawn text has no field
  names to collide, so `mergeCoordinateDocs` is just `copyPages()` in a
  loop — none of `mergeAcroFormDocs`'s `/Parent`-chain walking or
  duplicate-name disambiguation is needed.
- **Form Type Editor**: replaced the styling-only Configure modal with a
  pdf.js-rendered canvas (front/back page tabs) overlaying one
  draggable/resizable box per field. Header fields get full x/y/width
  control; table columns get one box representing their row-0 position on
  the shown page — dragging it vertically moves the *whole page's* row
  grid (all columns share one `startY`/`spacing`), which is an honest
  reflection of the data model, not a limitation glossed over. A
  properties panel mirrors whichever box is selected (x, y, width, font,
  size, bold, italic, allow overflow), plus a small "Row grid" panel for
  the shared startY/spacing once a column is selected.
- **Verification**: node-level regression tests (row-overflow copy counts,
  header/page-numbering, remarks wrap-vs-overflow, merged page counts) —
  hit a red herring first (`PDFDocument.load` throwing `NaN`-typed errors
  inside a Node `vm` sandbox harness, tracked down to pdf-lib's internal
  `instanceof Uint8Array` check failing across the sandbox's separate
  realm from pdf-lib's own — not a real bug, confirmed by re-running the
  identical logic without the sandbox, in the same realm as pdf-lib, where
  it passed cleanly). Browser/Playwright verification was explicitly
  deferred per the user's request, done later (see the bug in §14).
- **Deliverable**: `pdfgen-vanilla-image.zip`.

## 14. `03-pdfgen-vanilla-json` — form types as fetched data, and a real Alpine bug

**The idea**: asked (as a discussion first, via a forced Plan Mode
question-answering pass) whether form-type info could live in a database
instead of `.js` files. Answer: yes — nothing about the fill engine was
ever genuinely form-type-specific, so `sections`/`defaultLayout`/
`sampleData`/`templateB64` are all plain JSON already; the only thing
standing in the way was that `empty`/`clone`/`newRow`/`build`/
`buildCopies` were attached to each schema as *functions*, which can't
survive a database round-trip. Recommended proving the shape first with a
static JSON fetch before investing in real Postgres. The user then asked
to build exactly that.

- **Built**: forked `02-pdfgen-vanilla-image` into `03-pdfgen-vanilla-json`,
  generated `form-types.json` (297KB — both templates' base64 plus
  sections/layout/sampleData) via a Node script reading straight from
  `-image`'s files (never through the chat transcript — same
  never-paste-base64 discipline as 00-pdfgen-vanilla's original js-splitting
  work in §7), deleted `js/form2408-*.js` entirely, and turned
  `empty`/`clone`/`newRow`/`build`/`buildCopies` into generic top-level
  functions (`emptyInstance`, `cloneInstance`, `emptyRowFor`,
  `buildFilledPdfGeneric`, `buildCopiesGeneric`) driven by a schema's
  `sections`, since a fetched JSON schema carries no functions at all.
  `FORM_TYPES` starts empty and is populated by `loadFormTypes()` before
  `init()` proceeds to anything else.
- **Bug 1 (reported by the user): sidebar form-type list not showing.**
  Root cause: `loadFormTypes()` pushed into the *module-level* `FORM_TYPES`
  array (`FORM_TYPES.push(...)`) instead of the Alpine-*reactive*
  `this.FORM_TYPES` — Alpine (built on Vue's `@vue/reactivity`) only
  triggers a re-render on mutations that go through its reactive proxy;
  mutating the raw backing array bypasses that, so the DOM never learned
  the fetch had resolved even though the underlying array technically had
  the right data. One-line fix: `this.FORM_TYPES.push(...data)`.
- **Bug 2 (reported by the user, right after the fix above shipped):
  "unable to write" in the New Logbook dialog.** This one took real
  investigation — Playwright repro showed typing worked fine in isolation,
  but a page-level uncaught error appeared right at logbook creation
  (`Cannot read properties of undefined (reading 'after')`, deep inside
  Alpine's minified internals). Bisected by comparing against
  `02-pdfgen-vanilla-image` (same sequence, zero errors) and by stripping
  pieces of the page under test until isolating the cause: `page.evaluate`
  reading `Alpine.$data(...).FORM_TYPES` showed **4 entries** — both form
  types duplicated — meaning `loadFormTypes()` had run twice. Root cause:
  `<body x-data="pdfgenApp()" x-init="init()">` was calling `init()`
  *twice* — Alpine automatically invokes a data object's own `init()`
  method if it has one, and the explicit `x-init="init()"` called it
  again. This double-call has existed in every `00-pdfgen-vanilla-*` folder
  since undo/redo (§12) added a `x-data` object with an `init()` method,
  but was harmless everywhere else (`this.load()` just reassigns,
  duplicate `$watch`/keydown-listener registration went unnoticed) — this
  was the first place `init()`'s work was *additive*
  (`FORM_TYPES.push(...)`), so the second call created duplicate `x-for`
  `:key`s, which crashed Alpine's DOM-diffing and broke the *entire*
  page's reactivity (not just the form-type list — explaining why typing
  anywhere stopped working). Fixed by removing the redundant
  `x-init="init()"` from all four `pdfgen-vanilla*` `<body>` tags (Alpine's
  automatic `init()` call is sufficient on its own) plus a defensive
  re-population guard in `loadFormTypes()`. Side effect surfaced while
  writing this up: `01-pdfgen-vanilla-multi`/`-image`'s Ctrl+Z/Ctrl+Shift+Z
  undo/redo shortcut had been silently double-firing all along (duplicate
  keydown listener) — fixed by the same change.
- **Deliverable**: `pdfgen-vanilla-json.zip`, resent after both bug fixes.

## 15. "Print All" → "Export All"

Asked to rename "Print All" to "Export All" and change its behavior to
also perform the "Open PDF" action (open the merged PDF in a new tab)
automatically, not just render it into the preview panel. Scope question
asked first — all three `00-pdfgen-vanilla-*` folders that have the feature
(`multi`, `image`, `json`), or just the most recent one — user chose all
three, for consistency. `00-pdfgen-vanilla` itself (the original POC) keeps
its own "Print All" unrenamed; it was never in scope. Implementation:
renamed `printAllPreview()` to `exportAll()` in each folder and added one
line — `this.openPreviewPdf()` — right after the preview panel populates.

## 16. Deliverables sent to the user

- `pdfgen-vanilla.zip`, resent several times as features were added
  (each zip = the current `00-pdfgen-vanilla/` folder — unnumbered at the
  time it was sent; the folder was later renamed, see §17).
- `pdfgen-vanilla-multi.zip` (§12), sent once per-field export styling
  and undo/redo were added.
- `pdfgen-vanilla-image.zip` (§13).
- `pdfgen-vanilla-json.zip` (§14), resent after both bugs were fixed.
- The `PDF-gen App Mockup` Claude Artifact link (multi-screen design
  canvas), updated in place across the mockup iterations in §4.
- Various reference PDFs and PDF previews sent/shown inline during
  investigation (not deliverables, just working artifacts).

## 17. Numbering the four `pdfgen-vanilla*` folders

Renamed the four sibling POC folders to carry a numeric prefix reflecting
their build order: `pdfgen-vanilla` → `00-pdfgen-vanilla`,
`pdfgen-vanilla-multi` → `01-pdfgen-vanilla-multi`,
`pdfgen-vanilla-image` → `02-pdfgen-vanilla-image`,
`pdfgen-vanilla-json` → `03-pdfgen-vanilla-json`. Purely a folder-naming
change — no file contents inside any of the four folders were touched,
and `pdfgen-spring/` (still empty) was left unnumbered. `CLAUDE.md` and
this file were updated throughout to match the new names; the zip
deliverables named in §16 keep their original (unnumbered) names since
those are historical filenames of files already sent, not live paths.

## 18. Field/form validation and "Mark complete" (`03-pdfgen-vanilla-json`)

Asked to add: validation rules stored on the "simulated database"
(`form-types.json`), whole-form validation, and a button to mark a form
complete/incomplete with a completed form going read-only. Scoped to
`03-pdfgen-vanilla-json` only, confirmed up front — the phrase "simulated
database" matches that folder specifically (per "Form-type registry as
data" in §14/CLAUDE.md), and the other three folders hardcode schemas in
JS rather than fetching them.

- **Validation rules added to `form-types.json`** via a small Node script
  (never hand-edited — same discipline as touching this file's embedded
  base64 templates elsewhere in the project) that injects a `validation`
  object (`{ required, type, minLength, maxLength }`) onto each header
  field and table column for both form types, then deletes the old
  standalone `maxLength` on table columns (now folded into
  `validation.maxLength`). 13 header fields and 14 columns got rules —
  e.g. DA 2408-18's `serialNumber` (required), `inspNo` (required, max 5,
  matching its existing PDF-field maxLength), `nextDue` (type: date); DA
  2408-20's `dateSampleSubmitted` (required, type: date),
  `acftHrsLastOilChange`/`hoursEndItem`/etc. (type: number).
- **Date validation is deliberately lenient**: checked this project's own
  sample data first and found it mixes army-style dates ("15 MAR 26"),
  ISO, and slash dates — a strict `Date.parse()` would have flagged
  legitimate values as invalid, so date validation is a 3-pattern regex
  (`looksLikeDate()`) instead of parsing.
- **Live inline feedback**: invalid fields get a red border + a `title`
  tooltip with the specific problem(s) (`headerFieldErrors`/
  `rowFieldErrors`, recomputed each render — cheap enough at this form's
  scale), required fields/columns get a red asterisk on their
  label/column header, and a toolbar banner shows a live count of
  currently-invalid fields.
- **`validateInstance(schema, instance)`** runs the same rules across every
  header field and table row for the whole active instance, returning a
  flat list of `"Label: problem"` strings — used to gate "Mark complete."
- **Mark complete / Mark incomplete**: `complete` is a boolean added to
  each form instance (`emptyInstance`/`cloneInstance` both default it to
  `false` — a clone starts incomplete even if its source, e.g. a saved
  Default, was itself complete, since completeness tracks review of *that*
  instance's data). Marking complete runs `validateInstance()` first and
  refuses via an `alert` listing every problem if anything fails; marking
  incomplete always succeeds, no validation gate. While complete: header/
  row inputs go `readonly`, and row-structural actions (add/remove/
  duplicate/reorder) plus "Auto-fill from source" are disabled — both via
  UI bindings and defensively inside the mutator functions themselves, so
  the lock holds even if the UI is bypassed. Undo/redo and unmarking
  complete are deliberately exempt, matching a "submitted form, still
  revisable" model rather than a permanent lock.
- A logbook-level status label was **not** stored separately — a logbook
  (bundle of every form type's instances) is "Complete" only once every
  instance in it is, computed on the fly by `isLogbookComplete(lb)` so it
  can't drift out of sync with the instances it's derived from.

**Follow-up, same session**: asked to (1) move "Mark complete" and "Save
as default" from the per-instance center-pane toolbar into the app's top
header bar, next to "Export All", and (2) add a Complete/Incomplete label
to each logbook in the sidebar list. Both landed as one focused edit:
despite one action being logbook-scoped (Save as default) and the other
instance-scoped (Mark complete), both read as "I'm done with this"
document-level actions reached for from the same spot regardless of which
form is open, so they now sit together in the header; the center toolbar
keeps only what only makes sense while looking at one specific instance
(Undo/Redo, Auto-fill, Print Preview). The sidebar logbook list gained a
`status-pill` per row driven by `isLogbookComplete(lb)`.

Verified with a real Chromium instance via Playwright (installed fresh
into the session's scratchpad, not the project): required-field
asterisks render; leaving required fields blank blocks "Mark complete"
with the exact field-by-field alert text; filling them (including a
genuinely date-shaped value for a `type: "date"` required column — an
early test run correctly caught "Must be a valid date" when a placeholder
non-date string was used instead) lets it succeed; the instance then goes
fully read-only (inputs, add row, duplicate/remove row, Auto-fill all
disabled) while Undo and "Mark incomplete" remain live; unmarking
restores editability; the sidebar logbook pill stays "Incomplete" until
every form type's instance is complete, then flips to "Complete." Zero
console errors throughout.

**Follow-up, same session**: the initial "Mark complete" refusal used a
plain browser `alert()` listing every problem as one text blob. Asked for
a real check-and-review dialog instead, distinguishing *pending* (a
required field with nothing in it yet) from *incorrect* (a field that has
a value but fails a format/length check). `validateInstance()` was
reshaped from returning flat "Label: problem" strings to structured
`{ location, label, message, kind }` entries (`kind` derived from whether
the message is exactly `"Required"`), and a new "Cannot mark complete"
modal renders one row per problem with a Pending/Incorrect badge, in the
same modal-backdrop style as every other dialog in this folder — replacing
the `alert()` entirely; `activeInstanceErrorCount()` (the toolbar banner)
needed no change since it only reads `.length`. Verified via Playwright:
a mix of blank required fields (pending) and a non-date value typed into
the optional `type: "date"` "Next due" column (incorrect) produced exactly
that split in the dialog, no native `dialog` event fired at all, and the
modal closes via both its Close button and a backdrop click.

## 19. Overlays: images and text boxes, fixed or per-document (`03-pdfgen-vanilla-json`)

Asked, framed around a signature use case: let the user add an image to a
form via the Form Type Editor, adjust its size/position, add text boxes
with the same controls, and save these to the "simulated database." The
scope question — does an added image/text apply to every instance of a
form type, or is it unique per document (a real signature differs per
person/document) — was asked up front, since it forks the design
significantly. Answer: **both** — the Form Type Editor defines a
reusable placeholder (position/size), and each instance can then supply
its own content into that placeholder when filling out that specific
document.

- **Data model**: an `overlays` array added to each form type's
  `defaultLayout` (`form-types.json`, both types initialized to `[]` via
  a Node script — same base64-safe-editing discipline used everywhere
  else in this file). Each overlay carries `id`, `kind` (`"image"` |
  `"text"`), `mode` (`"fixed"` | `"placeholder"`), `page`, `x`, `y`,
  `width`, plus kind-specific fields: `height`/`imageB64` for images,
  `fontSize`/`fontFamily`/`bold`/`italic`/`allowOverflow`/`text` for text
  boxes. `getLayout()`'s merge rule treats `overlays` as a full replace
  (a saved list, even empty, always wins over `defaultLayout.overlays`)
  rather than the per-key deep-merge header/cols use, so deleting an
  overlay in the editor actually deletes it.
- **The "Fill per document" checkbox is the fork point**: `mode: "fixed"`
  bakes the image/text into the overlay itself, drawn identically on
  every generated copy of that form type (a letterhead, a stamp). `mode:
  "placeholder"` clears any baked content and instead reads from
  `instance.overlayData[overlayId]` at fill time — populated through a
  new "Signature & attachments" card that appears in the center pane
  (below the existing schema-driven fields/table renderer) whenever the
  active form type has any placeholder overlays. Toggling the checkbox
  clears whatever content the overlay was carrying, on the reasoning that
  a stale baked-in value left behind after switching modes would be
  confusing (and would never be read again anyway, once the mode flips).
- **Per-instance overlay data resets on clone**, same precedent as
  `complete` (§18) — a saved Default or a freshly cloned instance starts
  with no signature/attachment filled in, since that content is specific
  to *this* instance's own review/signing, not something worth carrying
  forward from whatever the source happened to have.
- **Image handling**: uploads go through `FileReader.readAsDataURL()`,
  stored as a full `data:image/png;base64,...` string — directly usable
  as both an `<img src>` preview and, at fill time, sniffed by its
  `data:` prefix to choose pdf-lib's `embedPng` vs `embedJpg`
  (`drawOverlayImage()`). Image overlays are the one box kind that needs
  an explicit `height` (pdf-lib's `drawImage` requires one, unlike text
  which derives its box height from `fontSize`), so the canvas box for an
  image overlay grew a second, bottom-edge resize handle
  (`startBoxResizeHeight`) alongside the existing right-edge width handle.
- **Text overlays reuse the exact styling controls** header/column fields
  already have — same `drawStyledField()` fill-engine call, just with a
  fixed or per-instance `text` value instead of one pulled from
  `form.header`/a row, so no new rendering path was needed.
- **Editor UI**: "+ Add image" / "+ Add text box" buttons above the page
  tabs; a third "Overlays" group in the field list with a small × to
  remove each one (the only removable items in that list — header/column
  boxes are intrinsic to the schema and can't be deleted). Extending
  `startBoxDrag`/`startBoxResize`/`selectEditorField`/`editorSelectedSpec`
  with an `"overlay"` branch (alongside the pre-existing `"header"`/`"col"`
  ones) turned out to be a small, mechanical change — overlays behave
  like a free-floating header field for drag purposes (no shared row grid
  to drag), looked up in the array by id via a new `overlayByKey()` helper
  rather than the object-keyed buckets header/cols use.
- **Fill engine**: `drawOverlays()` runs once per physical copy inside
  `buildCoordinateCopies()`, after header/row fields — shared by both
  Print Preview and Export All since both call the same function. An
  overlay repeats on every physical copy of a row-overflowed instance by
  default (same as header fields); no per-overlay exclude-list was added
  (unlike `repeatingHeaderExclude`), since it wasn't asked for. An
  unfilled placeholder is simply skipped — signing isn't validation-gated.

**A real bug caught mid-build, worth remembering**: the properties
panel's dynamic per-overlay "Replace image" control was first wired with
`:x-ref="'overlayUpload_' + ov.id"` to get a dynamically-named Alpine ref
for a hidden file input — Alpine's `x-ref` isn't a bindable directive the
way `:value`/`:class` are, so this silently did nothing. Fixed by
switching to a plain `<label for="...">` / `<input id="...">` pair
(the standard HTML pattern for a styled "choose file" button) instead of
JS-driven `.click()` — simpler and sidesteps the binding question
entirely; a `:disabled` on the underlying input also naturally blocks the
label from opening the file picker when the instance is complete, with no
extra guard code needed.

Verified with a real Chromium instance via Playwright: added an image
overlay (uploaded a 1×1 test PNG) and a text overlay in the Form Type
Editor; confirmed the properties panel correctly shows a Height field
(no Font size) for image overlays and vice versa; toggled "Fill per
document" and confirmed the placeholder note appears and the bake-in
controls disappear; saved the editor and confirmed a "Signature &
attachments" card appears in the document view for the placeholder
overlay, with a working per-instance upload + preview; generated a real
Print Preview PDF that included both the fixed text overlay and the
per-instance signature image with zero console errors. Drag-to-reposition
was verified directly against Alpine's live state (`Alpine.$data()`) after
an initial test run gave a false negative — the target box's bounding box
was outside a too-small default Playwright viewport, not an app bug;
confirmed correct at a realistic viewport size, including the expected
Y-axis inversion (PDF-up vs. screen-down).

## 20. Collapsible instance lists and inline rename (`03-pdfgen-vanilla-json`)

Two small sidebar usability asks: let the user collapse all form
instances of a type, and rename a form instance inline.

- **Collapse**: a chevron toggle button added to each form type's header
  row in "Forms in this document," backed by a `collapsedFormTypes`
  object keyed by type (in-memory, like undo/redo — not persisted).
  Scoped per form type rather than a single sidebar-wide collapse, since
  the ask was specifically "all form instances of a type."
- **Inline rename**: instances gained an optional `name` field
  (`emptyInstance`/`cloneInstance`, default `""`). A pencil button next
  to each instance row (hover-revealed, same treatment as the existing
  delete ×) swaps the label into a text input; Enter/blur commits,
  Escape cancels. `instanceLabel()` prefers the custom name and falls
  back to the original `"<type> — Instance N"` label so nothing changes
  for instances nobody renames. Decided that `name`, unlike `complete`
  (§18) or `overlayData` (§19), *should* survive `cloneInstance` — it's
  an organizational label (e.g. distinguishing two Oil Analysis Logs as
  "Left engine"/"Right engine"), not per-instance review or signing
  state, so a document created from a saved Default keeps its instance
  names instead of resetting them like it does for completeness/signatures.

Verified via Playwright: adding a second instance and collapsing that
form type's group hid its rows (3 visible → 1) and expanding restored
them; renaming showed the input pre-filled, Enter committed the new
label, a second rename attempt cancelled with Escape correctly kept the
prior (already-committed) name rather than reverting to the original
auto-label, and a third rename committed correctly via blur (clicking
elsewhere) rather than only via Enter. Zero console errors.

## 21. DA 2408-17 and multi-table engine support (`03-pdfgen-vanilla-json`)

Asked to implement `reference-plain/A2408_17.pdf` (DA 2408-17, "Aircraft
Inventory Record") as a third form type in this folder. Inspection (pdf-lib
probe against `reference-acroform/A2408_17.pdf`'s 259 AcroForm widgets,
cross-checked against pdf.js-extracted page text for real labels) showed
this form doesn't fit the "one header + one growable table" shape every
other form type in this project has used: page 1 is a 12-row-per-copy
Equipment Checklist (Item No./Nomenclature/Qty Req + 12 monthly "Check
number" columns) that grows/overflows like DA 2408-20/18's tables, but page
2 holds a fixed 6-slot Verification log and a fixed 13-slot Location/
Remarks list — neither ever grows, shrinks, or reorders.

Surfaced this as a real scope question before building: represent the 74
fixed page-2 slots as plain "fields" grids (fast, zero engine risk, less
faithful to the source form's real table structure), or generalize the
shared engine — until now hardcoded to exactly one table section per
schema — to support genuine multiple tables, including fixed-row-count
ones. Chose the generalization.

**Schema/data model**: a table section can now carry `fixedRows: N`,
marking it as a fixed physical row count (`emptyInstance` seeds exactly
`N` empty rows) instead of the default growable table (starts at 1,
add/remove/duplicate/reorder freely). `tableSectionOf` (singular) became
`tableSectionsOf` (plural) everywhere that walks a schema's tables
(`emptyInstance`, `validateInstance`, `runAutomateWorkflow`);
`cloneInstance` needed no schema parameter at all — it finds row arrays by
duck-typing (any own array-valued instance property), which generalizes to
however many `rowsKey`s exist with zero schema awareness.

**Fill engine**: two additions, both additive/backward-compatible — DA
2408-20/18 needed no migration. (1) A primary-table column can carry an
optional `yOffset` (default 0), since 2408-17's Item/Nomenclature/Qty and
its 12 check-number columns print on two different physical lines within
one logical row, not side by side — the first table in this project where
a row isn't one single printed line. (2) Fixed tables live in
`defaultLayout.extraTables[]`, each with its own single `page`/`startY`/
`spacing`/`rows` (no page1/page2 split — a fixed table never overflows)
and `cols`; `buildCoordinateCopies` draws them once, only on
`copyIndex === 0`, since a verification log or remarks list is
document-level content, not per-physical-copy. `getLayout()` merges
`extraTables` the same per-column-then-per-table way it already merged
the primary `cols`.

**Form Type Editor**: reused the *existing* `'col'` box kind for extra-
table columns instead of adding a parallel kind — column keys are unique
across a schema's tables by convention, so `findColBucket()`/
`findExtraTableForColKey()` just locate the right `cols` object by key.
Only small lookups changed in `editorBoxesForCurrentPage`,
`editorSelectedSpec`, `editorCurrentGrid`, `selectEditorField`,
`startBoxDrag`, `startBoxResize` — no new markup, no new Alpine state, no
duplicated drag/resize/select code. Verified via Playwright: selecting a
Verification column jumps to the back page automatically, its Row Grid
panel shows/edits that table's own `startY`/`spacing`, dragging it
doesn't disturb the primary table's grid, and Save persists
`extraTables` correctly.

**A real bug this surfaced**: switching the active form type sets
`activeFormType` and `activeInstanceId` in two separate reactive writes,
so Alpine briefly re-evaluates the *outgoing* schema's sections against
the *new* instance before the DOM settles. Invisible until now because
every schema shared one `rowsKey` ("rows"); 2408-17's `verifRows`/
`remarksRows` don't exist on a 2408-18/20 instance, so switching *away*
from 2408-17 threw `Cannot read properties of undefined (reading
'length')` on every transition — caught by an automated regression check
across all three form types (2408-18/20 Print Preview + a combined Export
All), not by manual testing, since it never blocked the actual UI action
that triggered it. Fixed with a defensive `(activeInstance[section.rowsKey]
|| [])` at the two read sites (section-title row count, row `x-for`) —
the window it guards is exactly one Alpine tick.

Verified end to end with Playwright against a real Chromium: sidebar
ordering (`2408-17, 2408-18, 2408-20`, numeric), the Verification/Remarks
tables render with exactly 6/13 rows and no add/remove/drag controls
while the Checklist table shows all of them and starts at 1 row; adding
rows past 12 produces a second physical copy (4 total pages, confirmed
against `Math.ceil(rows/12)`); a screenshot of the rendered PDF's page 2
confirmed the Verification and Remarks tables' text lands inside the
correct printed grid cells (not just "no crash" — actually legible,
correctly aligned output); Mark Complete correctly refuses with 36 listed
problems against a mix of filled/blank rows; a full regression pass
against 2408-18 and 2408-20 (Print Preview + a combined Export All across
all three form types, 6 total pages) confirmed zero behavior change to
the two pre-existing form types. `sampleData` was then extended (a
follow-up ask) to also cover `verifRows` (exactly 6 entries, preserving
the fixed-count invariant) and `remarksRows` (13 entries, only the first
few populated — realistic, since a real inventory record rarely fills
every remarks slot) — `runAutomateWorkflow` only replaces a table's rows
if `sampleData` actually supplies that `rowsKey`, so a fixed table with no
corresponding sample data would simply keep its pre-seeded empty rows.

**Follow-up bug report, same session**: the user found that in the Form
Type Editor, Item No./Nomenclature visually overlapped the Equipment
Checklist's 12 check-number columns instead of sitting one line above
them — even though the *generated PDF* already placed them correctly
(their `yOffset: 0` vs. the check columns' negative `yOffset`, added
earlier in this same section). Root cause: `editorBoxesForCurrentPage()`
computed every column's on-canvas `y` from the shared row grid's `startY`
alone, never applying `yOffset` — a real gap in the "Form Type Editor"
generalization above, since the fill engine had gotten `yOffset` right
but the editor's own preview never did. The user also reported the
underlying reason they'd gone looking in the first place: dragging Item
No. vertically moved the *whole table's* shared `startY` (correct for
every previous column in this project, which always shared one line per
row) — there was no way to reposition just those two fields on their own
line. Asked for a checkbox to let a user opt a column out of the shared
grid.

Fixed both: `editorBoxesForCurrentPage()` now folds `yOffset` into the
computed `y` for both the primary table and any extra table's columns
(the actual bug fix). Then added `independentY` — a boolean per column,
off by default (every existing column in every form type keeps behaving
exactly as before) — surfaced as a "Move independently of this table's
row grid" checkbox plus a numeric "Y offset" field in the properties
panel whenever a `'col'` box is selected. When on, `startBoxDrag`
redirects a vertical drag to that column's own `yOffset` instead of the
shared `page1`/`page2`/extra-table `startY`; switching it back off resets
`yOffset` to 0 rather than leaving a hidden, no-longer-editable offset in
place. Verified via Playwright: the editor now renders Item No. and
Check 1 at genuinely different `y` values; with `independentY` off,
dragging still moves the shared grid (`page1.startY` changes, `yOffset`
doesn't); with it on, dragging changes only that column's `yOffset` and
leaves `page1.startY` untouched; unchecking snaps `yOffset` back to 0;
Save persists `independentY`/`yOffset` correctly into `fieldLayouts`. A
full rerun of every earlier 2408-17/regression check (§21) still passed,
zero console errors.

## 22. `04-pdfgen-vanilla` — admin-maintained registry (a fifth track, not another POC of the original four)

Asked to copy `03-pdfgen-vanilla-json` into a new `04-pdfgen-vanilla` folder — an
exact fork, no changes yet, to build the next feature against. Immediately
after the copy, the user asked to remove the copied-over, now-unused
`js/` folder (03 already deleted its per-form-type JS files when it moved
to `form-types.json`, so the folder existed but was empty in the fork too).

Then a "major enhancement": UH-60R/Logbook was the only real combination
this project ever wired up — everything else (other aircraft models, other
document types like the planned "Blades" type with "Main Blades"/"Tail
Blades" form types) only existed as fake, hardcoded `<select>` options with
a "not implemented" note. Asked to make aircraft models, document types,
and form types all genuinely admin-maintainable *through the app* instead
of being added by more AI-assisted coding — plus which form types belong to
which document type, and in what order.

**Scope-defining answer, asked and resolved up front**: should a newly
admin-created form type get a manual schema builder now (so it's fillable
immediately) or just a name/label stub until PDF upload support exists?
Resolved as "manual builder now, automated (PDF-driven) one later" — this
is the decision that shaped everything else in this folder from here on.

**Registry**: `AIRCRAFT_MODELS`/`DOCUMENT_TYPES` (flat fake arrays) and the
read-only `FORM_TYPES` fetch became a mutable, localStorage-backed set —
`aircraftModels` (string array), `documentTypes` (`{id, name, models[]}`,
which aircraft models it applies to), `documentTypeForms` (`{docTypeId:
[formType keys, ordered]}` — replaces the old assumption that every
document contains every entry in `FORM_TYPES`), `formTypeOverrides`
(label/banner edits), and admin-created form types themselves (persisted
separately from the fetched, read-only `form-types.json`, tagged
`custom: true`). Seeded once from the old fake values / the fetched
`FORM_TYPES` order, so existing behavior is unchanged on first load.

**Admin mode**: a checkbox in the header (simulated role check, in-memory
only, unchecked by default) reveals three sidebar panels — Aircraft
models, Document types (+ an "Assign & sort form types" sub-panel per
type, drag-to-reorder), Form types (+ "+ New form type," a manual schema
builder: header fields and at most one repeating table; no PDF template
yet, so Print Preview/Export/the Form Type Editor's position placement are
hidden with a note instead). The header's "+ New logbook" button and its
modal now read "+ New {document type}" — cosmetic only, `logbooks` the
array/`openLogbook()`/the storage key etc. all keep their names.

**A real, unrelated bug caught along the way**: `04`'s three localStorage
keys were copied verbatim from `03` (`pdfgen-vanilla-json-*`) — since
localStorage is scoped per *origin*, not per path, serving both folders
from one static server would make them silently share (and corrupt) each
other's data. Renamed to a `04`-specific prefix before anything else.

**A real bug reported after this shipped: renaming an aircraft model did
nothing.** Traced (by reproducing the exact rename in a real, non-Electron
Chromium via Playwright, where it worked perfectly) to the actual cause:
`window.prompt()` is stubbed to always return `null` in Electron-based
renderers — which includes VS Code's own webviews, i.e. this very
session's environment — while `alert()`/`confirm()` are patched to real
dialogs there. Renaming used `prompt()`; deleting (which uses `confirm()`)
worked fine, which was the tell. Fixed by converting aircraft-model
rename, document-type rename, and form-type label/banner editing to
inline editing instead (same pattern this file already used for instance
rename, §20) — not just a workaround for this session's environment, a
strictly more robust choice regardless of host.

## 23. Upload PDF workflow — AcroForm + vector-PDF structure extraction

Discussed before building: can turning an uploaded PDF into a form
type's field structure be done without an LLM? Answer, arrived at through
back-and-forth: it splits cleanly into three cases. A PDF with real
AcroForm fields — fully mechanical, `pdf-lib`'s widget rectangles are
already exact positions, no guessing. A flattened/vector-exported PDF
(fields stripped, real text/line-draw operators intact, like this
project's own `reference-plain/` set) — no fields, but `pdf.js`'s
`getTextContent()` gives real label text at real positions, so a labeled-
text + nearby-blank-space heuristic is deterministic, not AI. A genuinely
scanned/photographed page — no text layer at all, would need real OCR
(Tesseract.js), lower confidence, explicitly deferred; the user confirmed
that case should just open the editor blank against the real uploaded page
for manual placement, not attempt extraction.

**Design, confirmed as a plan before coding**: classify by what the file
actually contains (`pdf-lib`: has fields? → AcroForm. Else `pdf.js`: has
real text? → vector. Else → image), extract candidates accordingly, land
in the Form Type Editor either way. AcroForm extraction walks each
`PDFTextField`'s first widget rectangle directly (page lookup verified
against `pdf-lib`'s actual source — a widget's `/P` ref, falling back to
scanning every page's `/Annots` array by object identity for PDFs that
omit it), flattens the form afterward so the resulting template has zero
live fields (this folder's fill engine is coordinate-draw only). Vector
extraction clusters `pdf.js` text items into lines, treats a `label:`-
style item as a field, claims the blank space to its right as its box.
Both skip table/repeating-row detection entirely (every candidate is a
one-off header field) and skip non-text AcroForm field kinds (checkbox/
dropdown/radio) — deliberately scoped down, not a limitation discovered
later.

Since extraction will always miss some fields and invent some false ones,
the Form Type Editor gained an add/remove capability for header fields —
"+ Add field" and a per-field × — scoped to `custom: true` types only
(built-ins' fields stay structurally fixed). A custom type's Save now
reconciles `editorDraft.header`'s current key set (and any label edits)
back into the schema's own `sections`.

Verified against three real, generated fixture PDFs (an AcroForm PDF, a
flattened/vector PDF, an image-only PDF) via Playwright — each produced
exactly the expected candidate count and correctly landed in the editor,
including the image case opening with the real page as a visual
background rather than a blank canvas.

**Three more real bugs, all found by actually generating a PDF for a
header-only custom type (the case the manual builder makes trivial to
reach) rather than by re-reading the code:**

1. `buildCoordinateCopies` read `form.rows.length` and `page1.rows +
   page2.rows` unconditionally — a header-only type has neither, so this
   crashed the instant Print Preview was clicked. Fixed: `rows` defaults
   to `[]`, and total-copies math only chunks by row-capacity when that
   capacity is actually nonzero (otherwise always exactly one copy).
2. The running "Page X of Y" header stamp assumed every schema's layout
   has `header.page`/`header.pageOf` keys (true only for the three
   built-in types) — crashed drawing an undefined spec once bug 1 was
   fixed and the code reached further. Fixed: only draw the stamp when
   those keys exist.
3. Saving the position editor's own add/remove-field feature for a custom
   type updated `sections` but never `schema.defaultLayout` — a field
   added via "+ Add field" would silently disappear the next time the
   editor reopened (dropped by `getLayout()`'s merge, which only walks
   keys already present in the base layout), and selecting it in the
   meantime threw `Cannot read properties of undefined`. Fixed by making
   a custom type's `defaultLayout` become the saved `editorDraft`
   directly on Save — there's no separate "real PDF original" layout
   worth protecting for these types the way there is for built-ins, so no
   override layer is needed for them at all. A related, subtler bug
   surfaced testing this: a transient Alpine re-render (same class of
   cross-render timing issue as the double-`init()` bug in §14) could
   evaluate the properties panel against a stale selection for one tick
   when switching which type's editor was open, throwing `Cannot read
   properties of null`. Fixed two ways — `closeEditorModal()` now resets
   the selection on every path out of the modal (Cancel, backdrop click,
   Save), and every read in that panel got defensive optional-chaining so
   a transient null render can't throw regardless of cause.

## 24. Manual structure builder: multiple field groups and tables, full "Edit"

Follow-up ask: the admin "Edit" button on a form type only ever touched
label/banner — asked to let it edit full structure instead, and to allow
adding "other layout elements like tables" (the create flow only offered
one fields section + at most one table).

Reworked the create builder into one shared builder used for both create
and edit (`builderDraft.editingType` null vs. an existing type's key):
unlimited field groups (pure UI grouping — a schema's header keys stay
flat regardless of how many groups they're split across) and unlimited
tables. The first table with any columns becomes the primary, growable
one (`rowsKey: "rows"`, overflows onto extra physical copies once a
template exists); any table after that is a fixed row count instead,
stored in `defaultLayout.extraTables` — reusing, not reinventing, the
exact multi-table machinery DA 2408-17 already proved out (§21).

Editing an existing custom type splits its current `sections` back into
the builder's draft shape, keeping every field/column's real key (and a
table's real `rowsKey`) so Save can tell "already existed" from "new" and
only regenerate keys for genuinely new rows; Save reconciles both
`sections` and `defaultLayout` together (new rows get a placeholder
position, removed ones lose theirs, existing ones keep whatever position
they already had). Built-in types are untouched — their "Edit" still opens
the old simple label/banner modal, since their structure is load-bearing
against real PDF-derived coordinates.

**A real bug found immediately after, from an actual user test screenshot**
(a form type built this way, filled with real row data, showed nothing
from its table in Print Preview): every table on a custom type had its
page-1 row capacity defaulted to `{rows: 0, startY: 0, spacing: 0}` (no
template existed yet to derive real numbers from) — with zero capacity,
the fill engine's row-chunking math produces an always-empty slice
window, so *no* row was ever drawn regardless of how much data existed.
Fixed at `getLayout()`'s read time rather than only at creation, so an
already-broken existing type self-heals the next time its layout is read
(no manual re-save needed) — defaults to a generous `rows: 20, startY:
700, spacing: 20` whenever a primary table exists but was never given a
real capacity. Also hardened `drawStyledField`/`drawOverlayImage`/the
editor's `renderEditorPage` to clamp to the last real page rather than
crash — every layout still assumes a 2-page front/back template, but a
custom type's attached PDF is now often genuinely one page (a blank
background, or a single uploaded page), which this project's fill engine
had never had to handle before this folder existed.

## 25. Per-type "Upload/Replace PDF" on an already-existing custom type

Follow-up: let the admin attach a PDF to a custom type that already
exists (whether built manually or via an earlier upload), not just at
creation. Refactored the classify/extract logic (§23) out of the create
handler into a shared `classifyAndExtractPdf()`, then added a per-row
"Upload PDF" (or "Replace PDF," once a template already exists) button —
a `<label for>` / `<input id>` pair, not a dynamic `x-ref` (Alpine's
`x-ref` isn't bindable — the same mistake, and the same fix, already hit
once for the per-overlay image upload in §19). Additive by design: newly
extracted fields merge into (or create) a single "Extracted fields"
section rather than replacing anything the admin already built by hand or
from a prior upload, with key collisions deduped against every existing
field. Verified live: a manually-added field survived two separate
uploads to the same type, and both uploads' extracted fields landed in
one shared section rather than two duplicate ones.

## 26. Small polish: model/doctype placeholders, a date picker, a dead button

Three small, independent asks in one pass:

- The aircraft-model and document-type selects defaulted to a real,
  pre-chosen value (`"UH-60R"`/`"logbook"`) — changed to genuine
  placeholder options ("Pick Model"/"Pick Document"), with the
  document-type list itself now filtered to only what's enabled for
  whichever model is picked (previously it listed every document type
  regardless of model, gated only by a warning note). Switching models
  resets an now-incompatible document-type selection back to the
  placeholder rather than silently keeping it.
- Any field or table column whose `validation.type === "date"` renders a
  native `<input type="date">` instead of plain text. Tradeoff surfaced
  and accepted: a native date input only displays a value already in ISO
  `yyyy-mm-dd` form, so an existing non-ISO date (this project's own
  sample data intentionally also uses "15 MAR 26"-style dates, per
  `looksLikeDate()`'s lenient validator, §18) shows blank in the picker
  until re-entered — the stored string itself isn't touched until then.
- Removed the PDF preview panel's "Print" button, reported as not doing
  anything useful (it opened a popup and printed static PNG snapshots of
  the on-screen canvas preview — a real feature, just apparently not one
  that helped) — and its now-unreferenced `printRenderedPages()` helper.

## Where things stand

- `PDF-gen/CLAUDE.md` — the living design doc (vision, domain model,
  validation rules, stack leanings, fill-engine duality, the four
  `NN-pdfgen-vanilla*` POC tracks, the schema-driven UI architecture, the
  Form Type Editor, form-types-as-data, reference folders). Kept in
  sync with decisions as they were made.
- `PDF-gen/mockup/` — the design canvas source (`.dc.html` files +
  `canvas.json`) and its seeded/published artifact HTML.
- `PDF-gen/reference-acroform/` and `PDF-gen/reference-plain/` — the
  14-form reference set, split by fill path.
- `00-pdfgen-vanilla/` — UH-60R + Logbook only, two form types (2408-20
  coordinate-fill, 2408-18 AcroForm-fill), each split into its own
  `js/form-XXXX.js`, sidebar form-type list with multi-instance
  support (§8), localStorage persistence, Defaults, Print
  Preview/**Print All** (still named that here — never renamed, per
  §15 — numeric-order grouped), row duplicate/reorder. Output PDFs are
  flattened (never revisited for the 2408-18 path in this folder).
- `01-pdfgen-vanilla-multi/` — same UH-60R + Logbook scope, but both form
  types on the AcroForm path, a schema-driven generic UI (one
  fields/table renderer for any form type), multi-instance forms,
  genuinely interactive (never-flattened, correctly merged) AcroForm
  output, a resizable Print Preview panel, "Open PDF" in a new tab
  instead of a download, a simulated "Auto-fill from source" workflow
  per form type, a per-form-type "Configure" gear icon for per-field
  export styling (font/size/bold/italic/overflow — no alignment
  control, per §12), per-logbook undo/redo (§12), and **Export All**
  (renamed + behavior-changed from Print All, §15).
- `02-pdfgen-vanilla-image/` — same scope again, but the coordinate fill
  path against flattened templates instead of AcroForm (§13), and the
  Configure modal upgraded into a real visual **Form Type Editor**
  (drag/resize field boxes on a rendered page, §13). Everything else
  (Defaults, undo/redo, preview panel, Auto-fill, Export All) carried
  over unchanged from `01-pdfgen-vanilla-multi`.
- `03-pdfgen-vanilla-json/` — forked from `02-pdfgen-vanilla-image`; form-type
  definitions fetched from `form-types.json` instead of hardcoded in
  `js/form-XXXX.js`, simulating the Postgres `form_types` table from §5
  (§14). Model factories and fill-engine entry points became generic
  top-level functions rather than per-schema methods, since fetched
  JSON can't carry functions. Two real bugs found and fixed here (§14)
  — a non-reactive array mutation, and a double-`init()` call that
  turned out to affect all four `pdfgen-vanilla*` folders at the time
  (fixed everywhere, not just here; folders were later renamed with
  numeric prefixes, see §17). Also has: per-field validation rules
  (required/type/length) carried in `form-types.json`, live inline
  error styling + a whole-form validation check, and a header-level
  "Mark complete" action that locks a form instance read-only once it
  passes, with a derived Complete/Incomplete label per logbook in the
  sidebar (§18). The Form Type Editor also supports adding image/text
  overlays, either baked into the form type or reserved as a
  per-document placeholder (e.g. a signature) filled in via a
  "Signature & attachments" section on each instance (§19). The sidebar's
  per-form-type instance lists can be collapsed, and each instance can be
  renamed inline (§20). A third form type, DA 2408-17, was added (§21),
  which required generalizing the shared engine to support more than one
  table section per schema, including fixed-row-count tables that never
  grow/shrink (`fixedRows`) — a schema-level `extraTables` fill-engine
  addition, a Form Type Editor extension that reuses the existing 'col'
  box kind for them, and a real (fixed) transient Alpine cross-render bug
  found along the way.
- `04-pdfgen-vanilla/` — forked from `03-pdfgen-vanilla-json` (§22); every
  registry piece that folder still hardcoded (aircraft models, document
  types, which form types belong to a document type and in what order,
  the form types themselves) is now genuinely admin-maintainable through
  the app, gated behind an in-memory "Admin" checkbox, persisted to its
  own `localStorage` keys (§22 also caught a real bug: it had copied 03's
  key names verbatim, which would have made the two folders silently
  share/corrupt each other's data). A custom (admin-created) form type can
  be built with a manual schema builder (unlimited field groups, a
  primary growable table plus fixed-row-count extra tables, §24) or by
  uploading a real PDF — classified as AcroForm/vector/scanned-image and
  extracted accordingly (mechanical widget rects, deterministic text-
  layout heuristics, or a blank visual reference respectively, §23) — and
  a PDF can also be attached or replaced on an already-existing custom
  type afterward, merging additively (§25). The aircraft-model/document-
  type selects default to real placeholders and the document-type list is
  filtered by model (§26); date-typed fields get a native date picker
  (§26). Several real bugs specific to a template-less or newly-templated
  custom type were found and fixed along the way (§23's three, §24's
  page-capacity self-heal) — this folder is where every one of them
  surfaced, since none of the built-in form types ever exercised those
  code paths.
- `pdfgen-spring/` — empty, reserved for the future backend.
- The Postgres schema (§5) is a design decision made in conversation,
  not yet written into any file — `03-pdfgen-vanilla-json`'s
  `form-types.json` (§14) is the closest thing to a concrete proof of
  its `form_types.field_map jsonb` shape so far, still without a real
  database behind it.
- Not yet built: a data structure that uses the schema-driven
  fields/table renderer but has no PDF fill engine behind it (the
  concrete form of the "data structures not tied to a form type"
  question raised in §10) — flagged as a natural next step for any of
  the schema-driven folders if/when it's needed.

## 27. `05-pdfgen-database` — a real backend, plus two custom-form-type gaps closed

A new fork, `05-pdfgen-database` (copied from `04-pdfgen-vanilla`), created to
finally take the Postgres-backed direction sketched in §5/`CLAUDE.md`'s
"Stack" section out of design-discussion and into something real — this time
answering "can the persistence layer move off `localStorage`," not another
engine/registry question like the previous four/five tracks.

**Express + SQLite backend.** Discussed as architect (not sales/pm) since it
was clearly a system-design question; planned via `EnterPlanMode` before
touching code. Two decisions confirmed with the user up front: **document-
level JSON blobs** (`documents` + `form_instances`, one row per form
instance, not a fully normalized `form_instance_rows` table — no row-level
queries are needed yet) over the fully normalized §5 schema; and **cache +
async flush queue** (the frontend edits in-memory instantly, writes debounce
to the server in the background) over synchronous await-per-save, matching
the pattern `CLAUDE.md`'s "Local storage" section already described. Built
`server/` (`server.js`, `db.js`, `better-sqlite3`, no ORM) with one
`GET /api/bootstrap` + eight `PUT /api/*` endpoints mirroring the app's
existing `load()`/`loadRegistry()`/`persist*()` split 1:1. `index.html`'s
persistence swap was correspondingly small: `persist*()` bodies now call a
`queueSync()` helper instead of `localStorage.setItem`, and a small set of
`documentToWire`/`documentFromWire` (etc.) helpers reshape a logbook's
`forms<Type>` keys into a flat `instances` list at the sync boundary, so the
server never needs to know how `formTypeKey()` spells a given type's key
(important for custom types, whose keys come from `slugify()`, not just the
three built-in DA types). A "Saved to server / Saving… / Save failed" pill
replaced the old "Saved to this browser" pill. Verified with a real Chromium
instance (Playwright): created a document, edited a field, added a row,
confirmed the write landed in SQLite via a direct API read (not just the
UI), and confirmed a fresh page reload still showed the edited value.

**Admin modal backdrop-click.** Small, separate ask: stop the six admin CRUD
modals (Aircraft models, Document types, Assign form types, Form types list,
Edit form type, Structure builder) from closing on a stray backdrop click,
which risked losing in-progress edits — `@click.self="show... = false"`
removed from each; only each modal's own Cancel/Close button closes it now.

**"+ Add table" in the Form Type Editor, and automatic table detection on
Upload PDF** — see "Database backend, and table authoring inside the Form
Type Editor" in `CLAUDE.md` for the full design; both scoped and confirmed
via `AskUserQuestion`/plan approval before building (the second one
specifically: whether to attempt table detection on flattened/vector-text
PDFs at all, given no field names survive flattening — the user chose to
attempt it anyway, accepting the higher false-positive risk). Verified two
different ways: a Node harness ran the extraction functions directly (via
`vm`, no browser) against this project's own real `reference-acroform/`
files, confirming `A2408_18.pdf` and `A2408_17.pdf`'s real tables (14+15 row,
6+13 row) were detected correctly, matching CLAUDE.md's already-documented
ground truth — a genuine "check against known-real data" test, not just a
smoke test. A real bug surfaced during that testing: the AcroForm signal was
initially assumed to be each field's `[n]` widget-array index (e.g.
`Item[0]`, `Item[1]`) — wrong for this project's real LiveCycle-generated
forms, which carry a constant `[0]` on every field and instead encode the
repeating row as a `_N` numeric suffix on the base name (`InspNo`,
`InspNo_1`, `InspNo_2`, ...). Found by testing against the real file instead
of trusting the assumption, and fixed to match the real convention (plus a
"require a consecutive 0,1,2,... run" guard, to avoid misreading a
coincidentally `_N`-suffixed unrelated field as a table column). A second
bug, also caught by testing (a Playwright pass exercising the actual "+ Add
table"/Save round-trip on a freshly-uploaded custom type): a per-table
column-label disambiguation prefix — added for the new multi-table-capable
field list — was getting permanently baked into a custom type's saved column
labels on every Save, the exact same trap `reconcileCustomFormTypeFields`
already existed to avoid for header fields (§23), just re-introduced for
table columns. Fixed by not prefixing custom types' column labels at all,
same as header fields — the new per-table grouping in the field list already
disambiguates on screen, so the prefix was redundant on top of destructive.

**Four rendering bugs found and fixed afterwards, by a dedicated render-test
pass** (asked for as "a couple of bugs when rendering custom PDFs"). The
harness runs the real extraction + fill engine outside the browser (Node +
`vm`, same technique as §13 — including the same cross-realm `Uint8Array`
red herring that section documents, solved here by injecting the outer
realm's constructors into the sandbox), renders a fully-filled instance of
every built-in type *and* of types freshly extracted from every real
reference PDF, then reads the produced PDF's own text layer back to assert
what actually landed: every value drawn, nothing over 14pt, nothing
overprinted, nothing off-page, no duplicate section titles.

1. **26pt text in every cell.** The AcroForm extractor derived font size from
   the widget's box *height* (`height * 0.7`) — but a form cell is routinely
   much taller than the text meant to go in it (one real form's row cells
   measured ~37pt, giving a 26pt font). Every value overflowed its cell and
   ran off the page. Clamped to a realistic 6–12pt fill range.
2. **Text sitting on the cell's bottom rule.** `rect.y` is the box's bottom
   edge, but pdf-lib draws from the text *baseline* — so values printed on
   the ruling line rather than inside the box. Now centred in the box,
   clamped.
3. **The page-number stamp overprinting a real field.** `buildCoordinateCopies`
   treats layout keys `page`/`pageOf` as the running "Page X of Y" stamp. Every
   DA form has a real "PAGE" box, so an uploaded form's *extracted* `page`
   field got the copy number drawn on top of the user's own value, at
   identical coordinates (confirmed by reading both strings back at the same
   x/y). The stamp now only fires when `page`/`pageOf` are layout-only keys,
   i.e. not real fields in `form.header` — built-in types are unaffected.
4. **The duplicate-`:key` page-wide crash, twice.** The main document
   renderer keyed its section loop on `section.title`, and auto-detected
   tables all defaulted to the title "Table" — two same-titled sections
   produced a duplicate Alpine `:key`, which (exactly as §14 documented for
   `FORM_TYPES`) crashed Alpine's diffing for the *entire page*: every field
   on every form type went blank and inputs anywhere stopped accepting text.
   Keying by bare index fixed that but introduced a subtler variant — an
   index is *too* stable, so switching form types made Alpine reuse the DOM
   node at index N for a completely different section (a table section's node
   reused for a fields section), corrupting the nested column `x-for`
   instead. The key is now scoped to the active form type as well
   (`activeFormType + ':' + sIdx`), forcing a clean rebuild per schema
   switch. Titles are also deduped at their source now, in both
   `tableCandidatesToLayout` and `addEditorTable`. **Lesson worth keeping:
   an `x-for` key here must be unique *within* a schema and different
   *across* schemas — neither a human-editable label nor a bare index
   satisfies both.**

The vector-text (flattened-PDF) side of detection works — verified against
synthetic aligned text — but **finds nothing on this project's own
`reference-plain/` files**, reported to the user as a real, honest finding
rather than silently claiming full success: those files' table rows are
blank fillable cells (empty ruled boxes, drawn as vector line graphics), not
text, so a pure text-alignment heuristic has nothing to align against.
Detecting a genuinely blank grid would need parsing the PDF content stream's
line/rect drawing operators, not `getTextContent()` — a materially different
approach, not attempted. Still useful for a flattened PDF whose table cells
already contain visible text.

## 28. Custom-PDF rendering bugs, found by a dedicated render-test harness

Asked to "run a full set of tests and fix the bugs" after §27's fixes still
left the reported symptoms unresolved on a live session. Built a Node
harness (`vm`, no browser — same technique as §13/§27, including the same
cross-realm `Uint8Array` fix) that runs the real extraction + fill engine
against every built-in type *and* types freshly extracted from every real
reference PDF, fills every field/row with a value, renders through the real
coordinate fill engine, then reads the produced PDF's own text layer back to
assert what actually landed: every value drawn, nothing over 14pt, nothing
overprinted, nothing off-page, no duplicate section titles. Found and fixed
four real bugs (all detailed in `CLAUDE.md`'s "Database backend..." section):
a widget-height-derived font size that produced 26pt text overflowing every
cell; text sitting on the cell's bottom rule instead of centred in the box;
the automatic "Page X of Y" stamp overprinting a real extracted "PAGE"
field at identical coordinates; and the duplicate-`:key` page-wide Alpine
crash from §27, whose first fix (keying by array index) turned out to
introduce a second, subtler variant (an index is schema-position-stable, so
switching form types reused one section kind's DOM node for another) — fixed
by scoping the key to the active form type as well.

Verified two ways: the render harness (all built-ins regression-clean at
8pt; every fresh AcroForm upload at ≤12pt with no overlaps; overflow,
overlays, single-page clamping, header-only types all separately covered),
and a real Chromium pass switching between all four of the user's actual
form types in both directions with zero console errors. The user's
already-saved custom type had the 26pt bug baked into its stored layout (the
code fix only affects new extractions) — repaired in place directly against
their live SQLite file (backed up first to `server/custom-form-types.backup.json`),
verified against the same harness afterward.

## 29. Built-in form types moved from `form-types.json` into the database

Asked directly ("is this content been migrated into the database?" → "yes
move it into the database") after noticing `form-types.json` was still
present following §27's backend work — a fair catch: that file was a
deliberate scope decision at the time (§27's plan explicitly kept it static,
since nothing in the app ever wrote to it), not an oversight, but the user
preferred one source of truth. Added a `form_types` table (`server/db.js`),
seeded once from `form-types.json` on first boot (transaction, same pattern
`aircraft_models`/`document_types` already used) — the file is never read
again after that. `/api/bootstrap` now returns `formTypes` alongside
`customFormTypes`; `index.html`'s `loadFormTypes()` became synchronous,
reading `boot.formTypes` instead of doing its own separate `fetch()`, which
let `init()` collapse to a single bootstrap round-trip instead of two. The
separate `formTypesError` state/banner (distinct wording about `file://`
fetch restrictions, no longer a meaningfully different failure mode once
both loads share one request) was folded into `bootstrapError`.

Verified against the user's actual live database (not a fresh one): booted
the server, confirmed the `form_types` table didn't exist beforehand, then
confirmed after boot that all 3 built-in types migrated with their template
bytes and sections intact, sitting alongside the pre-existing custom type
and documents untouched. A Playwright pass confirmed `form-types.json` is
never requested by the browser at all post-migration, all four form types
(3 built-in + 1 custom) still render correctly, and the render-test harness
from §28 re-run clean against the DB-sourced schemas. `form-types.json`
itself was left on disk (inert, harmless) rather than deleted, in case a
fresh database ever needs reseeding from it.

## 30. Built-in form types made structurally editable, same as custom ones

Direct follow-on ask right after §29: "now that the 3 form types are in the
database, allow the user to edit the structure the same way custom form
types." Planned via `EnterPlanMode` first, since it touched several call
sites and had real judgment calls (what stays custom-only) — investigation
during that phase found `confirmFormTypeBuilder`'s edit path and
`openFormTypeBuilderForEdit` were already fully generic, keyed by type not
a `.custom` flag, so the actual change was smaller than it sounded: remove
the `.custom` gates on "Edit" routing, the Form Type Editor's add/remove
controls, and `confirmSaveEditor`'s reconcile-vs-fieldLayouts branch; add
the missing write endpoint for `form_types` (mirroring `custom_form_types`,
which already had one); keep Delete and Upload/Replace PDF custom-only.
Removed the now-redundant label/banner-only modal (`showEditFormTypeMetaModal`)
as dead code, since the Structure Builder already has those same fields and
now handles every type.

Verification followed the same discipline as §27/28 — against the user's
*actual* live database, not a fresh one, but this time via an isolated copy
(the user had their own server running against the real file at the time;
copied the live `pdfgen.sqlite` + app to a scratch dir, ran a second server
instance on a different port against the copy) so the real session was
never touched or interrupted. Three real bugs surfaced this way, all fixed
(detailed in `CLAUDE.md`'s "Database backend..." section): the Structure
Builder's edit path silently dropping the "Page X of Y" running-stamp
keys (never reachable before — no custom type ever had them); a pre-existing
double-modal-stacking issue (fixed for consistency, traced and ruled out as
the actual cause); and the real cause, a `<template x-if>` in this feature's
own new warning-text markup that wrapped bare text with no element child —
Alpine requires an element for `template.content.firstElementChild`, and a
text-only template threw an uncaught `_x_dataStack` error on `null`, on
*every* Structure Builder open (reproduced with a completely blank "+ New
form type", confirming it had nothing to do with which type was being
edited). Found by testing the actual UI flow with Playwright rather than
just the data layer — the render-test harness from §28 alone would never
have caught either the modal-stacking or the Alpine template bug, both pure
frontend-interaction issues.

Final verification: real Chromium pass against the isolated copy — edited
DA 2408-20 (added one new header field), confirmed via direct DB read that
every *other* header field kept its exact original x/y/width/fontSize and
`page1` kept its real 12-row capacity, confirmed the edit landed in
`form_types` (not `custom_form_types`), confirmed Delete/Upload-PDF stayed
invisible for built-in types, zero console errors — then re-ran the new
field through the actual coordinate fill engine and read the produced PDF's
text layer back to confirm it renders (8pt, matching every other field on
that form, no regression).

## 31. Database reset, an autofill-warning fix, and the Form Type Editor's on-canvas labels (`05-pdfgen-database`)

Three small, independent asks in one session:

- **Reset the database** — the live server (`node server.js`, port 3000)
  had its database file open, so a plain `rm` on `pdfgen.sqlite`/`-shm`/
  `-wal` failed (`Device or resource busy`) until the process was stopped
  first. Stopped it, deleted the three files, restarted the server (it
  reseeds `form_types`/registry defaults from `form-types.json` on first
  boot per §29), confirmed via `/api/bootstrap`: 3 built-in form types, 0
  custom types, 0 documents, default registry (6 aircraft models, 4
  document types) restored.
- **A Chrome DevTools autofill warning** ("A form field element has
  neither an id nor a name attribute") — 52 real `<input>`/`<select>`/
  `<textarea>` elements in `index.html` had neither. Added a unique `id`
  to each: a plain static one for one-off fields (aircraft-model select,
  admin checkbox, new-tail-number input, etc.), a dynamic `:id` expression
  built from the same key the schema/fill-engine already address that
  field by (`field.key`, `row.id` + `col.key`, `inst.id`, `dt.id` + model
  name, builder draft indices, etc.) for anything inside an `x-for` loop —
  following the exact pattern the file already used for the one existing
  dynamic id (`'overlayUpload_' + ov.id`, from the per-instance signature
  upload). Verified no duplicate ids (static or live-rendered), the inline
  script still parses, and a Playwright pass through the create-document
  flow (model/doctype select → tail number → Create) still works with zero
  console errors.
- **Form Type Editor: on-canvas labels moved inside their box, styled like
  the real field.** A field/column's label used to float in a small
  fixed-style tag *above* its box (`.editor-box-label`: always 9px bold,
  a fixed editor-chrome color) — told you where a field was, not how it
  would actually print. `.editor-box-label` now positions `inset: 0`
  inside the box itself, and `editorBoxStyle()` (already computing the
  box's own font-size from the field's real `fontSize`) now also maps the
  field's real `fontFamily`/`bold`/`italic` to real CSS (`Helvetica` → a
  sans stack, `TimesRoman` → a serif stack, `Courier` → a monospace stack;
  weight/style straight off `bold`/`italic`) — `editorBoxesForCurrentPage()`
  was extended to carry these three properties on every box (header, col,
  overlay), not just `fontSize`. Verified via Playwright: selecting a
  field, switching it to Courier + bold + italic, and reading back the
  box's own inline style confirmed all three landed correctly; a full
  screenshot of DA 2408-20's front page showed every field's label sitting
  legibly inside its own box at its real position.

## 32. Custom form type tables: front/back/total row capacity, for every table

Follow-up ask, framed around a real gap: "the auto form analyser did a
good job but the form layout needed manual fixing for generated tables" —
add three properties (max rows on the front page, max rows on the back
page, a total row count per instance that triggers a new physical copy
when exceeded) to every table an admin creates or the app auto-detects,
plus let the Form Type Editor position each table's front-page and
back-page printing independently, and show the same three numbers at the
top of each table in the actual data-entry view. Two points were
genuinely ambiguous enough to ask before building (`AskUserQuestion`),
since guessing wrong on either meant redoing real work:

1. **What "overflow" means when a table's data exceeds its total-rows
   cap** — a new *physical page-copy* of the same Form instance (matching
   how the primary/growable table already overflows: header repeats,
   "Page X of Y" increments, one sidebar entry, more pages) vs.
   auto-creating a genuinely *new Form instance* in the sidebar with the
   header copied forward. Chosen: the former — the smaller, already-proven
   mechanism, just generalized to any table instead of only the one
   designated primary.
2. **Whether a column's style** (font family/size/bold/italic/allow-
   overflow) should be independently settable for its front-page vs.
   back-page printing, or shared with only position/spacing differing per
   page (already supported). Chosen: style stays shared — no data-model
   split needed.

Both answers kept the change additive rather than a rearchitecture:

- **Unified the fill engine.** `buildCoordinateCopies` previously had two
  separate code paths — the primary table's `page1`/`page2`-driven
  overflow (computing `totalCopies` from its own row capacity) and a
  hardcoded `copyIndex === 0`-only draw for every extra table (which,
  per "Database backend..." in `CLAUDE.md`, already had its own
  `page1`/`page2` split for *position* but could never itself overflow).
  Both are now one list (`allTables`: the primary table plus every extra
  table, each with its own `maxRows`/`page1`/`page2`/`cols`), with
  `totalCopies` computed as the max, across every table, of
  `ceil(rows.length / table.maxRows)`. A fixed-count table (no "add row"
  control exists for one, so its row count can never exceed what it was
  seeded with) simply has nothing to draw past copy 0 automatically —
  removing the special case entirely rather than keeping it as a second
  rule alongside the new general one. Added a schema-level `maxRows`
  (mirroring the extra-table one from the prior session) to `getLayout()`,
  defaulting to `page1.rows + page2.rows` when unset, same self-heal
  precedent as `page1`'s own 0-capacity default.
- **Admin Structure Builder** — a table's one "Fixed rows" number became
  four controls, for *every* table (primary or fixed): a "Table shows on"
  select (Front/Back/Both — seeds a sensible front/back split, independently
  fine-tunable after) plus the three raw numbers (front, back, total).
  `openFormTypeBuilderForEdit` now reads these off `getLayout()` (not the
  raw, possibly legacy-shaped `schema.defaultLayout` directly) so editing
  an old DA 2408-17-style table shows its real normalized front/back split
  instead of stale/wrong numbers; `confirmFormTypeBuilder` writes the
  primary table's `page1`/`page2`/`maxRows` at the schema's top level and
  every other table's into `extraTables`, carrying forward whatever real
  `startY`/`spacing` a table already had (row-count edits here never
  disturb position, which stays the Form Type Editor's job).
- **Form Type Editor's Row Grid panel unified** — the primary table's row
  count used to be a read-only caption ("fixed by the physical form
  layout"); now every table (primary or extra) shows the same three
  editable fields, resolved through one `editorCurrentTable()` (extra
  table's own record, or `editorDraft` itself for the primary table — both
  carry `page1`/`page2`/`maxRows` in the same shape, so no separate code
  path was needed) replacing the narrower `editorCurrentExtraTable()` from
  the prior session.
- **Document data-entry view** — each table section's header now shows
  "Front N · Back N · Total N/instance" at the top right
  (`tableCapacityLabel()`, reading the *actual* layout via `getLayout()`,
  not the schema alone, so a Form Type Editor override is reflected here
  too) — `.section-title` became a flex row to fit it.

**Verified in stages**, each against the running server: the unified
fill engine first (re-ran the existing all-form-types render regression,
byte-identical page counts; a synthetic 25-row DA 2408-20 instance still
correctly produced 2 physical copies, confirming the primary table's
overflow behavior survived the refactor unchanged), then a real edit
through the Structure Builder (created a table, set placement "Both",
front 8/back 4/total 12, confirmed the exact shape landed in
`defaultLayout` both in-browser and via a direct `/api/bootstrap` read),
then the visual editor's unified panel (`editorCurrentTable()` correctly
resolving to the primary table, `editorSelectedIsPrimaryTable()` correct),
then the real UI path end-to-end (assigned the new type to a document
type through the actual Admin → Document types → Form types flow, created
a document, added an instance, confirmed the capacity label rendered
correctly in the live DOM) — zero console errors throughout.

**A near-miss during that last verification pass, worth remembering for
any future testing against this project's live database**: several
Playwright scripts ran back-to-back against the *running* server (not an
isolated copy) — including one that read the in-memory `logbooks` array,
filtered it, and wrote it straight back through the app's own debounced
sync. Afterward, two real documents that existed before this session
("test 1", "test 2") had become one ("test") — almost certainly because
one script's fresh page load captured a snapshot of the data *before*
another change had landed (from an earlier script, or the user working in
the app concurrently — this project's own database has repeatedly shown
signs of concurrent live use across sessions, e.g. the `AB-12A` aircraft
model and `ab-logbook` document type appearing mid-session in an earlier
turn), and writing that stale snapshot back silently clobbered the newer
state. Checked the WAL file for any recoverable trace of the lost
documents — none found. Reported the loss to the user transparently
rather than guessing at a cause or quietly moving on. This directly
contradicts the discipline `history.md` §30 already established for this
exact scenario (copy the live `pdfgen.sqlite` to a scratch dir, run a
second server instance on a different port against the copy, so the real
session is never touched) — worth being strict about going forward:
**any test that writes data must run against an isolated copy, never the
live file**, even for a change that looks read-adjacent.

Immediately after, the user asked to reset the database again (same
mechanism as earlier in this session) — done, confirmed clean via
`/api/bootstrap`, and the stale `custom-form-types.backup.json` (left over
from the §28 live-data repair) was deleted alongside it since it no
longer refers to anything in the fresh database.

## 33. A third database reset (manual `db.js`/`form-types.json` edits), and field type + output formatting in the Form Type Editor

The user started making manual, direct edits to `server/db.js` and
`form-types.json` (VS Code showed `db.js` open) and asked to clear the
database again so it would reseed from those edits. Checked both files
first — `db.js` still parses (`node --check`), `form-types.json` still
valid JSON — before stopping the server and deleting the three SQLite
files, same mechanism as the prior two resets. The reseed correctly
reflected the manual edits: the aircraft-model/document-type registry
came back trimmed to a single `UH-60R`/1 document type (down from the
6/4 defaults), confirming the user's `db.js` seed changes took effect,
not just a repeat of the old defaults.

**Then**: add field-type editing to the Form Type Editor itself — a
"Field type" select (text/number/date) for any selected header field or
column, plus type-specific options (max characters for text, decimal
places for number, an output format for date). Scoped deliberately to the
*visual* Form Type Editor, not the admin Structure Builder (which already
had a Type select, just none of the three sub-options — max characters
had no UI anywhere in the project, decimal places and a date output
format didn't exist as concepts at all). See "Form Type Editor: field
type + output formatting" in `CLAUDE.md` for the full design
(`editorValidation` mirroring `editorLabels`, the new
`reconcilePrimaryTableColumns` step, `formatValueForType()` in the fill
engine).

**Two real bugs, both found by testing rather than by re-reading the
code, both fixed** (full detail in `CLAUDE.md`):

1. **Date-format token collision** — `formatDateForOutput`'s original
   sequential `.replace()` chain corrupted output whenever a month
   abbreviation contained a letter a later token in the chain would also
   match: `"DD MMM YY"` rendered `"05 3AR 26"` instead of `"05 MAR 26"`
   (the substituted `"MAR"`'s bare `M` got re-matched by the trailing
   bare-`M` replacement pass). Caught by a direct unit test of the new
   function against all five format presets, not by eyeballing the code.
   Fixed with a single regex pass (alternation, longest token first) so
   each character position is consumed exactly once and substituted text
   can never be re-scanned.
2. **`reconcileFormTypeFields` was silently promoting `page`/`pageOf`
   into real schema fields on every Save, for every form type** — a
   pre-existing bug, unrelated to today's actual ask, that this session's
   own end-to-end test happened to be the first thing to ever exercise
   (saving through the *visual* Form Type Editor, not the Structure
   Builder, for a *built-in* type — a path §30 made possible but nothing
   since had actually saved through). These two keys are the running
   "Page X of Y" stamp's layout-only position (always present in
   `editorDraft.header` since the stamp needs to be placed somewhere) but
   were never meant to become real `schema.sections` fields — doing so
   makes `emptyInstance()` seed `form.header.page`/`.pageOf` with real
   data, which then makes `buildCoordinateCopies` treat the stamp as
   user-owned and stop drawing it automatically. Caught by literally
   reading back the saved schema after a real Save and noticing `page`
   had become a real field — not something a plausible-looking diff
   would have flagged on its own. Fixed by excluding `page`/`pageOf` from
   promotion unless one already was a real field before the reconcile ran.

**The live database took two more hits from this session's own testing,
both self-inflicted and both repaired the same way — reset and reseed**:
the first end-to-end test (before either bug was fixed) saved real
validation changes onto 2408-20's `page` and `pageOf` layout-only keys
(turning them into real fields with `type: "number"`/`type: "date"`) plus
a stray `maxLength: 5` on a real field, corrupting the live schema; after
fixing bug 2, a second, corrected test still wrote harmless-but-unwanted
test values (`decimals: 2`, a date format, `maxLength: 5`) onto three of
2408-20's real fields to prove the fix actually worked. Both times, since
this database held no real documents (a fresh dev seed the whole
session), a full reset was the correct, simpler fix rather than hand-
editing the JSON back — confirmed clean via `/api/bootstrap` after each
one, and a final full render regression across all three built-in types
passed with zero console errors before finishing.

## 34. Bug report: can't create an instance of a form type added to a document type after the fact

The user (now actively using the app themselves, adding a new custom form
type through the admin flow) reported: a newly-added form type shows up
correctly in "Forms in this document," but clicking its "+" throws
`Cannot read properties of undefined (reading 'push')` in
`addFormInstance`.

Root cause, confirmed by reading `addFormInstance` directly rather than
guessing: a document's per-form-type data array (`forms<Type>`) is only
created once, by `emptyLogbookForms`, at document-creation time, seeded
only for whichever form types the document type had assigned *then*. The
sidebar list itself is driven by the document type's *current* assignment
(`formTypesInCurrent()`), completely independent of what arrays a given
document actually has — so a form type assigned *after* documents already
exist correctly appears in the sidebar for all of them (its count
correctly reads "(0)", since `instancesOf()` already defended with
`|| []`), but `addFormInstance` assumed the array already existed and
called `.push()` directly on `undefined`.

Fixed by having `addFormInstance` lazily create the array on first use
if missing; gave `deleteFormInstance` the same defensive fallback for
consistency, though it's unreachable in practice (deleting requires an
instance to exist, which requires `addFormInstance` to have already
succeeded).

**Verified against an isolated copy of the app + database, not the live
one** — the user was actively working in the live app at the time, and
this session's own §32 incident was a direct lesson in what goes wrong
otherwise. Copied the whole `05-pdfgen-database` folder (not just
`server/`, since `server.js` serves its static frontend from one
directory up — an early attempt to copy only `server/` 404'd for exactly
this reason) to a scratch directory, deleted its database file so it
reseeds fresh, and ran a second server instance on port 3099. Reproduced
the user's exact scenario end to end: created a document, created a
genuinely new custom form type through the real Structure Builder flow,
assigned it to the *same* document type the document already belonged to
through the real admin "Assign & sort form types" modal (not a raw state
mutation — an earlier attempt using a direct array push produced a
*different*, self-inflicted duplicate-`:key` Alpine crash, since pushing
the same type twice into `documentTypeForms` makes `formTypesInCurrent()`
return it twice), confirmed the document had no key for the new type yet,
clicked "+", and confirmed an instance was created with zero console
errors. Stopped the isolated server and deleted the scratch copy
afterward — the live server/database were never touched by this
verification.

## 35. Committing the backend, and cutting the official Version 1 (`06-pdfgen_v1.0.0`)

**Committing.** Asked to prep the pending changes for a commit — `git
status` showed `05-pdfgen-database/server/` had never been committed at
all (this whole Express/SQLite backend was new, untracked). Since
`node_modules`/the SQLite files clearly shouldn't be tracked, and the
question of *delete-from-disk vs. gitignore-only* has real, different
consequences (deleting `node_modules` breaks the running server until
`npm install` runs again; deleting the database resets it again), asked
first — chose gitignore-only. Added a repo-root `.gitignore`
(`node_modules/`, `*.sqlite`/`*.sqlite-shm`/`*.sqlite-wal`,
`*.backup.json`), confirmed via a dry-run `git add` that only the 4 real
source files (`db.js`, `server.js`, `package.json`, `package-lock.json`)
would be staged from `server/`, then committed everything pending
(including a `04-pdfgen-vanilla.zip` deletion unrelated to this session's
own work — asked before including it, since committing someone else's
pending deletion silently would be scope creep).

**Cutting Version 1.** Asked to copy `05-pdfgen-database/` to a new
`06-pdfgen_v1.0.0/` folder — a plain, exact copy (`diff -rq` confirmed
byte-identical afterward), including `node_modules` and `05`'s current
`pdfgen.sqlite` (81MB total, small enough that excluding `node_modules`
for speed wasn't worth the complexity of a partial copy). Then, on `06`
specifically: remove every "POC" mention from the running app, since this
folder is now the official Version 1 (not another POC track), and
document that fact.

- Found and reworded 8 real occurrences in `index.html` (browser tab
  title, header subtitle, the "can't delete a built-in type" alert, the
  Automate-entry modal's scope caption, and 4 code comments) plus 3 more
  in `form-types.json` — each built-in form type's `bannerNote`, shown
  directly in the app's own banner-note UI. Two of the three `bannerNote`
  strings were also stale in a second way, inherited unchanged from this
  form type's `03-pdfgen-vanilla-json` ancestry: "fetched from
  form-types.json at load, simulating a database-backed form-type
  registry" hasn't been true since the real database landed (§27) —
  `form-types.json` is now only read once, to seed the database on first
  boot. Corrected both while removing "POC" from them, since leaving a
  now-inaccurate technical claim right next to the POC-removal edit would
  have been worse than the original text.
- **A real scope question surfaced mid-edit**: the copied
  `pdfgen.sqlite` had already been seeded (during `05`'s own prior
  development) with the *old* "POC scope: ..." `bannerNote` text baked
  into its `form_types` table — editing `form-types.json` alone doesn't
  touch an already-seeded database, so the corrected text would never
  actually reach a running `06` unless its database got cleared and
  reseeded. Clearing it, though, would also drop whatever dev/test data
  `05` currently had (custom form types like `a2408-15`, the `AB-12A`
  aircraft model, etc.) that had been carried into the copy — asked
  before doing that, since "was that data wanted in the official release
  snapshot, or is a clean baseline the right call for Version 1" is
  exactly the kind of judgment only the user can make, and the two
  answers produce a meaningfully different `06`. Chose the clean
  baseline — matches treating this as a real release rather than a
  snapshot of `05`'s in-progress exploration; `05-pdfgen-database/`
  itself was never touched by any of this (it has its own separate
  database, its own server process, untouched throughout).
- Verified: `node --check`/`JSON.parse` on both edited files, a case-
  sensitive `grep -rn "POC"` across every `.html`/`.js`/`.json` file
  (excluding `node_modules` and `templateB64` payloads, which produced
  false-positive substring hits under a case-*insensitive* search) came
  back empty, then booted `06`'s own server on a spare port (3098) and
  confirmed via `/api/bootstrap` — all 3 built-in `bannerNote`s corrected,
  0 custom types, 0 documents, and a real Chromium pass confirmed the tab
  title ("PDF-gen — Version 1") and header subtitle ("Version 1 · Express
  + SQLite backend · form types served from the database") render
  correctly with zero console errors. Stopped that verification server
  afterward.
- `CLAUDE.md` gained a new "Version 1" section (right after "Five vanilla
  tracks") declaring `06-pdfgen_v1.0.0/` the official release and stating
  plainly that `05-pdfgen-database/` keeps developing independently past
  this point — the two are not required to stay in sync going forward.

## 36. A production-scale architecture question, answered and then implemented (`07-pdfgen-dbnormal`)

Asked directly, as architect: with a realistic production shape — 15+
form types per document type, up to 10 instances each, potentially
thousands of rows per instance accumulated over an aircraft's real
service life — is the document-level JSON blob storage (`05`/`06`'s
`form_instances.data_json`, one blob per instance holding header *and*
every table row) going to be a performance problem?

Answer given: yes, for two separate reasons, and pointed out that the
**write path** was actually the more urgent one — `server.js`'s
`/api/documents` handler deleted and reinserted every document's every
instance's every row on *every* save, not because of blob size but
because of literal delete-then-reinsert-everything semantics regardless
of what changed (its own code comment said as much: "datasets here are
POC-scale, so this is simpler and safer than diffing" — true when it was
written, not at the scale being asked about now). Recommended splitting
rows into their own table and fixing the write path to be per-row, not
per-document — a server-only change, since the client's in-memory model
and `/api/*` wire format don't need to know how the server stores things
underneath.

**Then asked to actually build it.** First question: which folder? Asked
before touching anything, since `06-pdfgen_v1.0.0` had just been
documented this same session as a frozen release snapshot — the user's
answer was neither of the two offered (`05` or `06`), but a fresh
`07-pdfgen-dbnormal`, created on its own git branch (`git checkout -b
07-pdfgen-dbnormal`) and forked from `05-pdfgen-database` (the active dev
line), matching this project's own precedent of one folder per
architectural question.

**Implementation** (full design in `CLAUDE.md`'s "Row-level
normalization"): a new `form_instance_rows` table (one real row per data
row, keyed by `instance_id` + `rows_key` — a schema can have more than
one table, see "Multi-table support" — + `row_index`), `form_instances
.data_json` shrunk to just `{ header, overlayData }`. `readDocuments()`
reassembles the exact `{ header, overlayData, rows, verifRows, ... }`
shape the client already sends/expects by merging the small blob with
grouped rows from the new table — this is what let `index.html` stay
completely untouched. The write path (`replaceDocuments`) became real
upserts: documents/instances by id (delete only what's missing from the
incoming set), and — the actual point of this exercise —
`syncInstanceRows()` diffs each row's *content*, not just its presence:
new rows insert, changed rows update, byte-identical rows are skipped
with zero SQL executed. Defaults were deliberately left as single blobs
— a snapshot saved once, not the thing that grows, so normalizing them
wouldn't have paid for itself.

**Two real bugs hit while building this, both fixed**:

1. A stray backtick inside a SQL comment (`` `id` is the row's own... ``)
   sitting inside a JS template-literal string silently closed that
   string early, breaking `db.js`'s syntax. Caught immediately by
   `node --check` before ever trying to boot the server.
2. **A genuine anomaly, not fully explained**: `05-pdfgen-database`'s own
   `server/node_modules` (and its database files) had disappeared from
   disk by the time this session touched it, despite nothing in this
   conversation's history intentionally deleting it — confirmed
   `06-pdfgen_v1.0.0`'s own copy, made earlier in an *different* session,
   still had its `node_modules` intact, which rules out a single
   project-wide cause and points at something specific to `05`'s folder
   between sessions (not conclusively identified — flagged to the user
   rather than guessed at). Practically harmless (`package.json`/
   `package-lock.json` were untouched, so `npm install` restores it
   exactly), and `07`'s own fresh copy was missing it for the same
   reason (it was forked from `05` after the loss already happened) —
   fixed by running `npm install` in `07/server` before any further
   testing.

**Verification, staged**:

- Direct raw-SQLite inspection after creating a 5-row instance confirmed
  `form_instance_rows` held 5 distinct, correctly-ordered, correctly-
  valued rows (a first test script mis-read the wrong column name and
  wrongly looked like a bug — corrected by reading the raw table
  directly rather than trusting the test's own assumptions).
- **The actual performance claim, proven, not just argued**: temporary
  write-count instrumentation added to `syncInstanceRows` (removed
  immediately after), a 10-row instance created, then exactly one row's
  one field edited and saved — server log showed `inserted=10` on
  creation, then `updated=1, skipped=9` on the edit, with two sibling
  instances in the same document showing `skipped=3`/`skipped=1` and
  zero writes. This is the concrete evidence the fix does what it was
  built to do.
- **Full round trip through the real app**: created rows, forced a full
  page reload (fresh `/api/bootstrap` fetch, exercising
  `documentFromWire`'s reconstruction from the now-normalized tables
  cold, not from in-memory state), confirmed every row came back in
  order with correct values, then ran the real coordinate fill engine
  against the reloaded instance and confirmed the produced PDF's text
  layer contained the right values — the storage change is invisible
  from the fill engine's side, exactly as designed.

`CLAUDE.md` gained a new "Row-level normalization" section and a
`07-pdfgen-dbnormal` bullet in "Repository layout" (folder count bumped
to nine).

## 37. Local dev setup: `better-sqlite3` behind the corporate proxy, and VS Code tasks/debug configs (`07-pdfgen-dbnormal`)

*(Backfilled entry — reconstructed after the fact from commit `ffcd10c`,
its diff, and the `CLAUDE.md`/`server/README.md` sections it added,
rather than written live at the time. §36 and §39 were written during
their own sessions; this one and §38 were not.)*

**The install failure.** A plain `npm install` inside
`07-pdfgen-dbnormal/server` dies partway through, on `better-sqlite3`
specifically, with the pure-JS dependencies (express, etc.) having
installed fine:

```
npm ERR! command ...cmd.exe /d /s /c prebuild-install || node-gyp rebuild --release
npm ERR! gyp ERR! stack FetchError: request to
https://nodejs.org/download/release/v18.17.1/node-v18.17.1-headers.tar.gz
failed, reason: read ECONNRESET
```

**Root cause, and why the obvious reading is wrong.** This looks like a
`better-sqlite3` version/compatibility problem and isn't one. It's a
*native* module, so its install step runs `prebuild-install` (fetch a
precompiled binary from GitHub releases) and falls back to `node-gyp
rebuild` (fetch Node headers straight from `nodejs.org`) when that fails.
Both are **separate child processes**, and both honor only the
`HTTPS_PROXY`/`HTTP_PROXY` **environment variables** — neither reads
npm's own `.npmrc` `proxy`/`https-proxy` settings. That asymmetry is the
whole bug: npm itself *does* read `.npmrc`, so registry traffic routes
through the Nexus mirror correctly, while the direct-to-`nodejs.org` and
direct-to-GitHub calls bypass the proxy configuration entirely and get
reset by the firewall.

**Fix** — export them as real environment variables so the child
processes inherit them, rather than configuring npm:

```powershell
$env:HTTPS_PROXY = "http://proxy-zsgov.external.lmco.com:80/"
$env:HTTP_PROXY  = "http://proxy-zsgov.external.lmco.com:80/"
$env:NODE_EXTRA_CA_CERTS = "C:\Utilities\Combined_pem.pem"
npm install
```

Written up in a new `07-pdfgen-dbnormal/server/README.md` (both
PowerShell and bash forms, plus how to make it permanent via Windows user
environment variables or a PowerShell profile) and summarized in
`CLAUDE.md` under "Local dev setup". **This generalizes well beyond this
one package** — any native npm module on this network fails the same way
for the same reason, and the identical "real env vars, not tool config"
rule is what §39's container section later leans on.

**Tooling added in the same commit**: `.vscode/tasks.json` with three
`07: ...` tasks (Delete SQLite DB / Reseed SQLite DB / Start Server) and
`.vscode/launch.json` with launch + attach debug configurations for the
server. `.gitignore` also picked up `.npmrc`, which can carry a live
registry auth token and must not be committed.

## 38. Two failure modes in those VS Code tasks, and workflow logging on both sides of the wire (`07-pdfgen-dbnormal`)

*(Backfilled entry — reconstructed from commit `9e6d9df` and its diff.
The logging half of this commit was never documented in `CLAUDE.md`; the
VS Code half was.)*

### The tasks from §37 didn't actually run

**Failure mode one — wrong shell.** All three `"type": "shell"` tasks run
their `command` under whatever shell VS Code's task runner defaults to on
this machine, which is **`cmd.exe`** — even though the user's own
interactive terminal is PowerShell. `Remove-Item -Force -ErrorAction
SilentlyContinue` is PowerShell-only syntax, so the delete task failed
immediately with `'Remove-Item' is not recognized as an internal or
external command`. Fixed by giving all three tasks an explicit
`options.shell` override:

```json
"shell": { "executable": "powershell.exe", "args": ["-NoProfile", "-Command"] }
```

Chosen over rewriting the commands in `cmd.exe`-compatible syntax —
keeps the PowerShell cmdlets working and stays consistent with the rest
of this project's Windows-first tooling.

**Failure mode two — a real OS file lock, not a shell problem, and not
fixed by the above.** SQLite's WAL mode holds `pdfgen.sqlite`, `-wal` and
`-shm` open for the lifetime of any live connection. If a prior "07:
Launch Server (Debug)" session or "07: Start Server" task is still
running when "07: Delete SQLite DB" fires, `Remove-Item` fails with `The
process cannot access the file... because it is being used by another
process`. Confirmed directly rather than assumed: a leftover
debug-session `node.exe` (spawned by VS Code's `js-debug` bootloader) was
still holding all three files open, and killing that process let the
delete succeed immediately. **Stop the server before running "07: Delete
Database and Reseed."** Worth automating later via a `preLaunchTask` or
task dependency that stops any running server first — not done.

### Workflow logging, client and server

The larger and previously undocumented half of this commit: **every
user-facing action, and the sync traffic it triggers, now writes one
timestamped, fixed-width-column line to the console** — so a whole
data-entry workflow can be traced without opening the network tab or
setting breakpoints.

- **Same function, twice, deliberately.** `logAction(category, action,
  details)` exists in both `index.html` and `server/server.js` with the
  same signature, the same `padEnd`-based column widths (`{ category: 10,
  action: 34 }`), and the same category taxonomy — so the browser console
  and the server console line up as one readable table. The only
  difference is coloring: the browser uses `console.log`'s `%c` CSS
  directives, the server uses ANSI escapes, because Node's console
  doesn't support `%c`.
- **Categories** (client): `DOC` (document lifecycle), `FORM` (instance
  lifecycle), `ROW` (table row edits), `UNDO`, `EXPORT`, `DEFAULT`,
  `AUTOFILL`, `EDITOR`, `ADMIN` (registry CRUD), `SYNC`, `APP`. The
  server logs `REQUEST`/`RESPONSE`/`SYNC`.
- **The sync path is traced end to end**, which is the point — a single
  edit produces `SYNC queue-logbooks` → `SYNC Queued sync` → `SYNC
  Syncing to server` on the client, the matching `REQUEST PUT
  /api/documents` / `RESPONSE 200 ok` / `SYNC Documents saved` on the
  server, and `SYNC Sync succeeded` back on the client. A failure logs
  `SYNC Sync FAILED` with the error alongside the existing
  `console.warn`, rather than replacing it.
- **`validateInstance`'s refusals are logged too** — a blocked "Mark
  complete" writes `FORM Mark-complete BLOCKED` with the problem count
  and the first failing field, so the modal's contents are recoverable
  from the log after it's dismissed.
- **A direct callback to §36**: that section recorded temporary
  write-count instrumentation added to `syncInstanceRows` to *prove* the
  row-diffing claim, "removed immediately after." This commit brings it
  back **permanently**, as a `SYNC Row sync diff` line reporting
  `inserted=/updated=/skipped=/deleted=` per instance, emitted only when
  at least one of the four is nonzero. The one-off experiment that
  validated the design became a standing observability feature — which
  also means the `updated=1, skipped=9` behavior §36 measured is now
  visible on every save rather than needing to be re-instrumented to
  check.

## 39. Spring Boot + PostgreSQL migration plan (`08-pdfgen-spring`) — design only, no code

A design-and-architecture session, deliberately kept to documents: with
the app at roughly 80% complete, management asked for it to be converted
to a Spring Boot application on PostgreSQL, frontend either left as
vanilla HTML or migrated to Angular. The ask was for a **step-by-step
migration outline for every functionality the app currently has**, using
Spring Boot industry standards — with an explicit instruction up front:
*"show me the plan, don't write any files yet."* Nothing was written
until the very end of the session, after four rounds of scope
correction.

**Four clarifying questions, and the answers that shaped everything
after**:

- **Fill engine** — not one or the other: *"I would like 2 versions, the
  client side rendering and the server side rendering so that I can do
  A/B testing."* Both engines ship.
- **Frontend** — keep vanilla now, Angular later, as a separate phase.
- **API** — redesign as proper REST resources, not a port of the current
  nine whole-collection `PUT`s.
- **Cross-cutting scope** — *all four* offered: auth and roles via Spring
  Security, cross-document uniqueness validation, a real (not simulated)
  automated-data-entry integration, and audit trail + optimistic locking.

**Grounding the plan in the real code first.** Before proposing
anything, `07-pdfgen-dbnormal`'s `server/db.js` (160 lines, 12 tables)
and `server/server.js` (442 lines, 10 endpoints — 1 `GET` + 9 `PUT`)
were read in full, and `index.html` (5,158 lines) was inventoried by
grep rather than read cover to cover — producing the ~30 top-level
functions and ~200 Alpine methods that the eventual 22-area migration
matrix is built from. Two counts were gotten wrong in the first draft
and corrected before the document was written (11 tables → **12**, 9
endpoints → **10**). One number went into the plan as-is because it is
the plan's own starting condition: the current app has **zero automated
test coverage**.

### The research detour that invalidated the first draft

The user then pointed at `C:\ARCHIVE\Logcards-V2\logcards-ng` — *"the
actual repository for the application this project is meant to
replace"* — and asked for the strategy to be validated against it. It
invalidated most of the first draft, which is the genuinely useful part
of this entry, because the discarded choices are exactly the defaults
anyone would reach for again:

| First draft assumed | House standard actually is |
| --- | --- |
| Maven | **Gradle**, multi-module |
| Java 21 | **Java 17** |
| Docker Compose for local dev | **No containers at all**; AWS Secrets Manager |
| Generic OAuth2/OIDC | **`com.lmco.rms.cf:authentication-sdk` 3.7.0** (OIDC JWT + AD LDAP) |
| springdoc-openapi + generated client | **Spring HATEOAS**, zero OpenAPI |
| Testcontainers | **H2** for tests |

The real stack: Spring 5.3.28, Spring Security 5.8.0, Spring Data
2.7.13, Hibernate 5.5.7, `javax.servlet` 4.0.1, Gradle 7.5.1, Flyway
8.5.13, Hibernate Envers, JasperReports 6.21.5, Angular 16 + Angular
Material — built as a **WAR on Tomcat 9**, deployed to EC2 in
`us-gov-west-1` GovCloud through GitLab CI → AWS CodeDeploy, gated by
SonarQube and Fortify SCA, with all dependencies pulled through
`proxy-zsgov.external.lmco.com:80`.

Three findings from that reading are load-bearing:

1. **LogCards is Spring 5 / Tomcat 9 / `javax`, not Spring Boot at all.**
   Spring Boot 3 requires `jakarta` and Tomcat 10.1+; the two namespaces
   cannot coexist. This became **the single blocking decision in the
   plan** (ADR-004) — Boot 3.3 executable JAR (recommended) vs. Boot 2.7
   WAR — and it turns entirely on whether `authentication-sdk` 3.7.0
   supports Spring Security 6. Not answerable from the repository;
   escalated as an open decision with an owner rather than guessed.
2. **No PDFBox, iText, or FOP anywhere in LogCards** — confirmed by
   direct search. A negative result worth recording: the server-side
   fill engine is genuinely net-new work, nothing to borrow. LogCards'
   JasperReports solves a different problem entirely.
3. **LogCards is already on PostgreSQL** (`PostgreSQL95Dialect`,
   `org.postgresql.Driver`; its `ojdbc8` dependency is vestigial),
   which deleted an assumed migration risk. It also already has house
   patterns for two of the four cross-cutting asks —
   `dup_check_id`/`sn_duplication_ref` for cross-document uniqueness,
   and Envers for audit.

**Reported, not touched**: `application-local.properties` in
`logcards-ng` contains a **plaintext Flyway database password committed
to source control**, in a Fortify-scanned repository. Flagged to the
user without reproducing the value.

### The scope lock — the most important message of the session

After that research, the plan had drifted toward framing the effort as
replacing LogCards wholesale, and the estimate was flagged as possibly
"off by an order of magnitude." The user corrected it flatly:

> *"we are using logcards-ng as reference for architecture and features
> / we will not be migrating anything that is currently on the
> logcards-ng app to the new app / we are just reimplementing the
> current 07 app implementation as a springboot app with postgres
> database and LM authentication"*

So: LogCards is read **only** to learn house Spring conventions. No
data, no code, no features come out of it. The thing being built is
`07-pdfgen-dbnormal`, reimplemented. Its existing patterns for
uniqueness and audit are *reimplemented*, not reused. This is why the
final document's stack is a hybrid — house Gradle/Java 17/Flyway/Envers/
auth-SDK conventions wrapped around this app's own data model, rather
than either a greenfield Boot app or a LogCards clone.

### Final instructions and the document

Last message settled the remaining choices: **JSONB is fine** (so the
form-type schemas and field layouts stay JSONB via
`@JdbcTypeCode(SqlTypes.JSON)` rather than being normalized into
LogCards' `fd_form_def`/`fd_section_def`/`fd_field_def` shape — a
conscious, documented deviation); **one document**, not a plan plus
appendix; and a side note requested specifically: *"I want a docker or
podman container that has all the development, testing and deployment
dependencies for this new app."*

That container section (§10 of the document) is a deviation from
LogCards' no-containers standard, and it was justified against pain this
project has already recorded rather than against preference — the LM CA
chain has to land in three separate trust stores, and the proxy has to
be exported as **real environment variables** rather than tool config,
which is the exact root cause of the `better-sqlite3` `ECONNRESET`
install failure already documented in `CLAUDE.md` ("Local dev setup"):
child processes honor `HTTPS_PROXY`/`HTTP_PROXY` but never npm's
`.npmrc`. It also covers Podman rootless socket configuration for
Testcontainers and a multi-stage layered-jar runtime image, and flags
that the approved base-image registry and container-vs-JAR deployment
both still need approval, since the existing pipeline ships a WAR to
EC2.

Written to `08-pdfgen-spring/08-pdfgen-spring-opus.md` (~74KB): scope;
what's adopted from LogCards vs. the six conscious deviations; six ADRs;
target stack and Gradle module layout; the 12 current tables mapped to
Postgres (UUID PKs behind a transitional `client_ref`, template bytes
extracted to a `form_type_template` BYTEA with a sha256 ETag,
`models_json` promoted to a join table, `form_types` +
`custom_form_types` merged behind a `custom` discriminator, Envers +
`@Version` with `If-Match`/`ETag`, RFC 7807 `ProblemDetail`); the full
REST resource map; the LM security config; both fill engines plus a
golden-file parity harness comparing them three ways (text layer, 150
DPI raster diff, structural) with a written **sunset criterion** so the
A/B doesn't quietly become permanent; the container strategy; a phase
plan (0–13); a testing strategy; a **22-subsection functionality
migration matrix** (each with Current → Target → Endpoints/data → Tests
→ Acceptance); the frontend path; 9 ranked risks; 8 open decisions with
owners; and two appendices (endpoint mapping, source material).

**Two structural decisions were carried over from `07` deliberately
unchanged**: `form_instance_row`'s shape and `syncInstanceRows`'
content-diffing write semantics (§36 measured that, so it survives the
rewrite intact), and Defaults staying un-normalized for the same reason
they always were.

A sibling plan, `08-pdfgen-spring-sonnet.md` (~29KB), was written
separately and is kept alongside rather than merged — two independent
takes on the same brief.

**A naming note**: both files were originally created with typo'd names
(`08-pdfget-spring-opus.md` and `08-pdfgen-sprint-sonnet.md`) — the
literal spellings given in the request. Flagged back and renamed by the
user to `08-pdfgen-spring-opus.md` / `08-pdfgen-spring-sonnet.md`.

`CLAUDE.md` gained a "Spring Boot + PostgreSQL migration plan" section
and an `08-pdfgen-spring/` bullet in "Repository layout" (folder count
bumped to ten); the existing `pdfgen-spring/` bullet was reworded to
make clear it's reserved for the eventual *code*, while
`08-pdfgen-spring/` holds the plan for it.

## 40. Sonnet-session sibling: `08-pdfgen-spring-sonnet.md`

Ran in parallel with the session §39 documents ("the other AI"),
independently working the same brief — reimplement `07-pdfgen-dbnormal`
as Spring Boot + PostgreSQL, a step-by-step migration outline for every
current functionality, using Spring Boot industry standards, with the
same standing instruction: *"show me the plan, don't write any files
yet."* This entry covers what this session did on its own; see §39 for
shared background (the scope lock, the plaintext-Flyway-password report)
that isn't repeated here.

**First pass, before any cross-session input.** Three clarifying
questions up front — frontend (vanilla vs. Angular), where the PDF fill
engine should live after migration, and migration strategy (big-bang vs.
incremental). Answered: keep the vanilla Alpine.js UI, ship **both** fill
engines (client `pdf-lib.js` and a new server-side engine), explicitly
for A/B testing, and an incremental/strangler-fig migration alongside
the existing Express server. A text-only outline was presented first —
no file yet, per the standing instruction.

**Mid-session, the user relayed the parallel opus session's own resolved
answers** ("the other ai flag the following items") — fill engine: both,
confirmed; frontend: vanilla now, Angular later, phased; API: redesign
as proper REST resources, not a port of the current whole-array `PUT`s;
cross-cutting scope: all four (auth/roles, cross-document uniqueness,
real automated-data-entry integration, audit/optimistic-locking) in
scope. These matched this session's own independently-reasoned direction
almost exactly — adopted with no course-correction needed.

**Its own `logcards-ng` research pass.** Rather than reuse the other
session's findings secondhand, this session spawned its own agent against
`C:\ARCHIVE\Logcards-V2\logcards-ng` with a 7-question brief (auth
mechanism, module architecture, database/migrations, REST conventions,
Angular integration, what `logcards-solumina-service` actually does,
build/deploy). It landed on essentially the same facts §39's research
detour did — `com.lmco.rms.cf.authentication.sdk` federated to
PingFederate OIDC + AD/LDAP group roles (`LOGCARDS.*` prefix), Gradle
multi-module with a `<context>-domain` (pure JPA entities) /
`<context>-service` (dao/service/config) pairing convention, Postgres +
Hibernate with `hbm2ddl.auto=validate` plus Flyway, a HATEOAS/RPC-
flavored API rather than clean REST (the one place this plan deliberately
diverges from house convention, per the user's own REST-resources
instruction), Angular 16.2 + Angular Material with `oidc-client`, and
WAR-on-Tomcat-9 via GitLab CI → AWS CodeDeploy into GovCloud. One finding
this session's agent surfaced that's a useful precedent for the
still-undefined "automated data entry" phase: `logcards-solumina-service`
integrates with Solumina (an external MES) through an isolated service
module, an external-DTO-to-internal-domain mapping/filter stage, and a
Quartz-scheduled Spring Batch pull — a shape worth copying once/if
pdfgen's own automated-entry source is ever identified, even though
nothing is wired to a real endpoint yet.

Two more targeted clarifying questions followed before finalizing: what
Spring Security should authenticate against (answered: validate against
`logcards-ng` directly rather than pick generically — hence the agent
survey above), and whether a real external API already exists for
automated data entry (answered: still undefined, build the generic
plumbing only).

**The document.** Written to `08-pdfgen-spring/08-pdfgen-sprint-sonnet.md`
(typo'd per the user's own literal spelling in the request — see §39's
naming note; later renamed by the user to `08-pdfgen-spring-sonnet.md`
alongside the opus file's equivalent fix). Ten sections: a
decisions-locked-in table; a module map (`pdfgen-common`,
`pdfgen-registry-domain`/`-service`, `pdfgen-documents-domain`/`-service`,
`pdfgen-fillengine-service` — the **server** engine only, since the
client engine stays browser JS and was never a Java module —
`pdfgen-automation-service`, `pdfgen-web`) mirroring LogCards' real
domain/service pairing rather than a generic controller/service/
repository split; an 8-phase strangler-fig rollout (Phase 0 scaffolding
plus the AD-group/PingFederate registration flagged as an external
blocking dependency, through Phase 8 Express retirement, with Phase 7
Angular deferred and deliberately unscheduled); a full
`07-pdfgen-dbnormal` table → Postgres mapping (schema `pdfgen`,
`REG_`/`DOC_`-prefixed tables mirroring LogCards' `FD_`/`DC_`
convention); a REST resource table replacing the ten current
whole-array endpoints, flagging explicitly that moving
`form_instance_rows`' diff-sync logic from server-side (today) to a
per-row REST contract is a real frontend rework, not just a URL swap; a
functionality-by-functionality migration map; a testing strategy
(Testcontainers, contract tests, a diff-sync parity test reproducing the
`updated=1, skipped=9` behavior as an automated check instead of a
one-time manual one, fill-engine A/B parity tests); a DevOps section; and
a risk register (WAR-vs-JAR, the Flyway naming-prefix convention, ID
strategy, ITAR/GovCloud dependency review, and an explicit note that no
existing audit-trail/optimistic-locking pattern was found in
`logcards-ng`, so that part of the design is genuinely new, not a port).

**Side-note addendum, after the document was written.** The user asked,
in this session specifically, for a Docker or Podman container "that has
all the development, testing and deployment dependencies" for the 08
app. Added as a new §9 ("Development, Test & Build Container"), pushing
the former risk-register section to §10 and fixing every internal `§9`
cross-reference that had pointed at it. Content: an open Docker-vs-Podman
decision deferred to whatever `logcards-ng`'s own CI runner already
standardizes on (flagging that a GovCloud/defense-contractor shop may
specifically mandate Podman); what the image bundles (Java 17, Gradle,
Postgres *client* tools only — not the server, kept as a separate Compose
service — Flyway CLI, Node.js/npm pre-staged for the later Angular phase,
and the corporate proxy/CA trust config this project has already been
burned by once, in the `better-sqlite3` `ECONNRESET` incident recorded
under "Local dev setup"); a Compose layout; and an explicit callout that
running Testcontainers-based tests *inside* this same dev container is a
nested-container problem (needs a socket-mount or rootless-nesting
decision), not something that works for free. Explicitly scoped as
dev/build/test only — production packaging/deploy stays the
WAR-on-Tomcat-9 path, unchanged.
