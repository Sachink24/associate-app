# Admin / Credit Team RBAC — Implementation Summary

**Repo used:** `sachink24/associate-app` (confirmed with you — `associate-appadmin` doesn't exist; this is the app behind `https://sachink24.github.io/associate-app/`)
**Supabase project:** `nbpvamrwzqrgoiwpadwc`, table `public.leads`

## Files changed

- **`index.html`** — the only frontend file touched. Copied to outputs as `index.html`; diff it against the repo's current version before committing.
- **`migration_admin_credit_rbac.sql`** — already applied live to your Supabase project via two migrations (`admin_credit_rbac_workflow`, `cleanup_redundant_select_policies`). Included here as a record — you don't need to re-run it, but keep it in the repo for history.

## Database changes (already live)

**New columns on `leads`:** `status` (state machine, backfilled from existing data), `credit_submitted_by`, `rework_reason`, `rework_requested_by/at`, `rejected_reason`, `rejected_by/at`, `approved_by/at`.

**New functions:**
- `credit_submit_recommendation()` — Credit's only path to submit; validates assignment + status, writes recommendation fields, flips status to `CREDIT_SUBMITTED_FOR_APPROVAL`, logs to `workflow_history`.
- `admin_approve_loan()` — Admin-only; validates status, sets `status='APPROVED'`, upserts into your existing `sanctions` table, logs audit.
- `admin_reject_loan()` — Admin-only; requires a reason, sets `status='REJECTED'`, logs audit.
- `admin_send_for_rework()` — Admin-only; requires instructions, sets `status='CREDIT_REWORK'`, re-opens the case for Credit, logs audit.
- `enforce_leads_update()` (trigger) — the real enforcement layer. Admin/Owner: unrestricted. Credit: can only touch their own assigned lead, only while status is editable, and only the recommendation columns (loan amount, term, ROI, fees, conditions, credit status/observation/recommendation) — every other column is locked even if a full-row upsert is sent. All other existing roles (business/legal/technical) are untouched.
- `log_lead_workflow()` — shared audit-logging helper into your existing `workflow_history` table.

**RLS changes:**
- `leads` INSERT — Credit Team excluded (`current_user_role() <> 'credit'`); every other existing role keeps its current ability to create leads, unchanged.
- No changes were needed to `sanctions`/`workflow_history` RLS — on closer inspection they already had correct admin-only-write, scoped-read policies from earlier work; I initially misread them as empty due to a truncated query result and added redundant policies, then removed them once I confirmed the pre-existing ones were already correct.

## Frontend changes (`index.html`)

- `leadToRow` / `rowToLead` / new-lead defaults — extended to carry the new `status` and audit columns.
- **Add Lead blocked for Credit** — both server-side (RLS) and client-side (`saveLead()` early-return + the capture card is shown read-only/disabled for `currentRole === 'credit'`, mirroring the existing `isCustomer` pattern). Legal/Technical/Business keep their existing ability to create leads — the spec only required blocking Credit, and removing it from other roles would break existing workflows.
- **Credit Recommendation panel** (`openCreditReport`) — now status-driven instead of boolean-driven. Shows a "sent back for rework" banner with Admin's instructions, or a rejection-reason banner, pulled from the new columns. Fields are editable only while `status` is in `NEW / IN_REVIEW / CREDIT_REVIEW / CREDIT_REWORK`. **"Submit to Admin"** now calls `credit_submit_recommendation()` via RPC instead of a local flag flip.
- **Admin Decision panel** — new, appears in the same view for Admin/Owner when a case is `CREDIT_SUBMITTED_FOR_APPROVAL` / `ADMIN_REVIEW`: **Approve & Sanction** (prompts for confirmation + remarks, calls `admin_approve_loan`), **Send for Rework** (prompts for required instructions, calls `admin_send_for_rework`), **Reject** (prompts for required reason, calls `admin_reject_loan`). Admin can also edit the loan amount/term/ROI/fees/conditions before approving, per the spec's "Admin can override."
- **Pipeline card buttons for Credit role** — Approve/Deny/Submit are now gated on `lead.status` (not just `creditSubmitted`), which also fixes the "dead Resubmit button post-rejection" bug you'd flagged earlier — a reworked case now correctly re-enables these buttons.
- All RPC calls immediately re-fetch the row from Supabase and merge it into local state, so the client's cached copy never drifts out of sync with what the database (and the enforcement trigger) actually allow — this matters because the app's general "save everything" sync (`persistAll` → `syncToSupabase`) does a full-row upsert of every lead in memory, and a stale local copy of a locked field would otherwise cause that bulk sync to fail.

## Status state machine

`NEW → IN_REVIEW → CREDIT_REVIEW → CREDIT_SUBMITTED_FOR_APPROVAL → ADMIN_REVIEW → APPROVED`, with `CREDIT_REWORK` looping back to Credit and `REJECTED` as a terminal state. Existing data was backfilled: `admin_status='approved'→APPROVED`, `admin_status='declined'→REJECTED`, `credit_submitted=true→CREDIT_SUBMITTED_FOR_APPROVAL`, else `NEW`. Nothing else in your existing `stage`/`admin_status`/`credit_status` fields was removed — the new `status` column drives the new workflow *alongside* them.

## Scope decisions / things I did NOT change

- Legal and Technical roles' permissions, RLS, and UI are untouched — the spec was scoped to Admin vs Credit.
- The pre-existing "✅ Final" approval button (which requires legal+technical+credit all approved+submitted) was left as-is; it's a separate, older mechanic from before this change. The new Admin Decision panel (Approve/Reject/Rework) is the one enforced at the database level and is what you should use going forward for Credit-originated approvals.
- I noticed (but did not fix, as it's out of scope) that `public.users.role` values are lowercase (`admin`, `owner`, `credit`, `legal`, `tech`) while the `roles`/`role_permissions` tables use different casing/naming (e.g. `Technical` vs `tech`), which makes `has_permission()` unreliable. Everything I built uses `current_user_role()` / `is_admin_or_owner()` directly (the same pattern your existing RLS already uses) to sidestep this, but it may be worth a cleanup pass at some point given the earlier `"tech"` vs `"technical"` bug you'd already hit once.

## What I could not do in this session

- **Push to GitHub** — I don't have write access to `sachink24/associate-app`; no GitHub connector is configured. You'll need to commit `index.html` yourself (diff it against the current file first).
- **Live end-to-end testing of the 15 scenarios** — I verified the SQL logic by reading back every function definition and the full RLS/trigger state after applying, and syntax-checked the entire modified `index.html` with Node. But I deliberately did **not** run the RPCs against your live leads (1001, 1012, 1157, etc.) to avoid mutating real production loan records with test data, and there's no dev branch set up. Please run through the 15 scenarios from your spec with real Admin/Credit accounts once you've deployed `index.html`.

## Environment / deployment steps for you

1. Diff `/mnt/user-data/outputs/index.html` against `sachink24/associate-app/index.html`, then commit + push (GitHub Pages will pick it up automatically).
2. No `.env` or config changes needed — same Supabase URL/anon key as before.
3. Test as a Credit user: confirm Add Lead is gone, confirm you can only edit your own assigned, not-yet-submitted leads' recommendation fields, submit one, then as Admin approve/reject/rework it and confirm `workflow_history` and `sanctions` populate correctly.
