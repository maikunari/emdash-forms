import type { FormTemplate } from "../types.js";

export const surveyTemplate: FormTemplate = {
  title: "Survey",
  slug: "survey",
  fields: [
    {
      type: "radio",
      id: "satisfaction",
      label: "How satisfied are you with our service?",
      required: true,
      options: [
        { label: "Very satisfied", value: "5" },
        { label: "Satisfied", value: "4" },
        { label: "Neutral", value: "3" },
        { label: "Dissatisfied", value: "2" },
        { label: "Very dissatisfied", value: "1" },
      ],
    },
    {
      type: "checkbox",
      id: "features_used",
      label: "Which features do you use most?",
      required: false,
      options: [
        { label: "Dashboard", value: "dashboard" },
        { label: "Reports", value: "reports" },
        { label: "Integrations", value: "integrations" },
        { label: "API", value: "api" },
      ],
    },
    {
      type: "radio",
      id: "recommend",
      label: "How likely are you to recommend us?",
      required: true,
      options: [
        { label: "Very likely", value: "5" },
        { label: "Likely", value: "4" },
        { label: "Neutral", value: "3" },
        { label: "Unlikely", value: "2" },
        { label: "Very unlikely", value: "1" },
      ],
    },
    {
      type: "textarea",
      id: "feedback",
      label: "Any additional feedback?",
      required: false,
      rows: 4,
      placeholder: "Tell us what you think...",
    },
  ],
  settings: {
    submitLabel: "Submit Survey",
    successMessage: "Thank you for your feedback!",
    notifyAdmin: true,
    confirmationEmail: false,
  },
};
