# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

O código, os comentários e a interface são em **português**. Escreva assim.

## Comandos

```bash
# Backend (FastAPI, porta 8000) — o .bat já usa --reload
iniciar_backend.bat
backend/venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000   # a partir de backend/

# Frontend (Next.js, porta 3000)
iniciar_frontend.bat
cd frontend && npm run dev

cd frontend && npx tsc --noEmit -p tsconfig.json   # typecheck
cd frontend && npm run lint
cd frontend && npm run build
```

**Pare o `next dev` antes de rodar `next build`.** Rodar os dois juntos corrompe o `.next` e o build passa a falhar por motivo que não tem a ver com o código.

Não há pytest. `backend/test_*.py` são scripts avulsos: `backend/venv/Scripts/python.exe test_all_integrations.py`. Para testar uma função do backend isoladamente, importe `main` num script e chame direto — mas veja a seção de segurança antes.

Python 3.11 (`.python-version`). O venv fica em `backend/venv`.

## Arquitetura

Três peças: **Next.js 14 (App Router)** → **FastAPI** → **Supabase (Postgres)**, com **Pipedrive CRM** e **Google Drive** como sistemas externos. O `README.md` descreve as funcionalidades; o que segue é o que exige ler vários arquivos para entender.

### O backend é quase um arquivo só

`backend/main.py` tem ~5.400 linhas, dividido por comentários `# ====`. Não há ORM nem camada de repositório: os endpoints chamam `supabase.table(...)` e `httpx` direto. Para achar código, procure pelo cabeçalho da seção (`PIPEDRIVE INTEGRATION`, `VÍNCULO: transcrição -> atividade`, etc.), não por arquivo.

A exceção é `backend/assistente.py` — o assistente de consulta em linguagem natural. Ficou fora por ser subsistema fechado (dois provedores de LLM, catálogo de ferramentas, despacho) e por `main.py` já ser difícil de navegar. `main.py` importa dele **no fim do arquivo**, porque `assistente` chama funções de `main` e importar antes fecharia o ciclo.

### O assistente é somente leitura

`assistente.py` mapeia perguntas para endpoints que já existem (`fetch_agenda`, busca no Pipedrive, transcrições). Nenhuma ferramenta escreve. Ao adicionar uma, mantenha assim — e note que `FERRAMENTAS` e `EXECUTORES` têm um `assert` que quebra o import se saírem de sincronia.

**Valide o nome da ferramenta antes de despachar.** Um modelo já devolveu `list_transcricoes` em vez de `listar_transcricoes`; nome inventado nunca pode chegar ao `EXECUTORES[...]`.

Provedores em cascata (Gemini → NVIDIA) porque **medimos**: cada um sozinho falhou em ~10% e ~14% das chamadas, sempre por indisponibilidade (429/500/503), nunca por escolha errada. `backend/test_chatbot_ferramentas.py` roda 21 perguntas e mede a escolha sem chamar endpoint nenhum — use antes de mexer nas descrições das ferramentas.

### Base de Clientes: o ID de 18 dígitos

`backend/base_clientes/` importa o export semanal de apólices da MAG. A regra que
não pode ser quebrada: **`ITEM CONTRATADO` é texto do começo ao fim.** São 18
dígitos e não cabem em `float64` (15) — deixar virar número corrompe o ID
(`...591` vira `...600`) e destrói a reconciliação entre importações. Vale na
leitura, no banco (`TEXT`) e na exportação (`number_format = "@"`).

O caminho inverso também importa: o Supabase devolve `NUMERIC` como **string** e
`DATE` como texto. `consultas.py` coage com `_num`/`_data` e `exportacao.py`
reconverte antes de escrever a célula — sem isso a coluna de capital segurado
não soma no Excel, que é justamente para o que o arquivo serve.

Nada é gravado antes da confirmação: a importação vira diff em
`base_importacoes.diff_json` e só aplica com o aceite. O que sumiu do export é
sinalizado, **nunca apagado** — a causa é ambígua (cancelamento ou recorte
diferente do export) e apagar por engano não tem volta.

Só os campos em `CAMPOS_COMPARADOS_*` disparam "alterado" — `DATA STATUS` muda
sozinha a cada export e acusaria 371 alterações por semana, tornando a
conferência inútil e portanto ignorada em um mês.

**A fila de oportunidade ordena, não filtra.** Medindo contra a base real, marcar
"subsegurado" por 24× a renda mensal pegaria 119 de 209 clientes (56%); pela
régua de mercado (10× a renda anual), 201 de 209 (96%). A mediana da carteira é
1,7× a renda anual. Por qualquer limiar absoluto a lista de prioridade vira a
lista de clientes com outro nome. O `REFERENCIA_RENDA_ANUAL = 10` só decide a
**ordem**: errar reordena a fila, não exclui ninguém nem inunda de falso
positivo.

Quatro situações fazem o leitor **recusar** o arquivo em vez de seguir: coluna
esperada faltando, `ITEM CONTRATADO` duplicado, cabeçalho ambíguo depois de
normalizado, e arquivo que não é `.xlsx`. Valor preenchido que não converte não
vira `null` calado — vai para `avisos`, que a tela de conferência mostra.

`backend/test_base_clientes.py` roda contra a planilha real e prova o que
importa: fidelidade (371 coberturas, 209 clientes, R$ 216.889.839),
idempotência (reimportar dá 0 alterações) e os quatro caminhos de recusa, estes
com planilhas montadas em memória.

**As planilhas da MAG estão no `.gitignore`** (`*.xlsx`, `*.xls`, `*.csv`).
Carregam CPF, telefone, e-mail, endereço e renda de 209 pessoas reais. Elas são
fixture de teste e ficam na máquina, nunca no histórico do git.

### SUSEP: sem API, mas também sem navegador

`backend/susep/consulta.py` busca Condições Gerais na base pública da SUSEP com
duas requisições `httpx`. **Não use Playwright aqui** — foi medido:

- a página de consulta é ASP.NET **MVC**, não WebForms: não há `__VIEWSTATE`
  nem `__EVENTVALIDATION` para carregar entre requisições;
- a busca é um POST `multipart` de campo único (`numeroProcesso`) e a tabela de
  resultados já vem no HTML da resposta, sem JavaScript;
- `GET .../DownloadConsultaPublica/{id}` devolve `application/pdf` e **não exige
  sessão** — conferido em processo separado, sem cookie da busca.

A automação anterior (`SUSEP/`, protótipo fora do git) subia um Chromium por
consulta para obter o mesmo arquivo, byte a byte.

**Vigente é a versão com data-fim vazia**, não a primeira linha da tabela. O
protótipo usava `rows[0]`, supondo ordenação do servidor.

**`Cód. SUSEP:` não é o número do processo.** A apólice traz o código da
corretora (9 dígitos) com essa mesma palavra, e um CNPJ com pontuação parecida
na mesma página. `extrair_processo()` casa só os quatro formatos de processo,
com guarda à esquerda contra dígito e pontuação — e à direita **só contra
dígito**, porque a apólice escreve `PROCESSO SUSEP Nº 15414.902186/2014-52.` e
barrar o ponto final derrubaria o caso mais comum.

Nada é gravado: o PDF é buscado na hora e entregue ao navegador. Guardar
exigiria decidir quando revalidar, e a SUSEP publica versão nova sem avisar.

`backend/test_susep.py` roda offline por padrão; `--online` exercita uma
consulta e um download reais.

### `briefing_json` é o esquema de verdade

A tabela `transcriptions` guarda quase todo o estado num JSONB. O comentário no `schema.sql:56` está desatualizado — cita três chaves e o código usa muito mais. As que importam:

| chave | o que é |
|---|---|
| `pipedrive` | `person_id`, `deal_id`, `activity_id`, `note_id` do vínculo |
| `vinculo` | resultado da vinculação automática: `status`, `motivo`, `detalhe` |
| `dados_cliente` | saída do parser do Tactiq |
| `is_ignored` | reunião interna — **some da listagem e apaga nota/atividade do Pipedrive** |
| `cadastro_dispensado` | tirada da fila de revisão de cadastro (só isso, não toca no CRM) |

`is_ignored` e `cadastro_dispensado` fazem coisas muito diferentes. Não reaproveite um pelo outro.

### O `briefing_json` gravado envelhece

Ele guarda o resultado do parser **vigente no momento do processamento**. Quando o parser melhora, os registros antigos não acompanham. Por isso as sugestões de cadastro **reextraem de `transcription_text` na leitura** (`dados_cliente_atualizados`) em vez de confiar no que está gravado. Prefira esse caminho a reprocessar: reprocessar reescreve briefings já enviados ao Pipedrive.

### Fluxo da transcrição (o coração do sistema)

Google Drive → `extrair_dados_cliente()` lê pares `* Rótulo: valor` da seção `DADOS DO CLIENTE` → monta `briefing_json` → `vincular_briefing_na_atividade()` acha a atividade R1/R2/R3 já existente na agenda, anexa o briefing e marca como concluída.

A vinculação **atualiza atividade existente, nunca cria**. Toda falha grava um código em `vinculo.motivo` com a evidência em `detalhe` — é isso que a tela `MotivoVinculo.tsx` traduz para o usuário. Ao adicionar um motivo novo no backend, adicione o texto correspondente lá, senão a tela mostra o código cru.

Regras da vinculação, todas calibradas com dados reais e medidas:
- Nome casa por **palavra inteira**, com prefixo a partir de 3 letras para apelido (`Ari`→`Ariovaldo`, `Fred`→`Frederico`). **Nunca volte a usar substring do texto corrido**: `"ari"` casava com "Livia **Ari**ane" e "Ferr**ari**", e 7 de 24 transcrições eram decididas pela ordem em que a API devolvia.
- Empate no topo desempata pelo título da reunião (que costuma trazer o sobrenome que o campo `nome` não tem) e, persistindo, pela data. Se sobrar mais de uma atividade, **desiste** — vínculo errado é pior que vínculo ausente.
- `LIMIAR_COMPATIBILIDADE = 0.90`, `TOLERANCIA_DIAS = 1`.
- **Quem conduz nunca é cliente** (`CONDUTORES`, motivo `REUNIAO_INTERNA`). Numa
  reunião interna o briefing nomeou como cliente alguém apenas *citado*, e o
  vínculo casou com score 1,00 contra o negócio real dele. A guarda compara
  **subconjunto de tokens com pelo menos dois** — recusar por primeiro nome
  derrubaria "Roberto Carlos Menezes", e por sobrenome, "Ana Paula Vieira".
  Note o alcance: ela pega o caso em que o *condutor* é extraído como cliente,
  **não** o caso em que um terceiro citado é. Esse só se resolve no Tactiq, que
  é onde a lista de participantes existe.
- **Não use "cliente está entre os participantes" como filtro.** Medido contra
  20 transcrições: bloquearia dois vínculos corretos, porque cliente presencial
  não aparece na lista do Tactiq.
- `done` só é reescrito quando está `false`; a nota é gravada com PUT, que **substitui** o conteúdo anterior.

## Pipedrive: armadilhas confirmadas na prática

Custaram bugs em produção. Confie nelas antes da documentação.

- **v1 para atividades e notas.** Os equivalentes v2 devolvem 405.
- **`pipeline_id` é silenciosamente ignorado** em `GET /v1/deals`. Filtre no cliente. (Comprovado: 242 negócios com e sem o filtro.)
- **Sem paginação você recebe 100 registros e nenhum aviso.** Use `paginar_pipedrive()`.
- **`end_date` é exclusivo** em `/activities` — para incluir o último dia, mande `fim + 1 dia`.
- **`/v1/persons/search` funciona; `/api/v1/persons/search` devolve 404** "Unknown method". A base não é consistente entre endpoints.
- **`due_time` é UTC.** O usuário opera em Brasília (UTC-3): +3h ao gravar, −3h ao ler.
- **O Pipedrive sanitiza HTML de nota**: remove `style=`/`target=`, injeta `rel='noopener noreferrer'`, escapa `&`→`&amp;`. Comparar o HTML enviado com o devolvido nunca dá igual.
- **Campos `enum` aceitam id numérico, não rótulo.** Veja `normalizar_para_opcao()`.
- Tipos de atividade: `meeting`=R1, `reuniao_2`=R2, `r3`=R3, `tactiq`=transcrição.
- Os campos `CS - Capital Segurado *` da pessoa descrevem a **apólice emitida por esta assessoria**, não cobertura que o cliente já tinha. Não mapeie `seguros_existentes` neles — contamina relatório de produção.

**Google Drive:** a Service Account tem `storageQuota.limit = 0`. Cria pastas, mas **não faz upload** (403 `storageQuotaExceeded`). Shared Drives exigem Workspace, e a conta é Gmail pessoal.

## Frontend

- **TanStack Table v9**, não v8. A API é outra: `useTable` + `tableFeatures()`, e os *row models* vão **dentro** do objeto de features. Esquecer `createSortedRowModel()`/`createPaginatedRowModel()` faz ordenação, busca e paginação morrerem em silêncio — o `tsc` passa e os botões não fazem nada.
- `new Date('2026-01-15')` é meia-noite **UTC** e renderiza o dia anterior em UTC-3. Formate strings ISO direto, sem passar por `Date`.
- Cards retráteis usam `hidden`, não altura zero, para que Tab e leitor de tela pulem o conteúdo fechado. Mantenha `aria-expanded`/`aria-controls`.
- Espalhar props em JSX (`{...props}`) **não** faz checagem de excesso de propriedades: uma prop com nome errado passa pelo `tsc` e some em silêncio. Declare props explicitamente em componente que recebe callback.
- Paleta: `#0092FF` (ação), `#00FFFF` (destaque no escuro), `#000D38`/`#002060`/`#00061A` (fundos escuros). Sempre estilizar claro e escuro.
- API pelo `NEXT_PUBLIC_API_URL` (padrão `http://localhost:8000`), token JWT em `localStorage.access_token`.

## Segurança: este CRM é de produção

Não há ambiente de testes. Todo negócio, atividade e nota que você tocar é real e é do trabalho do usuário.

- **Não faça escrita no Pipedrive (POST/PUT/DELETE) sem autorização explícita para aquela ação.** Aprovação para um teste não vale para o seguinte.
- Ao tocar no Pipedrive, informe na resposta o que foi feito, os **IDs** afetados e em que estado ficaram.
- Prefira **dry-run**: as funções de busca (`encontrar_atividade_da_reuniao`, `buscar_negocio_por_nome`) são só GET e mostram o que a automação *faria*. Foi assim que os cenários de vínculo foram validados sem gravar nada.
- A API tem limite de requisição e já derrubou o dashboard nesta base. Ao rodar bateria de testes, use `asyncio.sleep(0.2)` entre chamadas e diga quantas foram.
- `POST /toggle-ignore` numa transcrição vinculada **apaga a nota e a atividade do Pipedrive**. Não é só esconder um card.

## Especificações

Decisões de produto e as medições que as sustentam ficam em `docs/superpowers/specs/`. Antes de mexer em vínculo de atividade, ficha cadastral, dashboard ou agenda, leia o spec correspondente — vários registram o que foi **medido e descartado**, e o motivo. `AGENTS.md` (idêntico a `GEMINI.md`) tem as mesmas regras de Pipedrive resumidas.
