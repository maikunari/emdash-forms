/**
 * emdash-forms — /submissions/{id} admin page
 *
 * Per SPEC-v1.md §5.2. Full detail view for a single submission:
 *  - Meta (form, submitted at, status, IP, user agent, country, referer)
 *  - All field values (label → value, one row per non-hidden field)
 *  - Actions: Mark as read/unread, Delete (with confirm), Back
 *
 * Read-only for Phase 2. Submission data is never edited post-submit
 * (deliberate audit-trail semantics).
 */

import type { PluginContext, StorageCollection } from "emdash";
import { formatDate, renderFieldValue } from "../format.js";
import type { BlockResponse } from "../router.js";
import type { Form, FormField, Submission } from "../../types.js";

export async function buildSubmissionDetailPage(
	ctx: PluginContext,
	submissionId: string,
): Promise<BlockResponse> {
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;
	const forms = ctx.storage.forms as StorageCollection<Form>;

	const submission = await submissions.get(submissionId);
	if (!submission) {
		return {
			blocks: [
				{ type: "header", text: "Submission" },
				{
					type: "banner",
					variant: "error",
					title: "Submission not found",
					description: "This submission may have been deleted.",
				},
				backButton("/submissions"),
			],
		};
	}

	const form = await forms.get(submission.formId);
	// Graceful degrade: if the parent form was deleted, we still show the
	// submission data (admin audit trail) but note the form is gone.
	const formTitle = form?.title ?? "(deleted form)";

	// ─── Meta fields block ─────────────────────────────────────
	const metaItems: Array<{ label: string; value: string }> = [
		{ label: "Form", value: formTitle },
		{ label: "Submitted", value: formatDate(submission.createdAt, "iso") },
		{ label: "Status", value: submission.status },
	];
	if (submission.meta.ip) metaItems.push({ label: "IP", value: submission.meta.ip });
	if (submission.meta.country) metaItems.push({ label: "Country", value: submission.meta.country });
	if (submission.meta.userAgent)
		metaItems.push({ label: "User agent", value: submission.meta.userAgent });
	if (submission.meta.referer) metaItems.push({ label: "Referer", value: submission.meta.referer });

	// ─── Data fields block ─────────────────────────────────────
	// Iterate the form's fields (if available) so labels are human-
	// readable and order matches the form definition. If the form was
	// deleted, fall back to rendering whatever keys are present.
	const dataItems = buildDataItems(form?.fields, submission.data);

	// ─── Actions ───────────────────────────────────────────────
	const toggleReadAction =
		submission.status === "new"
			? {
					type: "button",
					text: "Mark as read",
					action_id: `submission:read:${submissionId}`,
					style: "primary",
				}
			: {
					type: "button",
					text: "Mark as unread",
					action_id: `submission:unread:${submissionId}`,
				};

	const deleteAction = {
		type: "button",
		text: "Delete",
		action_id: `submission:delete:${submissionId}`,
		style: "danger",
		confirm: {
			title: "Delete submission?",
			text: "This can't be undone. The submission and all its data will be permanently removed.",
			confirm: "Delete",
			deny: "Cancel",
			style: "danger",
		},
	};

	const backAction = {
		type: "button",
		text: "Back",
		action_id: form
			? `navigate:/forms/${submission.formId}/submissions`
			: "navigate:/submissions",
	};

	return {
		blocks: [
			{ type: "header", text: `Submission from ${formTitle}` },
			{
				type: "actions",
				elements: [backAction, toggleReadAction, deleteAction],
			},
			{ type: "divider" },
			{ type: "header", text: "Details" },
			{
				type: "fields",
				fields: metaItems,
			},
			{ type: "divider" },
			{ type: "header", text: "Submitted data" },
			{
				type: "fields",
				fields: dataItems,
			},
		],
	};
}

// ─── Action handlers ─────────────────────────────────────────────────

/** Flip a submission from `new` → `read`. Idempotent. */
export async function markSubmissionRead(
	ctx: PluginContext,
	submissionId: string,
): Promise<BlockResponse> {
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;
	const existing = await submissions.get(submissionId);
	if (!existing) {
		return {
			...(await buildSubmissionDetailPage(ctx, submissionId)),
			toast: { message: "Submission not found", type: "error" },
		};
	}
	if (existing.status !== "new") {
		return {
			...(await buildSubmissionDetailPage(ctx, submissionId)),
			toast: { message: "Already marked as read", type: "info" },
		};
	}
	await submissions.put(submissionId, { ...existing, status: "read" });
	ctx.log.info("[emdash-forms] submission marked read", { submissionId });
	return {
		...(await buildSubmissionDetailPage(ctx, submissionId)),
		toast: { message: "Marked as read", type: "success" },
	};
}

/** Flip a submission from `read` → `new`. Idempotent. */
export async function markSubmissionUnread(
	ctx: PluginContext,
	submissionId: string,
): Promise<BlockResponse> {
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;
	const existing = await submissions.get(submissionId);
	if (!existing) {
		return {
			...(await buildSubmissionDetailPage(ctx, submissionId)),
			toast: { message: "Submission not found", type: "error" },
		};
	}
	if (existing.status === "new") {
		return {
			...(await buildSubmissionDetailPage(ctx, submissionId)),
			toast: { message: "Already unread", type: "info" },
		};
	}
	await submissions.put(submissionId, { ...existing, status: "new" });
	ctx.log.info("[emdash-forms] submission marked unread", { submissionId });
	return {
		...(await buildSubmissionDetailPage(ctx, submissionId)),
		toast: { message: "Marked as unread", type: "success" },
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildDataItems(
	fields: FormField[] | undefined,
	data: Record<string, unknown>,
): Array<{ label: string; value: string }> {
	// Prefer the form definition for label lookup + ordering.
	if (fields) {
		return fields
			.filter((f) => f.type !== "hidden" || data[f.id] !== undefined)
			.map((f) => ({
				label: f.label,
				value: renderFieldValue(data[f.id]),
			}));
	}
	// Fallback: the form was deleted, or the submission has fields
	// the form no longer defines. Render whatever keys are present,
	// using the id as the label.
	return Object.entries(data).map(([key, value]) => ({
		label: key,
		value: renderFieldValue(value),
	}));
}

function backButton(path: string): Record<string, unknown> {
	return {
		type: "actions",
		elements: [
			{
				type: "button",
				text: "Back",
				action_id: `navigate:${path}`,
			},
		],
	};
}
