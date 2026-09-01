'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronDown, ArrowUp, ArrowDown, EyeOff } from 'lucide-react'

interface CollapsibleCardProps {
  title: string
  /** Linha de apoio sob o título. */
  subtitle?: string
  /** Ícone do cabeçalho, já com as classes de cor/fundo aplicadas pelo chamador. */
  icon?: ReactNode
  /** Número grande à direita do cabeçalho (contagem do bloco). */
  count?: number
  /** Conteúdo extra do cabeçalho, visível mesmo com o card retraído (ex: chips de resumo). */
  headerExtra?: ReactNode
  /** Se informado, o estado retraído é lembrado entre sessões nesta chave. */
  storageKey?: string
  defaultOpen?: boolean
  /** Move o card uma posição acima. Ausente ou nulo desabilita o botão. */
  onMoveUp?: (() => void) | null
  /** Move o card uma posição abaixo. Ausente ou nulo desabilita o botão. */
  onMoveDown?: (() => void) | null
  /** Oculta o card. O controle de reexibir vive fora, no cabeçalho da página. */
  onHide?: () => void
  children: ReactNode
}

/**
 * Card com cabeçalho que retrai o conteúdo e, opcionalmente, se reordena.
 *
 * Acessibilidade:
 * - O gatilho de retrair é um <button> nativo com `aria-expanded` e
 *   `aria-controls`, apontando para a região identificada por `aria-labelledby`.
 * - Retraído usa `hidden`, não altura zero: leitor de tela e navegação por Tab
 *   realmente pulam o bloco em vez de percorrer conteúdo invisível.
 * - Os controles de mover são irmãos do gatilho, nunca aninhados dentro dele —
 *   <button> dentro de <button> é HTML inválido e quebra a navegação por teclado.
 */
export default function CollapsibleCard({
  title,
  subtitle,
  icon,
  count,
  headerExtra,
  storageKey,
  defaultOpen = true,
  onMoveUp,
  onMoveDown,
  onHide,
  children,
}: CollapsibleCardProps) {
  const idBase = useId()
  const painelId = `${idBase}-painel`
  const tituloId = `${idBase}-titulo`

  const [aberto, setAberto] = useState(defaultOpen)

  // Lido após a montagem: no primeiro render o servidor não tem localStorage, e
  // ler direto no useState causaria divergência de hidratação.
  useEffect(() => {
    if (!storageKey) return
    const salvo = window.localStorage.getItem(`card-aberto:${storageKey}`)
    if (salvo !== null) setAberto(salvo === '1')
  }, [storageKey])

  const alternar = () => {
    const proximo = !aberto
    setAberto(proximo)
    if (storageKey) {
      window.localStorage.setItem(`card-aberto:${storageKey}`, proximo ? '1' : '0')
    }
  }

  const reordenavel = onMoveUp !== undefined || onMoveDown !== undefined
  const temControles = reordenavel || Boolean(onHide)

  return (
    <section className="bg-white dark:bg-[#000D38] rounded-2xl border border-slate-200/90 dark:border-[#002060] shadow-sm overflow-hidden group/card">
      <div className="flex items-start gap-1 pr-3">
        {/* Gatilho de retrair — ocupa o cabeçalho, mas não engloba os controles */}
        <h3 className="m-0 flex-1 min-w-0">
          <button
            type="button"
            onClick={alternar}
            aria-expanded={aberto}
            aria-controls={painelId}
            className="w-full text-left p-5 flex items-start justify-between gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-[#00061A]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] focus-visible:ring-inset"
          >
            <span className="flex items-start space-x-3 min-w-0">
              {icon && <span className="flex-shrink-0">{icon}</span>}
              <span className="min-w-0">
                <span
                  id={tituloId}
                  className="block text-sm font-bold text-slate-900 dark:text-white font-display"
                >
                  {title}
                </span>
                {subtitle && (
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {subtitle}
                  </span>
                )}
              </span>
            </span>

            <span className="flex items-center gap-3 flex-shrink-0">
              {typeof count === 'number' && (
                <span className="text-2xl font-extrabold text-slate-900 dark:text-white font-display tnum">
                  {count}
                </span>
              )}
              <ChevronDown
                aria-hidden="true"
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                  aberto ? 'rotate-180' : ''
                }`}
              />
              <span className="sr-only">{aberto ? 'Recolher seção' : 'Expandir seção'}</span>
            </span>
          </button>
        </h3>

        {temControles && (
          <div className="flex items-center gap-0.5 pt-5 flex-shrink-0">
            {onHide && (
              <button
                type="button"
                onClick={onHide}
                aria-label={`Ocultar ${title}`}
                title={`Ocultar ${title}`}
                className="p-1.5 rounded text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {reordenavel && (
          <div className="flex flex-col gap-0.5 pt-5 flex-shrink-0">
            <button
              type="button"
              onClick={() => onMoveUp?.()}
              disabled={!onMoveUp}
              aria-label={`Mover ${title} para cima`}
              className="p-1 rounded text-slate-300 dark:text-slate-600 hover:text-[#0092FF] hover:bg-slate-100 dark:hover:bg-[#002060] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
            >
              <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown?.()}
              disabled={!onMoveDown}
              aria-label={`Mover ${title} para baixo`}
              className="p-1 rounded text-slate-300 dark:text-slate-600 hover:text-[#0092FF] hover:bg-slate-100 dark:hover:bg-[#002060] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
            >
              <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {headerExtra && <div className="px-5 pb-4 -mt-1">{headerExtra}</div>}

      <div
        id={painelId}
        role="region"
        aria-labelledby={tituloId}
        hidden={!aberto}
        className="border-t border-slate-100 dark:border-[#002060]/70"
      >
        {children}
      </div>
    </section>
  )
}
