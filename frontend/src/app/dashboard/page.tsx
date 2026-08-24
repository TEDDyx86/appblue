'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
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
  Search,
  X,
  Clock,
  Eye,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: string
}

interface DealItem {
  id: string
  title: string
  person_name: string
  stage_id: number
  stage_name: string
  value: number
  update_time: string
  days_inactive: number
  next_activity_date: string | null
  is_stagnant: boolean
  is_overdue: boolean
  deal_url: string
}

interface PipelineSummary {
  pipeline_id: number
  pipeline_name: string
  total_deals: number
  total_value: number
  stages_breakdown: Record<string, number>
  stagnant_count: number
  overdue_count: number
  deals?: DealItem[]
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

  // Deals Modal state
  const [isDealsModalOpen, setIsDealsModalOpen] = useState(false)
  const [dealsSearch, setDealsSearch] = useState('')
  const [selectedStageFilter, setSelectedStageFilter] = useState('all')
  const [dealsSortBy, setDealsSortBy] = useState<'recent_update' | 'oldest_update' | 'highest_value' | 'stagnant_days' | 'title_az'>('recent_update')

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

  const filteredDeals = useMemo(() => {
    if (!pipelineSummary?.deals) return []
    const list = pipelineSummary.deals.filter((d) => {
      if (selectedStageFilter !== 'all' && d.stage_name !== selectedStageFilter) return false
      if (dealsSearch.trim()) {
        const q = dealsSearch.toLowerCase().trim()
        const title = (d.title || '').toLowerCase()
        const person = (d.person_name || '').toLowerCase()
        const idStr = String(d.id)
        if (!title.includes(q) && !person.includes(q) && !idStr.includes(q)) return false
      }
      return true
    })

    return list.sort((a, b) => {
      if (dealsSortBy === 'recent_update') {
        return new Date(b.update_time || 0).getTime() - new Date(a.update_time || 0).getTime()
      }
      if (dealsSortBy === 'oldest_update') {
        return new Date(a.update_time || 0).getTime() - new Date(b.update_time || 0).getTime()
      }
      if (dealsSortBy === 'stagnant_days') {
        return (b.days_inactive || 0) - (a.days_inactive || 0)
      }
      if (dealsSortBy === 'highest_value') {
        return (b.value || 0) - (a.value || 0)
      }
      if (dealsSortBy === 'title_az') {
        return (a.title || '').localeCompare(b.title || '')
      }
      return 0
    })
  }, [pipelineSummary?.deals, selectedStageFilter, dealsSearch, dealsSortBy])

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

                {/* Pipeline KPI Pills & Direct Actions */}
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
                    className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPipeline ? 'animate-spin' : ''}`} />
                    <span>{isSyncingPipeline ? 'Varrendo CRM...' : 'Sincronizar CRM'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsDealsModalOpen(true)}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors shadow-xs"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#0092FF] dark:text-[#00FFFF]" />
                    <span>Ver Negócios (Deals)</span>
                  </button>
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
                    <span>Distribuição de Negócios por Etapa (Clique para filtrar):</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(pipelineSummary.stages_breakdown).map(([stageName, count]) => (
                      <button
                        key={stageName}
                        type="button"
                        onClick={() => {
                          setSelectedStageFilter(stageName)
                          setIsDealsModalOpen(true)
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-100/80 hover:bg-blue-50 dark:bg-[#00061A] dark:hover:bg-[#002060] border border-slate-200/80 dark:border-[#002060] text-[11px] flex items-center space-x-1.5 transition-colors group cursor-pointer"
                        title={`Ver ${count} negócios em ${stageName}`}
                      >
                        <span className="text-slate-600 dark:text-slate-300 group-hover:text-[#0092FF]">{stageName}:</span>
                        <span className="font-bold text-slate-900 dark:text-[#00FFFF]">{count}</span>
                      </button>
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

      {/* MODAL DE NEGÓCIOS ESPECÍFICOS DO FUNIL COMERCIAL */}
      {isDealsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#000D38] rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-[#002060] overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] rounded-xl border border-blue-200 dark:border-blue-800/60">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                    Negócios do Funil Comercial
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {filteredDeals.length} de {pipelineSummary?.total_deals || 0} negócios exibidos &bull; Clique para abrir o Deal diretamente no Pipedrive
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDealsModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={dealsSearch}
                  onChange={(e) => setDealsSearch(e.target.value)}
                  placeholder="Filtrar por cliente, título ou ID do deal..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none transition-all"
                />
                {dealsSearch && (
                  <button
                    onClick={() => setDealsSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    &times;
                  </button>
                )}
              </div>

              {/* Ordenação por Data / Atualização */}
              <select
                value={dealsSortBy}
                onChange={(e) => setDealsSortBy(e.target.value as any)}
                className="w-full sm:w-52 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                title="Ordenar negócios"
              >
                <option value="recent_update">📅 Mais Recentes (Update ↓)</option>
                <option value="oldest_update">⏳ Mais Antigos (Update ↑)</option>
                <option value="stagnant_days">⚠️ Mais Dias Parado</option>
                <option value="highest_value">💰 Maior Valor (R$)</option>
                <option value="title_az">🔤 Nome do Negócio (A-Z)</option>
              </select>

              <select
                value={selectedStageFilter}
                onChange={(e) => setSelectedStageFilter(e.target.value)}
                className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
              >
                <option value="all">Todas as Etapas</option>
                {pipelineSummary?.stages_breakdown &&
                  Object.keys(pipelineSummary.stages_breakdown).map((s) => (
                    <option key={s} value={s}>
                      {s} ({pipelineSummary.stages_breakdown[s]})
                    </option>
                  ))}
              </select>
            </div>

            {/* Deals List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#002060] p-2">
              {filteredDeals.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Nenhum negócio encontrado com os filtros aplicados.
                </div>
              ) : (
                filteredDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className="p-3.5 sm:p-4 rounded-xl flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 font-mono">
                          Deal #{deal.id}
                        </span>

                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060]">
                          {deal.stage_name}
                        </span>

                        {deal.value > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            {deal.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        )}

                        {deal.is_stagnant && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
                            Parado há {deal.days_inactive}d
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate font-display">
                        {deal.title}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Cliente: <span className="font-semibold text-slate-700 dark:text-slate-300">{deal.person_name}</span>
                        {deal.next_activity_date && (
                          <span className="ml-2 inline-flex items-center text-slate-400">
                            &bull; Próx. Atividade: {deal.next_activity_date}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Direct Button to Specific Deal */}
                    <a
                      href={deal.deal_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-sm shadow-blue-500/20 transition-all flex-shrink-0"
                      title={`Abrir Deal #${deal.id} diretamente no Pipedrive`}
                    >
                      <span>Abrir Deal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Pipedrive Blue3 &bull; Funil Comercial
              </span>
              <button
                type="button"
                onClick={() => setIsDealsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
