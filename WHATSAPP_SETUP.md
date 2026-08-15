# WhatsApp Communication System — Setup

## What's included

| File | What to do with it |
|---|---|
| `index.html` | **Replace** your existing `associate-app/index.html` with this one. |
| `whatsapp-module.js` | **Add** as a new file in the same folder as `index.html`. |
| `whatsapp-schema.sql` | Run once in the **Supabase SQL editor** (project `nbpvamrwzqrgoiwpadwc`). |

`legal.html`, `technical.html`, `privacy.html`, `supabase-config.js`, `README.md`, `SECURITY.md`, `.github/` are **untouched** — nothing else in your repo needs to change.

## Steps

1. **Run the SQL.** Open Supabase → SQL Editor → paste `whatsapp-schema.sql` → Run. This creates `whatsapp_templates`, `whatsapp_messages`, and `whatsapp_settings`, all with RLS enabled (same open-policy pattern as your other tables, noted in the SQL comments — tighten alongside your existing RLS hardening pass once you move to Supabase Auth).
2. **Upload the two files** to your `associate-app` repo:
   - `index.html` (overwrite)
   - `whatsapp-module.js` (new)
3. **Push to `main`** — GitHub Pages redeploys automatically.
4. Open the live app. On first load, the module auto-detects the Supabase tables and seeds the 8 default templates (New Lead, KYC Documents Required, KYC Completed, Legal Verification, Technical Verification, Sanction, Documentation, Disbursement).

If you skip step 1, the app still works — it just stores templates/history in the browser's `localStorage` instead of Supabase until the tables exist.

## What changed inside `index.html` (5 small, additive edits)

1. A green WhatsApp icon added to the header (`#waHubIcon`) — opens the Templates/Automation/History hub.
2. A `🟢 WhatsApp` button added next to each lead's existing action buttons (owner, business/associate, legal, technical roles).
3. One `else if` branch added to the existing pipeline click-handler to open the panel.
4. A small read-only "bridge" object (`window.__sfmBridge`) exposing your existing `leads`, current user/role, `getTeamMemberName`, `escapeHtml`, `addFeed`, and the Supabase client — so `whatsapp-module.js` can read live data without touching your app's internal logic.
5. One `<script src="whatsapp-module.js">` tag before `</body>`.

Nothing was removed, renamed, or restructured. Your existing lead workflow, auth, Supabase sync, and role permissions work exactly as before.

## How it works

- **Per lead:** click 🟢 WhatsApp → panel shows customer/loan/stage info → select a template (auto-suggested based on the lead's current stage) → edit the preview if needed → **Send WhatsApp** opens `wa.me` with the message pre-filled, or **Copy Message** copies it to clipboard.
- **Mobile numbers** are auto-normalized to `+91XXXXXXXXXX`; invalid numbers block sending and are logged as `Failed`.
- **Admin (owner role)** gets the full hub: create/edit/duplicate/delete/activate templates, automation toggles (all default OFF except "enable WhatsApp" and "recommend template on stage change" — nothing auto-sends), and full communication history with search/filters.
- **Associates / Legal / Technical** can open the hub too, but only see **their own** sent history and only the templates relevant to their role (Legal team sees Legal + general templates, Technical sees Technical + general, Associates see everything active).
- **No delivery confirmation is ever claimed.** Click-to-chat can only tell you a message was opened in WhatsApp, not that it was delivered or read — the module logs status as `Sent` (opened) or `Failed` (bad number) only, never "Delivered".
- **No API keys or secrets** are used or stored anywhere in the frontend — this is pure `wa.me` click-to-chat. The code is structured behind a `WhatsAppService` abstraction so you can later swap in the official WhatsApp Business Cloud API (server-side) without changing any UI code.
