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

  const [checklistMonth, setChecklistMonth] = useState<string>(() => {
    const now = new Date();
    return toMonthKey(now);
  });
  const [checklistSubFilter, setChecklistSubFilter] = useState<ChecklistSubFilter>('all');

  // ✅ CORREÇÃO 2: Planilha começa no mês atual (com meses anteriores disponíveis)
  const [visibleMonths, setVisibleMonths] = useState<string[]>(() => {
    const now = new Date();
    const months: string[] = [];
    // 12 meses para trás + mês atual + 12 meses para frente
    for (let i = -12; i &lt;= 12; i++) {
      months.push(toMonthKey(addMonths(now, i)));
    }
    return months;
  });

  const monthsScrollRef = useRef<HTMLDivElement | null>(null);

  // ✅ CORREÇÃO 2: Scroll automático para o mês atual (funciona sempre)
  useEffect(() => {
    if (activeTab !== 'overview') return;
    const container = monthsScrollRef.current;
    if (!container) return;

    const nowKey = toMonthKey(new Date());
    const idx = visibleMonths.indexOf(nowKey);
    if (idx === -1) return;

    // Largura fixa de cada coluna de mês (240px)
    const monthColWidth = 240;
    const targetLeft = idx * monthColWidth - Math.max(0, container.clientWidth / 2 - monthColWidth / 2);

    const run = () => {
      container.scrollLeft = Math.max(0, targetLeft);
    };

    run();
    const t = window.setTimeout(run, 300);
    return () => window.clearTimeout(t);
  }, [activeTab, visibleMonths]);

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
    delete (sessionUser as any).password;
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

  const updateUser = async (userId: string, updates: Partial&lt;{ role: UserRole; active: boolean }>) => {
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
    const month4 = cycleMonths[3]; // 4ª reunião
    const nowKey = toMonthKey(new Date());

    return nowKey >= month4;
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
    updates: Partial&lt;{ status: MeetingStatus; customDate?: number }>
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
    }, [] as
