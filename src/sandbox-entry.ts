/**
 * emdash-forms — definePlugin runtime entry
 *
 * Runs at request time on the deployed server. Works in both trusted
 * (in-process) and sandboxed (V8 isolate) modes per SPEC-v1.md §2.
 *
 * Phase 1: write path implemented.
 * Phase 2: admin read path (routing extracted to src/admin/router.ts).
 * Phase 3: form builder / field editor bodies.
 * Phase 4: public `definition` route + Astro component.
 */

import { definePlugin } from "emdash";
import type { PluginContext, RouteContext } from "emdash";

import { dispatchAdminInteraction } from "./admin/router.js";
import { exportCsvHandler } from "./handlers/export-csv.js";
import { handleActivate, handleCron, handleInstall } from "./handlers/lifecycle.js";
import { submitHandler } from "./handlers/submit.js";
import {
	definitionSchema,
	exportCsvSchema,
	interactionSchema,
	submitSchema,
} from "./validation.js";
import type { ExportCsvInput, SubmitInput } from "./validation.js";

// NOTE: SPEC-v1 §3.1 specifies composite indexes (["formId", "createdAt"],
// ["formId", "status"]) on the submissions collection. The emdash 0.5.0
// TypeScript surface does not accept composite indexes on Standard-format
// plugins — PluginDescriptor's StorageCollectionDeclaration.indexes is
// `string[]`, and StandardPluginDefinition has no storage field at all.
// Composite indexes are a Native-only feature via PluginDefinition<TStorage>.
// Flat indexes in the descriptor; filter-then-order for per-form queries.

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
				const interaction =
					typeof ctx.input === "object" && ctx.input !== null ? ctx.input : {};
				return dispatchAdminInteraction(ctx, interaction as Record<string, unknown>);
			},
		},

		/** SPEC §4.4 — GET export/csv (auth required). */
		"export/csv": {
			input: exportCsvSchema,
			handler: async (ctx: RouteContext<ExportCsvInput>) => {
				return exportCsvHandler(ctx);
			},
		},
	},
});
