// Os casos abaixo são conferidos contra o painel REAL do eAgenda
// (prints de 30/07/2026). Se algum quebrar, o nosso motor divergiu do
// comportamento que o Eduardo já tem hoje.

import { describe, expect, test } from 'vitest';
import {
  availableSlots,
  canCancel,
  generateSlots,
  offGridAppointments,
  suggestedDay
} from './availability';
import { easterSunday, holidaysBetween, nationalHolidays } from './holidays';
import {
  addDays,
  daysBetween,
  formatMeetingLabel,
  toDayKey,
  toMonthKey,
  toTimeKey,
  weekdayOf,
  zonedToInstant
} from './timezone';
import { Appointment, AvailabilityRule, DEFAULT_SETTINGS, ScheduleBlock } from './types';

// A grade exata do painel dele (0 = domingo ... 6 = sábado).
const GRADE: AvailabilityRule[] = [
  { id: 1, weekday: 1, startTime: '08:30', endTime: '10:30', active: true },
  { id: 2, weekday: 1, startTime: '14:00', endTime: '17:00', active: true },
  { id: 3, weekday: 1, startTime: '18:30', endTime: '21:30', active: true },
  { id: 4, weekday: 2, startTime: '08:30', endTime: '10:30', active: true },
  { id: 5, weekday: 2, startTime: '14:00', endTime: '17:00', active: true },
  { id: 6, weekday: 2, startTime: '18:30', endTime: '20:30', active: true },
  { id: 7, weekday: 3, startTime: '14:00', endTime: '17:00', active: true },
  { id: 8, weekday: 3, startTime: '18:30', endTime: '20:30', active: true },
  { id: 9, weekday: 4, startTime: '08:30', endTime: '10:30', active: true },
  { id: 10, weekday: 4, startTime: '14:00', endTime: '17:00', active: true },
  { id: 11, weekday: 4, startTime: '18:30', endTime: '19:30', active: true },
  { id: 12, weekday: 5, startTime: '14:00', endTime: '17:00', active: true },
  { id: 13, weekday: 6, startTime: '09:00', endTime: '10:00', active: true }
];

const booking = (day: string, time: string, extra: Partial<Appointment> = {}): Appointment => ({
  id: `appt-${day}-${time}`,
  clientId: 'c1',
  startsAt: zonedToInstant(day, time).toISOString(),
  endsAt: new Date(zonedToInstant(day, time).getTime() + 3_600_000).toISOString(),
  attendeeName: 'Fulano',
  attendeeEmail: null,
  attendeePhone: null,
  status: 'CONFIRMED',
  meetUrl: null,
  googleEventId: null,
  manageToken: `tok-${day}-${time}`,
  source: 'personal_link',
  canceledAt: null,
  cancelReason: null,
  createdAt: '2026-07-01T12:00:00Z',
  ...extra
});

const timesOn = (slots: { day: string; time: string }[], day: string) =>
  slots.filter(s => s.day === day).map(s => s.time);

describe('geração de horários a partir da grade', () => {
  test('a faixa só gera o horário se a reunião inteira couber dentro dela', () => {
    // Segunda 27/07/2026. 08:30–10:30 cabe 08:30 e 09:30; 10:30 já não cabe.
    const slots = generateSlots('2026-07-27', '2026-07-27', GRADE, 60);

    expect(timesOn(slots, '2026-07-27')).toEqual([
      '08:30', '09:30',            // 08:30–10:30
      '14:00', '15:00', '16:00',   // 14:00–17:00
      '18:30', '19:30', '20:30'    // 18:30–21:30
    ]);
  });

  test('faixa de uma hora gera um horário só', () => {
    // Quinta 18:30–19:30 e sábado 09:00–10:00.
    const quinta = generateSlots('2026-07-30', '2026-07-30', GRADE, 60);
    const sabado = generateSlots('2026-08-01', '2026-08-01', GRADE, 60);

    expect(timesOn(quinta, '2026-07-30')).toContain('18:30');
    expect(timesOn(quinta, '2026-07-30')).not.toContain('19:30');
    expect(timesOn(sabado, '2026-08-01')).toEqual(['09:00']);
  });

  test('a semana da grade dá 30 horários, e domingo fica de fora', () => {
    // Domingo 26/07 a sábado 01/08 — a mesma semana do print.
    const slots = generateSlots('2026-07-26', '2026-08-01', GRADE, 60);

    expect(slots).toHaveLength(30);
    expect(timesOn(slots, '2026-07-26')).toEqual([]); // domingo
  });

  test('faixas sobrepostas não geram o mesmo horário duas vezes', () => {
    const comSobreposicao: AvailabilityRule[] = [
      { id: 1, weekday: 1, startTime: '14:00', endTime: '17:00', active: true },
      { id: 2, weekday: 1, startTime: '15:00', endTime: '18:00', active: true }
    ];

    const slots = generateSlots('2026-07-27', '2026-07-27', comSobreposicao, 60);
    expect(timesOn(slots, '2026-07-27')).toEqual(['14:00', '15:00', '16:00', '17:00']);
  });

  test('faixa inativa não gera horário', () => {
    const desligada = GRADE.map(rule =>
      rule.weekday === 6 ? { ...rule, active: false } : rule
    );
    const slots = generateSlots('2026-08-01', '2026-08-01', desligada, 60);
    expect(timesOn(slots, '2026-08-01')).toEqual([]);
  });

  test('bate horário a horário com o print da semana de 26/07', () => {
    const slots = generateSlots('2026-07-26', '2026-08-01', GRADE, 60);

    expect(timesOn(slots, '2026-07-28')).toEqual(
      ['08:30', '09:30', '14:00', '15:00', '16:00', '18:30', '19:30']
    );
    expect(timesOn(slots, '2026-07-29')).toEqual(
      ['14:00', '15:00', '16:00', '18:30', '19:30']
    );
    expect(timesOn(slots, '2026-07-31')).toEqual(['14:00', '15:00', '16:00']);
  });
});

describe('janela de antecedência', () => {
  // O dropdown do cliente, printado em 30/07/2026 à noite, listava
  // exatamente: 03, 04, 05, 06, 07, 10, 11, 12, 13 e 14 de agosto.
  const now = zonedToInstant('2026-07-30', '19:30');

  test('reproduz a lista de dias que o cliente via no dropdown', () => {
    const slots = availableSlots({
      now,
      rules: GRADE,
      blocks: [],
      // Os dois sábados da janela já estavam ocupados no painel.
      appointments: [booking('2026-08-01', '09:00'), booking('2026-08-08', '09:00')],
      settings: DEFAULT_SETTINGS
    });

    const dias = [...new Set(slots.map(s => s.day))];

    expect(dias).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'
    ]);
  });

  test('a antecedência mínima de 24h derruba a sexta seguinte inteira', () => {
    // Sexta 31/07 só atende até 17:00, e 24h a partir de 30/07 19:30
    // cai em 31/07 19:30 — não sobra horário nenhum.
    const slots = availableSlots({
      now,
      rules: GRADE,
      blocks: [],
      appointments: [],
      settings: DEFAULT_SETTINGS
    });

    expect(slots.some(s => s.day === '2026-07-31')).toBe(false);
  });

  test('a antecedência máxima de 15 dias corta em 14/08', () => {
    const slots = availableSlots({
      now,
      rules: GRADE,
      blocks: [],
      appointments: [],
      settings: DEFAULT_SETTINGS
    });

    const ultimo = slots[slots.length - 1];
    expect(ultimo.day).toBe('2026-08-14');
    expect(daysBetween('2026-07-30', ultimo.day)).toBe(15);
  });
});

describe('bloqueios', () => {
  const now = zonedToInstant('2026-07-20', '08:00');
  const base = { now, rules: GRADE, appointments: [], settings: DEFAULT_SETTINGS };

  test('bloqueio de faixa derruba só os horários daquela faixa', () => {
    // A quinta 30/07 aparece com 08:30 e 09:30 "-BLOQUEADO" no print.
    const blocks: ScheduleBlock[] = [{
      id: 1,
      dateFrom: '2026-07-30',
      dateTo: null,
      timeFrom: '08:30',
      timeTo: '10:30',
      source: 'manual'
    }];

    const slots = availableSlots({ ...base, blocks });
    const quinta = timesOn(slots, '2026-07-30');

    expect(quinta).not.toContain('08:30');
    expect(quinta).not.toContain('09:30');
    expect(quinta).toContain('14:00'); // a tarde continua aberta
  });

  test('bloqueio sem horário fecha o dia inteiro', () => {
    const blocks: ScheduleBlock[] = [
      { id: 1, dateFrom: '2026-07-30', dateTo: null, timeFrom: null, timeTo: null, source: 'manual' }
    ];

    const slots = availableSlots({ ...base, blocks });
    expect(timesOn(slots, '2026-07-30')).toEqual([]);
  });

  test('bloqueio de período fecha todos os dias do intervalo (férias)', () => {
    const blocks: ScheduleBlock[] = [
      { id: 1, dateFrom: '2026-07-27', dateTo: '2026-07-31', timeFrom: null, timeTo: null, source: 'manual' }
    ];

    const slots = availableSlots({ ...base, blocks });

    for (const dia of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']) {
      expect(timesOn(slots, dia)).toEqual([]);
    }
    expect(timesOn(slots, '2026-08-01')).toEqual(['09:00']); // volta no sábado
  });

  test('a faixa do bloqueio vale em cada dia do período, não de ponta a ponta', () => {
    // "de 27 a 31/07, das 14:00 às 17:00" bloqueia a tarde de cada dia —
    // a manhã e a noite continuam livres.
    const blocks: ScheduleBlock[] = [
      { id: 1, dateFrom: '2026-07-27', dateTo: '2026-07-31', timeFrom: '14:00', timeTo: '17:00', source: 'manual' }
    ];

    const slots = availableSlots({ ...base, blocks });
    const segunda = timesOn(slots, '2026-07-27');

    expect(segunda).toEqual(['08:30', '09:30', '18:30', '19:30', '20:30']);
  });

  test('horário já ocupado não é oferecido de novo', () => {
    const slots = availableSlots({
      ...base,
      blocks: [],
      appointments: [booking('2026-07-27', '14:00')]
    });

    expect(timesOn(slots, '2026-07-27')).not.toContain('14:00');
    expect(timesOn(slots, '2026-07-27')).toContain('15:00');
  });
});

describe('mudar a grade não mexe em quem já marcou', () => {
  test('reunião fora da grade atual continua existindo', () => {
    // O caso real: ele atendia quarta de manhã, tirou o horário da grade
    // por causa da filha, e os agendamentos do Gentil e da Victoria ficaram.
    const jaMarcados = [
      booking('2026-07-29', '08:30'), // Gentil
      booking('2026-07-29', '09:30')  // Victoria
    ];

    const foraDaGrade = offGridAppointments('2026-07-26', '2026-08-01', GRADE, jaMarcados, 60);
    expect(foraDaGrade).toHaveLength(2);

    // E a grade nova realmente não oferece mais aqueles horários.
    const slots = availableSlots({
      now: zonedToInstant('2026-07-20', '08:00'),
      rules: GRADE,
      blocks: [],
      appointments: jaMarcados,
      settings: DEFAULT_SETTINGS
    });
    expect(timesOn(slots, '2026-07-29')).toEqual(['14:00', '15:00', '16:00', '18:30', '19:30']);
  });
});

describe('feriados', () => {
  test('Páscoa de 2026 cai em 5 de abril', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2024)).toBe('2024-03-31');
  });

  test('os móveis saem certos a partir da Páscoa', () => {
    const nomes = new Map(nationalHolidays(2026).map(h => [h.label, h.day]));

    expect(nomes.get('Carnaval (terça)')).toBe('2026-02-17');
    expect(nomes.get('Sexta-feira Santa')).toBe('2026-04-03');
    expect(nomes.get('Corpus Christi')).toBe('2026-06-04');
  });

  test('feriado fecha a agenda do dia', () => {
    // 7 de setembro de 2026 é uma segunda-feira.
    expect(weekdayOf('2026-09-07')).toBe(1);

    const slots = availableSlots({
      now: zonedToInstant('2026-09-01', '08:00'),
      rules: GRADE,
      blocks: [],
      appointments: [],
      settings: DEFAULT_SETTINGS
    });

    expect(timesOn(slots, '2026-09-07')).toEqual([]);
    expect(timesOn(slots, '2026-09-08')).not.toEqual([]);
  });

  test('o estadual de SP entra, e a exceção "allow" libera o dia', () => {
    const comEstadual = holidaysBetween('2026-07-01', '2026-07-31', {
      blockNational: true, blockState: true, stateCode: 'SP'
    });
    expect(comEstadual.has('2026-07-09')).toBe(true);

    const liberado = holidaysBetween('2026-07-01', '2026-07-31', {
      blockNational: true,
      blockState: true,
      stateCode: 'SP',
      overrides: [{ day: '2026-07-09', kind: 'allow' }]
    });
    expect(liberado.has('2026-07-09')).toBe(false);
  });
});

describe('cancelamento', () => {
  const appointment = booking('2026-08-13', '15:00');

  test('dá para cancelar com mais de 5 horas de antecedência', () => {
    const now = zonedToInstant('2026-08-13', '09:00'); // 6h antes
    expect(canCancel(appointment, now, DEFAULT_SETTINGS)).toBe(true);
  });

  test('não dá para cancelar em cima da hora', () => {
    const now = zonedToInstant('2026-08-13', '12:00'); // 3h antes
    expect(canCancel(appointment, now, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('fuso horário', () => {
  test('a data civil sobrevive à ida e volta', () => {
    const instant = zonedToInstant('2026-08-13', '15:00');

    expect(toDayKey(instant)).toBe('2026-08-13');
    expect(toTimeKey(instant)).toBe('15:00');
    expect(instant.toISOString()).toBe('2026-08-13T18:00:00.000Z'); // UTC-3
  });

  test('o começo do mês não escorrega para o mês anterior', () => {
    // A cicatriz do projeto: `new Date('2026-09-01')` em UTC-3 vira 31/08.
    expect(toMonthKey(zonedToInstant('2026-09-01', '00:00'))).toBe('2026-09');
    expect(toDayKey(zonedToInstant('2026-09-01', '00:00'))).toBe('2026-09-01');
  });

  test('reunião cedo da manhã não cai no dia anterior', () => {
    const instant = zonedToInstant('2026-08-03', '08:30');
    expect(toDayKey(instant)).toBe('2026-08-03');
    expect(toMonthKey(instant)).toBe('2026-08');
  });

  test('o rótulo da mensagem sai no formato combinado', () => {
    expect(formatMeetingLabel(zonedToInstant('2026-08-13', '15:00')))
      .toBe('quinta-feira, 13/08 às 15:00');
    expect(formatMeetingLabel(zonedToInstant('2026-08-01', '09:00')))
      .toBe('sábado, 01/08 às 09:00');
  });

  test('somar dias atravessa o fim do mês corretamente', () => {
    expect(addDays('2026-07-30', 15)).toBe('2026-08-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // bissexto
  });
});

describe('data ideal da próxima reunião', () => {
  test('sugere 30 dias depois da última', () => {
    expect(suggestedDay('2026-07-28')).toBe('2026-08-27');
  });

  test('sem reunião anterior, não sugere nada', () => {
    expect(suggestedDay(null)).toBeNull();
  });
});
