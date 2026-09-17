-- =====================================================================
-- WhatsApp BA-referral lead generation
-- Project: nbpvamrwzqrgoiwpadwc
-- Additive only — does not touch existing leads / whatsapp_* behavior.
-- =====================================================================

-- 1. Give every Business Associate a short, unique referral code
alter table public.business_associates
  add column if not exists referral_code text;

create or replace function public.generate_ba_referral_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I to avoid confusion when spoken/typed
  code text;
  tries int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.business_associates where referral_code = code);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'Could not generate a unique referral code after 20 attempts';
    end if;
  end loop;
  return code;
end;
$$;

-- Backfill existing BAs
update public.business_associates
set referral_code = public.generate_ba_referral_code()
where referral_code is null;

alter table public.business_associates
  add constraint business_associates_referral_code_key unique (referral_code);

-- Auto-generate for any newly created BA that doesn't supply one
create or replace function public.set_ba_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.referral_code is null then
    new.referral_code := public.generate_ba_referral_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_ba_referral_code on public.business_associates;
create trigger trg_set_ba_referral_code
  before insert on public.business_associates
  for each row
  execute function public.set_ba_referral_code();

-- 2. Track referral attribution on the conversation and the lead it produces
alter table public.whatsapp_conversations
  add column if not exists referred_by_ba text,
  add column if not exists referral_code_used text;

alter table public.leads
  add column if not exists referred_by_ba text,
  add column if not exists lead_source text default 'organic';

alter table public.leads drop constraint if exists leads_lead_source_check;
alter table public.leads
  add constraint leads_lead_source_check check (lead_source in ('organic','whatsapp_referral','whatsapp_organic','manual','website'));

-- Backfill existing leads as 'manual' (created before this feature existed) so the
-- new column has a meaningful value rather than misleadingly reading 'organic'.
update public.leads set lead_source = 'manual' where lead_source = 'organic';

-- 3. The public WhatsApp Business number customers message (E.164, digits only,
--    no leading +) — used to build BA referral wa.me links / QR codes. Defaults
--    to the current Meta test number; update once the production number is live.
--    (whatsapp_settings didn't exist yet in this project — the wa.me template
--    hub has been running in browser-localStorage mode. Creating it here,
--    matching whatsapp-schema.sql exactly, so both features share one table
--    and running whatsapp-schema.sql later stays a safe no-op.)
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

alter table public.whatsapp_settings
  add column if not exists bot_whatsapp_number text not null default '15551770472';

