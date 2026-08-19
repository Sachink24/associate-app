/* ============================================================================
   SOLITAIRE — WhatsApp Communication & Template Management System
   ----------------------------------------------------------------------------
   Additive module. Does not modify existing app logic — reads live app state
   through window.__sfmBridge (exposed from index.html) and Supabase through
   window.__sfmBridge.sb (the SAME client/project the rest of the app uses).

   Include AFTER index.html's main <script> block:
     <script src="whatsapp-module.js"></script>

   Falls back to localStorage automatically if the whatsapp_templates /
   whatsapp_messages / whatsapp_settings tables are not yet created in
   Supabase (see whatsapp-schema.sql) — so nothing breaks if the SQL hasn't
   been run yet.
   ============================================================================ */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // 0. CONSTANTS
  // ---------------------------------------------------------------------
  const T_TEMPLATES = "whatsapp_templates";
  const T_MESSAGES = "whatsapp_messages";
  const T_SETTINGS = "whatsapp_settings";

  const LS_TEMPLATES = "sfm_wa_templates_v1";
  const LS_MESSAGES = "sfm_wa_messages_v1";
  const LS_SETTINGS = "sfm_wa_settings_v1";

  const CATEGORIES = ["Lead", "KYC", "Legal", "Technical", "Sanction", "Documentation", "Disbursement", "General"];

  const STAGE_OPTIONS = [
    "New", "Contacted", "Document Collection", "Underwriting",
    "Legal Approved", "Legal Submitted", "Legal Declined",
    "Technical Approved", "Technical Submitted", "Technical Declined",
    "Ready for Admin Approval", "Approved", "Declined"
  ];

  // maps a lead's current pipeline stage -> a suggested default template category
  const STAGE_TEMPLATE_HINT = {
    "New": "New Lead",
    "Contacted": "New Lead",
    "Document Collection": "KYC Documents Required",
    "Underwriting": "KYC Completed",
    "Legal Approved": "Legal Verification",
    "Legal Submitted": "Legal Verification",
    "Technical Approved": "Technical Verification",
    "Technical Submitted": "Technical Verification",
    "Credit Approved": "Credit Verification",
    "Credit Submitted": "Credit Verification",
    "Ready for Admin Approval": "Sanction",
    "Approved": "Sanction"
  };

  const DEFAULT_TEMPLATES = [
    {
      template_name: "New Lead", category: "Lead", application_stage: "New", status: "active",
      message_content:
`🏦 SOLITAIRE FINZ MART

Dear {{customer_name}},

Thank you for contacting SOLITAIRE FINZ MART for your loan requirement.

📋 Application ID: {{application_id}}
💰 Loan Requirement: ₹{{loan_amount}}
🏦 Loan Type: {{loan_type}}

✅ Your application has been successfully registered.

Our team will contact you shortly regarding the next steps.

Regards,
SOLITAIRE FINZ MART
📞 {{company_mobile}}`
    },
    {
      template_name: "KYC Documents Required", category: "KYC", application_stage: "Document Collection", status: "active",
      message_content:
`📄 SOLITAIRE FINZ MART

Dear {{customer_name}},

We require the following documents to proceed with your loan application.

📋 Application ID: {{application_id}}

Please submit the required KYC documents at the earliest to avoid processing delays.

📌 Current Stage: KYC Verification

For assistance:
📞 {{company_mobile}}

Regards,
SOLITAIRE FINZ MART`
    },
    {
      template_name: "KYC Completed", category: "KYC", application_stage: "Underwriting", status: "active",
      message_content:
`✅ SOLITAIRE FINZ MART

Dear {{customer_name}},

Your KYC verification for Application ID {{application_id}} has been successfully completed.

📌 Current Stage: KYC Completed
💰 Loan Amount: ₹{{loan_amount}}

Your application is now moving to the next stage.

Thank you for choosing SOLITAIRE FINZ MART.

📞 {{company_mobile}}`
    },
    {
      template_name: "Legal Verification", category: "Legal", application_stage: "Legal Submitted", status: "active",
      message_content:
`⚖️ SOLITAIRE FINZ MART

Dear {{customer_name}},

Your loan application {{application_id}} has moved to the Legal Verification stage.

🏠 Property/Loan: {{loan_type}}
💰 Loan Amount: ₹{{loan_amount}}
📌 Status: {{application_status}}

Our legal team may contact you if any additional documents are required.

Regards,
SOLITAIRE FINZ MART
📞 {{company_mobile}}`
    },
    {
      template_name: "Technical Verification", category: "Technical", application_stage: "Technical Submitted", status: "active",
      message_content:
`🏗️ SOLITAIRE FINZ MART

Dear {{customer_name}},

Your application {{application_id}} has moved to the Technical Verification stage.

Our technical team may contact you regarding property inspection/valuation.

📌 Current Stage: Technical Verification
💰 Loan Amount: ₹{{loan_amount}}

Please cooperate with the team for faster processing.

Regards,
SOLITAIRE FINZ MART
📞 {{company_mobile}}`
    },
    {
      template_name: "Sanction", category: "Sanction", application_stage: "Ready for Admin Approval", status: "active",
      message_content:
`🎉 SOLITAIRE FINZ MART

Dear {{customer_name}},

Congratulations!

Your loan application has been sanctioned.

📋 Application ID: {{application_id}}
🏦 Institution: {{bank_name}}
💰 Sanctioned Amount: ₹{{sanctioned_amount}}
📅 Tenure: {{tenure}}
📈 Rate of Interest: {{roi}}
💳 Fees: {{fees}}
📝 Conditions: {{sanction_conditions}}

📌 Status: {{application_status}}

Our team will contact you regarding the remaining formalities.

Thank you for trusting SOLITAIRE FINZ MART.

📞 {{company_mobile}}`
    },
    {
      template_name: "Credit Verification", category: "Sanction", application_stage: "Credit Submitted", status: "active",
      message_content:
`💰 SOLITAIRE FINZ MART

Dear {{customer_name}},

Your application {{application_id}} has moved to the Credit / Sanction Terms stage.

Our credit team has reviewed your file and finalized the terms:

📌 Current Stage: Credit Verification
💰 Loan Amount: ₹{{sanctioned_amount}}
📅 Tenure: {{tenure}}
📈 ROI: {{roi}}

Final approval is pending admin sign-off.

Regards,
SOLITAIRE FINZ MART
📞 {{company_mobile}}`
    },
    {
      template_name: "Documentation", category: "Documentation", application_stage: "Approved", status: "active",
      message_content:
`📝 SOLITAIRE FINZ MART

Dear {{customer_name}},

Your loan application {{application_id}} is now at the Documentation stage.

Please complete the required documentation/formalities to proceed towards disbursement.

💰 Sanctioned Amount: ₹{{sanctioned_amount}}
📅 Tenure: {{tenure}}
📈 ROI: {{roi}}
🏦 Institution: {{bank_name}}

For assistance:
📞 {{company_mobile}}

Regards,
SOLITAIRE FINZ MART`
    },
    {
      template_name: "Disbursement", category: "Disbursement", application_stage: "Approved", status: "active",
      message_content:
`🎊 SOLITAIRE FINZ MART

Dear {{customer_name}},

Congratulations!

Your loan application {{application_id}} has successfully reached the Disbursement stage.

🏦 Institution: {{bank_name}}
💰 Disbursed Amount: ₹{{sanctioned_amount}}
📅 Tenure: {{tenure}}
📈 ROI: {{roi}}

Thank you for choosing SOLITAIRE FINZ MART.

We appreciate your trust. 🙏

📞 {{company_mobile}}`
    }
  ];

  const DEFAULT_SETTINGS = {
    enable_whatsapp: true,
    recommend_on_stage_change: true,
    auto_open_on_stage_change: false,
    auto_log_communication: true,
    allow_associates: true,
    allow_credit_team: true,
    allow_legal_team: true,
    allow_technical_team: true
  };

  // ---------------------------------------------------------------------
  // 1. BRIDGE / STATE
  // ---------------------------------------------------------------------
  function bridge() { return window.__sfmBridge || null; }
  function sbClient() { return bridge() ? bridge().sb : null; }
  function esc(s) { return bridge() ? bridge().escapeHtml(s) : String(s == null ? "" : s); }

  let useSupabase = false;
  let templatesCache = [];
  let settingsCache = null;
  let dataReady = false;

  async function detectSupabase() {
    const sb = sbClient();
    if (!sb) { useSupabase = false; return; }
    try {
      const { error } = await sb.from(T_TEMPLATES).select("id").limit(1);
      useSupabase = !error;
    } catch (e) {
      useSupabase = false;
    }
  }

  function lsGet(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---------------------------------------------------------------------
  // 2. TEMPLATES DATA LAYER
  // ---------------------------------------------------------------------
  async function ensureDefaultTemplates() {
    const existing = await listTemplatesRaw();
    if (existing.length > 0) { templatesCache = existing; return; }
    const who = (bridge() && bridge().getCurrentUserData()?.name) || "system";
    const rows = DEFAULT_TEMPLATES.map(t => ({
      ...t,
      created_by: who,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    if (useSupabase) {
      const sb = sbClient();
      const { data, error } = await sb.from(T_TEMPLATES).insert(rows).select();
      templatesCache = error ? rows.map((r, i) => ({ ...r, id: "local-" + i })) : data;
    } else {
      templatesCache = rows.map((r, i) => ({ ...r, id: "local-" + i }));
      lsSet(LS_TEMPLATES, templatesCache);
    }
  }

  async function listTemplatesRaw() {
    if (useSupabase) {
      const sb = sbClient();
      const { data, error } = await sb.from(T_TEMPLATES).select("*").order("id", { ascending: true });
      return error ? [] : (data || []);
    }
    return lsGet(LS_TEMPLATES, []);
  }

  async function refreshTemplates() {
    templatesCache = await listTemplatesRaw();
    return templatesCache;
  }

  async function saveTemplate(row) {
    row.updated_at = new Date().toISOString();
    if (useSupabase) {
      const sb = sbClient();
      if (row.id) {
        const { error } = await sb.from(T_TEMPLATES).update(row).eq("id", row.id);
        if (error) throw error;
      } else {
        row.created_at = new Date().toISOString();
        const { error } = await sb.from(T_TEMPLATES).insert(row);
        if (error) throw error;
      }
    } else {
      const all = lsGet(LS_TEMPLATES, []);
      if (row.id) {
        const idx = all.findIndex(t => t.id === row.id);
        if (idx >= 0) all[idx] = { ...all[idx], ...row };
      } else {
        row.id = "local-" + Date.now();
        row.created_at = new Date().toISOString();
        all.push(row);
      }
      lsSet(LS_TEMPLATES, all);
    }
    await refreshTemplates();
  }

  async function deleteTemplate(id) {
    if (useSupabase) {
      const sb = sbClient();
      await sb.from(T_TEMPLATES).delete().eq("id", id);
    } else {
      lsSet(LS_TEMPLATES, lsGet(LS_TEMPLATES, []).filter(t => t.id !== id));
    }
    await refreshTemplates();
  }

  // ---------------------------------------------------------------------
  // 3. MESSAGES (COMMUNICATION HISTORY) DATA LAYER
  // ---------------------------------------------------------------------
  async function logMessage(row) {
    row.sent_at = new Date().toISOString();
    if (useSupabase) {
      const sb = sbClient();
      const { error } = await sb.from(T_MESSAGES).insert(row);
      if (error) console.error("[whatsapp] log insert failed", error);
    } else {
      const all = lsGet(LS_MESSAGES, []);
      row.id = "local-" + Date.now();
      all.unshift(row);
      lsSet(LS_MESSAGES, all);
    }
  }

  async function listMessages(filters) {
    filters = filters || {};
    let rows;
    if (useSupabase) {
      const sb = sbClient();
      let q = sb.from(T_MESSAGES).select("*").order("sent_at", { ascending: false }).limit(500);
      const { data, error } = await q;
      rows = error ? [] : (data || []);
    } else {
      rows = lsGet(LS_MESSAGES, []);
    }
    return rows.filter(m => {
      if (filters.mine && m.sent_by !== filters.mine) return false;
      if (filters.customer && !(m.customer_name || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
      if (filters.applicationId && !(m.application_id || "").toLowerCase().includes(filters.applicationId.toLowerCase())) return false;
      if (filters.mobile && !(m.mobile_number || "").includes(filters.mobile)) return false;
      if (filters.stage && m.application_stage !== filters.stage) return false;
      if (filters.status && m.status !== filters.status) return false;
      if (filters.templateName && m.template_used !== filters.templateName) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // 4. SETTINGS (AUTOMATION) DATA LAYER
  // ---------------------------------------------------------------------
  async function loadSettings() {
    if (useSupabase) {
      const sb = sbClient();
      const { data, error } = await sb.from(T_SETTINGS).select("*").eq("id", 1).maybeSingle();
      if (!error && data) { settingsCache = data; return settingsCache; }
      if (!error && !data) {
        const row = { id: 1, ...DEFAULT_SETTINGS };
        await sb.from(T_SETTINGS).insert(row);
        settingsCache = row;
        return settingsCache;
      }
    }
    settingsCache = lsGet(LS_SETTINGS, { id: 1, ...DEFAULT_SETTINGS });
    return settingsCache;
  }

  async function saveSettings(patch) {
    settingsCache = { ...settingsCache, ...patch };
    if (useSupabase) {
      const sb = sbClient();
      await sb.from(T_SETTINGS).update(settingsCache).eq("id", 1);
    } else {
      lsSet(LS_SETTINGS, settingsCache);
    }
  }

  // ---------------------------------------------------------------------
  // 5. ROLE / PERMISSIONS
  // ---------------------------------------------------------------------
  function role() { return (bridge() && bridge().getCurrentRole()) || "guest"; }
  function isAdmin() { return role() === "owner"; }
  function canSend() {
    const r = role();
    if (r === "owner") return true;
    if (!settingsCache || !settingsCache.enable_whatsapp) return false;
    if (r === "business") return !!settingsCache.allow_associates;
    if (r === "legal") return !!settingsCache.allow_legal_team;
    if (r === "technical") return !!settingsCache.allow_technical_team;
    if (r === "credit") return !!settingsCache.allow_credit_team;
    return false; // customer / guest cannot send
  }
  function canManageTemplates() { return isAdmin(); }
  function canViewAllHistory() { return isAdmin(); }

  function templatesForRole() {
    const r = role();
    const active = templatesCache.filter(t => t.status === "active");
    if (r === "owner" || r === "business") return active;
    if (r === "legal") return active.filter(t => t.category === "Legal" || t.category === "General" || t.category === "Lead");
    if (r === "technical") return active.filter(t => t.category === "Technical" || t.category === "General" || t.category === "Lead");
    if (r === "credit") return active.filter(t => t.category === "Sanction" || t.category === "General" || t.category === "Lead");
    return [];
  }

  // ---------------------------------------------------------------------
  // 6. MOBILE VALIDATION / NORMALIZATION
  // ---------------------------------------------------------------------
  function normalizeMobile(raw) {
    if (!raw) return { valid: false, e164: "", digits: "" };
    let digits = String(raw).replace(/[^0-9]/g, "");
    digits = digits.replace(/^0+/, "");
    if (digits.length === 10) digits = "91" + digits;
    else if (digits.length === 12 && digits.startsWith("91")) { /* already has country code */ }
    else if (digits.length === 11 && digits.startsWith("0")) digits = "91" + digits.slice(1);
    const valid = /^91[6-9][0-9]{9}$/.test(digits);
    return { valid, e164: digits, digits };
  }

  // ---------------------------------------------------------------------
  // 7. VARIABLE SUBSTITUTION
  // ---------------------------------------------------------------------
  function fmtINR(n) {
    if (n == null || isNaN(n)) return "0";
    return Number(n).toLocaleString("en-IN");
  }

  function buildVariables(lead) {
    const b = bridge();
    const currentUserData = b ? b.getCurrentUserData() : null;
    const currentUser = b ? b.getCurrentUser() : null;
    const associateEmail = lead.assignedBA || currentUser || "";
    const associateType = lead.assignedBA ? "ba" : (role() === "legal" ? "legal" : (role() === "technical" ? "technical" : (role() === "credit" ? "credit" : "ba")));
    const associateName = lead.assignedBA
      ? b.getTeamMemberName(lead.assignedBA, "ba")
      : (currentUserData ? currentUserData.name : "SOLITAIRE Team");
    const associateMobile = lead.assignedBA ? (b.getTeamMemberMobile(lead.assignedBA, "ba") || b.companyMobile)
      : (currentUserData && currentUserData.mobile ? currentUserData.mobile : b.companyMobile);

    const appId = "SOL-" + String(lead.id).padStart(4, "0") + "-" + new Date().getFullYear();

    return {
      customer_name: lead.borrower?.name || "Customer",
      application_id: appId,
      loan_amount: fmtINR(lead.loanAmount),
      loan_type: lead.loanType || "N/A",
      bank_name: lead.institutionName || "Not Selected",
      current_stage: lead.stage || "New",
      application_status: lead.adminStatus || lead.creditStatus || lead.legalStatus || lead.technicalStatus || "Pending",
      sanctioned_amount: fmtINR(lead.creditLoanAmount || lead.loanAmount),
      roi: lead.creditROI ? (lead.creditROI + "%") : "To be confirmed",
      tenure: lead.creditTermMonths ? (lead.creditTermMonths + " months") : "To be confirmed",
      fees: lead.creditFees || "To be confirmed",
      sanction_conditions: lead.creditConditions || "None",
      associate_name: associateName || "SOLITAIRE Team",
      associate_mobile: associateMobile || b.companyMobile,
      company_name: b.companyName,
      company_mobile: b.companyMobile,
      next_action: nextActionFor(lead),
      date: new Date().toLocaleDateString("en-IN")
    };
  }

  function nextActionFor(lead) {
    const stage = lead.stage || "New";
    const map = {
      "New": "Document collection",
      "Contacted": "Document collection",
      "Document Collection": "KYC verification",
      "Underwriting": "Legal, Technical & Credit evaluation",
      "Legal Submitted": "Technical & Credit evaluation",
      "Technical Submitted": "Credit evaluation",
      "Credit Submitted": "Final admin approval",
      "Ready for Admin Approval": "Final admin approval",
      "Approved": "Documentation & disbursement",
      "Declined": "N/A"
    };
    return map[stage] || "Next steps will be communicated shortly";
  }

  function renderTemplate(content, vars) {
    return String(content || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
      const v = vars[key];
      return v == null ? m : String(v);
    });
  }

  function sanitizeForUrl(text) { return encodeURIComponent(text); }

  // ---------------------------------------------------------------------
  // 8. WhatsAppService ABSTRACTION (click-to-chat now, Cloud API later)
  // ---------------------------------------------------------------------
  const ClickToChatProvider = {
    sendMessage(mobileE164, text) {
      if (!mobileE164) return { status: "Failed", error_message: "Missing mobile number" };
      const url = `https://wa.me/${mobileE164}?text=${sanitizeForUrl(text)}`;
      window.open(url, "_blank");
      return { status: "Sent" }; // "Sent" = opened in WhatsApp; delivery is not verifiable in click-to-chat mode
    },
    getMessageStatus() {
      // Click-to-chat has no delivery callback. Never claim delivery.
      return "Unknown (click-to-chat mode — no delivery receipts available)";
    }
  };

  const WhatsAppService = {
    provider: ClickToChatProvider,
    sendTemplate(mobileE164, renderedText) {
      return this.provider.sendMessage(mobileE164, renderedText);
    },
    getMessageStatus(msgId) {
      return this.provider.getMessageStatus(msgId);
    }
  };
  // Future: WhatsAppService.provider = MetaWhatsAppCloudAPIProvider; (server-side, never in frontend)

  // ---------------------------------------------------------------------
  // 9. STYLES
  // ---------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById("sfm-wa-styles")) return;
    const style = document.createElement("style");
    style.id = "sfm-wa-styles";
    style.textContent = `
      .wa-overlay { position:fixed; inset:0; background:rgba(5,5,10,0.72); backdrop-filter:blur(3px);
        display:none; align-items:flex-end; justify-content:center; z-index:9999; }
      .wa-overlay.show { display:flex; }
      @media (min-width:720px){ .wa-overlay{ align-items:center; } }
      .wa-card { background:linear-gradient(145deg,#1c1c2a,#14141e); border:1px solid rgba(255,215,0,0.2);
        border-radius:22px 22px 0 0; padding:20px 18px 26px; width:100%; max-width:440px; max-height:92vh;
        overflow-y:auto; box-shadow:0 30px 60px rgba(0,0,0,0.8); font-family:'Inter',sans-serif; color:#f0e6d0;
        animation:waSlideUp .3s ease; }
      @media (min-width:720px){ .wa-card{ border-radius:22px; } }
      @keyframes waSlideUp { from{ transform:translateY(30px); opacity:0; } to{ transform:translateY(0); opacity:1; } }
      .wa-hub .wa-card { max-width:720px; }
      .wa-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
      .wa-head h2 { font-size:17px; color:#f5e7c8; letter-spacing:.3px; display:flex; align-items:center; gap:8px; }
      .wa-close { background:none; border:none; color:#6a5f48; font-size:20px; cursor:pointer; }
      .wa-close:hover { color:#c9a84c; }
      .wa-info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 14px; background:#0f0f18;
        border:1px solid rgba(255,215,0,0.08); border-radius:14px; padding:12px; margin-bottom:14px; }
      .wa-info-grid .wa-item .wa-label { font-size:9.5px; text-transform:uppercase; letter-spacing:.5px; color:#6a5f48; }
      .wa-info-grid .wa-item .wa-value { font-size:13px; font-weight:600; color:#f0e6d0; }
      .wa-field { margin-bottom:12px; }
      .wa-field label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#c9a84c; margin-bottom:5px; }
      .wa-select, .wa-input, .wa-textarea { width:100%; background:#0f0f18; border:1px solid rgba(255,215,0,0.15);
        border-radius:10px; padding:10px 12px; color:#f0e6d0; font-family:'Inter',sans-serif; font-size:13px; }
      .wa-textarea { min-height:180px; line-height:1.55; white-space:pre-wrap; resize:vertical; }
      .wa-preview-box { background:#0a0a0f; border:1px dashed rgba(37,211,102,0.35); border-radius:14px; padding:12px;
        font-size:13px; line-height:1.6; color:#d8ceb4; white-space:pre-wrap; margin-bottom:10px; }
      .wa-badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:10.5px; font-weight:700; }
      .wa-badge.sent { background:#0f2a1a; color:#6ad49a; }
      .wa-badge.failed { background:#2a0f0f; color:#d46a6a; }
      .wa-badge.draft { background:#2a2a1a; color:#d4b86a; }
      .wa-badge.ready { background:#14243a; color:#6a9ad4; }
      .wa-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
      .wa-actions button { flex:1; min-width:100px; padding:11px; border-radius:40px; border:none; font-weight:600;
        cursor:pointer; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px; }
      .wa-btn-send { background:#25D366; color:#0a0a0f; }
      .wa-btn-send:hover { background:#1da851; }
      .wa-btn-copy { background:#2a2a3e; color:#c8bca8; }
      .wa-btn-copy:hover { background:#3a3a5a; }
      .wa-btn-cancel { background:transparent; border:1px solid rgba(255,255,255,0.15) !important; color:#9a8f78; }
      .wa-note { font-size:10.5px; color:#6a5f48; margin-top:8px; line-height:1.5; }
      .wa-tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
      .wa-tab { padding:7px 14px; border-radius:20px; background:#0f0f18; border:1px solid rgba(255,215,0,0.12);
        color:#9a8f78; font-size:11.5px; cursor:pointer; font-weight:600; }
      .wa-tab.active { background:rgba(201,168,76,0.15); color:#c9a84c; border-color:#c9a84c; }
      .wa-tabpanel { display:none; } .wa-tabpanel.active { display:block; }
      .wa-stats-row { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:14px; }
      @media (min-width:560px){ .wa-stats-row{ grid-template-columns:repeat(4,1fr);} }
      .wa-stat { background:#0f0f18; border:1px solid rgba(255,215,0,0.1); border-radius:12px; padding:12px; text-align:center; }
      .wa-stat .n { font-size:20px; font-weight:700; color:#f5e7c8; }
      .wa-stat .l { font-size:9.5px; text-transform:uppercase; color:#6a5f48; margin-top:2px; }
      .wa-list-row { background:#0f0f18; border:1px solid rgba(255,215,0,0.08); border-radius:12px; padding:10px 12px; margin-bottom:8px; }
      .wa-list-row .r1 { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
      .wa-list-row .r1 strong { font-size:13px; color:#f0e6d0; }
      .wa-list-row .r2 { font-size:11px; color:#9a8f78; }
      .wa-tpl-row { display:flex; justify-content:space-between; align-items:center; gap:8px; background:#0f0f18;
        border:1px solid rgba(255,215,0,0.08); border-radius:12px; padding:10px 12px; margin-bottom:8px; }
      .wa-tpl-row .meta strong { font-size:13px; color:#f0e6d0; display:block; }
      .wa-tpl-row .meta span { font-size:10.5px; color:#6a5f48; }
      .wa-tpl-row .btns { display:flex; gap:4px; flex-wrap:wrap; }
      .wa-tpl-row .btns button { background:#1c1c2a; border:1px solid rgba(255,215,0,0.15); color:#c8bca8;
        border-radius:8px; padding:5px 8px; font-size:10.5px; cursor:pointer; }
      .wa-tpl-row .btns button:hover { border-color:#c9a84c; color:#c9a84c; }
      .wa-filters { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
      .wa-filters input, .wa-filters select { background:#0f0f18; border:1px solid rgba(255,215,0,0.15); color:#f0e6d0;
        border-radius:8px; padding:6px 9px; font-size:11.5px; }
      .wa-toggle-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0;
        border-bottom:1px solid rgba(255,255,255,0.04); font-size:12.5px; color:#d8ceb4; }
      .wa-toggle-row input { width:18px; height:18px; accent-color:#25D366; }
      .wa-empty { text-align:center; color:#6a5f48; padding:24px 0; font-size:12.5px; }
      .wa-editor-actions { display:flex; gap:8px; margin-top:14px; }
      .wa-editor-actions button { flex:1; padding:10px; border-radius:30px; border:none; font-weight:600; cursor:pointer; font-size:12.5px; }
      .wa-save { background:#c9a84c; color:#0a0a0f; }
      .wa-discard { background:#2a2a3e; color:#c8bca8; }
    `;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // 10. DOM SCAFFOLD
  // ---------------------------------------------------------------------
  function injectDom() {
    if (document.getElementById("waPanelOverlay")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="wa-overlay" id="waPanelOverlay"><div class="wa-card" id="waPanelCard"></div></div>
      <div class="wa-overlay wa-hub" id="waHubOverlay"><div class="wa-card" id="waHubCard"></div></div>
    `;
    document.body.appendChild(wrap);
    document.getElementById("waPanelOverlay").addEventListener("click", (e) => {
      if (e.target.id === "waPanelOverlay") closePanel();
    });
    document.getElementById("waHubOverlay").addEventListener("click", (e) => {
      if (e.target.id === "waHubOverlay") closeHub();
    });
  }

  function closePanel() { document.getElementById("waPanelOverlay")?.classList.remove("show"); }
  function closeHub() { document.getElementById("waHubOverlay")?.classList.remove("show"); }

  // ---------------------------------------------------------------------
  // 11. PER-LEAD WHATSAPP PANEL
  // ---------------------------------------------------------------------
  let currentLead = null;
  let currentTemplateId = null;
  let editedMessage = null;

  async function openPanel(leadId) {
    const b = bridge();
    if (!b) return;
    const lead = b.getLeadById(leadId);
    if (!lead) { alert("Lead not found."); return; }
    if (!lead.borrower || !lead.borrower.phone) {
      alert("⚠️ This lead has no mobile number on file — cannot open WhatsApp.");
      return;
    }
    if (!dataReady) await ensureInit();
    if (!canSend()) {
      alert("🚫 You don't have permission to send WhatsApp messages. Contact your Admin.");
      return;
    }
    currentLead = lead;
    editedMessage = null;

    const options = templatesForRole();
    const hint = STAGE_TEMPLATE_HINT[lead.stage || "New"];
    const recommended = options.find(t => t.template_name === hint) || options[0];
    currentTemplateId = recommended ? recommended.id : null;

    renderPanel();
    document.getElementById("waPanelOverlay").classList.add("show");
  }

  function renderPanel() {
    const card = document.getElementById("waPanelCard");
    const lead = currentLead;
    const b = bridge();
    const options = templatesForRole();
    const vars = buildVariables(lead);
    const template = options.find(t => t.id === currentTemplateId) || options[0];
    const rendered = editedMessage != null ? editedMessage : renderTemplate(template ? template.message_content : "", vars);
    const norm = normalizeMobile(lead.borrower.phone);
    const assignedName = lead.assignedBA ? b.getTeamMemberName(lead.assignedBA, "ba") : "Unassigned";

    card.innerHTML = `
      <div class="wa-head">
        <h2>🟢 WhatsApp — ${esc(lead.borrower.name)}</h2>
        <button class="wa-close" id="waPanelCloseBtn">&times;</button>
      </div>

      <div class="wa-info-grid">
        <div class="wa-item"><div class="wa-label">Customer</div><div class="wa-value">${esc(lead.borrower.name)}</div></div>
        <div class="wa-item"><div class="wa-label">Mobile</div><div class="wa-value">${esc(lead.borrower.phone)} ${norm.valid ? "✅" : "⚠️"}</div></div>
        <div class="wa-item"><div class="wa-label">Application ID</div><div class="wa-value">${esc(vars.application_id)}</div></div>
        <div class="wa-item"><div class="wa-label">Loan Type</div><div class="wa-value">${esc(lead.loanType || "—")}</div></div>
        <div class="wa-item"><div class="wa-label">Loan Amount</div><div class="wa-value">₹${esc(vars.loan_amount)}</div></div>
        <div class="wa-item"><div class="wa-label">Bank/NBFC</div><div class="wa-value">${esc(lead.institutionName || "Not selected")}</div></div>
        <div class="wa-item"><div class="wa-label">Stage</div><div class="wa-value">${esc(lead.stage || "New")}</div></div>
        <div class="wa-item"><div class="wa-label">Associate</div><div class="wa-value">${esc(assignedName)}</div></div>
      </div>

      ${!norm.valid ? `<div class="wa-note" style="color:#d46a6a;">⚠️ This mobile number does not look like a valid 10-digit Indian number. Sending is disabled until it's corrected on the lead.</div>` : ""}

      <div class="wa-field">
        <label>Select Template</label>
        <select class="wa-select" id="waTemplateSelect" ${options.length === 0 ? "disabled" : ""}>
          ${options.length === 0 ? `<option>No templates available for your role</option>` :
            options.map(t => `<option value="${t.id}" ${t.id === currentTemplateId ? "selected" : ""}>${esc(t.template_name)} (${esc(t.category)})</option>`).join("")}
        </select>
      </div>

      <div class="wa-field">
        <label>Preview / Edit Message</label>
        <textarea class="wa-textarea" id="waMessageBox"></textarea>
      </div>

      <div class="wa-note">Variables are filled automatically from this application's live data. You can edit the text above before sending — your edits are used exactly as typed.</div>

      <div class="wa-actions">
        <button class="wa-btn-send" id="waSendBtn" ${!norm.valid ? "disabled style='opacity:.5;cursor:not-allowed;'" : ""}>📤 Send WhatsApp</button>
        <button class="wa-btn-copy" id="waCopyBtn">📋 Copy Message</button>
        <button class="wa-btn-cancel" id="waCancelBtn">Cancel</button>
      </div>
      <div class="wa-note">Click-to-chat mode: opens WhatsApp with the message pre-filled. Actual delivery cannot be confirmed from the browser.</div>
    `;

    document.getElementById("waPanelCloseBtn").onclick = closePanel;
    document.getElementById("waCancelBtn").onclick = closePanel;
    document.getElementById("waTemplateSelect").onchange = (e) => {
      currentTemplateId = e.target.value;
      editedMessage = null;
      renderPanel();
    };
    const waMessageBoxEl = document.getElementById("waMessageBox");
    if (waMessageBoxEl) waMessageBoxEl.value = String(rendered == null ? "" : rendered);
    waMessageBoxEl.oninput = (e) => { editedMessage = e.target.value; };

    document.getElementById("waCopyBtn").onclick = () => {
      const text = document.getElementById("waMessageBox").value;
      navigator.clipboard.writeText(text).then(() => alert("📋 Message copied to clipboard.")).catch(() => alert(text));
    };

    document.getElementById("waSendBtn").onclick = async () => {
      const text = document.getElementById("waMessageBox").value;
      const mobileNorm = normalizeMobile(lead.borrower.phone);
      const tpl = options.find(t => t.id === currentTemplateId);
      const b2 = bridge();
      const logRow = {
        application_id: vars.application_id,
        customer_id: String(lead.id),
        customer_name: lead.borrower.name,
        mobile_number: lead.borrower.phone,
        template_id: tpl ? String(tpl.id) : null,
        template_used: tpl ? tpl.template_name : "Custom",
        message_content: text,
        application_stage: lead.stage || "New",
        sent_by: (b2.getCurrentUserData() && b2.getCurrentUserData().name) || b2.getCurrentUser() || "unknown",
        status: "Draft",
        error_message: null
      };

      if (!mobileNorm.valid) {
        logRow.status = "Failed";
        logRow.error_message = "Invalid mobile number";
        await logMessage(logRow);
        alert("⚠️ Cannot send — invalid mobile number.");
        return;
      }

      const result = WhatsAppService.sendTemplate(mobileNorm.e164, text);
      logRow.status = result.status;
      logRow.error_message = result.error_message || null;
      await logMessage(logRow);

      if (result.status === "Sent") {
        b2.addFeed(`💬 WhatsApp sent to ${lead.borrower.name} (${tpl ? tpl.template_name : "custom message"})`);
      }
      closePanel();
    };
  }

  // ---------------------------------------------------------------------
  // 12. ADMIN / TEAM HUB (Templates · Automation · History · Overview)
  // ---------------------------------------------------------------------
  let hubTab = "overview";
  let editingTemplate = null; // null = not editing, {} = new, {...} = existing

  async function openHub() {
    if (!dataReady) await ensureInit();
    hubTab = isAdmin() ? "overview" : "history";
    editingTemplate = null;
    renderHub();
    document.getElementById("waHubOverlay").classList.add("show");
  }

  function tabButton(id, label) {
    return `<button class="wa-tab ${hubTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
  }

  async function renderHub() {
    const card = document.getElementById("waHubCard");
    const admin = isAdmin();

    const tabs = admin
      ? [tabButton("overview", "📊 Overview"), tabButton("templates", "📋 Templates"),
         tabButton("automation", "⚙️ Automation"), tabButton("history", "🕘 History (All)")]
      : [tabButton("history", "🕘 My History")];

    card.innerHTML = `
      <div class="wa-head">
        <h2>🟢 WhatsApp Communication</h2>
        <button class="wa-close" id="waHubCloseBtn">&times;</button>
      </div>
      <div class="wa-tabs">${tabs.join("")}</div>
      <div id="waHubBody"></div>
    `;
    document.getElementById("waHubCloseBtn").onclick = closeHub;
    card.querySelectorAll("[data-tab]").forEach(btn => {
      btn.onclick = () => { hubTab = btn.dataset.tab; editingTemplate = null; renderHub(); };
    });

    const body = document.getElementById("waHubBody");
    if (hubTab === "overview") body.innerHTML = await overviewHtml();
    else if (hubTab === "templates" && admin) { body.innerHTML = templatesHtml(); wireTemplatesTab(); }
    else if (hubTab === "automation" && admin) { body.innerHTML = automationHtml(); wireAutomationTab(); }
    else if (hubTab === "history") { body.innerHTML = await historyHtml(); wireHistoryTab(); }
  }

  async function overviewHtml() {
    const all = await listMessages(canViewAllHistory() ? {} : { mine: (bridge().getCurrentUserData() || {}).name });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const sentToday = all.filter(m => m.status === "Sent" && new Date(m.sent_at) >= today).length;
    const sentWeek = all.filter(m => m.status === "Sent" && new Date(m.sent_at) >= weekAgo).length;
    const pending = all.filter(m => m.status === "Draft" || m.status === "Ready").length;
    const failed = all.filter(m => m.status === "Failed").length;

    const recent = all.slice(0, 8).map(rowHtml).join("") || `<div class="wa-empty">No WhatsApp activity yet.</div>`;

    return `
      <div class="wa-stats-row">
        <div class="wa-stat"><div class="n">${sentToday}</div><div class="l">Sent Today</div></div>
        <div class="wa-stat"><div class="n">${sentWeek}</div><div class="l">Sent This Week</div></div>
        <div class="wa-stat"><div class="n">${pending}</div><div class="l">Pending</div></div>
        <div class="wa-stat"><div class="n">${failed}</div><div class="l">Failed</div></div>
      </div>
      <div class="wa-field"><label>Recent Activity</label></div>
      ${recent}
      <div class="wa-note">Storage: ${useSupabase ? "Supabase (cloud, synced across devices)" : "Local browser storage — run whatsapp-schema.sql in Supabase to enable cloud sync."}</div>
    `;
  }

  function rowHtml(m) {
    const statusClass = (m.status || "").toLowerCase();
    return `
      <div class="wa-list-row">
        <div class="r1"><strong>${esc(m.customer_name)}</strong><span class="wa-badge ${statusClass}">${esc(m.status)}</span></div>
        <div class="r2">${esc(m.application_id || "—")} · ${esc(m.template_used || "Custom")} · ${esc(m.application_stage || "—")}</div>
        <div class="r2">${esc(m.mobile_number || "")} · by ${esc(m.sent_by || "—")} · ${new Date(m.sent_at).toLocaleString("en-IN")}</div>
      </div>`;
  }

  // ---- Templates tab (admin only) ----
  function templatesHtml() {
    if (editingTemplate) return templateEditorHtml(editingTemplate);
    const list = templatesCache;
    return `
      <div class="wa-filters">
        <input type="text" id="waTplSearch" placeholder="Search templates…" />
        <select id="waTplStageFilter"><option value="">All stages</option>${STAGE_OPTIONS.map(s => `<option>${s}</option>`).join("")}</select>
        <button class="wa-tab" id="waTplNewBtn" style="border-color:#25D366;color:#25D366;">+ New Template</button>
      </div>
      <div id="waTplList">${list.map(templateRowHtml).join("") || `<div class="wa-empty">No templates yet.</div>`}</div>
    `;
  }

  function templateRowHtml(t) {
    return `
      <div class="wa-tpl-row" data-tpl-id="${t.id}">
        <div class="meta">
          <strong>${esc(t.template_name)} ${t.status === "active" ? "" : "· <span style='color:#d46a6a;'>Inactive</span>"}</strong>
          <span>${esc(t.category)} · ${esc(t.application_stage || "Any stage")}</span>
        </div>
        <div class="btns">
          <button data-act="preview">Preview</button>
          <button data-act="edit">Edit</button>
          <button data-act="duplicate">Duplicate</button>
          <button data-act="toggle">${t.status === "active" ? "Deactivate" : "Activate"}</button>
          <button data-act="delete" style="color:#d46a6a;">Delete</button>
        </div>
      </div>`;
  }

  function wireTemplatesTab() {
    const search = document.getElementById("waTplSearch");
    const stageFilter = document.getElementById("waTplStageFilter");
    const applyFilter = () => {
      const q = (search.value || "").toLowerCase();
      const stage = stageFilter.value;
      const list = document.getElementById("waTplList");
      const filtered = templatesCache.filter(t =>
        (!q || t.template_name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) &&
        (!stage || t.application_stage === stage));
      list.innerHTML = filtered.map(templateRowHtml).join("") || `<div class="wa-empty">No templates match.</div>`;
      wireTemplateRowButtons();
    };
    search.oninput = applyFilter;
    stageFilter.onchange = applyFilter;
    document.getElementById("waTplNewBtn").onclick = () => { editingTemplate = {}; renderHub(); };
    wireTemplateRowButtons();
  }

  function wireTemplateRowButtons() {
    document.querySelectorAll("#waTplList .wa-tpl-row, #waHubBody .wa-tpl-row").forEach(row => {
      const id = row.dataset.tplId;
      const t = templatesCache.find(x => String(x.id) === String(id));
      if (!t) return;
      row.querySelectorAll("[data-act]").forEach(btn => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          if (act === "preview") {
            const vars = { customer_name: "Rahul Sharma", application_id: "SOL-0125-2026", loan_amount: "25,00,000",
              loan_type: "Home Loan", bank_name: "ICICI Bank", current_stage: t.application_stage || "New",
              application_status: "Pending", associate_name: "Team Solitaire", associate_mobile: "8779023084",
              company_name: "SOLITAIRE FINZ MART", company_mobile: "8779023084", next_action: "Next steps",
              date: new Date().toLocaleDateString("en-IN") };
            alert(renderTemplate(t.message_content, vars));
          } else if (act === "edit") {
            editingTemplate = { ...t };
            renderHub();
          } else if (act === "duplicate") {
            const copy = { ...t, id: null, template_name: t.template_name + " (Copy)", status: "active",
              created_by: (bridge().getCurrentUserData() || {}).name || "admin" };
            await saveTemplate(copy);
            renderHub();
          } else if (act === "toggle") {
            await saveTemplate({ ...t, status: t.status === "active" ? "inactive" : "active" });
            renderHub();
          } else if (act === "delete") {
            if (confirm(`Delete template "${t.template_name}"? This cannot be undone.`)) {
              await deleteTemplate(t.id);
              renderHub();
            }
          }
        };
      });
    });
  }

  function templateEditorHtml(t) {
    const isNew = !t.id;
    return `
      <div class="wa-field"><label>Template Name</label>
        <input class="wa-input" id="waTplName" value="${esc(t.template_name || "")}" placeholder="e.g. Welcome Message" /></div>
      <div class="wa-field"><label>Category</label>
        <select class="wa-select" id="waTplCategory">${CATEGORIES.map(c => `<option ${t.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="wa-field"><label>Application Stage</label>
        <select class="wa-select" id="waTplStage"><option value="">Any stage</option>${STAGE_OPTIONS.map(s => `<option ${t.application_stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="wa-field"><label>Message Content</label>
        <textarea class="wa-textarea" id="waTplContent" placeholder="Use {{customer_name}}, {{application_id}}, {{loan_amount}}, {{loan_type}}, {{bank_name}}, {{current_stage}}, {{application_status}}, {{associate_name}}, {{associate_mobile}}, {{company_name}}, {{company_mobile}}, {{next_action}}, {{date}}">${esc(t.message_content || "")}</textarea></div>
      <div class="wa-toggle-row"><span>Active (visible to associates when sending)</span>
        <input type="checkbox" id="waTplActive" ${t.status !== "inactive" ? "checked" : ""} /></div>
      <div class="wa-editor-actions">
        <button class="wa-save" id="waTplSaveBtn">${isNew ? "Create Template" : "Save Changes"}</button>
        <button class="wa-discard" id="waTplCancelBtn">Cancel</button>
      </div>
    `;
  }

  function wireTemplateEditor() {
    document.getElementById("waTplCancelBtn").onclick = () => { editingTemplate = null; renderHub(); };
    document.getElementById("waTplSaveBtn").onclick = async () => {
      const name = document.getElementById("waTplName").value.trim();
      const content = document.getElementById("waTplContent").value.trim();
      if (!name || !content) { alert("Template name and message content are required."); return; }
      const row = {
        ...(editingTemplate.id ? { id: editingTemplate.id } : {}),
        template_name: name,
        category: document.getElementById("waTplCategory").value,
        application_stage: document.getElementById("waTplStage").value || null,
        message_content: content,
        status: document.getElementById("waTplActive").checked ? "active" : "inactive",
        created_by: editingTemplate.created_by || (bridge().getCurrentUserData() || {}).name || "admin"
      };
      await saveTemplate(row);
      editingTemplate = null;
      renderHub();
    };
  }

  // ---- Automation tab (admin only) ----
  function automationHtml() {
    const s = settingsCache;
    const rows = [
      ["enable_whatsapp", "Enable WhatsApp Communication"],
      ["recommend_on_stage_change", "Recommend template when stage changes"],
      ["auto_open_on_stage_change", "Automatically open WhatsApp when stage changes"],
      ["auto_log_communication", "Automatically log WhatsApp communication"],
      ["allow_associates", "Allow Associates to send messages"],
      ["allow_credit_team", "Allow Credit Team to send messages"],
      ["allow_legal_team", "Allow Legal Team to send messages"],
      ["allow_technical_team", "Allow Technical Team to send messages"]
    ];
    return `
      ${rows.map(([key, label]) => `
        <div class="wa-toggle-row"><span>${label}</span>
          <input type="checkbox" data-setting="${key}" ${s[key] ? "checked" : ""} /></div>
      `).join("")}
      <div class="wa-note">Automatic sending stays OFF by default. Toggling "auto open on stage change" only opens the panel for review — it never sends without an explicit click on "Send WhatsApp".</div>
    `;
  }

  function wireAutomationTab() {
    document.querySelectorAll("[data-setting]").forEach(cb => {
      cb.onchange = async () => { await saveSettings({ [cb.dataset.setting]: cb.checked }); };
    });
  }

  // ---- History tab ----
  async function historyHtml() {
    const admin = canViewAllHistory();
    return `
      <div class="wa-filters">
        <input type="text" id="waHistCustomer" placeholder="Customer name" />
        <input type="text" id="waHistAppId" placeholder="Application ID" />
        <input type="text" id="waHistMobile" placeholder="Mobile" />
        <select id="waHistStage"><option value="">All stages</option>${STAGE_OPTIONS.map(s => `<option>${s}</option>`).join("")}</select>
        <select id="waHistStatus"><option value="">All statuses</option><option>Draft</option><option>Ready</option><option>Sent</option><option>Failed</option></select>
      </div>
      <div id="waHistList">${(await listMessages(admin ? {} : { mine: (bridge().getCurrentUserData() || {}).name })).map(rowHtml).join("") || `<div class="wa-empty">No communication history yet.</div>`}</div>
    `;
  }

  function wireHistoryTab() {
    const admin = canViewAllHistory();
    const apply = async () => {
      const filters = admin ? {} : { mine: (bridge().getCurrentUserData() || {}).name };
      filters.customer = document.getElementById("waHistCustomer").value;
      filters.applicationId = document.getElementById("waHistAppId").value;
      filters.mobile = document.getElementById("waHistMobile").value;
      filters.stage = document.getElementById("waHistStage").value;
      filters.status = document.getElementById("waHistStatus").value;
      const rows = await listMessages(filters);
      document.getElementById("waHistList").innerHTML = rows.map(rowHtml).join("") || `<div class="wa-empty">No results.</div>`;
    };
    ["waHistCustomer", "waHistAppId", "waHistMobile", "waHistStage", "waHistStatus"].forEach(id => {
      const el = document.getElementById(id);
      el.oninput = apply; el.onchange = apply;
    });
  }

  // hook the template editor wiring whenever hub body re-renders into edit mode
  const _origRenderHub = renderHub;
  renderHub = async function () {
    await _origRenderHub();
    if (editingTemplate) wireTemplateEditor();
  };

  // ---------------------------------------------------------------------
  // 13. INIT
  // ---------------------------------------------------------------------
  async function initData() {
    await detectSupabase();
    await ensureDefaultTemplates();
    await loadSettings();
    dataReady = true;
  }

  let initPromise = null;
  function ensureInit() {
    if (!initPromise) initPromise = initData();
    return initPromise;
  }

  function init() {
    injectStyles();
    injectDom();
    ensureInit(); // fire and forget — openPanel/openHub await this if needed
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---------------------------------------------------------------------
  // 14. PUBLIC API
  // ---------------------------------------------------------------------
  window.SFM_WA = {
    openPanel,
    openHub,
    // exposed for debugging / future stage-change automation hooks
    _service: WhatsAppService,
    _normalizeMobile: normalizeMobile
  };

})();
