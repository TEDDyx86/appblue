'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import AlertsPanel, { Alert } from '@/components/AlertsPanel'
import StatsCards, { Stats } from '@/components/StatsCards'
import RecentTranscriptions from '@/components/RecentTranscriptions'
import {
  RefreshCw,
  Bell,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Sun,
  Moon,
  TrendingUp,
  DollarSign,
  Briefcase,
  AlertTriangle,
  ExternalLink,
  Zap,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: string
}

interface PipelineSummary {
  pipeline_id: number
  pipeline_name: string
  total_deals: number
  total_value: number
  stages_breakdown: Record<string, number>
  stagnant_count: number
  overdue_count: number
}

export default function DashboardPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [user, setUser] = useState<UserProfile | null>(null)
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null)
  const [isSyncingPipeline, setIsSyncingPipeline] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats>({
    total_alerts: 0,
    negocio_parado: 0,
    follow_up_atrasado: 0,
    teams_pendente: 0,
  })
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date())
  const [error, setError] = useState('')

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const fetchData = useCallback(async (isManual = false) => {
    try {
      if (isManual) setIsRefreshing(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      // Fetch alerts, user info & pipeline summary concurrently
      const [alertsRes, userRes, pipelineRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/alerts`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { resolved: false },
        }),
        axios.get(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/api/pipedrive/pipeline/comercial/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (alertsRes.status === 'fulfilled') {
        const alertsData: Alert[] = alertsRes.value.data
        setAlerts(alertsData)

        setStats({
          total_alerts: alertsData.length,
          negocio_parado: alertsData.filter((a) => a.alert_type === 'negocio_parado').length,
          follow_up_atrasado: alertsData.filter((a) => a.alert_type === 'follow_up_atrasado').length,
          teams_pendente: alertsData.filter((a) => a.alert_type === 'teams_pendente').length,
        })
        setError('')
      } else {
        const err: any = alertsRes.reason
        if (err.response?.status === 401) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          router.push('/login')
          return
        }
        setError('Não foi possível carregar os alertas em tempo real.')
      }

      if (userRes.status === 'fulfilled') {
        setUser(userRes.value.data)
      }

      if (pipelineRes.status === 'fulfilled') {
        setPipelineSummary(pipelineRes.value.data)
      }

      setLastSyncTime(new Date())
    } catch (err) {
      console.error('Erro na sincronização:', err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [API_URL, router])

  useEffect(() => {
    fetchData()

    // Auto-refresh a cada 45 segundos
    const interval = setInterval(() => {
      fetchData()
    }, 45000)

    return () => clearInterval(interval)
  }, [fetchData])

  const handleSyncPipeline = async () => {
    try {
      setIsSyncingPipeline(true)
      setSyncFeedback(null)
      const token = localStorage.getItem('access_token')
      const res = await axios.post(
        `${API_URL}/api/pipedrive/pipeline/comercial/sync-alerts`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSyncFeedback(`Sincronizado! ${res.data.alerts_created} novos alertas e ${res.data.alerts_updated} atualizados.`)
      await fetchData()
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err: any) {
      setSyncFeedback('Erro ao sincronizar CRM: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSyncingPipeline(false)
    }
  }

  const handleResolve = async (alertId: string) => {
    try {
      const token = localStorage.getItem('access_token')
      await axios.patch(
        `${API_URL}/api/alerts/${alertId}`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      fetchData()
    } catch (err) {
      console.error('Erro ao resolver alerta:', err)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    router.push('/login')
  }

  if (loading && alerts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#00061A]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">Carregando painel operacional...</p>
          <p className="text-xs text-slate-400">Conectando ao Pipedrive (Funil Comercial) e Google Drive</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#00061A] flex transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={handleLogout}
        userName={user?.full_name || 'Robson Vieira'}
        userEmail={user?.email || 'robson.vieira@investimentosblue.com.br'}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? 'pl-20' : 'pl-64'
        }`}
      >
        {/* Top Header Bar */}
        <header className="h-16 bg-white dark:bg-[#000D38] border-b border-slate-200/80 dark:border-[#002060] px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
          <div className="flex items-center space-x-3">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display tracking-tight">
              Visão Operacional
            </h1>
            <span className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Funil Comercial Ativo</span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Sync Status Button */}
            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
              title="Sincronizar dados agora"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#0092FF]' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">
                {isRefreshing ? 'Sincronizando...' : `Sync: ${lastSyncTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
              </span>
            </button>

            {/* Quick Theme Toggle in Header */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
              title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>

            {/* Date Badge */}
            <div className="hidden md:flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#00061A] border border-transparent dark:border-[#002060] font-medium">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {new Date().toLocaleDateString('pt-BR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            </div>
          </div>
        </header>

        {/* Dashboard Body */}
        <main className="p-6 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Welcome & Overview Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
                Olá, {user?.full_name?.split(' ')[0] || 'Robson'} 👋
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Monitoramento contínuo do Funil Comercial (Pipedrive) & Briefings do Google Drive.
              </p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => fetchData(true)}
                className="underline font-semibold hover:text-rose-900 ml-2"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* Interactive Stats Cards */}
          <StatsCards
            stats={stats}
            activeFilter={activeFilter}
            onSelectFilter={(filterType) => setActiveFilter(filterType)}
          />

          {/* COMMERCIAL PIPELINE HIGHLIGHT BANNER */}
          {pipelineSummary && (
            <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-5 shadow-sm relative overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start space-x-3.5">
                  <div className="p-3 bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white rounded-xl shadow-md shadow-[#0092FF]/20 flex-shrink-0">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                        Funil Comercial (Pipedrive)
                      </h3>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60">
                        Pipeline #1
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Robson Vieira &bull; Planejamento Patrimonial e Sucessório
                    </p>
                  </div>
                </div>

                {/* Pipeline KPI Pills */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060]">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Negócios Abertos</span>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white font-display">
                      {pipelineSummary.total_deals} deals
                    </span>
                  </div>

                  <div className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">Volume em Pipeline</span>
                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 font-display">
                      {pipelineSummary.total_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </div>

                  <button
                    onClick={handleSyncPipeline}
                    disabled={isSyncingPipeline}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPipeline ? 'animate-spin' : ''}`} />
                    <span>{isSyncingPipeline ? 'Varrendo CRM...' : 'Sincronizar Funil'}</span>
                  </button>

                  <a
                    href="https://investimentosblue.pipedrive.com/pipeline/1"
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
                    title="Abrir Funil Comercial no Pipedrive"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Sync Feedback Message */}
              {syncFeedback && (
                <div className="mt-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 text-xs text-[#0092FF] dark:text-[#00FFFF] font-medium flex items-center space-x-2">
                  <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{syncFeedback}</span>
                </div>
              )}

              {/* Stages Bar */}
              {pipelineSummary.stages_breakdown && Object.keys(pipelineSummary.stages_breakdown).length > 0 && (
                <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-[#002060]/70">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center space-x-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#0092FF]" />
                    <span>Distribuição de Negócios por Etapa:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(pipelineSummary.stages_breakdown).map(([stageName, count]) => (
                      <div
                        key={stageName}
                        className="px-2.5 py-1 rounded-lg bg-slate-100/80 dark:bg-[#00061A] border border-slate-200/80 dark:border-[#002060] text-[11px] flex items-center space-x-1.5"
                      >
                        <span className="text-slate-600 dark:text-slate-300">{stageName}:</span>
                        <span className="font-bold text-slate-900 dark:text-[#00FFFF]">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Alerts Panel - 2 cols */}
            <div className="lg:col-span-2">
              <AlertsPanel
                alerts={alerts}
                onResolve={handleResolve}
                selectedTypeFilter={activeFilter}
                onTypeFilterChange={(filterType) => setActiveFilter(filterType)}
              />
            </div>

            {/* Recent Transcriptions - 1 col */}
            <div className="lg:col-span-1 h-full">
              <RecentTranscriptions />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
