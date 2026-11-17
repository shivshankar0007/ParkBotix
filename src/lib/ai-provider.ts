import { db, aiActivity } from "@/db";

export interface AiCompletionResult {
  text: string;
  provider: "gemini" | "groq" | "deterministic-engine";
  latencyMs: number;
}

export async function generateAiText(
  systemPrompt: string,
  userPrompt: string,
  fallbackText: string
): Promise<AiCompletionResult> {
  const start = Date.now();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          return { text, provider: "groq", latencyMs: Date.now() - start };
        }
      }
    } catch {
      // Fall through to Gemini or deterministic engine
    }
  }

  if (geminiKey) {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          geminiKey
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
              },
            ],
          }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          return { text, provider: "gemini", latencyMs: Date.now() - start };
        }
      }
    } catch {
      // Fall through to deterministic engine
    }
  }

  return {
    text: fallbackText,
    provider: "deterministic-engine",
    latencyMs: Math.max(4, Date.now() - start),
  };
}

export async function recordAiActivity(params: {
  endpoint: string;
  module: string;
  userId?: number | null;
  lotId?: number | null;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  provider: string;
  latencyMs: number;
  status?: string;
}): Promise<void> {
  try {
    await db.insert(aiActivity).values({
      endpoint: params.endpoint,
      module: params.module,
      userId: params.userId ?? null,
      lotId: params.lotId ?? null,
      requestPayload: params.requestPayload ?? {},
      responsePayload: params.responsePayload ?? {},
      provider: params.provider,
      latencyMs: params.latencyMs,
      status: params.status ?? "success",
    });
  } catch {
    // Non-blocking audit log
  }
}
