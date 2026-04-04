-- emdash-forms D1 schema
-- Auto-migrated on plugin install via lifecycle hook

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
