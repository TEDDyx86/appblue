'use client'

import { useMemo, useState } from 'react'
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  sortFn_alphanumeric,
  sortFn_text,
  sortFn_datetime,
  filterFn_includesString,
  createColumnHelper,
  type ColumnDef,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table'
import {
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Search,
  ExternalLink,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { Alert } from '@/components/AlertsPanel'

interface AlertsDataGridProps {
  alerts: Alert[]
  onResolve: (id: string) => void
}

const rotuloTipo: Record<Alert['alert_type'], string> = {
  negocio_parado: 'Negócio Parado',
  follow_up_atrasado: 'Follow-up Atrasado',
  teams_pendente: 'Teams Pendente',
}

const classeTipo: Record<Alert['alert_type'], string> = {
  negocio_parado:
    'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60',
  follow_up_atrasado:
    'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/60',
  teams_pendente:
    'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60',
}

const rotuloSeveridade: Record<Alert['severity'], string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
}

const classeSeveridade: Record<Alert['severity'], string> = {
  high: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  low: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
}

/**
 * Features opt-in desta tabela.
 *
 * Na v9 não basta listar as features: os **row models** e as **funções de
 * ordenação/filtro** entram no mesmo objeto, via `tableFeatures()`. Sem
 * `sortedRowModel` / `filteredRowModel` / `paginatedRowModel` o estado muda mas
 * as linhas nunca são reprocessadas — os cabeçalhos parecem clicáveis e não
 * acontece nada.
 *
 * Dependências que o compilador exige: `globalFilteringFeature` requer
 * `columnFilteringFeature`, e `getVisibleCells()` requer `columnVisibilityFeature`.
 */
const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
  filterFns: {
    includesString: filterFn_includesString,
  },
})

/**
 * Severidade precisa de ordem semântica, não alfabética: ordenar as strings
 * daria "high, low, medium", com a prioridade baixa no meio.
 */
const pesoSeveridade: Record<Alert['severity'], number> = { high: 0, medium: 1, low: 2 }

const colunaHelper = createColumnHelper<typeof features, Alert>()

/**
 * Formata a data lendo os campos direto do texto ISO.
 *
 * `new Date('2026-01-15')` é interpretado como meia-noite UTC; em São Paulo
 * (UTC-3) isso renderiza como 14/01. Com timestamp completo o erro só aparece
 * entre 00h e 03h UTC — intermitente, e por isso mais difícil de notar.
 */
function formatarData(iso: string) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  const [, ano, mes, dia] = m
  return `${dia}/${mes}/${ano.slice(2)}`
}

/**
 * Grid de alertas sobre TanStack Table v9.
 *
 * A v9 abandona o `useReactTable`/`getCoreRowModel` da v8: as features são
 * opt-in num objeto e os row models vêm junto delas. Por isso o `features`
 * abaixo lista explicitamente o que esta tabela usa.
 *
 * A estilização é a paleta do sistema em hex, não os tokens do shadcn — eles
 * não existem neste projeto (ver `ui/button.tsx`, que está quebrado por isso).
 */
export default function AlertsDataGrid({ alerts, onResolve }: AlertsDataGridProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  // O tipo do valor precisa ser `any` no array: cada coluna tem um tipo de
  // retorno diferente (string, enum, display) e eles não unificam sozinhos.
  const columns = useMemo<ColumnDef<typeof features, Alert, any>[]>(
    () => [
      colunaHelper.accessor((row) => row.cliente_nome || 'Sem cliente', {
        id: 'cliente',
        header: 'Cliente',
        cell: (info) => (
          <span className="font-semibold text-slate-900 dark:text-white">{info.getValue()}</span>
        ),
      }),
      // Os accessors devolvem o texto que aparece na tela, não o valor cru do
      // banco. A busca global e a ordenação usam o accessor — traduzindo só na
      // célula, o usuário via "Alta" mas só conseguia buscar por "high".
      colunaHelper.accessor((row) => rotuloTipo[row.alert_type], {
        id: 'alert_type',
        header: 'Tipo',
        cell: (info) => {
          const t = info.row.original.alert_type
          return (
            <span
              className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap ${classeTipo[t]}`}
            >
              {rotuloTipo[t]}
            </span>
          )
        },
      }),
      colunaHelper.accessor('description', {
        header: 'Detalhe',
        // Ordenar texto livre e longo não leva a lugar nenhum — só embaralha.
        // Continua buscável, que é o uso real desta coluna.
        enableSorting: false,
        cell: (info) => (
          <span
            className="text-slate-600 dark:text-slate-300 line-clamp-2"
            title={info.getValue()}
          >
            {info.getValue()}
          </span>
        ),
      }),
      colunaHelper.accessor((row) => rotuloSeveridade[row.severity], {
        id: 'severity',
        header: 'Prioridade',
        // Ordem semântica, não alfabética: pelo rótulo daria Alta, Baixa, Média.
        sortFn: (a, b) =>
          pesoSeveridade[a.original.severity] - pesoSeveridade[b.original.severity],
        cell: (info) => {
          const s = info.row.original.severity
          return (
            <span
              className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border ${classeSeveridade[s]}`}
            >
              {rotuloSeveridade[s]}
            </span>
          )
        },
      }),
      colunaHelper.accessor((row) => formatarData(row.created_at), {
        id: 'created_at',
        header: 'Criado',
        // Buscável pela data formatada, mas ordenada pelo ISO original —
        // ordenar "01/03/26" como texto colocaria janeiro depois de dezembro.
        sortFn: (a, b) => a.original.created_at.localeCompare(b.original.created_at),
        cell: (info) => (
          <span className="text-slate-500 dark:text-slate-400 tnum whitespace-nowrap">
            {info.getValue()}
          </span>
        ),
      }),
      colunaHelper.display({
        id: 'acoes',
        header: () => <span className="sr-only">Ações</span>,
        enableSorting: false,
        cell: (info) => {
          const a = info.row.original
          const url = a.details?.deal_url as string | undefined
          return (
            <div className="flex items-center justify-end gap-1">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir negócio de ${a.cliente_nome || 'cliente'} no Pipedrive`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-[#0092FF] hover:bg-blue-50 dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                onClick={() => onResolve(a.id)}
                aria-label={`Resolver alerta de ${a.cliente_nome || 'cliente'}`}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <Check className="w-3 h-3" aria-hidden="true" />
                Resolver
              </button>
            </div>
          )
        },
      }),
    ],
    [onResolve],
  )

  const table = useTable({
    features,
    data: alerts,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
  })

  const linhas = table.getRowModel().rows
  const totalFiltrado = table.getFilteredRowModel().rows.length
  const paginaAtual = pagination.pageIndex + 1
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / pagination.pageSize))

  return (
    <div>
      {/* Barra de pesquisa */}
      <div className="p-4 border-b border-slate-200/80 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50">
        <div className="relative max-w-sm">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value)
              setPagination((p) => ({ ...p, pageIndex: 0 }))
            }}
            placeholder="Buscar em todos os campos..."
            aria-label="Buscar alertas"
            className="w-full pl-9 pr-8 py-2 bg-white dark:bg-[#00061A] border border-slate-300 dark:border-[#002060] rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
          />
          {globalFilter && (
            <button
              type="button"
              onClick={() => setGlobalFilter('')}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm font-bold"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {table.getHeaderGroups().map((grupo) => (
              <tr key={grupo.id} className="border-b border-slate-200 dark:border-[#002060]">
                {grupo.headers.map((header) => {
                  const podeOrdenar = header.column.getCanSort()
                  const direcao = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        direcao === 'asc'
                          ? 'ascending'
                          : direcao === 'desc'
                            ? 'descending'
                            : podeOrdenar
                              ? 'none'
                              : undefined
                      }
                      className="text-left font-bold text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 px-4 py-2.5 bg-slate-50 dark:bg-[#00061A]/60"
                    >
                      {podeOrdenar ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] rounded"
                        >
                          <table.FlexRender header={header} />
                          {direcao === 'asc' ? (
                            <ArrowUp className="w-3 h-3" aria-hidden="true" />
                          ) : direcao === 'desc' ? (
                            <ArrowDown className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <ChevronsUpDown className="w-3 h-3 opacity-40" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllLeafColumns().length}
                  className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                >
                  {globalFilter
                    ? `Nenhum alerta encontrado para “${globalFilter}”.`
                    : 'Nenhum alerta pendente.'}
                </td>
              </tr>
            ) : (
              linhas.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 dark:border-[#002060]/60 hover:bg-slate-50 dark:hover:bg-[#00061A]/60 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-top max-w-xs">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalFiltrado > pagination.pageSize && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Página <span className="font-bold tnum">{paginaAtual}</span> de{' '}
            <span className="font-bold tnum">{totalPaginas}</span> &middot;{' '}
            <span className="tnum">{totalFiltrado}</span> alertas
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Página anterior"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[#002060] text-slate-500 hover:bg-white dark:hover:bg-[#002060] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Próxima página"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[#002060] text-slate-500 hover:bg-white dark:hover:bg-[#002060] disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
