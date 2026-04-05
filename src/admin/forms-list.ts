// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit: Forms list (Workspace UI)
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock } from "../types.js";

export async function renderFormsList(ctx: PluginContext): Promise<BlockKitBlock[]> {
  const { results } = await ctx.db
    .prepare(
      `SELECT f.*, COUNT(s.id) as submission_count,
              SUM(CASE WHEN s.read_at IS NULL THEN 1 ELSE 0 END) as unread_count
       FROM emdash_forms f
       LEFT JOIN emdash_form_submissions s ON s.form_id = f.id
       GROUP BY f.id
       ORDER BY f.created_at DESC`
    )
    .all<{
      id: string;
      title: string;
      slug: string;
      submission_count: number;
      unread_count: number;
      created_at: string;
      updated_at: string;
    }>();

  const blocks: BlockKitBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Forms" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "New form" },
          action_id: "navigate_form_builder",
          style: "primary",
        },
      ],
    },
    { type: "divider" },
  ];

  if (results.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No forms yet. Create one to get started._",
      },
    });
    return blocks;
  }

  for (const form of results) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${form.title}*\n\`/${form.slug}\` · ${form.submission_count} submissions${form.unread_count > 0 ? ` (${form.unread_count} unread)` : ""}`,
        },
        accessory: {
          type: "overflow",
          action_id: `form_actions_${form.id}`,
          options: [
            { text: { type: "plain_text", text: "Edit" }, value: `edit_${form.id}` },
            { text: { type: "plain_text", text: "View Submissions" }, value: `submissions_${form.id}` },
            { text: { type: "plain_text", text: "Delete" }, value: `delete_${form.id}` },
          ],
        },
      },
      { type: "divider" }
    );
  }

  return blocks;
}
