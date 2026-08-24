'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  User,
  Tag,
  Calendar,
  X,
  Target,
  Sparkles,
  RefreshCw,
} from 'lucide-react'

export interface BriefingData {
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
  pipedrive?: {
    person_id?: string
    deal_id?: string
    activity_id?: string
    person_url?: string
    deal_url?: string
  }
}

export interface Transcription {
  id: string
  google_doc_id: string
  meeting_title: string | null
  meeting_date: string | null
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  briefing_json?: BriefingData | null
  cliente_nome?: string
  created_at: string
}

const statusConfig = {
  pending: {
    label: 'Pendente',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: Clock,
  },
  processing: {
    label: 'Processando',
    badgeClass: 'bg-blue-50 text-[#0092FF] border-blue-200 animate-pulse',
    icon: RefreshCw,
  },
  completed: {
    label: 'Processado',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: CheckCircle,
  },
  failed: {
    label: 'Falha',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: AlertTriangle,
  },
}

export default function RecentTranscriptions() {
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<Transcription | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    fetchTranscriptions()
  }, [])

  const fetchTranscriptions = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('access_token')
      const response = await axios.get(`${API_URL}/api/transcriptions`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 10 },
      })
      setTranscriptions(response.data)
    } catch (err) {
      console.error('Erro ao buscar transcrições:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return 'Data recente'
    return new Date(dateStr).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <>
      <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm overflow-hidden flex flex-col transition-colors">
        {/* Panel Header */}
        <div className="p-5 border-b border-slate-200/80 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-[#0092FF]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight font-display">
                  Transcrições & Briefings IA
                </h2>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-200/80 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-transparent dark:border-[#002060]">
                  {transcriptions.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Reuniões processadas automaticamente do Drive
              </p>
            </div>
          </div>

          <button
            onClick={fetchTranscriptions}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#0092FF]' : ''}`} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#002060]/60 max-h-[580px]">
          {loading && transcriptions.length === 0 ? (
            <div className="p-8 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse flex items-start space-x-3">
                  <div className="w-8 h-8 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-3/4"></div>
                    <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : transcriptions.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <FileText className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-display">Nenhuma transcrição encontrada</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Novos briefings do Tactiq salvos no Drive aparecerão aqui automaticamente.
              </p>
            </div>
          ) : (
            transcriptions.map((item) => {
              const status = statusConfig[item.processing_status] || statusConfig.pending
              const briefing = item.briefing_json
              const clientName = briefing?.dados_cliente?.nome || item.cliente_nome

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItem(item)}
                  className="w-full text-left p-4 hover:bg-slate-50/80 dark:hover:bg-[#001340] transition-colors group flex items-start justify-between gap-2"
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-[#0092FF] flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-4 h-4" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-[#0092FF] transition-colors font-display">
                        {item.meeting_title || 'Reunião Tactiq'}
                      </p>

                      {clientName && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5 truncate flex items-center space-x-1">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{clientName}</span>
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                          <Clock className="w-3 h-3" />
                          <span>{formatDate(item.meeting_date || item.created_at)}</span>
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${status.badgeClass}`}>
                          {status.label}
                        </span>

                        {briefing?.pipedrive?.person_url && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] border border-blue-200 dark:border-blue-800/60">
                            Pipedrive #{briefing.pipedrive.person_id}
                          </span>
                        )}

                        {briefing?.tactiq_link && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-transparent dark:border-[#002060]">
                            Tactiq 🎥
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors flex-shrink-0 mt-1" />
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden transition-colors">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A]/70 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#0092FF] block font-display">
                  Briefing Extraído via IA
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5 truncate font-display">
                  {selectedItem.meeting_title || 'Detalhes da Reunião'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Cliente */}
              {selectedItem.briefing_json?.dados_cliente && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#00061A]/80 border border-slate-200/80 dark:border-[#002060]">
                  <div className="flex items-center space-x-2 font-bold text-slate-800 dark:text-slate-200 text-xs mb-3 font-display">
                    <User className="w-4 h-4 text-[#0092FF]" />
                    <span>Dados do Cliente</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-slate-700 dark:text-slate-300">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Nome</span>
                      <span className="font-bold text-slate-900 dark:text-white">
                        {selectedItem.briefing_json.dados_cliente.nome || 'Não identificado'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Interesse Demonstrado</span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {selectedItem.briefing_json.dados_cliente.demonstrou_interesse || 'Não especificado'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Próxima Ação */}
              {selectedItem.briefing_json?.proxima_acao && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200">
                  <div className="flex items-center space-x-2 font-bold text-[#002060] text-xs mb-2">
                    <Target className="w-4 h-4 text-[#0092FF]" />
                    <span>Próxima Ação Extraída (Activity Pipedrive)</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-900 mb-2">
                    {selectedItem.briefing_json.proxima_acao.descricao}
                  </p>
                  <div className="flex items-center space-x-4 text-[11px] text-slate-600">
                    <span>
                      Prazo Sugerido:{' '}
                      <strong className="text-slate-900 font-semibold">
                        {selectedItem.briefing_json.proxima_acao.prazo_sugerido}
                      </strong>
                    </span>
                    <span>
                      Prioridade:{' '}
                      <strong className="text-slate-900 font-semibold capitalize">
                        {selectedItem.briefing_json.proxima_acao.prioridade || 'Média'}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Tópicos */}
              {selectedItem.briefing_json?.principais_topicos && selectedItem.briefing_json.principais_topicos.length > 0 && (
                <div>
                  <div className="flex items-center space-x-2 font-bold text-slate-800 text-xs mb-2">
                    <Tag className="w-4 h-4 text-[#0092FF]" />
                    <span>Principais Tópicos Abordados</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedItem.briefing_json.principais_topicos.map((topico, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[11px]"
                      >
                        {topico}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Pipedrive Shortcuts */}
              {selectedItem.briefing_json?.pipedrive && (
                <div className="p-3.5 rounded-xl bg-[#000D38] border border-[#002060] text-white flex flex-wrap items-center justify-between gap-2.5">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#0092FF] block">Pipedrive CRM</span>
                    <p className="text-[11px] text-slate-300">Acesso direto ao cliente</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedItem.briefing_json.pipedrive.person_url && (
                      <a
                        href={selectedItem.briefing_json.pipedrive.person_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-xs shadow-blue-500/30 transition-all"
                      >
                        <span>Abrir Cliente</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {selectedItem.briefing_json.pipedrive.deal_url && (
                      <a
                        href={selectedItem.briefing_json.pipedrive.deal_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-[#002060] hover:bg-[#001D99] text-white font-semibold text-xs border border-blue-400/30 transition-all"
                      >
                        <span>Ver Deal</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata, Drive & Tactiq Links */}
              <div className="pt-3 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <a
                    href={`https://docs.google.com/document/d/${selectedItem.google_doc_id}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-xs hover:bg-emerald-100 transition-colors"
                  >
                    <span>Google Drive</span>
                    <ExternalLink className="w-3 h-3 text-emerald-600" />
                  </a>

                  {selectedItem.briefing_json?.tactiq_link && (
                    <a
                      href={selectedItem.briefing_json.tactiq_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-200 transition-colors"
                    >
                      <span>Tactiq</span>
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </a>
                  )}
                </div>

                <span>Registrado em: {formatDate(selectedItem.created_at)}</span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-colors"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}