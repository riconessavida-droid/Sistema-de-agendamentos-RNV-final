import React, { useState, useEffect } from 'react';
import { User, UserRole } from './types';
import { supabase } from './supabaseClient';
import {
  TrendingUp,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  UserCheck,
  ShieldAlert
} from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.ASSISTANT); // Forçado para ASSISTANT
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) console.error('Erro Supabase getUser:', error);

      if (user) {
        await loadUserProfile(user.id, user.email || '');
      }
    };
    checkUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserProfile = async (userId: string, emailFallback = '') => {
    // 1) tenta carregar profile
    const { data: profile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id,name,role,active')
      .eq('id', userId)
      .single();

    // 2) se não existir profile, cria automaticamente
    if (profileFetchError || !profile) {
      const fallbackName =
        (emailFallback ? emailFallback.split('@')[0] : 'Usuário');

      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          name: fallbackName,
          role: UserRole.ASSISTANT, // Nunca cria ADMIN automaticamente
          active: true
        });

      if (profileInsertError) {
        console.error('Erro Supabase insert profiles:', profileInsertError);
        setError(profileInsertError.message || 'Erro no perfil. Fale com o administrador.');
        return;
      }

      // busca de novo após criar
      const { data: profile2, error: profileFetchError2 } = await supabase
        .from('profiles')
        .select('id,name,role,active')
        .eq('id', userId)
        .single();

      if (profileFetchError2 || !profile2) {
        console.error('Erro Supabase select profiles após insert:', profileFetchError2);
        setError(profileFetchError2?.message || 'Erro ao carregar perfil. Tente novamente.');
        return;
      }

      if (!profile2.active) {
        setError('Sua conta foi desativada. Entre em contato com o administrador.');
        await supabase.auth.signOut();
        return;
      }

      onLogin({
        id: userId,
        name: profile2.name || fallbackName,
        email: emailFallback,
        password: '',
        role: (profile2.role as UserRole) || UserRole.ASSISTANT
      });
      return;
    }

    // 3) profile existe: valida
    if (!profile.active) {
      setError('Sua conta foi desativada. Entre em contato com o administrador.');
      await supabase.auth.signOut();
      return;
    }

    onLogin({
      id: userId,
      name: profile.name || (emailFallback ? emailFallback.split('@')[0] : ''),
      email: emailFallback,
      password: '',
      role: (profile.role as UserRole) || UserRole.ASSISTANT
    });
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        // LOGIN
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) {
          console.error('Erro Supabase signIn:', error);
          setError(error.message); // Mostra erro real
          return;
        }

        if (data.user) {
          await loadUserProfile(data.user.id, data.user.email || email);
        } else {
          setError('Login não retornou usuário. Tente novamente.');
        }
      } else {
        // CADASTRO
        if (!name) {
          setError('Por favor, informe seu nome.');
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name,
              role: UserRole.ASSISTANT // Força ASSISTANT sempre
            }
          }
        });

        if (error) {
          console.error('Erro Supabase signUp:', error);
          setError(error.message); // Mostra erro real
          return;
        }

        if (data.user && data.session) {
          // Sessão criada: entra direto
          await loadUserProfile(data.user.id, data.user.email || email);
        } else {
          // Sem sessão (ex.: confirmação de e-mail ligada)
          setError('Conta criada. Verifique seu e-mail para confirmar e depois faça login.');
        }
      }
    } catch (err) {
      console.error('Erro inesperado:', err);
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-yellow-500 rounded-2xl shadow-lg mb-4">
            <TrendingUp className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">RNV Consultoria</h1>
          <p className="text-slate-500 font-medium text-sm">Gestão Financeira Estratégica</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
          <div className="flex border-b bg-slate-50/50">
            <button
              onClick={() => { setIsLogin(true); setError(''); }}
              className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all ${isLogin ? 'text-yellow-600 bg-white border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Entrar
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); }}
              className={`flex-1 py-4 text-xs font-black uppercase tracking-widest transition-all ${!isLogin ? 'text-yellow-600 bg-white border-b-2 border-yellow-500' : 'text-slate-400 hover:text-slate-600'}`}
            >
              Novo Cadastro
            </button>
          </div>

          <form onSubmit={handleAuth} className="p-8 space-y-5">
            {error && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-black rounded-xl text-center uppercase tracking-wider">
                {error}
              </div>
            )}

            {!isLogin && (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Nome Completo</label>
                  <div className="relative">
                    <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      required
                      type="text"
                      className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-yellow-500/10 focus:border-yellow-500 transition-all text-sm font-bold text-slate-700"
                      placeholder="Ex: João Silva"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Selecione seu Perfil</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole(UserRole.ADMIN)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all ${role === UserRole.ADMIN ? 'border-yellow-500 bg-yellow-50 text-yellow-700 shadow-md ring-2 ring-yellow-500/20' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'}`}
                    >
                      <ShieldAlert className={`w-6 h-6 ${role === UserRole.ADMIN ? 'text-yellow-500' : 'text-slate-300'}`} />
                      <span className="text-[10px] font-black uppercase tracking-tighter">Administrador</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole(UserRole.ASSISTANT)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all ${role === UserRole.ASSISTANT ? 'border-yellow-500 bg-yellow-50 text-yellow-700 shadow-md ring-2 ring-yellow-500/20' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'}`}
                    >
                      <UserCheck className={`w-6 h-6 ${role === UserRole.ASSISTANT ? 'text-yellow-500' : 'text-slate-300'}`} />
                      <span className="text-[10px] font-black uppercase tracking-tighter">Assistente</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold">
                    Observação: por segurança, novos cadastros entram como <b>Assistente</b>. O Administrador é liberado pelo Supabase.
                  </p>
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">E-mail de Acesso</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  required
                  type="email"
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-yellow-500/10 focus:border-yellow-500 transition-all text-sm font-bold text-slate-700"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  required
                  type="password"
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-yellow-500/10 focus:border-yellow-500 transition-all text-sm font-bold text-slate-700"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-slate-400 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-yellow-500/30 transition-all active:scale-[0.97] flex items-center justify-center gap-3 mt-4"
            >
              {loading ? 'Carregando...' : (isLogin ? 'Entrar no Sistema' : 'Finalizar Cadastro')}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>
        </div>

        <p className="mt-8 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">
          RNV Consulting • Sistema Seguro
        </p>
      </div>
    </div>
  );
};
