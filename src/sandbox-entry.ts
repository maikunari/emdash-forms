// ---------------------------------------------------------------------------
// emdash-forms — Sandbox entry point (definePlugin)
// ---------------------------------------------------------------------------

import type { PluginContext } from "./types.js";
import { submitHandler } from "./routes/submit.js";
import { listForms, createForm, updateForm, deleteForm } from "./routes/forms.js";
import { listSubmissions, deleteSubmission, markRead, exportCsv } from "./routes/submissions.js";
import { presignUpload } from "./routes/upload.js";
import { adminHandler } from "./admin/index.js";

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

type RouteHandler = (
  ctx: PluginContext,
  request: Request,
  params: Record<string, string>
) => Promise<Response>;

export default function definePlugin() {
  return {
    name: "emdash-forms",

    /** Run D1 migrations on install/upgrade */
    async onInstall(ctx: PluginContext): Promise<void> {
      await ctx.db.exec(SCHEMA_SQL);
    },

    routes: {
      // Public: form submission endpoint
      "POST /submit/:formSlug": ((ctx: PluginContext, req: Request, params: Record<string, string>) =>
        submitHandler(ctx, req, { formSlug: params.formSlug })) as RouteHandler,

      // Admin: form CRUD
      "GET /forms": ((ctx: PluginContext) =>
        listForms(ctx)) as unknown as RouteHandler,
      "POST /forms": ((ctx: PluginContext, req: Request) =>
        createForm(ctx, req)) as unknown as RouteHandler,
      "PUT /forms/:id": ((ctx: PluginContext, req: Request, params: Record<string, string>) =>
        updateForm(ctx, req, { id: params.id })) as RouteHandler,
      "DELETE /forms/:id": ((ctx: PluginContext, _req: Request, params: Record<string, string>) =>
        deleteForm(ctx, _req, { id: params.id })) as RouteHandler,

      // Admin: submissions
      "GET /submissions/:formId": ((ctx: PluginContext, _req: Request, params: Record<string, string>) =>
        listSubmissions(ctx, _req, { formId: params.formId })) as RouteHandler,
      "DELETE /submissions/:id": ((ctx: PluginContext, _req: Request, params: Record<string, string>) =>
        deleteSubmission(ctx, _req, { id: params.id })) as RouteHandler,
      "POST /submissions/:id/read": ((ctx: PluginContext, _req: Request, params: Record<string, string>) =>
        markRead(ctx, _req, { id: params.id })) as RouteHandler,
      "GET /submissions/:formId/export": ((ctx: PluginContext, _req: Request, params: Record<string, string>) =>
        exportCsv(ctx, _req, { formId: params.formId })) as RouteHandler,

      // File uploads
      "POST /upload/presign": ((ctx: PluginContext, req: Request) =>
        presignUpload(ctx, req)) as unknown as RouteHandler,

      // Admin Block Kit UI
      admin: ((ctx: PluginContext, req: Request) =>
        adminHandler(ctx, req)) as unknown as RouteHandler,
    },
  };
}
