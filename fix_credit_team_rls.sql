-- ============================================================
-- Fix: credit_team RLS — restrict Approve/Deny/Terminate/Reactivate
-- and row insert/delete to Admin (owner) only.
-- Brings credit_team in line with legal_team / technical_team,
-- which are already admin-only on UPDATE/DELETE.
-- Project: nbpvamrwzqrgoiwpadwc
-- ============================================================

-- 1. UPDATE — drop the self-service clause, admin/owner only
DROP POLICY IF EXISTS "credit_team_update_admin_only" ON public.credit_team;

CREATE POLICY "credit_team_update_admin_only"
ON public.credit_team
FOR UPDATE
TO authenticated
USING (is_admin_or_owner())
WITH CHECK (is_admin_or_owner());

-- 2. DELETE — drop the self-service clause, admin/owner only
DROP POLICY IF EXISTS "Enable delete for users based on user_id" ON public.credit_team;

CREATE POLICY "credit_team_delete_admin_only"
ON public.credit_team
FOR DELETE
TO authenticated
USING (is_admin_or_owner());

-- 3. INSERT — keep self-registration (new credit associate signs up),
--    but this only creates a row; it can no longer be flipped to
--    'active' afterwards without going through the admin-only UPDATE
--    policy above. If you want signup rows locked to 'pending' status
--    at the DB level too, uncomment the WITH CHECK below instead:
--
-- DROP POLICY IF EXISTS "authenticated_insert_credit_team" ON public.credit_team;
-- CREATE POLICY "credit_team_insert_self_or_admin"
-- ON public.credit_team
-- FOR INSERT
-- TO authenticated
-- WITH CHECK (
--   (auth_user_id = auth.uid() AND status = 'pending')
--   OR is_admin_or_owner()
-- );

-- ============================================================
-- Verify after running:
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname='public' and tablename='credit_team';
-- ============================================================
