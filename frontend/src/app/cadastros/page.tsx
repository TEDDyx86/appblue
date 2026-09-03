'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Sidebar from '@/components/Sidebar'
import SugestoesCadastro from '@/components/SugestoesCadastro'
import {
  UploadCloud,
  UserCog,
  CalendarDays,
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
  Sliders,
  Settings,
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

interface PipedriveField {
  key: string
  name: string
  field_type: string
  is_custom: boolean
  options?: Array<{ id: number | string; label: string }>
}

interface ReuniaoComDados {
  id: string
  meeting_title: string | null
  meeting_date: string | null
  person_id: string
  person_name: string | null
  deal_id: string | null
  campos_extraidos: string[]
  dispensada: boolean
}

export default function CadastrosPage() {
  const router = useRouter()
  const { theme, isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Duas entradas para a mesma ficha: o PDF que o cliente manda e o que a
  // reunião apurou. São origens diferentes do mesmo cadastro, não telas
  // separadas.
  const [aba, setAba] = useState<'pdf' | 'transcricao'>('pdf')
  const [reunioes, setReunioes] = useState<ReuniaoComDados[]>([])
  const [carregandoReunioes, setCarregandoReunioes] = useState(false)
  const [erroReunioes, setErroReunioes] = useState('')
  const [revisandoId, setRevisandoId] = useState<string | null>(null)
  const [totalDispensadas, setTotalDispensadas] = useState(0)
  const [mostrarDispensadas, setMostrarDispensadas] = useState(false)
  const [dispensandoId, setDispensandoId] = useState<string | null>(null)
  const [avisoFila, setAvisoFila] = useState('')

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

  // Dynamic Pipedrive Person Fields & Mapping
  const [personFields, setPersonFields] = useState<PipedriveField[]>([])
  const [loadingFields, setLoadingFields] = useState(false)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [customMapping, setCustomMapping] = useState<Record<string, string>>({
    cpf: 'bccf793f30f8882dc987634461f65fcefe04c116',
    data_nascimento: 'c5f06bfce880ed2c3618d10b40eab28c4b31dd1c',
    profissao: '079e39aaa3b5ec6782cdea922a29682f165d3953',
    estado_civil: '14a3f171ae02abe5a3e89333c707ed6f74df8837',
    regime_casamento: '011f47eeeffdcd9977e52c2dd706e969a7d76abe',
    nome_conjuge: 'dad66a725f4cce02a26669d26e4929cb1c816150',
    renda: '3b4aea4bd2e89b7859117ade965123b8580d2173',
    endereco_completo: 'none',
    empresa_nome: 'none',
    codigo_xp: 'none',
    documento_identidade: 'none',
    nome_mae: 'none',
    naturalidade: 'none',
  })

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    success: boolean
    message: string
    person_url?: string
    person_id?: string
  } | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  useEffect(() => {
    const fetchPersonFields = async () => {
      try {
        setLoadingFields(true)
        const token = localStorage.getItem('access_token')
        if (!token) return
        const res = await axios.get(`${API_URL}/api/pipedrive/person-fields`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.data?.fields) {
          setPersonFields(res.data.fields)
        }
      } catch (err) {
        console.warn('Não foi possível obter campos do Pipedrive:', err)
      } finally {
        setLoadingFields(false)
      }
    }
    fetchPersonFields()
  }, [API_URL])

  const carregarReunioes = useCallback(
    async (incluirDispensadas: boolean) => {
      setCarregandoReunioes(true)
      setErroReunioes('')
      try {
        const token = localStorage.getItem('access_token')
        const res = await axios.get(`${API_URL}/api/transcriptions/com-dados-cadastrais`, {
          headers: { Authorization: `Bearer ${token}` },
          params: incluirDispensadas ? { incluir_dispensadas: true } : undefined,
        })
        setReunioes(res.data?.itens || [])
        setTotalDispensadas(res.data?.dispensadas || 0)
      } catch (err: any) {
        setErroReunioes(
          err?.response?.data?.detail || 'Não foi possível carregar as reuniões.',
        )
      } finally {
        setCarregandoReunioes(false)
      }
    },
    [API_URL],
  )

  // Só busca ao abrir a aba: a lista relê todas as transcrições e não faz
  // sentido pagar isso em quem veio importar um PDF.
  const abaAberta = aba === 'transcricao'
  useEffect(() => {
    if (abaAberta) carregarReunioes(mostrarDispensadas)
  }, [abaAberta, mostrarDispensadas, carregarReunioes])

  /**
   * Tira o card da fila sem tocar na transcrição.
   *
   * A remoção é otimista e o aviso oferece desfazer na hora: descartar é um
   * clique fácil de errar, e mandar a pessoa caçar o item no "ver dispensadas"
   * para consertar um deslize é atrito à toa.
   */
  const alternarDispensa = async (id: string, dispensar: boolean) => {
    setDispensandoId(id)
    setAvisoFila('')
    const anterior = reunioes
    if (dispensar && !mostrarDispensadas) {
      setReunioes((atual) => atual.filter((r) => r.id !== id))
    }
    try {
      const token = localStorage.getItem('access_token')
      await axios.post(
        `${API_URL}/api/transcriptions/${id}/cadastro-dispensar`,
        { dispensado: dispensar },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      setTotalDispensadas((n) => Math.max(0, n + (dispensar ? 1 : -1)))
      if (mostrarDispensadas) {
        setReunioes((atual) =>
          atual.map((r) => (r.id === id ? { ...r, dispensada: dispensar } : r)),
        )
      }
      setAvisoFila(dispensar ? 'Reunião dispensada da fila.' : 'Reunião devolvida à fila.')
    } catch (err: any) {
      setReunioes(anterior)
      setAvisoFila(err?.response?.data?.detail || 'Não foi possível atualizar a fila.')
    } finally {
      setDispensandoId(null)
    }
  }

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
        regime_casamento_id: editFields.regime_casamento_id || undefined,
        nome_conjuge: editFields.nome_conjuge || undefined,
        renda_mensal: editFields.renda_mensal || undefined,
        endereco_completo: editFields.endereco_completo || undefined,
        empresa_nome: editFields.empresa_nome || undefined,
        empresa_cnpj: editFields.empresa_cnpj || undefined,
        codigo_xp: editFields.codigo_xp || undefined,
        dados_bancarios: editFields.dados_bancarios || undefined,
        create_history_activity: createHistoryActivity,
        custom_field_mapping: customMapping,
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

  const renderFieldMapper = (fieldKey: string, fallbackKey: string) => {
    const currentVal = customMapping[fieldKey] !== undefined ? customMapping[fieldKey] : fallbackKey
    return (
      <div className="flex items-center space-x-1 flex-shrink-0">
        <span className="text-[10px] text-slate-400 font-bold hidden sm:inline">➔ Pipedrive:</span>
        <select
          value={currentVal}
          onChange={(e) => setCustomMapping((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
          className="text-[10px] font-bold bg-blue-50 dark:bg-[#002060]/70 border border-blue-200 dark:border-[#0092FF]/40 text-[#0092FF] dark:text-[#00FFFF] rounded-md px-1.5 py-0.5 max-w-[145px] truncate focus:outline-hidden cursor-pointer hover:border-[#0092FF] transition-colors"
          title="Selecione o campo do Pipedrive onde este valor será gravado"
        >
          <option value="none">🚫 Não salvar no campo</option>
          {personFields.length === 0 ? (
            <option value={currentVal}>Campo Padrão CRM</option>
          ) : (
            personFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name} {f.is_custom ? '★' : ''}
              </option>
            ))
          )}
        </select>
      </div>
    )
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

  const pendentes = reunioes.filter((r) => !r.dispensada).length

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
                <span>Ficha Cadastral</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-[#002060] dark:text-[#00FFFF] text-[10px] font-extrabold uppercase tracking-wider">
                  Pipedrive
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {aba === 'pdf'
                  ? 'Extração inteligente de PDFs e sincronização direta no Pipedrive CRM'
                  : 'Dados apurados nas reuniões, revisados campo a campo antes de gravar'}
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
          {/* Origem do dado: PDF enviado pelo cliente ou reunião transcrita */}
          <div
            role="tablist"
            aria-label="Origem dos dados cadastrais"
            className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-[#000D38] border border-slate-200 dark:border-[#002060]"
          >
            {([
              { id: 'pdf', rotulo: 'Do PDF', Icone: UploadCloud },
              { id: 'transcricao', rotulo: 'Da transcrição', Icone: CalendarDays },
            ] as const).map(({ id, rotulo, Icone }) => (
              <button
                key={id}
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`painel-${id}`}
                onClick={() => setAba(id)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                  aba === id
                    ? 'bg-white dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF] shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Icone className="w-3.5 h-3.5" aria-hidden="true" />
                {rotulo}
                {/* Conta só o que está na fila — o dispensado não é pendência. */}
                {id === 'transcricao' && pendentes > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-[#0092FF]/15 text-[#0092FF] dark:text-[#00FFFF] text-[10px] font-extrabold">
                    {pendentes}
                  </span>
                )}
              </button>
            ))}
          </div>

          {aba === 'transcricao' && (
            <div id="painel-transcricao" role="tabpanel" aria-labelledby="aba-transcricao" className="space-y-4">
              <div className="p-5 rounded-2xl bg-gradient-to-r from-[#000D38] via-[#00164D] to-[#002060] text-white shadow-lg border border-[#0092FF]/20 space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded bg-[#0092FF]/20 text-[#00FFFF] font-mono text-[10px] font-bold uppercase tracking-wider border border-[#00FFFF]/30">
                    Cadastro a partir da reunião
                  </span>
                </div>
                <h2 className="text-lg font-extrabold tracking-tight font-display text-white">
                  O que as reuniões apuraram sobre o cliente
                </h2>
                <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                  Reuniões já vinculadas a uma pessoa no CRM cujo briefing trouxe algum dado
                  cadastral. Abrir uma delas compara com o cadastro atual — nada é gravado sem
                  você marcar campo a campo.
                </p>
              </div>

              {carregandoReunioes && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
                  Relendo as transcrições...
                </p>
              )}

              {erroReunioes && (
                <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
                  {erroReunioes}
                </div>
              )}

              {!carregandoReunioes && !erroReunioes && reunioes.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
                  {mostrarDispensadas
                    ? 'Nenhuma reunião vinculada trouxe dados de cadastro.'
                    : totalDispensadas > 0
                      ? 'Fila vazia — tudo que tinha dado cadastral já foi revisado ou dispensado.'
                      : 'Nenhuma reunião vinculada trouxe dados de cadastro.'}
                </p>
              )}

              {/* Confirmação e desfazer ficam juntos: descartar é fácil de errar. */}
              <div aria-live="polite" className="min-h-[1.25rem]">
                {avisoFila && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{avisoFila}</p>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {reunioes.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-2xl border p-4 flex flex-col gap-3 transition-opacity ${
                      r.dispensada
                        ? 'border-dashed border-slate-300 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A]/60 opacity-70'
                        : 'border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {r.person_name || 'Cliente sem nome'}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {r.meeting_title}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {r.meeting_date && (
                          <span className="text-[10px] font-mono text-slate-400">
                            {r.meeting_date.slice(8, 10)}/{r.meeting_date.slice(5, 7)}
                          </span>
                        )}
                        {!r.dispensada && (
                          <button
                            onClick={() => alternarDispensa(r.id, true)}
                            disabled={dispensandoId === r.id}
                            aria-label={`Dispensar ${r.person_name || 'esta reunião'} da fila de revisão`}
                            title="Dispensar da fila"
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {r.campos_extraidos.map((c) => (
                        <span
                          key={c}
                          className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-[#002060]/60 text-[10px] font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {c}
                        </span>
                      ))}
                    </div>

                    {r.dispensada ? (
                      <button
                        onClick={() => alternarDispensa(r.id, false)}
                        disabled={dispensandoId === r.id}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#002060] transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        Devolver à fila
                      </button>
                    ) : (
                      <button
                        onClick={() => setRevisandoId(r.id)}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                      >
                        <UserCog className="w-3.5 h-3.5" aria-hidden="true" />
                        Revisar cadastro
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {totalDispensadas > 0 && (
                <button
                  onClick={() => setMostrarDispensadas((v) => !v)}
                  aria-pressed={mostrarDispensadas}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-[#002060] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF]"
                >
                  {mostrarDispensadas ? (
                    <>
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      Ocultar dispensadas
                    </>
                  ) : (
                    <>
                      <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                      Ver {totalDispensadas} dispensada{totalDispensadas === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {revisandoId && (
            <SugestoesCadastro
              transcriptionId={revisandoId}
              apiUrl={API_URL}
              onFechar={() => setRevisandoId(null)}
              onAplicado={() =>
                setAvisoFila(
                  'Cadastro atualizado. Dispense o card se não houver mais nada a revisar nesta reunião.',
                )
              }
            />
          )}

          {aba === 'pdf' && (
          <div id="painel-pdf" role="tabpanel" aria-labelledby="aba-pdf" className="space-y-6">
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
                  <UploadCloud className="w-8 h-8 transition-transform duration-300 group-hover:scale-110" />
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
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowMappingModal(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center space-x-1.5 border border-slate-200 dark:border-[#002060]"
                    title="Ver e configurar o mapeamento de campos Pipedrive"
                  >
                    <Sliders className="w-3.5 h-3.5 text-[#0092FF]" />
                    <span>Mapeamento CRM</span>
                  </button>

                  {hasMatch && matchedPerson && (
                    <a
                      href={matchedPerson.person_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-[#00061A] hover:bg-slate-200 dark:hover:bg-[#002060] text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors flex items-center space-x-1 border border-slate-200 dark:border-[#002060]"
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
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#002060] pb-3">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4 text-[#0092FF]" />
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                        Dados Pessoais & Documentos
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          Nome Completo
                        </label>
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                          ➔ Pipedrive: Nome (Padrão)
                        </span>
                      </div>
                      <input
                        type="text"
                        value={editFields.nome_completo || ''}
                        onChange={(e) => handleFieldChange('nome_completo', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            CPF
                          </label>
                          {renderFieldMapper('cpf', 'bccf793f30f8882dc987634461f65fcefe04c116')}
                        </div>
                        <input
                          type="text"
                          value={editFields.cpf || ''}
                          onChange={(e) => handleFieldChange('cpf', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Data de Nascimento
                          </label>
                          {renderFieldMapper('data_nascimento', 'c5f06bfce880ed2c3618d10b40eab28c4b31dd1c')}
                        </div>
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
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          Documento de Identidade (RG/CNH)
                        </label>
                        {renderFieldMapper('documento_identidade', 'none')}
                      </div>
                      <input
                        type="text"
                        value={editFields.documento_identidade || ''}
                        onChange={(e) => handleFieldChange('documento_identidade', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Nome da Mãe
                          </label>
                          {renderFieldMapper('nome_mae', 'none')}
                        </div>
                        <input
                          type="text"
                          value={editFields.nome_mae || ''}
                          onChange={(e) => handleFieldChange('nome_mae', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Nacionalidade / Naturalidade
                          </label>
                          {renderFieldMapper('naturalidade', 'none')}
                        </div>
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
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#002060] pb-3">
                    <div className="flex items-center space-x-2">
                      <Phone className="w-4 h-4 text-[#0092FF]" />
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                        Contatos & Endereço Residencial
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          E-mail Principal
                        </label>
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                          ➔ Pipedrive: E-mail (Padrão)
                        </span>
                      </div>
                      <input
                        type="email"
                        value={editFields.email || ''}
                        onChange={(e) => handleFieldChange('email', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Celular / WhatsApp
                          </label>
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                            ➔ Pipedrive: Telefone (Padrão)
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editFields.celular || editFields.telefone || ''}
                          onChange={(e) => handleFieldChange('celular', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            CEP
                          </label>
                          {renderFieldMapper('endereco_completo', 'none')}
                        </div>
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
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#002060] pb-3">
                    <div className="flex items-center space-x-2">
                      <Briefcase className="w-4 h-4 text-[#0092FF]" />
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                        Profissão & Situação Financeira
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Profissão
                          </label>
                          {renderFieldMapper('profissao', '079e39aaa3b5ec6782cdea922a29682f165d3953')}
                        </div>
                        <input
                          type="text"
                          value={editFields.profissao || ''}
                          onChange={(e) => handleFieldChange('profissao', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Renda Mensal (R$)
                          </label>
                          {renderFieldMapper('renda', '3b4aea4bd2e89b7859117ade965123b8580d2173')}
                        </div>
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
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          Empresa / Entidade Onde Trabalha
                        </label>
                        {renderFieldMapper('empresa_nome', 'none')}
                      </div>
                      <input
                        type="text"
                        value={editFields.empresa_nome || ''}
                        onChange={(e) => handleFieldChange('empresa_nome', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          CNPJ da Empresa
                        </label>
                        {renderFieldMapper('empresa_cnpj', 'none')}
                      </div>
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
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#002060] pb-3">
                    <div className="flex items-center space-x-2">
                      <Heart className="w-4 h-4 text-[#0092FF]" />
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 font-display">
                        Família & Dados Bancários XP
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Estado Civil
                          </label>
                          {renderFieldMapper('estado_civil', '14a3f171ae02abe5a3e89333c707ed6f74df8837')}
                        </div>
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
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            Código de Conta XP
                          </label>
                          {renderFieldMapper('codigo_xp', 'none')}
                        </div>
                        <input
                          type="text"
                          value={editFields.codigo_xp || ''}
                          onChange={(e) => handleFieldChange('codigo_xp', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          Nome do(a) Cônjuge
                        </label>
                        {renderFieldMapper('nome_conjuge', 'dad66a725f4cce02a26669d26e4929cb1c816150')}
                      </div>
                      <input
                        type="text"
                        value={editFields.nome_conjuge || ''}
                        onChange={(e) => handleFieldChange('nome_conjuge', e.target.value)}
                        className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] font-medium text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          Dados Bancários Cadastrados
                        </label>
                        {renderFieldMapper('dados_bancarios', 'none')}
                      </div>
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
          )}
        </div>
      </main>

        {/* CRM MAPPING MODAL */}
        {showMappingModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-scale-in border border-slate-200/80 dark:border-[#002060]">
              <div className="p-5 border-b border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-[#0092FF]/10 text-[#0092FF] dark:text-[#00FFFF] rounded-xl">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                      Mapeamento de Atribuição no Pipedrive
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Defina para qual campo da Pessoa no CRM cada dado da ficha será salvo.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMappingModal(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#002060] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4">
                <div className="text-xs text-blue-950 dark:text-blue-200 bg-blue-50/70 dark:bg-[#002060]/30 p-3.5 rounded-xl border border-blue-200/80 dark:border-[#0092FF]/30">
                  <p className="font-semibold text-blue-900 dark:text-blue-100">
                    💡 Dica: Todos os dados extraídos também são salvos no <strong>Histórico de Atividades</strong> da Pessoa, mesmo se você optar por não gravar em um campo específico.
                  </p>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-[#002060] text-xs">
                  {[
                    { label: 'Nome Completo', key: 'nome_completo', isDefaultFixed: true, defaultTarget: 'Nome (name)' },
                    { label: 'CPF do Cliente', key: 'cpf', defaultFallback: 'bccf793f30f8882dc987634461f65fcefe04c116' },
                    { label: 'Data de Nascimento', key: 'data_nascimento', defaultFallback: 'c5f06bfce880ed2c3618d10b40eab28c4b31dd1c' },
                    { label: 'Profissão', key: 'profissao', defaultFallback: '079e39aaa3b5ec6782cdea922a29682f165d3953' },
                    { label: 'Estado Civil', key: 'estado_civil', defaultFallback: '14a3f171ae02abe5a3e89333c707ed6f74df8837' },
                    { label: 'Regime de Casamento', key: 'regime_casamento', defaultFallback: '011f47eeeffdcd9977e52c2dd706e969a7d76abe' },
                    { label: 'Nome do Cônjuge', key: 'nome_conjuge', defaultFallback: 'dad66a725f4cce02a26669d26e4929cb1c816150' },
                    { label: 'Renda Mensal', key: 'renda', defaultFallback: '3b4aea4bd2e89b7859117ade965123b8580d2173' },
                    { label: 'E-mail Principal', key: 'email', isDefaultFixed: true, defaultTarget: 'E-mail (email)' },
                    { label: 'Telefone / WhatsApp', key: 'celular', isDefaultFixed: true, defaultTarget: 'Telefone (phone)' },
                    { label: 'Endereço / CEP', key: 'endereco_completo', defaultFallback: 'none' },
                    { label: 'Empresa Onde Trabalha', key: 'empresa_nome', defaultFallback: 'none' },
                    { label: 'CNPJ da Empresa', key: 'empresa_cnpj', defaultFallback: 'none' },
                    { label: 'Código de Conta XP', key: 'codigo_xp', defaultFallback: 'none' },
                    { label: 'Documento (RG/CNH)', key: 'documento_identidade', defaultFallback: 'none' },
                    { label: 'Nome da Mãe', key: 'nome_mae', defaultFallback: 'none' },
                    { label: 'Naturalidade / Nacionalidade', key: 'naturalidade', defaultFallback: 'none' },
                  ].map((row) => (
                    <div key={row.key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200 block">
                          {row.label}
                        </span>
                        {editFields && (editFields as any)[row.key] && (
                          <span className="text-[11px] text-slate-400 font-mono truncate max-w-xs block">
                            Valor: {String((editFields as any)[row.key])}
                          </span>
                        )}
                      </div>

                      <div className="flex-shrink-0">
                        {row.isDefaultFixed ? (
                          <span className="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                            ➔ Pipedrive: {row.defaultTarget}
                          </span>
                        ) : (
                          <select
                            value={customMapping[row.key] !== undefined ? customMapping[row.key] : (row.defaultFallback || 'none')}
                            onChange={(e) => setCustomMapping((prev) => ({ ...prev, [row.key]: e.target.value }))}
                            className="w-full sm:w-64 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-[#00061A] border border-slate-200 dark:border-[#002060] text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#0092FF]"
                          >
                            <option value="none">🚫 Não salvar no campo (apenas Histórico)</option>
                            {personFields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.name} {f.is_custom ? '★' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-[#002060] bg-slate-50 dark:bg-[#00061A] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setCustomMapping({
                      cpf: 'bccf793f30f8882dc987634461f65fcefe04c116',
                      data_nascimento: 'c5f06bfce880ed2c3618d10b40eab28c4b31dd1c',
                      profissao: '079e39aaa3b5ec6782cdea922a29682f165d3953',
                      estado_civil: '14a3f171ae02abe5a3e89333c707ed6f74df8837',
                      regime_casamento: '011f47eeeffdcd9977e52c2dd706e969a7d76abe',
                      nome_conjuge: 'dad66a725f4cce02a26669d26e4929cb1c816150',
                      renda: '3b4aea4bd2e89b7859117ade965123b8580d2173',
                      endereco_completo: 'none',
                      empresa_nome: 'none',
                      codigo_xp: 'none',
                      documento_identidade: 'none',
                      nome_mae: 'none',
                      naturalidade: 'none',
                    })
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
                >
                  Restaurar Padrões
                </button>

                <button
                  type="button"
                  onClick={() => setShowMappingModal(false)}
                  className="px-5 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white font-bold text-xs shadow-md transition-all"
                >
                  Concluir & Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
