// db.js - SQLite para conversas e cliques (leve e confiável)
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const dbPath = path.join(dataDir, 'stats.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_name TEXT,
    user_phone TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    sender TEXT CHECK(sender IN ('user','assistant')),
    text TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    label TEXT,
    path TEXT,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function getOrCreateConversation(sessionId, userName = null, userPhone = null) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT 1`, [sessionId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row);
      db.run(`INSERT INTO conversations(session_id, user_name, user_phone) VALUES (?,?,?)`,
        [sessionId, userName, userPhone], function (err2) {
          if (err2) return reject(err2);
          db.get(`SELECT * FROM conversations WHERE id = ?`, [this.lastID], (e3, row2) => e3 ? reject(e3) : resolve(row2));
        });
    });
  });
}

function updateConversation(id, { user_name, user_phone }) {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE conversations SET user_name = COALESCE(?, user_name), user_phone = COALESCE(?, user_phone) WHERE id = ?`,
      [user_name, user_phone, id], function (err) {
        if (err) return reject(err);
        resolve();
      });
  });
}

function logMessage(conversationId, sender, text) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO messages(conversation_id, sender, text) VALUES (?,?,?)`,
      [conversationId, sender, text], function (err) {
        if (err) return reject(err);
        resolve();
      });
  });
}

function logClick(sessionId, label, pth) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO clicks(session_id, label, path) VALUES (?,?,?)`,
      [sessionId, label, pth], function (err) {
        if (err) return reject(err);
        resolve();
      });
  });
}

function getReport({ from, to, limit = 200, offset = 0 }) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = [];
    if (from) { where.push(`ts >= ?`); params.push(from); }
    if (to) { where.push(`ts <= ?`); params.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    db.all(
      `SELECT m.ts, c.session_id, c.user_name, c.user_phone, m.sender, m.text
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       ${whereSql}
       ORDER BY m.ts DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

function exportCsv({ from, to }) {
  return new Promise((resolve, reject) => {
    const params = [];
    let where = [];
    if (from) { where.push(`m.ts >= ?`); params.push(from); }
    if (to) { where.push(`m.ts <= ?`); params.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    db.all(
      `SELECT m.ts AS data_hora, c.session_id, c.user_name, c.user_phone, m.sender, m.text
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       ${whereSql}
       ORDER BY m.ts DESC`,
      params,
      (err, rows) => {
        if (err) return reject(err);
        const head = 'data_hora,session_id,user_name,user_phone,sender,text';
        const csv = [head]
          .concat(rows.map(r =>
            [
              r.data_hora,
              r.session_id,
              (r.user_name || '').replace(/,/g, ' '),
              (r.user_phone || ''),
              r.sender,
              `"${(r.text || '').replace(/"/g, '""')}"`
            ].join(',')
          )).join('\n');
        resolve(csv);
      }
    );
  });
}

module.exports = {
  db,
  getOrCreateConversation,
  updateConversation,
  logMessage,
  logClick,
  getReport,
  exportCsv
};
