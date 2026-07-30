import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import { slotTimesInRange } from './availability';
import { timeToMinutes } from './timezone';
import { AvailabilityRule } from './types';

const WEEKDAYS = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' }
];

type DraftRule = { key: string; weekday: number; startTime: string; endTime: string };

interface HoursConfigProps {
  rules: AvailabilityRule[];
  durationMinutes: number;
  canEdit: boolean;
  onSave: (rules: Omit<AvailabilityRule, 'id'>[]) => Promise<string | null>;
}

const toDraft = (rules: AvailabilityRule[]): DraftRule[] =>
  rules
    .filter(rule => rule.active)
    .map(rule => ({
      key: `r${rule.id}`,
      weekday: rule.weekday,
      startTime: rule.startTime,
      endTime: rule.endTime
    }));

const sortDraft = (rows: DraftRule[]): DraftRule[] => {
  const order = (weekday: number) => (weekday === 0 ? 7 : weekday);
  return [...rows].sort(
    (a, b) => order(a.weekday) - order(b.weekday) || a.startTime.localeCompare(b.startTime)
  );
};

/** Faixas do mesmo dia que se cruzam gerariam horário repetido. */
const findOverlaps = (rows: DraftRule[]): Set<string> => {
  const bad = new Set<string>();

  for (const a of rows) {
    for (const b of rows) {
      if (a.key === b.key || a.weekday !== b.weekday) continue;
      const aStart = timeToMinutes(a.startTime);
      const aEnd = timeToMinutes(a.endTime);
      const bStart = timeToMinutes(b.startTime);
      const bEnd = timeToMinutes(b.endTime);
      if (aStart < bEnd && aEnd > bStart) {
        bad.add(a.key);
        bad.add(b.key);
      }
    }
  }
  return bad;
};

export function HoursConfig({ rules, durationMinutes, canEdit, onSave }: HoursConfigProps) {
  const [draft, setDraft] = useState<DraftRule[]>(() => sortDraft(toDraft(rules)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Ressincroniza quando a grade muda de verdade no banco (depois de salvar
  // ou de um "Atualizar") — e não a cada re-render, para não apagar o que
  // está sendo editado na tela.
  const rulesSignature = rules
    .map(rule => `${rule.id}:${rule.weekday}:${rule.startTime}:${rule.endTime}:${rule.active}`)
    .join('|');

  useEffect(() => {
    setDraft(sortDraft(toDraft(rules)));
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesSignature]);

  const overlaps = useMemo(() => findOverlaps(draft), [draft]);

  const invalid = useMemo(
    () => draft.filter(row => timeToMinutes(row.endTime) <= timeToMinutes(row.startTime)),
    [draft]
  );

  const totalSlots = useMemo(
    () =>
      draft.reduce(
        (sum, row) => sum + slotTimesInRange(row.startTime, row.endTime, durationMinutes).length,
        0
      ),
    [draft, durationMinutes]
  );

  const updateRow = (key: string, patch: Partial<DraftRule>) => {
    setDraft(rows => rows.map(row => (row.key === key ? { ...row, ...patch } : row)));
    setMessage(null);
  };

  const addRow = () => {
    setDraft(rows => [
      ...rows,
      { key: `new-${Date.now()}-${rows.length}`, weekday: 1, startTime: '14:00', endTime: '17:00' }
    ]);
    setMessage(null);
  };

  const removeRow = (key: string) => {
    setDraft(rows => rows.filter(row => row.key !== key));
    setMessage(null);
  };

  /** Copia as faixas de segunda para os outros dias (como no eAgenda). */
  const copyMonday = (untilSunday: boolean) => {
    const monday = draft.filter(row => row.weekday === 1);
    if (monday.length === 0) {
      setMessage('Cadastre as faixas de segunda primeiro.');
      return;
    }
    const targets = untilSunday ? [2, 3, 4, 5, 6, 0] : [2, 3, 4, 5];
    const copies = targets.flatMap(weekday =>
      monday.map((row, index) => ({
        key: `copy-${weekday}-${index}-${Date.now()}`,
        weekday,
        startTime: row.startTime,
        endTime: row.endTime
      }))
    );
    setDraft(rows => sortDraft([...rows.filter(row => !targets.includes(row.weekday)), ...copies]));
    setMessage(null);
  };

  const handleSave = async () => {
    if (invalid.length > 0) {
      setMessage('Tem faixa com o fim antes do início. Corrija para salvar.');
      return;
    }
    if (overlaps.size > 0) {
      setMessage('Tem faixas do mesmo dia se sobrepondo. Corrija para salvar.');
      return;
    }
    setSaving(true);
    const error = await onSave(
      sortDraft(draft).map(row => ({
        weekday: row.weekday,
        startTime: row.startTime,
        endTime: row.endTime,
        active: true
      }))
    );
    setSaving(false);
    setMessage(error ? `Não consegui salvar: ${error}` : 'Grade salva.');
  };

  const rows = sortDraft(draft);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-600">
            Configurar Horários
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cada reunião dura {durationMinutes} minutos. A faixa gera um horário por vez —
            hoje sua grade oferece <strong>{totalSlots} horários por semana</strong>.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => copyMonday(false)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar Seg → Ter a Sex
            </button>
            <button
              onClick={() => copyMonday(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copiar Seg → Ter a Dom
            </button>
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar faixa
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-black uppercase tracking-widest text-slate-500 bg-white border-b border-slate-200">
              <th className="text-left px-4 py-2.5">Dia</th>
              <th className="text-left px-4 py-2.5">Início</th>
              <th className="text-left px-4 py-2.5">Fim</th>
              <th className="text-left px-4 py-2.5">Horários gerados</th>
              {canEdit && <th className="w-12" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="text-center py-12 text-slate-400 text-sm">
                  Nenhuma faixa cadastrada — sua agenda não vai oferecer nenhum horário.
                </td>
              </tr>
            )}

            {rows.map(row => {
              const times = slotTimesInRange(row.startTime, row.endTime, durationMinutes);
              const hasProblem = overlaps.has(row.key) || times.length === 0;

              return (
                <tr key={row.key} className={hasProblem ? 'bg-red-50/60' : 'hover:bg-slate-50/60'}>
                  <td className="px-4 py-2">
                    <select
                      value={row.weekday}
                      disabled={!canEdit}
                      onChange={e => updateRow(row.key, { weekday: Number(e.target.value) })}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    >
                      {WEEKDAYS.map(day => (
                        <option key={day.value} value={day.value}>{day.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="time"
                      value={row.startTime}
                      disabled={!canEdit}
                      onChange={e => updateRow(row.key, { startTime: e.target.value })}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="time"
                      value={row.endTime}
                      disabled={!canEdit}
                      onChange={e => updateRow(row.key, { endTime: e.target.value })}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                    />
                  </td>
                  <td className="px-4 py-2">
                    {times.length === 0 ? (
                      <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Faixa curta demais — não cabe nem uma reunião
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {times.map(time => (
                          <span
                            key={time}
                            className="px-2 py-0.5 rounded-md bg-yellow-100 border border-yellow-200 text-yellow-800 text-xs font-bold"
                          >
                            {time}
                          </span>
                        ))}
                      </div>
                    )}
                    {overlaps.has(row.key) && (
                      <span className="mt-1 block text-xs text-red-600 font-semibold">
                        Esta faixa se cruza com outra do mesmo dia.
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <button
                        onClick={() => removeRow(row.key)}
                        title="Remover faixa"
                        className="p-1.5 text-slate-300 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-slate-500 max-w-xl">
          <strong>Mudanças valem só para novos agendamentos.</strong> Quem já marcou continua
          marcado, mesmo que você tire o horário da grade.
        </p>
        <div className="flex items-center gap-3">
          {message && (
            <span
              className={`text-xs font-semibold ${
                message === 'Grade salva.' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {message}
            </span>
          )}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-sm font-bold transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando…' : 'Salvar grade'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
