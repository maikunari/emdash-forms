import type { FormTemplate } from "../types.js";

export const eventRegistrationTemplate: FormTemplate = {
  title: "Event Registration",
  slug: "event-registration",
  fields: [
    { type: "text_input", id: "name", label: "Full Name", required: true, placeholder: "Jane Smith" },
    { type: "email", id: "email", label: "Email Address", required: true, placeholder: "jane@example.com" },
    {
      type: "select",
      id: "ticket_type",
      label: "Ticket Type",
      required: true,
      options: [
        { label: "General Admission", value: "general" },
        { label: "VIP", value: "vip" },
        { label: "Student", value: "student" },
      ],
    },
    {
      type: "select",
      id: "dietary",
      label: "Dietary Requirements",
      required: false,
      options: [
        { label: "None", value: "none" },
        { label: "Vegetarian", value: "vegetarian" },
        { label: "Vegan", value: "vegan" },
        { label: "Gluten-free", value: "gluten-free" },
        { label: "Other", value: "other" },
      ],
    },
    { type: "textarea", id: "notes", label: "Additional Notes", required: false, rows: 3 },
  ],
  settings: {
    submitLabel: "Register",
    successMessage: "You're registered! Check your email for confirmation details.",
    notifyAdmin: true,
    confirmationEmail: true,
  },
};
