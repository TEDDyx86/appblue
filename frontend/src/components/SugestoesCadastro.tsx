'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { X, Check, ExternalLink, AlertTriangle, UserCog } from 'lucide-react'

interface Sugestao {
  campo: string
  rotulo: string
  tipo: string
  valor_atual: string | number | null
  valor_exibido: string | number | null
  valor_transcricao: string
  aplicavel: boolean
  motivo_nao_aplicavel: string | null
  ja_igual: boolean
  acao: 'igual' | 'preencher' | 'substituir'
}

interface Dados {
  person_id: string | null
  person_name: string | null
  person_url: string | null
  nome_transcricao: string | null
  meeting_title?: string
  sugestoes: Sugestao[]
  aplicaveis: number
  extras_para_nota: Record<string, any>
}

interface SugestoesCadastroProps {
  transcriptionId: string
  apiUrl: string
  onFechar: () => void
  onAplicado?: () => void
}

function formatar(v: string | number | null) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
  }
  return String(v)
}

/**
 * Revisão campo a campo do que a transcrição sugere para o cadastro.
 *
 * Nada vem pré-marcado, nem os campos vazios no CRM: o valor atual é a
 * informação principal e qualquer alteração exige decisão explícita. Campo já
 * igual não é marcável, e "substituir" é distinguido de "preencher" porque o
 * primeiro descarta informação existente.
 */
export default function SugestoesCadastro({
  transcriptionId,
  apiUrl,
  onFechar,
  onAplicado,
}: SugestoesCadastroProps) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [criarNota, setCriarNota] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [aplicando, setAplicando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const carregar = async () => {
      try {
        const token = localStorage.getItem('access_token')
        const r = await axios.get(
          `${apiUrl}/api/transcriptions/${transcriptionId}/sugestoes-cadastro`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        setDados(r.data)
      } catch (e: any) {
        setErro(e?.response?.data?.detail || 'Não foi possível carregar as sugestões.')
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [transcriptionId, apiUrl])

  const alternar = (campo: string) => {
    setMarcados((atual) => {
      const nova = new Set(atual)
      nova.has(campo) ? nova.delete(campo) : nova.add(campo)
      return nova
    })
  }

  const aplicar = async () => {
    setAplicando(true)
    setErro('')
    try {
      const token = localStorage.getItem('access_token')
      await axios.post(
        `${apiUrl}/api/transcriptions/${transcriptionId}/aplicar-cadastro`,
        { campos: Array.from(marcados), criar_nota: criarNota },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      onAplicado?.()
      onFechar()
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Falha ao aplicar as alterações.')
    } finally {
      setAplicando(false)
    }
  }

  const temExtras = dados && Object.keys(dados.extras_para_nota || {}).length > 0
  const total = marcados.size + (criarNota && temExtras ? 1 : 0)

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-[#002060] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex p-2 rounded-xl bg-[#0092FF]/15 text-[#0092FF] dark:text-[#00FFFF] flex-shrink-0">
              <UserCog className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                Atualizar cadastro a partir da reunião
              </h2>
              {dados?.person_name && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {dados.person_name}
                  {dados.person_url && (
                    <a
                      href={dados.person_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1.5 text-[#0092FF] hover:underline inline-flex items-center gap-0.5"
                    >
                      abrir no CRM
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {carregando && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              Comparando com o cadastro...
            </p>
          )}

          {erro && (
            <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
              {erro}
            </div>
          )}

          {dados && !carregando && dados.sugestoes.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
              A transcrição não trouxe nenhum dado cadastral aproveitável.
            </p>
          )}

          {dados && dados.sugestoes.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200 dark:border-[#002060]">
                  <th className="pb-2 w-8" scope="col"><span className="sr-only">Aplicar</span></th>
                  <th className="pb-2" scope="col">Campo</th>
                  <th className="pb-2" scope="col">No CRM</th>
                  <th className="pb-2" scope="col">Da transcrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#002060]/60">
                {dados.sugestoes.map((s) => {
                  const atual = formatar(s.valor_atual)
                  const sugerido = formatar(s.valor_exibido)
                  const marcavel = s.aplicavel && !s.ja_igual
                  return (
                    <tr key={s.campo} className="align-top">
                      <td className="py-2.5">
                        {marcavel && (
                          <input
                            type="checkbox"
                            checked={marcados.has(s.campo)}
                            onChange={() => alternar(s.campo)}
                            aria-label={`Aplicar ${s.rotulo}`}
                            className="w-4 h-4 rounded border-slate-300 dark:border-[#002060] text-[#0092FF] focus:ring-2 focus:ring-[#0092FF] cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                        {s.rotulo}
                      </td>
                      <td className="py-2.5 text-slate-900 dark:text-white">
                        {atual || (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">vazio</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <span className="text-slate-600 dark:text-slate-300">{sugerido || s.valor_transcricao}</span>
                        {s.ja_igual && (
                          <span className="ml-2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">igual</span>
                        )}
                        {s.acao === 'substituir' && s.aplicavel && (
                          <span className="ml-2 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            substitui
                          </span>
                        )}
                        {!s.aplicavel && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            não aplicável: {s.motivo_nao_aplicavel}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {temExtras && (
            <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A]/60 cursor-pointer">
              <input
                type="checkbox"
                checked={criarNota}
                onChange={(e) => setCriarNota(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-300 dark:border-[#002060] text-[#0092FF] focus:ring-2 focus:ring-[#0092FF] cursor-pointer"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300">
                Também criar uma nota na pessoa com patrimônio, seguros existentes e interesse
                <span className="block text-[10px] text-slate-400 mt-0.5">
                  Esses dados não têm campo correspondente no cadastro.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            Nada é alterado sem marcação
          </span>
          <button
            onClick={aplicar}
            disabled={total === 0 || aplicando}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            {aplicando ? 'Aplicando...' : `Aplicar ${total} ${total === 1 ? 'alteração' : 'alterações'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
