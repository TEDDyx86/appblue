'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sliders,
  RefreshCw,
  Trash2,
  Check,
  Copy,
  CalendarCheck,
  Code,
  Share2,
  Layers,
  Sparkles,
  Link as LinkIcon,
  Sun,
  Moon,
  Users,
  Search,
  MessageSquare,
  Send,
  Building2,
  CheckCheck,
  ChevronRight,
  Filter,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface PipedriveActivity {
  id: string
  type: string
  subject: string
  due_date: string
  due_time: string
  duration: string
  time_slot: string
  day_of_week: string
  date_display: string
  person_name: string
  person_id?: string
  person_url?: string
  org_name: string
  org_id?: string | number
  deal_id?: string
  deal_title?: string
  deal_url?: string
  done: boolean
  whatsapp_template: string
}

interface AssessorItem {
  id: number | string
  name: string
  count: number
}

interface CalendarSettingsData {
  work_days: number[]
  start_hour: string
  end_hour: string
  lunch_start: string
  lunch_end: string
  slot_duration_minutes: number
  buffer_minutes: number
  min_notice_hours: number
  max_future_days: number
  timezone: string
  meeting_types: any[]
}

export default function AgendaPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'calendar' | 'settings'>('calendar')

  // Activities from Pipedrive State
  const [activities, setActivities] = useState<PipedriveActivity[]>([])
  const [assessores, setAssessores] = useState<AssessorItem[]>([])
  const [whatsappConsolidated, setWhatsappConsolidated] = useState('')
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [selectedAssessor, setSelectedAssessor] = useState<string>('all')
  const [activitySearch, setActivitySearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('pending')
  const [copiedSingleId, setCopiedSingleId] = useState<string | null>(null)
  const [copiedConsolidated, setCopiedConsolidated] = useState(false)

  // Booking Settings State
  const [settings, setSettings] = useState<CalendarSettingsData | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsFeedback, setSettingsFeedback] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPublicUrl(`${window.location.origin}/agendar`)
    }
  }, [])

  // Carrega Atividades e Assessores do Pipedrive
  const fetchActivities = useCallback(async () => {
    try {
      setLoadingActivities(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const params: any = { limit: 100 }
      if (selectedAssessor !== 'all') {
        params.assessor_name = selectedAssessor
      }
      if (statusFilter === 'pending') {
        params.done = false
      } else if (statusFilter === 'done') {
        params.done = true
      }

      const res = await axios.get(`${API_URL}/api/pipedrive/activities`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      })

      setActivities(res.data.activities || [])
      setAssessores(res.data.assessores || [])
      setWhatsappConsolidated(res.data.whatsapp_consolidated || '')
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoadingActivities(false)
    }
  }, [API_URL, router, selectedAssessor, statusFilter])

  // Carrega configurações de booking
  const fetchSettings = useCallback(async () => {
    try {
      setLoadingSettings(true)
      const token = localStorage.getItem('access_token')
      if (!token) return

      const res = await axios.get(`${API_URL}/api/calendar/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSettings(res.data)
    } catch (err) {
      console.error('Erro ao carregar configurações de booking:', err)
    } finally {
      setLoadingSettings(false)
    }
  }, [API_URL])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  useEffect(() => {
    if (activeTab === 'settings') {
      fetchSettings()
    }
  }, [activeTab, fetchSettings])

  // Salva configurações
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return

    try {
      setSavingSettings(true)
      setSettingsFeedback('')
      const token = localStorage.getItem('access_token')
      await axios.put(`${API_URL}/api/calendar/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSettingsFeedback('Configurações salvas com sucesso!')
      setTimeout(() => setSettingsFeedback(''), 3000)
    } catch (err: any) {
      setSettingsFeedback('Erro ao salvar: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSavingSettings(false)
    }
  }

  // Copia mensagem de template único (WhatsApp)
  const handleCopySingleTemplate = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedSingleId(id)
    setTimeout(() => setCopiedSingleId(null), 2000)
  }

  // Copia mensagem consolidada
  const handleCopyConsolidated = () => {
    if (!whatsappConsolidated) return
    navigator.clipboard.writeText(whatsappConsolidated)
    setCopiedConsolidated(true)
    setTimeout(() => setCopiedConsolidated(false), 2500)
  }

  // Filtra atividades por busca de texto
  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      if (!activitySearch.trim()) return true
      const q = activitySearch.toLowerCase().trim()
      return (
        (a.person_name || '').toLowerCase().includes(q) ||
        (a.subject || '').toLowerCase().includes(q) ||
        (a.org_name || '').toLowerCase().includes(q) ||
        (a.deal_title || '').toLowerCase().includes(q)
      )
    })
  }, [activities, activitySearch])

  // Agrupa atividades por data para o calendário
  const groupedByDate = useMemo(() => {
    const groups: Record<string, { label: string; dateStr: string; items: PipedriveActivity[] }> = {}
    for (const act of filteredActivities) {
      const key = act.due_date || 'Sem data'
      if (!groups[key]) {
        const dayLabel = act.day_of_week
          ? `${act.day_of_week.charAt(0).toUpperCase() + act.day_of_week.slice(1)} (${act.date_display})`
          : 'Data a Definir'
        groups[key] = { label: dayLabel, dateStr: key, items: [] }
      }
      groups[key].items.push(act)
    }
    return Object.values(groups)
  }, [filteredActivities])

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
          <div className="flex items-center space-x-3">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display tracking-tight">
              Agenda de Atendimentos
            </h1>
            <span className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0092FF] animate-pulse"></span>
              <span>Pipedrive CRM & Assessores</span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Sync Button */}
            <button
              onClick={() => fetchActivities()}
              disabled={loadingActivities}
              className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingActivities ? 'animate-spin text-[#0092FF]' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Atualizar Atividades</span>
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
              title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="p-6 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Top Tabs Switcher */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#002060] pb-4">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setActiveTab('calendar')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'calendar'
                    ? 'bg-[#0092FF] text-white shadow-md shadow-blue-500/25'
                    : 'bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#00061A]'
                }`}
              >
                <CalendarIcon className="w-4 h-4" />
                <span>Calendário por Assessor</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  activeTab === 'settings'
                    ? 'bg-[#0092FF] text-white shadow-md shadow-blue-500/25'
                    : 'bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#00061A]'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>Autoagendamento & Links</span>
              </button>
            </div>

            {/* Quick Link Generator Info */}
            <div className="hidden md:flex items-center space-x-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Link de Agendamento:</span>
              <a
                href="/agendar"
                target="_blank"
                className="text-xs font-bold text-[#0092FF] dark:text-[#00FFFF] hover:underline inline-flex items-center space-x-1"
              >
                <span>/agendar</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* TAB 1: CALENDÁRIO POR ASSESSOR & ATIVIDADES PIPEDRIVE */}
          {/* ========================================================================= */}
          {activeTab === 'calendar' && (
            <div className="space-y-6">
              {/* FILTROS DE ASSESSOR & BUSCA */}
              <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-5 shadow-sm space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center space-x-2">
                      <Building2 className="w-4 h-4 text-[#0092FF] dark:text-[#00FFFF]" />
                      <span>Filtrar Atividades por Assessor (Organização Pipedrive)</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Selecione um assessor para visualizar os atendimentos da semana e gerar o template para WhatsApp
                    </p>
                  </div>

                  {/* WhatsApp Consolidated Action Button */}
                  {whatsappConsolidated && (
                    <button
                      type="button"
                      onClick={handleCopyConsolidated}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/25 transition-all self-start lg:self-auto"
                    >
                      {copiedConsolidated ? <CheckCheck className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                      <span>{copiedConsolidated ? 'Agenda Copiada!' : 'Copiar Agenda p/ WhatsApp do Assessor'}</span>
                    </button>
                  )}
                </div>

                {/* Assessores Pills Bar */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedAssessor('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                      selectedAssessor === 'all'
                        ? 'bg-[#0092FF] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:bg-slate-200 dark:hover:bg-[#002060]'
                    }`}
                  >
                    <span>Todos os Assessores</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
                      {activities.length}
                    </span>
                  </button>

                  {assessores.map((assessor) => {
                    const isSelected = selectedAssessor === assessor.name
                    return (
                      <button
                        key={assessor.name}
                        type="button"
                        onClick={() => setSelectedAssessor(assessor.name)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                          isSelected
                            ? 'bg-[#0092FF] text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:bg-slate-200 dark:hover:bg-[#002060]'
                        }`}
                      >
                        <span>{assessor.name}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                            isSelected ? 'bg-white/25 text-white' : 'bg-slate-200 dark:bg-[#002060] text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {assessor.count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Secondary Search & Status Filter */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-3 border-t border-slate-100 dark:border-[#002060]/70">
                  <div className="relative flex-1 w-full">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                      placeholder="Buscar por cliente, assunto ou deal..."
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                    />
                    {activitySearch && (
                      <button
                        onClick={() => setActivitySearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                      >
                        &times;
                      </button>
                    )}
                  </div>

                  <div className="flex items-center space-x-1.5 w-full sm:w-auto">
                    {[
                      { key: 'pending', label: 'Pendentes' },
                      { key: 'done', label: 'Concluídas' },
                      { key: 'all', label: 'Todas' },
                    ].map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setStatusFilter(s.key as any)}
                        className={`flex-1 sm:flex-initial px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                          statusFilter === s.key
                            ? 'bg-slate-900 dark:bg-[#002060] text-white'
                            : 'bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#002060]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* CALENDÁRIO / ATIVIDADES GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                {/* Atividades agrupadas por dia (2 colunas) */}
                <div className="lg:col-span-2 space-y-4">
                  {loadingActivities ? (
                    <div className="py-16 text-center bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200 dark:border-[#002060] p-6">
                      <div className="w-8 h-8 border-2 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Carregando atividades do Pipedrive...</p>
                    </div>
                  ) : groupedByDate.length === 0 ? (
                    <div className="py-16 text-center bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200 dark:border-[#002060] p-6">
                      <CalendarCheck className="w-10 h-10 text-slate-400 mx-auto mb-2 opacity-50" />
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">Nenhuma atividade encontrada</h3>
                      <p className="text-xs text-slate-400 mt-1">Não há reuniões ou tarefas cadastradas para os filtros selecionados.</p>
                    </div>
                  ) : (
                    groupedByDate.map((group) => (
                      <div
                        key={group.dateStr}
                        className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] overflow-hidden shadow-sm"
                      >
                        {/* Day Header */}
                        <div className="p-3.5 px-5 bg-slate-50/80 dark:bg-[#00061A]/70 border-b border-slate-200/80 dark:border-[#002060] flex items-center justify-between">
                          <div className="flex items-center space-x-2.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#0092FF]"></div>
                            <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">
                              {group.label}
                            </h3>
                          </div>
                          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            {group.items.length} {group.items.length === 1 ? 'atendimento' : 'atendimentos'}
                          </span>
                        </div>

                        {/* Activities for this day */}
                        <div className="divide-y divide-slate-100 dark:divide-[#002060]/70 p-2">
                          {group.items.map((act) => {
                            const isCopied = copiedSingleId === act.id
                            return (
                              <div
                                key={act.id}
                                className="p-3.5 rounded-xl hover:bg-slate-50/70 dark:hover:bg-[#00061A]/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="min-w-0 flex-1">
                                  {/* Badges & Meta */}
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    {/* Time badge */}
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 font-mono flex items-center space-x-1">
                                      <Clock className="w-3 h-3" />
                                      <span>{act.time_slot}</span>
                                    </span>

                                    {/* Assessor badge */}
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 flex items-center space-x-1">
                                      <Building2 className="w-2.5 h-2.5" />
                                      <span>{act.org_name}</span>
                                    </span>

                                    {/* Deal badge if exists */}
                                    {act.deal_id && (
                                      <a
                                        href={act.deal_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:text-[#0092FF] transition-colors inline-flex items-center space-x-1"
                                        title="Abrir Deal no Pipedrive"
                                      >
                                        <span>Deal #{act.deal_id}</span>
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    )}
                                  </div>

                                  {/* Title / Subject */}
                                  <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate font-display">
                                    {act.subject}
                                  </h4>

                                  {/* Client name with link */}
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    Cliente: <span className="font-semibold text-slate-800 dark:text-slate-200">{act.person_name}</span>
                                  </p>
                                </div>

                                {/* WhatsApp 1-Click Copy & Actions */}
                                <div className="flex items-center space-x-2 flex-shrink-0">
                                  {/* Copy WhatsApp template button */}
                                  <button
                                    type="button"
                                    onClick={() => handleCopySingleTemplate(act.id, act.whatsapp_template)}
                                    className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                      isCopied
                                        ? 'bg-emerald-600 text-white shadow-xs'
                                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                                    }`}
                                    title={`Copiar para WhatsApp: "${act.whatsapp_template}"`}
                                  >
                                    {isCopied ? <Check className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                                    <span>{isCopied ? 'Copiado!' : 'Copiar p/ Whats'}</span>
                                  </button>

                                  {/* Direct Pipedrive Link */}
                                  {act.deal_url && (
                                    <a
                                      href={act.deal_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-2 rounded-xl text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                                      title="Abrir no Pipedrive"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* WhatsApp Preview & Fast Dispatch Box (1 coluna lateral) */}
                <div className="lg:col-span-1 space-y-4">
                  <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-5 shadow-sm space-y-3 sticky top-24">
                    <div className="flex items-center space-x-2.5 pb-3 border-b border-slate-100 dark:border-[#002060]">
                      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">
                          Mensagem Pronta para WhatsApp
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {selectedAssessor !== 'all' ? `Assessor: ${selectedAssessor}` : 'Visão Geral'}
                        </p>
                      </div>
                    </div>

                    {whatsappConsolidated ? (
                      <div className="space-y-3">
                        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto">
                          {whatsappConsolidated}
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={handleCopyConsolidated}
                            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-2 shadow-md shadow-emerald-600/25 transition-all"
                          >
                            {copiedConsolidated ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            <span>{copiedConsolidated ? 'Copiado com Sucesso!' : 'Copiar Texto Completo'}</span>
                          </button>

                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(whatsappConsolidated)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-[#002060] transition-colors"
                            title="Abrir no WhatsApp Web"
                          >
                            <Send className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-slate-400">
                        <p>Selecione um assessor acima para gerar o resumo semanal formatado.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: CONFIGURAÇÕES DE AUTOAGENDAMENTO (BOOKINGS) */}
          {/* ========================================================================= */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-4xl">
              {/* Share Public Link Card */}
              <div className="bg-gradient-to-br from-[#0092FF]/10 via-[#000D38] to-[#00061A] border border-[#0092FF]/30 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white font-display flex items-center space-x-2">
                    <Share2 className="w-4 h-4 text-[#00FFFF]" />
                    <span>Link Público de Autoagendamento</span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    Envie para clientes ou assessores escolherem o melhor horário disponível na sua agenda
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="px-3 py-2 bg-[#00061A] border border-[#002060] rounded-xl text-xs text-[#00FFFF] font-mono w-60 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(publicUrl)
                      setCopiedLink(true)
                      setTimeout(() => setCopiedLink(false), 2000)
                    }}
                    className="p-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs transition-all shadow-xs"
                    title="Copiar link"
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href="/agendar"
                    target="_blank"
                    className="p-2.5 rounded-xl bg-[#002060] hover:bg-[#002a80] text-white transition-colors"
                    title="Abrir tela de agendamento"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Form Settings */}
              {loadingSettings ? (
                <div className="py-12 text-center text-xs text-slate-400">Carregando configurações...</div>
              ) : settings ? (
                <form onSubmit={handleSaveSettings} className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-6 shadow-sm space-y-6">
                  {settingsFeedback && (
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 text-xs text-[#0092FF] dark:text-[#00FFFF] font-bold">
                      {settingsFeedback}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Horário de Início do Expediente
                      </label>
                      <input
                        type="time"
                        value={settings.start_hour}
                        onChange={(e) => setSettings({ ...settings, start_hour: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Horário de Fim do Expediente
                      </label>
                      <input
                        type="time"
                        value={settings.end_hour}
                        onChange={(e) => setSettings({ ...settings, end_hour: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Início do Almoço / Pausa
                      </label>
                      <input
                        type="time"
                        value={settings.lunch_start}
                        onChange={(e) => setSettings({ ...settings, lunch_start: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Fim do Almoço / Pausa
                      </label>
                      <input
                        type="time"
                        value={settings.lunch_end}
                        onChange={(e) => setSettings({ ...settings, lunch_end: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Duração Padrão das Reuniões
                      </label>
                      <select
                        value={settings.slot_duration_minutes}
                        onChange={(e) => setSettings({ ...settings, slot_duration_minutes: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      >
                        <option value={30}>30 minutos</option>
                        <option value={45}>45 minutos</option>
                        <option value={60}>60 minutos (1 hora)</option>
                        <option value={90}>90 minutos (1h30)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Intervalo de Respiro (Buffer) entre Reuniões
                      </label>
                      <select
                        value={settings.buffer_minutes}
                        onChange={(e) => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white"
                      >
                        <option value={0}>Sem intervalo</option>
                        <option value={10}>10 minutos</option>
                        <option value={15}>15 minutos</option>
                        <option value={30}>30 minutos</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-[#002060] flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="px-6 py-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                    >
                      {savingSettings ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
