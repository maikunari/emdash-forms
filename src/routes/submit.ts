// ---------------------------------------------------------------------------
// emdash-forms — Public form submission handler
// ---------------------------------------------------------------------------

import type { PluginContext, Form, FormField, FormStep } from "../types.js";
import { sendNotifications } from "../notifications.js";

function generateId(): string {
  return crypto.randomUUID();
}

/** Flatten fields from either single-step or multi-step form config */
function getAllFields(form: Form): FormField[] {
  if (form.config.fields) return form.config.fields;
  if (form.config.steps) return form.config.steps.flatMap((s: FormStep) => s.fields);
  return [];
}

/** Validate required fields are present */
function validateSubmission(
  fields: FormField[],
  data: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (field.required && !data[field.id]) {
      errors.push(`${field.label} is required`);
    }
  }
  return errors;
}

/** Verify Cloudflare Turnstile token */
async function verifyTurnstile(
  ctx: PluginContext,
  token: string
): Promise<boolean> {
  const secretKey = ctx.pluginSettings["turnstileSecretKey"];
  if (!secretKey) return true; // skip if not configured

  const res = await ctx.http.fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
      }),
    }
  );

  const result = (await res.json()) as { success: boolean };
  return result.success;
}

export async function submitHandler(
  ctx: PluginContext,
  request: Request,
  params: { formSlug: string }
): Promise<Response> {
  // Look up form by slug
  const form = await ctx.db
    .prepare("SELECT * FROM emdash_forms WHERE slug = ?")
    .bind(params.formSlug)
    .first<{
      id: string;
      title: string;
      slug: string;
      config: string;
      settings: string;
      created_at: string;
      updated_at: string;
    }>();

  if (!form) {
    return new Response(JSON.stringify({ error: "Form not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsedForm: Form = {
    ...form,
    config: JSON.parse(form.config),
    settings: JSON.parse(form.settings),
  };

  // Parse body
  let body: Record<string, unknown>;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = (await request.json()) as Record<string, unknown>;
  } else {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries());
  }

  // Turnstile verification
  if (parsedForm.settings.turnstile) {
    const token = (body["cf-turnstile-response"] as string) || "";
    const valid = await verifyTurnstile(ctx, token);
    if (!valid) {
      return new Response(
        JSON.stringify({ error: "Spam check failed. Please try again." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Remove turnstile token from stored data
  const { "cf-turnstile-response": _token, ...submissionData } = body;

  // Validate required fields
  const fields = getAllFields(parsedForm);
  const errors = validateSubmission(fields, submissionData);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", errors }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Store submission
  const submissionId = generateId();
  const now = new Date().toISOString();
  const metadata = {
    ip: request.headers.get("cf-connecting-ip") || undefined,
    userAgent: request.headers.get("user-agent") || undefined,
    referer: request.headers.get("referer") || undefined,
  };

  await ctx.db
    .prepare(
      `INSERT INTO emdash_form_submissions (id, form_id, data, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      submissionId,
      parsedForm.id,
      JSON.stringify(submissionData),
      JSON.stringify(metadata),
      now
    )
    .run();

  // Send notifications
  await sendNotifications(ctx, parsedForm, submissionData);

  // Response
  const response: Record<string, unknown> = {
    success: true,
    message: parsedForm.settings.successMessage,
  };
  if (parsedForm.settings.redirectUrl) {
    response.redirect = parsedForm.settings.redirectUrl;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
