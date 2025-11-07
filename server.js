require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bhs-super-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// ---------- FILES ----------
const DATA_DIR = __dirname;
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.txt');
const DEPTS_FILE = path.join(DATA_DIR, 'departments.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

if (!fs.existsSync(KNOWLEDGE_FILE)) fs.writeFileSync(KNOWLEDGE_FILE, 'Você é a assistente virtual da BHS Eletrônica.');
if (!fs.existsSync(DEPTS_FILE)) fs.writeFileSync(DEPTS_FILE, JSON.stringify([
  { id: 1, name: 'Vendas', phone: '5511999999999', emoji: '💼', order: 1 },
  { id: 2, name: 'Suporte', phone: '5511888888888', emoji: '🛠️', order: 2 },
  { id: 3, name: 'Financeiro', phone: '5511777777777', emoji: '💰', order: 3 }
], null, 2));
if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, '[]');

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

function readKnowledge() {
  try { return fs.readFileSync(KNOWLEDGE_FILE, 'utf8'); } catch { return ''; }
}
function readDepts() {
  try {
    const d = JSON.parse(fs.readFileSync(DEPTS_FILE, 'utf8'));
    return [...d].sort((a, b) => (a.order || 999) - (b.order || 999));
  } catch { return []; }
}
function appendStat(entry) {
  try {
    const arr = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    arr.push({ ...entry, ts: new Date().toISOString() });
    fs.writeFileSync(STATS_FILE, JSON.stringify(arr, null, 2));
  } catch (e) { console.error('stats write fail', e); }
}
function normPhoneBR(input = '') {
  const d = input.replace(/\D/g, '');
  if (d.length < 10 || d.length > 11) return null;
  return '+55' + d;
}
function formatBR(digits) {
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return digits;
}

// --- IA ---
async function callAI(messages) {
  const payload = {
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.3,
    max_tokens: 350
  };
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${GROQ_KEY || OPENAI_KEY}`
  };

  try {
    if (!GROQ_KEY && !OPENAI_KEY) {
      throw new Error('Nenhuma chave de API configurada');
    }

    const url = GROQ_KEY
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!r.ok) {
        throw new Error(`API retornou status ${r.status}`);
      }

      const data = await r.json();
      let text = data?.choices?.[0]?.message?.content?.trim() || '';

      if (!text) {
        throw new Error('Resposta vazia da IA');
      }

      text = text.replace(/target=.*?">/g, '">'); // remove atributos HTML
      const chunks = [];
      while (text.length > 600) {
        let cut = text.lastIndexOf('.', 600);
        if (cut === -1) cut = 600;
        chunks.push(text.slice(0, cut + 1));
        text = text.slice(cut + 1);
      }
      if (text.trim()) chunks.push(text.trim());
      return chunks;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error('IA fail:', err.message || err);
    if (err.name === 'AbortError') {
      return ['A IA demorou muito para responder. Tente novamente com uma pergunta mais curta.'];
    }
    return ['Tive um pico de indisponibilidade nas IAs. Tente novamente em instantes.'];
  }
}

// ---------- CHAT FLOW ----------
// Endpoint para iniciar a conversa
app.get('/api/chat/init', (req, res) => {
  req.session.phase = 'awaiting_name';
  res.json({
    reply: 'Olá, sou Isa, a assistente virtual da BHS Eletrônica. Pra começar, me diga seu nome 👇',
    phase: 'awaiting_name'
  });
});

// Endpoint para resetar a sessão
app.post('/api/chat/reset', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao resetar sessão' });
    }
    res.json({ ok: true, message: 'Sessão resetada com sucesso' });
  });
});

app.post('/api/chat', async (req, res) => {
  const msg = (req.body?.message || '').trim();
  const sess = req.session;
  sess.phase = sess.phase || 'awaiting_intro';

  // Validação: mensagens vazias não são permitidas (exceto comandos que começam com /)
  if (!msg || (msg.length === 0 && !msg.startsWith('/'))) {
    return res.json({ reply: 'Por favor, envie uma mensagem válida.', phase: sess.phase });
  }

  if (sess.phase === 'awaiting_intro' || msg.toLowerCase() === 'start') {
    sess.phase = 'awaiting_name';
    return res.json({ reply: 'Olá, sou Isa, a assistente virtual da BHS Eletrônica. Pra começar, me diga seu nome 👇', phase: 'awaiting_name' });
  }

  if (sess.phase === 'awaiting_name') {
    const nome = msg.replace(/\s+/g, ' ').trim();
    if (!nome || nome.length < 3)
      return res.json({ reply: 'Pode me dizer seu **nome completo**, por favor?', phase: 'awaiting_name' });
    sess.user_name = nome;
    sess.phase = 'awaiting_phone';
    return res.json({
      reply: `Perfeito, ${nome.split(' ')[0]}! Agora digite seu **WhatsApp com DDD** (ex: 11987654321):`,
      phase: 'awaiting_phone'
    });
  }

  if (sess.phase === 'awaiting_phone') {
    const digits = msg.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11)
      return res.json({ reply: 'Ops! Envie no formato 11987654321 (somente números).', phase: 'awaiting_phone' });

    sess.user_phone_digits = digits;
    sess.phase = 'confirm_whatsapp';
    return res.json({
      reply: `Esse número ${formatBR(digits)} é WhatsApp? (Responda sim ou não)`,
      phase: 'confirm_whatsapp'
    });
  }

  if (sess.phase === 'confirm_whatsapp') {
    if (!/sim|não|nao/i.test(msg))
      return res.json({ reply: 'Por favor, responda apenas com sim ou não.', phase: 'confirm_whatsapp' });

    sess.user_phone = normPhoneBR(sess.user_phone_digits);
    sess.phase = 'choose_path';

    const depts = readDepts();
    const reply = `Perfeito, ${sess.user_name.split(' ')[0]}, vou te direcionar para o setor correto. Me diga o que quer fazer:`;
    return res.json({
      reply,
      phase: 'choose_path',
      options: {
        type: 'menu',
        items: [
          { id: 'ai', label: '🤖 Tirar dúvidas (IA)' },
          { id: 'human', label: '💬 Conversar via WhatsApp com...', subitems: depts }
        ]
      }
    });
  }

  // Processar comandos de escolha antes de verificar a fase
  if (msg.startsWith('/choose:dept_')) {
    const depId = parseInt(msg.replace('/choose:dept_', ''));
    const dep = readDepts().find(d => d.id === depId);
    if (!dep) return res.json({ reply: 'Departamento não encontrado.' });

    appendStat({ user: sess.user_name, choice: dep.name });
    const link = `https://wa.me/${dep.phone}?text=${encodeURIComponent(`Olá, sou ${sess.user_name}. Vim pelo assistente da BHS.`)}`;
    return res.json({ reply: `Abrindo contato com **${dep.name}** no WhatsApp...`, jumpTo: link });
  }

  if (msg === '/choose:ai') {
    sess.phase = 'ready_ai';
    return res.json({ reply: 'Ok, me fale o que você precisa:', phase: 'ready_ai' });
  }

  if (sess.phase === 'choose_path') {
    const depts = readDepts();
    const reply = `Perfeito, ${sess.user_name.split(' ')[0]}, vou te direcionar para o setor correto. Me diga o que quer fazer:`;
    return res.json({
      reply,
      phase: 'choose_path',
      options: {
        type: 'menu',
        items: [
          { id: 'ai', label: '🤖 Tirar dúvidas (IA)' },
          { id: 'human', label: '💬 Conversar via WhatsApp com...', subitems: depts }
        ]
      }
    });
  }

  if (sess.phase === 'ready_ai') {
    appendStat({ user: sess.user_name, question: msg });
    const systemPrompt = [
      'Você é “Isa”, assistente técnica e comercial da BHS Eletrônica.',
      'Não se reapresente.',
      'Use links clicáveis no formato <a href="URL">texto</a>.',
      'Responda de forma breve e direta.'
    ].join('\n');

    const chunks = await callAI([{ role: 'system', content: systemPrompt }, { role: 'user', content: msg }]);
    return res.json({ replies: chunks });
  }

  return res.json({ reply: 'Algo saiu errado. Digite qualquer coisa para reiniciar.', phase: 'awaiting_intro' });
});

// ---------- ADMIN ----------
// ---------- ADMIN ----------
app.get('/admin', (_req, res) => {
  res.send(`
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Admin BHS</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"></script>
      <style>
        body { font-family: Arial; padding: 20px; }
        h2 { color: #333; }
        button { margin-top: 10px; padding: 6px 10px; cursor: pointer; }
        textarea { width: 100%; height: 300px; font-family: monospace; }
        table { border-collapse: collapse; margin-top: 10px; width: 100%; }
        td, th { border: 1px solid #ccc; padding: 6px; }
        tr:nth-child(even) { background: #f8f8f8; }
        .link { color: #0066cc; cursor: pointer; text-decoration: underline; }
      </style>
    </head>
    <body>
      <h2>⚙️ Admin BHS</h2>
      <ul>
        <li><span class="link" onclick="load('departments')">Departamentos</span></li>
        <li><span class="link" onclick="load('ia')">Treinar IA</span></li>
        <li><span class="link" onclick="load('stats')">Estatísticas</span></li>
      </ul>
      <div id="content"></div>

      <script>
        async function load(section) {
          const box = document.getElementById('content');
          box.innerHTML = 'Carregando...';
          if (section === 'departments') {
            const res = await fetch('/admin/departments');
            const data = await res.json();
            let html = '<h3>Departamentos</h3><table><tr><th>ID</th><th>Nome</th><th>Telefone</th><th>Emoji</th><th>Ordem</th></tr>';
            data.forEach(d => {
              html += '<tr>' +
                '<td>' + d.id + '</td>' +
                '<td><input value="' + d.name + '" id="n'+d.id+'"></td>' +
                '<td><input value="' + d.phone + '" id="p'+d.id+'"></td>' +
                '<td><input value="' + (d.emoji || '') + '" id="e'+d.id+'"></td>' +
                '<td><input type="number" value="' + (d.order||'') + '" id="o'+d.id+'"></td>' +
              '</tr>';
            });
            html += '</table><button onclick="saveDepartments()">Salvar</button>';
            box.innerHTML = html;
          }
          if (section === 'ia') {
            const res = await fetch('/admin/ia');
            const text = await res.text();
            box.innerHTML = '<h3>Base de Conhecimento (knowledge.txt)</h3>' +
              '<textarea id="iaText">' + text.replace(/</g, "&lt;") + '</textarea>' +
              '<button onclick="saveIA()">Salvar</button>';
          }
          if (section === 'stats') {
            const res = await fetch('/admin/stats');
            const data = await res.json();
            let html = '<h3>Estatísticas</h3><table id="statsTable"><tr><th>Usuário</th><th>Ação</th><th>Data</th></tr>';
            data.forEach(l => html += '<tr><td>'+(l.user||'-')+'</td><td>'+(l.choice||l.question||'-')+'</td><td>'+l.ts+'</td></tr>');
            html += '</table><button onclick="exportPDF()" style="background:#25D366;color:#fff;border:0;padding:10px 16px;border-radius:8px;margin-top:10px;cursor:pointer;">💾 Exportar PDF</button>';
            box.innerHTML = html;
          }
        }

        async function saveDepartments() {
          const rows = document.querySelectorAll('table tr');
          const arr = [];
          rows.forEach((r,i)=>{
            if(i===0) return;
            const id = parseInt(r.children[0].innerText);
            arr.push({
              id,
              name: document.getElementById('n'+id).value,
              phone: document.getElementById('p'+id).value,
              emoji: document.getElementById('e'+id).value,
              order: parseInt(document.getElementById('o'+id).value)
            });
          });
          await fetch('/admin/departments', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(arr)
          });
          alert('Departamentos atualizados com sucesso!');
        }

        async function saveIA() {
          const txt = document.getElementById('iaText').value;
          await fetch('/admin/ia', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text: txt })
          });
          alert('Arquivo knowledge.txt atualizado!');
        }

        async function exportPDF() {
          try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // Título
            doc.setFontSize(18);
            doc.text('Relatório de Estatísticas - BHS Eletrônica', 14, 22);

            // Data do relatório
            doc.setFontSize(10);
            doc.text('Data: ' + new Date().toLocaleString('pt-BR'), 14, 30);

            // Buscar dados das estatísticas
            const res = await fetch('/admin/stats');
            const data = await res.json();

            if (data.length === 0) {
              doc.setFontSize(12);
              doc.text('Nenhuma estatística disponível.', 14, 40);
            } else {
              // Preparar dados para a tabela
              const tableData = data.map(l => [
                l.user || '-',
                l.choice || l.question || '-',
                new Date(l.ts).toLocaleString('pt-BR')
              ]);

              // Adicionar tabela
              doc.autoTable({
                startY: 35,
                head: [['Usuário', 'Ação', 'Data']],
                body: tableData,
                theme: 'striped',
                headStyles: { fillColor: [37, 211, 102] },
                styles: { fontSize: 9 }
              });
            }

            // Salvar PDF
            doc.save('estatisticas-bhs-' + new Date().toISOString().split('T')[0] + '.pdf');
            alert('PDF gerado com sucesso!');
          } catch (err) {
            console.error('Erro ao gerar PDF:', err);
            alert('Erro ao gerar PDF. Verifique o console.');
          }
        }
      </script>
    </body>
    </html>
  `);
});

// APIs do painel Admin
app.get('/admin/departments', (_req, res) => {
  const data = JSON.parse(fs.readFileSync(DEPTS_FILE, 'utf8'));
  res.json(data);
});

app.post('/admin/departments', (req, res) => {
  fs.writeFileSync(DEPTS_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get('/admin/ia', (_req, res) => {
  const text = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
  res.type('text/plain').send(text);
});

app.post('/admin/ia', (req, res) => {
  fs.writeFileSync(KNOWLEDGE_FILE, req.body.text || '');
  res.json({ ok: true });
});

app.get('/admin/stats', (_req, res) => {
  const logs = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  res.json(logs);
});


// ---------- START ----------
app.listen(PORT, () => console.log(`🚀 Servidor rodando: http://localhost:${PORT}`));
