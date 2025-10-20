const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Banco de dados local (Render-friendly)
const db = new sqlite3.Database('./agenda.db');

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'agenda_secreta',
  resave: false,
  saveUninitialized: true
}));

// Criação das tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admin (
    usuario TEXT PRIMARY KEY,
    senha TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT,
    hora TEXT,
    disponivel INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    cpf TEXT,
    data TEXT,
    hora TEXT,
    atendido INTEGER DEFAULT 0
  )`);

  // Insere admin padrão se não existir
  db.get("SELECT * FROM admin WHERE usuario = ?", ["admin"], (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (usuario, senha) VALUES (?, ?)", ["admin", "009975"]);
      console.log("✅ Admin criado com usuário: admin e senha: 009975");
    }
  });
});

// Remove agendamentos 30 dias após atendimento
cron.schedule('0 3 * * *', () => {
  db.run("DELETE FROM agendamentos WHERE atendido = 1 AND julianday('now') - julianday(data) > 30");
  console.log("🧹 Agendamentos antigos removidos automaticamente");
});

// Rota inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de login
app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  db.get("SELECT * FROM admin WHERE usuario = ? AND senha = ?", [usuario, senha], (err, row) => {
    if (row) {
      req.session.logado = true;
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  });
});

// Rota do painel admin
app.get('/admin', (req, res) => {
  if (req.session.logado) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.redirect('/login.html');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ==========================
// ROTAS DE AGENDAMENTO
// ==========================

// Datas com horários disponíveis
app.get('/api/datas-disponiveis', (req, res) => {
  db.all("SELECT DISTINCT data FROM horarios WHERE disponivel = 1 ORDER BY data ASC", (err, rows) => {
    if (err) return res.json({ success: false, error: err.message });
    const datas = rows.map(r => r.data);
    res.json({ success: true, datas });
  });
});

// Horários disponíveis por data
app.get('/api/horarios/:data', (req, res) => {
  const data = req.params.data;
  db.all("SELECT hora FROM horarios WHERE data = ? AND disponivel = 1 ORDER BY time(hora) ASC", [data], (err, rows) => {
    if (err) return res.json({ success: false, error: err.message });
    const horas = rows.map(r => r.hora);
    res.json({ success: true, horas });
  });
});

// Novo agendamento
app.post('/api/agendar', (req, res) => {
  const { nome, cpf, data, hora } = req.body;

  db.get("SELECT * FROM agendamentos WHERE cpf = ? AND atendido = 0", [cpf], (err, existente) => {
    if (existente) {
      return res.json({ success: false, message: "Você já possui um agendamento ativo. Aguarde o atendimento." });
    }

    db.run("INSERT INTO agendamentos (nome, cpf, data, hora) VALUES (?, ?, ?, ?)", [nome, cpf, data, hora], function (err) {
      if (err) return res.json({ success: false, error: err.message });

      db.run("UPDATE horarios SET disponivel = 0 WHERE data = ? AND hora = ?", [data, hora]);
      res.json({ success: true });
    });
  });
});

// Gera comprovante PDF
app.get('/api/comprovante/:cpf', (req, res) => {
  const cpf = req.params.cpf;

  db.get("SELECT * FROM agendamentos WHERE cpf = ? ORDER BY id DESC LIMIT 1", [cpf], (err, agendamento) => {
    if (!agendamento) return res.status(404).send("Agendamento não encontrado.");

    const doc = new PDFDocument();
    const filePath = path.join(__dirname, 'public', 'comprovante.pdf');
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("Comprovante de Agendamento", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Nome: ${agendamento.nome}`);
    doc.text(`CPF: ${agendamento.cpf}`);
    doc.text(`Data: ${agendamento.data.split('-').reverse().join('/')}`);
    doc.text(`Hora: ${agendamento.hora}`);
    doc.end();

    stream.on('finish', () => {
      res.download(filePath, "comprovante.pdf", () => fs.unlinkSync(filePath));
    });
  });
});

// ==========================
// ROTAS ADMINISTRATIVAS
// ==========================

// Adiciona data e gera horários automáticos
app.post('/api/admin/adicionar-horarios', (req, res) => {
  const { data } = req.body;
  const horarios = [
    "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30",
    "14:00", "14:30", "15:00", "15:30"
  ];

  db.serialize(() => {
    horarios.forEach(hora => {
      db.run("INSERT INTO horarios (data, hora, disponivel) VALUES (?, ?, 1)", [data, hora]);
    });
  });
  res.json({ success: true });
});

// Listar todos os agendamentos
app.get('/api/admin/agendamentos', (req, res) => {
  db.all("SELECT * FROM agendamentos ORDER BY date(data), time(hora)", [], (err, rows) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true, agendamentos: rows });
  });
});

// Excluir todos horários de uma data
app.delete('/api/admin/excluir-horarios/:data', (req, res) => {
  const data = req.params.data;
  db.run("DELETE FROM horarios WHERE data = ?", [data], function (err) {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// Gera relatório PDF filtrado
app.post('/api/admin/relatorio', (req, res) => {
  const { dataInicio, dataFim } = req.body;

  db.all("SELECT * FROM agendamentos WHERE date(data) BETWEEN date(?) AND date(?) ORDER BY date(data), time(hora)", [dataInicio, dataFim], (err, rows) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!rows.length) return res.status(404).json({ success: false, message: "Nenhum agendamento encontrado no período." });

    const doc = new PDFDocument();
    const filePath = path.join(__dirname, 'public', 'relatorio.pdf');
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("Relatório de Agendamentos", { align: "center" });
    doc.moveDown();

    rows.forEach(r => {
      doc.fontSize(12).text(`Nome: ${r.nome}`);
      doc.text(`CPF: ${r.cpf}`);
      doc.text(`Data: ${r.data.split('-').reverse().join('/')} - Hora: ${r.hora}`);
      doc.moveDown();
    });

    doc.end();
    stream.on('finish', () => {
      res.download(filePath, "relatorio.pdf", () => fs.unlinkSync(filePath));
    });
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
