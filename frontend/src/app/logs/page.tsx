'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import { useTheme } from '@/context/ThemeContext'
import {
  Activity,
  Cloud,
  Briefcase,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  RefreshCw,
  Clock,
  User,
  Filter,
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Sun,
  Moon,
  ArrowUpRight,
} from 'lucide-react'

export interface AuditLog {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  user_id: string | null
  details: {
    doc_title?: string
    google_doc_id?: string
    cliente_nome?: string
    cliente_email?: string
    pipedrive_person_id?: string
    pipedrive_deal_id?: string
    pipedrive_activity_id?: string
    deal_url?: string
    person_url?: string
    proxima_acao?: string
    tactiq_link?: string
    summary?: string
    client_name?: string
    client_email?: string
    meeting_type?: string
    date?: string
    time?: string
    platform?: string
    alert_type?: string
    resolved_by?: string
    [key: string]: any
  }
  created_at: string
}

export interface LogStats {
  total_logs: number
  drive_updates: number
  pipedrive_assignments: number
  calendar_bookings: number
  alerts_actions: number
}

const actionConfig: Record<
  string,
  {
    label: string
    badgeClass: string
    iconClass: string
    icon: typeof Cloud
  }
> = {
  DRIVE_DOC_LINKED: {
    label: 'Drive → Vinculado no CRM',
    badgeClass: 'bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] border-blue-200 dark:border-blue-800/60',
    iconClass: 'text-[#0092FF] bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60',
    icon: Cloud,
  },
  DRIVE_DOC_UNLINKED: {
    label: 'Drive (Sem Vínculo no CRM)',
    badgeClass: 'bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#002060]',
    iconClass: 'text-slate-500 bg-slate-100 dark:bg-[#00061A] border-slate-200 dark:border-[#002060]',
    icon: FileText,
  },
  DRIVE_DOC_PROCESSED: {
    label: 'Drive Processado',
    badgeClass: 'bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] border-blue-200 dark:border-blue-800/60',
    iconClass: 'text-[#0092FF] bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60',
    icon: Cloud,
  },
  CALENDAR_BOOKING_CREATED: {
    label: 'Reunião Agendada',
    badgeClass: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
    iconClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60',
    icon: Calendar,
  },
  ALERT_RESOLVED: {
    label: 'Alerta Resolvido',
    badgeClass: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60',
    iconClass: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60',
    icon: CheckCircle2,
  },
}

export default function LogsPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [stats, setStats] = useState<LogStats>({
    total_logs: 0,
    drive_updates: 0,
    pipedrive_assignments: 0,
    calendar_bookings: 0,
    alerts_actions: 0,
  })
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'action_type'>('newest')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const [logsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/audit-logs`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { action: actionFilter !== 'all' ? actionFilter : undefined },
        }),
        axios.get(`${API_URL}/api/audit-logs/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      setLogs(logsRes.data || [])
      setStats(
        statsRes.data || {
          total_logs: 0,
          drive_updates: 0,
          pipedrive_assignments: 0,
          calendar_bookings: 0,
          alerts_actions: 0,
        }
      )
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }, [API_URL, actionFilter, router])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const filteredLogs = useMemo(() => {
    const list = logs.filter((log) => {
      if (!searchTerm.trim()) return true
      const q = searchTerm.toLowerCase()
      const details = log.details || {}
      const client = (details.cliente_nome || details.client_name || '').toLowerCase()
      const doc = (details.doc_title || '').toLowerCase()
      const summary = (details.summary || '').toLowerCase()
      const deal = (details.pipedrive_deal_id || '').toLowerCase()
      return client.includes(q) || doc.includes(q) || summary.includes(q) || deal.includes(q)
    })

    return list.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }
      if (sortBy === 'action_type') {
        return a.action.localeCompare(b.action)
      }
      return 0
    })
  }, [logs, searchTerm, sortBy])

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    router.push('/login')
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#00061A] flex transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={handleLogout}
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
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight font-display flex items-center space-x-2">
              <Activity className="w-5 h-5 text-[#0092FF]" />
              <span>Logs de Operações & Rastreabilidade</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Histórico de arquivos recebidos pelo Drive, atribuição de clientes e ações no Pipedrive
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
              title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>

            <button
              onClick={fetchLogs}
              disabled={loading}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0092FF]' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="p-6 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Logs */}
            <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/80 dark:border-[#002060] shadow-sm relative overflow-hidden group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase font-display">
                    Total de Eventos
                  </p>
                  <p className="text-2xl font-extrabold text-slate-900 dark:text-white font-display mt-2 tnum">
                    {stats.total_logs}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Operações auditadas</p>
                </div>
                <div className="p-3 bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white rounded-2xl shadow-[0_0_12px_rgba(0,146,255,0.3)]">
                  <Activity className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Drive Updates */}
            <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/80 dark:border-[#002060] shadow-sm relative overflow-hidden group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase font-display">
                    Drive Processados
                  </p>
                  <p className="text-2xl font-extrabold text-[#0092FF] dark:text-[#00FFFF] font-display mt-2 tnum">
                    {stats.drive_updates}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Briefings recebidos</p>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] rounded-2xl border border-blue-200 dark:border-blue-800/60">
                  <Cloud className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Pipedrive Assignments */}
            <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/80 dark:border-[#002060] shadow-sm relative overflow-hidden group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase font-display">
                    Clientes & Negócios
                  </p>
                  <p className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 font-display mt-2 tnum">
                    {stats.pipedrive_assignments}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Atribuídos no CRM</p>
                </div>
                <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-200 dark:border-indigo-800/60">
                  <Briefcase className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Calendar Bookings */}
            <div className="bg-white dark:bg-[#000D38] p-5 rounded-2xl border border-slate-200/80 dark:border-[#002060] shadow-sm relative overflow-hidden group">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase font-display">
                    Reuniões Agendadas
                  </p>
                  <p className="text-2xl font-extrabold text-amber-500 dark:text-amber-400 font-display mt-2 tnum">
                    {stats.calendar_bookings}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Via agendador público</p>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-950/50 text-amber-500 rounded-2xl border border-amber-200 dark:border-amber-800/60">
                  <Calendar className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="bg-white dark:bg-[#000D38] p-4 rounded-2xl border border-slate-200/80 dark:border-[#002060] shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 transition-colors">
            {/* Search Input & Sort Dropdown */}
            <div className="flex flex-col sm:flex-row items-center gap-3 flex-1">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por cliente, documento do Drive, ID do Deal..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#00061A] focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
                />
              </div>

              {/* Ordenação por Data / Mais Recente */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                title="Ordenar logs"
              >
                <option value="newest">📅 Mais Recentes (Data ↓)</option>
                <option value="oldest">⏳ Mais Antigos (Data ↑)</option>
                <option value="action_type">⚙️ Por Tipo de Evento</option>
              </select>
            </div>

            {/* Action Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'all', label: 'Todos os Logs' },
                { id: 'DRIVE_DOC_LINKED', label: 'Vinculados no CRM' },
                { id: 'DRIVE_DOC_UNLINKED', label: 'Não Vinculados / Internos' },
                { id: 'CALENDAR_BOOKING_CREATED', label: 'Agendamentos' },
                { id: 'ALERT_RESOLVED', label: 'Alertas' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActionFilter(f.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    actionFilter === f.id
                      ? 'bg-[#0092FF] text-white shadow-[0_0_12px_rgba(0,146,255,0.3)]'
                      : 'bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] border border-transparent dark:border-[#002060]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs Timeline Feed */}
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-9 h-9 border-3 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Carregando logs de auditoria...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-20 bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/80 dark:border-[#002060] text-center p-6 shadow-sm">
              <Activity className="w-12 h-12 mx-auto text-slate-400 mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Nenhum log encontrado
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                Não há registros com os filtros atuais. Quando novos arquivos forem recebidos pelo Drive ou reuniões agendadas, os logs aparecerão aqui automaticamente.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLogs.map((log) => {
                const config = actionConfig[log.action] || {
                  label: log.action,
                  badgeClass: 'bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#002060]',
                  iconClass: 'text-slate-600 bg-slate-100 dark:bg-[#00061A]',
                  icon: Activity,
                }
                const Icon = config.icon
                const details = log.details || {}
                const isExpanded = expandedIds.has(log.id)
                const clientName = details.cliente_nome || details.client_name
                const dealId = details.pipedrive_deal_id
                const personId = details.pipedrive_person_id
                const dealUrl = details.deal_url || (dealId ? `https://investimentosblue.pipedrive.com/deal/${dealId}` : null)
                const personUrl = details.person_url || (personId ? `https://investimentosblue.pipedrive.com/person/${personId}` : null)
                const summary = details.summary || details.doc_title || 'Operação registrada no sistema'

                return (
                  <div
                    key={log.id}
                    className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/80 dark:border-[#002060] p-5 shadow-sm transition-all hover:border-slate-300 dark:hover:border-[#0092FF]/50"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      {/* Left info */}
                      <div className="flex items-start space-x-3.5 min-w-0">
                        <div className={`p-2.5 rounded-xl border flex-shrink-0 mt-0.5 ${config.iconClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* Tags row */}
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${config.badgeClass}`}>
                              {config.label}
                            </span>
                            {clientName && (
                              personUrl ? (
                                <a
                                  href={personUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#00061A] text-slate-800 dark:text-slate-200 hover:text-[#0092FF] dark:hover:text-[#00FFFF] hover:border-[#0092FF]/50 border border-slate-200/80 dark:border-[#002060] flex items-center space-x-1 transition-colors"
                                  title="Abrir contato no Pipedrive"
                                >
                                  <User className="w-3 h-3 text-[#0092FF]" />
                                  <span>{clientName}</span>
                                  <ArrowUpRight className="w-2.5 h-2.5 opacity-60" />
                                </a>
                              ) : (
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#00061A] text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-[#002060] flex items-center space-x-1">
                                  <User className="w-3 h-3 text-[#0092FF]" />
                                  <span>{clientName}</span>
                                </span>
                              )
                            )}
                            {dealId && (
                              dealUrl ? (
                                <a
                                  href={dealUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800/60 inline-flex items-center space-x-1 transition-colors"
                                  title="Abrir negócio no Pipedrive"
                                >
                                  <span>Deal #{dealId}</span>
                                  <ArrowUpRight className="w-2.5 h-2.5 opacity-60" />
                                </a>
                              ) : (
                                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
                                  Deal #{dealId}
                                </span>
                              )
                            )}
                            <span className="text-[11px] text-slate-400 font-medium">
                              {formatDate(log.created_at)}
                            </span>
                          </div>

                          {/* Main Summary */}
                          <p className="text-xs font-semibold text-slate-900 dark:text-white leading-relaxed font-sans">
                            {summary}
                          </p>

                          {/* Quick details previews */}
                          {details.doc_title && details.doc_title !== summary && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center space-x-1.5 truncate">
                              <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              <span className="truncate">{details.doc_title}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right actions */}
                      <div className="flex items-center space-x-2 self-end sm:self-center flex-shrink-0">
                        {/* Open Person in Pipedrive */}
                        {personUrl && (
                          <a
                            href={personUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-[#002060] hover:border-[#0092FF] dark:hover:border-[#00FFFF] hover:text-[#0092FF] dark:hover:text-[#00FFFF] transition-all"
                            title="Abrir contato/pessoa no Pipedrive"
                          >
                            <User className="w-3.5 h-3.5 text-[#0092FF]" />
                            <span className="hidden sm:inline">Ver Pessoa</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}

                        {/* Open Deal in Pipedrive */}
                        {dealUrl && (
                          <a
                            href={dealUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all"
                            title="Abrir negócio no Pipedrive"
                          >
                            <Briefcase className="w-3.5 h-3.5" />
                            <span>Abrir Deal</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        )}

                        <button
                          onClick={() => handleCopy(log.id, `${summary} | Cliente: ${clientName || 'N/A'}`)}
                          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                          title="Copiar dados do log"
                        >
                          {copiedId === log.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>

                        <button
                          onClick={() => toggleExpand(log.id)}
                          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                          title="Ver metadados completos"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Metadata details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-[#002060] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs bg-slate-50 dark:bg-[#00061A]/80 p-4 rounded-xl border border-slate-200/80 dark:border-[#002060]">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-bold">Identificador do Log</span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-[11px]">{log.id}</span>
                        </div>

                        {details.cliente_email && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">E-mail do Cliente</span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{details.cliente_email}</span>
                          </div>
                        )}

                        {personId && (
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-bold">Pessoa no Pipedrive</span>
                            {personUrl ? (
                              <a
                                href={personUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#0092FF] font-bold hover:underline inline-flex items-center space-x-1"
                              >
                                <span>Pessoa #{personId}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="font-mono text-slate-800 dark:text-slate-200">#{personId}</span>
                            )}
                          </div>
                        )}

                        {details.proxima_acao && (
                          <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-200 dark:border-[#002060]">
                            <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">
                              Próxima Ação Gerada no Pipedrive
                            </span>
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-[#000D38] p-3 rounded-lg border border-slate-200/80 dark:border-[#002060]">
                              {details.proxima_acao}
                            </p>
                          </div>
                        )}

                        {details.tactiq_link && (
                          <div className="sm:col-span-2 lg:col-span-3 pt-1 flex items-center justify-between">
                            <span className="text-slate-400 text-[11px]">Transcrição original gravada no Tactiq:</span>
                            <a
                              href={details.tactiq_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline inline-flex items-center space-x-1"
                            >
                              <span>Abrir Gravação no Tactiq</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
