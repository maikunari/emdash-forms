/**
 * emdash-forms — Field-level mutation handlers
 *
 * Shared helpers + handlers for every field mutation fired from the
 * form builder overflow menu + "Add field" select:
 *  - addField(ctx, formId, type)
 *  - moveField(ctx, formId, fieldId, position)
 *  - duplicateField(ctx, formId, fieldId)
 *  - deleteField(ctx, formId, fieldId)
 *
 * All return the re-rendered /forms/{id} page with a toast.
 *
 * Field mutations happen immediately (no "Save" button for the field
 * list) — that matches the spec's "every interaction is a round-trip"
 * Block Kit constraint. The admin adds a field, it's persisted; they
 * click Edit to customize it.
 */

import type { PluginContext, StorageCollection } from "emdash";
import { buildFormEditPage } from "./pages/form-edit.js";
import type { BlockResponse } from "./router.js";
import type { Form, FormField } from "../types.js";

// ─── Field-id generator ──────────────────────────────────────────────

/**
 * Generate a unique field id within a form. Starts from the type
 * prefix (text_input_1, email_1, …); bumps the suffix if the id is
 * already taken. Matches the lowercase + underscore convention
 * admins will see in CSV exports.
 */
function generateFieldId(type: FormField["type"], existing: FormField[]): string {
	const base = type.replace(/-/g, "_");
	let suffix = 1;
	while (existing.some((f) => f.id === `${base}_${suffix}`)) suffix += 1;
	return `${base}_${suffix}`;
}

/** Build a new field of the given type with sensible defaults. */
function buildDefaultField(type: FormField["type"], id: string): FormField {
	const label = type
		.split("_")
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join(" ");
	switch (type) {
		case "text_input":
			return { type, id, label, inputType: "text" };
		case "email":
			return { type, id, label };
		case "textarea":
			return { type, id, label, rows: 4 };
		case "select":
		case "multi_select":
		case "radio":
			return {
				type,
				id,
				label,
				options: [
					{ label: "Option 1", value: "option-1" },
					{ label: "Option 2", value: "option-2" },
				],
			};
		case "checkbox":
			return { type, id, label };
		case "number":
			return { type, id, label };
		case "date":
			return { type, id, label };
		case "hidden":
			return { type, id, label };
	}
}

// ─── Form-mutation scaffolding ───────────────────────────────────────

type ToastType = "success" | "error" | "info";

interface MutationResult {
	/** New fields array (omit to skip the write; implies error). */
	fields?: FormField[];
	/** Toast to surface to the admin. */
	toast: { message: string; type: ToastType };
}

/**
 * Common prefix for the field mutation handlers — fetch the form,
 * apply a transform to fields[], persist if the transform returned a
 * new fields array, re-render. Transform returns a unified shape so
 * error/info/success are distinguished by the toast type + presence
 * of fields.
 */
async function mutateFormFields(
	ctx: PluginContext,
	formId: string,
	transform: (fields: FormField[]) => MutationResult,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) {
		return {
			blocks: [],
			toast: { message: "Form not found.", type: "error" },
		};
	}

	const result = transform(existing.fields);

	if (result.fields !== undefined) {
		await forms.put(formId, {
			...existing,
			fields: result.fields,
			updatedAt: new Date().toISOString(),
		});
	}

	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: result.toast,
	};
}

// ─── Add ─────────────────────────────────────────────────────────────

const VALID_TYPES: ReadonlySet<FormField["type"]> = new Set([
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
]);

export async function addField(
	ctx: PluginContext,
	formId: string,
	rawType: string,
): Promise<BlockResponse> {
	if (!VALID_TYPES.has(rawType as FormField["type"])) {
		return {
			blocks: [],
			toast: { message: `Unknown field type "${rawType}".`, type: "error" },
		};
	}
	const type = rawType as FormField["type"];
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) {
		return {
			blocks: [],
			toast: { message: "Form not found.", type: "error" },
		};
	}

	const id = generateFieldId(type, existing.fields);
	const newField = buildDefaultField(type, id);
	const updated = [...existing.fields, newField];
	await forms.put(formId, {
		...existing,
		fields: updated,
		updatedAt: new Date().toISOString(),
	});
	ctx.log.info("[emdash-forms] field added", { formId, fieldId: id, type });
	return {
		...(await buildFormEditPage(ctx, formId)),
		toast: { message: `Added ${type} field`, type: "success" },
	};
}

// ─── Move ────────────────────────────────────────────────────────────

type MoveTarget = "top" | "up" | "down" | "bottom";

export async function moveField(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	target: MoveTarget,
): Promise<BlockResponse> {
	return mutateFormFields(ctx, formId, (fields) => {
		const idx = fields.findIndex((f) => f.id === fieldId);
		if (idx === -1) {
			return {
				toast: {
					message: "Field not found (it may have been deleted in another tab).",
					type: "error",
				},
			};
		}

		let dest: number;
		switch (target) {
			case "top":
				dest = 0;
				break;
			case "up":
				dest = Math.max(0, idx - 1);
				break;
			case "down":
				dest = Math.min(fields.length - 1, idx + 1);
				break;
			case "bottom":
				dest = fields.length - 1;
				break;
		}
		if (dest === idx) {
			return { toast: { message: "Field already at that position", type: "info" } };
		}

		const next = [...fields];
		const [moved] = next.splice(idx, 1);
		next.splice(dest, 0, moved!);
		return {
			fields: next,
			toast: { message: "Field reordered", type: "success" },
		};
	});
}

// ─── Duplicate ───────────────────────────────────────────────────────

export async function duplicateField(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
): Promise<BlockResponse> {
	return mutateFormFields(ctx, formId, (fields) => {
		const idx = fields.findIndex((f) => f.id === fieldId);
		if (idx === -1) return { toast: { message: "Field not found.", type: "error" } };

		const original = fields[idx]!;
		const newId = generateFieldId(original.type, fields);
		const copy: FormField = {
			...original,
			id: newId,
			label: `${original.label} (copy)`,
		};

		const next = [...fields];
		next.splice(idx + 1, 0, copy);
		return {
			fields: next,
			toast: { message: `Field duplicated as "${newId}"`, type: "success" },
		};
	});
}

// ─── Delete ──────────────────────────────────────────────────────────

export async function deleteField(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
): Promise<BlockResponse> {
	return mutateFormFields(ctx, formId, (fields) => {
		const idx = fields.findIndex((f) => f.id === fieldId);
		if (idx === -1) {
			return { toast: { message: "Field already deleted", type: "info" } };
		}
		const next = fields.filter((f) => f.id !== fieldId);
		return {
			fields: next,
			toast: { message: "Field deleted", type: "success" },
		};
	});
}
