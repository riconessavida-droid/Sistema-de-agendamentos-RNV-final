import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  Search,
  Users,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Trash2,
  Pencil,
  Filter,
  X,
  LogOut,
  LayoutDashboard,
  ClipboardCheck,
  Clock,
  ChevronLeft,
  AlertCircle,
  CalendarClock,
  UserPlus,
  BarChart3,
  Trophy,
  UserMinus,
  CheckSquare,
  Download,
  UserCog
} from 'lucide-react';
import { Client, MeetingStatus, User, UserRole } from './types';
import {
  STATUS_OPTIONS,
  GROUP_COLORS,
  getNextMonths,
  getMonthLabel,
  MEETING_LABEL_TEXTS
} from './constants';
import { ClientForm } from './ClientForm';
import { RemindersPanel } from './RemindersPanel';
import { Auth } from './Auth';
import { supabase } from './supabaseClient';

const SESSION_KEY = 'rnv_current_session';

type TabType = 'overview' | 'checklist' | 'reports' | 'users';
type ChecklistSubFilter = 'all' | 'pending' | 'not_done' | 'rescheduled';
type StatusFilter = 'all' | 'active' | 'finalized' | 'needs_attention';

type DbClientRow = {
  id: string;
  name: string;
  phone_digits: string;
  start_month_year: string;
  start_date: number;
  sequence_in_month: number;
  group_color: string;
  status_by_month: Record<string, { status: MeetingStatus; customDate?: number }>;
};

const dbToClient = (row: DbClientRow): Client => ({
  id: row.id,
  name: row.name,
  phoneDigits: row.phone_digits,
  startMonthYear: row.start_month_year,
  startDate: row.start_date,
  sequenceInMonth: row.sequence_in_month,
  groupColor: row.group_color,
  statusByMonth: row.status_by_month || {}
});

const clientToDb = (client: Client) => ({
  id: client.id,
  name: client.name,
  phone_digits: client.phoneDigits,
  start_month_year: client.startMonthYear,
  start_date: client.startDate,
  sequence_in_month: client.sequenceInMonth,
  group_color: client.groupColor,
  status_by_month: client.statusByMonth || {}
});

const toMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (base: Date, delta: number) => new Date(base.getFullYear(), base.getMonth() + delta, 1);

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');

  const [checklistMonth, setChecklistMonth] = useState<string>(() => toMonthKey(new Date()));
  const [checklistSubFilter, setChecklistSubFilter] = useState<ChecklistSubFilter>('all');

  // Mantém os meses desde Jan/2025
  const [visibleMonths, setVisibleMonths] = useState<string[]>(() => {
    const months: string[] = [];
    let current = new Date(2025, 0, 1);
    const end = addMonths(new Date(), 12);
    while (current <= end) {
      months.push(toMonthKey(current));
      current = addMonths(current, 1);
    }
    return months;
  });

  const monthsScrollRef = useRef<HTMLDivElement | null>(null);

  // ✅ CORREÇÃO: Scroll automático para o mês atual
  useEffect(() => {
    if (activeTab !== 'overview' || loadingClients) return;
    
    const scrollToCurrent = () => {
      const container = monthsScrollRef.current;
      if (!container) return;

      const nowKey = toMonthKey(new Date());
      const idx = visibleMonths.indexOf(nowKey);
      if (idx === -1) return;

      const monthColWidth = 240;
      const targetLeft = idx * monthColWidth - (container.clientWidth / 2 - monthColWidth / 2);
      container.scrollLeft = Math.max(0, targetLeft);
    };

    const timer = setTimeout(scrollToCurrent, 400);
    return () => clearTimeout(timer);
  }, [activeTab, visibleMonths, loadingClients]);

  useEffect(() => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) setCurrentUser(JSON.parse(session));
  }, []);

  useEffect(() => {
    const loadClients = async () => {
      if (!currentUser) return;
      setLoadingClients(true);
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('start_month_year', { ascending: true })
        .order('sequence_in_month', { ascending: true });

      if (!error && data) setClients(data.map(dbToClient));
      setLoadingClients(false);
    };
    loadClients();
  }, [currentUser]);

  useEffect(() => {
    const loadUsers = async () => {
      if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
      setLoadingUsers(true);
      const { data, error } = await supabase.from('profiles').select('*').order('name', { ascending: true });
      if (!error && data) setUsers(data as User[]);
      setLoadingUsers(false);
    };
    loadUsers();
  }, [currentUser]);
    const handleLogin = (user: User) => {
    const sessionUser = { ...user };
    delete (sessionUser as any).password;
    setCurrentUser(sessionUser);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    localStorage.removeItem(SESSION_KEY);
    setClients([]);
    setActiveTab('overview');
  };

  const isClientInactive = (client: Client) => {
    return Object.values(client.statusByMonth).some(s => s.status === MeetingStatus.CLOSED_CONTRACT);
  };

  const isOrangeClient = (client: Client) => {
    if (isClientInactive(client)) return false;
    const cycleMonths = getNextMonths(client.startMonthYear, 5);
    return toMonthKey(new Date()) >= cycleMonths[3];
  };

  const updateMeetingData = async (clientId: string, monthYear: string, updates: any) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const newStatusByMonth = {
      ...client.statusByMonth,
      [monthYear]: { ...(client.statusByMonth[monthYear] || {}), ...updates }
    };
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, statusByMonth: newStatusByMonth } : c));
    await supabase.from('clients').update({ status_by_month: newStatusByMonth }).eq('id', clientId);
  };

  const updateClientSequence = async (id: string, seq: number) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, sequenceInMonth: seq } : c));
    await supabase.from('clients').update({ sequence_in_month: seq }).eq('id', id);
  };

  const deleteClient = async (id: string) => {
    if (!window.confirm('Excluir permanentemente?')) return;
    setClients(prev => prev.filter(c => c.id !== id));
    await supabase.from('clients').delete().eq('id', id);
  };

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phoneDigits.includes(searchTerm);
      const matchesMonth = filterMonth === 'all' || c.startMonthYear === filterMonth;
      const inactive = isClientInactive(c);
      if (statusFilter === 'active') return matchesSearch && matchesMonth && !inactive;
      if (statusFilter === 'finalized') return matchesSearch && matchesMonth && inactive;
      if (statusFilter === 'needs_attention') return matchesSearch && matchesMonth && isOrangeClient(c);
      return matchesSearch && matchesMonth;
    }).sort((a, b) => a.startMonthYear.localeCompare(b.startMonthYear) || a.sequenceInMonth - b.sequenceInMonth);
  }, [clients, searchTerm, filterMonth, statusFilter]);

  const checklistData = useMemo(() => {
    const activeThisMonth = clients.filter(c => !isClientInactive(c)).reduce((acc: any[], client) => {
      const cycle = getNextMonths(client.startMonthYear, 5);
      const idx = cycle.indexOf(checklistMonth);
      if (idx !== -1) {
        const s = client.statusByMonth[checklistMonth];
        acc.push({ client, meetingLabel: MEETING_LABEL_TEXTS[idx], status: s?.status || MeetingStatus.PENDING, doneDate: s?.customDate || client.startDate });
      }
      return acc;
    }, []);

    return {
      pending: activeThisMonth.filter(i => i.status !== MeetingStatus.DONE && i.status !== MeetingStatus.CLOSED_CONTRACT && (checklistSubFilter === 'all' || i.status === checklistSubFilter)),
      completed: activeThisMonth.filter(i => i.status === MeetingStatus.DONE || i.status === MeetingStatus.CLOSED_CONTRACT)
    };
  }, [clients, checklistMonth, checklistSubFilter]);

  // ✅ CORREÇÃO: Gráfico baseado em contratos FECHADOS no mês
  const reportData = useMemo(() => {
    const months = getNextMonths(toMonthKey(new Date()), 12);
    const map: Record<string, number> = {};
    clients.forEach(client => {
      Object.entries(client.statusByMonth).forEach(([mKey, data]) => {
        if (data.status === MeetingStatus.CLOSED_CONTRACT) {
          map[mKey] = (map[mKey] || 0) + 1;
        }
      });
    });
    return months.map(m => ({ label: getMonthLabel(m), count: map[m] || 0 }));
  }, [clients]);

  const stats = useMemo(() => ({
    totalAtivos: clients.filter(c => !isClientInactive(c)).length,
    totalFinalizados: clients.filter(c => isClientInactive(c)).length,
    totalAtencao: clients.filter(c => isOrangeClient(c)).length,
    entradas: clients.filter(c => c.startMonthYear === toMonthKey(new Date())).length
  }), [clients]);

  if (!currentUser) return <Auth onLogin={handleLogin} />;
    return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b sticky top-0 z-50 shadow-sm px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-yellow-500 p-2 rounded-lg"><TrendingUp className="text-white w-6 h-6" /></div>
          <h1 className="text-xl font-bold text-slate-800">RNV Consultoria</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input placeholder="Pesquisar..." className="pl-9 pr-4 py-2 bg-slate-100 rounded-full text-sm outline-none w-64 focus:bg-white border focus:border-yellow-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
          <button onClick={() => { setEditingClient(null); setIsFormOpen(true); }} className="bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-yellow-600 flex items-center gap-2"><Plus className="w-5 h-5" /> Novo Cliente</button>
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-600"><LogOut className="w-5 h-5" /></button>
        </div>
      </nav>

      <div className="bg-white border-b px-4 flex gap-8">
        {['overview', 'checklist', 'reports', 'users'].map((t: any) => (
          (t !== 'reports' && t !== 'users' || currentUser.role === UserRole.ADMIN) && (
            <button key={t} onClick={() => setActiveTab(t)} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === t ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>
              {t === 'overview' ? 'Visão Geral' : t === 'checklist' ? 'Checklist' : t === 'reports' ? 'Relatórios' : 'Usuários'}
            </button>
          )
        ))}
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto px-4 py-8 space-y-6 w-full">
        {activeTab === 'overview' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border shadow-sm flex items-center gap-4">
                <div className="bg-green-50 p-3 rounded-xl text-green-600"><Users /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Ativos</p><p className="text-2xl font-black text-slate-800">{stats.totalAtivos}</p></div>
              </div>
              <div className="bg-white p-5 rounded-2xl border shadow-sm flex items-center gap-4">
                <div className="bg-orange-50 p-3 rounded-xl text-orange-600"><AlertCircle /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Atenção</p><p className="text-2xl font-black text-slate-800">{stats.totalAtencao}</p></div>
              </div>
            </div>

            <RemindersPanel clients={clients.filter(c => !isClientInactive(c))} />

            <div className="bg-white border rounded-2xl shadow-xl overflow-hidden">
              <div className="max-h-[70vh] overflow-auto relative" ref={monthsScrollRef}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b sticky top-0 z-30">
                      <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase sticky left-0 bg-slate-50 z-40 w-80 shadow-md">Identificação</th>
                      {visibleMonths.map(m => (
                        <th key={m} className="px-4 py-4 text-center text-[10px] font-black text-slate-400 uppercase border-l min-w-[240px]">{getMonthLabel(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredClients.map(client => (
                      <tr key={client.id} className="hover:bg-slate-50 transition-colors">
                        <td className={`px-4 py-4 sticky left-0 z-20 w-80 border-r shadow-sm ${isOrangeClient(client) ? 'bg-orange-500 text-white' : isClientInactive(client) ? 'bg-slate-200 text-slate-500' : 'bg-white'}`}>
                          <div className="flex items-center gap-3">
                            <input type="number" value={client.sequenceInMonth} onChange={e => updateClientSequence(client.id, parseInt(e.target.value) || 1)} className="w-10 h-10 rounded-lg text-center font-black bg-slate-800 text-white outline-none" />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold truncate text-sm uppercase">{client.name}</p>
                              <p className="text-[10px] font-black opacity-70">TEL: {client.phoneDigits}</p>
                            </div>
                            <div className="flex flex-col gap-1">
                              <button onClick={() => { setEditingClient(client); setIsFormOpen(true); }} className="p-1 hover:scale-110"><Pencil className="w-4 h-4 text-slate-400" /></button>
                              <button onClick={() => deleteClient(client.id)} className="p-1 hover:scale-110"><Trash2 className="w-4 h-4 text-slate-400" /></button>
                            </div>
                          </div>
                        </td>
                        {visibleMonths.map(m => {
                          const cycle = getNextMonths(client.startMonthYear, 5);
                          const isMeetingMonth = cycle.indexOf(m) !== -1;
                          const s = client.statusByMonth[m];
                          return (
                            <td key={m} className={`px-4 py-4 border-l text-center ${isMeetingMonth ? 'bg-white' : 'bg-slate-50/30 opacity-30'}`}>
                              {isMeetingMonth && (
                                <div className="space-y-2">
                                  <p className="text-[9px] font-black text-slate-400 uppercase">{MEETING_LABEL_TEXTS[cycle.indexOf(m)]}</p>
                                  <select value={s?.status || MeetingStatus.PENDING} onChange={e => updateMeetingData(client.id, m, { status: e.target.value })} className="text-[10px] font-bold border rounded p-1 w-full outline-none">
                                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'reports' && (
          <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-8">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Trophy className="text-yellow-500 w-7 h-7" /> Clientes Fechados por Mês</h2>
            <div className="flex items-end gap-4 h-64 border-b pb-2">
              {reportData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="text-[10px] font-black opacity-0 group-hover:opacity-100 transition-opacity">{d.count}</div>
                  <div style={{ height: `${(d.count / (Math.max(...reportData.map(x => x.count)) || 1)) * 100}%` }} className="w-full max-w-[40px] bg-yellow-500 rounded-t-lg shadow-lg shadow-yellow-500/20" />
                  <p className="text-[8px] font-black text-slate-400 uppercase rotate-45 mt-4 origin-left whitespace-nowrap">{d.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {isFormOpen && (
        <ClientForm 
          onAdd={async (data) => {
            const newClient = { ...data, id: crypto.randomUUID(), statusByMonth: {}, groupColor: GROUP_COLORS[0] };
            setClients([...clients, newClient]);
            await supabase.from('clients').insert(clientToDb(newClient));
            setIsFormOpen(false);
          }}
          onUpdate={async (id, data) => {
            setClients(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
            await supabase.from('clients').update(clientToDb(clients.find(c => c.id === id)!)).eq('id', id);
            setIsFormOpen(false);
          }}
          onClose={() => setIsFormOpen(false)}
          clientToEdit={editingClient}
        />
      )}
    </div>
  );
};

export default App;
