'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import {
  AlertTriangle,
  Clock,
  Users,
  TrendingUp,
  CheckCircle2,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Sun,
  Moon,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

export interface Alert {
  id: string
  alert_type: 'negocio_parado' | 'follow_up_atrasado' | 'teams_pendente'
  cliente_nome: string | null
  description: string
  severity: 'low' | 'medium' | 'high'
  is_resolved: boolean
  created_at: string
  pipedrive_deal_id?: string
  pipedrive_activity_id?: string
  details?: Record<string, any>
}

const alertConfig: Record<
  Alert['alert_type'],
  {
    label: string
    icon: typeof TrendingUp
    badgeClass: string
    iconClass: string
    tag: string
  }
> = {
  negocio_parado: {
    label: 'Negócio Parado',
    tag: 'Estagnação > 15d',
    icon: TrendingUp,
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    iconClass: 'text-rose-600',
  },
  follow_up_atrasado: {
    label: 'Follow-up Atrasado',
    tag: 'Prazo Vencido',
    icon: Clock,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    iconClass: 'text-amber-600',
  },
  teams_pendente: {
    label: 'Teams Pendente',
    tag: 'Sem Reunião Configurada',
    icon: Users,
    badgeClass: 'bg-indigo-50 text-[#002060] border-indigo-200',
    iconClass: 'text-[#002060]',
  },
}

function getAlertActivityInfo(alert: Alert): { dateLabel: string; timestamp: number } {
  // 1. Follow-up atrasado: data de vencimento da atividade no Pipedrive (due_date)
  if (alert.details?.due_date) {
    const raw = String(alert.details.due_date)
    const dt = new Date(raw.includes('T') ? raw : `${raw}T00:00:00`)
    if (!isNaN(dt.getTime())) {
      return {
        dateLabel: `Venceu em ${dt.toLocaleDateString('pt-BR')}`,
        timestamp: dt.getTime(),
      }
    }
  }

  // 2. Negócio parado: data da última atualização no Pipedrive (update_time)
  if (alert.details?.update_time) {
    const raw = String(alert.details.update_time)
    const dt = new Date(raw.replace(' ', 'T'))
    if (!isNaN(dt.getTime())) {
      const days = alert.details?.days_inactive
      return {
        dateLabel: days !== undefined ? `Parado há ${days}d (desde ${dt.toLocaleDateString('pt-BR')})` : `Última mov.: ${dt.toLocaleDateString('pt-BR')}`,
        timestamp: dt.getTime(),
      }
    }
  }

  // 3. Negócio parado com days_inactive nos details
  if (alert.details?.days_inactive !== undefined && alert.details?.days_inactive !== null) {
    const days = Number(alert.details.days_inactive)
    const dt = new Date(Date.now() - days * 86400000)
    return {
      dateLabel: `Parado há ${days}d (desde ${dt.toLocaleDateString('pt-BR')})`,
      timestamp: dt.getTime(),
    }
  }

  // 4. Regex para "Venceu em YYYY-MM-DD" no texto
  const desc = alert.description || ''
  const matchVenceu = desc.match(/Venceu em (\d{4}-\d{2}-\d{2})/)
  if (matchVenceu && matchVenceu[1]) {
    const dt = new Date(`${matchVenceu[1]}T00:00:00`)
    if (!isNaN(dt.getTime())) {
      return {
        dateLabel: `Venceu em ${dt.toLocaleDateString('pt-BR')}`,
        timestamp: dt.getTime(),
      }
    }
  }

  // 5. Regex para "parado há X dias" no texto
  const matchParado = desc.match(/parado há (\d+) dias/)
  if (matchParado && matchParado[1]) {
    const days = Number(matchParado[1])
    const dt = new Date(Date.now() - days * 86400000)
    return {
      dateLabel: `Parado há ${days}d (desde ${dt.toLocaleDateString('pt-BR')})`,
      timestamp: dt.getTime(),
    }
  }

  // 6. Fallback: created_at
  const dt = new Date(alert.created_at)
  return {
    dateLabel: isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    timestamp: isNaN(dt.getTime()) ? 0 : dt.getTime(),
  }
}

export default function AlertsPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'severity' | 'client_az'>('newest')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await axios.get(`${API_URL}/api/alerts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { resolved: activeTab === 'resolved' },
      })
      setAlerts(response.data)
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }, [API_URL, activeTab, router])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const handleResolve = async (alertId: string) => {
    try {
      setResolvingId(alertId)
      const token = localStorage.getItem('access_token')
      await axios.patch(
        `${API_URL}/api/alerts/${alertId}/resolve`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      fetchAlerts()
    } catch (err) {
      console.error('Erro ao resolver alerta:', err)
    } finally {
      setResolvingId(null)
    }
  }

  const filteredAlerts = useMemo(() => {
    const list = alerts.filter((alert) => {
      if (typeFilter !== 'all' && alert.alert_type !== typeFilter) return false
      if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()
        const client = (alert.cliente_nome || '').toLowerCase()
        const desc = (alert.description || '').toLowerCase()
        if (!client.includes(q) && !desc.includes(q)) return false
      }
      return true
    })

    return list.sort((a, b) => {
      if (sortBy === 'newest') {
        return getAlertActivityInfo(b).timestamp - getAlertActivityInfo(a).timestamp
      }
      if (sortBy === 'oldest') {
        return getAlertActivityInfo(a).timestamp - getAlertActivityInfo(b).timestamp
      }
      if (sortBy === 'severity') {
        const weight: Record<string, number> = { high: 3, medium: 2, low: 1 }
        return (weight[b.severity] || 0) - (weight[a.severity] || 0)
      }
      if (sortBy === 'client_az') {
        return (a.cliente_nome || '').localeCompare(b.cliente_nome || '')
      }
      return 0
    })
  }, [alerts, typeFilter, severityFilter, searchTerm, sortBy])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight font-display">
              Gestão de Alertas
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Notificações de negócios parados, follow-ups atrasados e convites pendentes
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
              onClick={fetchAlerts}
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
          {/* Main Status Switch Tab (Ativos vs Resolvidos) */}
          <div className="flex items-center justify-between">
            <div className="flex bg-slate-200/70 dark:bg-[#000D38] p-1 rounded-xl border border-slate-300/60 dark:border-[#002060]">
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'pending'
                    ? 'bg-[#000D38] dark:bg-[#0092FF] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Alertas Pendentes ({activeTab === 'pending' ? filteredAlerts.length : '...'})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('resolved')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeTab === 'resolved'
                    ? 'bg-[#000D38] dark:bg-[#0092FF] text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Histórico de Resolvidos
              </button>
            </div>
          </div>

          {/* Search and Filters Bar */}
          <div className="bg-white dark:bg-[#000D38] p-4 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filtrar por nome do cliente ou descrição..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#00061A] focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Ordenação por Data / Mais Recente */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                title="Ordenar alertas"
              >
                <option value="newest">📅 Mais Recentes (Data ↓)</option>
                <option value="oldest">⏳ Mais Antigos (Data ↑)</option>
                <option value="severity">🚨 Maior Prioridade</option>
                <option value="client_az">👤 Nome do Cliente (A-Z)</option>
              </select>

              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
              >
                <option value="all">Todas Severidades</option>
                <option value="high">Alta Prioridade</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
            {[
              { key: 'all', label: 'Todos os Alertas' },
              { key: 'negocio_parado', label: 'Negócios Parados' },
              { key: 'follow_up_atrasado', label: 'Follow-ups Atrasados' },
              { key: 'teams_pendente', label: 'Teams Pendente' },
            ].map((pill) => (
              <button
                key={pill.key}
                onClick={() => setTypeFilter(pill.key)}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-colors ${
                  typeFilter === pill.key
                    ? 'bg-[#000D38] text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Alerts List */}
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-9 h-9 border-3 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Carregando alertas...</p>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="py-20 bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] text-center p-6 shadow-sm">
              <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500 mb-3" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {activeTab === 'resolved' ? 'Nenhum alerta resolvido nesta lista' : 'Nenhum alerta pendente'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                {activeTab === 'resolved'
                  ? 'Alertas resolvidos serão listados aqui para consulta histórica e compliance.'
                  : 'Excelente! Todos os negócios e atividades no Pipedrive estão em dia.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((alert) => {
                const config = alertConfig[alert.alert_type] || alertConfig.follow_up_atrasado
                const Icon = config.icon
                const isExpanded = expandedIds.has(alert.id)
                const isResolving = resolvingId === alert.id

                return (
                  <div
                    key={alert.id}
                    className={`bg-white dark:bg-[#000D38] rounded-2xl border p-5 shadow-sm transition-all hover:border-slate-300 dark:hover:border-[#0092FF] ${
                      alert.severity === 'high' && !alert.is_resolved
                        ? 'border-l-4 border-l-rose-500 border-slate-200 dark:border-[#002060]'
                        : 'border-slate-200/90 dark:border-[#002060]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex items-start space-x-3.5 min-w-0">
                        <div className={`p-2.5 rounded-xl border flex-shrink-0 mt-0.5 ${config.badgeClass}`}>
                          <Icon className={`w-4 h-4 ${config.iconClass}`} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${config.badgeClass}`}>
                              {config.label}
                            </span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-transparent dark:border-[#002060]">
                              {alert.severity === 'high' ? 'Alta Prioridade' : alert.severity === 'medium' ? 'Média' : 'Baixa'}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center space-x-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{getAlertActivityInfo(alert).dateLabel}</span>
                            </span>
                          </div>

                          <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                            {alert.cliente_nome || 'Cliente não informado'}
                          </h3>

                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                            {alert.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 self-end sm:self-center flex-shrink-0">
                        <button
                          onClick={() => handleCopy(alert.id, `${alert.cliente_nome || ''} - ${alert.description}`)}
                          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                          title="Copiar dados do alerta"
                        >
                          {copiedId === alert.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        </button>

                        <button
                          onClick={() => {
                            setExpandedIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(alert.id)) next.delete(alert.id)
                              else next.add(alert.id)
                              return next
                            })
                          }}
                          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                          title="Ver detalhes"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {!alert.is_resolved && (
                          <button
                            onClick={() => handleResolve(alert.id)}
                            disabled={isResolving}
                            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-all disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>{isResolving ? 'Resolvendo...' : 'Resolver'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-[#002060] grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-[#00061A]/80 p-4 rounded-xl border border-slate-200/80 dark:border-[#002060]">
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-bold">Identificador</span>
                          <span className="font-mono text-slate-800 dark:text-slate-200 text-[11px]">{alert.id}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-bold">Regra de Diagnóstico</span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{config.tag}</span>
                        </div>
                        <div className="sm:col-span-2 pt-2 border-t border-slate-200 dark:border-[#002060] flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400">Ação recomendada: Entrar em contato com o cliente e agendar retorno.</span>
                          <a
                            href="https://investimentosblue.pipedrive.com"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1 text-[#0092FF] font-bold hover:underline"
                          >
                            <span>Abrir CRM Pipedrive</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
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
