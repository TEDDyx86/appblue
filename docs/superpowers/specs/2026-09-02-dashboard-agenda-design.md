# Design — Dashboard como agenda de trabalho

**Data:** 2026-09-02
**Status:** aprovado, não implementado

## O problema

O dashboard atual é uma **coleção de cards** — uma superfície de consulta. O uso
real é outro: um planejador financeiro e sucessório com agenda apertada, que
precisa responder em segundos **"o que eu preciso fazer agora?"**.

Um número do mapeamento explica por que a tela atual não serve:

> **120 dos 143 negócios abertos estão com follow-up vencido — 84%.**

Um card escrito "120 follow-ups vencidos" não é uma lista de tarefas; é um aviso
de que o sistema está afogado. E listar 120 itens para quem não tem tempo é pior
que não mostrar nada.

## Princípio

O eixo da tela é **tempo**, e a unidade de trabalho é a **atividade**, não o
negócio. Isso colapsa duas listas numa só: os "follow-ups vencidos" nada mais são
que atividades que venceram e continuam pendentes.

A tela **decide pelo usuário**. Não há cards para configurar, reordenar ou
ocultar — configurar o painel é o oposto de velocidade.

## Estrutura

```
11 transcrições sem vínculo · 4 negócios sem próximo passo      ← faixa de status

[ Hoje ]  [ Amanhã ]  [ Próximos ]              ⟨ 120 atrasados ⟩ ← secundário
   ▲ padrão                7d 15d 30d

┌─ AGORA ──────────────────────────────────┐
│  14:00 · R3 · Leandro Magalhães          │
│  [Abrir no CRM]                          │
└──────────────────────────────────────────┘

REUNIÕES (5)
  14:00  R3     Leandro Magalhães          R$ 85.000
  15:30  R1     Ana Ribeiro
  16:00  Teams  Bruno Costa

MENSAGENS (5)
   —     E-mail  Enviar proposta — Joelson

TAREFAS (10)
   —     Tarefa  Revisar apólice — Carlos
   —     Prazo   Vencimento da proposta

LIGAÇÕES (1)
  09:00  Chamada  Radilson Carlos
```

O exemplo acima reflete a composição real medida em 2026-09-02: 5 reuniões,
5 mensagens, 10 tarefas, 1 ligação. Note que a maioria das linhas **não tem
valor de negócio** — é o caso comum, não a exceção.

### Agrupamento por modo de ação

A aba de cada período agrupa as atividades por **o que você vai fazer**, que é
como o dia é pensado na prática: tenho seis reuniões, quatro ligações, dois
e-mails.

A conta tem **15 tipos de atividade personalizados**, verificados em
`GET /activityTypes`:

```
call        Chamada        meeting     R1          no_show     R1 No Show
whatsapp    WhatsApp       reuniao_2   R2          r2_no_show  R2 No Show
email       E-mail         r3          R3          r3_no_show  R3 No Show
task        Tarefa         teams       Teams       lunch       RR No Show
deadline    Prazo          outlook     Outlook     tactiq      Tactiq
```

| Grupo | Tipos |
|---|---|
| **Reuniões** | `teams`, `meeting` (R1), `reuniao_2` (R2), `r3` (R3), `outlook` |
| **Ligações** | `call` |
| **Mensagens** | `email`, `whatsapp` |
| **Tarefas** | `task`, `deadline`, `tactiq` e demais |
| **No Show** | `no_show`, `r2_no_show`, `r3_no_show`, `lunch` |

O grupo **No Show** existe porque a conta trata falta como categoria própria —
são quatro tipos dedicados. Misturá-los com reuniões daria a impressão de
compromisso a cumprir.

Cada reunião exibe o **rótulo do próprio tipo** (R1, R2, R3, Teams), que já
identifica o estágio do relacionamento.

Dentro de cada grupo: quem tem horário vem primeiro, em ordem cronológica; os
sem hora vêm depois, marcados com `—`.

Grupos vazios não aparecem.

### Os tipos vêm do Pipedrive, não do código

O mapeamento acima é lido de `GET /activityTypes` (1 requisição), não fixado no
código. Os tipos são personalizáveis por conta — `teams` já é um tipo criado
pelo usuário, não um padrão do Pipedrive. Se um tipo novo for criado no CRM, ele
aparece no painel em vez de sumir.

Tipos desconhecidos caem em **Tarefas**, que funciona como grupo de fallback.

### R1/R2/R3 já vêm no tipo da atividade

Medido: R1, R2 e R3 existem como **tipos de atividade** (`meeting`, `reuniao_2`,
`r3`), além de existirem como etapas do funil. Para rotular uma reunião de hoje
como R3, **basta o tipo** — não é preciso buscar os negócios abertos.

Isso reduz o custo da tela de ~5 para **~2 requisições**.

O valor do negócio continua sendo enriquecimento opcional, e é fraco: apenas
**36 de 106** atividades futuras têm `deal_id`. Dois terços não têm negócio
associado. **Não buscar os negócios abertos só por isso** — o layout deve tratar
a ausência de valor como caso normal, não como exceção.

### Armadilha: `end_date` é exclusivo

Verificado contra a API:

```
start_date=2026-09-02  end_date=2026-09-02  ->   0 atividades
start_date=2026-09-02  end_date=2026-09-03  ->  21 atividades
```

Pedir o mesmo dia em `start_date` e `end_date` devolve **vazio**. A aba "Hoje"
precisa pedir `end_date = hoje + 1 dia`.

Implementado de forma ingênua, o painel nasceria mostrando "nenhuma atividade
hoje" todos os dias — e o erro passaria por dado, não por bug.

### Períodos

| Aba | Conteúdo |
|---|---|
| **Hoje** (padrão) | atividades com vencimento hoje |
| **Amanhã** | atividades de amanhã |
| **Próximos** | 7, 15 ou 30 dias, agrupadas por dia |

### Atrasados: acesso secundário

Sai das abas de período de propósito. Aparece como um **botão discreto** com a
contagem, e abre a lista num painel à parte.

O painel é sobre o que vem pela frente. Colocar 120 pendências vencidas com o
mesmo peso das tarefas do dia recria exatamente a sobrecarga que se quer
eliminar.

Quando aberta, a lista vem **ordenada da mais recente para a mais antiga**: uma
atividade que venceu ontem ainda está quente; uma de seis meses atrás está morta.
Ordenar por antiguidade traria o irrelevante para o topo.

### Bloco AGORA

Só existe na aba **Hoje**: é o próximo compromisso com horário, em destaque, com
ação direta. Nos demais períodos a tela é apenas a lista cronológica.

Um marcador horizontal separa o que já passou do que ainda vem.

Se não houver mais compromissos hoje, o bloco some — sem estado vazio decorativo.

### Conteúdo de cada linha

Hora · tipo · cliente, e quando houver negócio associado, valor e etapa.

**Sem resumo da reunião anterior.** Foi avaliado e descartado: o custo é um
bloco de texto por linha, e o pedido é velocidade de leitura.

## O que sai da tela principal

Vão para **`/dashboard/analise`**, com toda a infraestrutura de retrair,
reordenar e ocultar preservada:

- Motivos de Perda
- Taxa de Conversão
- Aniversariantes
- Fila de Recuperação
- Alertas Operacionais (data grid)

São análise, não ação. Continuam existindo; param de disputar espaço com a
rotina diária.

`CollapsibleCard`, `CardVisibilityMenu` e a lógica de reordenação **não vão para
a tela principal** — permanecem em uso apenas na página de análise.

## Efeito colateral no consumo de cota

A cota diária da API do Pipedrive já foi esgotada uma vez durante o
desenvolvimento. Esta mudança melhora isso de forma significativa:

| Tela | Custo por carregamento |
|---|---|
| `/dashboard` hoje | ~15 requisições |
| `/dashboard` novo | **~2** (1 atividades + 1 tipos) |
| `/dashboard/analise` | ~15, mas aberta raramente |

A tela usada o dia inteiro fica barata; as agregações caras migram para uma
página de visita ocasional. O cache de 5 minutos continua valendo para ambas.

## Implementação

### Backend (`backend/main.py`)

Generalizar `fetch_agenda_hoje()` para receber um intervalo:

```
GET /api/dashboard/agenda?periodo=hoje|amanha|proximos&dias=7|15|30
GET /api/dashboard/agenda/atrasadas
```

Ambos consultam `/activities` com `done=0` e as datas do período, mais
`/activityTypes` para o mapeamento de grupos. **Sem buscar negócios abertos** —
R1/R2/R3 já vêm no tipo da atividade. O endpoint `/api/dashboard/operacional`
permanece como está, servindo a página de análise.

Atenção ao `end_date` exclusivo: o período "hoje" pede `end_date = hoje + 1`.

Resposta agrupada, pronta para renderizar:

```json
{
  "grupos": [
    { "chave": "reunioes", "titulo": "Reuniões", "itens": [ ... ] },
    { "chave": "ligacoes", "titulo": "Ligações",  "itens": [ ... ] },
    { "chave": "mensagens", "titulo": "Mensagens", "itens": [ ... ] },
    { "chave": "tarefas",  "titulo": "Tarefas",   "itens": [ ... ] },
    { "chave": "no_show",  "titulo": "No Show",   "itens": [ ... ] }
  ],
  "total": 15,
  "atrasadas": 120
}
```

Cada item: `id`, `subject`, `type`, `due_date`, `due_time`, `person_name`,
`deal_id`, `deal_title`, `deal_value`, `deal_stage`, `url`.

O agrupamento acontece no backend para o frontend não precisar conhecer os tipos
do Pipedrive nem replicar a regra de fallback.

### Frontend

- `src/app/dashboard/page.tsx` — reescrita como agenda
- `src/app/dashboard/analise/page.tsx` — recebe os cards atuais
- `src/components/AgendaDia.tsx` — lista com marcador de "agora"
- `src/components/ProximoCompromisso.tsx` — o bloco AGORA
- `src/components/PainelAtrasadas.tsx` — o secundário

Acessibilidade: as abas de período seguem o padrão de `tablist`/`tab`/`tabpanel`
com navegação por setas; o marcador de "agora" é decorativo (`aria-hidden`) e a
separação é comunicada no texto de cada item.

## Riscos

**Resolvido — volume real.** Medido em 2026-09-02 (quarta): **21 atividades**,
distribuídas assim:

| Grupo | Qtd |
|---|---|
| Reuniões (`teams` 3, `reuniao_2` 1, `meeting` 1) | 5 |
| Mensagens (`email` 5) | 5 |
| Tarefas (`task` 8, `deadline` 2) | 10 |
| Ligações (`call` 1) | 1 |

A janela de 4 semanas mostra dias entre 1 e 26 atividades, com média em torno de
10. **Não é uma agenda sobrecarregada** — o agrupamento dá conta sem precisar
nascer retraído. A estimativa anterior de "37 hoje" era de outra data.

**1. Metade das atividades não tem horário.** Medido: **76 de 106** futuras têm
`due_time`, ou seja, ~28% são itens sem hora. O marcador de "agora" só ordena os
que têm horário; os demais ficam agrupados ao final de cada bloco.

**2. Dois terços não têm negócio associado.** Apenas **36 de 106** têm
`deal_id`. Valor e etapa do funil são exceção, não regra — o layout precisa ser
desenhado para a linha sem esses campos e tratá-los como enriquecimento.

**3. Volume de atrasadas.** Só nos últimos 7 dias há **85 atividades vencidas**
não concluídas. O total é maior. Confirma a decisão de manter o acesso
secundário e limitar a lista.

**3. Fuso.** As datas do Pipedrive vêm como `YYYY-MM-DD`. Usar a leitura direta
do texto ISO, nunca `new Date(...)` — o mesmo bug de um dia a menos já corrigido
nos cards de ontem.

## Fora de escopo

- Resumo da reunião anterior
- Criar, editar ou concluir atividades pelo painel
- Cards configuráveis na tela principal
- Remover qualquer card existente (todos migram para a análise)
