'use client'

import { useId, useState } from 'react'
import { SlidersHorizontal, ChevronDown } from 'lucide-react'

interface CardVisibilityMenuProps<T extends string> {
  /** Todos os cards existentes, na ordem em que devem ser listados. */
  todos: readonly T[]
  /** Rótulo legível de cada card. */
  titulos: Record<T, string>
  /** Ids atualmente ocultos. */
  ocultos: readonly T[]
  onToggle: (id: T) => void
  onMostrarTodos: () => void
}

/**
 * Controle de quais cards aparecem no painel.
 *
 * Vive fora dos cards de propósito: se morasse dentro de um deles, ocultar
 * esse card levaria embora o único jeito de trazer os outros de volta.
 *
 * Usa checkbox nativo em vez de menu customizado — o estado marcado/desmarcado
 * já é anunciado pelo leitor de tela sem nenhum ARIA extra, e Tab/Espaço
 * funcionam de graça.
 */
export default function CardVisibilityMenu<T extends string>({
  todos,
  titulos,
  ocultos,
  onToggle,
  onMostrarTodos,
}: CardVisibilityMenuProps<T>) {
  const painelId = useId()
  const [aberto, setAberto] = useState(false)
  const qtdOcultos = ocultos.length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={painelId}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] hover:bg-slate-50 dark:hover:bg-[#002060] text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
        <span>Cards</span>
        {qtdOcultos > 0 && (
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[#0092FF]/15 text-[#0092FF] dark:text-[#00FFFF] tnum">
            {qtdOcultos} oculto{qtdOcultos > 1 ? 's' : ''}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={painelId}
        hidden={!aberto}
        className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] shadow-lg p-3"
      >
        <fieldset>
          <legend className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
            Exibir no painel
          </legend>
          <div className="space-y-1">
            {todos.map((id) => {
              const visivel = !ocultos.includes(id)
              return (
                <label
                  key={id}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-[#00061A]/60 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={visivel}
                    onChange={() => onToggle(id)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-[#002060] text-[#0092FF] focus:ring-2 focus:ring-[#0092FF] cursor-pointer"
                  />
                  <span className="text-xs text-slate-700 dark:text-slate-300">{titulos[id]}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {qtdOcultos > 0 && (
          <button
            type="button"
            onClick={onMostrarTodos}
            className="w-full mt-2 pt-2 border-t border-slate-100 dark:border-[#002060]/70 text-[11px] font-bold text-[#0092FF] dark:text-[#00FFFF] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] rounded"
          >
            Mostrar todos
          </button>
        )}
      </div>
    </div>
  )
}
