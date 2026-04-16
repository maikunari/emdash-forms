/**
 * emdash-forms — definePlugin runtime entry
 *
 * Runs at request time on the deployed server. Works in both trusted
 * (in-process) and sandboxed (V8 isolate) modes per SPEC-v1.md §2.
 *
 * Phase 1: write path implemented (submit, notifications, template seed,
 * cron retention). Admin routes still return Block Kit placeholders —
 * those bodies land in Phases 2–3.
 */

import { definePlugin } from "emdash";
import type { PluginContext, RouteContext } from "emdash";

import { handleActivate, handleCron, handleInstall } from "./handlers/lifecycle.js";
import { submitHandler } from "./handlers/submit.js";
import {
	definitionSchema,
	exportCsvSchema,
	interactionSchema,
	submitSchema,
} from "./validation.js";
import type { SubmitInput } from "./validation.js";

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

// ─── Placeholders for unimplemented admin pages ───────────────────────

const PLACEHOLDER_BLOCKS = {
	blocks: [
		{
			type: "section",
			text: "Under construction — Phase 2/3 implementation.",
		},
	],
} as const;

// ─── Admin page dispatcher ────────────────────────────────────────────

/**
 * Parse `interaction.page` against the 8 page patterns per SPEC §5.1.
 * Order matters: more-specific patterns before less-specific.
 *
 * Returns a tagged match the handler can switch on. Phase 1 still
 * returns placeholders for every branch; Phases 2 and 3 wire each
 * branch to a real page renderer.
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
	hooks: {
		// SPEC §9 + migration 1.3 — seed 5 templates + persist default settings.
		"plugin:install": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				await handleInstall(ctx);
			},
		},

		// Migration 1.6 — schedule @weekly retention cleanup.
		"plugin:activate": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				await handleActivate(ctx);
			},
		},

		// Migration 1.7 — retention cleanup.
		cron: {
			handler: async (
				event: { name: string; data?: Record<string, unknown>; scheduledAt: string },
				ctx: PluginContext,
			) => {
				await handleCron(event, ctx);
			},
		},
	},

	routes: {
		// ── Public routes ─────────────────────────────────────────────

		/** SPEC §4.1 — POST submit (public). */
		submit: {
			public: true,
			input: submitSchema,
			handler: async (ctx: RouteContext<SubmitInput>) => {
				return submitHandler(ctx);
			},
		},

		/** SPEC §4.2 — GET definition (public). TODO Phase 4. */
		definition: {
			public: true,
			input: definitionSchema,
			handler: async (ctx: RouteContext<unknown>) => {
				ctx.log.info("[emdash-forms] route:definition — TODO (Phase 4)");
				return { ok: false, error: "not implemented (Phase 4)" };
			},
		},

		// ── Admin routes (auth required) ──────────────────────────────

		/** SPEC §4.3 — POST admin (single Block Kit dispatcher). */
		admin: {
			input: interactionSchema,
			handler: async (ctx: RouteContext<unknown>) => {
				const interaction = (
					typeof ctx.input === "object" && ctx.input !== null ? ctx.input : {}
				) as { type?: string; page?: string };

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
		 *  it returns text/csv, not a BlockResponse. TODO Phase 2. */
		"export/csv": {
			input: exportCsvSchema,
			handler: async (ctx: RouteContext<unknown>) => {
				ctx.log.info("[emdash-forms] route:export/csv — TODO (Phase 2)");
				return new Response("", {
					status: 501,
					headers: { "Content-Type": "text/plain" },
				});
			},
		},
	},
});
