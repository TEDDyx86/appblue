'use client'

import { useState } from 'react'
import axios, { isAxiosError } from 'axios'
import { Download, Loader2 } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

// Data local (não UTC): perto da meia-noite em Brasília, toISOString() já mostra
// o dia seguinte — armadilha registrada no CLAUDE.md do projeto.
const dataLocalHoje = () => {
  const d = new Date()
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

// Extrai o nome de arquivo do cabeçalho Content-Disposition, quando presente,
// para não haver dois lugares decidindo o nome (backend e frontend divergindo).
const nomeDoContentDisposition = (cd: unknown): string | null => {
  if (typeof cd !== 'string') return null
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export default function AbaExportar() {
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState('')

  const baixar = async () => {
    setBaixando(true); setErro('')
    try {
      const r = await axios.get(`${API}/api/base/exportar`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        responseType: 'blob',
      })
      const nomeArquivo = nomeDoContentDisposition(r.headers['content-disposition']) || `BASE_MAG_${dataLocalHoje()}.xlsx`
      const url = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = nomeArquivo
      document.body.appendChild(a)
      a.click()
      a.remove()
      // a.click() dispara o download de forma assíncrona em alguns navegadores;
      // revogar a URL no mesmo tick pode cancelá-lo.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (e) {
      // Com responseType: 'blob', o corpo de erro também vem como blob — e.response.data.detail
      // não existe. Tenta ler o blob como texto/JSON; se não der, usa a mensagem genérica.
      let mensagem = 'Não foi possível gerar o arquivo.'
      if (isAxiosError(e) && e.response?.data instanceof Blob) {
        try {
          const texto = await e.response.data.text()
          const corpo = JSON.parse(texto)
          if (typeof corpo?.detail === 'string') mensagem = corpo.detail
        } catch {
          /* corpo de erro não é JSON legível; mantém a mensagem genérica */
        }
      }
      setErro(mensagem)
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-6 space-y-3 max-w-xl">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
        Exportar a base tratada
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        Gera o <code>.xlsx</code> de duas abas — <strong>1_CLIENTES</strong> e{' '}
        <strong>2_APÓLICES_E_COBERTURAS</strong> — no mesmo formato do tratamento manual.
        O ID da cobertura sai como texto, sem a notação científica que corrompia o arquivo antigo.
      </p>
      {erro && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>
      )}
      <button onClick={baixar} disabled={baixando}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 disabled:opacity-40">
        {baixando ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Download className="w-3.5 h-3.5" aria-hidden="true" />}
        Baixar .xlsx
      </button>
    </div>
  )
}
