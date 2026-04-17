import type { FormTemplate } from "../types.js";

export const callbackTemplate: FormTemplate = {
	id: "callback",
	title: "Callback Request",
	description: "Name, phone, preferred time, notes.",
	fields: [
		{
			type: "text_input",
			id: "name",
			label: "Your name",
			required: true,
			placeholder: "Jane Smith",
		},
		{
			type: "text_input",
			id: "phone",
			label: "Phone number",
			required: true,
			inputType: "tel",
			placeholder: "+1 555 123 4567",
		},
		{
			type: "select",
			id: "preferredTime",
			label: "Best time to call",
			required: true,
			options: [
				{ label: "Morning (9am–12pm)", value: "morning" },
				{ label: "Afternoon (12pm–5pm)", value: "afternoon" },
				{ label: "Evening (5pm–8pm)", value: "evening" },
			],
		},
		{
			type: "textarea",
			id: "notes",
			label: "Anything we should know before we call?",
			rows: 3,
		},
	],
	defaultSettings: {
		submitLabel: "Request callback",
		successMessage: "Got it — we'll call you during your preferred window.",
		spamProtection: "honeypot",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: false,
		},
	},
};
