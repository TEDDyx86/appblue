'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import {
  FileSearch,
  Sun,
  Moon,
  Search,
  UploadCloud,
  Loader2,
  AlertTriangle,
  Download,
  CheckCircle2,
} from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import { useTheme } from '@/context/ThemeContext'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

interface Versao {
  download_id: string
  nome_arquivo: string
  data_inicio: string | null
  data_fim: string | null
  vigente: boolean
}

interface Resultado {
  numero_processo: string
  versoes: Versao[]
  vigente: Versao | null
  origem?: string
  arquivo?: string
}

export default function SusepPage() {
  const router = useRouter()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const [numero, setNumero] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [baixandoId, setBaixandoId] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  const mensagemDeErro = (e: unknown) => {
    const err = e as { response?: { data?: { detail?: string } }; message?: string }
    return err?.response?.data?.detail || err?.message || 'Não foi possível consultar a SUSEP.'
  }

  const consultarPorNumero = async () => {
    const termo = numero.trim()
    if (!termo || consultando) return
    setConsultando(true)
    setErro('')
    setResultado(null)
    try {
      const r = await axios.post(
        `${API}/api/susep/consultar`,
        { numero_processo: termo },
        { headers: cab() },
      )
      setResultado(r.data)
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setConsultando(false)
    }
  }

  const consultarPelaApolice = async (arquivo: File) => {
    setConsultando(true)
    setErro('')
    setResultado(null)
    const fd = new FormData()
    fd.append('file', arquivo)
    try {
      const r = await axios.post(`${API}/api/susep/da-apolice`, fd, { headers: cab() })
      setResultado(r.data)
      setNumero(r.data.numero_processo || '')
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setConsultando(false)
    }
  }

  /**
   * O PDF vem pela nossa rota, não por link direto para a SUSEP: a rota exige
   * sessão e o arquivo chega com o nome que a SUSEP devolveu.
   */
  const baixar = async (v: Versao) => {
    setBaixandoId(v.download_id)
    setErro('')
    try {
      const r = await axios.get(`${API}/api/susep/baixar/${v.download_id}`, {
        headers: cab(),
        responseType: 'blob',
      })
      const nome =
        /filename="?([^"]+)"?/.exec(r.headers['content-disposition'] || '')?.[1] ||
        `${v.nome_arquivo || 'condicoes-gerais'}.pdf`
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = nome
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      // O corpo do erro vem como blob por causa do responseType; a mensagem
      // detalhada não é legível aqui sem lê-lo, e a genérica basta.
      setErro('Não foi possível baixar este PDF agora. Tente de novo em instantes.')
    } finally {
      setBaixandoId(null)
    }
  }

  const ocupado = consultando

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#00061A] text-[#000D38] dark:text-slate-100 font-sans overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={() => {
          localStorage.removeItem('access_token')
          router.push('/login')
        }}
      />
      <main
        className={`flex-1 overflow-y-auto transition-all duration-300 ${
          sidebarCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white/80 dark:bg-[#000D38]/80 backdrop-blur-md border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF]">
              <FileSearch className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Condições Gerais
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Consulta direta na base pública da SUSEP
              </p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Alternar tema"
            className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <div className="p-6 max-w-4xl mx-auto space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-5 space-y-4">
            <div>
              <label
                htmlFor="processo"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Número do processo SUSEP
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search
                    className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="processo"
                    type="text"
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && consultarPorNumero()}
                    placeholder="15414.902186/2014-52"
                    className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-[#0092FF] outline-none"
                  />
                </div>
                <button
                  onClick={consultarPorNumero}
                  disabled={!numero.trim() || ocupado}
                  className="h-10 px-5 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                >
                  {consultando ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Search className="w-4 h-4" aria-hidden="true" />
                  )}
                  Consultar
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-slate-200 dark:bg-[#002060]" />
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                ou
              </span>
              <span className="h-px flex-1 bg-slate-200 dark:bg-[#002060]" />
            </div>

            <label
              htmlFor="apolice"
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 dark:border-[#002060] px-4 py-7 cursor-pointer hover:border-[#0092FF] transition-colors text-center focus-within:ring-2 focus-within:ring-[#0092FF]"
            >
              <input
                id="apolice"
                ref={input}
                type="file"
                accept=".pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  // Limpa o valor para que escolher o MESMO arquivo de novo
                  // volte a disparar o onChange.
                  e.target.value = ''
                  if (f) consultarPelaApolice(f)
                }}
              />
              <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0092FF] to-[#002060] text-white flex items-center justify-center">
                {consultando ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="w-5 h-5" aria-hidden="true" />
                )}
              </span>
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Envie a apólice em PDF
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                O número do processo é lido do documento. Nada é guardado.
              </span>
            </label>
          </div>

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}

          {resultado && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Processo{' '}
                  <strong className="font-mono text-slate-900 dark:text-white">
                    {resultado.numero_processo}
                  </strong>
                  {resultado.arquivo && <> · lido de {resultado.arquivo}</>}
                </p>
                <p className="text-[11px] text-slate-400 tnum">
                  {resultado.versoes.length} versão(ões) publicadas
                </p>
              </div>

              {resultado.vigente ? (
                <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Versão vigente
                      </span>
                      <p className="mt-1 text-sm font-bold text-slate-900 dark:text-white break-words">
                        {resultado.vigente.nome_arquivo}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        Em vigor desde {resultado.vigente.data_inicio}
                      </p>
                    </div>
                    <button
                      onClick={() => baixar(resultado.vigente as Versao)}
                      disabled={baixandoId !== null}
                      className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/25 disabled:opacity-40 transition-colors flex-shrink-0"
                    >
                      {baixandoId === resultado.vigente.download_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="w-4 h-4" aria-hidden="true" />
                      )}
                      Baixar PDF
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-2xl border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                  Este processo não tem nenhuma versão em vigor hoje — todas têm data de
                  encerramento. As anteriores continuam disponíveis abaixo.
                </p>
              )}

              <details className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] overflow-hidden">
                <summary className="px-5 py-3 cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#002060]/40">
                  Versões anteriores ({Math.max(0, resultado.versoes.length - (resultado.vigente ? 1 : 0))})
                </summary>
                <ul className="divide-y divide-slate-100 dark:divide-[#002060]/60 border-t border-slate-100 dark:border-[#002060]">
                  {resultado.versoes
                    .filter((v) => !v.vigente)
                    .map((v) => (
                      <li
                        key={v.download_id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block text-xs text-slate-800 dark:text-slate-200 break-words">
                            {v.nome_arquivo}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 tnum">
                            {v.data_inicio} até {v.data_fim}
                          </span>
                        </span>
                        <button
                          onClick={() => baixar(v)}
                          disabled={baixandoId !== null}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] text-[11px] font-bold hover:bg-blue-100 dark:hover:bg-blue-900/60 disabled:opacity-40 flex-shrink-0"
                        >
                          {baixandoId === v.download_id ? (
                            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Download className="w-3 h-3" aria-hidden="true" />
                          )}
                          Baixar
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
