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
  ShieldAlert,
  CheckCircle
} from 'lucide-react';

interface AuthProps {
  onLogin: (user: User) => void;
}

export const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.ASSISTANT);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Detecta quando o usuário chega pelo link de redefinição de senha
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsResetPassword(true);
        setIsForgotPassword(false);
        setError('');
        setSuccessMsg('');
      }
    });

    // Verifica se já há sessão ativa (login persistido)
    const checkUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) console.error('Erro Supabase getUser:', error);
      if (user) {
        await loadUserProfile(user.id, user.email || '');
      }
    };
    checkUser();

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUserProfile = async (userId: string, emailFallback = '') => {
    const { data: profile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id,name,role,active')
      .eq('id', userId)
      .single();

    if (profileFetchError || !profile) {
      const fallbackName = emailFallback ? emailFallback.split('@')[0] : 'Usuário';

      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          name: fallbackName,
          role: UserRole.ASSISTANT,
          active: true
        });

      if (profileInsertError) {
        console.error('Erro Supabase insert profiles:', profileInsertError);
        setError(profileInsertError.message || 'Erro no perfil. Fale com o administrador.');
        return;
      }

      const { data: profile2, error: profileFetchError2 } = await supabase
        .from('profiles')
        .select('id,name,role,active')
        .eq('id', userId)
        .single();

      if (profileFetchError2 || !profile2) {
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

  // --- HANDLER: Enviar e-mail de redefinição ---
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      if (error) {
        setError(error.message);
      } else {
        setSuccessMsg('E-mail de redefinição enviado! Verifique sua caixa de entrada.');
      }
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLER: Salvar nova senha ---
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem. Verifique e tente novamente.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setError(error.message);
      } else {
        setSuccessMsg('Senha redefinida com sucesso!');
        // Após 2s, volta para o login limpo
        setTimeout(() => {
          setIsResetPassword(false);
          setNewPassword('');
          setConfirmPassword('');
          setSuccessMsg('');
          setError('');
        }, 2000);
      }
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // --- HANDLER: Login / Cadastro ---
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); return; }
        if (data.user) {
          await loadUserProfile(data.user.id, data.user.email || email);
        } else {
          setError('Login não retornou usuário. Tente novamente.');
        }
      } else {
        if (!name) { setError('Por favor, informe seu nome.'); return; }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, role: UserRole.ASSISTANT } }
        });
        if (error) { setError(error.message); return; }
        if (data.user && data.session) {
          await loadUserProfile(data.user.id, data.user.email || email);
        } else {
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

  const pageWrapper = (subtitle: string, children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-yellow-500 rounded-2xl shadow-lg mb-4">
            <TrendingUp className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">RNV Consultoria</h1>
          <p className="text-slate-500 font-medium text-sm">{subtitle}</p>
        </div>
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
          {children}
        </div>
        <p className="mt-8 text-center text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">
          RNV Consulting • Sistema Seguro
        </p>
      </div>
    </div>
  );

  // ============================================================
  // TELA 1: CRIAR NOVA SENHA (chegou pelo link do e-mail)
  // ============================================================
  if (isResetPassword) {
    return pageWrapper('Criar Nova Senha', (
      <form onSubmit={handleResetPassword} className="p-8 space-y-5">
        <p className="text-xs text-slate-500 font-semibold text-center">
          Escolha uma nova senha para sua conta.
        </p>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-black rounded-xl text-center uppercase tracking-wider">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-[10px] font-black rounded-xl text-center uppercase tracking-wider flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" /> {successMsg}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Nova Senha</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              required
              type="password"
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-yellow-500/10 focus:border-yellow-500 transition-all text-sm font-bold text-slate-700"
              placeholder="Mínimo 6 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase ml-1 tracking-widest">Confirmar Nova Senha</label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              required
              type="password"
              className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-4 focus:ring-yellow-500/10 focus:border-yellow-500 transition-all text-sm font-bold text-slate-700"
              placeholder="Repita a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !!successMsg}
          className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-slate-400 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-yellow-500/30 transition-all active:scale-[0.97] flex items-center justify-center gap-3 mt-4"
        >
          {loading ? 'Salvando...' : 'Salvar Nova Senha'}
          {!loading && !successMsg && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>
    ));
  }

  // ============================================================
  // TELA 2: ESQUECEU A SENHA (solicitar e-mail)
  // ============================================================
  if (isForgotPassword) {
    return pageWrapper('Redefinir Senha', (
      <form onSubmit={handleForgotPassword} className="p-8 space-y-5">
        <p className="text-xs text-slate-500 font-semibold text-center">
          Informe o e-mail cadastrado. Vamos enviar um link para você criar uma nova senha.
        </p>

        {error && (
          <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-black rounded-xl text-center uppercase tracking-wider">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-[10px] font-black rounded-xl text-center uppercase tracking-wider flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" /> {successMsg}
          </div>
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

        <button
          type="submit"
          disabled={loading || !!successMsg}
          className="w-full bg-yellow-500 hover:bg-yellow-600 disabled:bg-slate-400 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-yellow-500/30 transition-all active:scale-[0.97] flex items-center justify-center gap-3 mt-4"
        >
          {loading ? 'Enviando...' : 'Enviar Link de Redefinição'}
          {!loading && !successMsg && <ArrowRight className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={() => { setIsForgotPassword(false); setError(''); setSuccessMsg(''); }}
          className="w-full text-slate-400 hover:text-slate-600 text-[10px] font-black uppercase tracking-widest py-2 transition-all"
        >
          ← Voltar para o Login
        </button>
      </form>
    ));
  }

  // ============================================================
  // TELA 3: LOGIN / CADASTRO
  // ============================================================
  return pageWrapper('Gestão Financeira Estratégica', (
    <>
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
          {isLogin && (
            <button
              type="button"
              onClick={() => { setIsForgotPassword(true); setError(''); setEmail(''); }}
              className="ml-1 text-[10px] text-yellow-600 hover:text-yellow-700 font-black uppercase tracking-wider transition-all"
            >
              Esqueceu a senha?
            </button>
          )}
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
    </>
  ));
};
