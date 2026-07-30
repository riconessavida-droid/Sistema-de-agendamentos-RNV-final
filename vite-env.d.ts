// Tipos das variáveis de ambiente do Vite.
//
// O tsconfig usa `types: ["node"]`, o que impede o `vite/client` de entrar
// sozinho — por isso a declaração é manual. Sem isso, todo acesso a
// `import.meta.env` vira erro de tipo (era o caso do supabaseClient.ts).

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
