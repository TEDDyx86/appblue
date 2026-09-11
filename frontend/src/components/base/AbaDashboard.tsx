'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import axios from 'axios'
import { Phone, Loader2, AlertTriangle, Inbox, ChevronLeft, ChevronRight } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

/** Linhas por página. Alto o bastante para varrer, baixo para não virar rolagem. */
const POR_PAGINA = 25

interface Resumo {
  clientes: number
  coberturas: number
  capital_segurado_total: number | string
  premio_anualizado_total: number | string
  mudancas_ultima_importacao: number
}

interface LinhaBase {
  cpf: string
  nome: string | null
  telefone: string | null
  profissao: string | null
}

interface CoberturaUnica extends LinhaBase {
  produto_atual: string | null
  riders_que_faltam: string[]
}
interface ParouDePagar extends LinhaBase {
  coberturas: string[]
  capital_parado: number | string
}
interface MaiorLacuna extends LinhaBase {
  renda_mensal: number | string
  capital_segurado: number | string
  razao_renda_anual: number | string
  lacuna: number | string
}
interface Aniversariante extends LinhaBase {
  dia: number
  idade: number
}

interface Fila {
  cobertura_unica: CoberturaUnica[]
  parou_de_pagar: ParouDePagar[]
  maior_lacuna: MaiorLacuna[]
  aniversariantes: Aniversariante[]
}

interface Dashboard {
  resumo: Resumo
  fila: Fila
}

type IdSegmento = keyof Fila

/**
 * O Postgres devolve `NUMERIC` como string. As rotas coagem, mas a tela aceita
 * os dois — mesmo tratamento de AbaClientes, para as duas não divergirem.
 */
const numero = (v: number | string | null | undefined) => {
  const n = Number(v)
  return v === null || v === undefined || v === '' || Number.isNaN(n) ? null : n
}

const reais = (v: number | string | null | undefined) => {
  const n = numero(v)
  return n === null
    ? '—'
    : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

const juntar = (partes: (string | number | null | undefined)[]) =>
  partes.filter((p) => p !== null && p !== undefined && p !== '').join(' · ')

/**
 * Cada segmento sabe o próprio motivo.
 *
 * As colunas mudam porque a razão de estar na fila muda: capital parado no
 * REMIDO, riders faltando na cobertura única, lacuna em reais na subcobertura.
 * Uma coluna genérica "motivo" obrigaria a espremer tudo em texto corrido.
 */
interface Segmento {
  id: IdSegmento
  rotulo: string
  colunas: [string, string]
  vazio: string
  /** Aviso quando a contagem alta não é alarme, e sim o desenho da fila. */
  nota?: string
  celulas: (linha: never) => [React.ReactNode, React.ReactNode]
}

const SEGMENTOS: Segmento[] = [
  {
    id: 'parou_de_pagar',
    rotulo: 'Pararam de pagar',
    colunas: ['Coberturas', 'Capital parado'],
    vazio: 'Ninguém parou de pagar nesta base. É uma boa notícia.',
    celulas: (c: ParouDePagar) => [
      (c.coberturas || []).filter(Boolean).join(' · ') || '—',
      reais(c.capital_parado),
    ],
  },
  {
    id: 'cobertura_unica',
    rotulo: 'Cobertura única',
    colunas: ['Produto atual', 'Falta oferecer'],
    vazio: 'Todo cliente tem mais de uma cobertura.',
    celulas: (c: CoberturaUnica) => [
      c.produto_atual || '—',
      (c.riders_que_faltam || []).join(' · ') || 'já tem todos os riders',
    ],
  },
  {
    id: 'maior_lacuna',
    rotulo: 'Maior lacuna',
    colunas: ['Cobertura hoje', 'Lacuna para 10× a renda'],
    vazio: 'Nenhum cliente com renda declarada.',
    nota: 'Todos os clientes aparecem aqui. A lista ordena por quanto falta em reais — não é um alerta, é a ordem de prioridade.',
    celulas: (c: MaiorLacuna) => [
      `${numero(c.razao_renda_anual) ?? '—'}× a renda anual`,
      reais(c.lacuna),
    ],
  },
  {
    id: 'aniversariantes',
    rotulo: 'Aniversariantes',
    colunas: ['Dia', 'Perfil'],
    vazio: 'Ninguém faz aniversário este mês.',
    celulas: (c: Aniversariante) => [
      `dia ${c.dia}`,
      juntar([`${c.idade} anos`, c.profissao]) || '—',
    ],
  },
]

export default function AbaDashboard() {
  const [dados, setDados] = useState<Dashboard | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [segmentoId, setSegmentoId] = useState<IdSegmento>('parou_de_pagar')
  const [pagina, setPagina] = useState(0)
  const abas = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    axios
      .get(`${API}/api/base/dashboard`, { headers: cab() })
      .then((r) => setDados(r.data))
      .catch((e) =>
        setErro(
          e?.response?.data?.detail ||
            'Não foi possível carregar o dashboard. Verifique se o backend está no ar.',
        ),
      )
      .finally(() => setCarregando(false))
  }, [])

  const fila = dados?.fila
  const segmento = SEGMENTOS.find((s) => s.id === segmentoId) as Segmento
  const linhas = useMemo(
    () => ((fila?.[segmentoId] as LinhaBase[] | undefined) || []),
    [fila, segmentoId],
  )

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas - 1)
  const visiveis = linhas.slice(paginaSegura * POR_PAGINA, paginaSegura * POR_PAGINA + POR_PAGINA)

  const trocarSegmento = (id: IdSegmento) => {
    setSegmentoId(id)
    setPagina(0)
  }

  // Setas navegam entre os segmentos: é o que um tablist promete ao teclado.
  const aoTeclarNasAbas = (e: React.KeyboardEvent, indice: number) => {
    const passo = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!passo) return
    e.preventDefault()
    const alvo = (indice + passo + SEGMENTOS.length) % SEGMENTOS.length
    trocarSegmento(SEGMENTOS[alvo].id)
    abas.current[alvo]?.focus()
  }

  if (carregando) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Carregando...
      </p>
    )
  }

  // Falha de carregamento não pode virar "base vazia": mandar importar planilha
  // quando o backend está fora esconde o erro de verdade.
  if (erro || !dados) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 inline-flex items-center gap-2"
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        {erro || 'Resposta vazia do servidor.'}
      </div>
    )
  }

  const r = dados.resumo || ({} as Resumo)

  if (!r.clientes) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-[#002060] text-slate-400 flex items-center justify-center">
          <Inbox className="w-6 h-6" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white font-display">
          A base ainda está vazia
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Envie o export da MAG pela aba <strong>Fila de processamento</strong>. Você confere o
          que mudou antes de qualquer coisa ser gravada.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      {/* Contexto: uma faixa só, dividida. Quatro caixas separadas competiriam
          com a fila, que é o que a tela existe para mostrar. */}
      <dl className="flex flex-wrap divide-x divide-slate-200 dark:divide-[#002060] rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38]">
        <Numero rotulo="Capital segurado" valor={reais(r.capital_segurado_total)} />
        <Numero rotulo="Prêmio anualizado" valor={reais(r.premio_anualizado_total)} />
        <Numero rotulo="Clientes" valor={String(r.clientes ?? 0)} />
        <Numero
          rotulo="Mudanças na última base"
          valor={String(r.mudancas_ultima_importacao ?? 0)}
        />
      </dl>

      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Filas de oportunidade"
          className="flex flex-wrap gap-2"
        >
          {SEGMENTOS.map((s, i) => {
            const ativo = s.id === segmentoId
            const total = (fila?.[s.id] as unknown[] | undefined)?.length ?? 0
            return (
              <button
                key={s.id}
                ref={(el) => {
                  abas.current[i] = el
                }}
                role="tab"
                id={`seg-${s.id}`}
                aria-selected={ativo}
                aria-controls="tabela-fila"
                tabIndex={ativo ? 0 : -1}
                onClick={() => trocarSegmento(s.id)}
                onKeyDown={(e) => aoTeclarNasAbas(e, i)}
                className={`group inline-flex items-baseline gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                  ativo
                    ? 'border-[#0092FF] bg-[#0092FF] text-white shadow-md shadow-[#0092FF]/25'
                    : 'border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] text-slate-600 dark:text-slate-300 hover:border-[#0092FF]/60'
                }`}
              >
                <span>{s.rotulo}</span>
                <span
                  className={`tnum text-sm font-extrabold ${
                    ativo ? 'text-white' : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {total}
                </span>
              </button>
            )
          })}
        </div>

        {segmento.nota && (
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 max-w-2xl">
            {segmento.nota}
          </p>
        )}
      </div>

      <section
        id="tabela-fila"
        role="tabpanel"
        aria-labelledby={`seg-${segmentoId}`}
        className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] overflow-hidden"
      >
        {linhas.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {segmento.vazio}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-[#002060]">
                    <th scope="col" className="font-bold px-5 py-3">Cliente</th>
                    <th scope="col" className="font-bold px-5 py-3">{segmento.colunas[0]}</th>
                    <th scope="col" className="font-bold px-5 py-3">{segmento.colunas[1]}</th>
                    <th scope="col" className="font-bold px-5 py-3 text-right">Contato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#002060]/60">
                  {visiveis.map((linha) => {
                    const [a, b] = segmento.celulas(linha as never)
                    return (
                      <tr
                        key={linha.cpf}
                        className="hover:bg-slate-50 dark:hover:bg-[#002060]/40 transition-colors"
                      >
                        <th
                          scope="row"
                          className="px-5 py-3 text-left font-semibold text-slate-900 dark:text-white max-w-[18rem] truncate"
                        >
                          {linha.nome || 'sem nome'}
                        </th>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300 max-w-[20rem] truncate">
                          {a}
                        </td>
                        <td className="px-5 py-3 text-slate-800 dark:text-slate-100 font-semibold tnum whitespace-nowrap">
                          {b}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {linha.telefone ? (
                            <a
                              href={`tel:${linha.telefone.replace(/\D/g, '')}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] font-bold whitespace-nowrap hover:bg-blue-100 dark:hover:bg-blue-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                            >
                              <Phone className="w-3 h-3" aria-hidden="true" />
                              {linha.telefone}
                            </a>
                          ) : (
                            <span className="text-slate-400">sem telefone</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-100 dark:border-[#002060]">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 tnum">
                  {paginaSegura * POR_PAGINA + 1}–
                  {Math.min((paginaSegura + 1) * POR_PAGINA, linhas.length)} de {linhas.length}
                </p>
                <div className="flex items-center gap-1.5">
                  <BotaoPagina
                    rotulo="Página anterior"
                    desabilitado={paginaSegura === 0}
                    onClick={() => setPagina(paginaSegura - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </BotaoPagina>
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 tnum px-1">
                    {paginaSegura + 1} / {totalPaginas}
                  </span>
                  <BotaoPagina
                    rotulo="Próxima página"
                    desabilitado={paginaSegura >= totalPaginas - 1}
                    onClick={() => setPagina(paginaSegura + 1)}
                  >
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </BotaoPagina>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex-1 min-w-[10rem] px-5 py-4">
      <dt className="text-[10px] uppercase tracking-wider font-bold text-slate-400">{rotulo}</dt>
      <dd className="text-lg font-extrabold text-slate-900 dark:text-white tnum mt-0.5">
        {valor}
      </dd>
    </div>
  )
}

function BotaoPagina({
  rotulo,
  desabilitado,
  onClick,
  children,
}: {
  rotulo: string
  desabilitado: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      className="p-1.5 rounded-lg border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:border-[#0092FF] hover:text-[#0092FF] disabled:opacity-35 disabled:hover:border-slate-200 dark:disabled:hover:border-[#002060] disabled:hover:text-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
    >
      {children}
    </button>
  )
}
