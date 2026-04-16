import type { FormTemplate } from "../types.js";

export const eventRegistrationTemplate: FormTemplate = {
	id: "event-registration",
	title: "Event Registration",
	description: "Name, email, ticket type, dietary requirements.",
	fields: [
		{
			type: "text_input",
			id: "name",
			label: "Full name",
			required: true,
		},
		{
			type: "email",
			id: "email",
			label: "Email address",
			required: true,
		},
		{
			type: "radio",
			id: "ticketType",
			label: "Ticket type",
			required: true,
			options: [
				{ label: "General admission", value: "general" },
				{ label: "VIP", value: "vip" },
				{ label: "Student (with ID)", value: "student" },
			],
		},
		{
			type: "textarea",
			id: "dietaryRequirements",
			label: "Dietary requirements",
			helpText: "Let us know if you have any allergies, preferences, or accessibility needs.",
			rows: 3,
		},
	],
	defaultSettings: {
		submitLabel: "Register",
		successMessage: "You're in! Check your inbox for a confirmation email with event details.",
		spamProtection: "honeypot",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: true,
			confirmationSubject: "You're registered — {{name}}",
			confirmationBody:
				'<div style="font-family:system-ui,sans-serif;max-width:600px"><h2>See you there, {{name}}</h2><p>Your {{ticketType}} ticket is confirmed. We\'ll send venue details closer to the date.</p></div>',
		},
	},
};
