'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { usePathname } from 'next/navigation'
import axios from 'axios'
import { MessageSquare, X, Send, Loader2, Wrench } from 'lucide-react'

/**
 * O assistente só aparece na Base de Clientes.
 *
 * É uma lista de permissão, não de bloqueio: antes ele ficava em toda tela
 * atrás do login, e uma rota nova passava a exibi-lo sem ninguém decidir isso.
 * Continua valendo que ele consulta dado interno, então exige sessão.
 */
const ROTAS_COM_ASSISTENTE = ['/base-clientes']

interface Mensagem {
  autor: 'usuario' | 'assistente'
  texto: string
  ferramenta?: string | null
}

/** Atalhos para as perguntas que se repetem todo dia. */
const SUGESTOES = [
  'O que eu tenho hoje?',
  'Tem algo atrasado?',
  'Quais transcrições estão sem vínculo?',
  'Tenho cadastro para revisar?',
]

/**
 * Assistente de consulta, em painel flutuante.
 *
 * Só lê: pergunta em português, o backend escolhe o endpoint e devolve a
 * resposta. Nenhuma ação daqui altera Pipedrive ou banco — alterar dado
 * continua sendo pelas telas, onde há confirmação.
 */
export default function Assistente() {
  const [aberto, setAberto] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [entrada, setEntrada] = useState('')
  const [enviando, setEnviando] = useState(false)
  const fimDaLista = useRef<HTMLDivElement | null>(null)
  const campo = useRef<HTMLInputElement | null>(null)
  const painelId = useId()
  const rota = usePathname() || ''

  // Só depois de montar: no servidor não há localStorage, e ler antes causaria
  // divergência de hidratação.
  const [temSessao, setTemSessao] = useState(false)
  useEffect(() => {
    setTemSessao(Boolean(localStorage.getItem('access_token')))
  }, [rota])

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, enviando])

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])

  // Esc fecha — o painel cobre conteúdo e precisa sair pelo teclado.
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  const perguntar = async (texto: string) => {
    const pergunta = texto.trim()
    if (!pergunta || enviando) return

    setMensagens((m) => [...m, { autor: 'usuario', texto: pergunta }])
    setEntrada('')
    setEnviando(true)

    try {
      const token = localStorage.getItem('access_token')
      const r = await axios.post(
        `${API_URL}/api/assistente/perguntar`,
        { mensagem: pergunta },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setMensagens((m) => [
        ...m,
        { autor: 'assistente', texto: r.data.resposta, ferramenta: r.data.ferramenta },
      ])
    } catch (e: any) {
      setMensagens((m) => [
        ...m,
        {
          autor: 'assistente',
          texto:
            e?.response?.data?.detail ||
            'Não consegui responder agora. Tente de novo em instantes.',
        },
      ])
    } finally {
      setEnviando(false)
    }
  }

  const visivel = temSessao && ROTAS_COM_ASSISTENTE.some((r) => rota.startsWith(r))
  if (!visivel) return null

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        aria-label="Abrir assistente"
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-sm shadow-lg shadow-[#0092FF]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0092FF]"
      >
        <MessageSquare className="w-4 h-4" aria-hidden="true" />
        Perguntar
      </button>
    )
  }

  return (
    <div
      id={painelId}
      role="dialog"
      aria-label="Assistente de consulta"
      className="fixed bottom-6 right-6 z-40 w-[min(26rem,calc(100vw-3rem))] h-[min(34rem,calc(100vh-6rem))] flex flex-col rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-[#002060]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex p-1.5 rounded-lg bg-[#0092FF]/15 text-[#0092FF] dark:text-[#00FFFF]">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white font-display">
              Assistente
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Consulta agenda, transcrições e CRM
            </p>
          </div>
        </div>
        <button
          onClick={() => setAberto(false)}
          aria-label="Fechar assistente"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {mensagens.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pergunte em português. Ele só consulta — não altera nada.
            </p>
            {SUGESTOES.map((s) => (
              <button
                key={s}
                onClick={() => perguntar(s)}
                className="block w-full text-left px-3 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {mensagens.map((m, i) => (
          <div
            key={i}
            className={m.autor === 'usuario' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                m.autor === 'usuario'
                  ? 'bg-[#0092FF] text-white rounded-br-sm'
                  : 'bg-slate-100 dark:bg-[#00061A] text-slate-800 dark:text-slate-200 rounded-bl-sm'
              }`}
            >
              {m.texto}
              {m.ferramenta && (
                // Mostrar a origem do dado não é enfeite: é o que permite
                // desconfiar da resposta quando a ferramenta foi a errada.
                <span className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
                  <Wrench className="w-2.5 h-2.5" aria-hidden="true" />
                  {m.ferramenta}
                </span>
              )}
            </div>
          </div>
        ))}

        {enviando && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-[#00061A] text-slate-500 dark:text-slate-400 text-xs inline-flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              Consultando...
            </div>
          </div>
        )}

        <div aria-live="polite" className="sr-only">
          {enviando ? 'Consultando' : mensagens.at(-1)?.autor === 'assistente' ? mensagens.at(-1)?.texto : ''}
        </div>
        <div ref={fimDaLista} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          perguntar(entrada)
        }}
        className="flex items-center gap-2 px-3 py-3 border-t border-slate-200 dark:border-[#002060]"
      >
        <input
          ref={campo}
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
          placeholder="O que eu tenho hoje?"
          aria-label="Sua pergunta"
          className="flex-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-[#0092FF] outline-none"
        />
        <button
          type="submit"
          disabled={!entrada.trim() || enviando}
          aria-label="Enviar pergunta"
          className="p-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
        >
          <Send className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}
