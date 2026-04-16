/**
 * emdash-forms — Honeypot spam protection
 *
 * Per SPEC-v1.md §8.1. A hidden form field that real users don't fill but
 * naive bots often will. Zero-config default on every form.
 */

/**
 * Hidden-field name. Included in the form markup but CSS-hidden and
 * tabindex="-1" so keyboard + screen-reader users skip past it.
 */
export const HONEYPOT_FIELD = "_emdash_hp";

/**
 * Returns true if the submission looks like a bot filled the honeypot.
 * Accepts the parsed `data` object (top-level) or the full submit body
 * (where the honeypot lives under `_emdash_hp`, separate from `data`).
 */
export function isHoneypotTriggered(bodyOrData: Record<string, unknown>): boolean {
	const value = bodyOrData[HONEYPOT_FIELD];
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim().length > 0;
	return true;
}

/**
 * Strip the honeypot field from a submission data record before persisting.
 * Called after the spam check succeeds — we never store the honeypot value.
 */
export function stripHoneypot<T extends Record<string, unknown>>(data: T): T {
	if (!(HONEYPOT_FIELD in data)) return data;
	const copy = { ...data };
	delete copy[HONEYPOT_FIELD];
	return copy;
}
