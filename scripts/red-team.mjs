// Red team pass for the write path — adversarial submit input per
// SPEC §13.2. Exercises honeypot, Turnstile, merge tags, prototype
// pollution, XSS, SQL-ish strings, and retention edge cases.
//
// Run:   pnpm build && node scripts/red-team.mjs
//
// Committed as a regression harness. Each phase extends this with new
// scenarios; Phase 2 adds privilege escalation + CSV formula injection.

import { strict as assert } from "node:assert";

const mod = await import("../dist/sandbox-entry.mjs");
const plugin = mod.default;

// ─── Shared mock helpers (copied from smoke-test.mjs) ────────────────

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
						} else if (val !== cond) return false;
					}
					return true;
				});
			}
			const limit = opts.limit ?? 50;
			const offset = opts.cursor ? Number.parseInt(opts.cursor, 10) || 0 : 0;
			const sliced = items.slice(offset, offset + limit);
			const hasMore = items.length > offset + limit;
			return {
				items: sliced,
				hasMore,
				cursor: hasMore ? String(offset + limit) : undefined,
			};
		},
		async count() {
			return store.size;
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

function makeLog() {
	const entries = [];
	const make = (level) => (msg, data) => entries.push({ level, msg, data });
	return {
		debug: make("debug"),
		info: make("info"),
		warn: make("warn"),
		error: make("error"),
		_entries: entries,
	};
}

function makeCtx({ httpResponse = { success: true } } = {}) {
	const sends = [];
	return {
		plugin: { id: "emdash-forms", version: "1.0.0-alpha.0" },
		storage: { forms: makeCollection(), submissions: makeCollection() },
		kv: makeKV(),
		log: makeLog(),
		cron: { schedule: async () => {}, cancel: async () => {}, list: async () => [] },
		email: {
			async send(m) {
				sends.push(m);
			},
		},
		http: {
			async fetch() {
				return new Response(JSON.stringify(httpResponse), { status: 200 });
			},
		},
		site: { name: "test", url: "http://localhost", locale: "en" },
		url: (p) => `http://localhost${p}`,
		_sends: sends,
	};
}

function makeRouteCtx(ctx, input, headers = {}) {
	return {
		...ctx,
		input,
		request: new Request("http://localhost/submit", {
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

const findings = {
	blockers: [],
	nonBlockers: [],
	confirmed_safe: [],
};

async function safe(label, fn) {
	try {
		await fn();
		findings.confirmed_safe.push(label);
		console.log(`✓ safe — ${label}`);
	} catch (err) {
		findings.blockers.push({ label, err: err?.message ?? String(err) });
		console.log(`✗ BLOCKER — ${label}`);
		console.log(`  ${err?.message ?? err}`);
	}
}

async function nonBlocker(label, fn) {
	try {
		await fn();
		findings.confirmed_safe.push(label);
		console.log(`✓ safe — ${label}`);
	} catch (err) {
		findings.nonBlockers.push({ label, err: err?.message ?? String(err) });
		console.log(`! non-blocker — ${label}`);
		console.log(`  ${err?.message ?? err}`);
	}
}

// ── Malformed / unexpected input shapes ──────────────────────────────

await safe("Extra unknown fields in data are stored as-is (admin can see, no eval)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:defaultAdminEmail", "admin@x.com");
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: {
			name: "Jane",
			email: "j@e.com",
			message: "hi",
			__proto__: { pwned: true }, // prototype pollution attempt
			constructor: "bad",
			admin_notes: "attacker-controlled",
		},
	});
	const res = await plugin.routes.submit.handler(routeCtx);
	assert.equal(res.success, true);
	assert.equal(ctx.storage.submissions._store.size, 1);
	// Prototype pollution didn't leak.
	assert.equal({}.pwned, undefined, "prototype not polluted");
});

await safe("SQL-injection-like string in slug returns clean 404", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "'; DROP TABLE forms; --",
		data: { anything: "x" },
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should 404");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 404);
	}
});

await safe("XSS payload in field value stored verbatim, escaped in default HTML email", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:defaultAdminEmail", "admin@x.com");

	const xss = "<script>alert('xss')</script>";
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: xss, email: "j@e.com", message: "hi" },
	});
	await plugin.routes.submit.handler(routeCtx);

	// Stored verbatim (preserves evidence in admin review)
	const stored = Array.from(ctx.storage.submissions._store.values())[0];
	assert.equal(stored.data.name, xss);

	// But HTML-escaped in the email body (no raw <script> tag)
	const adminEmail = ctx._sends[0];
	assert.ok(adminEmail.html.includes("&lt;script&gt;"), "script tag escaped");
	assert.ok(!adminEmail.html.includes("<script>alert"), "no raw script tag");
});

await safe("Oversized payload (1 MB body in text field) — no crash, Zod size limits apply if configured", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const bigString = "A".repeat(1024 * 1024); // 1MB
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: bigString },
	});
	// Should handle without crashing. Actual byte-size rejection is a
	// v1.1 rate-limiting concern.
	const res = await plugin.routes.submit.handler(routeCtx);
	assert.equal(res.success, true);
});

// ── Turnstile token tampering ────────────────────────────────────────

await safe("Missing Turnstile token when form requires it → 403", async () => {
	const ctx = makeCtx({ httpResponse: { success: false, "error-codes": ["missing-input-response"] } });
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:turnstileSecretKey", "secret");
	const [id, form] = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(id, {
		...form,
		settings: { ...form.settings, spamProtection: "turnstile" },
	});

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "x", email: "x@y.com", message: "z" },
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should 403");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 403);
	}
});

await safe("Turnstile enabled but no secret key configured → 403 (fail closed)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	// No settings:turnstileSecretKey written
	const [id, form] = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(id, {
		...form,
		settings: { ...form.settings, spamProtection: "turnstile" },
	});

	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "x", email: "x@y.com", message: "z" },
		"cf-turnstile-response": "any-token",
	});
	try {
		await plugin.routes.submit.handler(routeCtx);
		throw new Error("should 403");
	} catch (err) {
		assert.ok(err instanceof Response);
		assert.equal(err.status, 403);
	}
});

// ── Honeypot edge cases ──────────────────────────────────────────────

await safe("Honeypot with whitespace-only string → silent drop", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Bot", email: "b@b.com", message: "spam" },
		_emdash_hp: "   ", // just whitespace
	});
	const res = await plugin.routes.submit.handler(routeCtx);
	assert.equal(res.success, true);
	assert.equal(ctx.storage.submissions._store.size, 0, "no submission stored");
});

await safe("Honeypot empty string → treated as untriggered (false positive protection)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: "hi" },
		_emdash_hp: "",
	});
	const res = await plugin.routes.submit.handler(routeCtx);
	assert.equal(res.success, true);
	assert.equal(ctx.storage.submissions._store.size, 1, "legitimate submission stored");
});

// ── Concurrent submits — counter behavior ────────────────────────────

await nonBlocker("Concurrent submits may under-count submissionCount (documented: last-write-wins)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:defaultAdminEmail", "admin@x.com");

	const submit = () =>
		plugin.routes.submit.handler(
			makeRouteCtx(ctx, {
				formSlug: "contact",
				data: { name: "X", email: "x@y.com", message: "m" },
			}),
		);

	await Promise.all([submit(), submit(), submit(), submit(), submit()]);

	const contact = Array.from(ctx.storage.forms._store.values()).find((f) => f.slug === "contact");
	// In-memory mock is synchronous-ish so counter will be 5; the real
	// last-write-wins semantics only show up against a real DB. We
	// verify the field exists and is a number; drift documented in SPEC.
	assert.equal(ctx.storage.submissions._store.size, 5, "all 5 submissions stored");
	assert.ok(typeof contact.submissionCount === "number");
	// Accept either 5 (ordered) or <5 (last-write-wins dropping some).
});

// ── No email provider ────────────────────────────────────────────────

await safe("Submit succeeds when ctx.email is undefined (no provider)", async () => {
	const ctx = makeCtx();
	ctx.email = undefined;
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: "hi" },
	});
	const res = await plugin.routes.submit.handler(routeCtx);
	assert.equal(res.success, true);
	// Submission persisted even though notification silently skipped.
	assert.equal(ctx.storage.submissions._store.size, 1);
});

// ── Merge tag injection variants ─────────────────────────────────────

await safe("Merge tag {{constructor.constructor('...')}} cannot execute (no eval)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const [id, form] = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(id, {
		...form,
		settings: {
			...form.settings,
			notifications: {
				...form.settings.notifications,
				adminEmail: "admin@x.com",
				adminSubject: "{{constructor.constructor('return 1+1')()}}",
			},
		},
	});
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "x", email: "x@y.com", message: "z" },
	});
	await plugin.routes.submit.handler(routeCtx);
	// Invalid identifier → preserved literally; no eval.
	assert.equal(ctx._sends[0].subject, "{{constructor.constructor('return 1+1')()}}");
});

await safe("Merge tag HTML injection in custom body is escaped", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const [id, form] = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	await ctx.storage.forms.put(id, {
		...form,
		settings: {
			...form.settings,
			notifications: {
				...form.settings.notifications,
				adminEmail: "admin@x.com",
				adminBody: "<p>From: {{name}}</p>",
			},
		},
	});
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: {
			name: "<img src=x onerror=alert(1)>",
			email: "j@e.com",
			message: "hi",
		},
	});
	await plugin.routes.submit.handler(routeCtx);
	const html = ctx._sends[0].html;
	assert.ok(html.includes("&lt;img"), "img tag escaped in custom body");
	assert.ok(!html.includes("<img src=x"), "no raw img tag");
});

// ── Redirect merge tag — open redirect risk ──────────────────────────

await nonBlocker("redirectUrl merge tag expansion — submitter-controlled redirect?", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const [id, form] = Array.from(ctx.storage.forms._store.entries()).find(([, f]) => f.slug === "contact");
	// Admin configures a legitimate thank-you redirect with a tracking tag.
	await ctx.storage.forms.put(id, {
		...form,
		settings: { ...form.settings, redirectUrl: "https://example.com/thanks?ref={{source}}" },
	});
	const routeCtx = makeRouteCtx(ctx, {
		formSlug: "contact",
		data: { name: "Jane", email: "j@e.com", message: "hi", source: "evil.com#" },
	});
	const res = await plugin.routes.submit.handler(routeCtx);
	// The merge value is interpolated into the URL verbatim. An attacker
	// could inject `evil.com` if the admin uses submitter-controlled
	// fields in redirectUrl. Mitigation is admin-responsibility: don't
	// interpolate submitter data into redirectUrl. Documenting as a
	// known-limitation non-blocker; v1.1 could add URL validation.
	assert.equal(res.redirect, "https://example.com/thanks?ref=evil.com#");
	throw new Error(
		"open-redirect surface: redirectUrl expands {{submitter_fields}} without URL-encoding. Admin must avoid interpolating submitter data into redirectUrl.",
	);
});

// ── Retention cleanup boundary ───────────────────────────────────────

await safe("retentionDays = 0 is clamped (no cleanup, no delete-all footgun)", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await ctx.kv.set("settings:retentionDays", 0);
	await ctx.storage.submissions.put("s1", {
		formId: "any",
		data: {},
		meta: {},
		status: "new",
		createdAt: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString(),
	});
	await plugin.hooks.cron.handler(
		{ name: "retention-cleanup", scheduledAt: new Date().toISOString() },
		ctx,
	);
	assert.equal(ctx.storage.submissions._store.size, 1, "no deletion when retentionDays <= 0");
});

// ═══ Phase 2 — Admin read path ═══════════════════════════════════════

async function admin(ctx, interaction) {
	return plugin.routes.admin.handler({
		...ctx,
		input: interaction,
		request: new Request("http://localhost/admin", { method: "POST" }),
		requestMeta: { ip: null, userAgent: null, referer: null, geo: null },
	});
}

// ── Privilege-escalation surface check ──────────────────────────────

await safe("admin route is NOT declared public: true", async () => {
	// Platform auth middleware gates non-public routes. The most we can
	// verify in a mock is that our route spec doesn't accidentally have
	// public: true — the runtime middleware itself is out of scope.
	assert.equal(plugin.routes.admin.public, undefined, "admin route must not be public");
	assert.equal(plugin.routes["export/csv"].public, undefined, "export/csv must not be public");
});

await safe("submit + definition are declared public: true (by design)", async () => {
	// Counterfoil: make sure the expected public routes ARE public, so
	// a future refactor that accidentally gates them becomes visible.
	assert.equal(plugin.routes.submit.public, true);
	assert.equal(plugin.routes.definition.public, true);
});

// ── CSV formula injection coverage ──────────────────────────────────

await safe("CSV export guards =, +, -, @, tab, and CR prefixes", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const contactId = Array.from(ctx.storage.forms._store.entries()).find(
		([, f]) => f.slug === "contact",
	)[0];

	const payloads = {
		"s-eq": "=SUM(A1)",
		"s-plus": "+cmd|calc",
		"s-minus": "-9*cmd",
		"s-at": "@SUM(A)",
		"s-tab": "\tSUM(A)",
		"s-cr": "\rbad",
	};
	for (const [id, msg] of Object.entries(payloads)) {
		await ctx.storage.submissions.put(id, {
			formId: contactId,
			data: { name: msg, email: "a@b.com", message: "x" },
			meta: {},
			status: "new",
			createdAt: new Date().toISOString(),
		});
	}

	const res = await plugin.routes["export/csv"].handler({
		...ctx,
		input: { formId: contactId },
		request: new Request("http://localhost/export"),
		requestMeta: { ip: null, userAgent: null, referer: null, geo: null },
	});

	// Every trigger char should appear with a leading ' prefix in the CSV.
	// RFC 4180 wraps cells containing , " \r \n in quotes so matches
	// may be inside "…" wrappers.
	assert.ok(res.data.includes("'=SUM(A1)"), "= guard");
	assert.ok(res.data.includes("'+cmd|calc"), "+ guard");
	assert.ok(res.data.includes("'-9*cmd"), "- guard");
	assert.ok(res.data.includes("'@SUM(A)"), "@ guard");
	assert.ok(res.data.includes("'\tSUM(A)"), "tab guard");
	assert.ok(res.data.includes("'\r"), "CR guard");
});

// ── Pagination cursor tampering ─────────────────────────────────────

await safe("Pagination: malformed cursor renders error banner, doesn't crash", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);

	// Override query to throw when it sees a malformed cursor — simulates
	// real storage that rejects alien cursor strings.
	const submissions = ctx.storage.submissions;
	const origQuery = submissions.query.bind(submissions);
	submissions.query = async (opts = {}) => {
		if (opts.cursor === "TAMPERED") {
			throw new Error("invalid cursor");
		}
		return origQuery(opts);
	};

	const res = await admin(ctx, {
		type: "block_action",
		action_id: "submissions:page",
		value: "TAMPERED",
	});

	// Expect an error banner + Reload button, not a thrown error.
	const banner = res.blocks.find((b) => b.type === "banner");
	assert.ok(banner, "error banner rendered");
	assert.equal(banner.variant, "error");
});

// ── Large result set stress test ────────────────────────────────────

await safe("Large result set (10k submissions): forms list renders under 500ms", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const contactId = Array.from(ctx.storage.forms._store.entries()).find(
		([, f]) => f.slug === "contact",
	)[0];

	// Seed 10k submissions synthetically.
	for (let i = 0; i < 10_000; i++) {
		await ctx.storage.submissions.put(`s-${i}`, {
			formId: contactId,
			data: { name: `n${i}`, email: `n${i}@x.com`, message: "m" },
			meta: {},
			status: i % 3 === 0 ? "new" : "read",
			createdAt: new Date(Date.now() - i * 1000).toISOString(),
		});
	}

	const start = Date.now();
	const res = await admin(ctx, { type: "page_load", page: "/" });
	const elapsed = Date.now() - start;

	assert.ok(Array.isArray(res.blocks));
	const stats = res.blocks.find((b) => b.type === "stats");
	const subs = stats.stats.find((s) => s.label === "Submissions");
	assert.equal(subs.value, "10000");

	// In the in-memory mock, 10k is trivial; real D1 should also be
	// fast for count() on a single-field index. 500ms is a soft ceiling
	// to catch accidental O(n²) regressions.
	assert.ok(elapsed < 500, `forms list took ${elapsed}ms (target < 500ms)`);
});

await safe("Large result set: paginated submissions page renders 25 rows in < 500ms", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const contactId = Array.from(ctx.storage.forms._store.entries()).find(
		([, f]) => f.slug === "contact",
	)[0];

	for (let i = 0; i < 10_000; i++) {
		await ctx.storage.submissions.put(`s-${i}`, {
			formId: contactId,
			data: { name: `n${i}`, email: `n${i}@x.com`, message: "m" },
			meta: {},
			status: "new",
			createdAt: new Date(Date.now() - i * 1000).toISOString(),
		});
	}

	const start = Date.now();
	const res = await admin(ctx, { type: "page_load", page: "/submissions" });
	const elapsed = Date.now() - start;

	const table = res.blocks.find((b) => b.type === "table");
	assert.equal(table.rows.length, 25, "paginated to PAGE_SIZE");
	assert.ok(elapsed < 500, `submissions page took ${elapsed}ms (target < 500ms)`);
});

// ── XSS in field values rendered in admin UI ────────────────────────

await safe("XSS payload in submission data is preserved verbatim (admin renderer escapes)", async () => {
	// Platform concern: the Block Kit renderer is supposed to HTML-
	// escape text in sections/tables/fields. We can't test the renderer
	// here, but we CAN verify we don't pre-sanitize server-side — that
	// would double-encode and also mask attacks during admin review.
	// Store verbatim, render escaped at display time.
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);

	const xss = "<img src=x onerror=alert(1)>";
	await plugin.routes.submit.handler(
		makeRouteCtx(ctx, {
			formSlug: "contact",
			data: { name: xss, email: "a@b.com", message: "m" },
		}),
	);
	const subId = Array.from(ctx.storage.submissions._store.keys())[0];

	const res = await admin(ctx, {
		type: "page_load",
		page: `/submissions/${subId}`,
	});

	const fieldsBlock = res.blocks
		.filter((b) => b.type === "fields")
		.find((b) => b.fields.some((f) => f.value === xss));
	assert.ok(fieldsBlock, "raw value preserved in server response");
});

// ── Delete-form cascade correctness ─────────────────────────────────

await safe("Delete form cascades to ALL submissions, even paginated ones", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	const contactId = Array.from(ctx.storage.forms._store.entries()).find(
		([, f]) => f.slug === "contact",
	)[0];

	// Seed > CASCADE_BATCH_SIZE (500) to exercise pagination in the cascade.
	for (let i = 0; i < 750; i++) {
		await ctx.storage.submissions.put(`c-${i}`, {
			formId: contactId,
			data: {},
			meta: {},
			status: "new",
			createdAt: new Date().toISOString(),
		});
	}

	await admin(ctx, {
		type: "block_action",
		action_id: "form:menu:anything",
		value: `form:delete:${contactId}`,
	});

	// None of the 750 contact submissions remain.
	for (const [id, data] of ctx.storage.submissions._store) {
		if (data.formId === contactId) {
			throw new Error(`submission ${id} survived the cascade`);
		}
	}
});

// ── Double-delete idempotency ───────────────────────────────────────

await safe("Double-delete of same submission is idempotent", async () => {
	const ctx = makeCtx();
	await plugin.hooks["plugin:install"].handler({}, ctx);
	await plugin.routes.submit.handler(
		makeRouteCtx(ctx, {
			formSlug: "contact",
			data: { name: "J", email: "a@b.com", message: "m" },
		}),
	);
	const subId = Array.from(ctx.storage.submissions._store.keys())[0];

	await admin(ctx, {
		type: "block_action",
		action_id: `submission:delete:${subId}`,
	});
	const res = await admin(ctx, {
		type: "block_action",
		action_id: `submission:delete:${subId}`,
	});
	assert.equal(res.toast.type, "info");
});

// ─── Summary ─────────────────────────────────────────────────────────

console.log(`\n─── Red team summary ───`);
console.log(`Blockers:     ${findings.blockers.length}`);
console.log(`Non-blockers: ${findings.nonBlockers.length}`);
console.log(`Confirmed safe: ${findings.confirmed_safe.length}`);

if (findings.blockers.length > 0) {
	console.log(`\nBlockers to fix before merge:`);
	for (const b of findings.blockers) console.log(`  - ${b.label}: ${b.err}`);
	process.exit(1);
}
if (findings.nonBlockers.length > 0) {
	console.log(`\nNon-blockers (file as issues):`);
	for (const n of findings.nonBlockers) console.log(`  - ${n.label}\n    ${n.err}`);
}
