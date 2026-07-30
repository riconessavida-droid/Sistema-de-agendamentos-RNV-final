import React, { useState } from 'react';
import { DownloadCloud, Lock, Plus, Trash2 } from 'lucide-react';
import { NewBlock } from './db';
import { toDayKey } from './timezone';
import { ScheduleBlock } from './types';

interface BlocksPanelProps {
  blocks: ScheduleBlock[];
  now: Date;
  canEdit: boolean;
  onAdd: (block: NewBlock) => Promise<string | null>;
  onRemove: (id: number) => Promise<string | null>;
  onImportEagenda: () => Promise<{ imported: number; error?: string }>;
}

const formatDay = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

const describeBlock = (block: ScheduleBlock): string => {
  const period = block.dateTo && block.dateTo !== block.dateFrom
    ? `${formatDay(block.dateFrom)} a ${formatDay(block.dateTo)}`
    : formatDay(block.dateFrom);
  const hours = block.timeFrom && block.timeTo
    ? `das ${block.timeFrom} às ${block.timeTo}`
    : 'dia inteiro';
  return `${period} · ${hours}`;
};

export function BlocksPanel({
  blocks,
  now,
  canEdit,
  onAdd,
  onRemove,
  onImportEagenda
}: BlocksPanelProps) {
  const today = toDayKey(now);

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Bloqueio já vencido não interessa mais na lista.
  const upcoming = blocks
    .filter(block => (block.dateTo ?? block.dateFrom) >= today)
    .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

  const handleAdd = async () => {
    if (!dateFrom) {
      setMessage('Escolha pelo menos a data inicial.');
      return;
    }
    if ((timeFrom && !timeTo) || (!timeFrom && timeTo)) {
      setMessage('Preencha os dois horários, ou nenhum (aí bloqueia o dia inteiro).');
      return;
    }
    if (timeFrom && timeTo && timeTo <= timeFrom) {
      setMessage('O horário de fim precisa ser depois do de início.');
      return;
    }
    if (dateTo && dateTo < dateFrom) {
      setMessage('A data final precisa ser depois da inicial.');
      return;
    }

    setBusy(true);
    const error = await onAdd({
      dateFrom,
      dateTo: dateTo || null,
      timeFrom: timeFrom || null,
      timeTo: timeTo || null,
      reason: reason.trim() || undefined
    });
    setBusy(false);

    if (error) {
      setMessage(`Não consegui bloquear: ${error}`);
      return;
    }
    setDateTo('');
    setTimeFrom('');
    setTimeTo('');
    setReason('');
    setMessage('Bloqueio criado.');
  };

  const handleImport = async () => {
    setBusy(true);
    const result = await onImportEagenda();
    setBusy(false);
    setMessage(
      result.error
        ? `Não consegui importar: ${result.error}`
        : result.imported === 0
          ? 'Nada novo para importar — os horários do eAgenda já estão bloqueados.'
          : `${result.imported} horário(s) do eAgenda bloqueados aqui.`
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-600 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" /> Bloquear Horários
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Sem horário = dia inteiro. Com data final = todos os dias do período (férias).
          </p>
        </div>
        {canEdit && (
          <button
            onClick={handleImport}
            disabled={busy}
            title="Bloqueia aqui os horários que já estão ocupados no eAgenda"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 text-xs font-semibold transition-colors"
          >
            <DownloadCloud className="w-3.5 h-3.5" /> Importar bloqueios do eAgenda
          </button>
        )}
      </div>

      {canEdit && (
        <div className="px-4 py-3 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Data inicial
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Data final <span className="normal-case font-normal">(opcional)</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Das <span className="normal-case font-normal">(opcional)</span>
            <input
              type="time"
              value={timeFrom}
              onChange={e => setTimeFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Às <span className="normal-case font-normal">(opcional)</span>
            <input
              type="time"
              value={timeTo}
              onChange={e => setTimeTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Motivo
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Férias, consulta…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </label>
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-bold transition-colors"
          >
            <Plus className="w-4 h-4" /> Bloquear
          </button>
        </div>
      )}

      {message && (
        <div className="px-4 py-2 text-xs font-semibold text-slate-600 bg-yellow-50 border-b border-yellow-100">
          {message}
        </div>
      )}

      <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
        {upcoming.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            Nenhum bloqueio ativo.
          </div>
        ) : (
          upcoming.map(block => (
            <div key={block.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700">{describeBlock(block)}</div>
                <div className="text-xs text-slate-400 truncate">
                  {block.reason ?? 'Sem motivo informado'}
                  {block.source === 'eagenda' && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">
                      eAgenda
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => onRemove(block.id)}
                  title="Remover bloqueio"
                  className="p-1.5 text-slate-300 hover:text-red-600 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
