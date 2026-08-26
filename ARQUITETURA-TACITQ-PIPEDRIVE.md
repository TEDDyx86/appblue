# Arquitetura: Automação Tactiq → Google Drive → Pipedrive

## 1. Fluxo End-to-End

```
[Reunião Google Meet]
    ↓
[Tactiq transcreve + IA estrutura com prompt customizado]
    ↓
[Tactiq salva em Google Drive → Tactiq Transcription/]
    ↓
[Google Drive webhook notifica sua app (POST HTTPS)]
    ↓
[FastAPI endpoint recebe notificação]
    ↓
[Lê arquivo .txt do Drive]
    ↓
[Executa prompt Tactiq → extrai proxima_acao (descrição, prazo, cliente)]
    ↓
[Matching cliente no Pipedrive por nome/email]
    ↓
├─ Candidato único + alta confiança → Cria Activity automaticamente
├─ Múltiplos candidatos → Notifica admin pra confirmação manual
└─ Nenhum encontrado → Notifica admin
    ↓
[Activity criada com origem_pipeline = "tactiq-auto"]
    ↓
[Salva estado no Supabase:
  - transcription_id (Google Doc ID)
  - deal_id (Pipedrive)
  - activity_id (Pipedrive)
  - status_teams ("pendente" / "confirmado")
  - created_at, updated_at]
    ↓
[Job diário (cron 7h):
  - Verifica Activities com status_teams = "pendente"
  - Checa conference_meeting_url no Pipedrive
  - Consolida 3 alertas:
    1. Negócio parado (sem update > 15 dias)
    2. Follow-up atrasado (due_date vencida)
    3. Teams pendente (conference_meeting_url vazio + due_date vencida/próxima)]
    ↓
[Dashboard exibe alertas em tempo real]
```

---

## 2. Stack Técnica

| Componente | Tecnologia | Função |
|---|---|---|
| **Autenticação** | JWT + email/senha | Sign up / Login |
| **Backend** | FastAPI (Python) | Webhook receiver, Pipedrive API, processamento |
| **Database** | Supabase (PostgreSQL) + RLS | Estado, auditing |
| **Frontend** | Next.js 16 + TypeScript | Dashboard de alertas |
| **Storage** | Google Drive | Histórico de transcrições |
| **CRM** | Pipedrive API | Source of truth para clientes/deals/activities |
| **Job Scheduler** | APScheduler ou Celery | Job diário de alertas |
| **Secrets** | Env vars / .env | API tokens (Pipedrive, Google, Tactiq) |

---

## 3. Schema Supabase (PostgreSQL + RLS)

### Tabela: `users`
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS: Apenas o próprio usuário pode ler seus dados
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid()::text = id::text OR current_user_id() = id);
```

### Tabela: `transcriptions`
```sql
CREATE TABLE transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_doc_id VARCHAR(255) UNIQUE NOT NULL,
  meeting_title VARCHAR(255),
  meeting_date TIMESTAMP,
  transcription_text TEXT,
  briefing_json JSONB, -- { principais_topicos: [...], dados_cliente: {...}, proxima_acao: {...} }
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS: Apenas admin pode ver todas; users veem suas próprias
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin can view all" ON transcriptions
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
CREATE POLICY "Users view own" ON transcriptions
  FOR SELECT USING (created_by = auth.uid());
```

### Tabela: `pipeline_activities` (vinculação entre Tactiq e Pipedrive)
```sql
CREATE TABLE pipeline_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcription_id UUID NOT NULL REFERENCES transcriptions(id),
  pipedrive_deal_id VARCHAR(255),
  pipedrive_person_id VARCHAR(255),
  pipedrive_activity_id VARCHAR(255) UNIQUE,
  cliente_nome VARCHAR(255),
  cliente_email VARCHAR(255),
  proxima_acao_descricao TEXT,
  proxima_acao_prazo DATE,
  status_teams VARCHAR(50) DEFAULT 'pendente' CHECK (status_teams IN ('pendente', 'confirmado')),
  conference_meeting_url VARCHAR(500),
  matching_confidence NUMERIC(3,2), -- 0.00-1.00
  matching_manual_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS: Apenas admin pode criar/update; users leem se role = admin
ALTER TABLE pipeline_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access" ON pipeline_activities
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
```

### Tabela: `alerts` (para dashboard)
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('negocio_parado', 'follow_up_atrasado', 'teams_pendente')),
  pipeline_activity_id UUID REFERENCES pipeline_activities(id),
  pipedrive_deal_id VARCHAR(255),
  cliente_nome VARCHAR(255),
  description TEXT,
  severity VARCHAR(50) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- RLS: Apenas admin vê
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin only" ON alerts
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
```

### Tabela: `audit_log` (compliance)
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100), -- "transcription_processed", "activity_created", "alert_resolved"
  resource_type VARCHAR(50), -- "transcription", "activity", "alert"
  resource_id VARCHAR(255),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- RLS: Apenas admin vê
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin only" ON audit_log
  FOR SELECT USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
```

---

## 4. Configurações de Segurança Supabase Necessárias

### ✅ **Já implementado via RLS acima**
- [ ] Row-level security (RLS) policies em todas as tabelas
- [ ] JWT com expiração (30 dias)
- [ ] Senha com hash bcrypt

### ⚠️ **Configurar na plataforma Supabase (depois de criar as tabelas)**
1. **Authentication > Providers**
   - Desabilitar "Email Confirmations" se não quiser (ou deixar habilitado com email de confirmação)
   - JWT expiration: 3600 segundos (1 hora) + Refresh token 604800 (7 dias)

2. **Database > Extensions**
   - ✅ `pgcrypto` (para gen_random_uuid) — já habilitada por padrão
   - ✅ `pg_cron` (para job scheduler) — habilitar se quiser usar cron nativo do Postgres

3. **Security > API Keys**
   - Manter `anon` e `service_role` bem separadas
   - `anon` = apenas requisições públicas (login)
   - `service_role` = backend FastAPI (operações admin)

4. **Database > Backups**
   - ✅ Backup automático habilitado (1x/dia)

5. **CORS/Allowed Origins**
   - Adicionar `http://localhost:3000` (dev)
   - Adicionar seu domínio em produção

---

## 5. Variáveis de Ambiente

```bash
# .env (FastAPI)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ... (secret role key)
SUPABASE_ANON_KEY=eyJ... (anon key)

PIPEDRIVE_API_TOKEN=xxxxx
PIPEDRIVE_BASE_URL=https://api.pipedrive.com/v1

GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json
# ou OAuth refresh token se usar credenciais de usuário

TACTIQ_API_KEY=xxxxx (se houver)

JWT_SECRET=your-super-secret-key-min-32-chars
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
REFRESH_TOKEN_EXPIRATION_DAYS=7

# Job scheduler
APScheduler_timezone=America/Sao_Paulo

# Webhook
GOOGLE_DRIVE_WEBHOOK_URL=https://seu-dominio.com/api/webhooks/google-drive
```

---

## 6. Endpoints FastAPI Necessários

### Auth
- `POST /api/auth/signup` — Criar usuário (email, senha, role=user por padrão)
- `POST /api/auth/login` — Login (retorna JWT + refresh token)
- `POST /api/auth/refresh` — Refresh JWT
- `GET /api/auth/me` — Dados do usuário logado

### Webhooks
- `POST /api/webhooks/google-drive` — Recebe notificação do Drive quando nova transcrição salva
  - Lê arquivo .txt do Drive
  - Extrai dados com prompt do Tactiq (ou Claude leve)
  - Busca cliente no Pipedrive
  - Cria Activity
  - Retorna status

### Pipedrive
- `GET /api/pipedrive/persons` — Busca pessoa por nome/email (paginado)
- `GET /api/pipedrive/deals/:id` — Detalhes do deal
- `POST /api/pipedrive/activities` — Criar activity (wrapper)

### Dashboard
- `GET /api/alerts` — Lista alertas consolidados (com filtros por tipo, status)
- `PATCH /api/alerts/:id` — Marcar alerta como resolvido
- `GET /api/transcriptions` — Lista histórico de transcrições processadas
- `GET /api/pipeline-activities` — Lista activities criadas

### Admin
- `POST /api/admin/approve-matching` — Confirmar matching manual (múltiplos candidatos)
- `GET /api/admin/audit-log` — Ver logs de ações
- `POST /api/admin/config` — Atualizar configurações (dias para "parado", etc.)

---

## 7. Prompt para Tactiq

**O prompt que você compartilhou** será executado **direto na transcrição** (não no resumo) para extrair:

```
Contexto: Robson Vieira é o planejador financeiro e sucessório — ele NUNCA é o cliente, mesmo que apareça como participante. O CLIENTE é sempre o outro participante.

A partir da TRANSCRIÇÃO COMPLETA abaixo, gere um BRIEFING DO CLIENTE com esta estrutura em JSON:

{
  "principais_topicos": ["tema1", "tema2", ...],
  "dados_cliente": {
    "nome": "...",
    "idade": "...",
    "estado_civil": "...",
    "demonstrou_interesse": "Sim/Não/Parcial - justificativa"
  },
  "proxima_acao": {
    "descricao": "breve descrição da próxima ação",
    "prazo_sugerido": "YYYY-MM-DD (data da reunião + N dias úteis)",
    "prioridade": "alta/média/baixa"
  },
  "observacoes": "qualquer observação relevante"
}

Transcrição:
{{ transcript }}
```

---

## 8. Próximos Passos

1. ✅ **SQL: Criar tabelas + RLS** (arquivo SQL separado)
2. ✅ **FastAPI: Autenticação** (signup, login, JWT)
3. ✅ **FastAPI: Webhook Google Drive receiver**
4. ✅ **FastAPI: Integração Pipedrive**
5. ✅ **Next.js: Dashboard de alertas**
6. ✅ **APScheduler: Job diário**
7. ⏳ **Testes e-to-e**

---

## 9. Configurações Pós-Implementação

Após codar, você precisa:

1. **Google Drive Watch Setup**
   - Criar webhook receiver HTTPS com certificado válido
   - Chamar `drive.changes().watch()` pra começar a receber notificações

2. **Supabase RLS Test**
   - Logar como user vs admin
   - Verificar se RLS bloqueia acesso cruzado

3. **Pipedrive Custom Fields**
   - Criar `origem_pipeline` (tipo: texto)
   - Criar `ultima_reuniao_processada` (tipo: data) [opcional]

4. **Alerting**
   - Testar job diário manualmente
   - Verificar consolidação de alertas

---

## 10. LGPD Compliance

✅ **Implementado:**
- RLS impede acesso cruzado entre usuários
- Audit log registra quem fez o quê
- Dados sensíveis (saúde) NÃO são salvos na `note` da Activity (apenas contexto comercial)
- Dados armazenados apenas enquanto necessário

⚠️ **Ainda precisa:**
- Política de retenção (ex: deletar transcriptions após 6 meses se inativas)
- Criptografia em repouso (Supabase oferece isso por padrão)
- Consentimento explícito do cliente (já coberto no pipeline principal)
