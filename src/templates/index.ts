/**
 * emdash-forms — Template registry
 *
 * Five templates seeded on `plugin:install` per SPEC-v1.md §9. Each is a
 * plain `FormTemplate` data object — no logic.
 *
 * Order matters: templates are seeded in this order and this is the
 * order they appear in the admin "New from template" dropdown (Phase 2).
 */

import type { FormTemplate } from "../types.js";
import { callbackTemplate } from "./callback.js";
import { contactTemplate } from "./contact.js";
import { eventRegistrationTemplate } from "./event-registration.js";
import { leadCaptureTemplate } from "./lead-capture.js";
import { surveyTemplate } from "./survey.js";

export const TEMPLATES: readonly FormTemplate[] = [
	contactTemplate,
	leadCaptureTemplate,
	eventRegistrationTemplate,
	surveyTemplate,
	callbackTemplate,
] as const;

export const TEMPLATES_BY_ID: Record<string, FormTemplate> = Object.fromEntries(
	TEMPLATES.map((t) => [t.id, t]),
);

export {
	callbackTemplate,
	contactTemplate,
	eventRegistrationTemplate,
	leadCaptureTemplate,
	surveyTemplate,
};
