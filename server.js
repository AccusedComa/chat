require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API KEY (usa .env)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Arquivos
const KNOWLEDGE_FILE = path.join(__dirname, 'knowledge.txt');
const DATA_FILE = path.join(__dirname, 'departments.json');

// Conhecimento IA
let KNOWLEDGE_BASE = `
Você é a assistente virtual da BHS Eletrônica.

INFORMAÇÕES:
- Nome: BHS Eletrônica
- Horário: Seg-Sex 9h-18h, Sáb 9h-13h

FAQS:
1. Horário: Seg-Sex 9h-18h
2. Pagamento: Cartão 12x, PIX 5% desc
3. Entrega: Capital 24-48h
4. Troca: 7 dias, produto sem uso
5. Garantia: 3m + 12m fabricante
`;

// Departamentos
let departments = [
  { id: 1, name: 'Vendas', phone: '5511999999999', emoji: '💼', type: 'whatsapp', order: 1 },
  { id: 2, name: 'Suporte', phone: '5511888888888', emoji: '🛠️', type: 'whatsapp', order: 2 },
  { id: 3, name: 'Financeiro', phone: '5511777777777', emoji: '💰', type: 'whatsapp', order: 3 }
];

const conversations = new Map();

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) departments = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (fs.existsSync(KNOWLEDGE_FILE)) KNOWLEDGE_BASE = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    console.log('✅ Dados carregados');
  } catch (e) { console.log('⚠️  Config padrão'); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(departments, null, 2));
  } catch (e) { console.error('❌ Erro:', e); }
}

function saveKnowledge(k) {
  try {
    fs.writeFileSync(KNOWLEDGE_FILE, k);
    KNOWLEDGE_BASE = k;
    return true;
  } catch (e) { return false; }
}

async function callAI(msg, history = []) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: KNOWLEDGE_BASE },
          ...history,
          { role: 'user', content: msg }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    if (!r.ok) throw new Error('API Error');
    const data = await r.json();
    return data.choices[0].message.content;
  } catch (e) {
    return 'Desculpe, erro. Digite /atendente';
  }
}

setInterval(() => {
  const old = Date.now() - 3600000;
  for (const [id, s] of conversations.entries()) {
    if (s.lastActivity < old) conversations.delete(id);
  }
}, 3600000);

// ROTAS
app.get('/api/departments', (req, res) => {
  res.json([...departments].sort((a, b) => (a.order || 999) - (b.order || 999)));
});

app.get('/api/departments/:id', (req, res) => {
  const d = departments.find(x => x.id === parseInt(req.params.id));
  d ? res.json(d) : res.status(404).json({ error: 'Não encontrado' });
});

app.post('/api/departments', (req, res) => {
  const { name, phone, emoji, type, order } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const newD = {
    id: departments.length > 0 ? Math.max(...departments.map(d => d.id)) + 1 : 1,
    name, phone: phone || null, emoji: emoji || '📞', type: type || 'whatsapp', order: order || 999
  };
  departments.push(newD);
  saveData();
  res.status(201).json(newD);
});

app.put('/api/departments/:id', (req, res) => {
  const idx = departments.findIndex(d => d.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const { name, phone, emoji, type, order } = req.body;
  departments[idx] = {
    ...departments[idx],
    ...(name && { name }),
    ...(phone !== undefined && { phone }),
    ...(emoji && { emoji }),
    ...(type && { type }),
    ...(order !== undefined && { order })
  };
  saveData();
  res.json(departments[idx]);
});

app.delete('/api/departments/:id', (req, res) => {
  const idx = departments.findIndex(d => d.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Não encontrado' });
  const del = departments.splice(idx, 1)[0];
  saveData();
  res.json({ message: 'Removido', department: del });
});

app.get('/api/knowledge', (req, res) => {
  res.json({ knowledge: KNOWLEDGE_BASE });
});

app.post('/api/knowledge', (req, res) => {
  const { knowledge } = req.body;
  if (!knowledge) return res.status(400).json({ error: 'Vazio' });
  saveKnowledge(knowledge) ? res.json({ success: true }) : res.status(500).json({ error: 'Erro' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Vazio' });

    let s = conversations.get(sessionId) || { history: [], startedAt: Date.now(), lastActivity: Date.now() };

    if (message.toLowerCase().includes('/atendente') || message.toLowerCase().includes('falar com humano')) {
      return res.json({ message: 'Transferindo! 👨‍💼', showDepartments: true });
    }

    if (message.toLowerCase().includes('/limpar')) {
      conversations.delete(sessionId);
      return res.json({ message: 'Limpo! 😊' });
    }

    const ai = await callAI(message, s.history);
    s.history.push({ role: 'user', content: message }, { role: 'assistant', content: ai });
    if (s.history.length > 20) s.history = s.history.slice(-20);
    s.lastActivity = Date.now();
    conversations.set(sessionId, s);

    res.json({ message: ai, showDepartments: false });
  } catch (e) {
    res.status(500).json({ error: 'Erro', message: 'Tente novamente' });
  }
});

// ADMIN
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin</title><style>*{margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;padding:20px}.container{max-width:900px;margin:0 auto}.card{background:white;border-radius:12px;padding:30px;box-shadow:0 2px 12px rgba(0,0,0,0.1)}h1{color:#25D366;margin-bottom:30px}.menu{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}.menu-item{background:linear-gradient(135deg,#25D366 0%,#128C7E 100%);color:white;padding:30px;border-radius:12px;text-decoration:none;text-align:center;display:block;transition:transform 0.2s}.menu-item:hover{transform:translateY(-5px)}.menu-item h3{font-size:24px;margin-bottom:10px}</style></head><body><div class="container"><div class="card"><h1>🛠️ Admin</h1><div class="menu"><a href="/admin/departments" class="menu-item"><h3>📱 Departamentos</h3></a><a href="/admin/ia" class="menu-item" style="background:linear-gradient(135deg,#2196F3,#1976D2)"><h3>🤖 Treinar IA</h3></a></div></div></div></body></html>`);
});

app.get('/admin/departments', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Departamentos</title><style>*{margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;padding:20px}.container{max-width:900px;margin:0 auto;background:white;border-radius:12px;padding:30px}h1{color:#25D366;margin-bottom:20px}.back{color:#25D366;text-decoration:none;font-weight:500;margin-bottom:20px;display:inline-block}.dept-list{display:grid;gap:15px;margin-bottom:30px}.dept-item{background:#f9f9f9;padding:20px;border-radius:8px;display:grid;grid-template-columns:auto 1fr auto auto;gap:15px;align-items:center}.dept-emoji{font-size:32px}button{padding:8px 16px;border:none;border-radius:6px;cursor:pointer;font-weight:500}.btn-edit{background:#2196F3;color:white}.btn-delete{background:#f44336;color:white}.btn-add{background:#25D366;color:white;padding:12px 24px;width:100%}.form-group{display:grid;gap:15px;margin-top:20px;padding:20px;background:#f9f9f9;border-radius:8px;display:none}.form-group.show{display:grid}input,select{padding:12px;border:2px solid #e0e0e0;border-radius:6px;width:100%}.form-buttons{display:flex;gap:10px}.btn-save{background:#25D366;color:white;flex:1}.btn-cancel{background:#999;color:white;flex:1}</style></head><body><div class="container"><a href="/admin" class="back">← Voltar</a><h1>📱 Departamentos</h1><div class="dept-list" id="list"></div><button class="btn-add" onclick="showForm()">➕ Adicionar</button><div class="form-group" id="form"><div><input id="n" placeholder="Nome"></div><div><select id="t" onchange="toggleP()"><option value="whatsapp">WhatsApp</option><option value="ai">IA</option></select></div><div id="pf"><input id="p" placeholder="5511999999999"></div><div><input id="e" placeholder="📞" maxlength="2"></div><div><input type="number" id="o" placeholder="Ordem" min="1"></div><div class="form-buttons"><button class="btn-save" onclick="save()">Salvar</button><button class="btn-cancel" onclick="hide()">Cancelar</button></div></div></div><script>let depts=[],editing=null;async function load(){const r=await fetch('/api/departments');depts=await r.json();document.getElementById('list').innerHTML=depts.map(d=>\`<div class="dept-item"><div class="dept-emoji">\${d.emoji}</div><div><div style="font-weight:600">\${d.name}</div><div style="color:#666;font-size:14px">\${d.phone||'IA'}</div><small>Ordem: \${d.order||999}</small></div><button class="btn-edit" onclick="edit(\${d.id})">Editar</button><button class="btn-delete" onclick="del(\${d.id})">Excluir</button></div>\`).join('')}function showForm(){editing=null;document.getElementById('form').classList.add('show');document.getElementById('n').value='';document.getElementById('p').value='';document.getElementById('e').value='';document.getElementById('o').value='';document.getElementById('t').value='whatsapp';toggleP()}function hide(){document.getElementById('form').classList.remove('show')}function toggleP(){document.getElementById('pf').style.display=document.getElementById('t').value==='whatsapp'?'block':'none'}async function save(){const data={name:document.getElementById('n').value,phone:document.getElementById('p').value,emoji:document.getElementById('e').value,type:document.getElementById('t').value,order:parseInt(document.getElementById('o').value)||999};if(!data.name)return alert('Nome!');if(data.type==='whatsapp'&&!data.phone)return alert('Telefone!');if(editing){await fetch(\`/api/departments/\${editing}\`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}else{await fetch('/api/departments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}hide();load()}async function edit(id){const d=depts.find(x=>x.id===id);if(!d)return;editing=id;document.getElementById('n').value=d.name;document.getElementById('p').value=d.phone||'';document.getElementById('e').value=d.emoji;document.getElementById('t').value=d.type;document.getElementById('o').value=d.order||'';toggleP();document.getElementById('form').classList.add('show')}async function del(id){if(!confirm('Excluir?'))return;await fetch(\`/api/departments/\${id}\`,{method:'DELETE'});load()}load()</script></body></html>`);
});

app.get('/admin/ia', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Treinar IA</title><style>*{margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#f5f5f5;padding:20px}.container{max-width:900px;margin:0 auto;background:white;border-radius:12px;padding:30px}h1{color:#25D366;margin-bottom:20px}.back{color:#25D366;text-decoration:none;font-weight:500;margin-bottom:20px;display:inline-block}textarea{width:100%;min-height:400px;padding:15px;border:2px solid #e0e0e0;border-radius:8px;font-family:'Courier New',monospace;resize:vertical}.buttons{display:flex;gap:10px;margin-top:20px}button{padding:12px 24px;border:none;border-radius:6px;font-weight:500;cursor:pointer}.btn-save{background:#25D366;color:white;flex:1}.btn-test{background:#2196F3;color:white}.test-area{margin-top:30px;padding:20px;background:#f9f9f9;border-radius:8px;display:none}.test-area.show{display:block}.chat-test{background:white;border-radius:8px;padding:15px;max-height:300px;overflow-y:auto;margin-bottom:15px}.test-message{margin-bottom:10px;padding:10px;border-radius:8px}.test-message.user{background:#E3F2FD;text-align:right}.test-message.bot{background:#E8F5E9}.test-input{display:flex;gap:10px}.test-input input{flex:1;padding:10px;border:2px solid #e0e0e0;border-radius:6px}</style></head><body><div class="container"><a href="/admin" class="back">← Voltar</a><h1>🤖 Treinar IA</h1><textarea id="k"></textarea><div class="buttons"><button class="btn-save" onclick="save()">💾 Salvar</button><button class="btn-test" onclick="toggleT()">🧪 Testar</button></div><div class="test-area" id="test"><h3>Testar</h3><div class="chat-test" id="chat"></div><div class="test-input"><input id="ti" onkeypress="if(event.key==='Enter')sendT()"><button class="btn-test" onclick="sendT()">Enviar</button></div></div></div><script>async function loadK(){const r=await fetch('/api/knowledge');const d=await r.json();document.getElementById('k').value=d.knowledge}async function save(){const k=document.getElementById('k').value;if(!k.trim())return alert('Vazio!');const r=await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({knowledge:k})});const d=await r.json();alert(d.success?'✅ Salvo!':'❌ Erro')}function toggleT(){document.getElementById('test').classList.toggle('show')}async function sendT(){const i=document.getElementById('ti');const m=i.value.trim();if(!m)return;const c=document.getElementById('chat');c.innerHTML+=\`<div class="test-message user"><strong>Você:</strong> \${m}</div>\`;i.value='';try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m,sessionId:'test-'+Date.now()})});const d=await r.json();c.innerHTML+=\`<div class="test-message bot"><strong>IA:</strong> \${d.message}</div>\`;c.scrollTop=c.scrollHeight}catch(e){c.innerHTML+=\`<div class="test-message bot" style="background:#FFEBEE">Erro</div>\`}}loadK()</script></body></html>`);
});

loadData();

app.listen(PORT, () => {
  console.log('🚀 Servidor: http://localhost:' + PORT);
  console.log('🛠️  Admin: http://localhost:' + PORT + '/admin');
});