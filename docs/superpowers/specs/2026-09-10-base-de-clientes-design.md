# Design — Base de Clientes

**Data:** 2026-09-10
**Status:** aprovado, não implementado

## Objetivo

Transformar o export de apólices da MAG numa base consultável dentro do sistema,
e usá-la para **gerar ligação**: quem tem cobertura única, quem está subsegurado
para a renda declarada, quem parou de pagar.

A planilha chega sempre **cheia**, não incremental. O sistema descobre o que
mudou.

## O que foi medido

Contra os dois arquivos reais — `PRODUTOS CONTRATADOS POR PROPOSTA - VIDA
INDIVIDUAL (16).xlsx` (bruto) e `BASE_MAG_V0_COMPLETA_ (1).xlsx` (tratado à mão).

| | valor |
|---|---|
| Linhas no export | 374 (3 vazias no rodapé) |
| Coberturas válidas | 371 |
| Clientes distintos (CPF) | 209 |
| `ITEM CONTRATADO` duplicados | **0** — serve como identidade |
| Capital segurado total | R$ 216.889.839 |
| Prêmio mensalizado total | R$ 781.941 (~R$ 9,4 mi/ano) |

**O número que orienta a feature: 162 dos 209 clientes (78%) têm uma única
cobertura.** Os produtos adicionais existem e quase ninguém tem — Doenças Graves
Plus em 15, IPA com Majoração em 30, DIH UTI em 10.

Entradas por ano: 43 (2021), 104 (2022), 83 (2023), 59 (2024), 24 (2025), 58
(2026). A queda até 2025 é parte do argumento para a fila de oportunidade.

**Dados de contato estão 100% completos** nas 371 linhas: telefone, e-mail, data
de nascimento, profissão e renda. Só `QTD FILHOS` falta, em 168 de 371 (45%).
Isso é incomum e é o que torna a fila acionável — não há etapa de enriquecimento
antes de ligar.

## A transformação

```
Export MAG              →  base_clientes          +  base_coberturas
374 linhas × 75 colunas    209 registros × 14        371 registros × 27
grão: item de cobertura    grão: CPF (agregado)      grão: item de cobertura
```

Os agregados por cliente são soma de capital segurado, soma de prêmio
mensalizado, contagem de propostas distintas e contagem de coberturas.

### Bug corrigido: `ITEM CONTRATADO`

No arquivo tratado à mão, o ID está **corrompido nos 371 registros**:

```
entrada:  112023223239210591     (18 dígitos)
saída:    1.120232232392106e+17
```

18 dígitos não cabem na precisão de um `float64` (15). Em algum passo o ID virou
número, perdeu os últimos dígitos e voltou a texto em notação científica —
`...591` virou `...600`.

Isso inviabiliza reconciliação: dois itens diferentes podem colidir no mesmo ID
truncado. **A coluna é lida como texto da planilha ao banco, e a coluna no
Postgres é `TEXT`.** Nunca deixar virar numérico em nenhum ponto do caminho.

O CPF sofre o problema inverso e mais conhecido: o export perde o zero à
esquerda (`7286584707`). É normalizado para 11 dígitos na entrada.

## Modelo de dados

| tabela | grão | chave |
|---|---|---|
| `base_importacoes` | um arquivo enviado | id |
| `base_clientes` | cliente | `cpf` (11 dígitos, texto) |
| `base_coberturas` | item de cobertura | `item_contratado` (texto) |

O diff calculado fica em `base_importacoes.diff_json`, não em tabela própria:
são ~370 registros por importação e é o mesmo padrão de `briefing_json`, que o
projeto já usa.

```
diff_json = {
  "inalterados": 338,
  "novos":     [ {chave, dados} ],
  "alterados": [ {chave, campos: {campo: [antes, depois]}} ],
  "sumidos":   [ {chave, visto_pela_ultima_vez_em} ],
  "avisos":    [ "linha 47: DATA NASCIMENTO ilegível" ]
}
```

`base_coberturas` guarda `ultima_importacao_id` e `visto_em` — é o que permite
detectar o que sumiu.

## Fluxo da importação

```
upload .xlsx
   ↓ normaliza     CPF com zero à esquerda, ID como texto, datas, números
   ↓ descarta      linhas sem CPF e sem item
   ↓ compara       contra base_clientes e base_coberturas
   ↓ grava         status "aguardando_confirmacao" + diff_json
   ↓
   CONFERÊNCIA     inalterados: só a contagem
                   novos: lista
                   alterados: campo a campo, antes → depois
                   sumidos: sinaliza, não apaga
   ↓
   aplicar   ou   descartar
```

Duas regras que não se negociam:

1. **Nada toca `base_clientes`/`base_coberturas` antes da confirmação.** Até lá
   a importação existe só como diff.
2. **Aplica tudo ou nada.** Importação pela metade é pior que nenhuma — deixa a
   base num estado que ninguém sabe descrever.

A confirmação é **da importação inteira**, não registro a registro. A tela existe
para você conferir se o arquivo está correto antes de gravar; discordar de uma
linha significa que o arquivo está errado, e o caminho é descartar a importação e
subir o arquivo corrigido — não aplicar 340 de 371.

### Os quatro baldes

| balde | o que é | o que a tela faz |
|---|---|---|
| inalterado | existe e nenhum campo mudou | mostra só o número |
| novo | `item_contratado` desconhecido | lista para conferir |
| alterado | existe e algum campo comparado mudou | mostra o diff campo a campo |
| sumido | estava na importação anterior, não veio nesta | sinaliza; **nunca apaga** |

Sumido não apaga porque a causa é ambígua: pode ser cancelamento, pode ser um
recorte diferente do export. Apagar por engano é irreversível; sinalizar não é.

## As quatro abas

Submenu no topo da página `/base-clientes`: **Dashboard**, **Clientes**,
**Fila de processamento**, **Exportar dados**.

### Dashboard

Quatro números de contexto — capital segurado, prêmio anualizado, clientes,
mudanças desde a última importação — e abaixo a **fila de oportunidade**, que
ocupa a maior parte da tela:

- **Cobertura única** (162 hoje) — cliente com exatamente uma cobertura, listando
  quais dos três riders da carteira ele não tem: `DOENÇAS GRAVES PLUS`,
  `IPA COM MAJORAÇÃO + IFPD`, `DIH ADICIONAL UTI`.
- **Maior lacuna de cobertura** — ver abaixo. Sem limiar: a lista é ordenada, não
  filtrada.
- **Status virou `REMIDO`** — parou de pagar. Detectado no diff da última
  importação, é ligação do dia.
- **Aniversariantes do mês** — com idade e profissão à mão.

#### Por que "subsegurado" não é um filtro

A primeira versão deste spec marcava como subsegurado quem tivesse capital
abaixo de 24× a renda mensal. Medindo contra a base real, isso marcaria **119 de
209 clientes (56%)** — e a régua de mercado (10× a renda anual) marcaria **201 de
209 (96%)**.

A mediana da carteira é **1,7× a renda anual**, contra 10× de referência de
mercado. Ou seja: por qualquer régua absoluta, quase todo mundo está
subsegurado, e a "lista de prioridade" vira a lista de clientes com outro nome.

Distribuição da razão capital / renda anual: p10 = 0,9× · p25 = 1,3× ·
**mediana 1,7×** · p75 = 3,3× · p90 = 6,3×.

O limiar então some e vira **ordenação**:

```
lacuna_em_reais = (renda_anual × 10) − capital_segurado_atual
```

O `10` só decide a **ordem** da fila, não quem entra nela. Errar esse número
reordena a lista; não exclui ninguém nem inunda de falso positivo — que é
exatamente o modo de falha que um limiar teria.

Ordenar por **reais** e não por proporção põe no topo quem vale mais: renda de
R$ 30 mil com razão 1,5× vale mais que R$ 5 mil com a mesma razão.

A linha mostra o cliente, a razão atual ("1,3× a renda anual") e a lacuna em
reais.

Cada linha termina em nome e telefone. Um dashboard que não termina num contato
informa, mas não vende — e a queixa registrada sobre o dashboard principal foi
exatamente "informações demais, cards incorretos".

### Clientes

Busca por nome, CPF ou profissão. Ao abrir um cliente, as coberturas dele.

### Fila de processamento

Histórico de importações com status, e a tela de conferência descrita acima.

**O export chega semanalmente**, então esta tela é usada ~52 vezes por ano. O caso
comum — poucas mudanças — precisa ser resolvível em segundos: contagem grande de
inalterados, lista curta do resto, um botão. Uma conferência que exige dez
minutos toda segunda-feira deixa de ser feita em um mês.

### Exportar dados

Gera o `.xlsx` de duas abas no formato tratado que já é usado hoje. CSV como
alternativa.

### Não há aba de Configurações

Foi cortada na revisão do spec. As três coisas que ela guardaria se resolvem sem
tela:

- **Limiares da fila** — deixaram de existir quando "subsegurado" virou ordenação
  em vez de filtro (acima).
- **Campos que contam como alteração** — vira constante no código, documentada
  abaixo. Mudar é uma linha.
- **Mapeamento de colunas** — só faz sentido quando a MAG renomear alguma coluna,
  o que ainda não aconteceu. Quando acontecer, é uma linha também. Construir a
  tela antes disso é resolver um problema que não existe.

### Campos que contam como "alterado"

Comparar todas as 27 colunas geraria ruído: `DATA STATUS` muda sozinha a cada
export e acusaria 371 alterações por semana, tornando a conferência inútil.

Contam como alteração, e só eles:

`status_cobertura` · `capital_segurado` · `premio_atual` · `premio_mensalizado` ·
`premio_anualizado` · `periodicidade` · `forma_pagamento` · `dia_vencimento` ·
`fim_vigencia` · `produto`

E no cliente: `telefone` · `email` · `endereco` · `profissao` · `renda`.

Os demais são gravados na aplicação da importação, mas não disparam conferência.

## Erros

| situação | comportamento |
|---|---|
| Faltam colunas esperadas | recusa, listando **quais** faltaram |
| `ITEM CONTRATADO` duplicado no arquivo | recusa — sem identidade não há reconciliação |
| Número ou data ilegível | entra em `avisos` no diff, não vira `null` silencioso |
| Arquivo não é `.xlsx` | recusa antes de ler |

## Como se prova que funciona

As duas planilhas reais viram fixture de teste:

1. **Fidelidade** — importar a bruta produz exatamente 209 clientes e 371
   coberturas, conferindo campo a campo contra a tratada (menos o
   `ITEM CONTRATADO`, onde o nosso valor é o correto e o dela está corrompido).
2. **Idempotência** — importar a mesma planilha de novo dá **0 novos, 0
   alterados, 371 inalterados**. É o requisito central medido, não prometido.

## Fora de escopo

- Cruzamento com o Pipedrive. Os 209 CPFs provavelmente aparecem lá também, e
  decidir qual fonte manda é discussão própria — fica para a segunda etapa.
- Qualquer escrita no CRM.
- Importação automática ou agendada: o arquivo é enviado à mão.
- Edição de cliente ou cobertura pela tela. A base é reflexo do export.
