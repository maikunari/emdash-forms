// ---------------------------------------------------------------------------
// emdash-forms — Admin Block Kit: Global settings
// ---------------------------------------------------------------------------

import type { PluginContext, BlockKitBlock } from "../types.js";

export async function renderSettings(ctx: PluginContext): Promise<BlockKitBlock[]> {
  const settings = ctx.pluginSettings;

  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Settings" },
    },
    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: "Email" },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Admin Email" },
      element: {
        type: "plain_text_input",
        action_id: "admin_email",
        initial_value: settings["adminEmail"] || "",
        placeholder: { type: "plain_text", text: "admin@example.com" },
      },
      hint: { type: "plain_text", text: "Default recipient for form submission notifications." },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "From Email" },
      element: {
        type: "plain_text_input",
        action_id: "from_email",
        initial_value: settings["fromEmail"] || "",
        placeholder: { type: "plain_text", text: "forms@yourdomain.com" },
      },
      hint: { type: "plain_text", text: "Sender address for all form notification emails." },
    },

    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: "Spam Protection" },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Turnstile Site Key" },
      element: {
        type: "plain_text_input",
        action_id: "turnstile_site_key",
        initial_value: settings["turnstileSiteKey"] || "",
        placeholder: { type: "plain_text", text: "0x..." },
      },
      hint: { type: "plain_text", text: "Cloudflare Turnstile site key. Get one at dash.cloudflare.com." },
    },
    {
      type: "input",
      label: { type: "plain_text", text: "Turnstile Secret Key" },
      element: {
        type: "plain_text_input",
        action_id: "turnstile_secret_key",
        initial_value: settings["turnstileSecretKey"] ? "••••••••" : "",
        placeholder: { type: "plain_text", text: "0x..." },
      },
      hint: { type: "plain_text", text: "Server-side secret key for Turnstile verification." },
    },

    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Save Settings" },
          action_id: "save_settings",
          style: "primary",
        },
      ],
    },
  ];
}
