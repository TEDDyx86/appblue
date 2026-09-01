'use client'

import { useState } from 'react'
import { ExternalLink, PhoneOff, Clock3, RotateCcw } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'

export interface LostDeal {
  id: string
  title: string
  person_name: string
  value: number
  lost_reason: string
  lost_time: string | null
  deal_url: string
}

interface RecoveryQueueProps {
  deals: LostDeal[]
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

const POR_PAGINA = 12

/**
 * Lê os campos direto do texto ISO, sem passar pelo `Date`.
 *
 * `new Date('2026-01-15')` vira meia-noite UTC e, em São Paulo (UTC-3),
 * renderiza como 14/01. Como aqui a string era cortada em 10 caracteres, o erro
 * acontecia em *todas* as datas, não só nas de madrugada.
 */
function formatarData(iso: string | null) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  const [, ano, mes, dia] = m
  return `${dia}/${mes}/${ano}`
}

/**
 * Clientes perdidos que não rejeitaram o produto — só não foram alcançados ou
 * não era o momento. É lista de trabalho, por isso mostra nome e link direto
 * para o negócio em vez de agregar em gráfico.
 *
 * Começa retraído: é o bloco mais alto da tela e o usuário quer decidir quando
 * abri-lo.
 */
export default function RecoveryQueue({
  deals,
  onMoveUp,
  onMoveDown,
  onHide,
}: RecoveryQueueProps) {
  const [visiveis, setVisiveis] = useState(POR_PAGINA)

  const semContato = deals.filter((d) => /consegui contato/i.test(d.lost_reason)).length
  const semMomento = deals.length - semContato

  return (
    <CollapsibleCard
      title="Fila de Recuperação"
      subtitle="Perdidos que não rejeitaram o produto — vale uma nova tentativa"
      count={deals.length}
      storageKey="fila-recuperacao"
      defaultOpen={false}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-md shadow-emerald-500/20">
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
        </span>
      }
      headerExtra={
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
            <PhoneOff className="w-3 h-3" aria-hidden="true" />
            {semContato} sem contato
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
            <Clock3 className="w-3 h-3" aria-hidden="true" />
            {semMomento} não era o momento
          </span>
        </div>
      }
    >
      {deals.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
            Nenhum negócio recuperável
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Todos os negócios perdidos foram rejeições diretas.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-[#002060]/70">
            {deals.slice(0, visiveis).map((d) => (
              <li
                key={d.id}
                className="px-5 py-3 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {d.person_name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {d.lost_reason} &bull; perdido em {formatarData(d.lost_time)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {d.value > 0 && (
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tnum hidden sm:inline">
                        {d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                      </span>
                    )}
                    <a
                      href={d.deal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                      aria-label={`Abrir negócio de ${d.person_name} no Pipedrive`}
                    >
                      <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {visiveis < deals.length && (
            <button
              type="button"
              onClick={() => setVisiveis((v) => v + POR_PAGINA)}
              className="w-full py-3 text-xs font-bold text-[#0092FF] dark:text-[#00FFFF] hover:bg-slate-50 dark:hover:bg-[#00061A] border-t border-slate-100 dark:border-[#002060]/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] focus-visible:ring-inset"
            >
              Ver mais {Math.min(POR_PAGINA, deals.length - visiveis)} &middot; {deals.length - visiveis} restantes
            </button>
          )}
        </>
      )}
    </CollapsibleCard>
  )
}
