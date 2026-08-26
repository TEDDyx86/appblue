'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import axios from 'axios'
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  RefreshCw,
  Phone,
  Mail,
  Video,
  Check,
  Building2,
  ShieldCheck,
} from 'lucide-react'

import { useRouter } from 'next/navigation'

interface MeetingType {
  id: string
  name: string
  duration: number
  color: string
  description: string
}

interface Slot {
  time: string
  end_time: string
  duration_minutes: number
}

interface DayData {
  date: string
  weekday_name: string
  day_of_month: number
  month_name: string
  has_slots: boolean
  slots_count: number
  slots: Slot[]
}

export default function AuthenticatedBookingPage() {
  const router = useRouter()
  const [plannerInfo, setPlannerInfo] = useState({
    planner_name: 'Robson Vieira Tavernard',
    planner_role: 'Planejamento Financeiro e Sucessório',
    company: 'Blue3 Investimentos',
  })
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([])
  const [selectedMeetingType, setSelectedMeetingType] = useState<MeetingType | null>(null)

  // Assessores / Organizações
  const [assessores, setAssessores] = useState<{ id: number; name: string }[]>([])
  const [selectedAssessorId, setSelectedAssessorId] = useState<string | number>('')

  // Booking slots
  const [availableDays, setAvailableDays] = useState<DayData[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>('')

  // Step flow
  const [step, setStep] = useState<'type' | 'datetime' | 'form' | 'success'>('type')

  // Form Fields
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [platform, setPlatform] = useState<'teams' | 'meet' | 'presencial'>('teams')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bookingResult, setBookingResult] = useState<any>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  // Carregamento inicial de tipos de reunião e assessores
  useEffect(() => {
    async function loadInitialData() {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const [typesRes, assessoresRes] = await Promise.allSettled([
          axios.get(`${API_URL}/api/calendar/types`, { headers }),
          axios.get(`${API_URL}/api/calendar/assessores`, { headers }),
        ])

        if (typesRes.status === 'fulfilled') {
          const res = typesRes.value
          setPlannerInfo({
            planner_name: res.data.planner_name || 'Robson Vieira Tavernard',
            planner_role: res.data.planner_role || 'Planejamento Financeiro e Sucessório',
            company: res.data.company || 'Blue3 Investimentos',
          })
          const types = res.data.meeting_types || []
          setMeetingTypes(types)
          if (types.length > 0) {
            setSelectedMeetingType(types[0])
          }
        }

        if (assessoresRes.status === 'fulfilled') {
          const raw = assessoresRes.value.data
          const list = Array.isArray(raw) ? raw : raw?.assessores || []
          setAssessores(list)
        }
      } catch (err: any) {
        console.error('Erro ao carregar dados iniciais:', err)
      }
    }
    loadInitialData()
  }, [API_URL])

  // Carrega slots quando o tipo de reunião mudar
  const loadSlots = useCallback(
    async (duration: number) => {
      try {
        setLoadingSlots(true)
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
        const headers: Record<string, string> = {}
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const res = await axios.get(`${API_URL}/api/calendar/available-slots`, {
          headers,
          params: { duration, days_count: 35 },
        })
        const days: DayData[] = res.data.days || []
        setAvailableDays(days)
        setLastUpdatedTime(
          new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        )
        const firstWithSlots = days.find((d) => d.has_slots)
        if (firstWithSlots) {
          setSelectedDate(firstWithSlots.date)
        }
      } catch (err: any) {
        console.error('Erro ao carregar slots disponíveis:', err)
      } finally {
        setLoadingSlots(false)
      }
    },
    [API_URL]
  )

  useEffect(() => {
    if (selectedMeetingType) {
      loadSlots(selectedMeetingType.duration)
    }
  }, [selectedMeetingType, loadSlots])

  const selectedDayObject = useMemo(() => {
    return availableDays.find((d) => d.date === selectedDate)
  }, [availableDays, selectedDate])

  const selectedAssessorObj = useMemo(() => {
    if (!selectedAssessorId) return null
    return assessores.find((a) => String(a.id) === String(selectedAssessorId)) || null
  }, [assessores, selectedAssessorId])

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return ''
    const parts = dateStr.split('-')
    if (parts.length < 3) return dateStr
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
    return d.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !selectedSlot || !selectedMeetingType || !clientName.trim()) return

    try {
      setSubmitting(true)
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
      const headers: Record<string, string> = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const payload = {
        date: selectedDate,
        time: selectedSlot.time,
        meeting_type_id: selectedMeetingType.id,
        meeting_type_name: selectedMeetingType.name,
        duration_minutes: selectedMeetingType.duration,
        client_name: clientName.trim(),
        client_email: clientEmail.trim() || undefined,
        client_phone: clientPhone.trim() || undefined,
        org_id: selectedAssessorId ? Number(selectedAssessorId) : undefined,
        org_name: selectedAssessorObj?.name || undefined,
        platform,
        notes: notes.trim() || undefined,
      }

      const res = await axios.post(`${API_URL}/api/calendar/book`, payload, { headers })
      setBookingResult(res.data)
      setStep('success')
    } catch (err: any) {
      alert(`Erro ao confirmar agendamento: ${err.response?.data?.detail || err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-3 sm:p-6 font-sans">
      {/* Container Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xl max-w-4xl w-full overflow-hidden transition-all">
        {/* Top Header / Profile Bar */}
        <header className="p-6 bg-[#000D38] text-white border-b border-[#002060] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <img
              src="/logo-rt-horizontal-white.png"
              alt="Robson Tavernard"
              style={{ maxHeight: '38px', maxWidth: '180px' }}
              className="h-10 w-auto max-w-[180px] object-contain flex-shrink-0"
            />
            <div className="border-l border-[#002060] pl-4">
              <div className="flex items-center space-x-2">
                <h1 className="text-sm font-bold tracking-tight font-display">{plannerInfo.planner_name}</h1>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-[#0092FF]/20 text-[#00FFFF] border border-[#0092FF]/30 text-[10px] font-bold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Verificado</span>
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {plannerInfo.planner_role} • <strong className="text-[#0092FF]">{plannerInfo.company}</strong>
              </p>
            </div>
          </div>

          {step !== 'type' && step !== 'success' && (
            <button
              onClick={() => {
                if (step === 'form') setStep('datetime')
                else if (step === 'datetime') setStep('type')
              }}
              className="inline-flex items-center space-x-1 text-xs text-slate-300 hover:text-white transition-colors self-start sm:self-center"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
          )}
        </header>

        {/* STEP 1: SELECT MEETING TYPE */}
        {step === 'type' && (
          <div className="p-6 sm:p-8 space-y-6 animate-fade-in">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Selecione o Tipo de Reunião</h2>
              <p className="text-xs text-slate-500 mt-1">
                Escolha o objetivo do nosso encontro para vermos os horários disponíveis
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {meetingTypes.map((mType) => {
                const isPlanning = mType.duration >= 50 || mType.name.toLowerCase().includes('sucessório') || mType.name.toLowerCase().includes('patrimonial')
                return (
                  <button
                    key={mType.id}
                    type="button"
                    onClick={() => {
                      setSelectedMeetingType(mType)
                      setStep('datetime')
                    }}
                    className={`text-left p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between group hover:scale-[1.01] hover:shadow-lg ${
                      isPlanning
                        ? 'border-amber-200/90 bg-gradient-to-br from-white to-amber-50/30 hover:border-amber-400 hover:shadow-amber-500/10'
                        : 'border-slate-200/90 bg-gradient-to-br from-white to-blue-50/20 hover:border-[#0092FF] hover:shadow-blue-500/10'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                            isPlanning
                              ? 'bg-amber-50 text-amber-700 border-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
                              : 'bg-blue-50 text-[#0092FF] border-blue-200 shadow-[0_0_8px_rgba(0,146,255,0.2)]'
                          }`}
                        >
                          {mType.duration} minutos
                        </span>
                        <span className="text-xs font-bold text-[#0092FF] group-hover:translate-x-1 transition-transform flex items-center">
                          Selecionar →
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 group-hover:text-[#0092FF] transition-colors font-display">
                        {mType.name}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                        {mType.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* STEP 2: SELECT DATE & TIME (CALENDLY STYLE) */}
        {step === 'datetime' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px] animate-fade-in divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left: Meeting Summary & Calendar */}
            <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="mb-5 flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#0092FF] block">
                      {selectedMeetingType?.duration} minutos de reunião
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      {selectedMeetingType?.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Selecione uma das datas disponíveis abaixo
                    </p>
                  </div>

                  {/* Botão de Atualizar e Horário da Última Atualização */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 flex-shrink-0">
                    {lastUpdatedTime && (
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold shadow-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>Atualizado às {lastUpdatedTime}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => selectedMeetingType && loadSlots(selectedMeetingType.duration)}
                      disabled={loadingSlots}
                      className="px-2.5 py-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#0092FF] transition-all flex items-center space-x-1 text-xs font-bold shadow-xs active:scale-95 disabled:opacity-50"
                      title="Atualizar horários em tempo real com o Pipedrive"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingSlots ? 'animate-spin text-[#0092FF]' : ''}`} />
                      <span className="hidden sm:inline">Atualizar</span>
                    </button>
                  </div>
                </div>

                {loadingSlots ? (
                  <div className="py-20 text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-xs font-semibold text-slate-600">Buscando horários disponíveis...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {availableDays.map((d) => {
                      const isSelected = selectedDate === d.date
                      const isAvailable = d.has_slots

                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => {
                            setSelectedDate(d.date)
                            setSelectedSlot(null)
                          }}
                          className={`p-3 rounded-xl border text-left transition-all relative ${
                            isSelected
                              ? 'bg-[#000D38] text-white border-[#000D38] shadow-sm ring-2 ring-[#0092FF]'
                              : isAvailable
                              ? 'bg-blue-50/40 border-blue-200 text-slate-900 hover:bg-blue-100/60'
                              : 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed opacity-50'
                          }`}
                        >
                          <span
                            className={`text-[10px] font-bold block uppercase ${
                              isSelected ? 'text-[#00FFFF]' : isAvailable ? 'text-[#0092FF]' : 'text-slate-400'
                            }`}
                          >
                            {d.weekday_name}
                          </span>
                          <span className="text-base font-bold block mt-0.5">
                            {d.day_of_month} {d.month_name.slice(0, 3)}
                          </span>
                          {isAvailable && (
                            <span
                              className={`text-[10px] block mt-1 font-medium ${
                                isSelected ? 'text-slate-300' : 'text-[#002060]'
                              }`}
                            >
                              {d.slots_count} {d.slots_count === 1 ? 'vaga' : 'vagas'}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>Fuso horário: <strong>Brasília (GMT-3)</strong></span>
                <button
                  onClick={() => setStep('type')}
                  className="text-[#0092FF] font-bold hover:underline"
                >
                  Alterar tipo de reunião
                </button>
              </div>
            </div>

            {/* Right: Available Slots */}
            <div className="lg:col-span-5 p-6 sm:p-8 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <div className="mb-4">
                  <span className="text-[10px] uppercase font-bold text-[#0092FF] block">
                    Horários Livres
                  </span>
                  <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                    {selectedDate ? formatDateDisplay(selectedDate) : 'Selecione uma data'}
                  </h4>
                </div>

                {!selectedDate ? (
                  <div className="py-20 text-center text-slate-400">
                    <CalendarIcon className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-xs">Selecione uma data ao lado</p>
                  </div>
                ) : !selectedDayObject || !selectedDayObject.has_slots ? (
                  <div className="py-16 text-center text-slate-500 bg-white rounded-xl border border-slate-200 p-6">
                    <AlertCircle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
                    <h5 className="text-xs font-bold text-slate-900">Sem horários para este dia</h5>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Por favor, escolha outro dia com vagas disponíveis.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
                    {selectedDayObject.slots.map((slot) => {
                      const isSlotSelected = selectedSlot?.time === slot.time

                      return (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-3 px-3 rounded-xl font-bold text-xs border transition-all flex flex-col items-center justify-center ${
                            isSlotSelected
                              ? 'bg-[#0092FF] text-white border-[#0092FF] shadow-sm scale-102'
                              : 'bg-white text-slate-800 border-slate-200 hover:border-[#0092FF] hover:text-[#0092FF]'
                          }`}
                        >
                          <span>{slot.time}</span>
                          <span className={`text-[10px] font-normal ${isSlotSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                            até {slot.end_time}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  disabled={!selectedSlot}
                  onClick={() => setStep('form')}
                  className="w-full py-3 rounded-xl bg-[#000D38] hover:bg-[#002060] text-white font-bold text-xs shadow-sm transition-all disabled:opacity-40 flex items-center justify-center space-x-1.5"
                >
                  <span>{selectedSlot ? `Avançar com horário ${selectedSlot.time}` : 'Selecione um horário'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: CLIENT DETAILS FORM */}
        {step === 'form' && (
          <form onSubmit={handleBookingSubmit} className="p-6 sm:p-8 space-y-5 animate-fade-in max-w-xl mx-auto">
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-[#002060] flex items-center justify-between font-bold text-xs">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-[#0092FF]" />
                <span>
                  {formatDateDisplay(selectedDate)} às {selectedSlot?.time}
                </span>
              </div>
              <span className="text-[#0092FF] font-semibold">{selectedMeetingType?.name} ({selectedMeetingType?.duration} min)</span>
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900">Seus Dados de Contato</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Preencha para receber a confirmação e o link da reunião
              </p>
            </div>

            {/* Name */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                Nome do Cliente *
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nome completo do cliente"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                />
              </div>
            </div>

            {/* Assessor / Organização */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                🏢 Assessor Responsável (Organização) *
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select
                  required
                  value={selectedAssessorId}
                  onChange={(e) => setSelectedAssessorId(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none transition-all cursor-pointer"
                >
                  <option value="">Selecione o Assessor / Organização...</option>
                  {assessores.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Vincula o agendamento diretamente à organização do assessor no Pipedrive.
              </span>
            </div>

            {/* Email & Phone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                  E-mail *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                  Telefone / WhatsApp *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="tel"
                    required
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(XX) 99999-9999"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Platform */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                Formato de Preferência
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'teams', label: 'Microsoft Teams' },
                  { id: 'meet', label: 'Google Meet' },
                  { id: 'presencial', label: 'Presencial' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id as any)}
                    className={`p-2.5 rounded-xl border text-center font-bold text-xs transition-all ${
                      platform === p.id
                        ? 'bg-[#000D38] text-white border-[#000D38] shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 uppercase block mb-1">
                Tópicos de interesse ou mensagem (opcional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Reunião R1 de planejamento sucessório..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
              />
            </div>

            <div className="pt-3 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setStep('datetime')}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-3 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/30 transition-all disabled:opacity-50 flex items-center space-x-2"
              >
                <span>{submitting ? 'Confirmando...' : 'Confirmar Agendamento'}</span>
                <Check className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 4: SUCCESS CONFIRMATION */}
        {step === 'success' && (
          <div className="p-8 sm:p-12 text-center space-y-5 animate-scale-in max-w-lg mx-auto">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-slate-900">Reunião Agendada com Sucesso!</h2>
              <p className="text-xs text-slate-500 mt-1">
                A atividade foi criada na agenda do Pipedrive com status em aberto.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Cliente:</span>
                <span className="font-bold text-slate-900">{clientName}</span>
              </div>
              {selectedAssessorObj && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Assessor:</span>
                  <span className="font-bold text-[#0092FF]">{selectedAssessorObj.name}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Data:</span>
                <span className="font-bold text-slate-900">{formatDateDisplay(selectedDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Horário:</span>
                <span className="font-bold text-slate-900">{selectedSlot?.time} (Duração: {selectedMeetingType?.duration} min)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Plataforma:</span>
                <span className="font-bold text-slate-900 uppercase">{platform}</span>
              </div>
            </div>

            <button
              onClick={() => {
                setStep('type')
                setClientName('')
                setClientEmail('')
                setClientPhone('')
                setNotes('')
                setSelectedSlot(null)
              }}
              className="px-6 py-2.5 rounded-xl bg-[#000D38] text-white font-bold text-xs hover:bg-[#002060] transition-colors"
            >
              Agendar Outro Horário
            </button>
          </div>
        )}
      </div>

      <footer className="mt-4 text-center text-[11px] text-slate-400">
        © {new Date().getFullYear()} {plannerInfo.company} • Todos os direitos reservados.
      </footer>
    </div>
  )
}
