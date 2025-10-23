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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

console.log("🚀 Iniciando servidor...");
console.log("🔑 Chave GROQ carregada?", !!GROQ_API_KEY);

const DATA_FILE = path.join(__dirname, "departments.json");
const KNOWLEDGE_FILE = path.join(__dirname, "knowledge.txt");

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "");

function readDepartments(){ try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch{return [];} }
function writeDepartments(v){ fs.writeFileSync(DATA_FILE, JSON.stringify(v,null,2)); }
function readKnowledge(){ try{return fs.readFileSync(KNOWLEDGE_FILE,"utf8");}catch{return "";} }

let fallbackActive = false; // se true, usa o modelo menor

async function callGroqModel(model, messages) {
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
      max_tokens: 600
    })
  });
  return resp;
}

async function callAI(userMessage, history=[]) {
  try {
    if (!GROQ_API_KEY) {
      console.error("❌ GROQ_API_KEY ausente!");
      return "Servidor da IA não configurado. Contate o administrador.";
    }

    const messages = [
      { role:"system", content: readKnowledge() || "Você é a assistente Bela da BHS Eletrônica. Responda em português claro e profissional." },
      ...history,
      { role:"user", content: userMessage }
    ];

    const model = fallbackActive ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
    console.log(`🤖 Chamando modelo: ${model} (fallback: ${fallbackActive})`);

    const resp = await callGroqModel(model, messages);
    console.log("📡 Status da Groq:", resp.status);

    // Se limite atingido -> fallback automático
    if (resp.status === 429) {
      console.warn("⚠️ Limite atingido — ativando fallback para modelo 8b-instant.");
      fallbackActive = true;

      const resp2 = await callGroqModel("llama-3.1-8b-instant", messages);
      console.log("📡 Status fallback:", resp2.status);

      if (!resp2.ok) {
        const text = await resp2.text();
        console.error("❌ Falha no fallback:", resp2.status, text);
        return "A IA atingiu o limite de uso no momento. Tente novamente mais tarde.";
      }

      const data2 = await resp2.json();
      return data2?.choices?.[0]?.message?.content || "Não consegui responder agora.";
    }

    // Se erro genérico
    if (!resp.ok) {
      const text = await resp.text();
      console.error("❌ Erro Groq:", resp.status, text);
      return `Erro do servidor da IA (${resp.status}).`;
    }

    // Resposta normal
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || "Não consegui gerar uma resposta.";
    console.log("✅ Resposta IA:", reply.slice(0, 80));

    // Se funcionou com o modelo grande, desativa fallback
    if (fallbackActive) {
      console.log("✅ Voltando ao modelo 70b.");
      fallbackActive = false;
    }

    return reply;

  } catch (e) {
    console.error("💣 Falha geral na chamada Groq:", e.message);
    return "Ops! O servidor da IA está temporariamente fora do ar. Tente novamente em instantes.";
  }
}

const conversations = new Map();

// Endpoint do chat
app.post("/api/chat", async (req,res)=>{
  try{
    const { message, sessionId } = req.body;
    if(!message) return res.status(400).json({error:"Mensagem obrigatória"});
    const sid = sessionId || "anon";
    const session = conversations.get(sid) || { history: [] };

    if(message.toLowerCase().includes("/limpar")){ 
      conversations.delete(sid); 
      return res.json({message:"Conversa limpa!"}); 
    }

    if(message.toLowerCase().includes("/atendente")){
      return res.json({ message:"Escolha um departamento: Vendas, Suporte ou Financeiro.", showDepartments:true });
    }

    const reply = await callAI(message, session.history);
    session.history.push({role:"user", content:message}, {role:"assistant", content:reply});
    conversations.set(sid, session);
    res.json({ message: reply, showDepartments:false });
  }catch(e){
    console.error("❌ Erro no /api/chat:", e);
    res.status(500).json({error:"Falha ao processar"});
  }
});

// Root simples
app.get("/", (req,res)=> res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, ()=> console.log(`🚀 Widget rodando na porta ${PORT}`));
