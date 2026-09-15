"""
Regressão: a atribuição manual não pode dizer "sucesso" sem ter escrito.

Rodar: backend/venv/Scripts/python.exe test_atribuicao_manual.py
Não há pytest no projeto — este arquivo é executável e imprime o resultado.

O bug: quando o negócio escolhido não tem atividade R1/R2/R3 na data, a rota cai
no fallback que cria uma `tactiq`. Falhando a criação, `anexar_transcricao_no_negocio`
devolve `{}` — e a rota devolvia `{"status": "success", "message": "Transcrição
vinculada com sucesso ao Pipedrive"}` assim mesmo. O usuário abria o negócio e não
havia nada, porque nada tinha sido escrito.

Pipedrive e Supabase são dublados aqui. Nenhuma chamada sai para produção.
"""

import asyncio
import io
import os
import sys

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

import httpx

import main

falhas = []


def checar(rotulo, obtido, esperado):
    ok = obtido == esperado
    print(f"  {'ok   ' if ok else 'FALHA'} {rotulo:56} obtido={obtido!r}")
    if not ok:
        falhas.append(f"{rotulo}: esperado {esperado!r}, obtido {obtido!r}")


def _transcricao():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "meeting_title": "Reuniao de teste",
        "meeting_date": "2026-09-01T19:00:00Z",
        "google_doc_id": "doc-fake",
        "processing_status": "completed",
        "briefing_json": {
            "dados_cliente": {"nome": "Fulano de Teste"},
            "data_reuniao": "01/09/2026",
            "pipedrive": {},
        },
    }


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, tabela, transcricao, gravacoes):
        self.tabela, self.transcricao, self.gravacoes = tabela, transcricao, gravacoes
        self.op = None

    def select(self, *a, **k):
        self.op = "select"
        return self

    def update(self, valores):
        self.op = ("update", valores)
        return self

    def insert(self, valores):
        self.op = ("insert", valores)
        return self

    def eq(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def single(self, *a, **k):
        return self

    def execute(self):
        if self.op == "select":
            if self.tabela == "transcriptions":
                return _Resp([self.transcricao])
            return _Resp([{"role": "admin"}])
        self.gravacoes.append((self.tabela, self.op))
        return _Resp([{"id": "x"}])


class _Supabase:
    def __init__(self, transcricao, gravacoes):
        self.transcricao, self.gravacoes = transcricao, gravacoes

    def table(self, nome):
        return _Query(nome, self.transcricao, self.gravacoes)


class _ClienteSemAtividades:
    """O negócio existe e não tem nenhuma atividade: a listagem volta vazia."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **kwargs):
        class R:
            status_code = 200

            @staticmethod
            def json():
                return {"success": True, "data": []}

        return R()


def _executar(criacao_funciona, com_decisoes=False):
    """Roda a rota com o negócio sem atividade e a criação dando certo ou não."""
    transcricao = _transcricao()
    if com_decisoes:
        transcricao["briefing_json"]["decisoes_proximos_passos"] = [
            "Enviar a proposta até sexta",
            "Cliente vai levantar os documentos",
        ]
    gravacoes, escritas = [], []

    async def _create(**kwargs):
        escritas.append(kwargs.get("activity_type") or "create")
        return {"id": 4242} if criacao_funciona else None

    async def _update(activity_id, updates):
        escritas.append("update")
        return None

    originais = (main.supabase, main.create_pipedrive_activity,
                 main.update_pipedrive_activity, httpx.AsyncClient)
    main.supabase = _Supabase(transcricao, gravacoes)
    main.create_pipedrive_activity = _create
    main.update_pipedrive_activity = _update
    httpx.AsyncClient = lambda *a, **k: _ClienteSemAtividades()

    req = main.AssignTranscriptionRequest(
        person_id="999", deal_id="888", cliente_nome="Fulano de Teste"
    )
    erro = None
    resposta = None
    try:
        resposta = asyncio.run(
            main.assign_transcription_to_crm(
                transcription_id=transcricao["id"], req=req, user={"sub": "u1", "id": "u1"}
            )
        )
    except main.HTTPException as e:
        erro = e
    finally:
        (main.supabase, main.create_pipedrive_activity,
         main.update_pipedrive_activity, httpx.AsyncClient) = originais

    return resposta, erro, escritas, gravacoes


def teste_falha_nao_pode_virar_sucesso():
    print("\n=== negocio sem atividade e criacao falhando ===")
    resposta, erro, escritas, gravacoes = _executar(criacao_funciona=False)

    checar("tentou criar a atividade", escritas, ["tactiq"])
    checar("a rota nao devolveu sucesso", resposta, None)
    checar("a rota sinalizou erro ao chamador", erro is not None, True)
    if erro:
        checar("status HTTP de falha upstream", erro.status_code, 502)
        checar("a mensagem diz que nada foi gravado",
               "Nada foi gravado" in str(erro.detail), True)

    # O estado tem que ficar gravado mesmo na falha: a tela lê o briefing para
    # explicar o que aconteceu, e um briefing mudo é o bug de novo, calado.
    updates = [v for (tabela, (op, v)) in
               [(t, o) for (t, o) in gravacoes if isinstance(o, tuple)]
               if tabela == "transcriptions" and op == "update"]
    briefing = (updates[-1] or {}).get("briefing_json", {}) if updates else {}
    vinculo = briefing.get("vinculo") or {}
    checar("briefing gravado mesmo na falha", bool(briefing), True)
    checar("vinculo registrado como nao_vinculado", vinculo.get("status"), "nao_vinculado")
    checar("motivo preenchido", vinculo.get("motivo"), "ERRO_PIPEDRIVE")
    checar("activity_id fica nulo",
           (briefing.get("pipedrive") or {}).get("activity_id"), None)


def teste_sucesso_continua_sucesso():
    print("\n=== negocio sem atividade e criacao funcionando ===")
    resposta, erro, escritas, gravacoes = _executar(criacao_funciona=True)

    checar("nenhum erro levantado", erro, None)
    checar("a rota devolveu sucesso", (resposta or {}).get("status"), "success")

    pipe = ((resposta or {}).get("briefing_json") or {}).get("pipedrive") or {}
    checar("activity_id da atividade criada", pipe.get("activity_id"), "4242")
    checar("origem marcada como criada", pipe.get("activity_origem"), "criada")

    vinculo = ((resposta or {}).get("briefing_json") or {}).get("vinculo") or {}
    checar("vinculo registrado como vinculado", vinculo.get("status"), "vinculado")


def teste_proximos_passos_tambem_na_atribuicao_manual():
    """
    As decisões da reunião viram pendência na agenda mesmo quando o vínculo foi
    feito à mão.

    Antes, `criar_atividade_proximos_passos` só era chamada no caminho
    automático que anexava numa R1/R2/R3 existente. Quem atribuía manualmente
    ficava sem a tarefa — e é justamente quem atribui à mão que já sabe que
    aquela conversa tem desdobramento.
    """
    print("\n=== atribuicao manual cria PROXIMOS PASSOS ===")
    resposta, erro, escritas, _ = _executar(criacao_funciona=True, com_decisoes=True)

    checar("nenhum erro levantado", erro, None)
    checar("criou a tactiq e a tarefa", escritas, ["tactiq", "task"])

    pipe = ((resposta or {}).get("briefing_json") or {}).get("pipedrive") or {}
    checar("id da tarefa guardado", pipe.get("proximos_passos_activity_id"), "4242")


def teste_sem_decisoes_a_manual_nao_cria_tarefa():
    print("\n=== atribuicao manual sem decisoes ===")
    _, erro, escritas, _ = _executar(criacao_funciona=True, com_decisoes=False)

    checar("nenhum erro levantado", erro, None)
    checar("criou so a tactiq", escritas, ["tactiq"])


if __name__ == "__main__":
    teste_falha_nao_pode_virar_sucesso()
    teste_sucesso_continua_sucesso()
    teste_proximos_passos_tambem_na_atribuicao_manual()
    teste_sem_decisoes_a_manual_nao_cria_tarefa()
    print(f"\n{'FALHOU' if falhas else 'TUDO OK'}")
    for f in falhas:
        print(f"   {f}")
    sys.exit(1 if falhas else 0)
