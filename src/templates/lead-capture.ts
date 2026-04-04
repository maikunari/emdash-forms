import type { FormTemplate } from "../types.js";

export const leadCaptureTemplate: FormTemplate = {
  title: "Lead Capture",
  slug: "lead-capture",
  fields: [
    { type: "text_input", id: "name", label: "Full Name", required: true, placeholder: "Jane Smith" },
    { type: "email", id: "email", label: "Work Email", required: true, placeholder: "jane@company.com" },
    { type: "text_input", id: "company", label: "Company", required: false, placeholder: "Acme Inc." },
    {
      type: "select",
      id: "interest",
      label: "What are you interested in?",
      required: true,
      options: [
        { label: "Product demo", value: "demo" },
        { label: "Pricing information", value: "pricing" },
        { label: "Partnership", value: "partnership" },
        { label: "Other", value: "other" },
      ],
    },
  ],
  settings: {
    submitLabel: "Get in Touch",
    successMessage: "Thanks for your interest! We'll reach out shortly.",
    notifyAdmin: true,
    confirmationEmail: true,
  },
};
