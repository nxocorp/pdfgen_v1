// SQLite connection + schema for 07-pdfgen-dbnormal (forked from
// 05-pdfgen-database). A form instance's header/overlayData stay a small
// JSON blob (form_instances.data_json), but its table ROWS — the part that
// grows unbounded over a real aircraft's service life, and the part that
// made the old "delete-then-reinsert the whole table on every save" write
// path a real production concern — now live in their own table,
// form_instance_rows, one real SQL row per data row. See PDF-gen/CLAUDE.md
// ("Row-level normalization" in 07-pdfgen-dbnormal) and history.md for the
// full design discussion this answers. Defaults are NOT normalized this
// way — they're a snapshot saved once and rarely re-saved, not the thing
// that grows, so the extra complexity isn't worth it there.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const db = new Database(path.join(__dirname, "pdfgen.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tail_number TEXT,
  aircraft_model TEXT,
  document_type_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS form_instances (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  form_type TEXT,
  name TEXT,
  complete INTEGER,
  data_json TEXT  -- { header, overlayData } only now — table rows live in form_instance_rows
);

-- One real row per data row (e.g. a DA 2408-20 Oil Analysis Log entry, a
-- 2408-17 Verification-log signature) instead of an entry inside a growing
-- JSON array. rows_key identifies which of a schema's tables this row
-- belongs to (the primary growable table is "rows"; an extra fixed-count
-- table uses its own rowsKey, e.g. "verifRows") — a schema can declare more
-- than one table (see "Multi-table support" in CLAUDE.md), so this can't
-- just be "the rows array." row_index preserves display/print order within
-- that (instance, rows_key) pair; id is the row's own client-assigned
-- uid(), stable across edits, so a single-row UPDATE/DELETE is possible
-- without touching its siblings.
CREATE TABLE IF NOT EXISTS form_instance_rows (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES form_instances(id) ON DELETE CASCADE,
  rows_key TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_instance_rows_instance
  ON form_instance_rows (instance_id, rows_key, row_index);

CREATE TABLE IF NOT EXISTS defaults (
  id TEXT PRIMARY KEY,
  name TEXT,
  aircraft_model TEXT,
  document_type_id TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS default_instances (
  id TEXT PRIMARY KEY,
  default_id TEXT NOT NULL REFERENCES defaults(id) ON DELETE CASCADE,
  form_type TEXT,
  name TEXT,
  complete INTEGER,
  data_json TEXT
);

CREATE TABLE IF NOT EXISTS field_layouts (
  form_type TEXT PRIMARY KEY,
  layout_json TEXT
);

CREATE TABLE IF NOT EXISTS aircraft_models (
  name TEXT PRIMARY KEY,
  position INTEGER
);

CREATE TABLE IF NOT EXISTS document_types (
  id TEXT PRIMARY KEY,
  name TEXT,
  models_json TEXT,
  position INTEGER
);

CREATE TABLE IF NOT EXISTS document_type_forms (
  document_type_id TEXT,
  form_type TEXT,
  position INTEGER,
  PRIMARY KEY (document_type_id, form_type)
);

CREATE TABLE IF NOT EXISTS form_types (
  type TEXT PRIMARY KEY,
  schema_json TEXT
);

CREATE TABLE IF NOT EXISTS custom_form_types (
  type TEXT PRIMARY KEY,
  schema_json TEXT
);

CREATE TABLE IF NOT EXISTS form_type_overrides (
  form_type TEXT PRIMARY KEY,
  overrides_json TEXT
);
`);

// Seed the registry with the same hardcoded fallbacks loadRegistry() used
// when localStorage was empty (index.html), so a fresh DB behaves exactly
// like a first-ever load did. Only runs once, when the table is empty.
const seedModels = ["UH-60R"];
const seedDocTypes = [
  { id: "logbook", name: "Logbook", models: ["UH-60R"] }
  
];

if (db.prepare("SELECT COUNT(*) c FROM aircraft_models").get().c === 0) {
  const insert = db.prepare("INSERT INTO aircraft_models (name, position) VALUES (?, ?)");
  seedModels.forEach((m, i) => insert.run(m, i));
}

if (db.prepare("SELECT COUNT(*) c FROM document_types").get().c === 0) {
  const insert = db.prepare(
    "INSERT INTO document_types (id, name, models_json, position) VALUES (?, ?, ?, ?)"
  );
  seedDocTypes.forEach((d, i) => insert.run(d.id, d.name, JSON.stringify(d.models), i));
}

// The built-in form types (DA 2408-17/18/20 — sections, field layout, sample
// data, template bytes) used to be fetched by the frontend directly from
// form-types.json at load. That file is now only a one-time SEED source for
// this table, read here on first boot — the frontend gets these from
// /api/bootstrap like everything else, and form-types.json is never touched
// again after this. Read-only from the app's perspective either way (no PUT
// endpoint for this table): an admin can override a built-in type's
// label/banner (form_type_overrides) or add wholly new custom types
// (custom_form_types), but a built-in type's own structure stays tied to its
// real PDF template.
if (db.prepare("SELECT COUNT(*) c FROM form_types").get().c === 0) {
  const seedPath = path.join(__dirname, "..", "form-types.json");
  if (fs.existsSync(seedPath)) {
    const builtIns = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const insert = db.prepare("INSERT INTO form_types (type, schema_json) VALUES (?, ?)");
    const seedAll = db.transaction((types) => {
      for (const ft of types) insert.run(ft.type, JSON.stringify(ft));
    });
    seedAll(builtIns);
  }
}

module.exports = db;
