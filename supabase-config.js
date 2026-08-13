/* ============================================================
   Solitaire Finz Mart — Shared Supabase Client
   ------------------------------------------------------------
   Include AFTER the Supabase JS CDN script on any page that
   needs backend access:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="js/supabase-config.js"></script>

   This file creates ONE shared client on `window.sb` (and
   `window.supabaseClient` as an alias) so every page — index.html,
   legal.html, technical.html, privacy.html — talks to the same
   Supabase project without re-declaring the URL/key each time.

   Pages that don't need the backend (e.g. a purely static page)
   can simply omit this <script> tag and nothing breaks.
   ============================================================ */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nbpvamrwzqrgoiwpadwc.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GrJ_9z_y903WFMGjoAg82Q_cG3N2_Jx";

  // Default private bucket used for evaluation report photos/signatures.
  // Individual pages can override by setting window.MEDIA_BUCKET before
  // this script runs, or just reference SFM.MEDIA_BUCKET directly.
  const MEDIA_BUCKET = window.MEDIA_BUCKET || "evaluation-media";

  // Avoid re-initializing if this script is accidentally included twice.
  if (window.sb && window.__sfmSupabaseReady) {
    console.warn("[supabase-config] Client already initialized — skipping re-init.");
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error(
      "[supabase-config] Supabase JS SDK not found. Make sure the CDN script " +
      "(@supabase/supabase-js@2) is included BEFORE js/supabase-config.js."
    );
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  /**
   * Upload a base64 data URL (e.g. a captured photo or signature) to Storage.
   * @param {string} dataUrl - "data:image/jpeg;base64,...."
   * @param {string} path - destination path inside the bucket, e.g. "legal/LN-2026-00842/photo_1.jpg"
   * @param {string} contentType - e.g. "image/jpeg" or "image/png"
   * @param {string} [bucket] - defaults to MEDIA_BUCKET
   * @returns {Promise<boolean>} true on success
   */
  async function uploadDataUrlToStorage(dataUrl, path, contentType, bucket) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const { error } = await client.storage
        .from(bucket || MEDIA_BUCKET)
        .upload(path, blob, { upsert: true, contentType });
      if (error) {
        console.error("[supabase-config] upload error:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[supabase-config] upload exception:", err);
      return false;
    }
  }

  /**
   * Get a temporary signed URL for a private storage object.
   * @param {string} path
   * @param {number} [expiresInSeconds=3600]
   * @param {string} [bucket] - defaults to MEDIA_BUCKET
   * @returns {Promise<string|null>}
   */
  async function getSignedUrl(path, expiresInSeconds, bucket) {
    if (!path) return null;
    try {
      const { data, error } = await client.storage
        .from(bucket || MEDIA_BUCKET)
        .createSignedUrl(path, expiresInSeconds || 3600);
      if (error) {
        console.error("[supabase-config] signed URL error:", error);
        return null;
      }
      return data ? data.signedUrl : null;
    } catch (err) {
      console.error("[supabase-config] signed URL exception:", err);
      return null;
    }
  }

  /**
   * Generic upsert helper for evaluation_reports-style tables.
   * @param {string} table
   * @param {object} row
   * @param {string} onConflict - e.g. "report_type,loan_app_no"
   */
  async function upsertRow(table, row, onConflict) {
    return client.from(table).upsert(row, { onConflict });
  }

  /**
   * Generic single-row fetch helper.
   * @param {string} table
   * @param {object} matchObj - e.g. { report_type: 'legal', loan_app_no: 'LN-2026-00842' }
   */
  async function fetchRow(table, matchObj) {
    let query = client.from(table).select("*");
    for (const key in matchObj) {
      query = query.eq(key, matchObj[key]);
    }
    return query.maybeSingle();
  }

  // Expose on window so existing inline scripts (which reference `sb`)
  // keep working with zero code changes beyond removing their own
  // duplicate createClient() call.
  window.sb = client;
  window.supabaseClient = client;
  window.MEDIA_BUCKET = MEDIA_BUCKET;

  window.SFM = window.SFM || {};
  window.SFM.supabase = client;
  window.SFM.uploadDataUrlToStorage = uploadDataUrlToStorage;
  window.SFM.getSignedUrl = getSignedUrl;
  window.SFM.upsertRow = upsertRow;
  window.SFM.fetchRow = fetchRow;

  window.__sfmSupabaseReady = true;

  console.log("[supabase-config] Solitaire Finz Mart Supabase client ready.");
})();
