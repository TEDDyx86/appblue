# Design — Enviar arquivos do Pipedrive para o Google Drive

**Data:** 2026-09-01
**Status:** aprovado, não implementado

## Objetivo

Levar os arquivos anexados a uma pessoa ou negócio do Pipedrive para uma pasta
no Google Drive nomeada com o cliente, **com revisão antes do envio**: o sistema
lista o que encontrou, o usuário escolhe o que sobe.

Não é uma varredura automática. A cota diária da API do Pipedrive é finita — e já
foi esgotada uma vez durante o desenvolvimento do dashboard — então cada consulta
acontece por decisão explícita do usuário, sobre um cliente por vez.

## Por que não usar a sincronização nativa do Pipedrive

Verificado na documentação oficial:

- Guarda tudo numa pasta única, **não cria pasta por cliente**
- **Não migra o que já existe**, vale só dali para frente
- **Anexos de e-mail ficam de fora**, permanecem no storage do Pipedrive
- Acopla os dois lados: apagar no Drive apaga no Pipedrive

## Bloqueio encontrado e resolvido no desenho

A integração atual com o Drive usa uma **Service Account**
(`tactiq-automation@robotic-rampart-506419-u4.iam.gserviceaccount.com`).

Medido na conta real:

```
storageQuota.limit : "0"        ← sem armazenamento próprio
Drives compartilhados : nenhum
```

Teste prático executado contra a pasta `Briefing - Tactiq`:

| Operação | Resultado |
|---|---|
| Criar subpasta | **OK** — pastas não consomem cota |
| Upload de arquivo | **403 `storageQuotaExceeded`** |

A Service Account vira **dona** do que cria, e arquivos são cobrados da cota do
dono. Como a cota dela é zero, todo upload falha. Ler o Drive continua
funcionando (é assim que as transcrições chegam hoje), porque leitura não
consome cota.

O caminho normal seria um **Drive compartilhado**, que é dono dos próprios
arquivos. Mas a conta que hospeda a pasta é `robson.vieira89@gmail.com` — um
**Gmail pessoal**, e Drives compartilhados são exclusivos do Google Workspace.

### Decisão: OAuth do usuário para o caminho de escrita

O sistema passa a agir **como o Robson** para gravar. Os arquivos ficam na cota
pessoal dele.

A Service Account **não é removida**: ela continua responsável pela leitura das
transcrições, que funciona. São dois caminhos com credenciais distintas, cada um
com o mínimo necessário.

Escopo do OAuth: **`drive.file`**, não `drive` completo. Ele dá acesso apenas aos
arquivos e pastas que a própria aplicação criar — o sistema não enxerga o resto
do Drive pessoal, o que é bem mais seguro do que o acesso total que a Service
Account tem hoje.

## Escopo dos arquivos

Somente arquivos com `deal_id` ou `person_id` — os que alguém anexou
deliberadamente a um registro.

Censo da conta (2.200+ arquivos):

| | |
|---|---|
| Anexos de e-mail (`mail_message_id`) | ~99% |
| Imagens (`img`, em geral logo de assinatura) | 1.722 |
| Com vínculo a negócio/pessoa | 11 nos 100 mais recentes |

Anexos de e-mail ficam de fora porque **não têm vínculo com pessoa ou negócio** —
não há como saber de qual cliente cada um é. Incluí-los replicaria milhares de
imagens de assinatura no Drive.

Confirmado que anexos reais carregam **`deal_id` e `person_id` juntos**, o que
permite agrupar por cliente. Exemplo verificado: negócio 632, 7 arquivos.

## Fluxo

Duas etapas, com decisão humana no meio.

### 1. Listar

O usuário informa um cliente. O sistema consulta
`GET /persons/{id}/files` e `GET /deals/{id}/files`, filtra os que já foram
enviados antes, e devolve a lista: nome, tipo, tamanho, negócio de origem, data.

Nada é baixado nem gravado nesta etapa.

### 2. Enviar

O usuário marca o que quer e confirma. Para cada arquivo selecionado:

1. Baixa do Pipedrive
2. Garante que a pasta do cliente existe no Drive (cria se não existir)
3. Sobe o arquivo
4. Registra o envio para não repetir

## Estrutura no Drive

Uma pasta raiz nova, `Clientes - Pipedrive`, com uma subpasta plana por pessoa:

```
Clientes - Pipedrive/
  Leandro Magalhães/
    proposta-assinada.pdf
  Radilson Carlos/
    apolice.pdf
```

O nome vem do `person_name` do Pipedrive. A raiz é separada da
`Briefing - Tactiq` para não misturar transcrições com documentos de cliente.

**Homônimos:** se dois clientes tiverem o mesmo nome, caem na mesma pasta. O
registro de controle guarda o `person_id`, então dá para detectar e tratar
depois — fica anotado como limitação conhecida, não resolvida nesta versão.

## Idempotência

Tabela nova no Supabase, `drive_uploads`:

| coluna | uso |
|---|---|
| `pipedrive_file_id` | chave, evita reenvio |
| `pipedrive_person_id` | de quem é |
| `drive_file_id` | o que foi criado |
| `drive_folder_id` | onde |
| `uploaded_at` | quando |

Na etapa de listagem, os arquivos já presentes nessa tabela aparecem marcados
como enviados. Rodar duas vezes não duplica nada.

## Componentes

### Backend (`backend/main.py`)

| Endpoint | Papel |
|---|---|
| `GET /api/drive/oauth/iniciar` | devolve a URL de consentimento |
| `GET /api/drive/oauth/callback` | troca o código pelo refresh token e guarda |
| `GET /api/pipedrive/clientes/{person_id}/arquivos` | lista, marcando os já enviados |
| `POST /api/drive/enviar-arquivos` | recebe os ids escolhidos e executa |

Mais um helper `get_google_drive_service_usuario()`, ao lado do
`get_google_drive_service()` que já existe e permanece para a leitura.

### Frontend

Uma seção na tela de Ficha Cadastral (`/cadastros`), que já trabalha sobre uma
pessoa do Pipedrive: busca o cliente, lista os arquivos com checkbox, mostra os
já enviados desabilitados, e um botão de enviar os selecionados.

## Riscos e o que falta verificar

**1. O download do Pipedrive não foi exercitado.** A documentação da API tem uma
ressalva confusa: diz que "não suporta download, mas devolve uma URL". Existe
`GET /files/{id}/download`, mas só a *listagem* foi validada. **Se esse endpoint
não funcionar como esperado, o resto da feature não se sustenta** — é o primeiro
item a testar na implementação.

Não foi possível verificar agora porque a cota diária do Pipedrive está esgotada
(`429`, `Retry-After` ~12h).

**2. Volume real de arquivos elegíveis não medido.** A amostra dos 100 mais
recentes tinha 11. O total exigiria paginar os 2.200+ arquivos, o que a cota não
permite no momento.

**3. Cota de armazenamento do Robson.** Uma conta Gmail gratuita tem 15 GB
compartilhados entre Drive, Gmail e Fotos. Vale conferir o espaço livre antes de
enviar volume grande.

## Fora de escopo

- Anexos de e-mail
- Sincronização automática ou agendada
- Migração para Google Workspace
- Remover a Service Account do caminho de leitura
- Tratar clientes homônimos
