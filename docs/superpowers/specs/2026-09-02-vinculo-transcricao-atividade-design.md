# Design — Vínculo automático da transcrição com a atividade do Pipedrive

**Data:** 2026-09-02
**Status:** aprovado, não implementado

## O que muda

Hoje, ao processar uma transcrição, o sistema **cria** uma atividade nova e uma
*Note* separada no negócio. Passa a **encontrar a atividade que já existe** —
a reunião que estava agendada na agenda —, anexar o briefing nela e marcá-la
como concluída.

A reunião no CRM deixa de ser só um compromisso e passa a ser o registro do que
aconteceu nela.

## Viabilidade verificada na API

Testado contra a conta real (atividade 7125, negócio 626):

```
PUT /activities/7125  {"note": html}   -> 200, success=true, 4089 chars gravados
PUT /activities/7125  {"done": true}   -> 200, done=True, marked_as_done_time preenchido
```

A nota sobreviveu à mudança de status. Estrutura HTML preservada integralmente:
4 `<h4>`, 4 `<ul>`, 27 `<li>`, 10 `<strong>`, acentos e emojis.

**O Pipedrive sanitiza o HTML:** remove `style=` e `target=`, adiciona
`rel='noopener noreferrer'`, escapa `&` para `&amp;` e normaliza `<br/>` para
`<br>`. Estrutura semântica passa; formatação inline não. O
`style='color: #0092FF'` que `generate_pipedrive_briefing_html()` aplica hoje no
link do Tactiq é descartado — código sem efeito, vale remover.

## A regra de vínculo

```
1. Nome do cliente vem de briefing_json.dados_cliente.nome
2. Busca o negócio:  GET /v1/deals/search?term=<primeiro nome>
3. Compatibilidade do nome com o título do negócio >= 0.90
4. Atividade do negócio com tipo R1 (meeting), R2 (reuniao_2) ou R3 (r3)
5. due_date dentro de ±1 dia da data da reunião
6. Exatamente uma candidata -> vincula
   Zero ou mais de uma      -> não vinculado, com motivo
```

Ao vincular: grava o briefing em `note` e, **se `done` for `false`, marca
`true`**. Atividade já concluída tem só a nota anexada — não se reescreve status
que já está correto.

### Duas premissas descartadas por medição

**"Atividade em aberto" não funciona.** As reuniões são marcadas como concluídas
logo após acontecerem; quando a transcrição chega, já estão fechadas:

```
Natália  R1  01/09  done=True     Leandro  R2  31/08  done=True
Joelson  R3  31/08  done=True     Tiago    R2  01/09  done=True
```

Exigir `done=false` derruba o vínculo para **0%**. Por isso o critério é a data,
não o status.

**A data também desempata.** O negócio do Joelson tem três reuniões (18/08,
21/08, 31/08). Sem a data não há como saber qual delas a transcrição documenta.

### Por que ±1 dia

Medido com 0, 1 e 2 dias de tolerância: **resultado idêntico nos três**, e
nenhuma candidata múltipla em nenhum deles. A atividade está sempre na data
exata, porque nasce do compromisso agendado.

A tolerância não ganha nada hoje e não custa nada. Fica como rede para reunião
que atravessa a meia-noite ou é remarcada no mesmo dia.

### Por que o limiar de 0.90

É o que separa cliente de homônimo. Os melhores palpites abaixo do corte, nos
dados reais:

```
"Mariana Vicário"     -> "Sérgio Bressan"    (0.28)
"Sérgio Paulo Araujo" -> "Sérgio Bressan"    (0.48)
"Adilson Schelbauer"  -> "Radilson Carlos"   (0.55)
"Eduardo Magalhaes"   -> "Eduardo Camara"    (0.71)
```

São pessoas diferentes. Com limiar frouxo, o briefing da Mariana iria para o
negócio do Sérgio.

O custo do corte é perder apelidos: `"Fred Candian"` →
`"Frederico Jacob Candian"` (0.69) é um acerto real que cai em revisão. Aceitável
— vínculo errado é pior que vínculo ausente.

A comparação normaliza acento e caixa, e trata nome parcial: `"Márcio"` casa com
`"Márcio Paes"` por contenção.

## Resultado medido

15 transcrições reais:

| | |
|---|---|
| **Vínculo automático** | **5 (33%)** |
| Compatibilidade de nome baixa | 5 |
| Negócio sem R1/R2/R3 na data | 4 |
| Sem negócio no CRM | 1 |
| **Vínculos errados** | **0** |

Os cinco acertos conferidos um a um: Natália→7125 R1, Henrique→7984 R2,
Tiago→8042 R2, Leandro→7750 R2, Joelson→7784 R3.

## Não vinculado: motivo obrigatório

Toda falha registra **por que** falhou, com a evidência que levou à decisão.
Sem isso não há como melhorar a regra.

| Código | Quando | Evidência guardada |
|---|---|---|
| `SEM_NOME_CLIENTE` | transcrição não identificou o cliente | título da reunião |
| `NEGOCIO_NAO_ENCONTRADO` | busca não retornou nada | termo buscado |
| `COMPATIBILIDADE_BAIXA` | melhor candidato < 0.90 | nome buscado, título do melhor candidato, score |
| `SEM_ATIVIDADE_NA_DATA` | negócio ok, sem R1/R2/R3 na janela | negócio, data procurada, datas das reuniões existentes |
| `MULTIPLAS_CANDIDATAS` | mais de uma na janela | ids e datas das candidatas |
| `ERRO_PIPEDRIVE` | API falhou | status e mensagem |

Gravado em dois lugares:

- **`briefing_json.vinculo`** — estado atual, para a tela ler
- **`audit_log`** — histórico, via `log_audit_event`, com as ações
  `TRANSCRIPTION_LINKED` e `TRANSCRIPTION_LINK_FAILED`

```json
"vinculo": {
  "status": "nao_vinculado",
  "motivo": "COMPATIBILIDADE_BAIXA",
  "detalhe": {
    "nome_buscado": "Mariana Vicário",
    "melhor_candidato": "Sérgio Bressan",
    "score": 0.28,
    "limiar": 0.90
  },
  "avaliado_em": "2026-09-02T19:40:00Z"
}
```

O `detalhe` é a parte que importa para o objetivo de melhorar a regra: ele mostra
o quase-acerto. Ver `"Fred Candian" → "Frederico Jacob Candian" (0.69)` repetido
várias vezes é o que revela que apelidos precisam de tratamento.

## Interface

Botão novo no card da transcrição, ao lado de **Vincular** e **Ignorar**, que só
aparece quando `vinculo.status == "nao_vinculado"`.

Rótulo: **"Por que não vinculou?"**. Abre um painel com o motivo em texto claro e
a evidência:

```
Não foi possível vincular automaticamente

Motivo: nome pouco compatível com o negócio

Buscamos por         Mariana Vicário
Melhor correspondência  Sérgio Bressan
Compatibilidade      28%  (mínimo exigido: 90%)

São clientes diferentes — vincular teria colocado este briefing
no negócio errado.

[ Vincular manualmente ]
```

O botão de vincular manualmente reaproveita o modal que já existe.

Um filtro "Não vinculadas" entra nas pills de `crmFilter` que a página já tem.

## Implementação

### Backend (`backend/main.py`)

- `compatibilidade_nome(a, b) -> float` — normaliza acento/caixa, trata nome
  parcial por contenção, cai em `SequenceMatcher`
- `encontrar_atividade_da_reuniao(nome, data) -> (atividade | None, motivo, detalhe)`
- `vincular_transcricao(transcription_id)` — orquestra: encontra, anexa briefing,
  marca `done` se `false`, grava `vinculo` e registra no `audit_log`
- `GET /api/transcriptions/{id}/vinculo` — devolve motivo e evidência

Reaproveita `update_pipedrive_activity()`, que existe desde antes e nunca foi
chamada.

**Atenção ao path:** `/v1/persons/search` e `/v1/deals/search` funcionam, mas
`/api/v1/persons/search` devolve **404 Unknown method**. A base do caminho é
inconsistente entre endpoints do Pipedrive.

### Frontend

- `src/app/transcriptions/page.tsx` — botão e pill de filtro
- `src/components/MotivoVinculo.tsx` — painel do motivo

## Fora de escopo

- Criar pessoa ou negócio automaticamente
- Aceitar tipos `teams` e `outlook` como reunião (o R1 do Pedro Freitas está
  como `teams`; é dívida do passado, não regra futura)
- Remover a *Note* separada que o fluxo atual cria — decidir depois, à luz do
  resultado
- Reprocessar as transcrições históricas
