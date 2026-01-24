import React, { useState, useEffect } from 'react';
import { User, UserRole } from './types';
import { supabase } from './supabaseClient';
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
  const [role, setRole] = useState<UserRole>(UserRole.ADMIN);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Verificar se já está logado (quando recarrega a página)
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await loadUserProfile(user.id);
      }
    };
    checkUser();
  }, []);

  const loadUserProfile = async (userId: string) => {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setError('Erro ao validar login. Tente novamente.')
      return
    }

    // 1) Tenta carregar profile
    const { data: profile, error: profileFetchError } = await supabase
      .from('profiles')
      .select('id,name,role,active')
      .eq('id', userId)
      .single()

    // 2) Se não existir profile, tenta criar automaticamente
    if (profileFetchError || !profile) {
      const fallbackName =
        (authData.user.user_metadata?.name as string) ||
        (authData.user.email ? authData.user.email.split('@')[0] : 'Usuário')

      const { error: profileInsertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          name: fallbackName,
          role: UserRole.ASSISTANT, // Sempre ASSISTANT por padrão
          active: true
        })

      if (profileInsertError) {
        console.error('Erro insert profiles:', profileInsertError)
        setError('Erro no perfil. Avise o administrador para liberar seu acesso.')
        return
      }

      // tenta buscar de novo
      const { data: profile2, error: profileFetchError2
