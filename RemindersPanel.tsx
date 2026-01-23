
import React from 'react';
import { Bell, Calendar, ChevronRight } from 'lucide-react';
import { Client, MeetingStatus } from './types';
import { getNextMonths } from './constants';

interface RemindersPanelProps {
  clients: Client[];
}

export const RemindersPanel: React.FC<RemindersPanelProps> = ({ clients }) => {
  const today = new Date();
  
  const upcomingReminders = clients.flatMap(client => {
    const months = getNextMonths(client.startMonthYear, 5);
    return months.map((m, idx) => {
      const [year, month] = m.split('-').map(Number);
      const statusObj = client.statusByMonth[m];
      const meetingDay = statusObj?.customDate || client.startDate;
      const meetingDate = new Date(year, month - 1, meetingDay);
      const diffDays = Math.ceil((meetingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays >= 0 && diffDays <= 7 && (!statusObj || statusObj.status === MeetingStatus.PENDING)) {
        return {
          id: `${client.id}-${m}`,
          clientName: client.name,
          meetingNum: idx + 1,
          daysLeft: diffDays,
          date: meetingDate.toLocaleDateString('pt-BR')
        };
      }
      return null;
    }).filter(Boolean);
  }).sort((a, b) => (a?.daysLeft || 0) - (b?.daysLeft || 0));

  if (upcomingReminders.length === 0) return null;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800">
        <Bell className="w-5 h-5 text-yellow-500" /> Próximos Lembretes
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {upcomingReminders.map(rem => (
          <div key={rem?.id} className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex justify-between items-center">
            <div>
              <p className="font-bold text-slate-900">{rem?.clientName}</p>
              <p className="text-xs text-slate-500">{rem?.meetingNum}ª Reunião • {rem?.date}</p>
            </div>
            <div className={`px-2 py-1 rounded-lg text-[10px] font-bold ${rem?.daysLeft! <= 2 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
              {rem?.daysLeft === 0 ? 'Hoje' : `Em ${rem?.daysLeft} dias`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
