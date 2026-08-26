-- =====================================================================
-- RBAC extension: Legal Team & Technical Team, sequential workflow
-- Lead Created -> Legal Review -> Technical Review -> Credit Review ->
-- Credit Recommendation -> Admin Review -> Final Decision
-- Project: nbpvamrwzqrgoiwpadwc  |  Table: public.leads
-- =====================================================================

-- 1. NEW COLUMNS
alter table public.leads
  add column if not exists legal_submitted_by text,
  add column if not exists legal_rework_reason text,
  add column if not exists legal_rework_requested_by text,
  add column if not exists legal_rework_requested_at timestamptz,
  add column if not exists technical_submitted_by text,
  add column if not exists technical_rework_reason text,
  add column if not exists technical_rework_requested_by text,
  add column if not exists technical_rework_requested_at timestamptz;

-- 2. EXTEND status state machine
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads
  add constraint leads_status_check check (status in (
    'NEW','LEGAL_REVIEW','LEGAL_SUBMITTED','LEGAL_REWORK',
    'TECHNICAL_REVIEW','TECHNICAL_SUBMITTED','TECHNICAL_REWORK',
    'IN_REVIEW','CREDIT_REVIEW','CREDIT_SUBMITTED_FOR_APPROVAL','CREDIT_REWORK',
    'ADMIN_REVIEW','APPROVED','REJECTED'
  ));

-- Resume-aware backfill: only touch rows still sitting at the generic 'NEW'
-- state left by the previous migration; never touch rows already submitted/
-- approved/rejected/reworked.
update public.leads set status = case
  when technical_submitted then 'CREDIT_REVIEW'
  when legal_submitted then 'TECHNICAL_REVIEW'
  else 'NEW'
end
where status = 'NEW';

-- =====================================================================
-- 3. COLUMN-LEVEL ENFORCEMENT TRIGGER — rewritten as an ALLOW-LIST.
--    Admin/Owner: unrestricted.
--    Legal: only while assigned & status is legal-editable, may only touch
--      legal_status / legal_observation / legal_recommendation.
--    Technical: only while assigned & status is technical-editable, may
--      only touch technical_status / technical_observation /
--      technical_recommendation.
--    Credit: only while assigned & status is credit-editable (now requires
--      Legal AND Technical to have already submitted), may only touch the
--      credit recommendation fields (unchanged from before).
--    All status transitions and submit/rework actions happen only through
--    the SECURITY DEFINER RPCs below (via the app.bypass_lead_trigger flag).
--    Any other existing role (business/etc.) keeps its current, unchanged
--    behavior.
-- =====================================================================
create or replace function public.enforce_leads_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_email text := public.current_user_email();
  v_bypass boolean := coalesce(current_setting('app.bypass_lead_trigger', true), '') = 'on';
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_allowed text[];
  k text;
begin
  if v_bypass then
    return new;
  end if;

  if public.is_admin_or_owner() then
    return new;
  end if;

  if v_role = 'credit' then
    if old.assigned_credit is distinct from v_email then
      raise exception 'Not authorized: this lead is not assigned to you';
    end if;
    if old.status not in ('CREDIT_REVIEW','CREDIT_REWORK') then
      raise exception 'Not authorized: case is in status % and is not editable by Credit', old.status;
    end if;
    v_allowed := array['credit_loan_amount','credit_term_months','credit_roi','credit_fees',
                        'credit_conditions','credit_observation','credit_recommendation','credit_status','updated_at'];

  elsif v_role = 'legal' then
    if old.assigned_legal is distinct from v_email then
      raise exception 'Not authorized: this lead is not assigned to you';
    end if;
    if old.status not in ('NEW','LEGAL_REVIEW','LEGAL_REWORK') then
      raise exception 'Not authorized: case is in status % and is not editable by Legal', old.status;
    end if;
    v_allowed := array['legal_status','legal_observation','legal_recommendation','updated_at'];

  elsif v_role = 'technical' then
    if old.assigned_technical is distinct from v_email then
      raise exception 'Not authorized: this lead is not assigned to you';
    end if;
    if old.status not in ('TECHNICAL_REVIEW','TECHNICAL_REWORK') then
      raise exception 'Not authorized: case is in status % and is not editable by Technical', old.status;
    end if;
    v_allowed := array['technical_status','technical_observation','technical_recommendation','updated_at'];

  else
    -- other existing roles (business/etc.): unchanged behavior
    return new;
  end if;

  for k in select jsonb_object_keys(v_new) loop
    if (v_new -> k) is distinct from (v_old -> k) and not (k = any(v_allowed)) then
      raise exception 'Not authorized: % role may not edit field %', v_role, k;
    end if;
  end loop;

  return new;
end;
$$;

-- (trigger itself already exists and points at this function; no need to recreate it)

-- =====================================================================
-- 4. WORKFLOW RPCs for Legal and Technical submit + Admin rework
-- =====================================================================

-- 4a. Legal submits (or resubmits) its assessment
create or replace function public.legal_submit_assessment(
  p_lead_id bigint,
  p_legal_status text,
  p_observation text,
  p_recommendation text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_technical_submitted boolean;
  v_credit_submitted boolean;
  v_next_status text;
  v_resubmit boolean;
begin
  if public.current_user_role() <> 'legal' then
    raise exception 'Not authorized: only Legal Team can submit a legal assessment';
  end if;
  if p_legal_status not in ('approved','declined') then
    raise exception 'Invalid legal status';
  end if;

  select status, technical_submitted, credit_submitted into v_old_status, v_technical_submitted, v_credit_submitted
    from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id and assigned_legal = v_email) then
    raise exception 'Not authorized: this lead is not assigned to you';
  end if;
  if v_old_status not in ('NEW','LEGAL_REVIEW','LEGAL_REWORK') then
    raise exception 'Case is in status % and cannot be submitted by Legal', v_old_status;
  end if;

  v_resubmit := (v_old_status = 'LEGAL_REWORK');
  v_next_status := case
    when v_credit_submitted then 'CREDIT_SUBMITTED_FOR_APPROVAL'
    when v_technical_submitted then 'CREDIT_REVIEW'
    else 'TECHNICAL_REVIEW'
  end;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    legal_status = p_legal_status,
    legal_observation = p_observation,
    legal_recommendation = p_recommendation,
    legal_submitted = true,
    legal_submitted_date = now(),
    legal_submitted_by = v_email,
    status = v_next_status,
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(
    p_lead_id,
    case when v_resubmit then 'LEGAL_RESUBMITTED' else 'LEGAL_SUBMITTED' end,
    v_old_status, v_next_status, p_observation
  );
end;
$$;

-- 4b. Technical submits (or resubmits) its assessment
create or replace function public.technical_submit_assessment(
  p_lead_id bigint,
  p_technical_status text,
  p_observation text,
  p_recommendation text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_legal_submitted boolean;
  v_credit_submitted boolean;
  v_next_status text;
  v_resubmit boolean;
begin
  if public.current_user_role() <> 'technical' then
    raise exception 'Not authorized: only Technical Team can submit a technical assessment';
  end if;
  if p_technical_status not in ('approved','declined') then
    raise exception 'Invalid technical status';
  end if;

  select status, legal_submitted, credit_submitted into v_old_status, v_legal_submitted, v_credit_submitted
    from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id and assigned_technical = v_email) then
    raise exception 'Not authorized: this lead is not assigned to you';
  end if;
  if v_old_status not in ('TECHNICAL_REVIEW','TECHNICAL_REWORK') then
    raise exception 'Case is in status % and cannot be submitted by Technical', v_old_status;
  end if;
  if not v_legal_submitted then
    raise exception 'Legal assessment must be submitted before Technical can submit';
  end if;

  v_resubmit := (v_old_status = 'TECHNICAL_REWORK');
  v_next_status := case when v_credit_submitted then 'CREDIT_SUBMITTED_FOR_APPROVAL' else 'CREDIT_REVIEW' end;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    technical_status = p_technical_status,
    technical_observation = p_observation,
    technical_recommendation = p_recommendation,
    technical_submitted = true,
    technical_submitted_date = now(),
    technical_submitted_by = v_email,
    status = v_next_status,
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(
    p_lead_id,
    case when v_resubmit then 'TECHNICAL_RESUBMITTED' else 'TECHNICAL_SUBMITTED' end,
    v_old_status, v_next_status, p_observation
  );
end;
$$;

-- 4c. Admin sends Legal back for rework
create or replace function public.admin_send_legal_for_rework(
  p_lead_id bigint,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_legal_submitted boolean;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Not authorized: only Admin can send Legal for rework';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rework reason/instruction is required';
  end if;

  select status, legal_submitted into v_old_status, v_legal_submitted from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if v_old_status in ('APPROVED','REJECTED') then
    raise exception 'Case is in status % and cannot be reworked', v_old_status;
  end if;
  if not v_legal_submitted then
    raise exception 'Legal has not submitted an assessment yet';
  end if;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    status = 'LEGAL_REWORK',
    legal_submitted = false,
    legal_rework_reason = p_reason,
    legal_rework_requested_by = v_email,
    legal_rework_requested_at = now(),
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(p_lead_id, 'LEGAL_SENT_FOR_REWORK', v_old_status, 'LEGAL_REWORK', p_reason);
end;
$$;

-- 4d. Admin sends Technical back for rework
create or replace function public.admin_send_technical_for_rework(
  p_lead_id bigint,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_technical_submitted boolean;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Not authorized: only Admin can send Technical for rework';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rework reason/instruction is required';
  end if;

  select status, technical_submitted into v_old_status, v_technical_submitted from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if v_old_status in ('APPROVED','REJECTED') then
    raise exception 'Case is in status % and cannot be reworked', v_old_status;
  end if;
  if not v_technical_submitted then
    raise exception 'Technical has not submitted an assessment yet';
  end if;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    status = 'TECHNICAL_REWORK',
    technical_submitted = false,
    technical_rework_reason = p_reason,
    technical_rework_requested_by = v_email,
    technical_rework_requested_at = now(),
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(p_lead_id, 'TECHNICAL_SENT_FOR_REWORK', v_old_status, 'TECHNICAL_REWORK', p_reason);
end;
$$;

revoke all on function public.legal_submit_assessment(bigint,text,text,text) from public;
revoke all on function public.technical_submit_assessment(bigint,text,text,text) from public;
revoke all on function public.admin_send_legal_for_rework(bigint,text) from public;
revoke all on function public.admin_send_technical_for_rework(bigint,text) from public;
grant execute on function public.legal_submit_assessment(bigint,text,text,text) to authenticated;
grant execute on function public.technical_submit_assessment(bigint,text,text,text) to authenticated;
grant execute on function public.admin_send_legal_for_rework(bigint,text) to authenticated;
grant execute on function public.admin_send_technical_for_rework(bigint,text) to authenticated;

-- =====================================================================
-- 5. credit_submit_recommendation now requires Legal & Technical to have
--    already submitted (strict sequential workflow), and only accepts
--    CREDIT_REVIEW/CREDIT_REWORK as the starting status.
-- =====================================================================
create or replace function public.credit_submit_recommendation(
  p_lead_id bigint,
  p_loan_amount bigint,
  p_term_months int,
  p_roi numeric,
  p_fees text,
  p_conditions text,
  p_remarks text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_legal_submitted boolean;
  v_technical_submitted boolean;
  v_resubmit boolean;
begin
  if public.current_user_role() <> 'credit' then
    raise exception 'Not authorized: only Credit Team can submit a recommendation';
  end if;

  select status, legal_submitted, technical_submitted into v_old_status, v_legal_submitted, v_technical_submitted
    from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id and assigned_credit = v_email) then
    raise exception 'Not authorized: this lead is not assigned to you';
  end if;
  if v_old_status not in ('CREDIT_REVIEW','CREDIT_REWORK') then
    raise exception 'Case is in status % and cannot be submitted', v_old_status;
  end if;
  if not v_legal_submitted or not v_technical_submitted then
    raise exception 'Legal and Technical assessments must be submitted before Credit can submit';
  end if;

  v_resubmit := (v_old_status = 'CREDIT_REWORK');

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    credit_loan_amount = p_loan_amount,
    credit_term_months = p_term_months,
    credit_roi = p_roi,
    credit_fees = p_fees,
    credit_conditions = p_conditions,
    credit_observation = p_remarks,
    credit_status = 'approved',
    credit_submitted = true,
    credit_submitted_date = now(),
    credit_submitted_by = v_email,
    status = 'CREDIT_SUBMITTED_FOR_APPROVAL',
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(
    p_lead_id,
    case when v_resubmit then 'CREDIT_RESUBMITTED' else 'CREDIT_SUBMITTED' end,
    v_old_status, 'CREDIT_SUBMITTED_FOR_APPROVAL', p_remarks
  );
end;
$$;

-- =====================================================================
-- 6. TIGHTEN leads INSERT further — Legal and Technical also cannot
--    create leads (Credit was already excluded by the prior migration)
-- =====================================================================
drop policy if exists leads_insert_authenticated on public.leads;
create policy leads_insert_authenticated
  on public.leads
  for insert
  to authenticated
  with check (public.current_user_role() not in ('credit','legal','technical'));
