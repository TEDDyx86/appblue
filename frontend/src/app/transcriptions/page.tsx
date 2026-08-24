'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import {
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  User,
  Tag,
  Target,
  ExternalLink,
  X,
  Filter,
  Calendar,
  Layers,
  Sun,
  Moon,
  Briefcase,
  Sparkles,
  Link as LinkIcon,
  Check,
  Plus,
  ArrowUpRight,
  EyeOff,
  Eye,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface BriefingData {
  principais_topicos?: string[]
  dados_cliente?: {
    nome?: string
    idade?: string
    estado_civil?: string
    demonstrou_interesse?: string
    email?: string
  }
  proxima_acao?: {
    descricao?: string
    prazo_sugerido?: string
    prioridade?: string
  }
  observacoes?: string
  tactiq_link?: string
  is_ignored?: boolean
  pipedrive?: {
    person_id?: string
    deal_id?: string
    activity_id?: string
    person_url?: string
    deal_url?: string
  }
}

interface Transcription {
  id: string
  google_doc_id: string
  meeting_title: string | null
  meeting_date: string | null
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  briefing_json?: BriefingData | null
  cliente_nome?: string
  created_at: string
}

export default function TranscriptionsPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [loading, setLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Transcription | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [crmFilter, setCrmFilter] = useState<'all' | 'linked' | 'unlinked' | 'ignored'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'client_az' | 'linked_first'>('newest')
  const [syncFeedback, setSyncFeedback] = useState('')

  // Assign Modal state
  const [assignItem, setAssignItem] = useState<Transcription | null>(null)
  const [assignMode, setAssignMode] = useState<'person' | 'deal'>('person')
  const [searchPersonTerm, setSearchPersonTerm] = useState('')
  const [searchingPersons, setSearchingPersons] = useState(false)
  const [personResults, setPersonResults] = useState<any[]>([])
  const [selectedPerson, setSelectedPerson] = useState<any | null>(null)

  const [searchDealTerm, setSearchDealTerm] = useState('')
  const [searchingDeals, setSearchingDeals] = useState(false)
  const [dealResults, setDealResults] = useState<any[]>([])
  const [selectedDeal, setSelectedDeal] = useState<any | null>(null)

  const [createNote, setCreateNote] = useState(true)
  const [createActivity, setCreateActivity] = useState(true)
  const [submittingAssign, setSubmittingAssign] = useState(false)
  const [assignSuccess, setAssignSuccess] = useState(false)
  const [togglingIgnoreId, setTogglingIgnoreId] = useState<string | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    fetchTranscriptions()
  }, [])

  const fetchTranscriptions = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const response = await axios.get(`${API_URL}/api/transcriptions`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 100 },
      })
      setTranscriptions(response.data)
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTriggerSync = async () => {
    try {
      setIsSyncing(true)
      setSyncFeedback('')
      const token = localStorage.getItem('access_token')
      await axios.post(
        `${API_URL}/api/webhooks/trigger-sync`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSyncFeedback('Varredura do Google Drive iniciada em segundo plano!')
      setTimeout(() => {
        fetchTranscriptions()
      }, 3000)
    } catch (err: any) {
      setSyncFeedback('Erro ao disparar sincronização.')
    } finally {
      setIsSyncing(false)
    }
  }

  // Toggle ignore / internal meeting
  const handleToggleIgnore = async (transcriptionId: string) => {
    try {
      setTogglingIgnoreId(transcriptionId)
      const token = localStorage.getItem('access_token')
      const res = await axios.post(
        `${API_URL}/api/transcriptions/${transcriptionId}/toggle-ignore`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )

      setTranscriptions((prev) =>
        prev.map((t) =>
          t.id === transcriptionId
            ? { ...t, briefing_json: res.data.briefing_json }
            : t
        )
      )

      if (selectedItem?.id === transcriptionId) {
        setSelectedItem((prev) => (prev ? { ...prev, briefing_json: res.data.briefing_json } : null))
      }
    } catch (err: any) {
      alert('Erro ao alterar status da transcrição: ' + (err.response?.data?.detail || err.message))
    } finally {
      setTogglingIgnoreId(null)
    }
  }

  // Autocomplete search for Persons
  useEffect(() => {
    if (searchPersonTerm.trim().length < 2) {
      setPersonResults([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        setSearchingPersons(true)
        const token = localStorage.getItem('access_token')
        const res = await axios.get(`${API_URL}/api/pipedrive/search-persons`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { term: searchPersonTerm.trim() },
        })
        setPersonResults(res.data.items || [])
      } catch (err) {
        console.error('Erro ao buscar pessoas:', err)
      } finally {
        setSearchingPersons(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchPersonTerm, API_URL])

  // Autocomplete search for Deals
  useEffect(() => {
    if (searchDealTerm.trim().length < 1) {
      setDealResults([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        setSearchingDeals(true)
        const token = localStorage.getItem('access_token')
        const res = await axios.get(`${API_URL}/api/pipedrive/search-deals`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { term: searchDealTerm.trim() },
        })
        setDealResults(res.data.items || [])
      } catch (err) {
        console.error('Erro ao buscar negócios:', err)
      } finally {
        setSearchingDeals(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchDealTerm, API_URL])

  const handleOpenAssignModal = (item: Transcription) => {
    setAssignItem(item)
    setSelectedPerson(null)
    setSelectedDeal(null)
    setSearchPersonTerm(item.briefing_json?.dados_cliente?.nome || '')
    setSearchDealTerm('')
    setAssignMode('person')
    setAssignSuccess(false)
  }

  const handleConfirmAssign = async () => {
    if (!assignItem) return
    if (!selectedPerson && !selectedDeal && !searchDealTerm.trim()) {
      alert('Por favor selecione uma Pessoa ou informe um Negócio (Deal) do Pipedrive.')
      return
    }

    try {
      setSubmittingAssign(true)
      const token = localStorage.getItem('access_token')
      const dealIdToAssign = selectedDeal?.id || (searchDealTerm.trim() && !isNaN(Number(searchDealTerm)) ? searchDealTerm.trim() : undefined)
      const personIdToAssign = selectedPerson?.id || undefined
      const clientNameToAssign = selectedPerson?.name || selectedDeal?.person_name || undefined

      const res = await axios.post(
        `${API_URL}/api/transcriptions/${assignItem.id}/assign-pipedrive`,
        {
          person_id: personIdToAssign ? String(personIdToAssign) : undefined,
          deal_id: dealIdToAssign ? String(dealIdToAssign) : undefined,
          cliente_nome: clientNameToAssign,
          create_note: createNote,
          create_activity: createActivity,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )

      setAssignSuccess(true)
      setTranscriptions((prev) =>
        prev.map((t) =>
          t.id === assignItem.id
            ? {
                ...t,
                briefing_json: res.data.briefing_json,
                cliente_nome: clientNameToAssign || t.cliente_nome,
              }
            : t
        )
      )

      if (selectedItem?.id === assignItem.id) {
        setSelectedItem((prev) =>
          prev
            ? {
                ...prev,
                briefing_json: res.data.briefing_json,
                cliente_nome: clientNameToAssign || prev.cliente_nome,
              }
            : null
        )
      }

      setTimeout(() => {
        setAssignItem(null)
        setAssignSuccess(false)
      }, 1500)
    } catch (err: any) {
      alert('Erro ao vincular ao Pipedrive: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSubmittingAssign(false)
    }
  }

  const filteredTranscriptions = useMemo(() => {
    const list = transcriptions.filter((t) => {
      if (statusFilter !== 'all' && t.processing_status !== statusFilter) return false

      const isIgnored = t.briefing_json?.observacoes?.includes('[IGNORADA')
      const isLinked = Boolean(
        t.briefing_json?.pipedrive?.deal_id || t.briefing_json?.pipedrive?.person_id
      )

      if (crmFilter === 'ignored' && !isIgnored) return false
      if (crmFilter === 'linked' && (!isLinked || isIgnored)) return false
      if (crmFilter === 'unlinked' && (isLinked || isIgnored)) return false

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase()
        const title = (t.meeting_title || '').toLowerCase()
        const client = (t.briefing_json?.dados_cliente?.nome || t.cliente_nome || '').toLowerCase()
        const topics = (t.briefing_json?.principais_topicos || []).join(' ').toLowerCase()
        const deal = (t.briefing_json?.pipedrive?.deal_id || '').toLowerCase()
        if (!title.includes(q) && !client.includes(q) && !topics.includes(q) && !deal.includes(q)) return false
      }
      return true
    })

    return list.sort((a, b) => {
      if (sortBy === 'newest') {
        const dateA = new Date(a.meeting_date || a.created_at).getTime()
        const dateB = new Date(b.meeting_date || b.created_at).getTime()
        return dateB - dateA
      }
      if (sortBy === 'oldest') {
        const dateA = new Date(a.meeting_date || a.created_at).getTime()
        const dateB = new Date(b.meeting_date || b.created_at).getTime()
        return dateA - dateB
      }
      if (sortBy === 'client_az') {
        const nameA = a.briefing_json?.dados_cliente?.nome || a.cliente_nome || a.meeting_title || ''
        const nameB = b.briefing_json?.dados_cliente?.nome || b.cliente_nome || b.meeting_title || ''
        return nameA.localeCompare(nameB)
      }
      if (sortBy === 'linked_first') {
        const isLinkedA = Boolean(a.briefing_json?.pipedrive?.deal_id || a.briefing_json?.pipedrive?.person_id) ? 1 : 0
        const isLinkedB = Boolean(b.briefing_json?.pipedrive?.deal_id || b.briefing_json?.pipedrive?.person_id) ? 1 : 0
        return isLinkedB - isLinkedA
      }
      return 0
    })
  }, [transcriptions, statusFilter, crmFilter, searchTerm, sortBy])

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Recente'
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
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

      {/* Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? 'pl-20' : 'pl-64'
        }`}
      >
        {/* Top Header */}
        <header className="h-16 bg-white dark:bg-[#000D38] border-b border-slate-200/80 dark:border-[#002060] px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30 transition-colors">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight font-display">
              Transcrições & Briefings
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Histórico de reuniões transcritas pelo Tactiq e processadas por IA
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
              onClick={handleTriggerSync}
              disabled={isSyncing}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">
                {isSyncing ? 'Buscando no Drive...' : 'Sincronizar Drive'}
              </span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6 sm:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {syncFeedback && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-800 flex items-center justify-between animate-fade-in">
              <span>{syncFeedback}</span>
              <button onClick={() => setSyncFeedback('')} className="text-blue-600 hover:text-blue-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Search and Filters Bar */}
          <div className="bg-white dark:bg-[#000D38] p-4 rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 transition-colors">
            {/* Search Input & Sort Select */}
            <div className="flex flex-col sm:flex-row items-center gap-3 flex-1">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por cliente, tópicos, título ou Deal..."
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-[#00061A] focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
                />
              </div>

              {/* Ordenação por Data / Mais Recente */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full sm:w-56 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                title="Ordenar transcrições"
              >
                <option value="newest">📅 Mais Recentes (Data ↓)</option>
                <option value="oldest">⏳ Mais Antigas (Data ↑)</option>
                <option value="client_az">👤 Nome do Cliente (A-Z)</option>
                <option value="linked_first">🎯 Vinculadas no CRM Primeiro</option>
              </select>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400 mr-1 uppercase">Filtro:</span>
              {[
                { id: 'all', label: 'Todas' },
                { id: 'linked', label: 'Vinculadas no CRM' },
                { id: 'unlinked', label: 'Pendentes de Vínculo' },
                { id: 'ignored', label: 'Internas / Ignoradas' },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setCrmFilter(pill.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    crmFilter === pill.id
                      ? 'bg-[#0092FF] text-white shadow-[0_0_12px_rgba(0,146,255,0.3)]'
                      : 'bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] border border-transparent dark:border-[#002060]'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-10 h-10 border-3 border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Carregando transcrições...</p>
            </div>
          ) : filteredTranscriptions.length === 0 ? (
            <div className="py-20 bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] text-center p-6 shadow-sm">
              <FileText className="w-12 h-12 mx-auto text-slate-400 mb-3 opacity-60" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Nenhuma transcrição encontrada
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                Não há transcrições com os filtros selecionados.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTranscriptions.map((item) => {
                const briefing = item.briefing_json
                const isIgnored = Boolean(briefing?.is_ignored)
                const clientName = briefing?.dados_cliente?.nome || item.cliente_nome
                const isLinked = Boolean(
                  briefing?.pipedrive?.deal_id || briefing?.pipedrive?.person_id
                )
                const personId = briefing?.pipedrive?.person_id
                const dealId = briefing?.pipedrive?.deal_id
                const personUrl = briefing?.pipedrive?.person_url || (personId ? `https://investimentosblue.pipedrive.com/person/${personId}` : null)
                const dealUrl = briefing?.pipedrive?.deal_url || (dealId ? `https://investimentosblue.pipedrive.com/deal/${dealId}` : null)

                return (
                  <div
                    key={item.id}
                    className={`bg-white dark:bg-[#000D38] rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group ${
                      isIgnored
                        ? 'border-slate-200/60 dark:border-[#002060]/50 opacity-75'
                        : 'border-slate-200/90 dark:border-[#002060] dark:hover:border-[#0092FF]/50'
                    }`}
                  >
                    <div>
                      {/* Top status bar */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        {isIgnored ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 flex items-center space-x-1">
                            <EyeOff className="w-3 h-3" />
                            <span>Interna / Ignorada</span>
                          </span>
                        ) : isLinked ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 flex items-center space-x-1">
                            <CheckCircle className="w-3 h-3" />
                            <span>Vinculado no Pipedrive</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60 flex items-center space-x-1">
                            <Clock className="w-3 h-3" />
                            <span>Pendente de Vínculo</span>
                          </span>
                        )}

                        <span className="text-[11px] text-slate-400 font-medium">
                          {formatDate(item.meeting_date || item.created_at)}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 font-display">
                        {item.meeting_title || 'Reunião Tactiq'}
                      </h3>

                      {/* Client row */}
                      {clientName && (
                        <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold mt-2 flex items-center space-x-1.5">
                          <User className="w-3.5 h-3.5 text-[#0092FF] flex-shrink-0" />
                          <span className="truncate">{clientName}</span>
                        </p>
                      )}

                      {/* Associação Pipedrive Card */}
                      <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-[#00061A]/70 border border-slate-200/90 dark:border-[#002060] text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block font-display">
                            Vínculo Pipedrive CRM
                          </span>
                          {!isLinked && !isIgnored && (
                            <button
                              onClick={() => handleOpenAssignModal(item)}
                              className="text-[10px] font-bold text-[#0092FF] dark:text-[#00FFFF] hover:underline flex items-center space-x-1"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Atribuir Agora</span>
                            </button>
                          )}
                        </div>

                        {isIgnored ? (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 italic text-[11px]">
                              Marcada como reunião interna
                            </span>
                            <button
                              onClick={() => handleToggleIgnore(item.id)}
                              disabled={togglingIgnoreId === item.id}
                              className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Reativar</span>
                            </button>
                          </div>
                        ) : isLinked ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {personUrl && (
                              <a
                                href={personUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-[#0092FF] dark:text-[#00FFFF] font-bold text-[11px] hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                                title="Abrir Pessoa no Pipedrive"
                              >
                                <span>👤 Pessoa #{personId}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}

                            {dealUrl && (
                              <a
                                href={dealUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#002060] text-white font-semibold text-[11px] hover:bg-[#001D99] transition-colors"
                                title="Abrir Negócio (Deal) no Pipedrive"
                              >
                                <span>💼 Deal #{dealId}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <button
                              onClick={() => handleToggleIgnore(item.id)}
                              disabled={togglingIgnoreId === item.id}
                              className="text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 flex items-center space-x-1 transition-colors"
                              title="Marcar como reunião interna e não gerar pendência"
                            >
                              <EyeOff className="w-3 h-3" />
                              <span>Ignorar</span>
                            </button>

                            <button
                              onClick={() => handleOpenAssignModal(item)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-[11px] shadow-xs shadow-blue-500/20 transition-all"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>Atribuir</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Próxima Ação */}
                      {briefing?.proxima_acao?.descricao && !isIgnored && (
                        <div className="mt-2.5 p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 text-xs">
                          <span className="text-[10px] uppercase font-bold text-[#002060] dark:text-[#0092FF] block mb-0.5">
                            Próxima Ação:
                          </span>
                          <p className="text-slate-800 dark:text-slate-200 line-clamp-2 text-[11px]">
                            {briefing.proxima_acao.descricao}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Bottom Actions */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#002060] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {item.google_doc_id && (
                          <a
                            href={`https://docs.google.com/document/d/${item.google_doc_id}/edit`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 text-emerald-800 dark:text-emerald-400 font-semibold text-[11px] border border-emerald-200 dark:border-emerald-800/60 transition-colors"
                            title="Abrir Google Doc original"
                          >
                            <span>Google Drive</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}

                        {briefing?.tactiq_link && (
                          <a
                            href={briefing.tactiq_link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-300 font-semibold text-[11px] border border-transparent dark:border-[#002060] transition-colors"
                            title="Abrir no Tactiq"
                          >
                            <span>Tactiq</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedItem(item)}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-slate-900 dark:text-white hover:text-[#0092FF] dark:hover:text-[#00FFFF] transition-colors py-1 px-2 rounded-lg hover:bg-slate-100 dark:hover:bg-[#002060]"
                      >
                        <span>Ver Briefing</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* ASSIGN TO PIPEDRIVE MODAL */}
      {assignItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#000D38] rounded-3xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200/90 dark:border-[#002060]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] rounded-xl border border-blue-200 dark:border-blue-800/60">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                    Atribuir Transcrição ao Pipedrive
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-sm">
                    {assignItem.meeting_title}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAssignItem(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Mode Selection Tabs */}
              <div className="flex bg-slate-100 dark:bg-[#00061A] p-1 rounded-xl border border-slate-200 dark:border-[#002060]">
                <button
                  type="button"
                  onClick={() => setAssignMode('person')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    assignMode === 'person'
                      ? 'bg-white dark:bg-[#000D38] text-[#0092FF] dark:text-[#00FFFF] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  👤 Buscar Pessoa / Cliente no CRM
                </button>
                <button
                  type="button"
                  onClick={() => setAssignMode('deal')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    assignMode === 'deal'
                      ? 'bg-white dark:bg-[#000D38] text-[#0092FF] dark:text-[#00FFFF] shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  💼 Inserir / Buscar Negócio (Deal)
                </button>
              </div>

              {/* MODE 1: SEARCH PERSON */}
              {assignMode === 'person' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Digite o nome ou e-mail do contato no Pipedrive:
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchPersonTerm}
                      onChange={(e) => setSearchPersonTerm(e.target.value)}
                      placeholder="Ex: Carlos Eduardo, Felipe, Maria..."
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                    />
                    {searchingPersons && (
                      <RefreshCw className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[#0092FF] animate-spin" />
                    )}
                  </div>

                  {/* Person Results list */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {personResults.map((p) => {
                      const isSel = selectedPerson?.id === p.id
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPerson(p)}
                          className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex items-center justify-between ${
                            isSel
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-[#0092FF] text-[#0092FF] dark:text-[#00FFFF]'
                              : 'bg-white dark:bg-[#00061A]/80 border-slate-200 dark:border-[#002060] text-slate-800 dark:text-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div>
                            <p className="font-bold flex items-center space-x-1.5">
                              <span>{p.name}</span>
                              <span className="text-[10px] font-mono text-slate-400">#{p.id}</span>
                            </p>
                            {p.email && <p className="text-[11px] text-slate-400">{p.email}</p>}
                          </div>
                          {isSel && <Check className="w-4 h-4 text-[#0092FF]" />}
                        </button>
                      )
                    })}
                    {searchPersonTerm.trim().length >= 2 && personResults.length === 0 && !searchingPersons && (
                      <p className="text-xs text-slate-400 italic text-center py-3">
                        Nenhuma pessoa encontrada no Pipedrive com esse termo.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* MODE 2: SEARCH OR TYPE DEAL */}
              {assignMode === 'deal' && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Digite o ID numérico ou nome do Negócio (Deal) no Pipedrive:
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchDealTerm}
                      onChange={(e) => setSearchDealTerm(e.target.value)}
                      placeholder="Ex: 48, Planejamento Carlos, Holding..."
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none"
                    />
                    {searchingDeals && (
                      <RefreshCw className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-[#0092FF] animate-spin" />
                    )}
                  </div>

                  {/* Deal Results list */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {dealResults.map((d) => {
                      const isSel = selectedDeal?.id === d.id
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSelectedDeal(d)}
                          className={`w-full text-left p-3 rounded-xl border text-xs transition-all flex items-center justify-between ${
                            isSel
                              ? 'bg-blue-50 dark:bg-blue-950/60 border-[#0092FF] text-[#0092FF] dark:text-[#00FFFF]'
                              : 'bg-white dark:bg-[#00061A]/80 border-slate-200 dark:border-[#002060] text-slate-800 dark:text-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div>
                            <p className="font-bold flex items-center space-x-1.5">
                              <span>{d.title}</span>
                              <span className="text-[10px] font-mono text-slate-400">Deal #{d.id}</span>
                            </p>
                            {d.person_name && (
                              <p className="text-[11px] text-slate-400">👤 {d.person_name}</p>
                            )}
                          </div>
                          {isSel && <Check className="w-4 h-4 text-[#0092FF]" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Selected Summary Card */}
              {(selectedPerson || selectedDeal) && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs flex items-center justify-between animate-fade-in">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 block">
                      Vínculo Selecionado:
                    </span>
                    <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {selectedPerson ? `👤 ${selectedPerson.name} (#${selectedPerson.id})` : `💼 ${selectedDeal.title} (#${selectedDeal.id})`}
                    </p>
                  </div>
                  <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-bold rounded-lg text-[10px]">
                    Pronto para Vincular
                  </span>
                </div>
              )}

              {/* Automation Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#002060] text-xs">
                <label className="flex items-center space-x-2.5 cursor-pointer text-slate-700 dark:text-slate-300 font-medium">
                  <input
                    type="checkbox"
                    checked={createNote}
                    onChange={(e) => setCreateNote(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0092FF] focus:ring-[#0092FF]"
                  />
                  <span>Criar Nota rica com o Briefing e Tópicos no Pipedrive</span>
                </label>

                <label className="flex items-center space-x-2.5 cursor-pointer text-slate-700 dark:text-slate-300 font-medium">
                  <input
                    type="checkbox"
                    checked={createActivity}
                    onChange={(e) => setCreateActivity(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0092FF] focus:ring-[#0092FF]"
                  />
                  <span>Criar Tarefa de Follow-up / Próxima Ação no CRM</span>
                </label>
              </div>

              {assignSuccess && (
                <div className="p-3 rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs text-center animate-fade-in">
                  ✅ Transcrição vinculada e sincronizada com sucesso no Pipedrive!
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const it = assignItem
                  setAssignItem(null)
                  handleToggleIgnore(it.id)
                }}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center space-x-1"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>Marcar como Reunião Interna (Ignorar)</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setAssignItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAssign}
                  disabled={submittingAssign || (!selectedPerson && !selectedDeal && !searchDealTerm.trim())}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition-all disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${submittingAssign ? 'animate-spin' : ''}`} />
                  <span>{submittingAssign ? 'Sincronizando...' : 'Confirmar & Vincular ao CRM'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BRIEFING MODAL */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-2xl animate-scale-in border border-slate-200/80 dark:border-[#002060]">
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#0092FF] dark:text-[#00FFFF] block">
                  Briefing Extraído via IA
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  {selectedItem.meeting_title || 'Reunião'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Cliente */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 font-display">
                  Dados do Cliente
                </h4>
                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-[#00061A]/80 p-4 rounded-xl border border-slate-200 dark:border-[#002060]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nome:</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {selectedItem.briefing_json?.dados_cliente?.nome || selectedItem.cliente_nome || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Interesse:</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200 line-clamp-2">
                      {selectedItem.briefing_json?.dados_cliente?.demonstrou_interesse || 'Não informado'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tópicos */}
              {selectedItem.briefing_json?.principais_topicos && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 font-display">
                    Principais Tópicos Abordados
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 list-disc list-inside bg-slate-50 dark:bg-[#00061A]/80 p-4 rounded-xl border border-slate-200 dark:border-[#002060]">
                    {selectedItem.briefing_json.principais_topicos.map((topico, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {topico}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Próxima Ação */}
              {selectedItem.briefing_json?.proxima_acao && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 font-display">
                    Próxima Ação & Follow-up
                  </h4>
                  <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-xs">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {selectedItem.briefing_json.proxima_acao.descricao}
                    </p>
                    {selectedItem.briefing_json.proxima_acao.prazo_sugerido && (
                      <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-[#0092FF] dark:text-[#00FFFF]">
                        Prazo: {selectedItem.briefing_json.proxima_acao.prazo_sugerido}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {!selectedItem.briefing_json?.pipedrive?.deal_id && !selectedItem.briefing_json?.pipedrive?.person_id && (
                  <button
                    onClick={() => {
                      const it = selectedItem
                      setSelectedItem(null)
                      handleOpenAssignModal(it)
                    }}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs transition-all shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Atribuir ao Pipedrive Agora</span>
                  </button>
                )}

                <button
                  onClick={() => handleToggleIgnore(selectedItem.id)}
                  disabled={togglingIgnoreId === selectedItem.id}
                  className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
                >
                  {selectedItem.briefing_json?.is_ignored ? (
                    <>
                      <Eye className="w-3.5 h-3.5 text-blue-500" />
                      <span>Reativar Notificações</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                      <span>Marcar como Reunião Interna</span>
                    </>
                  )}
                </button>
              </div>

              <button
                onClick={() => setSelectedItem(null)}
                className="ml-auto px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
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
