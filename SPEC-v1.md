# emdash-forms — v1 Specification

**Status:** blueprint. v1.0.0 target. Revised post-Phase 0 (see Revision history below).
**License:** MIT.
**Scope:** This document covers v1 only. See the [Future](#future-v11-and-v2) section for anything deferred.

### Revision history

- **Phase 0 (scaffold) resolved:** the `emdash plugin bundle` CLI accepts `public: true` routes on Standard-format plugins with no warnings — the pending-confirmation assumption held. ⚠ flags removed from §2, §4, §6.
- **Phase 0 findings:** four places where the original spec assumed Native-format capabilities that aren't available to Standard plugins. Fixes inline in §2.1 (named export only), §3.1 (flat indexes only), §3.2 (manual settings via Block Kit + ctx.kv), §5 (`/settings` admin page added).
- **Remaining ⚠:** §7.4 — marketplace deep-link URL pattern for `emdash-resend`. Verify once the marketplace UI is public.

---

## 1. Overview

**What.** A forms plugin for EmDash CMS. Create forms in the admin, embed them on a site via an Astro component, receive and review submissions, send email notifications. Built on the EmDash 0.5.0 Standard plugin format.

**Who.** Site owners running EmDash who need a contact form, lead capture form, survey, event signup, or callback request — the long tail of "you'd reach for Contact Form 7 / WPForms on WordPress." Developers and designers who want zero-config install and CSS-variable theming without being opinionated about the rest of the stack.

**License.** MIT. Free forever. Source on GitHub at `maikunari/emdash-forms`. Published to npm as `emdash-forms` and to the EmDash marketplace.

**Positioning.** The default forms plugin in the EmDash ecosystem. One of the first excellent third-party plugins on the marketplace. Positioned against Gravity Forms / WPForms for feature parity on the core scope; against Contact Form 7 for install simplicity.

---

## 2. Architecture

**Plugin format.** Standard (sandboxable). Block Kit admin. Marketplace-eligible via `emdash plugin publish`. No React, no custom Astro plugin components, no Portable Text blocks in v1.

### 2.1 Module shape

The descriptor factory in `./` is a **named export only** — `export function emdashForms()`. Do **not** add `export default emdashForms`.

The `emdash plugin bundle` CLI has two manifest-extraction code paths. A `default`-function export takes the fast path that returns the descriptor as-is, skipping the backend-probe step that normalizes `hooks`/`routes` onto a `ResolvedPlugin`. Result: `extractManifest()` crashes on undefined `hooks`. Using only a named export forces the CLI onto the probe path. Matches the `@emdash-cms/plugin-sandboxed-test` reference.

The `./sandbox` entry uses `export default definePlugin(...)` — this one's a default export because the CLI finds it via `.default` on the module.

### 2.2 Package structure

Two runtime entrypoints:
- `./` — descriptor factory (`PluginDescriptor`), Vite build-time, side-effect-free. Named export only (see §2.1).
- `./sandbox` — `definePlugin(...)` default export, runtime.
- `./astro` — plain Astro component, not a plugin artifact.

**package.json manifest:**

```jsonc
{
  "name": "emdash-forms",
  "version": "1.0.0",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".":        { "import": "./dist/index.mjs", "types": "./dist/index.d.ts" },
    "./sandbox":{ "import": "./dist/sandbox-entry.mjs", "types": "./dist/sandbox-entry.d.ts" },
    "./astro":  "./src/astro/EmDashForm.astro"
  },
  "peerDependencies": {
    "emdash": "^0.5.0",
    "astro":  ">=6.0.0-beta.0"
  },
  "peerDependenciesMeta": {
    "@emdash-cms/plugin-resend": { "optional": true }
  }
}
```

The resend plugin is documented as an optional peer so tools like `npm ls` surface the relationship. No runtime import; detection is via `ctx.email` at runtime.

**Capabilities:** `["email:send", "network:fetch"]`
**Allowed hosts:** `["challenges.cloudflare.com"]`

No `write:media` in v1 (file upload deferred). No wildcard hosts — Turnstile is the only external call.

**Dependencies.**
- Zero runtime dependencies beyond peerDeps.
- Zod for route input validation — imported from `astro/zod` (Astro re-exports Zod; no direct zod dep). Call signature in this release is `z.record(keySchema, valueSchema)` — Zod v4 shape.
- Dev: `typescript`, `tsdown` (matches emdash workspace catalog version `^0.20.0`), `emdash`, `astro` (mirroring peers so local builds + types resolve).

**Minimum EmDash version.** `^0.5.0`. Declared in `peerDependencies` and surfaced in the descriptor's `minEmdashVersion` field if supported (verify at bundle time).

---

## 3. Data model

### 3.1 Storage collections

Declared in the descriptor (`./src/index.ts`). `StandardPluginDefinition` does not accept a `storage` field — storage lives on the descriptor only for Standard-format plugins.

```typescript
storage: {
  forms: {
    indexes: ["status", "createdAt"],
    uniqueIndexes: ["slug"]
  },
  submissions: {
    indexes: ["formId", "status", "createdAt"]
  }
}
```

**Flat indexes only.** `PluginDescriptor.StorageCollectionDeclaration.indexes` is typed `string[]` — tuple/composite indexes (`["formId", "createdAt"]`) are a Native-format feature via `PluginDefinition<TStorage>` and are not available to Standard plugins. Per-form submission queries filter on `formId` and order by `createdAt` against the single-field index.

Phase 2 will benchmark query performance on the list pages (per-form submissions ordered by createdAt). If single-field ordering becomes a bottleneck at realistic dataset sizes (~10k submissions), revisit in v1.1.

### 3.2 Settings

Standard-format plugins do not have auto-generated settings UI. `admin.settingsSchema` lives on the Native `PluginDefinition.admin` interface and is not accessible from the Standard `PluginDescriptor`. The `/settings` admin page is rendered manually via Block Kit and persists to `ctx.kv` with the `settings:` prefix. Pattern follows `@emdash-cms/plugin-webhook-notifier`.

**Settings keys (all read from `ctx.kv.get<T>("settings:{key}")`):**

| Key | Type | Default | Purpose |
|---|---|---|---|
| `settings:defaultAdminEmail` | `string` | `""` | Recipient when a form doesn't specify one |
| `settings:retentionDays` | `number` | `365` | Submissions older than this are deleted weekly (min 7, max 3650) |
| `settings:turnstileSiteKey` | `string` | `""` | Optional; enables Turnstile site-side when set |
| `settings:turnstileSecretKey` | `string` (encrypted via Block Kit `secret_input`) | `""` | Server-side verify secret |

Defaults are seeded in `plugin:install` (§5 hook stubs in Phase 0; body in Phase 1).

**`/settings` page shape** (Phase 2 implementation):

```typescript
// Admin route, interaction.page === "/settings", type === "page_load"
return {
  blocks: [
    { type: "header", text: "Settings" },
    {
      type: "form",
      block_id: "settings",
      fields: [
        { type: "text_input",   action_id: "defaultAdminEmail", label: "Default admin email" },
        { type: "number_input", action_id: "retentionDays",     label: "Retention (days)", initial_value: 365, min: 7, max: 3650 },
        { type: "text_input",   action_id: "turnstileSiteKey",  label: "Turnstile site key (optional)" },
        { type: "secret_input", action_id: "turnstileSecretKey", label: "Turnstile secret key" }
      ],
      submit: { label: "Save", action_id: "save_settings" }
    }
  ]
};

// interaction.type === "form_submit", action_id === "save_settings"
for (const [key, value] of Object.entries(interaction.values)) {
  await ctx.kv.set(`settings:${key}`, value);
}
return { blocks: [/* re-render */], toast: { message: "Saved", type: "success" } };
```

### 3.3 Type definitions

```typescript
// Field types (v1: 10 types; `phone` rolled into text_input.inputType)
type FieldType =
  | "text_input"   // inputType: "text" | "email" | "url" | "tel"
  | "email"
  | "textarea"
  | "select"
  | "multi_select"
  | "checkbox"
  | "radio"
  | "number"
  | "date"
  | "hidden";

interface FieldCondition {
  field: string;
  eq?: string | number | boolean;
  neq?: string | number | boolean;
  in?: Array<string | number>;
}

interface SelectOption {
  label: string;
  value: string;
}

// Base shared by every field
interface BaseField {
  type: FieldType;
  id: string;              // Stable internal id; used as submission data key
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  width?: "full" | "half"; // Rendering hint for Astro component
  condition?: FieldCondition;
}

// Type-specific extensions (concise — full union in src/types.ts)
//   text_input → { inputType?: "text"|"email"|"url"|"tel"; maxLength?: number }
//   email      → (no extras; kept for semantics + built-in HTML5 validation)
//   textarea   → { rows?: number; maxLength?: number }
//   select     → { options: SelectOption[] }
//   multi_select → { options: SelectOption[] }
//   checkbox   → { options?: SelectOption[] }   // 0 opts = single boolean
//   radio      → { options: SelectOption[] }
//   number     → { min?: number; max?: number; step?: number }
//   date       → { min?: string; max?: string } // ISO date
//   hidden     → { defaultValue?: string }

type FormField = /* discriminated union of the above */;

interface NotificationSettings {
  notifyAdmin: boolean;
  adminEmail?: string;            // Falls back to settings:defaultAdminEmail
  adminSubject?: string;          // Merge tags supported
  adminBody?: string;             // Merge tags supported; HTML
  confirmationEmail: boolean;
  confirmationSubject?: string;
  confirmationBody?: string;
}

interface FormSettings {
  submitLabel: string;            // e.g. "Send Message"
  successMessage: string;         // Shown on successful submit
  redirectUrl?: string;           // Merge tags supported
  notifications: NotificationSettings;
  spamProtection: "honeypot" | "turnstile"; // Default: "honeypot"
}

interface Form {
  title: string;
  slug: string;                   // [a-z0-9-]+, unique per site
  fields: FormField[];
  settings: FormSettings;
  status: "active" | "paused";
  submissionCount: number;        // Denormalized; incremented in submit handler
  lastSubmissionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SubmissionMeta {
  ip?: string;                    // From cf-connecting-ip
  userAgent?: string;
  referer?: string;
  country?: string;               // From cf-ipcountry if present
}

interface Submission {
  formId: string;
  data: Record<string, unknown>;  // Keyed by field.id
  meta: SubmissionMeta;
  status: "new" | "read" | "archived"; // v1 uses new/read; archived reserved
  createdAt: string;
}

interface FormTemplate {
  id: string;                     // "contact", "lead-capture", etc.
  title: string;
  description: string;
  fields: FormField[];
  defaultSettings: Partial<FormSettings>;
}
```

**ID generation.** All document IDs use `crypto.randomUUID()`. Zero runtime deps; works in sandboxed Workers. Sorting by `createdAt` index (not by id) for chronological queries.

---

## 4. Routes

All routes mounted at `/_emdash/api/plugins/emdash-forms/{routeName}`.

### 4.1 `submit` (public)

**Method:** POST (body) • **Auth:** none • **Route key:** `submit`

**Input schema (Zod):**
```typescript
{
  formSlug: z.string().min(1),
  data: z.record(z.unknown()),
  _emdash_hp: z.string().optional(),           // Honeypot; must be empty
  "cf-turnstile-response": z.string().optional()
}
```

**Behavior:**
1. Load form by slug via `ctx.storage.forms.query({ where: { slug }, limit: 1 })`. 404 if not found or `status !== "active"`.
2. Honeypot check: reject 200 with `{ success: true }` if `_emdash_hp` is truthy (silent drop — don't signal to bots). Log at `info` level: spam traffic is the kind of thing admins want visible in default logs without enabling debug.
3. If `spamProtection === "turnstile"`: verify token against `https://challenges.cloudflare.com/turnstile/v0/siteverify`. On failure: 403.
4. Validate required fields against form definition. On failure: 400 with `errors: string[]`.
5. Strip honeypot + Turnstile token from `data` before persistence.
6. Create submission: `ctx.storage.submissions.put(id, { formId, data, meta, status: "new", createdAt })`.
7. Increment form's `submissionCount` + update `lastSubmissionAt` via a single `put` call. **Last-write-wins on this field is intentional** — under concurrent submits, small under-counts are acceptable for v1. Accurate counts are recomputable via `ctx.storage.submissions.count({ formId })` if ever needed.
8. Send notifications (see §7). Failures logged, not propagated.
9. Return `{ success: true, message: settings.successMessage, redirect?: mergedRedirectUrl }`.

### 4.2 `definition` (public)

**Method:** GET (query) • **Auth:** none • **Route key:** `definition`

**Input:** `{ slug: string }`

**Output:**
```typescript
{
  title: string;
  slug: string;
  fields: FormField[];
  settings: Pick<FormSettings, "submitLabel" | "spamProtection">;
}
```

Returns only the shape needed to render the form. Does not expose notification settings, redirect URL (applied server-side on submit response), submissionCount, or metadata. 404 if form not found or paused.

### 4.3 `admin` (authenticated)

**Method:** POST (body) • **Auth:** required • **Route key:** `admin`

The single Block Kit dispatcher. Input is a Block Kit interaction:

```typescript
{
  type: "page_load" | "form_submit" | "button_click",
  page?: string,                  // "/", "/forms/{id}", etc.
  action_id?: string,             // for form_submit and button_click
  block_id?: string,
  values?: Record<string, unknown>
}
```

**Output:** `{ blocks: Block[], toast?: { message: string, type: "success"|"error"|"info" } }`

Full routing and per-page rendering spec in §5.

### 4.4 `export/csv` (authenticated)

**Method:** GET (query) • **Auth:** required • **Route key:** `export/csv`

**Input:** `{ formId: string }`

**Output:** `text/csv` with `Content-Disposition: attachment; filename=submissions-{slug}-{date}.csv`.

Reason for a separate route from the admin dispatcher: returns raw bytes, not a `BlockResponse`. Linked to from `/forms/{id}/submissions` via a button with `url` → `/_emdash/api/plugins/emdash-forms/export/csv?formId={id}`.

Columns: `id`, `createdAt`, `status`, `ip`, then one column per unique field id seen across the result set. Handles quoted cells per RFC 4180.

**No dedicated CRUD routes in v1.** All create/update/delete flows happen via `form_submit` interactions on the `admin` route. This keeps the route surface small and marketplace-audit-friendly. Programmatic API access for third-party integrations is a v1.1 item.

---

## 5. Admin UI

**Descriptor declares three top-level pages:**
```typescript
adminPages: [
  { path: "/",            label: "Forms",       icon: "list" },
  { path: "/submissions", label: "Submissions", icon: "inbox" },
  { path: "/settings",    label: "Settings",    icon: "settings" }
]
```

Settings is rendered manually by the admin dispatcher (see §3.2) since Standard plugins don't have auto-generated settings UI.

### 5.1 Page dispatcher

Inside the `admin` route, parse `interaction.page` against these patterns (in order):

| Pattern | Page |
|---|---|
| `/` | Forms list |
| `/forms/new` | Form builder (new) |
| `/forms/{id}/fields/{fieldId}` | Field editor |
| `/forms/{id}/submissions` | Per-form submissions list |
| `/forms/{id}` | Form builder (edit) |
| `/submissions` | All submissions |
| `/submissions/{id}` | Submission detail |
| `/settings` | Settings (form block per §3.2) |

Unknown paths fall back to `/`.

### 5.2 Page specifications

#### `/` — Forms list
**Renders:** `stats` block (Forms count, Submissions count, Unread count), header "Forms", primary action button "New form" (→ `/forms/new`), secondary dropdown "New from template" (5 options → seeds a form and navigates to `/forms/{id}`), then one `section` per form with:
- Text: title, slug, submission count + unread count
- Accessory: `overflow` menu with actions `edit`, `submissions`, `pause`/`activate`, `delete` (confirm dialog)

Empty state: `banner` with "No forms yet — create one or start from a template."

#### `/forms/new` and `/forms/{id}` — Form builder

**Form creation flow.** A form is persisted on its first save; there are no in-memory drafts. `/forms/new` renders a minimal page with `title` (required) and `slug` (auto-derived from title if blank) inputs plus a **Create** button. The field list, "Add field" control, and settings section are **not available on `/forms/new`** — they require a persisted form id. On Create the form is written with `fields: []` and the user routes to `/forms/{id}` for the full builder.

This mirrors the Block Kit constraint: every interaction is a server round-trip, so ephemeral client-side drafts aren't a pattern that works. Create early, iterate against storage.

**Renders:**
1. Header with form title, back button (→ `/`)
2. `form` block for form metadata: `text_input` for title, `text_input` for slug, `toggle` for status
3. Divider, header "Fields"
4. One `section` per field with overflow menu: `move_up`, `move_down`, `duplicate`, `edit`, `delete`
5. Disabled `move_up` for first field, disabled `move_down` for last
6. Bottom `actions` block: `select` element "Add field…" with 10 type options
7. Divider, header "Settings"
8. `form` block for form settings: submit label, success message, redirect URL, `toggle` for admin notifications, `toggle` for confirmation email, `toggle` for Turnstile (disabled with helper text if Turnstile keys not configured)
9. Notification subject/body text inputs, condition-gated on the notification toggles
10. Divider, final `actions` block: Save (primary), Cancel

**Handles:** `form_submit` action_ids:
- `save_form` — validate, persist via `ctx.storage.forms.put()`, toast "Saved", re-render
- `add_field` — append field with defaults, navigate to `/forms/{id}/fields/{newFieldId}`
- `field:move_top:{fieldId}` / `field:move_up:{fieldId}` / `field:move_down:{fieldId}` / `field:move_bottom:{fieldId}` — reorder, persist, re-render
- `field:duplicate:{fieldId}` — insert copy with new id
- `field:delete:{fieldId}` — remove, persist, re-render
- `field:edit:{fieldId}` — navigate to `/forms/{id}/fields/{fieldId}`

#### Reorder UX

Overflow menu options per field, in this order:

- Move to top
- Move up  *(disabled on the first field)*
- Move down  *(disabled on the last field)*
- Move to bottom
- Edit
- Duplicate
- Delete  *(confirm dialog)*

Each reorder is a server round-trip — Block Kit has no client-side state. "Move to top" and "Move to bottom" exist specifically so reordering across a long list doesn't require N individual moves. Tradeoff accepted: no drag-and-drop in v1, but the jump actions keep per-move latency tolerable through ~30 fields. Forms larger than that are an anti-pattern regardless.

#### `/forms/{id}/fields/{fieldId}` — Field editor
**Renders:** single `form` block. Shared inputs always visible: `type` (select), `id`, `label`, `required` (toggle), `placeholder`, `helpText`, `width` (radio full/half).

Type-specific inputs gated by `condition: { field: "type", eq: "X" }`:
- `options` — textarea, one `label|value` per line — for select, multi_select, checkbox, radio
- `rows`, `maxLength` — for textarea
- `maxLength` — for text_input
- `inputType` (select) — for text_input
- `min`, `max`, `step` — for number
- `min`, `max` — for date (ISO)
- `defaultValue` — for hidden

Conditional-logic editor: `condition` subsection with `field` (select populated with other field ids), `operator` (eq/neq/in), `value`. Optional.

Actions block: Save (primary), Cancel. Both navigate back to `/forms/{id}`.

#### `/submissions` — All submissions
**Renders:** header, filter `actions` block (form select, status select, date range is v1.1), then a `table` block:

```typescript
{
  type: "table",
  columns: [
    { key: "formTitle", label: "Form" },
    { key: "preview",   label: "Preview" },     // First 2–3 fields joined
    { key: "createdAt", label: "Submitted", format: "relative_time" },
    { key: "status",    label: "Status", format: "badge" }
  ],
  rows: [...],
  pagination: { cursor, hasMore }
}
```

Row click → `/submissions/{id}`. Pagination via `button` action_ids `page:next:{cursor}` / `page:prev:{cursor}`.

#### `/forms/{id}/submissions` — Per-form submissions
Same table as `/submissions`, pre-filtered to `formId`. Header shows form title. "Export CSV" button links to `/_emdash/api/plugins/emdash-forms/export/csv?formId={id}`.

#### `/submissions/{id}` — Submission detail
**Renders:** header, `fields` block with submission meta (submitted at, IP, user agent, referer, status), divider, `fields` block with every field's label → value from `submission.data`. `actions`: Mark as read / Mark as unread, Delete (confirm dialog), Back.

### 5.3 Form builder UX pattern (reference)

Locked in per migration plan §1.6. Summary: overflow-menu reorder (no DnD), `select`-element field-type picker, per-field editor on a sub-page with `condition`-gated type-specific settings, inline per-form settings on the same page as the field list. No preview in v1.

---

## 6. Site-side rendering

### 6.1 Astro component

Import path: `import EmDashForm from "emdash-forms/astro"`.

**Props:**
```typescript
interface EmDashFormProps {
  slug: string;                    // Required
  action?: string;                 // Override submit endpoint URL
  turnstileSiteKey?: string;       // Override global; optional
  class?: string;                  // Additional CSS classes
}
```

### 6.2 Runtime behavior

Client-side script:
1. On mount, GET `/_emdash/api/plugins/emdash-forms/definition?slug={slug}`.
2. Render fields into the DOM via a `renderField(field)` function per field type.
3. Attach conditional-logic evaluator: on any field `change` / `input` event, re-evaluate all `condition` rules and toggle `display: none` on affected wrappers.
4. If form's `spamProtection === "turnstile"` and a site key is available (prop or response), inject the Turnstile script and widget.
5. On submit: prevent default, serialize form as JSON (multi-select collapses to array), POST to `action` (defaults to `/_emdash/api/plugins/emdash-forms/submit`) with body `{ formSlug, data, "cf-turnstile-response"?, _emdash_hp }`. Content type is `application/json` only.
6. Handle response: show success message inline, honor `redirect` if present, show error with `errors[]` on validation failure, generic message on network error.

**Content type.** The `submit` route accepts `application/json` only. Progressive enhancement (form-encoded fallback for JS-disabled clients) is explicitly out of scope for v1: the component renders fields client-side from the `definition` response, so there is no form to submit without JS. A v1.1 server-rendered fallback mode would add form-encoded acceptance — tracked in Future.

### 6.3 Conditional logic (client-side)

Operators match `FieldCondition`: `eq`, `neq`, `in`. Evaluator is ~30 LOC of pure JS. Each conditional field wrapper gets a `data-condition` attribute. Evaluation runs after every input change + on initial load.

**Two kinds of "hidden" to distinguish:**

- **Hidden field type** (`type: "hidden"`) — a field whose `defaultValue` is **always** included in the submission. Used for tracking params (UTM source, referrer, static tenant id). Not user-visible; not gated by any condition.
- **Conditionally hidden fields** (`condition` evaluates false) — any field type whose `condition` rule currently resolves false. Not rendered in the DOM. **Not submitted** — the client-side serializer excludes them before POST, even if the browser would otherwise include their last-set value.

A `type: "hidden"` field CAN also have a `condition`; if the condition is false, it is excluded from submission like any other conditionally hidden field. In practice, condition-gating a hidden field is unusual but legal.

### 6.4 CSS theming

Defaults follow the Workspace/Notion aesthetic currently in `src/astro/EmDashForm.astro` (Inter, zinc-tinted neutral borders, 4px radius). Variables:

```css
.emdash-form {
  --fw-accent:     #37352f;
  --fw-accent-fg:  #ffffff;
  --fw-radius:     4px;
  --fw-border:     rgba(55, 53, 47, 0.16);
  --fw-ring:       rgba(35, 131, 226, 0.35);
  --fw-font:       'Inter', system-ui, sans-serif;
  --fw-error:      #eb5757;
}
```

Consumers override on `.emdash-form` or `:root`. Documented in README, not configurable through plugin settings (design is a consumer concern, not a plugin concern).

---

## 7. Notifications

### 7.1 Merge tags

Syntax: `{{fieldId}}`. Replaced with the submitted value; missing fields render as empty string. HTML-escaped in `adminBody` / `confirmationBody` contexts. No nested expressions, no conditionals, no filters — keep it Mustache-lite.

Tags supported in: `adminSubject`, `adminBody`, `confirmationSubject`, `confirmationBody`, `FormSettings.redirectUrl`, `FormSettings.successMessage`.

### 7.2 Admin email

Sent when `notifications.notifyAdmin === true`. Recipient resolution order:
1. `form.settings.notifications.adminEmail`
2. `settings:defaultAdminEmail`
3. Skip silently (no recipient is not a hard error).

**Shape** (defaults when `adminBody` is not customized):
```
Subject: New submission: {form.title}

<h2>New submission — {form.title}</h2>
<table>
  {for each field in data}
  <tr><td>{label}</td><td>{value}</td></tr>
</table>
```

`ctx.email.send({ to, subject, text, html })`. No `from` — the provider plugin controls sender.

### 7.3 Confirmation email

Sent when `notifications.confirmationEmail === true` AND the submission contains an email-type field (preferred order: first field with `type: "email"`, then first field with id `email`, case-insensitive). Silently skipped if no recipient identified.

### 7.4 No provider — auto-disable + banner

If `ctx.email` is undefined (the `email:send` capability is granted but no `email:provide` plugin is configured), notifications are skipped. No error, no retry queue in v1.

On the `/` admin page, if any form has `notifyAdmin` or `confirmationEmail` enabled AND `ctx.email` is absent:

```json
{
  "type": "banner",
  "variant": "alert",
  "title": "Email notifications are disabled",
  "description": "Install an email provider to enable notifications.",
  "accessory": {
    "type": "button",
    "text": "Install Resend",
    "url": "https://marketplace.emdashcms.com/plugins/emdash-resend"
  }
}
```

> **⚠ Assumption:** programmatic plugin installation is not part of the 0.5.0 plugin SDK (not documented in `SKILL.md` or `installing.mdx`). We use a **marketplace deep link** to `marketplace.emdashcms.com/plugins/emdash-resend`. Verify the URL pattern once the marketplace front-end is public; current evidence shows the API at that subdomain but no confirmed UI route. If programmatic install becomes available later, swap to an inline button in v1.1.

---

## 8. Spam protection

### 8.1 Honeypot (default)

Hidden input with `name="_emdash_hp"`, `tabindex="-1"`, `autocomplete="off"`, wrapped in a CSS-hidden container (not `display: none` — some bots detect that; use `position:absolute; left:-9999px`). Real users don't see or fill it.

Submit handler: if `_emdash_hp` is non-empty, respond `{ success: true, message: settings.successMessage }` without storing. Log at info level. No delay, no rate limit.

### 8.2 Turnstile (opt-in)

Admin configures global site key + secret key in settings. Per-form toggle in form builder (disabled with helper text if keys are not configured).

**Render:** Astro component injects `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` and a `<div class="cf-turnstile" data-sitekey="...">` when site key is available.

**Verify:** submit handler POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify`:
```json
{
  "secret": "{turnstileSecretKey}",
  "response": "{cf-turnstile-response}",
  "remoteip": "{request.headers['cf-connecting-ip']}"
}
```
On `{ success: false }`: respond 403 `{ error: "Spam check failed. Please try again." }`.

Honeypot and Turnstile are mutually exclusive per form (`spamProtection: "honeypot" | "turnstile"`). Honeypot always runs as a sanity net regardless of setting — cost is zero.

---

## 9. Templates

Seeded on `plugin:install` if no forms exist. Users can also create new forms from a template via the "New from template" dropdown on `/`.

### 9.1 Contact

```typescript
{
  id: "contact",
  title: "Contact Form",
  description: "Name, email, message.",
  fields: [
    { type: "text_input", id: "name",    label: "Your name",    required: true, placeholder: "Jane Smith" },
    { type: "email",      id: "email",   label: "Email address",required: true, placeholder: "jane@example.com" },
    { type: "textarea",   id: "message", label: "Message",      required: true, rows: 5, placeholder: "How can we help?" }
  ],
  defaultSettings: {
    submitLabel: "Send Message",
    successMessage: "Thanks! We'll be in touch soon.",
    notifications: { notifyAdmin: true, confirmationEmail: false }
  }
}
```

### 9.2 Lead Capture

Fields: `name` (text_input, required), `email` (email, required), `company` (text_input, optional), `interest` (select — "Product demo", "Pricing", "Partnership", "Other", required).

### 9.3 Event Registration

Fields: `name`, `email`, `ticketType` (radio — "General", "VIP", "Student"), `dietaryRequirements` (textarea, optional — "Let us know if you have any dietary requirements").

### 9.4 Survey

Fields: `satisfaction` (select — "Very satisfied" / "Satisfied" / "Neutral" / "Dissatisfied" / "Very dissatisfied"), `features` (checkbox with options — "Reporting", "Integrations", "Mobile", "API", "Team features"), `nps` (number, min 0, max 10, label "How likely are you to recommend us? (0–10)"), `feedback` (textarea, optional — "Anything else?").

### 9.5 Callback Request

Fields: `name` (text_input, required), `phone` (text_input, `inputType: "tel"`, required), `preferredTime` (select — "Morning", "Afternoon", "Evening"), `notes` (textarea, optional).

Job application template is deferred to v1.1 with file upload.

---

## 10. Error handling

**Standard shape (all routes):**
```typescript
{ error: string, errors?: string[] }
```

**Status conventions:**

| Status | Meaning | Used when |
|---|---|---|
| 200 | Success | Normal responses |
| 400 | Validation failure | Zod schema fails, required field missing, slug already exists on create |
| 403 | Spam check failed | Turnstile verify returned `success: false` |
| 404 | Not found | Form slug unknown, form paused (public routes treat paused as 404), submission id unknown |
| 409 | Conflict | Slug update collides with another form |
| 500 | Internal | Uncaught |

**Pattern:**
```typescript
// Non-500
throw new Response(
  JSON.stringify({ error: "Form not found" }),
  { status: 404, headers: { "Content-Type": "application/json" } }
);

// 500 — handled by framework, wrapped automatically
throw new Error("unexpected state");  // → 500 { error: "unexpected state" }
```

No retry logic, no rate limiting in v1 (Turnstile + honeypot is considered sufficient for launch). Rate limiting goes in v1.1.

---

## 11. Build & publish

### 11.1 Bundle configuration

`tsdown.config.ts` produces two ESM outputs:

| Input | Output | Externals |
|---|---|---|
| `src/index.ts` | `dist/index.mjs` | `emdash`, `@emdash-cms/*`, `astro` |
| `src/sandbox-entry.ts` | `dist/sandbox-entry.mjs` | none (fully self-contained) |

Minified. Tree-shaken. No Node built-ins — verified by the `emdash plugin bundle` validator.

### 11.2 Bundle expectations

- Total `.tar.gz` size: under 500 KB (well below the 5 MB marketplace limit)
- `backend.js` (our `sandbox-entry.mjs`): 150–250 KB minified
- No `admin.js` output — Block Kit admin is in-band with the sandbox entry
- `README.md` bundled
- `icon.png` at 256×256
- 3 screenshots in `screenshots/`: forms list, form builder, submission detail

### 11.3 Marketplace submission checklist

- [ ] `emdash plugin bundle` runs clean — no sandbox-incompat warnings. Phase 0 confirmed this passes on a fresh build with `public: true` routes and no other features that trigger warnings.
- [ ] Bundle size under 5 MB
- [ ] Icon renders at 256×256 in the marketplace preview
- [ ] Screenshots render at full resolution
- [ ] README renders markdown correctly on marketplace listing
- [ ] Capability list on the consent dialog matches expectation: "Send email", "Make network requests to challenges.cloudflare.com"
- [ ] Version is bumped (first publish: `1.0.0`)
- [ ] GitHub release created with matching tag `v1.0.0`
- [ ] `emdash plugin login` via GitHub device auth succeeds
- [ ] `emdash plugin publish` returns `verdict: "pass"` or `"warn"` with acceptable findings
- [ ] Install counter visible at `marketplace.emdashcms.com/api/v1/plugins/emdash-forms` after a test install

---

## 12. Future (v1.1 and v2+)

### v1.1 — fast follow

- File upload field + job-application template (requires `write:media` + public presign route)
- Multi-step forms runtime + progress indicator
- Form preview in admin
- Duplicate form action
- Advanced submission filters (date range, text search)
- Per-form Turnstile override
- `phone` as a distinct field type (if community asks)
- Starred submissions
- Programmatic admin CRUD routes (for third-party integrations)
- Rate limiting on the `submit` route

### v2+ — later (likely premium add-ons as separate packages)

- Stripe / payment fields (`emdash-forms-stripe`)
- Webhook / Zapier integrations (`emdash-forms-webhooks`)
- Form analytics + conversion tracking
- A/B testing
- CRM sync (`emdash-forms-salesforce`, `emdash-forms-hubspot`)
- Scheduled submission digests
- Portable Text block for embedding forms in content (requires Native format — may never ship as Standard)

---

## 13. Development workflow

### 13.1 Branch and PR discipline

- Each phase (0–5 from the migration plan) is developed on its own branch named `phase/{number}-{short-name}` — e.g. `phase/0-scaffold`, `phase/1-write-path`, `phase/2-admin-read`, `phase/3-admin-write`, `phase/4-site-side`, `phase/5-publish`.
- At the end of each phase, a PR is opened against `main` with a summary of what shipped and what's verified.
- PRs are reviewed (by the maintainer) before merge. No direct commits to `main`.
- Each PR description includes:
  - **Implemented:** what's in the diff
  - **Tested:** what's been verified, how, against what environment
  - **Red team findings:** per §13.3 format
  - **Open questions / deferred:** anything punted
  - **Next:** the next phase's branch name
- Cross-phase refactoring gets its own branch + PR (`refactor/{short-name}`).

### 13.2 Red team testing

Before closing each phase's PR, run a red team pass appropriate to the scope. Blockers are fixed before merge; non-blockers are filed as issues tagged `red-team`.

**Phase 0 (scaffold).** No red team pass required — no runtime code yet.

**Phase 1 (write path).** Adversarial submit input:
- Malformed JSON, missing required fields, extra (unknown) fields
- SQL-injection-like strings in `slug` and field values
- XSS payloads in text fields (stored XSS → admin UI render)
- Oversized payloads (1 MB body)
- Bad / missing Turnstile tokens
- Unknown form slugs; slugs for paused forms
- Honeypot false-positive scenarios (accessibility tools filling hidden inputs)
- Concurrent submits to the same form — does `submissionCount` double-count?
- Submissions when no email provider is installed
- Merge tag injection attempts: `{{system}}`, `{{../secret}}`, `{{constructor.constructor('...')}}`

**Phase 2 (admin read path).** Privilege escalation:
- Can an unauthenticated user hit the `admin` route?
- Can a user with read-only access mutate data?
- CSV export with crafted field values (formula injection: `=SUM()`, `@SUM()`, `+SUM()`, `-SUM()` — prefix with `'` or strip)
- Pagination cursor tampering (malformed, from a different collection)
- Large result sets (10k submissions — does the list page crash or time out?)

**Phase 3 (admin write path).** Form builder adversarial input:
- Creating a form with slug `admin` or `new` — routing collision?
- Creating two forms with the same slug — does `uniqueIndex` actually enforce?
- Field IDs with special characters (`../`, `'`, whitespace, unicode)
- Field count stress (100 fields — does the UI still work?)
- Conditional logic loops (field A depends on B, B depends on A)
- Template injection via field labels

**Phase 4 (site-side rendering).** Client-facing surface:
- CORS on public routes — who's allowed to call `submit` and `definition`?
- Cross-origin submit attempts from an unrelated site
- XSS in rendered form fields from the `definition` response
- Turnstile widget injection / config tampering
- Double-submission handling (network hiccup, user clicks Submit twice)
- Replay attacks (resubmit the same payload)
- Conditionally-hidden fields being submitted anyway via crafted client
- Honeypot bypass attempts

**Phase 5 (polish and publish).** Distribution:
- Bundle audit findings — any warn or fail from the marketplace audit pipeline
- Capability consent dialog accuracy — does the listed permission match reality?
- Plugin-uninstall cleanliness — does storage survive? should it?
- Version upgrade path (0.9.0 → 1.0.0 migration — none expected; v1 is first public release; confirm nothing breaks on reinstall)
- README accuracy — do all documented steps actually work on a fresh install?

### 13.3 Red team findings format

Findings live in the PR description. Issues filed from "Non-blockers" are tagged `red-team` for tracking.

```markdown
## Red team findings

### Blockers (fix before merge)
- <finding> — <fix or mitigation>

### Non-blockers (file as issues)
- <finding> — <link to issue or "will file post-merge">

### Confirmed safe
- <attack vector> — <why it's not exploitable>
```

---

**End of v1 specification.** See `SPEC.md` (original, retained as historical context) and the migration plan (produced separately) for background.
