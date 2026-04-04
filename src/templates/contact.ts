import type { FormTemplate } from "../types.js";

export const contactTemplate: FormTemplate = {
  title: "Contact Form",
  slug: "contact",
  fields: [
    { type: "text_input", id: "name", label: "Your Name", required: true, placeholder: "Jane Smith" },
    { type: "email", id: "email", label: "Email Address", required: true, placeholder: "jane@example.com" },
    { type: "textarea", id: "message", label: "Message", required: true, rows: 5, placeholder: "How can we help?" },
  ],
  settings: {
    submitLabel: "Send Message",
    successMessage: "Thanks! We'll be in touch soon.",
    notifyAdmin: true,
    confirmationEmail: false,
  },
};
