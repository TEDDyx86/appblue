'use client'

import { AlertCircle } from 'lucide-react'
import CollapsibleCard from '@/components/CollapsibleCard'
import AlertsDataGrid from '@/components/AlertsDataGrid'

export interface Alert {
  id: string
  alert_type: 'negocio_parado' | 'follow_up_atrasado' | 'teams_pendente'
  cliente_nome: string | null
  description: string
  severity: 'low' | 'medium' | 'high'
  is_resolved: boolean
  created_at: string
  pipedrive_deal_id?: string
  pipedrive_activity_id?: string
  details?: Record<string, any>
}

interface AlertsPanelProps {
  alerts: Alert[]
  onResolve: (id: string) => void
  onMoveUp?: (() => void) | null
  onMoveDown?: (() => void) | null
  onHide?: () => void
}

/**
 * Card de alertas operacionais.
 *
 * A lista expansível anterior foi substituída por um data grid (TanStack Table
 * v9): colunas ordenáveis, busca global e paginação. O componente ficou sendo
 * só a casca — cabeçalho retrátil mais o grid.
 */
export default function AlertsPanel({
  alerts,
  onResolve,
  onMoveUp,
  onMoveDown,
  onHide,
}: AlertsPanelProps) {
  return (
    <CollapsibleCard
      title="Alertas Operacionais"
      subtitle="Negócios parados e follow-ups vencidos do Funil Comercial"
      count={alerts.length}
      storageKey="alertas-operacionais"
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onHide={onHide}
      icon={
        <span className="inline-flex w-10 h-10 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 rounded-xl items-center justify-center">
          <AlertCircle className="w-5 h-5 text-[#0092FF] dark:text-[#00FFFF]" aria-hidden="true" />
        </span>
      }
    >
      <AlertsDataGrid alerts={alerts} onResolve={onResolve} />
    </CollapsibleCard>
  )
}
