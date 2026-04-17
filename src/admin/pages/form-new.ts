/**
 * emdash-forms — /forms/new admin page
 *
 * Per SPEC-v1.md §5.2 "Form creation flow": minimal title + slug page.
 * The field list, "Add field" control, and settings section are NOT
 * available here — they require a persisted form id. On Create, the
 * form is written with fields: [] and the admin routes to /forms/{id}
 * for the full builder.
 *
 * This mirrors the Block Kit constraint: every interaction is a server
 * round-trip, so ephemeral client-side drafts aren't a pattern that
 * works. Create early, iterate against storage.
 */

import type { PluginContext, StorageCollection } from "emdash";
import type { BlockResponse } from "../router.js";
import { buildFormsListPage } from "./forms-list.js";
import type { Form, FormSettings } from "../../types.js";

// ─── Constants ───────────────────────────────────────────────────────

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SLUG_DERIVE_REPLACE = /[^a-z0-9]+/g;
const SLUG_DERIVE_TRIM = /^-+|-+$/g;

// ─── Page builder ────────────────────────────────────────────────────

export function buildFormNewPage(): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "New form" },
			{
				type: "section",
				text: "Give the form a name to get started. Fields and settings come next.",
			},
			{
				type: "form",
				block_id: "form-new",
				fields: [
					{
						type: "text_input",
						action_id: "title",
						label: "Form title",
						placeholder: "Contact form",
						help_text: "Shown to admins in the forms list and as the default notification subject.",
					},
					{
						type: "text_input",
						action_id: "slug",
						label: "Slug (optional)",
						placeholder: "contact",
						help_text:
							"URL-safe identifier. Lowercase letters, numbers, and hyphens. Leave blank to auto-derive from the title.",
					},
				],
				submit: { label: "Create form", action_id: "form_create" },
			},
			{
				type: "actions",
				elements: [
					{ type: "button", text: "Cancel", action_id: "navigate:/" },
				],
			},
		],
	};
}

// ─── Action handler ──────────────────────────────────────────────────

/**
 * Validate + persist a new form from the /forms/new submission.
 * On success, navigates to /forms/{id} for the full builder.
 * On validation failure, re-renders /forms/new with the error.
 */
export async function createFormAction(
	ctx: PluginContext,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const rawTitle = typeof values.title === "string" ? values.title.trim() : "";
	const rawSlug = typeof values.slug === "string" ? values.slug.trim().toLowerCase() : "";

	if (rawTitle.length === 0) {
		return errorPage("Title is required.");
	}

	const slug = rawSlug.length > 0 ? rawSlug : deriveSlug(rawTitle);

	if (slug.length === 0) {
		return errorPage(
			"Could not derive a slug from the title. Please provide a slug manually (lowercase letters, numbers, hyphens).",
		);
	}

	if (!SLUG_REGEX.test(slug)) {
		return errorPage(
			`Slug "${slug}" is invalid. Use only lowercase letters, numbers, and hyphens.`,
		);
	}

	// Uniqueness check. The storage layer's uniqueIndexes on slug will
	// reject duplicates at put() time, but we catch early so we can
	// return a friendly error instead of a 500.
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.query({ where: { slug }, limit: 1 });
	if (existing.items.length > 0) {
		return errorPage(
			`A form with slug "${slug}" already exists. Pick a different slug or edit the existing form.`,
		);
	}

	// Persist with empty fields[] and default settings. The admin will
	// customize fields + notifications on /forms/{id}.
	const now = new Date().toISOString();
	const defaultSettings: FormSettings = {
		submitLabel: "Submit",
		successMessage: "Thanks! Your submission has been received.",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: false,
		},
		spamProtection: "honeypot",
	};

	const id = crypto.randomUUID();
	const form: Form = {
		title: rawTitle,
		slug,
		fields: [],
		settings: defaultSettings,
		status: "active",
		submissionCount: 0,
		lastSubmissionAt: null,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await forms.put(id, form);
	} catch (err) {
		// uniqueIndexes collision at storage level (race between the check
		// above and this put, or an older non-indexed duplicate).
		ctx.log.warn("[emdash-forms] form create failed at storage.put", {
			slug,
			err: err instanceof Error ? err.message : String(err),
		});
		return errorPage(
			`Could not create form with slug "${slug}". It may already exist.`,
		);
	}

	ctx.log.info("[emdash-forms] form created", { id, slug });

	// Ideally we navigate to /forms/{id} for the full builder. That
	// page is a Phase 3 commit-2 item, so for commit 1 we land the
	// admin on the forms list with a success toast — they can click
	// into the new form from there. Commit 2 switches this to a proper
	// /forms/{id} navigation.
	return {
		...(await buildFormsListPage(ctx)),
		toast: { message: `Form "${rawTitle}" created`, type: "success" },
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Derive a URL-safe slug from a title. Lowercase, alnum-dash only,
 * no leading/trailing dashes. Matches the slug regex.
 */
export function deriveSlug(title: string): string {
	return title.toLowerCase().replace(SLUG_DERIVE_REPLACE, "-").replace(SLUG_DERIVE_TRIM, "");
}

function errorPage(message: string): BlockResponse {
	return {
		...buildFormNewPage(),
		toast: { message, type: "error" },
	};
}
