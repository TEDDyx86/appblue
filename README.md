# Blue3 Advisory Hub 🚀

> **Plataforma de Gestão Operacional, Inteligência de Atendimentos e Integração de CRM**  
> Desenvolvida para apoiar o planejamento financeiro e sucessório, unificando inteligência artificial, automação de transcrições e gestão de relacionamento.

---

## 📌 Visão Geral

O **Blue3 Advisory Hub** centraliza e automatiza a rotina operacional de atendimentos patrimoniais. A plataforma conecta reuniões realizadas com clientes e assessores, processa briefings através de Inteligência Artificial e sincroniza registros estratégicos diretamente no **Pipedrive CRM**, garantindo controle de funil e follow-up contínuo.

---

## 🎯 Principais Funcionalidades

### 📊 1. Painel Operacional & Gestão do Funil Comercial
* Acompanhamento em tempo real dos negócios ativos no Funil Comercial do CRM.
* Monitoramento de estagnação e alertas proativos para oportunidades sem contato recente.
* Métricas consolidadas de volume financeiro sob assessoria e negócios em andamento.

### 🎙️ 2. Inteligência de Reuniões & Transcrições
* Leitura e processamento automatizado de atas e transcrições de reuniões do Google Drive.
* Extração estruturada de dados via IA: perfil do cliente, interesse demonstrado, principais tópicos abordados e próxima ação recomendada.
* Vinculação direta ao Pipedrive com geração de anotações ricas na linha do tempo do contato e do negócio.

### 📅 3. Agenda de Atendimentos & Coordenação com Assessores
* Calendário cronológico das atividades em aberto no CRM, agrupadas por assessor e data.
* Filtros por período (*Esta Semana, Próxima Semana, Este Mês, etc.*) e seletores rápidos por assessor.
* Geração em 1-clique de resumos formatados para alinhamento rápido via WhatsApp.

### ⏱️ 4. Portal de Autoagendamento
* Página pública para clientes e parceiros agendarem reuniões nos horários disponíveis.
* Regras configuráveis de jornada de trabalho, intervalo de respiro (*buffer*) e antecedência mínima.

### 🛡️ 5. Trilha de Auditoria & Governança
* Registro cronológico e detalhado de todas as sincronizações, vínculos e atualizações realizadas.
* Autenticação segura baseada em JWT com controle de acesso para administradores.

---

## 🛠️ Tecnologias Utilizadas

* **Frontend:** [Next.js](https://nextjs.org/) (App Router), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), [Lucide React](https://lucide.dev/)
* **Backend:** [FastAPI](https://fastapi.tiangolo.com/), [Python](https://www.python.org/), [Pydantic](https://docs.pydantic.dev/), [HTTPX](https://www.python-httpx.org/)
* **Banco de Dados & Auth:** [Supabase](https://supabase.com/) (PostgreSQL com RLS & JWT)
* **Inteligência Artificial:** [Google Gemini](https://ai.google.dev/)
* **Integrações Externas:** [Pipedrive CRM API](https://developers.pipedrive.com/), [Google Workspace API](https://developers.google.com/drive)

---

## 📂 Estrutura da Aplicação

```
appblue/
├── backend/
│   ├── main.py              # API FastAPI, rotas de integração e regras de negócio
│   ├── requirements.txt     # Dependências Python
│   └── .env.example         # Exemplo de configuração de ambiente
├── frontend/
│   ├── src/
│   │   ├── app/             # Rotas e páginas da aplicação (Next.js App Router)
│   │   │   ├── agenda/      # Gestão de atividades e calendário por assessor
│   │   │   ├── agendar/     # Portal público de autoagendamento
│   │   │   ├── alerts/      # Gestão e resolução de alertas operacionais
│   │   │   ├── dashboard/   # Visão geral de métricas e negócios do funil
│   │   │   ├── logs/        # Histórico de auditoria e sincronização
│   │   │   └── transcriptions/ # Processamento de reuniões e briefings
│   │   ├── components/      # Componentes compartilhados e navegação
│   │   └── context/         # Gerenciamento de estado global e temas
│   ├── package.json         # Dependências do frontend
│   └── tailwind.config.ts   # Configuração de design system e tokens de cores
└── schema.sql               # Estrutura das tabelas relacionais e políticas RLS
```

---

## 🔒 Segurança e Privacidade

* Todas as operações de dados respeitam políticas de **Row Level Security (RLS)** no PostgreSQL.
* Tokens de autenticação assinados com expiração configurável.
* Credenciais de serviços externos armazenadas exclusivamente em variáveis de ambiente protegidas.

---

<p align="center">
  <sub>Blue3 Investimentos &bull; Plataforma de Uso Interno</sub>
</p>
