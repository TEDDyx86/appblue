'use client'

import { TrendingDown } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'

export interface LossReason {
  motivo: string
  total: number
  recuperavel: boolean
}

interface LossReasonsProps {
  motivos: LossReason[]
  totalPerdidos: number
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

/**
 * Distribuição dos motivos de perda. Os recuperáveis ficam destacados porque a
 * leitura útil não é "quanto perdi", e sim "quanto do que perdi ainda dá para
 * trabalhar".
 *
 * As barras são decorativas (`aria-hidden`): o número e o percentual já estão
 * no texto ao lado, então anunciá-las de novo só geraria ruído no leitor de tela.
 */
export default function LossReasons({
  motivos,
  totalPerdidos,
  onMoveUp,
  onMoveDown,
  onHide,
}: LossReasonsProps) {
  const maior = motivos.length > 0 ? motivos[0].total : 1

  return (
    <CollapsibleCard
      title="Motivos de Perda"
      subtitle={`${totalPerdidos} negócios perdidos`}
      storageKey="motivos-perda"
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex p-2.5 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow-md">
          <TrendingDown className="w-4 h-4" aria-hidden="true" />
        </span>
      }
    >
      {motivos.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
            Nenhum negócio perdido
          </p>
        </div>
      ) : (
        <ul className="p-4 space-y-2.5">
          {motivos.map((m) => {
            const percentual = totalPerdidos > 0 ? Math.round((m.total / totalPerdidos) * 100) : 0
            return (
              <li key={m.motivo}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-xs text-slate-700 dark:text-slate-300 truncate" title={m.motivo}>
                    {m.motivo}
                    {m.recuperavel && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                        recuperável
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-white tnum flex-shrink-0">
                    {m.total}
                    <span className="text-slate-400 font-medium ml-1">{percentual}%</span>
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-[#00061A] overflow-hidden"
                >
                  <div
                    className={`h-full rounded-full ${
                      m.recuperavel ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-[#002060]'
                    }`}
                    style={{ width: `${Math.max(3, (m.total / maior) * 100)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </CollapsibleCard>
  )
}
