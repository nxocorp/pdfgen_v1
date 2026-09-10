const path = require("path");
const express = require("express");
const db = require("./db");

const app = express();
app.use(express.json({ limit: "50mb" })); // custom form types / signature overlays carry base64 bytes

// ---------------------------------------------------------------------------
// Workflow logging — every API request that mutates or bootstraps data logs
// one aligned-column, timestamped line, mirroring the frontend's logAction()
// in index.html (same category taxonomy, same padEnd-based column alignment,
// ANSI colors here instead of %c CSS since Node's console doesn't support %c).
// ---------------------------------------------------------------------------
const LOG_COL = { category: 10, action: 34 };
const ANSI = { gray: "\x1b[90m", blue: "\x1b[34m", green: "\x1b[32m", reset: "\x1b[0m" };
function logAction(category, action, details) {
  const ts = new Date().toISOString();
  const cat = String(category).toUpperCase().padEnd(LOG_COL.category);
  const act = String(action).padEnd(LOG_COL.action);
  const det = details == null || details === "" ? "" : (typeof details === "string" ? details : JSON.stringify(details));
  console.log(`${ANSI.gray}${ts}${ANSI.reset}  ${ANSI.blue}${cat}${ANSI.reset}${ANSI.green}${act}${ANSI.reset}${det}`);
}

const ROOT = path.join(__dirname, "..");
app.use(express.static(ROOT));

// ---------------------------------------------------------------------------
// Read helpers — each assembles one bootstrap slice in the exact shape the
// frontend's load()/loadRegistry() already expect. Documents/defaults come
// back as { ...meta, instances: [{id, formType, name, complete, data}] } —
// a flat list, not pre-grouped into `forms<Type>` keys, since only the
// client (via formTypeKey()) knows how to name those keys for custom form
// types. See glittery-growing-raven.md for why.
// ---------------------------------------------------------------------------

// Reassembles each instance's `data` back into the exact { header,
// overlayData, rows, verifRows, ... } shape the client has always sent/
// expected (see serializeInstance/deserializeInstance in index.html) —
// rows just come from their own table now instead of being embedded in
// data_json, so the frontend needs no changes at all for this to work.
function readInstanceRows(instanceId) {
  const rows = db
    .prepare("SELECT rows_key, data_json FROM form_instance_rows WHERE instance_id = ? ORDER BY rows_key, row_index")
    .all(instanceId);
  const out = {};
  for (const r of rows) (out[r.rows_key] || (out[r.rows_key] = [])).push(JSON.parse(r.data_json));
  return out;
}

function readDocuments() {
  const docs = db.prepare("SELECT * FROM documents ORDER BY created_at").all();
  const instanceStmt = db.prepare("SELECT * FROM form_instances WHERE document_id = ?");
  return docs.map((d) => ({
    id: d.id,
    tailNumber: d.tail_number,
    aircraftModel: d.aircraft_model,
    documentTypeId: d.document_type_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    instances: instanceStmt.all(d.id).map((i) => ({
      id: i.id,
      formType: i.form_type,
      name: i.name,
      complete: !!i.complete,
      data: { ...JSON.parse(i.data_json), ...readInstanceRows(i.id) },
    })),
  }));
}

function readDefaults() {
  const defs = db.prepare("SELECT * FROM defaults ORDER BY created_at").all();
  const instanceStmt = db.prepare("SELECT * FROM default_instances WHERE default_id = ?");
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    aircraftModel: d.aircraft_model,
    documentTypeId: d.document_type_id,
    createdAt: d.created_at,
    instances: instanceStmt.all(d.id).map((i) => ({
      id: i.id,
      formType: i.form_type,
      name: i.name,
      complete: !!i.complete,
      data: JSON.parse(i.data_json),
    })),
  }));
}

function readFieldLayouts() {
  const out = {};
  for (const row of db.prepare("SELECT * FROM field_layouts").all()) {
    out[row.form_type] = JSON.parse(row.layout_json);
  }
  return out;
}

function readAircraftModels() {
  return db.prepare("SELECT name FROM aircraft_models ORDER BY position").all().map((r) => r.name);
}

function readDocumentTypes() {
  return db
    .prepare("SELECT * FROM document_types ORDER BY position")
    .all()
    .map((r) => ({ id: r.id, name: r.name, models: JSON.parse(r.models_json) }));
}

function readDocumentTypeForms() {
  const out = {};
  for (const row of db.prepare("SELECT * FROM document_type_forms ORDER BY position").all()) {
    (out[row.document_type_id] ||= []).push(row.form_type);
  }
  return out;
}

// The built-in form types (DA 2408-17/18/20) — read-only from the app's
// perspective, no PUT endpoint for this table (see db.js's seed comment for
// why). Ordered by rowid (insertion order) so the sidebar/Export All keep
// the same numeric ordering form-types.json always had.
function readFormTypes() {
  return db.prepare("SELECT schema_json FROM form_types ORDER BY rowid").all().map((r) => JSON.parse(r.schema_json));
}

function readCustomFormTypes() {
  return db.prepare("SELECT schema_json FROM custom_form_types").all().map((r) => JSON.parse(r.schema_json));
}

function readFormTypeOverrides() {
  const out = {};
  for (const row of db.prepare("SELECT * FROM form_type_overrides").all()) {
    out[row.form_type] = JSON.parse(row.overrides_json);
  }
  return out;
}

app.get("/api/bootstrap", (req, res) => {
  logAction("REQUEST", "GET /api/bootstrap", "");
  const documents = readDocuments();
  const boot = {
    documents,
    defaults: readDefaults(),
    fieldLayouts: readFieldLayouts(),
    aircraftModels: readAircraftModels(),
    documentTypes: readDocumentTypes(),
    documentTypeForms: readDocumentTypeForms(),
    formTypes: readFormTypes(),
    customFormTypes: readCustomFormTypes(),
    formTypeOverrides: readFormTypeOverrides(),
  };
  logAction("RESPONSE", "GET /api/bootstrap", "200 ok");
  res.json(boot);
  logAction("SYNC", "Bootstrap served", documents.length + " document(s)");
});

// ---------------------------------------------------------------------------
// Write endpoints — one per persist*() call in index.html. Most tables here
// are still small enough that a full delete-then-reinsert per save is fine
// (matches the whole-array semantics persistLogbooks() etc. already had
// against localStorage) — documents, defaults, and the various registry
// tables all stay that way.
//
// /api/documents is the one exception, and deliberately so: the client
// sends the WHOLE current `logbooks` array on every save (persistLogbooks()
// watches it with `deep: true`), same as before — nothing about that wire
// contract changed — but writing that out used to mean deleting and
// reinserting every document's every instance's every row on every single
// edit, anywhere, regardless of how small the actual change was. That's the
// part real production data (many form types × many instances × growing
// row counts per instance) can't afford. Fixed server-side only, by
// upserting-by-id (delete only what's actually missing from the incoming
// set) at the document/instance level, and by real row-level diffing
// (syncInstanceRows) at the row level — a row whose content is
// byte-identical to what's already stored is never rewritten at all.
// ---------------------------------------------------------------------------

const upsertDocument = db.prepare(`
  INSERT INTO documents (id, tail_number, aircraft_model, document_type_id, created_at, updated_at)
  VALUES (@id, @tailNumber, @aircraftModel, @documentTypeId, @createdAt, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET
    tail_number = excluded.tail_number,
    aircraft_model = excluded.aircraft_model,
    document_type_id = excluded.document_type_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at
`);
const deleteDocumentById = db.prepare("DELETE FROM documents WHERE id = ?");
const listDocumentIds = db.prepare("SELECT id FROM documents");

const upsertFormInstance = db.prepare(`
  INSERT INTO form_instances (id, document_id, form_type, name, complete, data_json)
  VALUES (@id, @documentId, @formType, @name, @complete, @dataJson)
  ON CONFLICT(id) DO UPDATE SET
    document_id = excluded.document_id,
    form_type = excluded.form_type,
    name = excluded.name,
    complete = excluded.complete,
    data_json = excluded.data_json
`);
const deleteFormInstanceById = db.prepare("DELETE FROM form_instances WHERE id = ?");
const listInstanceIdsForDocument = db.prepare("SELECT id FROM form_instances WHERE document_id = ?");

// Pulls a wire-format instance's `data` ({ header, overlayData, rows,
// verifRows, ... } — see serializeInstance in index.html) apart into the
// small blob that stays on form_instances (header/overlayData) and the row
// arrays that get diffed into form_instance_rows separately.
function splitInstanceData(data) {
  const { header, overlayData, ...rowsByKey } = data || {};
  return { base: { header, overlayData }, rowsByKey };
}

const listRowsForInstance = db.prepare(
  "SELECT id, rows_key, row_index, data_json FROM form_instance_rows WHERE instance_id = ?"
);
const insertInstanceRow = db.prepare(
  "INSERT INTO form_instance_rows (id, instance_id, rows_key, row_index, data_json) VALUES (?, ?, ?, ?, ?)"
);
const updateInstanceRow = db.prepare(
  "UPDATE form_instance_rows SET rows_key = ?, row_index = ?, data_json = ? WHERE id = ?"
);
const deleteInstanceRowById = db.prepare("DELETE FROM form_instance_rows WHERE id = ?");

// The actual per-row diff: a row is only written (inserted or updated) when
// it's new or has actually changed — position (rows_key/row_index) or
// content. An untouched row costs nothing here, which is the whole point —
// editing one row of a 500-row table no longer rewrites the other 499.
function syncInstanceRows(instanceId, rowsByKey) {
  const existing = new Map(listRowsForInstance.all(instanceId).map((r) => [r.id, r]));
  const incomingIds = new Set();
  let inserted = 0, updated = 0, skipped = 0;
  for (const rowsKey of Object.keys(rowsByKey)) {
    (rowsByKey[rowsKey] || []).forEach((row, index) => {
      incomingIds.add(row.id);
      const json = JSON.stringify(row);
      const prior = existing.get(row.id);
      if (!prior) {
        insertInstanceRow.run(row.id, instanceId, rowsKey, index, json);
        inserted++;
      } else if (prior.rows_key !== rowsKey || prior.row_index !== index || prior.data_json !== json) {
        updateInstanceRow.run(rowsKey, index, json, row.id);
        updated++;
      } else {
        skipped++;
      }
    });
  }
  let deleted = 0;
  for (const id of existing.keys()) if (!incomingIds.has(id)) { deleteInstanceRowById.run(id); deleted++; }
  if (inserted || updated || deleted || skipped) {
    logAction("SYNC", "Row sync diff", instanceId + ": inserted=" + inserted + ", updated=" + updated + ", skipped=" + skipped + ", deleted=" + deleted);
  }
}

const replaceDocuments = db.transaction((documents) => {
  const incomingDocIds = new Set(documents.map((d) => d.id));
  for (const row of listDocumentIds.all()) {
    if (!incomingDocIds.has(row.id)) deleteDocumentById.run(row.id); // cascades its instances + rows
  }

  for (const doc of documents) {
    upsertDocument.run({
      id: doc.id, tailNumber: doc.tailNumber, aircraftModel: doc.aircraftModel,
      documentTypeId: doc.documentTypeId, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    });

    const incomingInstanceIds = new Set((doc.instances || []).map((i) => i.id));
    for (const row of listInstanceIdsForDocument.all(doc.id)) {
      if (!incomingInstanceIds.has(row.id)) deleteFormInstanceById.run(row.id); // cascades its rows
    }

    for (const inst of doc.instances || []) {
      const { base, rowsByKey } = splitInstanceData(inst.data);
      upsertFormInstance.run({
        id: inst.id, documentId: doc.id, formType: inst.formType,
        name: inst.name || "", complete: inst.complete ? 1 : 0, dataJson: JSON.stringify(base),
      });
      syncInstanceRows(inst.id, rowsByKey);
    }
  }
});

app.put("/api/documents", (req, res) => {
  const documents = req.body || [];
  logAction("REQUEST", "PUT /api/documents", documents.length + " document(s)");
  replaceDocuments(documents);
  logAction("RESPONSE", "PUT /api/documents", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Documents saved", documents.length + " document(s)");
});

const insertDefault = db.prepare(
  "INSERT INTO defaults (id, name, aircraft_model, document_type_id, created_at) VALUES (?, ?, ?, ?, ?)"
);
const insertDefaultInstance = db.prepare(
  "INSERT INTO default_instances (id, default_id, form_type, name, complete, data_json) VALUES (?, ?, ?, ?, ?, ?)"
);

const replaceDefaults = db.transaction((defaults) => {
  db.exec("DELETE FROM default_instances; DELETE FROM defaults;");
  for (const def of defaults) {
    insertDefault.run(def.id, def.name, def.aircraftModel, def.documentTypeId, def.createdAt);
    for (const inst of def.instances || []) {
      insertDefaultInstance.run(inst.id, def.id, inst.formType, inst.name || "", inst.complete ? 1 : 0, JSON.stringify(inst.data));
    }
  }
});

app.put("/api/defaults", (req, res) => {
  const defaults = req.body || [];
  logAction("REQUEST", "PUT /api/defaults", defaults.length + " default(s)");
  replaceDefaults(defaults);
  logAction("RESPONSE", "PUT /api/defaults", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Defaults saved", defaults.length + " default(s)");
});

const insertFieldLayout = db.prepare("INSERT INTO field_layouts (form_type, layout_json) VALUES (?, ?)");
const replaceFieldLayouts = db.transaction((layouts) => {
  db.exec("DELETE FROM field_layouts;");
  for (const formType of Object.keys(layouts || {})) {
    insertFieldLayout.run(formType, JSON.stringify(layouts[formType]));
  }
});

app.put("/api/field-layouts", (req, res) => {
  const layouts = req.body || {};
  logAction("REQUEST", "PUT /api/field-layouts", Object.keys(layouts).length + " form type(s)");
  replaceFieldLayouts(layouts);
  logAction("RESPONSE", "PUT /api/field-layouts", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Field layouts saved", Object.keys(layouts).length + " form type(s)");
});

const insertAircraftModel = db.prepare("INSERT INTO aircraft_models (name, position) VALUES (?, ?)");
const replaceAircraftModels = db.transaction((models) => {
  db.exec("DELETE FROM aircraft_models;");
  models.forEach((name, i) => insertAircraftModel.run(name, i));
});

app.put("/api/registry/aircraft-models", (req, res) => {
  const models = req.body || [];
  logAction("REQUEST", "PUT /api/registry/aircraft-models", models.length + " model(s)");
  replaceAircraftModels(models);
  logAction("RESPONSE", "PUT /api/registry/aircraft-models", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Aircraft models saved", models.length + " model(s)");
});

const insertDocumentType = db.prepare(
  "INSERT INTO document_types (id, name, models_json, position) VALUES (?, ?, ?, ?)"
);
const replaceDocumentTypes = db.transaction((types) => {
  db.exec("DELETE FROM document_types;");
  types.forEach((dt, i) => insertDocumentType.run(dt.id, dt.name, JSON.stringify(dt.models || []), i));
});

app.put("/api/registry/document-types", (req, res) => {
  const types = req.body || [];
  logAction("REQUEST", "PUT /api/registry/document-types", types.length + " type(s)");
  replaceDocumentTypes(types);
  logAction("RESPONSE", "PUT /api/registry/document-types", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Document types saved", types.length + " type(s)");
});

const insertDocTypeForm = db.prepare(
  "INSERT INTO document_type_forms (document_type_id, form_type, position) VALUES (?, ?, ?)"
);
const replaceDocumentTypeForms = db.transaction((map) => {
  db.exec("DELETE FROM document_type_forms;");
  for (const docTypeId of Object.keys(map || {})) {
    (map[docTypeId] || []).forEach((formType, i) => insertDocTypeForm.run(docTypeId, formType, i));
  }
});

app.put("/api/registry/document-type-forms", (req, res) => {
  const map = req.body || {};
  logAction("REQUEST", "PUT /api/registry/document-type-forms", Object.keys(map).length + " document type(s)");
  replaceDocumentTypeForms(map);
  logAction("RESPONSE", "PUT /api/registry/document-type-forms", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Document-type form assignments saved", Object.keys(map).length + " document type(s)");
});

const insertCustomFormType = db.prepare("INSERT INTO custom_form_types (type, schema_json) VALUES (?, ?)");
const replaceCustomFormTypes = db.transaction((types) => {
  db.exec("DELETE FROM custom_form_types;");
  for (const ft of types) insertCustomFormType.run(ft.type, JSON.stringify(ft));
});

app.put("/api/registry/custom-form-types", (req, res) => {
  const types = req.body || [];
  logAction("REQUEST", "PUT /api/registry/custom-form-types", types.length + " type(s)");
  replaceCustomFormTypes(types);
  logAction("RESPONSE", "PUT /api/registry/custom-form-types", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Custom form types saved", types.length + " type(s)");
});

// Built-in types (DA 2408-17/18/20) — now also structurally editable (the
// same Structure Builder / Form Type Editor a custom type gets), so they
// need a write path too. Mirrors custom_form_types exactly; readFormTypes()
// orders by rowid, so a delete-all-reinsert here preserves whatever order
// the client's FORM_TYPES array was already in (unaffected by editing a
// type's content).
const insertFormType = db.prepare("INSERT INTO form_types (type, schema_json) VALUES (?, ?)");
const replaceFormTypes = db.transaction((types) => {
  db.exec("DELETE FROM form_types;");
  for (const ft of types) insertFormType.run(ft.type, JSON.stringify(ft));
});

app.put("/api/registry/form-types", (req, res) => {
  const types = req.body || [];
  logAction("REQUEST", "PUT /api/registry/form-types", types.length + " type(s)");
  replaceFormTypes(types);
  logAction("RESPONSE", "PUT /api/registry/form-types", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Form types saved", types.length + " type(s)");
});

const insertFormTypeOverride = db.prepare(
  "INSERT INTO form_type_overrides (form_type, overrides_json) VALUES (?, ?)"
);
const replaceFormTypeOverrides = db.transaction((overrides) => {
  db.exec("DELETE FROM form_type_overrides;");
  for (const formType of Object.keys(overrides || {})) {
    insertFormTypeOverride.run(formType, JSON.stringify(overrides[formType]));
  }
});

app.put("/api/registry/form-type-overrides", (req, res) => {
  const overrides = req.body || {};
  logAction("REQUEST", "PUT /api/registry/form-type-overrides", Object.keys(overrides).length + " override(s)");
  replaceFormTypeOverrides(overrides);
  logAction("RESPONSE", "PUT /api/registry/form-type-overrides", "200 ok");
  res.json({ ok: true });
  logAction("SYNC", "Form-type overrides saved", Object.keys(overrides).length + " override(s)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDF-gen (07-pdfgen-dbnormal) listening on http://localhost:${PORT}`);
});
