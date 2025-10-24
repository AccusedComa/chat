// ============================================
// WIDGET BACKEND - BHS v5.3
// Correções: IA treinável + stats detalhado
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
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "departments.json");
const KNOWLEDGE_FILE = path.join(__dirname, "knowledge.txt");
const STATS_FILE = path.join(__dirname, "stats.json");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "");
if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, "[]");

// =============== Leitura / Escrita ===============
function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return []; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// =============== Cache de conhecimento ===============
let currentKnowledge = fs.existsSync(KNOWLEDGE_FILE)
  ? fs.readFileSync(KNOWLEDGE_FILE, "utf8")
  : "";

// =============== Função de IA ===============
async function callAI(userMessage, history = []) {
  try {
    const messages = [
      { role: "system", content: currentKnowledge || "Você é a assistente Bela da BHS Eletrônica. Responda de forma resumida, simpática e clara." },
      ...history,
      { role: "user", content: userMessage }
    ];
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, temperature: 0.6, max_tokens: 300 })
    });
    if (!resp.ok) throw new Error("Groq " + resp.status);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "Não consegui responder agora.";
  } catch (err) {
    console.error("Erro Groq:", err);
    return "Ops! O servidor da IA está temporariamente fora do ar. Tente novamente em instantes.";
  }
}

// =============== Departamentos ===============
app.get("/api/departments", (req, res) => res.json(readJSON(DATA_FILE)));

app.post("/api/departments", (req, res) => {
  const { name, phone, emoji, type } = req.body;
  if (!name) return res.status(400).json({ error: "Nome é obrigatório" });
  const deps = readJSON(DATA_FILE);
  const newDep = {
    id: deps.length ? Math.max(...deps.map(d => d.id)) + 1 : 1,
    name, phone, emoji, type
  };
  deps.push(newDep);
  writeJSON(DATA_FILE, deps);
  res.status(201).json(newDep);
});

app.put("/api/departments/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const deps = readJSON(DATA_FILE);
  const idx = deps.findIndex(d => d.id === id);
  if (idx === -1) return res.status(404).json({ error: "Não encontrado" });
  deps[idx] = { ...deps[idx], ...req.body };
  writeJSON(DATA_FILE, deps);
  res.json(deps[idx]);
});

app.post("/api/departments/order", (req, res) => {
  try {
    const { order } = req.body;
    const deps = readJSON(DATA_FILE);
    const orderNums = order.map(Number);
    const pos = new Map(orderNums.map((id, i) => [id, i]));
    deps.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    writeJSON(DATA_FILE, deps);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Falha ao salvar ordem" });
  }
});

// =============== Chat + IA ===============
const sessions = new Map();

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: "Mensagem obrigatória" });
  const sid = sessionId || "anon";
  const session = sessions.get(sid) || { history: [] };
  const reply = await callAI(message, session.history);
  session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
  sessions.set(sid, session);

  // salva estatística
  const stats = readJSON(STATS_FILE);
  stats.push({ type: "message", label: message, timestamp: new Date().toISOString() });
  writeJSON(STATS_FILE, stats);

  res.json({ message: reply });
});

// =============== Estatísticas ===============
app.post("/api/stats/add", (req, res) => {
  const { type, label } = req.body;
  if (!type) return res.status(400).json({ error: "Tipo obrigatório" });
  const stats = readJSON(STATS_FILE);
  stats.push({ type, label, timestamp: new Date().toISOString() });
  writeJSON(STATS_FILE, stats);
  res.json({ ok: true });
});

app.get("/api/stats", (req, res) => {
  const stats = readJSON(STATS_FILE);
  const summary = {};
  for (const s of stats) {
    const key = `${s.type}::${s.label || "N/A"}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  const grouped = Object.entries(summary).map(([key, count]) => {
    const [type, label] = key.split("::");
    return { type, label, count };
  });
  res.json({ total: stats.length, grouped });
});

app.delete("/api/stats", (req, res) => {
  writeJSON(STATS_FILE, []);
  res.json({ ok: true });
});

// =============== Treinar IA ===============
app.get("/api/knowledge", (req, res) => res.send(currentKnowledge));
app.post("/api/knowledge", (req, res) => {
  try {
    const { content } = req.body;
    fs.writeFileSync(KNOWLEDGE_FILE, content ?? "", "utf8");
    currentKnowledge = content; // atualiza cache
    res.json({ ok: true, msg: "IA atualizada com sucesso!" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// =============== Admin ===============
app.get("/admin", (req, res) => {
  res.send(`
  <!doctype html><html><head><meta charset="utf-8"/><title>Admin - BHS</title>
  <style>body{font-family:Segoe UI,Arial;background:#f5f5f5;margin:0;padding:20px}
  .wrap{max-width:920px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
  .card{background:#fff;border-radius:14px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-decoration:none;color:#111;display:block}
  .card:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(0,0,0,.12)}h1{margin-top:0}</style></head>
  <body><div class="wrap"><h1>🛠️ Administração</h1>
  <div class="grid">
    <a class="card" href="/departments.html">📱 Departamentos</a>
    <a class="card" href="/train.html">🤖 Treinar IA</a>
    <a class="card" href="/stats.html">📊 Estatísticas</a>
  </div></div></body></html>`);
});

app.listen(PORT, () => console.log(`🚀 BHS rodando em http://localhost:${PORT}`));
