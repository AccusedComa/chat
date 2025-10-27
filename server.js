// ============================================
// WIDGET BACKEND - BHS ELETRÔNICA (v4.1)
// Multi-LLM fallback: Groq → Gemini → HuggingFace
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

// 🔑 Env keys
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || process.env.HF_API_KEY || "";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Files
const DATA_FILE = path.join(__dirname, "departments.json");
const KNOWLEDGE_FILE = path.join(__dirname, "knowledge.txt");
const STATS_FILE = path.join(__dirname, "stats.json");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "");
if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, "{}");

// Helpers to read/write
function readDepartments() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return []; }
}
function writeDepartments(v) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(v, null, 2));
}
function readKnowledge() {
  try { return fs.readFileSync(KNOWLEDGE_FILE, "utf8"); } catch { return ""; }
}
function readStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); } catch { return {}; }
}
function writeStats(v) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(v, null, 2));
}

// ===============================
// 🔍 Model status
// ===============================
let lastUsedModel = "Nenhum"; // atualizado a cada resposta bem-sucedida
app.get("/api/model", (req, res) => {
  res.json({ model: lastUsedModel || "Nenhum" });
});
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
// ===============================
// ⏱️ Fetch com timeout
// ===============================
async function fetchWithTimeout(url, opts = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(to);
  }
}

// ===============================
// 🤖 Chamadas às IAs (individuais)
// ===============================
async function callGroq(messages) {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY ausente");
  const r = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.6,
      max_tokens: 600
    })
  });
  if (!r.ok) throw new Error("Groq HTTP " + r.status);
  const d = await r.json();
  return d?.choices?.[0]?.message?.content || "";
}

async function callGemini(messages) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ausente");
  // Gemini não usa o mesmo formato de mensagens; juntamos system + user em texto
  const sys = messages.find(m => m.role === "system")?.content || "";
  const userJoined = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const full = `${sys}\n${userJoined}`.trim();

  const r = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: full }]}] })
    }
  );
  if (!r.ok) throw new Error("Gemini HTTP " + r.status);
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callHuggingFace(messages) {
  if (!HUGGINGFACE_API_KEY) throw new Error("HUGGINGFACE_API_KEY ausente");
  // Prompt simples: concatena papéis
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n") + "\nASSISTANT:";
  const r = await fetchWithTimeout(
    "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    }
  );
  if (!r.ok) throw new Error("HuggingFace HTTP " + r.status);
  const d = await r.json();
  // Alguns endpoints retornam array com generated_text
  if (Array.isArray(d) && d[0]?.generated_text) return d[0].generated_text;
  // Outros retornos podem vir em outro formato; fallback simples:
  return typeof d === "string" ? d : "Não consegui responder agora.";
}

// ===============================
// 🧠 Orquestrador com Fallback
// ===============================
async function callAI(userMessage, history = []) {
  const systemPrompt =
    readKnowledge() ||
    "Você é a assistente Bela da BHS Eletrônica. Responda em PT-BR, de forma breve, objetiva e gentil.";

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage }
  ];

  // 1) Groq
  try {
    const reply = await callGroq(messages);
    if (reply) { lastUsedModel = "Groq: llama-3.3-70b-versatile"; return reply; }
  } catch (e) { console.warn("⚠️ Groq falhou:", e.message); }

  // 2) Gemini
  try {
    const reply = await callGemini(messages);
    if (reply) { lastUsedModel = "Gemini: gemini-1.5-flash"; return reply; }
  } catch (e) { console.warn("⚠️ Gemini falhou:", e.message); }

  // 3) HuggingFace
  try {
    const reply = await callHuggingFace(messages);
    if (reply) { lastUsedModel = "HuggingFace: Mistral-7B-Instruct-v0.2"; return reply; }
  } catch (e) { console.warn("⚠️ HuggingFace falhou:", e.message); }

  // 4) Nada
  lastUsedModel = "Nenhum";
  return "Ops! Todas as IAs estão temporariamente fora do ar. Tente novamente em alguns instantes.";
}

// ===============================
// 💬 Conversas em memória
// ===============================
const conversations = new Map();

// ===============================
// 📦 API: Departments
// ===============================
app.get("/api/departments", (req, res) => res.json(readDepartments()));

app.post("/api/departments", (req, res) => {
  const { name, phone, emoji, type } = req.body;
  if (!name) return res.status(400).json({ error: "Nome obrigatório" });
  const deps = readDepartments();
  const item = {
    id: deps.length ? Math.max(...deps.map(d => d.id)) + 1 : 1,
    name,
    phone: phone || null,
    emoji: emoji || "📞",
    type: type || "whatsapp"
  };
  deps.push(item);
  writeDepartments(deps);
  res.status(201).json(item);
});

app.put("/api/departments/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const deps = readDepartments();
  const i = deps.findIndex(d => d.id === id);
  if (i === -1) return res.status(404).json({ error: "Departamento não encontrado" });
  deps[i] = { ...deps[i], ...req.body };
  writeDepartments(deps);
  res.json(deps[i]);
});

app.delete("/api/departments/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const deps = readDepartments();
  const i = deps.findIndex(d => d.id === id);
  if (i === -1) return res.status(404).json({ error: "Departamento não encontrado" });
  const removed = deps.splice(i, 1)[0];
  writeDepartments(deps);
  res.json({ ok: true, removed });
});

app.put("/api/departments/order", (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: "Formato inválido" });
    const deps = readDepartments();
    const pos = new Map(order.map((id, ix) => [id, ix]));
    deps.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    writeDepartments(deps);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ===============================
// 🧾 API: Knowledge
// ===============================
app.get("/api/knowledge", (req, res) => res.send(readKnowledge()));
app.post("/api/knowledge", (req, res) => {
  try {
    const { content } = req.body;
    fs.writeFileSync(KNOWLEDGE_FILE, content ?? "", "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ===============================
// 📊 API: Stats (opcional)
app.get("/api/stats", (req, res) => res.json(readStats()));
app.post("/api/stats", (req, res) => {
  try {
    const { event } = req.body;
    const stats = readStats();
    stats[event] = (stats[event] || 0) + 1;
    writeStats(stats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ===============================
// 💬 API: Chat
// ===============================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: "Mensagem obrigatória" });

    const sid = sessionId || "anon";
    const session = conversations.get(sid) || { history: [], lastActivity: Date.now() };

    // Comandos
    const lower = message.toLowerCase();
    if (lower.includes("/limpar")) {
      conversations.delete(sid);
      return res.json({ message: "Conversa limpa!" });
    }
    if (lower.includes("/atendente") || lower.includes("falar com humano")) {
      return res.json({
        message: "Escolha um departamento: Vendas, Suporte ou Financeiro.",
        showDepartments: true
      });
    }

    // Chamar IA
    const reply = await callAI(message, session.history);

    // Atualizar histórico
    session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
    session.lastActivity = Date.now();
    // Limitar histórico (últimas 20 mensagens p/ ambos)
    if (session.history.length > 40) session.history = session.history.slice(-40);
    conversations.set(sid, session);

    res.json({ message: reply, showDepartments: false });
  } catch (e) {
    console.error("❌ /api/chat erro:", e);
    res.status(500).json({ error: "Falha ao processar mensagem." });
  }
});

// ===============================
// 🔎 Root & Admin
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// 🚀 Start
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log("🔑 Chaves detectadas:", {
    GROQ: !!GROQ_API_KEY,
    GEMINI: !!GEMINI_API_KEY,
    HUGGINGFACE: !!HUGGINGFACE_API_KEY
  });
  console.log("ℹ️  Modelo atual (último que respondeu) aparece em GET /api/model");
});
