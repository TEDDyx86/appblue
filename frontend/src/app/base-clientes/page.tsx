'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Database, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import AbaDashboard from '@/components/base/AbaDashboard'
import AbaClientes from '@/components/base/AbaClientes'
import AbaFila from '@/components/base/AbaFila'
import AbaExportar from '@/components/base/AbaExportar'

type Aba = 'dashboard' | 'clientes' | 'fila' | 'exportar'

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'dashboard', rotulo: 'Dashboard' },
  { id: 'clientes', rotulo: 'Clientes' },
  { id: 'fila', rotulo: 'Fila de processamento' },
  { id: 'exportar', rotulo: 'Exportar dados' },
]

export default function BaseClientesPage() {
  const router = useRouter()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aba, setAba] = useState<Aba>('dashboard')

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#00061A] text-[#000D38] dark:text-slate-100 font-sans overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={() => {
          localStorage.removeItem('access_token')
          router.push('/login')
        }}
      />
      <main className={`flex-1 overflow-y-auto transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white/80 dark:bg-[#000D38]/80 backdrop-blur-md border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF]">
              <Database className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Base de Clientes
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Carteira MAG — importação semanal reconciliada
              </p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Alternar tema"
            className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <div className="p-6 max-w-7xl mx-auto space-y-6">
          <div role="tablist" aria-label="Seções da Base de Clientes"
               className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-[#000D38] border border-slate-200 dark:border-[#002060]">
            {ABAS.map(({ id, rotulo }) => (
              <button
                key={id}
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`painel-${id}`}
                onClick={() => setAba(id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                  aba === id
                    ? 'bg-white dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF] shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <div id={`painel-${aba}`} role="tabpanel" aria-labelledby={`aba-${aba}`}>
            {aba === 'dashboard' && <AbaDashboard />}
            {aba === 'clientes' && <AbaClientes />}
            {aba === 'fila' && <AbaFila />}
            {aba === 'exportar' && <AbaExportar />}
          </div>
        </div>
      </main>
    </div>
  )
}
