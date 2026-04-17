/**
 * emdash-forms — Cloudflare Turnstile verification
 *
 * Per SPEC-v1.md §8.2. Server-side verify of a Turnstile token against
 * challenges.cloudflare.com. Requires `network:fetch` capability and
 * `challenges.cloudflare.com` in `allowedHosts` (both declared in the
 * descriptor).
 */

import type { HttpAccess } from "emdash";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileVerifyResponse {
	success: boolean;
	/** Error codes returned by Turnstile on failure. */
	"error-codes"?: string[];
	challenge_ts?: string;
	hostname?: string;
	action?: string;
	cdata?: string;
}

export interface TurnstileVerifyInput {
	/** Server-side secret key (from `settings:turnstileSecretKey`). */
	secret: string;
	/** The `cf-turnstile-response` token from the client widget. */
	token: string;
	/** Optional visitor IP for replay protection (from requestMeta.ip). */
	remoteip?: string;
}

export interface TurnstileVerifyResult {
	success: boolean;
	errorCodes: string[];
}

/**
 * POST to Turnstile's siteverify endpoint and parse the response.
 *
 * Returns `{success: false}` on any transport failure rather than throwing
 * — submit-path callers treat network errors as "fail closed" without
 * leaking infrastructure detail to submitters.
 */
export async function verifyTurnstile(
	http: HttpAccess,
	input: TurnstileVerifyInput,
): Promise<TurnstileVerifyResult> {
	const body: Record<string, string> = {
		secret: input.secret,
		response: input.token,
	};
	if (input.remoteip) body.remoteip = input.remoteip;

	try {
		const res = await http.fetch(VERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			return { success: false, errorCodes: [`http-${res.status}`] };
		}

		const parsed = (await res.json()) as TurnstileVerifyResponse;
		return {
			success: parsed.success === true,
			errorCodes: parsed["error-codes"] ?? [],
		};
	} catch (err) {
		return {
			success: false,
			errorCodes: ["transport-error", err instanceof Error ? err.message : String(err)],
		};
	}
}
