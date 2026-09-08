const path = require("path");
const express = require("express");
const db = require("./db");

const app = express();
app.use(express.json({ limit: "50mb" })); // custom form types / signature overlays carry base64 bytes

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
      data: JSON.parse(i.data_json),
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
  res.json({
    documents: readDocuments(),
    defaults: readDefaults(),
    fieldLayouts: readFieldLayouts(),
    aircraftModels: readAircraftModels(),
    documentTypes: readDocumentTypes(),
    documentTypeForms: readDocumentTypeForms(),
    formTypes: readFormTypes(),
    customFormTypes: readCustomFormTypes(),
    formTypeOverrides: readFormTypeOverrides(),
  });
});

// ---------------------------------------------------------------------------
// Write endpoints — one per persist*() call in index.html. Each replaces the
// whole table's contents inside a transaction (delete-then-reinsert): the
// datasets here are small, so this is simpler and safer than diffing,
// and matches the whole-array semantics persistLogbooks() etc. already had
// against localStorage.
// ---------------------------------------------------------------------------

const insertDocument = db.prepare(
  "INSERT INTO documents (id, tail_number, aircraft_model, document_type_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const insertFormInstance = db.prepare(
  "INSERT INTO form_instances (id, document_id, form_type, name, complete, data_json) VALUES (?, ?, ?, ?, ?, ?)"
);

const replaceDocuments = db.transaction((documents) => {
  db.exec("DELETE FROM form_instances; DELETE FROM documents;");
  for (const doc of documents) {
    insertDocument.run(doc.id, doc.tailNumber, doc.aircraftModel, doc.documentTypeId, doc.createdAt, doc.updatedAt);
    for (const inst of doc.instances || []) {
      insertFormInstance.run(inst.id, doc.id, inst.formType, inst.name || "", inst.complete ? 1 : 0, JSON.stringify(inst.data));
    }
  }
});

app.put("/api/documents", (req, res) => {
  replaceDocuments(req.body || []);
  res.json({ ok: true });
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
  replaceDefaults(req.body || []);
  res.json({ ok: true });
});

const insertFieldLayout = db.prepare("INSERT INTO field_layouts (form_type, layout_json) VALUES (?, ?)");
const replaceFieldLayouts = db.transaction((layouts) => {
  db.exec("DELETE FROM field_layouts;");
  for (const formType of Object.keys(layouts || {})) {
    insertFieldLayout.run(formType, JSON.stringify(layouts[formType]));
  }
});

app.put("/api/field-layouts", (req, res) => {
  replaceFieldLayouts(req.body || {});
  res.json({ ok: true });
});

const insertAircraftModel = db.prepare("INSERT INTO aircraft_models (name, position) VALUES (?, ?)");
const replaceAircraftModels = db.transaction((models) => {
  db.exec("DELETE FROM aircraft_models;");
  models.forEach((name, i) => insertAircraftModel.run(name, i));
});

app.put("/api/registry/aircraft-models", (req, res) => {
  replaceAircraftModels(req.body || []);
  res.json({ ok: true });
});

const insertDocumentType = db.prepare(
  "INSERT INTO document_types (id, name, models_json, position) VALUES (?, ?, ?, ?)"
);
const replaceDocumentTypes = db.transaction((types) => {
  db.exec("DELETE FROM document_types;");
  types.forEach((dt, i) => insertDocumentType.run(dt.id, dt.name, JSON.stringify(dt.models || []), i));
});

app.put("/api/registry/document-types", (req, res) => {
  replaceDocumentTypes(req.body || []);
  res.json({ ok: true });
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
  replaceDocumentTypeForms(req.body || {});
  res.json({ ok: true });
});

const insertCustomFormType = db.prepare("INSERT INTO custom_form_types (type, schema_json) VALUES (?, ?)");
const replaceCustomFormTypes = db.transaction((types) => {
  db.exec("DELETE FROM custom_form_types;");
  for (const ft of types) insertCustomFormType.run(ft.type, JSON.stringify(ft));
});

app.put("/api/registry/custom-form-types", (req, res) => {
  replaceCustomFormTypes(req.body || []);
  res.json({ ok: true });
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
  replaceFormTypes(req.body || []);
  res.json({ ok: true });
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
  replaceFormTypeOverrides(req.body || {});
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDF-gen (05-pdfgen-database) listening on http://localhost:${PORT}`);
});
