# Design — `/login-preview2` (campo de partículas)

**Data:** 2026-08-26
**Status:** aprovado, pronto para implementação

## Objetivo

Criar uma segunda página de preview/testes de login, isolada, adaptando o bloco
`auth/login` do registry `devl.dev` para a identidade visual do sistema.

A referência substitui a animação `FloatingPaths` da `/login-preview` por um
**campo de partículas em canvas** que reage ao cursor, à digitação e ao envio do
formulário.

Nada em `/login` (produção) ou `/login-preview` é alterado.

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
| `frontend/src/app/login-preview2/page.tsx` | Rota isolada |
| `frontend/src/components/particle-field.tsx` | Motor de partículas portado |
| `frontend/src/components/auth-shell-particles.tsx` | Split layout + coluna esquerda + contexto do impulso |
| `frontend/src/components/auth-page-particles.tsx` | Formulário |
| `frontend/public/rt-monogram.png` | Monograma RT recortado, quadrado |

Nomes deliberadamente distintos de `auth-page.tsx` e `floating-paths.tsx` para
não colidir com a `/login-preview` existente.

## Asset: monograma RT

Gerado a partir de `frontend/public/logo-rt-horizontal-white.png` (1558×400,
RGBA, branco sobre transparente).

Análise de ocupação por coluna (alpha > 128) identificou blocos:

```
  0 .. 610   → monograma RT
645 .. 1254  → "Robson"/"Tavernard"
...
```

O vão de 34px (611–644) separa a marca do texto de forma limpa. Recorte em
`x ∈ [0, 610]`, depois padding simétrico até ficar quadrado, centralizado.

Script de geração fica em `scripts/` para ser reproduzível (decodificador PNG
puro com `zlib`, sem dependência nova).

## Motor de partículas

Portado **sem alterar a física**:

| Parâmetro | Valor |
|---|---|
| `spring` | 0.035 |
| `damping` | 0.86 |
| `mouseForce` | 90 |
| `mouseRadius` | 110 |
| `sampleStep` | 3 |
| `threshold` | 34 |
| `dotSize` | 1 |

Alterações em relação ao original:

1. Remover `adaptToTheme` / `useDocumentDark` — nosso sistema é dark-only.
2. **Cor por brilho:** o original usa um único `ctx.fillStyle`. Estendemos para
   interpolar por luminância do pixel de origem: pixels claros → ciano `#00FFFF`,
   escuros → azul da marca `#0092FF`. A cor é resolvida na amostragem e guardada
   por partícula, não recalculada por frame.
3. Remover o `morphTo` e o efeito de troca de `src` — só existe uma figura aqui.
   Reduz a superfície do componente sem perder nada usado.

### Interações preservadas

- **Hover:** cursor repele partículas num raio de 110px; a mola devolve.
- **Digitação:** `onKeyDown` no form chama `bumpParticleTypingImpulse` →
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

## Formulário

Segue o padrão de `/login` e `/login-preview`.

**Removido da referência:** magic link, OAuth Google/Apple, separador "or", dica
de teclado `⌘↵`, marca d'água "Sean's scratch pad".

**Mantido da referência:** split layout, sobrancelha mono em caixa alta com
`tracking-[0.3em]`, heading grande, bloco de legenda no rodapé da coluna esquerda.

**Campos:** E-mail Corporativo e Senha de Acesso, com ícones `Mail` / `Lock`,
toggle de olho, botão "Entrar no Sistema" com `ArrowRight`, aviso de acesso
restrito e selo `ShieldCheck`.

## Comportamento

Submit **simulado** — `setTimeout` de 600ms, sem chamada de API. É uma página de
refinamento visual; não autentica e não redireciona.

Como consequência: o campo de senha não trafega credencial nenhuma, e a página
não deve ser linkada de nenhum fluxo de produção.

## Responsivo

A coluna de partículas é `hidden lg:block`, igual ao original e à
`/login-preview`. Abaixo de `lg` sobra só o formulário centralizado, com o logo
no topo.

## Fora de escopo

- Alterar `/login` ou `/login-preview`
- Autenticação real
- Suporte a tema claro
- Troca de figura / morph entre imagens
