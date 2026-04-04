import type { FormTemplate } from "../types.js";

export const callbackTemplate: FormTemplate = {
  title: "Callback Request",
  slug: "callback",
  fields: [
    { type: "text_input", id: "name", label: "Your Name", required: true, placeholder: "Jane Smith" },
    { type: "phone", id: "phone", label: "Phone Number", required: true, placeholder: "+1 (555) 000-0000" },
    {
      type: "select",
      id: "preferred_time",
      label: "Preferred Time",
      required: true,
      options: [
        { label: "Morning (9am – 12pm)", value: "morning" },
        { label: "Afternoon (12pm – 5pm)", value: "afternoon" },
        { label: "Evening (5pm – 8pm)", value: "evening" },
      ],
    },
    { type: "textarea", id: "notes", label: "What's this about?", required: false, rows: 3, placeholder: "Brief description..." },
  ],
  settings: {
    submitLabel: "Request Callback",
    successMessage: "We'll call you back at the time you selected.",
    notifyAdmin: true,
    confirmationEmail: false,
  },
};
