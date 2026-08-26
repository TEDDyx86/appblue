# Design — Tela de login com campo de partículas

**Data:** 2026-08-26
**Status:** implementado e promovido para produção em `/login`

> Este documento nasceu como spec da rota de preview `/login-preview2`. Depois da
> validação visual, o design foi promovido a tela de login oficial e as rotas de
> preview foram removidas. O texto abaixo reflete o estado final.

## Objetivo

Substituir a tela de login do sistema por um layout dividido, com um **campo de
partículas em canvas** na coluna esquerda que reage ao cursor, à digitação e ao
envio do formulário.

## Origem da referência

- URL: `https://www.devl.dev/c/auth/login`
- Registry shadcn público: `https://www.devl.dev/r/auth/login.json`
- Fonte completa extraída: `login.tsx`, `auth-shell.tsx`, `particle-field.tsx`,
  `auth-split-layout.tsx`

O bloco original depende de `@orbit/ui` / `@coss/*` (Button, Input, Label,
Separator, Kbd), que não existem aqui. O `particle-field.tsx` é **autocontido** —
React + canvas 2D puro, zero dependência nova.

## Arquivos

| Arquivo | Papel |
|---|---|
| `frontend/src/app/login/page.tsx` | Rota oficial de login |
| `frontend/src/components/auth-page.tsx` | Formulário + autenticação |
| `frontend/src/components/auth-shell.tsx` | Split layout e coluna de partículas |
| `frontend/src/components/particle-field.tsx` | Motor de partículas |
| `frontend/public/rt-monogram.png` | Monograma RT recortado, quadrado |
| `scripts/gerar-monograma.js` | Gera o monograma a partir do logo horizontal |
| `scripts/png-lite.js` | Decodificador/codificador PNG (só `zlib`) |

### Removidos na promoção

Rotas `/login-preview` e `/login-preview2`, e os componentes que ficaram sem
nenhum importador: `floating-paths.tsx`, `logo.tsx`, `auth-divider.tsx`,
`apple-icon.tsx`, `github-icon.tsx`, `google-icon.tsx`, `ui/input-group.tsx`,
`ui/textarea.tsx`.

`ui/button.tsx`, `ui/input.tsx` e `lib/utils.ts` foram **mantidos** mesmo sem
importadores: são as primitivas base do shadcn e o helper `cn`, e o projeto tem
`components.json` configurado. Removê-los quebraria o próximo `shadcn add`.

## Asset: monograma RT

Gerado a partir de `frontend/public/logo-rt-horizontal-white.png` (1558×400,
RGBA, branco sobre transparente).

A análise de ocupação por coluna (alpha > 128) encontra o vão que separa a marca
do texto:

```
  0 .. 610   → monograma RT
645 .. 1254  → "Robson" / "Tavernard"
```

O script localiza esse vão em tempo de execução em vez de fixar o `x`, para
sobreviver a uma troca do arquivo de logo. Recorta, centraliza e aplica 12% de
margem, resultando em 758×758.

## Motor de partículas

Parâmetros ajustados em relação ao bloco original:

| Parâmetro | Original | Aqui | Motivo |
|---|---|---|---|
| `mouseForce` | 90 | 105 | silhueta cheia resiste mais que a figura pontilhada |
| `mouseRadius` | 110 | 145 | com 110 a cavidade ficava pequena demais para ler como interação |
| `sampleStep` | 3 | 2 | recupera o detalhe interno do monograma (contorno do R) |
| `renderScale` | 1 | 0.72 | mantém a figura longe do bloco de legenda |
| `spring` | 0.035 | 0.035 | — |
| `damping` | 0.86 | 0.86 | — |
| `threshold` | 34 | 34 | — |

Alterações no motor:

1. Remover `adaptToTheme` / `useDocumentDark` — nosso sistema é dark-only.
   Elimina o `useSyncExternalStore` e o `MutationObserver`.
2. Remover o `morphTo` e o efeito de troca de `src` — só existe uma figura aqui.
3. **Prop `densidade`.** O original deriva a densidade da luminância, o que só
   funciona com imagens em tons de cinza. Nosso monograma é branco chapado
   (luminância 255 uniforme), então todo pixel cairia na faixa "manter tudo" e a
   figura viraria um bloco sólido de ~16k partículas. A densidade explícita
   (0.45) devolve a textura granulada do original e mantém o custo por frame sob
   controle.
4. **Gradiente radial, não por luminância.** Pelo mesmo motivo do item 3: uma
   silhueta chapada não tem variação de brilho para mapear em cor. O eixo do
   gradiente é a distância normalizada até o centroide da figura, elevada a 1.6
   para enviesar a escala em direção ao núcleo.
5. **Paleta de 3 paradas** (`cores`): `#FFFFFF` → `#00FFFF` → `#0092FF`, do
   núcleo para a borda. Duas paradas deixavam a figura escura demais contra o
   fundo — o original tem o contraste de pontos brancos sobre preto, que a nossa
   paleta azul sozinha não alcança.
6. Variação aleatória de tamanho e opacidade por partícula, já que a luminância
   não fornece nenhuma.

A paleta é quantizada em 14 baldes e as partículas ficam **ordenadas por balde**,
para trocar `fillStyle` uma vez por cor em vez de uma vez por partícula — a troca
de estado é o gargalo do canvas 2D.

### Interações

- **Hover:** o cursor repele partículas num raio de 145px; a mola devolve.
- **Digitação:** `onKeyDown` no form chama `bumpParticleTypingImpulse` → o
  impulso decai 7% por frame, gerando drift, cintilação e onda a partir do centro.
- **Submit:** `pulseParticleSubmitImpulse` → pulso duplo (0.52, depois 0.2 após
  120ms).

## Cores

| Elemento | Token |
|---|---|
| Fundo geral | `#00061A` |
| Coluna esquerda | `#000926` |
| Divisória / bordas | `#002060` |
| Campos | `#000D38` |
| Primária (botão, focus ring) | `#0092FF` (hover `#007AFF`) |
| Acento | `#00FFFF` |
| Glows ambiente | `#0092FF/10` e `#001D99/20` |
| Erro | `rose-500/10`, borda `rose-500/30`, texto `rose-300` |

O autofill do Chrome pinta os campos de branco e ignora as classes utilitárias.
A classe `.campo-escuro` em `globals.css` devolve a paleta escura.

## Autenticação

Idêntica à implementação anterior de `/login`, que já estava em produção:

```
POST {NEXT_PUBLIC_API_URL}/api/auth/login  { email, password }
  → localStorage: access_token, refresh_token
  → router.push('/dashboard')
```

Em caso de falha, exibe `err.response.data.detail` (ou uma mensagem genérica) num
banner com `role="alert"` e a animação `shake`.

### Correção incidental: `animate-shake`

A classe `animate-shake` era referenciada nos banners de erro do login antigo,
mas **nunca foi definida** — nem em `tailwind.config.js` nem em `globals.css`. O
banner nunca tremeu. O keyframe agora existe no `tailwind.config.js`.

## Responsivo

A coluna de partículas é `hidden lg:block`. Abaixo de `lg` sobra só o formulário
centralizado, com o logo horizontal no topo.

Verificado pelas regras CSS compiladas (`@media (min-width: 1024px)` aplicando
`.lg:block` e `.lg:hidden`), não visualmente: a janela do Chrome de teste estava
maximizada e não aceitou redimensionamento.

## Estado da verificação

| Item | Situação |
|---|---|
| `tsc --noEmit` | limpo |
| `next build` | compila, 14 rotas |
| Console do navegador | sem erros |
| Hover / digitação / submit | verificados visualmente |
| Login com credencial **inválida** | verificado contra o backend real |
| Login com credencial **válida** | **não verificado** — exige senha real, que o assistente não manipula |

## Fora de escopo

- Suporte a tema claro
- Troca de figura / morph entre imagens
- Recuperação de senha e criação de contas (seguem gerenciadas pelo administrador)
