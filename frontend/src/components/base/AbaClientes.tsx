'use client'

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Search, X } from 'lucide-react'

interface Cliente {
  cpf: string
  nome: string
  telefone: string | null
  email: string | null
  profissao: string | null
  renda: number | string | null
  data_nascimento: string | null
  total_capital_segurado: number | string | null
  total_premio_mensal: number | string | null
  qtd_propostas: number
  qtd_coberturas: number
}

interface Cobertura {
  item_contratado: string
  produto: string
  status_cobertura: string
  capital_segurado: number | string | null
  premio_mensalizado: number | string | null
}

interface DetalheCliente {
  cliente: Cliente
  coberturas: Cobertura[]
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

// O Postgres devolve NUMERIC como string (ex.: "456902.55"), nunca como number.
// Converte antes de formatar; valores ausentes ou inválidos viram travessão.
const reais = (v: number | string | null | undefined) => {
  const n = Number(v)
  if (v === null || v === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function AbaClientes() {
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<Cliente[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<DetalheCliente | null>(null)
  const [erroDetalhe, setErroDetalhe] = useState('')
  const buscaId = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => {
      const idAtual = ++buscaId.current
      setCarregando(true)
      axios.get(`${API}/api/base/clientes`, { params: { busca }, headers: cab() })
        .then((r) => {
          if (idAtual !== buscaId.current) return // resposta de uma busca já superada
          setItens(r.data.itens || [])
        })
        .catch(() => {
          if (idAtual !== buscaId.current) return
          setItens([])
        })
        .finally(() => {
          if (idAtual !== buscaId.current) return
          setCarregando(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [busca])

  const abrir = async (cpf: string) => {
    setErroDetalhe('')
    try {
      const r = await axios.get(`${API}/api/base/clientes/${cpf}`, { headers: cab() })
      setAberto(r.data)
    } catch {
      setErroDetalhe('Não foi possível carregar os dados deste cliente.')
    }
  }

  const fechar = () => setAberto(null)

  useEffect(() => {
    if (!aberto) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [aberto])

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF ou profissão..."
          aria-label="Buscar cliente"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-[#0092FF] outline-none"
        />
      </div>

      {erroDetalhe && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{erroDetalhe}</p>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] divide-y divide-slate-100 dark:divide-[#002060]/60 overflow-hidden">
        {carregando && (
          <p className="p-4 text-xs text-slate-500 dark:text-slate-400">Carregando...</p>
        )}
        {!carregando && itens.length === 0 && (
          <p className="p-4 text-xs text-slate-500 dark:text-slate-400">Nenhum cliente encontrado.</p>
        )}
        {!carregando && itens.map((c) => {
          const detalhes = [c.profissao, `${c.qtd_coberturas} cobertura(s)`].filter(Boolean).join(' · ')
          return (
            <button key={c.cpf} onClick={() => abrir(c.cpf)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-[#002060] transition-colors">
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">{c.nome}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{detalhes}</span>
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tnum flex-shrink-0">
                {reais(c.total_capital_segurado)}
              </span>
            </button>
          )
        })}
      </div>

      {aberto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={fechar}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-detalhe-cliente"
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#000D38] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-[#002060] shadow-2xl overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200 dark:border-[#002060]">
              <div className="min-w-0">
                <h2 id="titulo-detalhe-cliente" className="text-sm font-bold text-slate-900 dark:text-white font-display truncate">
                  {aberto.cliente?.nome}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {[aberto.cliente?.telefone, aberto.cliente?.email].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button onClick={fechar} aria-label="Fechar"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060]">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-2">
              {(aberto.coberturas || []).length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma cobertura registrada.</p>
              )}
              {(aberto.coberturas || []).map((c) => (
                <div key={c.item_contratado} className="rounded-xl border border-slate-200 dark:border-[#002060] p-3">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">{c.produto}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {c.status_cobertura} · CS {reais(c.capital_segurado)} · prêmio {reais(c.premio_mensalizado)}/mês
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
