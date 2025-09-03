// Vercel Serverless Function: POST /api/verify
// Env vars required in Vercel project settings:
//  - OPENAI_API_KEY
//  - TAVILY_API_KEY
// CORS: open to mobile app.

export const config = { runtime: "edge" };

type Source = { title: string; url: string; snippet: string };
type Out = {
  label: "GREEN" | "YELLOW" | "RED";
  confidence: number;
  summary: string;
  sources: Source[];
};

function jsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "cache-control": "no-store",
    },
  });
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return jsonResponse({}, 200);
  if (req.method !== "POST") return jsonResponse({ error: "Use POST" }, 405);

  const { text } = await req.json().catch(() => ({} as any));
  if (!text || String(text).trim().length < 10)
    return jsonResponse({ error: "text is required" }, 400);

  const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!TAVILY_API_KEY || !OPENAI_API_KEY)
    return jsonResponse({ error: "Server not configured" }, 500);

  // 1) Web search (Tavily)
  const tavily = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: String(text).slice(0, 400),
      search_depth: "advanced",
      include_answer: false,
      include_images: false,
      max_results: 6,
    }),
  }).then(r => r.json() as Promise<any>).catch(() => null);

  const sources: Source[] =
    tavily?.results?.map((r: any) => ({
      title: r.title || r.url || "source",
      url: r.url,
      snippet: r.content?.slice(0, 280) || "",
    }))?.slice(0, 5) || [];

  // 2) Ask OpenAI to judge using those sources
  const sys = `You are a rigorous fact-checking assistant.
Given a user's on-screen text (a social post) and a list of web results,
decide a verdict label and provide a short explanation.
Labels:
- GREEN: likely correct / low risk
- YELLOW: uncertain / mixed / needs caution
- RED: likely false or misleading

Return ONLY strict JSON: {"label":"GREEN|YELLOW|RED","confidence":0.0-1.0,"summary":"...", "sources":[{"title":"...","url":"..."}]}
Base your decision on the provided sources; do not fabricate links.`;

  const user = {
    role: "user",
    content: [
      { type: "text", text: `POST_TEXT:\n${text}\n\nWEB_RESULTS:\n${sources.map((s,i)=>`${i+1}. ${s.title}\n${s.url}\n${s.snippet}\n`).join("\n")}` }
    ],
  };

  const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        user as any
      ],
    }),
  }).then(r => r.json()).catch(() => null);

  let out: Out | null = null;
  try {
    const txt = openaiResp?.choices?.[0]?.message?.content || "{}";
    out = JSON.parse(txt);
  } catch {}

  if (!out || !out.label || !["GREEN","YELLOW","RED"].includes(out.label))
    out = {
      label: "YELLOW",
      confidence: 0.5,
      summary: "Could not verify confidently. Review sources manually.",
      sources: sources.map(s => ({ title: s.title, url: s.url, snippet: s.snippet })),
    };

  if (!out.sources?.length) out.sources = sources;

  out.sources = out.sources.slice(0, 5).map(s => ({
    title: s.title?.slice(0, 140) || "source",
    url: s.url,
    snippet: (s as any).snippet ? String((s as any).snippet).slice(0, 220) : ""
  }));

  return jsonResponse(out);
}
