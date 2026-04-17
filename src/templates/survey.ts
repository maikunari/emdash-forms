import type { FormTemplate } from "../types.js";

export const surveyTemplate: FormTemplate = {
	id: "survey",
	title: "Customer Survey",
	description: "Satisfaction, NPS, feature checkboxes, open feedback.",
	fields: [
		{
			type: "select",
			id: "satisfaction",
			label: "How satisfied are you overall?",
			required: true,
			options: [
				{ label: "Very satisfied", value: "very_satisfied" },
				{ label: "Satisfied", value: "satisfied" },
				{ label: "Neutral", value: "neutral" },
				{ label: "Dissatisfied", value: "dissatisfied" },
				{ label: "Very dissatisfied", value: "very_dissatisfied" },
			],
		},
		{
			type: "checkbox",
			id: "features",
			label: "Which features do you use most?",
			helpText: "Select all that apply.",
			options: [
				{ label: "Reporting", value: "reporting" },
				{ label: "Integrations", value: "integrations" },
				{ label: "Mobile app", value: "mobile" },
				{ label: "API", value: "api" },
				{ label: "Team collaboration", value: "team" },
			],
		},
		{
			type: "number",
			id: "nps",
			label: "How likely are you to recommend us? (0–10)",
			required: true,
			min: 0,
			max: 10,
			step: 1,
		},
		{
			type: "textarea",
			id: "feedback",
			label: "Anything else you'd like to share?",
			rows: 4,
		},
	],
	defaultSettings: {
		submitLabel: "Submit feedback",
		successMessage: "Thanks for the feedback — we read every response.",
		spamProtection: "honeypot",
		notifications: {
			notifyAdmin: true,
			confirmationEmail: false,
		},
	},
};
