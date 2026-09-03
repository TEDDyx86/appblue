'use client'

import { X, AlertTriangle, Link2, RefreshCw } from 'lucide-react'

export interface Vinculo {
  status: 'vinculado' | 'nao_vinculado' | 'nao_avaliado'
  motivo: string
  detalhe?: Record<string, any>
  activity_id?: string
  activity_type?: string
  activity_url?: string
  ja_estava_concluida?: boolean
  meeting_title?: string
}

interface MotivoVinculoProps {
  vinculo: Vinculo
  onFechar: () => void
  onVincularManual: () => void
  onTentarNovamente: () => void
  reavaliando?: boolean
}

/** Texto de cada código de falha, em linguagem de quem usa e não de quem programou. */
const EXPLICACAO: Record<string, { titulo: string; texto: string }> = {
  SEM_NOME_CLIENTE: {
    titulo: 'A transcrição não identificou o cliente',
    texto:
      'O documento do Tactiq não trouxe um nome de cliente. Costuma acontecer em reunião interna, treinamento ou quando ninguém é nomeado na conversa.',
  },
  SEM_DATA_REUNIAO: {
    titulo: 'A transcrição não trouxe a data da reunião',
    texto: 'Sem a data não há como saber qual reunião do negócio este briefing documenta.',
  },
  NEGOCIO_NAO_ENCONTRADO: {
    titulo: 'Nenhum negócio encontrado com esse nome',
    texto: 'A busca no Pipedrive não retornou nenhum negócio. Pode ser um prospect ainda sem cadastro ou uma reunião interna.',
  },
  COMPATIBILIDADE_BAIXA: {
    titulo: 'O nome não bate com nenhum negócio',
    texto:
      'Existe um negócio parecido, mas a semelhança é baixa demais para arriscar. Vincular sem certeza colocaria este briefing no cliente errado.',
  },
  SEM_ATIVIDADE_NA_DATA: {
    titulo: 'O negócio não tem reunião R1, R2 ou R3 nessa data',
    texto:
      'O cliente foi identificado, mas não havia reunião agendada no CRM para o dia da conversa. Provavelmente ela não chegou a ser criada.',
  },
  MULTIPLAS_CANDIDATAS: {
    titulo: 'Mais de uma reunião possível',
    texto:
      'Há mais de uma atividade R1/R2/R3 na janela de datas — no mesmo negócio ou em clientes de nome parecido — e não dá para saber qual delas este briefing documenta.',
  },
  ERRO_PIPEDRIVE: {
    titulo: 'O Pipedrive respondeu com erro',
    texto: 'Falha de comunicação com a API. Tentar novamente costuma resolver.',
  },
  NAO_AVALIADO: {
    titulo: 'Esta transcrição é anterior ao vínculo automático',
    texto: 'Ela foi processada antes desta funcionalidade existir, então nunca chegou a ser avaliada.',
  },
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-slate-100 dark:border-[#002060]/60 last:border-0">
      <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">{rotulo}</span>
      <span className="text-xs font-semibold text-slate-900 dark:text-white text-right">{valor}</span>
    </div>
  )
}

/**
 * Explica por que uma transcrição não foi vinculada à atividade.
 *
 * Mostra a evidência que levou à decisão — o "quase acerto" — porque é ela que
 * revela onde a regra precisa melhorar. Ver várias vezes que "Fred Candian" quase
 * casou com "Frederico Jacob Candian" é o que mostra que apelido merece
 * tratamento próprio.
 */
export default function MotivoVinculo({
  vinculo,
  onFechar,
  onVincularManual,
  onTentarNovamente,
  reavaliando = false,
}: MotivoVinculoProps) {
  const info = EXPLICACAO[vinculo.motivo] || {
    titulo: 'Não foi possível vincular',
    texto: `Motivo registrado: ${vinculo.motivo}`,
  }
  const d = vinculo.detalhe || {}
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-lg w-full border border-slate-200 dark:border-[#002060] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-start gap-3 min-w-0">
            <span className="inline-flex p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex-shrink-0">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display">
                {info.titulo}
              </h2>
              {vinculo.meeting_title && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {vinculo.meeting_title}
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

        <div className="p-5 space-y-4">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{info.texto}</p>

          {Object.keys(d).length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A]/60 px-4 py-2">
              {d.nome_buscado && <Linha rotulo="Buscamos por" valor={d.nome_buscado} />}
              {d.melhor_candidato && (
                <Linha rotulo="Mais parecido" valor={d.melhor_candidato} />
              )}
              {typeof d.score === 'number' && (
                <Linha
                  rotulo="Compatibilidade"
                  valor={
                    <span className="text-rose-600 dark:text-rose-400">
                      {pct(d.score)}
                      <span className="text-slate-400 font-normal">
                        {' '}· mínimo {pct(d.limiar ?? 0.9)}
                      </span>
                    </span>
                  }
                />
              )}
              {d.negocio && <Linha rotulo="Negócio" valor={d.negocio} />}
              {d.data_reuniao && <Linha rotulo="Data da reunião" valor={d.data_reuniao} />}
              {Array.isArray(d.reunioes_no_negocio) && (
                <Linha
                  rotulo="Reuniões no negócio"
                  valor={d.reunioes_no_negocio.length ? d.reunioes_no_negocio.join(' · ') : 'nenhuma'}
                />
              )}
              {Array.isArray(d.candidatas) && (
                <Linha
                  rotulo="Candidatas"
                  valor={
                    <span className="flex flex-col items-end gap-0.5">
                      {d.candidatas.map((c: any) => (
                        <span key={c.id}>
                          {c.tipo} {c.data}
                          {/* O negócio importa: as candidatas podem estar em
                              clientes diferentes de nome parecido. */}
                          {c.negocio && (
                            <span className="text-slate-400 font-normal"> · {c.negocio}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  }
                />
              )}
              {Array.isArray(d.negocios_avaliados) && d.negocios_avaliados.length > 1 && (
                <Linha
                  rotulo="Negócios com o mesmo nome"
                  valor={d.negocios_avaliados.map((n: any) => n.titulo).join(' · ')}
                />
              )}
              {d.erro && <Linha rotulo="Erro" valor={d.erro} />}
            </div>
          )}

          {vinculo.motivo === 'COMPATIBILIDADE_BAIXA' && (
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 italic">
              Se forem a mesma pessoa, vincule manualmente — o registro fica salvo e ajuda a
              ajustar a regra depois.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50/50 dark:bg-[#00061A]/50">
          <button
            onClick={onTentarNovamente}
            disabled={reavaliando}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#002060] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${reavaliando ? 'animate-spin' : ''}`} aria-hidden="true" />
            {reavaliando ? 'Avaliando...' : 'Tentar novamente'}
          </button>
          <button
            onClick={onVincularManual}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
            Vincular manualmente
          </button>
        </div>
      </div>
    </div>
  )
}
