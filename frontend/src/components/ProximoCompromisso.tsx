'use client'

import { ExternalLink, Clock } from 'lucide-react'
import type { AgendaItem } from '@/components/AgendaGrupo'

interface ProximoCompromissoProps {
  item: AgendaItem
  /** Minutos até o compromisso. Negativo significa que já começou. */
  minutosAte: number
}

function textoRelativo(minutos: number) {
  if (minutos < 0) return 'começou'
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `em ${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `em ${h}h${String(m).padStart(2, '0')}` : `em ${h}h`
}

/**
 * O próximo compromisso com horário, em destaque.
 *
 * Só aparece na aba Hoje e some quando não há mais nada — sem estado vazio
 * decorativo, que só ocuparia a área mais nobre da tela sem informar nada.
 */
export default function ProximoCompromisso({ item, minutosAte }: ProximoCompromissoProps) {
  const iminente = minutosAte >= 0 && minutosAte <= 15

  return (
    <section
      aria-label="Próximo compromisso"
      className={`rounded-2xl border p-5 shadow-sm relative overflow-hidden transition-colors ${
        iminente
          ? 'border-[#0092FF] bg-[#0092FF]/[0.04] dark:bg-[#0092FF]/[0.08] shadow-[0_0_20px_rgba(0,146,255,0.15)]'
          : 'border-slate-200/90 dark:border-[#002060] bg-white dark:bg-[#000D38]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clock
              className={`w-3.5 h-3.5 ${iminente ? 'text-[#0092FF]' : 'text-slate-400'}`}
              aria-hidden="true"
            />
            <span
              className={`text-[11px] font-bold uppercase tracking-[0.2em] ${
                iminente ? 'text-[#0092FF] dark:text-[#00FFFF]' : 'text-slate-400'
              }`}
            >
              Próximo · {textoRelativo(minutosAte)}
            </span>
          </div>

          <p className="mt-2 flex items-baseline gap-2.5">
            <span className="text-2xl font-extrabold text-slate-900 dark:text-white font-display tnum">
              {item.due_time.slice(0, 5)}
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#002060]">
              {item.type_label}
            </span>
          </p>

          <p className="mt-1.5 flex items-center gap-2 min-w-0">
            {item.org_name && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-[#00061A] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                {item.org_name}
              </span>
            )}
            <span className="text-base font-bold text-slate-900 dark:text-white truncate">
              {item.person_name || item.subject}
            </span>
          </p>
          {item.person_name && item.subject !== item.person_name && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.subject}</p>
          )}
        </div>

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
        >
          Abrir no CRM
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
