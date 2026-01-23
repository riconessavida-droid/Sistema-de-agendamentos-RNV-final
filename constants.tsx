
import React from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  UserMinus, 
  CalendarDays 
} from 'lucide-react';
import { MeetingStatus } from './types';

export const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export const STATUS_OPTIONS = [
  { value: MeetingStatus.PENDING, label: 'Pendente', icon: <Clock className="w-4 h-4 text-slate-400" /> },
  { value: MeetingStatus.DONE, label: 'Realizada', icon: <CheckCircle2 className="w-4 h-4 text-green-500" /> },
  { value: MeetingStatus.NOT_DONE, label: 'Não Realizada', icon: <XCircle className="w-4 h-4 text-red-500" /> },
  { value: MeetingStatus.RESCHEDULED, label: 'Remarcada', icon: <CalendarDays className="w-4 h-4 text-blue-500" /> },
  { value: MeetingStatus.CLOSED_CONTRACT, label: 'Contrato Encerrado', icon: <UserMinus className="w-4 h-4 text-slate-600" /> },
];

export const GROUP_COLORS = [
  'bg-yellow-100 border-yellow-200 text-yellow-800', // Yellow
  'bg-slate-200/50 border-slate-300 text-slate-700', // Medium transparent gray
  'bg-amber-100 border-amber-200 text-amber-800',
  'bg-slate-300/40 border-slate-400 text-slate-600',
];

export const getMonthLabel = (monthYear: string) => {
  const [year, month] = monthYear.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};

export const getNextMonths = (startMonthYear: string, count: number): string[] => {
  const [year, month] = startMonthYear.split('-').map(Number);
  const result: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const d = new Date(year, month - 1 + i, 1);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    result.push(`${d.getFullYear()}-${m}`);
  }
  return result;
};

export const MEETING_LABEL_TEXTS = [
  "Primeira Reunião",
  "Segunda Reunião",
  "Terceira Reunião",
  "Quarta Reunião",
  "Quinta Reunião"
];
