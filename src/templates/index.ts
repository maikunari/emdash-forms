// ---------------------------------------------------------------------------
// emdash-forms — Template registry
// ---------------------------------------------------------------------------

import type { FormTemplate } from "../types.js";
import { contactTemplate } from "./contact.js";
import { leadCaptureTemplate } from "./lead-capture.js";
import { eventRegistrationTemplate } from "./event-registration.js";
import { jobApplicationTemplate } from "./job-application.js";
import { surveyTemplate } from "./survey.js";
import { callbackTemplate } from "./callback.js";

export const templates: Record<string, FormTemplate> = {
  contact: contactTemplate,
  "lead-capture": leadCaptureTemplate,
  "event-registration": eventRegistrationTemplate,
  "job-application": jobApplicationTemplate,
  survey: surveyTemplate,
  callback: callbackTemplate,
};

export {
  contactTemplate,
  leadCaptureTemplate,
  eventRegistrationTemplate,
  jobApplicationTemplate,
  surveyTemplate,
  callbackTemplate,
};
