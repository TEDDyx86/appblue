'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import {
  Settings,
  ShieldCheck,
  Database,
  Cloud,
  Briefcase,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  User,
  Sliders,
  Sparkles,
  Sun,
  Moon,
  Users,
  UserPlus,
  Trash2,
  X,
  Lock,
  Mail,
  Shield,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface SystemStatus {
  supabase?: { connected: boolean; detail: string }
  google_drive?: { connected: boolean; detail: string }
  pipedrive?: { connected: boolean; detail: string }
  scheduler?: { active: boolean; timezone: string }
}

interface UserItem {
  id: string
  email: string
  full_name: string
  role: string
  created_at: string
}

export default function SettingsPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testFeedback, setTestFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [user, setUser] = useState<any>(null)
  const [usersList, setUsersList] = useState<UserItem[]>([])

  // New User Modal State
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [newFullName, setNewFullName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member')
  const [creatingUser, setCreatingUser] = useState(false)
  const [userModalError, setUserModalError] = useState('')
  const [userModalSuccess, setUserModalSuccess] = useState('')
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const [statusRes, userRes] = await Promise.all([
        axios.get(`${API_URL}/api/system/status`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      setStatus(statusRes.data)
      setUser(userRes.data)

      // Se for admin, busca a lista de usuários
      if (userRes.data?.role === 'admin') {
        try {
          const usersRes = await axios.get(`${API_URL}/api/admin/users`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          setUsersList(usersRes.data.users || [])
        } catch (e) {
          console.error('Erro ao buscar lista de usuários:', e)
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTestIntegrations = async () => {
    try {
      setTesting(true)
      setTestFeedback(null)
      const token = localStorage.getItem('access_token')
      const res = await axios.post(
        `${API_URL}/api/webhooks/trigger-sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      await fetchSettings()
      setTestFeedback({
        type: 'success',
        message: res.data?.message || 'Conexões testadas e sincronizadas com sucesso!'
      })
      setTimeout(() => setTestFeedback(null), 6000)
    } catch (err: any) {
      setTestFeedback({
        type: 'error',
        message: 'Erro ao testar conexões: ' + (err.response?.data?.detail || err.message)
      })
    } finally {
      setTesting(false)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setUserModalError('')
    setUserModalSuccess('')

    if (!newFullName.trim() || !newEmail.trim() || !newPassword) {
      setUserModalError('Preencha todos os campos obrigatórios.')
      return
    }

    try {
      setCreatingUser(true)
      const token = localStorage.getItem('access_token')
      const res = await axios.post(
        `${API_URL}/api/admin/users`,
        {
          full_name: newFullName.trim(),
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          role: newRole,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )

      setUserModalSuccess('Usuário criado com sucesso!')
      setUsersList((prev) => [...prev, res.data.user])

      setTimeout(() => {
        setIsAddUserOpen(false)
        setNewFullName('')
        setNewEmail('')
        setNewPassword('')
        setNewRole('member')
        setUserModalSuccess('')
      }, 1200)
    } catch (err: any) {
      setUserModalError(err.response?.data?.detail || 'Erro ao criar novo usuário.')
    } finally {
      setCreatingUser(false)
    }
  }

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Tem certeza que deseja remover o acesso de ${userName}?`)) {
      return
    }

    try {
      setDeletingUserId(userId)
      const token = localStorage.getItem('access_token')
      await axios.delete(`${API_URL}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setUsersList((prev) => prev.filter((u) => u.id !== userId))
    } catch (err: any) {
      alert('Erro ao excluir usuário: ' + (err.response?.data?.detail || err.message))
    } finally {
      setDeletingUserId(null)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#00061A] flex transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={handleLogout}
        userName={user?.full_name}
        userEmail={user?.email}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? 'pl-20' : 'pl-64'
        }`}
      >
        {/* Header */}
        <header className="h-16 bg-white dark:bg-[#000D38] border-b border-slate-200/80 dark:border-[#002060] px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight font-display">
              Configurações & Gestão
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Controle de acessos, status dos serviços e parâmetros de negócio
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
              title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>

            <button
              onClick={handleTestIntegrations}
              disabled={testing}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Testando...' : 'Testar Conexões'}</span>
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="p-6 sm:p-8 space-y-8 max-w-5xl w-full mx-auto">
          {/* Section 1: Team & User Management (Exclusivo Admin) */}
          {user?.role === 'admin' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2 font-display">
                    <Users className="w-4 h-4 text-[#0092FF] dark:text-[#00FFFF]" />
                    <span>Equipe & Controle de Acessos</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Gerencie quem tem autorização para acessar o painel e o CRM
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(true)}
                  className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/20 transition-all self-start sm:self-auto"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>+ Novo Usuário</span>
                </button>
              </div>

              {/* Users Table / List */}
              <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-[#002060]">
                {usersList.map((u) => {
                  const isCurrent = u.id === user?.id
                  return (
                    <div
                      key={u.id}
                      className="p-4 sm:p-5 flex items-center justify-between gap-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-[#00061A]/50"
                    >
                      <div className="flex items-center space-x-3.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-xs">
                          {u.full_name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate font-display">
                              {u.full_name || 'Usuário'}
                            </h4>
                            {isCurrent && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60">
                                Você
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {u.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 flex-shrink-0">
                        <span
                          className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-lg border ${
                            u.role === 'admin'
                              ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60'
                              : 'bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#002060]'
                          }`}
                        >
                          {u.role === 'admin' ? 'Administrador' : 'Membro'}
                        </span>

                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u.id, u.full_name)}
                            disabled={deletingUserId === u.id}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                            title="Remover acesso"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Section 2: Integrations Status */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2 font-display">
                  <ShieldCheck className="w-4 h-4 text-[#0092FF] dark:text-[#00FFFF]" />
                  <span>Status das Integrações</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Saúde dos conectores que operam o fluxo de dados em tempo real
                </p>
              </div>

              <button
                type="button"
                onClick={handleTestIntegrations}
                disabled={testing}
                className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-[#0092FF] dark:text-[#00FFFF] font-bold text-xs hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all self-start sm:self-auto disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? 'Testando Conexões...' : 'Testar Conexões Agora'}</span>
              </button>
            </div>

            {testFeedback && (
              <div
                className={`p-3.5 rounded-2xl border text-xs flex items-center justify-between animate-fade-in ${
                  testFeedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  {testFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                  )}
                  <span className="font-semibold">{testFeedback.message}</span>
                </div>
                <button
                  onClick={() => setTestFeedback(null)}
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-slate-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Supabase */}
              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-start space-x-4">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800/60 flex-shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">Supabase (PostgreSQL)</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        status?.supabase?.connected
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60'
                      }`}
                    >
                      {status?.supabase?.connected ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {status?.supabase?.detail || 'Armazenamento e Row Level Security (RLS) ativos'}
                  </p>
                </div>
              </div>

              {/* Google Drive */}
              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-start space-x-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] rounded-xl border border-blue-200 dark:border-blue-800/60 flex-shrink-0">
                  <Cloud className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">Google Drive API</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        status?.google_drive?.connected
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60'
                      }`}
                    >
                      {status?.google_drive?.connected ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {status?.google_drive?.detail || 'Pasta "Briefing - Tactiq" monitorada via Service Account'}
                  </p>
                </div>
              </div>

              {/* Pipedrive */}
              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-start space-x-4">
                <div className="p-3 bg-indigo-50 dark:bg-blue-950/40 text-[#0092FF] rounded-xl border border-indigo-200 dark:border-blue-800/60 flex-shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">Pipedrive CRM (v1/v2)</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        status?.pipedrive?.connected
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60'
                      }`}
                    >
                      {status?.pipedrive?.connected ? 'Conectado' : 'Desconectado'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {status?.pipedrive?.detail || 'Robson Vieira Tavernard (Investimentos Blue)'}
                  </p>
                </div>
              </div>

              {/* Scheduler */}
              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-start space-x-4">
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl border border-amber-200 dark:border-amber-800/60 flex-shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">Job Scheduler (Cron)</h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        status?.scheduler?.active
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60'
                      }`}
                    >
                      {status?.scheduler?.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Consolidação diária de alertas às 7h00 ({status?.scheduler?.timezone || 'America/Sao_Paulo'})
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Business Parameters */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2 font-display">
                <Sliders className="w-4 h-4 text-[#0092FF] dark:text-[#00FFFF]" />
                <span>Parâmetros de Diagnóstico & Regras de Negócio</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Critérios para geração automática dos alertas
              </p>
            </div>

            <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm divide-y divide-slate-100 dark:divide-[#002060]">
              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">Limite de Estagnação (Negócio Parado)</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dias sem nenhuma atualização no Deal do Pipedrive antes de disparar alerta.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-slate-900 dark:text-white font-bold text-xs rounded-xl">
                  15 dias
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">Antecedência de Alerta do Teams</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dias antes do vencimento do follow-up para alertar sobre a falta do link da reunião.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-slate-900 dark:text-white font-bold text-xs rounded-xl">
                  2 dias
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">Prazo Padrão de Follow-up Sugerido</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dias úteis sugeridos pela IA para a próxima reunião de retorno após a conversa.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-slate-900 dark:text-white font-bold text-xs rounded-xl">
                  3 dias úteis
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">Confiança Mínima de Matching Automático</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Score mínimo para criação de Activity no Pipedrive sem requerer confirmação humana.
                  </p>
                </div>
                <span className="px-3 py-1 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-[#0092FF] dark:text-[#00FFFF] font-bold text-xs rounded-xl">
                  85% (0.85)
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: User Profile */}
          {user && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2 font-display">
                  <User className="w-4 h-4 text-[#0092FF] dark:text-[#00FFFF]" />
                  <span>Sessão & Usuário Conectado</span>
                </h2>
              </div>

              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">{user.full_name || 'Usuário'}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{user.email}</p>
                  <span className="inline-block mt-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060]">
                    Perfil: {user.role}
                  </span>
                </div>

                <button
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-100 transition-colors"
                >
                  Encerrar Sessão
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* CREATE NEW USER MODAL (ADMIN ONLY) */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#000D38] rounded-3xl max-w-md w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200/90 dark:border-[#002060]">
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] rounded-xl border border-blue-200 dark:border-blue-800/60">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                    Cadastrar Novo Usuário
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Apenas administradores podem criar acessos
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAddUserOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              {userModalError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs">
                  {userModalError}
                </div>
              )}

              {userModalSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  {userModalSuccess}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="Ex: Robson Vieira"
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  E-mail Corporativo
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="nome@investimentosblue.com.br"
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Senha Provisória
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none font-mono"
                    required
                    minLength={8}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Nível de Permissão
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole('member')}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all text-left ${
                      newRole === 'member'
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-[#0092FF] text-[#0092FF] dark:text-[#00FFFF]'
                        : 'bg-slate-50 dark:bg-[#00061A] border-slate-200 dark:border-[#002060] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <p>Membro</p>
                    <span className="text-[10px] font-normal text-slate-400 block mt-0.5">
                      Acesso a briefings e CRM
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewRole('admin')}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all text-left ${
                      newRole === 'admin'
                        ? 'bg-purple-50 dark:bg-purple-950/60 border-purple-500 text-purple-700 dark:text-purple-300'
                        : 'bg-slate-50 dark:bg-[#00061A] border-slate-200 dark:border-[#002060] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <p>Administrador</p>
                    <span className="text-[10px] font-normal text-slate-400 block mt-0.5">
                      Acesso total + gerenciar equipe
                    </span>
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-[#002060] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-5 py-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                >
                  {creatingUser ? 'Cadastrando...' : 'Criar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
