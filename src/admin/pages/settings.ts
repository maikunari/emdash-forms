/**
 * emdash-forms — /settings admin page
 *
 * Per SPEC-v1.md §3.2: Standard-format plugins don't have
 * `admin.settingsSchema` auto-generation — we render settings manually
 * as a Block Kit form and persist to `ctx.kv` with the `settings:`
 * prefix. Pattern from @emdash-cms/plugin-webhook-notifier.
 *
 * Settings managed here:
 * - settings:defaultAdminEmail (string)
 * - settings:retentionDays (number, default 365, min 7, max 3650)
 * - settings:turnstileSiteKey (string, optional)
 * - settings:turnstileSecretKey (secret, optional)
 */

import type { PluginContext } from "emdash";
import type { BlockResponse } from "../router.js";

const KEY_DEFAULT_ADMIN_EMAIL = "settings:defaultAdminEmail";
const KEY_RETENTION_DAYS = "settings:retentionDays";
const KEY_TURNSTILE_SITE_KEY = "settings:turnstileSiteKey";
const KEY_TURNSTILE_SECRET_KEY = "settings:turnstileSecretKey";

const RETENTION_DEFAULT = 365;
const RETENTION_MIN = 7;
const RETENTION_MAX = 3650;

// ─── Page builder ────────────────────────────────────────────────────

export async function buildSettingsPage(ctx: PluginContext): Promise<BlockResponse> {
	const defaultAdminEmail = (await ctx.kv.get<string>(KEY_DEFAULT_ADMIN_EMAIL)) ?? "";
	const retentionDays = (await ctx.kv.get<number>(KEY_RETENTION_DAYS)) ?? RETENTION_DEFAULT;
	const turnstileSiteKey = (await ctx.kv.get<string>(KEY_TURNSTILE_SITE_KEY)) ?? "";
	const turnstileSecretKeyPresent =
		((await ctx.kv.get<string>(KEY_TURNSTILE_SECRET_KEY)) ?? "").length > 0;

	return {
		blocks: [
			{ type: "header", text: "Settings" },
			{
				type: "section",
				text: "Plugin-wide defaults. Per-form overrides live on each form's settings tab.",
			},
			{ type: "divider" },

			// ── Email ──────────────────────────────────────────────
			{ type: "header", text: "Email" },
			{
				type: "form",
				block_id: "settings-email",
				fields: [
					{
						type: "text_input",
						action_id: "defaultAdminEmail",
						label: "Default admin email",
						initial_value: defaultAdminEmail,
						placeholder: "admin@example.com",
						help_text:
							"Recipient when a form's notification settings don't specify one. Requires an email provider plugin (e.g. @emdash-cms/plugin-resend).",
					},
				],
				submit: { label: "Save email settings", action_id: "save_settings_email" },
			},
			{ type: "divider" },

			// ── Retention ──────────────────────────────────────────
			{ type: "header", text: "Submission retention" },
			{
				type: "form",
				block_id: "settings-retention",
				fields: [
					{
						type: "number_input",
						action_id: "retentionDays",
						label: "Retention (days)",
						initial_value: retentionDays,
						min: RETENTION_MIN,
						max: RETENTION_MAX,
						help_text:
							"Submissions older than this are deleted by the weekly cleanup cron. Min 7, max 3650 (~10 years). Set to match your data-retention policy.",
					},
				],
				submit: { label: "Save retention settings", action_id: "save_settings_retention" },
			},
			{ type: "divider" },

			// ── Turnstile ──────────────────────────────────────────
			{ type: "header", text: "Cloudflare Turnstile" },
			{
				type: "section",
				text: turnstileSecretKeyPresent
					? "Turnstile is configured. Forms with spamProtection = 'turnstile' will verify tokens server-side."
					: "Turnstile is optional. Paste your site and secret keys from [dash.cloudflare.com](https://dash.cloudflare.com/?to=/:account/turnstile) to enable it as a per-form spam protection option.",
			},
			{
				type: "form",
				block_id: "settings-turnstile",
				fields: [
					{
						type: "text_input",
						action_id: "turnstileSiteKey",
						label: "Turnstile site key",
						initial_value: turnstileSiteKey,
						placeholder: "0x4AAA...",
					},
					{
						type: "secret_input",
						action_id: "turnstileSecretKey",
						label: "Turnstile secret key",
						// secret_input has no initial_value; render a hint in help_text instead.
						help_text: turnstileSecretKeyPresent
							? "A secret key is currently set. Enter a new value to replace it, or leave blank to keep the existing one."
							: "Server-side secret used to verify tokens. Never exposed to the browser.",
					},
				],
				submit: { label: "Save Turnstile settings", action_id: "save_settings_turnstile" },
			},
		],
	};
}

// ─── Save handlers ───────────────────────────────────────────────────
//
// Split by form block so each Save button only touches the fields
// visually grouped with it. Prevents accidental overwrite — e.g.
// saving retention shouldn't clobber a stale email field.

/** Save handler for the "email" settings form. */
export async function saveEmailSettings(
	ctx: PluginContext,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const email = typeof values.defaultAdminEmail === "string" ? values.defaultAdminEmail.trim() : "";
	await ctx.kv.set(KEY_DEFAULT_ADMIN_EMAIL, email);
	ctx.log.info("[emdash-forms] settings:defaultAdminEmail saved");
	return {
		...(await buildSettingsPage(ctx)),
		toast: { message: "Email settings saved", type: "success" },
	};
}

/** Save handler for the "retention" settings form. */
export async function saveRetentionSettings(
	ctx: PluginContext,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const rawDays = values.retentionDays;
	let days: number;
	if (typeof rawDays === "number" && Number.isFinite(rawDays)) {
		days = Math.floor(rawDays);
	} else if (typeof rawDays === "string" && rawDays.trim().length > 0) {
		const parsed = Number.parseInt(rawDays, 10);
		days = Number.isFinite(parsed) ? parsed : RETENTION_DEFAULT;
	} else {
		days = RETENTION_DEFAULT;
	}

	// Clamp server-side — the number_input block enforces in the UI but
	// a crafted client could submit out-of-range values. Defense in depth.
	if (days < RETENTION_MIN) days = RETENTION_MIN;
	if (days > RETENTION_MAX) days = RETENTION_MAX;

	await ctx.kv.set(KEY_RETENTION_DAYS, days);
	ctx.log.info("[emdash-forms] settings:retentionDays saved", { days });
	return {
		...(await buildSettingsPage(ctx)),
		toast: { message: `Retention set to ${days} days`, type: "success" },
	};
}

/** Save handler for the "turnstile" settings form. */
export async function saveTurnstileSettings(
	ctx: PluginContext,
	values: Record<string, unknown>,
): Promise<BlockResponse> {
	const siteKey = typeof values.turnstileSiteKey === "string" ? values.turnstileSiteKey.trim() : "";
	await ctx.kv.set(KEY_TURNSTILE_SITE_KEY, siteKey);

	// secret_input semantics per Block Kit reference: empty string = keep
	// existing value. Only overwrite when the admin types something new.
	const secretKey = values.turnstileSecretKey;
	if (typeof secretKey === "string" && secretKey.trim().length > 0) {
		await ctx.kv.set(KEY_TURNSTILE_SECRET_KEY, secretKey.trim());
	}

	ctx.log.info("[emdash-forms] settings:turnstile* saved", {
		hasSiteKey: siteKey.length > 0,
		rotatedSecret: typeof secretKey === "string" && secretKey.trim().length > 0,
	});

	return {
		...(await buildSettingsPage(ctx)),
		toast: { message: "Turnstile settings saved", type: "success" },
	};
}
