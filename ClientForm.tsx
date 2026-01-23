import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { Client } from '../types';

interface ClientFormProps {
  onAdd: (client: Omit<Client, 'id' | 'statusByMonth' | 'groupColor'>) => void;
  onUpdate?: (id: string, data: Partial<Client>) => void;
  onClose: () => void;
  clientToEdit?: Client | null;
  nextSequence?: number;
}

export const ClientForm: React.FC<ClientFormProps> = ({ onAdd, onUpdate, onClose, clientToEdit, nextSequence }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [sequence, setSequence] = useState<number>(1);

  useEffect(() => {
    if (clientToEdit) {
      setName(clientToEdit.name);
      setPhone(clientToEdit.phoneDigits);
      const [year, month] = clientToEdit.startMonthYear.split('-');
      const day = clientToEdit.startDate.toString().padStart(2, '0');
      setDate(`${year}-${month}-${day}`);
      setSequence(clientToEdit.sequenceInMonth);
    } else if (nextSequence) {
      setSequence(nextSequence);
    }
  }, [clientToEdit, nextSequence]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone || !date) return;

    const [year, month, day] = date.split('-').map(Number);
    const startMonthYear = `${year}-${month.toString().padStart(2, '0')}`;
    const startDate = day;

    if (clientToEdit && onUpdate) {
      onUpdate(clientToEdit.id, {
        name,
        phoneDigits: phone,
        startMonthYear,
        startDate,
        sequenceInMonth: sequence
      });
    } else {
      onAdd({
        name,
        phoneDigits: phone.slice(-4),
        startMonthYear,
        startDate,
        sequenceInMonth: sequence
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl font-bold text-slate-800">
            {clientToEdit ? 'Editar Cliente' : 'Novo Cliente'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-1">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ordem</label>
              <input
                type="number"
                min="1"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none font-bold text-center bg-slate-50"
                value={sequence}
                onChange={e => setSequence(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do Cliente</label>
              <input
                autoFocus
                required
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone (Final)</label>
            <input
              required
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data da Primeira Reunião (Início)</label>
            <input
              required
              type="date"
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-yellow-500 outline-none"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg font-medium">Cancelar</button>
            <button type="submit" className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 font-medium">
              {clientToEdit ? 'Atualizar' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};