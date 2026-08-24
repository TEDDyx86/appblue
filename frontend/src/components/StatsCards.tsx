'use client'

import { AlertCircle, Clock, Users, TrendingUp, ChevronRight } from 'lucide-react'

export interface Stats {
  total_alerts: number
  negocio_parado: number
  follow_up_atrasado: number
  teams_pendente: number
}

interface StatsCardsProps {
  stats: Stats
  activeFilter?: string
  onSelectFilter?: (filterType: string) => void
}

export default function StatsCards({ stats, activeFilter = 'all', onSelectFilter }: StatsCardsProps) {
  const cards = [
    {
      type: 'all',
      title: 'Alertas Pendentes',
      value: stats.total_alerts,
      description: 'Requerem atenção no CRM',
      icon: AlertCircle,
      textColor: 'text-[#0092FF]',
      badgeBg: 'bg-blue-50 dark:bg-blue-950/50 text-[#0092FF] dark:text-[#00FFFF] border-blue-200 dark:border-blue-800/60',
      iconBg: 'bg-gradient-to-br from-[#0092FF] to-[#001D99] text-white shadow-[0_0_12px_rgba(0,146,255,0.3)]',
      gradientBg: 'from-[#0092FF]/10 to-transparent',
      activeRing: 'ring-2 ring-[#0092FF] shadow-[0_0_20px_rgba(0,146,255,0.25)]',
      barColor: 'bg-[#0092FF]',
    },
    {
      type: 'negocio_parado',
      title: 'Negócios Parados',
      value: stats.negocio_parado,
      description: '> 15 dias sem update',
      icon: TrendingUp,
      textColor: 'text-rose-600',
      badgeBg: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60',
      iconBg: 'bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-[0_0_12px_rgba(244,63,94,0.3)]',
      gradientBg: 'from-rose-500/10 to-transparent',
      activeRing: 'ring-2 ring-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.25)]',
      barColor: 'bg-rose-500',
    },
    {
      type: 'follow_up_atrasado',
      title: 'Follow-ups Atrasados',
      value: stats.follow_up_atrasado,
      description: 'Data limite expirada',
      icon: Clock,
      textColor: 'text-amber-500',
      badgeBg: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
      iconBg: 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_0_12px_rgba(245,158,11,0.3)]',
      gradientBg: 'from-amber-500/10 to-transparent',
      activeRing: 'ring-2 ring-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.25)]',
      barColor: 'bg-amber-500',
    },
    {
      type: 'teams_pendente',
      title: 'Teams Pendentes',
      value: stats.teams_pendente,
      description: 'Sem link de reunião',
      icon: Users,
      textColor: 'text-indigo-500',
      badgeBg: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60',
      iconBg: 'bg-gradient-to-br from-indigo-500 to-[#002060] text-white shadow-[0_0_12px_rgba(99,102,241,0.3)]',
      gradientBg: 'from-indigo-500/10 to-transparent',
      activeRing: 'ring-2 ring-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.25)]',
      barColor: 'bg-indigo-500',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon
        const isSelected = activeFilter === card.type

        return (
          <button
            key={card.type}
            type="button"
            onClick={() => onSelectFilter && onSelectFilter(card.type)}
            className={`text-left bg-gradient-to-br bg-white dark:bg-[#000D38] rounded-2xl border p-5 transition-all duration-300 hover:scale-[1.01] hover:border-slate-300 dark:hover:border-[#0092FF] hover:shadow-lg relative overflow-hidden group ${
              isSelected
                ? `${card.activeRing} border-transparent bg-slate-50 dark:bg-[#001340]`
                : 'border-slate-200/80 dark:border-[#002060] shadow-sm'
            }`}
          >
            {/* Ambient Corner Gradient */}
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl ${card.gradientBg} rounded-bl-full pointer-events-none opacity-60 group-hover:opacity-100 transition-opacity`} />

            <div className="flex items-start justify-between relative z-10">
              <div>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wide uppercase font-display">
                  {card.title}
                </p>
                <div className="flex items-baseline space-x-2 mt-2">
                  <span className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight font-display tnum">
                    {card.value}
                  </span>
                  {card.value > 0 ? (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${card.badgeBg}`}>
                      Ativo
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#00061A] text-slate-500 dark:text-slate-400 border border-transparent dark:border-[#002060]">
                      Zerado
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                  {card.description}
                </p>
              </div>

              <div className={`p-3 rounded-2xl ${card.iconBg} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>

            {/* Bottom active accent bar */}
            {isSelected && (
              <div className={`absolute bottom-0 left-0 right-0 h-1.5 ${card.barColor}`} />
            )}
          </button>
        )
      })}
    </div>
  )
}