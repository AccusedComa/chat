// ============================================
// WIDGET BACKEND - BHS ELETRÔNICA (v4.2 - stats restore)
// Multi-LLM fallback: Groq → Gemini → HuggingFace
// Stats format: [{type,label,message,source,timestamp}]
// ============================================

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 🔑 Chaves das APIs
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY || "";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Caminhos de arquivos
const DATA_FILE = path.join(__dirname, "departments.json");
const KNOW_FILE = path.join(__dirname, "knowledge.txt");
const STATS_FILE = path.join(__dirname, "stats.json");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOW_FILE)) fs.writeFileSync(KNOW_FILE, "");
if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, "[]");

// Helpers de leitura/escrita
const readJSON = f => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
};
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

function appendEvent(evt) {
  let arr = [];

  try {
    const raw = fs.readFileSync(STATS_FILE, "utf8") || "[]";
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (typeof parsed === "object") {
      // converte objetos antigos em formato novo
      arr = Object.entries(parsed).map(([k, v]) => ({
        type: k,
        label: null,
        message: String(v),
        source: "legacy",
        timestamp: new Date().toISOString()
      }));
    }
  } catch (e) {
    console.warn("⚠️ stats.json inválido, recriando...");
  }

  const e = {
    type: evt?.type || "unknown",
    label: evt?.label || null,
    message: evt?.message || null,
    source: evt?.source || "widget",
    timestamp: new Date().toISOString()
  };

  arr.push(e);

  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(arr, null, 2));
  } catch (err) {
    console.error("❌ Erro ao salvar stats.json:", err.message);
  }

  return e;
}



// ===============================
// 🤖 IA Fallback
// ===============================
let lastUsedModel = "Nenhum";

async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function callGroq(messages) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY ausente");
  const r = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.6, max_tokens: 600 })
  });
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "";
}

async function callGemini(messages) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ausente");
  const sys = messages.find(m => m.role === "system")?.content || "";
  const user = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const full = `${sys}\n${user}`;
  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: full }]}] }) }
  );
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callHF(messages) {
  if (!HF_API_KEY) throw new Error("HUGGINGFACE_API_KEY ausente");
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n") + "\nASSISTANT:";
  const r = await fetchWithTimeout("https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2", {
    method: "POST",
    headers: { "Authorization": `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ inputs: prompt })
  });
  const d = await r.json();
  if (Array.isArray(d) && d[0]?.generated_text) return d[0].generated_text;
  return typeof d === "string" ? d : "Sem resposta agora.";
}

async function callAI(msg, hist = []) {
  const sys = fs.readFileSync(KNOW_FILE, "utf8") || "Você é a assistente Bela da BHS Eletrônica.";
  const messages = [{ role: "system", content: sys }, ...hist, { role: "user", content: msg }];

  try { const r = await callGroq(messages); if (r) { lastUsedModel = "Groq"; return r; } } catch {}
  try { const r = await callGemini(messages); if (r) { lastUsedModel = "Gemini"; return r; } } catch {}
  try { const r = await callHF(messages); if (r) { lastUsedModel = "HuggingFace"; return r; } } catch {}

  lastUsedModel = "Nenhum";
  return "Todas as IAs estão temporariamente indisponíveis.";
}

// ===============================
// 📊 Stats APIs
// ===============================
app.get("/api/stats", (_, res) => res.json(readJSON(STATS_FILE)));

app.post("/api/stats", (req, res) => {
  try { res.json({ ok: true, saved: appendEvent(req.body) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Endpoints compatíveis com widget
["department","message","ai","link","open"].forEach(type=>{
  app.post(`/api/track/${type}`, (req,res)=>{
    const data = req.body || {};
    appendEvent({ type, label: data.name||data.url||null, message: data.message||null, source:"widget" });
    res.json({ ok:true });
  });
});

// ===============================
// 💬 Chat API
// ===============================
const sessions = new Map();

app.post("/api/chat", async (req,res)=>{
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error:"Mensagem obrigatória" });
  appendEvent({ type:"user_message", message, source:"widget" });

  const s = sessions.get(sessionId) || { hist: [] };
  const reply = await callAI(message, s.hist);
  s.hist.push({ role:"user", content:message }, { role:"assistant", content:reply });
  sessions.set(sessionId, s);

  appendEvent({ type:"ai_response", message:reply, label:lastUsedModel, source:"backend" });
  res.json({ message:reply });
});

// ===============================
app.listen(PORT, ()=>console.log(`🚀 http://localhost:${PORT}`));
