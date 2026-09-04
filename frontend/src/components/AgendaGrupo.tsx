'use client'

import { useEffect, useId, useState } from 'react'
import { ExternalLink, Video, Phone, Mail, CheckSquare, UserX, ChevronDown, CalendarClock } from 'lucide-react'

export interface AgendaItem {
  id: string
  subject: string
  type: string
  type_label: string
  due_date: string | null
  due_time: string
  person_name: string | null
  /** Organização vinculada. Nesta conta é o assessor responsável, não a empresa. */
  org_name: string | null
  deal_id: number | null
  deal_title: string | null
  url: string
}

export interface AgendaGrupoData {
  chave: string
  titulo: string
  itens: AgendaItem[]
}

interface AgendaGrupoProps {
  grupo: AgendaGrupoData
  /** Mostra a data de cada item — usado quando o período abrange vários dias. */
  mostrarData?: boolean
}

const iconePorGrupo: Record<string, typeof Video> = {
  reunioes: Video,
  ligacoes: Phone,
  mensagens: Mail,
  compromissos: CalendarClock,
  tarefas: CheckSquare,
  no_show: UserX,
}

const corPorGrupo: Record<string, string> = {
  reunioes: 'from-[#0092FF] to-[#001D99]',
  ligacoes: 'from-emerald-500 to-emerald-700',
  mensagens: 'from-amber-400 to-amber-600',
  // Cinza-azulado: é compromisso de agenda, não atendimento de cliente. A cor
  // forte fica reservada para R1/R2/R3.
  compromissos: 'from-slate-400 to-slate-600',
  tarefas: 'from-slate-500 to-slate-700',
  no_show: 'from-rose-500 to-rose-700',
}

/**
 * Cores da tag de assessor.
 *
 * Escolhida de forma determinística pelo nome, para o mesmo assessor manter a
 * mesma cor entre sessões e a leitura ficar rápida ao bater o olho. São tons
 * discretos: a tag é referência, não destaque.
 */
const CORES_TAG = [
  'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
]

function corDaTag(nome: string) {
  let soma = 0
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 997
  return CORES_TAG[soma % CORES_TAG.length]
}

/** Lê os campos direto do texto ISO — `new Date('2026-09-02')` volta um dia em UTC-3. */
function formatarDia(iso: string | null) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return `${m[3]}/${m[2]}`
}

/**
 * Um bloco de atividades por modo de ação.
 *
 * Nasce **retraído**: a leitura de relance é a contagem por grupo — "tenho cinco
 * reuniões e dez tarefas" —, e o detalhe só aparece quando pedido.
 *
 * O estado não é persistido de propósito: a cada abertura da tela os grupos
 * voltam a ficar fechados, mantendo a mesma leitura inicial todo dia.
 */
export default function AgendaGrupo({ grupo, mostrarData = false }: AgendaGrupoProps) {
  const idBase = useId()
  const painelId = `${idBase}-itens`
  const [aberto, setAberto] = useState(false)

  // Trocar de período recolhe tudo de novo — sem isso, um grupo aberto em
  // "Hoje" reapareceria aberto em "Próximos", com outro volume de conteúdo.
  useEffect(() => {
    setAberto(false)
  }, [grupo.itens])

  const Icone = iconePorGrupo[grupo.chave] || CheckSquare
  const cor = corPorGrupo[grupo.chave] || corPorGrupo.tarefas

  return (
    <section className="rounded-2xl border border-slate-200/90 dark:border-[#002060] bg-white dark:bg-[#000D38] overflow-hidden">
      <h2 className="m-0">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls={painelId}
          className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-[#00061A]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] focus-visible:ring-inset"
        >
          <span className={`inline-flex p-1.5 rounded-lg bg-gradient-to-br ${cor} text-white flex-shrink-0`}>
            <Icone className="w-3.5 h-3.5" aria-hidden="true" />
          </span>

          <span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 font-display">
            {grupo.titulo}
          </span>

          <span className="text-sm font-extrabold text-slate-900 dark:text-white tnum">
            {grupo.itens.length}
          </span>

          <span className="flex-1" />

          <ChevronDown
            aria-hidden="true"
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`}
          />
          <span className="sr-only">{aberto ? 'Recolher' : 'Expandir'}</span>
        </button>
      </h2>

      <ul
        id={painelId}
        hidden={!aberto}
        className="border-t border-slate-100 dark:border-[#002060]/70 divide-y divide-slate-100 dark:divide-[#002060]/60"
      >
        {grupo.itens.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
          >
            <span className="flex-shrink-0 w-16 text-xs font-bold tnum text-slate-900 dark:text-white">
              {mostrarData && a.due_date && (
                <span className="block text-[10px] font-semibold text-slate-400">
                  {formatarDia(a.due_date)}
                </span>
              )}
              {a.due_time ? a.due_time.slice(0, 5) : <span className="text-slate-300 dark:text-slate-600">—</span>}
            </span>

            <span className="flex-shrink-0 w-20 text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate">
              {a.type_label}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 min-w-0">
                {/* Quem é o compromisso vem antes; o assessor é qualificação. */}
                <span className="text-sm text-slate-900 dark:text-white truncate">
                  {a.person_name || a.subject}
                </span>
                {a.org_name && (
                  <span
                    className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${corDaTag(a.org_name)}`}
                  >
                    {a.org_name}
                  </span>
                )}
              </span>
              {a.person_name && a.subject !== a.person_name && (
                <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                  {a.subject}
                </span>
              )}
            </span>

            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir ${a.subject} no Pipedrive`}
              className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
            >
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
