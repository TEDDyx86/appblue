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
│  14:00 · Teams · Leandro Magalhães       │
│  R$ 85.000 · R3 - Reunião de Fechamento  │
│  [Entrar]  [Abrir no CRM]                │
└──────────────────────────────────────────┘

REUNIÕES (6)
  14:00 · Leandro Magalhães        R3 - Fechamento      R$ 85.000
  15:30 · Ana Ribeiro              R1 - Apresentação

LIGAÇÕES (4)
  09:00 · Bruno Costa              R2 - Planejamento    R$ 40.000
   —    · Carlos Mendes            Elaborar Planejamento

E-MAILS (2)
   —    · Enviar proposta — Joelson   Enviar Informações

TAREFAS (3)
```

### Agrupamento por modo de ação

A aba de cada período agrupa as atividades por **o que você vai fazer**, que é
como o dia é pensado na prática: tenho seis reuniões, quatro ligações, dois
e-mails.

| Grupo | Tipos do Pipedrive |
|---|---|
| **Reuniões** | `teams`, `meeting` |
| **Ligações** | `call` |
| **E-mails** | `email` |
| **Tarefas** | `task` e demais |

`teams` e `meeting` entram juntos porque ambos são encontro com cliente —
separá-los criaria dois blocos quase idênticos.

Dentro de cada grupo: quem tem horário vem primeiro, em ordem cronológica; os
sem hora vêm depois, marcados com `—`.

Grupos vazios não aparecem.

### Os tipos vêm do Pipedrive, não do código

O mapeamento acima é lido de `GET /activityTypes` (1 requisição), não fixado no
código. Os tipos são personalizáveis por conta — `teams` já é um tipo criado
pelo usuário, não um padrão do Pipedrive. Se um tipo novo for criado no CRM, ele
aparece no painel em vez de sumir.

Tipos desconhecidos caem em **Tarefas**, que funciona como grupo de fallback.

### A etapa (R1/R2/R3) vem do negócio, não da atividade

R1, R2 e R3 são **etapas do funil**, não propriedades da atividade. A atividade
carrega `deal_id`; a etapa e o valor vêm do negócio associado.

O cruzamento é feito **em memória**: os negócios abertos são buscados uma vez
(3 requisições) e indexados por id. Uma consulta por atividade multiplicaria o
consumo de cota e está descartada.

Atividade sem negócio associado exibe só cliente e assunto — o layout precisa
ficar íntegro sem esses campos.

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
| `/dashboard` novo | **~5** (1 atividades + 1 tipos + 3 negócios abertos) |
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
`/activityTypes` para o mapeamento de grupos e os negócios abertos para o
cruzamento de etapa e valor. O endpoint `/api/dashboard/operacional` permanece
como está, servindo a página de análise.

Resposta agrupada, pronta para renderizar:

```json
{
  "grupos": [
    { "chave": "reunioes", "titulo": "Reuniões", "itens": [ ... ] },
    { "chave": "ligacoes", "titulo": "Ligações",  "itens": [ ... ] }
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

**1. Volume de "hoje" pode ser irreal.** A medição apontou **37 atividades com
vencimento hoje**, o que é muito para uma pessoa. O agrupamento por modo de ação
ameniza — seis reuniões e trinta tarefas lê muito melhor que "37 itens" — mas se
o grupo Tarefas nascer com trinta linhas, a sobrecarga volta com outra roupa.

**Verificar a composição dessas 37 antes de implementar.** Se forem
majoritariamente tarefas represadas, o grupo Tarefas deve nascer **retraído**,
com apenas a contagem visível.

**2. Nem toda atividade tem negócio associado.** Linhas sem valor e etapa vão
existir; o layout precisa ficar íntegro sem esses campos.

**3. `deal_id` na atividade não foi confirmado.** A listagem de atividades foi
verificada quanto a `subject`, `type`, `due_date`, `due_time`, `person_name` e
`deal_title`, mas **não quanto a `deal_id`**. Sem ele o cruzamento com o negócio
não acontece e a etapa (R1/R2/R3) não aparece. Confirmar na primeira
requisição disponível; se faltar, o fallback é casar por `deal_title`, que é
frágil e deve ser evitado.

**3. Fuso.** As datas do Pipedrive vêm como `YYYY-MM-DD`. Usar a leitura direta
do texto ISO, nunca `new Date(...)` — o mesmo bug de um dia a menos já corrigido
nos cards de ontem.

## Fora de escopo

- Resumo da reunião anterior
- Criar, editar ou concluir atividades pelo painel
- Cards configuráveis na tela principal
- Remover qualquer card existente (todos migram para a análise)
