// ============================================================
// 🤖 BHS Chat Server v2 – para Railway + Widget Integrado
// ============================================================

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { Groq } from "groq-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// =================== CORS ===================
app.use(cors({
  origin: [
    "https://www.mastersrelogios.com.br",
    "https://mastersrelogios.com.br",
    "https://chat-production-7d32.up.railway.app"
  ],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  next();
});

// =================== Configurações ===================
app.use(express.static("public"));
app.use(bodyParser.json());

const conversations = new Map();

// =================== Rota Principal ===================
app.get("/", (req, res) => {
  res.send("✅ Servidor do Chat BHS está online!");
});

// =================== Rota de Chat ===================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) return res.status(400).json({ error: "Mensagem obrigatória" });

    const sid = sessionId || "anon";
    const session = conversations.get(sid) || { history: [] };

    // 🔹 Comandos Especiais
    if (message.toLowerCase().includes("/limpar")) {
      conversations.delete(sid);
      return res.json({ message: "Conversa limpa!" });
    }

    if (message.toLowerCase().includes("/atendente")) {
      return res.json({
        message: "Escolha um departamento: Vendas, Suporte ou Financeiro.",
        showDepartments: true
      });
    }

    // =================== IA – Groq ===================
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Você é o assistente técnico e comercial da BHS Eletrônica. Fale sempre em português do Brasil, com clareza e simpatia. Seja breve e preciso nas respostas, e mencione a BHS quando fizer sentido." },
        ...session.history,
        { role: "user", content: message }
      ],
      model: "mixtral-8x7b-32768",
      temperature: 0.7,
      max_tokens: 300
    });

    const reply = chatCompletion.choices?.[0]?.message?.content?.trim() || "Desculpe, não consegui entender sua mensagem.";

    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });
    conversations.set(sid, session);

    console.log(`[IA] (${sid}) ${message} → ${reply}`);
    res.json({ message: reply, showDepartments: false });
  } catch (error) {
    console.error("🚨 Erro no /api/chat:", error);
    res.status(500).json({
      error: "Erro interno ao processar mensagem.",
      message: "Ops! O servidor da IA está temporariamente fora do ar. Tente novamente em instantes."
    });
  }
});

// =================== Inicialização ===================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor BHS Chat rodando em http://localhost:${PORT}`);
});
