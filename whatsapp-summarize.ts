// =========================================================
// SOLITAIRE FINZ MART — whatsapp-summarize
// Called by the Admin Panel (or any logged-in staff tool) to generate a
// short, factual summary of a WhatsApp conversation transcript, for staff
// who haven't read the full chat. Writes the result onto
// whatsapp_conversations.ai_summary so it persists and doesn't need to be
// regenerated on every view.
//
// FIX HISTORY:
//  - CORS (the Admin Panel calls this from the browser) + role gate + caller-scoped reads.
//  - Reliability: the old default model (gemini-3.8-flash) hangs from the Edge runtime and
//    this call had no timeout, so the "AI Summary" button could spin indefinitely.
//    Default is now gemini-3.5-flash-lite with a hard timeout.
//
// Request body: { "conversation_id": "<uuid>" }
// Response: { "summary": "..." } on success, or { "error": "..." }
// =========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
const GEMINI_TIMEOUT_MS = Number(Deno.env.get("GEMINI_TIMEOUT_MS") ?? 25000);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const ALLOWED_ROLES = ["owner", "manager", "credit", "support"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SUMMARY_PROMPT = `You are summarizing a WhatsApp conversation between a customer and SOLITAIRE FINZ MART, a loan advisory business, for an internal staff member who has not read the chat. Write a concise summary as 3-5 short plain-text bullet points (start each with "- ", no markdown headers or bold) covering: what the customer wants, key details they shared (loan type, amount, location, income if mentioned), where the conversation currently stands, and anything that needs staff follow-up or seems urgent/unusual. Be strictly factual — do not invent details that are not present in the transcript below.`;

async function callGemini(systemPrompt: string, userText: string): Promise<string | null> {
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
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini API error", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.error("Gemini call failed:", (err as any)?.name ?? err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad payload" }, 400); }

  // ---- Authorization ----
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Unauthorized" }, 401);
  const uc = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: role, error: roleErr } = await uc.rpc("current_user_role");
  if (roleErr || !ALLOWED_ROLES.includes(String(role))) {
    return json({ error: "Forbidden: conversation summaries are restricted to Owner, Manager, Credit and Support roles." }, 403);
  }

  const conversationId = body?.conversation_id;
  if (!conversationId) return json({ error: "Missing conversation_id" }, 400);

  // Read the transcript AS THE CALLER so RLS still applies.
  const { data: messages, error } = await uc
    .from("whatsapp_messages")
    .select("direction, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load messages", error);
    return json({ error: "Could not load conversation" }, 500);
  }
  if (!messages || !messages.length) return json({ error: "No messages found for this conversation" }, 404);

  const transcript = messages
    .map((m: any) => `${m.direction === "inbound" ? "Customer" : "Bot"}: ${m.body ?? ""}`)
    .join("\n");

  const summary = await callGemini(SUMMARY_PROMPT, transcript);
  if (!summary) {
    return json({ error: "Summarization unavailable — Gemini did not respond. Please try again shortly." }, 503);
  }

  const trimmed = summary.trim();
  // Authorized above, so write back with the service key.
  await sb.from("whatsapp_conversations").update({
    ai_summary: trimmed,
    ai_summary_updated_at: new Date().toISOString(),
  }).eq("id", conversationId);

  return json({ summary: trimmed });
});
