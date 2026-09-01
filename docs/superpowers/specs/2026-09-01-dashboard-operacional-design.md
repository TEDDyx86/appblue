# Design — Dashboard operacional

**Data:** 2026-09-01
**Status:** aprovado, em implementação

## Problema

O dashboard respondia "quanto tenho no funil". O uso real é outro: "quem eu preciso
procurar hoje". Além disso, os números estavam errados.

### Bug de paginação (causa raiz dos "cards incorretos")

`fetch_comercial_pipeline_data()` busca negócios com `limit: 100` e **não pagina**
(`backend/main.py:1800`). Medido contra a conta real:

| | Dashboard | Real |
|---|---|---|
| Negócios abertos | 100 | **242** |
| Volume em pipeline | R$ 2.578.543 | R$ 6.160.932 |

58% do funil invisível. Como `stages_breakdown`, `stagnant_deals` e `overdue_deals`
derivam do mesmo `raw_deals` truncado, **todos** os cards herdavam o erro — e
`22 parados + 78 follow-ups = 100` era o teto, não a soma real.

O bug também contamina qualquer card novo construído sobre a lista de negócios,
então a correção é pré-requisito, não item de escopo separado.

## Levantamento dos dados

Feito por sondagem somente-leitura contra a conta real, antes de desenhar.

| Dado | Situação | Veredito |
|---|---|---|
| Motivo de perda | 232 negócios perdidos, **100% preenchidos** | pronto |
| Follow-up vencido | **180 de 242** abertos (74%) | pronto |
| Sem nenhuma atividade | 24 de 242 (9%) | pronto |
| Data de Nascimento | **24 de 456 pessoas (5%)** | frágil — exibir com aviso |
| Data de Emissão da Apólice | 25 de 81 ganhos (30%), nada após 10/03/2025 | **inviável** |

### Renovação: fora de escopo

Não existe campo de renovação. O mais próximo, "Data de Emissão da Apólice", foi
abandonado há 18 meses, e mesmo os 25 registros preenchidos já passaram do ciclo
de 12 meses — **zero** renovações cairiam nos próximos 90 dias. Um card hoje
mostraria vazio permanente. Volta à mesa quando o campo voltar a ser preenchido.

### Aniversários: incluído com ressalva explícita

Com 5% de preenchimento, o card mostra ~2 aniversariantes/mês quando o esperado
seriam ~38. O risco é dar falsa sensação de cobertura. O usuário optou por
incluir mesmo assim, **desde que a limitação apareça na tela** — não só na
documentação. O card exibe permanentemente a cobertura real ("24 de 456
cadastradas").

## O que sai da tela

- Volume em Pipeline (o usuário não quer ver valor de funil)
- Distribuição de Negócios por Etapa
- Filtros de severidade e de tipo dos alertas ("filtros sem sentido")
- Card "Teams Pendentes" (permanentemente zerado)

## O que fica

Três números no topo, todos operacionais e recalculados sobre os 242 reais:

1. **Follow-ups vencidos** — hoje mostra 78, o real é 180
2. **Negócios parados** — sem atualização há mais de 15 dias
3. **Sem próximo passo** — 24 negócios sem nenhuma atividade agendada

## Blocos novos

### 1. Fila de recuperação (principal)

Lista nominal dos **84** negócios perdidos que não rejeitaram o produto:

- 68 · "Não consegui contato"
- 16 · "Não é o momento (Compra de imóvel, por exemplo)"

Colunas: cliente, valor, motivo, data da perda, link para o Pipedrive. É lista de
trabalho, não gráfico.

### 2. Motivos de perda

Distribuição dos 232 perdidos, ordenada por volume, com os recuperáveis marcados.
Leitura estratégica: 35% não querem seguro, 29% é falha de contato.

### 3. Aniversariantes do mês

Nome, dia e link. Com o aviso de cobertura fixo no card.

## Implementação

### Backend (`backend/main.py`)

- `paginar_pipedrive()` — helper que percorre `more_items_in_collection`.
- `fetch_comercial_pipeline_data()` — passa a usar o helper.
- `fetch_lost_deals_data()` — perdidos agrupados por motivo + fila de recuperação.
- `fetch_birthdays_data()` — aniversariantes do mês + cobertura do campo.
- `GET /api/dashboard/operacional` — reúne os três blocos numa resposta.

### Frontend (`frontend/src/app/dashboard/page.tsx`)

Reescrita da tela consumindo o novo endpoint, mantendo o painel de alertas
operacionais e o de transcrições que já existem.

## Fora de escopo

- Card de renovação (sem dado)
- Alterar o funil ou os campos no Pipedrive
- Backfill de datas de nascimento
