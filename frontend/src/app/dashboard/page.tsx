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
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: string
}

export default function DashboardPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [user, setUser] = useState<UserProfile | null>(null)
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

      // Fetch alerts & user info concurrently
      const [alertsRes, userRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/alerts`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { resolved: false },
        }),
        axios.get(`${API_URL}/api/auth/me`, {
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

    // Auto-refresh a cada 30 segundos
    const interval = setInterval(() => {
      fetchData()
    }, 30000)

    return () => clearInterval(interval)
  }, [fetchData])

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
      // Atualiza lista após resolução
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
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Carregando painel operacional...</p>
          <p className="text-xs text-slate-400">Verificando Pipedrive e Google Drive</p>
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

      {/* Main Content Area with adaptive left margin */}
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
              <span>Integrado ao Pipedrive</span>
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
                {isRefreshing ? 'Sincronizando...' : `Último sync: ${lastSyncTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
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
          {/* Welcome Message */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
                Olá, {user?.full_name?.split(' ')[0] || 'Robson'} 👋
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Aqui está o status das reuniões pós-Meet e pendências no CRM Pipedrive.
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
