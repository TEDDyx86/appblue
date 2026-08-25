'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import {
  UploadCloud,
  FileText,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  User,
  Sparkles,
  ArrowUpRight,
  Sun,
  Moon,
  Check,
  X,
  CreditCard,
  Building,
  MapPin,
  Briefcase,
  Heart,
  Phone,
  Mail,
  DollarSign,
  ShieldCheck,
  ChevronRight,
  Layers,
  Search,
  CheckCheck,
} from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'

interface ExtractedData {
  nome_completo: string | null
  cpf: string | null
  nome_mae: string | null
  nome_pai: string | null
  data_nascimento: string | null
  data_nascimento_iso: string | null
  nacionalidade: string | null
  naturalidade: string | null
  sexo: string | null
  estado_civil: string | null
  estado_civil_id: number | null
  regime_casamento: string | null
  regime_casamento_id: number | null
  nome_conjuge: string | null
  cpf_conjuge: string | null
  documento_identidade: string | null
  email: string | null
  telefone: string | null
  celular: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  endereco_completo: string | null
  profissao: string | null
  ocupacao: string | null
  empresa_nome: string | null
  empresa_cnpj: string | null
  renda_mensal: number | null
  renda_mensal_fmt: string | null
  codigo_xp: string | null
  dados_bancarios: string | null
}

interface MatchedPerson {
  id: string
  name: string
  email: string | null
  phone: string | null
  cpf: string | null
  data_nascimento: string | null
  profissao: string | null
  estado_civil_id: number | null
  nome_conjuge: string | null
  renda: string | number | null
  person_url: string
  raw_data?: any
}

export default function CadastrosPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Drag & drop & file states
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Extraction results
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null)
  const [matchedPerson, setMatchedPerson] = useState<MatchedPerson | null>(null)
  const [hasMatch, setHasMatch] = useState(false)

  // Editable fields before sync
  const [editFields, setEditFields] = useState<ExtractedData | null>(null)
  const [createNewPerson, setCreateNewPerson] = useState(false)
  const [createHistoryActivity, setCreateHistoryActivity] = useState(true)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    success: boolean
    message: string
    person_url?: string
    person_id?: string
  } | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.type === 'application/pdf' || droppedFile.name.toLowerCase().endsWith('.pdf')) {
        processPdfFile(droppedFile)
      } else {
        setErrorMsg('Por favor envie apenas arquivos no formato PDF (.pdf).')
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0]
      processPdfFile(selectedFile)
    }
  }

  const processPdfFile = async (selectedFile: File) => {
    try {
      setFile(selectedFile)
      setProcessing(true)
      setErrorMsg('')
      setSyncResult(null)

      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }

      const formData = new FormData()
      formData.append('file', selectedFile)

      const res = await axios.post(`${API_URL}/api/pdf/parse-ficha-cadastral`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      })

      if (res.data.status === 'success') {
        const ext = res.data.extracted_data
        setExtractedData(ext)
        setEditFields({ ...ext })
        setMatchedPerson(res.data.matched_person)
        setHasMatch(res.data.has_match)
        setCreateNewPerson(!res.data.has_match)
      } else {
        setErrorMsg('Não foi possível extrair os dados do PDF enviado.')
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Erro ao processar o arquivo PDF.')
    } finally {
      setProcessing(false)
    }
  }

  const handleFieldChange = (field: keyof ExtractedData, value: any) => {
    if (!editFields) return
    setEditFields({
      ...editFields,
      [field]: value,
    })
  }

  const handleSaveToPipedrive = async () => {
    if (!editFields || !editFields.nome_completo) {
      alert('O Nome Completo do cliente é obrigatório.')
      return
    }

    try {
      setSyncing(true)
      setErrorMsg('')
      const token = localStorage.getItem('access_token')

      const payload = {
        person_id: !createNewPerson && matchedPerson ? matchedPerson.id : undefined,
        create_new: createNewPerson,
        nome_completo: editFields.nome_completo,
        cpf: editFields.cpf || undefined,
        data_nascimento_iso: editFields.data_nascimento_iso || undefined,
        email: editFields.email || undefined,
        telefone: editFields.telefone || undefined,
        celular: editFields.celular || undefined,
        profissao: editFields.profissao || undefined,
        estado_civil_id: editFields.estado_civil_id || undefined,
        nome_conjuge: editFields.nome_conjuge || undefined,
        renda_mensal: editFields.renda_mensal || undefined,
        endereco_completo: editFields.endereco_completo || undefined,
        empresa_nome: editFields.empresa_nome || undefined,
        empresa_cnpj: editFields.empresa_cnpj || undefined,
        codigo_xp: editFields.codigo_xp || undefined,
        dados_bancarios: editFields.dados_bancarios || undefined,
        create_history_activity: createHistoryActivity,
      }

      const res = await axios.post(`${API_URL}/api/pipedrive/sync-person-ficha`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.data.status === 'success') {
        setSyncResult({
          success: true,
          message: res.data.message,
          person_url: res.data.person_url,
          person_id: res.data.person_id,
        })
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || err.message || 'Erro ao sincronizar com o Pipedrive.')
    } finally {
      setSyncing(false)
    }
  }

  const handleReset = () => {
    setFile(null)
    setExtractedData(null)
    setEditFields(null)
    setMatchedPerson(null)
    setHasMatch(false)
    setErrorMsg('')
    setSyncResult(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#00061A] text-[#000D38] dark:text-slate-100 font-sans transition-colors duration-200 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={() => {
          localStorage.removeItem('access_token')
          router.push('/login')
        }}
      />

      {/* Main Content */}
      <main
        className={`flex-1 overflow-y-auto transition-all duration-300 ${
          sidebarCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        {/* Top Navbar */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white/80 dark:bg-[#000D38]/80 backdrop-blur-md border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white font-display flex items-center space-x-2">
                <span>Importação de Ficha Cadastral (PDF)</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#002060] dark:text-[#00FFFF] text-[10px] font-extrabold uppercase tracking-wider">
                  OCR & Pipedrive
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Extração inteligente de PDFs e sincronização direta no Pipedrive CRM
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
              title="Alternar Tema"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>
          </div>
        </header>

        {/* Page Container */}
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          {/* Top Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-[#000D38] via-[#00164D] to-[#002060] text-white shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-[#0092FF]/20">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-[#0092FF]/20 text-[#00FFFF] font-mono text-[10px] font-bold uppercase tracking-wider border border-[#00FFFF]/30">
                  Automação Cadastral
                </span>
                <span className="text-xs text-slate-300 font-medium">Template XP Investimentos & Parceiros</span>
              </div>
              <h2 className="text-lg font-extrabold tracking-tight font-display text-white">
                Importe e Enriqueça Fichas no Pipedrive
              </h2>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                Arraste o arquivo PDF da Ficha Cadastral abaixo. O sistema lerá os campos (CPF, Nascimento, Renda, Profissão, Cônjuge, Contatos, Endereço e Código XP), localizará o cliente no CRM e atualizará os dados com 1 clique.
              </p>
            </div>

            {editFields && (
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 transition-all flex items-center space-x-1.5 flex-shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Importar Novo PDF</span>
              </button>
            )}
          </div>

          {/* DRAG & DROP ZONE (If no file or resetting) */}
          {!editFields && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center space-y-4 ${
                isDragging
                  ? 'border-[#0092FF] bg-blue-50/50 dark:bg-[#002060]/40 scale-101'
                  : 'border-slate-300 dark:border-[#002060] bg-white dark:bg-[#000D38] hover:border-[#0092FF] dark:hover:border-[#0092FF]'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".pdf"
                className="hidden"
              />

              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#0092FF] to-[#002060] text-white flex items-center justify-center shadow-lg shadow-blue-500/20">
                {processing ? (
                  <RefreshCw className="w-8 h-8 animate-spin" />
                ) : (
                  <UploadCloud className="w-8 h-8 animate-bounce" />
                )}
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                  {processing ? 'Processando e Extraindo Dados do PDF...' : 'Arraste e solte o PDF da Ficha Cadastral aqui'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {processing
                    ? 'Lendo posições, identificando campos e consultando Pipedrive...'
                    : 'ou clique para selecionar o arquivo no seu computador (.pdf)'}
                </p>
              </div>

              <div className="flex items-center space-x-2 text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Compatível com Fichas Cadastrais XP Investimentos e parceiros</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-300 flex items-start space-x-3">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Aviso:</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {syncResult && syncResult.success && (
            <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700/60 text-emerald-900 dark:text-emerald-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-in shadow-md">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-emerald-500 text-white rounded-xl">
                  <CheckCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-emerald-950 dark:text-white">
                    {syncResult.message}
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                    Todos os dados cadastrais e a atividade de histórico foram vinculados ao Pipedrive.
                  </p>
                </div>
              </div>

              {syncResult.person_url && (
                <a
                  href={syncResult.person_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center space-x-1.5 flex-shrink-0"
                >
                  <span>Abrir Pessoa no Pipedrive (#{syncResult.person_id})</span>
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              )}
            </div>
          )}

          {/* EXTRACTION RESULTS & COMPARISON VIEW */}
          {editFields && (
            <div className="space-y-6">
              {/* Match Header Card */}
              <div className="p-5 rounded-2xl bg-white dark:bg-[#000D38] border border-slate-200/80 dark:border-[#002060] shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start space-x-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#0092FF] to-[#002060] text-white flex items-center justify-center font-bold text-lg font-display shadow-md shadow-blue-500/20 flex-shrink-0">
                    {editFields.nome_completo ? editFields.nome_completo.charAt(0).toUpperCase() : 'C'}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                        {editFields.nome_completo || 'Cliente'}
                      </h3>
                      {hasMatch && matchedPerson ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold flex items-center space-x-1">
                          <Check className="w-3 h-3" />
                          <span>Localizado no Pipedrive (Pessoa #{matchedPerson.id})</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#002060] dark:text-[#00FFFF] text-[10px] font-bold flex items-center space-x-1">
                          <Sparkles className="w-3 h-3" />
                          <span>Novo Contato (Não cadastrado)</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {editFields.cpf && (
                        <span className="font-mono">CPF: <strong className="text-slate-700 dark:text-slate-200">{editFields.cpf}</strong></span>
                      )}
                      {editFields.codigo_xp && (
                        <span className="font-mono">Conta XP: <strong className="text-slate-700 dark:text-slate-200">{editFields.codigo_xp}</strong></span>
                      )}
                      {file && (
                        <span>Arquivo: <strong className="text-slate-700 dark:text-slate-200">{file.name}</strong></span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Match Action Selection */}
                <div className="flex flex-wrap items-center gap-3">
                  {hasMatch && matchedPerson && (
                    <a
                      href={matchedPerson.person_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center space-x-1"
                      title="Ver cadastro atual no Pipedrive"
                    >
                      <span>Ver no Pipedrive</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveToPipedrive}
                    disabled={syncing}
                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#0092FF] to-[#002060] hover:from-[#0080E6] hover:to-[#001D99] text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition-all flex items-center space-x-2 disabled:opacity-50"
                  >
                    {syncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Sincronizando no Pipedrive...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{createNewPerson ? 'Cadastrar Novo Contato no Pipedrive' : 'Atualizar Contato no Pipedrive'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Mode Selector (Update vs Create New) */}
              {hasMatch && (
                <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    O contato <strong>{matchedPerson?.name}</strong> já existe no CRM. Deseja atualizar o cadastro existente ou criar uma nova pessoa?
                  </span>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setCreateNewPerson(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        !createNewPerson
                          ? 'bg-[#0092FF] text-white shadow-xs'
                          : 'bg-white dark:bg-[#000D38] text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Atualizar Existente (#{matchedPerson?.id})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateNewPerson(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        createNewPerson
                          ? 'bg-[#0092FF] text-white shadow-xs'
                          : 'bg-white dark:bg-[#000D38] text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Criar como Novo Contato
                    </button>
                  </div>
                </div>
              )}

              {/* 4 Cards Grid with Extracted Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 1. DADOS PESSOAIS & DOCUMENTOS */}
                <div className="p-5 rounded-2xl bg-white dark:bg-[#000D38] border border-slate-200/80 dark:border-[#002060] shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#002060] pb-3">
                    <User className="w-4 h-4 text-[#0092FF]" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                      Dados Pessoais & Documentos
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Nome Completo
                      </label>
                      <input
                        type="text"
                        value={editFields.nome_completo || ''}
                        onChange={(e) => handleFieldChange('nome_completo', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          CPF
                        </label>
                        <input
                          type="text"
                          value={editFields.cpf || ''}
                          onChange={(e) => handleFieldChange('cpf', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Data de Nascimento
                        </label>
                        <input
                          type="date"
                          value={editFields.data_nascimento_iso || ''}
                          onChange={(e) => {
                            const val = e.target.value
                            handleFieldChange('data_nascimento_iso', val)
                            if (val) {
                              const [y, m, d] = val.split('-')
                              handleFieldChange('data_nascimento', `${d}/${m}/${y}`)
                            }
                          }}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Documento de Identidade
                      </label>
                      <input
                        type="text"
                        value={editFields.documento_identidade || ''}
                        onChange={(e) => handleFieldChange('documento_identidade', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Nome da Mãe
                        </label>
                        <input
                          type="text"
                          value={editFields.nome_mae || ''}
                          onChange={(e) => handleFieldChange('nome_mae', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Nacionalidade / Naturalidade
                        </label>
                        <input
                          type="text"
                          value={editFields.naturalidade || editFields.nacionalidade || ''}
                          onChange={(e) => handleFieldChange('naturalidade', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. CONTATOS & ENDEREÇO RESIDENCIAL */}
                <div className="p-5 rounded-2xl bg-white dark:bg-[#000D38] border border-slate-200/80 dark:border-[#002060] shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#002060] pb-3">
                    <Phone className="w-4 h-4 text-[#0092FF]" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                      Contatos & Endereço Residencial
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        E-mail Principal
                      </label>
                      <input
                        type="email"
                        value={editFields.email || ''}
                        onChange={(e) => handleFieldChange('email', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Celular / WhatsApp
                        </label>
                        <input
                          type="text"
                          value={editFields.celular || editFields.telefone || ''}
                          onChange={(e) => handleFieldChange('celular', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          CEP
                        </label>
                        <input
                          type="text"
                          value={editFields.cep || ''}
                          onChange={(e) => handleFieldChange('cep', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Logradouro & Número
                      </label>
                      <input
                        type="text"
                        value={editFields.logradouro || ''}
                        onChange={(e) => handleFieldChange('logradouro', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Bairro
                        </label>
                        <input
                          type="text"
                          value={editFields.bairro || ''}
                          onChange={(e) => handleFieldChange('bairro', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Cidade
                        </label>
                        <input
                          type="text"
                          value={editFields.cidade || ''}
                          onChange={(e) => handleFieldChange('cidade', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          UF
                        </label>
                        <input
                          type="text"
                          value={editFields.uf || ''}
                          onChange={(e) => handleFieldChange('uf', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. DADOS PROFISSIONAIS & FINANCEIROS */}
                <div className="p-5 rounded-2xl bg-white dark:bg-[#000D38] border border-slate-200/80 dark:border-[#002060] shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#002060] pb-3">
                    <Briefcase className="w-4 h-4 text-[#0092FF]" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                      Profissão & Situação Financeira
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Profissão
                        </label>
                        <input
                          type="text"
                          value={editFields.profissao || ''}
                          onChange={(e) => handleFieldChange('profissao', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Renda Mensal (R$)
                        </label>
                        <input
                          type="number"
                          step="1000"
                          value={editFields.renda_mensal || ''}
                          onChange={(e) => handleFieldChange('renda_mensal', parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Empresa / Entidade Onde Trabalha
                      </label>
                      <input
                        type="text"
                        value={editFields.empresa_nome || ''}
                        onChange={(e) => handleFieldChange('empresa_nome', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        CNPJ da Empresa
                      </label>
                      <input
                        type="text"
                        value={editFields.empresa_cnpj || ''}
                        onChange={(e) => handleFieldChange('empresa_cnpj', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>
                  </div>
                </div>

                {/* 4. FAMÍLIA & DADOS BANCÁRIOS */}
                <div className="p-5 rounded-2xl bg-white dark:bg-[#000D38] border border-slate-200/80 dark:border-[#002060] shadow-xs space-y-4">
                  <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#002060] pb-3">
                    <Heart className="w-4 h-4 text-[#0092FF]" />
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                      Família & Dados Bancários XP
                    </h4>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Estado Civil
                        </label>
                        <select
                          value={editFields.estado_civil_id || 53}
                          onChange={(e) => handleFieldChange('estado_civil_id', parseInt(e.target.value))}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        >
                          <option value={53}>Casado(a)</option>
                          <option value={52}>Solteiro(a)</option>
                          <option value={54}>União Estável</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                          Código de Conta XP
                        </label>
                        <input
                          type="text"
                          value={editFields.codigo_xp || ''}
                          onChange={(e) => handleFieldChange('codigo_xp', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Nome do(a) Cônjuge
                      </label>
                      <input
                        type="text"
                        value={editFields.nome_conjuge || ''}
                        onChange={(e) => handleFieldChange('nome_conjuge', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1">
                        Dados Bancários Cadastrados
                      </label>
                      <input
                        type="text"
                        value={editFields.dados_bancarios || ''}
                        onChange={(e) => handleFieldChange('dados_bancarios', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Sync Bar */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                <label className="flex items-center space-x-2.5 text-xs text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createHistoryActivity}
                    onChange={(e) => setCreateHistoryActivity(e.target.checked)}
                    className="w-4 h-4 rounded text-[#0092FF] focus:ring-[#0092FF]"
                  />
                  <span>Registrar Atividade de Histórico no Pipedrive (&quot;Ficha Cadastral XP Importada&quot;)</span>
                </label>

                <div className="flex items-center space-x-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveToPipedrive}
                    disabled={syncing}
                    className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#0092FF] to-[#002060] hover:from-[#0080E6] hover:to-[#001D99] text-white font-bold text-xs shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {syncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Sincronizando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{createNewPerson ? 'Cadastrar Novo Contato' : 'Confirmar & Atualizar no Pipedrive'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
