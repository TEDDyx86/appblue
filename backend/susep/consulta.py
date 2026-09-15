"""
Consulta de Condições Gerais no site da SUSEP.

A SUSEP não tem API, mas **não precisa de navegador**. Medido contra o site:

  - a página de consulta é ASP.NET MVC, não WebForms — não há `__VIEWSTATE`
    nem `__EVENTVALIDATION` para carregar entre requisições;
  - a busca é um POST `multipart` de um campo só, e a tabela de resultados vem
    pronta no HTML da resposta, sem JavaScript montando nada;
  - o download é um GET direto que devolve `application/pdf`, e **não exige
    sessão**: o id é identificador público estável, conferido em processo
    separado sem cookie nenhum.

Por isso aqui é `httpx` e não Playwright. A automação anterior subia um Chromium
por consulta (~300 MB, 8–15 s) para obter exatamente o mesmo arquivo que estas
duas requisições trazem em menos de um segundo.

Nada aqui escreve em disco nem em banco: devolve os bytes a quem chamou.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

BASE = "https://www2.susep.gov.br/safe/menumercado/REP2/Produto.aspx"
URL_CONSULTA = f"{BASE}/Consultar"
URL_DOWNLOAD = f"{BASE}/DownloadConsultaPublica"

TEMPO_LIMITE = 90.0

# Formatos de processo SUSEP aceitos, do mais específico para o menos.
#
# As bordas existem para não casar no meio de outro número: a apólice traz CNPJ
# (`04.529.055/0001-44`) e código de corretora (`Cód. SUSEP: 202011542`) na
# mesma página, e ambos enganam um padrão frouxo.
#
# À esquerda o guarda barra dígito e pontuação de número. À direita barra só
# dígito: a apólice escreve "PROCESSO SUSEP Nº 15414.902186/2014-52." e barrar o
# ponto ali derrubaria o caso mais comum de todos.
PADROES_PROCESSO = [
    r"\d{5}\.\d{6}/\d{4}-\d{2}",   # 15414.902186/2014-52
    r"\d{5}\.\d{6}/\d{2}-\d{2}",   # 15414.002186/99-11
    r"\d{2}\.\d{6}/\d{2}-\d{2}",   # 10.002186/99-11
    r"\d{3}-\d{5}/\d{2}",          # 101-12345/95
]
_RE_PROCESSO = re.compile(
    r"(?<![\d.\-/])(" + "|".join(PADROES_PROCESSO) + r")(?!\d)"
)

_RE_LINHA = re.compile(r'<tr class="(?:item|altItem)"(.*?)</tr>', re.S | re.I)
_RE_CELULA = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_RE_ID = re.compile(r"DownloadConsultaPublica/(\d+)")
_RE_TAG = re.compile(r"<[^>]+>")


def extrair_processo(texto: str) -> Optional[str]:
    """
    Acha o número do processo SUSEP no texto da apólice.

    Devolve o primeiro que casar, ou None. Não tenta adivinhar a partir da
    palavra "SUSEP": ela aparece também em "Cód. SUSEP", que é o código da
    corretora e não identifica o produto.
    """
    m = _RE_PROCESSO.search(texto or "")
    return m.group(1) if m else None


def _limpar(html: str) -> str:
    return _RE_TAG.sub(" ", html).replace("&nbsp;", " ").replace("&amp;", "&").strip()


def ler_versoes_do_html(html: str) -> List[Dict[str, Any]]:
    """
    Lê a tabela de versões da resposta da consulta.

    É análise por expressão regular, e não por um parser de HTML, porque o
    projeto não tem nenhum instalado e a tabela é rígida: `tr.item`/`tr.altItem`
    com três colunas. Se a SUSEP mudar a marcação, isto devolve lista vazia — e
    a rota trata lista vazia como "processo não encontrado", que é o que o
    usuário vê. Não há caminho em que dado errado passe por aqui calado.
    """
    versoes: List[Dict[str, Any]] = []
    for bloco in _RE_LINHA.findall(html or ""):
        celulas = [_limpar(c) for c in _RE_CELULA.findall(bloco)]
        if len(celulas) < 3:
            continue
        m = _RE_ID.search(bloco)
        if not m:
            continue

        # O nome útil está no <span>; o resto da célula é a palavra "Download".
        span = re.search(r"<span[^>]*>(.*?)</span>", bloco, re.S | re.I)
        nome = _limpar(span.group(1)) if span else celulas[0].split()[0]

        data_fim = celulas[2] or None
        versoes.append({
            "download_id": m.group(1),
            "nome_arquivo": nome,
            "data_inicio": celulas[1] or None,
            "data_fim": data_fim,
            # Vigente é a que não tem data de fim. A automação anterior usava
            # "a primeira linha", supondo ordenação do servidor — o campo é o
            # critério de verdade, a ordem é acidente.
            "vigente": data_fim is None,
        })
    return versoes


def versao_vigente(versoes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A versão em vigor hoje, ou None se o processo não tiver nenhuma."""
    for v in versoes:
        if v.get("vigente"):
            return v
    return None


def consultar_processo(numero_processo: str) -> List[Dict[str, Any]]:
    """
    Consulta um processo na SUSEP e devolve todas as versões encontradas.

    `verify=False` porque a cadeia de certificados do www2.susep.gov.br não
    valida em todos os ambientes e o conteúdo é público — não há segredo
    trafegando, só um PDF que qualquer pessoa baixa do site.
    """
    numero = (numero_processo or "").strip()
    if not numero:
        return []
    with httpx.Client(timeout=TEMPO_LIMITE, follow_redirects=True, verify=False) as c:
        r = c.post(URL_CONSULTA, files={"numeroProcesso": (None, numero)})
    if r.status_code != 200:
        raise SusepIndisponivel(f"A SUSEP respondeu {r.status_code} na consulta.")
    return ler_versoes_do_html(r.text)


def baixar_versao(download_id: str) -> Tuple[bytes, str]:
    """
    Baixa o PDF de uma versão. Devolve `(conteudo, nome_do_arquivo)`.

    O nome vem do `content-disposition` e não da tabela: os nomes na tabela são
    inconsistentes entre processos — um traz `CG_Vida_Individual_....pdf` e
    outro traz `15414900142201731`, sem extensão.
    """
    with httpx.Client(timeout=TEMPO_LIMITE, follow_redirects=True, verify=False) as c:
        r = c.get(f"{URL_DOWNLOAD}/{download_id}")
    if r.status_code != 200:
        raise SusepIndisponivel(f"A SUSEP respondeu {r.status_code} no download.")
    if not r.content.startswith(b"%PDF-"):
        raise SusepIndisponivel(
            "A SUSEP devolveu algo que não é um PDF. O processo pode ter saído do ar."
        )

    nome = f"CG_{download_id}.pdf"
    disp = r.headers.get("content-disposition") or ""
    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', disp)
    if m:
        nome = m.group(1).strip()
    if not nome.lower().endswith(".pdf"):
        nome = f"{nome}.pdf"
    return r.content, nome


class SusepIndisponivel(Exception):
    """A SUSEP não respondeu como esperado. É falha de fora, não do nosso lado."""
