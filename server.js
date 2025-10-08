
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.use(bodyParser.json());

const db = new sqlite3.Database('./agenda.db');

function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g,'');
    if(cpf.length !== 11) return false;
    let soma = 0;
    let resto;
    for(let i=1; i<=9; i++) soma += parseInt(cpf.substring(i-1,i)) * (11-i);
    resto = (soma * 10) % 11;
    if(resto === 10 || resto === 11) resto = 0;
    if(resto !== parseInt(cpf.substring(9,10))) return false;
    soma = 0;
    for(let i=1; i<=10; i++) soma += parseInt(cpf.substring(i-1,i)) * (12-i);
    resto = (soma * 10) % 11;
    if(resto === 10 || resto === 11) resto = 0;
    if(resto !== parseInt(cpf.substring(10,11))) return false;
    return true;
}

app.post('/agendar', (req, res) => {
  const { nome, cpf, email, telefone, data, hora } = req.body;

  if (!nome || !cpf || !email || !telefone || !data || !hora) {
    return res.status(400).json({ erro: 'Nome, CPF, e-mail, telefone, data e hora são obrigatórios' });
  }

  if (!validarCPF(cpf)) {
    return res.status(400).json({ erro: 'CPF inválido' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }

  if (!/^\d{10,11}$/.test(telefone)) {
    return res.status(400).json({ erro: 'Telefone inválido' });
  }

  db.get('SELECT * FROM agendamentos WHERE cpf = ?', [cpf], (err, agendamento) => {
    if (agendamento) {
      return res.status(400).json({ erro: 'CPF já possui agendamento' });
    }

    db.get('SELECT * FROM horarios WHERE data = ? AND hora = ? AND disponivel = 1', [data, hora], (err, horario) => {
      if (err || !horario) {
        return res.status(400).json({ erro: 'Horário indisponível' });
      }

      db.run(
        'INSERT INTO agendamentos (nome, cpf, email, telefone, data, hora) VALUES (?, ?, ?, ?, ?, ?)',
        [nome, cpf, email, telefone, data, hora],
        function (err) {
          if (err) return res.status(500).json({ erro: 'Erro ao agendar' });

          db.run('UPDATE horarios SET disponivel = 0 WHERE id = ?', [horario.id]);
          res.json({ sucesso: true, agendamentoId: this.lastID });
        }
      );
    });
  });
});

app.get('/', (req, res) => {
  res.send('Agenda - Posto de Identificação - Barrocas-BA está online!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
