// ---------------------------------------------------------------------------
// emdash-forms — Email notification handlers
// ---------------------------------------------------------------------------

import type { PluginContext, Form } from "./types.js";

/** Replace {{field_name}} merge tags with submission values */
function mergeTags(
  template: string,
  data: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = data[key];
    return val != null ? String(val) : "";
  });
}

/** Build a plain-text summary of all submitted fields */
function buildFieldSummary(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** Build an HTML summary table of submitted fields */
function buildFieldSummaryHtml(data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(
      ([key, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${escapeHtml(key)}</td><td style="padding:6px 0">${escapeHtml(String(value ?? ""))}</td></tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rows}</table>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Send admin and/or confirmation emails */
export async function sendNotifications(
  ctx: PluginContext,
  form: Form,
  data: Record<string, unknown>
): Promise<void> {
  const { notifications } = form.settings;
  if (!notifications) return;

  const fromName = notifications.fromName || "EmDash Forms";
  const fromEmail = ctx.pluginSettings["fromEmail"] || "forms@emdash.io";
  const from = `${fromName} <${fromEmail}>`;

  // Admin notification
  if (notifications.notifyAdmin) {
    const adminEmail =
      notifications.adminEmail || ctx.pluginSettings["adminEmail"];
    if (adminEmail) {
      const subject = notifications.adminSubject
        ? mergeTags(notifications.adminSubject, data)
        : `New submission: ${form.title}`;

      const html = notifications.adminBody
        ? mergeTags(notifications.adminBody, data)
        : `
          <div style="font-family:system-ui,sans-serif;max-width:600px">
            <h2 style="font-size:16px;font-weight:600;margin:0 0 16px">New submission — ${escapeHtml(form.title)}</h2>
            ${buildFieldSummaryHtml(data)}
          </div>
        `.trim();

      await ctx.email.send({
        to: adminEmail,
        from,
        subject,
        html,
        text: `New submission: ${form.title}\n\n${buildFieldSummary(data)}`,
      });
    }
  }

  // Confirmation email to submitter
  if (notifications.confirmationEmail) {
    const submitterEmail = (data["email"] as string) || (data["Email"] as string);
    if (submitterEmail) {
      const subject = notifications.confirmationSubject
        ? mergeTags(notifications.confirmationSubject, data)
        : `Thanks for your submission`;

      const html = notifications.confirmationBody
        ? mergeTags(notifications.confirmationBody, data)
        : `
          <div style="font-family:system-ui,sans-serif;max-width:600px">
            <h2 style="font-size:16px;font-weight:600;margin:0 0 16px">Thank you</h2>
            <p style="margin:0 0 16px;color:#52525b">We've received your submission and will get back to you soon.</p>
            ${buildFieldSummaryHtml(data)}
          </div>
        `.trim();

      await ctx.email.send({
        to: submitterEmail,
        from,
        subject,
        html,
        text: `Thank you — we've received your submission.\n\n${buildFieldSummary(data)}`,
      });
    }
  }
}
