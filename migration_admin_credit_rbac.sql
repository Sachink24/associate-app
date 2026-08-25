-- =====================================================================
-- RBAC: Admin (full control) vs Credit Team (review & recommend only)
-- Project: nbpvamrwzqrgoiwpadwc  |  Table: public.leads
-- =====================================================================

-- 1. NEW COLUMNS ON leads (workflow state + rework/reject/approve audit fields)
alter table public.leads
  add column if not exists status text default 'NEW',
  add column if not exists credit_submitted_by text,
  add column if not exists rework_reason text,
  add column if not exists rework_requested_by text,
  add column if not exists rework_requested_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists rejected_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

-- Backfill status from existing fields so nothing regresses for current data
update public.leads set status = case
  when admin_status = 'approved' then 'APPROVED'
  when admin_status = 'declined' then 'REJECTED'
  when credit_submitted = true then 'CREDIT_SUBMITTED_FOR_APPROVAL'
  else 'NEW'
end
where status is null or status = 'NEW';

alter table public.leads
  add constraint leads_status_check check (status in (
    'NEW','IN_REVIEW','CREDIT_REVIEW','CREDIT_SUBMITTED_FOR_APPROVAL',
    'ADMIN_REVIEW','CREDIT_REWORK','APPROVED','REJECTED'
  ));

create index if not exists idx_leads_status on public.leads(status);

-- =====================================================================
-- 2. AUDIT LOGGING HELPER (writes to existing public.workflow_history)
-- =====================================================================
create or replace function public.log_lead_workflow(
  p_lead_id bigint,
  p_action text,
  p_old_status text,
  p_new_status text,
  p_remarks text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text := public.current_user_role();
begin
  select name into v_name from public.users where auth_user_id = v_uid;
  insert into public.workflow_history
    (lead_id, application_no, action, old_status, new_status, user_id, user_name, role, remarks)
  values
    (p_lead_id, 'LN-' || p_lead_id::text, p_action, p_old_status, p_new_status, v_uid, coalesce(v_name, public.current_user_email()), v_role, p_remarks);
end;
$$;

revoke all on function public.log_lead_workflow(bigint, text, text, text, text) from public;
grant execute on function public.log_lead_workflow(bigint, text, text, text, text) to authenticated;

-- =====================================================================
-- 3. COLUMN-LEVEL ENFORCEMENT TRIGGER
--    Admin/Owner: unrestricted.
--    Credit: may only edit their own assigned lead's credit-recommendation
--    fields, and only while the case is in an editable status. All other
--    columns, and all status transitions, are locked at the DB level even
--    if the client sends a full-row upsert.
--    All other existing roles (business/legal/technical) keep their
--    current, unchanged behavior.
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

    if old.status not in ('NEW','IN_REVIEW','CREDIT_REVIEW','CREDIT_REWORK') then
      raise exception 'Not authorized: case is in status % and is not editable by Credit', old.status;
    end if;

    if new.borrower is distinct from old.borrower
      or new.co_applicants is distinct from old.co_applicants
      or new.loan_type is distinct from old.loan_type
      or new.loan_amount is distinct from old.loan_amount
      or new.credit is distinct from old.credit
      or new.institution_type is distinct from old.institution_type
      or new.institution_name is distinct from old.institution_name
      or new.assigned_ba is distinct from old.assigned_ba
      or new.assigned_legal is distinct from old.assigned_legal
      or new.assigned_technical is distinct from old.assigned_technical
      or new.assigned_credit is distinct from old.assigned_credit
      or new.bt_top_up_data is distinct from old.bt_top_up_data
      or new.property is distinct from old.property
      or new.verification_status is distinct from old.verification_status
      or new.assessment_status is distinct from old.assessment_status
      or new.kyc_status is distinct from old.kyc_status
      or new.legal_status is distinct from old.legal_status
      or new.technical_status is distinct from old.technical_status
      or new.admin_status is distinct from old.admin_status
      or new.legal_submitted is distinct from old.legal_submitted
      or new.technical_submitted is distinct from old.technical_submitted
      or new.legal_submitted_date is distinct from old.legal_submitted_date
      or new.technical_submitted_date is distinct from old.technical_submitted_date
      or new.stage is distinct from old.stage
      or new.created_by is distinct from old.created_by
      or new."references" is distinct from old."references"
      or new.legal_observation is distinct from old.legal_observation
      or new.legal_recommendation is distinct from old.legal_recommendation
      or new.technical_observation is distinct from old.technical_observation
      or new.technical_recommendation is distinct from old.technical_recommendation
      or new.credit_submitted is distinct from old.credit_submitted
      or new.credit_submitted_date is distinct from old.credit_submitted_date
      or new.credit_submitted_by is distinct from old.credit_submitted_by
      or new.status is distinct from old.status
      or new.rework_reason is distinct from old.rework_reason
      or new.rework_requested_by is distinct from old.rework_requested_by
      or new.rework_requested_at is distinct from old.rework_requested_at
      or new.rejected_reason is distinct from old.rejected_reason
      or new.rejected_by is distinct from old.rejected_by
      or new.rejected_at is distinct from old.rejected_at
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    then
      raise exception 'Not authorized: Credit Team may only edit loan amount, term, ROI, fees, sanction conditions, credit status and credit remarks';
    end if;

    return new;
  end if;

  -- business / legal / technical / other existing roles: unchanged
  return new;
end;
$$;

drop trigger if exists trg_enforce_leads_update on public.leads;
create trigger trg_enforce_leads_update
  before update on public.leads
  for each row
  execute function public.enforce_leads_update();

-- =====================================================================
-- 4. TIGHTEN leads INSERT — Credit Team can never create leads
--    (all other existing roles keep current ability, unchanged)
-- =====================================================================
drop policy if exists leads_insert_authenticated on public.leads;
create policy leads_insert_authenticated
  on public.leads
  for insert
  to authenticated
  with check (public.current_user_role() is distinct from 'credit');

-- =====================================================================
-- 5. WORKFLOW RPCs — the only sanctioned way to change lead status.
--    Each validates role + current status itself, then flips the
--    trigger bypass for its own statement, writes the audit row, and
--    (for approval) upserts into public.sanctions.
-- =====================================================================

-- 5a. Credit submits (or resubmits after rework) a recommendation
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
  v_resubmit boolean;
begin
  if public.current_user_role() <> 'credit' then
    raise exception 'Not authorized: only Credit Team can submit a recommendation';
  end if;

  select status into v_old_status from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if not exists (select 1 from public.leads where id = p_lead_id and assigned_credit = v_email) then
    raise exception 'Not authorized: this lead is not assigned to you';
  end if;
  if v_old_status not in ('NEW','IN_REVIEW','CREDIT_REVIEW','CREDIT_REWORK') then
    raise exception 'Case is in status % and cannot be submitted', v_old_status;
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

-- 5b. Admin approves — final decision, writes public.sanctions
create or replace function public.admin_approve_loan(
  p_lead_id bigint,
  p_approved_amount bigint,
  p_tenure_months int,
  p_roi numeric,
  p_fees text,
  p_conditions text,
  p_remarks text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.current_user_email();
  v_old_status text;
  v_app_no text := 'LN-' || p_lead_id::text;
begin
  if not public.is_admin_or_owner() then
    raise exception 'Not authorized: only Admin can give final approval';
  end if;

  select status into v_old_status from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if v_old_status not in ('CREDIT_SUBMITTED_FOR_APPROVAL','ADMIN_REVIEW') then
    raise exception 'Case is in status % and is not awaiting admin approval', v_old_status;
  end if;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    status = 'APPROVED',
    admin_status = 'approved',
    stage = 'Approved',
    approved_by = v_email,
    approved_at = now(),
    updated_at = now()
  where id = p_lead_id;

  insert into public.sanctions
    (lead_id, application_no, sanction_amount, tenure_months, roi, processing_fee, conditions, final_remarks, sanction_date, status, approved_by, approved_at)
  values
    (p_lead_id, v_app_no, p_approved_amount, p_tenure_months, p_roi, p_fees, p_conditions, p_remarks, current_date, 'sanctioned', v_email, now())
  on conflict (lead_id) do update set
    application_no = excluded.application_no,
    sanction_amount = excluded.sanction_amount,
    tenure_months = excluded.tenure_months,
    roi = excluded.roi,
    processing_fee = excluded.processing_fee,
    conditions = excluded.conditions,
    final_remarks = excluded.final_remarks,
    sanction_date = excluded.sanction_date,
    status = excluded.status,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    updated_at = now();

  perform public.log_lead_workflow(p_lead_id, 'ADMIN_APPROVED', v_old_status, 'APPROVED', p_remarks);
end;
$$;

-- 5c. Admin rejects
create or replace function public.admin_reject_loan(
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
begin
  if not public.is_admin_or_owner() then
    raise exception 'Not authorized: only Admin can reject a case';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select status into v_old_status from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if v_old_status not in ('CREDIT_SUBMITTED_FOR_APPROVAL','ADMIN_REVIEW') then
    raise exception 'Case is in status % and cannot be rejected from here', v_old_status;
  end if;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    status = 'REJECTED',
    admin_status = 'declined',
    stage = 'Declined',
    rejected_reason = p_reason,
    rejected_by = v_email,
    rejected_at = now(),
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(p_lead_id, 'ADMIN_REJECTED', v_old_status, 'REJECTED', p_reason);
end;
$$;

-- 5d. Admin sends back to Credit for rework
create or replace function public.admin_send_for_rework(
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
begin
  if not public.is_admin_or_owner() then
    raise exception 'Not authorized: only Admin can send a case back for rework';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rework reason/instruction is required';
  end if;

  select status into v_old_status from public.leads where id = p_lead_id for update;
  if v_old_status is null then
    raise exception 'Lead not found';
  end if;
  if v_old_status not in ('CREDIT_SUBMITTED_FOR_APPROVAL','ADMIN_REVIEW') then
    raise exception 'Case is in status % and cannot be sent for rework', v_old_status;
  end if;

  perform set_config('app.bypass_lead_trigger', 'on', true);
  update public.leads set
    status = 'CREDIT_REWORK',
    credit_submitted = false,
    rework_reason = p_reason,
    rework_requested_by = v_email,
    rework_requested_at = now(),
    updated_at = now()
  where id = p_lead_id;

  perform public.log_lead_workflow(p_lead_id, 'ADMIN_SENT_FOR_REWORK', v_old_status, 'CREDIT_REWORK', p_reason);
end;
$$;

revoke all on function public.credit_submit_recommendation(bigint,bigint,int,numeric,text,text,text) from public;
revoke all on function public.admin_approve_loan(bigint,bigint,int,numeric,text,text,text) from public;
revoke all on function public.admin_reject_loan(bigint,text) from public;
revoke all on function public.admin_send_for_rework(bigint,text) from public;
grant execute on function public.credit_submit_recommendation(bigint,bigint,int,numeric,text,text,text) to authenticated;
grant execute on function public.admin_approve_loan(bigint,bigint,int,numeric,text,text,text) to authenticated;
grant execute on function public.admin_reject_loan(bigint,text) to authenticated;
grant execute on function public.admin_send_for_rework(bigint,text) to authenticated;

-- =====================================================================
-- 6. RLS for workflow_history and sanctions (both had RLS enabled but
--    zero policies, so were previously unreadable to everyone). Make
--    them read-only for assigned parties / admin; all writes happen
--    only through the SECURITY DEFINER functions above.
-- =====================================================================
drop policy if exists workflow_history_select on public.workflow_history;
create policy workflow_history_select
  on public.workflow_history
  for select
  to authenticated
  using (
    public.is_admin_or_owner()
    or exists (
      select 1 from public.leads l
      where l.id = workflow_history.lead_id
        and (l.assigned_ba = public.current_user_email()
          or l.assigned_legal = public.current_user_email()
          or l.assigned_technical = public.current_user_email()
          or l.assigned_credit = public.current_user_email()
          or l.created_by = public.current_user_email())
    )
  );

drop policy if exists sanctions_select on public.sanctions;
create policy sanctions_select
  on public.sanctions
  for select
  to authenticated
  using (
    public.is_admin_or_owner()
    or exists (
      select 1 from public.leads l
      where l.id = sanctions.lead_id
        and (l.assigned_ba = public.current_user_email()
          or l.assigned_legal = public.current_user_email()
          or l.assigned_technical = public.current_user_email()
          or l.assigned_credit = public.current_user_email()
          or l.created_by = public.current_user_email())
    )
  );
