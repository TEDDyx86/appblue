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

## As cinco abas

Submenu no topo da página `/base-clientes`.

### Dashboard

Quatro números de contexto — capital segurado, prêmio anualizado, clientes,
mudanças desde a última importação — e abaixo a **fila de oportunidade**, que
ocupa a maior parte da tela:

- **Cobertura única** (162 hoje) — cliente com exatamente uma cobertura, listando
  quais dos três riders da carteira ele não tem: `DOENÇAS GRAVES PLUS`,
  `IPA COM MAJORAÇÃO + IFPD`, `DIH ADICIONAL UTI`.
- **Subsegurado** — capital segurado total abaixo de **24× a renda mensal
  declarada**. Dois anos de renda é o piso conservador da categoria; o número é
  editável em Configurações, e a régua serve para ordenar a fila, não para
  precificar nada.
- **Status virou `REMIDO`** — parou de pagar. Detectado no diff da última
  importação, é ligação do dia.
- **Aniversariantes do mês** — com idade e profissão à mão.

Cada linha termina em nome e telefone. Um dashboard que não termina num contato
informa, mas não vende — e a queixa registrada sobre o dashboard principal foi
exatamente "informações demais, cards incorretos".

### Clientes

Busca por nome, CPF ou profissão. Ao abrir um cliente, as coberturas dele.

### Fila de processamento

Histórico de importações com status, e a tela de conferência descrita acima.

### Exportar dados

Gera o `.xlsx` de duas abas no formato tratado que já é usado hoje. CSV como
alternativa.

### Configurações

Três coisas concretas, não um painel genérico:

- **Mapeamento de colunas** — se a MAG renomear uma coluna, ajusta aqui em vez
  de no código.
- **Campos que contam como alteração** — `DATA STATUS` muda sozinha e geraria
  371 alertas por importação. Precisa ser desligável.
- **Limiares da fila de oportunidade** — o que é "renda alta", o que é
  "subsegurado".

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
