// =========================================================
// SOLITAIRE FINZ MART — ai-lead-score
// Triggered by trg_ai_lead_score (AFTER INSERT on leads).
// Scores every new lead HOT/WARM/COLD using a deterministic
// point system plus an optional Gemini summary.
//
// Auth: verify_jwt OFF — called by Postgres via pg_net.
//
// Reliability: the Gemini summary is OPTIONAL. It has a hard timeout so a slow
// or hung model can never stop the score from being saved. (The previous default
// model, gemini-3.8-flash, was found to hang from the Edge runtime.)
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS") ?? 10000);
const AI_SKILLS_NOTIFY_SECRET = Deno.env.get("AI_SKILLS_NOTIFY_SECRET")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- Deterministic scoring ----------------------------------------
// Points are additive. Max possible ~100.
// NOTE: these are starting weights — tune based on actual conversion data.

function scoreAmount(amount: number | null, loanType: string): number {
  if (!amount || amount <= 0) return 0;
  // Higher amounts = higher priority for the business
  if (amount >= 10000000) return 20; // 1 Cr+
  if (amount >= 5000000)  return 16; // 50L+
  if (amount >= 2500000)  return 12; // 25L+
  if (amount >= 1000000)  return 8;  // 10L+
  return 4;
}

function scoreCompleteness(borrower: Record<string, unknown>): number {
  let pts = 0;
  if (borrower.name)       pts += 8;
  if (borrower.phone)      pts += 5;
  if (borrower.income)     pts += 10;
  if (borrower.location)   pts += 5;
  if (borrower.employment) pts += 7;
  return pts; // max 35
}

function scoreSource(source: string | null, isExisting: boolean): number {
  if (isExisting) return 15;
  if (source === "whatsapp_referral")   return 12;
  if (source === "whatsapp_organic")    return 8;
  if (source === "website")             return 6;
  return 4;
}

function scoreDocuments(docCount: number): number {
  if (docCount >= 5) return 15;
  if (docCount >= 3) return 10;
  if (docCount >= 1) return 5;
  return 0;
}

// Engagement signal: how quickly the customer completed the WhatsApp flow
// (first message -> lead created). Comparing "last message" to lead creation
// would be meaningless because the bot creates the lead in response to the
// final message, so that gap is always ~0. Leads not created via WhatsApp
// have no conversation and simply score 0 here.
function scoreEngagement(leadCreatedAt: string, convStartedAt: string | null): number {
  if (!convStartedAt) return 0;
  const diffMin = (new Date(leadCreatedAt).getTime() - new Date(convStartedAt).getTime()) / 60000;
  if (!isFinite(diffMin) || diffMin < 0) return 0;
  if (diffMin <= 15)   return 10; // finished the whole flow within 15 minutes
  if (diffMin <= 120)  return 6;
  if (diffMin <= 1440) return 3;  // same day
  return 0;
}

async function callGemini(system: string, user: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: user }] }], systemInstruction: { parts: [{ text: system }] }, generationConfig: { temperature: 0.2, maxOutputTokens: 600 } }),
    });
    if (!res.ok) { console.error("lead-score Gemini HTTP", res.status); return null; }
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (e) {
    console.error("lead-score Gemini failed (continuing without summary):", (e as any)?.name ?? e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = req.headers.get("x-ai-skills-secret");
  if (!secret || secret !== AI_SKILLS_NOTIFY_SECRET) return new Response("Forbidden", { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad payload", { status: 400 }); }
  const leadId = body?.lead_id;
  if (!leadId) return new Response("Missing lead_id", { status: 400 });

  const { data: lead } = await sb.from("leads")
    .select("id, borrower, loan_type, loan_amount, lead_source, created_at, assigned_ba")
    .eq("id", leadId).maybeSingle();
  if (!lead) return new Response("Lead not found", { status: 200 });

  const borrower: Record<string, unknown> = lead.borrower ?? {};
  const { count: docCount } = await sb.from("lead_documents").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
  const { data: conv } = await sb.from("whatsapp_conversations").select("created_at, is_existing_customer").eq("wa_number", String(borrower.phone ?? "")).maybeSingle();
  const priorLeads = await sb.from("leads").select("id", { count: "exact", head: true }).neq("id", leadId).eq("borrower->>phone", String(borrower.phone ?? ""));

  const isExisting = conv?.is_existing_customer ?? (priorLeads.count ?? 0) > 0;
  const amtPts   = scoreAmount(lead.loan_amount, lead.loan_type ?? "");
  const compPts  = scoreCompleteness(borrower);
  const srcPts   = scoreSource(lead.lead_source, isExisting);
  const docPts   = scoreDocuments(docCount ?? 0);
  const respPts  = scoreEngagement(lead.created_at, conv?.created_at ?? null);
  const score    = Math.min(100, amtPts + compPts + srcPts + docPts + respPts);

  const temperature = score >= 70 ? "HOT" : score >= 45 ? "WARM" : "COLD";
  const priority    = temperature === "HOT" ? "HIGH" : temperature === "WARM" ? "MEDIUM" : "LOW";

  const nextActions: Record<string, string> = {
    HOT:  "Call within 2 hours. Customer is active and requirement is clear.",
    WARM: "Follow up today. Gather missing income/document details.",
    COLD: "Send WhatsApp message. Verify requirement and gather more information.",
  };

  const breakdown = { amount: amtPts, completeness: compPts, source: srcPts, documents: docPts, engagement: respPts };

  // Optional Gemini summary (2 sentences max). Never blocks saving the score.
  let summary: string | null = null;
  if (GEMINI_API_KEY) {
    const ctx = `Lead details: loan type=${lead.loan_type}, amount=Rs.${lead.loan_amount?.toLocaleString("en-IN") ?? "unknown"}, income=${borrower.income ?? "not stated"}, location=${borrower.location ?? "unknown"}, source=${lead.lead_source ?? "unknown"}, existing customer=${isExisting}, documents uploaded=${docCount ?? 0}.`;
    summary = await callGemini(
      "You write a 1-2 sentence CRM summary for a loan sales team. Be factual, mention the loan type and amount, note any gaps or urgency. Never promise approval.",
      ctx
    );
  }

  const segment = isExisting ? "Existing Customer" : lead.lead_source === "whatsapp_referral" ? "Referred" : "New Organic";

  await sb.from("ai_lead_scores").insert({
    lead_id: leadId,
    temperature,
    score,
    priority,
    intent: lead.loan_type ?? "Unknown",
    customer_segment: segment,
    follow_up_priority: priority,
    suggested_next_action: nextActions[temperature],
    score_breakdown: breakdown,
    ai_summary: summary,
    recommended_ba: lead.assigned_ba ?? null,
  });

  await sb.from("ai_skill_logs").insert({
    skill_name: "ai-lead-score",
    lead_id: leadId,
    input_summary: `lead_id=${leadId}`,
    output_summary: `${temperature} (${score}/100)${summary ? "" : " [no AI summary]"}`,
    model: GEMINI_MODEL,
    status: "SUCCESS",
  });

  return new Response(JSON.stringify({ temperature, score }), { status: 200, headers: { "Content-Type": "application/json" } });
});
