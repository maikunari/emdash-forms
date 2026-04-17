/**
 * emdash-forms — Admin Block Kit dispatcher
 *
 * Routes interactions from the single `admin` HTTP route to page
 * builders (for `page_load`) and action handlers (for `form_submit`
 * and `block_action`). Per SPEC-v1.md §5.1.
 *
 * Phase 2 will fill in the page builders and action handlers; Phase 1
 * leaves every branch at a placeholder response, matching the Phase 0
 * behavior but now with the shape in place for extension.
 */

import type { PluginContext, RouteContext } from "emdash";

import {
	activateFormAction,
	deleteFormAction,
	deleteSubmissionAction,
	pauseFormAction,
} from "./actions.js";
import {
	addField,
	deleteField,
	duplicateField,
	moveField,
} from "./field-actions.js";
import {
	createFormFromTemplate,
	saveFormBehavior,
	saveFormMetadata,
	saveFormNotifications,
} from "./form-save.js";
import { buildFormEditPage } from "./pages/form-edit.js";
import { buildFormNewPage, createFormAction } from "./pages/form-new.js";
import { buildFormsListPage } from "./pages/forms-list.js";
import {
	buildSettingsPage,
	saveEmailSettings,
	saveRetentionSettings,
	saveTurnstileSettings,
} from "./pages/settings.js";
import {
	buildSubmissionDetailPage,
	markSubmissionRead,
	markSubmissionUnread,
} from "./pages/submission-detail.js";
import {
	buildSubmissionsListPage,
	PAGINATION_ACTION_ID,
} from "./pages/submissions-list.js";

// ─── Block Kit response shapes (local) ───────────────────────────────
//
// emdash doesn't re-export BlockResponse as a named type (it lives in
// @emdash-cms/blocks). For our handler return values we only need the
// outer shape — keeping blocks typed as `unknown[]` is fine, the
// platform renderer validates them.

export interface BlockResponse {
	blocks: readonly unknown[];
	toast?: { message: string; type: "success" | "error" | "info" };
}

// ─── Page dispatcher ─────────────────────────────────────────────────

/**
 * Parse `interaction.page` against the 8 page patterns per SPEC §5.1.
 * Order matters: more-specific patterns before less-specific.
 */
export type AdminPageMatch =
	| { kind: "forms-list" }
	| { kind: "form-new" }
	| { kind: "field-edit"; formId: string; fieldId: string }
	| { kind: "form-submissions"; formId: string }
	| { kind: "form-edit"; formId: string }
	| { kind: "submissions-list" }
	| { kind: "submission-detail"; submissionId: string }
	| { kind: "settings" }
	| { kind: "unknown" };

export function matchAdminPage(page: string | undefined): AdminPageMatch {
	if (!page || page === "/") return { kind: "forms-list" };
	if (page === "/forms/new") return { kind: "form-new" };
	if (page === "/settings") return { kind: "settings" };

	const fieldEditMatch = /^\/forms\/([^/]+)\/fields\/([^/]+)$/.exec(page);
	if (fieldEditMatch) {
		return {
			kind: "field-edit",
			formId: fieldEditMatch[1]!,
			fieldId: fieldEditMatch[2]!,
		};
	}

	const formSubmissionsMatch = /^\/forms\/([^/]+)\/submissions$/.exec(page);
	if (formSubmissionsMatch) {
		return { kind: "form-submissions", formId: formSubmissionsMatch[1]! };
	}

	const formEditMatch = /^\/forms\/([^/]+)$/.exec(page);
	if (formEditMatch) {
		return { kind: "form-edit", formId: formEditMatch[1]! };
	}

	if (page === "/submissions") return { kind: "submissions-list" };

	const submissionDetailMatch = /^\/submissions\/([^/]+)$/.exec(page);
	if (submissionDetailMatch) {
		return { kind: "submission-detail", submissionId: submissionDetailMatch[1]! };
	}

	return { kind: "unknown" };
}

// ─── Interaction envelope ────────────────────────────────────────────

/**
 * Narrowed Block Kit interaction shape. The Zod schema in validation.ts
 * accepts this plus some extra optional fields; we only read the ones
 * the dispatcher cares about.
 */
interface Interaction {
	type?: string;
	page?: string;
	action_id?: string;
	block_id?: string;
	values?: Record<string, unknown>;
	value?: string;
}

// ─── Placeholder builder ─────────────────────────────────────────────

/**
 * Dispatch a field-row action from the form-edit page. Value shape:
 *   field:{action}:{formId}:{fieldId}
 * where action ∈ { move_top, move_up, move_down, move_bottom, edit,
 *                  duplicate, delete }.
 */
async function dispatchFieldOverflow(
	ctx: PluginContext,
	selected: string,
): Promise<BlockResponse> {
	// Parse: strip leading "field:", split off action, remaining is
	// formId:fieldId (fieldId may contain internal underscores but not
	// colons — our field id regex forbids them).
	const withoutPrefix = selected.slice("field:".length);
	const firstColon = withoutPrefix.indexOf(":");
	if (firstColon === -1) return placeholder(`field-overflow:${selected}`);
	const action = withoutPrefix.slice(0, firstColon);
	const rest = withoutPrefix.slice(firstColon + 1);
	const secondColon = rest.indexOf(":");
	if (secondColon === -1) return placeholder(`field-overflow:${selected}`);
	const formId = rest.slice(0, secondColon);
	const fieldId = rest.slice(secondColon + 1);

	switch (action) {
		case "move_top":
			return moveField(ctx, formId, fieldId, "top");
		case "move_up":
			return moveField(ctx, formId, fieldId, "up");
		case "move_down":
			return moveField(ctx, formId, fieldId, "down");
		case "move_bottom":
			return moveField(ctx, formId, fieldId, "bottom");
		case "duplicate":
			return duplicateField(ctx, formId, fieldId);
		case "delete":
			return deleteField(ctx, formId, fieldId);
		case "edit":
			return dispatchAdminInteraction(ctx, {
				type: "page_load",
				page: `/forms/${formId}/fields/${fieldId}`,
			});
		default:
			return placeholder(`field-overflow:${action}`);
	}
}

/**
 * Dispatch a form-row action — either the overflow-menu selected value
 * (e.g. "form:delete:{id}") or a direct action_id of the same shape.
 */
async function dispatchFormOverflow(
	ctx: PluginContext,
	selected: string,
): Promise<BlockResponse> {
	if (selected.startsWith("form:submissions:")) {
		const formId = selected.slice("form:submissions:".length);
		return dispatchAdminInteraction(ctx, {
			type: "page_load",
			page: `/forms/${formId}/submissions`,
		});
	}
	if (selected.startsWith("form:edit:")) {
		const formId = selected.slice("form:edit:".length);
		return dispatchAdminInteraction(ctx, {
			type: "page_load",
			page: `/forms/${formId}`,
		});
	}
	if (selected.startsWith("form:pause:")) {
		return pauseFormAction(ctx, selected.slice("form:pause:".length));
	}
	if (selected.startsWith("form:activate:")) {
		return activateFormAction(ctx, selected.slice("form:activate:".length));
	}
	if (selected.startsWith("form:delete:")) {
		return deleteFormAction(ctx, selected.slice("form:delete:".length));
	}
	return placeholder(`form-overflow:${selected}`);
}

function placeholder(kind: string): BlockResponse {
	return {
		blocks: [
			{
				type: "section",
				text: `Under construction — Phase 2/3 implementation (${kind}).`,
			},
		],
	};
}

// ─── Entry point ─────────────────────────────────────────────────────

/**
 * Dispatch an admin interaction to the correct handler.
 *
 * Phase 2 extends this with real page builders + action handlers.
 * Phase 3 adds the form builder bodies. Unknown pages and
 * unhandled interaction types fall through to a placeholder.
 */
export async function dispatchAdminInteraction(
	ctx: RouteContext<unknown> | PluginContext,
	interaction: Interaction,
): Promise<BlockResponse> {
	const match = matchAdminPage(interaction.page);

	// Log every dispatch so plugins-demo server logs make it obvious
	// what the client is calling. Low-cardinality — safe for info.
	if ("log" in ctx) {
		ctx.log.info("[emdash-forms] admin dispatch", {
			type: interaction.type,
			page: interaction.page,
			action_id: interaction.action_id,
			match: match.kind,
		});
	}

	const pluginCtx = ctx as PluginContext;

	// page_load → page builders
	if (interaction.type === "page_load" || !interaction.type) {
		switch (match.kind) {
			case "settings":
				return buildSettingsPage(pluginCtx);
			case "forms-list":
				return buildFormsListPage(pluginCtx);
			case "submissions-list":
				return buildSubmissionsListPage(pluginCtx);
			case "form-submissions":
				return buildSubmissionsListPage(pluginCtx, { formId: match.formId });
			case "submission-detail":
				return buildSubmissionDetailPage(pluginCtx, match.submissionId);
			case "form-new":
				return buildFormNewPage();
			case "form-edit":
				return buildFormEditPage(pluginCtx, match.formId);
			case "field-edit":
			case "unknown":
				return placeholder(match.kind);
		}
	}

	// form_submit → action handlers
	if (interaction.type === "form_submit") {
		const values = interaction.values ?? {};
		const actionId = interaction.action_id ?? "";
		switch (actionId) {
			case "save_settings_email":
				return saveEmailSettings(pluginCtx, values);
			case "save_settings_retention":
				return saveRetentionSettings(pluginCtx, values);
			case "save_settings_turnstile":
				return saveTurnstileSettings(pluginCtx, values);
			case "form_create":
				return createFormAction(pluginCtx, values);
		}

		// Form-edit save handlers — action ids carry the formId suffix
		// so the handler knows which form to update.
		if (actionId.startsWith("form_save_metadata:")) {
			return saveFormMetadata(pluginCtx, actionId.slice("form_save_metadata:".length), values);
		}
		if (actionId.startsWith("form_save_behavior:")) {
			return saveFormBehavior(pluginCtx, actionId.slice("form_save_behavior:".length), values);
		}
		if (actionId.startsWith("form_save_notifications:")) {
			return saveFormNotifications(
				pluginCtx,
				actionId.slice("form_save_notifications:".length),
				values,
			);
		}

		return placeholder(`form_submit:${actionId}`);
	}

	// block_action → action handlers
	if (interaction.type === "block_action") {
		const actionId = interaction.action_id ?? "";

		// Pagination on submissions tables — cursor arrives as interaction.value.
		if (actionId === PAGINATION_ACTION_ID) {
			const cursor = typeof interaction.value === "string" ? interaction.value : undefined;
			// We can't tell cross-form from per-form from the action id
			// alone — the table lives on whichever page rendered it, and
			// we route based on the current match.
			if (match.kind === "form-submissions") {
				return buildSubmissionsListPage(pluginCtx, { formId: match.formId, cursor });
			}
			return buildSubmissionsListPage(pluginCtx, { cursor });
		}

		// Simple navigation buttons: `navigate:{path}`.
		if (actionId.startsWith("navigate:")) {
			const path = actionId.slice("navigate:".length);
			return dispatchAdminInteraction(ctx, { type: "page_load", page: path });
		}

		// Submission row actions.
		if (actionId.startsWith("submission:read:")) {
			return markSubmissionRead(pluginCtx, actionId.slice("submission:read:".length));
		}
		if (actionId.startsWith("submission:unread:")) {
			return markSubmissionUnread(pluginCtx, actionId.slice("submission:unread:".length));
		}
		if (actionId.startsWith("submission:view:")) {
			const id = actionId.slice("submission:view:".length);
			return buildSubmissionDetailPage(pluginCtx, id);
		}
		if (actionId.startsWith("submission:delete:")) {
			return deleteSubmissionAction(pluginCtx, actionId.slice("submission:delete:".length));
		}

		// Form row actions (fired from the forms-list overflow menu).
		// Overflow interactions arrive as `form:menu:{id}` with the
		// selected option's value in interaction.value.
		if (actionId.startsWith("form:menu:")) {
			const selected = typeof interaction.value === "string" ? interaction.value : "";
			return dispatchFormOverflow(pluginCtx, selected);
		}
		// "New from template" dropdown — picked value is the template id.
		if (actionId === "form:new_from_template") {
			const templateId = typeof interaction.value === "string" ? interaction.value : "";
			return createFormFromTemplate(pluginCtx, templateId);
		}

		// ── Field mutations on /forms/{id} ───────────────────────
		// Add field: select action fires `form:field_add:{formId}`
		// with the picked field type in interaction.value.
		if (actionId.startsWith("form:field_add:")) {
			const formId = actionId.slice("form:field_add:".length);
			const type = typeof interaction.value === "string" ? interaction.value : "";
			return addField(pluginCtx, formId, type);
		}
		// Field overflow menu: `form:field_menu:{formId}:{fieldId}`
		// with a specific action in interaction.value.
		if (actionId.startsWith("form:field_menu:")) {
			const selected = typeof interaction.value === "string" ? interaction.value : "";
			return dispatchFieldOverflow(pluginCtx, selected);
		}
		// Direct field:* action — used when a confirm dialog fires
		// the underlying action id rather than going through the menu.
		if (actionId.startsWith("field:")) {
			return dispatchFieldOverflow(pluginCtx, actionId);
		}

		// Direct form:* actions (e.g. from confirm dialogs in future).
		if (actionId.startsWith("form:")) {
			return dispatchFormOverflow(pluginCtx, actionId);
		}

		return placeholder(`block_action:${actionId}`);
	}

	return placeholder(`unhandled:${interaction.type ?? "unknown"}`);
}
