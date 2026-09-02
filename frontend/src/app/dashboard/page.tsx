'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import AgendaGrupo, { AgendaGrupoData, AgendaItem } from '@/components/AgendaGrupo'
import ProximoCompromisso from '@/components/ProximoCompromisso'
import { RefreshCw, Sun, Moon, Calendar, AlertTriangle, BarChart3, FileText, X } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface UserProfile {
  id: string
  email: string
  full_name?: string
  role: string
}

interface RespostaAgenda {
  periodo: string
  grupos: AgendaGrupoData[]
  total: number
}

type Periodo = 'hoje' | 'amanha' | 'proximos'

const PERIODOS: { chave: Periodo; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: 'amanha', rotulo: 'Amanhã' },
  { chave: 'proximos', rotulo: 'Próximos' },
]

const HORIZONTES = [7, 15, 30] as const

/** Minutos desde a meia-noite. `HH:MM:SS` ou `HH:MM`. */
function paraMinutos(hora: string) {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export default function DashboardPage() {
  const router = useRouter()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [user, setUser] = useState<UserProfile | null>(null)

  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [dias, setDias] = useState<(typeof HORIZONTES)[number]>(7)
  const [agenda, setAgenda] = useState<RespostaAgenda | null>(null)
  const [transcricoesPendentes, setTranscricoesPendentes] = useState<number | null>(null)

  const [atrasadasAberto, setAtrasadasAberto] = useState(false)
  const [atrasadas, setAtrasadas] = useState<{ itens: AgendaItem[]; total: number } | null>(null)

  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [agora, setAgora] = useState(() => new Date())

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  const abasRef = useRef<(HTMLButtonElement | null)[]>([])

  const buscar = useCallback(
    async (manual = false) => {
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }
      if (manual) setIsRefreshing(true)

      const cab = { headers: { Authorization: `Bearer ${token}` } }
      const [agendaRes, userRes, pendRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/dashboard/agenda`, {
          ...cab,
          params: { periodo, dias, ...(manual ? { refresh: true } : {}) },
        }),
        axios.get(`${API_URL}/api/auth/me`, cab),
        axios.get(`${API_URL}/api/dashboard/pendencias`, cab),
      ])

      if (agendaRes.status === 'fulfilled') {
        setAgenda(agendaRes.value.data)
        setError('')
      } else {
        const err: any = agendaRes.reason
        if (err.response?.status === 401) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          router.push('/login')
          return
        }
        setError(err.response?.data?.detail || 'Não foi possível carregar a agenda.')
      }

      if (userRes.status === 'fulfilled') setUser(userRes.value.data)
      if (pendRes.status === 'fulfilled') {
        setTranscricoesPendentes(pendRes.value.data?.transcricoes?.pendentes ?? null)
      }

      setLoading(false)
      setIsRefreshing(false)
      setAgora(new Date())
    },
    [API_URL, periodo, dias, router],
  )

  useEffect(() => {
    buscar()
    // 5 minutos: o backend tem cache de 2 min, e a cota do Pipedrive é finita.
    const t = setInterval(() => buscar(), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [buscar])

  // Relógio próprio, para o "em 20 min" não congelar entre as recargas.
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const abrirAtrasadas = async () => {
    setAtrasadasAberto(true)
    if (atrasadas) return
    const token = localStorage.getItem('access_token')
    try {
      const r = await axios.get(`${API_URL}/api/dashboard/agenda/atrasadas`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      setAtrasadas(r.data)
    } catch {
      setAtrasadas({ itens: [], total: 0 })
    }
  }

  /** Próximo item com horário ainda por vir hoje. */
  const proximo = useMemo(() => {
    if (periodo !== 'hoje' || !agenda) return null
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes()
    const comHora = agenda.grupos
      .flatMap((g) => g.itens)
      .filter((i) => i.due_time)
      .sort((a, b) => paraMinutos(a.due_time) - paraMinutos(b.due_time))

    // Um compromisso que começou há menos de 30 min ainda é "o agora".
    const candidato = comHora.find((i) => paraMinutos(i.due_time) >= minutosAgora - 30)
    if (!candidato) return null
    return { item: candidato, minutosAte: paraMinutos(candidato.due_time) - minutosAgora }
  }, [agenda, periodo, agora])

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    router.push('/login')
  }

  const onTeclaAba = (e: React.KeyboardEvent, indice: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const proximoIndice =
      e.key === 'ArrowRight'
        ? (indice + 1) % PERIODOS.length
        : (indice - 1 + PERIODOS.length) % PERIODOS.length
    setPeriodo(PERIODOS[proximoIndice].chave)
    abasRef.current[proximoIndice]?.focus()
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#00061A]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-[3px] border-[#0092FF] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
            Carregando sua agenda...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#00061A] flex transition-colors duration-200">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={handleLogout}
        userName={user?.full_name || 'Robson Vieira'}
        userEmail={user?.email || 'robson.vieira@email.com'}
      />

      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? 'pl-20' : 'pl-64'
        }`}
      >
        <header className="h-16 bg-white dark:bg-[#000D38] border-b border-slate-200/80 dark:border-[#002060] px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white font-display tracking-tight">
              Minha Agenda
            </h1>
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              {agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/analise"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              <BarChart3 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span className="hidden sm:inline">Análise</span>
            </Link>

            <button
              onClick={() => buscar(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#0092FF]' : 'text-slate-500'}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">
                {isRefreshing ? 'Atualizando...' : agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>

            <button
              onClick={toggleTheme}
              aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] hover:bg-slate-100 dark:hover:bg-[#002060] text-slate-600 dark:text-slate-300 transition-colors"
            >
              {isDark ? <Moon className="w-4 h-4 text-[#00FFFF]" /> : <Sun className="w-4 h-4 text-amber-500" />}
            </button>
          </div>
        </header>

        <main className="p-6 sm:p-8 space-y-5 max-w-4xl w-full mx-auto">
          {/* Períodos + acesso secundário aos atrasados */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Período" className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#000D38] border border-slate-200 dark:border-[#002060]">
              {PERIODOS.map((p, i) => (
                <button
                  key={p.chave}
                  ref={(el) => { abasRef.current[i] = el }}
                  role="tab"
                  aria-selected={periodo === p.chave}
                  tabIndex={periodo === p.chave ? 0 : -1}
                  onClick={() => setPeriodo(p.chave)}
                  onKeyDown={(e) => onTeclaAba(e, i)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                    periodo === p.chave
                      ? 'bg-white dark:bg-[#0092FF] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {p.rotulo}
                </button>
              ))}

              {periodo === 'proximos' && (
                <span className="flex items-center gap-1 pl-2 ml-1 border-l border-slate-200 dark:border-[#002060]">
                  {HORIZONTES.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDias(d)}
                      aria-pressed={dias === d}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                        dias === d
                          ? 'bg-[#0092FF]/15 text-[#0092FF] dark:text-[#00FFFF]'
                          : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs">
              {transcricoesPendentes !== null && transcricoesPendentes > 0 && (
                <Link
                  href="/transcriptions"
                  className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[#0092FF] transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  {transcricoesPendentes} transcrições sem vínculo
                </Link>
              )}

              <button
                onClick={abrirAtrasadas}
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 rounded"
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                Ver atrasados
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}

          {proximo && <ProximoCompromisso item={proximo.item} minutosAte={proximo.minutosAte} />}

          {agenda && agenda.grupos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#002060] p-12 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
                Nada agendado {periodo === 'hoje' ? 'para hoje' : periodo === 'amanha' ? 'para amanhã' : 'neste período'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sua agenda está livre.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {agenda?.grupos.map((g) => (
                <AgendaGrupo key={g.chave} grupo={g} mostrarData={periodo === 'proximos'} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Atrasados: secundário, fora do fluxo principal */}
      {atrasadasAberto && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col border border-slate-200 dark:border-[#002060] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-[#002060]">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                  Atividades atrasadas
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {atrasadas ? `${atrasadas.total} vencidas · mostrando as mais recentes` : 'Carregando...'}
                </p>
              </div>
              <button
                onClick={() => setAtrasadasAberto(false)}
                aria-label="Fechar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ul className="overflow-y-auto divide-y divide-slate-100 dark:divide-[#002060]/60">
              {atrasadas?.itens.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="flex-shrink-0 w-16 text-[11px] font-bold tnum text-rose-500">
                    {String(a.due_date ?? '').slice(8, 10)}/{String(a.due_date ?? '').slice(5, 7)}
                  </span>
                  <span className="flex-shrink-0 w-20 text-[11px] font-bold text-slate-400 truncate">
                    {a.type_label}
                  </span>
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    {a.org_name && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {a.org_name}
                      </span>
                    )}
                    <span className="text-sm text-slate-900 dark:text-white truncate">
                      {a.person_name || a.subject}
                    </span>
                  </span>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir ${a.subject} no Pipedrive`}
                    className="flex-shrink-0 text-xs font-bold text-[#0092FF] hover:underline"
                  >
                    abrir
                  </a>
                </li>
              ))}
              {atrasadas && atrasadas.itens.length === 0 && (
                <li className="px-5 py-10 text-center text-sm text-slate-500">
                  Nenhuma atividade atrasada.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
