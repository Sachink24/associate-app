-- ============================================================================
-- SOLITAIRE — WhatsApp Communication & Template Management
-- Supabase schema (project: nbpvamrwzqrgoiwpadwc)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. It is additive only — it does not
-- touch leads / users / business_associates / evaluation_reports etc.
--
-- NOTE on RLS: this project's app uses a custom (non-Supabase-Auth) login
-- system, so auth.uid()-based policies are not usable here — same known
-- limitation already documented for the rest of the schema. These policies
-- therefore use the same "open to anon/authenticated" pattern as the other
-- tables in this project, and role separation (who can create/edit templates,
-- who can view all history vs only their own) is enforced in the app layer
-- (whatsapp-module.js), not at the database layer. Tighten this together with
-- the rest of the RLS hardening pass when the app moves to Supabase Auth.
-- ============================================================================

-- 1. TEMPLATES ----------------------------------------------------------------
create table if not exists public.whatsapp_templates (
  id                 bigint generated always as identity primary key,
  template_name      text not null,
  category           text not null default 'General',
  application_stage  text,
  message_content    text not null,
  status             text not null default 'active' check (status in ('active', 'inactive')),
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_whatsapp_templates_stage on public.whatsapp_templates (application_stage);
create index if not exists idx_whatsapp_templates_status on public.whatsapp_templates (status);

alter table public.whatsapp_templates enable row level security;

drop policy if exists "wa_templates_select" on public.whatsapp_templates;
create policy "wa_templates_select" on public.whatsapp_templates
  for select using (true);

drop policy if exists "wa_templates_insert" on public.whatsapp_templates;
create policy "wa_templates_insert" on public.whatsapp_templates
  for insert with check (true);

drop policy if exists "wa_templates_update" on public.whatsapp_templates;
create policy "wa_templates_update" on public.whatsapp_templates
  for update using (true) with check (true);

drop policy if exists "wa_templates_delete" on public.whatsapp_templates;
create policy "wa_templates_delete" on public.whatsapp_templates
  for delete using (true);

-- 2. MESSAGES / COMMUNICATION HISTORY -----------------------------------------
create table if not exists public.whatsapp_messages (
  id                 bigint generated always as identity primary key,
  application_id     text,
  customer_id        text,
  customer_name      text,
  mobile_number      text,
  template_id        text,
  template_used      text,
  message_content    text,
  application_stage  text,
  sent_by            text,
  sent_at            timestamptz not null default now(),
  status             text not null default 'Draft' check (status in ('Draft', 'Ready', 'Sent', 'Failed')),
  error_message      text
);

create index if not exists idx_whatsapp_messages_customer on public.whatsapp_messages (customer_id);
create index if not exists idx_whatsapp_messages_app on public.whatsapp_messages (application_id);
create index if not exists idx_whatsapp_messages_sent_by on public.whatsapp_messages (sent_by);
create index if not exists idx_whatsapp_messages_status on public.whatsapp_messages (status);
create index if not exists idx_whatsapp_messages_sent_at on public.whatsapp_messages (sent_at desc);

alter table public.whatsapp_messages enable row level security;

drop policy if exists "wa_messages_select" on public.whatsapp_messages;
create policy "wa_messages_select" on public.whatsapp_messages
  for select using (true);

drop policy if exists "wa_messages_insert" on public.whatsapp_messages;
create policy "wa_messages_insert" on public.whatsapp_messages
  for insert with check (true);

drop policy if exists "wa_messages_update" on public.whatsapp_messages;
create policy "wa_messages_update" on public.whatsapp_messages
  for update using (true) with check (true);

-- No delete policy: communication history should not be deletable from the
-- client. Deletions (if ever needed for data-retention requests) should be
-- done from the Supabase dashboard directly.

-- 3. AUTOMATION SETTINGS (single row) -----------------------------------------
create table if not exists public.whatsapp_settings (
  id                          int primary key default 1,
  enable_whatsapp             boolean not null default true,
  recommend_on_stage_change   boolean not null default true,
  auto_open_on_stage_change   boolean not null default false,
  auto_log_communication      boolean not null default true,
  allow_associates            boolean not null default true,
  allow_credit_team           boolean not null default true,
  allow_legal_team            boolean not null default true,
  allow_technical_team        boolean not null default true,
  updated_at                  timestamptz not null default now(),
  constraint whatsapp_settings_singleton check (id = 1)
);

alter table public.whatsapp_settings enable row level security;

drop policy if exists "wa_settings_select" on public.whatsapp_settings;
create policy "wa_settings_select" on public.whatsapp_settings
  for select using (true);

drop policy if exists "wa_settings_insert" on public.whatsapp_settings;
create policy "wa_settings_insert" on public.whatsapp_settings
  for insert with check (true);

drop policy if exists "wa_settings_update" on public.whatsapp_settings;
create policy "wa_settings_update" on public.whatsapp_settings
  for update using (true) with check (true);

insert into public.whatsapp_settings (id) values (1)
  on conflict (id) do nothing;

-- ============================================================================
-- Done. whatsapp-module.js will auto-detect these tables on next page load
-- and seed the 8 default templates into whatsapp_templates automatically the
-- first time anyone opens the WhatsApp panel or hub. Until this script is
-- run, the module keeps working using the browser's localStorage instead —
-- nothing breaks either way.
-- ============================================================================
