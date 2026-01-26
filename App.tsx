import React, { useState, useEffect, useMemo } from 'react';
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

// Utilitários para datas
const toMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addMonths = (base: Date, delta: number) => new Date(base.getFullYear(), base.getMonth() + delta, 1);

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

  const [checklistMonth, setChecklistMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  });
  const [checklistSubFilter, setChecklistSubFilter] = useState<ChecklistSubFilter>('all');

  const [visibleMonths, setVisibleMonths] = useState<string[]>(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = -12; i <= 12; i++) {
      months.push(toMonthKey(addMonths(now, i)));
    }
    return months;
  });

  useEffect(() => {
    if (activeTab !== 'overview') return;
    
    const nowKey = toMonthKey(new Date());
    const container = document.getElementById('months-scroll-container');
    if (!container) return;

    const t = window.setTimeout(() => {
      const th = container.querySelector(`[data-month="${nowKey}"]`) as HTMLElement | null;
      if (th) {
        const left = th.offsetLeft - (container.clientWidth / 2) + (th.clientWidth / 2);
        container.scrollLeft = left;
      }
    }, 100);

    return () => window.clearTimeout(t);
  }, [activeTab, visibleMonths]);

  useEffect(() => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      setCurrentUser(JSON.parse(session));
    }
  }, []);

  useEffect(() => {
    const loadClients = async () => {
      if (!currentUser) return;
      setLoadingClients(true);
      const { data, error } = await supabase.from('clients').select('*').order('start_month_year').order('sequence_in_month');
      if (!error) setClients((data as DbClientRow[]).map(dbToClient));
      setLoadingClients(false);
    };
    loadClients();
  }, [currentUser]);

  useEffect(() => {
    const loadUsers = async () => {
      if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
      setLoadingUsers(true);
      const { data, error } = await supabase.from('profiles').select('id,name,email,role,active').order('name');
      if (!error) setUsers(data as User[]);
      setLoadingUsers(false);
    };
    loadUsers();
  }, [currentUser]);

  const handleLogin = (user: User) => {
    const sessionUser = { ...user };
    delete sessionUser.password;
    setCurrentUser(sessionUser);
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const exportClientsToCSV = () => {
    if (clients.length === 0) return alert('Nenhum cliente para exportar.');
    const headers = ['ID', 'Nome', 'Telefone', 'Mês Início', 'Dia Início', 'Sequência', 'Cor', 'Status'];
    const rows = clients.map(c => [c.id, `"${c.name}"`, c.phoneDigits, c.startMonthYear, c.startDate, c.sequenceInMonth, c.groupColor, JSON.stringify(c.statusByMonth)]);
    // ✅ CORREÇÃO: Colchete ']' adicionado antes do .join('\n')
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `rnv_clientes_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateUser = async (userId: string, updates: Partial<{ role: UserRole; active: boolean }>) => {
    const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
    if (error) return alert(`Erro: ${error.message}`);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
  };

  const isClientInactive = (client: Client) => Object.values(client.statusByMonth).some(s => s.status === MeetingStatus.CLOSED_CONTRACT);

  // ✅ CORREÇÃO: Lógica para marcar de laranja
  const needsAttention = (client: Client) => {
    if (isClientInactive(client)) return false;

    const now = new Date();
    const clientCycleMonths = getNextMonths(client.startMonthYear, 5);

    for (const monthYear of clientCycleMonths) {
      const statusData = client.statusByMonth[monthYear];
      const isDone = statusData?.status === MeetingStatus.DONE || statusData?.status === MeetingStatus.CLOSED_CONTRACT;

      if (!isDone) {
        const [year, month] = monthYear.split('-').map(Number);
        const meetingDate = new Date(year, month - 1, client.startDate);
        const fourMonthsLater = addMonths(meetingDate, 4);
        
        if (now >= fourMonthsLater) {
          return true;
        }
      }
    }
    return false;
  };

  const getNextSequenceForMonth = (monthYear: string) => {
    const monthClients = clients.filter(c => c.startMonthYear === monthYear);
    return monthClients.length > 0 ? Math.max(...monthClients.map(c => c.sequenceInMonth || 0)) + 1 : 1;
  };

  const addClient = async (data: Omit<Client, 'id' | 'statusByMonth' | 'groupColor'>) => {
    const newClient: Client = { ...data, id: crypto.randomUUID(), statusByMonth: {}, groupColor: GROUP_COLORS[clients.length % GROUP_COLORS.length] };
    setClients(prev => [...prev, newClient]);
    await supabase.from('clients').insert(clientToDb(newClient));
  };

  const updateClient = async (id: string, data: Partial<Client>) => {
    const updatedLocal = clients.map(c => (c.id === id ? { ...c, ...data } : c));
    setClients(updatedLocal);
    setEditingClient(null);
    await supabase.from('clients').update(clientToDb(updatedLocal.find(c => c.id === id)!)).eq('id', id);
  };

  const deleteClient = async (id: string) => {
    if (!window.confirm('Excluir cliente?')) return;
    setClients(prev => prev.filter(c => c.id !== id));
    await supabase.from('clients').delete().eq('id', id);
  };

  const updateMeetingData = async (clientId: string, monthYear: string, updates: Partial<{ status: MeetingStatus; customDate: number }>) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    const currentData = client.statusByMonth[monthYear] || { status: MeetingStatus.PENDING };
    const newStatus = { ...client.statusByMonth, [monthYear]: { ...currentData, ...updates } };
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, statusByMonth: newStatus } : c));
    await supabase.from('clients').update({ status_by_month: newStatus }).eq('id', clientId);
  };

  const addMoreMonth = () => {
    const last = visibleMonths[visibleMonths.length - 1];
    setVisibleMonths(prev => [...prev, getNextMonths(last, 2)[1]]);
  };

  const availableMonths = useMemo(() => Array.from(new Set(clients.map(c => c.startMonthYear))).sort(), [clients]);

  const filteredClients = useMemo(() => {
    return clients
      .filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phoneDigits.includes(searchTerm);
        const matchesMonth = filterMonth === 'all' || c.startMonthYear === filterMonth;
        const inactive = isClientInactive(c);
        const attention = needsAttention(c);
        let matchesStatus = true;
        if (statusFilter === 'active') matchesStatus = !inactive;
        else if (statusFilter === 'finalized') matchesStatus = inactive;
        else if (statusFilter === 'needs_attention') matchesStatus = attention && !inactive;
        return matchesSearch && matchesMonth && matchesStatus;
      })
      .sort((a, b) => a.startMonthYear.localeCompare(b.startMonthYear) || (a.sequenceInMonth - b.sequenceInMonth));
  }, [clients, searchTerm, filterMonth, statusFilter]);

  const stats = useMemo(() => ({
    totalAtivos: clients.filter(c => !isClientInactive(c)).length,
    totalFinalizados: clients.filter(c => isClientInactive(c)).length,
    totalAtencao: clients.filter(c => needsAttention(c) && !isClientInactive(c)).length,
    entradasNoMes: clients.filter(c => c.startMonthYear === (filterMonth === 'all' ? toMonthKey(new Date()) : filterMonth)).length,
    labelEntradas: getMonthLabel(filterMonth === 'all' ? toMonthKey(new Date()) : filterMonth)
  }), [clients, filterMonth]);
  
  if (!currentUser) return <Auth onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500 p-2 rounded-lg"><TrendingUp className="text-white w-6 h-6" /></div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-700 to-amber-600">RNV Consultoria</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Pesquisar..." className="pl-9 pr-4 py-2 bg-slate-100 rounded-full text-sm outline-none w-64 focus:bg-white" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="flex items-center gap-4 border-l pl-6">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">{currentUser.role === UserRole.ADMIN ? 'Administrador' : 'Assistente'}</p>
              </div>
              <button onClick={handleLogout} className="p-2.5 bg-slate-100 text-slate-500 hover:text-red-600 rounded-xl"><LogOut className="w-5 h-5" /></button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportClientsToCSV} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg font-bold"><Download className="w-5 h-5" /> <span className="hidden sm:inline">Exportar</span></button>
              <button onClick={() => { setEditingClient(null); setIsFormOpen(true); }} className="flex items-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold"><Plus className="w-5 h-5" /> <span className="hidden sm:inline">Novo Cliente</span></button>
            </div>
          </div>
        </div>
      </nav>

      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-4 flex gap-8">
          <button onClick={() => setActiveTab('overview')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 ${activeTab === 'overview' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Visão Geral</button>
          <button onClick={() => setActiveTab('checklist')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 ${activeTab === 'checklist' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Checklist</button>
          {currentUser.role === UserRole.ADMIN && (
            <>
              <button onClick={() => setActiveTab('reports')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 ${activeTab === 'reports' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Relatórios</button>
              <button onClick={() => setActiveTab('users')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 ${activeTab === 'users' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Usuários</button>
            </>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto px-4 py-8 space-y-6 w-full">
        {activeTab === 'overview' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm"><div className="bg-green-50 p-3 rounded-xl text-green-600"><Users /></div><div><p className="text-[10px] font-black text-slate-400 uppercase">Ativos</p><p className="text-2xl font-black">{stats.totalAtivos}</p></div></div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm"><div className="bg-slate-50 p-3 rounded-xl text-slate-600"><CheckSquare /></div><div><p className="text-[10px] font-black text-slate-400 uppercase">Finalizados</p><p className="text-2xl font-black">{stats.totalFinalizados}</p></div></div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm"><div className="bg-blue-50 p-3 rounded-xl text-blue-600"><UserPlus /></div><div><p className="text-[10px] font-black text-slate-400 uppercase">{stats.labelEntradas}</p><p className="text-2xl font-black">{stats.entradasNoMes}</p></div></div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm"><div className="bg-orange-50 p-3 rounded-xl text-orange-600"><AlertCircle /></div><div><p className="text-[10px] font-black text-slate-400 uppercase">Atenção</p><p className="text-2xl font-black">{stats.totalAtencao}</p></div></div>
            </div>

            <div className="bg-white p-4 rounded-xl border shadow-sm space-y-6">
              <div className="space-y-4">
                <h3 className="text-xs font-black text-slate-500 uppercase">Filtro de Status</h3>
                <div className="flex gap-2">
                  <button onClick={() => setStatusFilter('all')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase border ${statusFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-50'}`}>Todos</button>
                  <button onClick={() => setStatusFilter('active')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase border ${statusFilter === 'active' ? 'bg-green-600 text-white' : 'bg-slate-50'}`}>Ativos</button>
                  <button onClick={() => setStatusFilter('finalized')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase border ${statusFilter === 'finalized' ? 'bg-blue-600 text-white' : 'bg-slate-50'}`}>Finalizados</button>
                  <button onClick={() => setStatusFilter('needs_attention')} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase border ${statusFilter === 'needs_attention' ? 'bg-orange-600 text-white' : 'bg-slate-50'}`}>Atenção</button>
                </div>
              </div>
            </div>

            <div className="bg-white border rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
                <h2 className="font-bold text-slate-800 uppercase text-xs">Planilha Operacional</h2>
                <button onClick={addMoreMonth} className="text-[10px] font-black text-yellow-600 uppercase bg-yellow-50 px-3 py-1.5 rounded-lg">Ver Mais Meses</button>
              </div>

              <div className="max-h-[70vh] overflow-auto relative" id="months-scroll-container">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b sticky top-0 z-30">
                      <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase sticky left-0 bg-slate-50 z-40 w-80 shadow-md">Identificação</th>
                      {visibleMonths.map(m => (
                        <th key={m} data-month={m} className="px-4 py-4 text-center text-[10px] font-black text-slate-400 uppercase border-l w-64 min-w-[240px] sticky top-0 bg-slate-50 z-30">{getMonthLabel(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredClients.map(client => {
                      const cycle = getNextMonths(client.startMonthYear, 5);
                      const inactive = isClientInactive(client);
                      const attention = needsAttention(client);
                      return (
                        <tr key={client.id} className={inactive ? 'bg-slate-50/50' : ''}>
                          <td className={`px-4 py-4 sticky left-0 z-20 w-80 border-r shadow-sm ${attention && !inactive ? 'bg-orange-500 text-white' : inactive ? 'bg-slate-200' : client.groupColor}`}>
                            <div className="flex items-start gap-3">
                              <input type="number" value={client.sequenceInMonth} onChange={e => updateClientSequence(client.id, parseInt(e.target.value) || 1)} className="w-10 h-10 rounded-xl bg-slate-800 text-white text-center font-black" />
                              <div className="flex-1 min-w-0">
                                <p className={`font-bold truncate text-sm uppercase ${inactive ? 'line-through' : ''}`}>{client.name}</p>
                                <p className="text-[10px] font-black opacity-60">TEL: {client.phoneDigits}</p>
                                {attention && !inactive && <p className="text-[8px] font-black bg-white/20 px-2 py-0.5 rounded-full uppercase mt-1">PRECISA ATENÇÃO</p>}
                              </div>
                              <div className="flex flex-col gap-1">
                                <button onClick={() => { setEditingClient(client); setIsFormOpen(true); }} className="p-1 hover:text-yellow-600"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => deleteClient(client.id)} className="p-1 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                          </td>
                          {visibleMonths.map(m => {
                            const cycleIdx = cycle.indexOf(m);
                            const statusData = client.statusByMonth[m];
                            return (
                              <td key={m} className={`px-4 py-4 border-l text-center ${cycleIdx !== -1 ? 'bg-white' : 'bg-slate-50 opacity-30'}`}>
                                {cycleIdx !== -1 && (
                                  <div className="flex flex-col gap-2">
                                    <div className="flex justify-between text-[9px] font-black text-slate-400"><span>{MEETING_LABEL_TEXTS[cycleIdx]}</span><span className="bg-yellow-50 px-1 rounded">Dia {client.startDate}</span></div>
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => updateMeetingData(client.id, m, { status: statusData?.status === MeetingStatus.NOT_DONE ? MeetingStatus.PENDING : MeetingStatus.NOT_DONE })} className={`w-5 h-5 rounded-full border ${statusData?.status === MeetingStatus.NOT_DONE ? 'bg-red-500' : ''}`} />
                                      <div className="flex-1 bg-slate-50 rounded border px-2 py-1 flex justify-between items-center"><span className="text-[8px] font-black">DIA:</span><input type="number" value={statusData?.customDate || ''} onChange={e => updateMeetingData(client.id, m, { customDate: parseInt(e.target.value) || undefined })} className="w-8 bg-transparent text-center font-black text-xs" /></div>
                                      <button onClick={() => updateMeetingData(client.id, m, { status: statusData?.status === MeetingStatus.DONE ? MeetingStatus.PENDING : MeetingStatus.DONE })} className={`w-5 h-5 rounded-full border ${statusData?.status === MeetingStatus.DONE ? 'bg-green-500' : ''}`} />
                                    </div>
                                    <select value={statusData?.status || MeetingStatus.PENDING} onChange={e => updateMeetingData(client.id, m, { status: e.target.value as MeetingStatus })} className="text-[9px] font-black border rounded p-1 outline-none">
                                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </main>

      {isFormOpen && (
        <ClientForm
          onAdd={addClient}
          onUpdate={updateClient}
          onClose={() => { setIsFormOpen(false); setEditingClient(null); }}
          clientToEdit={editingClient}
          nextSequence={editingClient ? undefined : getNextSequenceForMonth(toMonthKey(new Date()))}
        />
      )}
    </div>
  );
};

export default App;
