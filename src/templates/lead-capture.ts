import type { FormTemplate } from "../types.js";

export const leadCaptureTemplate: FormTemplate = {
	id: "lead-capture",
	title: "Lead Capture",
	description: "Name, email, company, interest — hand off to sales.",
	fields: [
		{
			type: "text_input",
			id: "name",
			label: "Your name",
			required: true,
			placeholder: "Jane Smith",
		},
		{
			type: "email",
			id: "email",
			label: "Work email",
			required: true,
			placeholder: "jane@company.com",
		},
		{
			type: "text_input",
			id: "company",
			label: "Company",
			placeholder: "Acme Inc.",
		},
		{
			type: "select",
			id: "interest",
			label: "What are you interested in?",
			required: true,
			options: [
				{ label: "Product demo", value: "demo" },
				{ label: "Pricing", value: "pricing" },
				{ label: "Partnership", value: "partnership" },
				{ label: "Other", value: "other" },
			],
		},
	],
	defaultSettings: {
		submitLabel: "Request a call",
		successMessage: "Thanks — someone from our team will reach out within one business day.",
		spamProtection: "honeypot",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: true,
			confirmationSubject: "Thanks, {{name}} — we received your request",
		},
	},
};
