/**
 * emdash-forms — /forms/{formId}/fields/{fieldId} field editor page
 *
 * Per the Phase 3 plan §1, architecture (c) hybrid:
 *  - Shared form block (always visible): type, id, label, required,
 *    placeholder, helpText, width
 *  - Type-specific form block (per-type builder): rendered based on
 *    the current field's type
 *  - Actions row: Save, Cancel
 *
 * COMMIT 5 (CHECKPOINT): shared fields + SELECT prototype only.
 * Commit 6 cascades the pattern to the other 9 types.
 *
 * Verification criteria at this checkpoint (Phase 3 plan §1):
 *  - Shared fields round-trip: load → edit label → save → reload shows
 *    updated label
 *  - Type-specific round-trip (select): options textarea parses
 *    "Label|value\n…" correctly, persists, renders back in the textarea
 *  - Type change select → text_input discards options with a documented
 *    toast (commit 7's type-change guard lands this — for now, silent
 *    discard per Q1 answer "(a)")
 *  - Cancel navigates back to /forms/{id} unchanged
 *  - Field id lowercase enforcement + regex validation on rename
 *  - Updated label visible in the field list on /forms/{id}
 */

import type { PluginContext, StorageCollection } from "emdash";
import type { BlockResponse } from "../router.js";
import type { Form, FormField, SelectField, SelectOption } from "../../types.js";

// ─── Constants ───────────────────────────────────────────────────────

/** Field id regex — lowercase alnum + underscore + hyphen per Q2 decision. */
export const FIELD_ID_REGEX = /^[a-z0-9_-]+$/;

const FIELD_TYPE_OPTIONS: Array<{ label: string; value: FormField["type"] }> = [
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
];

// ─── Page builder ────────────────────────────────────────────────────

export async function buildFieldEditPage(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const form = await forms.get(formId);
	if (!form) return notFound("Form not found");
	const field = form.fields.find((f) => f.id === fieldId);
	if (!field) return notFound("Field not found — it may have been deleted in another tab");

	const backAction = {
		type: "button",
		text: "← Back to form",
		action_id: `navigate:/forms/${formId}`,
	};

	return {
		blocks: [
			{ type: "header", text: `Edit field: ${field.label}` },
			{ type: "actions", elements: [backAction] },
			{ type: "divider" },

			// Shared-fields form
			{ type: "header", text: "Field basics" },
			buildSharedFieldsForm(formId, fieldId, field),
			{ type: "divider" },

			// Type-specific form (delegates by type)
			...buildTypeSpecificSection(formId, fieldId, field),
		],
	};
}

// ─── Shared fields (always visible) ──────────────────────────────────

function buildSharedFieldsForm(
	formId: string,
	fieldId: string,
	field: FormField,
): Record<string, unknown> {
	return {
		type: "form",
		block_id: "field-shared",
		fields: [
			{
				type: "select",
				action_id: "type",
				label: "Field type",
				initial_value: field.type,
				options: FIELD_TYPE_OPTIONS,
				help_text:
					"Changing the type drops type-specific settings (options, min/max, etc). Basic settings are preserved.",
			},
			{
				type: "text_input",
				action_id: "id",
				label: "Field ID",
				initial_value: field.id,
				help_text:
					"Lowercase letters, numbers, underscores, and hyphens. Used as the key in submission data and CSV exports.",
			},
			{
				type: "text_input",
				action_id: "label",
				label: "Label",
				initial_value: field.label,
			},
			{
				type: "toggle",
				action_id: "required",
				label: "Required",
				initial_value: field.required ?? false,
			},
			{
				type: "text_input",
				action_id: "placeholder",
				label: "Placeholder (optional)",
				initial_value: field.placeholder ?? "",
			},
			{
				type: "text_input",
				action_id: "helpText",
				label: "Help text (optional)",
				initial_value: field.helpText ?? "",
			},
			{
				type: "select",
				action_id: "width",
				label: "Width",
				initial_value: field.width ?? "full",
				options: [
					{ label: "Full", value: "full" },
					{ label: "Half", value: "half" },
				],
			},
		],
		submit: {
			label: "Save basics",
			action_id: `field_save_shared:${formId}:${fieldId}`,
		},
	};
}

// ─── Type-specific section dispatch ──────────────────────────────────
//
// Phase 3 commit 5 ships SELECT only as a prototype. Commit 6 cascades
// the pattern to the other types. The dispatch here is what allows
// each type's settings to live in its own tiny builder function — no
// mega condition-gated form, no per-type page.

function buildTypeSpecificSection(
	formId: string,
	fieldId: string,
	field: FormField,
): unknown[] {
	switch (field.type) {
		case "select":
			return buildSelectTypeSpecific(formId, fieldId, field);
		case "text_input":
		case "email":
		case "textarea":
		case "multi_select":
		case "checkbox":
		case "radio":
		case "number":
		case "date":
		case "hidden":
			// Commit 6 implements these. Placeholder for now so the page
			// renders without crashing on non-select fields during the
			// checkpoint review.
			return [
				{ type: "header", text: "Type-specific settings" },
				{
					type: "banner",
					variant: "default",
					title: "Type-specific settings coming next",
					description: `Settings for "${field.type}" fields land in commit 6. The shared basics above are fully editable.`,
				},
			];
	}
}

// ─── SELECT prototype ────────────────────────────────────────────────

/**
 * Per SPEC-v1.md §5.2 field editor: options serialize as
 * newline-separated "label|value" pairs. A single line without a pipe
 * uses the same string for both label and value (common admin shortcut).
 */
function buildSelectTypeSpecific(
	formId: string,
	fieldId: string,
	field: SelectField,
): unknown[] {
	const optionsText = serializeOptions(field.options);

	return [
		{ type: "header", text: "Select options" },
		{
			type: "form",
			block_id: "field-select",
			fields: [
				{
					type: "text_input",
					action_id: "options",
					label: "Options",
					initial_value: optionsText,
					multiline: true,
					help_text:
						"One option per line in the form `Label|value`. If you omit `|value`, the label is used as the value.",
				},
			],
			submit: {
				label: "Save options",
				action_id: `field_save_select:${formId}:${fieldId}`,
			},
		},
	];
}

/** Options array → "Label|value\nLabel|value" text for the textarea. */
export function serializeOptions(options: SelectOption[]): string {
	return options.map((o) => (o.label === o.value ? o.label : `${o.label}|${o.value}`)).join("\n");
}

/**
 * Textarea text → options array. Each non-blank line produces one
 * option. Unescaped | separates label from value; label-only lines
 * reuse the label as the value.
 *
 * Silently skips blank lines and trims whitespace.
 */
export function parseOptions(text: string): SelectOption[] {
	const result: SelectOption[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.length === 0) continue;
		const pipeIdx = line.indexOf("|");
		if (pipeIdx === -1) {
			result.push({ label: line, value: line });
		} else {
			const label = line.slice(0, pipeIdx).trim();
			const value = line.slice(pipeIdx + 1).trim();
			if (label.length === 0) continue;
			result.push({ label, value: value.length > 0 ? value : label });
		}
	}
	return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function notFound(message: string): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "Field editor" },
			{
				type: "banner",
				variant: "error",
				title: message,
				description: "Head back to pick another.",
			},
			{
				type: "actions",
				elements: [{ type: "button", text: "Back to forms", action_id: "navigate:/" }],
			},
		],
	};
}
