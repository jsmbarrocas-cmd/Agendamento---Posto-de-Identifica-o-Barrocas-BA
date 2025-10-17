const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./agenda.db');

db.serialize(() => {
  // Tabela de horários disponíveis
  db.run(`CREATE TABLE IF NOT EXISTS horarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    hora TEXT NOT NULL,
    disponivel INTEGER DEFAULT 1
  )`);

  // Tabela de agendamentos
  db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    telefone TEXT NOT NULL,
    data TEXT NOT NULL,
    hora TEXT NOT NULL
  )`);
});

db.close();
console.log("Banco de dados criado e tabelas configuradas com sucesso!");
