// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit: Form builder (Workspace UI)
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock, Form, FormField } from "../types.js";

const FIELD_TYPE_OPTIONS = [
  { label: "Text Input", value: "text_input" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Textarea", value: "textarea" },
  { label: "Select", value: "select" },
  { label: "Multi-Select", value: "multi_select" },
  { label: "Checkbox", value: "checkbox" },
  { label: "Radio", value: "radio" },
  { label: "Number", value: "number" },
  { label: "Date", value: "date" },
  { label: "Hidden", value: "hidden" },
  { label: "File Upload", value: "file_upload" },
];

export async function renderFormBuilder(
  ctx: PluginContext,
  formId?: string
): Promise<BlockKitBlock[]> {
  let form: Form | null = null;

  if (formId) {
    const row = await ctx.db
      .prepare("SELECT * FROM emdash_forms WHERE id = ?")
      .bind(formId)
      .first<{
        id: string;
        title: string;
        slug: string;
        config: string;
        settings: string;
        created_at: string;
        updated_at: string;
      }>();

    if (row) {
      form = {
        ...row,
        config: JSON.parse(row.config),
        settings: JSON.parse(row.settings),
      };
    }
  }

  const isEdit = !!form;
  const title = isEdit ? `Edit — ${form!.title}` : "New form";
  const fields: FormField[] = form?.config.fields ?? [];

  const blocks: BlockKitBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: title },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Back" },
          action_id: "navigate_forms",
        },
      ],
    },
    { type: "divider" },

    // Form metadata
    {
      type: "input",
      label: { type: "plain_text", text: "Form Title" },
      element: {
        type: "plain_text_input",
        action_id: "form_title",
        initial_value: form?.title || "",
        placeholder: { type: "plain_text", text: "e.g. Contact Form" },
      },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Slug" },
      element: {
        type: "plain_text_input",
        action_id: "form_slug",
        initial_value: form?.slug || "",
        placeholder: { type: "plain_text", text: "e.g. contact" },
      },
      hint: { type: "plain_text", text: "URL-safe identifier used in the submission endpoint." },
    },

    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: "Fields" },
    },
  ];

  // Render existing fields
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${i + 1}. ${field.label}*\nType: \`${field.type}\` · ${field.required ? "Required" : "Optional"}`,
        },
        accessory: {
          type: "overflow",
          action_id: `field_actions_${i}`,
          options: [
            { text: { type: "plain_text", text: "Move Up" }, value: `move_up_${i}` },
            { text: { type: "plain_text", text: "Move Down" }, value: `move_down_${i}` },
            { text: { type: "plain_text", text: "Remove" }, value: `remove_${i}` },
          ],
        },
      }
    );
  }

  // Add field controls
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: "add_field_type",
          placeholder: { type: "plain_text", text: "Add field..." },
          options: FIELD_TYPE_OPTIONS.map((opt) => ({
            text: { type: "plain_text", text: opt.label },
            value: opt.value,
          })),
        },
      ],
    },

    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: "Settings" },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Button label" },
      element: {
        type: "plain_text_input",
        action_id: "submit_label",
        initial_value: form?.settings.submitLabel || "Submit",
      },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Success message" },
      element: {
        type: "plain_text_input",
        action_id: "success_message",
        initial_value: form?.settings.successMessage || "Thanks! Your submission has been received.",
        multiline: true,
      },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Redirect URL" },
      element: {
        type: "plain_text_input",
        action_id: "redirect_url",
        initial_value: form?.settings.redirectUrl || "",
        placeholder: { type: "plain_text", text: "https://..." },
      },
      optional: true,
    },

    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: "Notifications" },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Admin notifications" },
      element: {
        type: "checkboxes",
        action_id: "notify_admin",
        options: [
          {
            text: { type: "plain_text", text: "Send email to admin" },
            value: "true",
          },
        ],
        ...(form?.settings.notifications.notifyAdmin
          ? {
              initial_options: [
                { text: { type: "plain_text", text: "Send email to admin" }, value: "true" },
              ],
            }
          : {}),
      },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Confirmation email" },
      element: {
        type: "checkboxes",
        action_id: "confirmation_email",
        options: [
          {
            text: { type: "plain_text", text: "Send confirmation email" },
            value: "true",
          },
        ],
        ...(form?.settings.notifications.confirmationEmail
          ? {
              initial_options: [
                { text: { type: "plain_text", text: "Send confirmation email" }, value: "true" },
              ],
            }
          : {}),
      },
    },

    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: isEdit ? "Save" : "Create" },
          action_id: isEdit ? `save_form_${form!.id}` : "create_form",
          style: "primary",
        },
      ],
    },
  );

  return blocks;
}
