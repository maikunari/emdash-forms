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
import type {
	CheckboxField,
	DateField,
	Form,
	FormField,
	HiddenField,
	MultiSelectField,
	NumberField,
	RadioField,
	SelectField,
	SelectOption,
	TextInputField,
	TextareaField,
} from "../types.js";

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

// ─── Shared options-parse for select/multi_select/radio/checkbox ─────

/**
 * Parse + validate options text. Returns the parsed options or an
 * error message. Callers check `result.error` before persisting.
 */
function parseOptionsStrict(
	rawText: string,
	{ allowEmpty }: { allowEmpty: boolean },
): { options: SelectOption[] } | { error: string } {
	const options = parseOptions(rawText);
	if (options.length === 0 && !allowEmpty) {
		return { error: "At least one option is required." };
	}
	const seen = new Set<string>();
	for (const opt of options) {
		if (seen.has(opt.value)) return { error: `Duplicate option value "${opt.value}".` };
		seen.add(opt.value);
	}
	return { options };
}

// ─── TEXT_INPUT save ─────────────────────────────────────────────────

export async function saveFieldTextInput(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<TextInputField>(ctx, formId, fieldId, "text_input", (existing) => {
		const rawInputType = typeof values.inputType === "string" ? values.inputType : "text";
		const validTypes: TextInputField["inputType"][] = ["text", "email", "url", "tel"];
		const inputType: TextInputField["inputType"] = (validTypes as string[]).includes(rawInputType)
			? (rawInputType as TextInputField["inputType"])
			: "text";
		const maxLength = normalizePositive(values.maxLength);
		const next: TextInputField = { ...existing, type: "text_input", inputType };
		if (maxLength !== undefined) next.maxLength = maxLength;
		else delete (next as { maxLength?: number }).maxLength;
		return { field: next, toast: "Text settings saved" };
	});
}

// ─── EMAIL save (no-op; present for router symmetry) ─────────────────

export async function saveFieldEmail(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
): Promise<BlockResponse> {
	// Email has no type-specific settings. The save endpoint exists so
	// the router's parse-once pattern covers all types uniformly; firing
	// it is a no-op + info toast.
	return {
		...(await buildFieldEditPage(ctx, formId, fieldId)),
		toast: { message: "No type-specific settings to save for email fields.", type: "info" },
	};
}

// ─── TEXTAREA save ───────────────────────────────────────────────────

export async function saveFieldTextarea(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<TextareaField>(ctx, formId, fieldId, "textarea", (existing) => {
		const rows = clamp(normalizePositive(values.rows) ?? 4, 1, 40);
		const maxLength = normalizePositive(values.maxLength);
		const next: TextareaField = { ...existing, type: "textarea", rows };
		if (maxLength !== undefined) next.maxLength = maxLength;
		else delete (next as { maxLength?: number }).maxLength;
		return { field: next, toast: "Textarea settings saved" };
	});
}

// ─── MULTI_SELECT save ───────────────────────────────────────────────

export async function saveFieldMultiSelect(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<MultiSelectField>(ctx, formId, fieldId, "multi_select", (existing) => {
		const result = parseOptionsStrict(
			typeof values.options === "string" ? values.options : "",
			{ allowEmpty: false },
		);
		if ("error" in result) return { error: result.error };
		const next: MultiSelectField = { ...existing, type: "multi_select", options: result.options };
		return {
			field: next,
			toast: `Saved ${result.options.length} option${result.options.length === 1 ? "" : "s"}`,
		};
	});
}

// ─── RADIO save ──────────────────────────────────────────────────────

export async function saveFieldRadio(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<RadioField>(ctx, formId, fieldId, "radio", (existing) => {
		const result = parseOptionsStrict(
			typeof values.options === "string" ? values.options : "",
			{ allowEmpty: false },
		);
		if ("error" in result) return { error: result.error };
		const next: RadioField = { ...existing, type: "radio", options: result.options };
		return {
			field: next,
			toast: `Saved ${result.options.length} option${result.options.length === 1 ? "" : "s"}`,
		};
	});
}

// ─── CHECKBOX save (options optional) ────────────────────────────────

export async function saveFieldCheckbox(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<CheckboxField>(ctx, formId, fieldId, "checkbox", (existing) => {
		const result = parseOptionsStrict(
			typeof values.options === "string" ? values.options : "",
			{ allowEmpty: true },
		);
		if ("error" in result) return { error: result.error };
		const next: CheckboxField = { ...existing, type: "checkbox" };
		if (result.options.length > 0) {
			next.options = result.options;
		} else {
			delete (next as { options?: SelectOption[] }).options;
		}
		return {
			field: next,
			toast:
				result.options.length > 0
					? `Saved ${result.options.length} option${result.options.length === 1 ? "" : "s"}`
					: "Saved — rendering as a single boolean checkbox",
		};
	});
}

// ─── NUMBER save ─────────────────────────────────────────────────────

export async function saveFieldNumber(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<NumberField>(ctx, formId, fieldId, "number", (existing) => {
		const min = normalizeOptionalNumber(values.min);
		const max = normalizeOptionalNumber(values.max);
		const step = normalizeOptionalNumber(values.step);
		if (min !== undefined && max !== undefined && min > max) {
			return { error: `Minimum (${min}) is greater than maximum (${max}).` };
		}
		if (step !== undefined && step < 0) {
			return { error: "Step must be zero or positive." };
		}
		const next: NumberField = { ...existing, type: "number" };
		if (min !== undefined) next.min = min;
		else delete (next as { min?: number }).min;
		if (max !== undefined) next.max = max;
		else delete (next as { max?: number }).max;
		if (step !== undefined && step > 0) next.step = step;
		else delete (next as { step?: number }).step;
		return { field: next, toast: "Number settings saved" };
	});
}

// ─── DATE save ───────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function saveFieldDate(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<DateField>(ctx, formId, fieldId, "date", (existing) => {
		const min = typeof values.min === "string" ? values.min.trim() : "";
		const max = typeof values.max === "string" ? values.max.trim() : "";
		if (min.length > 0 && !ISO_DATE_REGEX.test(min)) {
			return { error: `Earliest date "${min}" is not ISO (YYYY-MM-DD).` };
		}
		if (max.length > 0 && !ISO_DATE_REGEX.test(max)) {
			return { error: `Latest date "${max}" is not ISO (YYYY-MM-DD).` };
		}
		if (min.length > 0 && max.length > 0 && min > max) {
			return { error: `Earliest date (${min}) is after latest (${max}).` };
		}
		const next: DateField = { ...existing, type: "date" };
		if (min.length > 0) next.min = min;
		else delete (next as { min?: string }).min;
		if (max.length > 0) next.max = max;
		else delete (next as { max?: string }).max;
		return { field: next, toast: "Date settings saved" };
	});
}

// ─── HIDDEN save ─────────────────────────────────────────────────────

export async function saveFieldHidden(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	return mutateTypeSpecific<HiddenField>(ctx, formId, fieldId, "hidden", (existing) => {
		const defaultValue = typeof values.defaultValue === "string" ? values.defaultValue : "";
		const next: HiddenField = { ...existing, type: "hidden" };
		if (defaultValue.length > 0) next.defaultValue = defaultValue;
		else delete (next as { defaultValue?: string }).defaultValue;
		return { field: next, toast: "Hidden field saved" };
	});
}

// ─── CONDITION save ──────────────────────────────────────────────────

/**
 * Save handler for the conditional-visibility editor. Shared across
 * all field types — operates on the shared `condition` prop.
 *
 * Validates:
 *  - The referenced field exists in the form (not self, not missing)
 *  - No circular dependency: A → B → A, or deeper cycles. We BFS the
 *    condition graph from the saved field and fail if we loop back.
 *    This is the "conditional logic loops" item on the SPEC §13.2
 *    Phase 3 red team matrix.
 *  - For "in" operator: at least one value in the comma-split
 */
export async function saveFieldCondition(
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
		return { blocks: [], toast: { message: "Field not found.", type: "error" } };
	}
	const existing = form.fields[idx]!;

	const enabled = values.conditionEnabled === true;

	// Disable path — drop the condition prop.
	if (!enabled) {
		if (existing.condition === undefined) {
			return {
				...(await buildFieldEditPage(ctx, formId, fieldId)),
				toast: { message: "Condition already disabled", type: "info" },
			};
		}
		const next = cloneFieldWithoutCondition(existing);
		const nextFields = [...form.fields];
		nextFields[idx] = next;
		await forms.put(formId, { ...form, fields: nextFields, updatedAt: new Date().toISOString() });
		return {
			...(await buildFieldEditPage(ctx, formId, fieldId)),
			toast: { message: "Condition removed", type: "success" },
		};
	}

	// Enable path — validate the proposed condition.
	const gateField = typeof values.conditionField === "string" ? values.conditionField : "";
	const operator = typeof values.conditionOperator === "string" ? values.conditionOperator : "eq";
	const rawValue = typeof values.conditionValue === "string" ? values.conditionValue : "";

	if (gateField.length === 0) {
		return withPage(ctx, formId, fieldId, {
			message: "Pick a field to gate on.",
			type: "error",
		});
	}
	if (gateField === fieldId) {
		// Defense-in-depth. The UI omits self from the select, but a
		// crafted client could submit the current field's own id.
		return withPage(ctx, formId, fieldId, {
			message: "A field can't be conditional on itself.",
			type: "error",
		});
	}
	if (!form.fields.some((f) => f.id === gateField)) {
		return withPage(ctx, formId, fieldId, {
			message: `Field "${gateField}" doesn't exist in this form.`,
			type: "error",
		});
	}
	if (!["eq", "neq", "in"].includes(operator)) {
		return withPage(ctx, formId, fieldId, {
			message: `Unknown operator "${operator}".`,
			type: "error",
		});
	}

	// Build the proposed condition.
	const proposed: import("../types.js").FieldCondition = { field: gateField };
	if (operator === "in") {
		const parts = rawValue
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (parts.length === 0) {
			return withPage(ctx, formId, fieldId, {
				message: "Enter at least one value for 'is one of'.",
				type: "error",
			});
		}
		proposed.in = parts;
	} else if (operator === "eq") {
		proposed.eq = rawValue;
	} else {
		proposed.neq = rawValue;
	}

	// ── Loop detection ──────────────────────────────────────────
	// Build a hypothetical graph with the proposed condition applied
	// to the current field, then walk it from the current field and
	// see if we reach ourselves. SPEC §13.2 Phase 3: "conditional
	// logic loops (field A depends on B, B depends on A)."
	const hypothetical = form.fields.map((f) =>
		f.id === fieldId ? { ...f, condition: proposed } : f,
	);
	if (detectConditionCycle(fieldId, hypothetical)) {
		return withPage(ctx, formId, fieldId, {
			message:
				"This condition creates a cycle. Field A can't depend on Field B while Field B depends on Field A.",
			type: "error",
		});
	}

	// Apply + persist.
	const next = cloneFieldWithCondition(existing, proposed);
	const nextFields = [...form.fields];
	nextFields[idx] = next;
	await forms.put(formId, { ...form, fields: nextFields, updatedAt: new Date().toISOString() });
	ctx.log.info("[emdash-forms] field condition saved", {
		formId,
		fieldId,
		gateField,
		operator,
	});
	return {
		...(await buildFieldEditPage(ctx, formId, fieldId)),
		toast: { message: "Condition saved", type: "success" },
	};
}

// ─── Cycle detection ─────────────────────────────────────────────────

/**
 * DFS from `start` through the condition graph. Returns true if we
 * find a back-edge to `start`. Each field's condition creates a single
 * outgoing edge to `condition.field`. A cycle means some field's
 * visibility depends (transitively) on its own value.
 */
function detectConditionCycle(start: string, fields: FormField[]): boolean {
	const byId = new Map<string, FormField>();
	for (const f of fields) byId.set(f.id, f);

	const visited = new Set<string>();
	let current: string | undefined = start;
	while (current !== undefined) {
		const field = byId.get(current);
		if (!field || !field.condition) return false;
		const next = field.condition.field;
		if (next === start) return true;
		if (visited.has(next)) {
			// A cycle that doesn't touch `start` isn't this field's
			// fault. Let it go — the admin who introduced that other
			// cycle would have been blocked when THEY saved.
			return false;
		}
		visited.add(next);
		current = next;
	}
	return false;
}

// ─── Condition clone helpers ─────────────────────────────────────────

function cloneFieldWithoutCondition(field: FormField): FormField {
	// Cleaner than a spread-with-delete because TS's narrowing prefers
	// the switch here. Kept explicit to match mergeExistingFieldWithSharedProps.
	const { condition: _dropped, ...rest } = field;
	switch (field.type) {
		case "text_input":
			return { ...(rest as TextInputField), type: "text_input" };
		case "email":
			return { ...rest, type: "email" };
		case "textarea":
			return { ...(rest as TextareaField), type: "textarea" };
		case "select":
			return { ...(rest as SelectField), type: "select" };
		case "multi_select":
			return { ...(rest as MultiSelectField), type: "multi_select" };
		case "checkbox":
			return { ...(rest as CheckboxField), type: "checkbox" };
		case "radio":
			return { ...(rest as RadioField), type: "radio" };
		case "number":
			return { ...(rest as NumberField), type: "number" };
		case "date":
			return { ...(rest as DateField), type: "date" };
		case "hidden":
			return { ...(rest as HiddenField), type: "hidden" };
	}
}

function cloneFieldWithCondition(
	field: FormField,
	condition: import("../types.js").FieldCondition,
): FormField {
	switch (field.type) {
		case "text_input":
			return { ...field, type: "text_input", condition };
		case "email":
			return { ...field, type: "email", condition };
		case "textarea":
			return { ...field, type: "textarea", condition };
		case "select":
			return { ...field, type: "select", condition };
		case "multi_select":
			return { ...field, type: "multi_select", condition };
		case "checkbox":
			return { ...field, type: "checkbox", condition };
		case "radio":
			return { ...field, type: "radio", condition };
		case "number":
			return { ...field, type: "number", condition };
		case "date":
			return { ...field, type: "date", condition };
		case "hidden":
			return { ...field, type: "hidden", condition };
	}
}


// ─── Shared type-specific mutation scaffold ──────────────────────────

/**
 * Shared prologue for type-specific saves. Loads the form, confirms
 * the field exists and has the expected type, calls the transform,
 * persists, and re-renders.
 */
async function mutateTypeSpecific<TField extends FormField>(
	ctx: PluginContext,
	formId: string,
	fieldId: string,
	expectedType: TField["type"],
	transform: (existing: TField) =>
		| { field: TField; toast: string }
		| { error: string },
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const form = await forms.get(formId);
	if (!form) return { blocks: [], toast: { message: "Form not found.", type: "error" } };
	const idx = form.fields.findIndex((f) => f.id === fieldId);
	if (idx === -1) {
		return { blocks: [], toast: { message: "Field not found.", type: "error" } };
	}
	const existing = form.fields[idx]!;
	if (existing.type !== expectedType) {
		return withPage(ctx, formId, fieldId, {
			message: `Field type changed to ${existing.type} — reload the editor.`,
			type: "error",
		});
	}
	const result = transform(existing as TField);
	if ("error" in result) {
		return withPage(ctx, formId, fieldId, { message: result.error, type: "error" });
	}
	const nextFields = [...form.fields];
	nextFields[idx] = result.field;
	await forms.put(formId, {
		...form,
		fields: nextFields,
		updatedAt: new Date().toISOString(),
	});
	ctx.log.info("[emdash-forms] field type-specific saved", {
		formId,
		fieldId,
		type: expectedType,
	});
	return {
		...(await buildFieldEditPage(ctx, formId, fieldId)),
		toast: { message: result.toast, type: "success" },
	};
}

// ─── Number/positive parsing ─────────────────────────────────────────

function normalizePositive(v: unknown): number | undefined {
	const n = normalizeOptionalNumber(v);
	if (n === undefined) return undefined;
	return n > 0 ? Math.floor(n) : undefined;
}

function normalizeOptionalNumber(v: unknown): number | undefined {
	if (typeof v === "number" && Number.isFinite(v) && v !== 0) return v;
	if (typeof v === "string" && v.trim().length > 0) {
		const parsed = Number(v);
		if (Number.isFinite(parsed) && parsed !== 0) return parsed;
	}
	return undefined;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(Math.max(n, lo), hi);
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
