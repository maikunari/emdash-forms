/**
 * emdash-forms — / admin page (forms list)
 *
 * Per SPEC-v1.md §5.2. Dashboard-style landing page:
 *  - Stats header: total forms, total submissions, unread count
 *  - Per-form section with overflow menu (View submissions, Pause/Activate, Delete)
 *  - Empty state when no forms exist
 *  - Primary "New form" button (wired in Phase 3)
 *  - "New from template" button — Phase 3 (dropdown for the 5 templates)
 */

import type { PluginContext, StorageCollection } from "emdash";
import { pluralize } from "../format.js";
import type { BlockResponse } from "../router.js";
import { TEMPLATES } from "../../templates/index.js";
import type { Form, Submission } from "../../types.js";

// Per-form overflow limit — capping the forms list prevents accidental
// pathological renders with 10,000 forms. Forms are admin-authored, not
// user-generated, so the ceiling can be high.
const FORMS_LIST_LIMIT = 200;

export async function buildFormsListPage(ctx: PluginContext): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;

	// Fetch forms ordered by creation (newest first).
	const formResult = await forms.query({
		orderBy: { createdAt: "desc" },
		limit: FORMS_LIST_LIMIT,
	});

	// Stats header aggregates: count across all forms + submissions.
	// submissions.count() queries indexed storage; cheap for v1 sizes.
	// If this becomes slow at scale, cache in settings:stats:* and
	// invalidate in submit + retention handlers.
	const totalForms = await forms.count();
	const totalSubmissions = await submissions.count();
	const unreadSubmissions = await submissions.count({ status: "new" });

	// No-email-provider banner (SPEC §7.4 — the last ⚠). Checks whether
	// any active form would attempt to send email + whether we have a
	// provider. Only renders the banner when BOTH are true; no point
	// pestering admins who deliberately run no-mail setups.
	const providerBanner = await buildEmailProviderBanner(ctx, formResult.items);

	const statsBlock = {
		type: "stats",
		stats: [
			{ label: "Forms", value: String(totalForms) },
			{ label: "Submissions", value: String(totalSubmissions) },
			{ label: "Unread", value: String(unreadSubmissions) },
		],
	};

	const headerBlocks: unknown[] = [
		{ type: "header", text: "Forms" },
		...(providerBanner ? [providerBanner] : []),
		statsBlock,
		{
			type: "actions",
			elements: [
				{
					type: "button",
					text: "New form",
					action_id: "navigate:/forms/new",
					style: "primary",
				},
				{
					type: "select",
					action_id: "form:new_from_template",
					placeholder: "New from template…",
					options: TEMPLATES.map((t) => ({
						label: t.title,
						value: t.id,
					})),
				},
				{
					type: "button",
					text: "Settings",
					action_id: "navigate:/settings",
				},
			],
		},
		{ type: "divider" },
	];

	// Empty state.
	if (formResult.items.length === 0) {
		return {
			blocks: [
				...headerBlocks,
				{
					type: "banner",
					variant: "default",
					title: "No forms yet",
					description: "Create a form from scratch or start from a template.",
				},
			],
		};
	}

	// Per-form sections. Each row shows title + slug + counts + overflow.
	const formBlocks = formResult.items.flatMap(({ id, data: form }) => {
		const subText = buildFormSubText(form);
		const accessory = {
			type: "overflow",
			action_id: `form:menu:${id}`,
			options: buildFormOverflowOptions(id, form.status),
		};

		return [
			{
				type: "section",
				text: `**${form.title}**\n${subText}`,
				accessory,
			},
			{ type: "divider" },
		];
	});

	return { blocks: [...headerBlocks, ...formBlocks] };
}

/**
 * Build the sub-text for a form row: slug · counts · status badge.
 * Kept explicit rather than templated so we can tweak punctuation
 * without digging into block builder code.
 */
function buildFormSubText(form: Form): string {
	const parts: string[] = [];
	parts.push(`/${form.slug}`);
	parts.push(pluralize(form.submissionCount, "submission"));
	if (form.status === "paused") parts.push("_(paused)_");
	return parts.join(" · ");
}

/**
 * No-email-provider banner per SPEC-v1.md §7.4.
 *
 * Checks:
 *  1. Any active form has notifyAdmin or confirmationEmail enabled?
 *     (No need to pester admins who deliberately run no-mail forms.)
 *  2. Is ctx.email absent? Absent = email:send capability granted
 *     but no provider plugin (e.g. @emdash-cms/plugin-resend) is
 *     configured to deliver.
 *
 * Both true → render the banner. Otherwise render nothing.
 *
 * ⚠ The "Install Resend" accessory links to a marketplace deep-link
 * URL whose exact pattern isn't verifiable until the marketplace UI
 * is public. The API at marketplace.emdashcms.com is confirmed; the
 * /plugins/{id} UI path is a plausible guess that matches the CLI's
 * verification checklist in SPEC §11.3. Follow-up issue tracks the
 * verification once the UI ships.
 */
const RESEND_MARKETPLACE_URL = "https://marketplace.emdashcms.com/plugins/emdash-resend";

async function buildEmailProviderBanner(
	ctx: PluginContext,
	formsList: ReadonlyArray<{ data: Form }>,
): Promise<Record<string, unknown> | null> {
	const anyWantsEmail = formsList.some(
		({ data }) =>
			data.status === "active" &&
			(data.settings.notifications.notifyAdmin ||
				data.settings.notifications.confirmationEmail),
	);
	if (!anyWantsEmail) return null;
	if (ctx.email !== undefined) return null;

	return {
		type: "banner",
		variant: "alert",
		title: "Email notifications are disabled",
		description:
			"One or more forms want to send email but no provider plugin is installed. Submissions are still stored — admin + confirmation emails are silently skipped.",
		accessory: {
			type: "button",
			text: "Install Resend",
			url: RESEND_MARKETPLACE_URL,
		},
	};
}

/**
 * Overflow menu options for a form row. Action ids embed the form id
 * so the action handler can parse it via .slice() — matches the
 * pattern from sandboxed-test/sandbox-entry.ts:96.
 */
function buildFormOverflowOptions(
	formId: string,
	status: Form["status"],
): Array<{ text: string; value: string }> {
	const options: Array<{ text: string; value: string }> = [
		{ text: "View submissions", value: `form:submissions:${formId}` },
		{ text: "Edit", value: `form:edit:${formId}` },
	];

	if (status === "active") {
		options.push({ text: "Pause", value: `form:pause:${formId}` });
	} else {
		options.push({ text: "Activate", value: `form:activate:${formId}` });
	}

	options.push({ text: "Delete", value: `form:delete:${formId}` });
	return options;
}
