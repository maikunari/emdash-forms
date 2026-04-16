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

export interface EmDashFormsOptions {
	/**
	 * Default spam protection for new forms.
	 * @default "honeypot"
	 */
	defaultSpamProtection?: "honeypot" | "turnstile";
}

export function emdashForms(options: EmDashFormsOptions = {}): PluginDescriptor {
	return {
		id: "emdash-forms",
		version: "1.0.0-alpha.0",
		format: "standard",
		entrypoint: "emdash-forms/sandbox",
		options,

		// SPEC §2 — Capabilities
		capabilities: ["email:send", "network:fetch"],
		allowedHosts: ["challenges.cloudflare.com"],

		// SPEC §3.1 — Storage collections
		storage: {
			forms: {
				indexes: ["status", "createdAt"],
				uniqueIndexes: ["slug"],
			},
			submissions: {
				indexes: [
					"formId",
					"status",
					"createdAt",
					["formId", "createdAt"],
					["formId", "status"],
				],
			},
		},

		// SPEC §5 — Admin pages (Block Kit; rendered by the `admin` route)
		adminPages: [
			{ path: "/", label: "Forms", icon: "list" },
			{ path: "/submissions", label: "Submissions", icon: "inbox" },
		],

		// SPEC §3.2 — Auto-generated settings page
		settingsSchema: {
			defaultAdminEmail: {
				type: "string",
				label: "Default admin email",
				description: "Recipient when a form doesn't specify one.",
			},
			retentionDays: {
				type: "number",
				label: "Submission retention (days)",
				default: 365,
				min: 7,
				max: 3650,
				description: "Submissions older than this are deleted weekly.",
			},
			turnstileSiteKey: {
				type: "string",
				label: "Turnstile site key",
				description:
					"Optional. Paste from dash.cloudflare.com to enable Turnstile spam protection.",
			},
			turnstileSecretKey: {
				type: "secret",
				label: "Turnstile secret key",
			},
		},
	};
}

export default emdashForms;
