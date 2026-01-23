
import React, { useState } from 'react';
import { User, UserRole } from './types';
import { 
  TrendingUp, 
  Mail, 
  Lock, 
  User as UserIcon, 
  ShieldCheck, 
  ArrowRight,
  ChevronDown,
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
  const [role, setRole] = useState<UserRole>(UserRole.ADMIN); // Padrão como Admin para facilitar
  const [error, setError] = useState('');

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const storedUsers = JSON.parse(localStorage.getItem('rnv_users') || '[]');

    if (isLogin) {
      const user = storedUsers.find((u: User) => u.email === email && u.password === password);
      if (user) {
        onLogin(user);
      } else {
        setError('E-mail ou senha incorretos.');
      }
    } else {
      if (storedUsers.some((u: User) => u.email === email)) {
        setError('Este e-mail já está cadastrado.');
        return;
      }

      if (!name) {
        setError('Por favor, informe seu nome.');
        return;
      }

      const newUser: User = {
        id: crypto.randomUUID(),
        name,
        email,
        password,
        role
      };

      const updatedUsers = [...storedUsers, newUser];
      localStorage.setItem('rnv_users', JSON.stringify(updatedUsers));
      onLogin(newUser);
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
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-yellow-500/30 transition-all active:scale-[0.97] flex items-center justify-center gap-3 mt-4"
            >
              {isLogin ? 'Entrar no Sistema' : 'Finalizar Cadastro'}
              <ArrowRight className="w-4 h-4" />
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
