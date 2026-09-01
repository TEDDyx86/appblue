'use client'

import { CalendarClock, ExternalLink, Video, Phone, Mail, CheckSquare, Users } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'

export interface AgendaItem {
  id: string
  subject: string
  type: string
  due_time: string
  person_name: string | null
  deal_title: string | null
  url: string
}

interface TodayAgendaProps {
  itens: AgendaItem[]
  totalSemana: number
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

const iconePorTipo: Record<string, typeof Video> = {
  teams: Video,
  meeting: Users,
  call: Phone,
  email: Mail,
  task: CheckSquare,
}

const rotuloPorTipo: Record<string, string> = {
  teams: 'Teams',
  meeting: 'Reunião',
  call: 'Ligação',
  email: 'E-mail',
  task: 'Tarefa',
}

/**
 * Atividades de hoje, em ordem cronológica. As sem horário definido aparecem
 * primeiro, como "dia todo".
 */
export default function TodayAgenda({
  itens,
  totalSemana,
  onMoveUp,
  onMoveDown,
  onHide,
}: TodayAgendaProps) {
  return (
    <CollapsibleCard
      title="Agenda de Hoje"
      subtitle={`${totalSemana} atividades nos próximos 7 dias`}
      count={itens.length}
      storageKey="agenda-hoje"
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex p-2.5 rounded-xl bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white shadow-md shadow-[#0092FF]/20">
          <CalendarClock className="w-4 h-4" aria-hidden="true" />
        </span>
      }
    >
      {itens.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
            Nenhuma atividade para hoje
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {totalSemana > 0
              ? `Você tem ${totalSemana} nos próximos 7 dias.`
              : 'Nada agendado para a semana.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-[#002060]/70">
          {itens.map((a) => {
            const Icone = iconePorTipo[a.type] || CheckSquare
            return (
              <li
                key={a.id}
                className="px-5 py-3 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-14 text-center">
                    <span className="text-xs font-bold text-slate-900 dark:text-white tnum">
                      {a.due_time ? a.due_time.slice(0, 5) : '—'}
                    </span>
                  </span>

                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] flex items-center justify-center">
                    <Icone
                      className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{rotuloPorTipo[a.type] || a.type}</span>
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {a.subject}
                    </p>
                    {(a.person_name || a.deal_title) && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {[a.person_name, a.deal_title].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>

                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir atividade ${a.subject} no Pipedrive`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-[#002060] transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                  >
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                  </a>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </CollapsibleCard>
  )
}
