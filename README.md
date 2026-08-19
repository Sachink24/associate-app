# Solitaire Finz Mart — Associate App

> A modern web-based Associate / DSA workflow application for managing lending operations, customer cases, documentation, credit, legal processing, technical evaluation, WhatsApp communication, and case tracking.

[![Live App](https://img.shields.io/badge/Live%20App-GitHub%20Pages-111827?style=for-the-badge)](https://sachink24.github.io/associate-app/) [![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Sachink24/associate-app) [![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)

## Overview

**Solitaire Finz Mart — Associate App** is a lightweight, browser-based lending operations platform designed for Associates / DSAs and internal teams (Business Associates, Legal, Technical, Credit, and Owner/Admin roles).

The application provides a centralized workflow for handling customer and loan-case information and connects operational pages such as:

- Associate / customer case management
- Lead and application information
- Document and data collection
- Credit-related case processing
- Legal evaluation
- Technical evaluation
- WhatsApp client communication (templates, automation hints, history)
- Case status tracking
- Internal operational coordination
- Privacy, legal and compliance information

The project is built as a deployable web application (no build step — plain HTML/CSS/JS) and uses **Supabase** for backend connectivity, authentication, and Row Level Security.

## Live Application

**Live App:**
<https://sachink24.github.io/associate-app/>

**Repository:**
<https://github.com/Sachink24/associate-app>

## Main Modules

### 🏠 Associate / Main Application (`index.html`)

The main application acts as the central workspace for Associates and lending operations — lead intake, case pipeline, role-based dashboards, real-time Supabase sync, and the WhatsApp communication hub.

Typical workflow:

```
Lead / Customer
      ↓
Case Entry
      ↓
Data & Document Collection
      ↓
Credit Evaluation
      ↓
Legal Evaluation
      ↓
Technical Evaluation
      ↓
Sanction / Further Processing
      ↓
Disbursement
      ↓
Payout / Closure
```

### 💳 Credit Evaluation (`credit.html`)

A dedicated Credit Team module supporting a structured, multi-stage case pipeline covering document checklists, credit/financial analysis, an internal risk matrix, internal credit scoring, and a rich-text credit report writer with PDF export.

### ⚖️ Legal Evaluation (`legal.html`)

A dedicated page for legal-related information and evaluation workflows, including a "Pull Lead" tool that prefills the legal evaluation report directly from the `leads` table via `supabase-config.js`.

The legal section is used to organize and display:

- Property/legal information
- Legal observations
- Document status
- Verification requirements
- Legal remarks
- Case-level compliance information

### 🏗️ Technical Evaluation (`technical.html`)

A dedicated page for technical/property evaluation, also wired to "Pull Lead" via `supabase-config.js`.

It supports information such as:

- Property details
- Site/technical observations
- Construction details
- Property condition
- Valuation-related information
- Technical remarks
- Evaluation status

Both `legal.html` and `technical.html` save structured evaluation data to the `evaluation_reports` table (upserted on `report_type` + `loan_app_no`) with supporting files stored in the `evaluation-media` storage bucket.

### 🟢 WhatsApp Communication Hub

Built into `index.html` via `whatsapp-module.js` (schema in `whatsapp-schema.sql`). Adds a per-lead **WhatsApp** action button and an admin hub for templates, automation toggles, and communication history.

- Auto-suggests a message template based on the lead's current pipeline stage; 8 default templates ship out of the box (New Lead, KYC Documents Required, KYC Completed, Legal Verification, Technical Verification, Sanction, Documentation, Disbursement).
- Pure `wa.me` click-to-chat — **no WhatsApp API keys or secrets** are stored in the frontend. Sends are logged as `Sent` (opened) or `Failed` (bad number) only — no delivery/read confirmation is ever claimed.
- Mobile numbers auto-normalized to `+91XXXXXXXXXX`.
- Role-scoped visibility: Admin/Owner sees the full hub (template CRUD, automation settings, full history); Associates, Legal, and Technical see only their own sent history and role-relevant templates.
- Falls back to browser `localStorage` if the Supabase WhatsApp tables haven't been created yet.
- See [`WHATSAPP_SETUP.md`](./WHATSAPP_SETUP.md) for the full setup and rollout notes.

### 🔐 Privacy & Legal (`privacy.html`, `legal.html`)

Static, user-facing privacy, terms and legal information pages that do not require backend calls.

## Project Structure

```
associate-app/
│
├── index.html
│   └── Main Associate / Application interface + WhatsApp hub
│
├── credit.html
│   └── Credit Evaluation module
│
├── technical.html
│   └── Technical Evaluation module (Supabase "Pull Lead")
│
├── legal.html
│   └── Legal Evaluation module (Supabase "Pull Lead")
│
├── privacy.html
│   └── Privacy Policy
│
├── supabase-config.js
│   └── Shared Supabase client + SolitaireDB helpers (getLeadById, searchLeads, mapLeadToReportData)
│
├── whatsapp-module.js
│   └── WhatsApp templates, automation hints, and history (WhatsAppService)
│
├── whatsapp-schema.sql
│   └── whatsapp_templates / whatsapp_messages / whatsapp_settings tables (RLS enabled)
│
├── WHATSAPP_SETUP.md
│   └── WhatsApp module install/rollout guide
│
├── SECURITY.md
│   └── Security policy
│
├── .github/workflows/
│   └── GitHub Actions / CI configuration
│
└── README.md
    └── Project documentation
```

## Technology Stack

| Technology   | Purpose                                        |
| ------------ | ----------------------------------------------- |
| HTML5        | Application structure                            |
| CSS3         | Responsive user interface                        |
| JavaScript   | Application logic and interactions               |
| Supabase     | Database, Auth, Row Level Security, real-time sync |
| GitHub       | Source-code repository                           |
| GitHub Pages | Static web deployment                            |

## Backend

The application is designed to work with **Supabase** (project `nbpvamrwzqrgoiwpadwc`), which provides:

- Database storage (`users`, `leads`, `loan_applications`, `threads`, `thread_members`, `messages`, `thread_summaries`, `business_associates`, `legal_team`, `technical_team`, `evaluation_reports`, `cibil_scores`, `feed_entries`, `whatsapp_*`, and more)
- Authentication
- Row Level Security (RLS), including role tables (`roles`, `permissions`, `role_permissions`) and helper functions (`current_user_role()`, `is_admin_or_owner()`)
- API access
- Case and operational data management

### 🔑 Authentication & RBAC (in progress)

The app is migrating from open/anon-role RLS policies to **Supabase Auth**-backed, role-scoped access:

- Auth accounts have been provisioned for all users.
- `roles` / `permissions` / `role_permissions` tables are seeded with 9 roles.
- `current_user_role()` and `is_admin_or_owner()` SQL helper functions are in place.
- Authenticated-only, role-scoped RLS policies have replaced insecure open policies on sensitive tables.
- **Remaining:** the associate-app login flow and `syncToSupabase()` need to be patched to call `supabase.auth.signInWithPassword()` instead of the legacy custom-auth path.

### Security Note

Frontend applications normally contain a Supabase publishable/anonymous key. This key is **not** a substitute for database security.

**Row Level Security (RLS) must be correctly configured on every production table**, and production tables should ultimately require an authenticated session rather than relying on the `anon` role.

Never place:

- Service-role keys
- Private API keys
- Database passwords
- Server secrets
- Authentication secrets

inside frontend source code or a public repository.

See [`SECURITY.md`](./SECURITY.md) for the full security policy, including recent hardening (CodeQL fixes: subresource integrity on CDN scripts, removal of clear-text credential storage patterns).

## Deployment

This project is suitable for deployment using **GitHub Pages**.

### GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Select the `main` branch.
5. Select the root folder `/`.
6. Save the configuration.

The application can then be accessed through:

```
https://sachink24.github.io/associate-app/
```

## Local Development

Because the project is a static HTML/CSS/JavaScript application with no build step, it can be tested locally without a complex toolchain.

### Option 1 — Open directly

Open `index.html` in a modern browser.

### Option 2 — Local server

For better browser compatibility (module scripts, fetch calls), run the project through a local web server.

```
git clone https://github.com/Sachink24/associate-app.git
cd associate-app
```

Then serve the folder using your preferred local development server.

### Adding the WhatsApp module to a fresh clone

If a checkout is missing the WhatsApp files, follow [`WHATSAPP_SETUP.md`](./WHATSAPP_SETUP.md): run `whatsapp-schema.sql` once in the Supabase SQL editor, then ensure `whatsapp-module.js` sits alongside `index.html`.

## Recommended Production Practices

Before using the application for real customer or lending data:

- Complete the Supabase Auth migration (`signInWithPassword()` on login, authenticated-only RLS everywhere).
- Enable and test Supabase RLS policies on every table, including the WhatsApp tables.
- Use proper authentication and role-based access (`roles` / `permissions` / `role_permissions`).
- Do not expose service-role credentials.
- Validate all user input.
- Add audit logging for important case changes (`audit_logs`, append-only).
- Restrict access to customer and financial information.
- Use HTTPS in production.
- Regularly review database permissions and `pg_policies`.
- Keep legal and privacy documents updated.
- Back up important operational data.

## Workflow Philosophy

The application is designed around a **case-based lending workflow**, where a customer case moves through multiple operational stages while maintaining relevant information and status.

```
ASSOCIATE
   │
   ├── Lead Entry
   ├── Customer Data
   ├── Documents
   │
   ▼
CREDIT
   │
   ├── Eligibility
   ├── Financial Analysis
   └── Credit Decision
   │
   ▼
LEGAL
   │
   ├── Document Verification
   ├── Property Legal Check
   └── Legal Opinion
   │
   ▼
TECHNICAL
   │
   ├── Site Evaluation
   ├── Property Assessment
   └── Technical Opinion
   │
   ▼
SANCTION
   │
   ▼
DISBURSEMENT
   │
   ▼
PAYOUT / CLOSURE
```

Client communication (via the WhatsApp hub) runs alongside every stage above, triggered manually or suggested automatically as a lead's stage changes.

## Future Enhancements

Potential future modules include:

- Full Supabase Auth cutover across all apps in the ecosystem
- Admin control panel (Control Panel / CRM-ERP with ~30 modules)
- Loan product management & Bank/NBFC product mapping
- Automated case status transitions
- WhatsApp Business Cloud API (server-side) upgrade path
- Sanction, disbursement, and payout tracking
- Notifications and reminders
- Advanced reporting & MIS dashboards
- Activity/audit logs across all modules
- AI-assisted document and case analysis

## Important

This repository is an operational software project. It should not be treated as a replacement for the underwriting, legal, technical, compliance, or approval policies of any bank, NBFC, lender, or regulated financial institution.

All lending decisions should remain subject to the applicable lender's policies, documentation, verification and approval process.

## License

Unless a separate license file is added to this repository, the source code should be considered **all rights reserved** by the repository owner.

For commercial use, redistribution, modification or integration, obtain appropriate permission from the project owner.

---

### Solitaire Finz Mart

**Associate • Credit • Legal • Technical • WhatsApp • Lending Operations**

Built to bring the lending case workflow into one organized digital platform.
