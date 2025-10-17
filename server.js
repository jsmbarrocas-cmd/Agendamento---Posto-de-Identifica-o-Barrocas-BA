const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const session = require("express-session");

const app = express();
const db = new sqlite3.Database("./agenda.db");

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: "agenda-c326-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// ===============================
// BANCO DE DADOS
// ===============================
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        cpf TEXT,
        email TEXT,
        telefone TEXT,
        data TEXT,
        hora TEXT
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS horarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT,
        hora TEXT,
        disponivel INTEGER DEFAULT 1
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT UNIQUE,
        senha TEXT
    )`);

  db.get("SELECT * FROM admin WHERE usuario = ?", ["admin"], (err, row) => {
    if (!row) {
      db.run("INSERT INTO admin (usuario, senha) VALUES (?, ?)", [
        "admin",
        "009975",
      ]);
      console.log("✅ Usuário admin criado (admin / 009975)");
    }
  });
});

// ===============================
// FUNÇÃO PARA GERAR HORÁRIOS PADRÃO
// ===============================
function gerarHorariosPadrao(data) {
  const horarios = [
    "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30",
    "14:00", "14:30", "15:00", "15:30"
  ];

  horarios.forEach((hora) => {
    db.run(
      "INSERT INTO horarios (data, hora, disponivel) VALUES (?, ?, 1)",
      [data, hora],
      (err) => {
        if (err) console.error("Erro ao inserir horário:", err.message);
      }
    );
  });
}

// ===============================
// LOGIN / LOGOUT
// ===============================
app.post("/api/login", (req, res) => {
  const { usuario, senha } = req.body;
  db.get(
    "SELECT * FROM admin WHERE usuario = ? AND senha = ?",
    [usuario, senha],
    (err, row) => {
      if (err) return res.status(500).json({ success: false });
      if (row) {
        req.session.logado = true;
        res.json({ success: true });
      } else {
        res.json({ success: false });
      }
    }
  );
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ===============================
// MIDDLEWARE DE AUTENTICAÇÃO
// ===============================
function autenticar(req, res, next) {
  if (req.session.logado) return next();
  res.status(401).json({ success: false, message: "Não autorizado" });
}

// ===============================
// ROTAS ADMINISTRATIVAS
// ===============================
app.post("/admin/api/cadastrar-horarios", autenticar, (req, res) => {
  const { data } = req.body;
  if (!data) return res.json({ success: false, message: "Data inválida" });

  db.all("SELECT * FROM horarios WHERE data = ?", [data], (err, rows) => {
    if (rows.length > 0) {
      return res.json({ success: false, message: "Horários já cadastrados!" });
    } else {
      gerarHorariosPadrao(data);
      res.json({ success: true, message: "Horários gerados com sucesso!" });
    }
  });
});

// ✅ CORRIGIDO — EXCLUIR TODOS HORÁRIOS DE UMA DATA
app.delete("/admin/api/horarios/:data", autenticar, (req, res) => {
  const { data } = req.params;

  db.run("DELETE FROM horarios WHERE data = ?", [data], function (err) {
    if (err) {
      return res.json({ success: false, message: "Erro ao excluir horários." });
    }

    if (this.changes > 0) {
      return res.json({ success: true, message: "Todos os horários foram excluídos!" });
    } else {
      return res.json({ success: false, message: "Nenhum horário encontrado para esta data." });
    }
  });
});

// ✅ EXCLUIR AGENDAMENTO INDIVIDUAL
app.delete("/admin/api/agendamentos/:id", autenticar, (req, res) => {
  const { id } = req.params;

  db.get("SELECT * FROM agendamentos WHERE id = ?", [id], (err, row) => {
    if (!row) return res.json({ success: false, message: "Agendamento não encontrado." });

    db.run("DELETE FROM agendamentos WHERE id = ?", [id], function (err2) {
      if (err2) return res.json({ success: false, message: "Erro ao excluir agendamento." });

      db.run(
        "UPDATE horarios SET disponivel = 1 WHERE data = ? AND hora = ?",
        [row.data, row.hora]
      );

      res.json({ success: true, message: "Agendamento excluído com sucesso!" });
    });
  });
});

// ===============================
// CONSULTAR LISTAS
// ===============================
app.get("/admin/api/agendamentos", autenticar, (req, res) => {
  const { inicio, fim } = req.query;
  let query = "SELECT * FROM agendamentos";
  const params = [];

  if (inicio && fim) {
    query += " WHERE date(data) BETWEEN date(?) AND date(?)";
    params.push(inicio, fim);
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, rows });
  });
});

app.get("/admin/api/horarios", autenticar, (req, res) => {
  db.all("SELECT * FROM horarios ORDER BY data, hora", [], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ success: true, rows });
  });
});

// ===============================
// ROTAS PÚBLICAS
// ===============================
app.get("/api/datas-disponiveis", (req, res) => {
  db.all(
    "SELECT DISTINCT data FROM horarios WHERE disponivel = 1 ORDER BY data ASC",
    (err, rows) => {
      if (err) return res.status(500).json([]);
      const datas = rows.map((r) => r.data);
      res.json(datas);
    }
  );
});

app.get("/api/horarios-disponiveis", (req, res) => {
  const { data } = req.query;
  db.all(
    "SELECT hora FROM horarios WHERE data = ? AND disponivel = 1 ORDER BY hora ASC",
    [data],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

// ===============================
// AGENDAR NOVO HORÁRIO
// ===============================
app.post("/api/agendar", (req, res) => {
  const { nome, cpf, email, telefone, data, hora } = req.body;

  // Bloqueia novo agendamento se existir algum agendamento futuro para o mesmo CPF
  db.get(
    "SELECT * FROM agendamentos WHERE cpf = ? AND date(data) >= date('now')",
    [cpf],
    (err, row) => {
      if (row) {
        return res.json({
          success: false,
          message: "Você já possui um agendamento futuro. Só é permitido um de cada vez.",
        });
      }

      db.get(
        "SELECT * FROM horarios WHERE data = ? AND hora = ? AND disponivel = 1",
        [data, hora],
        (err, row) => {
          if (!row) {
            return res.json({
              success: false,
              message: "Horário indisponível!",
            });
          }

          db.run(
            "INSERT INTO agendamentos (nome, cpf, email, telefone, data, hora) VALUES (?, ?, ?, ?, ?, ?)",
            [nome, cpf, email, telefone, data, hora],
            function (err) {
              if (err)
                return res.json({
                  success: false,
                  message: "Erro ao agendar.",
                });

              db.run(
                "UPDATE horarios SET disponivel = 0 WHERE data = ? AND hora = ?",
                [data, hora]
              );

              const doc = new PDFDocument();
              const pdfPath = path.join(
                __dirname,
                "public",
                `comprovante_${this.lastID}.pdf`
              );
              const stream = fs.createWriteStream(pdfPath);
              doc.pipe(stream);

              const dataFormatada = new Date(data + "T00:00:00-03:00").toLocaleDateString("pt-BR");

              doc.fontSize(20).text("Comprovante de Agendamento", { align: "center" });
              doc.moveDown();
              doc.fontSize(14).text(`Nome: ${nome}`);
              doc.text(`CPF: ${cpf}`);
              doc.text(`E-mail: ${email}`);
              doc.text(`Telefone: ${telefone}`);
              doc.text(`Data: ${dataFormatada}`);
              doc.text(`Horário: ${hora}`);
              doc.end();

              stream.on("finish", () => {
                res.json({
                  success: true,
                  message: "Agendamento realizado com sucesso!",
                  comprovante: `/comprovante_${this.lastID}.pdf`,
                });
              });
            }
          );
        }
      );
    }
  );
});

// ===============================
// ADMIN PAGE
// ===============================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ===============================
// REMOÇÃO AUTOMÁTICA DE AGENDAMENTOS APÓS 30 DIAS DA DATA
setInterval(() => {
  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje.setDate(hoje.getDate() - 30))
    .toISOString()
    .split("T")[0]; // formato YYYY-MM-DD

  db.run(
    "DELETE FROM agendamentos WHERE date(data) <= ?",
    [trintaDiasAtras],
    function (err) {
      if (err) console.error("Erro ao remover agendamentos antigos:", err.message);
      else if (this.changes > 0)
        console.log(`🗑️ ${this.changes} agendamento(s) antigos removidos automaticamente.`);
    }
  );
}, 24 * 60 * 60 * 1000); // roda a cada 24 horas

// ===============================
const PORT = 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);
