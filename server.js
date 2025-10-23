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

app.use(session({
  secret: process.env.SESSION_SECRET || 'segredo-fixo-do-posto-barrocas',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 } // 1h
}));

// ==========================
//  BANCO DE DADOS
// ==========================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'agenda.db');
const db = new sqlite3.Database(dbPath);

// Cria tabelas
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

  db.run(`CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    disponivel INTEGER DEFAULT 1
  )`);

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
//  LOGIN ADMINISTRADOR (AJUSTADO)
// ==========================
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  db.get("SELECT * FROM admin WHERE usuario = ? AND senha = ?", [usuario, senha], (err, row) => {
    if (row) {
      req.session.user = usuario;
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

function checkAuth(req, res, next) {
  if (req.session.user) next();
  else res.status(401).json({ success: false, message: 'Não autorizado' });
}

// ==========================
//  ROTAS ADMINISTRATIVAS
// ==========================

// Gerar horários padrão
app.post('/admin/api/cadastrar-horarios', checkAuth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.json({ success: false, message: "Data não informada" });

  const horariosPadrao = [
    '08:00', '08:30', '09:00', '09:30',
    '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30',
    '15:00', '15:30'
  ];

  const stmt = db.prepare("INSERT INTO horarios (data, hora) VALUES (?, ?)");
  horariosPadrao.forEach(hora => stmt.run(data, hora));
  stmt.finalize(() => {
    res.json({ success: true, message: "Horários padrão cadastrados com sucesso!" });
  });
});

// Listar horários de uma data
app.get('/admin/api/horarios', checkAuth, (req, res) => {
  db.all("SELECT * FROM horarios ORDER BY data, hora", (err, rows) => {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, rows });
  });
});

// Excluir horários de uma data
app.delete('/admin/api/horarios/:data', checkAuth, (req, res) => {
  const { data } = req.params;
  db.run("DELETE FROM horarios WHERE data = ?", [data], function (err) {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, message: "Horários excluídos com sucesso!" });
  });
});

// Listar agendamentos (com filtro)
app.get('/admin/api/agendamentos', checkAuth, (req, res) => {
  const { inicio, fim } = req.query;
  let sql = "SELECT * FROM agendamentos";
  const params = [];

  if (inicio && fim) {
    sql += " WHERE date(data) BETWEEN date(?) AND date(?)";
    params.push(inicio, fim);
  }

  sql += " ORDER BY data, horario";
  db.all(sql, params, (err, rows) => {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, rows });
  });
});

// Excluir agendamento individual
app.delete('/admin/api/agendamentos/:id', checkAuth, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM agendamentos WHERE id = ?", [id], function (err) {
    if (err) res.json({ success: false, message: err.message });
    else res.json({ success: true, message: "Agendamento excluído." });
  });
});

// ==========================
//  ROTAS PÚBLICAS DE CONSULTA
// ==========================
app.get('/api/datas-disponiveis', (req, res) => {
  db.all("SELECT DISTINCT data FROM horarios WHERE disponivel = 1 ORDER BY data", (err, rows) => {
    if (err) res.json([]);
    else res.json(rows.map(r => r.data));
  });
});

app.get('/api/horarios-disponiveis', (req, res) => {
  const { data } = req.query;
  db.all("SELECT hora FROM horarios WHERE data = ? AND disponivel = 1", [data], (err, rows) => {
    if (err) res.json([]);
    else res.json(rows);
  });
});

app.post('/api/agendar', (req, res) => {
  const { nome, cpf, email, telefone, data, hora } = req.body;
  if (!nome || !cpf || !data || !hora) {
    return res.json({ success: false, message: 'Preencha todos os campos.' });
  }

  db.run(
    "INSERT INTO agendamentos (nome, cpf, data, horario, status) VALUES (?, ?, ?, ?, 'pendente')",
    [nome, cpf, data, hora],
    function (err) {
      if (err) return res.json({ success: false, message: err.message });

      db.run("UPDATE horarios SET disponivel = 0 WHERE data = ? AND hora = ?", [data, hora]);
      res.json({ success: true, message: "Agendamento realizado com sucesso!" });
    }
  );
});

// ==========================
//  LIMPEZA AUTOMÁTICA
// ==========================
cron.schedule('0 3 * * *', () => {
  db.run(`
    DELETE FROM agendamentos
    WHERE status = 'atendido'
    AND DATE(data) <= DATE('now', '-30 days')
  `);
  console.log('🧹 Agendamentos antigos removidos automaticamente.');
});

// ==========================
//  INICIAR SERVIDOR
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
