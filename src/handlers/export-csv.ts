/**
 * emdash-forms — /export/csv route handler
 *
 * Per SPEC-v1.md §4.4. Authenticated GET that returns a CSV dump of
 * one form's submissions.
 *
 * Returns a structured object the emdash route runner interprets:
 *   { data: string, contentType: "text/csv", filename: string }
 *
 * Platform auth middleware covers the route (non-public). Q3 decision
 * in the Phase 2 plan.
 */

import type { RouteContext, StorageCollection } from "emdash";
import { formatCsv } from "../csv.js";
import type { Form, FormField, Submission } from "../types.js";
import type { ExportCsvInput } from "../validation.js";

/** Pagination size for reading submissions during export. */
const EXPORT_PAGE_SIZE = 500;

/** Hard upper bound on rows in a single export. Keeps memory sane. */
const EXPORT_MAX_ROWS = 50_000;

interface CsvRouteResponse {
	data: string;
	contentType: string;
	filename: string;
}

export async function exportCsvHandler(
	ctx: RouteContext<ExportCsvInput>,
): Promise<CsvRouteResponse | { error: string }> {
	const { formId } = ctx.input;
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;

	const form = await forms.get(formId);
	if (!form) {
		return { error: "Form not found" };
	}

	// Column order: core meta, then one column per non-hidden form field
	// in definition order. Hidden fields are included because they often
	// carry tracking metadata the admin specifically wants in the export.
	const columns = buildColumns(form.fields);

	// Paginate through all submissions for this form.
	const allItems: Array<Record<string, unknown>> = [];
	let cursor: string | undefined;
	let totalFetched = 0;

	do {
		const page = await submissions.query({
			where: { formId },
			orderBy: { createdAt: "desc" },
			limit: EXPORT_PAGE_SIZE,
			cursor,
		});

		for (const { id, data } of page.items) {
			if (totalFetched >= EXPORT_MAX_ROWS) break;
			allItems.push(buildRow(id, data, form.fields));
			totalFetched += 1;
		}

		if (totalFetched >= EXPORT_MAX_ROWS) {
			ctx.log.warn("[emdash-forms] CSV export hit row cap", {
				formId,
				cap: EXPORT_MAX_ROWS,
			});
			break;
		}

		cursor = page.cursor;
	} while (cursor);

	const csv = formatCsv(columns, allItems);
	const dateStamp = new Date().toISOString().slice(0, 10);

	ctx.log.info("[emdash-forms] CSV export", {
		formId,
		slug: form.slug,
		rows: allItems.length,
	});

	return {
		data: csv,
		contentType: "text/csv",
		filename: `submissions-${form.slug}-${dateStamp}.csv`,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildColumns(
	fields: FormField[],
): Array<{ key: string; label: string }> {
	const columns: Array<{ key: string; label: string }> = [
		{ key: "_id", label: "ID" },
		{ key: "_createdAt", label: "Submitted at" },
		{ key: "_status", label: "Status" },
		{ key: "_ip", label: "IP" },
		{ key: "_country", label: "Country" },
		{ key: "_userAgent", label: "User agent" },
		{ key: "_referer", label: "Referer" },
	];

	// One column per field, prefix with `f_` to avoid collisions with
	// the meta columns above. Use the field id as the CSV header so
	// exports survive label edits; admins generally treat the CSV as a
	// data source, not a display table. (If users ask for labels, add
	// an option in v1.1 — don't break existing downstream pipelines.)
	for (const field of fields) {
		columns.push({ key: `f_${field.id}`, label: field.id });
	}

	return columns;
}

function buildRow(
	id: string,
	submission: Submission,
	fields: FormField[],
): Record<string, unknown> {
	const row: Record<string, unknown> = {
		_id: id,
		_createdAt: submission.createdAt,
		_status: submission.status,
		_ip: submission.meta.ip ?? "",
		_country: submission.meta.country ?? "",
		_userAgent: submission.meta.userAgent ?? "",
		_referer: submission.meta.referer ?? "",
	};
	for (const field of fields) {
		const value = submission.data[field.id];
		row[`f_${field.id}`] = Array.isArray(value) ? value.join(", ") : (value ?? "");
	}
	return row;
}
