/**
 * emdash-forms — Plugin descriptor factory
 *
 * Returned object is a PluginDescriptor per emdash 0.5.0. Runs at build time
 * in Vite when consumers import this from their astro.config.mjs — must be
 * side-effect-free. Runtime logic lives in ./sandbox-entry.ts.
 *
 * See SPEC-v1.md §2 (Architecture), §3.1 (Storage), §3.2 (Settings schema),
 * §4 (Routes), §5 (Admin UI).
 */

import type { PluginDescriptor } from "emdash";

export interface EmDashFormsOptions extends Record<string, unknown> {
	/**
	 * Default spam protection for new forms.
	 * @default "honeypot"
	 */
	defaultSpamProtection?: "honeypot" | "turnstile";
}

export function emdashForms(
	options: EmDashFormsOptions = {},
): PluginDescriptor<EmDashFormsOptions> {
	return {
		id: "emdash-forms",
		version: "1.0.0-alpha.0",
		format: "standard",
		entrypoint: "emdash-forms/sandbox",
		options,

		// SPEC §2 — Capabilities
		capabilities: ["email:send", "network:fetch"],
		allowedHosts: ["challenges.cloudflare.com"],

		// SPEC §3.1 — Storage collections.
		// Descriptor allows flat indexes only; composite indexes
		// (["formId", "createdAt"], ["formId", "status"]) are declared in
		// definePlugin() in sandbox-entry.ts. This matches the pattern in
		// @emdash-cms/plugin-forms (see its index.ts comment).
		storage: {
			forms: {
				indexes: ["status", "createdAt"],
				uniqueIndexes: ["slug"],
			},
			submissions: {
				indexes: ["formId", "status", "createdAt"],
			},
		},

		// SPEC §5 — Admin pages (Block Kit; rendered by the `admin` route).
		// The /settings page is handled via the admin dispatcher, not via an
		// auto-generated settingsSchema (see SPEC-v1 finding in the Phase 0 PR).
		adminPages: [
			{ path: "/", label: "Forms", icon: "list" },
			{ path: "/submissions", label: "Submissions", icon: "inbox" },
			{ path: "/settings", label: "Settings", icon: "settings" },
		],

		// NOTE: SPEC-v1 §3.2 specifies `admin.settingsSchema` for auto-generated
		// settings UI, but that lives on Native `PluginDefinition.admin`, not
		// on Standard `PluginDescriptor`. Standard plugins render their settings
		// page manually via the admin Block Kit route (pattern from
		// webhook-notifier). Settings are still persisted to `ctx.kv` with
		// `settings:` prefix per SPEC §3.2. Flagged in the Phase 0 PR for
		// spec revision in v1.1.
	};
}

// NOTE: Named export only, no `export default`. The `emdash plugin bundle`
// CLI has two code paths: a default-factory path that returns the
// descriptor as-is (breaks manifest extraction because hooks/routes aren't
// normalized) and a named-factory path that probes the backend entry and
// builds a full ResolvedPlugin shape. Matching the @emdash-cms/plugin-
// sandboxed-test reference which only names the factory.
