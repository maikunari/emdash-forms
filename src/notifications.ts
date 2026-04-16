/**
 * emdash-forms — Email notifications
 *
 * Per SPEC-v1.md §7. Two kinds of mail: admin notification (when
 * `notifications.notifyAdmin`) and submitter confirmation (when
 * `notifications.confirmationEmail` and the submission has an email
 * field). Both support `{{fieldId}}` merge tags in subject/body.
 *
 * No email provider? Silently skip. The admin `/` page renders a
 * banner separately (see Phase 2).
 */

import type { LogAccess, PluginContext } from "emdash";
import type { Form, FormField, NotificationSettings, Submission } from "./types.js";

/**
 * Structural shape of the email accessor — emdash doesn't re-export
 * `EmailAccess` or `EmailMessage` as named types, only surfaces them
 * via `PluginContext["email"]`. Derive from there.
 */
type EmailAccess = NonNullable<PluginContext["email"]>;

// ─── Merge tags ──────────────────────────────────────────────────────

/**
 * Replace `{{fieldId}}` placeholders with submission values. Missing
 * keys render as empty strings. No nested expressions, no filters —
 * Mustache-lite. SPEC §7.1.
 *
 * Values are stringified; HTML escaping is the caller's responsibility
 * (we escape in HTML bodies, not in text bodies or subjects).
 */
export function renderMergeTags(
	template: string,
	data: Record<string, unknown>,
): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, key: string) => {
		const value = data[key];
		if (value === undefined || value === null) return "";
		if (Array.isArray(value)) return value.map(String).join(", ");
		return String(value);
	});
}

/**
 * HTML-escape a string. Used for field values rendered into default
 * HTML email bodies. Custom admin-authored `adminBody` / `confirmationBody`
 * are rendered as-is (admin-trusted HTML; the merge-tag values inside
 * are escaped by `renderMergeTagsHtml`).
 */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Like renderMergeTags, but HTML-escapes interpolated values.
 * For custom bodies that contain admin-authored HTML + merge tags.
 */
export function renderMergeTagsHtml(
	template: string,
	data: Record<string, unknown>,
): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, key: string) => {
		const value = data[key];
		if (value === undefined || value === null) return "";
		if (Array.isArray(value)) return escapeHtml(value.map(String).join(", "));
		return escapeHtml(String(value));
	});
}

// ─── Default email bodies ────────────────────────────────────────────

/** Build a plain-text summary of every submitted field: `Label: value\n…` */
function buildTextSummary(fields: FormField[], data: Record<string, unknown>): string {
	return fields
		.filter((f) => f.type !== "hidden")
		.map((f) => {
			const raw = data[f.id];
			const value = Array.isArray(raw) ? raw.join(", ") : (raw ?? "");
			return `${f.label}: ${value}`;
		})
		.join("\n");
}

/** Build an HTML `<table>` summary of every submitted field. */
function buildHtmlSummary(fields: FormField[], data: Record<string, unknown>): string {
	const rows = fields
		.filter((f) => f.type !== "hidden")
		.map((f) => {
			const raw = data[f.id];
			const value = Array.isArray(raw) ? raw.join(", ") : (raw ?? "");
			return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap">${escapeHtml(f.label)}</td><td style="padding:6px 0">${escapeHtml(String(value))}</td></tr>`;
		})
		.join("");
	return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${rows}</table>`;
}

function defaultAdminSubject(form: Form): string {
	return `New submission: ${form.title}`;
}

function defaultAdminHtml(form: Form, data: Record<string, unknown>): string {
	return `<div style="font-family:system-ui,sans-serif;max-width:600px"><h2 style="font-size:16px;font-weight:600;margin:0 0 16px">New submission — ${escapeHtml(form.title)}</h2>${buildHtmlSummary(form.fields, data)}</div>`;
}

function defaultAdminText(form: Form, data: Record<string, unknown>): string {
	return `New submission: ${form.title}\n\n${buildTextSummary(form.fields, data)}`;
}

function defaultConfirmationSubject(form: Form): string {
	return `Thanks for your submission — ${form.title}`;
}

function defaultConfirmationHtml(form: Form, data: Record<string, unknown>): string {
	return `<div style="font-family:system-ui,sans-serif;max-width:600px"><h2 style="font-size:16px;font-weight:600;margin:0 0 16px">Thank you</h2><p style="margin:0 0 16px;color:#52525b">We've received your submission and will get back to you soon.</p>${buildHtmlSummary(form.fields, data)}</div>`;
}

function defaultConfirmationText(form: Form, data: Record<string, unknown>): string {
	return `Thank you — we've received your submission.\n\n${buildTextSummary(form.fields, data)}`;
}

// ─── Submitter email resolution ──────────────────────────────────────

/**
 * Find the submitter's email address in the submission data. Preference:
 * 1. First field of type "email"
 * 2. Field whose id matches /^email$/i
 *
 * Returns undefined if none found (confirmation is silently skipped).
 */
export function findSubmitterEmail(
	fields: FormField[],
	data: Record<string, unknown>,
): string | undefined {
	const emailField = fields.find((f) => f.type === "email");
	if (emailField) {
		const value = data[emailField.id];
		if (typeof value === "string" && value.length > 0) return value;
	}

	for (const [key, value] of Object.entries(data)) {
		if (/^email$/i.test(key) && typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return undefined;
}

// ─── Dispatch ────────────────────────────────────────────────────────

export interface SendNotificationsInput {
	form: Form;
	submission: Submission;
	/** Fallback recipient when `notifications.adminEmail` is blank. */
	defaultAdminEmail?: string;
}

/**
 * Fire admin + confirmation emails per the form's notification settings.
 *
 * Design:
 * - If `email` is undefined (capability granted but no provider configured),
 *   log once at warn and return. Caller already checks ctx.email presence,
 *   but belt-and-braces keeps this module self-contained.
 * - Each email is wrapped in its own try/catch. One failure doesn't block
 *   the other. Errors are logged, never propagated — the submit handler
 *   has already persisted the submission; we don't want a transient SMTP
 *   failure to 500 the submitter.
 */
export async function sendNotifications(
	email: EmailAccess | undefined,
	log: LogAccess,
	input: SendNotificationsInput,
): Promise<void> {
	if (!email) {
		log.warn("[emdash-forms] skipped notifications — no email provider configured");
		return;
	}

	const { form, submission, defaultAdminEmail } = input;
	const notifications: NotificationSettings = form.settings.notifications;
	const data = submission.data;

	// ─── Admin notification ─────────────────────────────────────
	if (notifications.notifyAdmin) {
		const recipient = notifications.adminEmail?.trim() || defaultAdminEmail?.trim() || "";
		if (recipient.length === 0) {
			log.info("[emdash-forms] admin notification enabled but no recipient configured", {
				formId: submission.formId,
			});
		} else {
			try {
				const subject = notifications.adminSubject
					? renderMergeTags(notifications.adminSubject, data)
					: defaultAdminSubject(form);
				const html = notifications.adminBody
					? renderMergeTagsHtml(notifications.adminBody, data)
					: defaultAdminHtml(form, data);
				const text = defaultAdminText(form, data);

				await email.send({ to: recipient, subject, text, html });
				log.info("[emdash-forms] admin notification sent", {
					formId: submission.formId,
					to: recipient,
				});
			} catch (err) {
				log.error("[emdash-forms] admin notification failed", {
					formId: submission.formId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	// ─── Submitter confirmation ─────────────────────────────────
	if (notifications.confirmationEmail) {
		const recipient = findSubmitterEmail(form.fields, data);
		if (!recipient) {
			log.info("[emdash-forms] confirmation enabled but no email field in submission", {
				formId: submission.formId,
			});
		} else {
			try {
				const subject = notifications.confirmationSubject
					? renderMergeTags(notifications.confirmationSubject, data)
					: defaultConfirmationSubject(form);
				const html = notifications.confirmationBody
					? renderMergeTagsHtml(notifications.confirmationBody, data)
					: defaultConfirmationHtml(form, data);
				const text = defaultConfirmationText(form, data);

				await email.send({ to: recipient, subject, text, html });
				log.info("[emdash-forms] confirmation sent", {
					formId: submission.formId,
					to: recipient,
				});
			} catch (err) {
				log.error("[emdash-forms] confirmation failed", {
					formId: submission.formId,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}
}
