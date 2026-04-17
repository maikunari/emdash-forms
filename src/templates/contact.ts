import type { FormTemplate } from "../types.js";

export const contactTemplate: FormTemplate = {
	id: "contact",
	title: "Contact Form",
	description: "Name, email, message. The canonical get-in-touch form.",
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
			label: "Email address",
			required: true,
			placeholder: "jane@example.com",
		},
		{
			type: "textarea",
			id: "message",
			label: "Message",
			required: true,
			rows: 5,
			placeholder: "How can we help?",
		},
	],
	defaultSettings: {
		submitLabel: "Send Message",
		successMessage: "Thanks! We'll be in touch soon.",
		spamProtection: "honeypot",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: false,
		},
	},
};
