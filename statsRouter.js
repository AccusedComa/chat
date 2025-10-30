// statsRouter.js - Endpoints de stats e cliques
const express = require('express');
const router = express.Router();
const { logClick, getReport, exportCsv } = require('./db');

router.post('/click', async (req, res) => {
  try {
    const { sessionId, label, path } = req.body || {};
    if (!sessionId || !label) return res.status(400).json({ error: 'sessionId e label são obrigatórios' });
    await logClick(sessionId, label, path || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/messages', async (req, res) => {
  try {
    const { from, to, limit, offset } = req.query;
    const rows = await getReport({
      from, to,
      limit: Math.min(Number(limit || 200), 1000),
      offset: Number(offset || 0)
    });
    res.json({ rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/export.csv', async (req, res) => {
  try {
    const { from, to } = req.query;
    const csv = await exportCsv({ from, to });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chat-report.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).send(`erro: ${e.message}`);
  }
});

module.exports = router;
