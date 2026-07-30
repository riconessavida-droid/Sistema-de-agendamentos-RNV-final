import React from 'react';
import { Star } from 'lucide-react';
import { MONTH_NAMES } from '../constants';
import { DayKey, weekdayOf } from './timezone';

const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface BookingCalendarProps {
  availableDays: string[];
  selectedDay: string | null;
  suggestedDay?: string | null;
  onSelect: (day: DayKey) => void;
}

/** Meses que precisam aparecer, na ordem, a partir dos dias disponíveis. */
const monthsOf = (days: string[]): string[] =>
  [...new Set(days.map(day => day.slice(0, 7)))].sort();

/** Células do mês, com os buracos do começo para alinhar o dia da semana. */
const cellsOf = (monthKey: string): Array<string | null> => {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = weekdayOf(`${monthKey}-01`);

  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: lastDay }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, '0')}`)
  ];
};

export function BookingCalendar({
  availableDays,
  selectedDay,
  suggestedDay,
  onSelect
}: BookingCalendarProps) {
  const available = new Set(availableDays);
  const months = monthsOf(availableDays);

  // A data ideal só ganha estrela se ela realmente estiver livre.
  const starDay = suggestedDay && available.has(suggestedDay) ? suggestedDay : null;

  return (
    <div className="space-y-5">
      {months.map(monthKey => {
        const [year, month] = monthKey.split('-').map(Number);

        return (
          <div key={monthKey}>
            <h3 className="text-center text-sm font-black uppercase tracking-widest text-slate-500 mb-2">
              {MONTH_NAMES[month - 1]} {year}
            </h3>

            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_INITIALS.map((initial, index) => (
                <div key={index} className="text-[11px] font-bold text-slate-300 py-1">
                  {initial}
                </div>
              ))}

              {cellsOf(monthKey).map((day, index) => {
                if (!day) return <div key={`gap-${index}`} />;

                const isAvailable = available.has(day);
                const isSelected = day === selectedDay;
                const isStar = day === starDay;
                const number = Number(day.slice(8));

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => onSelect(day)}
                    className={`relative aspect-square rounded-xl text-sm font-bold transition-all ${
                      isSelected
                        ? 'bg-slate-800 text-white shadow-md scale-105'
                        : isAvailable
                          ? 'bg-yellow-50 text-slate-700 hover:bg-yellow-100 border border-yellow-200'
                          : 'text-slate-200 cursor-default'
                    }`}
                  >
                    {number}
                    {isStar && !isSelected && (
                      <Star className="w-3 h-3 absolute top-0.5 right-0.5 fill-yellow-400 text-yellow-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {starDay && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
          data ideal para manter o intervalo de 30 dias
        </p>
      )}
    </div>
  );
}
