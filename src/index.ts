// ---------------------------------------------------------------------------
// emdash-forms — Plugin descriptor factory
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS emdash_forms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  config JSON NOT NULL,
  settings JSON NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emdash_form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data JSON NOT NULL,
  metadata JSON,
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (form_id) REFERENCES emdash_forms(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_form_id
  ON emdash_form_submissions(form_id);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON emdash_form_submissions(created_at);

CREATE INDEX IF NOT EXISTS idx_forms_slug
  ON emdash_forms(slug);
`;

export default function emdashForms() {
  return {
    name: "emdash-forms",
    version: "0.1.0",
    displayName: "EmDash Forms",
    description: "Best-in-class forms plugin for EmDash — contact forms, lead capture, surveys, and more.",
    capabilities: [
      "db:read",
      "db:write",
      "email:send",
      "storage:write",
      "network:fetch",
    ],
    schema: SCHEMA_SQL,
    entry: "./sandbox-entry.js",
  };
}
