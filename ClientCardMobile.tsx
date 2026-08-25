import { Pencil, Trash2, Bell, FileSignature, Download, Phone } from 'lucide-react';
import { Client, MeetingStatus } from './types';

/**
 * O cliente da Visão Geral, no celular.
 *
 * A tabela do computador tem coluna fixa de 320px e colunas de mês de
 * 240px — num iPhone de 390px a primeira sozinha come a tela inteira e o
 * resto some. Não é caso de encolher: quatro controles lado a lado não
 * cabem em 390px de jeito nenhum.
 *
 * Aqui a mesma informação vira um cartão com os meses empilhados. Nada
 * foi removido: dá para marcar realizada, não realizada, digitar o dia,
 * mudar o status e avisar, igual no computador.
 */

/**
 * As opções vêm de STATUS_OPTIONS, que carrega um ícone junto para a
 * tela do computador. Aqui só o valor e o rótulo importam — o resto é
 * aceito e ignorado, em vez de obrigar o chamador a filtrar.
 */
interface StatusOption {
  value: MeetingStatus;
  label: string;
  [extra: string]: unknown;
}

interface ClientCardMobileProps {
  /**
   * O projeto não tem @types/react instalado, então o TypeScript não
   * reconhece `key` como atributo especial de JSX e reclama dele como se
   * fosse uma prop qualquer. Declarar aqui é mais barato do que embrulhar
   * cada cartão numa div só para carregar a chave.
   */
  key?: string | number;
  client: Client;
  cycle: string[];
  inactive: boolean;
  orange: boolean;
  statusOptions: StatusOption[];
  meetingLabels: string[];
  getMonthLabel: (monthKey: string) => string;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
  onToggleContract: (client: Client) => void;
  onExtraMeetings: (id: string, delta: number) => void;
  onMeetingChange: (
    clientId: string,
    monthKey: string,
    updates: Partial<{ status: MeetingStatus; customDate?: number; notified?: boolean }>
  ) => void;
}

export function ClientCardMobile({
  client, cycle, inactive, orange, statusOptions, meetingLabels,
  getMonthLabel, onEdit, onDelete, onToggleContract, onExtraMeetings, onMeetingChange
}: ClientCardMobileProps) {
  const tomCabecalho = orange
    ? 'bg-orange-500 text-white'
    : inactive
      ? 'bg-slate-200 text-slate-500'
      : client.groupColor;

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">

      {/* ------------------------------------------------ identificação */}
      <div className={`px-4 py-3 ${tomCabecalho}`}>
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
              orange ? 'bg-white/20 text-white' : 'bg-slate-800 text-white'
            }`}
          >
            {client.sequenceInMonth}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-black text-sm uppercase truncate leading-tight">{client.name}</p>

            {client.phoneDigits && (
              <a
                href={`https://wa.me/55${client.phoneDigits.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold opacity-80"
              >
                <Phone className="w-3 h-3" />
                {client.phoneDigits}
              </a>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onToggleContract(client)}
                className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase inline-flex items-center gap-1 ${
                  client.contractSigned
                    ? orange ? 'bg-white/30 text-white' : 'bg-green-100 text-green-700 border border-green-300'
                    : orange ? 'bg-white/10 text-white/70 border border-white/30' : 'bg-yellow-50 text-yellow-700 border border-yellow-300'
                }`}
              >
                <FileSignature className="w-2.5 h-2.5" />
                {client.contractSigned ? 'Assinado' : 'Pendente'}
              </button>

              {client.contractPdfUrl && (
                <a
                  href={client.contractPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase inline-flex items-center gap-1 ${
                    orange ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-600 border border-slate-300'
                  }`}
                >
                  <Download className="w-2.5 h-2.5" />
                  PDF
                </a>
              )}
            </div>

            {client.contractIssue && (
              <p className={`text-[9px] font-black mt-1 leading-tight ${orange ? 'text-white' : 'text-red-600'}`}>
                ⚠ {client.contractIssue}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 items-center flex-shrink-0">
            <button onClick={() => onEdit(client)} className="p-1" title="Editar">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => onDelete(client.id)} className="p-1" title="Excluir">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- meses */}
      <div className="divide-y divide-slate-100">
        {cycle.map((monthKey, idx) => {
          const s = client.statusByMonth[monthKey];
          const isClosed = s?.status === MeetingStatus.CLOSED_CONTRACT;
          const label = meetingLabels[idx] ?? `${idx + 1}ª Reunião`;

          return (
            <div key={monthKey} className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">
                  {label} · {getMonthLabel(monthKey)}
                </span>
                <span className="text-[9px] font-black bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded">
                  Dia {client.startDate}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Não realizada */}
                <button
                  onClick={() =>
                    onMeetingChange(client.id, monthKey, {
                      status: s?.status === MeetingStatus.NOT_DONE ? MeetingStatus.PENDING : MeetingStatus.NOT_DONE
                    })
                  }
                  className={`w-8 h-8 rounded-full border-2 flex-shrink-0 transition-all ${
                    s?.status === MeetingStatus.NOT_DONE
                      ? 'bg-red-500 border-red-600 scale-105'
                      : 'bg-white border-slate-200'
                  }`}
                  title="Não realizada"
                />

                <div className="flex-1 bg-slate-50 rounded-lg border px-2 py-1.5">
                  <span className="text-[8px] font-black text-slate-400 block text-center leading-none mb-0.5">
                    REALIZADO DIA
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={s?.customDate || ''}
                    onChange={e =>
                      onMeetingChange(client.id, monthKey, {
                        customDate: parseInt(e.target.value) || undefined
                      })
                    }
                    className="w-full bg-transparent text-center font-black text-base outline-none"
                    placeholder="--"
                  />
                </div>

                {/* Realizada */}
                <button
                  onClick={() =>
                    onMeetingChange(client.id, monthKey, {
                      status: s?.status === MeetingStatus.DONE ? MeetingStatus.PENDING : MeetingStatus.DONE
                    })
                  }
                  className={`w-8 h-8 rounded-full border-2 flex-shrink-0 transition-all ${
                    s?.status === MeetingStatus.DONE
                      ? 'bg-green-500 border-green-600 scale-105'
                      : 'bg-white border-slate-200'
                  }`}
                  title="Realizada"
                />
              </div>

              <div className="mt-2 flex gap-2">
                <select
                  value={s?.status || MeetingStatus.PENDING}
                  onChange={e =>
                    onMeetingChange(client.id, monthKey, { status: e.target.value as MeetingStatus })
                  }
                  className={`flex-1 text-[11px] font-bold border rounded-lg px-2 py-2 outline-none ${
                    s?.status === MeetingStatus.RESCHEDULED
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : isClosed
                        ? 'bg-slate-100 text-slate-500 border-slate-300'
                        : 'bg-white'
                  }`}
                >
                  {statusOptions.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                <button
                  onClick={() => onMeetingChange(client.id, monthKey, { notified: !s?.notified })}
                  className={`px-3 rounded-lg text-[10px] font-black flex items-center gap-1 transition-all ${
                    s?.notified
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-50 text-slate-400 border border-slate-200'
                  }`}
                >
                  <Bell className="w-3.5 h-3.5" />
                  {s?.notified ? '✓' : 'Avisar'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------------------------------------- reunião extra */}
      <div className="px-4 py-2.5 bg-slate-50 border-t flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400 uppercase">
          {(client.extraMeetings ?? 0) > 0
            ? `${client.extraMeetings} reunião extra${(client.extraMeetings ?? 0) > 1 ? 's' : ''}`
            : 'Reuniões extras'}
        </span>
        <div className="flex items-center gap-2">
          {(client.extraMeetings ?? 0) > 0 && (
            <button
              onClick={() => onExtraMeetings(client.id, -1)}
              className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 font-black text-sm"
            >
              −
            </button>
          )}
          <button
            onClick={() => onExtraMeetings(client.id, 1)}
            className="w-7 h-7 rounded-full bg-slate-700 text-white font-black text-sm"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
