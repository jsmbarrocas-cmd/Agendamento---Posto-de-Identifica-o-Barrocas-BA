// ==========================
//  Sistema de Agendamento - Posto de Identificação Barrocas-BA
// ==========================

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// ==========================
//  CONFIGURAÇÕES BÁSICAS
// ==========================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Configura a sessão (corrigido para ambiente Render)
app.use(session({
  secret: process.env.SESSION_SECRET || 'segredo-fixo-do-posto-barrocas',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // true apenas se HTTPS direto
    maxAge: 1000 * 60 * 60 // 1 hora
  }
}));

// ==========================
//  BANCO DE DADOS
// ==========================

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'agenda.db');
const db = new sqlite3.Database(dbPath);

// Cria tabelas se não existirem
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL,
    data TEXT NOT NULL,
    horario TEXT NOT NULL,
    status TEXT DEFAULT 'pendente'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT UNIQUE,
    senha TEXT
  )`);

  // Garante que o admin exista
  db.get("SELECT * FROM admin WHERE usuario = 'admin'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (usuario, senha) VALUES (?, ?)", ['admin', '009975']);
      console.log('👤 Admin padrão criado (usuário: admin | senha: 009975)');
    }
  });
});

// ==========================
//  ROTAS PÚBLICAS
// ==========================
app.use(express.static(path.join(__dirname, 'public')));

// ==========================
//  LOGIN ADMINISTRADOR
// ==========================
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM admin WHERE usuario = ? AND senha = ?", [username, password], (err, row) => {
    if (row) {
      req.session.user = username;
      res.redirect('/admin/index.html');
    } else {
      res.send('<script>alert("Usuário ou senha incorretos!"); window.location.href="/login.html";</script>');
    }
  });
});

// Middleware para autenticação
function checkAuth(req, res, next) {
  if (req.session.user) next();
  else res.redirect('/login.html');
}

app.use('/admin', checkAuth, express.static(path.join(__dirname, 'public', 'admin')));

// ==========================
//  ROTAS DE AGENDAMENTO
// ==========================

// Obter todos agendamentos
app.get('/api/agendamentos', (req, res) => {
  db.all("SELECT * FROM agendamentos ORDER BY data, horario", (err, rows) => {
    if (err) res.status(500).json({ error: err.message });
    else res.json(rows);
  });
});

// Criar novo agendamento
app.post('/api/agendar', (req, res) => {
  const { nome, cpf, data, horario } = req.body;
  if (!nome || !cpf || !data || !horario) {
    return res.status(400).json({ error: 'Preencha todos os campos.' });
  }

  db.run("INSERT INTO agendamentos (nome, cpf, data, horario) VALUES (?, ?, ?, ?)",
    [nome, cpf, data, horario],
    function (err) {
      if (err) res.status(500).json({ error: err.message });
      else res.json({ success: true, id: this.lastID });
    });
});

// Excluir agendamento
app.delete('/api/agendamentos/:id', (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM agendamentos WHERE id = ?", [id], function (err) {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true });
  });
});

// Atualizar status
app.put('/api/agendamentos/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.run("UPDATE agendamentos SET status = ? WHERE id = ?", [status, id], function (err) {
    if (err) res.status(500).json({ error: err.message });
    else res.json({ success: true });
  });
});

// ==========================
//  LIMPEZA AUTOMÁTICA (30 DIAS APÓS ATENDIMENTO)
// ==========================
cron.schedule('0 3 * * *', () => {
  const sql = `
    DELETE FROM agendamentos
    WHERE status = 'atendido'
    AND DATE(data) <= DATE('now', '-30 days')
  `;
  db.run(sql, (err) => {
    if (err) console.error('Erro ao limpar agendamentos antigos:', err.message);
    else console.log('🧹 Agendamentos antigos removidos automaticamente.');
  });
});

// ==========================
//  INICIAR SERVIDOR
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
