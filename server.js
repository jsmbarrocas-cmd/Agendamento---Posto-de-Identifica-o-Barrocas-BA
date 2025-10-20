const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIGURAÇÃO DO BANCO DE DADOS PERSISTENTE ======
const dbDir = '/var/data';
const dbPath = path.join(dbDir, 'agenda.db');

// Cria o diretório /var/data se não existir (Render mantém esse caminho)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Conecta ao banco
const db = new sqlite3.Database(dbPath);

// ====== CRIA AS TABELAS SE NÃO EXISTIREM ======
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT,
    senha TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT,
    hora TEXT,
    disponivel INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    cpf TEXT,
    email TEXT,
    telefone TEXT,
    data TEXT,
    hora TEXT
  )`);

  // Garante que o admin existe
  db.get("SELECT * FROM admin WHERE usuario = 'admin'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (usuario, senha) VALUES (?, ?)", ["admin", "009975"]);
      console.log("✅ Admin criado com senha padrão 009975");
    }
  });
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== CONFIGURAÇÃO DE SESSÃO ======
app.use(session({
  secret: 'agenda_secret_key',
  resave: false,
  saveUninitialized: false
}));

// ====== MIDDLEWARE DE AUTENTICAÇÃO ======
function checkAuth(req, res, next) {
  if (req.session && req.session.loggedIn) next();
  else res.status(401).json({ success: false, message: 'Não autorizado' });
}

// ====== LOGIN / LOGOUT ======
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  db.get("SELECT * FROM admin WHERE usuario = ? AND senha = ?", [usuario, senha], (err, row) => {
    if (row) {
      req.session.loggedIn = true;
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ====== ROTAS ADMIN PROTEGIDAS ======

// Cadastrar horários automáticos
app.post('/admin/api/cadastrar-horarios', checkAuth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.json({ erro: 'Data inválida' });

  const horarios = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','14:00','14:30','15:00','15:30'];
  const stmt = db.prepare("INSERT INTO horarios (data, hora, disponivel) VALUES (?, ?, 1)");
  horarios.forEach(h => stmt.run(data, h));
  stmt.finalize(() => res.json({ success: true, message: 'Horários cadastrados!' }));
});

// Listar horários
app.get('/admin/api/horarios', checkAuth, (req, res) => {
  db.all("SELECT * FROM horarios ORDER BY data ASC, hora ASC", (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, rows });
  });
});

// Excluir horários
app.delete('/admin/api/excluir-horarios', checkAuth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.json({ success: false, message: 'Data inválida' });

  db.run("DELETE FROM horarios WHERE data = ?", [data], err => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, message: `Horários de ${data} excluídos.` });
  });
});

// Filtrar agendamentos
app.get('/admin/api/agendamentos', checkAuth, (req, res) => {
  const { inicio, fim } = req.query;
  db.all("SELECT * FROM agendamentos WHERE data BETWEEN ? AND ? ORDER BY data, hora", [inicio, fim], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, rows });
  });
});

// Gerar PDF dos agendamentos filtrados
app.get('/admin/api/relatorio', checkAuth, (req, res) => {
  const { inicio, fim } = req.query;
  db.all("SELECT * FROM agendamentos WHERE data BETWEEN ? AND ? ORDER BY data, hora", [inicio, fim], (err, rows) => {
    if (err) return res.status(500).send('Erro ao gerar relatório.');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio_agendamentos.pdf"');

    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(16).text('Relatório de Agendamentos', { align: 'center' });
    doc.moveDown();

    rows.forEach(r => {
      doc.fontSize(12).text(`Nome: ${r.nome}`);
      doc.text(`CPF: ${r.cpf}`);
      doc.text(`Data: ${r.data.split('-').reverse().join('/')}`);
      doc.text(`Hora: ${r.hora}`);
      doc.moveDown();
    });

    doc.end();
  });
});

// ====== ROTAS PÚBLICAS ======

// Retorna datas disponíveis
app.get('/api/datas-disponiveis', (req, res) => {
  db.all("SELECT DISTINCT data FROM horarios WHERE disponivel = 1 ORDER BY data", (err, rows) => {
    if (err) return res.json({ success: false, error: err.message });
    const datas = rows.map(r => r.data);
    res.json({ success: true, datas });
  });
});

// Retorna horários disponíveis
app.get('/api/horarios', (req, res) => {
  const { data } = req.query;
  db.all("SELECT hora FROM horarios WHERE data = ? AND disponivel = 1 ORDER BY hora ASC", [data], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, horarios: rows.map(r => r.hora) });
  });
});

// Agendar
app.post('/api/agendar', (req, res) => {
  const { nome, cpf, email, telefone, data, hora } = req.body;
  if (!nome || !cpf || !data || !hora) return res.json({ success: false, message: 'Campos obrigatórios faltando.' });

  db.get("SELECT * FROM agendamentos WHERE cpf = ? AND data >= DATE('now')", [cpf], (err, row) => {
    if (row) return res.json({ success: false, message: 'Já existe um agendamento ativo para este CPF.' });

    db.run("INSERT INTO agendamentos (nome, cpf, email, telefone, data, hora) VALUES (?, ?, ?, ?, ?, ?)",
      [nome, cpf, email, telefone, data, hora],
      function (err) {
        if (err) return res.json({ success: false, message: err.message });

        db.run("UPDATE horarios SET disponivel = 0 WHERE data = ? AND hora = ?", [data, hora]);
        res.json({ success: true, message: 'Agendamento realizado com sucesso!' });
      });
  });
});

// ====== LIMPEZA AUTOMÁTICA (30 DIAS APÓS DATA) ======
setInterval(() => {
  db.run("DELETE FROM agendamentos WHERE julianday('now') - julianday(data) > 30");
}, 24 * 60 * 60 * 1000);

// ====== INICIAR SERVIDOR ======
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
