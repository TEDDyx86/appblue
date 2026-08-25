'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  Calendar,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Zap,
  Activity,
  UserCheck,
} from 'lucide-react'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onLogout: () => void
  userName?: string
  userEmail?: string
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  onLogout,
  userName = 'Robson Vieira',
  userEmail = 'robson.vieira@investimentosblue.com.br',
}: SidebarProps) {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/transcriptions', label: 'Transcrições', icon: FileText, badge: 'Auto' },
    { href: '/cadastros', label: 'Ficha Cadastral', icon: UserCheck, badge: 'PDF' },
    { href: '/agenda', label: 'Agenda', icon: Calendar, badge: 'Pipedrive' },
    { href: '/logs', label: 'Logs & Auditoria', icon: Activity, badge: 'Live' },
    { href: '/alerts', label: 'Alertas', icon: AlertTriangle },
    { href: '/settings', label: 'Configurações', icon: Settings },
  ]

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-[#000D38] text-slate-200 border-r border-[#002060]/80 transition-all duration-300 z-40 flex flex-col ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-[#002060]/80 bg-[#00061A]/60">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center space-x-2 group overflow-hidden">
            <img
              src="/logo-rt-horizontal-white.png"
              alt="Robson Tavernard"
              style={{ maxHeight: '34px', maxWidth: '160px' }}
              className="h-8 w-auto max-w-[155px] object-contain group-hover:scale-102 transition-transform"
            />
          </Link>
        )}
        
        {collapsed && (
          <Link
            href="/dashboard"
            className="w-9 h-9 bg-gradient-to-br from-[#0092FF] to-[#001D99] rounded-xl flex items-center justify-center mx-auto shadow-sm shadow-[#0092FF]/30 font-display font-extrabold text-xs text-white"
            title="Robson Tavernard"
          >
            RT
          </Link>
        )}

        <button
          onClick={onToggleCollapse}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#002060] transition-colors ${
            collapsed ? 'mx-auto mt-2' : ''
          }`}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="p-3 space-y-1.5 flex-1 overflow-y-auto">
        {!collapsed && (
          <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
            Navegação Principal
          </div>
        )}
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href === '/dashboard' && pathname === '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group ${
                isActive
                  ? 'bg-gradient-to-r from-[#0092FF]/20 to-[#001D99]/30 text-white border border-[#0092FF]/60 shadow-[0_0_15px_rgba(0,146,255,0.25)]'
                  : 'text-slate-300 hover:text-white hover:bg-[#002060]/50'
              } ${collapsed ? 'justify-center px-2' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  isActive ? 'text-[#00FFFF]' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />
              {!collapsed && (
                <div className="flex items-center justify-between flex-1">
                  <span className={isActive ? 'font-bold text-white' : ''}>{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#0092FF]/30 text-[#00FFFF] border border-[#0092FF]/50 shadow-[0_0_8px_rgba(0,255,255,0.2)]">
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User Profile & Logout */}
      <div className="p-3 border-t border-[#002060]/80 bg-[#00061A]/70">
        {!collapsed ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#0092FF] text-white flex items-center justify-center font-bold text-xs flex-shrink-0 shadow-xs shadow-[#0092FF]/30">
                {userName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{userName}</p>
                <p className="text-[11px] text-slate-400 truncate">{userEmail}</p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-[#002060] transition-colors"
              title="Sair do sistema"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onLogout}
            className="w-full py-2 flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-[#002060] rounded-lg transition-colors"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  )
}