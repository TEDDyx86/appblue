'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck, LockKeyhole } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        email: email.trim(),
        password,
      })

      // Salva tokens no localStorage
      localStorage.setItem('access_token', response.data.access_token)
      localStorage.setItem('refresh_token', response.data.refresh_token)

      router.push('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Falha na autenticação. Verifique seu e-mail e senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#00061A] px-4 py-12 relative overflow-hidden">
      {/* Subtle Background Lighting */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#0092FF]/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#001D99]/25 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img
              src="/logo-rt-horizontal-white.png"
              alt="Robson Tavernard"
              style={{ maxHeight: '52px', maxWidth: '220px' }}
              className="h-12 w-auto max-w-[220px] object-contain drop-shadow-md"
            />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight font-display">
            Painel Executivo & CRM
          </h1>
          <p className="text-xs text-slate-300 mt-1">
            Planejamento Patrimonial &bull; Pipedrive &bull; Agenda
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-[#000D38] border border-[#002060] rounded-3xl p-8 shadow-2xl backdrop-blur-md">
          <div className="flex items-center space-x-2.5 mb-6 pb-4 border-b border-[#002060]">
            <div className="p-2 bg-[#002060] rounded-xl text-[#0092FF] dark:text-[#00FFFF]">
              <LockKeyhole className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-display">Identificação de Acesso</h2>
              <p className="text-[11px] text-slate-400">Entre com suas credenciais autorizadas</p>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 px-4 py-3 rounded-xl text-xs mb-5 animate-shake">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                E-mail Corporativo
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-[#00061A] border border-[#002060] rounded-xl text-xs text-white placeholder:text-slate-600 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
                  placeholder="seu.nome@investimentosblue.com.br"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha de Acesso
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-[#00061A] border border-[#002060] rounded-xl text-xs text-white placeholder:text-slate-600 focus:ring-2 focus:ring-[#0092FF] focus:border-[#0092FF] outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-[#0092FF] hover:bg-[#007AFF] text-white py-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md shadow-[#0092FF]/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{loading ? 'Autenticando...' : 'Entrar no Sistema'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {/* Access notice */}
          <div className="mt-6 pt-4 border-t border-[#002060] text-center">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              🔒 <span className="font-semibold text-slate-300">Acesso Restrito à Equipe Blue3.</span>
              <br />
              A criação de novas contas é gerenciada exclusivamente pelo administrador do sistema.
            </p>
          </div>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-[11px] text-slate-400 flex items-center justify-center space-x-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#0092FF]" />
          <span>Ambiente protegido com criptografia e RLS (Supabase)</span>
        </div>
      </div>
    </div>
  )
}
