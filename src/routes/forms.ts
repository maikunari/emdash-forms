// ---------------------------------------------------------------------------
// emdash-forms — Admin CRUD routes for forms
// ---------------------------------------------------------------------------

import type { PluginContext, Form, FormConfig, FormSettings } from "../types.js";

function generateId(): string {
  return crypto.randomUUID();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** GET /forms — list all forms with submission counts */
export async function listForms(
  ctx: PluginContext
): Promise<Response> {
  const { results } = await ctx.db
    .prepare(
      `SELECT f.*, COUNT(s.id) as submission_count
       FROM emdash_forms f
       LEFT JOIN emdash_form_submissions s ON s.form_id = f.id
       GROUP BY f.id
       ORDER BY f.created_at DESC`
    )
    .all<Form & { submission_count: number }>();

  return new Response(JSON.stringify({ forms: results }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** POST /forms — create a new form */
export async function createForm(
  ctx: PluginContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as {
    title: string;
    slug?: string;
    config: FormConfig;
    settings: FormSettings;
  };

  const id = generateId();
  const slug = body.slug || slugify(body.title);
  const now = new Date().toISOString();

  await ctx.db
    .prepare(
      `INSERT INTO emdash_forms (id, title, slug, config, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      body.title,
      slug,
      JSON.stringify(body.config),
      JSON.stringify(body.settings),
      now,
      now
    )
    .run();

  return new Response(JSON.stringify({ id, slug }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

/** PUT /forms/:id — update a form */
export async function updateForm(
  ctx: PluginContext,
  request: Request,
  params: { id: string }
): Promise<Response> {
  const body = (await request.json()) as Partial<{
    title: string;
    slug: string;
    config: FormConfig;
    settings: FormSettings;
  }>;

  const existing = await ctx.db
    .prepare("SELECT * FROM emdash_forms WHERE id = ?")
    .bind(params.id)
    .first();

  if (!existing) {
    return new Response(JSON.stringify({ error: "Form not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();

  await ctx.db
    .prepare(
      `UPDATE emdash_forms
       SET title = ?, slug = ?, config = ?, settings = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      body.title || (existing as Record<string, unknown>).title,
      body.slug || (existing as Record<string, unknown>).slug,
      body.config ? JSON.stringify(body.config) : (existing as Record<string, unknown>).config,
      body.settings ? JSON.stringify(body.settings) : (existing as Record<string, unknown>).settings,
      now,
      params.id
    )
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** DELETE /forms/:id — delete a form and its submissions */
export async function deleteForm(
  ctx: PluginContext,
  _request: Request,
  params: { id: string }
): Promise<Response> {
  await ctx.db
    .prepare("DELETE FROM emdash_form_submissions WHERE form_id = ?")
    .bind(params.id)
    .run();

  await ctx.db
    .prepare("DELETE FROM emdash_forms WHERE id = ?")
    .bind(params.id)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
