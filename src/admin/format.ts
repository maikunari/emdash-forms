/**
 * emdash-forms — Admin UI formatting helpers
 *
 * Pure functions used by the Block Kit page builders. Kept separate
 * from the builders themselves so they're trivially testable and
 * reusable across pages (forms-list, submissions-list, submission-detail
 * all share preview-text formatting, for instance).
 */

import type { FormField, Submission } from "../types.js";

/** Maximum characters in a preview string before we append an ellipsis. */
const PREVIEW_MAX = 120;

/** Maximum characters for a single field's value inside the preview. */
const PREVIEW_FIELD_MAX = 40;

/** Number of fields to include in a submissions-list preview cell. */
const PREVIEW_FIELD_COUNT = 3;

/**
 * Truncate a string at `max` chars, appending an ellipsis if cut.
 * Uses a single Unicode ellipsis rather than "..." to save two cells
 * in a tight table column.
 */
export function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Build a short single-line preview of a submission for the
 * submissions table. Joins the first N non-hidden field values with
 * a bullet separator. Missing or empty values are elided.
 */
export function submissionPreview(
	fields: FormField[],
	data: Record<string, unknown>,
): string {
	const parts: string[] = [];
	for (const field of fields) {
		if (field.type === "hidden") continue;
		if (parts.length >= PREVIEW_FIELD_COUNT) break;

		const raw = data[field.id];
		const rendered = renderFieldValue(raw);
		if (!rendered) continue;

		parts.push(truncate(rendered, PREVIEW_FIELD_MAX));
	}
	return truncate(parts.join(" · "), PREVIEW_MAX);
}

/**
 * Stringify a single field value for display. Arrays join with ", ";
 * objects JSON-serialize; null/undefined return empty string.
 */
export function renderFieldValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.map(String).join(", ");
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return "[object]";
		}
	}
	return String(value);
}

/**
 * Format an ISO timestamp for display. Block Kit's `relative_time`
 * column format handles relative rendering ("2 hours ago") on the
 * client — we just return the ISO string verbatim in that case.
 * For absolute rendering, return a short date string.
 */
export function formatDate(
	iso: string | null | undefined,
	mode: "iso" | "short" = "iso",
): string {
	if (!iso) return "";
	if (mode === "iso") return iso;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Count a Submission's unread siblings by status. Used for the forms-list
 * "N unread" annotation. Pure helper — the caller does the storage query.
 */
export function countUnread(submissions: ReadonlyArray<Submission>): number {
	return submissions.filter((s) => s.status === "new").length;
}

/**
 * Pluralize a noun based on count. `n forms` / `1 form`.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
	if (count === 1) return `${count} ${singular}`;
	return `${count} ${plural ?? `${singular}s`}`;
}
