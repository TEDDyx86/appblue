# PRD — Automação de Pós-Reunião: Tactiq → LLM → Pipedrive

**Versão:** 1.0
**Autor:** Roberto (intern) — para planejador financeiro e sucessório
**Status:** Pronto para desenvolvimento
**Destinado a:** Agente de IA / desenvolvedor responsável pela implementação

---

## 1. Resumo executivo

Sistema que automatiza o fluxo pós-reunião de um planejador financeiro especializado em seguro de vida e planejamento sucessório. Reuniões no Google Meet são transcritas pelo Tactiq; um LLM processa a transcrição e gera saídas estruturadas (resumo, objetivos do cliente, produtos apresentados, objeções, e-mail de follow-up); o sistema então cria automaticamente uma tarefa (Activity) no Pipedrive vinculada ao negócio do cliente, e monitora se essa tarefa teve uma reunião do Microsoft Teams efetivamente agendada, alertando quando isso está pendente.

**Problema que resolve:** hoje o planejador depende de memória e trabalho manual para transformar o conteúdo de uma reunião em ação de follow-up registrada no CRM. Isso causa esquecimentos, atraso em contatos com clientes e falta de histórico organizado.

**Não é objetivo deste sistema:** cotação de seguros (projeto separado, ver `claude_multicotador-seguros-brainstorm.md`), CRM completo, ou substituição do Pipedrive.

---

## 2. Objetivos e métricas de sucesso

| Objetivo | Métrica |
|---|---|
| Eliminar follow-up esquecido | 0 reuniões processadas sem Activity criada no Pipedrive |
| Reduzir tempo de trabalho manual pós-reunião | Redução do tempo entre reunião e follow-up enviado |
| Visibilidade de negócios estagnados | Alerta diário funcionando sem falso-negativo |
| Confirmação de reunião de retorno agendada | Sistema identifica em até 24h se o Teams foi configurado |

---

## 3. Personas

- **Planejador financeiro (usuário final principal):** recebe as tarefas já criadas na sua agenda do Pipedrive/Teams, revisa e-mails de follow-up, confirma/agenda reuniões.
- **Roberto (intern / operador do sistema):** configura, monitora e ajusta o pipeline; primeiro a ver os alertas do dashboard.

---

## 4. Escopo funcional

### 4.1 Módulo 1 — Pipeline de processamento (já validado, não é o foco deste PRD, mas é pré-requisito)
- Input: transcrição do Tactiq (export via webhook/e-mail/API do Tactiq).
- Processamento: LLM (Claude API) usando o prompt template já existente, com 5 saídas: resumo, objetivos financeiros, produtos apresentados, objeções, rascunho de e-mail.
- **Nova saída (6ª) a ser adicionada:** campo estruturado `proxima_acao` contendo:
  - `descricao` (string curta, ex: "Enviar proposta MAG e agendar retorno")
  - `prazo_sugerido` (data, calculada como data da reunião + N dias úteis, configurável)
  - `cliente_identificado` (nome extraído da transcrição, para matching)

### 4.2 Módulo 2 — Criação de Activity no Pipedrive
1. Sistema recebe a saída estruturada do LLM (incluindo `proxima_acao`).
2. Busca na API do Pipedrive (`GET /persons`, `GET /deals`) por correspondência de nome/e-mail do cliente identificado.
3. **Se encontrar candidato único e com alta confiança:** segue para criação automática.
4. **Se encontrar múltiplos candidatos ou nenhum:** envia notificação (Slack/e-mail) para confirmação manual antes de criar a Activity — nunca cria vínculo errado sem revisão humana.
5. Cria a Activity via `POST /activities` com:
   - `subject`: `proxima_acao.descricao`
   - `due_date`: `proxima_acao.prazo_sugerido`
   - `deal_id` ou `person_id`: vinculado ao registro confirmado
   - `note`: contexto resumido da reunião (sem dados de saúde sensíveis — ver seção 7)
   - `type`: `meeting` (ou tipo customizado, ver seção 6.3)
   - **Custom field `origem_pipeline`** = `"tactiq-auto"` (ver seção 6.1)
6. Sistema registra localmente (banco próprio ou apenas nos custom fields do Pipedrive) o estado inicial: `status_teams = "pendente"`.

### 4.3 Módulo 3 — Verificação de reunião do Teams
1. Job agendado (cron diário, horário configurável — sugestão 7h) consulta todas as Activities com `origem_pipeline = "tactiq-auto"` e `status_teams = "pendente"`.
2. Para cada uma, consulta `GET /activities/{id}` e verifica o campo nativo `conference_meeting_url`.
3. **Se `conference_meeting_url` estiver preenchido:** atualiza `status_teams = "confirmado"` internamente, remove do alerta.
4. **Se estiver vazio e `due_date` ainda não passou:** mantém como pendente, sem alerta ainda.
5. **Se estiver vazio e `due_date` já passou ou está a menos de X dias (configurável, sugestão 2 dias):** inclui no alerta diário como "Teams pendente".

> Nota de arquitetura: caso o time queira reduzir a latência de 1 dia do polling, este módulo pode ser convertido para Webhook v2 do Pipedrive (evento `activity.updated`) sem alterar a lógica de negócio — apenas o gatilho muda de "cron" para "evento recebido". Ver seção 9 (fora do escopo do MVP, mas desenhado para permitir essa evolução).

### 4.4 Módulo 4 — Dashboard de alertas diário
Job diário consolida três categorias de alerta e envia para o(s) destino(s) configurado(s) (Slack, e-mail, ou Google Sheet — decidir em conjunto com o planejador antes de codar):

| Categoria | Regra |
|---|---|
| **Negócio parado** | Deal com `status = open` e `update_time` > N dias (configurável, sugestão 15) sem mudança de estágio |
| **Follow-up atrasado** | Activity com `origem_pipeline = tactiq-auto`, `due_date` vencida, `done = false` |
| **Teams pendente** | Activity com `origem_pipeline = tactiq-auto`, `conference_meeting_url` vazio, `due_date` vencida ou a ≤2 dias |

---

## 5. Fluxo de ponta a ponta (diagrama textual)

```
[Reunião Google Meet]
        │
        ▼
[Tactiq transcreve]
        │
        ▼
[LLM processa — 6 saídas estruturadas]
        │
        ├─→ Resumo / objetivos / produtos / objeções / e-mail  → destinos já definidos
        │
        └─→ proxima_acao {descricao, prazo, cliente}
                    │
                    ▼
        [Matching de cliente no Pipedrive]
              │              │
        candidato único   ambíguo/não encontrado
              │              │
              ▼              ▼
      [Cria Activity]   [Notifica p/ confirmação manual]
              │
              ▼
      status_teams = "pendente"
              │
              ▼
   [Job diário verifica conference_meeting_url]
              │
       ┌──────┴──────┐
   preenchido      vazio
       │              │
       ▼              ▼
 status="confirmado" segue pendente → entra no alerta se vencido
              │
              ▼
   [Dashboard diário: 3 categorias de alerta]
   → Slack / E-mail / Sheet
```

---

## 6. Modelo de dados e configuração no Pipedrive

### 6.1 Custom fields a criar (pré-requisito antes de codar)
- **Em Activities:**
  - `origem_pipeline` (tipo: texto ou lista de opção única) — valor fixo `"tactiq-auto"` para toda Activity criada pelo sistema.
- **Em Deals (opcional, mas recomendado):**
  - `ultima_reuniao_processada` (tipo: data) — evita reprocessar a mesma transcrição duas vezes.

### 6.2 Campos nativos utilizados (não precisam ser criados)
- `Activity.due_date`, `Activity.done`, `Activity.subject`, `Activity.note`
- `Activity.conference_meeting_url`, `Activity.conference_meeting_id`, `Activity.conference_meeting_client`
- `Deal.update_time`, `Deal.status`, `Deal.stage_id`

### 6.3 Tipo de Activity
Definir com o planejador se usa o tipo nativo `meeting` ou um tipo customizado (ex: `follow-up-tactiq`) para facilitar filtros visuais dentro do próprio Pipedrive, além do campo `origem_pipeline`.

---

## 7. Requisitos não funcionais

### 7.1 Privacidade e LGPD
- Declaração de saúde é dado sensível (LGPD, art. 5º, II — categoria especial). O campo `note` da Activity **não deve conter** detalhes de saúde do cliente extraídos da reunião — apenas contexto comercial/administrativo (ex: "Discutir proposta de seguro de vida" e não detalhes da condição de saúde declarada).
- Base legal de tratamento: consentimento explícito do cliente do planejador (já coberto no desenho do pipeline principal).
- Retenção mínima necessária; se o sistema mantiver banco próprio (fora do Pipedrive) para status intermediário, aplicar criptografia em repouso.

### 7.2 Segurança
- Token de API do Pipedrive armazenado em variável de ambiente / secret manager, nunca em código versionado.
- Se usar Webhooks (evolução futura), validar a origem das requisições recebidas.

### 7.3 Confiabilidade
- Nenhuma Activity deve ser criada sem confirmação de vínculo correto ao cliente (ver 4.2, passo 3-4) — prioridade sobre velocidade.
- Job diário deve ter alerta próprio de falha (ex: se o cron não rodar, alguém precisa saber).

### 7.4 Limites da API
- Verificar rate limit do plano Pipedrive contratado antes de definir frequência de polling (uso de um único escritório deve ficar bem abaixo do limite, mas validar).

---

## 8. Fora de escopo (explicitamente, para não gerar scope creep)

- Criação automática do link de reunião do Teams (isso continua sendo uma ação manual do planejador dentro do Pipedrive — o sistema só **verifica** se foi feita, não faz por ele nesta versão).
- Integração com Microsoft Graph API para criar eventos diretamente no Teams (avaliar como fase futura separada, ver seção 9).
- Multi-tenant / produto SaaS para outros corretores — este é uso interno do escritório.
- Cotação de seguros (projeto separado).
- CRM próprio — o Pipedrive continua sendo a fonte de verdade.

---

## 9. Evoluções futuras (não implementar agora, apenas documentar)

1. **Webhooks em vez de polling** para reduzir latência de detecção do Teams de até 24h para tempo real.
2. **Criação automática do evento no Teams via Microsoft Graph API**, eliminando o passo manual — motivaria mudar o Módulo 3 de "verificação" para "criação direta".
3. **MCP (Model Context Protocol)** como camada de integração mais avançada entre LLM e Pipedrive, quando o pipeline básico estiver validado em produção.

---

## 10. Plataforma de automação

A decisão entre Zapier, Make, n8n ou script Python customizado é independente deste PRD funcional — todas as opções têm conector nativo para Pipedrive. Critérios de decisão (retomar do brainstorm anterior):
- **Zapier:** mais rápido para MVP, gatilho nativo do Tactiq.
- **Make:** melhor para lógica condicional (útil no matching de cliente ambíguo, seção 4.2).
- **n8n:** self-hosted, melhor controle de privacidade — relevante dado o volume de dado sensível (seção 7.1).
- **Python customizado:** máxima flexibilidade, mais esforço de manutenção.

**Recomendação para este projeto:** dado o volume de dados sensíveis (saúde/financeiro) tratados no pipeline como um todo, priorizar n8n (self-hosted) ou script Python customizado sobre Zapier/Make (SaaS de terceiros), salvo decisão em contrário do responsável pelos dados.

---

## 11. Critérios de aceite (para o agente validar a implementação)

- [ ] Ao processar uma transcrição de teste, o sistema gera a 6ª saída (`proxima_acao`) corretamente estruturada.
- [ ] Sistema identifica corretamente um cliente já existente no Pipedrive por nome/e-mail em pelo menos 90% dos casos de teste.
- [ ] Quando o matching é ambíguo, o sistema **não** cria a Activity automaticamente — envia para confirmação.
- [ ] Activity criada contém todos os campos da seção 4.2, incluindo `origem_pipeline = "tactiq-auto"`.
- [ ] Job diário identifica corretamente Activities com `conference_meeting_url` vazio vs. preenchido (testar manualmente criando uma reunião Teams em uma activity de teste).
- [ ] Dashboard diário gera as 3 categorias de alerta sem falso positivo em ambiente de teste.
- [ ] Nenhum dado de saúde do cliente aparece no campo `note` da Activity (revisão manual de amostra).
- [ ] Token de API não aparece em nenhum arquivo versionado no controle de código.

---

## 12. Perguntas em aberto (validar com o planejador antes de codar)

1. Qual o valor de N dias para considerar um negócio "parado" (sugestão inicial: 15)?
2. Qual o destino preferido do dashboard diário: Slack, e-mail ou planilha?
3. Confirma o uso de `type: meeting` nativo ou prefere um tipo de Activity customizado no Pipedrive?
4. Quantos dias úteis após a reunião deve ser o prazo padrão sugerido para o follow-up?
5. Quem deve receber a notificação de matching ambíguo (o próprio planejador, o Roberto, ou os dois)?
