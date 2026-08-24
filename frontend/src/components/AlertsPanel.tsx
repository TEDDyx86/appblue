'use client'

import { useState, useMemo } from 'react'
import {
  AlertCircle,
  Clock,
  Users,
  CheckCircle2,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  Copy,
  ExternalLink,
  Filter,
  Sparkles,
  DollarSign,
  Layers,
} from 'lucide-react'

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

interface AlertsPanelProps {
  alerts: Alert[]
  onResolve: (id: string) => void
  selectedTypeFilter?: string
  onTypeFilterChange?: (type: string) => void
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
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/60',
    iconClass: 'text-rose-600 dark:text-rose-400',
  },
  follow_up_atrasado: {
    label: 'Follow-up Atrasado',
    tag: 'Prazo Vencido',
    icon: Clock,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  teams_pendente: {
    label: 'Teams Pendente',
    tag: 'Sem Reunião Configurada',
    icon: Users,
    badgeClass: 'bg-indigo-50 text-[#002060] border-indigo-200 dark:bg-blue-950/40 dark:text-[#00FFFF] dark:border-blue-800/60',
    iconClass: 'text-[#002060] dark:text-[#00FFFF]',
  },
}

export default function AlertsPanel({
  alerts,
  onResolve,
  selectedTypeFilter = 'all',
  onTypeFilterChange,
}: AlertsPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (selectedTypeFilter !== 'all' && alert.alert_type !== selectedTypeFilter) return false
      if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase()
        const client = (alert.cliente_nome || '').toLowerCase()
        const desc = (alert.description || '').toLowerCase()
        if (!client.includes(query) && !desc.includes(query)) return false
      }
      return true
    })
  }, [alerts, selectedTypeFilter, severityFilter, searchTerm])

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
            Alta Prioridade
          </span>
        )
      case 'medium':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
            Média
          </span>
        )
      case 'low':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060]">
            Baixa
          </span>
        )
      default:
        return null
    }
  }

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

  const handleResolveClick = async (id: string) => {
    setResolvingId(id)
    await onResolve(id)
    setResolvingId(null)
  }

  return (
    <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm overflow-hidden flex flex-col transition-colors">
      {/* Panel Header */}
      <div className="p-5 border-b border-slate-200/80 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 rounded-xl flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-[#0092FF] dark:text-[#00FFFF]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight font-display">Alertas Operacionais & Funil</h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200/80 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-transparent dark:border-[#002060]">
                  {filteredAlerts.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Negócios e follow-ups monitorados do Funil Comercial Pipedrive
              </p>
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar cliente ou negócio..."
                className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-[#00061A] border border-slate-300 dark:border-[#002060] rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  &times;
                </button>
              )}
            </div>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-white dark:bg-[#00061A] border border-slate-300 dark:border-[#002060] rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
              title="Filtrar por severidade"
            >
              <option value="all">Todas Severidades</option>
              <option value="high">Alta Prioridade</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-200/60 dark:border-[#002060]/80 overflow-x-auto text-xs">
          <span className="text-slate-400 font-medium mr-1 text-[11px]">Tipo:</span>
          {[
            { key: 'all', label: 'Todos' },
            { key: 'negocio_parado', label: 'Negócios Parados' },
            { key: 'follow_up_atrasado', label: 'Follow-ups Atrasados' },
            { key: 'teams_pendente', label: 'Teams Pendente' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => onTypeFilterChange && onTypeFilterChange(tab.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                selectedTypeFilter === tab.key
                  ? 'bg-[#000D38] dark:bg-[#0092FF] text-white shadow-xs'
                  : 'bg-white dark:bg-[#00061A] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:bg-slate-100 dark:hover:bg-[#002060]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts List */}
      <div className="divide-y divide-slate-100 dark:divide-[#002060]/60 flex-1 overflow-y-auto max-h-[580px]">
        {filteredAlerts.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-14 h-14 mx-auto mb-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">Nenhum alerta pendente</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              Todas as reuniões do Tactiq e tarefas do Pipedrive estão sincronizadas e em dia.
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const config = alertConfig[alert.alert_type] || alertConfig.follow_up_atrasado
            const Icon = config.icon
            const isExpanded = expandedIds.has(alert.id)
            const isResolving = resolvingId === alert.id
            const dealId = alert.pipedrive_deal_id || alert.details?.deal_id
            const dealUrl = alert.details?.deal_url || (dealId ? `https://investimentosblue.pipedrive.com/deal/${dealId}` : 'https://investimentosblue.pipedrive.com')
            const dealValue = alert.details?.value
            const stageName = alert.details?.stage
            const daysInactive = alert.details?.days_inactive

            return (
              <div
                key={alert.id}
                className={`p-4 transition-colors hover:bg-slate-50/80 dark:hover:bg-[#001340] ${
                  alert.severity === 'high' ? 'bg-rose-50/20 dark:bg-rose-950/20' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Icon & Category Tag */}
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className={`p-2 rounded-xl border flex-shrink-0 mt-0.5 ${config.badgeClass}`}>
                      <Icon className={`w-4 h-4 ${config.iconClass}`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${config.badgeClass}`}>
                          {config.label}
                        </span>
                        {getSeverityBadge(alert.severity)}
                        
                        {dealId && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 font-mono">
                            Deal #{dealId}
                          </span>
                        )}

                        {dealValue !== undefined && dealValue > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            {dealValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        )}

                        <span className="text-[11px] text-slate-400">
                          {formatDate(alert.created_at)}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate font-display">
                        {alert.cliente_nome || 'Cliente não informado'}
                      </h4>

                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                        {alert.description}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {dealUrl && (
                      <a
                        href={dealUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                        title="Abrir Deal no Pipedrive"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    <button
                      onClick={() => handleCopy(alert.id, `${alert.cliente_nome || ''} - ${alert.description}`)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                      title="Copiar texto do alerta"
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
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                      title={isExpanded ? 'Recolher detalhes' : 'Ver detalhes completos'}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleResolveClick(alert.id)}
                      disabled={isResolving}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-all disabled:opacity-50"
                      title="Marcar como resolvido"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{isResolving ? 'Salvando...' : 'Resolver'}</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Details Box */}
                {isExpanded && (
                  <div className="mt-3.5 p-3.5 bg-slate-100/70 dark:bg-[#00061A]/80 border border-slate-200 dark:border-[#002060] rounded-xl text-xs space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-700 dark:text-slate-300">
                      {stageName && (
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Etapa no CRM</span>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{stageName}</span>
                        </div>
                      )}
                      {daysInactive !== undefined && (
                        <div>
                          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Inatividade</span>
                          <span className="font-bold text-rose-600 dark:text-rose-400">{daysInactive} dias sem update</span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">Regra de Gatilho</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{config.tag}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200/80 dark:border-[#002060] flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">
                        {dealId ? `Negócio Pipedrive: #${dealId}` : 'Ação recomendada: Revisar negócio e agendar retorno.'}
                      </span>
                      {dealUrl && (
                        <a
                          href={dealUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 text-[#0092FF] dark:text-[#00FFFF] font-bold hover:underline"
                        >
                          <span>Abrir Negócio no Pipedrive</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}