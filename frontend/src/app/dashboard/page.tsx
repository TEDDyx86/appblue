'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import AlertsPanel, { Alert } from '@/components/AlertsPanel'
import StatsCards, { Stats } from '@/components/StatsCards'
import RecoveryQueue, { LostDeal } from '@/components/RecoveryQueue'
import LossReasons, { LossReason } from '@/components/LossReasons'
import BirthdaysCard, { Birthday } from '@/components/BirthdaysCard'
import TodayAgenda, { AgendaItem } from '@/components/TodayAgenda'
import ConversionCard, { Conversao } from '@/components/ConversionCard'
import CardVisibilityMenu from '@/components/CardVisibilityMenu'
import {
  RefreshCw,
  Calendar,
  Sun,
  Moon,
  Briefcase,
  ExternalLink,
  Zap,
  Search,
  X,
  Eye,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: string
}

interface DealItem {
  id: string
  title: string
  person_name: string
  stage_id: number
  stage_name: string
  value: number
  update_time: string
  days_inactive: number
  next_activity_date: string | null
  is_stagnant: boolean
  is_overdue: boolean
  deal_url: string
}

interface PipelineSummary {
  pipeline_id: number
  pipeline_name: string
  total_deals: number
  total_value: number
  stages_breakdown: Record<string, number>
  stagnant_count: number
  overdue_count: number
  deals?: DealItem[]
}

interface DashboardOperacional {
  resumo: {
    total_abertos: number
    follow_ups_vencidos: number
    negocios_parados: number
    sem_proximo_passo: number
    transcricoes_pendentes: number
  }
  pipeline: PipelineSummary
  sem_proximo_passo: DealItem[]
  perdidos: {
    total_perdidos: number
    motivos: LossReason[]
    fila_recuperacao: LostDeal[]
    total_recuperavel: number
  }
  aniversarios: {
    aniversariantes: Birthday[]
    com_data: number
    total_pessoas: number
    cobertura: number
  }
  agenda: {
    hoje: AgendaItem[]
    total_hoje: number
    total_semana: number
  }
  conversao: Conversao
}

type CardId = 'agenda' | 'recuperacao' | 'conversao' | 'motivos' | 'aniversarios' | 'alertas'

const ORDEM_PADRAO: CardId[] = [
  'agenda',
  'recuperacao',
  'conversao',
  'motivos',
  'aniversarios',
  'alertas',
]

const TITULOS_CARD: Record<CardId, string> = {
  agenda: 'Agenda de Hoje',
  recuperacao: 'Fila de Recuperação',
  conversao: 'Taxa de Conversão',
  motivos: 'Motivos de Perda',
  aniversarios: 'Aniversariantes',
  alertas: 'Alertas Operacionais',
}

const CHAVE_ORDEM = 'dashboard:ordem-cards'
const CHAVE_OCULTOS = 'dashboard:cards-ocultos'

export default function DashboardPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [user, setUser] = useState<UserProfile | null>(null)
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null)
  const [isSyncingPipeline, setIsSyncingPipeline] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null)

  // Deals Modal state
  const [isDealsModalOpen, setIsDealsModalOpen] = useState(false)
  const [dealsSearch, setDealsSearch] = useState('')
  const [selectedStageFilter, setSelectedStageFilter] = useState('all')
  const [dealsSortBy, setDealsSortBy] = useState<'recent_update' | 'oldest_update' | 'highest_value' | 'stagnant_days' | 'title_az'>('recent_update')

  const [operacional, setOperacional] = useState<DashboardOperacional | null>(null)

  const [ordem, setOrdem] = useState<CardId[]>(ORDEM_PADRAO)
  const [ocultos, setOcultos] = useState<CardId[]>([])
  const [anuncio, setAnuncio] = useState('')

  // Lido após a montagem: no servidor não existe localStorage, e ler direto no
  // useState causaria divergência de hidratação.
  useEffect(() => {
    const salvo = window.localStorage.getItem(CHAVE_ORDEM)
    if (!salvo) return
    try {
      const lista = JSON.parse(salvo) as CardId[]
      // Reconcilia com o padrão: descarta ids desconhecidos e acrescenta os que
      // faltarem, para uma ordem antiga não sumir com um card novo.
      const validos = lista.filter((id) => ORDEM_PADRAO.includes(id))
      const faltantes = ORDEM_PADRAO.filter((id) => !validos.includes(id))
      setOrdem([...validos, ...faltantes])
    } catch {
      // JSON corrompido: mantém o padrão
    }
  }, [])

  useEffect(() => {
    const salvo = window.localStorage.getItem(CHAVE_OCULTOS)
    if (!salvo) return
    try {
      const lista = JSON.parse(salvo) as CardId[]
      setOcultos(lista.filter((id) => ORDEM_PADRAO.includes(id)))
    } catch {
      // JSON corrompido: nada oculto
    }
  }, [])

  const visiveis = ordem.filter((id) => !ocultos.includes(id))

  /**
   * Move um card uma posição entre os **visíveis**. A troca acontece no array
   * completo, mas pulando os ocultos — sem isso, mover um card poderia trocá-lo
   * com um card invisível e nada aconteceria na tela.
   */
  const moverCard = (id: CardId, direcao: -1 | 1) => {
    setOrdem((atual) => {
      const de = atual.indexOf(id)
      let para = de + direcao
      while (para >= 0 && para < atual.length && ocultos.includes(atual[para])) {
        para += direcao
      }
      if (de < 0 || para < 0 || para >= atual.length) return atual

      const nova = [...atual]
      ;[nova[de], nova[para]] = [nova[para], nova[de]]
      window.localStorage.setItem(CHAVE_ORDEM, JSON.stringify(nova))

      const novaVisivel = nova.filter((c) => !ocultos.includes(c))
      setAnuncio(
        `${TITULOS_CARD[id]} movido para a posição ${novaVisivel.indexOf(id) + 1} de ${novaVisivel.length}.`,
      )
      return nova
    })
  }

  const alternarVisibilidade = (id: CardId) => {
    setOcultos((atual) => {
      const nova = atual.includes(id) ? atual.filter((c) => c !== id) : [...atual, id]
      window.localStorage.setItem(CHAVE_OCULTOS, JSON.stringify(nova))
      setAnuncio(
        nova.includes(id)
          ? `${TITULOS_CARD[id]} ocultado. Use o botão Cards para reexibir.`
          : `${TITULOS_CARD[id]} exibido novamente.`,
      )
      return nova
    })
  }

  const mostrarTodos = () => {
    setOcultos([])
    window.localStorage.setItem(CHAVE_OCULTOS, JSON.stringify([]))
    setAnuncio('Todos os cards foram exibidos.')
  }

  const [stats, setStats] = useState<Stats>({
    negocio_parado: 0,
    follow_up_atrasado: 0,
    sem_proximo_passo: 0,
    transcricoes_pendentes: 0,
  })
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

      // O resumo do funil vem dentro de /dashboard/operacional. Chamá-lo em
      // separado paginava os negócios abertos duas vezes por carregamento, e a
      // cota diária do Pipedrive é finita.
      const [alertsRes, userRes, operacionalRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/alerts`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { resolved: false },
        }),
        axios.get(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API_URL}/api/dashboard/operacional`, {
          headers: { Authorization: `Bearer ${token}` },
          // O clique manual em Sincronizar ignora o cache do backend.
          params: isManual ? { refresh: true } : undefined,
        }),
      ])

      if (alertsRes.status === 'fulfilled') {
        setAlerts(alertsRes.value.data)
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

      if (operacionalRes.status === 'fulfilled') {
        const dados: DashboardOperacional = operacionalRes.value.data
        setOperacional(dados)
        setPipelineSummary(dados.pipeline)
        // Os números do topo vêm do funil inteiro (paginado), não da tabela de
        // alertas — esta só guarda o que já virou alerta no Supabase.
        setStats({
          negocio_parado: dados.resumo.negocios_parados,
          follow_up_atrasado: dados.resumo.follow_ups_vencidos,
          sem_proximo_passo: dados.resumo.sem_proximo_passo,
          transcricoes_pendentes: dados.resumo.transcricoes_pendentes,
        })
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

    // Auto-refresh a cada 5 minutos. Cada carregamento custa ~15 requisicoes
    // ao Pipedrive; a 45s isso consumia a cota diaria da conta em poucas horas
    // so de deixar o painel aberto. O backend ainda tem cache de 5 min, entao
    // recargas mais frequentes que isso nao trariam dado novo de qualquer forma.
    const interval = setInterval(() => {
      fetchData()
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [fetchData])

  const handleSyncPipeline = async () => {
    try {
      setIsSyncingPipeline(true)
      setSyncFeedback(null)
      const token = localStorage.getItem('access_token')
      const res = await axios.post(
        `${API_URL}/api/pipedrive/pipeline/comercial/sync-alerts`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSyncFeedback(`Sincronizado! ${res.data.alerts_created} novos alertas e ${res.data.alerts_updated} atualizados.`)
      await fetchData()
      setTimeout(() => setSyncFeedback(null), 4000)
    } catch (err: any) {
      setSyncFeedback('Erro ao sincronizar CRM: ' + (err.response?.data?.detail || err.message))
    } finally {
      setIsSyncingPipeline(false)
    }
  }

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
      fetchData()
    } catch (err) {
      console.error('Erro ao resolver alerta:', err)
    }
  }

  const filteredDeals = useMemo(() => {
    if (!pipelineSummary?.deals) return []
    const list = pipelineSummary.deals.filter((d) => {
      if (selectedStageFilter !== 'all' && d.stage_name !== selectedStageFilter) return false
      if (dealsSearch.trim()) {
        const q = dealsSearch.toLowerCase().trim()
        const title = (d.title || '').toLowerCase()
        const person = (d.person_name || '').toLowerCase()
        const idStr = String(d.id)
        if (!title.includes(q) && !person.includes(q) && !idStr.includes(q)) return false
      }
      return true
    })

    return list.sort((a, b) => {
      if (dealsSortBy === 'recent_update') {
        return new Date(b.update_time || 0).getTime() - new Date(a.update_time || 0).getTime()
      }
      if (dealsSortBy === 'oldest_update') {
        return new Date(a.update_time || 0).getTime() - new Date(b.update_time || 0).getTime()
      }
      if (dealsSortBy === 'stagnant_days') {
        return (b.days_inactive || 0) - (a.days_inactive || 0)
      }
      if (dealsSortBy === 'highest_value') {
        return (b.value || 0) - (a.value || 0)
      }
      if (dealsSortBy === 'title_az') {
        return (a.title || '').localeCompare(b.title || '')
      }
      return 0
    })
  }, [pipelineSummary?.deals, selectedStageFilter, dealsSearch, dealsSortBy])

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
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">Carregando painel operacional...</p>
          <p className="text-xs text-slate-400">Conectando ao Pipedrive (Funil Comercial) e Google Drive</p>
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
        userEmail={user?.email || 'robson.vieira@email.com'}
      />

      {/* Main Content Area */}
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
              <span>Funil Comercial Ativo</span>
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
                {isRefreshing ? 'Sincronizando...' : `Sync: ${lastSyncTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
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
          {/* Welcome & Overview Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white font-display tracking-tight">
                Olá, {user?.full_name?.split(' ')[0] || 'Robson'} 👋
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Monitoramento contínuo do Funil Comercial (Pipedrive) & Briefings do Google Drive.
              </p>
            </div>

            <CardVisibilityMenu
              todos={ORDEM_PADRAO}
              titulos={TITULOS_CARD}
              ocultos={ocultos}
              onToggle={alternarVisibilidade}
              onMostrarTodos={mostrarTodos}
            />
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

          {/* Números operacionais do funil inteiro */}
          <StatsCards stats={stats} totalAbertos={operacional?.resumo.total_abertos} />

          {/* COMMERCIAL PIPELINE HIGHLIGHT BANNER */}
          {pipelineSummary && (
            <div className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] p-5 shadow-sm relative overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start space-x-3.5">
                  <div className="p-3 bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white rounded-xl shadow-md shadow-[#0092FF]/20 flex-shrink-0">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                        Funil Comercial (Pipedrive)
                      </h3>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60">
                        Pipeline #1
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Robson Vieira &bull; Planejamento Patrimonial e Sucessório
                    </p>
                  </div>
                </div>

                {/* Pipeline KPI Pills & Direct Actions */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060]">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Negócios Abertos</span>
                    <span className="text-sm font-extrabold text-slate-900 dark:text-white font-display">
                      {pipelineSummary.total_deals} deals
                    </span>
                  </div>

                  <button
                    onClick={handleSyncPipeline}
                    disabled={isSyncingPipeline}
                    className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPipeline ? 'animate-spin' : ''}`} />
                    <span>{isSyncingPipeline ? 'Varrendo CRM...' : 'Sincronizar CRM'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsDealsModalOpen(true)}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors shadow-xs"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#0092FF] dark:text-[#00FFFF]" />
                    <span>Ver Negócios (Deals)</span>
                  </button>
                </div>
              </div>

              {/* Sync Feedback Message */}
              {syncFeedback && (
                <div className="mt-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 text-xs text-[#0092FF] dark:text-[#00FFFF] font-medium flex items-center space-x-2">
                  <Zap className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{syncFeedback}</span>
                </div>
              )}

            </div>
          )}

          {/* Cards reordenáveis, em coluna única. A ordem vive no estado e é
              persistida; cada card recebe os callbacks de mover, ou null nas
              extremidades para desabilitar o botão correspondente. */}
          {visiveis.map((id, indice) => {
            const mover = {
              onMoveUp: indice > 0 ? () => moverCard(id, -1) : null,
              onMoveDown: indice < visiveis.length - 1 ? () => moverCard(id, 1) : null,
              onHide: () => alternarVisibilidade(id),
            }

            if (id === 'alertas') {
              return (
                <AlertsPanel key={id} alerts={alerts} onResolve={handleResolve} {...mover} />
              )
            }
            if (!operacional) return null
            if (id === 'agenda') {
              return (
                <TodayAgenda
                  key={id}
                  itens={operacional.agenda.hoje}
                  totalSemana={operacional.agenda.total_semana}
                  {...mover}
                />
              )
            }
            if (id === 'conversao') {
              return <ConversionCard key={id} dados={operacional.conversao} {...mover} />
            }
            if (id === 'recuperacao') {
              return (
                <RecoveryQueue
                  key={id}
                  deals={operacional.perdidos.fila_recuperacao}
                  {...mover}
                />
              )
            }
            if (id === 'motivos') {
              return (
                <LossReasons
                  key={id}
                  motivos={operacional.perdidos.motivos}
                  totalPerdidos={operacional.perdidos.total_perdidos}
                  {...mover}
                />
              )
            }
            return (
              <BirthdaysCard
                key={id}
                aniversariantes={operacional.aniversarios.aniversariantes}
                comData={operacional.aniversarios.com_data}
                totalPessoas={operacional.aniversarios.total_pessoas}
                cobertura={operacional.aniversarios.cobertura}
                {...mover}
              />
            )
          })}

          {/* Todos os cards ocultos: sem isso o painel ficaria vazio e sem pista
              de como recuperá-los. */}
          {visiveis.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#002060] p-10 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
                Todos os cards estão ocultos
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Use o botão <span className="font-semibold">Cards</span>, no topo, para escolher o
                que exibir.
              </p>
              <button
                type="button"
                onClick={mostrarTodos}
                className="mt-4 inline-flex items-center px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
              >
                Mostrar todos
              </button>
            </div>
          )}

          {/* Anúncio de reordenação e visibilidade para leitor de tela */}
          <p aria-live="polite" className="sr-only">
            {anuncio}
          </p>
        </main>
      </div>

      {/* MODAL DE NEGÓCIOS ESPECÍFICOS DO FUNIL COMERCIAL */}
      {isDealsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-[#000D38] rounded-3xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200/90 dark:border-[#002060] overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] rounded-xl border border-blue-200 dark:border-blue-800/60">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                    Negócios do Funil Comercial
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {filteredDeals.length} de {pipelineSummary?.total_deals || 0} negócios exibidos &bull; Clique para abrir o Deal diretamente no Pipedrive
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsDealsModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={dealsSearch}
                  onChange={(e) => setDealsSearch(e.target.value)}
                  placeholder="Filtrar por cliente, título ou ID do deal..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#0092FF] outline-none transition-all"
                />
                {dealsSearch && (
                  <button
                    onClick={() => setDealsSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    &times;
                  </button>
                )}
              </div>

              {/* Ordenação por Data / Atualização */}
              <select
                value={dealsSortBy}
                onChange={(e) => setDealsSortBy(e.target.value as any)}
                className="w-full sm:w-52 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
                title="Ordenar negócios"
              >
                <option value="recent_update">📅 Mais Recentes (Update ↓)</option>
                <option value="oldest_update">⏳ Mais Antigos (Update ↑)</option>
                <option value="stagnant_days">⚠️ Mais Dias Parado</option>
                <option value="highest_value">💰 Maior Valor (R$)</option>
                <option value="title_az">🔤 Nome do Negócio (A-Z)</option>
              </select>

              <select
                value={selectedStageFilter}
                onChange={(e) => setSelectedStageFilter(e.target.value)}
                className="w-full sm:w-48 px-3 py-2 bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-[#0092FF] outline-none"
              >
                <option value="all">Todas as Etapas</option>
                {pipelineSummary?.stages_breakdown &&
                  Object.keys(pipelineSummary.stages_breakdown).map((s) => (
                    <option key={s} value={s}>
                      {s} ({pipelineSummary.stages_breakdown[s]})
                    </option>
                  ))}
              </select>
            </div>

            {/* Deals List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#002060] p-2">
              {filteredDeals.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  Nenhum negócio encontrado com os filtros aplicados.
                </div>
              ) : (
                filteredDeals.map((deal) => (
                  <div
                    key={deal.id}
                    className="p-3.5 sm:p-4 rounded-xl flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[#0092FF] dark:text-[#00FFFF] border border-blue-200 dark:border-blue-800/60 font-mono">
                          Deal #{deal.id}
                        </span>

                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-[#00061A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#002060]">
                          {deal.stage_name}
                        </span>

                        {deal.value > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            {deal.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        )}

                        {deal.is_stagnant && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
                            Parado há {deal.days_inactive}d
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate font-display">
                        {deal.title}
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        Cliente: <span className="font-semibold text-slate-700 dark:text-slate-300">{deal.person_name}</span>
                        {deal.next_activity_date && (
                          <span className="ml-2 inline-flex items-center text-slate-400">
                            &bull; Próx. Atividade: {deal.next_activity_date}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Direct Button to Specific Deal */}
                    <a
                      href={deal.deal_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-sm shadow-blue-500/20 transition-all flex-shrink-0"
                      title={`Abrir Deal #${deal.id} diretamente no Pipedrive`}
                    >
                      <span>Abrir Deal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Pipedrive CRM &bull; Funil Comercial
              </span>
              <button
                type="button"
                onClick={() => setIsDealsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
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
