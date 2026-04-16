/**
 * emdash-forms — Zod input schemas
 *
 * Schemas for route inputs per SPEC-v1.md §4. Admin-interaction schemas
 * cover the Block Kit form_submit payloads handled by the `admin` route
 * dispatcher per SPEC §5.
 *
 * Zod is sourced from astro/zod (re-exported by the astro peer dep,
 * matching the @emdash-cms/plugin-forms reference pattern — no direct
 * zod dependency needed).
 */

import { z } from "astro/zod";

// ─── Public routes ────────────────────────────────────────────────────

/** SPEC §4.1 — POST submit (public). */
export const submitSchema = z.object({
	formSlug: z.string().min(1),
	data: z.record(z.unknown()),
	/** Honeypot — must be empty or absent for a real submission. */
	_emdash_hp: z.string().optional(),
	/** Turnstile token when form's spamProtection === "turnstile". */
	"cf-turnstile-response": z.string().optional(),
});

/** SPEC §4.2 — GET definition (public). */
export const definitionSchema = z.object({
	slug: z.string().min(1),
});

// ─── Admin interactions (routed through the `admin` route) ────────────

/**
 * Block Kit interaction envelope. The admin route receives this on every
 * page load, form submit, and button click per SPEC §5.1. Concrete action
 * shapes are parsed inside the handler by narrowing on `type` + `action_id`.
 */
export const interactionSchema = z.object({
	type: z.enum(["page_load", "form_submit", "block_action"]),
	page: z.string().optional(),
	action_id: z.string().optional(),
	block_id: z.string().optional(),
	values: z.record(z.unknown()).optional(),
	value: z.string().optional(),
});

// ─── Form CRUD (admin interactions) ───────────────────────────────────

/**
 * Shape of the form-level inputs submitted from the form builder page
 * (see SPEC §5.2 `/forms/{id}` Renders + Handles). Fields themselves
 * are mutated via per-field action_ids (add_field, field:*), not sent
 * in bulk on save — this schema covers the metadata + settings half.
 */
export const formSaveValuesSchema = z.object({
	title: z.string().min(1, "Title is required"),
	slug: z
		.string()
		.min(1)
		.regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric + hyphens"),
	status: z.enum(["active", "paused"]).optional(),
	submitLabel: z.string().min(1).optional(),
	successMessage: z.string().optional(),
	redirectUrl: z.string().optional(),
	spamProtection: z.enum(["honeypot", "turnstile"]).optional(),
	notifyAdmin: z.boolean().optional(),
	adminEmail: z.string().email().optional().or(z.literal("")),
	adminSubject: z.string().optional(),
	adminBody: z.string().optional(),
	confirmationEmail: z.boolean().optional(),
	confirmationSubject: z.string().optional(),
	confirmationBody: z.string().optional(),
});

/**
 * Shape of the `/forms/new` Create form submission — SPEC §5.2 "Form
 * creation flow." Minimal until the form is persisted; field list and
 * full settings come after the redirect to `/forms/{id}`.
 */
export const formCreateValuesSchema = z.object({
	title: z.string().min(1, "Title is required"),
	slug: z
		.string()
		.regex(/^[a-z0-9-]*$/, "Slug must be lowercase alphanumeric + hyphens")
		.optional(),
});

// ─── Field editor (admin interactions) ────────────────────────────────

/**
 * Inputs submitted from `/forms/{id}/fields/{fieldId}` per SPEC §5.2.
 * Type-specific fields are all optional at the schema level — they're
 * gated by Block Kit `condition` at render time, not validated here.
 * The admin handler validates coherence per field.type before saving.
 */
export const fieldSaveValuesSchema = z.object({
	type: z.enum([
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
	]),
	id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
	label: z.string().min(1),
	required: z.boolean().optional(),
	placeholder: z.string().optional(),
	helpText: z.string().optional(),
	width: z.enum(["full", "half"]).optional(),
	// Text / textarea
	inputType: z.enum(["text", "email", "url", "tel"]).optional(),
	maxLength: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	// Select-family — options serialized as newline-separated "label|value"
	options: z.string().optional(),
	// Number
	min: z.number().optional(),
	max: z.number().optional(),
	step: z.number().optional(),
	// Date
	minDate: z.string().optional(),
	maxDate: z.string().optional(),
	// Hidden
	defaultValue: z.string().optional(),
	// Condition
	conditionField: z.string().optional(),
	conditionOperator: z.enum(["eq", "neq", "in"]).optional(),
	conditionValue: z.string().optional(),
});

// ─── Submission interactions (admin) ──────────────────────────────────

export const submissionsListQuerySchema = z.object({
	formId: z.string().optional(),
	status: z.enum(["new", "read", "archived"]).optional(),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

// ─── CSV export ───────────────────────────────────────────────────────

/** SPEC §4.4 — GET export/csv (auth required). */
export const exportCsvSchema = z.object({
	formId: z.string().min(1),
});

// ─── Type exports ─────────────────────────────────────────────────────

export type SubmitInput = z.infer<typeof submitSchema>;
export type DefinitionInput = z.infer<typeof definitionSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type FormSaveValues = z.infer<typeof formSaveValuesSchema>;
export type FormCreateValues = z.infer<typeof formCreateValuesSchema>;
export type FieldSaveValues = z.infer<typeof fieldSaveValuesSchema>;
export type SubmissionsListQuery = z.infer<typeof submissionsListQuerySchema>;
export type ExportCsvInput = z.infer<typeof exportCsvSchema>;
