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

type TabType = 'overview' | 'checklist' | 'reports' | 'users';
type ChecklistSubFilter = 'all' | 'pending' | 'not_done' | 'rescheduled';
type StatusFilter = 'all' | 'active' | 'finalized';

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
    return getNextMonths('2025-06', 8);
  });

  // 1) Recarrega usuário da sessão local
  useEffect(() => {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      setCurrentUser(JSON.parse(session));
    }
  }, []);

  // 2) Quando logar, carrega clients do Supabase
  useEffect(() => {
    const loadClients = async () => {
      if (!currentUser) return;
      setLoadingClients(true);

      const { data, error } = await supabase
        .from('clients')
        .select('id,name,phone_digits,start_month_year,start_date,sequence_in_month,group_color,status_by_month')
        .order('start_month_year', { ascending: true })
        .order('sequence_in_month', { ascending: true });

      if (error) {
        console.error('Erro ao carregar clients:', error);
        setLoadingClients(false);
        return;
      }

      setClients((data as DbClientRow[]).map(dbToClient));
      setLoadingClients(false);
    };

    loadClients();
  }, [currentUser]);

  // 3) Carrega usuários (só ADMIN)
  useEffect(() => {
    const loadUsers = async () => {
      if (!currentUser || currentUser.role !== UserRole.ADMIN) return;
      setLoadingUsers(true);

      const { data, error } = await supabase
        .from('profiles')
        .select('id,name,email,role,active')
        .order('name', { ascending: true });

      if (error) {
        console.error('Erro ao carregar users:', error);
        setLoadingUsers(false);
        return;
      }

      setUsers(data as User[]);
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
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error('Erro ao deslogar no Supabase:', error);
    } finally {
      setCurrentUser(null);
      localStorage.removeItem(SESSION_KEY);
      setClients([]);
      setUsers([]);
      setActiveTab('overview');
    }
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

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

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
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Erro ao atualizar user:', error);
      alert(`Erro ao atualizar usuário: ${error.message}`);
      return;
    }

    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
  };

  const isClientInactive = (client: Client) => {
    return Object.values(client.statusByMonth).some(s => s.status === MeetingStatus.CLOSED_CONTRACT);
  };

  const getNextSequenceForMonth = (monthYear: string) => {
    const monthClients = clients.filter(c => c.startMonthYear === monthYear);
    if (monthClients.length === 0) return 1;
    const max = Math.max(...monthClients.map(c => c.sequenceInMonth || 0));
    return max + 1;
  };

  const addClient = async (data: Omit<Client, 'id' | 'statusByMonth' | 'groupColor'>) => {
    const colorIndex = (clients.length) % GROUP_COLORS.length;
    const groupColor = GROUP_COLORS[colorIndex];

    const newClient: Client = {
      ...data,
      id: crypto.randomUUID(),
      statusByMonth: {},
      groupColor
    };

    setClients(prev => [...prev, newClient]);

    const { error } = await supabase
      .from('clients')
      .insert(clientToDb(newClient));

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

    const { error } = await supabase
      .from('clients')
      .update(clientToDb(after))
      .eq('id', id);

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

    const { error } = await supabase
      .from('clients')
      .update({ sequence_in_month: after.sequenceInMonth })
      .eq('id', id);

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

      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', id);

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
    updates: Partial<{ status: MeetingStatus; customDate: number }>
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
        const matchesSearch =
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.phoneDigits.includes(searchTerm);

        const matchesMonth = filterMonth === 'all' || c.startMonthYear === filterMonth;

        const inactive = isClientInactive(c);
        let matchesStatus = true;
        if (statusFilter === 'active') matchesStatus = !inactive;
        else if (statusFilter === 'finalized') matchesStatus = inactive;

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

  const stats = useMemo(() => {
    const totalAtivos = clients.filter(c => !isClientInactive(c)).length;
    const totalFinalizados = clients.filter(c => isClientInactive(c)).length;

    const targetMonth = filterMonth === 'all' ? new Date().toISOString().slice(0, 7) : filterMonth;
    const entradasNoMes = clients.filter(c => c.startMonthYear === targetMonth).length;

    return { totalAtivos, totalFinalizados, entradasNoMes, labelEntradas: getMonthLabel(targetMonth) };
  }, [clients, filterMonth]);

  const reportData = useMemo(() => {
    if (currentUser?.role !== UserRole.ADMIN) return [];
    const monthMap: Record<string, number> = {};
    const last8Months = getNextMonths('2025-01', 12);

    clients.forEach(client => {
      Object.entries(client.statusByMonth).forEach(([m, data]) => {
        if ((data as { status: MeetingStatus }).status === MeetingStatus.CLOSED_CONTRACT) {
          monthMap[m] = (monthMap[m] || 0) + 1;
        }
      });
    });

    return last8Months.map(m => ({
      month: m,
      label: getMonthLabel(m),
      count: monthMap[m] || 0
    }));
  }, [clients, currentUser]);

  const maxCount = Math.max(...reportData.map(d => d.count), 5);

  if (!currentUser) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500 p-2 rounded-lg">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-700 to-amber-600">
              RNV Consultoria
            </h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Pesquisar cliente..."
                className="pl-9 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-yellow-500 outline-none w-64 transition-all focus:bg-white focus:shadow-inner"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-4 border-l pl-6 border-slate-200">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-800 leading-none">{currentUser.name}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                  {currentUser.role === UserRole.ADMIN ? 'Administrador' : 'Assistente'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2.5 bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all group relative"
                title="Sair do Sistema"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={exportClientsToCSV}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-lg font-bold transition-all shadow-md active:scale-95"
                title="Exportar clientes (CSV)"
              >
                <Download className="w-5 h-5" />
                <span className="hidden sm:inline">Exportar</span>
              </button>

              <button
                onClick={() => {
                  setEditingClient(null);
                  setIsFormOpen(true);
                }}
                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg font-bold transition-all shadow-md active:scale-95"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Novo Cliente</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1600px] mx-auto px-4 flex gap-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-4 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 border-b-2 transition-all ${activeTab === 'overview' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Visão Geral
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`py-4 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 border-b-2 transition-all ${activeTab === 'checklist' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Checklist Mensal
          </button>
          {currentUser.role === UserRole.ADMIN && (
            <>
              <button
                onClick={() => setActiveTab('reports')}
                className={`py-4 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 border-b-2 transition-all ${activeTab === 'reports' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                <BarChart3 className="w-4 h-4" />
                Relatórios
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`py-4 text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 border-b-2 transition-all ${activeTab === 'users' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                <UserCog className="w-4 h-4" />
                Usuários
              </button>
            </>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-[1600px] mx-auto px-4 py-8 space-y-6 w-full">
        {loadingClients && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 text-slate-500 text-sm">
            Carregando clientes do Supabase...
          </div>
        )}

        {activeTab === 'overview' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="bg-green-50 p-3 rounded-xl text-green-600">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Clientes Ativos</p>
                  <p className="text-2xl font-black text-slate-800">{stats.totalAtivos}</p>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="bg-slate-50 p-3 rounded-xl text-slate-600">
                  <CheckSquare className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Contratos Finalizados</p>
                  <p className="text-2xl font-black text-slate-800">{stats.totalFinalizados}</p>
                </div>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
                <div className="bg-blue-50 p-3 rounded-xl text-blue-600">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Entradas: {stats.labelEntradas}</p>
                  <p className="text-2xl font-black text-slate-800">{stats.entradasNoMes}</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2 border-slate-100">
                  <h3 className="text-xs font-black text-slate-500 flex items-center gap-2 uppercase tracking-widest">
                    <Filter className="w-3.5 h-3.5" /> Filtrar por Mês de Início
                  </h3>
                  {filterMonth !== 'all' && (
                    <button
                      onClick={() => setFilterMonth('all')}
                      className="text-[10px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 uppercase"
                    >
                      Limpar <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilterMonth('all')}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${filterMonth === 'all' ? 'bg-yellow-500 border-yellow-600 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                  >
                    Todos os Meses
                  </button>
                  {availableMonths.map(m => (
                    <button
                      key={m}
                      onClick={() => setFilterMonth(m)}
                      className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${filterMonth === m ? 'bg-yellow-500 border-yellow-600 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                    >
                      {getMonthLabel(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-black text-slate-500 flex items-center gap-2 uppercase tracking-widest border-b pb-2 border-slate-100">
                  <ClipboardCheck className="w-3.5 h-3.5" /> Filtro de Status do Cliente
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border ${statusFilter === 'all' ? 'bg-slate-800 border-slate-900 text-white shadow-lg shadow-slate-200' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                  >
                    <Users className="w-3.5 h-3.5" /> Todos
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border ${statusFilter === 'active' ? 'bg-green-600 border-green-700 text-white shadow-lg shadow-green-200' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ativos
                  </button>
                  <button
                    onClick={() => setStatusFilter('finalized')}
                    className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border ${statusFilter === 'finalized' ? 'bg-blue-600 border-blue-700 text-white shadow-lg shadow-blue-200' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                  >
                    <UserMinus className="w-3.5 h-3.5" /> Finalizados
                  </button>
                </div>
              </div>
            </div>

            <RemindersPanel clients={clients.filter(c => !isClientInactive(c))} />

            <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <h2 className="font-bold text-slate-800 flex items-center gap-2 uppercase tracking-widest text-xs">
                  Planilha Operacional RNV
                </h2>
                <button
                  onClick={addMoreMonth}
                  className="text-[10px] font-black uppercase tracking-widest text-yellow-600 hover:text-yellow-700 flex items-center gap-1 transition-colors bg-yellow-50 px-3 py-1.5 rounded-lg border border-yellow-100"
                >
                  Ver Mais Meses <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="px-6 py-4 text-left text-xs font-black text-slate-400 uppercase tracking-wider sticky left-0 bg-slate-50 z-20 w-80 shadow-[2px_0_5px_rgba(0,0,0,0.05)]">
                        Identificação
                      </th>
                      {visibleMonths.map(m => (
                        <th key={m} className="px-4 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-wider border-l w-64 min-w-[240px]">
                          {getMonthLabel(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {filteredClients.length > 0 ? (
                      filteredClients.map((client) => {
                        const clientCycleMonths = getNextMonths(client.startMonthYear, 5);
                        const isFinalized = isClientInactive(client);
                        const isMeeting4Done = client.statusByMonth[clientCycleMonths[3]]?.status === MeetingStatus.DONE;
                        const isConsultantRequired = isMeeting4Done && !isFinalized;

                        return (
                          <tr key={client.id} className={`transition-colors group ${isFinalized ? 'bg-slate-50/50' : 'hover:bg-slate-50/30'}`}>
                            <td className={`px-4 py-4 sticky left-0 z-10 w-80 shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r ${isConsultantRequired ? 'bg-orange-500 text-white' : isFinalized ? 'bg-slate-200 text-slate-500' : client.groupColor}`}>
                              <div className="flex items-start gap-3">
                                <div className="shrink-0 pt-0.5">
                                  <input
                                    type="number"
                                    min="1"
                                    value={client.sequenceInMonth}
                                    onChange={(e) => updateClientSequence(client.id, parseInt(e.target.value) || 1)}
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black border text-center outline-none focus:ring-2 focus:ring-yellow-400 transition-all shadow-sm ${isConsultantRequired ? 'bg-white/20 border-white/40 text-white' : isFinalized ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-800 text-white border-slate-900'}`}
                                    title="Ordem de entrada"
                                  />
                                </div>

                                <div className="flex flex-col overflow-hidden flex-1 space-y-1">
                                  <div className="flex flex-col">
                                    <span className={`font-bold truncate text-sm leading-tight uppercase ${isFinalized ? 'line-through opacity-50' : ''}`}>{client.name}</span>
                                    <span className={`text-[10px] font-black ${isConsultantRequired ? 'text-white/80' : isFinalized ? 'text-slate-400' : 'text-slate-600'}`}>
                                      TEL: {client.phoneDigits}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 pt-1">
                                    {isFinalized ? (
                                      <span className="text-[8px] font-black bg-slate-800 text-white px-2 py-0.5 rounded-full uppercase tracking-widest border border-slate-900">FINALIZADO</span>
                                    ) : (
                                      <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1 border shadow-sm ${isConsultantRequired ? 'bg-white/20 text-white border-white/30' : 'bg-white text-slate-700 border-slate-200'}`}>
                                        INÍCIO: {getMonthLabel(client.startMonthYear)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-col items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => handleEditClick(client)}
                                    className={`p-1.5 rounded-lg transition-colors ${isConsultantRequired ? 'hover:bg-white/20 text-white' : 'hover:bg-yellow-50 text-slate-400 hover:text-yellow-600'}`}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => deleteClient(client.id)}
                                    className={`p-1.5 rounded-lg transition-colors ${isConsultantRequired ? 'hover:bg-white/20 text-white' : 'hover:bg-red-50 text-slate-400 hover:text-red-500'}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </td>

                            {visibleMonths.map((m) => {
                              const cycleIdx = clientCycleMonths.indexOf(m);
                              const isInCycle = cycleIdx !== -1;
                              const statusData = client.statusByMonth[m] as { status: MeetingStatus; customDate?: number; } | undefined;
                              const currentStatus = statusData?.status || MeetingStatus.PENDING;
                              const isDone = currentStatus === MeetingStatus.DONE;
                              const isNotDone = currentStatus === MeetingStatus.NOT_DONE;

                              return (
                                <td key={m} className={`px-4 py-4 border-l text-center relative transition-colors ${isInCycle ? 'bg-white' : 'bg-slate-200/20 opacity-50'}`}>
                                  {isInCycle ? (
                                    <div className={`flex flex-col gap-2 ${isClientInactive(client) ? 'opacity-75 saturate-[0.8]' : ''}`}>
                                      <div className="flex items-center justify-between">
                                        <span className="text-[9px] font-black text-slate-400 tracking-tighter uppercase">
                                          {MEETING_LABEL_TEXTS[cycleIdx]}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <span className="text-[9px] font-black px-1.5 py-0.5 bg-yellow-50 text-yellow-700 rounded border border-yellow-200">
                                            {client.startDate}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => updateMeetingData(client.id, m, { status: isNotDone ? MeetingStatus.PENDING : MeetingStatus.NOT_DONE })}
                                          className={`w-5 h-5 rounded-full border transition-all flex items-center justify-center shrink-0 ${isNotDone ? 'bg-red-500 border-red-600 scale-110 shadow-md shadow-red-100' : 'bg-white border-slate-200 hover:border-red-300'}`}
                                        >
                                          {isNotDone && <XCircle className="w-3 h-3 text-white" />}
                                        </button>

                                        <div className={`flex-1 flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border transition-all ${isDone ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                                          <span className="text-[9px] font-black text-slate-400 uppercase leading-none text-left shrink-0">REALIZADO DIA:</span>
                                          <input
                                            type="number"
                                            min="1"
                                            max="31"
                                            placeholder="-"
                                            value={statusData?.customDate || ''}
                                            onChange={(e) => {
                                              const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                                              updateMeetingData(client.id, m, { customDate: val });
                                            }}
                                            className="w-10 bg-transparent font-black text-xs text-slate-800 text-center outline-none"
                                          />
                                        </div>

                                        <button
                                          onClick={() => updateMeetingData(client.id, m, { status: isDone ? MeetingStatus.PENDING : MeetingStatus.DONE })}
                                          className={`w-5 h-5 rounded-full border transition-all flex items-center justify-center shrink-0 ${isDone ? 'bg-green-500 border-green-600 scale-110 shadow-md shadow-green-100' : 'bg-white border-slate-200 hover:border-green-300'}`}
                                        >
                                          {isDone && <CheckCircle2 className="w-3 h-3 text-white" />}
                                        </button>
                                      </div>

                                      <div className="relative group/status">
                                        <select
                                          value={currentStatus}
                                          onChange={(e) => updateMeetingData(client.id, m, { status: e.target.value as MeetingStatus })}
                                          className={`appearance-none w-full text-[9px] py-1.5 px-2 rounded-md border bg-white font-black cursor-pointer transition-all pr-6 outline-none
                                            ${currentStatus === MeetingStatus.RESCHEDULED ? 'border-amber-300 text-amber-700 bg-amber-50' :
                                              currentStatus === MeetingStatus.CLOSED_CONTRACT ? 'border-slate-800 text-white bg-slate-800' :
                                                'border-slate-200 text-slate-500'}
                                          `}
                                        >
                                          {STATUS_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                          ))}
                                        </select>
                                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                          <ChevronDown className={`w-3 h-3 ${currentStatus === MeetingStatus.CLOSED_CONTRACT ? 'text-white' : 'text-slate-300'}`} />
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="h-10 flex items-center justify-center opacity-5">
                                      <CalendarDays className="w-5 h-5 text-slate-400" />
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={visibleMonths.length + 1} className="py-24 text-center">
                          <div className="flex flex-col items-center gap-4 text-slate-400">
                            <Search className="w-16 h-16 opacity-10" />
                            <div className="space-y-1">
                              <p className="font-bold text-slate-500 uppercase tracking-widest text-xs">Nenhum cliente encontrado</p>
                              <p className="text-sm">Comece clicando em "Novo Cliente".</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : activeTab === 'checklist' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <ClipboardCheck className="w-7 h-7 text-yellow-500" />
                  Checklist Mensal
                </h2>
                <p className="text-slate-500 font-medium">Controle focado apenas em <span className="text-yellow-600 font-bold">Clientes Ativos</span> de {getMonthLabel(checklistMonth)}</p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100 shadow-inner">
                  <button
                    onClick={() => {
                      const [y, m] = checklistMonth.split('-').map(Number);
                      const prev = new Date(y, m - 2, 1);
                      setChecklistMonth(`${prev.getFullYear()}-${(prev.getMonth() + 1).toString().padStart(2, '0')}`);
                    }}
                    className="p-2 hover:bg-white rounded-lg transition-colors shadow-sm text-slate-400 hover:text-slate-600"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 min-w-[150px] text-center">
                    {getMonthLabel(checklistMonth)}
                  </span>
                  <button
                    onClick={() => {
                      const [y, m] = checklistMonth.split('-').map(Number);
                      const next = new Date(y, m, 1);
                      setChecklistMonth(`${next.getFullYear()}-${(next.getMonth() + 1).toString().padStart(2, '0')}`);
                    }}
                    className="p-2 hover:bg-white rounded-lg transition-colors shadow-sm text-slate-400 hover:text-slate-600"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap gap-2">
              <button
                onClick={() => setChecklistSubFilter('all')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${checklistSubFilter === 'all' ? 'bg-slate-800 text-white shadow-lg' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
              >
                <Filter className="w-3.5 h-3.5" />
                Todos <span className="opacity-40 ml-1">({checklistData.counts.all})</span>
              </button>
              <button
                onClick={() => setChecklistSubFilter('pending')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${checklistSubFilter === 'pending' ? 'bg-yellow-500 text-white shadow-lg shadow-yellow-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
              >
                <Clock className="w-3.5 h-3.5" />
                Pendentes <span className="opacity-40 ml-1">({checklistData.counts.pending})</span>
              </button>
              <button
                onClick={() => setChecklistSubFilter('not_done')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${checklistSubFilter === 'not_done' ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                Faltaram <span className="opacity-40 ml-1">({checklistData.counts.not_done})</span>
              </button>
              <button
                onClick={() => setChecklistSubFilter('rescheduled')}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${checklistSubFilter === 'rescheduled' ? 'bg-blue-500 text-white shadow-lg shadow-blue-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                Remarcadas <span className="opacity-40 ml-1">({checklistData.counts.rescheduled})</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Reuniões Pendentes ({checklistData.pending.length})
                  </h3>
                  <div className="h-px bg-slate-200 flex-1 ml-4" />
                </div>

                <div className="space-y-3">
                  {checklistData.pending.length > 0 ? (
                    checklistData.pending.map((item) => (
                      <div key={item.client.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group animate-in slide-in-from-left-2 duration-300">
                        <div className="flex items-start justify-between">
                          <div className="space-y-3 flex-1">
                            <div className="flex items-center gap-3">
                              <span className="bg-slate-800 text-white text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-lg shadow-sm">
                                {item.client.sequenceInMonth}
                              </span>
                              <h4 className="font-bold text-slate-800 uppercase text-sm tracking-tight">{item.client.name}</h4>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="bg-yellow-50 text-yellow-700 text-[9px] font-black px-3 py-1 rounded-full border border-yellow-200 uppercase tracking-tighter shadow-sm">
                                {item.meetingLabel}
                              </span>
                              <span className="bg-slate-100 text-slate-600 text-[9px] font-black px-3 py-1 rounded-full border border-slate-200 uppercase tracking-tighter shadow-sm">
                                Ideal: Dia {item.client.startDate}
                              </span>
                              <span className={`text-[9px] font-black px-3 py-1 rounded-full border uppercase tracking-tighter shadow-sm ${item.status === MeetingStatus.RESCHEDULED ? 'bg-blue-50 text-blue-700 border-blue-200' : item.status === MeetingStatus.NOT_DONE ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                                Status: {STATUS_OPTIONS.find(o => o.value === item.status)?.label}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.DONE, customDate: new Date().getDate() })}
                              className="bg-slate-50 hover:bg-green-500 hover:text-white text-slate-400 p-3 rounded-2xl transition-all border border-slate-100 shadow-sm active:scale-90"
                              title="Marcar como Concluída"
                            >
                              <CheckCircle2 className="w-6 h-6" />
                            </button>
                            <button
                              onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.NOT_DONE })}
                              className="bg-slate-50 hover:bg-red-500 hover:text-white text-slate-400 p-2 rounded-xl transition-all border border-slate-100 shadow-sm active:scale-90"
                              title="Marcar Falta"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-12 text-center bg-slate-100/30 rounded-3xl border-2 border-dashed border-slate-200">
                      <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">Nada pendente</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Concluídas no Mês ({checklistData.completed.length})
                  </h3>
                  <div className="h-px bg-slate-200 flex-1 ml-4" />
                </div>

                <div className="space-y-3 opacity-60 hover:opacity-100 transition-opacity">
                  {checklistData.completed.length > 0 ? (
                    checklistData.completed.map((item) => (
                      <div key={item.client.id} className="bg-green-50/30 p-5 rounded-2xl border border-green-100/50 shadow-sm flex items-center justify-between animate-in fade-in duration-500">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-green-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-green-100">
                            <CheckCircle2 className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-slate-700 uppercase text-xs line-through decoration-slate-400">{item.client.name}</h4>
                            <p className="text-[10px] font-black text-green-600 uppercase tracking-tighter">
                              {item.meetingLabel} • Feito Dia {item.doneDate}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => updateMeetingData(item.client.id, checklistMonth, { status: MeetingStatus.PENDING })}
                          className="text-slate-400 hover:text-red-500 p-2 transition-colors"
                          title="Voltar para Pendente"
                        >
                          <XCircle className="w-5 h-5" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-inner">
                      <p className="text-slate-400 text-sm mt-1">Nenhuma conclusão registrada ainda.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'reports' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                    <Trophy className="w-7 h-7 text-yellow-500" />
                    Conversão de Contratos
                  </h2>
                  <p className="text-slate-500 font-medium">Histórico mensal de contratos encerrados (CLOSED_CONTRACT)</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center min-w-[150px]">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total de Sucessos</p>
                  <p className="text-3xl font-black text-slate-800">
                    {reportData.reduce((acc, curr) => acc + curr.count, 0)}
                  </p>
                </div>
              </div>

              <div className="relative h-80 w-full pt-8 px-4">
                <div className="absolute inset-x-4 top-8 bottom-12 flex items-end justify-between gap-4">
                  {reportData.map((data, idx) => {
                    const heightPercent = (data.count / maxCount) * 100;
                    return (
                      <div key={idx} className="group relative flex flex-col items-center flex-1">
                        <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-all bg-slate-800 text-white text-[10px] font-black px-2 py-1 rounded shadow-lg -translate-y-2 group-hover:translate-y-0">
                          {data.count} Contratos
                        </div>

                        <div
                          style={{ height: `${heightPercent}%` }}
                          className="w-full max-w-[40px] bg-gradient-to-t from-yellow-500 to-yellow-400 rounded-t-xl transition-all duration-700 shadow-lg shadow-yellow-500/20 group-hover:from-slate-800 group-hover:to-slate-700 group-hover:shadow-slate-800/20"
                        />

                        <div className="absolute top-[105%] flex flex-col items-center">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter whitespace-nowrap overflow-hidden max-w-[60px] text-ellipsis">
                            {data.label.split(' ')[0]}
                          </span>
                          <span className="text-[8px] font-bold text-slate-300">
                            {data.label.split(' ')[1]}
                          </span>
                        </div>

                        {data.count === 0 && (
                          <div className="w-1 h-1 rounded-full bg-slate-200 mt-2" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="absolute left-0 right-0 bottom-12 h-px bg-slate-100" />
              </div>

              <div className="pt-12 text-center">
                <p className="text-xs font-medium text-slate-400 flex items-center justify-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Este gráfico reflete o status 'Contrato Encerrado' aplicado em cada mês específico.
                </p>
              </div>
            </div>
          </div>
        ) : activeTab === 'users' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <UserCog className="w-7 h-7 text-yellow-500" />
                  Gerenciamento de Usuários
                </h2>
                {loadingUsers && <p className="text-slate-500 text-sm">Carregando...</p>}
              </div>

              <div className="space-y-4">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-800 text-white rounded-xl flex items-center justify-center font-black text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{user.name}</p>
                        <p className="text-sm text-slate-500">{user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-slate-600">Ativo:</label>
                        <input
                          type="checkbox"
                          checked={user.active}
                          onChange={(e) => updateUser(user.id, { active: e.target.checked })}
                          className="w-4 h-4 text-yellow-600 bg-slate-100 border-slate-300 rounded focus:ring-yellow-500"
                        />
                      </div>

                      <select
                        value={user.role}
                        onChange={(e) => updateUser(user.id, { role: e.target.value as UserRole })}
                        className="px-3 py-1 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-yellow-500 outline-none"
                      >
                        <option value={UserRole.ADMIN}>Administrador</option>
                        <option value={UserRole.ASSISTANT}>Assistente</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </main>

      {isFormOpen && (
        <ClientForm
          onAdd={addClient}
          onUpdate={updateClient}
          onClose={() => {
            setIsFormOpen(false);
            setEditingClient(null);
          }}
          clientToEdit={editingClient}
          nextSequence={editingClient ? undefined : getNextSequenceForMonth(new Date().toISOString().slice(0, 7))}
        />
      )}

      <footer className="py-10 border-t border-slate-200 bg-white mt-auto">
        <div className="max-w-[1600px] mx-auto px-4 text-center">
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">
            RNV Consultoria Financeira &copy; {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
