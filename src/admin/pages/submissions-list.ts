/**
 * emdash-forms — /submissions and /forms/{id}/submissions
 *
 * Per SPEC-v1.md §5.2. Paginated submissions table. The same builder
 * serves both the cross-form view (no formId filter) and the per-form
 * view (formId passed in). Pagination uses Block Kit's native table
 * pageActionId + nextCursor pattern — the audit-log reference plugin
 * does this at packages/plugins/audit-log/src/sandbox-entry.ts:312.
 */

import type { PluginContext, StorageCollection } from "emdash";
import { formatDate, submissionPreview, truncate } from "../format.js";
import type { BlockResponse } from "../router.js";
import type { Form, Submission } from "../../types.js";

const PAGE_SIZE = 25;

/** Action id for the table's "next page" interaction. */
export const PAGINATION_ACTION_ID = "submissions:page";

export interface SubmissionsListOptions {
	/** Restrict to a single form (per-form view). */
	formId?: string;
	/** Cursor from a previous page. */
	cursor?: string;
}

export async function buildSubmissionsListPage(
	ctx: PluginContext,
	options: SubmissionsListOptions = {},
): Promise<BlockResponse> {
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;
	const forms = ctx.storage.forms as StorageCollection<Form>;

	// Resolve the header: cross-form vs per-form.
	const formsCache = new Map<string, Form>();
	let headerText = "All submissions";
	let backButton: unknown | null = null;
	let exportButton: unknown | null = null;

	if (options.formId) {
		const formRecord = await forms.get(options.formId);
		if (!formRecord) {
			// Form was deleted mid-navigation. Render a friendly error
			// rather than 404ing the admin page.
			return {
				blocks: [
					{ type: "header", text: "Submissions" },
					{
						type: "banner",
						variant: "error",
						title: "Form not found",
						description: "This form may have been deleted. Head back to the forms list.",
					},
					{
						type: "actions",
						elements: [
							{
								type: "button",
								text: "Back to forms",
								action_id: "navigate:/",
							},
						],
					},
				],
			};
		}
		formsCache.set(options.formId, formRecord);
		headerText = `Submissions — ${formRecord.title}`;
		backButton = {
			type: "button",
			text: "Back to forms",
			action_id: "navigate:/",
		};
		exportButton = {
			type: "button",
			text: "Export CSV",
			// Browser-level GET to the export/csv route; opens in a new tab.
			url: `/_emdash/api/plugins/emdash-forms/export/csv?formId=${encodeURIComponent(options.formId)}`,
		};
	}

	// Query a page of submissions.
	const queryOptions: Parameters<typeof submissions.query>[0] = {
		orderBy: { createdAt: "desc" },
		limit: PAGE_SIZE,
	};
	if (options.cursor) queryOptions.cursor = options.cursor;
	if (options.formId) queryOptions.where = { formId: options.formId };

	let page: Awaited<ReturnType<typeof submissions.query>>;
	try {
		page = await submissions.query(queryOptions);
	} catch (err) {
		// Cursor-tampering surface: a malformed/alien cursor makes the
		// storage layer throw. We recover gracefully — offer to reload
		// from the top.
		ctx.log.warn("[emdash-forms] submissions list query failed", {
			err: err instanceof Error ? err.message : String(err),
			cursor: options.cursor,
		});
		return {
			blocks: [
				{ type: "header", text: headerText },
				{
					type: "banner",
					variant: "error",
					title: "Could not load submissions",
					description: "The pagination cursor is invalid or expired. Reload from the top.",
					accessory: {
						type: "button",
						text: "Reload",
						action_id: options.formId
							? `navigate:/forms/${options.formId}/submissions`
							: "navigate:/submissions",
					},
				},
			],
		};
	}

	// For cross-form view, fetch form titles in batch so we can render a
	// "Form" column. One getMany call; missed ids render as "(deleted)".
	if (!options.formId) {
		const uniqueFormIds = Array.from(new Set(page.items.map((item) => item.data.formId)));
		const missingIds = uniqueFormIds.filter((id) => !formsCache.has(id));
		if (missingIds.length > 0) {
			const fetched = await forms.getMany(missingIds);
			for (const [id, form] of fetched) formsCache.set(id, form);
		}
	}

	const headerActions: unknown[] = [];
	if (backButton) headerActions.push(backButton);
	if (exportButton) headerActions.push(exportButton);

	const headerBlocks: unknown[] = [{ type: "header", text: headerText }];
	if (headerActions.length > 0) {
		headerBlocks.push({ type: "actions", elements: headerActions });
	}
	headerBlocks.push({ type: "divider" });

	// Empty state.
	if (page.items.length === 0) {
		return {
			blocks: [
				...headerBlocks,
				{
					type: "banner",
					variant: "default",
					title: "No submissions yet",
					description: options.formId
						? "Submissions to this form will show up here."
						: "Submissions across all forms will show up here.",
				},
			],
		};
	}

	// Build table rows.
	const rows = page.items.map(({ id, data: submission }) => {
		const form = formsCache.get(submission.formId);
		const formFields = form?.fields ?? [];
		return {
			_submissionId: id,
			form: truncate(form?.title ?? "(deleted form)", 40),
			preview: submissionPreview(formFields, submission.data),
			status: submission.status,
			submitted: formatDate(submission.createdAt, "iso"),
		};
	});

	const tableColumns: Array<Record<string, string>> = [];
	if (!options.formId) {
		tableColumns.push({ key: "form", label: "Form", format: "text" });
	}
	tableColumns.push(
		{ key: "preview", label: "Preview", format: "text" },
		{ key: "status", label: "Status", format: "badge" },
		{ key: "submitted", label: "Submitted", format: "relative_time" },
	);

	const tableBlock: Record<string, unknown> = {
		type: "table",
		blockId: "submissions-table",
		columns: tableColumns,
		rows,
		// Row click navigates to detail page. Action id encodes the
		// submission id via colon separator.
		rowActionIdPrefix: "submission:view:",
		rowActionIdKey: "_submissionId",
	};

	if (page.cursor) {
		tableBlock.pageActionId = PAGINATION_ACTION_ID;
		tableBlock.nextCursor = page.cursor;
	}

	return { blocks: [...headerBlocks, tableBlock] };
}
