const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `You are Amsa, a friendly assistant that speaks English and Hausa.
- Reply in the language the user writes in (English or Hausa). If they mix, mirror them.
- Keep answers short, clear, and easy to read on a phone.
- If you are not sure of a fact, say so plainly instead of guessing.
- Be respectful and polite. Do not give medical, legal, or financial decisions as certain; suggest a qualified person.`;

// In-memory sessions (reset when the server restarts)
const sessions = new Map();
const MAX_TURNS = 20;

// Simple rate limit: 20 requests per minute per IP
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 20;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (typeof sessionId !== "string" || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (limited(req.ip)) {
    return res.status(429).json({ error: "Too many messages. Please wait a moment." });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
  }

  const history = sessions.get(sessionId) || [];
  history.push({ role: "user", parts: [{ text: message.trim().slice(0, 2000) }] });
  const trimmed = history.slice(-MAX_TURNS * 2);

  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: trimmed,
        generationConfig: { maxOutputTokens: 800 },
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Gemini error:", r.status, JSON.stringify(data));
      const msg = r.status === 429
        ? "Amsa is busy right now. Please try again in a minute."
        : "Amsa could not answer right now. Please try again.";
      return res.status(500).json({ error: msg });
    }
    const reply = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("\n")
      .trim();
    if (!reply) return res.status(500).json({ error: "No answer came back. Please rephrase and try again." });
    trimmed.push({ role: "model", parts: [{ text: reply }] });
    sessions.set(sessionId, trimmed);
    res.json({ reply });
  } catch (err) {
    console.error("Request error:", err.message);
    res.status(500).json({ error: "Amsa could not answer right now. Please try again." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Amsa running on port ${PORT}`));
