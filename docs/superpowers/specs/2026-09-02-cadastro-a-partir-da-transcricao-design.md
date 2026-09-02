# Design — Atualizar cadastro do cliente a partir da transcrição

**Data:** 2026-09-02
**Status:** aprovado, não implementado

## Objetivo

Usar os dados que a transcrição extrai da reunião para **sugerir** atualizações
no cadastro da pessoa no Pipedrive, com aprovação campo a campo.

Nada é gravado sem marcação explícita. O valor que já está no CRM é a informação
principal; a transcrição entra como sugestão ao lado.

## Por que isso ficou viável

Os campos personalizados de pessoa do Pipedrive **espelham quase exatamente** o
que o prompt novo do Tactiq extrai — inclusive "Cônjuge sem Proteção" e "Filhos
sem Proteção", que não são campos comuns de CRM. O prompt foi desenhado contra
essa estrutura.

| Transcrição (`dados_cliente`) | Campo no Pipedrive | Tipo |
|---|---|---|
| `nome` | Nome | padrão |
| `email` | E-mail | padrão |
| `telefone` | Telefone | padrão |
| `data_nascimento` | Data de Nascimento | `date` |
| `profissao` | Profissão | `varchar_auto` |
| `estado_civil` | Estado Civil | `enum` |
| `regime_casamento` | Regime de Casamento | `enum` |
| `nome_conjuge` | Nome do (a) cônjuge | `varchar` |
| `filhos_itens` | Nome (s) do (s) filho (s) | `varchar` |
| `conjuge_sem_protecao` | Cônjuge sem Proteção | `enum` Sim/Não |
| `filhos_sem_protecao` | Filhos sem Proteção | `enum` Sim/Não |
| `renda_mensal` | Renda | `monetary` |

`PIPEDRIVE_PERSON_CUSTOM_FIELDS` já mapeia 7 desses. Faltam quatro chaves:

```python
"regime_casamento":     "011f47eeeffdcd9977e52c2dd706e969a7d76abe"
"filhos":               "4dbe50bc5776265528952814794cf56659d16e1c"
"conjuge_sem_protecao": "0d615482b0d010a1f487678d1137c1f753b1aaf7"
"filhos_sem_protecao":  "25a7be8d3ecfbf20f750d375297ce37e93c016e7"
```

## Normalização: o trabalho de verdade

Campos `enum` do Pipedrive aceitam **id numérico**, não rótulo. E a transcrição
escreve em linguagem natural, com flexão de gênero.

| Transcrição diz | Opção no Pipedrive | id |
|---|---|---|
| "Casada" / "casados" / "Casado" | Casado | 53 |
| "Solteira" / "Solteiro" | Solteiro | 52 |
| "União estável" | União Estável | 54 |
| "Comunhão parcial" | Comunhão Parcial | 55 |
| "Comunhão universal" | Comunhão Universal | 56 |
| "Separação total" | Separação Total | 58 |
| "Separação obrigatória" | Separação Obrigatório de Bens | 57 |
| "Sim" / "Não" | Sim / Não | 46/47 e 48/49 |

A comparação normaliza acento, caixa e a terminação de gênero (`-a`/`-o`/`-os`
/`-as`). Valor que não casar com nenhuma opção **não vira sugestão** — melhor
não sugerir do que sugerir errado num campo de escolha fixa.

### Data de nascimento: limitação conhecida

O campo é `date`, mas a transcrição costuma trazer **só o ano** — no caso da
Natália veio `"1984"`. Não há como gravar data parcial.

Regra: só sugere quando houver dia, mês e ano identificáveis. Ano isolado é
exibido como informação, marcado como **não aplicável**, com o motivo visível.
Não é erro; é o dado que a conversa produziu.

### Renda

`monetary` exige número. A transcrição traz texto ("cerca de R$ 12 mil"). Extrai
o primeiro número; se houver "mil"/"milhão" aplica o multiplicador. Não
conseguindo, não sugere.

### Filhos

`filhos_itens` é lista; o campo é `varchar`. Junta com `", "`.

## Fluxo

Duas portas para a mesma tela, como decidido.

**1. No card da transcrição** (`/transcriptions`): botão **"Atualizar cadastro"**,
visível quando a transcrição tem pessoa vinculada e ao menos um campo sugerível.
Leva para a revisão.

**2. Na Ficha Cadastral** (`/cadastros`): aba nova **"Da transcrição"**, ao lado
do upload de PDF, com a lista de transcrições que têm sugestões pendentes.

### Tela de revisão

```
Natália Fernanda Gomes Sobestiansky              Pessoa #489 ↗

CAMPO                NO CRM (atual)        DA TRANSCRIÇÃO
─────────────────────────────────────────────────────────────────
Estado Civil         Casado                Casado            = igual
Profissão            —  vazio              Servidora públ.   [ ] aplicar
Regime de Casamento  —  vazio              Comunhão Parcial  [ ] aplicar
Nome do cônjuge      —  vazio              Ivan              [ ] aplicar
Filhos               Diana e João          Diana             [ ] substituir
Data de Nascimento   —  vazio              1984              não aplicável:
                                                             só o ano

[ ] Também criar nota com patrimônio, seguros e interesse

                                   [ Aplicar 0 alterações ]
```

Regras da tela:

- **Nada vem pré-marcado**, nem os campos vazios no CRM. O valor atual é a
  informação principal; a mudança exige clique.
- Campo vazio no CRM é destacado, para saltar aos olhos sem alterar o padrão.
- Campo cujo valor já é igual aparece como "igual" e não é marcável.
- O botão mostra a contagem do que será alterado e fica inativo em zero.

### Nota opcional

Patrimônio, seguros existentes e "demonstrou interesse" não têm campo de pessoa
correspondente. Uma caixa opcional cria uma nota na pessoa com esse conteúdo,
usando `create_pipedrive_note`, que já existe.

Fica desmarcada por padrão: é conteúdo que já aparece no briefing anexado à
atividade, e repetir sem escolha polui o cadastro.

## Criar pessoa nova

Quando a transcrição não tem pessoa vinculada, a mesma tela oferece **criar** o
cadastro com os campos sugeridos — todos marcáveis, nenhum obrigatório além do
nome.

Não acontece automaticamente. Das 15 transcrições medidas, 6 não tinham negócio
no CRM e várias eram reunião interna ("Samuel — treinamento", "Roberto Righetti
— daily"). Criar pessoa a partir de nome dito em conversa geraria cadastro
duplicado e sujo.

## Implementação

### Backend (`backend/main.py`)

- Completar `PIPEDRIVE_PERSON_CUSTOM_FIELDS` com as quatro chaves faltantes
- `normalizar_para_opcao(valor, opcoes) -> Optional[int]` — casa texto livre com
  opção de enum, tolerando gênero e acento
- `montar_sugestoes(briefing, person_id) -> List[Sugestao]` — para cada campo:
  valor atual no CRM, valor sugerido, se são iguais, e se é aplicável
- `GET  /api/transcriptions/{id}/sugestoes-cadastro`
- `POST /api/transcriptions/{id}/aplicar-cadastro` — recebe só os campos
  marcados, grava e registra em `audit_log` com a ação
  `PERSON_UPDATED_FROM_TRANSCRIPTION`, guardando valores antigo e novo

O log com `old_values`/`new_values` importa: é o que permite desfazer uma
sugestão ruim e avaliar se a extração está melhorando.

### Frontend

- `src/components/SugestoesCadastro.tsx` — a tabela de revisão
- `src/app/transcriptions/page.tsx` — botão "Atualizar cadastro"
- `src/app/cadastros/page.tsx` — aba "Da transcrição"

## Riscos

**1. A transcrição é prosa interpretada por IA.** "Casada com Ivan, em comunhão
parcial" saiu correto, mas nada garante que sempre saia. Por isso nada é
automático e o valor do CRM é o padrão.

**2. Formato antigo não tem os campos novos.** As 66 transcrições anteriores ao
prompt atual só têm nome, estado civil e e-mail preenchidos. Para elas a tela
mostrará poucas sugestões — comportamento correto, não falha.

**3. Sobrescrever lista de filhos.** "Diana e João" no CRM contra "Diana" na
transcrição é perda de informação se aplicado sem ler. A tela marca esse caso
como **substituir**, não como preencher, para diferenciar do campo vazio.

## Fora de escopo

- Criar campos personalizados novos no Pipedrive
- Aplicar sugestões automaticamente
- Reprocessar transcrições antigas
- Atualizar dados do negócio (só pessoa)
