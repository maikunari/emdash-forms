# emdash-forms — Plugin Spec v0.1

**Goal:** Best-in-class forms plugin for EmDash. MIT licensed, open source.
**Repo:** maikunari/emdash-forms (create on GitHub)
**Reference:** Gravity Forms / WPForms Pro feature parity for core + templates

---

## What We're Building (v1 scope)

### Core Features
- Field types: text, email, phone, textarea, select, multi-select, checkbox, radio, number, date, hidden, file upload
- Conditional logic — show/hide fields based on other field values (Block Kit `condition` already supports this natively)
- Multi-step forms with progress indicator
- Form-level settings: success message, redirect on submit, submit button label
- Spam protection via Cloudflare Turnstile (free, built into Workers)

### Submissions
- All submissions stored in D1 (auto-migrated on install)
- Admin UI via Block Kit: table view of submissions, per-form filter, export CSV
- Mark as read/unread, delete

### Notifications
- Email to admin on submission (via `ctx.email` — Resend under the hood)
- Confirmation email to submitter (optional, toggled per form)
- Custom subject + body with `{{field_name}}` merge tags

### Templates (ship 6 at launch)
1. Contact form (name, email, message)
2. Lead capture (name, email, company, interest)
3. Event registration (name, email, ticket type, dietary requirements)
4. Job application (name, email, resume upload, cover letter)
5. Survey (multiple choice + rating scale + open text)
6. Callback request (name, phone, preferred time)

---

## Technical Architecture

### Plugin Format: Standard (sandboxed-compatible)
```
emdash-forms/
├── src/
│   ├── index.ts            # Descriptor factory
│   ├── sandbox-entry.ts    # definePlugin() — hooks + routes
│   └── templates/          # JSON form configs
│       ├── contact.ts
│       ├── lead-capture.ts
│       ├── event-registration.ts
│       ├── job-application.ts
│       ├── survey.ts
│       └── callback.ts
├── package.json
└── tsconfig.json
```

### Capabilities Needed
```typescript
capabilities: [
  "db:read",
  "db:write",
  "email:send",
  "storage:write",   // for file uploads → R2
  "network:fetch",   // for Turnstile verification
]
```

### Storage Schema (D1)
```sql
-- Forms definition table
CREATE TABLE emdash_forms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  config JSON NOT NULL,        -- full form schema
  settings JSON NOT NULL,      -- notifications, redirects, etc.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Submissions table
CREATE TABLE emdash_form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data JSON NOT NULL,          -- field values keyed by field id
  metadata JSON,               -- IP, user agent, etc.
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (form_id) REFERENCES emdash_forms(id)
);
```

### Hooks Used
- `content:afterSave` — not needed for v1
- Plugin exposes its own API routes for form submission endpoint

### Routes
```typescript
routes: {
  // Public: receive form submission
  "POST /submit/:formSlug": submitHandler,

  // Admin: CRUD forms
  "GET /forms": listForms,
  "POST /forms": createForm,
  "PUT /forms/:id": updateForm,
  "DELETE /forms/:id": deleteForm,

  // Admin: submissions
  "GET /submissions/:formId": listSubmissions,
  "DELETE /submissions/:id": deleteSubmission,
  "POST /submissions/:id/read": markRead,
  "GET /submissions/:formId/export": exportCsv,

  // Admin Block Kit UI
  "admin": adminHandler,   // Block Kit dashboard
}
```

### Admin UI (Block Kit)
Pages:
1. **Dashboard** — stats (total forms, total submissions, recent activity)
2. **Forms list** — table of forms with submission counts, edit/delete actions
3. **Form builder** — field list, add/reorder/remove fields, settings panel
4. **Submissions** — table view, per-form filter, mark read, export CSV
5. **Settings** — global defaults (from email, Turnstile site key)

### Form Rendering (site-side)
Since sandboxed plugins can't ship Astro components, the form rendering will be:
- An Astro component users add to their site: `<EmDashForm slug="contact" />`
- Shipped as a separate `@emdash-forms/astro` package (native plugin or user installs manually)
- OR: plugin exposes form config via API route, user renders with provided component

**Decision:** Ship a simple Astro component as a separate package users drop into their site. Not sandboxed, just a component. Keeps it clean.

### Spam Protection
```typescript
// Turnstile verification in submit handler
const turnstileRes = await ctx.http.fetch(
  "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  {
    method: "POST",
    body: JSON.stringify({
      secret: settings.turnstileSecretKey,
      response: body["cf-turnstile-response"],
    }),
  }
);
```

---

## Conditional Logic Schema
```json
{
  "type": "text_input",
  "action_id": "company_name",
  "label": "Company Name",
  "condition": {
    "field": "contact_type",
    "eq": "business"
  }
}
```
This matches EmDash Block Kit's native condition format — no extra work needed.

---

## Multi-Step Forms
Store current step in form state. Each step is an array of fields. Progress bar rendered via Block Kit `meter` block. Navigation buttons via `actions` block.

---

## File Uploads
- Field type `file_upload` generates a pre-signed R2 URL
- File uploaded directly to R2 from browser
- Submission stores R2 key reference, not the file itself
- Admin can view/download from submissions panel

---

## Template Format
Each template is a plain JSON config:
```typescript
export const contactTemplate = {
  title: "Contact Form",
  slug: "contact",
  fields: [
    { type: "text_input", id: "name", label: "Your Name", required: true },
    { type: "text_input", id: "email", label: "Email Address", required: true, inputType: "email" },
    { type: "textarea", id: "message", label: "Message", required: true, rows: 5 },
  ],
  settings: {
    submitLabel: "Send Message",
    successMessage: "Thanks! We'll be in touch soon.",
    notifyAdmin: true,
    confirmationEmail: false,
  },
};
```

---

## v1 Out of Scope
- Stripe / payment fields (v2)
- Zapier / webhook integrations (v2)
- Form analytics / conversion tracking (v2)
- A/B testing (v3 maybe)
- Salesforce / HubSpot CRM sync (v2)

---

## Build Order for Owsley

1. Scaffold plugin package structure + TypeScript setup
2. D1 schema + migration system
3. Core field types + form config schema (TypeScript types)
4. Submit route + Turnstile verification
5. Email notifications (admin + confirmation)
6. Admin Block Kit UI — forms list + submission table
7. Form builder UI (Block Kit)
8. File upload (R2 pre-signed URLs)
9. Multi-step form support
10. Conditional logic (leverage Block Kit native condition)
11. Astro component package (`@emdash-forms/astro`)
12. 6 templates
13. README + docs
14. GitHub repo + npm publish

---

## Repo Setup
- GitHub: `maikunari/emdash-forms`
- npm: `emdash-forms` (check availability)
- License: MIT
- README: lead with "Gravity Forms for EmDash" framing

---

## Design Direction (updated Apr 4 2026)

**Aesthetic:** shadcn/Vercel minimal — neutral, developer-first, adapts to any site.

### Default Visual Language
- Background: white / neutral-50
- Borders: 1px, zinc-200 (barely-there)
- Border radius: 6px (tight, not bubbly)
- Focus state: simple ring (ring-2 ring-zinc-900 ring-offset-1) — no glow
- Typography: system font stack or Inter, labels in small caps or semibold 12px
- Submit button: zinc-900 fill, white text, 6px radius, subtle hover opacity shift
- Error state: red-500 text below field, no red borders/boxes
- Success state: clean inline message, optional subtle fade-in

### Theming via CSS Custom Properties
```css
:root {
  --fw-accent: #18181b;        /* zinc-900 */
  --fw-accent-fg: #ffffff;
  --fw-radius: 6px;
  --fw-border: #e4e4e7;        /* zinc-200 */
  --fw-ring: #18181b;
  --fw-font: var(--font-sans, system-ui);
  --fw-error: #ef4444;
}
```
One CSS variable override = full rebrand. Document this prominently in README.

### Anti-patterns to avoid
- No colored borders on focus (only ring)
- No drop shadows on fields
- No floating labels (top-aligned only)
- No placeholder-as-label
- No emoji in field labels
- No gradient buttons
