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

### O backend é um arquivo só

`backend/main.py` tem ~5.400 linhas, dividido por comentários `# ====`. Não há ORM nem camada de repositório: os endpoints chamam `supabase.table(...)` e `httpx` direto. Para achar código, procure pelo cabeçalho da seção (`PIPEDRIVE INTEGRATION`, `VÍNCULO: transcrição -> atividade`, etc.), não por arquivo.

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
