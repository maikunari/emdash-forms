/**
 * emdash-forms — Lifecycle hook handlers
 *
 * Per SPEC-v1.md:
 *  - plugin:install → seed 5 templates + persist default settings (§3.2, §9, migration 1.3, 1.5)
 *  - plugin:activate → schedule @weekly retention cleanup cron (migration 1.6)
 *  - cron → retention cleanup (migration 1.7, SPEC §3.2 retentionDays)
 */

import type { PluginContext, StorageCollection } from "emdash";
import { TEMPLATES } from "../templates/index.js";
import type { Form, FormSettings, FormTemplate } from "../types.js";

/**
 * Event shape for the `cron` hook. Not re-exported by name from emdash
 * (only via PluginHooks internally), so we mirror the interface here.
 */
interface CronEvent {
	name: string;
	data?: Record<string, unknown>;
	scheduledAt: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_ADMIN_EMAIL = "";
const DEFAULT_TURNSTILE_SITE_KEY = "";
const DEFAULT_TURNSTILE_SECRET_KEY = "";

const CRON_RETENTION_CLEANUP = "retention-cleanup";
const CRON_SCHEDULE_WEEKLY = "@weekly";

// ─── Template → Form materialization ─────────────────────────────────

/**
 * Build a concrete Form from a template. Called during plugin:install
 * and (in Phase 3) the "New from template" admin flow.
 */
export function formFromTemplate(template: FormTemplate): {
	id: string;
	data: Form;
} {
	const now = new Date().toISOString();
	const settings: FormSettings = {
		submitLabel: template.defaultSettings.submitLabel ?? "Submit",
		successMessage:
			template.defaultSettings.successMessage ??
			"Thanks! Your submission has been received.",
		redirectUrl: template.defaultSettings.redirectUrl,
		spamProtection: template.defaultSettings.spamProtection ?? "honeypot",
		notifications: {
			notifyAdmin: template.defaultSettings.notifications?.notifyAdmin ?? true,
			adminEmail: template.defaultSettings.notifications?.adminEmail,
			adminSubject: template.defaultSettings.notifications?.adminSubject,
			adminBody: template.defaultSettings.notifications?.adminBody,
			confirmationEmail: template.defaultSettings.notifications?.confirmationEmail ?? false,
			confirmationSubject: template.defaultSettings.notifications?.confirmationSubject,
			confirmationBody: template.defaultSettings.notifications?.confirmationBody,
		},
	};

	return {
		id: crypto.randomUUID(),
		data: {
			title: template.title,
			slug: template.id,
			fields: [...template.fields],
			settings,
			status: "active",
			submissionCount: 0,
			lastSubmissionAt: null,
			createdAt: now,
			updatedAt: now,
		},
	};
}

// ─── plugin:install ──────────────────────────────────────────────────

/**
 * Seed the 5 templates + default settings. Idempotent — if a slug is
 * already present, skip it (installation is supposed to be one-shot,
 * but this defends against double-invoke scenarios during reinstalls).
 */
export async function handleInstall(ctx: PluginContext): Promise<void> {
	ctx.log.info("[emdash-forms] plugin:install — seeding templates + defaults");

	// Seed settings with defaults. Uses ?? so existing values survive
	// (again, belt-and-braces for reinstall semantics).
	if ((await ctx.kv.get<number>("settings:retentionDays")) == null) {
		await ctx.kv.set("settings:retentionDays", DEFAULT_RETENTION_DAYS);
	}
	if ((await ctx.kv.get<string>("settings:defaultAdminEmail")) == null) {
		await ctx.kv.set("settings:defaultAdminEmail", DEFAULT_ADMIN_EMAIL);
	}
	if ((await ctx.kv.get<string>("settings:turnstileSiteKey")) == null) {
		await ctx.kv.set("settings:turnstileSiteKey", DEFAULT_TURNSTILE_SITE_KEY);
	}
	if ((await ctx.kv.get<string>("settings:turnstileSecretKey")) == null) {
		await ctx.kv.set("settings:turnstileSecretKey", DEFAULT_TURNSTILE_SECRET_KEY);
	}

	// Seed templates. Look up existing slugs first so we skip rather
	// than duplicate on reinstall.
	const forms = ctx.storage.forms as StorageCollection<Form>;

	for (const template of TEMPLATES) {
		const existing = await forms.query({ where: { slug: template.id }, limit: 1 });
		if (existing.items.length > 0) {
			ctx.log.info("[emdash-forms] template already present, skipping", { slug: template.id });
			continue;
		}

		const { id, data } = formFromTemplate(template);
		await forms.put(id, data);
		ctx.log.info("[emdash-forms] template seeded", { slug: template.id, id });
	}
}

// ─── plugin:activate ─────────────────────────────────────────────────

/**
 * Schedule the weekly retention-cleanup cron. Idempotent via
 * ctx.cron.list().
 */
export async function handleActivate(ctx: PluginContext): Promise<void> {
	if (!ctx.cron) {
		ctx.log.warn("[emdash-forms] plugin:activate — ctx.cron unavailable; retention disabled");
		return;
	}

	const existing = await ctx.cron.list();
	if (existing.some((t) => t.name === CRON_RETENTION_CLEANUP)) {
		ctx.log.info("[emdash-forms] retention cron already scheduled");
		return;
	}

	await ctx.cron.schedule(CRON_RETENTION_CLEANUP, { schedule: CRON_SCHEDULE_WEEKLY });
	ctx.log.info("[emdash-forms] retention cron scheduled", { name: CRON_RETENTION_CLEANUP });
}

// ─── cron handler ────────────────────────────────────────────────────

/** Max submissions deleted per cron tick. Prevents runaway cron
 *  invocations on freshly-configured-short-retention sites. */
const RETENTION_BATCH_LIMIT = 1000;

/**
 * Delete submissions older than `settings:retentionDays`. Runs weekly.
 *
 * Query via the `createdAt` single-field index with a lt cutoff; batch
 * via deleteMany. Caps the per-run delete count so one long-delayed
 * cleanup tick doesn't block the scheduler.
 */
export async function handleRetentionCleanup(ctx: PluginContext): Promise<void> {
	const retentionDays =
		(await ctx.kv.get<number>("settings:retentionDays")) ?? DEFAULT_RETENTION_DAYS;

	if (retentionDays <= 0) {
		ctx.log.info("[emdash-forms] retentionDays <= 0, cleanup skipped");
		return;
	}

	const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	const cutoffIso = new Date(cutoffMs).toISOString();

	const submissions = ctx.storage.submissions as StorageCollection<unknown>;
	let deleted = 0;
	let cursor: string | undefined;

	do {
		const page = await submissions.query({
			where: { createdAt: { lt: cutoffIso } },
			limit: 100,
			cursor,
		});

		if (page.items.length === 0) break;

		const ids = page.items.map((item) => item.id);
		const count = await submissions.deleteMany(ids);
		deleted += count;

		if (deleted >= RETENTION_BATCH_LIMIT) {
			ctx.log.warn("[emdash-forms] retention cleanup hit batch cap; remainder next run", {
				deleted,
				cap: RETENTION_BATCH_LIMIT,
			});
			break;
		}

		cursor = page.cursor;
	} while (cursor);

	ctx.log.info("[emdash-forms] retention cleanup complete", {
		retentionDays,
		cutoff: cutoffIso,
		deleted,
	});
}

/** Dispatch on event.name so multiple cron tasks can share one hook. */
export async function handleCron(event: CronEvent, ctx: PluginContext): Promise<void> {
	switch (event.name) {
		case CRON_RETENTION_CLEANUP:
			await handleRetentionCleanup(ctx);
			return;
		default:
			ctx.log.warn("[emdash-forms] cron — unknown task", { name: event.name });
	}
}
