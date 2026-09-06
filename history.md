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
