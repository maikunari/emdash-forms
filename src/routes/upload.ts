// ---------------------------------------------------------------------------
// emdash-forms — File upload handler (R2 presigned URLs)
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

/** POST /upload/presign — generate a presigned upload URL */
export async function presignUpload(
  ctx: PluginContext,
  request: Request
): Promise<Response> {
  const body = (await request.json()) as {
    filename: string;
    contentType: string;
    formId: string;
    fieldId: string;
  };

  const key = `forms/${body.formId}/${body.fieldId}/${Date.now()}-${body.filename}`;

  const url = await ctx.storage.createPresignedUrl(key, {
    expiresIn: 3600,
    contentType: body.contentType,
  });

  return new Response(
    JSON.stringify({
      uploadUrl: url,
      key,
      publicUrl: ctx.storage.getPublicUrl(key),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
