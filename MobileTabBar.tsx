import {
  LayoutGrid, CalendarCheck, CheckSquare, CalendarClock, History,
  Link2, BarChart3, DollarSign, UserCog, Copy, ChevronRight, CircleUser
} from 'lucide-react';

/**
 * Navegação de rodapé, só no celular.
 *
 * As abas do topo funcionam bem no computador, mas no iPhone elas somem
 * para fora da tela e o polegar não alcança. Aqui viram uma barra fixa
 * embaixo, no padrão que o Eduardo já conhece do app dele: fundo
 * translúcido, rolagem lateral e um degradê na borda direita avisando que
 * há mais botões — sem isso ninguém descobre que dá para arrastar.
 */

export type TabId =
  | 'overview' | 'checklist' | 'tasks' | 'scheduling' | 'history'
  | 'conciliation' | 'reports' | 'billing' | 'users' | 'duplicates'
  | 'profile';

interface Aba {
  id: TabId;
  label: string;
  Icon: typeof LayoutGrid;
  /** Quantidade em destaque (conciliação pendente, duplicados). */
  badge?: number;
  /** Só o admin vê algumas. */
  adminOnly?: boolean;
}

const ABAS: Aba[] = [
  { id: 'overview',     label: 'Geral',      Icon: LayoutGrid },
  { id: 'tasks',        label: 'Hoje',       Icon: CheckSquare },
  { id: 'scheduling',   label: 'Agenda',     Icon: CalendarClock },
  { id: 'checklist',    label: 'Checklist',  Icon: CalendarCheck },
  { id: 'conciliation', label: 'Conciliar',  Icon: Link2 },
  { id: 'history',      label: 'Histórico',  Icon: History },
  { id: 'reports',      label: 'Relatórios', Icon: BarChart3,  adminOnly: true },
  { id: 'billing',      label: 'Faturas',    Icon: DollarSign, adminOnly: true },
  { id: 'users',        label: 'Usuários',   Icon: UserCog,    adminOnly: true },
  { id: 'duplicates',   label: 'Duplicados', Icon: Copy,       adminOnly: true },
  // Última de propósito: é onde ficam conta e notificações, coisas que se
  // ajustam uma vez e não se procura todo dia.
  { id: 'profile',      label: 'Perfil',     Icon: CircleUser }
];

interface MobileTabBarProps {
  activeTab: string;
  onChange: (tab: TabId) => void;
  isAdmin: boolean;
  pendingConciliation?: number;
  duplicates?: number;
}

export function MobileTabBar({
  activeTab,
  onChange,
  isAdmin,
  pendingConciliation = 0,
  duplicates = 0
}: MobileTabBarProps) {
  const visiveis = ABAS.filter(a => !a.adminOnly || isAdmin);

  const badgeDe = (id: TabId): number | undefined => {
    if (id === 'conciliation' && pendingConciliation > 0) return pendingConciliation;
    if (id === 'duplicates' && duplicates > 0) return duplicates;
    return undefined;
  };

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: 'rgba(255,255,255,0.94)',
        backdropFilter: 'blur(20px) saturate(1.6)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
        borderTop: '0.5px solid rgba(0,0,0,0.12)',
        // Respeita a faixa do "home indicator" do iPhone: sem isto, o
        // último botão fica embaixo da barrinha e não dá para tocar.
        paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}
    >
      <div className="relative">
        {/* Avisa que há mais botões para o lado. */}
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 flex items-center justify-end pr-1"
          style={{ width: 28, background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.96))' }}
        >
          <ChevronRight className="w-3 h-3 text-slate-300" />
        </div>

        <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex min-w-max px-1">
            {visiveis.map(({ id, label, Icon }) => {
              const ativo = activeTab === id;
              const badge = badgeDe(id);

              return (
                <button
                  key={id}
                  onClick={() => onChange(id)}
                  className={`relative min-w-[68px] flex flex-col items-center justify-center pt-2 pb-1.5 gap-1 transition-colors active:scale-95 ${
                    ativo ? 'text-yellow-600' : 'text-slate-400'
                  }`}
                >
                  <div
                    className={`w-8 h-8 flex items-center justify-center rounded-[10px] transition-all ${
                      ativo ? 'bg-yellow-50' : ''
                    }`}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-wide leading-none">
                    {label}
                  </span>

                  {badge !== undefined && (
                    <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
