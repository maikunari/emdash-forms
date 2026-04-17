/**
 * emdash-forms — Mutation action handlers (non-settings)
 *
 * Block-action targets referenced from the admin pages:
 *  - submission:delete:{id} — delete a single submission
 *  - form:pause:{id}         — set Form.status = "paused"
 *  - form:activate:{id}      — set Form.status = "active"
 *  - form:delete:{id}        — delete form + cascade-delete its submissions
 *
 * Settings saves live in pages/settings.ts; submission read-state
 * flips live in pages/submission-detail.ts. This module covers
 * destructive + status-change actions so they share cascade helpers.
 */

import type { PluginContext, StorageCollection } from "emdash";
import type { BlockResponse } from "./router.js";
import { buildFormsListPage } from "./pages/forms-list.js";
import { buildSubmissionsListPage } from "./pages/submissions-list.js";
import type { Form, Submission } from "../types.js";

/** Max submissions deleted per batch during a form-delete cascade. */
const CASCADE_BATCH_SIZE = 500;

// ─── Submission delete ───────────────────────────────────────────────

export async function deleteSubmissionAction(
	ctx: PluginContext,
	submissionId: string,
): Promise<BlockResponse> {
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;
	const existing = await submissions.get(submissionId);

	// Idempotent: already gone → friendly info toast, return to
	// whichever list the admin likely came from.
	if (!existing) {
		return {
			...(await buildSubmissionsListPage(ctx)),
			toast: { message: "Submission already deleted", type: "info" },
		};
	}

	await submissions.delete(submissionId);
	ctx.log.info("[emdash-forms] submission deleted", {
		submissionId,
		formId: existing.formId,
	});

	// Route back to the per-form list if that's where it came from;
	// if the form is gone, fall back to the cross-form list.
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const parentForm = await forms.get(existing.formId);
	if (parentForm) {
		return {
			...(await buildSubmissionsListPage(ctx, { formId: existing.formId })),
			toast: { message: "Submission deleted", type: "success" },
		};
	}
	return {
		...(await buildSubmissionsListPage(ctx)),
		toast: { message: "Submission deleted", type: "success" },
	};
}

// ─── Form pause / activate ───────────────────────────────────────────

export async function pauseFormAction(
	ctx: PluginContext,
	formId: string,
): Promise<BlockResponse> {
	return setFormStatus(ctx, formId, "paused");
}

export async function activateFormAction(
	ctx: PluginContext,
	formId: string,
): Promise<BlockResponse> {
	return setFormStatus(ctx, formId, "active");
}

async function setFormStatus(
	ctx: PluginContext,
	formId: string,
	status: Form["status"],
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const existing = await forms.get(formId);
	if (!existing) {
		return {
			...(await buildFormsListPage(ctx)),
			toast: { message: "Form not found", type: "error" },
		};
	}
	if (existing.status === status) {
		return {
			...(await buildFormsListPage(ctx)),
			toast: {
				message: `Form already ${status}`,
				type: "info",
			},
		};
	}
	await forms.put(formId, {
		...existing,
		status,
		updatedAt: new Date().toISOString(),
	});
	ctx.log.info("[emdash-forms] form status changed", { formId, status });
	return {
		...(await buildFormsListPage(ctx)),
		toast: {
			message: status === "paused" ? "Form paused" : "Form activated",
			type: "success",
		},
	};
}

// ─── Form delete (with cascade) ──────────────────────────────────────

export async function deleteFormAction(
	ctx: PluginContext,
	formId: string,
): Promise<BlockResponse> {
	const forms = ctx.storage.forms as StorageCollection<Form>;
	const submissions = ctx.storage.submissions as StorageCollection<Submission>;

	const existing = await forms.get(formId);
	if (!existing) {
		return {
			...(await buildFormsListPage(ctx)),
			toast: { message: "Form already deleted", type: "info" },
		};
	}

	// Cascade-delete submissions. Paginate in batches so we don't hold
	// 10k ids in memory at once.
	const deletedCount = await cascadeDeleteSubmissions(submissions, formId, ctx);

	await forms.delete(formId);

	ctx.log.info("[emdash-forms] form deleted", {
		formId,
		slug: existing.slug,
		cascadedSubmissions: deletedCount,
	});

	return {
		...(await buildFormsListPage(ctx)),
		toast: {
			message:
				deletedCount > 0
					? `Form deleted (${deletedCount} submissions removed)`
					: "Form deleted",
			type: "success",
		},
	};
}

/**
 * Delete every submission belonging to the form. Callers should not
 * rely on atomicity — if this fails partway, the form still gets
 * deleted and a retention cleanup pass will sweep up the orphans
 * eventually (they'll match createdAt < retention cutoff regardless
 * of formId).
 *
 * Important: we re-query from scratch on each iteration rather than
 * paginating with a cursor. Cursor semantics across deletes are
 * implementation-dependent (offset-based cursors become invalid after
 * items shift; id-based cursors might skip items depending on order).
 * Re-querying the first page each time converges cleanly — every
 * remaining submission bubbles up to page 1 as its predecessors are
 * deleted. Worst case: O(N/batch) queries, same as cursor pagination.
 */
async function cascadeDeleteSubmissions(
	submissions: StorageCollection<Submission>,
	formId: string,
	ctx: PluginContext,
): Promise<number> {
	let deleted = 0;
	// Safety valve: bail after a pathological number of iterations so
	// a bug in the storage layer can't spin forever.
	const MAX_ITERATIONS = 1000;

	for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
		const page = await submissions.query({
			where: { formId },
			limit: CASCADE_BATCH_SIZE,
		});
		if (page.items.length === 0) return deleted;

		const ids = page.items.map((item) => item.id);
		const batchDeleted = await submissions.deleteMany(ids);
		deleted += batchDeleted;

		ctx.log.info("[emdash-forms] cascade-delete in progress", {
			formId,
			batchDeleted,
			totalDeleted: deleted,
		});

		// Protective: if deleteMany reports zero, something is wrong
		// (maybe a read-only collection or an id-mismatch bug). Break
		// to avoid an infinite loop.
		if (batchDeleted === 0) {
			ctx.log.warn("[emdash-forms] cascade-delete: 0 deleted in a batch, bailing", {
				formId,
				iter,
			});
			return deleted;
		}
	}

	ctx.log.warn("[emdash-forms] cascade-delete hit MAX_ITERATIONS safety cap", {
		formId,
		deleted,
	});
	return deleted;
}
