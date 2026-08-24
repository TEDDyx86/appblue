# Automação Tactiq → Google Drive → Pipedrive

Sistema de automação pós-reunião que processa transcrições do Tactiq, extrai insights com IA e cria Activities no Pipedrive.

## 🎯 Visão Geral

Este sistema automatiza o fluxo pós-reunião de um planejador financeiro especializado em seguro de vida e planejamento sucessório.

**Fluxo:**
```
Reunião Google Meet → Tactiq transcreve → Google Drive → Webhook → 
FastAPI processa → Matching no Pipedrive → Activity criada → Alertas no Dashboard
```

## 📁 Estrutura do Projeto

```
Projeto Robson/
├── backend/
│   ├── main.py              # FastAPI app
│   ├── requirements.txt     # Dependências Python
│   └── .env.example         # Variáveis de ambiente
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/   # Página principal
│   │   │   ├── login/       # Autenticação
│   │   ├── components/      # Componentes React
│   ├── package.json
│   └── .env.example
├── schema.sql               # Schema Supabase + RLS
├── ARQUITETURA-TACITQ-PIPEDRIVE.md
└── PRD-automacao-tactiq-pipedrive.md
```

## 🚀 Setup Rápido

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute o arquivo `schema.sql`
3. Copie as credenciais:
   - Settings → API → URL (`SUPABASE_URL`)
   - Settings → API → service_role (`SUPABASE_SERVICE_ROLE_KEY`)
   - Settings → API → anon (`SUPABASE_ANON_KEY`)

**Configurações adicionais no Supabase:**
- Authentication → Providers → Email: Desabilitar "Email Confirmations" (opcional)
- Authentication → JWT: Expiration = 3600 seg
- Database → Extensions: Habilitar `pg_cron` (para jobs agendados)

### 2. Google Drive

1. Crie uma conta de serviço no Google Cloud Console
2. Baixe o JSON de credenciais
3. Salve em local seguro
4. Compartilhe a pasta "Tactiq Transcription" com o email da conta de serviço

### 3. Pipedrive

1. Vá em Settings → API → Copie o token
2. Configure Custom Fields em Activities:
   - `origem_pipeline` (texto): valor "tactiq-auto"

### 4. Backend (FastAPI)

```bash
cd backend

# Criar venv
python -m venv venv
source venv/bin/activate  # Linux/Mac
# ou
.\venv\Scripts\activate   # Windows

# Instalar dependências
pip install -r requirements.txt

# Configurar ambiente
cp .env.example .env
# Edite .env com suas credenciais

# Rodar
uvicorn main:app --reload --port 8000
```

### 5. Frontend (Next.js)

```bash
cd frontend

# Instalar dependências
npm install

# Configurar ambiente
cp .env.example .env.local
# Edite .env.local com a URL do backend

# Rodar
npm run dev
```

Acesse: http://localhost:3000

## 🔐 Segurança

### RLS (Row Level Security)

O schema Supabase inclui RLS policies que:
- ✅ Usuários veem apenas seus próprios dados
- ✅ Admins têm acesso total
- ✅ Tokens JWT com expiração
- ✅ Senhas com bcrypt hash

### Variáveis Sensíveis

**NUNCA** commite:
- `.env` files
- `service-account.json` do Google
- Tokens de API

## 📊 Dashboard

O dashboard exibe 3 tipos de alertas:

| Alerta | Descrição | Cor |
|--------|-----------|-----|
| **Negócio Parado** | Deal sem atualização > 15 dias | Vermelho |
| **Follow-up Atrasado** | Activity vencida sem conclusão | Amarelo |
| **Teams Pendente** | Activity sem link Teams configurado | Azul |

## 🔧 Endpoints API

### Autenticação
- `POST /api/auth/signup` - Criar usuário
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/me` - Dados do usuário

### Webhooks
- `POST /api/webhooks/google-drive` - Recebe notificação do Drive

### Alertas
- `GET /api/alerts` - Lista alertas
- `PATCH /api/alerts/{id}` - Resolver alerta

### Transcrições
- `GET /api/transcriptions` - Lista histórico

## 🧪 Testes

```bash
# Backend
cd backend
pytest

# Frontend
cd frontend
npm test
```

## 📝 Próximos Passos

- [ ] Implementar prompt Tactiq para extração de dados
- [ ] Configurar webhook Google Drive Watch
- [ ] Job diário para consolidação de alertas
- [ ] Integrar com Microsoft Teams API (futuro)
- [ ] Dashboard mobile responsivo

## 📚 Documentação

- [PRD Completo](./PRD-automacao-tactiq-pipedrive.md)
- [Arquitetura Detalhada](./ARQUITETURA-TACITQ-PIPEDRIVE.md)

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit (`git commit -m 'Add nova funcionalidade'`)
4. Push (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## 📄 Licença

Projeto interno - Blue3 Investimentos
