# Base de Clientes — Plano de Implementação

> **Para quem executa:** use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** importar semanalmente o export de apólices da MAG, reconciliar contra o que já existe, e usar a base para gerar fila de ligação.

**Arquitetura:** o `.xlsx` é lido e normalizado em memória, comparado contra `base_clientes`/`base_coberturas`, e o diff é gravado em `base_importacoes.diff_json` com status `aguardando_confirmacao`. Nada toca as tabelas de dado antes de o usuário confirmar. A página `/base-clientes` tem quatro abas.

**Tech:** FastAPI + `openpyxl` no backend, Supabase (Postgres) para persistência, Next.js 14 App Router no frontend. Spec: `docs/superpowers/specs/2026-09-10-base-de-clientes-design.md`.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `schema_base_clientes.sql` | as três tabelas, índices e RLS |
| `backend/base_clientes/planilha.py` | ler o `.xlsx` e normalizar (é onde o bug do ID morre) |
| `backend/base_clientes/reconciliacao.py` | comparar contra o banco e montar o diff |
| `backend/base_clientes/consultas.py` | dashboard, fila de oportunidade, clientes, export |
| `backend/base_clientes/__init__.py` | reexporta a API pública do pacote |
| `backend/main.py` | as rotas (é onde a autenticação existe) |
| `backend/test_base_clientes.py` | testes contra as duas planilhas reais |
| `frontend/src/app/base-clientes/page.tsx` | casca com o submenu de quatro abas |
| `frontend/src/components/base/AbaFila.tsx` | upload e conferência |
| `frontend/src/components/base/AbaDashboard.tsx` | números + fila de oportunidade |
| `frontend/src/components/base/AbaClientes.tsx` | busca e detalhe |
| `frontend/src/components/base/AbaExportar.tsx` | gera o `.xlsx` de duas abas |
| `frontend/src/components/Sidebar.tsx` | novo item de menu |

Pacote separado de `main.py` seguindo o precedente de `assistente.py`, registrado no `CLAUDE.md`. Cada módulo tem uma responsabilidade e cabe em contexto.

---

## Task 1: Schema das três tabelas

**Files:**
- Create: `schema_base_clientes.sql`

- [ ] **Passo 1: escrever o SQL**

```sql
-- ============================================================================
-- BASE DE CLIENTES — import reconciliado do export MAG
-- Execute na console SQL do Supabase.
-- ============================================================================

-- Uma linha por arquivo enviado. Guarda o diff calculado até a confirmação.
CREATE TABLE IF NOT EXISTS base_importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao'
    CHECK (status IN ('aguardando_confirmacao', 'aplicada', 'descartada')),
  linhas_arquivo INTEGER,
  linhas_descartadas INTEGER,
  diff_json JSONB,
  enviado_por UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  aplicada_em TIMESTAMP WITH TIME ZONE
);

-- Grão: CPF. Os quatro primeiros números são agregados das coberturas.
CREATE TABLE IF NOT EXISTS base_clientes (
  cpf VARCHAR(11) PRIMARY KEY,
  nome VARCHAR(255),
  telefone VARCHAR(60),
  email VARCHAR(255),
  endereco TEXT,
  sexo VARCHAR(20),
  data_nascimento DATE,
  profissao VARCHAR(255),
  renda NUMERIC(14,2),
  qtd_filhos INTEGER,
  total_capital_segurado NUMERIC(16,2),
  total_premio_mensal NUMERIC(14,2),
  qtd_propostas INTEGER,
  qtd_coberturas INTEGER,
  ultima_importacao_id UUID REFERENCES base_importacoes(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Grão: item de cobertura.
-- item_contratado é TEXT e nunca numérico: tem 18 dígitos e não cabe em
-- float64. No tratamento manual antigo virava notação científica e o ID ficava
-- corrompido, inviabilizando a reconciliação.
CREATE TABLE IF NOT EXISTS base_coberturas (
  item_contratado TEXT PRIMARY KEY,
  cpf VARCHAR(11) NOT NULL,
  nome_segurado VARCHAR(255),
  proposta TEXT,
  produto VARCHAR(255),
  status_cobertura VARCHAR(80),
  capital_segurado NUMERIC(16,2),
  premio_atual NUMERIC(14,2),
  premio_mensalizado NUMERIC(14,2),
  premio_anualizado NUMERIC(14,2),
  premio_implantado_liquido NUMERIC(14,2),
  iof_implantado NUMERIC(14,2),
  periodicidade VARCHAR(30),
  forma_pagamento VARCHAR(60),
  dia_vencimento INTEGER,
  data_entrada TIMESTAMP WITH TIME ZONE,
  inicio_vigencia DATE,
  fim_vigencia DATE,
  tempo_contribuicao INTEGER,
  prazo_decrescimo INTEGER,
  prazo_diferimento INTEGER,
  am VARCHAR(60),
  produtor_principal VARCHAR(255),
  corretor_pj VARCHAR(255),
  corretor_estruturado VARCHAR(255),
  unidade_producao VARCHAR(120),
  oferta_comercial VARCHAR(255),
  ultima_importacao_id UUID REFERENCES base_importacoes(id),
  visto_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_base_coberturas_cpf ON base_coberturas(cpf);
CREATE INDEX IF NOT EXISTS idx_base_coberturas_status ON base_coberturas(status_cobertura);
CREATE INDEX IF NOT EXISTS idx_base_clientes_nome ON base_clientes(nome);
CREATE INDEX IF NOT EXISTS idx_base_importacoes_status ON base_importacoes(status);

ALTER TABLE base_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_clientes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_coberturas ENABLE ROW LEVEL SECURITY;

CREATE POLICY svc_base_importacoes ON base_importacoes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY svc_base_clientes    ON base_clientes    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY svc_base_coberturas  ON base_coberturas  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Passo 2: executar no Supabase**

Cole na console SQL do Supabase e execute. Confirme que as três tabelas aparecem em Table Editor.

- [ ] **Passo 3: commit**

```bash
git add schema_base_clientes.sql
git commit -m "feat(base-clientes): schema das tres tabelas"
```

---

## Task 2: Leitura e normalização da planilha

**Files:**
- Create: `backend/base_clientes/__init__.py`, `backend/base_clientes/planilha.py`
- Create: `backend/test_base_clientes.py`
- Modify: `backend/requirements.txt`

- [ ] **Passo 1: escrever o teste que falha**

Crie `backend/test_base_clientes.py`:

```python
"""
Testes da Base de Clientes contra as duas planilhas reais.

Rodar: backend/venv/Scripts/python.exe test_base_clientes.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.
"""

import io
import os
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from base_clientes.planilha import ler_export_mag

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BRUTA = os.path.join(RAIZ, "PRODUTOS CONTRATADOS POR PROPOSTA - VIDA INDIVIDUAL (16).xlsx")

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:52} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def teste_leitura():
    print("\n=== leitura e normalizacao ===")
    with open(BRUTA, "rb") as f:
        r = ler_export_mag(f.read())

    checar("coberturas lidas", len(r.coberturas), 371)
    checar("clientes agregados", len(r.clientes), 209)
    checar("linhas descartadas (vazias no rodape)", r.linhas_descartadas, 3)

    c = r.coberturas[0]
    checar("item_contratado e str", isinstance(c["item_contratado"], str), True)
    checar("item_contratado sem notacao cientifica", "e+" in c["item_contratado"], False)
    checar("item_contratado integro", c["item_contratado"], "112023223239210591")
    checar("cpf com 11 digitos", len(c["cpf"]), 11)
    checar("cpf com zero a esquerda", c["cpf"], "07286584707")

    cli = r.clientes["07286584707"]
    checar("agregado: qtd_coberturas", cli["qtd_coberturas"], 1)
    checar("agregado: capital segurado", round(cli["total_capital_segurado"], 2), 456902.55)


if __name__ == "__main__":
    teste_leitura()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `ModuleNotFoundError: No module named 'base_clientes'`

- [ ] **Passo 3: adicionar openpyxl ao requirements**

Em `backend/requirements.txt`, abaixo de `pypdf>=4.0.0`, acrescente:

```
openpyxl>=3.1.0
```

E instale:

```bash
cd backend && venv/Scripts/python.exe -m pip install openpyxl
```

- [ ] **Passo 4: criar o pacote**

`backend/base_clientes/__init__.py`:

```python
"""Base de Clientes: importação reconciliada do export de apólices da MAG."""

from .planilha import ler_export_mag, ExportLido

__all__ = ["ler_export_mag", "ExportLido"]
```

- [ ] **Passo 5: escrever o leitor**

`backend/base_clientes/planilha.py`:

```python
"""
Leitura e normalização do export "PRODUTOS CONTRATADOS POR PROPOSTA".

Duas normalizações não são cosméticas e o resto do sistema depende delas:

1. `ITEM CONTRATADO` é lido como **texto**. Tem 18 dígitos e não cabe na
   precisão de um float64 (15). No tratamento manual antigo virava notação
   científica e o ID ficava corrompido nos 371 registros — sem ID íntegro não há
   reconciliação entre importações, que é o requisito central da feature.

2. O CPF perde o zero à esquerda no export, porque a MAG o trata como número.
   É normalizado para 11 dígitos.
"""

import io
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import openpyxl

ABA = "Export"

# Coluna da planilha -> nome do campo em base_coberturas.
COLUNAS_COBERTURA: Dict[str, str] = {
    "ITEM CONTRATADO": "item_contratado",
    "CPF": "cpf",
    "SEGURADO": "nome_segurado",
    "PROPOSTA": "proposta",
    "PRODUTO": "produto",
    "STATUS ITEM": "status_cobertura",
    "CAPITAL SEGURADO": "capital_segurado",
    "PRÊMIO ATUAL": "premio_atual",
    "PRÊMIO ATUAL MENSALIZADO": "premio_mensalizado",
    "PRÊMIO ATUAL ANUALIZADO": "premio_anualizado",
    "PRÊMIO IMPLANTADO LÍQUIDO": "premio_implantado_liquido",
    "IOF IMPLANTADO": "iof_implantado",
    "PERIODICIDADE": "periodicidade",
    "FORMA COBRANÇA": "forma_pagamento",
    "DIA VENCIMENTO": "dia_vencimento",
    "DATA ENTRADA": "data_entrada",
    "ÍNICIO VIGÊNCIA": "inicio_vigencia",
    "FIM VIGÊNCIA": "fim_vigencia",
    "TEMPO CONTRIBUIÇÃO (ANOS)": "tempo_contribuicao",
    "PRAZO DECRECIMO": "prazo_decrescimo",
    "PRAZO DIFERIMENTO": "prazo_diferimento",
    "AM": "am",
    "PRODUTOR PRINCIPAL": "produtor_principal",
    "CORRETOR PJ": "corretor_pj",
    "CORRETOR ESTRUTURADO": "corretor_estruturado",
    "UNIDADE DE PRODUÇÃO": "unidade_producao",
    "OFERTA COMERCIAL": "oferta_comercial",
}

# Coluna da planilha -> nome do campo em base_clientes (parte não agregada).
COLUNAS_CLIENTE: Dict[str, str] = {
    "CPF": "cpf",
    "SEGURADO": "nome",
    "TELEFONE CLIENTE": "telefone",
    "E-MAIL CLIENTE": "email",
    "ENDEREÇO CLIENTE": "endereco",
    "SEXO CLIENTE": "sexo",
    "DATA NASCIMENTO": "data_nascimento",
    "PROFISSÃO CLIENTE": "profissao",
    "RENDA CLIENTE": "renda",
    "QTD FILHOS": "qtd_filhos",
}

TEXTO = {"item_contratado", "proposta"}
NUMERO = {
    "capital_segurado", "premio_atual", "premio_mensalizado", "premio_anualizado",
    "premio_implantado_liquido", "iof_implantado", "renda",
}
INTEIRO = {"dia_vencimento", "tempo_contribuicao", "prazo_decrescimo",
           "prazo_diferimento", "qtd_filhos"}
DATA = {"inicio_vigencia", "fim_vigencia", "data_nascimento"}
DATA_HORA = {"data_entrada"}


class ColunasFaltando(Exception):
    """A planilha não tem as colunas esperadas — recusar antes de processar."""


class IdDuplicado(Exception):
    """Dois itens com o mesmo ITEM CONTRATADO: sem identidade não há reconciliação."""


@dataclass
class ExportLido:
    coberturas: List[Dict[str, Any]] = field(default_factory=list)
    clientes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    linhas_arquivo: int = 0
    linhas_descartadas: int = 0
    avisos: List[str] = field(default_factory=list)


def _normalizar_cabecalho(v: Any) -> str:
    """Tolera acento e espaço a mais no cabeçalho, sem tolerar coluna errada."""
    s = "".join(
        c for c in unicodedata.normalize("NFKD", str(v or "")) if not unicodedata.combining(c)
    )
    return " ".join(s.split()).strip().upper()


def _so_digitos(v: Any) -> str:
    return "".join(c for c in str(v or "") if c.isdigit())


def _texto(v: Any) -> Optional[str]:
    """
    Converte para texto sem passar por float.

    Um inteiro grande já lido pelo openpyxl como int vira str direto. Se vier
    como float (planilha salva de outro jeito), formata sem notação científica —
    mas isso já indica perda de precisão na origem e entra em avisos.
    """
    if v is None:
        return None
    if isinstance(v, float):
        return f"{v:.0f}"
    return str(v).strip() or None


def _numero(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _inteiro(v: Any) -> Optional[int]:
    n = _numero(v)
    return int(n) if n is not None else None


def _data(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _data_hora(v: Any) -> Optional[datetime]:
    return v if isinstance(v, datetime) else None


def _converter(campo: str, bruto: Any) -> Any:
    if campo == "cpf":
        d = _so_digitos(bruto)
        return d.zfill(11) if d else None
    if campo in TEXTO:
        return _texto(bruto)
    if campo in NUMERO:
        return _numero(bruto)
    if campo in INTEIRO:
        return _inteiro(bruto)
    if campo in DATA:
        return _data(bruto)
    if campo in DATA_HORA:
        return _data_hora(bruto)
    return _texto(bruto)


def ler_export_mag(conteudo: bytes) -> ExportLido:
    """
    Lê o .xlsx da MAG e devolve coberturas normalizadas + clientes agregados.

    Levanta ColunasFaltando ou IdDuplicado — as duas situações em que continuar
    produziria uma base em que ninguém pode confiar.
    """
    wb = openpyxl.load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    ws = wb[ABA] if ABA in wb.sheetnames else wb.worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    wb.close()

    if not linhas:
        raise ColunasFaltando("Planilha vazia.")

    cabecalho = [_normalizar_cabecalho(c) for c in linhas[0]]
    posicao = {h: i for i, h in enumerate(cabecalho)}

    exigidas = {_normalizar_cabecalho(c) for c in COLUNAS_COBERTURA}
    faltando = sorted(exigidas - set(posicao))
    if faltando:
        raise ColunasFaltando("Colunas ausentes: " + ", ".join(faltando))

    r = ExportLido(linhas_arquivo=len(linhas) - 1)
    vistos = set()

    for n, linha in enumerate(linhas[1:], start=2):
        def bruto(coluna: str) -> Any:
            i = posicao.get(_normalizar_cabecalho(coluna))
            return linha[i] if i is not None and i < len(linha) else None

        cpf = _converter("cpf", bruto("CPF"))
        item = _converter("item_contratado", bruto("ITEM CONTRATADO"))
        if not cpf and not item:
            r.linhas_descartadas += 1
            continue
        if not item:
            r.avisos.append(f"linha {n}: sem ITEM CONTRATADO, descartada")
            r.linhas_descartadas += 1
            continue
        if item in vistos:
            raise IdDuplicado(f"ITEM CONTRATADO repetido no arquivo: {item} (linha {n})")
        vistos.add(item)

        cob = {campo: _converter(campo, bruto(col)) for col, campo in COLUNAS_COBERTURA.items()}
        r.coberturas.append(cob)

        c = r.clientes.setdefault(cpf, {
            "cpf": cpf, "total_capital_segurado": 0.0, "total_premio_mensal": 0.0,
            "qtd_coberturas": 0, "_propostas": set(),
        })
        for col, campo in COLUNAS_CLIENTE.items():
            if campo == "cpf":
                continue
            valor = _converter(campo, bruto(col))
            if valor is not None:
                c[campo] = valor
        c["total_capital_segurado"] += cob.get("capital_segurado") or 0.0
        c["total_premio_mensal"] += cob.get("premio_mensalizado") or 0.0
        c["qtd_coberturas"] += 1
        if cob.get("proposta"):
            c["_propostas"].add(cob["proposta"])

    for c in r.clientes.values():
        c["qtd_propostas"] = len(c.pop("_propostas"))

    return r
```

- [ ] **Passo 6: rodar o teste**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `TUDO OK`, com `coberturas lidas=371`, `clientes agregados=209`, `linhas descartadas=3`, `item_contratado='112023223239210591'`, `cpf='07286584707'`.

- [ ] **Passo 7: commit**

```bash
git add backend/base_clientes/ backend/test_base_clientes.py backend/requirements.txt
git commit -m "feat(base-clientes): leitor do export MAG com ID integro"
```

---

## Task 3: Reconciliação (o coração)

**Files:**
- Create: `backend/base_clientes/reconciliacao.py`
- Modify: `backend/test_base_clientes.py`
- Modify: `backend/base_clientes/__init__.py`

- [ ] **Passo 1: escrever o teste que falha**

Acrescente em `backend/test_base_clientes.py`, antes do bloco `if __name__`:

```python
from base_clientes.reconciliacao import calcular_diff


def teste_reconciliacao():
    print("\n=== reconciliacao ===")
    with open(BRUTA, "rb") as f:
        lido = ler_export_mag(f.read())

    # Base vazia: tudo é novo.
    d = calcular_diff(lido, coberturas_atuais={}, clientes_atuais={})
    checar("base vazia: novos", len(d["novos"]), 371)
    checar("base vazia: alterados", len(d["alterados"]), 0)
    checar("base vazia: inalterados", d["inalterados"], 0)

    # Idempotência: importar de novo o que já está gravado não muda nada.
    atuais = {c["item_contratado"]: dict(c) for c in lido.coberturas}
    cli_atuais = {k: dict(v) for k, v in lido.clientes.items()}
    d2 = calcular_diff(lido, coberturas_atuais=atuais, clientes_atuais=cli_atuais)
    checar("reimportacao: novos", len(d2["novos"]), 0)
    checar("reimportacao: alterados", len(d2["alterados"]), 0)
    checar("reimportacao: inalterados", d2["inalterados"], 371)
    checar("reimportacao: sumidos", len(d2["sumidos"]), 0)

    # Um campo comparado muda -> vira alterado.
    alterada = {k: dict(v) for k, v in atuais.items()}
    alvo = lido.coberturas[0]["item_contratado"]
    alterada[alvo]["status_cobertura"] = "REMIDO - D02"
    d3 = calcular_diff(lido, coberturas_atuais=alterada, clientes_atuais=cli_atuais)
    checar("status mudou: alterados", len(d3["alterados"]), 1)
    checar("status mudou: campo certo",
           list(d3["alterados"][0]["campos"]), ["status_cobertura"])

    # Um campo NÃO comparado muda -> continua inalterado (evita ruído semanal).
    ruido = {k: dict(v) for k, v in atuais.items()}
    ruido[alvo]["am"] = "AM9999"
    d4 = calcular_diff(lido, coberturas_atuais=ruido, clientes_atuais=cli_atuais)
    checar("campo nao comparado: alterados", len(d4["alterados"]), 0)

    # Item que existia e não veio -> sumido, e nunca apagado.
    com_extra = {k: dict(v) for k, v in atuais.items()}
    com_extra["999999999999999999"] = {"item_contratado": "999999999999999999", "cpf": "00000000000"}
    d5 = calcular_diff(lido, coberturas_atuais=com_extra, clientes_atuais=cli_atuais)
    checar("sumido detectado", len(d5["sumidos"]), 1)
```

E chame no bloco final:

```python
if __name__ == "__main__":
    teste_leitura()
    teste_reconciliacao()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
```

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `ImportError: cannot import name 'calcular_diff'`

- [ ] **Passo 3: escrever a reconciliação**

`backend/base_clientes/reconciliacao.py`:

```python
"""
Compara o export lido contra o que já está no banco e monta o diff.

Só os campos em CAMPOS_COMPARADOS disparam "alterado". Comparar as 27 colunas
geraria ruído inútil: `DATA STATUS` muda sozinha a cada export e acusaria 371
alterações por semana, tornando a conferência inútil e portanto ignorada.

Nada aqui escreve. A função devolve o diff; aplicar é decisão de quem confere.
"""

from datetime import date, datetime
from typing import Any, Dict, List

from .planilha import ExportLido

CAMPOS_COMPARADOS_COBERTURA = [
    "status_cobertura", "capital_segurado", "premio_atual", "premio_mensalizado",
    "premio_anualizado", "periodicidade", "forma_pagamento", "dia_vencimento",
    "fim_vigencia", "produto",
]

CAMPOS_COMPARADOS_CLIENTE = ["telefone", "email", "endereco", "profissao", "renda"]

# Diferença abaixo disso é arredondamento de float, não mudança de negócio.
TOLERANCIA = 0.01


def _igual(a: Any, b: Any) -> bool:
    if a is None and b is None:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < TOLERANCIA
    if isinstance(a, (date, datetime)) or isinstance(b, (date, datetime)):
        return _texto_data(a) == _texto_data(b)
    return str(a or "").strip() == str(b or "").strip()


def _texto_data(v: Any) -> str:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v or "")[:10]


def _serializavel(v: Any) -> Any:
    """JSONB não aceita date/datetime — o diff é gravado como JSON."""
    if isinstance(v, (date, datetime)):
        return _texto_data(v)
    return v


def _comparar(novo: Dict[str, Any], atual: Dict[str, Any], campos: List[str]) -> Dict[str, list]:
    mudou = {}
    for campo in campos:
        if not _igual(novo.get(campo), atual.get(campo)):
            mudou[campo] = [_serializavel(atual.get(campo)), _serializavel(novo.get(campo))]
    return mudou


def calcular_diff(
    lido: ExportLido,
    coberturas_atuais: Dict[str, Dict[str, Any]],
    clientes_atuais: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Devolve {inalterados, novos, alterados, sumidos, avisos, clientes}.

    `sumidos` são itens que estavam no banco e não vieram nesta planilha. Eles
    são sinalizados e **nunca apagados**: a causa é ambígua (cancelamento ou
    recorte diferente do export) e apagar por engano não tem volta.
    """
    novos, alterados = [], []
    inalterados = 0
    vistos = set()

    for cob in lido.coberturas:
        chave = cob["item_contratado"]
        vistos.add(chave)
        atual = coberturas_atuais.get(chave)
        if atual is None:
            novos.append({
                "chave": chave,
                "cpf": cob.get("cpf"),
                "nome": cob.get("nome_segurado"),
                "produto": cob.get("produto"),
                "capital_segurado": cob.get("capital_segurado"),
                "status": cob.get("status_cobertura"),
            })
            continue
        campos = _comparar(cob, atual, CAMPOS_COMPARADOS_COBERTURA)
        if campos:
            alterados.append({
                "chave": chave,
                "cpf": cob.get("cpf"),
                "nome": cob.get("nome_segurado"),
                "campos": campos,
            })
        else:
            inalterados += 1

    sumidos = [
        {"chave": k, "cpf": (v or {}).get("cpf"), "nome": (v or {}).get("nome_segurado")}
        for k, v in coberturas_atuais.items()
        if k not in vistos
    ]

    clientes_novos, clientes_alterados = [], []
    for cpf, cli in lido.clientes.items():
        atual = clientes_atuais.get(cpf)
        if atual is None:
            clientes_novos.append({"chave": cpf, "nome": cli.get("nome")})
        else:
            campos = _comparar(cli, atual, CAMPOS_COMPARADOS_CLIENTE)
            if campos:
                clientes_alterados.append({"chave": cpf, "nome": cli.get("nome"), "campos": campos})

    return {
        "inalterados": inalterados,
        "novos": novos,
        "alterados": alterados,
        "sumidos": sumidos,
        "avisos": lido.avisos,
        "clientes": {"novos": clientes_novos, "alterados": clientes_alterados},
    }
```

E em `backend/base_clientes/__init__.py`:

```python
"""Base de Clientes: importação reconciliada do export de apólices da MAG."""

from .planilha import ler_export_mag, ExportLido, ColunasFaltando, IdDuplicado
from .reconciliacao import calcular_diff

__all__ = [
    "ler_export_mag", "ExportLido", "ColunasFaltando", "IdDuplicado", "calcular_diff",
]
```

- [ ] **Passo 4: rodar o teste**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `TUDO OK`. O resultado que importa é `reimportacao: inalterados=371` — é a idempotência pedida, medida.

- [ ] **Passo 5: commit**

```bash
git add backend/base_clientes/ backend/test_base_clientes.py
git commit -m "feat(base-clientes): reconciliacao com os quatro baldes"
```

---

## Task 4: Rotas de importação

**Files:**
- Create: `backend/base_clientes/persistencia.py`
- Modify: `backend/main.py` (antes do bloco `# MAIN`)

- [ ] **Passo 1: escrever a persistência**

`backend/base_clientes/persistencia.py`:

```python
"""
Grava e lê as três tabelas. Isolado para que planilha.py e reconciliacao.py
continuem puros — eles não conhecem Supabase e são testáveis sem banco.
"""

from datetime import date, datetime
from typing import Any, Dict, List


def _para_banco(d: Dict[str, Any]) -> Dict[str, Any]:
    saida = {}
    for k, v in d.items():
        if k.startswith("_"):
            continue
        if isinstance(v, datetime):
            saida[k] = v.isoformat()
        elif isinstance(v, date):
            saida[k] = v.isoformat()
        else:
            saida[k] = v
    return saida


def carregar_estado_atual(supabase) -> tuple:
    """Devolve (coberturas_por_item, clientes_por_cpf) do que já está gravado."""
    cob, pagina = {}, 0
    while True:
        r = (
            supabase.table("base_coberturas").select("*")
            .range(pagina * 1000, pagina * 1000 + 999).execute()
        )
        for linha in r.data or []:
            cob[linha["item_contratado"]] = linha
        if not r.data or len(r.data) < 1000:
            break
        pagina += 1

    cli = {}
    r = supabase.table("base_clientes").select("*").limit(5000).execute()
    for linha in r.data or []:
        cli[linha["cpf"]] = linha
    return cob, cli


def aplicar_importacao(supabase, importacao_id: str, lido) -> Dict[str, int]:
    """
    Grava clientes e coberturas. Upsert pela chave primária.

    Não apaga nada: o que sumiu do export permanece na base, sinalizado no diff.
    """
    clientes = [
        _para_banco({**c, "ultima_importacao_id": importacao_id})
        for c in lido.clientes.values()
    ]
    coberturas = [
        _para_banco({
            **c,
            "ultima_importacao_id": importacao_id,
            "visto_em": datetime.utcnow().isoformat(),
        })
        for c in lido.coberturas
    ]

    for i in range(0, len(clientes), 200):
        supabase.table("base_clientes").upsert(clientes[i:i + 200], on_conflict="cpf").execute()
    for i in range(0, len(coberturas), 200):
        supabase.table("base_coberturas").upsert(
            coberturas[i:i + 200], on_conflict="item_contratado"
        ).execute()

    return {"clientes": len(clientes), "coberturas": len(coberturas)}
```

- [ ] **Passo 2: acrescentar as rotas em `backend/main.py`**

Imediatamente antes do bloco `# ============ # MAIN`:

```python
# ============================================================================
# BASE DE CLIENTES
# ============================================================================
#
# A lógica vive no pacote `base_clientes`; aqui ficam as rotas, porque é aqui
# que a autenticação existe.

import base_clientes as _base
from base_clientes.persistencia import carregar_estado_atual, aplicar_importacao


@app.post("/api/base/importar")
async def base_importar(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    """
    Recebe o .xlsx, calcula o diff e guarda aguardando confirmação.

    NÃO grava em base_clientes/base_coberturas — só o diff. Aplicar é um
    segundo passo, explícito.
    """
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Envie um arquivo .xlsx")

    conteudo = await file.read()
    try:
        lido = _base.ler_export_mag(conteudo)
    except _base.ColunasFaltando as e:
        raise HTTPException(status_code=400, detail=str(e))
    except _base.IdDuplicado as e:
        raise HTTPException(status_code=400, detail=str(e))

    cob_atuais, cli_atuais = carregar_estado_atual(supabase)
    diff = _base.calcular_diff(lido, cob_atuais, cli_atuais)

    res = supabase.table("base_importacoes").insert({
        "arquivo_nome": file.filename,
        "status": "aguardando_confirmacao",
        "linhas_arquivo": lido.linhas_arquivo,
        "linhas_descartadas": lido.linhas_descartadas,
        "diff_json": diff,
        "enviado_por": user.get("id", user.get("sub")),
    }).execute()

    importacao = res.data[0]
    log_audit_event(
        action="BASE_IMPORTACAO_RECEBIDA",
        resource_type="base_importacao",
        resource_id=importacao["id"],
        user_id=user.get("id", user.get("sub")),
        details={
            "arquivo": file.filename,
            "novos": len(diff["novos"]),
            "alterados": len(diff["alterados"]),
            "inalterados": diff["inalterados"],
            "sumidos": len(diff["sumidos"]),
        },
    )
    return {"importacao_id": importacao["id"], **diff,
            "linhas_arquivo": lido.linhas_arquivo,
            "linhas_descartadas": lido.linhas_descartadas}


@app.get("/api/base/importacoes")
async def base_listar_importacoes(user: dict = Depends(get_current_user)):
    """Histórico da fila, sem o diff (que é grande)."""
    r = (
        supabase.table("base_importacoes")
        .select("id, arquivo_nome, status, linhas_arquivo, linhas_descartadas, created_at, aplicada_em")
        .order("created_at", desc=True).limit(50).execute()
    )
    return {"itens": r.data or []}


@app.get("/api/base/importacoes/{importacao_id}")
async def base_detalhe_importacao(importacao_id: str, user: dict = Depends(get_current_user)):
    r = supabase.table("base_importacoes").select("*").eq("id", importacao_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Importação não encontrada")
    return r.data[0]


@app.post("/api/base/importacoes/{importacao_id}/aplicar")
async def base_aplicar(
    importacao_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    """
    Aplica a importação conferida.

    O arquivo é reenviado porque o conteúdo não é guardado no banco — só o diff.
    O diff serve para conferir; a fonte da verdade continua sendo a planilha.
    """
    r = supabase.table("base_importacoes").select("*").eq("id", importacao_id).execute()
    if not r.data:
        raise HTTPException(status_code=404, detail="Importação não encontrada")
    if r.data[0]["status"] != "aguardando_confirmacao":
        raise HTTPException(status_code=409, detail="Esta importação já foi resolvida.")

    conteudo = await file.read()
    lido = _base.ler_export_mag(conteudo)
    contagem = aplicar_importacao(supabase, importacao_id, lido)

    supabase.table("base_importacoes").update({
        "status": "aplicada",
        "aplicada_em": datetime.utcnow().isoformat(),
    }).eq("id", importacao_id).execute()

    log_audit_event(
        action="BASE_IMPORTACAO_APLICADA",
        resource_type="base_importacao",
        resource_id=importacao_id,
        user_id=user.get("id", user.get("sub")),
        details=contagem,
    )
    return {"status": "aplicada", **contagem}


@app.post("/api/base/importacoes/{importacao_id}/descartar")
async def base_descartar(importacao_id: str, user: dict = Depends(require_admin)):
    supabase.table("base_importacoes").update({"status": "descartada"}).eq(
        "id", importacao_id
    ).execute()
    log_audit_event(
        action="BASE_IMPORTACAO_DESCARTADA",
        resource_type="base_importacao",
        resource_id=importacao_id,
        user_id=user.get("id", user.get("sub")),
    )
    return {"status": "descartada"}
```

- [ ] **Passo 3: verificar que o backend sobe**

```bash
cd backend && venv/Scripts/python.exe -c "from dotenv import load_dotenv; load_dotenv('.env'); import main; print('ok')"
```
Esperado: `ok`

- [ ] **Passo 4: commit**

```bash
git add backend/base_clientes/persistencia.py backend/main.py
git commit -m "feat(base-clientes): rotas de importacao, conferencia e aplicacao"
```

---

## Task 5: Consultas do dashboard e da fila

**Files:**
- Create: `backend/base_clientes/consultas.py`
- Modify: `backend/main.py`
- Modify: `backend/test_base_clientes.py`

- [ ] **Passo 1: escrever o teste que falha**

Acrescente em `backend/test_base_clientes.py`:

```python
from base_clientes.consultas import montar_fila_oportunidade, RIDERS


def teste_fila():
    print("\n=== fila de oportunidade ===")
    with open(BRUTA, "rb") as f:
        lido = ler_export_mag(f.read())

    clientes = list(lido.clientes.values())
    coberturas = lido.coberturas
    fila = montar_fila_oportunidade(clientes, coberturas)

    checar("cobertura unica: 162 clientes", len(fila["cobertura_unica"]), 162)
    checar("lacuna: todos os clientes com renda", len(fila["maior_lacuna"]), 209)

    # A fila de lacuna é ordenada decrescente por reais, não filtrada.
    valores = [c["lacuna"] for c in fila["maior_lacuna"]]
    checar("lacuna ordenada decrescente", valores == sorted(valores, reverse=True), True)
    checar("riders conhecidos", len(RIDERS), 3)
    checar("parou de pagar (REMIDO) detectado", len(fila["parou_de_pagar"]) > 0, True)

    # O MESMO dicionario vindo do Supabase: NUMERIC volta string, DATE volta
    # "1976-05-04". Sem coercao a fila funciona aqui e quebra em producao.
    como_banco = [
        {**c, "renda": str(c.get("renda") or 0),
         "total_capital_segurado": str(c.get("total_capital_segurado") or 0),
         "data_nascimento": (c["data_nascimento"].isoformat()
                             if c.get("data_nascimento") else None)}
        for c in clientes
    ]
    cob_banco = [{**c, "capital_segurado": str(c.get("capital_segurado") or 0)} for c in coberturas]
    fila_banco = montar_fila_oportunidade(como_banco, cob_banco)
    checar("vindo do banco: mesma cobertura unica",
           len(fila_banco["cobertura_unica"]), len(fila["cobertura_unica"]))
    checar("vindo do banco: mesma lacuna",
           len(fila_banco["maior_lacuna"]), len(fila["maior_lacuna"]))
    checar("vindo do banco: mesmos aniversariantes",
           len(fila_banco["aniversariantes"]), len(fila["aniversariantes"]))
```

E chame `teste_fila()` no bloco `__main__`.

- [ ] **Passo 2: rodar e ver falhar**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `ImportError: cannot import name 'montar_fila_oportunidade'`

- [ ] **Passo 3: escrever as consultas**

`backend/base_clientes/consultas.py`:

```python
"""
Consultas que alimentam o dashboard.

A fila de oportunidade é o produto da feature. Ela ordena, não filtra: medindo
contra a base real, qualquer limiar absoluto de "subsegurado" marcaria de 56% a
96% dos clientes, e uma lista com 201 de 209 nomes não é prioridade — é a lista
de clientes com outro nome. A mediana da carteira é 1,7x a renda anual.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional

# Riders vendáveis presentes na carteira, por trecho identificador do produto.
RIDERS = {
    "DOENÇAS GRAVES": "Doenças Graves Plus",
    "IPA COM MAJORAÇÃO": "IPA com Majoração + IFPD",
    "DIH ADICIONAL": "DIH Adicional UTI",
}

# Referência de mercado para cobertura de vida. Só decide a ORDEM da fila —
# errar reordena a lista, não exclui ninguém nem inunda de falso positivo.
REFERENCIA_RENDA_ANUAL = 10


def _num(v: Any) -> float:
    """
    Coerção obrigatória, não defensiva.

    O mesmo dicionário chega por dois caminhos: recém-lido da planilha (float e
    `date` de verdade) ou vindo do Supabase, onde `NUMERIC` volta como string e
    `DATE` como `"1976-05-04"`. Sem coagir, a fila funciona no teste e quebra em
    produção — que é o pior lugar para descobrir.
    """
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _data(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str) and len(v) >= 10:
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def _riders_do_cliente(coberturas: List[Dict[str, Any]]) -> set:
    tem = set()
    for c in coberturas:
        produto = (c.get("produto") or "").upper()
        for chave, nome in RIDERS.items():
            if chave in produto:
                tem.add(nome)
    return tem


def montar_fila_oportunidade(
    clientes: List[Dict[str, Any]], coberturas: List[Dict[str, Any]]
) -> Dict[str, List[Dict[str, Any]]]:
    por_cpf: Dict[str, List[Dict[str, Any]]] = {}
    for c in coberturas:
        por_cpf.setdefault(c.get("cpf"), []).append(c)

    cobertura_unica, maior_lacuna, aniversariantes, parou_de_pagar = [], [], [], []
    hoje = date.today()

    for cli in clientes:
        cpf = cli.get("cpf")
        minhas = por_cpf.get(cpf, [])
        base = {
            "cpf": cpf,
            "nome": cli.get("nome"),
            "telefone": cli.get("telefone"),
            "profissao": cli.get("profissao"),
        }

        if len(minhas) == 1:
            faltam = [n for n in RIDERS.values() if n not in _riders_do_cliente(minhas)]
            cobertura_unica.append({
                **base,
                "produto_atual": minhas[0].get("produto"),
                "riders_que_faltam": faltam,
            })

        # Parou de pagar: status atual da cobertura, não o diff. Assim o card
        # continua correto mesmo quem entrou como REMIDO na primeira importação.
        remidas = [c for c in minhas if "REMIDO" in (c.get("status_cobertura") or "").upper()]
        if remidas:
            parou_de_pagar.append({
                **base,
                "coberturas": [c.get("produto") for c in remidas],
                "capital_parado": round(sum(_num(c.get("capital_segurado")) for c in remidas), 2),
            })

        renda = _num(cli.get("renda"))
        capital = _num(cli.get("total_capital_segurado"))
        if renda > 0:
            renda_anual = renda * 12
            maior_lacuna.append({
                **base,
                "renda_mensal": renda,
                "capital_segurado": capital,
                "razao_renda_anual": round(capital / renda_anual, 2),
                "lacuna": round(renda_anual * REFERENCIA_RENDA_ANUAL - capital, 2),
            })

        nasc = _data(cli.get("data_nascimento"))
        if nasc and nasc.month == hoje.month:
            aniversariantes.append({**base, "dia": nasc.day, "idade": hoje.year - nasc.year})

    maior_lacuna.sort(key=lambda x: x["lacuna"], reverse=True)
    parou_de_pagar.sort(key=lambda x: x["capital_parado"], reverse=True)
    aniversariantes.sort(key=lambda x: x["dia"])
    cobertura_unica.sort(key=lambda x: x["nome"] or "")

    return {
        "cobertura_unica": cobertura_unica,
        "parou_de_pagar": parou_de_pagar,
        "maior_lacuna": maior_lacuna,
        "aniversariantes": aniversariantes,
    }


def montar_resumo(clientes: List[Dict[str, Any]], coberturas: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "clientes": len(clientes),
        "coberturas": len(coberturas),
        "capital_segurado_total": round(sum(_num(c.get("capital_segurado")) for c in coberturas), 2),
        "premio_anualizado_total": round(
            sum(_num(c.get("premio_mensalizado")) for c in coberturas) * 12, 2
        ),
    }
```

- [ ] **Passo 4: rodar o teste**

```bash
cd backend && venv/Scripts/python.exe test_base_clientes.py
```
Esperado: `TUDO OK`, com `cobertura unica: 162 clientes`.

- [ ] **Passo 5: acrescentar as rotas de leitura em `backend/main.py`**

Logo abaixo de `base_descartar`:

```python
from base_clientes.consultas import montar_fila_oportunidade, montar_resumo


def _carregar_base() -> tuple:
    cob, cli = carregar_estado_atual(supabase)
    return list(cli.values()), list(cob.values())


@app.get("/api/base/dashboard")
async def base_dashboard(user: dict = Depends(get_current_user)):
    clientes, coberturas = _carregar_base()
    ultima = (
        supabase.table("base_importacoes").select("diff_json, created_at")
        .eq("status", "aplicada").order("created_at", desc=True).limit(1).execute()
    )
    mudancas = 0
    if ultima.data:
        d = ultima.data[0].get("diff_json") or {}
        mudancas = len(d.get("novos") or []) + len(d.get("alterados") or [])

    return {
        "resumo": {**montar_resumo(clientes, coberturas), "mudancas_ultima_importacao": mudancas},
        "fila": montar_fila_oportunidade(clientes, coberturas),
    }


@app.get("/api/base/clientes")
async def base_clientes_listar(busca: str = "", user: dict = Depends(get_current_user)):
    q = supabase.table("base_clientes").select("*")
    if busca.strip():
        termo = f"%{busca.strip()}%"
        q = q.or_(f"nome.ilike.{termo},cpf.ilike.{termo},profissao.ilike.{termo}")
    r = q.order("nome").limit(200).execute()
    return {"itens": r.data or []}


@app.get("/api/base/clientes/{cpf}")
async def base_cliente_detalhe(cpf: str, user: dict = Depends(get_current_user)):
    c = supabase.table("base_clientes").select("*").eq("cpf", cpf).execute()
    if not c.data:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    cob = supabase.table("base_coberturas").select("*").eq("cpf", cpf).execute()
    return {"cliente": c.data[0], "coberturas": cob.data or []}
```

- [ ] **Passo 6: commit**

```bash
git add backend/base_clientes/consultas.py backend/main.py backend/test_base_clientes.py
git commit -m "feat(base-clientes): fila de oportunidade ordenada por lacuna em reais"
```

---

## Task 6: Exportação

**Files:**
- Create: `backend/base_clientes/exportacao.py`
- Modify: `backend/main.py`

- [ ] **Passo 1: escrever o gerador**

`backend/base_clientes/exportacao.py`:

```python
"""Gera o .xlsx de duas abas, no mesmo formato do tratamento manual antigo."""

import io
from datetime import date, datetime
from typing import Any, Dict, List

import openpyxl

ABA_CLIENTES = [
    ("cpf", "CPF"), ("nome", "Nome do Cliente"), ("telefone", "Telefone / WhatsApp"),
    ("email", "E-mail"), ("total_capital_segurado", "Total Capital Segurado (R$)"),
    ("total_premio_mensal", "Total Prêmio Mensal (R$)"), ("qtd_propostas", "Qtd Propostas"),
    ("qtd_coberturas", "Qtd Coberturas"), ("profissao", "Profissão"),
    ("renda", "Renda Declarada (R$)"), ("data_nascimento", "Data Nascimento"),
    ("sexo", "Sexo"), ("qtd_filhos", "Qtd Filhos"), ("endereco", "Endereço Completo"),
]

ABA_COBERTURAS = [
    ("cpf", "CPF Cliente"), ("nome_segurado", "Nome Segurado"), ("proposta", "Nº Proposta"),
    ("item_contratado", "ID Item Cobertura"), ("produto", "Produto / Cobertura"),
    ("status_cobertura", "Status Cobertura"), ("capital_segurado", "Capital Segurado (R$)"),
    ("premio_atual", "Prêmio Atual (R$)"), ("premio_mensalizado", "Prêmio Mensalizado (R$)"),
    ("premio_anualizado", "Prêmio Anualizado (R$)"),
    ("premio_implantado_liquido", "Prêmio Implantado Líquido (R$)"),
    ("iof_implantado", "IOF Implantado (R$)"), ("periodicidade", "Periodicidade"),
    ("forma_pagamento", "Forma de Pagamento"), ("dia_vencimento", "Dia Vencimento"),
    ("data_entrada", "Data Entrada Proposta"), ("inicio_vigencia", "Início Vigência"),
    ("fim_vigencia", "Fim Vigência"), ("tempo_contribuicao", "Tempo Contribuição (Anos)"),
    ("prazo_decrescimo", "Prazo Decréscimo"), ("prazo_diferimento", "Prazo Diferimento"),
    ("am", "AM (Account Manager)"), ("produtor_principal", "Produtor Principal (Emissão)"),
    ("corretor_pj", "Corretor PJ"), ("corretor_estruturado", "Corretor Estruturado"),
    ("unidade_producao", "Unidade Produção"), ("oferta_comercial", "Oferta Comercial"),
]


def _celula(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v
    return v


def _escrever(ws, colunas, linhas):
    ws.append([rotulo for _, rotulo in colunas])
    for item in linhas:
        ws.append([_celula(item.get(campo)) for campo, _ in colunas])
    # ID e CPF como texto: são identificadores, não números. Sem isso o Excel
    # reintroduz a notação científica que esta feature existe para evitar.
    for col, (campo, _) in enumerate(colunas, start=1):
        if campo in ("item_contratado", "cpf", "proposta"):
            for linha in range(2, ws.max_row + 1):
                ws.cell(row=linha, column=col).number_format = "@"


def gerar_xlsx(clientes: List[Dict[str, Any]], coberturas: List[Dict[str, Any]]) -> bytes:
    wb = openpyxl.Workbook()
    ws1 = wb.active
    ws1.title = "1_CLIENTES"
    _escrever(ws1, ABA_CLIENTES, sorted(clientes, key=lambda c: c.get("nome") or ""))
    ws2 = wb.create_sheet("2_APÓLICES_E_COBERTURAS")
    _escrever(ws2, ABA_COBERTURAS, sorted(coberturas, key=lambda c: c.get("nome_segurado") or ""))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
```

- [ ] **Passo 2: acrescentar a rota em `backend/main.py`**

```python
from fastapi.responses import Response
from base_clientes.exportacao import gerar_xlsx


@app.get("/api/base/exportar")
async def base_exportar(user: dict = Depends(get_current_user)):
    clientes, coberturas = _carregar_base()
    conteudo = gerar_xlsx(clientes, coberturas)
    nome = f"BASE_MAG_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return Response(
        content=conteudo,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )
```

- [ ] **Passo 3: verificar**

```bash
cd backend && venv/Scripts/python.exe -c "
from base_clientes.exportacao import gerar_xlsx
b = gerar_xlsx([{'cpf':'07286584707','nome':'TESTE'}], [{'item_contratado':'112023223239210591','cpf':'07286584707'}])
open('/tmp/t.xlsx','wb').write(b)
import openpyxl; wb=openpyxl.load_workbook('/tmp/t.xlsx')
print(wb.sheetnames)
print(wb['2_APÓLICES_E_COBERTURAS'].cell(row=2,column=4).value)
"
```
Esperado: `['1_CLIENTES', '2_APÓLICES_E_COBERTURAS']` e `112023223239210591` — íntegro, sem notação científica.

- [ ] **Passo 4: commit**

```bash
git add backend/base_clientes/exportacao.py backend/main.py
git commit -m "feat(base-clientes): exportacao xlsx com ID preservado como texto"
```

---

## Task 7: Menu e casca da página

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx:38-44`
- Create: `frontend/src/app/base-clientes/page.tsx`

- [ ] **Passo 1: acrescentar o item de menu**

Em `frontend/src/components/Sidebar.tsx`, no array de itens, depois da linha de `/cadastros`:

```tsx
    { href: '/base-clientes', label: 'Base de Clientes', icon: Database },
```

E acrescente `Database` ao import de `lucide-react` no topo do arquivo.

- [ ] **Passo 2: criar a casca com o submenu**

`frontend/src/app/base-clientes/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Database, Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/ThemeContext'
import AbaDashboard from '@/components/base/AbaDashboard'
import AbaClientes from '@/components/base/AbaClientes'
import AbaFila from '@/components/base/AbaFila'
import AbaExportar from '@/components/base/AbaExportar'

type Aba = 'dashboard' | 'clientes' | 'fila' | 'exportar'

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'dashboard', rotulo: 'Dashboard' },
  { id: 'clientes', rotulo: 'Clientes' },
  { id: 'fila', rotulo: 'Fila de processamento' },
  { id: 'exportar', rotulo: 'Exportar dados' },
]

export default function BaseClientesPage() {
  const router = useRouter()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aba, setAba] = useState<Aba>('dashboard')

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-[#00061A] text-[#000D38] dark:text-slate-100 font-sans overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onLogout={() => {
          localStorage.removeItem('access_token')
          router.push('/login')
        }}
      />
      <main className={`flex-1 overflow-y-auto transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 bg-white/80 dark:bg-[#000D38]/80 backdrop-blur-md border-b border-slate-200 dark:border-[#002060]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF]">
              <Database className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Base de Clientes
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Carteira MAG — importação semanal reconciliada
              </p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Alternar tema"
            className="p-2 rounded-xl border border-slate-200 dark:border-[#002060] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#002060] transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        <div className="p-6 max-w-7xl mx-auto space-y-6">
          <div role="tablist" aria-label="Seções da Base de Clientes"
               className="inline-flex p-1 rounded-2xl bg-slate-100 dark:bg-[#000D38] border border-slate-200 dark:border-[#002060]">
            {ABAS.map(({ id, rotulo }) => (
              <button
                key={id}
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`painel-${id}`}
                onClick={() => setAba(id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0092FF] ${
                  aba === id
                    ? 'bg-white dark:bg-[#002060] text-[#0092FF] dark:text-[#00FFFF] shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <div id={`painel-${aba}`} role="tabpanel" aria-labelledby={`aba-${aba}`}>
            {aba === 'dashboard' && <AbaDashboard />}
            {aba === 'clientes' && <AbaClientes />}
            {aba === 'fila' && <AbaFila />}
            {aba === 'exportar' && <AbaExportar />}
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Passo 3: criar stubs para as quatro abas**

Para o typecheck passar antes das próximas tarefas, crie cada arquivo com um placeholder mínimo. **Estes stubs são substituídos nas Tasks 8–11 — não deixe nenhum para trás.**

`frontend/src/components/base/AbaDashboard.tsx`, `AbaClientes.tsx`, `AbaFila.tsx`, `AbaExportar.tsx`, cada um com (trocando o nome):

```tsx
'use client'
export default function AbaDashboard() {
  return <p className="text-sm text-slate-500 dark:text-slate-400">Em construção.</p>
}
```

- [ ] **Passo 4: typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
```
Esperado: sem saída.

- [ ] **Passo 5: commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/app/base-clientes/ frontend/src/components/base/
git commit -m "feat(base-clientes): menu e casca com submenu de quatro abas"
```

---

## Task 8: Aba Fila de processamento

**Files:**
- Modify: `frontend/src/components/base/AbaFila.tsx`

Esta é a aba mais importante: é por onde o dado entra. O caso comum — poucas mudanças numa importação semanal — precisa ser resolvível em segundos.

- [ ] **Passo 1: escrever o componente**

Substitua o stub de `frontend/src/components/base/AbaFila.tsx`:

```tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { UploadCloud, Check, X, Loader2, AlertTriangle } from 'lucide-react'

interface Diff {
  importacao_id: string
  inalterados: number
  novos: any[]
  alterados: any[]
  sumidos: any[]
  avisos: string[]
  linhas_arquivo: number
  linhas_descartadas: number
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

export default function AbaFila() {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [historico, setHistorico] = useState<any[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const input = useRef<HTMLInputElement | null>(null)

  const carregarHistorico = async () => {
    try {
      const r = await axios.get(`${API}/api/base/importacoes`, { headers: cab() })
      setHistorico(r.data.itens || [])
    } catch {
      /* histórico é secundário; não bloqueia a tela */
    }
  }

  useEffect(() => { carregarHistorico() }, [])

  const enviar = async (f: File) => {
    setOcupado(true); setErro(''); setDiff(null)
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await axios.post(`${API}/api/base/importar`, fd, { headers: cab() })
      setDiff(r.data); setArquivo(f)
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Não foi possível ler a planilha.')
    } finally {
      setOcupado(false)
    }
  }

  const aplicar = async () => {
    if (!diff || !arquivo) return
    setOcupado(true); setErro('')
    const fd = new FormData()
    fd.append('file', arquivo)
    try {
      await axios.post(`${API}/api/base/importacoes/${diff.importacao_id}/aplicar`, fd, { headers: cab() })
      setDiff(null); setArquivo(null); carregarHistorico()
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Falha ao aplicar.')
    } finally {
      setOcupado(false)
    }
  }

  const descartar = async () => {
    if (!diff) return
    await axios.post(`${API}/api/base/importacoes/${diff.importacao_id}/descartar`, {}, { headers: cab() })
    setDiff(null); setArquivo(null); carregarHistorico()
  }

  return (
    <div className="space-y-6">
      {!diff && (
        <div
          onClick={() => input.current?.click()}
          className="border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer border-slate-300 dark:border-[#002060] bg-white dark:bg-[#000D38] hover:border-[#0092FF] transition-colors"
        >
          <input ref={input} type="file" accept=".xlsx" className="hidden"
                 onChange={(e) => e.target.files?.[0] && enviar(e.target.files[0])} />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[#0092FF] to-[#002060] text-white flex items-center justify-center">
            {ocupado ? <Loader2 className="w-7 h-7 animate-spin" /> : <UploadCloud className="w-7 h-7" />}
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-white font-display">
            {ocupado ? 'Lendo a planilha...' : 'Arraste o export da MAG aqui'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Nada é gravado antes da sua confirmação.
          </p>
        </div>
      )}

      {erro && (
        <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-600 dark:text-rose-300">
          {erro}
        </div>
      )}

      {diff && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Sem mudança', diff.inalterados, 'text-slate-500'],
              ['Novos', diff.novos.length, 'text-emerald-600 dark:text-emerald-400'],
              ['Alterados', diff.alterados.length, 'text-amber-600 dark:text-amber-400'],
              ['Sumiram', diff.sumidos.length, 'text-rose-600 dark:text-rose-400'],
            ].map(([rotulo, valor, cor]) => (
              <div key={rotulo as string} className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-4">
                <p className="text-[10px] uppercase font-bold text-slate-400">{rotulo}</p>
                <p className={`text-2xl font-extrabold tnum ${cor}`}>{valor as number}</p>
              </div>
            ))}
          </div>

          {diff.novos.length > 0 && (
            <Secao titulo={`${diff.novos.length} novos`}>
              {diff.novos.slice(0, 50).map((n) => (
                <li key={n.chave} className="py-1.5 text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold">{n.nome}</span> — {n.produto}
                </li>
              ))}
            </Secao>
          )}

          {diff.alterados.length > 0 && (
            <Secao titulo={`${diff.alterados.length} alterados`}>
              {diff.alterados.slice(0, 50).map((a) => (
                <li key={a.chave} className="py-1.5 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{a.nome}</span>
                  {Object.entries(a.campos).map(([campo, par]: any) => (
                    <span key={campo} className="block text-slate-500 dark:text-slate-400 ml-3">
                      {campo}: <span className="text-rose-500">{String(par[0])}</span> → <span className="text-emerald-500">{String(par[1])}</span>
                    </span>
                  ))}
                </li>
              ))}
            </Secao>
          )}

          {diff.sumidos.length > 0 && (
            <Secao titulo={`${diff.sumidos.length} não vieram nesta planilha`}>
              <li className="text-[11px] text-slate-500 dark:text-slate-400 pb-2">
                Nada é apagado. Pode ser cancelamento ou recorte diferente do export.
              </li>
              {diff.sumidos.slice(0, 50).map((s) => (
                <li key={s.chave} className="py-1 text-xs text-slate-600 dark:text-slate-300">{s.nome}</li>
              ))}
            </Secao>
          )}

          {diff.avisos.length > 0 && (
            <Secao titulo={`${diff.avisos.length} avisos de leitura`}>
              {diff.avisos.map((a, i) => (
                <li key={i} className="py-1 text-xs text-amber-600 dark:text-amber-400">{a}</li>
              ))}
            </Secao>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Aplica tudo ou nada. Se algo estiver errado, descarte e suba o arquivo corrigido.
            </span>
            <div className="flex items-center gap-2">
              <button onClick={descartar} disabled={ocupado}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-[#002060] text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#002060] disabled:opacity-40">
                <X className="w-3.5 h-3.5" /> Descartar
              </button>
              <button onClick={aplicar} disabled={ocupado}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 disabled:opacity-40">
                {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Aplicar importação
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2">Importações anteriores</h3>
        <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] divide-y divide-slate-100 dark:divide-[#002060]/60">
          {historico.length === 0 && (
            <p className="p-4 text-xs text-slate-500 dark:text-slate-400">Nenhuma importação ainda.</p>
          )}
          {historico.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
              <span className="truncate text-slate-700 dark:text-slate-300">{h.arquivo_nome}</span>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span className="text-slate-400">{(h.created_at || '').slice(0, 10)}</span>
                <span className={`font-bold ${h.status === 'aplicada' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {h.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details open className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] px-4 py-3">
      <summary className="text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">{titulo}</summary>
      <ul className="mt-2 max-h-64 overflow-y-auto">{children}</ul>
    </details>
  )
}
```

- [ ] **Passo 2: typecheck**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
```
Esperado: sem saída.

- [ ] **Passo 3: testar no navegador**

Suba backend e frontend, abra `/base-clientes`, aba "Fila de processamento", e envie `PRODUTOS CONTRATADOS POR PROPOSTA - VIDA INDIVIDUAL (16).xlsx`.

Esperado na primeira importação: **Sem mudança 0 · Novos 371 · Alterados 0 · Sumiram 0**.
Aplique. Envie o mesmo arquivo de novo.
Esperado na segunda: **Sem mudança 371 · Novos 0 · Alterados 0 · Sumiram 0**.

Essa segunda tela é a prova visual da idempotência.

- [ ] **Passo 4: commit**

```bash
git add frontend/src/components/base/AbaFila.tsx
git commit -m "feat(base-clientes): tela de conferencia com os quatro baldes"
```

---

## Task 9: Aba Dashboard

**Files:**
- Modify: `frontend/src/components/base/AbaDashboard.tsx`

- [ ] **Passo 1: escrever o componente**

```tsx
'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { Phone, Loader2 } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })

const reais = (v: number) =>
  (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function AbaDashboard() {
  const [dados, setDados] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    axios.get(`${API}/api/base/dashboard`, { headers: cab() })
      .then((r) => setDados(r.data))
      .finally(() => setCarregando(false))
  }, [])

  if (carregando) {
    return <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</p>
  }
  if (!dados) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma importação aplicada ainda. Comece pela aba "Fila de processamento".</p>
  }

  const r = dados.resumo
  const f = dados.fila

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile rotulo="Capital segurado" valor={reais(r.capital_segurado_total)} />
        <Tile rotulo="Prêmio anualizado" valor={reais(r.premio_anualizado_total)} />
        <Tile rotulo="Clientes" valor={String(r.clientes)} />
        <Tile rotulo="Mudanças na última base" valor={String(r.mudancas_ultima_importacao)} />
      </div>

      <Fila titulo={`Cobertura única — ${f.cobertura_unica.length} clientes`}
            subtitulo="Têm uma apólice só. A coluna mostra o que dá para oferecer.">
        {f.cobertura_unica.slice(0, 30).map((c: any) => (
          <Linha key={c.cpf} nome={c.nome} telefone={c.telefone}
                 detalhe={c.riders_que_faltam.join(' · ') || 'já tem todos os riders'} />
        ))}
      </Fila>

      {f.parou_de_pagar.length > 0 && (
        <Fila titulo={`Pararam de pagar — ${f.parou_de_pagar.length}`}
              subtitulo="Coberturas com status REMIDO. Ligação do dia.">
          {f.parou_de_pagar.map((c: any) => (
            <Linha key={c.cpf} nome={c.nome} telefone={c.telefone}
                   detalhe={`${c.coberturas.join(' · ')} · ${reais(c.capital_parado)} parados`} />
          ))}
        </Fila>
      )}

      <Fila titulo="Maior lacuna de cobertura"
            subtitulo="Ordenado pela diferença em reais para 10× a renda anual. Não é filtro — todos aparecem.">
        {f.maior_lacuna.slice(0, 30).map((c: any) => (
          <Linha key={c.cpf} nome={c.nome} telefone={c.telefone}
                 detalhe={`${c.razao_renda_anual}× a renda anual · lacuna ${reais(c.lacuna)}`} />
        ))}
      </Fila>

      {f.aniversariantes.length > 0 && (
        <Fila titulo={`Aniversariantes do mês — ${f.aniversariantes.length}`} subtitulo="">
          {f.aniversariantes.map((c: any) => (
            <Linha key={c.cpf} nome={c.nome} telefone={c.telefone}
                   detalhe={`dia ${c.dia} · ${c.idade} anos · ${c.profissao || ''}`} />
          ))}
        </Fila>
      )}
    </div>
  )
}

function Tile({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-4">
      <p className="text-[10px] uppercase font-bold text-slate-400">{rotulo}</p>
      <p className="text-xl font-extrabold text-slate-900 dark:text-white tnum mt-0.5">{valor}</p>
    </div>
  )
}

function Fila({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-[#002060]">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">{titulo}</h3>
        {subtitulo && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitulo}</p>}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-[#002060]/60 max-h-96 overflow-y-auto">{children}</ul>
    </section>
  )
}

function Linha({ nome, telefone, detalhe }: { nome: string; telefone: string; detalhe: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">{nome}</span>
        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{detalhe}</span>
      </span>
      {telefone && (
        <a href={`tel:${telefone.replace(/\D/g, '')}`}
           className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#0092FF] dark:text-[#00FFFF] text-[11px] font-bold hover:bg-blue-100 dark:hover:bg-blue-900/60">
          <Phone className="w-3 h-3" aria-hidden="true" />
          {telefone}
        </a>
      )}
    </li>
  )
}
```

- [ ] **Passo 2: typecheck e conferir no navegador**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
```

Abra `/base-clientes`. Esperado após aplicar a importação: capital segurado ≈ **R$ 216.889.839**, clientes **209**, e "Cobertura única — **162** clientes".

- [ ] **Passo 3: commit**

```bash
git add frontend/src/components/base/AbaDashboard.tsx
git commit -m "feat(base-clientes): dashboard com fila de oportunidade"
```

---

## Task 10: Aba Clientes

**Files:**
- Modify: `frontend/src/components/base/AbaClientes.tsx`

- [ ] **Passo 1: escrever o componente**

```tsx
'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { Search, X } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const cab = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` })
const reais = (v: number) =>
  (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export default function AbaClientes() {
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState<any[]>([])
  const [aberto, setAberto] = useState<any>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      axios.get(`${API}/api/base/clientes`, { params: { busca }, headers: cab() })
        .then((r) => setItens(r.data.itens || []))
        .catch(() => setItens([]))
    }, 300)
    return () => clearTimeout(t)
  }, [busca])

  const abrir = async (cpf: string) => {
    const r = await axios.get(`${API}/api/base/clientes/${cpf}`, { headers: cab() })
    setAberto(r.data)
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CPF ou profissão..."
          aria-label="Buscar cliente"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#000D38] border border-slate-200 dark:border-[#002060] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-[#0092FF] outline-none"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] divide-y divide-slate-100 dark:divide-[#002060]/60 overflow-hidden">
        {itens.length === 0 && (
          <p className="p-4 text-xs text-slate-500 dark:text-slate-400">Nenhum cliente encontrado.</p>
        )}
        {itens.map((c) => (
          <button key={c.cpf} onClick={() => abrir(c.cpf)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-[#002060] transition-colors">
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-900 dark:text-white truncate">{c.nome}</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {c.profissao} · {c.qtd_coberturas} cobertura(s)
              </span>
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tnum flex-shrink-0">
              {reais(c.total_capital_segurado)}
            </span>
          </button>
        ))}
      </div>

      {aberto && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#000D38] rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-[#002060] shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-200 dark:border-[#002060]">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white font-display truncate">
                  {aberto.cliente.nome}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {aberto.cliente.telefone} · {aberto.cliente.email}
                </p>
              </div>
              <button onClick={() => setAberto(null)} aria-label="Fechar"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#002060]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5 space-y-2">
              {aberto.coberturas.map((c: any) => (
                <div key={c.item_contratado} className="rounded-xl border border-slate-200 dark:border-[#002060] p-3">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">{c.produto}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {c.status_cobertura} · CS {reais(c.capital_segurado)} · prêmio {reais(c.premio_mensalizado)}/mês
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Passo 2: typecheck e commit**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
git add frontend/src/components/base/AbaClientes.tsx
git commit -m "feat(base-clientes): busca e detalhe do cliente"
```

---

## Task 11: Aba Exportar dados

**Files:**
- Modify: `frontend/src/components/base/AbaExportar.tsx`

- [ ] **Passo 1: escrever o componente**

```tsx
'use client'

import { useState } from 'react'
import axios from 'axios'
import { Download, Loader2 } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function AbaExportar() {
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState('')

  const baixar = async () => {
    setBaixando(true); setErro('')
    try {
      const r = await axios.get(`${API}/api/base/exportar`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `BASE_MAG_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setErro('Não foi possível gerar o arquivo.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-[#002060] bg-white dark:bg-[#000D38] p-6 space-y-3 max-w-xl">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white font-display">
        Exportar a base tratada
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        Gera o <code>.xlsx</code> de duas abas — <strong>1_CLIENTES</strong> e{' '}
        <strong>2_APÓLICES_E_COBERTURAS</strong> — no mesmo formato do tratamento manual.
        O ID da cobertura sai como texto, sem a notação científica que corrompia o arquivo antigo.
      </p>
      {erro && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{erro}</p>
      )}
      <button onClick={baixar} disabled={baixando}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0092FF] hover:bg-[#007AFF] text-white text-xs font-bold shadow-md shadow-[#0092FF]/30 disabled:opacity-40">
        {baixando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Baixar .xlsx
      </button>
    </div>
  )
}
```

- [ ] **Passo 2: typecheck, conferir o download e commit**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json
```

Baixe o arquivo e abra. Confirme que a coluna **ID Item Cobertura** mostra `112023223239210591` inteiro, não `1,12E+17`.

```bash
git add frontend/src/components/base/AbaExportar.tsx
git commit -m "feat(base-clientes): exportacao da base tratada"
```

---

## Task 12: Documentar no CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Passo 1: acrescentar a seção**

Depois da seção "O assistente é somente leitura", acrescente:

```markdown
### Base de Clientes: o ID de 18 dígitos

`backend/base_clientes/` importa o export semanal de apólices da MAG. A regra que
não pode ser quebrada: **`ITEM CONTRATADO` é texto do começo ao fim.** São 18
dígitos e não cabem em `float64` (15) — deixar virar número corrompe o ID
(`...591` vira `...600`) e destrói a reconciliação entre importações. Vale na
leitura, no banco (`TEXT`) e na exportação (`number_format = "@"`).

Nada é gravado antes da confirmação: a importação vira diff em
`base_importacoes.diff_json` e só aplica com o aceite. O que sumiu do export é
sinalizado, **nunca apagado**.

Só os campos em `CAMPOS_COMPARADOS_*` disparam "alterado" — `DATA STATUS` muda
sozinha a cada export e acusaria 371 alterações por semana.

`backend/test_base_clientes.py` roda contra as duas planilhas reais e prova as
duas coisas que importam: fidelidade (371 coberturas, 209 clientes) e
idempotência (reimportar dá 0 alterações).
```

- [ ] **Passo 2: commit**

```bash
git add CLAUDE.md
git commit -m "docs(base-clientes): registrar a regra do ID como texto"
```

---

## Verificação final

- [ ] `cd backend && venv/Scripts/python.exe test_base_clientes.py` → `TUDO OK`
- [ ] `cd frontend && npx tsc --noEmit -p tsconfig.json` → sem saída
- [ ] Importar a planilha real duas vezes seguidas: a segunda mostra **371 sem mudança, 0 novos, 0 alterados**
- [ ] Dashboard mostra R$ 216.889.839, 209 clientes, 162 com cobertura única
- [ ] Export baixado abre com `ID Item Cobertura` íntegro
- [ ] Nenhum stub "Em construção" restou em `frontend/src/components/base/`
