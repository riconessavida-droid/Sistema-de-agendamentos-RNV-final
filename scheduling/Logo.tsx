import React from 'react';

// A logo da RNV desenhada em SVG (em vez de um PNG): escala sem borrar em
// qualquer tela, não pesa no carregamento e serve também de favicon.
export const RNV_GREEN = '#0F4C3E';
export const RNV_YELLOW = '#F0B429';

interface LogoMarkProps {
  size?: number;
  className?: string;
  /** true = fundo verde com barras amarelas; false = só as barras verdes. */
  filled?: boolean;
}

/** O símbolo quadrado, sem o texto. */
export function LogoMark({ size = 40, className = '', filled = true }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="RNV Consultoria Financeira"
    >
      {filled && <rect width="100" height="100" rx="24" fill={RNV_GREEN} />}
      <g fill={filled ? RNV_YELLOW : RNV_GREEN}>
        <rect x="26" y="55" width="11" height="18" rx="3.5" />
        <rect x="44.5" y="42" width="11" height="31" rx="3.5" />
        <rect x="63" y="26" width="11" height="47" rx="3.5" />
      </g>
    </svg>
  );
}

interface LogoProps {
  /** 'light' = para fundo claro; 'dark' = para fundo escuro. */
  tone?: 'light' | 'dark';
  className?: string;
}

/** Logo completa: símbolo + "RNV" + "CONSULTORIA FINANCEIRA". */
export function Logo({ tone = 'light', className = '' }: LogoProps) {
  const isDark = tone === 'dark';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoMark size={44} />
      <div className="leading-none">
        <div
          className="text-2xl font-black tracking-tight"
          style={{ color: isDark ? '#FFFFFF' : RNV_GREEN }}
        >
          RNV
        </div>
        <div
          className="text-[9px] font-medium tracking-[0.2em] mt-1"
          style={{ color: isDark ? 'rgba(255,255,255,0.65)' : '#8A8A8A' }}
        >
          CONSULTORIA FINANCEIRA
        </div>
      </div>
    </div>
  );
}
