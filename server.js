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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Sessão
app.use(session({
  secret: process.env.SESSION_SECRET || 'segredo-fixo-do-posto-barrocas',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 }
}));

// Banco de dados
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const dbPath = path.join(dataDir, 'agenda.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL,
    email TEXT,
    telefone TEXT,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    status TEXT DEFAULT 'pendente'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT UNIQUE,
    senha TEXT
  )`);

  db.get("SELECT * FROM admin WHERE usuario = 'admin'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (usuario, senha) VALUES (?, ?)", ['admin', '009975']);
      console.log('👤 Admin padrão criado (usuário: admin | senha: 009975)');
    }
  });
});

// ==========================
// ROTAS PÚBLICAS
// ==========================
app.use(express.static(path.join(__dirname, 'public')));

// ==========================
// LOGIN ADMIN
// ==========================
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  db.get("SELECT * FROM admin WHERE usuario = ? AND senha = ?", [usuario, senha], (err, row) => {
    if (row) {
      req.session.user = usuario;
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Usuário ou senha incorretos!' });
    }
  });
});

// LOGOUT
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Middleware para verificar login
function checkAuth(req, res, next) {
  if (req.session.user) next();
  else res.status(401).json({ success: false, message: 'Não autorizado.' });
}

// ==========================
// ROTAS ADMIN (painel)
// ==========================
app.get('/admin/api/agendamentos', checkAuth, (req, res) => {
  db.all("SELECT * FROM agendamentos ORDER BY data, hora", (err, rows) => {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, rows });
  });
});

app.delete('/admin/api/agendamentos/:id', checkAuth, (req, res) => {
  db.run("DELETE FROM agendamentos WHERE id = ?", [req.params.id], function (err) {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, message: 'Agendamento excluído.' });
  });
});

// ==========================
// LIMPEZA AUTOMÁTICA
// ==========================
cron.schedule('0 3 * * *', () => {
  db.run(`
    DELETE FROM agendamentos
    WHERE status = 'atendido'
    AND DATE(data) <= DATE('now', '-30 days')
  `, (err) => {
    if (err) console.error('Erro na limpeza automática:', err.message);
    else console.log('🧹 Agendamentos antigos removidos.');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
