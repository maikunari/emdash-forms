import type { FormTemplate } from "../types.js";

export const jobApplicationTemplate: FormTemplate = {
  title: "Job Application",
  slug: "job-application",
  fields: [
    { type: "text_input", id: "name", label: "Full Name", required: true, placeholder: "Jane Smith" },
    { type: "email", id: "email", label: "Email Address", required: true, placeholder: "jane@example.com" },
    { type: "phone", id: "phone", label: "Phone Number", required: false, placeholder: "+1 (555) 000-0000" },
    {
      type: "file_upload",
      id: "resume",
      label: "Resume / CV",
      required: true,
      accept: [".pdf", ".doc", ".docx"],
      maxSizeMB: 10,
    },
    {
      type: "textarea",
      id: "cover_letter",
      label: "Cover Letter",
      required: false,
      rows: 8,
      placeholder: "Tell us why you'd be a great fit...",
    },
    { type: "text_input", id: "linkedin", label: "LinkedIn Profile", required: false, inputType: "url", placeholder: "https://linkedin.com/in/..." },
  ],
  settings: {
    submitLabel: "Submit Application",
    successMessage: "Application received! We'll review it and get back to you.",
    notifyAdmin: true,
    confirmationEmail: true,
  },
};
