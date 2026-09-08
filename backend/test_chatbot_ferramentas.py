"""
Mede se o modelo escolhe a ferramenta certa para cada pergunta.

Esta é a única pergunta que importa antes de construir qualquer interface: dada
uma pergunta em português, o modelo chama o endpoint certo? Se errar aqui, erra
no WhatsApp e erra no chat do sistema — o canal não conserta escolha ruim.

Não chama os endpoints e não toca no Pipedrive. Só mede a decisão.

Uso:
    backend/venv/Scripts/python.exe test_chatbot_ferramentas.py
    backend/venv/Scripts/python.exe test_chatbot_ferramentas.py --modelos

    backend/venv/Scripts/python.exe test_chatbot_ferramentas.py --nvidia

Precisa de GEMINI_API_KEY (ou NVIDIA_API_KEY com --nvidia) no backend/.env.
Opcionalmente GEMINI_MODEL / NVIDIA_MODEL.
"""

import io
import os
import sys
import json
import asyncio

import httpx
from dotenv import load_dotenv

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
# meta/llama-3.3-70b-instruct chegou ao fim de vida em 26/08/2026 (HTTP 410).
# Dos candidatos sondados, este foi o unico que escolheu certo: mistral-large-2 e
# llama-3.1-nemotron-70b dao 404 nesta conta, e nemotron-3.5-lightning inventou
# o nome da ferramenta ("list_transcricoes" em vez de "listar_transcricoes").
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "nvidia/nemotron-3-super-120b-a12b")
NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Versão fixa, não `gemini-flash-latest`: alias muda sozinho e o resultado do
# teste deixa de ser comparável entre execuções.
#
# 3.6-flash e não 3.8: a cota gratuita do 3.8 estourou depois de 8 perguntas.
# `gemini-2.5-flash` está fechado para chaves novas.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
BASE = "https://generativelanguage.googleapis.com/v1beta"

# REST direto em vez do SDK: o projeto inteiro já fala httpx, e assim o teste não
# quebra quando o SDK do Google muda de nome de classe entre versões.

# ============================================================================
# AS FERRAMENTAS — cada uma é um endpoint que já existe no main.py
# ============================================================================

FERRAMENTAS = [
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
                "dias": {
                    "type": "integer",
                    "description": "Quantos dias quando periodo='proximos'. Padrão 7.",
                },
            },
            "required": ["periodo"],
        },
    },
    {
        "name": "consultar_atrasados",
        "description": (
            "Atividades vencidas e ainda não concluídas. Use para 'o que está "
            "atrasado', 'tenho pendência vencida', 'o que deixei passar'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "listar_transcricoes",
        "description": (
            "Reuniões transcritas pelo Tactiq. Filtra por estado do vínculo com o "
            "CRM. Use para 'quais transcrições estão sem vínculo', 'quantas reuniões "
            "foram transcritas', 'o que ficou pendente de atribuição'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "filtro": {
                    "type": "string",
                    "enum": ["todas", "vinculadas", "pendentes", "ignoradas"],
                    "description": "Estado do vínculo com o Pipedrive.",
                },
                "busca": {
                    "type": "string",
                    "description": "Nome do cliente ou trecho do título, quando citado.",
                },
            },
            "required": ["filtro"],
        },
    },
    {
        "name": "motivo_do_vinculo",
        "description": (
            "Explica por que uma transcrição específica NÃO foi vinculada "
            "automaticamente a uma atividade do CRM, com a evidência da decisão. "
            "Use quando a pergunta for sobre a causa da falha de uma reunião nomeada."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "cliente": {
                    "type": "string",
                    "description": "Nome do cliente ou da reunião citada na pergunta.",
                }
            },
            "required": ["cliente"],
        },
    },
    {
        "name": "transcricoes_com_dados_cadastrais",
        "description": (
            "Reuniões que apuraram dados do cliente (profissão, estado civil, regime "
            "de bens, filhos) e estão esperando revisão da ficha cadastral. Use para "
            "'o que tenho para revisar no cadastro', 'quais clientes têm dado novo'."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "buscar_pessoa",
        "description": (
            "Procura uma PESSOA no Pipedrive pelo nome. Use quando a pergunta for "
            "sobre o contato em si: telefone, e-mail, cadastro."
        ),
        "parameters": {
            "type": "object",
            "properties": {"termo": {"type": "string", "description": "Nome buscado."}},
            "required": ["termo"],
        },
    },
    {
        "name": "buscar_negocio",
        "description": (
            "Procura um NEGÓCIO (deal) no Pipedrive por nome ou número. Use quando a "
            "pergunta for sobre a oportunidade: em que etapa está, qual o valor, qual "
            "o número do deal."
        ),
        "parameters": {
            "type": "object",
            "properties": {"termo": {"type": "string", "description": "Nome ou id do negócio."}},
            "required": ["termo"],
        },
    },
    {
        "name": "horarios_disponiveis",
        "description": (
            "Horários livres na agenda para marcar reunião, respeitando jornada, "
            "intervalo e antecedência mínima. Use para 'tenho horário quinta', "
            "'quando posso encaixar uma R2'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "dias": {"type": "integer", "description": "Quantos dias à frente olhar."}
            },
        },
    },
    {
        "name": "resumo_do_funil",
        "description": (
            "Números consolidados do Funil Comercial: quantidade de negócios abertos "
            "e volume financeiro. Use para perguntas de totais do pipeline."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "listar_alertas",
        "description": "Alertas operacionais abertos do sistema.",
        "parameters": {"type": "object", "properties": {}},
    },
]

INSTRUCAO = (
    "Você é o assistente interno de um escritório de planejamento patrimonial e "
    "sucessório. Responde ao próprio assessor sobre a agenda dele, as reuniões "
    "transcritas e o CRM.\n\n"
    "Escolha UMA ferramenta quando a pergunta pedir dado do sistema. Se a pergunta "
    "for saudação, agradecimento, conversa fiada ou algo fora do escopo, NÃO chame "
    "ferramenta nenhuma — responda em texto.\n"
    "Hoje é sexta-feira, 04/09/2026. O usuário opera no fuso de Brasília."
)

# ============================================================================
# AS PERGUNTAS — edite aqui com as suas de verdade
#
# `esperado` é o nome da ferramenta que deveria ser chamada, ou None quando a
# resposta certa é não chamar nada. Trocar por perguntas reais é o que dá valor
# ao teste: as que eu inventei se parecem com o seu dia, mas não são o seu dia.
# ============================================================================

PERGUNTAS = [
    ("o que eu tenho hoje?", "consultar_agenda"),
    ("quantas reuniões tenho amanhã?", "consultar_agenda"),
    ("como está minha semana?", "consultar_agenda"),
    ("tem alguma coisa atrasada?", "consultar_atrasados"),
    ("o que eu deixei passar?", "consultar_atrasados"),
    ("quais transcrições estão sem vínculo?", "listar_transcricoes"),
    ("quantas reuniões foram transcritas essa semana?", "listar_transcricoes"),
    ("por que a reunião do Iderval não vinculou?", "motivo_do_vinculo"),
    ("o que deu errado no vínculo do Márcio?", "motivo_do_vinculo"),
    ("tenho algum cadastro para revisar?", "transcricoes_com_dados_cadastrais"),
    ("quais clientes trouxeram dado novo nas reuniões?", "transcricoes_com_dados_cadastrais"),
    ("qual o telefone do Douglas?", "buscar_pessoa"),
    ("em que etapa está o negócio da Natália?", "buscar_negocio"),
    ("qual o número do deal do Frederico?", "buscar_negocio"),
    ("tenho horário livre quinta à tarde?", "horarios_disponiveis"),
    ("quando consigo encaixar uma R2 semana que vem?", "horarios_disponiveis"),
    ("quantos negócios abertos eu tenho?", "resumo_do_funil"),
    ("tem algum alerta aberto?", "listar_alertas"),
    ("bom dia", None),
    ("obrigado, era só isso", None),
    ("qual a capital da França?", None),
]


async def perguntar_nvidia(client: httpx.AsyncClient, pergunta: str, tentativas: int = 3):
    """
    Mesma pergunta, provedor compatível com OpenAI.

    O catálogo FERRAMENTAS é reaproveitado sem alteração: os dois formatos
    diferem só no invólucro — Gemini agrupa em `functionDeclarations`, OpenAI
    embrulha cada uma em `{"type": "function", "function": {...}}`. Nome,
    descrição e parâmetros são os mesmos, e é isso que torna o fallback viável.
    """
    corpo = {
        "model": NVIDIA_MODEL,
        "messages": [
            {"role": "system", "content": INSTRUCAO},
            {"role": "user", "content": pergunta},
        ],
        "tools": [{"type": "function", "function": f} for f in FERRAMENTAS],
        "tool_choice": "auto",
        "max_tokens": 512,
    }
    cabecalhos = {"Authorization": f"Bearer {NVIDIA_API_KEY}"}

    for tentativa in range(tentativas):
        r = await client.post(
            f"{NVIDIA_BASE}/chat/completions", headers=cabecalhos, json=corpo, timeout=90.0
        )
        if r.status_code in (429, 500, 503) and tentativa < tentativas - 1:
            espera = 5.0 * (2 ** tentativa)
            print(f"         (provedor ocupado, aguardando {espera:.0f}s)")
            await asyncio.sleep(espera)
            continue
        break

    if r.status_code != 200:
        return None, {}, f"HTTP {r.status_code}: {r.text[:200]}"

    escolhas = r.json().get("choices") or []
    if not escolhas:
        return None, {}, "resposta sem choices"
    chamadas = escolhas[0].get("message", {}).get("tool_calls") or []
    if not chamadas:
        return None, {}, None  # respondeu em texto

    fn = chamadas[0].get("function", {})
    try:
        # Diferença do Gemini: aqui os argumentos vêm como string JSON.
        args = json.loads(fn.get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {"_bruto": fn.get("arguments")}
    return fn.get("name"), args, None


async def listar_modelos_nvidia(client: httpx.AsyncClient) -> None:
    r = await client.get(
        f"{NVIDIA_BASE}/models", headers={"Authorization": f"Bearer {NVIDIA_API_KEY}"}
    )
    if r.status_code != 200:
        print(f"Falha ao listar: {r.status_code} {r.text[:300]}")
        return
    nomes = sorted(m["id"] for m in r.json().get("data", []))
    print(f"{len(nomes)} modelos na plataforma NVIDIA. Instruct/chat mais prováveis:\n")
    for n in nomes:
        if any(t in n.lower() for t in ("instruct", "nemotron", "qwen", "llama", "mistral")):
            print(f"   {n}")


async def listar_modelos(client: httpx.AsyncClient) -> None:
    r = await client.get(f"{BASE}/models", params={"key": GEMINI_API_KEY})
    if r.status_code != 200:
        print(f"Falha ao listar modelos: {r.status_code} {r.text[:300]}")
        return
    print("Modelos que aceitam generateContent:\n")
    for m in r.json().get("models", []):
        if "generateContent" in (m.get("supportedGenerationMethods") or []):
            print(f"   {m['name'].removeprefix('models/')}")


def _espera_sugerida(corpo_erro: dict, tentativa: int) -> float:
    """Segundos a esperar após um 429, preferindo o que a própria API sugere."""
    for d in (corpo_erro.get("error", {}).get("details") or []):
        atraso = d.get("retryDelay")
        if isinstance(atraso, str) and atraso.endswith("s"):
            try:
                return float(atraso[:-1]) + 1
            except ValueError:
                pass
    return min(60.0, 5.0 * (2 ** tentativa))


async def perguntar(client: httpx.AsyncClient, pergunta: str, tentativas: int = 4):
    """
    Devolve (nome_da_ferramenta | None, argumentos, erro | None).

    A cota gratuita do Gemini limita requisições por minuto, e nos modelos mais
    novos o limite é baixo. Sem backoff, o teste mede a cota em vez de medir a
    escolha de ferramenta — foi o que aconteceu na primeira execução.
    """
    corpo = {
        "systemInstruction": {"parts": [{"text": INSTRUCAO}]},
        "contents": [{"role": "user", "parts": [{"text": pergunta}]}],
        "tools": [{"functionDeclarations": FERRAMENTAS}],
    }

    for tentativa in range(tentativas):
        r = await client.post(
            f"{BASE}/models/{GEMINI_MODEL}:generateContent",
            params={"key": GEMINI_API_KEY},
            json=corpo,
            timeout=60.0,
        )
        # 429 = cota; 500/503 = falha do provedor. Todos transitórios, e sem
        # retry viram falso negativo: medindo, o Gemini devolveu 503 duas vezes
        # e a NVIDIA 500 três — todas apareceram no relatório como se o modelo
        # tivesse escolhido errado.
        if r.status_code in (429, 500, 503) and tentativa < tentativas - 1:
            try:
                espera = _espera_sugerida(r.json(), tentativa)
            except Exception:
                espera = 5.0 * (2 ** tentativa)
            motivo = "cota atingida" if r.status_code == 429 else "modelo ocupado"
            print(f"         ({motivo}, aguardando {espera:.0f}s)")
            await asyncio.sleep(espera)
            continue
        break

    if r.status_code != 200:
        return None, {}, f"HTTP {r.status_code}: {r.text[:200]}"

    candidatos = r.json().get("candidates") or []
    if not candidatos:
        return None, {}, "resposta sem candidatos"
    for parte in candidatos[0].get("content", {}).get("parts", []):
        if "functionCall" in parte:
            fc = parte["functionCall"]
            return fc.get("name"), fc.get("args") or {}, None
    return None, {}, None  # respondeu em texto, sem chamar ferramenta


async def run() -> int:
    nvidia = "--nvidia" in sys.argv
    chave = NVIDIA_API_KEY if nvidia else GEMINI_API_KEY
    nome_chave = "NVIDIA_API_KEY" if nvidia else "GEMINI_API_KEY"
    modelo = NVIDIA_MODEL if nvidia else GEMINI_MODEL

    if not chave:
        print(f"{nome_chave} não está no backend/.env — adicione a linha e rode de novo.")
        return 2

    async with httpx.AsyncClient() as client:
        if "--modelos" in sys.argv:
            await (listar_modelos_nvidia(client) if nvidia else listar_modelos(client))
            return 0

        provedor = "NVIDIA" if nvidia else "Gemini"
        print(f"{provedor} | modelo: {modelo} | {len(FERRAMENTAS)} ferramentas | {len(PERGUNTAS)} perguntas\n")
        acertos, erros = 0, []

        for pergunta, esperado in PERGUNTAS:
            if nvidia:
                escolhida, args, erro = await perguntar_nvidia(client, pergunta)
            else:
                escolhida, args, erro = await perguntar(client, pergunta)

            if erro:
                print(f"  ERRO   {pergunta[:46]:48} {erro}")
                if "404" in erro:
                    print("\n  Modelo não encontrado. Veja os disponíveis com:")
                    print("     python test_chatbot_ferramentas.py --modelos")
                    return 1
                erros.append((pergunta, esperado, f"<{erro[:40]}>"))
                continue

            ok = escolhida == esperado
            acertos += ok
            marca = "ok    " if ok else "ERRO  "
            mostrado = escolhida or "(nenhuma)"
            extra = f"  {json.dumps(args, ensure_ascii=False)}" if args else ""
            print(f"  {marca} {pergunta[:46]:48} -> {mostrado}{extra}")
            if not ok:
                erros.append((pergunta, esperado or "(nenhuma)", mostrado))
            await asyncio.sleep(float(os.getenv("GEMINI_PAUSA", "4")))

    total = len(PERGUNTAS)
    print(f"\n{'='*74}\nacertou {acertos} de {total} ({acertos*100//total}%)")
    if erros:
        print("\ndivergências — confira se o erro foi do modelo ou da sua expectativa:")
        for p, esp, obt in erros:
            print(f"   '{p}'\n      esperado: {esp}\n      escolheu: {obt}")
    return 0 if not erros else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
