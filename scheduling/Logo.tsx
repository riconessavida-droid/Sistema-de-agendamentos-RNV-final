import React from 'react';

// A logo da RNV desenhada em SVG (em vez de um PNG): escala sem borrar em
// qualquer tela, não pesa no carregamento e serve também de favicon.
//
// Cores da paleta oficial da marca.
export const RNV_GREEN = '#0E4C45';
export const RNV_YELLOW = '#F0B429';
export const RNV_INK = '#15201E';
export const RNV_OFFWHITE = '#F4F2EE';

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
          className="font-brand text-2xl font-extrabold tracking-tight"
          style={{ color: isDark ? '#FFFFFF' : RNV_GREEN }}
        >
          RNV
        </div>
        <div
          className="font-label text-[9px] tracking-[0.18em] mt-1.5"
          style={{ color: isDark ? 'rgba(255,255,255,0.65)' : '#8A8A8A' }}
        >
          CONSULTORIA FINANCEIRA
        </div>
      </div>
    </div>
  );
}
