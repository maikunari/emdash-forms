// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit: Overview (Workspace UI)
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock } from "../types.js";

export async function renderDashboard(ctx: PluginContext): Promise<BlockKitBlock[]> {
  const formsCount = await ctx.db
    .prepare("SELECT COUNT(*) as count FROM emdash_forms")
    .first<{ count: number }>();

  const submissionsCount = await ctx.db
    .prepare("SELECT COUNT(*) as count FROM emdash_form_submissions")
    .first<{ count: number }>();

  const unreadCount = await ctx.db
    .prepare("SELECT COUNT(*) as count FROM emdash_form_submissions WHERE read_at IS NULL")
    .first<{ count: number }>();

  const recentSubmissions = await ctx.db
    .prepare(
      `SELECT s.id, s.created_at, s.read_at, f.title as form_title
       FROM emdash_form_submissions s
       JOIN emdash_forms f ON f.id = s.form_id
       ORDER BY s.created_at DESC
       LIMIT 5`
    )
    .all<{ id: string; created_at: string; read_at: string | null; form_title: string }>();

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Overview" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Forms*\n${formsCount?.count ?? 0}` },
        { type: "mrkdwn", text: `*Submissions*\n${submissionsCount?.count ?? 0}` },
        { type: "mrkdwn", text: `*Unread*\n${unreadCount?.count ?? 0}` },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Recent activity*" },
    },
    ...(recentSubmissions.results.length > 0
      ? recentSubmissions.results.map((s) => ({
          type: "section" as const,
          text: {
            type: "mrkdwn" as const,
            text: `${s.read_at ? "" : "● "} *${s.form_title}*  ·  ${new Date(s.created_at).toLocaleDateString()}`,
          },
        }))
      : [
          {
            type: "section" as const,
            text: { type: "mrkdwn" as const, text: "_No submissions yet._" },
          },
        ]),
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "All forms" },
          action_id: "navigate_forms",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "New form" },
          action_id: "navigate_form_builder",
        },
      ],
    },
  ];
}
