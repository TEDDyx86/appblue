'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { Phone, Loader2, AlertTriangle, Inbox } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

/** Quantas linhas cada fila mostra antes de avisar que há mais. */
const LIMITE_VISIVEL = 30

interface Resumo {
  clientes: number
  coberturas: number
  capital_segurado_total: number | string
  premio_anualizado_total: number | string
  mudancas_ultima_importacao: number
}

interface LinhaBase {
  cpf: string
  nome: string | null
  telefone: string | null
  profissao: string | null
}

interface CoberturaUnica extends LinhaBase {
  produto_atual: string | null
  riders_que_faltam: string[]
}

interface ParouDePagar extends LinhaBase {
  coberturas: string[]
  capital_parado: number | string
}

interface MaiorLacuna extends LinhaBase {
  renda_mensal: number | string
  capital_segurado: number | string
  razao_renda_anual: number | string
  lacuna: number | string
}

interface Aniversariante extends LinhaBase {
  dia: number
  idade: number
}

interface Fila {
  cobertura_unica: CoberturaUnica[]
  parou_de_pagar: ParouDePagar[]
  maior_lacuna: MaiorLacuna[]
  aniversariantes: Aniversariante[]
}

interface Dashboard {
  resumo: Resumo
  fila: Fila
}

/**
 * O Postgres devolve `NUMERIC` como string. As rotas desta feature já coagem
 * para número, mas a tela aceita os dois para não depender disso — é o mesmo
 * tratamento que AbaClientes.tsx adotou, e as duas telas precisam concordar.
 */
const reais = (v: number | string | null | undefined) => {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || Number.isNaN(n)) return '—'
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  })
}

/** Junta só o que existe, para não imprimir "null ·" nem separador solto. */
const juntar = (partes: (string | number | null | undefined)[]) =>
  partes.filter((p) => p !== null && p !== undefined && p !== '').join(' · ')

export default function AbaDashboard() {
  const [dados, setDados] = useState<Dashboard | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    axios
      .get(`${API}/api/base/dashboard`, { headers: cab() })
      .then((r) => setDados(r.data))
      .catch((e) =>
        setErro(
          e?.response?.data?.detail ||
            'Não foi possível carregar o dashboard. Verifique se o backend está no ar.',
        ),
      )
      .finally(() => setCarregando(false))
  }, [])

  if (carregando) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Carregando...
      </p>
    )
  }

  // Falha de carregamento não pode ser confundida com base vazia: mandar o
  // usuário importar uma planilha quando o problema é o backend fora do ar
  // custa o tempo dele e esconde o erro de verdade.
  if (erro || !dados) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300 inline-flex items-center gap-2"
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        {erro || 'Resposta vazia do servidor.'}
      </div>
    )
  }

  const r = dados.resumo || ({} as Resumo)
  const f = dados.fila || ({} as Fila)
  const coberturaUnica = f.cobertura_unica || []
  const parouDePagar = f.parou_de_pagar || []
  const maiorLacuna = f.maior_lacuna || []
  const aniversariantes = f.aniversariantes || []

  if (!r.clientes) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-[#002060] text-slate-400 flex items-center justify-center">
          <Inbox className="w-6 h-6" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-sm font-bold text-slate-900 dark:text-white font-display">
          A base ainda está vazia
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Envie o export da MAG pela aba <strong>Fila de processamento</strong>. Você confere o
          que mudou antes de qualquer coisa ser gravada.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile rotulo="Capital segurado" valor={reais(r.capital_segurado_total)} />
        <Tile rotulo="Prêmio anualizado" valor={reais(r.premio_anualizado_total)} />
        <Tile rotulo="Clientes" valor={String(r.clientes ?? 0)} />
        <Tile rotulo="Mudanças na última base" valor={String(r.mudancas_ultima_importacao ?? 0)} />
      </div>

      <Fila
        titulo={`Cobertura única — ${coberturaUnica.length} clientes`}
        subtitulo="Têm uma apólice só. A coluna mostra o que dá para oferecer."
        total={coberturaUnica.length}
      >
        {coberturaUnica.slice(0, LIMITE_VISIVEL).map((c) => (
          <Linha
            key={c.cpf}
            nome={c.nome}
            telefone={c.telefone}
            detalhe={
              (c.riders_que_faltam || []).join(' · ') || 'já tem todos os riders da carteira'
            }
          />
        ))}
      </Fila>

      {parouDePagar.length > 0 && (
        <Fila
          titulo={`Pararam de pagar — ${parouDePagar.length}`}
          subtitulo="Coberturas com status REMIDO. Ligação do dia."
          total={parouDePagar.length}
        >
          {parouDePagar.slice(0, LIMITE_VISIVEL).map((c) => (
            <Linha
              key={c.cpf}
              nome={c.nome}
              telefone={c.telefone}
              detalhe={juntar([
                (c.coberturas || []).filter(Boolean).join(' · '),
                `${reais(c.capital_parado)} parados`,
              ])}
            />
          ))}
        </Fila>
      )}

      <Fila
        titulo="Maior lacuna de cobertura"
        subtitulo="Ordenado pela diferença em reais para 10× a renda anual. Não é filtro — todos os clientes aparecem."
        total={maiorLacuna.length}
      >
        {maiorLacuna.slice(0, LIMITE_VISIVEL).map((c) => (
          <Linha
            key={c.cpf}
            nome={c.nome}
            telefone={c.telefone}
            detalhe={`${c.razao_renda_anual}× a renda anual · lacuna ${reais(c.lacuna)}`}
          />
        ))}
      </Fila>

      {aniversariantes.length > 0 && (
        <Fila
          titulo={`Aniversariantes do mês — ${aniversariantes.length}`}
          subtitulo=""
          total={aniversariantes.length}
        >
          {aniversariantes.slice(0, LIMITE_VISIVEL).map((c) => (
            <Linha
              key={c.cpf}
              nome={c.nome}
              telefone={c.telefone}
              detalhe={juntar([`dia ${c.dia}`, `${c.idade} anos`, c.profissao])}
            />
          ))}
        </Fila>
      )}
    </div>
  )
}

function Tile({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-4">
      <p className="text-[10px] uppercase font-bold text-slate-400">{rotulo}</p>
      <p className="text-xl font-extrabold text-slate-900 dark:text-white tnum mt-0.5">{valor}</p>
    </div>
  )
}

function Fila({
  titulo,
  subtitulo,
  total,
  children,
}: {
  titulo: string
  subtitulo: string
  total: number
  children: React.ReactNode
}) {
  const ocultos = Math.max(0, total - LIMITE_VISIVEL)
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-[#002060]">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">{titulo}</h3>
        {subtitulo && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitulo}</p>
        )}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-[#002060]/60 max-h-96 overflow-y-auto">
        {children}
      </ul>
      {/* Cortar em silêncio faria o usuário achar que a lista acabou. */}
      {ocultos > 0 && (
        <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100 dark:border-[#002060]">
          Mostrando os {LIMITE_VISIVEL} primeiros — mais {ocultos} na exportação.
        </p>
      )}
    </section>
  )
}

function Linha({
  nome,
  telefone,
  detalhe,
}: {
  nome: string | null
  telefone: string | null
  detalhe: string
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">
          {nome || 'sem nome'}
        </span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {detalhe}
        </span>
      </span>
      {telefone && (
        <a
          href={`tel:${telefone.replace(/\D/g, '')}`}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] text-[11px] font-bold hover:bg-blue-100 dark:hover:bg-blue-900/60"
        >
          <Phone className="w-3 h-3" aria-hidden="true" />
          {telefone}
        </a>
      )}
    </li>
  )
}
