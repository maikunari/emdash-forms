/**
 * emdash-forms — Public form submission handler
 *
 * Per SPEC-v1.md §4.1. POST to /_emdash/api/plugins/emdash-forms/submit
 * with a validated submitSchema body. End-to-end flow: form lookup,
 * honeypot + Turnstile spam check, required-field validation,
 * persist, increment counter, send notifications, return response.
 */

import type { RouteContext, StorageCollection } from "emdash";
import { HONEYPOT_FIELD, isHoneypotTriggered, stripHoneypot } from "../honeypot.js";
import { renderMergeTags, sendNotifications } from "../notifications.js";
import { verifyTurnstile } from "../turnstile.js";
import type { Form, FormField, Submission, SubmissionMeta } from "../types.js";
import type { SubmitInput } from "../validation.js";

// ─── Response shapes ─────────────────────────────────────────────────

interface SubmitSuccess {
	success: true;
	message: string;
	redirect?: string;
}

interface SubmitFailure {
	success: false;
	error: string;
	errors?: string[];
}

type SubmitResponse = SubmitSuccess | SubmitFailure;

// ─── Error helpers ───────────────────────────────────────────────────

/**
 * Throw a Response with a JSON error body. The emdash route runner
 * catches thrown Response values and delivers them verbatim; thrown
 * Error values become 500s. SPEC §10.
 */
function errorResponse(status: number, error: string, errors?: string[]): never {
	const body: SubmitFailure = errors ? { success: false, error, errors } : { success: false, error };
	throw new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ─── Form lookup ─────────────────────────────────────────────────────

/**
 * Look up an active form by slug. Returns undefined if not found or
 * paused. SPEC §4.1 step 1 + §4.2: paused forms appear as 404s to
 * public callers to avoid leaking existence.
 */
async function loadActiveFormBySlug(
	forms: StorageCollection<Form>,
	slug: string,
): Promise<{ id: string; data: Form } | undefined> {
	const result = await forms.query({
		where: { slug },
		limit: 1,
	});

	const hit = result.items[0];
	if (!hit) return undefined;
	if (hit.data.status !== "active") return undefined;
	return hit;
}

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Collect all fields from the form definition. Phase 1 forms are
 * single-step (`fields[]`); multi-step support (steps[].fields[]) is
 * a v1.1 item.
 */
function allFields(form: Form): FormField[] {
	return form.fields;
}

/**
 * Check that every required field has a non-empty value in the
 * submission data. Excludes conditionally-hidden fields (condition
 * evaluated false) — those are stripped client-side per SPEC §6.3 and
 * not expected in the payload. For server-side safety we don't try to
 * re-evaluate conditions here; missing conditional fields simply pass
 * validation regardless of `required`.
 */
function validateRequiredFields(
	fields: FormField[],
	data: Record<string, unknown>,
): string[] {
	const errors: string[] = [];
	for (const field of fields) {
		if (!field.required) continue;
		// Conditional fields: skip validation if a condition is declared.
		// Re-evaluating server-side would require mirroring the client
		// evaluator against possibly-stripped sibling values; punting
		// until there's a concrete attack scenario (see red-team notes).
		if (field.condition) continue;

		const value = data[field.id];
		const missing =
			value === undefined ||
			value === null ||
			value === "" ||
			(Array.isArray(value) && value.length === 0);
		if (missing) errors.push(`${field.label} is required`);
	}
	return errors;
}

// ─── Submission construction ─────────────────────────────────────────

function buildSubmissionMeta(request: Request): SubmissionMeta {
	const meta: SubmissionMeta = {};
	const headers = request.headers;

	const ip = headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	if (ip) meta.ip = ip;

	const userAgent = headers.get("user-agent");
	if (userAgent) meta.userAgent = userAgent;

	const referer = headers.get("referer");
	if (referer) meta.referer = referer;

	const country = headers.get("cf-ipcountry");
	if (country) meta.country = country;

	return meta;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function submitHandler(
	ctx: RouteContext<SubmitInput>,
): Promise<SubmitResponse> {
	const { input, request, requestMeta, storage, log } = ctx;

	// 1. Honeypot (pre-lookup so bots get the same silent success without
	//    burning a storage read). SPEC §4.1 step 2.
	if (isHoneypotTriggered(input as unknown as Record<string, unknown>)) {
		log.info("[emdash-forms] honeypot triggered — silent drop", {
			slug: input.formSlug,
			ip: requestMeta.ip ?? null,
		});
		// Mimic a successful submission so bots don't probe for failure
		// signals. We don't know the form's successMessage until lookup,
		// but a generic message is fine for this path.
		return { success: true, message: "Thanks!" };
	}

	// 2. Load form by slug.
	const forms = storage.forms as StorageCollection<Form>;
	const submissions = storage.submissions as StorageCollection<Submission>;

	const formHit = await loadActiveFormBySlug(forms, input.formSlug);
	if (!formHit) errorResponse(404, "Form not found");
	const { id: formId, data: form } = formHit;

	// 3. Turnstile (if enabled on this form).
	if (form.settings.spamProtection === "turnstile") {
		const secret = (await ctx.kv.get<string>("settings:turnstileSecretKey")) ?? "";
		const token = input["cf-turnstile-response"] ?? "";
		if (!secret) {
			log.warn("[emdash-forms] form requires turnstile but secret key not configured", {
				formId,
			});
			errorResponse(403, "Spam check failed. Please try again.");
		}
		if (!ctx.http) {
			log.error("[emdash-forms] network:fetch capability missing at turnstile verify");
			errorResponse(403, "Spam check failed. Please try again.");
		}
		const result = await verifyTurnstile(ctx.http, {
			secret,
			token,
			remoteip: requestMeta.ip ?? undefined,
		});
		if (!result.success) {
			log.info("[emdash-forms] turnstile verification failed", {
				formId,
				errorCodes: result.errorCodes,
				ip: requestMeta.ip ?? null,
			});
			errorResponse(403, "Spam check failed. Please try again.");
		}
	}

	// 4. Validate required fields.
	const cleanData = stripHoneypot({ ...input.data });
	// Turnstile token arrives at the top level, not under `data`, but
	// defensively strip it from data too in case a client duplicates it.
	delete cleanData["cf-turnstile-response"];

	const fields = allFields(form);
	const validationErrors = validateRequiredFields(fields, cleanData);
	if (validationErrors.length > 0) {
		errorResponse(400, "Validation failed", validationErrors);
	}

	// 5. Persist submission.
	const submissionId = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const submission: Submission = {
		formId,
		data: cleanData,
		meta: buildSubmissionMeta(request),
		status: "new",
		createdAt,
	};
	await submissions.put(submissionId, submission);

	// 6. Update form counters. Last-write-wins on submissionCount is
	//    intentional per SPEC §4.1 step 7 — small under-counts under
	//    concurrent submits are acceptable for v1, and accurate counts
	//    are always recomputable via submissions.count({formId}).
	const updatedForm: Form = {
		...form,
		submissionCount: form.submissionCount + 1,
		lastSubmissionAt: createdAt,
		updatedAt: createdAt,
	};
	await forms.put(formId, updatedForm);

	// 7. Send notifications (fire-and-forget re: errors; see module).
	const defaultAdminEmail = (await ctx.kv.get<string>("settings:defaultAdminEmail")) ?? undefined;
	await sendNotifications(ctx.email, log, {
		form: updatedForm,
		submission,
		defaultAdminEmail,
	});

	// 8. Build response — merge-tag the success message + redirectUrl.
	const message = renderMergeTags(form.settings.successMessage, cleanData);
	const redirect = form.settings.redirectUrl
		? renderMergeTags(form.settings.redirectUrl, cleanData)
		: undefined;

	return redirect ? { success: true, message, redirect } : { success: true, message };
}

// Exported for tests / future use.
export const _internal = {
	loadActiveFormBySlug,
	validateRequiredFields,
	buildSubmissionMeta,
	HONEYPOT_FIELD,
};
