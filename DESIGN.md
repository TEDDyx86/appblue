# Design System: Blue3 Investimentos

<!-- impeccable:design-schema 1 -->

## Brand Identity & Aesthetic World

A identidade visual da plataforma é diretamente derivada do ecossistema oficial da **Blue3 Investimentos** (`blue3investimentos.com.br`), combinando a sofisticação do Private Wealth Management com a precisão tecnológica de alta performance.

- **Vibe Geral**: Executivo, limpo, moderno, tecnológico e altamente escaneável (*Operate Mode*).
- **Contraste & Hierarquia**: Fundo escuro azul-marinho profundo (`#000D38` / `#0A1128`) para navegação e headers, superfícies neutras de alta legibilidade (`#F8FAFC` / `#FFFFFF`), e acentos marcantes no icônico **Azul Elétrico Blue3 (`#0092FF`)** e **Ciano Highlighter (`#00FFFF`)**.

---

## Palette & Color Tokens (Blue3 High-End Wealth Palette)

### 1. Primary Blues (Marca & Ações)
- **Blue3 Primary Blue**: `#0092FF` (`--brand--primary-blue` / `--blues--blue-4--100`) — Ações principais, botões primários, links ativos, badges de destaque.
- **Blue3 Vivid Cyan**: `#00FFFF` (`--blues--blue-5--100`) — Glows, indicadores de status ativos, detalhes de alta precisão.
- **Blue3 Royal Blue**: `#001D99` (`--blues--blue-3--100`) — Hover em botões primários, gradientes corporativos.
- **Blue3 Corporate Navy**: `#002060` (`--blues--blue-2--100`) — Cabeçalhos, cartões institucionais.
- **Blue3 Midnight Deep**: `#000D38` (`--blues--blue-1--100`) — Sidebar, headers contrastados, superfícies premium.
- **Blue3 Deep Canvas (Dark)**: `#00061A` — Fundo principal do modo escuro.

### 2. Wealth & Status Tokens
- **Wealth Gold (Patrimonial & Sucessório)**: `#F59E0B` / `#FBBF24` (Dourado Âmbar Sucessório) / Fundo: `bg-amber-500/10` / Glow: `shadow-[0_0_16px_rgba(245,158,11,0.3)]`.
- **Success / Sincronizado**: `#10B981` (Emerald Mint) / Fundo: `#ECFDF5` (`bg-emerald-50`)
- **Warning / Atenção**: `#F59E0B` (Amber) / Fundo: `#FFFBEB` (`bg-amber-50`)
- **Danger / Negócio Parado**: `#FF3366` / `#EF4444` (Coral Rose) / Fundo: `bg-rose-500/10` (`bg-rose-50`)
- **Pipedrive Badge**: `#0092FF` (Azul Blue3) / Fundo: `#EFF6FF` (`bg-blue-50`)
- **Tactiq Badge**: `#8B5CF6` (Roxo / IA) / Fundo: `#F5F3FF` (`bg-purple-50`)
- **Drive Badge**: `#059669` (Esmeralda / Docs) / Fundo: `#ECFDF5`

### 3. Ambient Glows & Elevation
- **Glow Blue**: `shadow-[0_0_20px_rgba(0,146,255,0.35)]`
- **Glow Cyan**: `shadow-[0_0_16px_rgba(0,255,255,0.40)]`
- **Glow Wealth Gold**: `shadow-[0_0_16px_rgba(245,158,11,0.35)]`
- **Card Luxury**: Gradiente suave de fundo adaptativo claro/escuro.

---

## Typography & Rhythm (Official Blue3 Typography System)

- **Display & Headings**: `Plus Jakarta Sans` (Geometria moderna, sólida e imponente, fiel à *Helvetica Now* / *Commuter Sans* da Blue3)
- **Body & Data Tables**: `Inter` (Máxima escaneabilidade e clareza de leitura operacional, com *tabular numbers*)
- **Code & Numbers / CRM IDs**: `JetBrains Mono` (Para IDs de Deal, relógios e código embed do Iframe)
- **Hierarchy Tokens**:
  - `Display / Page Title`: `text-2xl font-extrabold tracking-tight text-[#000D38] font-display`
  - `Section Heading`: `text-base font-bold text-slate-900 font-display`
  - `Card Metric Number`: `text-3xl font-extrabold text-[#000D38] font-display tnum`
  - `Card Heading`: `text-sm font-bold text-slate-900 font-display`
  - `Body / Briefings`: `text-xs font-normal text-slate-600 leading-relaxed font-sans`
  - `Meta / Captions / Badges`: `text-[10px] font-bold uppercase tracking-wider font-display`
  - `Mono / Code / Time`: `text-xs font-mono font-semibold font-mono`

---

## Components & Micro-interactions

- **Sidebar**: Fundo `#000D38` com gradiente sutil para `#002060`, logo com brilho `#0092FF`, itens ativos com fundo `#0092FF/15`, texto `#0092FF` e borda de destaque `#0092FF`.
- **Buttons Primary**: Fundo `#0092FF`, hover `#007AFF` / `#001D99`, texto `#FFFFFF`, cantos `rounded-xl`, sombra suave `shadow-sm shadow-blue-500/20`.
- **Buttons Secondary**: Fundo `#FFFFFF`, borda `border-slate-200`, texto `#000D38`, hover `bg-slate-50`.
- **Cards**: `bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all duration-200`.
- **Modals**: Backdrop com blur suave `backdrop-blur-xs bg-slate-950/60`, container `rounded-2xl shadow-2xl`.

---

## Craft & Quality Floor (WCAG AAA)

- Todos os textos e números possuem contraste mínimo de 4.5:1 (e 7:1 em elementos principais).
- Estados de foco e hover claros em todos os botões e atalhos de 1 clique.
- Sem elementos genéricos: cada card possui tipografia equilibrada, espaçamento simétrico e hierarquia visual evidente.
