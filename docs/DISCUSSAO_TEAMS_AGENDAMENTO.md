# 📋 Registro de Discussão: Integração Microsoft Teams & Módulo Agendar

Este documento reúne todas as análises técnicas, opções e comportamentos mapeados para a geração de links de reunião do Microsoft Teams no sistema de agendamento (`/agendar`).

---

## 1. Contexto Atual
* **Módulo Agendar (`/agendar`)**:
  * Horários livres calculados em tempo real cruzando grade de horários com ocupações reais do Pipedrive (`/v1/activities`).
  * Atividades criadas no Pipedrive em aberto com tags dinâmicas (`R1`, `R2`, `R3`), vinculadas à Pessoa do cliente e à Organização do Assessor selecionado.
* **Microsoft Teams no Pipedrive**:
  * A API REST v1 do Pipedrive suporta os campos `conference_meeting_client: "teams"`, `conference_meeting_url` e `attendees`.
  * Porém, a API do Pipedrive **não** gera links de reunião do Teams dinamicamente por conta própria sem que a URL seja enviada na criação.

---

## 2. Opções Avaliadas para Geração do Link do Teams

### **Opção 1: Link de Sala Fixa / Permanente do Teams (Recomendada)**
* **Como funciona**:
  * O Robson gera um link de reunião permanente no seu aplicativo do Teams (via *"Reunir Agora"* ou criando um evento permanente no calendário).
  * O link é configurado nas variáveis/configurações da agenda (`calendar_settings`).
  * Toda nova reunião criada pelo `/agendar` já recebe automaticamente esse link no `conference_meeting_url`, `location` e nas notas da atividade.
* **Vantagens**:
  * Não depende de permissões de administrador do Azure / Microsoft Graph API.
  * Implementação imediata e zero atrito.
  * O botão azul *"Entrar na reunião"* aparece normalmente no Pipedrive.
* **Cuidados**:
  * **Lobby / Sala de Espera**: Clientes externos sempre caem na sala de espera do Teams e o organizador precisa clicar em "Admitir" para liberar a entrada (evitando que um cliente entre na reunião de outro).
  * **Chat**: Evitar compartilhamento de dados sensíveis no chat de texto da sala fixa, pois o histórico pode ser visível entre sessões no Teams.

---

### **Opção 2: Geração Dinâmica via Microsoft Graph API (Link Único por Reunião)**
* **Como funciona**:
  * Criação de um App no portal Microsoft Azure com permissões para chamar `POST /v1.0/me/onlineMeetings`.
  * A cada novo agendamento, o backend do app conecta na API da Microsoft, cria uma sala nova e única, e salva a URL retornada no Pipedrive.
* **Status**:
  * Requer credenciais de API / permissão corporativa de administrador do Microsoft 365 / Azure.
  * Deixado em espera para quando houver liberação de permissões de TI.

---

## 3. Comportamento do Tactiq com Link Fixo
* **Gravação por Sessão**: O Tactiq inicia uma nova gravação do zero a cada atendimento e encerra ao fechar a chamada.
* **Arquivos Separados**: Cada reunião gera seu próprio arquivo `.docx` independente no Google Drive com data, hora e resumo exclusivos.
* **Sem Conflito**: O fato de usar o mesmo link de sala do Teams não afeta o processamento das transcrições ou geração de notas no CRM.

---

## 4. Próximos Passos para Retomar a Discussão
1. Obter o link da sala fixa do Microsoft Teams para cadastro no sistema.
2. Definir se o link da sala ficará visível na tela de configurações da agenda para edição pelo próprio Robson.
3. Se a empresa liberar permissões de API da Microsoft no futuro, avaliar a transição para links 100% dinâmicos via Microsoft Graph API.
