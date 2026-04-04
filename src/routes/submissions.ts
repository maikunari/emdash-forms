// ---------------------------------------------------------------------------
// emdash-forms — Admin submission routes
// ---------------------------------------------------------------------------

import type { PluginContext, FormSubmission } from "../types.js";

/** GET /submissions/:formId — list submissions for a form */
export async function listSubmissions(
  ctx: PluginContext,
  _request: Request,
  params: { formId: string }
): Promise<Response> {
  const { results } = await ctx.db
    .prepare(
      `SELECT * FROM emdash_form_submissions
       WHERE form_id = ?
       ORDER BY created_at DESC`
    )
    .bind(params.formId)
    .all<FormSubmission>();

  return new Response(JSON.stringify({ submissions: results }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** DELETE /submissions/:id — delete a single submission */
export async function deleteSubmission(
  ctx: PluginContext,
  _request: Request,
  params: { id: string }
): Promise<Response> {
  await ctx.db
    .prepare("DELETE FROM emdash_form_submissions WHERE id = ?")
    .bind(params.id)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** POST /submissions/:id/read — mark a submission as read */
export async function markRead(
  ctx: PluginContext,
  _request: Request,
  params: { id: string }
): Promise<Response> {
  const now = new Date().toISOString();

  await ctx.db
    .prepare("UPDATE emdash_form_submissions SET read_at = ? WHERE id = ?")
    .bind(now, params.id)
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

/** GET /submissions/:formId/export — export submissions as CSV */
export async function exportCsv(
  ctx: PluginContext,
  _request: Request,
  params: { formId: string }
): Promise<Response> {
  const { results } = await ctx.db
    .prepare(
      `SELECT * FROM emdash_form_submissions
       WHERE form_id = ?
       ORDER BY created_at DESC`
    )
    .bind(params.formId)
    .all<{ id: string; data: string; created_at: string; read_at: string | null }>();

  if (results.length === 0) {
    return new Response("No submissions", {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=submissions.csv",
      },
    });
  }

  // Collect all unique field keys from submissions
  const allKeys = new Set<string>();
  const parsed = results.map((row) => {
    const data =
      typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    Object.keys(data as Record<string, unknown>).forEach((k) => allKeys.add(k));
    return { ...row, data: data as Record<string, unknown> };
  });

  const headers = ["id", "created_at", "read_at", ...Array.from(allKeys)];

  const csvRows = [
    headers.map(csvEscape).join(","),
    ...parsed.map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.created_at),
        csvEscape(row.read_at || ""),
        ...Array.from(allKeys).map((k) =>
          csvEscape(String(row.data[k] ?? ""))
        ),
      ].join(",")
    ),
  ];

  return new Response(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=submissions-${params.formId}.csv`,
    },
  });
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
