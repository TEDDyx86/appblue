'use client'

import { Target, AlertTriangle } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'

export interface Conversao {
  ganhos: number
  perdidos: number
  fechados: number
  taxa_ganho: number
  valor_ganho: number
  ganhos_com_data: number
}

interface ConversionCardProps {
  dados: Conversao
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

/**
 * Taxa de ganho sobre negócios fechados.
 *
 * Deliberadamente sem recorte por período: `won_time` está preenchido numa
 * minoria dos ganhos, então um gráfico mensal mostraria uma fração dos negócios
 * como se fosse o total. O aviso aparece só quando a cobertura é parcial.
 */
export default function ConversionCard({
  dados,
  onMoveUp,
  onMoveDown,
  onHide,
}: ConversionCardProps) {
  const { ganhos, perdidos, fechados, taxa_ganho, valor_ganho, ganhos_com_data } = dados
  const coberturaParcial = ganhos > 0 && ganhos_com_data < ganhos

  return (
    <CollapsibleCard
      title="Taxa de Conversão"
      subtitle={`${fechados} negócios fechados no Funil Comercial`}
      storageKey="conversao"
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
          <Target className="w-4 h-4" aria-hidden="true" />
        </span>
      }
    >
      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold text-slate-900 dark:text-white font-display tnum">
            {taxa_ganho}%
          </span>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            de ganho
          </span>
        </div>

        {/* Barra ganhos vs perdidos — decorativa, os números estão no texto abaixo */}
        <div
          aria-hidden="true"
          className="mt-4 h-2 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-[#00061A] flex"
        >
          <div className="h-full bg-emerald-500" style={{ width: `${taxa_ganho}%` }} />
          <div className="h-full bg-rose-400 dark:bg-rose-600 flex-1" />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            {ganhos} ganhos
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
            <span className="w-2 h-2 rounded-full bg-rose-400 dark:bg-rose-600" aria-hidden="true" />
            {perdidos} perdidos
          </span>
        </div>

        {valor_ganho > 0 && (
          <p className="mt-4 pt-3 border-t border-slate-100 dark:border-[#002060]/70 text-xs text-slate-500 dark:text-slate-400">
            Valor total ganho:{' '}
            <span className="font-bold text-slate-900 dark:text-white tnum">
              {valor_ganho.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                maximumFractionDigits: 0,
              })}
            </span>
          </p>
        )}

        {coberturaParcial && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5">
            <AlertTriangle
              className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              Sem recorte por período: só <strong>{ganhos_com_data} de {ganhos}</strong> negócios
              ganhos têm data de fechamento registrada. Um gráfico mensal mostraria uma fração
              como se fosse o total.
            </p>
          </div>
        )}
      </div>
    </CollapsibleCard>
  )
}
