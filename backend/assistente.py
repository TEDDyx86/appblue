"""
Assistente de consulta: pergunta em português -> endpoint certo -> resposta.

Mora fora de `main.py` de propósito. O padrão do projeto é arquivo único, mas
este é um subsistema fechado — dois provedores de LLM, catálogo de ferramentas e
despacho — e enfiar mais 300 linhas num arquivo de 5.400 só piora a navegação
que o CLAUDE.md já descreve como difícil.

**Somente leitura.** Nenhuma ferramenta escreve no Pipedrive ou no Supabase. O
assistente responde perguntas; alterar dado continua sendo pelas telas, onde há
confirmação.

Dois provedores em cascata, e a medição que justifica isso: rodando 21 perguntas
de teste, Gemini falhou em ~10% das chamadas e NVIDIA em ~14% — todas por
indisponibilidade (500/503), nenhuma por escolha errada. Sozinho, cada um
engasga com frequência suficiente para o usuário desistir.
"""

import os
import json
import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "nvidia/nemotron-3-super-120b-a12b")
NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"

# Falhas transitórias dos provedores. Sem retry elas viram resposta errada para o
# usuário; medindo, foram a única causa de falha em ambos.
#
# 404 entra na lista por causa da NVIDIA: um modelo que está no catálogo pode
# responder 404 "Function not found" enquanto a instância sobe, e responder 200
# segundos depois. Foi o que aconteceu no primeiro teste ponta a ponta.
TRANSITORIOS = (404, 429, 500, 502, 503)

# Teto do que volta para o modelo. Resultado grande custa token, atrasa e não
# melhora a resposta — ninguém quer as 55 transcrições numa frase.
MAX_ITENS = 25


# ============================================================================
# CATÁLOGO — cada ferramenta é um endpoint que já existe
# ============================================================================

FERRAMENTAS: List[Dict[str, Any]] = [
    {
        "name": "consultar_agenda",
        "description": (
            "Compromissos do usuário num período: reuniões, ligações, mensagens e "
            "tarefas. Use para 'o que eu tenho hoje', 'quantas reuniões amanhã', "
            "'como está minha semana'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "periodo": {
                    "type": "string",
                    "enum": ["hoje", "amanha", "proximos"],
                    "description": "Janela desejada. 'proximos' cobre os próximos dias.",
                },
                "dias": {"type": "integer", "description": "Dias quando periodo='proximos'."},
            },
            "required": ["periodo"],
        },
    },
    {
        "name": "consultar_atrasados",
        "description": (
            "Atividades vencidas e não concluídas. Use para 'o que está atrasado', "
            "'tenho pendência vencida', 'o que deixei passar'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "listar_transcricoes",
        "description": (
            "Reuniões transcritas pelo Tactiq, filtradas pelo estado do vínculo com o "
            "CRM. Use para 'quais transcrições estão sem vínculo', 'quantas reuniões "
            "foram transcritas', 'o que ficou pendente de atribuição'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "filtro": {
                    "type": "string",
                    "enum": ["todas", "vinculadas", "pendentes", "ignoradas"],
                },
                "busca": {"type": "string", "description": "Nome do cliente, se citado."},
            },
            "required": ["filtro"],
        },
    },
    {
        "name": "motivo_do_vinculo",
        "description": (
            "Explica por que uma transcrição específica NÃO foi vinculada "
            "automaticamente a uma atividade do CRM, com a evidência da decisão."
        ),
        "parameters": {
            "type": "object",
            "properties": {"cliente": {"type": "string", "description": "Nome citado."}},
            "required": ["cliente"],
        },
    },
    {
        "name": "transcricoes_com_dados_cadastrais",
        "description": (
            "Reuniões que apuraram dados do cliente (profissão, estado civil, regime "
            "de bens, filhos) e esperam revisão da ficha cadastral."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "buscar_pessoa",
        "description": (
            "Procura uma PESSOA no Pipedrive pelo nome. Use quando a pergunta for "
            "sobre o contato: telefone, e-mail, cadastro."
        ),
        "parameters": {
            "type": "object",
            "properties": {"termo": {"type": "string"}},
            "required": ["termo"],
        },
    },
    {
        "name": "buscar_negocio",
        "description": (
            "Procura um NEGÓCIO (deal) no Pipedrive por nome ou número. Use quando a "
            "pergunta for sobre a oportunidade: etapa, valor, número do deal."
        ),
        "parameters": {
            "type": "object",
            "properties": {"termo": {"type": "string"}},
            "required": ["termo"],
        },
    },
    {
        "name": "resumo_do_funil",
        "description": (
            "Números consolidados do Funil Comercial: quantidade de negócios abertos "
            "e volume financeiro."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "listar_alertas",
        "description": "Alertas operacionais em aberto no sistema.",
        "parameters": {"type": "object", "properties": {}},
    },
]

NOMES_VALIDOS = {f["name"] for f in FERRAMENTAS}


def _instrucao() -> str:
    from datetime import datetime

    hoje = datetime.now()
    dias = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return (
        "Você é o assistente interno de um escritório de planejamento patrimonial e "
        "sucessório. Responde ao próprio assessor sobre a agenda dele, as reuniões "
        "transcritas e o CRM.\n\n"
        "Escolha UMA ferramenta quando a pergunta pedir dado do sistema. Se for "
        "saudação, agradecimento ou algo fora do escopo, NÃO chame ferramenta — "
        "responda em texto, curto.\n"
        f"Hoje é {dias[hoje.weekday()]}, {hoje.strftime('%d/%m/%Y')}. "
        "O usuário opera no fuso de Brasília."
    )


# ============================================================================
# PROVEDORES
# ============================================================================


async def _chamar_gemini(
    client: httpx.AsyncClient, mensagem: str, com_ferramentas: bool
) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
    if not GEMINI_API_KEY:
        return None, {}, "GEMINI_API_KEY ausente"

    corpo: Dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": _instrucao()}]},
        "contents": [{"role": "user", "parts": [{"text": mensagem}]}],
    }
    if com_ferramentas:
        corpo["tools"] = [{"functionDeclarations": FERRAMENTAS}]

    r = await client.post(
        f"{GEMINI_BASE}/models/{GEMINI_MODEL}:generateContent",
        params={"key": GEMINI_API_KEY},
        json=corpo,
        timeout=60.0,
    )
    if r.status_code != 200:
        return None, {}, f"gemini {r.status_code}"

    candidatos = r.json().get("candidates") or []
    if not candidatos:
        return None, {}, "gemini sem candidatos"
    texto = []
    for parte in candidatos[0].get("content", {}).get("parts", []):
        if "functionCall" in parte:
            fc = parte["functionCall"]
            return fc.get("name"), fc.get("args") or {}, None
        if "text" in parte:
            texto.append(parte["text"])
    return None, {"_texto": "".join(texto)}, None


async def _chamar_nvidia(
    client: httpx.AsyncClient, mensagem: str, com_ferramentas: bool
) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
    if not NVIDIA_API_KEY:
        return None, {}, "NVIDIA_API_KEY ausente"

    corpo: Dict[str, Any] = {
        "model": NVIDIA_MODEL,
        "messages": [
            {"role": "system", "content": _instrucao()},
            {"role": "user", "content": mensagem},
        ],
        # Folgado porque o Nemotron é modelo de raciocínio: ele gasta saída
        # pensando antes de responder, e com teto apertado o que chega ao usuário
        # é o raciocínio truncado no meio.
        "max_tokens": 3000,
    }
    if com_ferramentas:
        corpo["tools"] = [{"type": "function", "function": f} for f in FERRAMENTAS]
        corpo["tool_choice"] = "auto"

    r = await client.post(
        f"{NVIDIA_BASE}/chat/completions",
        headers={"Authorization": f"Bearer {NVIDIA_API_KEY}"},
        json=corpo,
        timeout=90.0,
    )
    if r.status_code != 200:
        return None, {}, f"nvidia {r.status_code}"

    escolhas = r.json().get("choices") or []
    if not escolhas:
        return None, {}, "nvidia sem choices"
    msg = escolhas[0].get("message", {})
    chamadas = msg.get("tool_calls") or []
    if chamadas:
        fn = chamadas[0].get("function", {})
        try:
            # Diferença do Gemini: aqui os argumentos vêm como string JSON.
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        return fn.get("name"), args, None
    return None, {"_texto": msg.get("content") or ""}, None


async def _perguntar_ao_modelo(
    mensagem: str, com_ferramentas: bool = True
) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
    """
    Cascata: Gemini, depois NVIDIA. Cada um com uma tentativa extra.

    O segundo provedor só existe porque a medição mostrou que nenhum dos dois é
    confiável sozinho — e as falhas são de disponibilidade, não de qualidade.
    """
    async with httpx.AsyncClient() as client:
        for chamar, rotulo in ((_chamar_gemini, "gemini"), (_chamar_nvidia, "nvidia")):
            for tentativa in range(2):
                nome, args, erro = await chamar(client, mensagem, com_ferramentas)
                if erro is None:
                    return nome, args, None
                transitorio = any(str(c) in erro for c in TRANSITORIOS)
                if transitorio and tentativa == 0:
                    await asyncio.sleep(2)
                    continue
                logger.warning(f"assistente: {rotulo} falhou ({erro})")
                break
    return None, {}, "todos os provedores falharam"


# ============================================================================
# EXECUTORES — o que cada ferramenta realmente faz
# ============================================================================


async def _exec_consultar_agenda(periodo: str = "hoje", dias: int = 7, **_):
    import main

    d = await main.fetch_agenda(periodo, dias)
    return {
        "periodo": f"{d['inicio']} a {d['fim']}",
        "grupos": [
            {
                "titulo": g["titulo"],
                "quantidade": len(g["itens"]),
                "itens": [
                    {
                        "hora": i["due_time"] or "dia inteiro",
                        "data": i["due_date"],
                        "tipo": i["type_label"],
                        "assunto": i["subject"],
                        "cliente": i.get("person_name"),
                        "assessor": i.get("org_name"),
                    }
                    for i in g["itens"][:MAX_ITENS]
                ],
            }
            for g in d["grupos"]
        ],
    }


async def _exec_consultar_atrasados(**_):
    import main

    d = await main.fetch_agenda_atrasadas(MAX_ITENS)
    return {
        "total": d["total"],
        "itens": [
            {
                "data": i["due_date"],
                "tipo": i["type_label"],
                "assunto": i["subject"],
                "cliente": i.get("person_name"),
            }
            for i in d["itens"]
        ],
    }


def _classificar(briefing: Dict[str, Any]) -> str:
    if briefing.get("is_ignored"):
        return "ignoradas"
    pipe = briefing.get("pipedrive") or {}
    return "vinculadas" if (pipe.get("deal_id") or pipe.get("person_id")) else "pendentes"


async def _exec_listar_transcricoes(filtro: str = "todas", busca: str = "", **_):
    import main

    res = (
        main.supabase.table("transcriptions")
        .select("meeting_title, meeting_date, briefing_json")
        .order("meeting_date", desc=True)
        .limit(200)
        .execute()
    )
    itens = []
    for t in res.data or []:
        b = t.get("briefing_json") or {}
        estado = _classificar(b)
        if filtro != "todas" and estado != filtro:
            continue
        titulo = t.get("meeting_title") or ""
        if busca and busca.lower() not in titulo.lower():
            continue
        pipe = b.get("pipedrive") or {}
        itens.append(
            {
                "reuniao": titulo,
                "data": (t.get("meeting_date") or "")[:10],
                "estado": estado,
                "deal_id": pipe.get("deal_id"),
                "motivo_da_falha": (b.get("vinculo") or {}).get("motivo"),
            }
        )
    return {"total": len(itens), "itens": itens[:MAX_ITENS]}


async def _exec_motivo_do_vinculo(cliente: str = "", **_):
    import main

    if not cliente:
        return {"erro": "nome do cliente não informado"}
    res = (
        main.supabase.table("transcriptions")
        .select("meeting_title, briefing_json")
        .ilike("meeting_title", f"%{cliente}%")
        .order("meeting_date", desc=True)
        .limit(3)
        .execute()
    )
    if not res.data:
        return {"encontrado": False, "buscado": cliente}
    saida = []
    for t in res.data:
        b = t.get("briefing_json") or {}
        v = b.get("vinculo") or {}
        saida.append(
            {
                "reuniao": t.get("meeting_title"),
                "status": v.get("status", "nunca avaliada"),
                "motivo": v.get("motivo"),
                "detalhe": v.get("detalhe"),
            }
        )
    return {"encontrado": True, "resultados": saida}


async def _exec_transcricoes_com_dados_cadastrais(**_):
    import main

    d = await main.listar_transcricoes_com_dados_cadastrais(user={"id": "assistente"})
    return {
        "total_na_fila": d["total"],
        "itens": [
            {
                "cliente": i["person_name"],
                "reuniao": i["meeting_title"],
                "data": (i.get("meeting_date") or "")[:10],
                "campos": i["campos_extraidos"],
            }
            for i in d["itens"][:MAX_ITENS]
        ],
    }


async def _exec_buscar_pessoa(termo: str = "", **_):
    import main

    if not termo:
        return {"erro": "termo vazio"}
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.get(
            f"{main.PIPEDRIVE_BASE_URL}/persons/search",
            params={"term": termo, "api_token": main.PIPEDRIVE_API_TOKEN, "limit": 5},
        )
    if r.status_code != 200:
        return {"erro": f"Pipedrive respondeu {r.status_code}"}
    itens = (r.json().get("data") or {}).get("items") or []
    return {
        "encontrados": [
            {
                "id": i["item"].get("id"),
                "nome": i["item"].get("name"),
                "telefone": (i["item"].get("phones") or [None])[0],
                "email": (i["item"].get("emails") or [None])[0],
            }
            for i in itens
        ]
    }


async def _exec_buscar_negocio(termo: str = "", **_):
    import main

    if not termo:
        return {"erro": "termo vazio"}
    async with httpx.AsyncClient(timeout=30.0) as c:
        itens = await main.buscar_negocio_por_nome(c, termo)
    return {
        "encontrados": [
            {
                "id": i["item"].get("id"),
                "titulo": i["item"].get("title"),
                "status": i["item"].get("status"),
                "valor": i["item"].get("value"),
                "pessoa": (i["item"].get("person") or {}).get("name"),
            }
            for i in itens[:5]
        ]
    }


async def _exec_resumo_do_funil(**_):
    import main

    d = await main.fetch_comercial_pipeline_data()
    return {k: v for k, v in d.items() if not isinstance(v, (list, dict))} or d


async def _exec_listar_alertas(**_):
    import main

    res = (
        main.supabase.table("alerts")
        .select("alert_type, cliente_nome, message, created_at")
        .eq("is_resolved", False)
        .order("created_at", desc=True)
        .limit(MAX_ITENS)
        .execute()
    )
    return {"total": len(res.data or []), "alertas": res.data or []}


EXECUTORES = {
    "consultar_agenda": _exec_consultar_agenda,
    "consultar_atrasados": _exec_consultar_atrasados,
    "listar_transcricoes": _exec_listar_transcricoes,
    "motivo_do_vinculo": _exec_motivo_do_vinculo,
    "transcricoes_com_dados_cadastrais": _exec_transcricoes_com_dados_cadastrais,
    "buscar_pessoa": _exec_buscar_pessoa,
    "buscar_negocio": _exec_buscar_negocio,
    "resumo_do_funil": _exec_resumo_do_funil,
    "listar_alertas": _exec_listar_alertas,
}

# Garantia de que catálogo e despacho não saem de sincronia em silêncio.
assert NOMES_VALIDOS == set(EXECUTORES), (
    f"catálogo e executores divergem: {NOMES_VALIDOS ^ set(EXECUTORES)}"
)


# ============================================================================
# ORQUESTRAÇÃO
# ============================================================================


class PerguntaRequest(BaseModel):
    mensagem: str


async def responder(mensagem: str) -> Dict[str, Any]:
    """
    Pergunta -> ferramenta -> dado -> resposta em português.

    A segunda chamada ao modelo manda o resultado como texto simples em vez de
    usar o formato de tool_result do provedor. Os dois formatos são diferentes, e
    a fidelidade que se perde não paga o código de tradução que se ganharia.
    """
    mensagem = (mensagem or "").strip()
    if not mensagem:
        raise HTTPException(status_code=400, detail="Mensagem vazia")

    nome, args, erro = await _perguntar_ao_modelo(mensagem, com_ferramentas=True)
    if erro:
        raise HTTPException(status_code=503, detail="Assistente indisponível no momento.")

    if not nome:
        return {"resposta": args.get("_texto") or "Não entendi. Pode reformular?", "ferramenta": None}

    # Um modelo já devolveu "list_transcricoes" em vez de "listar_transcricoes"
    # nos testes. Nome inventado nunca chega ao despacho.
    if nome not in EXECUTORES:
        logger.warning(f"assistente: modelo pediu ferramenta inexistente '{nome}'")
        return {
            "resposta": "Não consegui atender essa pergunta com os dados que tenho acesso.",
            "ferramenta": None,
        }

    try:
        dados = await EXECUTORES[nome](**args)
    except Exception as e:
        logger.error(f"assistente: falha ao executar {nome}: {e}")
        raise HTTPException(status_code=502, detail=f"Falha ao consultar {nome}.")

    resumo_pedido = (
        f"Pergunta do usuário: {mensagem}\n\n"
        f"Dados retornados pelo sistema (ferramenta {nome}):\n"
        f"{json.dumps(dados, ensure_ascii=False, default=str)[:12000]}\n\n"
        "Responda em português, direto, com base APENAS nesses dados. Não invente "
        "nada que não esteja acima. Se a lista estiver vazia, diga que não há nada.\n"
        "Escreva para uma pessoa, não para um programador: nunca cite nomes de "
        "campo do JSON (deal_id, briefing_json, person_name) nem valores como "
        "'null' — diga 'sem negócio vinculado'. Seja breve: o usuário está entre "
        "reuniões. Quando houver muitos itens, dê o número e cite dois ou três "
        "exemplos, não a lista inteira."
    )
    _, texto, erro2 = await _perguntar_ao_modelo(resumo_pedido, com_ferramentas=False)
    if erro2:
        return {"resposta": "Consultei os dados, mas não consegui redigir a resposta.",
                "ferramenta": nome, "dados": dados}

    return {
        "resposta": (texto.get("_texto") or "").strip() or "Sem resposta.",
        "ferramenta": nome,
        "argumentos": args,
    }
