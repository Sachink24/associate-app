// =========================================================
// SOLITAIRE FINZ MART — ai-credit-assistant
// INTERNAL ONLY — Credit Team, Owner, Manager and Business Associates.
// Generates a structured credit assessment from all available
// lead data. The credit team edits the output before saving;
// nothing is ever auto-approved or auto-rejected.
//
// Auth: verify_jwt ON (valid login) PLUS an in-function role check
// (current_user_role() must be owner / manager / credit / business).
// Reads and the assessment save run as the CALLER, so existing RLS
// still applies — this function never widens anyone's access.
//
// Reliability: the old default model (gemini-3.8-flash) hangs from the Edge runtime, and
// this call had no timeout, so the AI Draft buttons could spin indefinitely. Default is now
// gemini-3.5-flash-lite with a hard timeout; on any Gemini failure the deterministic fallback
// template is returned so staff are never left waiting on nothing.
//
// POST { lead_id: number, save?: boolean }
// Response: { ok: true, assessment: { ... } }
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS") ?? 40000);

// Service client is used ONLY for the audit log (ai_skill_logs has no INSERT
// policy for authenticated users). Every read of lead data, and the save of the
// assessment, runs as the CALLER via a user-scoped client so existing RLS and
// role permissions still apply — this function never widens anyone's access.
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// business = associate/BA role; they use the AI Draft button in the associate app
const ALLOWED_ROLES = ["owner", "manager", "credit", "business"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SYSTEM_PROMPT = `You are an internal credit analysis assistant for SOLITAIRE FINZ MART, a loan DSA and advisory firm in India. You help staff prepare structured notes on a loan application — you do NOT make the final decision.

Rules you must always follow:
- Never approve or reject a loan application. Your output is advisory and must be reviewed by the authorised team member.
- Never fabricate data that is not in the application. If something is missing, say it is missing.
- Be factual, concise and professional. No marketing language.
- Keep each section under 120 words.
- Flag any income inconsistencies, missing documents or risk alerts, but never make definitive fraud accusations — use "requires verification" language.
- Output ONLY valid JSON with the exact keys specified.`;

async function callGemini(userText: string): Promise<Record<string, string> | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: userText }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) { console.error("Gemini error", res.status); return null; }
    const j = await res.json();
    const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch (e) { console.error("Gemini call failed:", (e as any)?.name ?? e); return null; }
}

const RECOMMENDATION_LABELS = ["PROCEED WITH VERIFICATION", "REQUEST MORE INFORMATION", "ESCALATE FOR REVIEW"];
const BANNED_DECISION_WORDS = /\b(approv\w*|sanction\w*|reject\w*|declin\w*|guarantee\w*)\b/i;

function cleanRecommendation(raw: unknown): string {
  const text = String(raw ?? "").trim();
  const label = RECOMMENDATION_LABELS.find((l) => text.toUpperCase().startsWith(l));
  if (!label) return "REQUEST MORE INFORMATION \u2014 Please review manually.";
  const rest = text.slice(label.length).replace(/^[\s.:\u2014\u2013-]+/, "");
  if (!rest || BANNED_DECISION_WORDS.test(rest)) return label;
  return `${label} \u2014 ${rest}`;
}

function fmtINR(n: unknown): string {
  if (!n) return "Not stated";
  return "Rs. " + Math.round(Number(n)).toLocaleString("en-IN");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  // ---- Authorization ----
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: role, error: roleErr } = await uc.rpc("current_user_role");
  if (roleErr || !ALLOWED_ROLES.includes(String(role))) {
    return json({ ok: false, error: "Forbidden: this assistant is restricted to Credit, Manager, Owner and Business Associate roles." }, 403);
  }

  const leadId = Number(body?.lead_id);
  if (!leadId) return json({ ok: false, error: "lead_id required" }, 400);
  const save = body?.save !== false;

  // ---- Pull all available data (as the caller, under RLS) ----
  const [leadRes, docsRes, workflowRes, riskRes, eligRes, scoreRes, convRes] = await Promise.all([
    uc.from("leads").select("*").eq("id", leadId).maybeSingle(),
    uc.from("lead_documents").select("file_name, source, created_at").eq("lead_id", leadId).order("created_at"),
    uc.from("workflow_history").select("action, new_status, remarks, created_at, user_name, role").eq("lead_id", leadId).order("created_at"),
    uc.from("ai_risk_alerts").select("severity, title, description, status").eq("lead_id", leadId).order("created_at"),
    uc.from("ai_eligibility_assessments").select("result, verdict, created_at").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    uc.from("ai_lead_scores").select("temperature, score, ai_summary").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
    uc.from("ai_document_insights").select("document_type, verification_status, expiry_status, risk_flags, ai_summary, extracted_data").eq("lead_id", leadId),
  ]);

  const lead = leadRes.data;
  if (!lead) return json({ ok: false, error: "Lead not found" }, 404);
  const borrower: Record<string, unknown> = lead.borrower ?? {};
  const docs     = docsRes.data ?? [];
  const history  = workflowRes.data ?? [];
  const risks    = riskRes.data ?? [];
  const elig     = eligRes.data?.[0];
  const score    = scoreRes.data?.[0];
  const insights = convRes.data ?? [];

  const ctx = `
APPLICATION SUMMARY
Lead ID: ${lead.id}
Loan Type: ${lead.loan_type ?? "Unknown"}
Requested Amount: ${fmtINR(lead.loan_amount)}
Stage: ${lead.stage ?? "\u2014"} | Status: ${lead.status ?? "\u2014"}
Source: ${lead.lead_source ?? "Unknown"}
Created: ${new Date(lead.created_at).toLocaleDateString("en-IN")}
Assigned BA: ${lead.assigned_ba ?? "Unassigned"}

APPLICANT
Name: ${borrower.name ?? "Not stated"}
Phone: ${borrower.phone ?? "Not stated"}
Location: ${borrower.location ?? "Not stated"}
Employment: ${borrower.employment ?? "Not stated"}
Declared Monthly Income: ${fmtINR(borrower.income)}

PRELIMINARY ELIGIBILITY ESTIMATE
${elig ? `Verdict: ${elig.verdict}\nEstimated eligible: ${fmtINR(elig.result?.final_eligible)}\nEstimated EMI: ${fmtINR(elig.result?.proposed_emi)}\nFOIR: ${elig.result?.foir_pct ?? "N/A"}%` : "No eligibility estimate available."}

LEAD SCORE
${score ? `${score.temperature} (${score.score}/100): ${score.ai_summary ?? ""}` : "Not scored yet."}

DOCUMENTS UPLOADED (${docs.length})
${docs.length ? docs.map((d: any) => `- ${d.file_name} (${d.source})`).join("\n") : "None uploaded."}

AI DOCUMENT INSIGHTS
${insights.length ? insights.map((i: any) => `- ${i.document_type}: ${i.verification_status}${i.expiry_status && i.expiry_status !== "not_applicable" ? " | Expiry: " + i.expiry_status : ""}${Array.isArray(i.risk_flags) && i.risk_flags.length ? " | Flags: " + i.risk_flags.join(", ") : ""}${i.ai_summary ? " | " + i.ai_summary : ""}`).join("\n") : "No AI document analysis available yet."}

AI RISK ALERTS (${risks.length})
${risks.length ? risks.map((r: any) => `- [${r.severity}] ${r.title}: ${r.description} (Status: ${r.status})`).join("\n") : "No risk alerts."}

WORKFLOW HISTORY
${history.length ? history.map((h: any) => `- ${new Date(h.created_at).toLocaleDateString("en-IN")} | ${h.user_name} (${h.role}): ${h.action}${h.remarks ? " \u2014 " + h.remarks : ""}`).join("\n") : "No workflow history."}
`.trim();

  const prompt = `Based on the following loan application data, generate a structured assessment. Respond with ONLY a JSON object with exactly these keys:
- applicant_summary: Brief factual summary of the applicant and requirement (2-3 sentences).
- credit_observations: Key observations about income, employment, obligations and loan amount (2-4 sentences).
- missing_information: Bullet list of specific items not yet provided or verified. Use "- " prefix for each item.
- risk_observations: Summary of risk flags and concerns, severity and what needs verification.
- questions_for_applicant: 3-5 specific questions to ask the applicant. Use "- " prefix.
- draft_comments: Draft comments for the file (3-4 sentences, neutral and factual).
- draft_recommendation: One of: "PROCEED WITH VERIFICATION", "REQUEST MORE INFORMATION", "ESCALATE FOR REVIEW". Then one sentence explaining why.

Application data:
${ctx}`;

  const aiResult = await callGemini(prompt);

  const fallback = {
    applicant_summary: `Applicant ${borrower.name ?? "Unknown"} has requested ${fmtINR(lead.loan_amount)} for ${lead.loan_type ?? "a loan"}. Gemini analysis unavailable \u2014 manual review required.`,
    credit_observations: "Manual review required. AI analysis could not be generated.",
    missing_information: docs.length === 0 ? "- No documents uploaded yet." : "- Review documents for completeness.",
    risk_observations: risks.filter((r: any) => r.status === "OPEN").length > 0 ? `${risks.filter((r: any) => r.status === "OPEN").length} open risk alert(s). Manual review required.` : "No open risk alerts.",
    questions_for_applicant: "- Please provide income proof.\n- Please confirm existing loan obligations.\n- What is the purpose of the loan?",
    draft_comments: "Application received. Review pending.",
    draft_recommendation: "REQUEST MORE INFORMATION \u2014 Insufficient data for full assessment.",
  };

  const assessment = aiResult ?? fallback;
  assessment.draft_recommendation = cleanRecommendation(assessment.draft_recommendation);

  if (save) {
    await uc.from("ai_credit_assessments").insert({
      lead_id: leadId,
      generated_by: "ai-credit-assistant",
      applicant_summary: assessment.applicant_summary ?? null,
      credit_observations: assessment.credit_observations ?? null,
      missing_information: assessment.missing_information ?? null,
      risk_observations: assessment.risk_observations ?? null,
      questions_for_applicant: assessment.questions_for_applicant ?? null,
      draft_comments: assessment.draft_comments ?? null,
      draft_recommendation: assessment.draft_recommendation ?? null,
      status: "DRAFT",
    });
  }

  await sb.from("ai_skill_logs").insert({
    skill_name: "ai-credit-assistant",
    lead_id: leadId,
    input_summary: `lead_id=${leadId}`,
    output_summary: `${assessment.draft_recommendation ?? "Generated"}${aiResult ? "" : " [fallback template — Gemini unavailable]"}`,
    model: GEMINI_MODEL,
    status: "SUCCESS",
  });

  return json({ ok: true, assessment, generated_by_ai: !!aiResult });
});
