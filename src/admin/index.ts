// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit router (Workspace UI)
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock } from "../types.js";
import { renderDashboard } from "./dashboard.js";
import { renderFormsList } from "./forms-list.js";
import { renderSubmissionsList } from "./submissions-list.js";
import { renderFormBuilder } from "./form-builder.js";
import { renderSettings } from "./settings.js";

export type AdminPage = "dashboard" | "forms" | "form-builder" | "submissions" | "settings";

export async function adminHandler(
  ctx: PluginContext,
  request: Request
): Promise<Response> {
  const url = new URL(request.url);
  const page = (url.searchParams.get("page") || "dashboard") as AdminPage;
  const formId = url.searchParams.get("formId") || undefined;

  let blocks: BlockKitBlock[];

  switch (page) {
    case "forms":
      blocks = await renderFormsList(ctx);
      break;
    case "form-builder":
      blocks = await renderFormBuilder(ctx, formId);
      break;
    case "submissions":
      blocks = formId
        ? await renderSubmissionsList(ctx, formId)
        : await renderFormsList(ctx);
      break;
    case "settings":
      blocks = await renderSettings(ctx);
      break;
    case "dashboard":
    default:
      blocks = await renderDashboard(ctx);
      break;
  }

  // Wrap in navigation tabs
  const nav: BlockKitBlock[] = [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Overview" },
          action_id: "navigate_dashboard",
          ...(page === "dashboard" ? { style: "primary" } : {}),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Forms" },
          action_id: "navigate_forms",
          ...(page === "forms" || page === "form-builder" ? { style: "primary" } : {}),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Settings" },
          action_id: "navigate_settings",
          ...(page === "settings" ? { style: "primary" } : {}),
        },
      ],
    },
    { type: "divider" },
  ];

  return new Response(JSON.stringify({ blocks: [...nav, ...blocks] }), {
    headers: { "Content-Type": "application/json" },
  });
}
