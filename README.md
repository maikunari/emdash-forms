# emdash-forms

**The forms plugin EmDash deserves.** Beautiful, secure, and dead simple to deploy.

Contact forms, lead capture, surveys, event registration, job applications, and more. Built on Cloudflare D1, R2, and Turnstile. Designed with a shadcn/minimal aesthetic that adapts to any site.

## Features

- **12 field types** — text, email, phone, textarea, select, multi-select, checkbox, radio, number, date, hidden, file upload
- **Conditional logic** — show/hide fields based on other field values
- **Multi-step forms** — with progress indicator
- **Spam protection** — Cloudflare Turnstile (free, built into Workers)
- **Email notifications** — admin alerts + submitter confirmation with `{{merge_tags}}`
- **Submissions dashboard** — view, filter, mark read/unread, export CSV
- **Form builder** — visual admin UI via Block Kit
- **6 templates** — contact, lead capture, event registration, job application, survey, callback request
- **Astro component** — drop-in `<EmDashForm slug="contact" />` for your site
- **Theming** — one CSS variable override = full rebrand

## Quick Start

### 1. Install the plugin

```bash
npm install emdash-forms
```

### 2. Register in your EmDash config

```typescript
import emdashForms from "emdash-forms";

export default {
  plugins: [emdashForms()],
};
```

### 3. Add a form to your site

```astro
---
import EmDashForm from "emdash-forms/astro";
---

<EmDashForm slug="contact" />
```

### 4. Configure in admin

Open the EmDash admin panel → **Forms** → create a form or use a template.

## Theming

emdash-forms ships with a shadcn/Vercel-inspired minimal design. Override any CSS custom property to match your brand:

```css
:root {
  --fw-accent: #18181b;        /* button + focus ring color */
  --fw-accent-fg: #ffffff;     /* button text */
  --fw-radius: 6px;            /* border radius */
  --fw-border: #e4e4e7;        /* input borders */
  --fw-ring: #18181b;          /* focus ring */
  --fw-font: system-ui;        /* font stack */
  --fw-error: #ef4444;         /* error text */
}
```

### Design principles

- Top-aligned labels only — no floating labels
- Focus state: ring only — no colored borders, no glow
- No drop shadows on fields
- System font stack by default
- Zinc-900 submit button with hover opacity shift

## Field Types

| Type | Description |
|------|-------------|
| `text_input` | Single-line text (supports `inputType`: text, email, url, tel) |
| `email` | Email input with validation |
| `phone` | Phone number input |
| `textarea` | Multi-line text with configurable rows |
| `select` | Dropdown select |
| `multi_select` | Multi-select dropdown |
| `checkbox` | Single checkbox or checkbox group |
| `radio` | Radio button group |
| `number` | Numeric input with min/max/step |
| `date` | Date picker |
| `hidden` | Hidden field with default value |
| `file_upload` | File upload via R2 presigned URLs |

## Conditional Logic

Show/hide fields based on other field values using Block Kit's native condition format:

```json
{
  "type": "text_input",
  "id": "company_name",
  "label": "Company Name",
  "condition": {
    "field": "contact_type",
    "eq": "business"
  }
}
```

## Templates

| Template | Fields |
|----------|--------|
| **Contact** | name, email, message |
| **Lead Capture** | name, email, company, interest |
| **Event Registration** | name, email, ticket type, dietary requirements |
| **Job Application** | name, email, phone, resume upload, cover letter |
| **Survey** | satisfaction rating, feature checkboxes, NPS, open feedback |
| **Callback Request** | name, phone, preferred time, notes |

## API Routes

### Public

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/submit/:formSlug` | Submit a form |

### Admin

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/forms` | List all forms |
| `POST` | `/forms` | Create a form |
| `PUT` | `/forms/:id` | Update a form |
| `DELETE` | `/forms/:id` | Delete a form |
| `GET` | `/submissions/:formId` | List submissions |
| `DELETE` | `/submissions/:id` | Delete a submission |
| `POST` | `/submissions/:id/read` | Mark as read |
| `GET` | `/submissions/:formId/export` | Export CSV |

## Spam Protection

emdash-forms uses [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) for spam protection. Configure your site key and secret key in the admin settings panel.

```astro
<EmDashForm slug="contact" turnstileSiteKey="0x..." />
```

## Email Notifications

Configure per-form in the admin panel:

- **Admin notification** — sends an email to the admin on every submission
- **Confirmation email** — sends a confirmation to the submitter (requires an `email` field)
- **Merge tags** — use `{{field_id}}` in subject/body templates

## License

MIT
