// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit: Submissions (Workspace UI)
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock } from "../types.js";

export async function renderSubmissionsList(
  ctx: PluginContext,
  formId: string
): Promise<BlockKitBlock[]> {
  const form = await ctx.db
    .prepare("SELECT * FROM emdash_forms WHERE id = ?")
    .bind(formId)
    .first<{ id: string; title: string; slug: string }>();

  if (!form) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: "_Form not found._" },
      },
    ];
  }

  const { results } = await ctx.db
    .prepare(
      `SELECT * FROM emdash_form_submissions
       WHERE form_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .bind(formId)
    .all<{
      id: string;
      data: string;
      metadata: string | null;
      read_at: string | null;
      created_at: string;
    }>();

  const blocks: BlockKitBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Submissions — ${form.title}` },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Back" },
          action_id: "navigate_forms",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Export" },
          action_id: `export_csv_${formId}`,
        },
      ],
    },
    { type: "divider" },
  ];

  if (results.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No submissions yet._" },
    });
    return blocks;
  }

  for (const submission of results) {
    const data =
      typeof submission.data === "string"
        ? (JSON.parse(submission.data) as Record<string, unknown>)
        : (submission.data as Record<string, unknown>);
    const preview = Object.entries(data)
      .slice(0, 3)
      .map(([k, v]) => `*${k}:* ${v}`)
      .join(" · ");

    const readIndicator = submission.read_at ? "" : "● ";
    const date = new Date(submission.created_at).toLocaleString();

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${readIndicator}${date}\n${preview}`,
        },
        accessory: {
          type: "overflow",
          action_id: `submission_actions_${submission.id}`,
          options: [
            ...(submission.read_at
              ? []
              : [{ text: { type: "plain_text", text: "Mark as Read" }, value: `read_${submission.id}` }]),
            { text: { type: "plain_text", text: "Delete" }, value: `delete_${submission.id}` },
          ],
        },
      },
      { type: "divider" }
    );
  }

  return blocks;
}
