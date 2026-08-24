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
  Plus,
  X,
  CreditCard,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Edit3,
  ToggleLeft,
  ToggleRight,
  Eye,
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

interface TimeInterval {
  start: string
  end: string
}

interface DaySchedule {
  day: number
  name: string
  enabled: boolean
  intervals: TimeInterval[]
}

interface MeetingTypeItem {
  id: string
  name: string
  duration: number
  color: string
  description?: string
  active?: boolean
}

interface CalendarSettingsData {
  weekly_schedule?: Record<string, DaySchedule>
  work_days: number[]
  start_hour: string
  end_hour: string
  lunch_start: string
  lunch_end: string
  slot_duration_minutes: number
  buffer_before_minutes?: number
  buffer_after_minutes?: number
  buffer_minutes?: number
  slot_interval_minutes?: number
  min_notice_hours?: number
  max_future_days?: number
  timezone: string
  meeting_types: MeetingTypeItem[]
  whatsapp_single_template?: string
  whatsapp_header_template?: string
  whatsapp_day_template?: string
  whatsapp_item_template?: string
  whatsapp_footer_template?: string
}

const DEFAULT_SCHEDULE: Record<string, DaySchedule> = {
  '0': { day: 0, name: 'Domingo', enabled: false, intervals: [] },
  '1': { day: 1, name: 'Segunda-feira', enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
  '2': { day: 2, name: 'Terça-feira', enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
  '3': { day: 3, name: 'Quarta-feira', enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
  '4': { day: 4, name: 'Quinta-feira', enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
  '5': { day: 5, name: 'Sexta-feira', enabled: true, intervals: [{ start: '09:00', end: '18:00' }] },
  '6': { day: 6, name: 'Sábado', enabled: false, intervals: [] },
}

const TIME_OPTIONS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00', '18:30',
  '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'
]

const AVAILABLE_TAGS = [
  { tag: '{cliente}', label: 'Nome do Cliente', demo: 'Carlos Eduardo' },
  { tag: '{assunto}', label: 'Assunto / Reunião', demo: 'R1 Planejamento Sucessório' },
  { tag: '{horario}', label: 'Horário (Intervalo)', demo: '14:00 - 15:00' },
  { tag: '{dia_semana}', label: 'Dia da Semana', demo: 'Segunda-feira' },
  { tag: '{data}', label: 'Data Curta (Dia/Mês)', demo: '25/08' },
  { tag: '{assessor}', label: 'Nome do Assessor / Org', demo: 'Investimentos Blue' },
  { tag: '{deal}', label: 'Título do Deal', demo: 'Holding Familiar' },
  { tag: '{deal_id}', label: 'ID do Deal', demo: '48' },
  { tag: '{horario_inicio}', label: 'Hora Início', demo: '14:00' },
  { tag: '{horario_fim}', label: 'Hora Término', demo: '15:00' },
  { tag: '{duracao}', label: 'Duração', demo: '01:00' },
  { tag: '{data_completa}', label: 'Data Completa', demo: '2026-08-25' },
]

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
  const [periodFilter, setPeriodFilter] = useState<'next_30_days' | 'this_week' | 'next_week' | 'this_month' | 'all'>('all')
  const [activitySearch, setActivitySearch] = useState('')
  const [activitySortBy, setActivitySortBy] = useState<'date_asc' | 'date_desc' | 'assessor_az' | 'client_az'>('date_asc')
  const [copiedSingleId, setCopiedSingleId] = useState<string | null>(null)
  const [copiedConsolidated, setCopiedConsolidated] = useState(false)

  // Booking Settings State
  const [settings, setSettings] = useState<CalendarSettingsData | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsFeedback, setSettingsFeedback] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [previewMeetingIndex, setPreviewMeetingIndex] = useState(0)

  // Modal / Form para Criar/Editar Tipo de Evento
  const [editingMeeting, setEditingMeeting] = useState<MeetingTypeItem | null>(null)
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false)

  // Modal de Personalização de Templates do WhatsApp
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [templateModalTab, setTemplateModalTab] = useState<'single' | 'consolidated'>('single')
  const [tempSingleTpl, setTempSingleTpl] = useState('')
  const [tempHeaderTpl, setTempHeaderTpl] = useState('')
  const [tempDayTpl, setTempDayTpl] = useState('')
  const [tempItemTpl, setTempItemTpl] = useState('')
  const [tempFooterTpl, setTempFooterTpl] = useState('')
  const [activeTemplateField, setActiveTemplateField] = useState<'single' | 'header' | 'day' | 'item' | 'footer'>('single')
  const [templateSavedFeedback, setTemplateSavedFeedback] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPublicUrl(`${window.location.origin}/agendar`)
    }
  }, [])

  // Carrega Atividades e Assessores do Pipedrive (apenas em aberto)
  const fetchActivities = useCallback(async () => {
    try {
      setLoadingActivities(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const params: any = { period: periodFilter, done: false }
      if (selectedAssessor !== 'all') {
        params.assessor_name = selectedAssessor
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
  }, [API_URL, router, selectedAssessor, periodFilter])

  // Carrega configurações de booking
  const fetchSettings = useCallback(async () => {
    try {
      setLoadingSettings(true)
      const token = localStorage.getItem('access_token')
      if (!token) return

      const res = await axios.get(`${API_URL}/api/calendar/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      
      const data: CalendarSettingsData = res.data
      if (!data.weekly_schedule || Object.keys(data.weekly_schedule).length === 0) {
        data.weekly_schedule = DEFAULT_SCHEDULE
      }
      setSettings(data)
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

  // Salva configurações no Supabase
  const handleSaveSettings = async (e?: React.FormEvent, customSettings?: CalendarSettingsData) => {
    if (e) e.preventDefault()
    const target = customSettings || settings
    if (!target) return

    try {
      setSavingSettings(true)
      setSettingsFeedback('')
      const token = localStorage.getItem('access_token')
      await axios.post(`${API_URL}/api/calendar/settings`, target, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSettingsFeedback('Configurações salvas com sucesso!')
      setTimeout(() => setSettingsFeedback(''), 3500)
    } catch (err: any) {
      setSettingsFeedback('Erro ao salvar: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSavingSettings(false)
    }
  }

  // Helpers de manipulação de Horários da Semana
  const toggleDayReservable = (dayKey: string) => {
    if (!settings) return
    const schedule = { ...(settings.weekly_schedule || DEFAULT_SCHEDULE) }
    const current = schedule[dayKey]
    if (current.enabled) {
      schedule[dayKey] = { ...current, enabled: false, intervals: [] }
    } else {
      schedule[dayKey] = { ...current, enabled: true, intervals: [{ start: '09:00', end: '18:00' }] }
    }
    const updated = { ...settings, weekly_schedule: schedule }
    setSettings(updated)
  }

  const updateInterval = (dayKey: string, index: number, field: 'start' | 'end', value: string) => {
    if (!settings) return
    const schedule = { ...(settings.weekly_schedule || DEFAULT_SCHEDULE) }
    const current = schedule[dayKey]
    const newIntervals = [...current.intervals]
    newIntervals[index] = { ...newIntervals[index], [field]: value }
    schedule[dayKey] = { ...current, intervals: newIntervals }
    const updated = { ...settings, weekly_schedule: schedule }
    setSettings(updated)
  }

  const addInterval = (dayKey: string) => {
    if (!settings) return
    const schedule = { ...(settings.weekly_schedule || DEFAULT_SCHEDULE) }
    const current = schedule[dayKey]
    if (!current.enabled) {
      schedule[dayKey] = { ...current, enabled: true, intervals: [{ start: '09:00', end: '18:00' }] }
    } else {
      schedule[dayKey] = {
        ...current,
        intervals: [...current.intervals, { start: '14:00', end: '18:00' }],
      }
    }
    const updated = { ...settings, weekly_schedule: schedule }
    setSettings(updated)
  }

  const removeInterval = (dayKey: string, index: number) => {
    if (!settings) return
    const schedule = { ...(settings.weekly_schedule || DEFAULT_SCHEDULE) }
    const current = schedule[dayKey]
    const newIntervals = current.intervals.filter((_, i) => i !== index)
    if (newIntervals.length === 0) {
      schedule[dayKey] = { ...current, enabled: false, intervals: [] }
    } else {
      schedule[dayKey] = { ...current, intervals: newIntervals }
    }
    const updated = { ...settings, weekly_schedule: schedule }
    setSettings(updated)
  }

  // Helpers de Tipos de Reunião / Eventos (com persistência imediata)
  const handleSaveMeetingType = (meeting: MeetingTypeItem) => {
    if (!settings) return
    const existing = settings.meeting_types || []
    let updatedTypes: MeetingTypeItem[]
    if (isCreatingMeeting) {
      const newId = meeting.id || meeting.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now()
      updatedTypes = [...existing, { ...meeting, id: newId }]
    } else {
      updatedTypes = existing.map((m) => (m.id === meeting.id ? meeting : m))
    }
    const newSettings = { ...settings, meeting_types: updatedTypes }
    setSettings(newSettings)
    setEditingMeeting(null)
    setIsCreatingMeeting(false)
    handleSaveSettings(undefined, newSettings)
  }

  const handleDeleteMeetingType = (id: string) => {
    if (!settings) return
    if ((settings.meeting_types || []).length <= 1) {
      alert('Você deve manter ao menos 1 tipo de evento cadastrado.')
      return
    }
    const updatedTypes = (settings.meeting_types || []).filter((m) => m.id !== id)
    const newSettings = { ...settings, meeting_types: updatedTypes }
    setSettings(newSettings)
    if (previewMeetingIndex >= updatedTypes.length) {
      setPreviewMeetingIndex(0)
    }
    handleSaveSettings(undefined, newSettings)
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

  // Abertura e manipulação do Modal de Templates WhatsApp
  const handleOpenTemplateModal = () => {
    setTempSingleTpl(settings?.whatsapp_single_template || '{dia_semana} ({data}) {assunto} com {cliente} ({horario})')
    setTempHeaderTpl(settings?.whatsapp_header_template || '📅 *Agenda de Atendimentos - Robson Vieira & {assessor}*\n')
    setTempDayTpl(settings?.whatsapp_day_template || '🔹 *{dia_semana} ({data})*')
    setTempItemTpl(settings?.whatsapp_item_template || '• {horario} | {assunto} com {cliente}')
    setTempFooterTpl(settings?.whatsapp_footer_template !== undefined ? settings.whatsapp_footer_template : 'Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀')
    setIsTemplateModalOpen(true)
    setTemplateSavedFeedback(false)
  }

  const handleInsertTag = (tag: string) => {
    if (activeTemplateField === 'single') setTempSingleTpl((prev) => (prev ? prev + ' ' + tag : tag))
    else if (activeTemplateField === 'header') setTempHeaderTpl((prev) => (prev ? prev + ' ' + tag : tag))
    else if (activeTemplateField === 'day') setTempDayTpl((prev) => (prev ? prev + ' ' + tag : tag))
    else if (activeTemplateField === 'item') setTempItemTpl((prev) => (prev ? prev + ' ' + tag : tag))
    else if (activeTemplateField === 'footer') setTempFooterTpl((prev) => (prev ? prev + ' ' + tag : tag))
  }

  const handleResetDefaultTemplates = () => {
    setTempSingleTpl('{dia_semana} ({data}) {assunto} com {cliente} ({horario})')
    setTempHeaderTpl('📅 *Agenda de Atendimentos - Robson Vieira & {assessor}*\n')
    setTempDayTpl('🔹 *{dia_semana} ({data})*')
    setTempItemTpl('• {horario} | {assunto} com {cliente}')
    setTempFooterTpl('Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀')
  }

  const handleSaveTemplateSettings = async () => {
    const current = settings || {
      work_days: [1, 2, 3, 4, 5],
      start_hour: '09:00',
      end_hour: '18:00',
      lunch_start: '12:00',
      lunch_end: '13:00',
      slot_duration_minutes: 60,
      timezone: 'America/Sao_Paulo',
      meeting_types: [],
    }
    const updatedSettings: CalendarSettingsData = {
      ...current,
      whatsapp_single_template: tempSingleTpl,
      whatsapp_header_template: tempHeaderTpl,
      whatsapp_day_template: tempDayTpl,
      whatsapp_item_template: tempItemTpl,
      whatsapp_footer_template: tempFooterTpl,
    }
    setSettings(updatedSettings)
    await handleSaveSettings(undefined, updatedSettings)
    await fetchActivities()
    setTemplateSavedFeedback(true)
    setTimeout(() => {
      setTemplateSavedFeedback(false)
      setIsTemplateModalOpen(false)
    }, 900)
  }

  // Demo simulation helper
  const formatDemoText = (tpl: string, customCtx?: Record<string, string>) => {
    if (!tpl) return ''
    const demoCtx: Record<string, string> = {
      dia_semana: 'Segunda-feira',
      dia: 'Segunda-feira',
      day_of_week: 'Segunda-feira',
      data: '25/08',
      date_display: '25/08',
      data_completa: '2026-08-25',
      due_date: '2026-08-25',
      horario: '14:00 - 15:00',
      time_slot: '14:00 - 15:00',
      horario_inicio: '14:00',
      horario_fim: '15:00',
      duracao: '01:00',
      duration: '01:00',
      cliente: 'Carlos Eduardo',
      person_name: 'Carlos Eduardo',
      assunto: 'R1 Planejamento Sucessório',
      subject: 'R1 Planejamento Sucessório',
      assessor: 'Investimentos Blue',
      org_name: 'Investimentos Blue',
      deal: 'Holding Familiar',
      deal_title: 'Holding Familiar',
      deal_id: '48',
      ...customCtx,
    }
    let text = tpl
    Object.entries(demoCtx).forEach(([k, v]) => {
      text = text.replaceAll(`{${k}}`, v)
    })
    return text
  }

  // Filtra, deduplica e ordena atividades (excluindo concluídas/feitas)
  const filteredActivities = useMemo(() => {
    const seen = new Set<string>()
    const list = activities.filter((a) => {
      if (!a.id || seen.has(a.id)) return false
      seen.add(a.id)

      if (a.done) return false
      if (!a.person_name || !a.org_name || a.org_name === 'Sem Assessor') return false

      if (!activitySearch.trim()) return true
      const q = activitySearch.toLowerCase().trim()
      return (
        (a.person_name || '').toLowerCase().includes(q) ||
        (a.subject || '').toLowerCase().includes(q) ||
        (a.org_name || '').toLowerCase().includes(q) ||
        (a.deal_title || '').toLowerCase().includes(q)
      )
    })

    return list.sort((a, b) => {
      if (activitySortBy === 'date_asc') {
        return (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.due_time || '99:99').localeCompare(b.due_time || '99:99')
      }
      if (activitySortBy === 'date_desc') {
        return (b.due_date || '0000').localeCompare(a.due_date || '0000') || (b.due_time || '00:00').localeCompare(a.due_time || '00:00')
      }
      if (activitySortBy === 'assessor_az') {
        return (a.org_name || '').localeCompare(b.org_name || '')
      }
      if (activitySortBy === 'client_az') {
        return (a.person_name || '').localeCompare(b.person_name || '')
      }
      return 0
    })
  }, [activities, activitySearch, activitySortBy])

  // Agrupa atividades por data para o calendário
  const groupedByDate = useMemo(() => {
    const groups: Record<string, { label: string; dateStr: string; items: PipedriveActivity[] }> = {}
    for (const act of filteredActivities) {
      const key = act.due_date || 'Sem data'
      if (!groups[key]) {
        const dayLabel = act.day_of_week
          ? `${act.day_of_week.charAt(0).toUpperCase() + act.day_of_week.slice(1)} (${act.date_display})`
          : (act.due_date || 'Data a Definir')
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

  // Lista ordenada dos dias da semana (Domingo=0 até Sábado=6)
  const scheduleDays = useMemo(() => {
    const raw = settings?.weekly_schedule || DEFAULT_SCHEDULE
    return [
      { key: '0', name: 'Domingo', data: raw['0'] || DEFAULT_SCHEDULE['0'] },
      { key: '1', name: 'Segunda-feira', data: raw['1'] || DEFAULT_SCHEDULE['1'] },
      { key: '2', name: 'Terça-feira', data: raw['2'] || DEFAULT_SCHEDULE['2'] },
      { key: '3', name: 'Quarta-feira', data: raw['3'] || DEFAULT_SCHEDULE['3'] },
      { key: '4', name: 'Quinta-feira', data: raw['4'] || DEFAULT_SCHEDULE['4'] },
      { key: '5', name: 'Sexta-feira', data: raw['5'] || DEFAULT_SCHEDULE['5'] },
      { key: '6', name: 'Sábado', data: raw['6'] || DEFAULT_SCHEDULE['6'] },
    ]
  }, [settings])

  const currentPreviewMeeting = useMemo<MeetingTypeItem>(() => {
    if (!settings?.meeting_types || settings.meeting_types.length === 0) {
      return { id: 'r1', name: 'R1 Planejamento Sucessório', duration: 60, color: 'sky', description: '', active: true }
    }
    return settings.meeting_types[previewMeetingIndex] || settings.meeting_types[0]
  }, [settings, previewMeetingIndex])

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
                <span>Autoagendamento & Horários</span>
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
                      Apenas atividades em aberto com Cliente e Assessor definidos &bull; Selecione o assessor para gerar o template WhatsApp
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

                {/* Período e Seletor Principal de Assessor */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
                  {/* Seletor Dropdown de Assessor (Elimina scroll horizontal) */}
                  <div className="flex items-center space-x-2 flex-1">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap flex items-center space-x-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#0092FF]" />
                      <span>Assessor:</span>
                    </span>
                    <select
                      value={selectedAssessor}
                      onChange={(e) => setSelectedAssessor(e.target.value)}
                      className="w-full sm:max-w-xs px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-[#0092FF] outline-none transition-all"
                    >
                      <option value="all">🏢 Todos os Assessores ({filteredActivities.length})</option>
                      {assessores.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.name} ({a.count} {a.count === 1 ? 'em aberto' : 'em aberto'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Period Selector Tabs */}
                  <div className="flex items-center gap-1 overflow-x-auto text-xs">
                    <span className="text-slate-400 font-bold mr-1 text-[11px]">Período:</span>
                    {[
                      { key: 'all', label: 'Todas' },
                      { key: 'this_week', label: 'Esta Semana' },
                      { key: 'next_week', label: 'Próx. Semana' },
                      { key: 'this_month', label: 'Este Mês' },
                      { key: 'next_30_days', label: '30 Dias' },
                    ].map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setPeriodFilter(p.key as any)}
                        className={`px-2.5 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                          periodFilter === p.key
                            ? 'bg-[#002060] dark:bg-[#0092FF] text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:bg-slate-200 dark:hover:bg-[#002060]'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Top Assessores em Grade Envolvente (Wrap Pills) */}
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-[#002060]/70">
                  <span className="text-[11px] font-bold text-slate-400 mr-1">Atalhos:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedAssessor('all')}
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
                      selectedAssessor === 'all'
                        ? 'bg-[#0092FF] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060] hover:bg-slate-200 dark:hover:bg-[#002060]'
                    }`}
                  >
                    <span>Todos</span>
                  </button>

                  {assessores.slice(0, 7).map((assessor) => {
                    const isSelected = selectedAssessor === assessor.name
                    return (
                      <button
                        key={assessor.name}
                        type="button"
                        onClick={() => setSelectedAssessor(assessor.name)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
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
                <div className="flex flex-col lg:flex-row items-center gap-3 pt-3 border-t border-slate-100 dark:border-[#002060]/70">
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

                  {/* Ordenação por Data / Mais Próximos */}
                  <select
                    value={activitySortBy}
                    onChange={(e) => setActivitySortBy(e.target.value as any)}
                    className="w-full sm:w-56 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                    title="Ordenar atendimentos"
                  >
                    <option value="date_asc">📅 Mais Próximos (Cronológico ↑)</option>
                    <option value="date_desc">⏳ Mais Distantes (Data ↓)</option>
                    <option value="assessor_az">🏢 Por Assessor (A-Z)</option>
                    <option value="client_az">👤 Por Cliente (A-Z)</option>
                  </select>

                  <div className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold whitespace-nowrap self-stretch sm:self-auto justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Em Aberto ({filteredActivities.length})</span>
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
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">Nenhuma atividade em aberto encontrada</h3>
                      <p className="text-xs text-slate-400 mt-1">Não há reuniões pendentes com cliente e assessor definidos para os filtros selecionados.</p>
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
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#002060]">
                      <div className="flex items-center space-x-2.5">
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-900 dark:text-white font-display">
                            Mensagem WhatsApp
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {selectedAssessor !== 'all' ? `Assessor: ${selectedAssessor}` : 'Visão Geral'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleOpenTemplateModal}
                        className="px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-all text-xs font-bold flex items-center space-x-1.5"
                        title="Personalizar texto e formato do WhatsApp"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Alterar Template</span>
                      </button>
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
          {/* TAB 2: CONFIGURAÇÕES DE AUTOAGENDAMENTO & HORÁRIOS DA SEMANA */}
          {/* ========================================================================= */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-5xl">
              {/* Share Public Link Card */}
              <div className="bg-gradient-to-br from-[#0092FF]/10 via-[#000D38] to-[#00061A] border border-[#0092FF]/30 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-white font-display flex items-center space-x-2">
                    <Share2 className="w-4 h-4 text-[#00FFFF]" />
                    <span>Link Público de Autoagendamento</span>
                  </h3>
                  <p className="text-xs text-slate-300 mt-1">
                    Envie para clientes ou assessores agendarem no melhor horário disponível na sua grade
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="px-3 py-2 bg-[#00061A] border border-[#002060] rounded-xl text-xs text-[#00FFFF] font-mono w-56 sm:w-64 outline-none"
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

              {/* SECTION: TIPOS DE EVENTOS / REUNIÕES */}
              <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#002060]">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-[#0092FF]" />
                      <span>Tipos de Eventos & Reuniões</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Crie e personalize os serviços que os clientes podem selecionar no agendamento
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingMeeting(true)
                      setEditingMeeting({
                        id: '',
                        name: '',
                        duration: 60,
                        color: 'sky',
                        description: '',
                        active: true,
                      })
                    }}
                    className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-sm transition-all self-start sm:self-auto"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Novo Tipo de Evento</span>
                  </button>
                </div>

                {/* Event Types Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {settings?.meeting_types?.map((meeting, index) => {
                    const isPreview = previewMeetingIndex === index
                    return (
                      <div
                        key={meeting.id || index}
                        className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                          isPreview
                            ? 'bg-blue-50/70 dark:bg-blue-950/30 border-[#0092FF] shadow-sm'
                            : 'bg-slate-50/70 dark:bg-[#00061A]/80 border-slate-200 dark:border-[#002060]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-[#0092FF]"></span>
                              <h4 className="text-xs font-bold text-slate-900 dark:text-white font-display">
                                {meeting.name}
                              </h4>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                              {meeting.description || 'Sem descrição cadastrada.'}
                            </p>
                          </div>

                          <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {meeting.duration} min
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 dark:border-[#002060]/60">
                          <button
                            type="button"
                            onClick={() => setPreviewMeetingIndex(index)}
                            className={`text-[11px] font-bold flex items-center space-x-1 transition-colors ${
                              isPreview
                                ? 'text-[#0092FF] dark:text-[#00FFFF]'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                          >
                            <Eye className="w-3 h-3" />
                            <span>{isPreview ? 'Visualizando no Card' : 'Pré-visualizar'}</span>
                          </button>

                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => {
                                setIsCreatingMeeting(false)
                                setEditingMeeting(meeting)
                              }}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-[#0092FF] hover:bg-white dark:hover:bg-[#000D38] transition-colors"
                              title="Editar evento"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMeetingType(meeting.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              title="Excluir evento"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* MODAL DE CRIAÇÃO / EDIÇÃO DE TIPO DE EVENTO */}
              {editingMeeting && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
                  <div className="bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-up">
                    <div className="p-5 border-b border-slate-100 dark:border-[#002060] flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                        {isCreatingMeeting ? 'Novo Tipo de Evento' : 'Editar Tipo de Evento'}
                      </h3>
                      <button onClick={() => setEditingMeeting(null)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Nome do Evento / Reunião
                        </label>
                        <input
                          type="text"
                          value={editingMeeting.name}
                          onChange={(e) => setEditingMeeting({ ...editingMeeting, name: e.target.value })}
                          placeholder="Ex: R1 Planejamento Sucessório"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                            Duração (minutos)
                          </label>
                          <select
                            value={editingMeeting.duration}
                            onChange={(e) => setEditingMeeting({ ...editingMeeting, duration: Number(e.target.value) })}
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value={15}>15 minutos</option>
                            <option value={30}>30 minutos</option>
                            <option value={45}>45 minutos</option>
                            <option value={60}>60 minutos (1h)</option>
                            <option value={90}>90 minutos (1h30)</option>
                            <option value={120}>120 minutos (2h)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                            Cor / Destaque
                          </label>
                          <select
                            value={editingMeeting.color || 'sky'}
                            onChange={(e) => setEditingMeeting({ ...editingMeeting, color: e.target.value })}
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value="sky">Azul Blue3</option>
                            <option value="teal">Verde Petróleo</option>
                            <option value="indigo">Índigo</option>
                            <option value="amber">Âmbar / Dourado</option>
                            <option value="purple">Roxo</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Descrição para o Cliente
                        </label>
                        <textarea
                          rows={3}
                          value={editingMeeting.description || ''}
                          onChange={(e) => setEditingMeeting({ ...editingMeeting, description: e.target.value })}
                          placeholder="Explique resumidamente o objetivo desta reunião..."
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-end space-x-2">
                      <button
                        type="button"
                        onClick={() => setEditingMeeting(null)}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#002060]"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!editingMeeting.name.trim()}
                        onClick={() => handleSaveMeetingType(editingMeeting)}
                        className="px-5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-blue-500/25 disabled:opacity-50"
                      >
                        Salvar Evento
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ===================================================================== */}
              {/* SECTION: CONFIGURAÇÃO DE HORÁRIOS DA SEMANA (IGUAL À IMAGEM DO USUÁRIO) */}
              {/* ===================================================================== */}
              {loadingSettings ? (
                <div className="py-12 text-center text-xs text-slate-400">Carregando configurações...</div>
              ) : settings ? (
                <form onSubmit={handleSaveSettings} className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-6 shadow-sm space-y-6">
                  {settingsFeedback && (
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 text-xs text-[#0092FF] dark:text-[#00FFFF] font-bold animate-fade-in">
                      {settingsFeedback}
                    </div>
                  )}

                  {/* Término (incluído) */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Término (incluído)
                    </label>
                    <div className="inline-flex items-center space-x-2 px-3 py-1.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-700 dark:text-slate-300 font-medium">
                      <span>Nenhum</span>
                      <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                  </div>

                  {/* Grade de Horários por Dia da Semana (EXATAMENTE IGUAL À IMAGEM) */}
                  <div className="space-y-3 pt-1">
                    {scheduleDays.map((d) => {
                      const dayKey = d.key
                      const isEnabled = d.data.enabled && d.data.intervals && d.data.intervals.length > 0

                      return (
                        <div
                          key={dayKey}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-1"
                        >
                          {/* Nome do Dia */}
                          <div className="w-28 text-xs font-bold text-slate-800 dark:text-slate-200">
                            {d.name}
                          </div>

                          {/* Se Não Reservável */}
                          {!isEnabled ? (
                            <div className="flex items-center space-x-2 flex-1">
                              <div className="flex-1 max-w-sm py-2 px-4 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-400 dark:text-slate-500 text-center bg-slate-50/50 dark:bg-[#00061A]/50">
                                Não reservável
                              </div>
                              <button
                                type="button"
                                onClick={() => addInterval(dayKey)}
                                className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
                                title="Adicionar horário para este dia"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            /* Se Reservável: exibe faixas de horário com botões [X] e [+] */
                            <div className="flex flex-col gap-2 flex-1">
                              {d.data.intervals.map((interval, idx) => (
                                <div key={idx} className="flex items-center space-x-2 flex-wrap gap-y-2">
                                  {/* Horário de Início */}
                                  <select
                                    value={interval.start}
                                    onChange={(e) => updateInterval(dayKey, idx, 'start', e.target.value)}
                                    className="px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                                  >
                                    {TIME_OPTIONS.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>

                                  {/* Horário de Fim */}
                                  <select
                                    value={interval.end}
                                    onChange={(e) => updateInterval(dayKey, idx, 'end', e.target.value)}
                                    className="px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                                  >
                                    {TIME_OPTIONS.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>

                                  {/* Botão [X] para remover faixa */}
                                  <button
                                    type="button"
                                    onClick={() => removeInterval(dayKey, idx)}
                                    className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 transition-colors"
                                    title="Remover este horário"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>

                                  {/* Botão [+] para adicionar faixa extra no dia */}
                                  {idx === d.data.intervals.length - 1 && (
                                    <button
                                      type="button"
                                      onClick={() => addInterval(dayKey)}
                                      className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
                                      title="Adicionar intervalo extra (ex: tarde)"
                                    >
                                      <Plus className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Botão Alternador: Ocultar / Mostrar Opções Avançadas */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-[#002060] bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-xs font-bold text-slate-700 dark:text-slate-300 transition-colors"
                    >
                      {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{showAdvanced ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas'}</span>
                    </button>
                  </div>

                  {/* ================================================================= */}
                  {/* OPÇÕES AVANÇADAS & CARD PREVIEW (EXATAMENTE IGUAL À IMAGEM) */}
                  {/* ================================================================= */}
                  {showAdvanced && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4 border-t border-slate-100 dark:border-[#002060]/70 items-start">
                      {/* Left: Inputs avançados */}
                      <div className="lg:col-span-2 space-y-4">
                        {/* Buffer Antes da Reunião */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                            <CreditCard className="w-4 h-4 text-slate-400" />
                            <span>Tempo de buffer antes da reunião</span>
                          </label>
                          <select
                            value={settings.buffer_before_minutes ?? 0}
                            onChange={(e) => setSettings({ ...settings, buffer_before_minutes: Number(e.target.value) })}
                            className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value={0}>0 minutos</option>
                            <option value={5}>5 minutos</option>
                            <option value={10}>10 minutos</option>
                            <option value={15}>15 minutos</option>
                            <option value={30}>30 minutos</option>
                            <option value={45}>45 minutos</option>
                            <option value={60}>60 minutos</option>
                          </select>
                        </div>

                        {/* Buffer Depois da Reunião */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-2 pl-6">
                            <span>Tempo de buffer depois da reunião</span>
                          </label>
                          <select
                            value={settings.buffer_after_minutes ?? settings.buffer_minutes ?? 0}
                            onChange={(e) => setSettings({ ...settings, buffer_after_minutes: Number(e.target.value), buffer_minutes: Number(e.target.value) })}
                            className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value={0}>0 minutos</option>
                            <option value={5}>5 minutos</option>
                            <option value={10}>10 minutos</option>
                            <option value={15}>15 minutos</option>
                            <option value={30}>30 minutos</option>
                            <option value={45}>45 minutos</option>
                            <option value={60}>60 minutos</option>
                          </select>
                        </div>

                        {/* Limitar a hora de início a */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-2 pl-6">
                            <span>Limitar a hora de início a</span>
                          </label>
                          <select
                            value={settings.slot_interval_minutes ?? 30}
                            onChange={(e) => setSettings({ ...settings, slot_interval_minutes: Number(e.target.value) })}
                            className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value={15}>15 minutos</option>
                            <option value={30}>30 minutos</option>
                            <option value={45}>45 minutos</option>
                            <option value={60}>1 - horas de in...</option>
                          </select>
                        </div>

                        {/* Prazo de entrega mínimo (Antecedência mínima) */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-2">
                            <CalendarRange className="w-4 h-4 text-slate-400" />
                            <span>Prazo de entrega mínimo</span>
                          </label>
                          <select
                            value={settings.min_notice_hours ?? 12}
                            onChange={(e) => setSettings({ ...settings, min_notice_hours: Number(e.target.value) })}
                            className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value={1}>1 hora</option>
                            <option value={2}>2 horas</option>
                            <option value={4}>4 horas</option>
                            <option value={12}>12 horas</option>
                            <option value={24}>24 horas</option>
                            <option value={48}>48 horas</option>
                          </select>
                        </div>

                        {/* Prazo de entrega máximo (Dias futuros) */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-2 pl-6">
                            <span>Prazo de entrega máximo</span>
                          </label>
                          <div className="flex items-center space-x-2 w-full sm:w-48">
                            <span className="text-xs font-medium text-slate-500">Personalizado</span>
                            <div className="relative flex-1">
                              <input
                                type="number"
                                min={1}
                                max={180}
                                value={settings.max_future_days ?? 21}
                                onChange={(e) => setSettings({ ...settings, max_future_days: Number(e.target.value) })}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">dias</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Preview Card do Evento (EXATAMENTE COMO NA IMAGEM) */}
                      <div className="lg:col-span-1">
                        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700 dark:border-[#002060] text-white shadow-xl space-y-3">
                          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                            Pré-visualização do Evento
                          </p>

                          <div className="p-4 rounded-xl bg-gradient-to-r from-[#001D99] to-[#000D38] border border-[#0092FF]/50 shadow-inner flex items-center justify-between">
                            <span className="text-xs font-bold text-white font-display">
                              {currentPreviewMeeting.name} &bull; {currentPreviewMeeting.duration} minutos
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            {currentPreviewMeeting.description || 'Configuração ativa para reserva de clientes.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submit Action Button */}
                  <div className="pt-4 border-t border-slate-100 dark:border-[#002060] flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="px-6 py-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                    >
                      {savingSettings ? 'Salvando...' : 'Salvar Todas as Configurações'}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </main>
      </div>

      {/* ========================================================================= */}
      {/* MODAL DE PERSONALIZAÇÃO DE TEMPLATES DO WHATSAPP */}
      {/* ========================================================================= */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 dark:border-[#002060] flex items-center justify-between bg-slate-50/50 dark:bg-[#00061A]/50">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                    Personalizar Templates de Mensagem (WhatsApp)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Edite o formato das mensagens automáticas e use as tags dinâmicas do sistema
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Tab Selector inside Modal */}
              <div className="flex items-center space-x-2 p-1 bg-slate-100 dark:bg-[#00061A] rounded-xl border border-slate-200 dark:border-[#002060]">
                <button
                  type="button"
                  onClick={() => setTemplateModalTab('single')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                    templateModalTab === 'single'
                      ? 'bg-white dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>1. Card Individual (Linha Única)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateModalTab('consolidated')}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                    templateModalTab === 'consolidated'
                      ? 'bg-white dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF] shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  <span>2. Agenda Completa (Por Assessor)</span>
                </button>
              </div>

              {/* Dynamic Tags Selector Bar */}
              <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-[#00061A]/80 border border-blue-100 dark:border-[#002060] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#0092FF]" />
                    <span>Variáveis Disponíveis (Clique para Inserir no Texto):</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Substituídas dinamicamente</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_TAGS.map((item) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => handleInsertTag(item.tag)}
                      className="px-2.5 py-1 bg-white dark:bg-[#000D38] border border-blue-200 dark:border-[#002060] hover:border-[#0092FF] text-slate-800 dark:text-slate-200 rounded-lg text-[11px] font-mono font-bold transition-all flex items-center space-x-1.5 shadow-2xs hover:scale-105 active:scale-95"
                      title={`${item.label} (Exemplo real: "${item.demo}")`}
                    >
                      <span className="text-[#0092FF] dark:text-[#00FFFF] font-bold">+</span>
                      <span>{item.tag}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* TAB 1: Template Card Individual */}
              {templateModalTab === 'single' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                      Texto do Botão "Copiar p/ Whats" de cada atividade
                    </label>
                    <textarea
                      rows={3}
                      value={tempSingleTpl}
                      onFocus={() => setActiveTemplateField('single')}
                      onChange={(e) => setTempSingleTpl(e.target.value)}
                      placeholder="{dia_semana} ({data}) {assunto} com {cliente} ({horario})"
                      className="w-full p-3.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Padrão sugerido: <code className="text-[#0092FF]">{`{dia_semana} ({data}) {assunto} com {cliente} ({horario})`}</code>
                    </p>
                  </div>

                  {/* Live Simulation Card */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      📱 Prévia em Tempo Real
                    </span>
                    <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-[#042417] border border-emerald-200 dark:border-emerald-800/60 text-xs font-mono text-emerald-950 dark:text-emerald-200 shadow-inner">
                      {formatDemoText(tempSingleTpl) || <span className="text-slate-400 italic">Digite algo acima para simular...</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Template Consolidado do Assessor */}
              {templateModalTab === 'consolidated' && (
                <div className="space-y-4">
                  {/* 1. Cabeçalho */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      1. Cabeçalho do Relatório
                    </label>
                    <input
                      type="text"
                      value={tempHeaderTpl}
                      onFocus={() => setActiveTemplateField('header')}
                      onChange={(e) => setTempHeaderTpl(e.target.value)}
                      placeholder="📅 *Agenda de Atendimentos - Robson Vieira & {assessor}*"
                      className="w-full p-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                    />
                  </div>

                  {/* 2. Título do Dia */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      2. Título do Dia da Semana
                    </label>
                    <input
                      type="text"
                      value={tempDayTpl}
                      onFocus={() => setActiveTemplateField('day')}
                      onChange={(e) => setTempDayTpl(e.target.value)}
                      placeholder="🔹 *{dia_semana} ({data})*"
                      className="w-full p-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                    />
                  </div>

                  {/* 3. Item / Reunião */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      3. Formato de Cada Reunião (Linha de Atendimento)
                    </label>
                    <input
                      type="text"
                      value={tempItemTpl}
                      onFocus={() => setActiveTemplateField('item')}
                      onChange={(e) => setTempItemTpl(e.target.value)}
                      placeholder="• {horario} | {assunto} com {cliente}"
                      className="w-full p-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                    />
                  </div>

                  {/* 4. Rodapé */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      4. Rodapé / Fechamento da Mensagem
                    </label>
                    <input
                      type="text"
                      value={tempFooterTpl}
                      onFocus={() => setActiveTemplateField('footer')}
                      onChange={(e) => setTempFooterTpl(e.target.value)}
                      placeholder="Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀"
                      className="w-full p-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#0092FF]"
                    />
                  </div>

                  {/* Live Simulation Consolidated */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      📱 Prévia da Mensagem Consolidada
                    </span>
                    <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed max-h-[220px] overflow-y-auto">
                      {(formatDemoText(tempHeaderTpl) ? formatDemoText(tempHeaderTpl) + '\n\n' : '') +
                        (formatDemoText(tempDayTpl) ? formatDemoText(tempDayTpl) + '\n' : '') +
                        (formatDemoText(tempItemTpl) ? formatDemoText(tempItemTpl) + '\n' : '') +
                        (formatDemoText(tempItemTpl, {
                          horario: '16:00 - 17:00',
                          assunto: 'Revisão de Carteira',
                          cliente: 'Mariana Costa'
                        }) ? formatDemoText(tempItemTpl, {
                          horario: '16:00 - 17:00',
                          assunto: 'Revisão de Carteira',
                          cliente: 'Mariana Costa'
                        }) + '\n\n' : '') +
                        (formatDemoText(tempFooterTpl) || '')}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-[#002060] flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#00061A]/50">
              <button
                type="button"
                onClick={handleResetDefaultTemplates}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white underline self-start sm:self-auto"
              >
                Restaurar Padrão do Sistema
              </button>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplateSettings}
                  disabled={savingSettings}
                  className="flex-1 sm:flex-initial px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/25 transition-all flex items-center justify-center space-x-1.5"
                >
                  {templateSavedFeedback ? <CheckCheck className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  <span>{templateSavedFeedback ? 'Salvo com Sucesso!' : 'Salvar Templates'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
