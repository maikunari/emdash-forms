/**
 * emdash-forms — definePlugin runtime entry
 *
 * Runs at request time on the deployed server. Works in both trusted
 * (in-process) and sandboxed (V8 isolate) modes per SPEC-v1.md §2.
 *
 * Phase 0: skeleton only. All routes and hooks return TODO responses.
 * Phase 1 implements write path (submit, notifications, cron, templates).
 * Phase 2 implements admin read path. Phase 3 implements admin write path.
 */

import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";

import {
	definitionSchema,
	exportCsvSchema,
	interactionSchema,
	submitSchema,
} from "./validation.js";

// NOTE: SPEC-v1 §3.1 specifies composite indexes (["formId", "createdAt"],
// ["formId", "status"]) on the submissions collection. The emdash 0.5.0
// TypeScript surface does not accept composite indexes on Standard-format
// plugins — PluginDescriptor's StorageCollectionDeclaration.indexes is
// `string[]`, and StandardPluginDefinition has no storage field at all.
// Composite indexes are a Native-only feature via PluginDefinition<TStorage>.
//
// Phase 0 ships flat indexes only, declared in the descriptor. Query paths
// that would benefit from composites (per-form submissions ordered by
// createdAt) will use filter-then-order on a single-field index instead;
// we'll benchmark in Phase 2 and revisit before v1.0.0 if needed.
// Flagged in the Phase 0 PR for spec revision.

// ─── Shared stub response ─────────────────────────────────────────────

const NOT_IMPLEMENTED = { ok: false, error: "not implemented (Phase 0 stub)" } as const;

const PLACEHOLDER_BLOCKS = {
	blocks: [
		{
			type: "section",
			text: "Phase 0 placeholder — under construction.",
		},
	],
} as const;

// ─── Admin page dispatcher ────────────────────────────────────────────

/**
 * Parse `interaction.page` against the 7 page patterns per SPEC §5.1.
 * Order matters: more-specific patterns before less-specific.
 *
 * Returns a tagged match the handler can switch on. Phase 0 never reads
 * the tag — every branch returns the same placeholder. Phases 2 and 3
 * wire each branch to a real page renderer.
 */
function matchAdminPage(
	page: string | undefined,
):
	| { kind: "forms-list" }
	| { kind: "form-new" }
	| { kind: "field-edit"; formId: string; fieldId: string }
	| { kind: "form-submissions"; formId: string }
	| { kind: "form-edit"; formId: string }
	| { kind: "submissions-list" }
	| { kind: "submission-detail"; submissionId: string }
	| { kind: "settings" }
	| { kind: "unknown" } {
	if (!page || page === "/") return { kind: "forms-list" };
	if (page === "/forms/new") return { kind: "form-new" };
	if (page === "/settings") return { kind: "settings" };

	const fieldEditMatch = /^\/forms\/([^/]+)\/fields\/([^/]+)$/.exec(page);
	if (fieldEditMatch) {
		return {
			kind: "field-edit",
			formId: fieldEditMatch[1]!,
			fieldId: fieldEditMatch[2]!,
		};
	}

	const formSubmissionsMatch = /^\/forms\/([^/]+)\/submissions$/.exec(page);
	if (formSubmissionsMatch) {
		return { kind: "form-submissions", formId: formSubmissionsMatch[1]! };
	}

	const formEditMatch = /^\/forms\/([^/]+)$/.exec(page);
	if (formEditMatch) {
		return { kind: "form-edit", formId: formEditMatch[1]! };
	}

	if (page === "/submissions") return { kind: "submissions-list" };

	const submissionDetailMatch = /^\/submissions\/([^/]+)$/.exec(page);
	if (submissionDetailMatch) {
		return { kind: "submission-detail", submissionId: submissionDetailMatch[1]! };
	}

	return { kind: "unknown" };
}

// ─── Plugin definition ────────────────────────────────────────────────

export default definePlugin({
	// SPEC §4.1 step 5 notifications, §4.1 step 7 cron, migration plan 1.3 (templates).
	// All bodies TODO in Phase 0.
	hooks: {
		"plugin:install": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				ctx.log.info("[emdash-forms] plugin:install — TODO (Phase 1: seed 5 templates)");
			},
		},

		"plugin:activate": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				ctx.log.info(
					"[emdash-forms] plugin:activate — TODO (Phase 1: schedule @weekly cron)",
				);
			},
		},

		cron: {
			handler: async (_event: unknown, ctx: PluginContext) => {
				ctx.log.info("[emdash-forms] cron — TODO (Phase 1: retention cleanup)");
			},
		},
	},

	routes: {
		// ── Public routes ─── ⚠ SPEC §4 — pending maintainer confirmation ──

		/** SPEC §4.1 — POST submit (public). */
		submit: {
			public: true,
			input: submitSchema,
			handler: async (_routeCtx: unknown, ctx: PluginContext) => {
				ctx.log.info("[emdash-forms] route:submit — TODO (Phase 1)");
				return NOT_IMPLEMENTED;
			},
		},

		/** SPEC §4.2 — GET definition (public). */
		definition: {
			public: true,
			input: definitionSchema,
			handler: async (_routeCtx: unknown, ctx: PluginContext) => {
				ctx.log.info("[emdash-forms] route:definition — TODO (Phase 4)");
				return NOT_IMPLEMENTED;
			},
		},

		// ── Admin routes (auth required) ──────────────────────────────

		/** SPEC §4.3 — POST admin (single Block Kit dispatcher). */
		admin: {
			input: interactionSchema,
			handler: async (routeCtx: unknown, ctx: PluginContext) => {
				// Minimal narrowing of the interaction envelope.
				const input =
					typeof routeCtx === "object" && routeCtx !== null && "input" in routeCtx
						? (routeCtx as { input: unknown }).input
						: {};
				const interaction = (
					typeof input === "object" && input !== null ? input : {}
				) as {
					type?: string;
					page?: string;
				};

				// Page dispatcher (SPEC §5.1). Phase 0: all branches return the
				// same placeholder. Phases 2–3 replace each branch with a real
				// page renderer.
				const match = matchAdminPage(interaction.page);
				ctx.log.info("[emdash-forms] route:admin", {
					type: interaction.type,
					page: interaction.page,
					match: match.kind,
				});

				switch (match.kind) {
					case "forms-list":
					case "form-new":
					case "form-edit":
					case "field-edit":
					case "form-submissions":
					case "submissions-list":
					case "submission-detail":
					case "settings":
					case "unknown":
						return PLACEHOLDER_BLOCKS;
				}
			},
		},

		/** SPEC §4.4 — GET export/csv (auth required). Separate route because
		 *  it returns text/csv, not a BlockResponse. */
		"export/csv": {
			input: exportCsvSchema,
			handler: async (_routeCtx: unknown, ctx: PluginContext) => {
				ctx.log.info("[emdash-forms] route:export/csv — TODO (Phase 2)");
				return new Response("", {
					status: 501,
					headers: { "Content-Type": "text/plain" },
				});
			},
		},
	},
});
