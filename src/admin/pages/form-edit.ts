/**
 * emdash-forms — /forms/{id} form builder page
 *
 * Per SPEC-v1.md §5.2. Full form editor:
 *  - Header with form title + breadcrumb back to /
 *  - Metadata form: title, slug, status toggle
 *  - Field list: one section per field with overflow-menu reorder
 *  - "Add field" select at the bottom of the list
 *  - Settings section: submit label, success message, redirect URL,
 *    notification toggles + condition-gated subject/body templates,
 *    Turnstile toggle
 *  - Save / Cancel actions
 *
 * Commit 2 (this one) ships the READ-ONLY shell — title/slug inputs,
 * field list rendering, settings section rendering, no Save wiring.
 * Commit 3 adds the save action. Commit 4 adds field mutations.
 * Commit 5+ adds the field editor sub-page.
 */

import type { PluginContext, StorageCollection } from "emdash";
import type { BlockResponse } from "../router.js";
import { pluralize, truncate } from "../format.js";
import type { Form, FormField } from "../../types.js";

// ─── Label maps for the field list ───────────────────────────────────

const FIELD_TYPE_LABELS: Record<FormField["type"], string> = {
	text_input: "Text",
	email: "Email",
	textarea: "Textarea",
	select: "Select",
	multi_select: "Multi-select",
	checkbox: "Checkbox",
	radio: "Radio",
	number: "Number",
	date: "Date",
	hidden: "Hidden",
};

// ─── Page builder ────────────────────────────────────────────────────

export async function buildFormEditPage(
	ctx: PluginContext,
	formId: string,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const form = await forms.get(formId);

	if (!form) {
		return {
			blocks: [
				{ type: "header", text: "Form not found" },
				{
					type: "banner",
					variant: "error",
					title: "This form may have been deleted",
					description: "Head back to the forms list to pick another.",
				},
				{
					type: "actions",
					elements: [
						{ type: "button", text: "Back to forms", action_id: "navigate:/" },
					],
				},
			],
		};
	}

	return {
		blocks: [
			// ── Header + breadcrumb ──────────────────────────────────
			{ type: "header", text: form.title },
			{
				type: "actions",
				elements: [
					{ type: "button", text: "← Back to forms", action_id: "navigate:/" },
					{
						type: "button",
						text: "View submissions",
						action_id: `navigate:/forms/${formId}/submissions`,
					},
				],
			},
			{ type: "divider" },

			// ── Metadata ─────────────────────────────────────────────
			{ type: "header", text: "Form details" },
			{
				type: "form",
				block_id: "form-metadata",
				fields: [
					{
						type: "text_input",
						action_id: "title",
						label: "Form title",
						initial_value: form.title,
					},
					{
						type: "text_input",
						action_id: "slug",
						label: "Slug",
						initial_value: form.slug,
						help_text: "URL-safe identifier used in the submit endpoint.",
					},
					{
						type: "toggle",
						action_id: "active",
						label: "Active",
						initial_value: form.status === "active",
						help_text: "Paused forms return 404 to public submissions.",
					},
				],
				submit: {
					label: "Save form details",
					action_id: `form_save_metadata:${formId}`,
				},
			},
			{ type: "divider" },

			// ── Fields list ──────────────────────────────────────────
			...buildFieldsSection(formId, form.fields),
			{ type: "divider" },

			// ── Settings ─────────────────────────────────────────────
			...buildSettingsSection(formId, form),
		],
	};
}

// ─── Fields section ──────────────────────────────────────────────────

function buildFieldsSection(formId: string, fields: FormField[]): unknown[] {
	const blocks: unknown[] = [
		{ type: "header", text: "Fields" },
		{
			type: "section",
			text: `${pluralize(fields.length, "field")} — reorder with the overflow menu, edit with Edit.`,
		},
	];

	if (fields.length === 0) {
		blocks.push({
			type: "banner",
			variant: "default",
			title: "No fields yet",
			description: "Add your first field below to start collecting data.",
		});
	}

	for (let i = 0; i < fields.length; i += 1) {
		const field = fields[i]!;
		const isFirst = i === 0;
		const isLast = i === fields.length - 1;
		const typeLabel = FIELD_TYPE_LABELS[field.type] ?? field.type;
		const reqBadge = field.required ? " · _required_" : "";

		blocks.push({
			type: "section",
			text: `**${truncate(field.label, 50)}**\n\`${field.id}\` · ${typeLabel}${reqBadge}`,
			accessory: {
				type: "overflow",
				action_id: `form:field_menu:${formId}:${field.id}`,
				options: buildFieldOverflowOptions(formId, field.id, isFirst, isLast),
			},
		});
	}

	// "Add field" selector — commit 4 wires the handler.
	blocks.push({
		type: "actions",
		elements: [
			{
				type: "select",
				action_id: `form:field_add:${formId}`,
				placeholder: "Add field…",
				options: [
					{ label: "Text", value: "text_input" },
					{ label: "Email", value: "email" },
					{ label: "Textarea", value: "textarea" },
					{ label: "Select", value: "select" },
					{ label: "Multi-select", value: "multi_select" },
					{ label: "Checkbox", value: "checkbox" },
					{ label: "Radio", value: "radio" },
					{ label: "Number", value: "number" },
					{ label: "Date", value: "date" },
					{ label: "Hidden", value: "hidden" },
				],
			},
		],
	});

	return blocks;
}

/**
 * Overflow-menu options per field: reorder (Move to top / up / down /
 * bottom — with boundary ones elided), Edit, Duplicate, Delete
 * (confirm dialog via the block_action path).
 */
function buildFieldOverflowOptions(
	formId: string,
	fieldId: string,
	isFirst: boolean,
	isLast: boolean,
): Array<{ text: string; value: string }> {
	const options: Array<{ text: string; value: string }> = [];

	if (!isFirst) {
		options.push({ text: "Move to top", value: `field:move_top:${formId}:${fieldId}` });
		options.push({ text: "Move up", value: `field:move_up:${formId}:${fieldId}` });
	}
	if (!isLast) {
		options.push({ text: "Move down", value: `field:move_down:${formId}:${fieldId}` });
		options.push({ text: "Move to bottom", value: `field:move_bottom:${formId}:${fieldId}` });
	}

	options.push({ text: "Edit", value: `field:edit:${formId}:${fieldId}` });
	options.push({ text: "Duplicate", value: `field:duplicate:${formId}:${fieldId}` });
	options.push({ text: "Delete", value: `field:delete:${formId}:${fieldId}` });

	return options;
}

// ─── Settings section ────────────────────────────────────────────────

function buildSettingsSection(formId: string, form: Form): unknown[] {
	const notif = form.settings.notifications;

	return [
		{ type: "header", text: "Behavior" },
		{
			type: "form",
			block_id: "form-behavior",
			fields: [
				{
					type: "text_input",
					action_id: "submitLabel",
					label: "Submit button label",
					initial_value: form.settings.submitLabel,
				},
				{
					type: "text_input",
					action_id: "successMessage",
					label: "Success message",
					initial_value: form.settings.successMessage,
					help_text: "Shown after a successful submission. Supports {{field_id}} merge tags.",
				},
				{
					type: "text_input",
					action_id: "redirectUrl",
					label: "Redirect URL (optional)",
					initial_value: form.settings.redirectUrl ?? "",
					help_text:
						"If set, redirects the browser here after submit. Merge tags supported (see issue #4 for caveats when interpolating submitter-controlled fields).",
				},
				{
					type: "select",
					action_id: "spamProtection",
					label: "Spam protection",
					initial_value: form.settings.spamProtection,
					options: [
						{ label: "Honeypot (default)", value: "honeypot" },
						{ label: "Cloudflare Turnstile", value: "turnstile" },
					],
				},
			],
			submit: {
				label: "Save behavior",
				action_id: `form_save_behavior:${formId}`,
			},
		},
		{ type: "divider" },

		{ type: "header", text: "Notifications" },
		{
			type: "form",
			block_id: "form-notifications",
			fields: [
				{
					type: "toggle",
					action_id: "notifyAdmin",
					label: "Notify admin on submission",
					initial_value: notif.notifyAdmin,
				},
				{
					type: "text_input",
					action_id: "adminEmail",
					label: "Admin email (optional)",
					initial_value: notif.adminEmail ?? "",
					help_text: "Leave blank to use the plugin-wide default from /settings.",
					condition: { field: "notifyAdmin", eq: true },
				},
				{
					type: "text_input",
					action_id: "adminSubject",
					label: "Admin email subject (optional)",
					initial_value: notif.adminSubject ?? "",
					help_text:
						"Supports {{field_id}} merge tags. Leave blank for the default: 'New submission: <form title>'.",
					condition: { field: "notifyAdmin", eq: true },
				},
				{
					type: "text_input",
					action_id: "adminBody",
					label: "Admin email body (HTML, optional)",
					initial_value: notif.adminBody ?? "",
					multiline: true,
					help_text:
						"Supports {{field_id}} merge tags. Interpolated values are HTML-escaped. Leave blank for a default table of all fields.",
					condition: { field: "notifyAdmin", eq: true },
				},
				{
					type: "toggle",
					action_id: "confirmationEmail",
					label: "Send confirmation email to submitter",
					initial_value: notif.confirmationEmail,
					help_text: "Requires a field of type 'email' in the form.",
				},
				{
					type: "text_input",
					action_id: "confirmationSubject",
					label: "Confirmation subject (optional)",
					initial_value: notif.confirmationSubject ?? "",
					condition: { field: "confirmationEmail", eq: true },
				},
				{
					type: "text_input",
					action_id: "confirmationBody",
					label: "Confirmation body (HTML, optional)",
					initial_value: notif.confirmationBody ?? "",
					multiline: true,
					condition: { field: "confirmationEmail", eq: true },
				},
			],
			submit: {
				label: "Save notifications",
				action_id: `form_save_notifications:${formId}`,
			},
		},
	];
}
