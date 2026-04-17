// Smoke tests for the write path. Exercises plugin:install, submit,
// and cron handlers against an in-memory PluginContext mock. Imports
// the built sandbox-entry default export.
//
// Run:   pnpm build && node scripts/smoke-test.mjs
//
// Committed as a regression harness. v2.0 will migrate these to Vitest
// once the codebase is bigger; for now, plain Node + node:assert keeps
// the dev-deps surface tiny.

import { strict as assert } from "node:assert";

const mod = await import("../dist/sandbox-entry.mjs");
const plugin = mod.default;

// ─── In-memory PluginContext mock ────────────────────────────────────

function makeCollection() {
	const store = new Map();
	return {
		async get(id) {
			return store.has(id) ? store.get(id) : null;
		},
		async put(id, data) {
			store.set(id, data);
		},
		async delete(id) {
			return store.delete(id);
		},
		async exists(id) {
			return store.has(id);
		},
		async getMany(ids) {
			const out = new Map();
			for (const id of ids) if (store.has(id)) out.set(id, store.get(id));
			return out;
		},
		async putMany(items) {
			for (const { id, data } of items) store.set(id, data);
		},
		async deleteMany(ids) {
			let count = 0;
			for (const id of ids) if (store.delete(id)) count++;
			return count;
		},
		async query(opts = {}) {
			let items = Array.from(store.entries()).map(([id, data]) => ({ id, data }));
			if (opts.where) {
				items = items.filter(({ data }) => {
					for (const [key, cond] of Object.entries(opts.where)) {
						const val = data[key];
						if (cond && typeof cond === "object") {
							if ("lt" in cond && !(val < cond.lt)) return false;
							if ("lte" in cond && !(val <= cond.lte)) return false;
							if ("gt" in cond && !(val > cond.gt)) return false;
							if ("gte" in cond && !(val >= cond.gte)) return false;
							if ("in" in cond && !cond.in.includes(val)) return false;
							if ("startsWith" in cond && !String(val).startsWith(cond.startsWith)) return false;
						} else if (val !== cond) {
							return false;
						}
					}
					return true;
				});
			}
			if (opts.orderBy) {
				const [[key, dir]] = Object.entries(opts.orderBy);
				items.sort((a, b) => {
					const av = a.data[key];
					const bv = b.data[key];
					return dir === "desc" ? (av < bv ? 1 : av > bv ? -1 : 0) : av < bv ? -1 : av > bv ? 1 : 0;
				});
			}
			const limit = opts.limit ?? 50;
			const sliced = items.slice(0, limit);
			return { items: sliced, hasMore: items.length > limit, cursor: undefined };
		},
		async count(where) {
			return (await this.query({ where })).items.length;
		},
		_store: store,
	};
}

function makeKV() {
	const store = new Map();
	return {
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
		async set(key, value) {
			store.set(key, value);
		},
		async delete(key) {
			return store.delete(key);
		},
		async list(prefix = "") {
			return Array.from(store.entries())
				.filter(([k]) => k.startsWith(prefix))
				.map(([key, value]) => ({ key, value }));
		},
		_store: store,
	};
}

function makeLog(label) {
	const entries = [];
	const make = (level) => (msg, data) => {
		entries.push({ level, msg, data });
	};
	return {
		debug: make("debug"),
		info: make("info"),
		warn: make("warn"),
		error: make("error"),
		_entries: entries,
		_dump() {
			for (const e of entries) console.log(`  [${e.level}] ${e.msg}`, e.data ?? "");
		},
	};
}

function makeCron() {
	const tasks = [];
	return {
		async schedule(name, opts) {
			tasks.push({ name, schedule: opts.schedule });
		},
		async cancel(name) {
			const idx = tasks.findIndex((t) => t.name === name);
			if (idx >= 0) tasks.splice(idx, 1);
		},
		async list() {
			return tasks.map((t) => ({ ...t, nextRunAt: "", lastRunAt: null }));
		},
	};
}

function makeCtx({ emailSends = [], httpResponse = { success: true } } = {}) {
	const storage = {
		forms: makeCollection(),
		submissions: makeCollection(),
	};
	const kv = makeKV();
	const log = makeLog();
	const cron = makeCron();

	const email = {
		async send(message) {
			emailSends.push(message);
		},
	};

	const http = {
		async fetch(_url, _init) {
			return new Response(JSON.stringify(httpResponse), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	};

	return {
		plugin: { id: "emdash-forms", version: "1.0.0-alpha.0" },
		storage,
		kv,
		log,
		cron,
		email,
		http,
		site: { name: "test", url: "http://localhost", locale: "en" },
		url: (p) => `http://localhost${p}`,
		_sends: emailSends,
	};
}

function makeRouteCtx(ctx, input, headers = {}) {
	return {
		...ctx,
		input,
		request: new Request("http://localhost/_emdash/api/plugins/emdash-forms/submit", {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		}),
		requestMeta: {
			ip: headers["cf-connecting-ip"] ?? null,
			userAgent: headers["user-agent"] ?? null,
			referer: headers["referer"] ?? null,
			geo: null,
		},
	};
}

// ─── Scenarios ───────────────────────────────────────────────────────

const results = [];
async function scenario(name, fn) {
	try {
		await fn();
		results.push({ name, pass: true });
		console.log(`✓ ${name}`);
	} catch (err) {
		results.push({ name, pass: false, err });
		console.log(`✗ ${name}`);
		console.log(`  ${err?.message ?? err}`);
		if (err?.stack) console.log(err.stack.split("\n").slice(1, 4).join("\n"));
	}
}

// ── 1. plugin:install seeds 5 templates
await scenario("plugin:install seeds 5 templates with default settings", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	assert.equal(ctx.storage.forms._store.size, 5, "5 forms seeded");
	assert.equal(await ctx.kv.get("settings:retentionDays"), 365);
	assert.equal(await ctx.kv.get("settings:defaultAdminEmail"), "");
	const slugs = Array.from(ctx.storage.forms._store.values()).map((f) => f.slug).sort();
	assert.deepEqual(slugs, ["callback", "contact", "event-registration", "lead-capture", "survey"]);
});

// ── 2. plugin:install is idempotent
await scenario("plugin:install is idempotent on reinstall", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await plugin.hooks["plugin:install"].handler({}, ctx);
	assert.equal(ctx.storage.forms._store.size, 5, "still 5 after second install");
});

// ── 3. plugin:activate schedules cron
await scenario("plugin:activate schedules @weekly retention cron", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:activate"].handler({}, ctx);
	const tasks = await ctx.cron.list();
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].name, "retention-cleanup");
	assert.equal(tasks[0].schedule, "@weekly");
});

// ── 4. Happy-path submit
await scenario("submit: happy path stores submission + increments counter + sends admin email", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:defaultAdminEmail", "admin@example.com");

	const input = {
		formSlug: "contact",
		data: { name: "Jane", email: "jane@example.com", message: "hello" },
	};
	const routeCtx = makeRouteCtx(ctx, input, {
		"user-agent": "smoke-test/1",
		"cf-connecting-ip": "192.0.2.1",
	});
	const result = await plugin.routes.submit.handler(routeCtx);

	assert.equal(result.success, true);
	assert.equal(ctx.storage.submissions._store.size, 1);
	const submission = Array.from(ctx.storage.submissions._store.values())[0];
	assert.equal(submission.data.name, "Jane");
	assert.equal(submission.meta.ip, "192.0.2.1");
	assert.equal(submission.meta.userAgent, "smoke-test/1");

	const contactForm = Array.from(ctx.storage.forms._store.values()).find((f) => f.slug === "contact");
	assert.equal(contactForm.submissionCount, 1);
	assert.equal(ctx._sends.length, 1);
	assert.equal(ctx._sends[0].to, "admin@example.com");
	assert.ok(ctx._sends[0].subject.includes("Contact Form"));
});

// ── 5. Honeypot → silent success, no storage write
await scenario("submit: honeypot silently drops (no storage, 200 OK)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Bot", email: "bot@spam.test", message: "buy now" },
		_emdash_hp: "I am a bot",
	});
	const result = await plugin.routes.submit.handler(routeCtx);

	assert.equal(result.success, true);
	assert.equal(ctx.storage.submissions._store.size, 0);
	assert.equal(ctx._sends.length, 0);
});

// ── 6. Unknown slug → 404
await scenario("submit: unknown slug returns 404", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, { formSlug: "nope", data: {} });
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should have thrown");
	} catch (err) {
		assert.ok(err instanceof Response, "expected a Response throw");
		assert.equal(err.status, 404);
		const body = await err.json();
		assert.equal(body.error, "Form not found");
	}
});

// ── 7. Paused form → 404
await scenario("submit: paused form returns 404 (not leaked as existing)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const contact = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(contact[0], { ...contact[1], status: "paused" });

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "x", email: "x@x.com", message: "y" },
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should have thrown");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 404);
	}
});

// ── 8. Missing required field → 400
await scenario("submit: missing required field returns 400 with field errors", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane" }, // missing email + message
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should have thrown");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 400);
		const body = await err.json();
		assert.equal(body.success, false);
		assert.ok(Array.isArray(body.errors));
		assert.ok(body.errors.some((e) => e.includes("Email")));
		assert.ok(body.errors.some((e) => e.includes("Message")));
	}
});

// ── 9. Turnstile failure → 403
await scenario("submit: turnstile failure returns 403", async () => {
	const ctx = makeCtx({ httpResponse: { success: false, "error-codes": ["invalid-input-response"] } });
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:turnstileSecretKey", "test-secret");

	// Flip contact to turnstile mode
	const contact = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(contact[0], {
		...contact[1],
		settings: { ...contact[1].settings, spamProtection: "turnstile" },
	});

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "x", email: "x@x.com", message: "y" },
		"cf-turnstile-response": "bad-token",
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should have thrown");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 403);
	}
});

// ── 10. No email provider → notifications skipped silently
await scenario("submit: missing email provider doesn't fail submission", async () => {
	const ctx = makeCtx();
	ctx.email = undefined;
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: "hi" },
	});
	const result = await plugin.routes.submit.handler(routeCtx);
	assert.equal(result.success, true);
	assert.equal(ctx.storage.submissions._store.size, 1);
});

// ── 11. Confirmation email dispatched when form opts in
await scenario("submit: lead-capture confirmation email sent with merge tag", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:defaultAdminEmail", "admin@example.com");

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "lead-capture",
		data: { name: "Jane", email: "jane@example.com", interest: "demo" },
	});
	await plugin.routes.submit.handler(routeCtx);

	// Two emails: admin notification + submitter confirmation.
	assert.equal(ctx._sends.length, 2);
	const confirmation = ctx._sends.find((m) => m.to === "jane@example.com");
	assert.ok(confirmation, "confirmation to submitter");
	assert.ok(confirmation.subject.includes("Jane"), "merge tag expanded");
});

// ── 12. Merge tag injection attempt in admin subject template.
//    Verified behavior: known keys expand; unknown keys (valid identifiers)
//    expand to empty string; malformed tags like {{../secret}} are preserved
//    literally because they don't match the [a-zA-Z0-9_-]+ identifier regex.
//    Never eval, never lookup outside the submission data bag.
await scenario("submit: merge tags are injection-safe", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);

	const contact = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(contact[0], {
		...contact[1],
		settings: {
			...contact[1].settings,
			notifications: {
				...contact[1].settings.notifications,
				adminEmail: "admin@example.com",
				// {{name}} → "Jane" (valid key, expanded)
				// {{system}} → "" (valid identifier, missing key)
				// {{../secret}} → literal "{{../secret}}" (invalid identifier)
				adminSubject: "New from {{name}} ({{system}}) {{../secret}}",
			},
		},
	});

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: "hi" },
	});
	await plugin.routes.submit.handler(routeCtx);

	const subject = ctx._sends[0].subject;
	assert.equal(subject, "New from Jane () {{../secret}}");
});

// ── Cron retention
await scenario("cron retention-cleanup deletes old submissions", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:retentionDays", 1);

	// Seed an old and new submission.
	const contact = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.submissions.put("old-1", {
		formId: contact[0],
		data: {},
		meta: {},
		status: "new",
		createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
	});
	await ctx.storage.submissions.put("new-1", {
		formId: contact[0],
		data: {},
		meta: {},
		status: "new",
		createdAt: new Date().toISOString(),
	});

	await plugin.hooks.cron.handler(
		{ name: "retention-cleanup", scheduledAt: new Date().toISOString() },
		ctx,
	);

	assert.equal(ctx.storage.submissions._store.size, 1);
	assert.ok(ctx.storage.submissions._store.has("new-1"));
});

// ─── Summary ─────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
if (failed.length > 0) {
	console.log(`\nFailed:`);
	for (const f of failed) console.log(`  ✗ ${f.name}`);
	process.exit(1);
}
