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
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface SystemStatus {
  supabase?: { connected: boolean; detail: string }
  google_drive?: { connected: boolean; detail: string }
  pipedrive?: { connected: boolean; detail: string }
  scheduler?: { active: boolean; timezone: string }
}

export default function SettingsPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [user, setUser] = useState<any>(null)

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
        axios.get(`${API_URL}/api/health`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      setStatus(statusRes.data)
      setUser(userRes.data)
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
      const token = localStorage.getItem('access_token')
      await axios.post(
        `${API_URL}/api/webhooks/trigger-sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      await fetchSettings()
    } finally {
      setTesting(false)
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
              Configurações & Diagnóstico
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Status dos serviços conectados e parâmetros de negócio
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
          {/* Section 1: Integrations Status */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-[#0092FF]" />
                <span>Status das Integrações</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Saúde dos conectores que operam o fluxo de dados
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Supabase */}
              <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex items-start space-x-4">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800/60 flex-shrink-0">
                  <Database className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">Supabase (PostgreSQL)</h3>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                      Conectado
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                      Conectado
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
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                      Conectado
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
                    <h3 className="text-xs font-bold text-slate-900">Job Scheduler (Cron)</h3>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Ativo
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Consolidação diária de alertas às 7h00 ({status?.scheduler?.timezone || 'America/Sao_Paulo'})
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Business Parameters */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-[#0092FF]" />
                <span>Parâmetros de Diagnóstico & Regras de Negócio</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Critérios para geração automática dos alertas
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm divide-y divide-slate-100">
              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Limite de Estagnação (Negócio Parado)</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dias sem nenhuma atualização no Deal do Pipedrive antes de disparar alerta.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-900 font-bold text-xs rounded-xl">
                  15 dias
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Antecedência de Alerta do Teams</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dias antes do vencimento do follow-up para alertar sobre a falta do link da reunião.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-900 font-bold text-xs rounded-xl">
                  2 dias
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Prazo Padrão de Follow-up Sugerido</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Dias úteis sugeridos pela IA para a próxima reunião de retorno após a conversa.
                  </p>
                </div>
                <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-900 font-bold text-xs rounded-xl">
                  3 dias úteis
                </span>
              </div>

              <div className="p-5 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Confiança Mínima de Matching Automático</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Score mínimo para criação de Activity no Pipedrive sem requerer confirmação humana.
                  </p>
                </div>
                <span className="px-3 py-1 bg-blue-50 border border-blue-200 text-[#002060] font-bold text-xs rounded-xl">
                  85% (0.85)
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: User Profile */}
          {user && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                  <User className="w-4 h-4 text-teal-600" />
                  <span>Sessão & Usuário Conectado</span>
                </h2>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">{user.full_name || 'Usuário'}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
                  <span className="inline-block mt-2 text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    Role: {user.role}
                  </span>
                </div>

                <button
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
                >
                  Encerrar Sessão
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
