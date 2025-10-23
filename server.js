import express from "express";
import cors from "cors";
const app = express();

app.use(cors({
  origin: "*", // ou coloque o domínio específico do seu site, tipo:
  // origin: "https://mastersrelogios.com.br",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// permite ser carregado em iframe
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "ALLOWALL");
  next();
});

// ============================================
// WIDGET BACKEND - BHS
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

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, "");

function readDepartments(){ try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch{return [];} }
function writeDepartments(v){ fs.writeFileSync(DATA_FILE, JSON.stringify(v,null,2)); }
function readKnowledge(){ try{return fs.readFileSync(KNOWLEDGE_FILE,"utf8");}catch{return "";} }

async function callAI(userMessage, history=[]) {
  try{
    const messages = [
      { role:"system", content: readKnowledge() || "Você é a assistente Bela da BHS Eletrônica. Responda em PT-BR." },
      ...history,
      { role:"user", content: userMessage }
    ];
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model:"llama-3.3-70b-versatile", messages, temperature:0.6, max_tokens:500 })
    });
    if(!resp.ok) throw new Error("Groq "+resp.status);
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? "Não consegui responder agora.";
  }catch(e){
    console.error("Groq error:", e);
    return "Estou com dificuldades agora. Quer falar com um atendente? (/atendente)";
  }
}

const conversations = new Map();

// Departments API
app.get("/api/departments",(req,res)=> res.json(readDepartments()));
app.post("/api/departments",(req,res)=>{
  const {name,phone,emoji,type}=req.body;
  if(!name) return res.status(400).json({error:"Nome obrigatório"});
  const deps=readDepartments();
  const item={ id: deps.length? Math.max(...deps.map(d=>d.id))+1 : 1, name, phone: phone||null, emoji: emoji||"📞", type: type||"whatsapp" };
  deps.push(item); writeDepartments(deps); res.status(201).json(item);
});
app.put("/api/departments/:id",(req,res)=>{
  const id=parseInt(req.params.id); const deps=readDepartments();
  const i=deps.findIndex(d=>d.id===id); if(i===-1) return res.status(404).json({error:"Não encontrado"});
  deps[i]={...deps[i], ...req.body}; writeDepartments(deps); res.json(deps[i]);
});
app.delete("/api/departments/:id",(req,res)=>{
  const id=parseInt(req.params.id); const deps=readDepartments();
  const i=deps.findIndex(d=>d.id===id); if(i===-1) return res.status(404).json({error:"Não encontrado"});
  const removed=deps.splice(i,1)[0]; writeDepartments(deps); res.json({ok:true, removed});
});
app.put("/api/departments/order",(req,res)=>{
  const {order}=req.body; if(!Array.isArray(order)) return res.status(400).json({error:"Formato inválido"});
  const deps=readDepartments(); const pos=new Map(order.map((id,ix)=>[id,ix]));
  deps.sort((a,b)=>(pos.get(a.id)??0)-(pos.get(b.id)??0)); writeDepartments(deps); res.json({ok:true});
});

// Knowledge API
app.get("/api/knowledge",(req,res)=> res.send(readKnowledge()));
app.post("/api/knowledge",(req,res)=>{
  try{ const {content}=req.body; fs.writeFileSync(KNOWLEDGE_FILE, content??"", "utf8"); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});

// Chat API
app.post("/api/chat", async (req,res)=>{
  try{
    const { message, sessionId } = req.body;
    if(!message) return res.status(400).json({error:"Mensagem obrigatória"});
    const sid = sessionId || "anon";
    const session = conversations.get(sid) || { history: [] };
    if(message.toLowerCase().includes("/limpar")){ conversations.delete(sid); return res.json({message:"Conversa limpa!"}); }
    if(message.toLowerCase().includes("/atendente")){
      return res.json({ message:"Escolha um departamento: Vendas, Suporte ou Financeiro.", showDepartments:true });
    }
    const reply = await callAI(message, session.history);
    session.history.push({role:"user", content:message}, {role:"assistant", content:reply});
    conversations.set(sid, session);
    res.json({ message: reply, showDepartments:false });
  }catch(e){ console.error(e); res.status(500).json({error:"Falha ao processar"}); }
});

// Admin landing
app.get("/admin",(req,res)=>{
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Admin - BHS</title>
  <style>body{font-family:Segoe UI,Arial;background:#f5f5f5;margin:0;padding:20px}.wrap{max-width:920px;margin:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
  .card{background:#fff;border-radius:14px;padding:24px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-decoration:none;color:#111;display:block}
  .card:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(0,0,0,.12)}h1{margin-top:0}</style></head>
  <body><div class="wrap"><h1>🛠️ Administração</h1>
  <div class="grid">
    <a class="card" href="/departments.html">📱 Departamentos</a>
    <a class="card" href="/train.html">🤖 Treinar IA</a>
  </div></div></body></html>`);
});

// Root
app.get("/", (req,res)=>{
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, ()=> console.log("🚀 Widget rodando em http://localhost:"+PORT));
