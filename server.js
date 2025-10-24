// ============================================
// BHS Widget - v5 (Railway-ready)
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
const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim();

// ---------- middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- data files ----------
const DATA_FILE = path.join(__dirname, "departments.json");
const KNOWLEDGE_FILE = path.join(__dirname, "knowledge.txt");
const STATS_FILE = path.join(__dirname, "stats.json");

// bootstrap files
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "");
if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, JSON.stringify({
  departamentos: {}, links: {}, interacoes: 0
}, null, 2));

// helpers
const readDepartments = () => {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return []; }
};
const writeDepartments = (arr) => {
  // grava de forma síncrona e robusta
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, DATA_FILE);
};
const readKnowledge = () => {
  try { return fs.readFileSync(KNOWLEDGE_FILE, "utf8"); } catch { return ""; }
};
const readStats = () => {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, "utf8")); } catch {
    return { departamentos: {}, links: {}, interacoes: 0 };
  }
};
const writeStats = (obj) => {
  const tmp = STATS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, STATS_FILE);
};

// ---------- IA com resumo curto + fallback 429 ----------
let fallbackActive = false; // alterna 70b -> 8b se bater limite

async function callGroq(model, messages) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 500
    })
  });
  return resp;
}

function clipReply(text, limit = 420) {
  if (!text) return text;
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > limit ? clean.slice(0, limit).trim() + "…" : clean;
}

async function callAI(userMessage, history = []) {
  try {
    if (!GROQ_API_KEY) {
      return "Servidor da IA não configurado. Digite /atendente para falar com humano.";
    }

    // instrução pra respostas curtas
    const sys = `${readKnowledge()}

Regras de estilo:
- Responda em PT-BR.
- Seja objetivo e claro.
- Máximo 2-3 frases. Liste itens com bullets quando fizer sentido.
- Se for preço/estoque/logística sensível, convide a falar com atendente.`;

    const messages = [
      { role: "system", content: sys },
      ...history,
      { role: "user", content: userMessage }
    ];

    const model = fallbackActive ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
    const resp = await callGroq(model, messages);

    if (resp.status === 429) {
      // ativa fallback para 8b e tenta novamente
      fallbackActive = true;
      const resp2 = await callGroq("llama-3.1-8b-instant", messages);
      if (!resp2.ok) {
        const t2 = await resp2.text();
        console.error("Falha fallback 8b:", resp2.status, t2);
        return "A IA atingiu limite de uso no momento. Tente novamente em alguns minutos ou digite /atendente.";
      }
      const data2 = await resp2.json();
      return clipReply(data2?.choices?.[0]?.message?.content || "");
    }

    if (!resp.ok) {
      const t = await resp.text();
      console.error("Erro Groq:", resp.status, t);
      return "Ops! O servidor da IA está temporariamente fora do ar. Tente mais tarde ou digite /atendente.";
    }

    const data = await resp.json();
    const reply = clipReply(data?.choices?.[0]?.message?.content || "");
    // se funcionou com 70b, desativa fallback
    if (!fallbackActive) return reply;
    // funcionou com o atual; se era fallback ativo, testaremos 70b na próxima
    fallbackActive = false;
    return reply;

  } catch (e) {
    console.error("Falha geral IA:", e?.message || e);
    return "Ops! O servidor da IA está temporariamente fora do ar. Tente novamente mais tarde.";
  }
}

// ---------- memória simples de conversa ----------
const conversations = new Map();

// ---------- API: departamentos ----------
app.get("/api/departments", (req, res) => res.json(readDepartments()));

app.post("/api/departments", (req, res) => {
  const { name, phone, emoji, type } = req.body;
  if (!name) return res.status(400).json({ error: "Nome obrigatório" });
  const deps = readDepartments();
  const item = {
    id: deps.length ? Math.max(...deps.map(d => d.id)) + 1 : 1,
    name,
    phone: type === "whatsapp" ? (phone || null) : null,
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
  if (i === -1) return res.status(404).json({ error: "Não encontrado" });
  deps[i] = { ...deps[i], ...req.body };
  writeDepartments(deps);
  res.json(deps[i]);
});

app.delete("/api/departments/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const deps = readDepartments();
  const i = deps.findIndex(d => d.id === id);
  if (i === -1) return res.status(404).json({ error: "Não encontrado" });
  const removed = deps.splice(i, 1)[0];
  writeDepartments(deps);
  res.json({ ok: true, removed });
});

app.put("/api/departments/order", (req, res) => {
  const { order } = req.body; // [ids em nova ordem]
  if (!Array.isArray(order)) return res.status(400).json({ error: "Formato inválido" });
  const deps = readDepartments();
  const pos = new Map(order.map((id, ix) => [id, ix]));
  deps.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  writeDepartments(deps);
  console.log("✅ Ordem salva:", order);
  res.json({ ok: true });
});

// ---------- API: conhecimento ----------
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

// ---------- API: estatísticas ----------
app.post("/api/track/department", (req, res) => {
  const { name } = req.body;
  const stats = readStats();
  stats.interacoes++;
  stats.departamentos[name] = (stats.departamentos[name] || 0) + 1;
  writeStats(stats);
  res.json({ ok: true });
});

app.post("/api/track/link", (req, res) => {
  const { url } = req.body;
  const stats = readStats();
  stats.interacoes++;
  stats.links[url] = (stats.links[url] || 0) + 1;
  writeStats(stats);
  res.json({ ok: true });
});

app.get("/api/stats", (req, res) => res.json(readStats()));
app.get("/api/stats/export", (req, res) => {
  const s = readStats();
  const lines = [
    "Tipo,Chave,Quantidade",
    ...Object.entries(s.departamentos).map(([k, v]) => `Departamento,${k},${v}`),
    ...Object.entries(s.links).map(([k, v]) => `Link,${k},${v}`)
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=stats-export.csv");
  res.send(lines.join("\n"));
});

// ---------- API: chat ----------
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: "Mensagem obrigatória" });

    const sid = sessionId || "anon";
    const session = conversations.get(sid) || { history: [], startedAt: Date.now() };

    if (message.toLowerCase().includes("/limpar")) {
      conversations.delete(sid);
      return res.json({ message: "Conversa limpa!" });
    }
    if (message.toLowerCase().includes("/menu") || message.toLowerCase().includes("/atendente")) {
      return res.json({
        message: "Escolha um departamento: Vendas, Suporte ou Financeiro.",
        showDepartments: true
      });
    }

    const reply = await callAI(message, session.history);
    session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
    conversations.set(sid, session);
    res.json({ message: reply, showDepartments: false });
  } catch (e) {
    console.error("Erro /api/chat:", e);
    res.status(500).json({ error: "Falha ao processar" });
  }
});

// ---------- páginas ----------
app.get("/admin", (req, res) => {
  res.send(`<!doctype html><html lang="pt-BR"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admin - BHS</title>
  <style>
    body{font-family:Segoe UI,Arial;background:#f5f5f5;margin:0;padding:20px}
    .wrap{max-width:960px;margin:auto}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
    .card{background:#fff;border-radius:14px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-decoration:none;color:#111;display:block}
    .card:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(0,0,0,.12)}h1{margin-top:0}
  </style></head>
  <body><div class="wrap"><h1>🛠️ Administração</h1>
  <div class="grid">
    <a class="card" href="/departments.html">📱 Departamentos</a>
    <a class="card" href="/train.html">🤖 Treinar IA</a>
    <a class="card" href="/stats.html">📈 Estatísticas</a>
  </div></div></body></html>`);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 BHS Widget v5 rodando na porta ${PORT}`);
});
