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
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface MeetingType {
  id: string
  name: string
  duration: number
  color: string
  description: string
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
  meeting_types: MeetingType[]
}

interface ScheduledMeeting {
  id: string | number
  subject: string
  date: string
  time: string
  duration: string
  client_name: string
  person_id?: string | number
  deal_id?: string | number
  is_done?: boolean
  pipedrive_person_url?: string
  pipedrive_deal_url?: string
}

export default function AgendaAdminPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'settings' | 'meetings' | 'embed'>('settings')

  // Settings State
  const [settings, setSettings] = useState<CalendarSettingsData | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsFeedback, setSettingsFeedback] = useState('')

  // Meetings List State
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([])
  const [loadingMeetings, setLoadingMeetings] = useState(false)
  const [meetingsFilter, setMeetingsFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [cancelingId, setCancelingId] = useState<string | number | null>(null)

  // Link & Embed Helpers
  const [publicUrl, setPublicUrl] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedEmbed, setCopiedEmbed] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPublicUrl(`${window.location.origin}/agendar`)
    }
  }, [])

  // Carrega configurações
  const fetchSettings = useCallback(async () => {
    try {
      setLoadingSettings(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const res = await axios.get(`${API_URL}/api/calendar/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSettings(res.data)
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoadingSettings(false)
    }
  }, [API_URL, router])

  // Carrega reuniões agendadas no Pipedrive
  const fetchMeetings = useCallback(async () => {
    try {
      setLoadingMeetings(true)
      const token = localStorage.getItem('access_token')
      const res = await axios.get(`${API_URL}/api/calendar/meetings`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { filter_type: meetingsFilter },
      })
      setMeetings(res.data || [])
    } catch (err) {
      console.error('Erro ao buscar reuniões:', err)
    } finally {
      setLoadingMeetings(false)
    }
  }, [API_URL, meetingsFilter])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    if (activeTab === 'meetings') {
      fetchMeetings()
    }
  }, [activeTab, fetchMeetings])

  // Salvar configurações
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return

    try {
      setSavingSettings(true)
      setSettingsFeedback('')
      const token = localStorage.getItem('access_token')
      await axios.post(`${API_URL}/api/calendar/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setSettingsFeedback('Configurações da agenda salvas com sucesso!')
      setTimeout(() => setSettingsFeedback(''), 3000)
    } catch (err) {
      setSettingsFeedback('Erro ao salvar configurações.')
    } finally {
      setSavingSettings(false)
    }
  }

  // Cancelar reunião no Pipedrive
  const handleCancelMeeting = async (activityId: string | number) => {
    if (!confirm('Tem certeza que deseja cancelar esta reunião no Pipedrive?')) return

    try {
      setCancelingId(activityId)
      const token = localStorage.getItem('access_token')
      await axios.delete(`${API_URL}/api/calendar/meetings/${activityId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      fetchMeetings()
    } catch (err) {
      alert('Erro ao cancelar reunião.')
    } finally {
      setCancelingId(null)
    }
  }

  const handleCopyPublicLink = () => {
    navigator.clipboard.writeText(publicUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const iframeCode = `<iframe \n  src="${publicUrl}" \n  width="100%" \n  height="750" \n  frameborder="0" \n  style="border: none; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);"\n></iframe>`

  const handleCopyIframeCode = () => {
    navigator.clipboard.writeText(iframeCode)
    setCopiedEmbed(true)
    setTimeout(() => setCopiedEmbed(false), 2000)
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    router.push('/login')
  }

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length < 3) return dateStr
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
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
        {/* Top Header */}
        <header className="h-16 bg-white dark:bg-[#000D38] border-b border-slate-200/80 dark:border-[#002060] px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center space-x-2 font-display">
              <CalendarIcon className="w-5 h-5 text-[#0092FF]" />
              <span>Configuração da Agenda & Iframe</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Gerencie regras de atendimento e gere o link público ou código embed
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
              title={isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>

            <button
              onClick={handleCopyPublicLink}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/30 transition-all"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Link Copiado!' : 'Copiar Link Público'}</span>
            </button>

            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="Abrir página pública de agendamento em nova aba"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </header>

        {/* Page Content Body */}
        <main className="p-6 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* PUBLIC LINK & EMBED BANNER */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-[#000D38] via-[#002060] to-[#000D38] border border-[#002060] text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#0092FF]/20 text-[#00FFFF] border border-[#0092FF]/40">
                  Agendador Online
                </span>
                <span className="text-xs text-slate-300">Estilo Calendly & Microsoft Bookings</span>
              </div>
              <h3 className="text-sm font-bold text-white">
                Link do seu Domínio para Agendamento & Iframe
              </h3>
              <p className="text-xs text-blue-200 font-mono bg-[#00061A]/70 px-3 py-1.5 rounded-lg inline-block border border-[#002060]">
                {publicUrl || 'Carregando URL...'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyPublicLink}
                className="px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/30 transition-all flex items-center space-x-1.5"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? 'Copiado!' : 'Copiar URL'}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('embed')}
                className="px-3.5 py-2 rounded-xl bg-[#000D38] hover:bg-[#002060] text-white font-semibold text-xs border border-[#002060] transition-all flex items-center space-x-1.5"
              >
                <Code className="w-4 h-4 text-[#00FFFF]" />
                <span>Gerar Código Iframe</span>
              </button>

              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3.5 py-2 rounded-xl bg-[#000D38] hover:bg-[#002060] text-slate-200 font-semibold text-xs border border-[#002060] transition-all flex items-center space-x-1.5"
              >
                <span>Testar Página</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex bg-slate-200/70 p-1 rounded-xl border border-slate-300/60">
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 ${
                  activeTab === 'settings'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sliders className="w-3.5 h-3.5 text-[#0092FF]" />
                <span>Configuração de Horários & Regras</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('meetings')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 ${
                  activeTab === 'meetings'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CalendarCheck className="w-3.5 h-3.5 text-[#002060]" />
                <span>Reuniões Agendadas</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('embed')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-2 ${
                  activeTab === 'embed'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Code className="w-3.5 h-3.5 text-amber-600" />
                <span>Código Iframe (Embed)</span>
              </button>
            </div>
          </div>

          {/* TAB 1: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6 animate-fade-in max-w-4xl">
              {settingsFeedback && (
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-[#002060] animate-slide-down">
                  {settingsFeedback}
                </div>
              )}

              <form onSubmit={handleSaveSettings} className="space-y-6">
                {/* Working Days */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Dias de Atendimento da Agenda
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Selecione em quais dias os clientes poderão agendar reuniões
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 1, label: 'Segunda-feira' },
                      { id: 2, label: 'Terça-feira' },
                      { id: 3, label: 'Quarta-feira' },
                      { id: 4, label: 'Quinta-feira' },
                      { id: 5, label: 'Sexta-feira' },
                      { id: 6, label: 'Sábado' },
                      { id: 7, label: 'Domingo' },
                    ].map((day) => {
                      const isActive = (settings?.work_days || []).includes(day.id)
                      return (
                        <button
                          key={day.id}
                          type="button"
                          onClick={() => {
                            if (!settings) return
                            const current = settings.work_days || []
                            const next = isActive
                              ? current.filter((d) => d !== day.id)
                              : [...current, day.id]
                            setSettings({ ...settings, work_days: next })
                          }}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                            isActive
                              ? 'bg-[#0092FF] text-white border-[#0092FF] shadow-xs'
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Working Hours & Lunch */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Horário Comercial & Intervalo de Almoço
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Defina a janela diária para geração dos horários disponíveis
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Início Expediente
                      </label>
                      <input
                        type="time"
                        value={settings?.start_hour || '08:30'}
                        onChange={(e) =>
                          setSettings(settings ? { ...settings, start_hour: e.target.value } : null)
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Fim Expediente
                      </label>
                      <input
                        type="time"
                        value={settings?.end_hour || '18:00'}
                        onChange={(e) =>
                          setSettings(settings ? { ...settings, end_hour: e.target.value } : null)
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Início Almoço
                      </label>
                      <input
                        type="time"
                        value={settings?.lunch_start || '12:00'}
                        onChange={(e) =>
                          setSettings(settings ? { ...settings, lunch_start: e.target.value } : null)
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Fim Almoço
                      </label>
                      <input
                        type="time"
                        value={settings?.lunch_end || '13:30'}
                        onChange={(e) =>
                          setSettings(settings ? { ...settings, lunch_end: e.target.value } : null)
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Buffer & Notice */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Regras de Intervalo e Antecedência
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Intervalo de Respiro entre Reuniões (Buffer)
                      </label>
                      <select
                        value={settings?.buffer_minutes || 15}
                        onChange={(e) =>
                          setSettings(
                            settings ? { ...settings, buffer_minutes: parseInt(e.target.value) } : null
                          )
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="0">0 minutos (sem intervalo)</option>
                        <option value="10">10 minutos</option>
                        <option value="15">15 minutos (recomendado)</option>
                        <option value="30">30 minutos</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-bold uppercase text-slate-500 block mb-1">
                        Antecedência Mínima para Agendamento
                      </label>
                      <select
                        value={settings?.min_notice_hours || 2}
                        onChange={(e) =>
                          setSettings(
                            settings ? { ...settings, min_notice_hours: parseInt(e.target.value) } : null
                          )
                        }
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="1">1 hora de antecedência</option>
                        <option value="2">2 horas de antecedência</option>
                        <option value="4">4 horas de antecedência</option>
                        <option value="24">24 horas (1 dia antes)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Meeting Types List */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Tipos de Reunião Habilitados
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tipos de reunião que aparecem para o cliente escolher na página pública
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(settings?.meeting_types || []).map((m) => (
                      <div key={m.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-900">{m.name}</h4>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
                            {m.duration} min
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">{m.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center space-x-2"
                >
                  <Check className="w-4 h-4 text-teal-400" />
                  <span>{savingSettings ? 'Salvando...' : 'Salvar Configurações da Agenda'}</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 2: SCHEDULED MEETINGS */}
          {activeTab === 'meetings' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-sm">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Reuniões Agendadas no Pipedrive
                  </h3>
                  <p className="text-xs text-slate-500">
                    Atividades do tipo &quot;Reunião&quot; sincronizadas em tempo real
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMeetingsFilter('upcoming')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      meetingsFilter === 'upcoming'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Próximas
                  </button>
                  <button
                    onClick={() => setMeetingsFilter('past')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      meetingsFilter === 'past'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Concluídas
                  </button>
                  <button
                    onClick={() => setMeetingsFilter('all')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      meetingsFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Todas
                  </button>
                </div>
              </div>

              {loadingMeetings ? (
                <div className="py-20 text-center space-y-3">
                  <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs font-semibold text-slate-600">Carregando reuniões...</p>
                </div>
              ) : meetings.length === 0 ? (
                <div className="py-20 bg-white rounded-2xl border border-slate-200/90 text-center p-6 shadow-sm">
                  <CalendarCheck className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                  <h3 className="text-sm font-bold text-slate-900">Nenhuma reunião encontrada</h3>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {meetings.map((m) => (
                    <div
                      key={m.id}
                      className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
                            {m.time} • {m.duration}
                          </span>
                          <span className="text-xs font-semibold text-slate-500">
                            {formatDateDisplay(m.date)}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-slate-900 leading-snug mt-2 line-clamp-2">
                          {m.subject}
                        </h4>

                        {m.client_name && (
                          <p className="text-xs text-slate-600 font-medium mt-1.5 flex items-center space-x-1.5">
                            <User className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                            <span className="truncate">{m.client_name}</span>
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {m.pipedrive_person_url && (
                            <a
                              href={m.pipedrive_person_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold text-[11px] transition-colors"
                            >
                              <span>Pessoa</span>
                              <ExternalLink className="w-3 h-3 text-teal-600" />
                            </a>
                          )}
                          {m.pipedrive_deal_url && (
                            <a
                              href={m.pipedrive_deal_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] transition-colors"
                            >
                              <span>Deal</span>
                              <ExternalLink className="w-3 h-3 text-slate-300" />
                            </a>
                          )}
                        </div>

                        <button
                          onClick={() => handleCancelMeeting(m.id)}
                          disabled={cancelingId === m.id}
                          className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                          title="Cancelar reunião no Pipedrive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EMBED / IFRAME GENERATOR */}
          {activeTab === 'embed' && (
            <div className="space-y-6 animate-fade-in max-w-4xl">
              <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/90 shadow-sm space-y-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Código de Incorporação (Iframe Embed)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Copie o código abaixo e cole no HTML do seu site, landing page ou portal de clientes
                  </p>
                </div>

                {/* Code Snippet Box */}
                <div className="relative">
                  <pre className="p-4 bg-slate-950 text-teal-300 rounded-2xl text-xs font-mono overflow-x-auto border border-slate-800">
                    <code>{iframeCode}</code>
                  </pre>
                  <button
                    onClick={handleCopyIframeCode}
                    className="absolute right-3 top-3 px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs shadow-sm transition-all flex items-center space-x-1.5"
                  >
                    {copiedEmbed ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedEmbed ? 'Copiado!' : 'Copiar Código'}</span>
                  </button>
                </div>

                {/* Live Preview */}
                <div className="space-y-2 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase text-slate-600">
                      Pré-visualização do Iframe ao Vivo
                    </h4>
                    <span className="text-[11px] text-slate-400">Dimensão simulada</span>
                  </div>
                  <div className="border border-slate-300 rounded-2xl overflow-hidden shadow-inner bg-slate-100 p-2">
                    <iframe
                      src={publicUrl}
                      className="w-full h-[600px] rounded-xl border border-slate-200 bg-white"
                      title="Pré-visualização do Agendador"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
