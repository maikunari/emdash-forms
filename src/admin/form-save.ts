/**
 * emdash-forms — Form-edit save handlers
 *
 * Three save handlers matching the three form blocks in form-edit.ts:
 *  - saveFormMetadata — title, slug, status
 *  - saveFormBehavior — submitLabel, successMessage, redirectUrl, spamProtection
 *  - saveFormNotifications — notify toggles + subject/body templates
 *
 * Plus one creation handler:
 *  - createFormFromTemplate — spawns a form by template id (for the
 *    "New from template" dropdown on the forms-list page)
 */

import type { PluginContext, StorageCollection } from "emdash";
import { buildFormEditPage } from "./pages/form-edit.js";
import type { BlockResponse } from "./router.js";
import { formFromTemplate } from "../handlers/lifecycle.js";
import { TEMPLATES_BY_ID } from "../templates/index.js";
import type { Form } from "../types.js";

const SLUG_REGEX = /^[a-z0-9-]+$/;

// ─── Metadata (title, slug, status) ──────────────────────────────────

export async function saveFormMetadata(
	ctx: PluginContext,
	formId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) return notFound(ctx, formId);

	const title = typeof values.title === "string" ? values.title.trim() : "";
	const slugRaw = typeof values.slug === "string" ? values.slug.trim().toLowerCase() : "";
	const active = values.active === true;

	if (title.length === 0) {
		return {
			...(await buildFormEditPage(ctx, formId)),
			toast: { message: "Title is required.", type: "error" },
		};
	}
	if (!SLUG_REGEX.test(slugRaw)) {
		return {
			...(await buildFormEditPage(ctx, formId)),
			toast: {
				message: `Slug "${slugRaw}" is invalid. Use lowercase letters, numbers, and hyphens.`,
				type: "error",
			},
		};
	}
	// Uniqueness check — only if slug changed.
	if (slugRaw !== existing.slug) {
		const clash = await forms.query({ where: { slug: slugRaw }, limit: 1 });
		if (clash.items.length > 0) {
			return {
				...(await buildFormEditPage(ctx, formId)),
				toast: {
					message: `Another form already uses slug "${slugRaw}".`,
					type: "error",
				},
			};
		}
	}

	const updated: Form = {
		...existing,
		title,
		slug: slugRaw,
		status: active ? "active" : "paused",
		updatedAt: new Date().toISOString(),
	};
	await forms.put(formId, updated);
	ctx.log.info("[emdash-forms] form metadata saved", {
		formId,
		slug: slugRaw,
		active,
	});

	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: { message: "Form details saved", type: "success" },
	};
}

// ─── Behavior (submit label, success, redirect, spam protection) ─────

export async function saveFormBehavior(
	ctx: PluginContext,
	formId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) return notFound(ctx, formId);

	const submitLabel =
		typeof values.submitLabel === "string" && values.submitLabel.trim().length > 0
			? values.submitLabel.trim()
			: "Submit";
	const successMessage =
		typeof values.successMessage === "string" ? values.successMessage : "";
	const redirectRaw = typeof values.redirectUrl === "string" ? values.redirectUrl.trim() : "";
	const redirectUrl = redirectRaw.length > 0 ? redirectRaw : undefined;
	const spamProtection: Form["settings"]["spamProtection"] =
		values.spamProtection === "turnstile" ? "turnstile" : "honeypot";

	// Warn (not error) if admin picked Turnstile but hasn't configured
	// keys yet. Submissions will fail-closed at submit time; better to
	// surface here too.
	let extraToast: BlockResponse["toast"] | undefined;
	if (spamProtection === "turnstile") {
		const secret = (await ctx.kv.get<string>("settings:turnstileSecretKey")) ?? "";
		if (secret.length === 0) {
			extraToast = {
				message:
					"Turnstile selected but no keys are configured. Submissions will fail until you set them in Settings.",
				type: "info",
			};
		}
	}

	const updated: Form = {
		...existing,
		settings: {
			...existing.settings,
			submitLabel,
			successMessage,
			redirectUrl,
			spamProtection,
		},
		updatedAt: new Date().toISOString(),
	};
	await forms.put(formId, updated);
	ctx.log.info("[emdash-forms] form behavior saved", { formId, spamProtection });

	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: extraToast ?? { message: "Behavior saved", type: "success" },
	};
}

// ─── Notifications ───────────────────────────────────────────────────

export async function saveFormNotifications(
	ctx: PluginContext,
	formId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) return notFound(ctx, formId);

	const notifyAdmin = values.notifyAdmin === true;
	const confirmationEmail = values.confirmationEmail === true;

	// Only persist sub-fields when their parent toggle is on. Keeps the
	// data model clean — turning notifications off drops the templates
	// so we don't persist stale configuration.
	const adminEmail =
		notifyAdmin && typeof values.adminEmail === "string" && values.adminEmail.trim().length > 0
			? values.adminEmail.trim()
			: undefined;
	const adminSubject =
		notifyAdmin && typeof values.adminSubject === "string" && values.adminSubject.trim().length > 0
			? values.adminSubject.trim()
			: undefined;
	const adminBody =
		notifyAdmin && typeof values.adminBody === "string" && values.adminBody.trim().length > 0
			? values.adminBody.trim()
			: undefined;

	const confirmationSubject =
		confirmationEmail &&
		typeof values.confirmationSubject === "string" &&
		values.confirmationSubject.trim().length > 0
			? values.confirmationSubject.trim()
			: undefined;
	const confirmationBody =
		confirmationEmail &&
		typeof values.confirmationBody === "string" &&
		values.confirmationBody.trim().length > 0
			? values.confirmationBody.trim()
			: undefined;

	// Sanity: confirmation emails need an email-type field to target.
	let extraToast: BlockResponse["toast"] | undefined;
	if (confirmationEmail) {
		const hasEmailField = existing.fields.some(
			(f) => f.type === "email" || /^email$/i.test(f.id),
		);
		if (!hasEmailField) {
			extraToast = {
				message:
					"Confirmation enabled but no field of type 'email' exists. Confirmations will be silently skipped until one is added.",
				type: "info",
			};
		}
	}

	const updated: Form = {
		...existing,
		settings: {
			...existing.settings,
			notifications: {
				notifyAdmin,
				adminEmail,
				adminSubject,
				adminBody,
				confirmationEmail,
				confirmationSubject,
				confirmationBody,
			},
		},
		updatedAt: new Date().toISOString(),
	};
	await forms.put(formId, updated);
	ctx.log.info("[emdash-forms] form notifications saved", {
		formId,
		notifyAdmin,
		confirmationEmail,
	});

	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: extraToast ?? { message: "Notifications saved", type: "success" },
	};
}

// ─── New from template ───────────────────────────────────────────────

/**
 * Spawn a new form from a template id. Called when the admin picks
 * an entry from the "New from template" dropdown on the forms list.
 *
 * On slug collision (e.g. the template's canonical slug is taken),
 * append a numeric suffix: contact → contact-2 → contact-3…
 * This happens when an admin has already seeded + renamed a template
 * form, so the original slug is available for a fresh copy.
 */
export async function createFormFromTemplate(
	ctx: PluginContext,
	templateId: string,
): Promise<BlockResponse> {
	const template = TEMPLATES_BY_ID[templateId];
	if (!template) {
		return {
			blocks: [],
			toast: { message: `Unknown template "${templateId}"`, type: "error" },
		};
	}

	const forms = ctx.storage.forms as StorageCollection<Form>;
	const { id, data: baseForm } = formFromTemplate(template);

	// Slug collision: append -2, -3, etc.
	let slug = baseForm.slug;
	let suffix = 2;
	while ((await forms.query({ where: { slug }, limit: 1 })).items.length > 0) {
		slug = `${baseForm.slug}-${suffix}`;
		suffix += 1;
		if (suffix > 100) {
			return {
				blocks: [],
				toast: {
					message: `Could not find an available slug for template "${templateId}".`,
					type: "error",
				},
			};
		}
	}

	await forms.put(id, { ...baseForm, slug });
	ctx.log.info("[emdash-forms] form created from template", { templateId, id, slug });

	return {
		...(await buildFormEditPage(ctx, id)),
		toast: { message: `Created "${template.title}" from template`, type: "success" },
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function notFound(ctx: PluginContext, formId: string): Promise<BlockResponse> {
	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: { message: "Form not found — it may have been deleted.", type: "error" },
	};
}
