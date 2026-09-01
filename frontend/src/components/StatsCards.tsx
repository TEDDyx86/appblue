'use client'

import { Clock, TrendingUp, CalendarX, FileText } from 'lucide-react'

export interface Stats {
  negocio_parado: number
  follow_up_atrasado: number
  sem_proximo_passo: number
  transcricoes_pendentes: number
}

interface StatsCardsProps {
  stats: Stats
  /** Total de negócios abertos no funil, usado como denominador dos cards. */
  totalAbertos?: number
}

/**
 * Três números operacionais. Não são filtros: a lista de trabalho fica logo
 * abaixo, e os cards clicáveis de antes só criavam um estado escondido que
 * ninguém usava.
 */
export default function StatsCards({ stats, totalAbertos }: StatsCardsProps) {
  const cards = [
    {
      title: 'Transcrições Pendentes',
      value: stats.transcricoes_pendentes,
      description: 'Sem vínculo no Pipedrive',
      icon: FileText,
      iconBg: 'bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white shadow-[0_0_12px_rgba(217,70,239,0.3)]',
      gradientBg: 'from-fuchsia-500/10 to-transparent',
      // Não é sobre negócios do funil, então não leva o "de N" como denominador.
      semDenominador: true,
    },
    {
      title: 'Follow-ups Vencidos',
      value: stats.follow_up_atrasado,
      description: 'Data limite já passou',
      icon: Clock,
      iconBg: 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_0_12px_rgba(245,158,11,0.3)]',
      gradientBg: 'from-amber-500/10 to-transparent',
    },
    {
      title: 'Negócios Parados',
      value: stats.negocio_parado,
      description: 'Mais de 15 dias sem update',
      icon: TrendingUp,
      iconBg: 'bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-[0_0_12px_rgba(244,63,94,0.3)]',
      gradientBg: 'from-rose-500/10 to-transparent',
    },
    {
      title: 'Sem Próximo Passo',
      value: stats.sem_proximo_passo,
      description: 'Nenhuma atividade agendada',
      icon: CalendarX,
      iconBg: 'bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white shadow-[0_0_12px_rgba(0,146,255,0.3)]',
      gradientBg: 'from-[#0092FF]/10 to-transparent',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.title}
            className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/80 dark:border-[#002060] p-5 shadow-sm relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl ${card.gradientBg} rounded-bl-full pointer-events-none opacity-60`} />

            <div className="flex items-start justify-between relative z-10">
              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wide uppercase font-display">
                  {card.title}
                </p>
                <div className="flex items-baseline space-x-1.5 mt-2">
                  <span className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-display tnum">
                    {card.value}
                  </span>
                  {!card.semDenominador && typeof totalAbertos === 'number' && totalAbertos > 0 && (
                    <span className="text-xs font-semibold text-slate-400 tnum">
                      de {totalAbertos}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                  {card.description}
                </p>
              </div>

              <div className={`p-3 rounded-2xl ${card.iconBg}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
