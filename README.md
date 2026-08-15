# Solitaire Finz Mart — Associate App

> A modern web-based Associate / DSA workflow application for managing lending operations, customer cases, documentation, legal processing, technical evaluation, and case tracking.

[![Live App](https://img.shields.io/badge/Live%20App-GitHub%20Pages-111827?style=for-the-badge)](https://sachink24.github.io/associate-app/)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Sachink24/associate-app)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)

## Overview

**Solitaire Finz Mart — Associate App** is a lightweight, browser-based lending operations platform designed for Associates / DSAs and internal teams.

The application provides a centralized workflow for handling customer and loan-case information and connects operational pages such as:

- Associate / customer case management
- Lead and application information
- Document and data collection
- Credit-related case processing
- Legal evaluation
- Technical evaluation
- Case status tracking
- Internal operational coordination
- Privacy, legal and compliance information

The project is built as a deployable web application and uses **Supabase** for backend connectivity where required.

## Live Application

**Live App:**  
https://sachink24.github.io/associate-app/

**Repository:**  
https://github.com/Sachink24/associate-app

## Main Modules

### 🏠 Associate / Main Application

The main application is intended to act as the central workspace for Associates and lending operations.

Typical workflow:

```text
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

### ⚖️ Legal Evaluation

The repository includes a dedicated `legal.html` page for legal-related information and evaluation workflows.

The legal section can be used to organize and display:

- Property/legal information
- Legal observations
- Document status
- Verification requirements
- Legal remarks
- Case-level compliance information

### 🏗️ Technical Evaluation

The repository includes `technical.html` for technical/property evaluation.

It can support information such as:

- Property details
- Site/technical observations
- Construction details
- Property condition
- Valuation-related information
- Technical remarks
- Evaluation status

### 🔐 Privacy & Legal

The repository includes `privacy.html` and `legal.html` to provide user-facing privacy, terms and legal information.

These pages are designed to remain static and do not require direct backend calls.

## Project Structure

```text
associate-app/
│
├── index.html
│   └── Main Associate / Application interface
│
├── technical.html
│   └── Technical Evaluation module
│
├── legal.html
│   └── Legal / Terms information
│
├── privacy.html
│   └── Privacy Policy
│
├── supabase-config.js
│   └── Shared Supabase client configuration
│
├── SECURITY.md
│   └── Security policy
│
├── .github/
│   └── GitHub Actions / workflow configuration
│
└── README.md
    └── Project documentation
```

## Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application structure |
| CSS3 | Responsive user interface |
| JavaScript | Application logic and interactions |
| Supabase | Backend / database connectivity |
| GitHub | Source-code repository |
| GitHub Pages | Static web deployment |

## Backend

The application is designed to work with **Supabase**.

Supabase can provide:

- Database storage
- Authentication
- Row Level Security (RLS)
- API access
- Case and operational data management

### Security Note

Frontend applications normally contain a Supabase publishable/anonymous key. This key is not a substitute for database security.

**Row Level Security (RLS) must be correctly configured on every production table.**

Never place:

- Service-role keys
- Private API keys
- Database passwords
- Server secrets
- Authentication secrets

inside frontend source code or a public repository.

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

```text
https://sachink24.github.io/associate-app/
```

## Local Development

Because the project is primarily a static HTML/CSS/JavaScript application, it can be tested locally without a complex build system.

### Option 1 — Open directly

Open:

```text
index.html
```

in a modern browser.

### Option 2 — Local server

For better browser compatibility, run the project through a local web server.

Example:

```bash
git clone https://github.com/Sachink24/associate-app.git
cd associate-app
```

Then serve the folder using your preferred local development server.

## Recommended Production Practices

Before using the application for real customer or lending data:

- Enable and test Supabase RLS policies.
- Use proper authentication and role-based access.
- Do not expose service-role credentials.
- Validate all user input.
- Add audit logging for important case changes.
- Restrict access to customer and financial information.
- Use HTTPS in production.
- Regularly review database permissions.
- Keep legal and privacy documents updated.
- Back up important operational data.

## Workflow Philosophy

The application is designed around a **case-based lending workflow**, where a customer case can move through multiple operational stages while maintaining relevant information and status.

A scalable future workflow can be structured as:

```text
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

## Future Enhancements

Potential future modules include:

- Role-based dashboards
- Admin control panel
- Associate management
- Customer/lead management
- Loan product management
- Bank/NBFC product mapping
- Credit assessment
- Document checklist
- Automated case status
- Legal report generation
- Technical report generation
- PDF report generation
- Sanction tracking
- Disbursement tracking
- Payout calculation
- Notifications and reminders
- Advanced reporting
- MIS dashboards
- Activity/audit logs
- AI-assisted document and case analysis

## Important

This repository is an operational software project. It should not be treated as a replacement for the underwriting, legal, technical, compliance, or approval policies of any bank, NBFC, lender, or regulated financial institution.

All lending decisions should remain subject to the applicable lender's policies, documentation, verification and approval process.

## License

Unless a separate license file is added to this repository, the source code should be considered **all rights reserved** by the repository owner.

For commercial use, redistribution, modification or integration, obtain appropriate permission from the project owner.

---

### Solitaire Finz Mart

**Associate • Credit • Legal • Technical • Lending Operations**

Built to bring the lending case workflow into one organized digital platform.
