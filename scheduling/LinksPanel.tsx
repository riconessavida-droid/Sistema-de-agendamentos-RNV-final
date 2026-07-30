import React, { useMemo, useState } from 'react';
import { Check, Copy, Link2, Search, Zap } from 'lucide-react';
import { Client } from '../types';
import { createFitInLink, ensureBookingLink } from './db';
import { toDayKey } from './timezone';

interface LinksPanelProps {
  clients: Client[];
  now: Date;
}

const publicUrl = (path: string) => `${window.location.origin}${path}`;

export function LinksPanel({ clients, now }: LinksPanelProps) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [fitInFor, setFitInFor] = useState<string | null>(null);
  const [fitInDay, setFitInDay] = useState(toDayKey(now));
  const [fitInTime, setFitInTime] = useState('07:00');

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return clients
      .filter(client => client.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [clients, search]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(current => (current === key ? null : current)), 2000);
    } catch {
      setMessage('Não consegui copiar. Selecione o endereço e copie na mão.');
    }
  };

  const copyPersonalLink = async (client: Client) => {
    setBusy(client.id);
    setMessage(null);
    const { token, error } = await ensureBookingLink(client.id);
    setBusy(null);
    if (error || !token) {
      setMessage(`Não consegui gerar o link: ${error ?? 'erro desconhecido'}`);
      return;
    }
    await copy(publicUrl(`/agendar/${token}`), client.id);
  };

  const createFitIn = async (client: Client) => {
    setBusy(client.id);
    setMessage(null);
    const { token, error } = await createFitInLink(client.id, fitInDay, fitInTime);
    setBusy(null);
    if (error || !token) {
      setMessage(`Não consegui gerar o encaixe: ${error ?? 'erro desconhecido'}`);
      return;
    }
    setFitInFor(null);
    await copy(publicUrl(`/agendar/${token}`), `fit-${client.id}`);
    setMessage(`Encaixe criado para ${fitInDay.slice(8)}/${fitInDay.slice(5, 7)} às ${fitInTime}. Link copiado.`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-600 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-slate-400" /> Link geral
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Para quem <strong>ainda não é cliente</strong>. Pede nome, WhatsApp e e-mail —
            e cai na Conciliação depois.
          </p>
        </div>
        <div className="px-4 py-3 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
            {publicUrl('/agendar')}
          </code>
          <button
            onClick={() => copy(publicUrl('/agendar'), 'general')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors shrink-0"
          >
            {copied === 'general' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === 'general' ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-600 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-yellow-500" /> Link pessoal do cliente
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Já sabe quem é: não pede nada, mostra a data ideal e cai direto no cliente
            certo. É este que vai nos lembretes.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar cliente pelo nome…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </div>
        </div>

        {message && (
          <div className="px-4 py-2 text-xs font-semibold text-slate-600 bg-yellow-50 border-b border-yellow-100">
            {message}
          </div>
        )}

        <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {search.trim() === '' ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              Digite o nome do cliente para gerar o link dele.
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              Nenhum cliente com esse nome.
            </div>
          ) : (
            results.map(client => (
              <div key={client.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">{client.name}</div>
                    {!client.contractSigned && (
                      <span className="text-[10px] font-black uppercase tracking-wider text-yellow-700">
                        contrato pendente
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setFitInFor(fitInFor === client.id ? null : client.id)}
                      title="Criar um horário fora da grade só para este cliente"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" /> Encaixe
                    </button>
                    <button
                      onClick={() => copyPersonalLink(client)}
                      disabled={busy === client.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                    >
                      {copied === client.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied === client.id ? 'Copiado' : 'Copiar link'}
                    </button>
                  </div>
                </div>

                {fitInFor === client.id && (
                  <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-end gap-2 flex-wrap">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Dia
                      <input
                        type="date"
                        value={fitInDay}
                        onChange={e => setFitInDay(e.target.value)}
                        className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                    </label>
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Horário
                      <input
                        type="time"
                        value={fitInTime}
                        onChange={e => setFitInTime(e.target.value)}
                        className="mt-1 block rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                      />
                    </label>
                    <button
                      onClick={() => createFitIn(client)}
                      disabled={busy === client.id}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                    >
                      Gerar link de encaixe
                    </button>
                    <p className="w-full text-[11px] text-slate-400">
                      Vale só para este horário e some depois de usado.
                    </p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
