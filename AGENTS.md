# 🛡️ Diretrizes Globais do Projeto e Memória do Agente

## 1. POLÍTICA DE INTEGRIDADE DA AGENDA E CRM (PIPEDRIVE) - REGRA CRÍTICA

1. **Cuidado com a Agenda e Dados de Produção**:
   - Nunca criar, editar ou excluir atividades, clientes, notas ou negócios no Pipedrive sem necessidade estrita.
   - Qualquer teste automatizado de API que crie dados fictícios deve limpar/excluir o item imediatamente após a asserção.

2. **Transparência Obrigatória nas Respostas**:
   - Caso qualquer requisição de teste ou script toque no Pipedrive (atividades, clientes, negócios ou notas), o agente **DEVE SEMPRE** informar detalhadamente na resposta final:
     - Qual requisição/teste foi realizado;
     - Os IDs dos registros criados/modificados/excluídos;
     - A confirmação de que os dados temporários foram devidamente limpos ou o estado exato em que ficaram.

---

## 2. REGRAS TÉCNICAS DO PROJETO

* **Fuso Horário do Pipedrive**:
  - A API do Pipedrive armazena `due_time` em UTC.
  - Como o usuário opera em **Brasília (UTC-3)**, toda gravação de horário enviada pelo backend deve ser convertida para UTC (`+3 horas`) para que na interface do Pipedrive o horário apareça exatamente no horário local pretendido.
  - Ao ler atividades do Pipedrive para verificar ocupações livres, converter `due_time` de UTC para horário local (`-3 horas`).

* **Endpoints de Atividades e Notas**:
  - Atividades e Notas do Pipedrive devem usar estritamente a API **v1** (`https://api.pipedrive.com/v1/activities` e `https://api.pipedrive.com/v1/notes`). Endpoints v2 retornam erro 405.
  - Para participantes em atividades: usar `primary_flag: True` e `person_id`.

* **Tags de Atividade**:
  - `meeting` = R1
  - `reuniao_2` = R2
  - `r3` = R3
  - `tactiq` = Transcrições Tactiq
