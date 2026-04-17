/**
 * emdash-forms — Field editor save handlers
 *
 * Two save handlers matching the two form blocks in field-edit.ts:
 *  - saveFieldShared — shared fields: type, id, label, required,
 *    placeholder, helpText, width
 *  - Type-specific savers, one per type. Commit 5 ships saveFieldSelect
 *    only; commit 6 adds the remaining 9.
 *
 * Shared save handles:
 *  - Type changes. Switching type discards incompatible type-specific
 *    settings per Q1 decision (silent with a toast). Commit 7 will
 *    upgrade this to a confirm dialog with preview if the UX feels
 *    destructive during the checkpoint review.
 *  - Field id renames. Validated against ^[a-z0-9_-]+$ per Q2.
 *    Collision with another field in the form → error toast.
 *    Rename with existing submissions → info toast with count
 *    (Q4 decision was full confirm dialog, but Block Kit doesn't
 *    support a confirm-with-data-preview primitive — best we can do
 *    in a single round-trip is the info toast; confirm dialog would
 *    require a two-step UX that commit 7 can tackle if needed).
 */

import type { PluginContext, StorageCollection } from "emdash";
import { FIELD_ID_REGEX, parseOptions } from "./pages/field-edit.js";
import { buildFieldEditPage } from "./pages/field-edit.js";
import type { BlockResponse } from "./router.js";
import type { Form, FormField, SelectField } from "../types.js";

// ─── Shared save ─────────────────────────────────────────────────────

export async function saveFieldShared(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const form = await forms.get(formId);
	if (!form) {
		return {
			blocks: [],
			toast: { message: "Form not found.", type: "error" },
		};
	}

	const idx = form.fields.findIndex((f) => f.id === fieldId);
	if (idx === -1) {
		return {
			blocks: [],
			toast: { message: "Field not found (it may have been deleted).", type: "error" },
		};
	}
	const existing = form.fields[idx]!;

	// ── Validate inputs ─────────────────────────────────────────
	const newType = typeof values.type === "string" ? values.type : existing.type;
	// Strict: do NOT silently lowercase. Admin sees what they typed and
	// gets told if it's invalid. Silent normalization is a gotcha —
	// admin types `Company`, CSV exports show `company` without warning.
	const newId = typeof values.id === "string" ? values.id.trim() : existing.id;
	const newLabel = typeof values.label === "string" ? values.label.trim() : "";
	const required = values.required === true;
	const placeholder = typeof values.placeholder === "string" ? values.placeholder.trim() : "";
	const helpText = typeof values.helpText === "string" ? values.helpText.trim() : "";
	const width: FormField["width"] = values.width === "half" ? "half" : "full";

	if (newLabel.length === 0) {
		return withPage(ctx, formId, fieldId, {
			message: "Label is required.",
			type: "error",
		});
	}
	if (!FIELD_ID_REGEX.test(newId)) {
		const hasUpper = /[A-Z]/.test(newId);
		const hint = hasUpper
			? "Field IDs must be lowercase."
			: "Use only lowercase letters, numbers, underscores, and hyphens.";
		return withPage(ctx, formId, fieldId, {
			message: `Field ID "${newId}" is invalid. ${hint}`,
			type: "error",
		});
	}
	if (!isValidFieldType(newType)) {
		return withPage(ctx, formId, fieldId, {
			message: `Unknown field type "${String(newType)}".`,
			type: "error",
		});
	}
	// ID collision (only relevant on rename).
	if (newId !== existing.id && form.fields.some((f) => f.id === newId)) {
		return withPage(ctx, formId, fieldId, {
			message: `Another field in this form already uses ID "${newId}".`,
			type: "error",
		});
	}

	// ── Type change handling (Q1: silent discard with toast) ────
	const typeChanged = newType !== existing.type;

	// Build the shared-fields struct used by both branches.
	const sharedFields: SharedFieldProps = {
		id: newId,
		label: newLabel,
	};
	if (required) sharedFields.required = true;
	if (placeholder.length > 0) sharedFields.placeholder = placeholder;
	if (helpText.length > 0) sharedFields.helpText = helpText;
	if (width !== "full") sharedFields.width = width;
	if (existing.condition) sharedFields.condition = existing.condition;

	// Preserve type-specific settings IFF type didn't change.
	const updated: FormField = typeChanged
		? buildFieldWithTypeDefaults(newType, sharedFields)
		: mergeExistingFieldWithSharedProps(existing, sharedFields);

	// ── Rename with existing submissions → info toast ───────────
	let renameToast: BlockResponse["toast"] | undefined;
	if (newId !== existing.id) {
		const submissions = ctx.storage.submissions as StorageCollection<unknown>;
		const count = await submissions.count({ formId });
		if (count > 0) {
			renameToast = {
				message: `Renamed "${existing.id}" → "${newId}". ${count} existing ${
					count === 1 ? "submission keeps" : "submissions keep"
				} the old ID in its data.`,
				type: "info",
			};
		}
	}

	// ── Persist ─────────────────────────────────────────────────
	const nextFields = [...form.fields];
	nextFields[idx] = updated;
	await forms.put(formId, {
		...form,
		fields: nextFields,
		updatedAt: new Date().toISOString(),
	});
	ctx.log.info("[emdash-forms] field shared saved", {
		formId,
		oldId: existing.id,
		newId,
		typeChanged,
	});

	// New URL if the field id changed.
	const nextFieldId = newId;

	if (typeChanged) {
		return {
			...(await buildFieldEditPage(ctx, formId, nextFieldId)),
			toast: {
				message: `Field type changed to ${newType}. Type-specific settings were reset.`,
				type: "info",
			},
		};
	}
	if (renameToast) {
		return {
			...(await buildFieldEditPage(ctx, formId, nextFieldId)),
			toast: renameToast,
		};
	}
	return {
		...(await buildFieldEditPage(ctx, formId, nextFieldId)),
		toast: { message: "Field saved", type: "success" },
	};
}

// ─── SELECT save ─────────────────────────────────────────────────────

export async function saveFieldSelect(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const form = await forms.get(formId);
	if (!form) {
		return { blocks: [], toast: { message: "Form not found.", type: "error" } };
	}

	const idx = form.fields.findIndex((f) => f.id === fieldId);
	if (idx === -1) {
		return {
			blocks: [],
			toast: { message: "Field not found.", type: "error" },
		};
	}
	const existing = form.fields[idx]!;
	if (existing.type !== "select") {
		return withPage(ctx, formId, fieldId, {
			message: `Expected a select field, got "${existing.type}".`,
			type: "error",
		});
	}

	const rawText = typeof values.options === "string" ? values.options : "";
	const options = parseOptions(rawText);
	if (options.length === 0) {
		return withPage(ctx, formId, fieldId, {
			message: "At least one option is required.",
			type: "error",
		});
	}
	// Duplicate-value detection — values must be unique for the browser
	// submit to round-trip unambiguously.
	const values_seen = new Set<string>();
	for (const opt of options) {
		if (values_seen.has(opt.value)) {
			return withPage(ctx, formId, fieldId, {
				message: `Duplicate option value "${opt.value}".`,
				type: "error",
			});
		}
		values_seen.add(opt.value);
	}

	const updated: SelectField = { ...existing, options };
	const nextFields = [...form.fields];
	nextFields[idx] = updated;
	await forms.put(formId, {
		...form,
		fields: nextFields,
		updatedAt: new Date().toISOString(),
	});
	ctx.log.info("[emdash-forms] select options saved", {
		formId,
		fieldId,
		optionCount: options.length,
	});

	return {
		...(await buildFieldEditPage(ctx, formId, fieldId)),
		toast: {
			message: `Saved ${options.length} option${options.length === 1 ? "" : "s"}`,
			type: "success",
		},
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isValidFieldType(v: unknown): v is FormField["type"] {
	return (
		typeof v === "string" &&
		[
			"text_input",
			"email",
			"textarea",
			"select",
			"multi_select",
			"checkbox",
			"radio",
			"number",
			"date",
			"hidden",
		].includes(v)
	);
}

/**
 * Props shared across every FormField variant. Kept separate from
 * FormField's discriminated union so the type-change path can build a
 * properly-typed new field of the target type without fighting TS
 * about which discriminator "type" actually has.
 */
interface SharedFieldProps {
	id: string;
	label: string;
	required?: boolean;
	placeholder?: string;
	helpText?: string;
	width?: FormField["width"];
	condition?: FormField["condition"];
}

/**
 * Build a new FormField of the target type with default type-specific
 * settings plus the passed-through shared props. Called from
 * saveFieldShared on type change — existing type-specific props are
 * discarded since they don't belong to the new type.
 */
function buildFieldWithTypeDefaults(
	type: FormField["type"],
	shared: SharedFieldProps,
): FormField {
	switch (type) {
		case "select":
			return {
				...shared,
				type: "select",
				options: [
					{ label: "Option 1", value: "option-1" },
					{ label: "Option 2", value: "option-2" },
				],
			};
		case "multi_select":
			return {
				...shared,
				type: "multi_select",
				options: [
					{ label: "Option 1", value: "option-1" },
					{ label: "Option 2", value: "option-2" },
				],
			};
		case "radio":
			return {
				...shared,
				type: "radio",
				options: [
					{ label: "Option 1", value: "option-1" },
					{ label: "Option 2", value: "option-2" },
				],
			};
		case "checkbox":
			return { ...shared, type: "checkbox" };
		case "textarea":
			return { ...shared, type: "textarea", rows: 4 };
		case "text_input":
			return { ...shared, type: "text_input", inputType: "text" };
		case "email":
			return { ...shared, type: "email" };
		case "number":
			return { ...shared, type: "number" };
		case "date":
			return { ...shared, type: "date" };
		case "hidden":
			return { ...shared, type: "hidden" };
	}
}

/**
 * Same-type update — preserve the existing type-specific settings,
 * overwrite the shared props. Builds a properly-discriminated value
 * by matching on the existing field's type.
 */
function mergeExistingFieldWithSharedProps(
	existing: FormField,
	shared: SharedFieldProps,
): FormField {
	// The spread preserves type-specific props; the shared spread wins
	// for the shared keys. Field type is unchanged, so TS's
	// discriminated-union inference holds.
	switch (existing.type) {
		case "text_input":
			return { ...existing, ...shared, type: "text_input" };
		case "email":
			return { ...existing, ...shared, type: "email" };
		case "textarea":
			return { ...existing, ...shared, type: "textarea" };
		case "select":
			return { ...existing, ...shared, type: "select" };
		case "multi_select":
			return { ...existing, ...shared, type: "multi_select" };
		case "checkbox":
			return { ...existing, ...shared, type: "checkbox" };
		case "radio":
			return { ...existing, ...shared, type: "radio" };
		case "number":
			return { ...existing, ...shared, type: "number" };
		case "date":
			return { ...existing, ...shared, type: "date" };
		case "hidden":
			return { ...existing, ...shared, type: "hidden" };
	}
}

async function withPage(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	toast: { message: string; type: "success" | "error" | "info" },
): Promise<BlockResponse> {
	return {
		...(await buildFieldEditPage(ctx, formId, fieldId)),
		toast,
	};
}
