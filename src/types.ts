// ---------------------------------------------------------------------------
// emdash-forms — TypeScript type definitions
// ---------------------------------------------------------------------------

/** All supported field types */
export type FieldType =
  | "text_input"
  | "email"
  | "phone"
  | "textarea"
  | "select"
  | "multi_select"
  | "checkbox"
  | "radio"
  | "number"
  | "date"
  | "hidden"
  | "file_upload";

/** Conditional visibility rule — matches Block Kit native condition format */
export interface FieldCondition {
  field: string;
  eq?: string;
  neq?: string;
  in?: string[];
}

/** Base properties shared by every field */
export interface BaseField {
  type: FieldType;
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  condition?: FieldCondition;
  width?: "full" | "half";
}

export interface TextField extends BaseField {
  type: "text_input";
  inputType?: "text" | "email" | "url" | "tel";
  maxLength?: number;
}

export interface EmailField extends BaseField {
  type: "email";
}

export interface PhoneField extends BaseField {
  type: "phone";
}

export interface TextareaField extends BaseField {
  type: "textarea";
  rows?: number;
  maxLength?: number;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectField extends BaseField {
  type: "select";
  options: SelectOption[];
}

export interface MultiSelectField extends BaseField {
  type: "multi_select";
  options: SelectOption[];
}

export interface CheckboxField extends BaseField {
  type: "checkbox";
  options?: SelectOption[];
}

export interface RadioField extends BaseField {
  type: "radio";
  options: SelectOption[];
}

export interface NumberField extends BaseField {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

export interface DateField extends BaseField {
  type: "date";
  min?: string;
  max?: string;
}

export interface HiddenField extends BaseField {
  type: "hidden";
  defaultValue?: string;
}

export interface FileUploadField extends BaseField {
  type: "file_upload";
  accept?: string[];
  maxSizeMB?: number;
}

/** Union of all field types */
export type FormField =
  | TextField
  | EmailField
  | PhoneField
  | TextareaField
  | SelectField
  | MultiSelectField
  | CheckboxField
  | RadioField
  | NumberField
  | DateField
  | HiddenField
  | FileUploadField;

/** A step in a multi-step form */
export interface FormStep {
  title?: string;
  description?: string;
  fields: FormField[];
}

/** Notification configuration */
export interface NotificationSettings {
  notifyAdmin: boolean;
  adminEmail?: string;
  adminSubject?: string;
  adminBody?: string;
  confirmationEmail: boolean;
  confirmationSubject?: string;
  confirmationBody?: string;
  fromName?: string;
}

/** Form-level settings */
export interface FormSettings {
  submitLabel: string;
  successMessage: string;
  redirectUrl?: string;
  notifications: NotificationSettings;
  turnstile: boolean;
}

/** Full form configuration stored in the config JSON column */
export interface FormConfig {
  /** Single-step forms use fields; multi-step use steps */
  fields?: FormField[];
  steps?: FormStep[];
}

/** Form record as stored in D1 */
export interface Form {
  id: string;
  title: string;
  slug: string;
  config: FormConfig;
  settings: FormSettings;
  created_at: string;
  updated_at: string;
}

/** Submission metadata */
export interface SubmissionMetadata {
  ip?: string;
  userAgent?: string;
  referer?: string;
}

/** Submission record as stored in D1 */
export interface FormSubmission {
  id: string;
  form_id: string;
  data: Record<string, unknown>;
  metadata: SubmissionMetadata | null;
  read_at: string | null;
  created_at: string;
}

/** Form template definition */
export interface FormTemplate {
  title: string;
  slug: string;
  fields: FormField[];
  settings: Omit<FormSettings, "notifications" | "turnstile"> & {
    notifyAdmin: boolean;
    confirmationEmail: boolean;
  };
}

// ---------------------------------------------------------------------------
// Plugin context types (subset of EmDash plugin SDK)
// ---------------------------------------------------------------------------

export interface PluginDB {
  exec(sql: string): Promise<void>;
  prepare(sql: string): PluginStatement;
}

export interface PluginStatement {
  bind(...values: unknown[]): PluginStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<void>;
}

export interface PluginEmail {
  send(options: {
    to: string;
    from?: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void>;
}

export interface PluginStorage {
  createPresignedUrl(key: string, options?: {
    expiresIn?: number;
    contentType?: string;
  }): Promise<string>;
  getPublicUrl(key: string): string;
}

export interface PluginHTTP {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface PluginContext {
  db: PluginDB;
  email: PluginEmail;
  storage: PluginStorage;
  http: PluginHTTP;
  siteUrl: string;
  pluginSettings: Record<string, string>;
}

/** Block Kit block types used by admin UI */
export interface BlockKitBlock {
  type: string;
  [key: string]: unknown;
}
