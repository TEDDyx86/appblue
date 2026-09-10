'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { UploadCloud, Check, X, Loader2, AlertTriangle } from 'lucide-react'

interface ItemNovo {
  chave: string
  cpf: string
  nome: string
  produto: string
  capital_segurado: number
  status: string
}

interface ItemAlterado {
  chave: string
  cpf: string
  nome: string
  campos: Record<string, [unknown, unknown]>
}

interface ItemSumido {
  chave: string
  cpf: string
  nome: string
}

interface Diff {
  importacao_id: string
  inalterados: number
  novos: ItemNovo[]
  alterados: ItemAlterado[]
  sumidos: ItemSumido[]
  avisos: string[]
  linhas_arquivo: number
  linhas_descartadas: number
}

interface ItemHistorico {
  id: string
  arquivo_nome: string
  status: string
  linhas_arquivo: number
  linhas_descartadas: number
  created_at: string
  aplicada_em: string | null
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

export default function AbaFila() {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [historico, setHistorico] = useState<ItemHistorico[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  const carregarHistorico = async () => {
    try {
      const r = await axios.get(`${API}/api/base/importacoes`, { headers: cab() })
      setHistorico(r.data.itens || [])
    } catch {
      /* histórico é secundário; não bloqueia a tela */
    }
  }

  useEffect(() => { carregarHistorico() }, [])

  const enviar = async (f: File) => {
    setOcupado(true); setErro(''); setDiff(null)
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await axios.post(`${API}/api/base/importar`, fd, { headers: cab() })
      setDiff({
        ...r.data,
        novos: r.data.novos ?? [],
        alterados: r.data.alterados ?? [],
        sumidos: r.data.sumidos ?? [],
        avisos: r.data.avisos ?? [],
        inalterados: r.data.inalterados ?? 0,
      })
      setArquivo(f)
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Não foi possível ler a planilha.')
    } finally {
      setOcupado(false)
    }
  }

  const aplicar = async () => {
    if (!diff || !arquivo) return
    setOcupado(true); setErro('')
    const fd = new FormData()
    fd.append('file', arquivo)
    try {
      await axios.post(`${API}/api/base/importacoes/${diff.importacao_id}/aplicar`, fd, { headers: cab() })
      setDiff(null); setArquivo(null); carregarHistorico()
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Falha ao aplicar.')
    } finally {
      setOcupado(false)
    }
  }

  const descartar = async () => {
    if (!diff) return
    setOcupado(true); setErro('')
    try {
      await axios.post(`${API}/api/base/importacoes/${diff.importacao_id}/descartar`, {}, { headers: cab() })
      setDiff(null); setArquivo(null); carregarHistorico()
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Não foi possível descartar a importação.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-6">
      {!diff && (
        <label
          htmlFor="arquivo-mag"
          className="block border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer border-slate-300 dark:border-[#002060] bg-white dark:bg-[#000D38] hover:border-[#0092FF] focus-within:border-[#0092FF] focus-within:ring-2 focus-within:ring-[#0092FF] transition-colors"
        >
          <input
            id="arquivo-mag"
            type="file"
            accept=".xlsx"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) enviar(f)
            }}
          />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#0092FF] to-[#002060] text-white flex items-center justify-center">
            {ocupado ? <Loader2 className="w-7 h-7 animate-spin" aria-hidden="true" /> : <UploadCloud className="w-7 h-7" aria-hidden="true" />}
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-white font-display">
            {ocupado ? 'Lendo a planilha...' : 'Arraste o export da MAG aqui'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Nada é gravado antes da sua confirmação.
          </p>
        </label>
      )}

      {erro && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
          {erro}
        </div>
      )}

      {diff && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Sem mudança', diff.inalterados, 'text-slate-500'],
              ['Novos', diff.novos.length, 'text-emerald-600 dark:text-emerald-400'],
              ['Alterados', diff.alterados.length, 'text-amber-600 dark:text-amber-400'],
              ['Sumiram', diff.sumidos.length, 'text-rose-600 dark:text-rose-400'],
            ].map(([rotulo, valor, cor]) => (
              <div key={rotulo as string} className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-4">
                <p className="text-[10px] uppercase font-bold text-slate-400">{rotulo}</p>
                <p className={`text-2xl font-extrabold tnum ${cor}`}>{valor as number}</p>
              </div>
            ))}
          </div>

          {diff.novos.length > 0 && (
            <Secao titulo={`${diff.novos.length} novos`}>
              {diff.novos.slice(0, 50).map((n) => (
                <li key={n.chave} className="py-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">{n.nome}</span> — {n.produto}
                </li>
              ))}
            </Secao>
          )}

          {diff.alterados.length > 0 && (
            <Secao titulo={`${diff.alterados.length} alterados`}>
              {diff.alterados.slice(0, 50).map((a) => (
                <li key={a.chave} className="py-1.5 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{a.nome}</span>
                  {Object.entries(a.campos).map(([campo, par]) => (
                    <span key={campo} className="block text-slate-500 dark:text-slate-400 ml-3">
                      {campo}: <span className="text-rose-500">{String(par[0])}</span> → <span className="text-emerald-500">{String(par[1])}</span>
                    </span>
                  ))}
                </li>
              ))}
            </Secao>
          )}

          {diff.sumidos.length > 0 && (
            <Secao titulo={`${diff.sumidos.length} não vieram nesta planilha`}>
              <li className="text-[11px] text-slate-500 dark:text-slate-400 pb-2">
                Nada é apagado. Pode ser cancelamento ou recorte diferente do export.
              </li>
              {diff.sumidos.slice(0, 50).map((s) => (
                <li key={s.chave} className="py-1 text-xs text-slate-600 dark:text-slate-300">{s.nome}</li>
              ))}
            </Secao>
          )}

          {diff.avisos.length > 0 && (
            <Secao titulo={`${diff.avisos.length} avisos de leitura`}>
              {diff.avisos.map((a, i) => (
                <li key={i} className="py-1 text-xs text-amber-600 dark:text-amber-400">{a}</li>
              ))}
            </Secao>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Aplica tudo ou nada. Se algo estiver errado, descarte e suba o arquivo corrigido.
            </span>
            <div className="flex items-center gap-2">
              <button onClick={descartar} disabled={ocupado}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#002060] disabled:opacity-40">
                <X className="w-3.5 h-3.5" aria-hidden="true" /> Descartar
              </button>
              <button onClick={aplicar} disabled={ocupado}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 disabled:opacity-40">
                {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                Aplicar importação
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2">Importações anteriores</h3>
        <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] divide-y divide-slate-100 dark:divide-[#002060]/60">
          {historico.length === 0 && (
            <p className="p-4 text-xs text-slate-500 dark:text-slate-400">Nenhuma importação ainda.</p>
          )}
          {historico.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
              <span className="truncate text-slate-700 dark:text-slate-300">{h.arquivo_nome}</span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className="text-slate-400">{(h.created_at || '').slice(0, 10)}</span>
                <span className={`font-bold ${h.status === 'aplicada' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {h.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details open className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] px-4 py-3">
      <summary className="text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">{titulo}</summary>
      <ul className="mt-2 max-h-64 overflow-y-auto">{children}</ul>
    </details>
  )
}
