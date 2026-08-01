/* ============================================================
   Solitaire Finz Mart — Shared Supabase Client
   Loaded on any page that needs backend access.
   Legal & Technical pages are static and do NOT include this file.
   ============================================================ */

const SUPABASE_URL = "https://nbpvamrwzqrgoiwpadwc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GrJ_9z_y903WFMGjoAg82Q_cG3N2_Jx";

// Requires the Supabase JS CDN script to be loaded before this file:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
