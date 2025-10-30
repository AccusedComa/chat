// knowledgeStore.js - grava aprendizado em knowledge.txt
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'knowledge.txt');

function appendKnowledge(text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const line = `\n[${new Date().toISOString()}] ${clean}\n`;
  fs.appendFileSync(filePath, line, { encoding: 'utf8' });
}

function readKnowledge(maxBytes = 1024 * 1024) {
  try {
    const stats = fs.statSync(filePath);
    const size = Math.min(stats.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stats.size - size);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { appendKnowledge, readKnowledge };
