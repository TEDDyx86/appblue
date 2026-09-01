'use client'

import { Cake, ExternalLink, AlertTriangle } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'

export interface Birthday {
  id: string
  name: string
  dia: number
  person_url: string
}

interface BirthdaysCardProps {
  aniversariantes: Birthday[]
  comData: number
  totalPessoas: number
  cobertura: number
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

/**
 * Aniversariantes do mês.
 *
 * O aviso de cobertura é obrigatório e não deve ser removido: apenas ~5% das
 * pessoas têm data de nascimento no Pipedrive. Ele fica em `headerExtra`, fora
 * da área retrátil, de propósito — com o card recolhido a contagem continua
 * visível no cabeçalho, e é exatamente esse número isolado que passa a falsa
 * impressão de que o mês só tem dois aniversariantes.
 */
export default function BirthdaysCard({
  aniversariantes,
  comData,
  totalPessoas,
  cobertura,
  onMoveUp,
  onMoveDown,
  onHide,
}: BirthdaysCardProps) {
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' })

  return (
    <CollapsibleCard
      title={`Aniversariantes de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`}
      subtitle="Contato de relacionamento"
      count={aniversariantes.length}
      storageKey="aniversariantes"
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex p-2.5 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white shadow-md shadow-fuchsia-500/20">
          <Cake className="w-4 h-4" aria-hidden="true" />
        </span>
      }
      headerExtra={
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5">
          <AlertTriangle
            className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            Lista incompleta: só <strong>{comData} de {totalPessoas}</strong> pessoas
            ({cobertura}%) têm data de nascimento cadastrada no Pipedrive. Os demais
            aniversariantes do mês não aparecem aqui.
          </p>
        </div>
      }
    >
      {aniversariantes.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-display">
            Nenhum aniversariante cadastrado neste mês
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Entre as {comData} pessoas com data preenchida.
          </p>
        </div>
      ) : (
        <ul className="p-4 space-y-1">
          {aniversariantes.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-slate-100 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] flex items-center justify-center text-xs font-extrabold text-slate-700 dark:text-slate-200 tnum">
                  {String(p.dia).padStart(2, '0')}
                </span>
                <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {p.name}
                </span>
              </div>
              <a
                href={p.person_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-[#002060] transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                aria-label={`Abrir cadastro de ${p.name} no Pipedrive`}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}
