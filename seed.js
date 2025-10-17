const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./agenda.db');

// Altere aqui as datas e horários disponíveis conforme quiser
const datas = [
  { data: '2025-10-09', horas: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00'] },
  { data: '2025-10-10', horas: ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00'] },
  { data: '2025-10-11', horas: ['08:00', '09:00', '10:00', '11:00'] }
];

db.serialize(() => {
  datas.forEach(dia => {
    dia.horas.forEach(hora => {
      db.run('INSERT INTO horarios (data, hora, disponivel) VALUES (?, ?, 1)', [dia.data, hora]);
    });
  });
});

db.close();
console.log('Horários inseridos com sucesso!');
