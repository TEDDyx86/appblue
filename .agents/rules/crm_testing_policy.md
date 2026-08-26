# Política Obrigatória de Testes no CRM & Transparência da Agenda

## Regras Fundamentais:
1. **Evitar Poluição da Agenda Real**:
   - Não criar atividades fictícias no Pipedrive a menos que seja para testar uma correção específica.
   - Qualquer item criado para teste deve ser deletado na mesma execução.

2. **Relatório Obrigatório em Cada Resposta**:
   - Se qualquer chamada à API do Pipedrive (criação, edição, deleção) for feita durante o atendimento, deve ser explicitamente listada no final da mensagem com:
     - Tipo de item (Atividade, Pessoa, Nota, Negócio);
     - ID do item;
     - Ação realizada e confirmação de exclusão/limpeza.
