console.log("URL FRONT:", import.meta.env.VITE_SUPABASE_URL);
console.log("KEY FRONT:", import.meta.env.VITE_SUPABASE_ANON_KEY);
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

  const exportClientsToCSV = () => {
    if (clients.length === 0) {
      alert('Nenhum cliente para exportar.');
      return;
    }

    const headers = [
      'ID',
      'Nome',
      'Telefone (últimos 4)',
      'Mês de Início',
      'Dia de Início',
      'Sequência no Mês',
      'Cor do Grupo',
      'Status por Mês (JSON)'
    ];

    const rows = clients.map(c => [
      c.id,
      `"${c.name}"`,
      c.phoneDigits,
      c.startMonthYear,
      c.startDate,
      c.sequenceInMonth,
      c.groupColor,
      JSON.stringify(c.statusByMonth)
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `rnv_clientes_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const updateUser = async (userId: string, updates: Partial<{ role: UserRole; active: boolean }>) => {
    const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
    if (error) {
      console.error('Erro ao atualizar user:', error);
      alert(`Erro ao atualizar usuário: ${error.message}`);
      return;
    }
    setUsers(prev => prev.map(u => (u.id === userId ? { ...u, ...updates } : u)));
  };

  const isClientInactive = (client: Client) => {
    return Object.values(client.statusByMonth).some(s => s.status === MeetingStatus.CLOSED_CONTRACT);
  };

  const isOrangeClient = (client: Client) => {
    if (isClientInactive(client)) return false;
    const cycleMonths = getNextMonths(client.startMonthYear, 5);
    return toMonthKey(new Date()) >= cycleMonths[3];
  };

  const getNextSequenceForMonth = (monthYear: string) => {
    const monthClients = clients.filter(c => c.startMonthYear === monthYear);
    if (monthClients.length === 0) return 1;
    const max = Math.max(...monthClients.map(c => c.sequenceInMonth || 0));
    return max + 1;
  };

  const addClient = async (data: Omit<Client, 'id' | 'statusByMonth' | 'groupColor'>) => {
    const colorIndex = clients.length % GROUP_COLORS.length;
    const groupColor = GROUP_COLORS[colorIndex];

    const newClient: Client = {
      ...data,
      id: crypto.randomUUID(),
      statusByMonth: {},
      groupColor
    };

    setClients(prev => [...prev, newClient]);

    const { error } = await supabase.from('clients').insert(clientToDb(newClient));

    if (error) {
      console.error('Erro ao inserir client:', error);
      setClients(prev => prev.filter(c => c.id !== newClient.id));
      window.alert(`Erro ao salvar cliente no Supabase: ${error.message}`);
    }
  };

  const updateClient = async (id: string, data: Partial<Client>) => {
    const before = clients.find(c => c.id === id);
    if (!before) return;

    let patched: Partial<Client> = { ...data };
    if (patched.phoneDigits) {
      patched.phoneDigits = patched.phoneDigits.length > 4 ? patched.phoneDigits.slice(-4) : patched.phoneDigits;
    }

    const updatedLocal = clients.map(c => (c.id === id ? { ...c, ...patched } : c));
    setClients(updatedLocal);
    setEditingClient(null);

    const after = updatedLocal.find(c => c.id === id)!;

    const { error } = await supabase.from('clients').update(clientToDb(after)).eq('id', id);

    if (error) {
      console.error('Erro ao atualizar client:', error);
      setClients(prev => prev.map(c => (c.id === id ? before : c)));
      window.alert(`Erro ao atualizar cliente no Supabase: ${error.message}`);
    }
  };

  const updateClientSequence = async (id: string, newSequence: number) => {
    const before = clients.find(c => c.id === id);
    if (!before) return;

    const updated = clients.map(c => (c.id === id ? { ...c, sequenceInMonth: newSequence } : c));
    setClients(updated);

    const after = updated.find(c => c.id === id)!;

    const { error } = await supabase.from('clients').update({ sequence_in_month: after.sequenceInMonth }).eq('id', id);

    if (error) {
      console.error('Erro ao atualizar sequence:', error);
      setClients(prev => prev.map(c => (c.id === id ? before : c)));
      window.alert(`Erro ao atualizar sequência no Supabase: ${error.message}`);
    }
  };

  const deleteClient = async (id: string) => {
    if (window.confirm('Tem certeza que deseja excluir este cliente permanentemente?')) {
      const before = clients;
      setClients(prev => prev.filter(c => c.id !== id));

      const { error } = await supabase.from('clients').delete().eq('id', id);

      if (error) {
        console.error('Erro ao deletar client:', error);
        setClients(before);
        window.alert(`Erro ao excluir cliente no Supabase: ${error.message}`);
      }
    }
  };

  const handleEditClick = (client: Client) => {
    setEditingClient(client);
    setIsFormOpen(true);
  };

  const updateMeetingData = async (
    clientId: string,
    monthYear: string,
    updates: Partial<{ status: MeetingStatus; customDate?: number }>
  ) => {
    const before = clients.find(c => c.id === clientId);
    if (!before) return;

    const currentData = before.statusByMonth[monthYear] || { status: MeetingStatus.PENDING };

    const afterClient: Client = {
      ...before,
      statusByMonth: {
        ...before.statusByMonth,
        [monthYear]: { ...currentData, ...updates }
      }
    };

    setClients(prev => prev.map(c => (c.id === clientId ? afterClient : c)));

    const { error } = await supabase
      .from('clients')
      .update({ status_by_month: afterClient.statusByMonth })
      .eq('id', clientId);

    if (error) {
      console.error('Erro ao atualizar status_by_month:', error);
      setClients(prev => prev.map(c => (c.id === clientId ? before : c)));
      window.alert(`Erro ao salvar status no Supabase: ${error.message}`);
    }
  };

  const addMoreMonth = () => {
    const last = visibleMonths[visibleMonths.length - 1];
    const next = getNextMonths(last, 2)[1];
    setVisibleMonths(prev => [...prev, next]);
  };

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    clients.forEach(c => months.add(c.startMonthYear));
    return Array.from(months).sort();
  }, [clients]);

  const filteredClients = useMemo(() => {
    return clients
      .filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phoneDigits.includes(searchTerm);

        const matchesMonth = filterMonth === 'all' || c.startMonthYear === filterMonth;

        const inactive = isClientInactive(c);
        const orange = isOrangeClient(c);
        let matchesStatus = true;
        if (statusFilter === 'active') matchesStatus = !inactive;
        else if (statusFilter === 'finalized') matchesStatus = inactive;
        else if (statusFilter === 'needs_attention') matchesStatus = orange;

        return matchesSearch && matchesMonth && matchesStatus;
      })
      .sort((a, b) => {
        if (a.startMonthYear !== b.startMonthYear) return a.startMonthYear.localeCompare(b.startMonthYear);
        return (a.sequenceInMonth || 0) - (b.sequenceInMonth || 0);
      });
  }, [clients, searchTerm, filterMonth, statusFilter]);

  const checklistData = useMemo(() => {
    const activeClients = clients.filter(c => !isClientInactive(c));

    const activeThisMonth = activeClients.reduce((acc, client) => {
      const cycleMonths = getNextMonths(client.startMonthYear, 5);
      const meetingIdx = cycleMonths.indexOf(checklistMonth);

      if (meetingIdx !== -1) {
        const statusData = client.statusByMonth[checklistMonth];
        acc.push({
          client,
          meetingIdx,
          meetingLabel: MEETING_LABEL_TEXTS[meetingIdx],
          status: statusData?.status || MeetingStatus.PENDING,
          doneDate: statusData?.customDate || client.startDate
        });
      }
      return acc;
    }, [] as Array<{
      client: Client;
      meetingIdx: number;
      meetingLabel: string;
      status: MeetingStatus;
      doneDate: number;
    }>);

    const pendingAll = activeThisMonth.filter(item =>
      item.status !== MeetingStatus.DONE &&
      item.status !== MeetingStatus.CLOSED_CONTRACT
    );

    const filteredPending = pendingAll.filter(item => {
      if (checklistSubFilter === 'all') return true;
      if (checklistSubFilter === 'pending') return item.status === MeetingStatus.PENDING;
      if (checklistSubFilter === 'not_done') return item.status === MeetingStatus.NOT_DONE;
      if (checklistSubFilter === 'rescheduled') return item.status === MeetingStatus.RESCHEDULED;
      return true;
    });

    return {
      pending: filteredPending,
      completed: activeThisMonth.filter(item =>
        item.status === MeetingStatus.DONE ||
        item.status === MeetingStatus.CLOSED_CONTRACT
      ),
      counts: {
        all: pendingAll.length,
        pending: pendingAll.filter(i => i.status === MeetingStatus.PENDING).length,
        not_done: pendingAll.filter(i => i.status === MeetingStatus.NOT_DONE).length,
        rescheduled: pendingAll.filter(i => i.status === MeetingStatus.RESCHEDULED).length
      }
    };
  }, [clients, checklistMonth, checklistSubFilter]);

  // ✅ CORREÇÃO: Gráfico baseado em contratos FECHADOS no mês
  const reportData = useMemo(() => {
    const now = new Date();
    const months = getNextMonths(toMonthKey(now), 12);
    const map: Record<string, number> = {};
    
    clients.forEach(client => {
      Object.entries(client.statusByMonth).forEach(([monthYear, statusData]) => {
        if (statusData.status === MeetingStatus.CLOSED_CONTRACT) {
          map[monthYear] = (map[monthYear] || 0) + 1;
        }
      });
    });
    
    return months.map(m => ({ 
      label: getMonthLabel(m), 
      count: map[m] || 0 
    }));
  }, [clients]);

  const stats = useMemo(() => {
    const totalAtivos = clients.filter(c => !isClientInactive(c)).length;
    const totalFinalizados = clients.filter(c => isClientInactive(c)).length;
    const totalAtencao = clients.filter(c => isOrangeClient(c)).length;
    const target = filterMonth === 'all' ? toMonthKey(new Date()) : filterMonth;
    const entradas = clients.filter(c => c.startMonthYear === target).length;
    return { 
      totalAtivos, 
      totalFinalizados, 
      totalAtencao, 
      entradas, 
      labelEntradas: getMonthLabel(target) 
    };
  }, [clients, filterMonth]);

  if (!currentUser) return <Auth onLogin={handleLogin} />;
    return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500 p-2 rounded-lg"><TrendingUp className="text-white w-6 h-6" /></div>
            <h1 className="text-xl font-bold text-slate-800">RNV Consultoria</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input placeholder="Pesquisar..." className="pl-9 pr-4 py-2 bg-slate-100 rounded-full text-sm outline-none w-64 focus:bg-white border focus:border-yellow-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <button onClick={exportClientsToCSV} className="p-2 bg-slate-100 rounded-lg hover:bg-slate-200" title="Exportar CSV"><Download className="w-5 h-5 text-slate-600" /></button>
            <button onClick={() => { setEditingClient(null); setIsFormOpen(true); }} className="bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-yellow-600 flex items-center gap-2"><Plus className="w-5 h-5" /> Novo Cliente</button>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-600"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      <div className="bg-white border-b">
        <div className="max-w-[1600px] mx-auto px-4 flex gap-8">
          <button onClick={() => setActiveTab('overview')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'overview' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Visão Geral</button>
          <button onClick={() => setActiveTab('checklist')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'checklist' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Checklist Mensal</button>
          {currentUser.role === UserRole.ADMIN && (
            <>
              <button onClick={() => setActiveTab('reports')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'reports' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Relatórios</button>
              <button onClick={() => setActiveTab('users')} className={`py-4 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'users' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400'}`}>Usuários</button>
            </>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto px-4 py-8 space-y-6 w-full">
        {activeTab === 'overview' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm">
                <div className="bg-green-50 p-3 rounded-xl text-green-600"><Users /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Ativos</p><p className="text-2xl font-black text-slate-800">{stats.totalAtivos}</p></div>
              </div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm">
                <div className="bg-orange-50 p-3 rounded-xl text-orange-600"><AlertCircle /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Atenção</p><p className="text-2xl font-black text-slate-800">{stats.totalAtencao}</p></div>
              </div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm">
                <div className="bg-blue-50 p-3 rounded-xl text-blue-600"><UserPlus /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">{stats.labelEntradas}</p><p className="text-2xl font-black text-slate-800">{stats.entradas}</p></div>
              </div>
              <div className="bg-white p-5 rounded-2xl border flex items-center gap-4 shadow-sm">
                <div className="bg-slate-50 p-3 rounded-xl text-slate-600"><CheckSquare /></div>
                <div><p className="text-[10px] font-black text-slate-400 uppercase">Finalizados</p><p className="text-2xl font-black text-slate-800">{stats.totalFinalizados}</p></div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border shadow-sm space-y-4">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase mr-2">Filtrar Status:</span>
                <button onClick={() => setStatusFilter('active')} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${statusFilter === 'active' ? 'bg-green-600 text-white border-green-700 shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>Ativos</button>
                <button onClick={() => setStatusFilter('needs_attention')} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${statusFilter === 'needs_attention' ? 'bg-orange-500 text-white border-orange-600 shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>Atenção</button>
                <button onClick={() => setStatusFilter('finalized')} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${statusFilter === 'finalized' ? 'bg-slate-800 text-white border-slate-900 shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>Finalizados</button>
                <button onClick={() => setStatusFilter('all')} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase border transition-all ${statusFilter === 'all' ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>Todos</button>
              </div>
            </div>

            <RemindersPanel clients={clients.filter(c => !isClientInactive(c))} />

            <div className="bg-white border rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
                <h2 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Planilha Operacional RNV</h2>
                <button onClick={addMoreMonth} className="text-[10px] font-black text-yellow-600 uppercase bg-yellow-50 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors">Ver Mais Meses</button>
              </div>

              <div className="max-h-[70vh] overflow-auto relative" ref={monthsScrollRef}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b sticky top-0 z-30">
                      <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase sticky left-0 bg-slate-50 z-40 w-80 shadow-md">Identificação</th>
                      {visibleMonths.map(m => (
                        <th key={m} data-month={m} className="px-4 py-4 text-center text-[10px] font-black text-slate-400 uppercase border-l w-64 min-w-[240px] sticky top-0 bg-slate-50 z-30">{getMonthLabel(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredClients.map(client => {
                      const cycle = getNextMonths(client.startMonthYear, 5);
                      const inactive = isClientInactive(client);
                      const orange = isOrangeClient(client);
                      return (
                        <tr key={client.id} className={`hover:bg-slate-50/50 transition-colors ${inactive ? 'bg-slate-50/50' : ''}`}>
                          <td className={`px-4 py-4 sticky left-0 z-20 w-80 border-r shadow-sm transition-colors ${orange ? 'bg-orange-500 text-white' : inactive ? 'bg-slate-200 text-slate-500' : client.groupColor}`}>
                            <div className="flex items-start gap-3">
                              <input type="number" value={client.sequenceInMonth} onChange={e => updateClientSequence(client.id, parseInt(e.target.value) || 1)} className={`w-10 h-10 rounded-xl text-center font-black outline-none transition-all ${orange ? 'bg-white/20 text-white' : 'bg-slate-800 text-white'}`} />
                              <div className="flex-1 min-w-0">
                                <p className={`font-bold truncate text-sm uppercase ${inactive ? 'line-through opacity-50' : ''}`}>{client.name}</p>
                                <p className={`text-[10px] font-black opacity-70`}>TEL: {client.phoneDigits}</p>
                                {orange && <span className="text-[8px] font-black bg-white/20 px-2 py-0.5 rounded-full uppercase mt-1 inline-block">Atenção Necessária</span>}
                              </div>
                              <div className="flex flex-col gap-1">
                                <button onClick={() => handleEditClick(client)} className="p-1 hover:scale-110 transition-transform"><Pencil className="w-4 h-4" /></button>
                                <button onClick={() => deleteClient(client.id)} className="p-1 hover:scale-110 transition-transform"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                          </td>
                          {visibleMonths.map(m => {
                            const cycleIdx = cycle.indexOf(m);
                            const s = client.statusByMonth[m];
                            return (
                              <td key={m} className={`px-4 py-4 border-l text-center ${cycleIdx !== -1 ? 'bg-white' : 'bg-slate-50/30 opacity-30'}`}>
                                {cycleIdx !== -1 && (
                                  <div className="flex flex-col gap-2">
                                    <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                                      <span>{MEETING_LABEL_TEXTS[cycleIdx]}</span>
                                      <span className="bg-yellow-50 text-yellow-700 px-1.5 rounded">Dia {client.startDate}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => updateMeetingData(client.id, m, { status: s?.status === MeetingStatus.NOT_DONE ? MeetingStatus.PENDING : MeetingStatus.NOT_DONE })} className={`w-5 h-5 rounded-full border transition-all ${s?.status === MeetingStatus.NOT_DONE ? 'bg-red-500 border-red-600 scale-110 shadow-sm' : 'bg-white hover:border-red-300'}`} />
                                      <div className="flex-1 bg-slate-50 rounded border px-2 py-1 flex justify-between items-center">
                                        <span className="text-[8px] font-black text-slate-400">DIA:</span>
                                        <input type="number" value={s?.customDate || ''} onChange={e => updateMeetingData(client.id, m, { customDate: parseInt(e.target.value) || undefined })} className="w-8 bg-transparent text-center font-black text-xs outline-none" />
                                      </div>
                                      <button onClick={() => updateMeetingData(client.id, m, { status: s?.status === MeetingStatus.DONE ? MeetingStatus.PENDING : MeetingStatus.DONE })} className={`w-5 h-5 rounded-full border transition-all ${s?.status === MeetingStatus.DONE ? 'bg-green-500 border-green-600 scale-110 shadow-sm' : 'bg-white hover:border-green-300'}`} />
                                    </div>
                                    <select value={s?.status || MeetingStatus.PENDING} onChange={e => updateMeetingData(client.id, m, { status: e.target.value as MeetingStatus })} className={`text-[9px] font-black border rounded p-1 outline-none transition-colors ${s?.status === MeetingStatus.RESCHEDULED ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white'}`}>
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
        ) : activeTab === 'checklist' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-6 rounded-2xl border flex items-center justify-between shadow-sm">
              <div>
                <h2 className="text-xl font-black flex items-center gap-3 text-slate-800"><ClipboardCheck className="text-yellow-500 w-7 h-7" /> Checklist Mensal</h2>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Controle de Reuniões de {getMonthLabel(checklistMonth)}</p>
              </div>
              <div className="flex items-center gap-3 bg-slate-100 p-2 rounded-xl">
                <button onClick={() => { const d = addMonths(new Date(checklistMonth + '-01'), -1); setChecklistMonth(toMonthKey(d)); }} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
                <span className="font-black text-xs uppercase text-slate-700 min-w-[140px] text-center">{getMonthLabel(checklistMonth)}</span>
                <button onClick={() => { const d = addMonths(new Date(checklistMonth + '-01'), 1); setChecklistMonth(toMonthKey(d)); }} className="p-2 hover:bg-white rounded-lg transition-all shadow-sm"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 px-2"><Clock className="w-4 h-4" /> Pendentes ({checklistData.pending.length})</h3>
                {checklistData.pending.map((item: any) => (
                  <div key={item.client.id} className="bg-white p-4 rounded-xl border shadow-sm flex items-center justify-between group hover:border-yellow-200 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-800 text-white rounded-lg flex items-center justify-center font-black text-xs">{item.client.sequenceInMonth}</div>
                      <div>
                        <p className="font-bold text-slate-800 text-sm uppercase">{item.client.name}</p>
                        <p className="text-[10px] font-black text-yellow-600 uppercase">{item.meetingLabel} • Ideal: Dia {item.client.startDate}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.DONE, customDate: new Date().getDate() })} className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-500 hover:text-white transition-all"><CheckCircle2 className="w-5 h-5" /></button>
                      <button onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.NOT_DONE })} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-500 hover:text-white transition-all"><XCircle className="w-5 h-5" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 px-2"><CheckCircle2 className="w-4 h-4 text-green-500" /> Concluídas ({checklistData.completed.length})</h3>
                {checklistData.completed.map((item: any) => (
                  <div key={item.client.id} className="bg-green-50/50 p-4 rounded-xl border border-green-100 flex items-center justify-between opacity-80">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-green-500 text-white rounded-lg flex items-center justify-center"><CheckCircle2 className="w-5 h-5" /></div>
                      <div>
                        <p className="font-bold text-slate-700 text-sm uppercase line-through">{item.client.name}</p>
                        <p className="text-[10px] font-black text-green-600 uppercase">{item.meetingLabel} • Feito Dia {item.doneDate}</p>
                      </div>
                    </div>
                    <button onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.PENDING })} className="text-slate-400 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : activeTab === 'reports' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Trophy className="text-yellow-500 w-7 h-7" /> Clientes Fechados por Mês</h2>
                  <p className="text-slate-500 font-medium">Quantidade de clientes com contrato fechado por mês (Próximos 12 meses)</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center min-w-[150px]">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total (12 Meses)</p>
                  <p className="text-3xl font-black text-slate-800">{reportData.reduce((a, b) => a + b.count, 0)}</p>
                </div>
              </div>

              <div className="overflow-x-auto pb-4">
                <div className="relative h-80 w-[1200px] pt-8 px-4">
                  <div className="absolute inset-x-4 top-8 bottom-12 flex items-end justify-between gap-4">
                    {reportData.map((data, idx) => {
                      const max = Math.max(...reportData.map(d => d.count), 5);
                      const heightPercent = (data.count / max) * 100;
                      return (
                        <div key={idx} className="group relative flex flex-col items-center flex-1 min-w-[70px]">
                          <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-all bg-slate-800 text-white text-[10px] font-black px-2 py-1 rounded shadow-lg">
                            {data.count} Clientes Fechados
                          </div>
                          <div
                            style={{ height: `${heightPercent}%` }}
                            className="w-full max-w-[40px] bg-gradient-to-t from-yellow-500 to-yellow-400 rounded-t-xl transition-all duration-700 shadow-lg shadow-yellow-500/20 group-hover:from-slate-800 group-hover:to-slate-700"
                          />
                          <div className="absolute top-[105%] flex flex-col items-center">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">{data.label.split(' ')[0]}</span>
                            <span className="text-[8px] font-bold text-slate-300">{data.label.split(' ')[1]}</span>
                          </div>
                          {data.count === 0 && <div className="w-1 h-1 rounded-full bg-slate-200 mt-2" />}
                        </div>
                      );
                    })}
                  </div>
                  <div className="absolute left-0 right-0 bottom-12 h-px bg-slate-100" />
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'users' ? (
          <div className="bg-white p-6 rounded-2xl border shadow-sm animate-in fade-in">
            <h2 className="text-xl font-black mb-8 flex items-center gap-3 text-slate-800"><UserCog className="text-yellow-500 w-7 h-7" /> Gestão de Usuários</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {users.map(u => (
                <div key={u.id} className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border hover:border-yellow-200 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-800 text-white rounded-xl flex items-center justify-center font-black text-lg shadow-sm">{u.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <p className="font-bold text-slate-800 uppercase text-sm">{u.name}</p>
                      <p className="text-xs text-slate-400 font-medium">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-slate-600">Ativo:</label>
                      <input type="checkbox" checked={u.active} onChange={async (e) => {
                        const { error } = await supabase.from('profiles').update({ active: e.target.checked }).eq('id', u.id);
                        if (!error) setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, active: e.target.checked } : usr));
                      }} className="w-4 h-4 accent-yellow-500" />
                    </div>
                    <select value={u.role} onChange={async (e) => {
                      const { error } = await supabase.from('profiles').update({ role: e.target.value }).eq('id', u.id);
                      if (!error) setUsers(prev => prev.map(usr => usr.id === u.id ? { ...usr, role: e.target.value as UserRole } : usr));
                    }} className="px-3 py-1 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-yellow-500 outline-none uppercase">
                      <option value={UserRole.ADMIN}>Admin</option>
                      <option value={UserRole.ASSISTANT}>Assistente</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </main>

      {isFormOpen && (
        <ClientForm
          onAdd={async (data) => {
            const newClient = { ...data, id: crypto.randomUUID(), statusByMonth: {}, groupColor: GROUP_COLORS[clients.length % GROUP_COLORS.length] };
            setClients(prev => [...prev, newClient]);
            await supabase.from('clients').insert(clientToDb(newClient));
            setIsFormOpen(false);
          }}
          onUpdate={async (id, data) => {
            setClients(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
            await supabase.from('clients').update(clientToDb(clients.find(c => c.id === id)!)).eq('id', id);
            setIsFormOpen(false);
            setEditingClient(null);
          }}
          onClose={() => { setIsFormOpen(false); setEditingClient(null); }}
          clientToEdit={editingClient}
          nextSequence={editingClient ? undefined : (clients.filter(c => c.startMonthYear === toMonthKey(new Date())).length + 1)}
        />
      )}
      
      <footer className="py-8 border-t bg-white mt-auto">
        <p className="text-[10px] text-slate-400 font-black uppercase text-center tracking-[0.3em]">RNV Consultoria Financeira &copy; {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
};

export default App;
