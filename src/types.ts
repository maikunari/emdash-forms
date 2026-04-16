/**
 * emdash-forms — Shared type definitions
 *
 * Mirrors SPEC-v1.md §3.3 exactly. The FieldType union has 10 variants
 * (phone rolled into text_input.inputType per SPEC Q4 decision).
 */

// ─── Fields ───────────────────────────────────────────────────────────

export type FieldType =
	| "text_input"
	| "email"
	| "textarea"
	| "select"
	| "multi_select"
	| "checkbox"
	| "radio"
	| "number"
	| "date"
	| "hidden";

export interface FieldCondition {
	field: string;
	eq?: string | number | boolean;
	neq?: string | number | boolean;
	in?: Array<string | number>;
}

export interface SelectOption {
	label: string;
	value: string;
}

/** Base properties shared by every field type. */
export interface BaseField {
	type: FieldType;
	id: string;
	label: string;
	required?: boolean;
	placeholder?: string;
	helpText?: string;
	width?: "full" | "half";
	condition?: FieldCondition;
}

export interface TextInputField extends BaseField {
	type: "text_input";
	inputType?: "text" | "email" | "url" | "tel";
	maxLength?: number;
}

export interface EmailField extends BaseField {
	type: "email";
}

export interface TextareaField extends BaseField {
	type: "textarea";
	rows?: number;
	maxLength?: number;
}

export interface SelectField extends BaseField {
	type: "select";
	options: SelectOption[];
}

export interface MultiSelectField extends BaseField {
	type: "multi_select";
	options: SelectOption[];
}

export interface CheckboxField extends BaseField {
	type: "checkbox";
	/** If omitted or empty, renders as a single boolean checkbox. */
	options?: SelectOption[];
}

export interface RadioField extends BaseField {
	type: "radio";
	options: SelectOption[];
}

export interface NumberField extends BaseField {
	type: "number";
	min?: number;
	max?: number;
	step?: number;
}

export interface DateField extends BaseField {
	type: "date";
	min?: string;
	max?: string;
}

export interface HiddenField extends BaseField {
	type: "hidden";
	/** Always included in the submission. See SPEC §6.3. */
	defaultValue?: string;
}

/** Discriminated union of all field variants. */
export type FormField =
	| TextInputField
	| EmailField
	| TextareaField
	| SelectField
	| MultiSelectField
	| CheckboxField
	| RadioField
	| NumberField
	| DateField
	| HiddenField;

// ─── Form ─────────────────────────────────────────────────────────────

export interface NotificationSettings {
	notifyAdmin: boolean;
	adminEmail?: string;
	adminSubject?: string;
	adminBody?: string;
	confirmationEmail: boolean;
	confirmationSubject?: string;
	confirmationBody?: string;
}

export interface FormSettings {
	submitLabel: string;
	successMessage: string;
	redirectUrl?: string;
	notifications: NotificationSettings;
	spamProtection: "honeypot" | "turnstile";
}

export interface Form {
	title: string;
	slug: string;
	fields: FormField[];
	settings: FormSettings;
	status: "active" | "paused";
	submissionCount: number;
	lastSubmissionAt: string | null;
	createdAt: string;
	updatedAt: string;
}

// ─── Submission ───────────────────────────────────────────────────────

export interface SubmissionMeta {
	ip?: string;
	userAgent?: string;
	referer?: string;
	country?: string;
}

export interface Submission {
	formId: string;
	data: Record<string, unknown>;
	meta: SubmissionMeta;
	status: "new" | "read" | "archived";
	createdAt: string;
}

// ─── Templates ────────────────────────────────────────────────────────

export interface FormTemplate {
	id: string;
	title: string;
	description: string;
	fields: FormField[];
	defaultSettings: Partial<FormSettings>;
}
