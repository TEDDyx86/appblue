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


class CabecalhoAmbiguo(Exception):
    """Duas colunas com o mesmo nome normalizado: não dá para saber qual ler."""


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


def _converter(campo: str, bruto: Any, avisos: Optional[List[str]] = None,
               linha: Optional[int] = None) -> Any:
    if campo == "cpf":
        d = _so_digitos(bruto)
        valor = d.zfill(11) if d else None
    elif campo in TEXTO:
        valor = _texto(bruto)
    elif campo in NUMERO:
        valor = _numero(bruto)
    elif campo in INTEIRO:
        valor = _inteiro(bruto)
    elif campo in DATA:
        valor = _data(bruto)
    elif campo in DATA_HORA:
        valor = _data_hora(bruto)
    else:
        valor = _texto(bruto)

    # Valor preenchido que não converteu não pode virar null calado: some da
    # base sem ninguém saber. Vai para avisos, que a tela de conferência mostra.
    if valor is None and bruto is not None and str(bruto).strip() != "" and avisos is not None:
        avisos.append(f"linha {linha}: {campo} ilegível ({bruto!r})")

    return valor


# Abas que a exportação deste próprio sistema gera. Enviar o arquivo tratado no
# lugar do bruto é o engano provável: os dois moram na mesma pasta.
ABAS_DA_BASE_TRATADA = {"1_CLIENTES", "2_APÓLICES_E_COBERTURAS"}


def _recusa_por_coluna(faltando: List[str], exigidas: set, abas: List[str]) -> str:
    """
    Mensagem da recusa por coluna ausente.

    Faltando tudo, o diagnóstico não é "faltam 34 colunas" — é arquivo errado, e
    listar as 34 é a mensagem menos útil possível. Faltando uma ou outra, a
    listagem é exatamente o que resolve, porque indica o que a MAG renomeou.
    """
    if ABAS_DA_BASE_TRATADA & set(abas):
        return (
            "Esta é a base já tratada que o próprio sistema gera (abas "
            "1_CLIENTES e 2_APÓLICES_E_COBERTURAS). A importação precisa do "
            "export bruto da MAG, o arquivo PRODUTOS CONTRATADOS POR PROPOSTA, "
            "com a aba Export."
        )

    if len(faltando) > len(exigidas) / 2:
        return (
            f"Este arquivo não parece o export da MAG: {len(faltando)} das "
            f"{len(exigidas)} colunas esperadas não estão nele. Confira se é o "
            "PRODUTOS CONTRATADOS POR PROPOSTA, na aba Export."
        )

    return "Colunas ausentes: " + ", ".join(faltando)


def ler_export_mag(conteudo: bytes) -> ExportLido:
    """
    Lê o .xlsx da MAG e devolve coberturas normalizadas + clientes agregados.

    Levanta ColunasFaltando ou IdDuplicado — as duas situações em que continuar
    produziria uma base em que ninguém pode confiar.
    """
    wb = openpyxl.load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True)
    abas = list(wb.sheetnames)
    ws = wb[ABA] if ABA in wb.sheetnames else wb.worksheets[0]
    linhas = list(ws.iter_rows(values_only=True))
    wb.close()

    if not linhas:
        raise ColunasFaltando("Planilha vazia.")

    cabecalho = [_normalizar_cabecalho(c) for c in linhas[0]]

    # Cabeçalho duplicado faz a última ocorrência ganhar em silêncio no dict
    # abaixo, e todas as leituras daquele nome passam a ler a coluna errada sem
    # erro nenhum. Recusa é o certo aqui, como em ColunasFaltando/IdDuplicado:
    # continuar produziria uma base em que ninguém pode confiar.
    usadas = {_normalizar_cabecalho(c) for c in COLUNAS_COBERTURA} | {
        _normalizar_cabecalho(c) for c in COLUNAS_CLIENTE
    }
    contagem: Dict[str, int] = {}
    for h in cabecalho:
        contagem[h] = contagem.get(h, 0) + 1
    duplicadas = sorted(h for h, qtd in contagem.items() if qtd > 1 and h in usadas)
    if duplicadas:
        raise CabecalhoAmbiguo("Colunas duplicadas no cabeçalho: " + ", ".join(duplicadas))

    posicao = {h: i for i, h in enumerate(cabecalho)}

    exigidas = usadas
    faltando = sorted(exigidas - set(posicao))
    if faltando:
        raise ColunasFaltando(_recusa_por_coluna(faltando, exigidas, abas))

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
        if not cpf:
            # Item preenchido sem CPF: não tem a quem atribuir a cobertura. Sem
            # esse descarte, setdefault(None, ...) juntaria coberturas de
            # pessoas diferentes num cliente fantasma de chave None, que depois
            # não vira linha válida em base_clientes (PK é cpf).
            r.avisos.append(f"linha {n}: sem CPF, descartada")
            r.linhas_descartadas += 1
            continue
        if item in vistos:
            raise IdDuplicado(f"ITEM CONTRATADO repetido no arquivo: {item} (linha {n})")
        vistos.add(item)

        cob = {
            campo: _converter(campo, bruto(col), r.avisos, n)
            for col, campo in COLUNAS_COBERTURA.items()
        }
        r.coberturas.append(cob)

        c = r.clientes.setdefault(cpf, {
            "cpf": cpf, "total_capital_segurado": 0.0, "total_premio_mensal": 0.0,
            "qtd_coberturas": 0, "_propostas": set(),
        })
        for col, campo in COLUNAS_CLIENTE.items():
            if campo == "cpf":
                continue
            valor = _converter(campo, bruto(col), r.avisos, n)
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
