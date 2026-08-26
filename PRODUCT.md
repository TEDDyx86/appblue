# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Usuário Primário**: Robson Vieira Tavernard (`robson.vieira@email.com`), Planejador Financeiro e Sucessório (`investimentosblue.pipedrive.com`). Ele conduz reuniões com clientes de alta renda (HNW), realiza diagnósticos patrimoniais, estrutura estratégias de proteção e sucessão familiar e acompanha a evolução de apólices e carteiras.
- **Usuários Secundários**: Equipe de assessoria, backoffice e administração técnica do sistema (Roberto Righetti).

## Product Purpose

Eliminar o trabalho manual de pós-reunião e organizar o fluxo de planejamento patrimonial de ponta a ponta:
1. **Automação Pós-Reunião**: Processar automaticamente reuniões gravadas no Tactiq e exportadas no Google Drive, extrair dados do cliente, notas executivas e próximas ações, e registrar tudo no CRM Pipedrive em segundos.
2. **Agenda & Bookings Integrada**: Oferecer um agendador de reuniões estilo Calendly / Microsoft Bookings que verifica em tempo real os horários livres no Pipedrive (respeitando expediente, almoço e buffers) e permite marcar novas reuniões vinculadas ao CRM.
3. **Monitor Inteligente de Alertas**: Rastrear proativamente negócios parados há mais de 15 dias, follow-ups atrasados e reuniões próximas sem link do Microsoft Teams configurado.

## Positioning

A plataforma é o "cockpit executivo e motor de automação" dedicado ao planejador financeiro. Ao contrário de CRMs genéricos ou ferramentas isoladas de agendamento, ela conecta de forma nativa e sem atrito a tríade **Tactiq (transcrição/IA) ↔ Google Drive ↔ Pipedrive CRM (atividades e negócios)**, garantindo que nenhuma informação de reunião se perca e que todas as tarefas de follow-up sejam executadas no prazo.

## Operating Context

- **Ambiente de Trabalho**: Rotina diária de planejamento financeiro, atendimentos presenciais e remotos (Microsoft Teams e Google Meet).
- **Ferramentas Conectadas**:
  - **Tactiq**: Gera transcrições ao vivo e briefings estruturados com IA salvos automaticamente no Google Drive (pasta `Briefing - Tactiq`).
  - **Google Drive**: Armazenamento em nuvem dos documentos originais via Service Account.
  - **Pipedrive CRM**: Gerenciamento de Pessoas, Negócios (Deals) e Atividades de Reunião/Follow-up.
  - **Microsoft Teams & Outlook**: Calendário e salas virtuais sincronizados via Pipedrive Calendar Sync.

## Capabilities and Constraints

- **Capacidades Confirmadas**:
  - Leitura e sincronização automática/manual de briefings do Tactiq no Google Drive.
  - Extração precisa de entidades: Nome do cliente (ignorando Robson Vieira), dados cadastrais/patrimoniais, tópicos centrais e ações recomendadas com prazo (+3 dias úteis).
  - Matching automático e busca de clientes e negócios abertos na API v2 do Pipedrive.
  - Criação automática de Activities no Pipedrive com atalhos de 1 clique para `Google Drive`, `Tactiq`, `Pessoa` e `Deal`.
  - Agendador de reuniões interativo com cálculo de disponibilidade livre (estilo Calendly/Bookings) e bloqueio de horários ocupados.
  - Painel de configuração de agenda com geração de links e código embed (`<iframe>`).
  - Central de alertas com severidades (Alta, Média, Baixa) e resolução rápida.
  - Autenticação e segurança JWT obrigatória em todos os endpoints e páginas sensíveis.
- **Restrições**:
  - Robson Vieira Tavernard é sempre o planejador responsável e nunca o cliente.
  - Não há necessidade de chamadas externas a LLMs pagas durante o processamento, pois o Tactiq já gera os briefings estruturados via prompt interno no Google Drive.

## Brand Commitments

- **Identidade Corporativa**: Robson Tavernard / Planejamento Financeiro e Sucessório.
- **Tom de Voz**: Profissional, executivo, discreto, confiável e de alta precisão.
- **Paleta e Estética**: Tons sóbrios e tecnológicos (Slate escuro/grafite, Teal/Esmeralda para ações e sucesso, Sky/Azul corporativo para CRM e badges informativas).

## Evidence on Hand

- Documentos de arquitetura e PRD: `PRD-automacao-tactiq-pipedrive.md` e `ARQUITETURA-TACITQ-PIPEDRIVE.md`.
- Conexões e credenciais validadas: Google Drive Service Account, Supabase PostgreSQL e API Token do Pipedrive CRM.
- Base real com 18 documentos de reuniões reais do Google Drive e atividades ativas criadas no Pipedrive.

## Product Principles

1. **Ação em 1 Clique**: Todo registro de reunião deve oferecer atalhos diretos para o Pipedrive, o documento original e a gravação, sem navegação desnecessária.
2. **Zero Atrito & Zero Perda**: Toda reunião gravada pelo Tactiq deve ter seu briefing e próximas ações refletidos fielmente no CRM sem depender de digitação manual.
3. **Disponibilidade Real**: O agendador só apresenta horários genuinamente livres, prevenindo conflitos de agenda e respeitando o tempo do planejador.
4. **Segurança por Padrão**: Acesso protegido por autenticação robusta em todas as rotas operacionais e administrativas.
