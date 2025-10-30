// ai.js - Fallback de provedores de IA (OpenAI -> Anthropic -> Gemini)
const fetch = global.fetch;

const PROVIDERS = (process.env.AI_PROVIDERS || 'openai,anthropic,gemini')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);

const models = {
  openai: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
  gemini: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
};

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

async function callOpenAI(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY ausente');
  const res = await withTimeout(fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: models.openai, messages, temperature: 0.3 })
  }));
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('OpenAI sem conteúdo');
  return text;
}

async function callAnthropic(messages) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY ausente');
  const msg = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  const res = await withTimeout(fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model: models.anthropic, max_tokens: 1024, messages: msg, temperature: 0.3 })
  }));
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = data?.content?.map(c => c.text).join(' ') || '';
  if (!text) throw new Error('Anthropic sem conteúdo');
  return text;
}

async function callGemini(messages) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY ausente');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${models.gemini}:generateContent?key=${key}`;
  const contents = [{
    role: 'user',
    parts: [{ text: messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n') }]
  }];
  const res = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.3 } })
  }));
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ') || '';
  if (!text) throw new Error('Gemini sem conteúdo');
  return text;
}

const adapters = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  gemini: callGemini,
};

async function chatCompletion(messages) {
  let lastError = null;
  for (const p of PROVIDERS) {
    const fn = adapters[p];
    if (!fn) continue;
    try { return await fn(messages); }
    catch (err) { lastError = err; /* tenta próximo */ }
  }
  throw lastError || new Error('Nenhum provedor disponível');
}

module.exports = { chatCompletion };
