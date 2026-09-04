"""
FastAPI Backend: Automação Tactiq → Google Drive → Pipedrive
Autenticação, Webhooks, Integração CRM
"""

import os
import re
import uuid
import json
import base64
import time
import asyncio
import unicodedata
import html as html_lib
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple, Union
from functools import wraps

from fastapi import FastAPI, HTTPException, Depends, Header, Request, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
import jwt
import bcrypt
import pymupdf
from google.oauth2.service_account import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from googleapiclient.discovery import build
import httpx
from supabase import create_client, Client
from apscheduler.schedulers.background import BackgroundScheduler
import logging
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

# ============================================================================
# CONFIGURAÇÃO
# ============================================================================

logger = logging.getLogger(__name__)

# Env vars
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", 24))

PIPEDRIVE_API_TOKEN = os.getenv("PIPEDRIVE_API_TOKEN")
PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/api/v2"  # API v2 - mais eficiente, 50% menos tokens

GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
GOOGLE_DRIVE_FOLDER_NAME = "Briefing - Tactiq"

# FastAPI app
app = FastAPI(title="Automação Tactiq-Pipedrive", version="1.0.0")

# CORS - Permite Vercel, Render, localhost e qualquer origem
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Scheduler
scheduler = BackgroundScheduler()
scheduler.start()

# ============================================================================
# MODELS
# ============================================================================

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str]
    role: str
    created_at: str

class AlertResponse(BaseModel):
    id: str
    alert_type: str
    cliente_nome: Optional[str] = None
    pipedrive_deal_id: Optional[str] = None
    description: str
    severity: str
    is_resolved: bool
    details: Optional[Dict] = None
    created_at: str

# ============================================================================
# AUTENTICAÇÃO
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password com bcrypt"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode(), salt).decode()

def verify_password(password: str, hash_val: str) -> bool:
    """Verifica password"""
    return bcrypt.checkpw(password.encode(), hash_val.encode())

def create_jwt(user_id: str, expires_hours: int = JWT_EXPIRATION_HOURS) -> tuple[str, str]:
    """Cria JWT access token + refresh token"""
    now = datetime.utcnow()
    
    # Access token
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(hours=expires_hours),
        "type": "access"
    }
    access_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    # Refresh token (7 dias)
    refresh_payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(days=7),
        "type": "refresh"
    }
    refresh_token = jwt.encode(refresh_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    return access_token, refresh_token

def verify_jwt(token: str) -> dict:
    """Verifica JWT e retorna payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Dependency: extrai usuário do JWT"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente")
    
    token = authorization.split(" ")[1]
    payload = verify_jwt(token)
    
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token inválido")
    
    return payload

def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Dependency opcional: extrai usuário se houver token válido, sem bloquear clientes públicos"""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        token = authorization.split(" ")[1]
        payload = verify_jwt(token)
        if payload.get("type") == "access":
            return payload
    except Exception:
        pass
    return None

def require_admin(user: dict = Depends(get_current_user)):
    """Dependency: verifica se é admin"""
    # Busca role no DB
    response = supabase.table("users").select("role").eq("id", user["sub"]).single().execute()
    if response.data.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a admin")
    return user

# ============================================================================
# AUTH ENDPOINTS
# ============================================================================

@app.post("/api/auth/signup")
async def signup(req: SignupRequest):
    """Cadastro público desabilitado por segurança"""
    raise HTTPException(
        status_code=403,
        detail="Cadastro público desabilitado. Novas contas devem ser criadas pelo Administrador no painel de Configurações."
    )

class CreateUserByAdminRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "member"  # "admin" ou "member"

@app.get("/api/admin/users")
async def list_users(user: dict = Depends(require_admin)):
    """Lista todos os usuários do sistema (Exclusivo Admin)"""
    res = supabase.table("users").select("id, email, full_name, role, created_at").order("created_at", desc=False).execute()
    return {"users": res.data or []}

@app.post("/api/admin/users")
async def create_user_by_admin(req: CreateUserByAdminRequest, user: dict = Depends(require_admin)):
    """Cria um novo usuário pela conta de Administrador"""
    existing = supabase.table("users").select("id").eq("email", req.email.strip().lower()).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Este e-mail já está cadastrado no sistema")
        
    user_id = str(uuid.uuid4())
    password_hash = hash_password(req.password)
    role = req.role if req.role in ["admin", "member"] else "member"
    
    supabase.table("users").insert({
        "id": user_id,
        "email": req.email.strip().lower(),
        "password_hash": password_hash,
        "full_name": req.full_name.strip(),
        "role": role
    }).execute()
    
    log_audit_event(
        action="USER_CREATED_BY_ADMIN",
        resource_type="user",
        resource_id=user_id,
        user_id=user["sub"],
        details={
            "created_user_email": req.email,
            "created_user_name": req.full_name,
            "created_user_role": role,
            "summary": f"Novo usuário '{req.full_name}' ({req.email}) criado com perfil {role.upper()} pelo administrador."
        }
    )
    
    return {
        "status": "success",
        "message": f"Usuário {req.full_name} criado com sucesso!",
        "user": {
            "id": user_id,
            "email": req.email,
            "full_name": req.full_name,
            "role": role
        }
    }

@app.delete("/api/admin/users/{user_id_to_delete}")
async def delete_user_by_admin(user_id_to_delete: str, user: dict = Depends(require_admin)):
    """Exclui um usuário do sistema (Exclusivo Admin)"""
    if user_id_to_delete == user["sub"]:
        raise HTTPException(status_code=400, detail="Você não pode excluir sua própria conta de administrador")
        
    supabase.table("users").delete().eq("id", user_id_to_delete).execute()
    
    log_audit_event(
        action="USER_DELETED_BY_ADMIN",
        resource_type="user",
        resource_id=user_id_to_delete,
        user_id=user["sub"],
        details={
            "deleted_user_id": user_id_to_delete,
            "summary": f"Usuário #{user_id_to_delete} removido do sistema pelo administrador."
        }
    )
    
    return {"status": "success", "message": "Usuário removido com sucesso"}

@app.post("/api/auth/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Login"""
    
    # Busca usuário
    response = supabase.table("users").select("id, password_hash").eq("email", req.email).execute()
    if not response.data:
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    user = response.data[0]
    
    # Verifica senha
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")
    
    # Cria JWT
    access_token, refresh_token = create_jwt(user["id"])
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600
    )

@app.post("/api/auth/refresh", response_model=TokenResponse)
async def refresh(authorization: Optional[str] = Header(None)):
    """Refresh JWT"""
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente")
    
    token = authorization.split(" ")[1]
    payload = verify_jwt(token)
    
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token inválido")
    
    # Cria novo access token
    access_token, new_refresh_token = create_jwt(payload["sub"])
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_in=JWT_EXPIRATION_HOURS * 3600
    )

@app.get("/api/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    """Dados do usuário logado"""
    
    response = supabase.table("users").select("*").eq("id", user["sub"]).single().execute()
    data = response.data
    
    return UserResponse(
        id=data["id"],
        email=data["email"],
        full_name=data["full_name"],
        role=data["role"],
        created_at=data["created_at"]
    )

# ============================================================================
# GOOGLE DRIVE INTEGRATION
# ============================================================================

def get_google_drive_service():
    """Cria serviço do Google Drive suportando JSON em string, base64, caminho exato ou fallback"""
    scopes = ["https://www.googleapis.com/auth/drive"]
    
    # 1. Se variável GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON estiver definida
    if GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON:
        val = GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.strip()
        
        # Caso A: JSON string direto (ex: '{"type": "service_account", ...}')
        if val.startswith("{") and val.endswith("}"):
            try:
                info = json.loads(val)
                credentials = Credentials.from_service_account_info(info, scopes=scopes)
                return build("drive", "v3", credentials=credentials)
            except Exception as e:
                logger.warning(f"Erro ao carregar GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON como JSON: {e}")
                
        # Caso B: String Base64
        try:
            if not os.path.exists(val) and len(val) > 80:
                decoded = base64.b64decode(val).decode("utf-8")
                if decoded.startswith("{") and decoded.endswith("}"):
                    info = json.loads(decoded)
                    credentials = Credentials.from_service_account_info(info, scopes=scopes)
                    return build("drive", "v3", credentials=credentials)
        except Exception:
            pass
            
        # Caso C: Caminho de arquivo existente
        if os.path.exists(val):
            credentials = Credentials.from_service_account_file(val, scopes=scopes)
            return build("drive", "v3", credentials=credentials)

    # 2. Fallbacks de caminhos conhecidos no projeto
    base_dir = os.path.dirname(os.path.abspath(__file__))
    possible_paths = [
        os.path.join(base_dir, "credentials", "service-account.json"),
        os.path.join(base_dir, "service-account.json"),
        os.path.join(os.getcwd(), "backend", "credentials", "service-account.json"),
        os.path.join(os.getcwd(), "credentials", "service-account.json"),
        "credentials/service-account.json",
        "service-account.json"
    ]
    for p in possible_paths:
        if os.path.exists(p):
            credentials = Credentials.from_service_account_file(p, scopes=scopes)
            return build("drive", "v3", credentials=credentials)
            
    raise HTTPException(
        status_code=500,
        detail="Credenciais do Google Drive não encontradas. No painel da hospedagem (ex: Render), configure a variável de ambiente GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON com o conteúdo JSON da Service Account."
    )

def find_google_drive_folder():
    """Encontra a pasta 'Tactiq Transcription' no Drive"""
    service = get_google_drive_service()
    
    query = f"name='{GOOGLE_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = service.files().list(q=query, spaces="drive", fields="files(id, name)").execute()
    
    files = results.get("files", [])
    if not files:
        raise HTTPException(status_code=500, detail="Pasta Tactiq Transcription não encontrada")
    
    return files[0]["id"]

def read_google_doc_as_text(doc_id: str) -> str:
    """Lê conteúdo de um Google Doc e retorna como texto"""
    service = get_google_drive_service()
    
    # Exporta como texto
    response = service.files().export(fileId=doc_id, mimeType="text/plain").execute()
    return response.decode("utf-8")

def setup_google_drive_watch(folder_id: str, webhook_url: str):
    """Configura notificações do Google Drive para a pasta"""
    service = get_google_drive_service()
    
    channel_id = str(uuid.uuid4())
    
    try:
        # Watch folder para mudanças
        body = {
            "id": channel_id,
            "type": "web_hook",
            "address": webhook_url,
            "token": "tactiq-automation"
        }
        
        # Nota: Google Drive API watch em folders é via changes, não via files
        # Por simplicidade, você pode fazer polling periódico em vez disso
        logger.info(f"Google Drive watch setup iniciado para pasta {folder_id}")
        return channel_id
    except Exception as e:
        logger.error(f"Erro ao setup Google Drive watch: {e}")
        raise

def log_audit_event(
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None
):
    """Registra evento com metadados detalhados na tabela audit_log do Supabase"""
    clean_user_id = None
    if user_id:
        try:
            uuid.UUID(str(user_id))
            clean_user_id = str(user_id)
        except (ValueError, AttributeError):
            clean_user_id = None

    try:
        supabase.table("audit_log").insert({
            "action": action,
            "resource_type": resource_type,
            "resource_id": str(resource_id) if resource_id else None,
            "user_id": clean_user_id,
            "details": details or {},
            "old_values": old_values,
            "new_values": new_values,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        logger.error(f"Erro ao registrar audit_log ({action}): {e}")

# ============================================================================
# PIPEDRIVE INTEGRATION
# ============================================================================

async def search_pipedrive_person(name: str, email: Optional[str] = None) -> Optional[List[Dict]]:
    """
    Busca pessoa no Pipedrive por nome ou email usando API v2.
    
    API v2 changes:
    - Endpoint: /api/v2/persons/search
    - Retorna objetos diretamente em 'data.items'
    """
    
    async with httpx.AsyncClient() as client:
        # Busca por nome
        query = name
        if email:
            query = email  # Prioriza busca por email
        
        response = await client.get(
            f"{PIPEDRIVE_BASE_URL}/persons/search",
            params={
                "term": query,
                "api_token": PIPEDRIVE_API_TOKEN
            }
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao buscar pessoa no Pipedrive: {response.text}")
            return None
        
        data = response.json()
        # API v2 retorna em data.items
        return data.get("data", {}).get("items", []) if data.get("success") else None

async def get_pipedrive_deal(deal_id: str) -> Optional[Dict]:
    """
    Busca deal no Pipedrive usando API v2.
    
    API v2 changes:
    - Endpoint: /api/v2/deals/{id}
    - Timestamps em RFC 3339
    """
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao buscar deal: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

async def create_pipedrive_activity(
    subject: str = "Transcrição Tactiq",
    activity_type: str = "tactiq",
    due_date: Optional[str] = None,
    due_time: Optional[str] = None,
    duration: Optional[str] = None,
    note_content: Optional[str] = None,
    note: Optional[str] = None,
    deal_id: Optional[str] = None,
    person_id: Optional[str] = None,
    org_id: Optional[Union[str, int]] = None,
    location: Optional[str] = None,
    conference_meeting_url: Optional[str] = None,
    conference_meeting_client: Optional[str] = None,
    done: bool = True
) -> Optional[Dict]:
    """
    Cria Activity no Pipedrive com suporte a tipo, notas ricas, assessor e link de videoconferência.
    """
    if not PIPEDRIVE_API_TOKEN:
        logger.warning("PIPEDRIVE_API_TOKEN não configurado")
        return None
        
    payload = {
        "type": activity_type or "tactiq",
        "subject": subject or "Transcrição Tactiq",
        "done": 1 if done else 0,
        "note": note_content or note or "",
    }
    
    if due_date:
        payload["due_date"] = due_date
    if due_time:
        payload["due_time"] = due_time
    if duration:
        payload["duration"] = duration
    if location:
        payload["location"] = location
    if conference_meeting_url:
        payload["conference_meeting_url"] = conference_meeting_url
    if conference_meeting_client:
        payload["conference_meeting_client"] = conference_meeting_client
        
    if deal_id:
        try:
            payload["deal_id"] = int(deal_id)
        except (ValueError, TypeError):
            payload["deal_id"] = deal_id
            
    if person_id:
        try:
            payload["person_id"] = int(person_id)
            payload["participants"] = [{"person_id": int(person_id), "primary_flag": True}]
        except (ValueError, TypeError):
            payload["person_id"] = person_id
            
    if org_id:
        try:
            payload["org_id"] = int(org_id)
        except (ValueError, TypeError):
            payload["org_id"] = org_id
            
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.pipedrive.com/v1/activities",
                params={"api_token": PIPEDRIVE_API_TOKEN},
                json=payload
            )
            
            if response.status_code not in [200, 201]:
                logger.error(f"Erro ao criar Activity no Pipedrive: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            logger.info(f"Atividade Pipedrive #{data.get('data', {}).get('id')} ('{subject}') criada com sucesso!")
            return data.get("data") if data.get("success") else data.get("data")
    except Exception as e:
        logger.error(f"Exceção ao criar atividade no Pipedrive: {e}")
        return None

async def update_pipedrive_activity(activity_id: str, updates: Dict) -> Optional[Dict]:
    """
    Atualiza Activity no Pipedrive usando API v1.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.put(
            f"https://api.pipedrive.com/v1/activities/{activity_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=updates
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao atualizar Activity {activity_id}: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

# ============================================================================
# VÍNCULO: transcrição -> atividade do Pipedrive
# ============================================================================

# Tipos de atividade que representam uma reunião com o cliente nesta conta.
# São os R1/R2/R3 do funil — `teams` fica de fora de propósito: existem R1
# antigos gravados com esse tipo, mas é dívida do passado, não regra.
TIPOS_REUNIAO = {"meeting": "R1", "reuniao_2": "R2", "r3": "R3"}

# Abaixo disto o candidato é tratado como outra pessoa. Calibrado com dados
# reais: "Mariana Vicário" tinha "Sérgio Bressan" como melhor palpite (0.28), e
# "Adilson Schelbauer" tinha "Radilson Carlos" (0.55). Vínculo errado é pior que
# vínculo ausente.
LIMIAR_COMPATIBILIDADE = 0.90

# A atividade nasce do compromisso agendado, então cai sempre na data exata.
# Medido com 0, 1 e 2 dias: resultado idêntico e nenhuma candidata múltipla.
# Fica como rede para reunião que atravessa a meia-noite ou é remarcada.
TOLERANCIA_DIAS = 1


def _normalizar_nome(txt: str) -> str:
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFKD", str(txt or "")) if not unicodedata.combining(c)
    )
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", "", sem_acento.lower())).strip()


# Conectivos não identificam ninguém e distorcem a proporção de tokens em comum.
_CONECTIVOS = {"de", "da", "do", "das", "dos", "e", "di", "del"}


def _tokens_nome(txt: str) -> List[str]:
    return [t for t in _normalizar_nome(txt).split() if t not in _CONECTIVOS and len(t) > 1]


def _casa_token(a: str, b: str) -> bool:
    """
    Dois pedaços de nome se referem à mesma palavra.

    Aceita prefixo a partir de 3 letras para cobrir apelido — "Ari" por
    "Ariovaldo". Prefixo, e não substring: "ari" casa com "ariovaldo" e com
    "ariane", mas não com "ferrari", que não é o nome de ninguém chamado Ari.
    """
    if a == b:
        return True
    curto, longo = (a, b) if len(a) <= len(b) else (b, a)
    return len(curto) >= 3 and longo.startswith(curto)


def _contido(a: List[str], b: List[str]) -> bool:
    return all(any(_casa_token(x, y) for y in b) for x in a)


def compatibilidade_nome(nome: str, titulo: str) -> float:
    """
    Quão provável é que `nome` e `titulo` sejam a mesma pessoa, de 0 a 1.

    A contenção é por palavra inteira, não por substring do texto corrido. Com
    substring, `"Ari"` valia 1.00 contra "Livia **Ari**ane" e "Ferr**ari**", e
    quatro negócios diferentes empatavam no topo — quem decidia era a ordem em
    que a API devolvia, não a regra. Medido: 7 das 24 transcrições avaliáveis
    caíam nesse empate, e em 3 delas outro empatado também tinha reunião na
    data.
    """
    a, b = _tokens_nome(nome), _tokens_nome(titulo)
    if not a or not b:
        return 0.0
    if _contido(a, b) or _contido(b, a):
        return 1.0
    comuns = sum(1 for x in a if any(_casa_token(x, y) for y in b))
    if comuns:
        proporcao = comuns / min(len(a), len(b))
        if proporcao >= 0.6:
            return 0.95
    return SequenceMatcher(None, _normalizar_nome(nome), _normalizar_nome(titulo)).ratio()


async def buscar_negocio_por_nome(client: httpx.AsyncClient, nome: str) -> List[Dict[str, Any]]:
    """
    Busca negócios pelo nome do cliente.

    O caminho é `/v1/deals/search`, sem o prefixo `/api`: a mesma rota sob
    `/api/v1` devolve 404 "Unknown method". A base não é consistente entre os
    endpoints do Pipedrive.
    """
    termo = (nome or "").strip().split()[0] if (nome or "").strip() else ""
    if len(termo) < 2:
        return []
    res = await client.get(
        "https://api.pipedrive.com/v1/deals/search",
        params={"api_token": PIPEDRIVE_API_TOKEN, "term": termo, "limit": 8},
    )
    if res.status_code != 200:
        logger.warning(f"deals/search respondeu {res.status_code} para '{termo}'")
        return []
    return ((res.json().get("data") or {}).get("items")) or []


async def encontrar_atividade_da_reuniao(
    nome_cliente: str, data_reuniao: Optional[str], meeting_title: str = ""
) -> Tuple[Optional[Dict[str, Any]], str, Dict[str, Any]]:
    """
    Localiza a atividade R1/R2/R3 que a transcrição documenta.

    Devolve `(atividade, motivo, detalhe)`. Com atividade encontrada o motivo é
    "OK"; caso contrário traz o código da falha e a evidência que levou a ela —
    é essa evidência que permite melhorar a regra depois.

    Quando vários negócios empatam no topo, nenhum é eleito por ordem de
    chegada. O desempate tenta primeiro o título da reunião, que costuma trazer
    o sobrenome que o campo `nome` não trouxe — foi o que separou
    "Márcio | R3 Marcio **Aguiar**" de "Márcio Paes". Persistindo o empate,
    procura a atividade em todos os empatados: vincula se existir exatamente
    uma na data, e desiste se houver mais de uma.
    """
    if not nome_cliente or len(nome_cliente) < 3 or "identificado" in nome_cliente.lower():
        return None, "SEM_NOME_CLIENTE", {"nome_recebido": nome_cliente}

    alvo = None
    if data_reuniao:
        m = re.match(r"(\d{2})/(\d{2})/(\d{4})", data_reuniao)
        if m:
            try:
                alvo = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).date()
            except ValueError:
                alvo = None
    if alvo is None:
        return None, "SEM_DATA_REUNIAO", {"data_recebida": data_reuniao}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            itens = await buscar_negocio_por_nome(client, nome_cliente)
        except Exception as e:
            return None, "ERRO_PIPEDRIVE", {"erro": str(e)[:200]}

        if not itens:
            return None, "NEGOCIO_NAO_ENCONTRADO", {"nome_buscado": nome_cliente}

        pontuados = [
            (compatibilidade_nome(nome_cliente, i["item"].get("title")), i["item"]) for i in itens
        ]
        melhor_score = max(s for s, _ in pontuados)

        if melhor_score < LIMIAR_COMPATIBILIDADE:
            melhor_titulo = max(pontuados, key=lambda p: p[0])[1].get("title")
            return None, "COMPATIBILIDADE_BAIXA", {
                "nome_buscado": nome_cliente,
                "melhor_candidato": melhor_titulo,
                "score": round(melhor_score, 2),
                "limiar": LIMIAR_COMPATIBILIDADE,
            }

        empatados = [n for s, n in pontuados if s == melhor_score]
        desempate = "nome"

        # O título da reunião só desempata quando ele próprio bate com folga.
        # Aceitar o "menos pior" aqui reintroduziria a escolha arbitrária, agora
        # com cara de critério.
        if len(empatados) > 1 and meeting_title:
            por_titulo = [(compatibilidade_nome(n.get("title"), meeting_title), n) for n in empatados]
            topo = max(s for s, _ in por_titulo)
            if topo >= LIMIAR_COMPATIBILIDADE:
                finalistas = [n for s, n in por_titulo if s == topo]
                if len(finalistas) < len(empatados):
                    empatados, desempate = finalistas, "titulo"

        candidatas: List[Dict[str, Any]] = []
        reunioes_por_negocio: Dict[str, List[str]] = {}
        for negocio in empatados:
            res = await client.get(
                f"https://api.pipedrive.com/v1/deals/{negocio['id']}/activities",
                params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 50},
            )
            if res.status_code != 200:
                return None, "ERRO_PIPEDRIVE", {"status": res.status_code, "deal_id": negocio["id"]}

            reunioes = [a for a in (res.json().get("data") or []) if a.get("type") in TIPOS_REUNIAO]
            # Chaveado por id, não por título: negócios duplicados têm o mesmo
            # título e um sobrescrevia a agenda do outro no relatório da falha.
            rotulo = f"{negocio.get('title')} (#{negocio['id']})"
            reunioes_por_negocio[rotulo] = sorted({str(a.get("due_date")) for a in reunioes})
            for a in reunioes:
                try:
                    quando = datetime.strptime(str(a.get("due_date")), "%Y-%m-%d").date()
                except (ValueError, TypeError):
                    continue
                if abs((quando - alvo).days) <= TOLERANCIA_DIAS:
                    candidatas.append({**a, "_negocio": negocio})

    base = {
        "nome_buscado": nome_cliente,
        "score": round(melhor_score, 2),
        "data_reuniao": str(alvo),
        "desempate": desempate,
        "negocios_avaliados": [
            {"id": n["id"], "titulo": n.get("title")} for n in empatados
        ],
    }

    if len(candidatas) == 1:
        escolhida = candidatas[0]
        negocio = escolhida.pop("_negocio")
        base["negocio"] = negocio.get("title")
        base["deal_id"] = negocio["id"]
        # Empate desfeito pela data merece revisão amostral: o nome sozinho não
        # bastava para saber de quem era a reunião.
        if len(empatados) > 1:
            base["desempate"] = "data"
        return escolhida, "OK", base

    if len(candidatas) > 1:
        base["candidatas"] = [
            {
                "id": a["id"],
                "tipo": TIPOS_REUNIAO.get(a.get("type")),
                "data": a.get("due_date"),
                "negocio": a["_negocio"].get("title"),
            }
            for a in candidatas
        ]
        return None, "MULTIPLAS_CANDIDATAS", base

    base["reunioes_no_negocio"] = sorted(
        {d for datas in reunioes_por_negocio.values() for d in datas}
    )
    base["reunioes_por_negocio"] = reunioes_por_negocio
    base["tolerancia_dias"] = TOLERANCIA_DIAS
    if empatados:
        base["negocio"] = empatados[0].get("title")
        base["deal_id"] = empatados[0]["id"]
    return None, "SEM_ATIVIDADE_NA_DATA", base


def _texto_seguro(v: Any) -> str:
    """Escapa o texto da transcrição antes de virar HTML de nota."""
    return html_lib.escape(str(v or "").strip())


def gerar_nota_da_atividade(
    briefing_json: Dict[str, Any], client_name: str, google_doc_id: Optional[str] = None
) -> str:
    """
    Nota enxuta anexada à atividade da reunião: quem, quando e onde ler.

    O briefing inteiro saiu daqui de propósito. Ele já existe no documento do
    Drive e na transcrição do Tactiq, e repetido dentro da atividade só deixava
    a timeline do negócio ilegível — eram ~3.600 caracteres por reunião.
    """
    nome = _texto_seguro(
        client_name or (briefing_json.get("dados_cliente") or {}).get("nome") or "Cliente"
    )
    data = _texto_seguro(briefing_json.get("data_reuniao"))
    hora = _texto_seguro(briefing_json.get("hora_reuniao"))
    quando = f"{data} às {hora}" if data and hora else data

    partes = [f"<p><strong>{nome}</strong>{f' — {quando}' if quando else ''}</p>"]

    tactiq = briefing_json.get("tactiq_link")
    if tactiq:
        url = _texto_seguro(tactiq)
        partes.append(f"<p><strong>Transcrição (Tactiq):</strong> <a href='{url}'>{url}</a></p>")

    if google_doc_id:
        url = f"https://docs.google.com/document/d/{_texto_seguro(google_doc_id)}/edit"
        partes.append(f"<p><strong>Documento (Google Drive):</strong> <a href='{url}'>{url}</a></p>")

    return "".join(partes)


def gerar_nota_proximos_passos(briefing_json: Dict[str, Any]) -> str:
    """O bloco DECISÕES E PRÓXIMOS PASSOS em bullets. Vazio quando não há nada."""
    itens = briefing_json.get("decisoes_proximos_passos") or []
    if isinstance(itens, str):
        # Formato antigo guardava tudo num texto só.
        itens = [linha.strip(" *-•\t") for linha in itens.splitlines()]
    itens = [_texto_seguro(i) for i in itens if str(i or "").strip()]
    if not itens:
        return ""
    return "<ul>" + "".join(f"<li>{i}</li>" for i in itens) + "</ul>"


async def criar_atividade_proximos_passos(
    briefing_json: Dict[str, Any], atividade: Dict[str, Any], detalhe: Dict[str, Any]
) -> Optional[str]:
    """
    Abre a tarefa "PRÓXIMOS PASSOS" com o que ficou combinado na reunião.

    Só roda depois do vínculo confirmado: sem atividade vinculada não há negócio
    de que se tenha certeza, e tarefa solta no CRM é pior que tarefa ausente.

    Reexecução **atualiza** a tarefa já criada em vez de abrir outra — o id fica
    guardado no briefing. Sem isso cada reavaliação deixaria mais uma "PRÓXIMOS
    PASSOS" no negócio, que é exatamente a duplicidade que o vínculo evita.
    """
    corpo = gerar_nota_proximos_passos(briefing_json)
    if not corpo:
        return None

    pipedrive = briefing_json.setdefault("pipedrive", {})
    existente = pipedrive.get("proximos_passos_activity_id")
    if existente:
        atualizada = await update_pipedrive_activity(str(existente), {"note": corpo})
        return str(existente) if atualizada else None

    nova = await create_pipedrive_activity(
        subject="PRÓXIMOS PASSOS",
        activity_type="task",
        due_date=atividade.get("due_date"),
        note_content=corpo,
        deal_id=str(detalhe["deal_id"]) if detalhe.get("deal_id") else None,
        person_id=str(atividade["person_id"]) if atividade.get("person_id") else None,
        done=False,  # é o que ainda falta fazer
    )
    if not nova:
        return None

    novo_id = str(nova.get("id"))
    pipedrive["proximos_passos_activity_id"] = novo_id
    return novo_id


async def vincular_briefing_na_atividade(
    briefing_json: Dict[str, Any], meeting_title: str, google_doc_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Anexa o briefing na atividade da reunião e a marca como concluída.

    `done` só é reescrito quando está `false`: as reuniões costumam já ter sido
    fechadas manualmente antes de a transcrição chegar, e não faz sentido
    reescrever um status que já está correto.

    Devolve o bloco `vinculo`, gravado no briefing para a tela poder explicar ao
    usuário por que não vinculou.
    """
    nome = (briefing_json.get("dados_cliente") or {}).get("nome") or ""
    atividade, motivo, detalhe = await encontrar_atividade_da_reuniao(
        nome, briefing_json.get("data_reuniao"), meeting_title
    )
    agora = datetime.utcnow().isoformat() + "Z"

    if not atividade:
        return {"status": "nao_vinculado", "motivo": motivo, "detalhe": detalhe, "avaliado_em": agora}

    campos: Dict[str, Any] = {
        "note": gerar_nota_da_atividade(briefing_json, nome, google_doc_id)
    }
    ja_concluida = bool(atividade.get("done"))
    if not ja_concluida:
        campos["done"] = True

    atualizada = await update_pipedrive_activity(str(atividade["id"]), campos)
    if not atualizada:
        return {
            "status": "nao_vinculado",
            "motivo": "ERRO_PIPEDRIVE",
            "detalhe": {**detalhe, "activity_id": atividade["id"], "erro": "PUT em /activities falhou"},
            "avaliado_em": agora,
        }

    # Só depois da atribuição confirmada. Uma falha aqui não desfaz o vínculo:
    # a reunião documentada vale por si, e a tarefa pode ser recriada depois.
    try:
        proximos_id = await criar_atividade_proximos_passos(briefing_json, atividade, detalhe)
    except Exception as e:
        logger.error(f"Falha ao criar PRÓXIMOS PASSOS de '{meeting_title}': {e}")
        proximos_id = None

    return {
        "status": "vinculado",
        "motivo": "OK",
        "activity_id": str(atividade["id"]),
        "activity_type": TIPOS_REUNIAO.get(atividade.get("type")),
        "activity_url": f"https://investimentosblue.pipedrive.com/activities/list#dialog/activity/{atividade['id']}",
        "ja_estava_concluida": ja_concluida,
        "proximos_passos_activity_id": proximos_id,
        "detalhe": detalhe,
        "avaliado_em": agora,
    }


# ============================================================================
# WEBHOOK: Google Drive
# ============================================================================

@app.post("/api/webhooks/google-drive")
async def google_drive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin)
):
    """
    Webhook do Google Drive quando novo arquivo é criado em Tactiq Transcription.
    Google Drive envia notificações vazias, então fazemos polling.
    """
    
    # Extrai headers do webhook
    channel_id = request.headers.get("X-Goog-Channel-ID")
    resource_id = request.headers.get("X-Goog-Resource-ID")
    resource_state = request.headers.get("X-Goog-Resource-State")
    
    logger.info(f"Google Drive webhook recebido: state={resource_state}, channel={channel_id}")
    
    if resource_state == "sync":
        # Sync message, apenas confirma
        return {"status": "ok"}
    
    # Processa mudança em background
    background_tasks.add_task(process_new_transcription, user["sub"])
    
    return {"status": "processing"}

# ============================================================================
# TACTIQ DOCUMENT PARSER
# ============================================================================

import re

def _normalizar_rotulo(txt: str) -> str:
    """
    Reduz um rótulo à forma canônica para comparação.

    Remove os parênteses explicativos do prompt — "Regime de casamento (se casado
    ou em união estável)" vira "regime de casamento", e "Nome(s) do(s) filho(s)"
    vira "nome do filho".
    """
    sem_parenteses = re.sub(r"\([^)]*\)", "", txt or "")
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFKD", sem_parenteses) if not unicodedata.combining(c)
    )
    return re.sub(r"\s+", " ", sem_acento).strip().strip(":").lower()


# Rótulos aceitos na seção DADOS DO CLIENTE -> campo canônico.
#
# Inclui as variações antigas junto com as do prompt atual: documentos já
# processados continuam sendo lidos, e um ajuste de redação no prompt não
# derruba a extração inteira.
ROTULOS_CLIENTE: Dict[str, str] = {
    "nome": "nome",
    "nome do cliente": "nome",
    "data de nascimento": "data_nascimento",
    "idade": "idade",
    "profissao": "profissao",
    "ocupacao": "profissao",
    "estado civil": "estado_civil",
    "regime de casamento": "regime_casamento",
    "regime de bens": "regime_casamento",
    "nome do conjuge": "nome_conjuge",
    "conjuge": "nome_conjuge",
    "conjuge sem protecao": "conjuge_sem_protecao",
    "nome do filho": "filhos",
    "filhos": "filhos",
    "herdeiros/filhos": "filhos",
    "herdeiros": "filhos",
    "filho sem protecao": "filhos_sem_protecao",
    "patrimonio ou bens mencionados": "patrimonio_bens",
    "patrimonio/bens": "patrimonio_bens",
    "patrimonio": "patrimonio_bens",
    "seguros ou apolices ja existentes": "seguros_existentes",
    "seguros/previdencia existentes": "seguros_existentes",
    "seguros existentes": "seguros_existentes",
    "seguros": "seguros_existentes",
    "demonstrou interesse": "demonstrou_interesse",
    "e-mail": "email",
    "email": "email",
    "telefone": "telefone",
    "celular": "telefone",
    "renda mensal": "renda_mensal",
    "renda": "renda_mensal",
}

# Campos cujo valor pode continuar nas linhas seguintes, como lista de itens.
CAMPOS_LISTA = {"patrimonio_bens", "seguros_existentes", "filhos"}

# O prompt escreve isto quando não apurou o dado. Guardar a string literal faria
# "Não informado" ser gravado no CRM como se fosse informação.
VAZIOS = {"nao informado", "nao informada", "nao informados", "n/a", "na", "-", "--", "nenhum", "nenhuma"}


def _valor_limpo(valor: str) -> str:
    v = (valor or "").strip().strip("*").strip()
    return "" if _normalizar_rotulo(v) in VAZIOS else v


def extrair_dados_cliente(bloco: str) -> Dict[str, Any]:
    """
    Lê a seção DADOS DO CLIENTE, que vem como pares `* Rótulo: valor`.

    Dois detalhes tornam a leitura ingênua incorreta:

    1. Rótulos como "Patrimônio ou bens mencionados:" não trazem valor na própria
       linha — os itens vêm nas linhas seguintes, também iniciadas por `*`.
    2. Itens de lista podem conter dois-pontos ("Conta/investimentos na XP: cerca
       de R$ 1,4 milhão"), então a presença de `:` não distingue rótulo de item.

    Por isso a decisão é tomada contra a lista de rótulos conhecidos, e tudo que
    não casa é tratado como continuação do campo anterior.
    """
    campos: Dict[str, Any] = {}
    listas: Dict[str, List[str]] = {chave: [] for chave in CAMPOS_LISTA}
    campo_atual: Optional[str] = None

    for linha in (bloco or "").split("\n"):
        conteudo = linha.strip().lstrip("*").strip()
        if not conteudo:
            continue

        rotulo_bruto, separador, resto = conteudo.partition(":")
        canonico = ROTULOS_CLIENTE.get(_normalizar_rotulo(rotulo_bruto)) if separador else None

        if canonico:
            campo_atual = canonico
            valor = _valor_limpo(resto)
            if canonico in CAMPOS_LISTA:
                if valor:
                    listas[canonico].append(valor)
            else:
                campos[canonico] = valor
        elif campo_atual in CAMPOS_LISTA:
            # Continuação: item da lista aberta pelo rótulo anterior.
            valor = _valor_limpo(conteudo)
            if valor:
                listas[campo_atual].append(valor)

    for chave, itens in listas.items():
        campos[f"{chave}_itens"] = itens
        campos[chave] = "; ".join(itens)

    return campos


# Cabeçalhos de seção do documento do Tactiq. Usados como delimitadores: uma
# seção vai até o próximo cabeçalho.
_CABECALHOS_TACTIQ = (
    r"RESUMO R[AÁ]PIDO",
    r"PRINCIPAIS T[ÓO]PICOS",
    r"DADOS DO CLIENTE",
    r"DECIS[OÕ]ES E PR[ÓO]XIMOS PASSOS",
    r"PONTOS DE ATEN[CÇ][AÃ]O",
    r"====",
)


def _bloco_da_secao(texto: str, cabecalho: str) -> Optional[str]:
    """
    Conteúdo de uma seção, do seu cabeçalho até o próximo.

    O cabeçalho seguinte é reconhecido **só no início de uma linha**. Sem essa
    âncora, a frase "…a leitura da apólice e os pontos de atenção da cobertura"
    dentro de um bullet era lida como o começo da seção PONTOS DE ATENÇÃO: o
    documento do Douglas tinha 6 decisões e só 4 chegavam ao briefing, a quarta
    cortada no meio. Silencioso — nada falhava, o texto só sumia.
    """
    outros = "|".join(c for c in _CABECALHOS_TACTIQ if c != cabecalho)
    m = re.search(
        rf"^[ \t]*{cabecalho}[^\n]*\n(.*?)(?=^[ \t]*(?:{outros})|\Z)",
        texto,
        re.IGNORECASE | re.DOTALL | re.MULTILINE,
    )
    return m.group(1) if m else None


def _itens_da_lista(bloco: str) -> List[str]:
    """Linhas do bloco sem o marcador de bullet, descartando as vazias."""
    itens = []
    for linha in bloco.strip().split("\n"):
        limpa = re.sub(r"^[\*\-\•\d\.]+\s*", "", linha).strip()
        if limpa and len(limpa) > 3:
            itens.append(limpa)
    return itens


def parse_tactiq_doc(text: str, file_name: str = "") -> dict:
    """
    Parser para extrair dados estruturados dos Google Docs gerados pelo Tactiq
    Suporta formato legado e novo formato com Resumo Rápido, Decisões, Data/Hora e Pontos de Atenção.
    """
    now = datetime.utcnow()
    data = {
        "resumo_rapido": "",
        "data_reuniao": "",
        "hora_reuniao": "",
        "principais_topicos": [],
        "dados_cliente": {
            # Chaves históricas — o gerador de HTML e a sincronização com o
            # Pipedrive dependem delas, então continuam sempre presentes.
            "nome": "",
            "idade": "",
            "estado_civil": "",
            "herdeiros_filhos": "",
            "patrimonio_bens": "",
            "seguros_existentes": "",
            "demonstrou_interesse": "",
            "email": "",
            # Campos que o prompt novo passou a fornecer.
            "data_nascimento": "",
            "profissao": "",
            "regime_casamento": "",
            "nome_conjuge": "",
            "conjuge_sem_protecao": "",
            "filhos_sem_protecao": "",
            "telefone": "",
            "renda_mensal": "",
            # Versões em lista, para consumo estruturado sem quebrar as strings.
            "filhos_itens": [],
            "patrimonio_bens_itens": [],
            "seguros_existentes_itens": [],
        },
        "decisoes_proximos_passos": [],
        "pontos_atencao": [],
        "proxima_acao": {
            "descricao": "",
            "prazo_sugerido": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
            "prioridade": "média"
        },
        "participantes": [],
        "tactiq_link": "",
        "pipedrive": {
            "person_id": None,
            "deal_id": None,
            "note_id": None,
            "activity_id": None,
            "person_url": None,
            "deal_url": None
        }
    }
    
    # 1. Link Tactiq (busca link app.tactiq.io ou regex flexível)
    link_match = re.search(r"https?://(?:app\.)?tactiq\.io/[^\s\)\>]+", text, re.IGNORECASE)
    if link_match:
        data["tactiq_link"] = link_match.group(0).strip()
    else:
        link_fallback = re.search(r"Link da reuni[aã]o.*:\s*(https?://[^\s]+)", text, re.IGNORECASE)
        if link_fallback:
            data["tactiq_link"] = link_fallback.group(1).strip()
        
    # 2. Participantes
    part_match = re.search(r"PARTICIPANTES_NOME:\s*(.*)", text, re.IGNORECASE)
    if part_match:
        parts = [p.strip() for p in part_match.group(1).split(",") if p.strip()]
        data["participantes"] = parts

    # 3. Resumo Rápido
    resumo_match = _bloco_da_secao(text, r"RESUMO R[AÁ]PIDO")
    if resumo_match:
        data["resumo_rapido"] = resumo_match.strip()
        
    # 4. Dados do Cliente — lidos por rótulo dentro da própria seção.
    #
    # Delimitar a seção importa: fora dela existem linhas com `*` e dois-pontos
    # (tópicos, decisões) que a busca solta no texto inteiro capturava por engano.
    bloco_cliente = _bloco_da_secao(text, r"DADOS DO CLIENTE")
    if bloco_cliente:
        data["dados_cliente"].update(extrair_dados_cliente(bloco_cliente))

    # `herdeiros_filhos` é o nome histórico do campo de filhos.
    if data["dados_cliente"].get("filhos"):
        data["dados_cliente"]["herdeiros_filhos"] = data["dados_cliente"]["filhos"]

    # Sem nome apurado, cai no primeiro participante que não seja da casa.
    if not data["dados_cliente"].get("nome") and data["participantes"]:
        for p in data["participantes"]:
            if "robson" not in p.lower() and "alexandre" not in p.lower():
                data["dados_cliente"]["nome"] = p
                break


    # 5. Principais Tópicos
    topicos_section = _bloco_da_secao(text, r"PRINCIPAIS T[ÓO]PICOS")
    if topicos_section:
        data["principais_topicos"] = _itens_da_lista(topicos_section)

    # 6. Decisões e Próximos Passos
    decisoes_section = _bloco_da_secao(text, r"DECIS[OÕ]ES E PR[ÓO]XIMOS PASSOS")
    if decisoes_section:
        data["decisoes_proximos_passos"] = _itens_da_lista(decisoes_section)

    # 7. Pontos de Atenção
    atencao_section = _bloco_da_secao(text, r"PONTOS DE ATEN[CÇ][AÃ]O")
    if atencao_section:
        data["pontos_atencao"] = _itens_da_lista(atencao_section)

    # 8. Extração de Data e Horário da Reunião (quando presente no documento)
    # 8.1 Padrão combinado (ex: "Data e horário da reunião: 25/08/2026 às 00:00" ou "Data e Hora: 25/08/2026 14:30")
    combined_date_match = re.search(
        r"Data\s*(?:e|/)?\s*(?:hor[aá]rio|hora)[^\:]*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})(?:\s*(?:[aàá]s|at|-|,)?\s*(\d{1,2}:\d{2}(?::\d{2})?))?",
        text,
        re.IGNORECASE
    )
    if combined_date_match:
        data["data_reuniao"] = combined_date_match.group(1).strip()
        if combined_date_match.group(2):
            data["hora_reuniao"] = combined_date_match.group(2).strip()

    if not data["data_reuniao"]:
        date_match = re.search(
            r"(?:Data(?:\s*da\s*reuni[aã]o|\s*do\s*atendimento)?|DATA):\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})",
            text,
            re.IGNORECASE
        )
        if date_match:
            data["data_reuniao"] = date_match.group(1).strip()

    if not data["hora_reuniao"]:
        time_match = re.search(
            r"(?:Hora(?:\s*da\s*reuni[aã]o|\s*do\s*atendimento)?|Hor[aá]rio|HORA):\s*(\d{1,2}:\d{2}(?::\d{2})?)",
            text,
            re.IGNORECASE
        )
        if time_match:
            data["hora_reuniao"] = time_match.group(1).strip()

    # 9. Próxima Ação Sugerida
    proxima_acao_desc = ""
    for d in reversed(data["decisoes_proximos_passos"]):
        if any(keyword in d.lower() for keyword in ["agend", "reuni", "combinad", "enviar", "apresenta", "propost", "análise", "follow"]):
            proxima_acao_desc = d
            break
            
    if not proxima_acao_desc:
        for t in reversed(data["principais_topicos"]):
            if any(keyword in t.lower() for keyword in ["agend", "reuni", "propost", "enviar", "apresenta", "retorno", "custo", "avaliar", "estudo"]):
                proxima_acao_desc = t
                break
            
    if not proxima_acao_desc:
        if data["decisoes_proximos_passos"]:
            proxima_acao_desc = data["decisoes_proximos_passos"][0]
        elif data["principais_topicos"]:
            proxima_acao_desc = f"Follow-up: {data['principais_topicos'][-1]}"
        else:
            proxima_acao_desc = f"Follow-up reunião com {data['dados_cliente']['nome'] or file_name}"
            
    data["proxima_acao"]["descricao"] = proxima_acao_desc[:250]
    
    # Prioridade
    interesse = data["dados_cliente"]["demonstrou_interesse"].lower()
    if "sim" in interesse or "alto" in interesse or "muito" in interesse or "aprovou" in interesse:
        data["proxima_acao"]["prioridade"] = "alta"
    elif "não" in interesse or "baixo" in interesse or "recus" in interesse:
        data["proxima_acao"]["prioridade"] = "baixa"
    else:
        data["proxima_acao"]["prioridade"] = "média"
        
    return data

def generate_pipedrive_briefing_html(briefing_json: dict, meeting_title: str, client_name: str) -> str:
    """
    Gera o HTML rico e formatado para a nota no Pipedrive conforme especificação:
    Reunião: [Título]
    Cliente: [Nome]
    🔗 Link da Gravação - [Link]
    
    📝 Resumo Executivo:
    ...
    """
    tactiq_url = briefing_json.get("tactiq_link")
    tactiq_line_html = (
        f"<p><strong>🔗 Link da Gravação -</strong> <a href='{tactiq_url}' target='_blank' style='color: #0092FF;'>{tactiq_url}</a></p>"
    ) if tactiq_url else ""

    data_reuniao = briefing_json.get("data_reuniao")
    hora_reuniao = briefing_json.get("hora_reuniao")
    data_hora_line = ""
    if data_reuniao and hora_reuniao:
        data_hora_line = f"<p><strong>Data & Horário:</strong> {data_reuniao} às {hora_reuniao}</p>"
    elif data_reuniao:
        data_hora_line = f"<p><strong>Data:</strong> {data_reuniao}</p>"

    resumo_html = f"<p><strong>📝 Resumo Executivo:</strong><br/>{briefing_json.get('resumo_rapido')}</p>" if briefing_json.get("resumo_rapido") else ""
    
    dados_cli = briefing_json.get("dados_cliente", {})
    dados_extras = []
    if dados_cli.get("idade"):
        dados_extras.append(f"<li><strong>Idade:</strong> {dados_cli.get('idade')}</li>")
    if dados_cli.get("estado_civil"):
        dados_extras.append(f"<li><strong>Estado Civil:</strong> {dados_cli.get('estado_civil')}</li>")
    if dados_cli.get("herdeiros_filhos"):
        dados_extras.append(f"<li><strong>Herdeiros/Filhos:</strong> {dados_cli.get('herdeiros_filhos')}</li>")
    if dados_cli.get("patrimonio_bens"):
        dados_extras.append(f"<li><strong>Patrimônio/Bens:</strong> {dados_cli.get('patrimonio_bens')}</li>")
    if dados_cli.get("seguros_existentes"):
        dados_extras.append(f"<li><strong>Seguros/Previdência Existentes:</strong> {dados_cli.get('seguros_existentes')}</li>")
    if dados_cli.get("demonstrou_interesse"):
        dados_extras.append(f"<li><strong>Interesse:</strong> {dados_cli.get('demonstrou_interesse')}</li>")
    dados_cli_html = f"<h4>👤 Dados do Cliente:</h4><ul>{''.join(dados_extras)}</ul>" if dados_extras else ""

    topicos_html = "".join([f"<li>{t}</li>" for t in briefing_json.get("principais_topicos", [])])
    decisoes_html = "".join([f"<li>{d}</li>" for d in briefing_json.get("decisoes_proximos_passos", [])])
    atencao_html = "".join([f"<li>{a}</li>" for a in briefing_json.get("pontos_atencao", [])])

    decisoes_section = f"<h4>✅ Decisões e Próximos Passos:</h4><ul>{decisoes_html}</ul>" if decisoes_html else ""
    atencao_section = f"<h4>⚠️ Pontos de Atenção para a Próxima Reunião:</h4><ul>{atencao_html}</ul>" if atencao_html else ""

    html = (
        f"<p><strong>Reunião:</strong> {meeting_title}</p>"
        f"<p><strong>Cliente:</strong> {client_name}</p>"
        f"{data_hora_line}"
        f"{tactiq_line_html}"
        f"{resumo_html}"
        f"{dados_cli_html}"
        f"<h4>📌 Principais Tópicos Abordados:</h4>"
        f"<ul>{topicos_html or '<li>Discussão patrimonial e sucessória.</li>'}</ul>"
        f"{decisoes_section}"
        f"{atencao_section}"
        f"<hr/>"
        f"<p><em>⚡ Sincronizado automaticamente pelo Sistema Robson Tavernard</em></p>"
    )
    return html

async def get_person_deals(person_id: str) -> Optional[List[Dict]]:
    """Busca deals associados a uma pessoa no Pipedrive"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{PIPEDRIVE_BASE_URL}/deals",
                params={"person_id": person_id, "api_token": PIPEDRIVE_API_TOKEN}
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("data", []) if data.get("success") else []
    except Exception as e:
        logger.error(f"Erro ao buscar deals da pessoa {person_id}: {e}")
    return []

# ============================================================================
# PROCESSAMENTO DE TRANSCRIÇÃO
# ============================================================================

async def process_new_transcription(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Background task: processa novas transcrições do Drive com parser real"""
    stats = {"total_files": 0, "processed_new": 0, "already_existing": 0, "errors": 0}
    
    clean_user_id = None
    if user_id:
        try:
            uuid.UUID(str(user_id))
            clean_user_id = str(user_id)
        except (ValueError, AttributeError):
            clean_user_id = None
            
    if not clean_user_id:
        try:
            admin_res = supabase.table("users").select("id").limit(1).execute()
            if admin_res.data:
                clean_user_id = admin_res.data[0]["id"]
        except Exception as e:
            logger.warning(f"Não foi possível obter fallback de user_id: {e}")
            
    try:
        folder_id = find_google_drive_folder()
        service = get_google_drive_service()
        
        # Lista arquivos na pasta
        query = f"'{folder_id}' in parents and trashed=false"
        results = service.files().list(
            q=query,
            spaces="drive",
            fields="files(id, name, createdTime, mimeType)",
            orderBy="createdTime desc",
            pageSize=100
        ).execute()
        
        files = results.get("files", [])
        stats["total_files"] = len(files)
        logger.info(f"Encontrados {len(files)} arquivos na pasta do Google Drive")
        
        for file in files:
            if file.get("mimeType") != "application/vnd.google-apps.document":
                continue
                
            google_doc_id = file["id"]
            meeting_title = file["name"]
            created_time = file.get("createdTime")
            
            # Extrai data da reunião em formato YYYY-MM-DD
            meeting_date_str = (created_time[:10] if created_time else None) or datetime.now().strftime("%Y-%m-%d")
            
            # Verifica se já foi processado com sucesso ou se foi ignorado/desvinculado/excluído
            existing = supabase.table("transcriptions").select("id, processing_status, briefing_json").eq(
                "google_doc_id", google_doc_id
            ).execute()
            
            existing_record = existing.data[0] if existing.data else None
            if existing_record:
                ex_status = existing_record.get("processing_status")
                ex_briefing = existing_record.get("briefing_json") or {}
                
                # Se já foi completado com briefing, ou marcado como ignorado/desvinculado/excluído, não reprocessa nem recria atividade
                if ex_status in ["completed", "ignored"] and ex_briefing:
                    stats["already_existing"] += 1
                    continue
                if ex_briefing.get("is_ignored") or ex_briefing.get("manually_unlinked") or ex_briefing.get("is_deleted"):
                    stats["already_existing"] += 1
                    continue
                
            logger.info(f"Processando arquivo do Drive: {meeting_title}")
            
            try:
                # Lê conteúdo do arquivo
                transcription_text = read_google_doc_as_text(google_doc_id)
                
                # Se já existe no banco (stuck em processing/failed), reaproveita o ID; senão insere
                if existing_record:
                    transcription_id = existing_record["id"]
                    supabase.table("transcriptions").update({
                        "meeting_title": meeting_title,
                        "meeting_date": created_time,
                        "transcription_text": transcription_text,
                        "processing_status": "processing"
                    }).eq("id", transcription_id).execute()
                else:
                    insert_data = {
                        "google_doc_id": google_doc_id,
                        "meeting_title": meeting_title,
                        "meeting_date": created_time,
                        "transcription_text": transcription_text,
                        "processing_status": "processing"
                    }
                    if clean_user_id:
                        insert_data["created_by"] = clean_user_id
                        
                    transcription_record = supabase.table("transcriptions").insert(insert_data).execute()
                    transcription_id = transcription_record.data[0]["id"]
                
                # Executa parser real do Tactiq
                briefing_json = parse_tactiq_doc(transcription_text, meeting_title)
                cliente_nome = briefing_json["dados_cliente"]["nome"]
                cliente_email = briefing_json["dados_cliente"].get("email")
                
                # Garante que data e hora estejam sempre preenchidas mesmo se ausentes no texto do doc
                if created_time:
                    try:
                        dt_utc = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
                        dt_sp = dt_utc - timedelta(hours=3)
                        if not briefing_json.get("data_reuniao"):
                            briefing_json["data_reuniao"] = dt_sp.strftime("%d/%m/%Y")
                        if not briefing_json.get("hora_reuniao"):
                            briefing_json["hora_reuniao"] = dt_sp.strftime("%H:%M")
                    except Exception:
                        pass

                # Preserva flags de controle prévias caso existam
                if existing_record and existing_record.get("briefing_json"):
                    prev_b = existing_record["briefing_json"]
                    if prev_b.get("is_ignored"):
                        briefing_json["is_ignored"] = True
                    if prev_b.get("manually_unlinked"):
                        briefing_json["manually_unlinked"] = True
                    if prev_b.get("is_deleted"):
                        briefing_json["is_deleted"] = True
                
                person_id = None
                deal_id = None
                activity_id = None
                matching_confidence = 0.0
                
                # Não cria atividade se o arquivo estiver marcado como ignorado ou desvinculado
                should_link_crm = not briefing_json.get("is_ignored") and not briefing_json.get("manually_unlinked") and not briefing_json.get("is_deleted")
                
                if should_link_crm and cliente_nome and len(cliente_nome) > 2:
                    # Busca no Pipedrive
                    person_results = await search_pipedrive_person(cliente_nome, cliente_email)
                    
                    if person_results and len(person_results) > 0:
                        # Encontrou pessoa no Pipedrive
                        first_person = person_results[0]
                        item_data = first_person.get("item", first_person)
                        person_id = str(item_data.get("id"))
                        matching_confidence = 1.0 if len(person_results) == 1 else 0.75
                        
                        # Gera link direto do cliente
                        briefing_json["pipedrive"]["person_id"] = person_id
                        briefing_json["pipedrive"]["person_url"] = f"https://investimentosblue.pipedrive.com/person/{person_id}"
                        
                        # Busca Deals abertos do cliente
                        deals = await get_person_deals(person_id)
                        if deals:
                            deal_id = str(deals[0].get("id"))
                            briefing_json["pipedrive"]["deal_id"] = deal_id
                            briefing_json["pipedrive"]["deal_url"] = f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
                        
                        if matching_confidence >= 0.70:
                            briefing_note_html = generate_pipedrive_briefing_html(
                                briefing_json=briefing_json,
                                meeting_title=meeting_title,
                                client_name=cliente_nome
                            )
                            
                            note_res = await create_pipedrive_note(
                                content=briefing_note_html,
                                person_id=person_id,
                                deal_id=deal_id
                            )
                            if note_res:
                                note_id = str(note_res.get("id"))
                                briefing_json["pipedrive"]["note_id"] = note_id
                                briefing_json["pipedrive"]["activity_id"] = None
                                logger.info(f"Nota Pipedrive criada com sucesso: #{note_id} para {cliente_nome}")

                # Vincula o briefing à atividade da reunião (R1/R2/R3) que já
                # existe na agenda. Toda falha registra o motivo e a evidência,
                # para a tela poder explicar e a regra poder ser melhorada.
                if should_link_crm:
                    try:
                        vinculo = await vincular_briefing_na_atividade(
                            briefing_json, meeting_title, google_doc_id
                        )
                    except Exception as e:
                        logger.error(f"Falha ao vincular atividade de '{meeting_title}': {e}")
                        vinculo = {
                            "status": "nao_vinculado",
                            "motivo": "ERRO_PIPEDRIVE",
                            "detalhe": {"erro": str(e)[:200]},
                            "avaliado_em": datetime.utcnow().isoformat() + "Z",
                        }
                    briefing_json["vinculo"] = vinculo

                    if vinculo["status"] == "vinculado":
                        activity_id = vinculo["activity_id"]
                        briefing_json["pipedrive"]["activity_id"] = activity_id

                    log_audit_event(
                        action="TRANSCRIPTION_LINKED" if vinculo["status"] == "vinculado"
                               else "TRANSCRIPTION_LINK_FAILED",
                        resource_type="transcription",
                        resource_id=transcription_id,
                        user_id=clean_user_id,
                        details={
                            "doc_title": meeting_title,
                            "cliente_nome": cliente_nome,
                            "motivo": vinculo["motivo"],
                            **vinculo.get("detalhe", {}),
                            **({"activity_id": vinculo["activity_id"],
                                "activity_type": vinculo.get("activity_type"),
                                "ja_estava_concluida": vinculo.get("ja_estava_concluida")}
                               if vinculo["status"] == "vinculado" else {}),
                        },
                    )

                # Atualiza transcrição para completed com o briefing real
                supabase.table("transcriptions").update({
                    "processing_status": "completed",
                    "briefing_json": briefing_json
                }).eq("id", transcription_id).execute()
                
                stats["processed_new"] += 1
                
                # Registra no log de auditoria
                is_linked = bool(deal_id or person_id)
                if is_linked:
                    action_type = "DRIVE_DOC_LINKED"
                    note_id_str = briefing_json.get("pipedrive", {}).get("note_id")
                    summary_text = f"Arquivo '{meeting_title}' recebido do Google Drive e vinculado com sucesso ao cliente '{cliente_nome or 'Identificado'}'" + (f" e Deal #{deal_id}" if deal_id else "") + (f" no Pipedrive com nota (#{note_id_str}) sincronizada." if note_id_str else " no Pipedrive.")
                else:
                    action_type = "DRIVE_DOC_UNLINKED"
                    if cliente_nome and cliente_nome.lower() != "cliente":
                        summary_text = f"Arquivo '{meeting_title}' processado pela IA (mencionou '{cliente_nome}'). Não foi vinculado ao Pipedrive pois o contato não foi localizado no CRM ou trata-se de reunião interna."
                    else:
                        summary_text = f"Arquivo '{meeting_title}' processado pela IA. Reunião interna da equipe ou sem cliente externo identificado no Pipedrive."

                log_audit_event(
                    action=action_type,
                    resource_type="transcription",
                    resource_id=transcription_id,
                    user_id=clean_user_id,
                    details={
                        "doc_title": meeting_title,
                        "google_doc_id": google_doc_id,
                        "cliente_nome": cliente_nome if cliente_nome and cliente_nome.lower() != "cliente" else None,
                        "cliente_email": cliente_email,
                        "matching_confidence": matching_confidence,
                        "pipedrive_person_id": person_id,
                        "pipedrive_deal_id": deal_id,
                        "pipedrive_activity_id": activity_id,
                        "deal_url": briefing_json.get("pipedrive", {}).get("deal_url"),
                        "person_url": briefing_json.get("pipedrive", {}).get("person_url"),
                        "proxima_acao": briefing_json.get("proxima_acao", {}).get("descricao") if is_linked else None,
                        "tactiq_link": briefing_json.get("tactiq_link"),
                        "is_linked_to_crm": is_linked,
                        "summary": summary_text
                    }
                )
                logger.info(f"Transcrição concluída e auditada ({action_type}): {meeting_title}")
            except Exception as file_err:
                logger.error(f"Erro ao processar arquivo {meeting_title} ({google_doc_id}): {file_err}")
                stats["errors"] += 1
            
    except Exception as e:
        logger.error(f"Erro no processamento de transcrições: {e}")
        stats["errors"] += 1
        
    return stats

# ============================================================================
# PIPEDRIVE ENDPOINTS
# ============================================================================

@app.post("/api/pipedrive/persons")
async def search_pipedrive_persons(
    request: Request,
    user: dict = Depends(require_admin)
):
    """Busca pessoa no Pipedrive por nome ou email"""
    try:
        body = await request.json()
        name = body.get("name")
        email = body.get("email")
        
        if not name:
            raise HTTPException(status_code=400, detail="Nome é obrigatório")
        
        results = await search_pipedrive_person(name, email)
        
        if results is None:
            raise HTTPException(status_code=500, detail="Erro ao buscar no Pipedrive")
        
        return {"results": results}
    except Exception as e:
        logger.error(f"Erro ao processar request: {e}")
        raise HTTPException(status_code=400, detail=f"Erro ao processar request: {str(e)}")

@app.get("/api/pipedrive/search-persons")
async def search_persons_autocomplete(
    term: str,
    user: dict = Depends(require_admin)
):
    """Busca pessoas no Pipedrive para autocomplete e atribuição"""
    if not term or len(term.strip()) < 2:
        return {"items": []}
        
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/persons/search",
            params={"term": term.strip(), "api_token": PIPEDRIVE_API_TOKEN, "limit": 10}
        )
        if res.status_code != 200:
            return {"items": []}
            
        raw_items = res.json().get("data", {}).get("items", [])
        formatted = []
        for it in raw_items:
            item = it.get("item", it)
            emails = item.get("emails", [])
            primary_email = emails[0] if emails and isinstance(emails, list) else item.get("email", "")
            phones = item.get("phones", [])
            primary_phone = phones[0] if phones and isinstance(phones, list) else item.get("phone", "")
            formatted.append({
                "id": str(item.get("id")),
                "name": item.get("name"),
                "email": primary_email,
                "phone": primary_phone,
                "url": f"https://investimentosblue.pipedrive.com/person/{item.get('id')}"
            })
        return {"items": formatted}

@app.get("/api/pipedrive/search-deals")
async def search_deals_autocomplete(
    term: str,
    user: dict = Depends(require_admin)
):
    """Busca negócios no Pipedrive para autocomplete e atribuição"""
    if not term or len(term.strip()) < 1:
        return {"items": []}
        
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/search",
            params={"term": term.strip(), "api_token": PIPEDRIVE_API_TOKEN, "limit": 10}
        )
        if res.status_code != 200:
            return {"items": []}
            
        raw_items = res.json().get("data", {}).get("items", [])
        formatted = []
        for it in raw_items:
            item = it.get("item", it)
            person = item.get("person") or {}
            formatted.append({
                "id": str(item.get("id")),
                "title": item.get("title"),
                "status": item.get("status"),
                "person_id": str(person.get("id")) if person.get("id") else None,
                "person_name": person.get("name"),
                "url": f"https://investimentosblue.pipedrive.com/deal/{item.get('id')}"
            })
        return {"items": formatted}

@app.get("/api/pipedrive/deal/{deal_id}")
async def get_deal_by_id(
    deal_id: str,
    user: dict = Depends(require_admin)
):
    """Busca detalhes de um deal específico pelo ID no Pipedrive"""
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        if res.status_code != 200:
            raise HTTPException(status_code=404, detail="Negócio não encontrado no Pipedrive")
            
        data = res.json().get("data", {})
        person = data.get("person") or {}
        return {
            "id": str(data.get("id")),
            "title": data.get("title"),
            "status": data.get("status"),
            "person_id": str(person.get("id")) if person.get("id") else None,
            "person_name": person.get("name"),
            "url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
        }

async def delete_pipedrive_activity(activity_id: str) -> bool:
    """Exclui uma atividade existente no Pipedrive"""
    if not activity_id or not PIPEDRIVE_API_TOKEN:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.delete(
                f"https://api.pipedrive.com/v1/activities/{activity_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code in [200, 204]:
                logger.info(f"Atividade #{activity_id} excluída com sucesso no Pipedrive.")
                return True
            else:
                logger.warning(f"Resposta ao excluir atividade {activity_id}: {res.status_code} - {res.text}")
                return False
    except Exception as e:
        logger.error(f"Erro ao excluir atividade {activity_id} no Pipedrive: {e}")
        return False

async def create_pipedrive_note(
    content: str,
    person_id: Optional[str] = None,
    deal_id: Optional[str] = None
) -> Optional[Dict]:
    """Cria uma Nota no Pipedrive vinculada à Pessoa e/ou ao Negócio"""
    if not PIPEDRIVE_API_TOKEN:
        logger.warning("PIPEDRIVE_API_TOKEN não configurado.")
        return None
    try:
        payload: Dict[str, Any] = {
            "content": content,
            "pinned_to_deal_flag": 0,
            "pinned_to_person_flag": 0
        }
        if person_id:
            try:
                payload["person_id"] = int(person_id)
            except (ValueError, TypeError):
                payload["person_id"] = person_id
        if deal_id:
            try:
                payload["deal_id"] = int(deal_id)
            except (ValueError, TypeError):
                payload["deal_id"] = deal_id

        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(
                "https://api.pipedrive.com/v1/notes",
                params={"api_token": PIPEDRIVE_API_TOKEN},
                json=payload
            )
            if res.status_code in [200, 201]:
                data = res.json().get("data") or {}
                logger.info(f"Nota #{data.get('id')} criada com sucesso no Pipedrive para person_id={person_id}, deal_id={deal_id}.")
                return data
            else:
                logger.error(f"Falha ao criar nota no Pipedrive: {res.status_code} - {res.text}")
                return None
    except Exception as e:
        logger.error(f"Exceção ao criar nota no Pipedrive: {e}")
        return None

async def delete_pipedrive_note(note_id: str) -> bool:
    """Exclui uma nota existente no Pipedrive"""
    if not note_id or not PIPEDRIVE_API_TOKEN:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.delete(
                f"https://api.pipedrive.com/v1/notes/{note_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code in [200, 204]:
                logger.info(f"Nota #{note_id} excluída com sucesso no Pipedrive.")
                return True
            else:
                return False
    except Exception as e:
        logger.error(f"Erro ao excluir nota {note_id} no Pipedrive: {e}")
        return False

# ============================================================================
# PIPEDRIVE: ATIVIDADES, ASSESSORES (ORGANIZAÇÕES) & AGENDA
# ============================================================================

DIAS_SEMANA_PT = {
    0: "segunda-feira",
    1: "terça-feira",
    2: "quarta-feira",
    3: "quinta-feira",
    4: "sexta-feira",
    5: "sábado",
    6: "domingo"
}

@app.get("/api/calendar/assessores")
@app.get("/api/pipedrive/assessores")
async def list_pipedrive_assessores(user: Optional[dict] = Depends(get_current_user_optional)):
    """Lista todas as Organizações (Assessores) cadastradas no Pipedrive"""
    if not PIPEDRIVE_API_TOKEN:
        return {"assessores": []}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                "https://api.pipedrive.com/v1/organizations",
                params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 100}
            )
            if res.status_code != 200:
                return {"assessores": []}
            data = res.json().get("data") or []
            assessores = [{"id": o.get("id"), "name": o.get("name")} for o in data if o.get("name")]
            return {"assessores": sorted(assessores, key=lambda x: x["name"])}
    except Exception as e:
        logger.error(f"Erro ao buscar assessores no Pipedrive: {e}")
        return {"assessores": []}

def format_whatsapp_template(template_str: str, ctx: Dict[str, Any]) -> str:
    """
    Substitui tags no formato {tag} em templates de WhatsApp.
    Suporta mapeamentos em português e inglês.
    """
    if not template_str:
        return ""
        
    tag_map = {
        "cliente": ctx.get("cliente") or ctx.get("person_name") or "",
        "person_name": ctx.get("cliente") or ctx.get("person_name") or "",
        "assunto": ctx.get("assunto") or ctx.get("subject") or "Reunião",
        "subject": ctx.get("assunto") or ctx.get("subject") or "Reunião",
        "horario": ctx.get("horario") or ctx.get("time_slot") or "",
        "time_slot": ctx.get("horario") or ctx.get("time_slot") or "",
        "horario_inicio": ctx.get("horario_inicio") or ctx.get("start_fmt") or "",
        "start_fmt": ctx.get("horario_inicio") or ctx.get("start_fmt") or "",
        "horario_fim": ctx.get("horario_fim") or ctx.get("end_fmt") or "",
        "end_fmt": ctx.get("horario_fim") or ctx.get("end_fmt") or "",
        "duracao": ctx.get("duracao") or ctx.get("duration_str") or "",
        "duration_str": ctx.get("duracao") or ctx.get("duration_str") or "",
        "dia_semana": ctx.get("dia_semana") or ctx.get("day_name") or "",
        "day_of_week": ctx.get("dia_semana") or ctx.get("day_name") or "",
        "data": ctx.get("data") or ctx.get("date_display") or "",
        "date_display": ctx.get("data") or ctx.get("date_display") or "",
        "data_completa": ctx.get("data_completa") or ctx.get("due_date_str") or "",
        "due_date_str": ctx.get("data_completa") or ctx.get("due_date_str") or "",
        "assessor": ctx.get("assessor") or ctx.get("org_name") or "",
        "org_name": ctx.get("assessor") or ctx.get("org_name") or "",
        "deal": ctx.get("deal") or ctx.get("deal_title") or "",
        "deal_title": ctx.get("deal") or ctx.get("deal_title") or "",
        "deal_id": str(ctx.get("deal_id") or "")
    }
    
    result = template_str
    for k, v in tag_map.items():
        result = result.replace(f"{{{k}}}", str(v))
    return result

DEFAULT_ACTIVITY_TYPES_MAP = {
    "meeting": {"name": "R1", "icon_key": "meeting"},
    "reuniao_2": {"name": "R2", "icon_key": "document"},
    "r3": {"name": "R3", "icon_key": "finish"},
    "tactiq": {"name": "Tactiq", "icon_key": "checkbox"},
    "call": {"name": "Chamada", "icon_key": "call"},
    "whatsapp": {"name": "WhatsApp", "icon_key": "smartphone"},
    "email": {"name": "E-mail", "icon_key": "email"},
    "task": {"name": "Tarefa", "icon_key": "task"},
    "deadline": {"name": "Prazo", "icon_key": "deadline"},
    "teams": {"name": "Teams", "icon_key": "clip"},
    "no_show": {"name": "R1 No Show", "icon_key": "scissors"},
    "r2_no_show": {"name": "R2 No Show", "icon_key": "scissors"},
    "r3_no_show": {"name": "R3 No Show", "icon_key": "scissors"}
}

@app.get("/api/pipedrive/activities")
async def list_pipedrive_activities(
    assessor_name: Optional[str] = None,
    assessor_id: Optional[int] = None,
    activity_type: Optional[str] = None,
    tag: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    period: Optional[str] = None,
    done: Optional[bool] = None,
    user: dict = Depends(require_admin)
):
    """
    Lista atividades do Pipedrive com suporte a paginação completa,
    filtros por período (esta semana, este mês, etc.), assessor, tags/tipos de atividade e geração de template WhatsApp.
    """
    try:
        cal_settings = get_calendar_settings_data()
        tpl_single = cal_settings.get("whatsapp_single_template") or "{dia_semana} ({data}) {assunto} com {cliente} ({horario})"
        tpl_header = cal_settings.get("whatsapp_header_template") or "📅 *Agenda de Atendimentos - Robson Vieira & {assessor}*\n"
        tpl_day = cal_settings.get("whatsapp_day_template") or "🔹 *{dia_semana} ({data})*"
        tpl_item = cal_settings.get("whatsapp_item_template") or "• {horario} | {assunto} com {cliente}"
        tpl_footer = cal_settings.get("whatsapp_footer_template", "Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀")

        now = datetime.now()
        
        # Define range de datas
        computed_start = start_date
        computed_end = end_date
        
        if period == "this_week":
            # Segunda-feira da semana atual até Domingo
            monday = now - timedelta(days=now.weekday())
            sunday = monday + timedelta(days=6)
            computed_start = monday.strftime("%Y-%m-%d")
            computed_end = sunday.strftime("%Y-%m-%d")
        elif period == "next_week":
            next_monday = now - timedelta(days=now.weekday()) + timedelta(days=7)
            next_sunday = next_monday + timedelta(days=6)
            computed_start = next_monday.strftime("%Y-%m-%d")
            computed_end = next_sunday.strftime("%Y-%m-%d")
        elif period == "this_month":
            first_day = now.replace(day=1)
            # Próximo mês dia 1 - 1 dia
            if now.month == 12:
                last_day = now.replace(year=now.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                last_day = now.replace(month=now.month + 1, day=1) - timedelta(days=1)
            computed_start = first_day.strftime("%Y-%m-%d")
            computed_end = last_day.strftime("%Y-%m-%d")
        elif period == "next_30_days":
            computed_start = now.strftime("%Y-%m-%d")
            computed_end = (now + timedelta(days=30)).strftime("%Y-%m-%d")
        elif not computed_start and not computed_end and period != "all":
            # Janela padrão: 30 dias atrás até 90 dias no futuro
            computed_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
            computed_end = (now + timedelta(days=90)).strftime("%Y-%m-%d")

        async with httpx.AsyncClient() as client:
            # 1. Busca organizações (Assessores) cadastradas
            orgs_res = await client.get(
                "https://api.pipedrive.com/v1/organizations",
                params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 100}
            )
            all_orgs = (orgs_res.json().get("data") or []) if orgs_res.status_code == 200 else []
            assessores_map = {o["id"]: o["name"] for o in all_orgs if o.get("name")}
            
            # 2. Busca Tipos/Tags de Atividades cadastrados no Pipedrive
            types_res = await client.get(
                "https://api.pipedrive.com/v1/activityTypes",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            raw_types = (types_res.json().get("data") or []) if types_res.status_code == 200 else []
            types_map = {t["key_string"]: t for t in raw_types if t.get("key_string")}
            
            # 3. Paginação sobre as atividades no Pipedrive (até 1000 registros)
            all_raw_activities = []
            start_offset = 0
            
            for _ in range(10):
                query_params = {
                    "api_token": PIPEDRIVE_API_TOKEN,
                    "limit": 100,
                    "start": start_offset,
                    "user_id": 0
                }
                if computed_start:
                    query_params["start_date"] = computed_start
                if computed_end:
                    query_params["end_date"] = computed_end
                if done is not None:
                    query_params["done"] = 1 if done else 0
                else:
                    query_params["done"] = 0  # REGRA: Apenas atividades em aberto por padrão
                    
                res = await client.get("https://api.pipedrive.com/v1/activities", params=query_params)
                if res.status_code != 200:
                    break
                    
                data = res.json().get("data") or []
                if not data:
                    break
                    
                all_raw_activities.extend(data)
                
                pagination = res.json().get("additional_data", {}).get("pagination", {})
                if not pagination.get("more_items_in_collection"):
                    break
                start_offset = pagination.get("next_start", start_offset + 100)
                
            formatted_activities = []
            assessores_count: Dict[str, Dict[str, Any]] = {}
            types_count: Dict[str, Dict[str, Any]] = {}
            
            selected_tag_filter = tag or activity_type
            
            for a in all_raw_activities:
                # Rejeita concluídas
                if a.get("done") == 1 or a.get("done") is True:
                    continue
                    
                org_name = a.get("org_name") or (assessores_map.get(a.get("org_id")) if a.get("org_id") else None)
                org_id = a.get("org_id")
                
                # REGRA CRUCIAL: Ignora atividades sem assessor (organização) definida
                if not org_name or org_name == "Sem Assessor" or org_name == "None":
                    continue
                
                raw_person = a.get("person_name")
                raw_subj = a.get("subject") or "Reunião"
                person_name = raw_person if raw_person else raw_subj
                raw_act_type = a.get("type") or "meeting"
                    
                # Mapeia nome legível e ícone da Tag / Tipo
                t_info = types_map.get(raw_act_type) or DEFAULT_ACTIVITY_TYPES_MAP.get(raw_act_type) or {"name": raw_act_type.capitalize(), "icon_key": "tag"}
                t_name = t_info.get("name") or raw_act_type.capitalize()
                t_icon = t_info.get("icon_key") or "tag"
                
                # Atualiza contagem global por assessor
                if org_name not in assessores_count:
                    assessores_count[org_name] = {
                        "id": org_id,
                        "name": org_name,
                        "count": 0
                    }
                assessores_count[org_name]["count"] += 1
                
                # Atualiza contagem global por Tag / Tipo de Atividade
                if raw_act_type not in types_count:
                    types_count[raw_act_type] = {
                        "key": raw_act_type,
                        "name": t_name,
                        "icon": t_icon,
                        "count": 0
                    }
                types_count[raw_act_type]["count"] += 1
                
                # Filtro por assessor selecionado
                if assessor_name and assessor_name != "all" and org_name != assessor_name:
                    continue
                if assessor_id and org_id != assessor_id:
                    continue
                    
                # Filtro por Tag / Tipo de atividade
                if selected_tag_filter and selected_tag_filter != "all" and raw_act_type != selected_tag_filter:
                    continue
                    
                due_date_str = a.get("due_date") or ""
                due_time_str = a.get("due_time") or ""
                duration_str = a.get("duration") or "01:00"
                
                time_slot = "Horário a definir"
                day_name = ""
                date_display = ""
                start_fmt = ""
                end_fmt = ""
                
                if due_date_str:
                    try:
                        dt = datetime.strptime(due_date_str, "%Y-%m-%d")
                        day_name = DIAS_SEMANA_PT.get(dt.weekday(), "")
                        date_display = dt.strftime("%d/%m")
                    except Exception:
                        pass
                        
                if due_time_str:
                    try:
                        start_parts = [int(p) for p in due_time_str.split(":")[:2]]
                        dur_parts = [int(p) for p in duration_str.split(":")[:2]]
                        start_min = start_parts[0] * 60 + start_parts[1]
                        dur_min = dur_parts[0] * 60 + dur_parts[1]
                        end_min = start_min + dur_min
                        end_h, end_m = divmod(end_min, 60)
                        start_fmt = f"{start_parts[0]:02d}:{start_parts[1]:02d}"
                        end_fmt = f"{end_h:02d}:{end_m:02d}"
                        time_slot = f"{start_fmt} - {end_fmt}"
                    except Exception:
                        time_slot = due_time_str
                        
                person_id = a.get("person_id")
                deal_title = a.get("deal_title")
                deal_id = a.get("deal_id")
                subj = a.get("subject") or "Reunião"
                
                act_ctx = {
                    "day_name": day_name,
                    "date_display": date_display,
                    "due_date_str": due_date_str,
                    "subject": subj,
                    "person_name": person_name,
                    "time_slot": time_slot,
                    "due_time_str": due_time_str,
                    "duration_str": duration_str,
                    "start_fmt": start_fmt,
                    "end_fmt": end_fmt,
                    "org_name": org_name,
                    "deal_title": deal_title or "",
                    "deal_id": deal_id or "",
                }
                
                # Template WhatsApp linha única formatado dinamicamente
                wa_template = format_whatsapp_template(tpl_single, act_ctx)
                
                formatted_activities.append({
                    "id": str(a.get("id")),
                    "type": raw_act_type,
                    "type_name": t_name,
                    "type_icon": t_icon,
                    "subject": subj,
                    "due_date": due_date_str,
                    "due_time": due_time_str,
                    "duration": duration_str,
                    "time_slot": time_slot,
                    "day_of_week": day_name,
                    "date_display": date_display,
                    "person_name": person_name,
                    "person_id": str(person_id) if person_id else None,
                    "org_name": org_name,
                    "org_id": org_id,
                    "deal_id": str(deal_id) if deal_id else None,
                    "deal_title": deal_title,
                    "deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None,
                    "whatsapp_template": wa_template
                })
                
            # Ordena cronologicamente
            formatted_activities.sort(key=lambda x: (x["due_date"], x["due_time"] or "99:99"))
            
            # Gera template consolidado para WhatsApp se filtrado por assessor
            whatsapp_consolidated = ""
            target_assessor_label = assessor_name if (assessor_name and assessor_name != "all") else "Geral"
            if formatted_activities:
                header_text = format_whatsapp_template(tpl_header, {"assessor": target_assessor_label, "org_name": target_assessor_label})
                lines = [header_text] if header_text else []
                
                by_date: Dict[str, List[Dict]] = {}
                for act in formatted_activities:
                    d_key = act["due_date"]
                    by_date.setdefault(d_key, []).append(act)
                    
                for d_date, acts in by_date.items():
                    first_act = acts[0]
                    day_title = format_whatsapp_template(tpl_day, {
                        "dia_semana": first_act["day_of_week"].capitalize(),
                        "data": first_act["date_display"],
                        "data_completa": first_act["due_date"],
                        "day_of_week": first_act["day_of_week"].capitalize(),
                        "date_display": first_act["date_display"]
                    })
                    if day_title:
                        lines.append(day_title)
                        
                    for act in acts:
                        item_text = format_whatsapp_template(tpl_item, {
                            "horario": act["time_slot"],
                            "time_slot": act["time_slot"],
                            "assunto": act["subject"],
                            "subject": act["subject"],
                            "cliente": act["person_name"],
                            "person_name": act["person_name"],
                            "assessor": act["org_name"],
                            "deal": act.get("deal_title") or "",
                            "deal_id": act.get("deal_id") or ""
                        })
                        if item_text:
                            lines.append(item_text)
                    lines.append("")
                    
                if tpl_footer:
                    lines.append(tpl_footer.strip())
                    
                whatsapp_consolidated = "\n".join(lines).strip()
                
            # Retorna assessores ordenados por contagem (maiores primeiro)
            assessores_list = sorted(
                [a for a in assessores_count.values() if a["count"] > 0],
                key=lambda x: -x["count"]
            )
            
            # Retorna tags/tipos de atividades ordenados por contagem (maiores primeiro)
            tags_list = sorted(
                [t for t in types_count.values() if t["count"] > 0],
                key=lambda x: -x["count"]
            )
            
            return {
                "activities": formatted_activities,
                "assessores": assessores_list,
                "tags": tags_list,
                "whatsapp_consolidated": whatsapp_consolidated,
                "templates": {
                    "whatsapp_single_template": tpl_single,
                    "whatsapp_header_template": tpl_header,
                    "whatsapp_day_template": tpl_day,
                    "whatsapp_item_template": tpl_item,
                    "whatsapp_footer_template": tpl_footer
                },
                "period": {
                    "start_date": computed_start,
                    "end_date": computed_end,
                    "period_filter": period or "all"
                },
                "total": len(formatted_activities)
            }
    except Exception as e:
        logger.error(f"Erro ao listar atividades do Pipedrive: {e}")
        raise HTTPException(status_code=500, detail=f"Erro interno ao buscar atividades: {str(e)}")

# ============================================================================
# PIPELINE COMERCIAL (MONITORAMENTO ATIVO)
# ============================================================================

PIPELINE_COMERCIAL_ID = 1

async def paginar_pipedrive(
    client: httpx.AsyncClient,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    limite_paginas: int = 50,
) -> List[Dict[str, Any]]:
    """
    Percorre todas as páginas de um endpoint de coleção do Pipedrive.

    O Pipedrive devolve no máximo 100 itens por chamada e sinaliza a continuação
    em `additional_data.pagination.more_items_in_collection`. Sem percorrer essas
    páginas, uma conta com 242 negócios abertos reporta 100 — e todo agregado
    calculado em cima (volume, parados, follow-ups) sai subestimado em silêncio.

    `limite_paginas` é uma trava de segurança contra laço infinito caso a API
    devolva paginação inconsistente.
    """
    itens: List[Dict[str, Any]] = []
    start = 0
    for _ in range(limite_paginas):
        p = dict(params or {})
        p.update({"api_token": PIPEDRIVE_API_TOKEN, "limit": 100, "start": start})
        res = await client.get(f"https://api.pipedrive.com/v1{path}", params=p)

        # Uma falha NUNCA pode se disfarçar de "nenhum resultado". Sem esta
        # checagem, um 429 devolvia lista vazia e o dashboard renderizava tudo
        # zerado como se o funil estivesse vazio — parecendo dado, não erro.
        if res.status_code == 429:
            espera = res.headers.get("Retry-After", "?")
            logger.error(f"Pipedrive: cota de requisições esgotada em {path} (Retry-After: {espera}s)")
            raise HTTPException(
                status_code=503,
                detail=(
                    "A cota diária de requisições do Pipedrive foi atingida. "
                    "Os dados voltam automaticamente quando a cota renovar."
                ),
            )
        if res.status_code != 200:
            logger.error(f"Pipedrive respondeu {res.status_code} em {path}: {res.text[:200]}")
            raise HTTPException(
                status_code=502,
                detail=f"O Pipedrive respondeu com erro {res.status_code}.",
            )

        payload = res.json()
        if payload.get("success") is False:
            logger.error(f"Pipedrive retornou success=false em {path}: {payload.get('error')}")
            raise HTTPException(
                status_code=502,
                detail=f"Pipedrive: {payload.get('error') or 'erro desconhecido'}",
            )

        itens.extend(payload.get("data") or [])

        paginacao = (payload.get("additional_data") or {}).get("pagination") or {}
        if not paginacao.get("more_items_in_collection"):
            return itens
        start = paginacao.get("next_start", start + 100)

    logger.warning(
        f"paginar_pipedrive: limite de {limite_paginas} páginas atingido em {path}; "
        f"resultado pode estar incompleto ({len(itens)} itens)"
    )
    return itens


async def fetch_comercial_pipeline_data() -> Dict[str, Any]:
    """Busca dados consolidados do Funil Comercial do Pipedrive"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Busca stages do funil 1
        stages_res = await client.get(
            "https://api.pipedrive.com/v1/stages",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        all_stages = stages_res.json().get("data") or []
        comercial_stages = {s["id"]: s["name"] for s in all_stages if s.get("pipeline_id") == PIPELINE_COMERCIAL_ID}

        # 2. Busca deals abertos e filtra o funil aqui, não na API.
        #
        # A v1 de /deals ACEITA `pipeline_id` mas o IGNORA em silêncio: pedir
        # pipeline_id=1 devolve exatamente o mesmo que não filtrar nada. Sem o
        # filtro abaixo, negócios de Pós-Venda, Eventos e MentorIA entram na
        # conta como se fossem do Comercial (99 de 242 na medição real).
        #
        # A v2 filtra de verdade, mas não devolve `next_activity_date` nem
        # `person_name`, que são a base dos alertas — por isso continuamos na v1.
        todos_abertos = await paginar_pipedrive(client, "/deals", {"status": "open"})
        raw_deals = [
            d for d in todos_abertos
            if str(d.get("pipeline_id")) == str(PIPELINE_COMERCIAL_ID)
        ]

        now = datetime.now()
        total_value = 0.0
        stages_breakdown = {}
        stagnant_deals = []
        overdue_deals = []
        formatted_deals = []
        
        for d in raw_deals:
            deal_id = str(d.get("id"))
            title = d.get("title") or "Negócio sem título"
            person = d.get("person_name") or (d.get("person_id", {}).get("name") if isinstance(d.get("person_id"), dict) else "Cliente")
            val = float(d.get("value") or 0)
            total_value += val
            stage_id = d.get("stage_id")
            stage_name = comercial_stages.get(stage_id, f"Etapa #{stage_id}")
            
            stages_breakdown[stage_name] = stages_breakdown.get(stage_name, 0) + 1
            
            # Stagnation check
            days_inactive = 0
            update_time_str = d.get("update_time")
            if update_time_str:
                try:
                    up_dt = datetime.strptime(update_time_str, "%Y-%m-%d %H:%M:%S")
                    days_inactive = (now - up_dt).days
                except Exception:
                    pass
            
            # Next activity check
            next_act = d.get("next_activity_date")
            is_overdue = False
            if next_act:
                try:
                    act_dt = datetime.strptime(next_act, "%Y-%m-%d")
                    is_overdue = act_dt.date() < now.date()
                except Exception:
                    pass
            
            deal_obj = {
                "id": deal_id,
                "title": title,
                "person_name": person,
                "stage_id": stage_id,
                "stage_name": stage_name,
                "value": val,
                "update_time": update_time_str,
                "days_inactive": days_inactive,
                "next_activity_date": next_act,
                "is_stagnant": days_inactive > 15,
                "is_overdue": is_overdue,
                "deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}"
            }
            
            formatted_deals.append(deal_obj)
            if deal_obj["is_stagnant"]:
                stagnant_deals.append(deal_obj)
            if is_overdue:
                overdue_deals.append(deal_obj)
                
        return {
            "pipeline_id": PIPELINE_COMERCIAL_ID,
            "pipeline_name": "Comercial",
            "total_deals": len(formatted_deals),
            "total_value": total_value,
            "stages_breakdown": stages_breakdown,
            "stagnant_count": len(stagnant_deals),
            "overdue_count": len(overdue_deals),
            "deals": formatted_deals,
            "stagnant_deals": stagnant_deals,
            "overdue_deals": overdue_deals
        }

# ============================================================================
# DASHBOARD OPERACIONAL
# ============================================================================

def _normalizar(texto: str) -> str:
    """Minúsculas e sem acento, para casar motivo de perda sem depender de grafia."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sem_acento if not unicodedata.combining(c)).lower().strip()


# Motivos de perda em que o cliente não rejeitou o produto — só não foi alcançado
# ou não era o momento. São os que voltam para a fila de trabalho.
MOTIVOS_RECUPERAVEIS = ("consegui contato", "nao e o momento")


def _e_recuperavel(motivo: str) -> bool:
    m = _normalizar(motivo)
    return any(chave in m for chave in MOTIVOS_RECUPERAVEIS)


async def fetch_lost_deals_data() -> Dict[str, Any]:
    """
    Negócios perdidos agrupados por motivo, mais a fila de recuperação.

    O campo `lost_reason` está preenchido em 100% dos negócios perdidos desta
    conta, então o agrupamento é confiável sem tratamento de ausentes.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        todos_perdidos = await paginar_pipedrive(client, "/deals", {"status": "lost"})

    perdidos = [
        d for d in todos_perdidos
        if str(d.get("pipeline_id")) == str(PIPELINE_COMERCIAL_ID)
    ]

    por_motivo: Dict[str, int] = {}
    fila: List[Dict[str, Any]] = []

    for d in perdidos:
        motivo = (d.get("lost_reason") or "").strip() or "Sem motivo informado"
        por_motivo[motivo] = por_motivo.get(motivo, 0) + 1

        if _e_recuperavel(motivo):
            deal_id = str(d.get("id"))
            fila.append({
                "id": deal_id,
                "title": d.get("title") or "Negócio sem título",
                "person_name": d.get("person_name") or "Cliente",
                "value": float(d.get("value") or 0),
                "lost_reason": motivo,
                "lost_time": d.get("lost_time"),
                "deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}",
            })

    # Mais recentes primeiro: são os de contato ainda quente.
    fila.sort(key=lambda x: x.get("lost_time") or "", reverse=True)

    motivos = [
        {"motivo": k, "total": v, "recuperavel": _e_recuperavel(k)}
        for k, v in sorted(por_motivo.items(), key=lambda kv: kv[1], reverse=True)
    ]

    return {
        "total_perdidos": len(perdidos),
        "motivos": motivos,
        "fila_recuperacao": fila,
        "total_recuperavel": len(fila),
        # Repassado para `fetch_conversao` reaproveitar, em vez de refazer a
        # mesma paginação. Não vai para a resposta HTTP.
        "_brutos": todos_perdidos,
    }


async def fetch_birthdays_data() -> Dict[str, Any]:
    """
    Aniversariantes do mês corrente.

    ATENÇÃO: apenas ~5% das pessoas têm data de nascimento preenchida. O card
    consumidor exibe `cobertura` na tela justamente porque a lista parece
    completa e não é — sem esse aviso, dois nomes passam a impressão de que só
    existem dois aniversariantes no mês.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        campos_res = await client.get(
            "https://api.pipedrive.com/v1/personFields",
            params={"api_token": PIPEDRIVE_API_TOKEN},
        )
        chave_nascimento = None
        for f in (campos_res.json().get("data") or []):
            if "nascimento" in _normalizar(f.get("name") or ""):
                chave_nascimento = f.get("key")
                break

        if not chave_nascimento:
            return {"aniversariantes": [], "com_data": 0, "total_pessoas": 0, "cobertura": 0.0}

        pessoas = await paginar_pipedrive(client, "/persons")

    mes_atual = datetime.now().month
    com_data = 0
    aniversariantes: List[Dict[str, Any]] = []

    for p in pessoas:
        bruto = p.get(chave_nascimento)
        if not bruto:
            continue
        com_data += 1
        try:
            nascimento = datetime.strptime(str(bruto)[:10], "%Y-%m-%d").date()
        except ValueError:
            continue
        if nascimento.month != mes_atual:
            continue

        pessoa_id = str(p.get("id"))
        aniversariantes.append({
            "id": pessoa_id,
            "name": p.get("name") or "Sem nome",
            "dia": nascimento.day,
            "person_url": f"https://investimentosblue.pipedrive.com/person/{pessoa_id}",
        })

    aniversariantes.sort(key=lambda x: x["dia"])
    total = len(pessoas)

    return {
        "aniversariantes": aniversariantes,
        "com_data": com_data,
        "total_pessoas": total,
        "cobertura": round(com_data / total * 100, 1) if total else 0.0,
    }


# ============================================================================
# AGENDA — "o que eu preciso fazer agora?"
# ============================================================================

# Agrupamento por modo de ação. As chaves são os `key_string` dos tipos de
# atividade da conta, lidos de /activityTypes — são personalizáveis, e vários
# aqui foram criados pelo usuário (teams, reuniao_2, r3, tactiq...).
#
# R1, R2 e R3 são TIPOS DE ATIVIDADE nesta conta, não só etapas do funil. Por
# isso rotular uma reunião não exige buscar o negócio associado.
GRUPOS_AGENDA: List[Tuple[str, str, Tuple[str, ...]]] = [
    # Só R1/R2/R3. `teams` e `outlook` são a agenda sincronizada do calendário —
    # medido no período de 01/08 a 04/09: 91 atividades `teams`, e só 9 eram
    # reunião de cliente. O resto é Daily, KIHAP, Casa, aniversário. Misturadas
    # com R1/R2/R3, o grupo deixava de responder "que cliente eu atendo hoje?".
    ("reunioes", "Reuniões", ("meeting", "reuniao_2", "r3")),
    ("ligacoes", "Ligações", ("call",)),
    ("mensagens", "Mensagens", ("email", "whatsapp")),
    # Compromisso de calendário que não é atendimento. Continua visível, porque
    # ocupa a agenda de verdade, mas fora do grupo de reuniões com cliente.
    ("compromissos", "Compromissos", ("teams", "outlook")),
    # Falta é categoria própria na conta, com quatro tipos dedicados. Misturar
    # com reuniões daria a impressão de compromisso a cumprir.
    ("no_show", "No Show", ("no_show", "r2_no_show", "r3_no_show", "lunch")),
    ("tarefas", "Tarefas", ("task", "deadline", "tactiq")),
]

# Tipo desconhecido cai aqui, para um tipo novo criado no CRM aparecer no painel
# em vez de sumir.
GRUPO_PADRAO = "tarefas"


async def buscar_rotulos_de_tipo(client: httpx.AsyncClient) -> Dict[str, str]:
    """Mapa `key_string` -> nome exibido, ex.: `r3` -> `R3`, `meeting` -> `R1`."""
    res = await client.get(
        "https://api.pipedrive.com/v1/activityTypes",
        params={"api_token": PIPEDRIVE_API_TOKEN},
    )
    if res.status_code != 200:
        logger.warning(f"activityTypes respondeu {res.status_code}; usando as chaves cruas")
        return {}
    return {
        t.get("key_string"): t.get("name")
        for t in (res.json().get("data") or [])
        if t.get("key_string")
    }


# Brasília. O Pipedrive devolve `due_time` em UTC e o usuário opera em UTC-3.
FUSO_BRASILIA = timedelta(hours=-3)


def _para_horario_local(due_date: Optional[str], due_time: Optional[str]) -> Tuple[Optional[str], str]:
    """
    Converte o par (data, hora) do Pipedrive de UTC para Brasília.

    A conversão é do instante inteiro, não só da hora: 01:00 UTC é 22:00 do dia
    anterior. Ajustar só `due_time` mostraria o horário certo na data errada.

    Atividade sem hora é dia inteiro e não se converte — subtrair 3h de uma
    tarefa sem horário a jogaria para o dia anterior sem motivo.
    """
    hora = (due_time or "").strip()
    if not due_date or not hora:
        return due_date, ""
    try:
        partes = [int(p) for p in hora.split(":")[:3]]
        while len(partes) < 3:
            partes.append(0)
        utc = datetime.strptime(due_date, "%Y-%m-%d").replace(
            hour=partes[0], minute=partes[1], second=partes[2]
        )
    except (ValueError, TypeError):
        return due_date, hora
    local = utc + FUSO_BRASILIA
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M")


def _formatar_atividade(a: Dict[str, Any], rotulos: Dict[str, str]) -> Dict[str, Any]:
    atividade_id = str(a.get("id"))
    chave = a.get("type") or "task"
    data_local, hora_local = _para_horario_local(a.get("due_date"), a.get("due_time"))
    return {
        "id": atividade_id,
        "subject": a.get("subject") or "Sem assunto",
        "type": chave,
        "type_label": rotulos.get(chave, chave),
        "due_date": data_local,
        "due_time": hora_local,
        "person_name": a.get("person_name"),
        # A organização vinculada à atividade é, nesta conta, o assessor
        # responsável — não uma empresa cliente. Preenchida em ~40% dos casos.
        "org_name": a.get("org_name"),
        "deal_id": a.get("deal_id"),
        "deal_title": a.get("deal_title"),
        "url": f"https://investimentosblue.pipedrive.com/activities/list#dialog/activity/{atividade_id}",
    }


def _agrupar(atividades: List[Dict[str, Any]], rotulos: Dict[str, str]) -> List[Dict[str, Any]]:
    """Distribui nos grupos de ação, preservando a ordem de GRUPOS_AGENDA."""
    por_chave: Dict[str, List[Dict[str, Any]]] = {chave: [] for chave, _, _ in GRUPOS_AGENDA}
    tipo_para_grupo = {
        tipo: chave for chave, _, tipos in GRUPOS_AGENDA for tipo in tipos
    }

    for a in atividades:
        item = _formatar_atividade(a, rotulos)
        por_chave[tipo_para_grupo.get(item["type"], GRUPO_PADRAO)].append(item)

    for itens in por_chave.values():
        # Com horário primeiro, em ordem cronológica; sem horário no fim.
        itens.sort(key=lambda x: (x["due_time"] == "", x["due_date"] or "", x["due_time"]))

    return [
        {"chave": chave, "titulo": titulo, "itens": por_chave[chave]}
        for chave, titulo, _ in GRUPOS_AGENDA
        if por_chave[chave]  # grupo vazio não aparece
    ]


async def fetch_agenda(periodo: str = "hoje", dias: int = 7) -> Dict[str, Any]:
    """
    Atividades não concluídas do período, agrupadas por modo de ação.

    ATENÇÃO: `end_date` do Pipedrive é EXCLUSIVO. Pedir start_date e end_date no
    mesmo dia devolve lista vazia — verificado contra a API. Por isso todo
    intervalo aqui soma um dia ao fim. Sem isso a aba "Hoje" nasceria vazia
    todos os dias, e o erro passaria por dado em vez de bug.
    """
    hoje = datetime.now().date()

    if periodo == "amanha":
        inicio = hoje + timedelta(days=1)
        fim = inicio
    elif periodo == "proximos":
        inicio = hoje
        fim = hoje + timedelta(days=max(1, dias))
    else:  # hoje
        inicio = fim = hoje

    async with httpx.AsyncClient(timeout=60.0) as client:
        rotulos = await buscar_rotulos_de_tipo(client)
        # Um dia a mais de cada lado porque a API filtra pela data em UTC e a
        # conversão para Brasília move o compromisso de dia: 01:00 UTC é 22:00
        # do dia anterior. Sem a folga, a reunião das 21h sumiria de "hoje".
        atividades = await paginar_pipedrive(
            client,
            "/activities",
            {
                "start_date": str(inicio - timedelta(days=1)),
                "end_date": str(fim + timedelta(days=2)),  # exclusivo
                "done": 0,
            },
        )

    # Recorta pela data já convertida. Sem horário é dia inteiro e continua
    # valendo a data que o Pipedrive devolveu.
    def no_periodo(a: Dict[str, Any]) -> bool:
        data_local, _ = _para_horario_local(a.get("due_date"), a.get("due_time"))
        if not data_local:
            return False
        try:
            d = datetime.strptime(data_local, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return False
        return inicio <= d <= fim

    atividades = [a for a in atividades if no_periodo(a)]

    return {
        "periodo": periodo,
        "dias": dias if periodo == "proximos" else None,
        "inicio": str(inicio),
        "fim": str(fim),
        "grupos": _agrupar(atividades, rotulos),
        "total": len(atividades),
    }


async def fetch_agenda_atrasadas(limite: int = 30) -> Dict[str, Any]:
    """
    Atividades vencidas e não concluídas, das mais recentes para as mais antigas.

    A ordem não é acidental: uma atividade que venceu ontem ainda está quente;
    uma de seis meses atrás está morta. Ordenar por antiguidade traria o
    irrelevante para o topo.

    A janela de 180 dias evita paginar anos de histórico só para preencher uma
    lista que mostra algumas dezenas.
    """
    hoje = datetime.now().date()
    inicio = hoje - timedelta(days=180)

    async with httpx.AsyncClient(timeout=60.0) as client:
        rotulos = await buscar_rotulos_de_tipo(client)
        atividades = await paginar_pipedrive(
            client,
            "/activities",
            {"start_date": str(inicio), "end_date": str(hoje), "done": 0},  # fim exclusivo = ontem
        )

    itens = [_formatar_atividade(a, rotulos) for a in atividades]
    itens.sort(key=lambda x: (x["due_date"] or "", x["due_time"]), reverse=True)

    return {"itens": itens[:limite], "total": len(itens), "limite": limite}


async def fetch_conversao(perdidos_brutos: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Taxa de ganho sobre negócios fechados do Funil Comercial.

    Recebe os perdidos já buscados em vez de refazer a chamada: a cota diária de
    requisições do Pipedrive é finita, e este endpoint paginava a mesma lista
    duas vezes por carregamento do dashboard.

    Só o número global: `won_time` está preenchido em uma minoria dos ganhos,
    então qualquer recorte por período seria enganoso. A cobertura vai junto na
    resposta para o card poder avisar.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        ganhos = await paginar_pipedrive(client, "/deals", {"status": "won"})

    alvo = str(PIPELINE_COMERCIAL_ID)
    ganhos = [d for d in ganhos if str(d.get("pipeline_id")) == alvo]
    perdidos = [d for d in perdidos_brutos if str(d.get("pipeline_id")) == alvo]

    fechados = len(ganhos) + len(perdidos)
    com_data = sum(1 for d in ganhos if d.get("won_time"))

    return {
        "ganhos": len(ganhos),
        "perdidos": len(perdidos),
        "fechados": fechados,
        "taxa_ganho": round(len(ganhos) / fechados * 100, 1) if fechados else 0.0,
        "valor_ganho": sum(float(d.get("value") or 0) for d in ganhos),
        "ganhos_com_data": com_data,
    }


def contar_transcricoes_pendentes() -> Dict[str, Any]:
    """
    Transcrições processadas que ainda não foram vinculadas ao Pipedrive.

    O vínculo mora em `briefing_json.pipedrive` (person_id ou deal_id). As
    marcadas com `is_ignored` — reuniões internas — ficam de fora: estão sem
    vínculo de propósito, e contá-las inflaria o número de pendências.
    """
    res = supabase.table("transcriptions").select("briefing_json").execute()
    linhas = res.data or []

    pendentes = 0
    vinculadas = 0
    ignoradas = 0

    for linha in linhas:
        briefing = linha.get("briefing_json") or {}
        pipe = briefing.get("pipedrive") or {}
        if pipe.get("person_id") or pipe.get("deal_id"):
            vinculadas += 1
        elif briefing.get("is_ignored"):
            ignoradas += 1
        else:
            pendentes += 1

    return {
        "pendentes": pendentes,
        "vinculadas": vinculadas,
        "ignoradas": ignoradas,
        "total": len(linhas),
    }


CACHE_AGENDA_TTL = 120  # segundos — a agenda muda mais que as agregações

_cache_agenda: Dict[str, Dict[str, Any]] = {}
_lock_agenda = asyncio.Lock()


async def _servir_com_cache(chave: str, ttl: int, montar, refresh: bool) -> Dict[str, Any]:
    """
    Cache com TTL por chave, servindo dado obsoleto quando a origem falha.

    Durante um estouro de cota da API, um número de minutos atrás é mais útil que
    uma tela vazia. A resposta sinaliza isso em `cache.obsoleto`.
    """
    entrada = _cache_agenda.get(chave)
    agora = time.monotonic()

    if not refresh and entrada and agora - entrada["gerado_em"] < ttl:
        return {**entrada["dados"], "cache": {"idade_s": int(agora - entrada["gerado_em"]), "obsoleto": False}}

    async with _lock_agenda:
        entrada = _cache_agenda.get(chave)
        agora = time.monotonic()
        if not refresh and entrada and agora - entrada["gerado_em"] < ttl:
            return {**entrada["dados"], "cache": {"idade_s": int(agora - entrada["gerado_em"]), "obsoleto": False}}

        try:
            dados = await montar()
        except HTTPException:
            if entrada:
                idade = int(time.monotonic() - entrada["gerado_em"])
                logger.warning(f"Agenda '{chave}': falha ao atualizar, servindo cache de {idade}s atrás")
                return {**entrada["dados"], "cache": {"idade_s": idade, "obsoleto": True}}
            raise

        _cache_agenda[chave] = {"dados": dados, "gerado_em": time.monotonic()}
        return {**dados, "cache": {"idade_s": 0, "obsoleto": False}}


@app.get("/api/dashboard/agenda")
async def dashboard_agenda(
    periodo: str = "hoje",
    dias: int = 7,
    refresh: bool = False,
    user: dict = Depends(get_current_user),
):
    """Atividades do período, agrupadas por modo de ação."""
    if periodo not in ("hoje", "amanha", "proximos"):
        raise HTTPException(status_code=400, detail="periodo deve ser hoje, amanha ou proximos")
    if dias not in (7, 15, 30):
        raise HTTPException(status_code=400, detail="dias deve ser 7, 15 ou 30")

    chave = f"agenda:{periodo}:{dias if periodo == 'proximos' else '-'}"
    return await _servir_com_cache(chave, CACHE_AGENDA_TTL, lambda: fetch_agenda(periodo, dias), refresh)


@app.get("/api/dashboard/pendencias")
async def dashboard_pendencias(user: dict = Depends(get_current_user)):
    """
    Faixa de status da agenda.

    Só consulta o Supabase — nenhuma requisição ao Pipedrive. É por isso que
    cabe na tela usada o dia inteiro, ao contrário dos números do funil.
    """
    return {"transcricoes": contar_transcricoes_pendentes()}


@app.get("/api/dashboard/agenda/atrasadas")
async def dashboard_agenda_atrasadas(
    refresh: bool = False,
    user: dict = Depends(get_current_user),
):
    """Atividades vencidas, das mais recentes para as mais antigas."""
    return await _servir_com_cache("agenda:atrasadas", CACHE_AGENDA_TTL, fetch_agenda_atrasadas, refresh)


# ---------------------------------------------------------------------------
# Cache do dashboard
#
# Montar a resposta custa ~15 requisições ao Pipedrive (várias páginas de
# negócios, 456 pessoas, atividades). Com o painel aberto e recarregando
# sozinho, isso consumia a cota diária da conta em poucas horas.
#
# Cache global e não por usuário: a resposta não depende de quem pergunta.
# ---------------------------------------------------------------------------
CACHE_DASHBOARD_TTL = 300  # segundos

_cache_dashboard: Dict[str, Any] = {"gerado_em": 0.0, "dados": None}
_lock_dashboard = asyncio.Lock()


async def montar_dashboard_operacional() -> Dict[str, Any]:
    """Busca tudo no Pipedrive e no Supabase. Sempre bate na origem."""
    pipeline = await fetch_comercial_pipeline_data()
    perdidos = await fetch_lost_deals_data()
    aniversarios = await fetch_birthdays_data()
    conversao = await fetch_conversao(perdidos.pop("_brutos", []))
    transcricoes = contar_transcricoes_pendentes()

    sem_proximo_passo = [
        d for d in pipeline.get("deals", []) if not d.get("next_activity_date")
    ]

    return {
        "resumo": {
            "total_abertos": pipeline.get("total_deals", 0),
            "follow_ups_vencidos": pipeline.get("overdue_count", 0),
            "negocios_parados": pipeline.get("stagnant_count", 0),
            "sem_proximo_passo": len(sem_proximo_passo),
            "transcricoes_pendentes": transcricoes["pendentes"],
        },
        "transcricoes": transcricoes,
        # Devolvido junto para o frontend não precisar chamar
        # /pipedrive/pipeline/comercial/summary em separado, o que paginava os
        # negócios abertos uma segunda vez a cada carregamento.
        "pipeline": pipeline,
        "sem_proximo_passo": sem_proximo_passo,
        "perdidos": perdidos,
        "aniversarios": aniversarios,
        "conversao": conversao,
    }


@app.get("/api/dashboard/operacional")
async def dashboard_operacional(
    refresh: bool = False,
    user: dict = Depends(get_current_user),
):
    """
    Blocos do dashboard operacional, servidos de cache quando recentes.

    `?refresh=true` ignora o cache — usado pelo botão de sincronizar manual.

    Se a busca falhar e existir dado antigo em cache, ele é devolvido em vez do
    erro: durante um estouro de cota, um número de dez minutos atrás é mais útil
    que uma tela vazia. A resposta sinaliza isso em `cache.obsoleto`.
    """
    agora = time.monotonic()
    idade = agora - _cache_dashboard["gerado_em"]

    if not refresh and _cache_dashboard["dados"] is not None and idade < CACHE_DASHBOARD_TTL:
        return {**_cache_dashboard["dados"], "cache": {"idade_s": int(idade), "obsoleto": False}}

    # O lock evita que duas abas abrindo juntas disparem a busca em duplicidade.
    async with _lock_dashboard:
        # Outra requisição pode ter preenchido o cache enquanto esperávamos.
        agora = time.monotonic()
        idade = agora - _cache_dashboard["gerado_em"]
        if not refresh and _cache_dashboard["dados"] is not None and idade < CACHE_DASHBOARD_TTL:
            return {**_cache_dashboard["dados"], "cache": {"idade_s": int(idade), "obsoleto": False}}

        try:
            dados = await montar_dashboard_operacional()
        except HTTPException:
            if _cache_dashboard["dados"] is not None:
                idade = time.monotonic() - _cache_dashboard["gerado_em"]
                logger.warning(
                    f"Dashboard: falha ao atualizar, servindo cache de {int(idade)}s atrás"
                )
                return {
                    **_cache_dashboard["dados"],
                    "cache": {"idade_s": int(idade), "obsoleto": True},
                }
            raise

        _cache_dashboard["dados"] = dados
        _cache_dashboard["gerado_em"] = time.monotonic()
        return {**dados, "cache": {"idade_s": 0, "obsoleto": False}}


async def sync_comercial_alerts_internal(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Varre o Funil Comercial e grava/atualiza os alertas de negócios parados e follow-ups atrasados no Supabase"""
    data = await fetch_comercial_pipeline_data()
    stagnant = data.get("stagnant_deals", [])
    overdue = data.get("overdue_deals", [])
    
    # 1. Pega alertas abertos existentes no Supabase para não duplicar
    existing_alerts_res = supabase.table("alerts").select("id, pipedrive_deal_id, alert_type").eq("is_resolved", False).execute()
    existing_map = {(a.get("pipedrive_deal_id"), a.get("alert_type")): a.get("id") for a in (existing_alerts_res.data or [])}
    
    alerts_created = 0
    alerts_updated = 0
    
    # Processa Negócios Parados
    for d in stagnant:
        key = (d["id"], "negocio_parado")
        desc = f"Negócio '{d['title']}' parado há {d['days_inactive']} dias na etapa '{d['stage_name']}'."
        sev = "high" if d["value"] >= 50000 or d["days_inactive"] > 30 else "medium"
        alert_payload = {
            "alert_type": "negocio_parado",
            "pipedrive_deal_id": d["id"],
            "cliente_nome": d["person_name"],
            "description": desc,
            "severity": sev,
            "is_resolved": False,
            "details": {
                "deal_id": d["id"],
                "deal_url": d["deal_url"],
                "value": d["value"],
                "stage": d["stage_name"],
                "days_inactive": d["days_inactive"],
                "update_time": d.get("update_time")
            }
        }
        
        if key in existing_map:
            supabase.table("alerts").update(alert_payload).eq("id", existing_map[key]).execute()
            alerts_updated += 1
        else:
            supabase.table("alerts").insert(alert_payload).execute()
            alerts_created += 1
            
    # Processa Follow-ups Atrasados
    for d in overdue:
        key = (d["id"], "follow_up_atrasado")
        desc = f"Follow-up atrasado para '{d['person_name']}' no negócio '{d['title']}'. Venceu em {d['next_activity_date']}."
        sev = "high" if d["value"] >= 50000 else "medium"
        alert_payload = {
            "alert_type": "follow_up_atrasado",
            "pipedrive_deal_id": d["id"],
            "cliente_nome": d["person_name"],
            "description": desc,
            "severity": sev,
            "is_resolved": False,
            "details": {
                "deal_id": d["id"],
                "deal_url": d["deal_url"],
                "value": d["value"],
                "due_date": d["next_activity_date"],
                "update_time": d.get("update_time")
            }
        }
        
        if key in existing_map:
            supabase.table("alerts").update(alert_payload).eq("id", existing_map[key]).execute()
            alerts_updated += 1
        else:
            supabase.table("alerts").insert(alert_payload).execute()
            alerts_created += 1
            
    log_audit_event(
        action="PIPELINE_COMERCIAL_SYNCED",
        resource_type="pipeline",
        resource_id="1",
        user_id=user_id or "system",
        details={
            "pipeline": "Comercial",
            "total_deals": data["total_deals"],
            "total_value": data["total_value"],
            "stagnant_count": len(stagnant),
            "overdue_count": len(overdue),
            "alerts_created": alerts_created,
            "alerts_updated": alerts_updated,
            "summary": f"Varredura no Funil Comercial concluída: {len(stagnant)} negócios parados e {len(overdue)} follow-ups identificados ({alerts_created} novos alertas)."
        }
    )
    
    return {
        "status": "success",
        "total_deals": data["total_deals"],
        "total_value": data["total_value"],
        "stagnant_count": len(stagnant),
        "overdue_count": len(overdue),
        "alerts_created": alerts_created,
        "alerts_updated": alerts_updated,
        "stages_breakdown": data["stages_breakdown"]
    }

@app.get("/api/pipedrive/pipeline/comercial/summary")
async def get_comercial_summary(user: dict = Depends(require_admin)):
    """Retorna resumo consolidado do Funil Comercial do Pipedrive"""
    return await fetch_comercial_pipeline_data()

@app.get("/api/pipedrive/pipeline/comercial/deals")
async def get_comercial_deals(user: dict = Depends(require_admin)):
    """Retorna lista de negócios abertos no Funil Comercial do Pipedrive"""
    data = await fetch_comercial_pipeline_data()
    return {"deals": data.get("deals", [])}

@app.post("/api/pipedrive/pipeline/comercial/sync-alerts")
async def sync_comercial_alerts_endpoint(user: dict = Depends(require_admin)):
    """Dispara a sincronização ativa de alertas do Funil Comercial com o banco"""
    return await sync_comercial_alerts_internal(user_id=user.get("id", user.get("sub")))

# ============================================================================
# TRANSCRIPTIONS ENDPOINTS
# ============================================================================

from pydantic import BaseModel

class TranscriptionResponse(BaseModel):
    id: str
    google_doc_id: str
    meeting_title: Optional[str]
    meeting_date: Optional[str]
    processing_status: str
    briefing_json: Optional[Dict]
    created_at: str

class AssignTranscriptionRequest(BaseModel):
    person_id: Optional[str] = None
    deal_id: Optional[str] = None
    custom_client_name: Optional[str] = None
    cliente_nome: Optional[str] = None
    activity_subject: Optional[str] = "Transcrição Tactiq"
    activity_type: Optional[str] = "tactiq"
    activity_date: Optional[str] = None
    activity_time: Optional[str] = None
    duration: Optional[str] = None
    done: bool = True
    create_activity: bool = True
    delete_old_activity: bool = True
    delete_old_note: bool = True
    create_note: bool = False

@app.get("/api/transcriptions", response_model=List[TranscriptionResponse])
async def get_transcriptions(
    limit: int = 50,
    status: Optional[str] = None,
    user: dict = Depends(require_admin)
):
    """Lista histórico de transcrições processadas"""
    
    query = supabase.table("transcriptions").select("*").order("created_at", desc=True).limit(limit)
    
    if status:
        query = query.eq("processing_status", status)
    
    response = query.execute()
    
    return [
        TranscriptionResponse(
            id=t["id"],
            google_doc_id=t["google_doc_id"],
            meeting_title=t.get("meeting_title"),
            meeting_date=t.get("meeting_date"),
            processing_status=t["processing_status"],
            briefing_json=t.get("briefing_json"),
            created_at=t["created_at"]
        )
        for t in response.data
        if not (t.get("briefing_json") or {}).get("is_deleted", False)
    ]

@app.post("/api/transcriptions/{transcription_id}/assign")
@app.post("/api/transcriptions/{transcription_id}/assign-pipedrive")
async def assign_transcription_to_crm(
    transcription_id: str,
    req: AssignTranscriptionRequest,
    user: dict = Depends(require_admin)
):
    """Atribui/Reatribui manualmente uma transcrição a um Cliente/Negócio no Pipedrive criando Atividade do tipo Tactiq"""
    
    # 1. Busca transcrição existente
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    
    person_id = req.person_id
    deal_id = req.deal_id
    client_name = req.custom_client_name or req.cliente_nome
    
    # 2. Se já possuía uma atividade ou nota anterior e foi solicitado apagar ao reatribuir, exclui no Pipedrive
    old_pipe_info = briefing_json.get("pipedrive") or {}
    old_activity_id = old_pipe_info.get("activity_id")
    old_note_id = old_pipe_info.get("note_id")
    old_act_deleted = False
    old_note_deleted = False
    
    if req.delete_old_activity and old_activity_id:
        old_act_deleted = await delete_pipedrive_activity(old_activity_id)
    if req.delete_old_note and old_note_id:
        old_note_deleted = await delete_pipedrive_note(old_note_id)
    
    # 3. Se informou deal_id mas não person_id, busca person_id no Deal
    if deal_id and not person_id:
        try:
            async with httpx.AsyncClient() as client:
                d_res = await client.get(
                    f"{PIPEDRIVE_BASE_URL}/deals/{deal_id}",
                    params={"api_token": PIPEDRIVE_API_TOKEN}
                )
                if d_res.status_code == 200:
                    d_data = d_res.json().get("data", {})
                    d_person = d_data.get("person")
                    if d_person and isinstance(d_person, dict):
                        person_id = str(d_person.get("id"))
                        if not client_name:
                            client_name = d_person.get("name")
        except Exception as e:
            logger.warning(f"Não foi possível buscar person_id do deal {deal_id}: {e}")
            
    # 4. Se informou person_id mas não client_name, busca nome da pessoa
    if person_id and not client_name:
        try:
            async with httpx.AsyncClient() as client:
                p_res = await client.get(
                    f"{PIPEDRIVE_BASE_URL}/persons/{person_id}",
                    params={"api_token": PIPEDRIVE_API_TOKEN}
                )
                if p_res.status_code == 200:
                    p_data = p_res.json().get("data", {})
                    client_name = p_data.get("name")
        except Exception as e:
            logger.warning(f"Não foi possível buscar nome da person {person_id}: {e}")
            
    if not client_name:
        client_name = briefing_json.get("dados_cliente", {}).get("nome") or "Cliente"
        
    # 5. Atualiza briefing_json com Pipedrive URLs e limpa flags de ignore/unlinked
    if "pipedrive" not in briefing_json:
        briefing_json["pipedrive"] = {}
    if "dados_cliente" not in briefing_json:
        briefing_json["dados_cliente"] = {}
        
    briefing_json["is_ignored"] = False
    briefing_json["manually_unlinked"] = False
    briefing_json["is_deleted"] = False
    briefing_json["dados_cliente"]["nome"] = client_name
    briefing_json["pipedrive"]["person_id"] = str(person_id) if person_id else None
    briefing_json["pipedrive"]["deal_id"] = str(deal_id) if deal_id else None
    briefing_json["pipedrive"]["person_url"] = f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None
    briefing_json["pipedrive"]["deal_url"] = f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
    
    # 5.1 Garante extração de data e hora do texto ou da data do registro
    if not briefing_json.get("data_reuniao") or not briefing_json.get("hora_reuniao"):
        trans_txt = t.get("transcription_text") or ""
        if trans_txt:
            parsed_dates = parse_tactiq_doc(trans_txt, meeting_title)
            if parsed_dates.get("data_reuniao") and not briefing_json.get("data_reuniao"):
                briefing_json["data_reuniao"] = parsed_dates["data_reuniao"]
            if parsed_dates.get("hora_reuniao") and not briefing_json.get("hora_reuniao"):
                briefing_json["hora_reuniao"] = parsed_dates["hora_reuniao"]

    if not briefing_json.get("data_reuniao") and (t.get("meeting_date") or t.get("created_at")):
        raw_dt_str = t.get("meeting_date") or t.get("created_at")
        try:
            dt_utc = datetime.fromisoformat(str(raw_dt_str).replace("Z", "+00:00"))
            dt_sp = dt_utc - timedelta(hours=3)
            briefing_json["data_reuniao"] = dt_sp.strftime("%d/%m/%Y")
            if not briefing_json.get("hora_reuniao"):
                briefing_json["hora_reuniao"] = dt_sp.strftime("%H:%M")
        except Exception:
            pass

    # 6. Cria Nota no Pipedrive com o Briefing
    note_id = None
    if req.create_activity or getattr(req, "create_note", True):
        briefing_note_html = generate_pipedrive_briefing_html(
            briefing_json=briefing_json,
            meeting_title=meeting_title,
            client_name=client_name
        )
        note_res = await create_pipedrive_note(
            content=briefing_note_html,
            person_id=person_id,
            deal_id=deal_id
        )
        if note_res:
            note_id = str(note_res.get("id"))
            briefing_json["pipedrive"]["note_id"] = note_id
            briefing_json["pipedrive"]["activity_id"] = None
            
    # 7. Atualiza registro da Transcrição
    supabase.table("transcriptions").update({
        "processing_status": "completed",
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    # 8. Registra no Log de Auditoria
    log_audit_event(
        action="DRIVE_DOC_REASSIGNED" if (old_activity_id or old_note_id) else "DRIVE_DOC_LINKED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "cliente_nome": client_name,
            "pipedrive_person_id": person_id,
            "pipedrive_deal_id": deal_id,
            "pipedrive_note_id": note_id,
            "old_activity_id": old_activity_id,
            "old_activity_deleted": old_act_deleted,
            "old_note_id": old_note_id,
            "old_note_deleted": old_note_deleted,
            "deal_url": briefing_json["pipedrive"].get("deal_url"),
            "person_url": briefing_json["pipedrive"].get("person_url"),
            "proxima_acao": briefing_json.get("proxima_acao", {}).get("descricao"),
            "is_linked_to_crm": True,
            "assigned_manually": True,
            "summary": f"Transcrição '{meeting_title}' " + (f"reatribuída (registro anterior removido) para '{client_name}'" if (old_activity_id or old_note_id) else f"vinculada ao cliente '{client_name}'") + (f" (Deal #{deal_id})" if deal_id else "") + (f" no Pipedrive com nota (#{note_id}) sincronizada." if note_id else " no Pipedrive.")
        }
    )
    
    return {
        "status": "success",
        "message": f"Transcrição vinculada com sucesso ao Pipedrive com Nota no cliente '{client_name}'!" + (" (Registro anterior substituído)" if (old_act_deleted or old_note_deleted) else ""),
        "person_id": person_id,
        "deal_id": deal_id,
        "note_id": note_id,
        "person_url": briefing_json["pipedrive"].get("person_url"),
        "deal_url": briefing_json["pipedrive"].get("deal_url"),
        "briefing_json": briefing_json
    }

@app.delete("/api/transcriptions/{transcription_id}/unlink")
@app.post("/api/transcriptions/{transcription_id}/unlink")
async def unlink_transcription_from_crm(
    transcription_id: str,
    delete_activity: bool = True,
    delete_note: bool = True,
    user: dict = Depends(require_admin)
):
    """Desvincula uma transcrição do Pipedrive, exclui a nota/atividade associada no CRM e impede reenvio automático"""
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    pipe_info = briefing_json.get("pipedrive") or {}
    old_activity_id = pipe_info.get("activity_id")
    old_note_id = pipe_info.get("note_id")
    old_person = briefing_json.get("dados_cliente", {}).get("nome") or pipe_info.get("person_id")
    old_deal = pipe_info.get("deal_id")
    
    # 1. Apaga atividade no Pipedrive se existir
    act_deleted = False
    if delete_activity and old_activity_id:
        act_deleted = await delete_pipedrive_activity(old_activity_id)
        
    # 2. Apaga nota se existir
    note_deleted = False
    if delete_note and old_note_id:
        note_deleted = await delete_pipedrive_note(old_note_id)
        
    # 3. Limpa os vínculos no briefing_json e marca flag de desvinculação manual
    briefing_json["manually_unlinked"] = True
    briefing_json["pipedrive"] = {
        "person_id": None,
        "deal_id": None,
        "person_url": None,
        "deal_url": None,
        "activity_id": None,
        "note_id": None
    }
    
    # 4. Atualiza registro da Transcrição mantendo 'completed' para a sincronização contínua NÃO reenviar
    supabase.table("transcriptions").update({
        "processing_status": "completed",
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    # 5. Registra no Log de Auditoria
    log_audit_event(
        action="DRIVE_DOC_UNLINKED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "old_client": old_person,
            "old_deal_id": old_deal,
            "old_activity_id": old_activity_id,
            "old_note_id": old_note_id,
            "activity_deleted_from_crm": act_deleted,
            "note_deleted_from_crm": note_deleted,
            "summary": f"Transcrição '{meeting_title}' desvinculada do Pipedrive por Robson" + (f" (nota/atividade #{old_note_id or old_activity_id} removida do CRM)." if (act_deleted or note_deleted) else ".")
        }
    )
    
    return {
        "status": "success",
        "message": "Transcrição desvinculada com sucesso" + (" e registros removidos do Pipedrive." if (act_deleted or note_deleted) else "."),
        "activity_deleted": act_deleted,
        "note_deleted": note_deleted,
        "briefing_json": briefing_json
    }

class AplicarCadastroRequest(BaseModel):
    """Só os campos marcados chegam aqui — a tela nunca envia o que não foi revisado."""
    campos: List[str] = []
    criar_nota: bool = False


@app.get("/api/transcriptions/com-dados-cadastrais")
async def listar_transcricoes_com_dados_cadastrais(
    incluir_dispensadas: bool = False,
    user: dict = Depends(get_current_user),
):
    """
    Transcrições vinculadas a uma pessoa que trazem algum dado de cadastro.

    Não consulta o Pipedrive: a comparação com o CRM é cara (uma chamada por
    pessoa) e só faz sentido na tela de revisão. Aqui a pergunta é mais simples
    — "esta reunião apurou algo sobre o cliente?" — e ela se responde só com o
    documento. Por isso a contagem devolvida é de campos *extraídos*, não de
    campos pendentes; nomear isso errado na tela prometeria uma revisão que
    ainda não foi feita.

    O que já foi dispensado sai da lista por padrão. Como toda reunião vinculada
    acaba caindo aqui, sem isso a fila só cresce e para de ser fila.
    """
    res = supabase.table("transcriptions").select(
        "id, meeting_title, meeting_date, briefing_json, transcription_text"
    ).order("meeting_date", desc=True).limit(200).execute()

    itens = []
    dispensadas = 0
    for t in res.data or []:
        briefing = t.get("briefing_json") or {}
        if briefing.get("is_ignored"):
            continue
        pipedrive = briefing.get("pipedrive") or {}
        person_id = pipedrive.get("person_id")
        if not person_id:
            continue

        dados = dados_cliente_atualizados(briefing, t.get("transcription_text"))
        campos = [
            rotulo
            for origem, _chave, rotulo, _tipo in CAMPOS_SUGERIVEIS
            if str(dados.get(origem) or "").strip()
        ]
        if not campos:
            continue

        dispensada = bool(briefing.get("cadastro_dispensado"))
        if dispensada:
            dispensadas += 1
            if not incluir_dispensadas:
                continue

        itens.append({
            "id": t["id"],
            "meeting_title": t.get("meeting_title"),
            "meeting_date": t.get("meeting_date"),
            "person_id": str(person_id),
            "person_name": dados.get("nome") or pipedrive.get("person_name"),
            "deal_id": pipedrive.get("deal_id"),
            "campos_extraidos": campos,
            "dispensada": dispensada,
        })

    return {
        "total": len([i for i in itens if not i["dispensada"]]),
        "dispensadas": dispensadas,
        "itens": itens,
    }


class DispensarCadastroRequest(BaseModel):
    dispensado: bool = True


@app.post("/api/transcriptions/{transcription_id}/cadastro-dispensar")
async def dispensar_cadastro(
    transcription_id: str,
    req: DispensarCadastroRequest,
    user: dict = Depends(get_current_user),
):
    """
    Tira (ou devolve) a transcrição da fila de revisão de cadastro.

    Flag próprio, e não `is_ignored`: aquele marca a reunião como interna e
    chega a apagar atividade e nota do Pipedrive. Aqui a reunião continua
    valendo — só já foi olhada sob a ótica do cadastro. Confundir os dois
    apagaria registro do CRM por um clique de "ocultar card".
    """
    res = supabase.table("transcriptions").select("briefing_json, meeting_title").eq(
        "id", transcription_id
    ).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")

    briefing = res.data[0].get("briefing_json") or {}
    titulo = res.data[0].get("meeting_title") or "Reunião"
    briefing["cadastro_dispensado"] = req.dispensado

    supabase.table("transcriptions").update({"briefing_json": briefing}).eq(
        "id", transcription_id
    ).execute()

    log_audit_event(
        action="CADASTRO_DISPENSADO" if req.dispensado else "CADASTRO_REABERTO",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": titulo,
            "summary": (
                f"Revisão de cadastro de '{titulo}' dispensada."
                if req.dispensado
                else f"Revisão de cadastro de '{titulo}' devolvida à fila."
            ),
        },
    )

    return {"status": "success", "dispensado": req.dispensado}


@app.get("/api/transcriptions/{transcription_id}/sugestoes-cadastro")
async def get_sugestoes_cadastro(
    transcription_id: str,
    user: dict = Depends(get_current_user),
):
    """O que a transcrição sugere para o cadastro, ao lado do valor atual."""
    res = supabase.table("transcriptions").select(
        "briefing_json, meeting_title, transcription_text"
    ).eq("id", transcription_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")

    briefing = res.data[0].get("briefing_json") or {}
    person_id = (briefing.get("pipedrive") or {}).get("person_id")
    dados = await montar_sugestoes_cadastro(
        briefing, person_id, res.data[0].get("transcription_text")
    )
    return {**dados, "meeting_title": res.data[0].get("meeting_title")}


@app.post("/api/transcriptions/{transcription_id}/aplicar-cadastro")
async def aplicar_cadastro(
    transcription_id: str,
    req: AplicarCadastroRequest,
    user: dict = Depends(require_admin),
):
    """
    Grava no Pipedrive apenas os campos marcados na revisão.

    O log guarda valores antigo e novo: é o que permite desfazer uma sugestão
    ruim e avaliar se a extração está melhorando com o tempo.
    """
    res = supabase.table("transcriptions").select(
        "briefing_json, meeting_title, transcription_text"
    ).eq("id", transcription_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")

    briefing = res.data[0].get("briefing_json") or {}
    titulo = res.data[0].get("meeting_title") or "Reunião"
    person_id = (briefing.get("pipedrive") or {}).get("person_id")
    if not person_id:
        raise HTTPException(status_code=400, detail="Transcrição sem pessoa vinculada no Pipedrive")

    dados = await montar_sugestoes_cadastro(
        briefing, person_id, res.data[0].get("transcription_text")
    )
    escolhidas = [
        s for s in dados["sugestoes"]
        if s["campo"] in req.campos and s["aplicavel"] and s["valor_a_gravar"] is not None
    ]
    if not escolhidas and not req.criar_nota:
        raise HTTPException(status_code=400, detail="Nenhum campo selecionado")

    payload = {s["chave_pipedrive"]: s["valor_a_gravar"] for s in escolhidas}
    antigos = {s["rotulo"]: s["valor_atual"] for s in escolhidas}
    novos = {s["rotulo"]: s["valor_exibido"] for s in escolhidas}

    if payload:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.put(
                f"https://api.pipedrive.com/v1/persons/{person_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN},
                json=payload,
            )
            if r.status_code != 200:
                logger.error(f"Falha ao atualizar pessoa {person_id}: {r.text[:200]}")
                raise HTTPException(status_code=502, detail=f"Pipedrive respondeu {r.status_code}")

    nota_id = None
    if req.criar_nota and dados["extras_para_nota"]:
        partes = []
        for chave, rotulo in (
            ("patrimonio_bens", "Patrimônio e bens"),
            ("seguros_existentes", "Seguros já existentes"),
            ("demonstrou_interesse", "Interesse demonstrado"),
        ):
            valor = dados["extras_para_nota"].get(chave)
            if not valor:
                continue
            if isinstance(valor, list):
                itens = "".join(f"<li>{v}</li>" for v in valor)
                partes.append(f"<p><strong>{rotulo}</strong></p><ul>{itens}</ul>")
            else:
                partes.append(f"<p><strong>{rotulo}:</strong> {valor}</p>")
        if partes:
            html = f"<p><em>Extraído da reunião: {titulo}</em></p>" + "".join(partes)
            nota = await create_pipedrive_note(content=html, person_id=str(person_id), deal_id=None)
            nota_id = str(nota.get("id")) if nota else None

    log_audit_event(
        action="PERSON_UPDATED_FROM_TRANSCRIPTION",
        resource_type="person",
        resource_id=str(person_id),
        user_id=user.get("id"),
        details={
            "transcription_id": transcription_id,
            "doc_title": titulo,
            "campos_aplicados": [s["rotulo"] for s in escolhidas],
            "nota_criada": nota_id,
        },
        old_values=antigos,
        new_values=novos,
    )

    return {
        "aplicados": len(escolhidas),
        "campos": [s["rotulo"] for s in escolhidas],
        "nota_id": nota_id,
        "person_id": person_id,
    }


@app.get("/api/transcriptions/{transcription_id}/vinculo")
async def get_vinculo_transcricao(
    transcription_id: str,
    user: dict = Depends(get_current_user),
):
    """Estado do vínculo com a atividade, incluindo o motivo da falha."""
    res = supabase.table("transcriptions").select("briefing_json, meeting_title").eq(
        "id", transcription_id
    ).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")

    briefing = res.data[0].get("briefing_json") or {}
    vinculo = briefing.get("vinculo")
    if not vinculo:
        # Transcrição processada antes desta funcionalidade existir.
        return {
            "status": "nao_avaliado",
            "motivo": "NAO_AVALIADO",
            "detalhe": {},
            "meeting_title": res.data[0].get("meeting_title"),
        }
    return {**vinculo, "meeting_title": res.data[0].get("meeting_title")}


@app.post("/api/transcriptions/{transcription_id}/revincular")
async def revincular_transcricao(
    transcription_id: str,
    user: dict = Depends(require_admin),
):
    """Reavalia o vínculo de uma transcrição, sem reprocessar o documento."""
    res = supabase.table("transcriptions").select(
        "briefing_json, meeting_title, google_doc_id, transcription_text"
    ).eq("id", transcription_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")

    briefing = res.data[0].get("briefing_json") or {}
    titulo = res.data[0].get("meeting_title") or "Reunião"

    # Relê as decisões do documento antes de montar a tarefa. O briefing gravado
    # guarda o resultado do parser da época, e o de antes desta correção cortava
    # a seção no meio quando um bullet dizia "pontos de atenção".
    texto = res.data[0].get("transcription_text")
    if texto:
        try:
            frescas = _bloco_da_secao(texto, r"DECIS[OÕ]ES E PR[ÓO]XIMOS PASSOS")
            if frescas:
                briefing["decisoes_proximos_passos"] = _itens_da_lista(frescas)
        except Exception as e:
            logger.warning(f"Falha ao reler decisões de '{titulo}': {e}")
    vinculo = await vincular_briefing_na_atividade(
        briefing, titulo, res.data[0].get("google_doc_id")
    )
    briefing["vinculo"] = vinculo
    if vinculo["status"] == "vinculado":
        briefing.setdefault("pipedrive", {})["activity_id"] = vinculo["activity_id"]

    supabase.table("transcriptions").update({"briefing_json": briefing}).eq(
        "id", transcription_id
    ).execute()

    log_audit_event(
        action="TRANSCRIPTION_LINKED" if vinculo["status"] == "vinculado" else "TRANSCRIPTION_LINK_FAILED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id"),
        details={"doc_title": titulo, "motivo": vinculo["motivo"], "manual": True, **vinculo.get("detalhe", {})},
    )
    return vinculo


@app.post("/api/transcriptions/{transcription_id}/toggle-ignore")
async def toggle_ignore_transcription(
    transcription_id: str,
    user: dict = Depends(require_admin)
):
    """Alterna o status de ignorada/reunião interna de uma transcrição, removendo nota/atividade do Pipedrive se marcada como ignorada"""
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    pipe_info = briefing_json.get("pipedrive") or {}
    old_activity_id = pipe_info.get("activity_id")
    old_note_id = pipe_info.get("note_id")
    
    current_ignored = briefing_json.get("is_ignored", False)
    new_ignored = not current_ignored
    briefing_json["is_ignored"] = new_ignored
    
    act_deleted = False
    note_deleted = False
    if new_ignored:
        # Se for marcada como ignorada / reunião interna, remove nota/atividade existente do Pipedrive para não poluir o CRM
        if old_activity_id:
            act_deleted = await delete_pipedrive_activity(old_activity_id)
        if old_note_id:
            note_deleted = await delete_pipedrive_note(old_note_id)
            
        if "pipedrive" in briefing_json:
            briefing_json["pipedrive"]["activity_id"] = None
            briefing_json["pipedrive"]["activity_subject"] = None
            briefing_json["pipedrive"]["activity_type"] = None
            briefing_json["pipedrive"]["activity_date"] = None
            briefing_json["pipedrive"]["note_id"] = None
    
    supabase.table("transcriptions").update({
        "processing_status": "completed",
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    action_text = "marcada como Reunião Interna (Ignorada)" if new_ignored else "reaberta para acompanhamento"
    
    log_audit_event(
        action="TRANSCRIPTION_IGNORED" if new_ignored else "TRANSCRIPTION_UNIGNORED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "is_ignored": new_ignored,
            "old_activity_id": old_activity_id,
            "old_note_id": old_note_id,
            "activity_deleted_from_crm": act_deleted,
            "note_deleted_from_crm": note_deleted,
            "summary": f"Transcrição '{meeting_title}' {action_text} por Robson" + (f" (registros removidos do Pipedrive)." if (act_deleted or note_deleted) else ".")
        }
    )
    
    return {
        "status": "success",
        "is_ignored": new_ignored,
        "activity_deleted": act_deleted,
        "note_deleted": note_deleted,
        "message": f"Transcrição {action_text} com sucesso" + (" e registros removidos do Pipedrive." if (act_deleted or note_deleted) else "."),
        "briefing_json": briefing_json
    }

@app.delete("/api/transcriptions/{transcription_id}")
async def delete_transcription_endpoint(
    transcription_id: str,
    user: dict = Depends(require_admin)
):
    """Exclui/oculta uma transcrição e remove sua nota/atividade associada no Pipedrive com proteção contra reimportação do Google Drive"""
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    pipe_info = briefing_json.get("pipedrive") or {}
    activity_id = pipe_info.get("activity_id")
    note_id = pipe_info.get("note_id")
    
    # 1. Apaga do Pipedrive se houver atividade ou nota
    act_deleted = False
    if activity_id:
        act_deleted = await delete_pipedrive_activity(activity_id)
        
    note_deleted = False
    if note_id:
        note_deleted = await delete_pipedrive_note(note_id)
        
    # 2. Marca flags de controle para não exibir no painel e não ser re-sincronizado pelo auto-sync
    briefing_json["is_deleted"] = True
    briefing_json["is_ignored"] = True
    briefing_json["manually_unlinked"] = True
    briefing_json["pipedrive"] = {
        "person_id": None,
        "deal_id": None,
        "person_url": None,
        "deal_url": None,
        "activity_id": None,
        "note_id": None
    }
    
    supabase.table("transcriptions").update({
        "processing_status": "completed",
        "briefing_json": briefing_json
    }).eq("id", transcription_id).execute()
    
    log_audit_event(
        action="TRANSCRIPTION_DELETED",
        resource_type="transcription",
        resource_id=transcription_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "doc_title": meeting_title,
            "activity_deleted": act_deleted,
            "note_deleted": note_deleted,
            "summary": f"Transcrição '{meeting_title}' excluída do painel por Robson" + (f" (nota/atividade removida do Pipedrive)." if (act_deleted or note_deleted) else ".")
        }
    )
    
    return {
        "status": "success",
        "message": "Transcrição excluída com sucesso" + (" e atividade removida do Pipedrive." if act_deleted else "."),
        "activity_deleted": act_deleted
    }

@app.get("/api/pipeline-activities")
async def get_pipeline_activities(
    limit: int = 50,
    user: dict = Depends(require_admin)
):
    """Lista activities criadas no pipeline"""
    
    query = supabase.table("pipeline_activities").select("*").order("created_at", desc=True).limit(limit)
    response = query.execute()
    
    return response.data

# ============================================================================
# ALERTS ENDPOINTS
# ============================================================================

@app.get("/api/alerts", response_model=List[AlertResponse])
async def get_alerts(
    resolved: Optional[bool] = None,
    alert_type: Optional[str] = None,
    user: dict = Depends(require_admin)
):
    """Lista alertas consolidados"""
    
    query = supabase.table("alerts").select("*")
    
    if resolved is not None:
        query = query.eq("is_resolved", resolved)
    
    if alert_type:
        query = query.eq("alert_type", alert_type)
    
    query = query.order("created_at", desc=True).limit(100)
    
    response = query.execute()
    
    return [
        AlertResponse(
            id=alert["id"],
            alert_type=alert["alert_type"],
            cliente_nome=alert.get("cliente_nome"),
            pipedrive_deal_id=alert.get("pipedrive_deal_id"),
            description=alert["description"],
            severity=alert["severity"],
            is_resolved=alert["is_resolved"],
            details=alert.get("details"),
            created_at=alert["created_at"]
        )
        for alert in response.data
    ]

@app.patch("/api/alerts/{alert_id}")
@app.patch("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, user: dict = Depends(require_admin)):
    """Marca alerta como resolvido e registra no log de auditoria"""
    
    # Busca dados do alerta antes de resolver
    current_alert = supabase.table("alerts").select("*").eq("id", alert_id).execute()
    alert_info = current_alert.data[0] if current_alert.data else {}
    
    response = supabase.table("alerts").update({
        "is_resolved": True,
        "resolved_by": user.get("id", user.get("sub")),
        "resolved_at": datetime.utcnow().isoformat()
    }).eq("id", alert_id).execute()
    
    log_audit_event(
        action="ALERT_RESOLVED",
        resource_type="alert",
        resource_id=alert_id,
        user_id=user.get("id", user.get("sub")),
        details={
            "alert_type": alert_info.get("alert_type"),
            "cliente_nome": alert_info.get("cliente_nome"),
            "description": alert_info.get("description"),
            "resolved_by": user.get("email"),
            "summary": f"Alerta de '{alert_info.get('alert_type', 'Geral')}' para o cliente '{alert_info.get('cliente_nome', 'Geral')}' foi marcado como resolvido."
        }
    )
    
    return {"status": "ok", "alert_id": alert_id}

# ============================================================================
# AUDIT & ACTIVITY LOGS ENDPOINTS
# ============================================================================

@app.get("/api/audit-logs")
async def get_audit_logs(
    action: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(require_admin)
):
    """Retorna histórico cronológico de logs de auditoria e atribuições"""
    query = supabase.table("audit_log").select("*").order("created_at", desc=True).limit(limit)
    
    if action and action != "all":
        query = query.eq("action", action)
        
    res = query.execute()
    logs = res.data or []
    
    if search and search.strip():
        q = search.lower().strip()
        filtered = []
        for item in logs:
            details = item.get("details") or {}
            details_str = json.dumps(details).lower()
            action_str = (item.get("action") or "").lower()
            if q in details_str or q in action_str:
                filtered.append(item)
        logs = filtered
        
    return logs

@app.get("/api/audit-logs/stats")
async def get_audit_logs_stats(user: dict = Depends(require_admin)):
    """Retorna métricas consolidadas dos logs de auditoria"""
    res = supabase.table("audit_log").select("action").execute()
    rows = res.data or []
    
    drive_count = sum(1 for r in rows if "DRIVE" in r.get("action", ""))
    pipedrive_count = sum(1 for r in rows if r.get("action") == "DRIVE_DOC_LINKED" or "PIPEDRIVE" in r.get("action", ""))
    booking_count = sum(1 for r in rows if "CALENDAR" in r.get("action", "") or "BOOKING" in r.get("action", ""))
    alert_count = sum(1 for r in rows if "ALERT" in r.get("action", ""))
    
    return {
        "total_logs": len(rows),
        "drive_updates": drive_count,
        "pipedrive_assignments": pipedrive_count,
        "calendar_bookings": booking_count,
        "alerts_actions": alert_count
    }

# ============================================================================
# JOB SCHEDULER: Alertas diários
# ============================================================================

def generate_daily_alerts():
    """Job diário que consolida alertas do Funil Comercial do Pipedrive"""
    import asyncio
    try:
        logger.info("Iniciando job diário de monitoramento do Funil Comercial...")
        asyncio.run(sync_comercial_alerts_internal(user_id="system_cron"))
        logger.info("Job diário de monitoramento concluído com sucesso")
    except Exception as e:
        logger.error(f"Erro no job diário do Funil Comercial: {e}")

def sync_drive_transcriptions_job():
    """Job periódico de sincronização automática de transcrições do Google Drive (a cada 5 minutos)"""
    import asyncio
    try:
        logger.info("🔄 [Auto-Sync] Verificando novas transcrições no Google Drive...")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        stats = loop.run_until_complete(process_new_transcription())
        loop.close()
        if stats.get("processed_new", 0) > 0:
            logger.info(f"✨ [Auto-Sync] {stats['processed_new']} nova(s) transcrição(ões) sincronizada(s) com sucesso!")
        else:
            logger.info(f"💤 [Auto-Sync] Verificação concluída ({stats.get('total_files', 0)} arquivos no Drive, 0 novos).")
    except Exception as e:
        logger.error(f"⚠️ [Auto-Sync] Erro na verificação periódica do Drive: {e}")

# Agenda job para rodar diariamente às 7h (Alertas Comerciais)
scheduler.add_job(generate_daily_alerts, "cron", hour=7, minute=0, timezone="America/Sao_Paulo", id="daily_comercial_alerts", replace_existing=True)

# Agenda job para checagem automática de novas transcrições a cada 5 minutos
scheduler.add_job(sync_drive_transcriptions_job, "interval", minutes=5, id="auto_sync_drive_transcriptions", replace_existing=True)

# ============================================================================
# HEALTH CHECK & SYSTEM STATUS
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check básico"""
    return {"status": "ok"}

@app.get("/api/health")
@app.get("/api/system/status")
async def get_system_status(user: Optional[dict] = Depends(get_current_user_optional)):
    """Verifica status detalhado das conexões (Supabase, Drive, Pipedrive, Scheduler)"""
    status_report = {
        "supabase": {"connected": False, "detail": ""},
        "google_drive": {"connected": False, "detail": ""},
        "pipedrive": {"connected": False, "detail": ""},
        "scheduler": {"active": scheduler.running, "timezone": "America/Sao_Paulo"}
    }
    
    # 1. Supabase
    try:
        res = supabase.table("users").select("id").limit(1).execute()
        status_report["supabase"]["connected"] = True
        status_report["supabase"]["detail"] = "Conexão e RLS ativas"
    except Exception as e:
        status_report["supabase"]["detail"] = str(e)
        
    # 2. Google Drive
    try:
        folder_id = find_google_drive_folder()
        status_report["google_drive"]["connected"] = True
        status_report["google_drive"]["detail"] = f"Pasta '{GOOGLE_DRIVE_FOLDER_NAME}' conectada"
    except Exception as e:
        status_report["google_drive"]["detail"] = str(e)
        
    # 3. Pipedrive
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.pipedrive.com/v1/users/me", params={"api_token": PIPEDRIVE_API_TOKEN})
            if res.status_code == 200:
                user_info = res.json().get("data", {})
                status_report["pipedrive"]["connected"] = True
                status_report["pipedrive"]["detail"] = f"{user_info.get('name')} (CRM)"
            else:
                status_report["pipedrive"]["detail"] = f"Status {res.status_code}"
    except Exception as e:
        status_report["pipedrive"]["detail"] = str(e)
        
    return status_report

@app.post("/api/webhooks/trigger-sync")
@app.post("/api/transcriptions/sync")
@app.post("/api/system/test-connections")
async def trigger_drive_sync(
    user: dict = Depends(require_admin)
):
    """Dispara sincronização manual de novos arquivos no Google Drive e teste de conexões"""
    user_id = user.get("id", user.get("sub", ""))
    try:
        folder_id = find_google_drive_folder()
    except Exception as e:
        logger.error(f"Erro ao localizar pasta do Google Drive: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao acessar pasta do Google Drive: {str(e)}")
        
    stats = await process_new_transcription(user_id)
    return {
        "status": "success",
        "message": f"Sincronização concluída! {stats.get('processed_new', 0)} novos arquivos processados ({stats.get('already_existing', 0)} já sincronizados).",
        "stats": stats,
        "folder_id": folder_id
    }

@app.get("/api/system/config")
async def get_system_config(user: dict = Depends(require_admin)):
    """Obtém configurações ativas do sistema"""
    try:
        res = supabase.table("configuration").select("*").execute()
        return res.data
    except Exception as e:
        logger.error(f"Erro ao buscar configurações: {e}")
        return []

# ============================================================================
# CALENDAR & BOOKING SYSTEM (CALENDLY / MS BOOKINGS STYLE)
# ============================================================================

DEFAULT_WEEKLY_SCHEDULE = {
    "0": {"day": 0, "name": "Domingo", "enabled": False, "intervals": []},
    "1": {"day": 1, "name": "Segunda-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "2": {"day": 2, "name": "Terça-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "3": {"day": 3, "name": "Quarta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "4": {"day": 4, "name": "Quinta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "5": {"day": 5, "name": "Sexta-feira", "enabled": True, "intervals": [{"start": "09:00", "end": "18:00"}]},
    "6": {"day": 6, "name": "Sábado", "enabled": False, "intervals": []},
}

class CalendarSettings(BaseModel):
    weekly_schedule: Dict[str, Any] = Field(default_factory=lambda: DEFAULT_WEEKLY_SCHEDULE)
    work_days: List[int] = [1, 2, 3, 4, 5]  # 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab, 7=Dom
    start_hour: str = "09:00"
    end_hour: str = "18:00"
    lunch_start: str = "12:00"
    lunch_end: str = "13:00"
    slot_duration_minutes: int = 60
    buffer_before_minutes: int = 0
    buffer_after_minutes: int = 0
    buffer_minutes: int = 0
    slot_interval_minutes: int = 30  # Limitar a hora de início a (15, 30, 60 min)
    min_notice_hours: int = 12        # Prazo de entrega mínimo (12 horas)
    max_future_days: int = 21         # Prazo de entrega máximo (21 dias)
    timezone: str = "America/Sao_Paulo"
    teams_meeting_url: Optional[str] = None
    meet_meeting_url: Optional[str] = None
    whatsapp_single_template: Optional[str] = "{dia_semana} ({data}) {assunto} com {cliente} ({horario})"
    whatsapp_header_template: Optional[str] = "📅 *Agenda de Atendimentos - Robson Vieira & {assessor}*\n"
    whatsapp_day_template: Optional[str] = "🔹 *{dia_semana} ({data})*"
    whatsapp_item_template: Optional[str] = "• {horario} | {assunto} com {cliente}"
    whatsapp_footer_template: Optional[str] = "Qualquer dúvida ou ajuste de horário, estou à disposição! 🚀"
    meeting_types: List[Dict[str, Any]] = [
        {
            "id": "r1",
            "name": "R1 Planejamento Sucessório",
            "duration": 60,
            "color": "sky",
            "description": "Primeira reunião de levantamento patrimonial e objetivos familiares.",
            "active": True
        },
        {
            "id": "r2",
            "name": "R2 Gestão Patrimonial",
            "duration": 45,
            "color": "teal",
            "description": "Apresentação da estratégia personalizada e estruturação.",
            "active": True
        },
        {
            "id": "revisao",
            "name": "Revisão de Carteira & Apólices",
            "duration": 30,
            "color": "amber",
            "description": "Acompanhamento periódico de coberturas e ativos.",
            "active": True
        },
        {
            "id": "follow_up",
            "name": "Follow-up & Alinhamento Rápido",
            "duration": 30,
            "color": "indigo",
            "description": "Tira-dúvidas e próximos passos contratuais.",
            "active": True
        }
    ]

class BookingRequest(BaseModel):
    date: str  # "YYYY-MM-DD"
    time: str  # "HH:MM"
    meeting_type_id: str
    meeting_type_name: str
    duration_minutes: int
    client_name: str
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    org_id: Optional[Union[int, str]] = None
    org_name: Optional[str] = None
    person_id: Optional[str] = None
    deal_id: Optional[str] = None
    platform: str = "teams"  # "teams" | "meet" | "presencial"
    notes: Optional[str] = None

def get_calendar_settings_data() -> Dict[str, Any]:
    """Função interna para carregar configurações de calendário"""
    try:
        res = supabase.table("configuration").select("value").eq("key", "calendar_settings").execute()
        if res.data and len(res.data) > 0:
            val = res.data[0]["value"]
            data = json.loads(val) if isinstance(val, str) else val
            if "weekly_schedule" not in data:
                data["weekly_schedule"] = DEFAULT_WEEKLY_SCHEDULE
            if "buffer_before_minutes" not in data:
                data["buffer_before_minutes"] = 0
            if "buffer_after_minutes" not in data:
                data["buffer_after_minutes"] = 0
            if "slot_interval_minutes" not in data:
                data["slot_interval_minutes"] = 30
            return data
    except Exception as e:
        logger.error(f"Erro ao buscar calendar_settings: {e}")
        
    return CalendarSettings().dict()

@app.get("/api/calendar/settings")
async def get_calendar_settings(user: dict = Depends(require_admin)):
    """Obtém configurações de disponibilidade da agenda para o admin"""
    return get_calendar_settings_data()

@app.post("/api/calendar/settings")
@app.put("/api/calendar/settings")
async def save_calendar_settings(settings: CalendarSettings, user: dict = Depends(require_admin)):
    """Salva configurações de disponibilidade da agenda"""
    try:
        settings_dict = settings.dict()
        res = supabase.table("configuration").select("id").eq("key", "calendar_settings").execute()
        if res.data:
            supabase.table("configuration").update({
                "value": json.dumps(settings_dict),
                "updated_by": user.get("id", user.get("sub")),
                "updated_at": datetime.utcnow().isoformat()
            }).eq("key", "calendar_settings").execute()
        else:
            supabase.table("configuration").insert({
                "key": "calendar_settings",
                "value": json.dumps(settings_dict),
                "value_type": "json",
                "description": "Configurações de horários e regras da agenda",
                "updated_by": user.get("id", user.get("sub"))
            }).execute()
        return {"status": "ok", "settings": settings_dict}
    except Exception as e:
        logger.error(f"Erro ao salvar calendar_settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Cache para séries recorrentes de calendário
_RECURRING_ACTIVITIES_CACHE: List[Dict] = []
_RECURRING_CACHE_TIME: Optional[datetime] = None

async def fetch_pipedrive_busy_intervals(start_date: str, end_date: str) -> Dict[str, List[Tuple[int, int]]]:
    """
    Busca todas as ocupações reais da agenda no Pipedrive:
    - Atividades normais (abertas e concluídas que possuem horário)
    - Eventos sincronizados de calendários externos (Teams, Outlook, Google Calendar)
    - Ocorrências de séries recorrentes (ex: Encontro EPS Mensal, reuniões periódicas)
    Faz a conversão correta de fusos horários (UTC para São Paulo UTC-3 quando originado de calendar-sync).
    Retorna: { 'YYYY-MM-DD': [(start_minutes_of_day, end_minutes_of_day), ...] }
    """
    global _RECURRING_ACTIVITIES_CACHE, _RECURRING_CACHE_TIME
    
    raw_activities: List[Dict] = []
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Busca atividades com horário dentro do período (user_id=0 inclui todo o calendário)
            start = 0
            while True:
                res = await client.get(
                    "https://api.pipedrive.com/v1/activities",
                    params={
                        "api_token": PIPEDRIVE_API_TOKEN,
                        "user_id": 0,
                        "start_date": start_date,
                        "end_date": end_date,
                        "start": start,
                        "limit": 100
                    }
                )
                if res.status_code != 200:
                    break
                data = res.json().get("data", []) or []
                raw_activities.extend(data)
                pag = res.json().get("additional_data", {}).get("pagination", {})
                if not pag.get("more_items_in_collection"):
                    break
                start = pag.get("next_start", start + 100)
                
            # 2. Busca e mantém cache de eventos recorrentes (rec_rule / series)
            now = datetime.utcnow()
            if not _RECURRING_ACTIVITIES_CACHE or not _RECURRING_CACHE_TIME or (now - _RECURRING_CACHE_TIME).total_seconds() > 300:
                rec_list = []
                r_start = 0
                while True:
                    res_r = await client.get(
                        "https://api.pipedrive.com/v1/activities",
                        params={
                            "api_token": PIPEDRIVE_API_TOKEN,
                            "user_id": 0,
                            "start": r_start,
                            "limit": 100
                        }
                    )
                    if res_r.status_code != 200:
                        break
                    r_data = res_r.json().get("data", []) or []
                    for item in r_data:
                        if item.get("rec_rule") or item.get("series"):
                            rec_list.append(item)
                    pag_r = res_r.json().get("additional_data", {}).get("pagination", {})
                    if not pag_r.get("more_items_in_collection"):
                        break
                    r_start = pag_r.get("next_start", r_start + 100)
                _RECURRING_ACTIVITIES_CACHE = rec_list
                _RECURRING_CACHE_TIME = now
                
            raw_activities.extend(_RECURRING_ACTIVITIES_CACHE)
    except Exception as e:
        logger.error(f"Erro ao buscar atividades ocupadas do Pipedrive: {e}")
        
    busy_by_date: Dict[str, List[Tuple[int, int]]] = {}
    
    def add_busy_slot(date_str: str, time_str: str, duration_str: str, is_utc: bool = False):
        if not date_str or not time_str:
            return
        try:
            th, tm = map(int, time_str.split(":")[:2])
            # Se o horário vem em UTC (de calendar-sync ou series), converte para horário local de SP (-3h)
            if is_utc:
                dt_utc = datetime.strptime(f"{date_str} {th:02d}:{tm:02d}", "%Y-%m-%d %H:%M")
                dt_sp = dt_utc - timedelta(hours=3)
                date_str = dt_sp.strftime("%Y-%m-%d")
                start_m = dt_sp.hour * 60 + dt_sp.minute
            else:
                start_m = th * 60 + tm
                
            dur_m = 60
            if duration_str:
                dh, dm = map(int, duration_str.split(":")[:2])
                dur_m = dh * 60 + dm
                if dur_m <= 0:
                    dur_m = 30
                    
            end_m = start_m + dur_m
            if date_str not in busy_by_date:
                busy_by_date[date_str] = []
            busy_by_date[date_str].append((start_m, end_m))
        except Exception:
            pass

    for act in raw_activities:
        due_date = act.get("due_date")
        due_time = act.get("due_time")
        dur = act.get("duration")
        ref_type = act.get("reference_type")
        series = act.get("series") or []
        
        # Todas as atividades com horário no Pipedrive são armazenadas em UTC
        if due_date and due_time:
            add_busy_slot(due_date, due_time, dur, is_utc=True)
            
        # Ocorrências de séries recorrentes (armazenadas em UTC)
        if isinstance(series, list):
            for s in series:
                s_date = s.get("due_date")
                s_time = s.get("due_time")
                if s_date and s_time:
                    add_busy_slot(s_date, s_time, dur, is_utc=True)
                    
    return busy_by_date

@app.get("/api/calendar/available-slots")
async def get_available_slots(
    duration: int = 60,
    start_date: Optional[str] = None,
    days_count: int = 30,
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """Calcula slots livres estilo Calendly baseando-se nas regras e conflitos (acesso público)"""
    # 1. Carrega configurações
    try:
        dur_int = int(duration) if str(duration).isdigit() else 60
    except Exception:
        dur_int = 60
    duration = dur_int

    settings_res = get_calendar_settings_data()
    weekly_schedule = settings_res.get("weekly_schedule")
    work_days = settings_res.get("work_days", [1, 2, 3, 4, 5])
    start_hour_str = settings_res.get("start_hour", "09:00")
    end_hour_str = settings_res.get("end_hour", "18:00")
    
    buffer_before = int(settings_res.get("buffer_before_minutes", 0) or 0)
    buffer_after = int(settings_res.get("buffer_after_minutes", settings_res.get("buffer_minutes", 0)) or 0)
    slot_step = int(settings_res.get("slot_interval_minutes", 30) or 30)
    min_notice_hrs = int(settings_res.get("min_notice_hours", 12) or 12)
    max_future_days = int(settings_res.get("max_future_days", 21) or 21)
    
    actual_days_count = min(int(days_count or 30), max_future_days)
    
    # 2. Período de cálculo
    now_utc = datetime.utcnow()
    # Horário local de SP (-3h)
    now_local = now_utc - timedelta(hours=3)
    
    if start_date:
        try:
            curr_date = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            curr_date = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        curr_date = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        
    end_calc_date = curr_date + timedelta(days=actual_days_count)
    
    # 3. Busca ocupações reais no Pipedrive (incluindo calendar-sync e séries recorrentes)
    busy_by_date = await fetch_pipedrive_busy_intervals(
        curr_date.strftime("%Y-%m-%d"),
        end_calc_date.strftime("%Y-%m-%d")
    )
    
    # Converte strings de horário para minutos do dia
    def to_minutes(h_str: str) -> int:
        h, m = map(int, h_str.split(":")[:2])
        return h * 60 + m
        
    def to_time_str(mins: int) -> str:
        h = mins // 60
        m = mins % 60
        return f"{h:02d}:{m:02d}"
        
    weekday_names = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    
    result_days = []
    
    for day_offset in range(actual_days_count):
        day_date = curr_date + timedelta(days=day_offset)
        date_str = day_date.strftime("%Y-%m-%d")
        
        # Mapeamento do dia da semana para weekly_schedule:
        # Python weekday(): 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab, 6=Dom
        # Chave weekly_schedule: "0"=Dom, "1"=Seg, "2"=Ter, "3"=Qua, "4"=Qui, "5"=Sex, "6"=Sab
        day_key = str((day_date.weekday() + 1) % 7)
        
        intervals = []
        if weekly_schedule and day_key in weekly_schedule:
            day_cfg = weekly_schedule[day_key]
            if not day_cfg.get("enabled"):
                continue
            intervals = day_cfg.get("intervals", [])
            if not intervals:
                continue
        else:
            # Fallback para work_days legado
            iso_weekday = day_date.weekday() + 1
            if iso_weekday not in work_days:
                continue
            intervals = [{"start": start_hour_str, "end": end_hour_str}]
            
        day_busy = busy_by_date.get(date_str, [])
        slots = []
        seen_slot_times = set()
        
        for iv in intervals:
            iv_start_m = to_minutes(iv.get("start", "09:00"))
            iv_end_m = to_minutes(iv.get("end", "18:00"))
            
            current_m = iv_start_m
            
            while current_m + duration <= iv_end_m:
                slot_start = current_m
                slot_end = current_m + duration
                
                # Verifica colisão com atividades ocupadas no Pipedrive (considerando buffers)
                overlaps_busy = False
                for (b_start, b_end) in day_busy:
                    required_start = slot_start - buffer_before
                    required_end = slot_end + buffer_after
                    if not (required_end <= b_start or required_start >= b_end):
                        overlaps_busy = True
                        break
                        
                # Verifica antecedência mínima se for o dia de hoje
                is_past = False
                if date_str == now_local.strftime("%Y-%m-%d"):
                    now_m = now_local.hour * 60 + now_local.minute
                    if slot_start < now_m + (min_notice_hrs * 60):
                        is_past = True
                elif day_date < now_local.replace(hour=0, minute=0, second=0):
                    is_past = True
                    
                time_key = to_time_str(slot_start)
                if not overlaps_busy and not is_past and time_key not in seen_slot_times:
                    seen_slot_times.add(time_key)
                    slots.append({
                        "time": time_key,
                        "end_time": to_time_str(slot_end),
                        "duration_minutes": duration
                    })
                    
                # Avança pelo intervalo configurado (slot_step)
                current_m += slot_step
                
        # Ordena slots
        slots.sort(key=lambda s: s["time"])
        
        result_days.append({
            "date": date_str,
            "weekday_name": weekday_names[day_date.weekday()],
            "day_of_month": day_date.day,
            "month_name": day_date.strftime("%B"),
            "has_slots": len(slots) > 0,
            "slots_count": len(slots),
            "slots": slots
        })
        
    return {
        "duration_minutes": duration,
        "days": result_days
    }

@app.post("/api/calendar/book")
async def book_meeting(booking: BookingRequest, user: Optional[dict] = Depends(get_current_user_optional)):
    """Cria agendamento de reunião integrado ao Pipedrive (acesso público)"""
    try:
        # 1. Busca ou cria Pessoa no Pipedrive
        person_id = booking.person_id
        if not person_id:
            results = await search_pipedrive_person(booking.client_name, booking.client_email)
            if results:
                item_data = results[0].get("item", results[0])
                person_id = str(item_data.get("id"))
            else:
                # Cria nova pessoa
                async with httpx.AsyncClient() as client:
                    create_res = await client.post(
                        "https://api.pipedrive.com/v1/persons",
                        params={"api_token": PIPEDRIVE_API_TOKEN},
                        json={
                            "name": booking.client_name,
                            "email": [{"value": booking.client_email, "primary": True}] if booking.client_email else [],
                            "phone": [{"value": booking.client_phone, "primary": True}] if booking.client_phone else []
                        }
                    )
                    if create_res.status_code in [200, 201]:
                        person_id = str(create_res.json().get("data", {}).get("id"))
                        
        # 2. Busca Deal se não informado
        deal_id = booking.deal_id
        if person_id and not deal_id:
            deals = await get_person_deals(person_id)
            if deals:
                deal_id = str(deals[0].get("id"))
                
        # 3. Formata duração
        dur_h = booking.duration_minutes // 60
        dur_m = booking.duration_minutes % 60
        dur_str = f"{dur_h:02d}:{dur_m:02d}"
        
        assessor_suffix = f" - {booking.org_name}" if booking.org_name else ""
        subject = f"[{booking.meeting_type_name}] {booking.client_name}{assessor_suffix}"
        
        platform_location = "Microsoft Teams" if booking.platform == "teams" else ("Google Meet" if booking.platform == "meet" else "Presencial")
        conference_client = "teams" if booking.platform == "teams" else ("google_meet" if booking.platform == "meet" else None)
        
        # Busca URL de videoconferência padrão se configurada nas opções de agenda
        conf_meeting_url = None
        try:
            cfg_res = await get_calendar_settings()
            if booking.platform == "teams":
                conf_meeting_url = cfg_res.get("teams_meeting_url")
            elif booking.platform == "meet":
                conf_meeting_url = cfg_res.get("meet_meeting_url")
        except Exception:
            pass

        assessor_line = f"🏢 Assessor / Organização: {booking.org_name}\n" if booking.org_name else ""
        conf_link_line = f"🔗 Sala Virtual ({platform_location}): {conf_meeting_url}\n" if conf_meeting_url else ""
        note_content = (
            f"🎯 Tipo: {booking.meeting_type_name}\n"
            f"👤 Cliente: {booking.client_name}\n"
            f"{assessor_line}"
            f"📱 Telefone: {booking.client_phone or 'Não informado'}\n"
            f"📧 E-mail: {booking.client_email or 'Não informado'}\n"
            f"💻 Plataforma: {platform_location}\n"
            f"{conf_link_line}"
            f"📝 Observações: {booking.notes or 'Nenhuma'}\n"
            f"⚡ Agendado via Sistema Robson Tavernard"
        )
        
        # Mapeamento do tipo de reunião para a Tag/Tipo correspondente no Pipedrive:
        # 'meeting' -> Tag R1
        # 'reuniao_2' -> Tag R2
        # 'r3' -> Tag R3
        pipedrive_activity_type = "meeting"  # Tag R1 por padrão
        type_combined = f"{booking.meeting_type_id} {booking.meeting_type_name}".lower()
        if "r2" in type_combined or "gestão patrimonial" in type_combined:
            pipedrive_activity_type = "reuniao_2"
        elif "r3" in type_combined:
            pipedrive_activity_type = "r3"
        elif "teams" in type_combined:
            pipedrive_activity_type = "teams"
        elif "call" in type_combined or "chamada" in type_combined:
            pipedrive_activity_type = "call"
        
        # Converte a data e horário escolhidos (Brasília UTC-3) para UTC (+3h) para gravação no Pipedrive
        def to_pipedrive_utc(date_str: str, time_str: str) -> Tuple[str, str]:
            try:
                dt_local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
                dt_utc = dt_local + timedelta(hours=3)
                return dt_utc.strftime("%Y-%m-%d"), dt_utc.strftime("%H:%M")
            except Exception:
                return date_str, time_str

        utc_due_date, utc_due_time = to_pipedrive_utc(booking.date, booking.time)
        
        # 4. Cria Activity no Pipedrive (em aberto)
        activity = await create_pipedrive_activity(
            person_id=person_id,
            deal_id=deal_id,
            org_id=booking.org_id,
            subject=subject,
            due_date=utc_due_date,
            due_time=utc_due_time,
            duration=dur_str,
            location=platform_location,
            conference_meeting_url=conf_meeting_url,
            conference_meeting_client=conference_client,
            note=note_content,
            activity_type=pipedrive_activity_type,
            done=False
        )
        
        if not activity:
            raise HTTPException(status_code=500, detail="Erro ao criar atividade no Pipedrive")
            
        activity_id = str(activity.get("id"))
        
        person_url = f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None
        deal_url = f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
        
        # Registra no log de auditoria
        log_audit_event(
            action="CALENDAR_BOOKING_CREATED",
            resource_type="calendar_booking",
            resource_id=activity_id,
            user_id=user.get("id", user.get("sub")) if user else "PUBLIC_CLIENT",
            details={
                "client_name": booking.client_name,
                "client_email": booking.client_email,
                "client_phone": booking.client_phone,
                "meeting_type": booking.meeting_type_name,
                "date": booking.date,
                "time": booking.time,
                "duration": dur_str,
                "platform": booking.platform,
                "pipedrive_person_id": person_id,
                "pipedrive_deal_id": deal_id,
                "pipedrive_activity_id": activity_id,
                "person_url": person_url,
                "deal_url": deal_url,
                "summary": f"Novo agendamento de '{booking.meeting_type_name}' confirmado com {booking.client_name} para {booking.date} às {booking.time} ({booking.platform.upper()}). Atividade #{activity_id} vinculada ao Pipedrive."
            }
        )
        
        return {
            "status": "success",
            "message": "Reunião agendada com sucesso!",
            "activity_id": activity_id,
            "subject": subject,
            "date": booking.date,
            "time": booking.time,
            "duration": dur_str,
            "client_name": booking.client_name,
            "pipedrive_person_url": person_url,
            "pipedrive_deal_url": deal_url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao agendar reunião: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calendar/meetings")
async def get_scheduled_meetings(
    filter_type: str = "upcoming",  # "upcoming" | "all" | "past"
    user: dict = Depends(require_admin)
):
    """Lista reuniões agendadas no Pipedrive"""
    try:
        now_str = (datetime.utcnow() - timedelta(hours=3)).strftime("%Y-%m-%d")
        
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://api.pipedrive.com/v1/activities",
                params={
                    "api_token": PIPEDRIVE_API_TOKEN,
                    "type": "meeting",
                    "limit": 50
                }
            )
            if res.status_code != 200:
                return []
                
            activities = res.json().get("data", []) or []
            formatted = []
            for a in activities:
                due_date = a.get("due_date") or ""
                done = a.get("done")
                
                if filter_type == "upcoming" and (due_date < now_str or done):
                    continue
                elif filter_type == "past" and due_date >= now_str and not done:
                    continue
                    
                person = a.get("person_name") or a.get("person_id")
                person_id = a.get("person_id")
                deal_id = a.get("deal_id")
                
                formatted.append({
                    "id": a.get("id"),
                    "subject": a.get("subject"),
                    "date": due_date,
                    "time": a.get("due_time") or "09:00",
                    "duration": a.get("duration") or "00:45",
                    "client_name": person if isinstance(person, str) else a.get("subject"),
                    "person_id": person_id,
                    "deal_id": deal_id,
                    "is_done": done,
                    "pipedrive_person_url": f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None,
                    "pipedrive_deal_url": f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
                })
                
            formatted.sort(key=lambda x: (x["date"], x["time"]))
            return formatted
            
    except Exception as e:
        logger.error(f"Erro ao listar reuniões agendadas: {e}")
        return []

@app.delete("/api/calendar/meetings/{activity_id}")
async def cancel_meeting(activity_id: str, user: dict = Depends(require_admin)):
    """Cancela reunião agendada no Pipedrive"""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.delete(
                f"https://api.pipedrive.com/v1/activities/{activity_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code == 200:
                return {"status": "ok", "message": "Reunião cancelada com sucesso"}
            else:
                raise HTTPException(status_code=res.status_code, detail="Erro ao cancelar reunião no Pipedrive")
    except Exception as e:
        logger.error(f"Erro ao cancelar reunião {activity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# CALENDAR AUTHENTICATED ENDPOINTS
# ============================================================================

@app.get("/api/calendar/types")
async def get_calendar_meeting_types(user: Optional[dict] = Depends(get_current_user_optional)):
    """Retorna tipos de reuniões para o agendador (acesso público)"""
    settings_dict = get_calendar_settings_data()
    return {
        "planner_name": "Robson Vieira Tavernard",
        "planner_role": "Planejamento Financeiro e Sucessório",
        "company": "Planejamento Patrimonial",
        "meeting_types": settings_dict.get("meeting_types", []),
        "timezone": settings_dict.get("timezone", "America/Sao_Paulo")
    }

# ============================================================================
# PARSER & IMPORTAÇÃO DE FICHA CADASTRAL (PDF XP INVESTIMENTOS / OUTROS)
# ============================================================================

PIPEDRIVE_PERSON_CUSTOM_FIELDS = {
    "cpf": "bccf793f30f8882dc987634461f65fcefe04c116",
    "data_nascimento": "c5f06bfce880ed2c3618d10b40eab28c4b31dd1c",
    "profissao": "079e39aaa3b5ec6782cdea922a29682f165d3953",
    "estado_civil": "14a3f171ae02abe5a3e89333c707ed6f74df8837",
    "nome_conjuge": "dad66a725f4cce02a26669d26e4929cb1c816150",
    "renda": "3b4aea4bd2e89b7859117ade965123b8580d2173",
    "link_pasta": "7a4456cb975aa8b0decb9e1842eed3039a47e415",
    # Campos que o prompt novo do Tactiq passou a fornecer.
    "regime_casamento": "011f47eeeffdcd9977e52c2dd706e969a7d76abe",
    "filhos": "4dbe50bc5776265528952814794cf56659d16e1c",
    "conjuge_sem_protecao": "0d615482b0d010a1f487678d1137c1f753b1aaf7",
    "filhos_sem_protecao": "25a7be8d3ecfbf20f750d375297ce37e93c016e7",
}

# ============================================================================
# SUGESTÕES DE CADASTRO A PARTIR DA TRANSCRIÇÃO
# ============================================================================

# Campo da transcrição -> (chave em PIPEDRIVE_PERSON_CUSTOM_FIELDS, rótulo, tipo)
# Só entram campos cujo significado corresponde de fato. `seguros_existentes`
# fica de fora de proposito: os campos "CS - Capital Segurado" descrevem a
# apólice emitida por esta assessoria, não a cobertura que o cliente já tinha.
CAMPOS_SUGERIVEIS: List[Tuple[str, str, str, str]] = [
    ("profissao", "profissao", "Profissão", "texto"),
    ("estado_civil", "estado_civil", "Estado Civil", "enum"),
    ("regime_casamento", "regime_casamento", "Regime de Casamento", "enum"),
    ("nome_conjuge", "nome_conjuge", "Nome do cônjuge", "texto"),
    ("filhos", "filhos", "Filhos", "texto"),
    ("conjuge_sem_protecao", "conjuge_sem_protecao", "Cônjuge sem Proteção", "enum"),
    ("filhos_sem_protecao", "filhos_sem_protecao", "Filhos sem Proteção", "enum"),
    ("data_nascimento", "data_nascimento", "Data de Nascimento", "data"),
    ("renda_mensal", "renda", "Renda", "monetario"),
]


def _sem_flexao(txt: str) -> str:
    """Normaliza acento, caixa e terminação de gênero/número.

    A transcrição escreve "Casada"/"casados" onde a opção do Pipedrive é
    "Casado". Sem isso, nenhum enum casaria.
    """
    base = "".join(
        c for c in unicodedata.normalize("NFKD", str(txt or "")) if not unicodedata.combining(c)
    ).lower().strip()
    base = re.sub(r"[^a-z ]", "", base)
    return re.sub(r"(a|o|as|os)\b", "", base).strip()


def normalizar_para_opcao(valor: str, opcoes: List[Dict[str, Any]]) -> Optional[int]:
    """
    Casa texto livre com a opção de um campo enum, devolvendo o id.

    Devolve None quando não há correspondência clara — em campo de escolha fixa,
    sugerir errado é pior que não sugerir.
    """
    alvo = _sem_flexao(valor)
    if not alvo:
        return None
    for o in opcoes:
        if _sem_flexao(o.get("label")) == alvo:
            return o.get("id")
    # Segunda passada por contenção: "separacao obrigatoria" casa com
    # "separacao obrigatorio de bens".
    for o in opcoes:
        rotulo = _sem_flexao(o.get("label"))
        if rotulo and (alvo in rotulo or rotulo in alvo):
            return o.get("id")
    return None


def extrair_valor_monetario(texto: str) -> Optional[float]:
    """Tira um número de "cerca de R$ 12 mil". Sem número claro, devolve None."""
    limpo = str(texto or "").lower()
    m = re.search(r"(\d+(?:[.,]\d+)?)", limpo.replace(".", ""))
    if not m:
        return None
    try:
        valor = float(m.group(1).replace(",", "."))
    except ValueError:
        return None
    if "milh" in limpo:
        valor *= 1_000_000
    elif "mil" in limpo:
        valor *= 1_000
    return valor


def extrair_data_iso(texto: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Converte a data da transcrição para ISO.

    Devolve `(iso, motivo_de_recusa)`. A transcrição costuma trazer só o ano
    ("1984"), e o campo do Pipedrive é `date` — não aceita data parcial. Nesse
    caso o motivo é devolvido para a tela explicar, em vez de o campo sumir.
    """
    t = str(texto or "").strip()
    if not t:
        return None, None
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", t)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}", None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return m.group(0), None
    if re.fullmatch(r"(19|20)\d{2}", t):
        return None, "a transcrição trouxe só o ano"
    return None, "formato de data não reconhecido"


def dados_cliente_atualizados(
    briefing: Dict[str, Any], transcription_text: Optional[str]
) -> Dict[str, Any]:
    """
    Dados do cliente relidos do documento original, não do briefing gravado.

    O `briefing_json` guarda o resultado do parser vigente na hora do
    processamento. Transcrições anteriores à reescrita do parser têm ali um
    recorte pobre — a da Natália, por exemplo, guardou `estado_civil` e perdeu
    profissão, regime de bens, cônjuge e filhos, que estavam no documento.

    Reextrair na leitura resolve isso sem regravar nada: o briefing já enviado
    ao Pipedrive permanece como está, e a tela de sugestões passa a enxergar
    tudo que o parser atual sabe ler. Se o texto não estiver disponível, cai
    para o que foi gravado.
    """
    if transcription_text:
        try:
            relido = extrair_dados_cliente(transcription_text)
            if relido:
                return relido
        except Exception as e:  # documento malformado não pode derrubar a tela
            logger.warning(f"Falha ao reextrair dados do cliente: {e}")
    return briefing.get("dados_cliente") or {}


async def montar_sugestoes_cadastro(
    briefing: Dict[str, Any],
    person_id: Optional[str],
    transcription_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Compara o que a transcrição extraiu com o cadastro atual da pessoa.

    Nenhuma sugestão vem marcada: o valor que já está no CRM é a informação
    principal, e a alteração exige decisão explícita de quem revisa.
    """
    dados = dados_cliente_atualizados(briefing, transcription_text)

    async with httpx.AsyncClient(timeout=30.0) as client:
        campos_res = await client.get(
            "https://api.pipedrive.com/v1/personFields",
            params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 200},
        )
        definicoes = {f["key"]: f for f in (campos_res.json().get("data") or [])}

        pessoa: Dict[str, Any] = {}
        if person_id:
            p_res = await client.get(
                f"https://api.pipedrive.com/v1/persons/{person_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN},
            )
            pessoa = p_res.json().get("data") or {}

    sugestoes: List[Dict[str, Any]] = []
    for origem, chave_mapa, rotulo, tipo in CAMPOS_SUGERIVEIS:
        bruto = dados.get(origem)
        if isinstance(bruto, list):
            bruto = ", ".join(bruto)
        bruto = str(bruto or "").strip()
        if not bruto:
            continue

        key = PIPEDRIVE_PERSON_CUSTOM_FIELDS.get(chave_mapa)
        definicao = definicoes.get(key) or {}
        atual_bruto = pessoa.get(key)

        item: Dict[str, Any] = {
            "campo": origem,
            "rotulo": rotulo,
            "tipo": tipo,
            "chave_pipedrive": key,
            "valor_transcricao": bruto,
            "aplicavel": True,
            "motivo_nao_aplicavel": None,
        }

        if tipo == "enum":
            opcoes = definicao.get("options") or []
            id_sugerido = normalizar_para_opcao(bruto, opcoes)
            rotulo_atual = next(
                (o["label"] for o in opcoes if str(o.get("id")) == str(atual_bruto)), None
            )
            item["valor_atual"] = rotulo_atual
            item["valor_a_gravar"] = id_sugerido
            item["valor_exibido"] = next(
                (o["label"] for o in opcoes if o.get("id") == id_sugerido), None
            )
            if id_sugerido is None:
                item["aplicavel"] = False
                item["motivo_nao_aplicavel"] = "não corresponde a nenhuma opção do campo"

        elif tipo == "data":
            iso, recusa = extrair_data_iso(bruto)
            item["valor_atual"] = atual_bruto or None
            item["valor_a_gravar"] = iso
            item["valor_exibido"] = iso or bruto
            if not iso:
                item["aplicavel"] = False
                item["motivo_nao_aplicavel"] = recusa

        elif tipo == "monetario":
            numero = extrair_valor_monetario(bruto)
            item["valor_atual"] = atual_bruto or None
            item["valor_a_gravar"] = numero
            item["valor_exibido"] = numero
            if numero is None:
                item["aplicavel"] = False
                item["motivo_nao_aplicavel"] = "não foi possível extrair um número"

        else:
            item["valor_atual"] = atual_bruto or None
            item["valor_a_gravar"] = bruto
            item["valor_exibido"] = bruto

        # "igual" e "substituir" são situações diferentes para quem revisa:
        # a primeira não pede ação, a segunda avisa que há perda de informação.
        atual_txt = str(item.get("valor_atual") or "").strip()
        item["ja_igual"] = bool(atual_txt) and _sem_flexao(atual_txt) == _sem_flexao(
            str(item.get("valor_exibido") or "")
        )
        item["acao"] = "igual" if item["ja_igual"] else ("substituir" if atual_txt else "preencher")
        sugestoes.append(item)

    # Sem campo correspondente no cadastro — só cabem numa nota.
    extras = {
        "patrimonio_bens": dados.get("patrimonio_bens_itens") or dados.get("patrimonio_bens"),
        "seguros_existentes": dados.get("seguros_existentes_itens") or dados.get("seguros_existentes"),
        "demonstrou_interesse": dados.get("demonstrou_interesse"),
    }

    return {
        "person_id": person_id,
        "person_name": pessoa.get("name"),
        "person_url": f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None,
        "nome_transcricao": dados.get("nome"),
        "sugestoes": sugestoes,
        "aplicaveis": sum(1 for s in sugestoes if s["aplicavel"] and not s["ja_igual"]),
        "extras_para_nota": {k: v for k, v in extras.items() if v},
    }


def parse_xp_ficha_cadastral(doc_bytes_or_path) -> Dict[str, Any]:
    """
    Parser avançado para extrair dados estruturados de Fichas Cadastrais (ex: XP Investimentos)
    usando análise espacial por coordenadas e blocos de texto do PyMuPDF.
    """
    if isinstance(doc_bytes_or_path, bytes):
        doc = pymupdf.open(stream=doc_bytes_or_path, filetype="pdf")
    else:
        doc = pymupdf.open(doc_bytes_or_path)
        
    page1 = doc[0]
    blocks = page1.get_text("blocks")
    
    extracted = {
        "nome_completo": None,
        "cpf": None,
        "nome_mae": None,
        "nome_pai": None,
        "data_nascimento": None,
        "data_nascimento_iso": None,
        "nacionalidade": None,
        "naturalidade": None,
        "sexo": None,
        "estado_civil": None,
        "estado_civil_id": None,
        "regime_casamento": None,
        "regime_casamento_id": None,
        "nome_conjuge": None,
        "cpf_conjuge": None,
        "documento_identidade": None,
        "email": None,
        "telefone": None,
        "celular": None,
        "logradouro": None,
        "bairro": None,
        "cidade": None,
        "uf": None,
        "cep": None,
        "endereco_completo": None,
        "profissao": None,
        "ocupacao": None,
        "empresa_nome": None,
        "empresa_cnpj": None,
        "renda_mensal": None,
        "renda_mensal_fmt": None,
        "codigo_xp": None,
        "dados_bancarios": None
    }
    
    for b in blocks:
        txt = b[4].strip()
        if not txt:
            continue
        y = b[1]
        x = b[0]
        
        # Codigo XP
        if 80 <= y <= 115 and x > 150:
            xp_m = re.search(r"(\d{7,8}-\d|\d{7,9})", txt)
            if xp_m:
                extracted["codigo_xp"] = xp_m.group(1)
                
        # Nome e CPF
        if 140 <= y <= 165 and x < 100:
            lines = txt.split("\n")
            for l in lines:
                cpf_m = re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})", l)
                if cpf_m:
                    extracted["cpf"] = cpf_m.group(1)
                    nome = l.replace(cpf_m.group(1), "").strip()
                    if nome:
                        extracted["nome_completo"] = nome
                elif not extracted["nome_completo"] and len(l) > 5 and not any(k in l.lower() for k in ["ficha", "dados", "nome"]):
                    extracted["nome_completo"] = l.strip()
                    
        # Mae / Pai
        if 170 <= y <= 195:
            if not any(k in txt.lower() for k in ["nome", "pai", "mae", "mãe"]):
                extracted["nome_mae"] = txt.replace("\n", " ").strip()
                
        # Nasc, Nacionalidade, Naturalidade
        if 195 <= y <= 218:
            nasc_m = re.search(r"(\d{2})/(\d{2})/(\d{4})", txt)
            if nasc_m:
                extracted["data_nascimento"] = f"{nasc_m.group(1)}/{nasc_m.group(2)}/{nasc_m.group(3)}"
                extracted["data_nascimento_iso"] = f"{nasc_m.group(3)}-{nasc_m.group(2)}-{nasc_m.group(1)}"
            if "brasileir" in txt.lower():
                extracted["nacionalidade"] = "Brasileiro(a)"
            cleaned_nat = re.sub(r"\d{2}/\d{2}/\d{4}|brasileiro\(a\)|brasileiro|nato", "", txt, flags=re.I).strip()
            if cleaned_nat:
                extracted["naturalidade"] = cleaned_nat
                
        # Estado Civil & Conjuge
        if 215 <= y <= 245:
            if "casado" in txt.lower():
                extracted["estado_civil"] = "Casado(a)"
                extracted["estado_civil_id"] = 53
            elif "solteiro" in txt.lower():
                extracted["estado_civil"] = "Solteiro(a)"
                extracted["estado_civil_id"] = 52
            elif "uniao estavel" in txt.lower() or "união" in txt.lower():
                extracted["estado_civil"] = "União Estável"
                extracted["estado_civil_id"] = 54
            elif "divorciado" in txt.lower():
                extracted["estado_civil"] = "Divorciado(a)"
                
            if x > 300 and not any(k in txt.lower() for k in ["sexo", "estado", "nome", "cpf", "000."]):
                extracted["nome_conjuge"] = txt.replace("\n", " ").strip()
            cpf_c_m = re.search(r"(\d{3}\.\d{3}\.\d{3}-\d{2})", txt)
            if cpf_c_m and cpf_c_m.group(1) != extracted.get("cpf"):
                extracted["cpf_conjuge"] = cpf_c_m.group(1)
                
        # Documento RG/CNH
        if 250 <= y <= 272 and x < 100:
            extracted["documento_identidade"] = txt.replace("\n", " ").strip()
            
        # Telefones e E-mail
        if 275 <= y <= 305 and x < 100:
            emails = re.findall(r"[\w\.-]+@[\w\.-]+", txt)
            if emails:
                extracted["email"] = emails[0].lower()
            phones = re.findall(r"\(\d{2}\)\s*\d{8,9}", txt)
            if phones:
                extracted["telefone"] = phones[0]
                extracted["celular"] = phones[-1]
                
        # Endereco
        if 335 <= y <= 360 and x < 100:
            extracted["logradouro"] = txt.replace("\n", " ").strip()
        if 360 <= y <= 385 and x < 100:
            cep_m = re.search(r"(\d{5}-\d{3})", txt)
            if cep_m:
                extracted["cep"] = cep_m.group(1)
            parts = txt.replace(extracted.get("cep") or "", "").strip().split()
            if len(parts) >= 3:
                extracted["bairro"] = " ".join(parts[:-2])
                extracted["cidade"] = parts[-2]
                extracted["uf"] = parts[-1]
                
        # Profissao
        if 500 <= y <= 525 and x < 100:
            p_words = [w.strip() for w in txt.split() if len(w.strip()) > 2]
            if p_words:
                extracted["profissao"] = p_words[0]
                extracted["ocupacao"] = p_words[-1]
                
        # Entidade / CNPJ
        if 525 <= y <= 555:
            cnpj_m = re.search(r"(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})", txt)
            if cnpj_m:
                extracted["empresa_cnpj"] = cnpj_m.group(1)
            elif x < 100 and not any(k in txt.lower() for k in ["entidade", "dados"]):
                extracted["empresa_nome"] = txt.replace("\n", " ").strip()
                
        # Renda
        if 570 <= y <= 590 and x > 400:
            val_clean = txt.replace("R$", "").replace(".", "").replace(",", ".").strip()
            try:
                val_num = float(val_clean)
                extracted["renda_mensal"] = val_num
                extracted["renda_mensal_fmt"] = f"R$ {val_num:,.2f}"
            except Exception:
                extracted["renda_mensal_fmt"] = txt.strip()
                
        # Dados bancarios
        if 710 <= y <= 745 and x > 50:
            if not extracted["dados_bancarios"]:
                extracted["dados_bancarios"] = txt.replace("\n", " ").strip()

    # Formatar endereco completo
    end_parts = [extracted["logradouro"], extracted["bairro"], f"{extracted['cidade']} - {extracted['uf']}" if extracted["cidade"] and extracted["uf"] else extracted["cidade"], f"CEP: {extracted['cep']}" if extracted["cep"] else None]
    extracted["endereco_completo"] = ", ".join([p for p in end_parts if p])
    
    return extracted


async def find_pipedrive_person_match(cpf: Optional[str] = None, email: Optional[str] = None, name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Busca pessoa no Pipedrive por CPF, Email ou Nome"""
    if not PIPEDRIVE_API_TOKEN:
        return None
        
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Busca por Nome / Termo
        search_terms = []
        if cpf:
            search_terms.append(cpf)
        if email:
            search_terms.append(email)
        if name:
            search_terms.append(name)
            
        for term in search_terms:
            try:
                res = await client.get(
                    f"{PIPEDRIVE_BASE_URL}/persons/search",
                    params={"api_token": PIPEDRIVE_API_TOKEN, "term": term, "limit": 5}
                )
                if res.status_code == 200:
                    items = res.json().get("data", {}).get("items", [])
                    if items:
                        first_item = items[0].get("item", {})
                        person_id = first_item.get("id")
                        if person_id:
                            # Busca dados completos da pessoa
                            detail_res = await client.get(
                                f"{PIPEDRIVE_BASE_URL}/persons/{person_id}",
                                params={"api_token": PIPEDRIVE_API_TOKEN}
                            )
                            if detail_res.status_code == 200:
                                p_data = detail_res.json().get("data", {})
                                
                                # Extrai valores dos campos customizados
                                return {
                                    "id": str(p_data.get("id")),
                                    "name": p_data.get("name"),
                                    "email": p_data.get("primary_email") or (p_data.get("email", [{}])[0].get("value") if p_data.get("email") else None),
                                    "phone": (p_data.get("phone", [{}])[0].get("value") if p_data.get("phone") else None),
                                    "cpf": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["cpf"]),
                                    "data_nascimento": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["data_nascimento"]),
                                    "profissao": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["profissao"]),
                                    "estado_civil_id": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["estado_civil"]),
                                    "nome_conjuge": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["nome_conjuge"]),
                                    "renda": p_data.get(PIPEDRIVE_PERSON_CUSTOM_FIELDS["renda"]),
                                    "person_url": f"https://investimentosblue.pipedrive.com/person/{person_id}",
                                    "raw_data": p_data
                                }
            except Exception as e:
                logger.warning(f"Erro ao buscar pessoa no Pipedrive para termo '{term}': {e}")
                
    return None


class SyncPersonFichaRequest(BaseModel):
    person_id: Optional[str] = None
    create_new: bool = False
    nome_completo: str
    cpf: Optional[str] = None
    data_nascimento_iso: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    celular: Optional[str] = None
    profissao: Optional[str] = None
    estado_civil_id: Optional[int] = None
    regime_casamento_id: Optional[int] = None
    nome_conjuge: Optional[str] = None
    renda_mensal: Optional[float] = None
    endereco_completo: Optional[str] = None
    empresa_nome: Optional[str] = None
    empresa_cnpj: Optional[str] = None
    codigo_xp: Optional[str] = None
    dados_bancarios: Optional[str] = None
    create_history_activity: bool = True
    custom_field_mapping: Optional[Dict[str, Optional[str]]] = None


@app.get("/api/pipedrive/person-fields")
async def get_pipedrive_person_fields_endpoint(user: dict = Depends(require_admin)):
    """Retorna todos os campos (padrões e personalizados) de Pessoa do Pipedrive"""
    if not PIPEDRIVE_API_TOKEN:
        raise HTTPException(status_code=500, detail="PIPEDRIVE_API_TOKEN não configurado")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                "https://api.pipedrive.com/v1/personFields",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code != 200:
                raise HTTPException(status_code=res.status_code, detail="Erro ao buscar campos no Pipedrive")
            
            raw_fields = res.json().get("data", [])
            fields = []
            for f in raw_fields:
                key = f.get("key")
                # Ignora campos de sistema não editáveis
                if key in ["id", "add_time", "update_time", "open_deals_count", "won_deals_count", "lost_deals_count", "closed_deals_count", "activities_count", "done_activities_count", "undone_activities_count", "email_messages_count", "picture_id", "last_incoming_mail_time", "last_outgoing_mail_time"]:
                    continue
                fields.append({
                    "key": key,
                    "name": f.get("name"),
                    "field_type": f.get("field_type"),
                    "is_custom": bool(f.get("is_subfield", False) or f.get("edit_flag", True)),
                    "options": f.get("options")
                })
            return {"status": "success", "fields": fields}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao buscar campos de pessoa do Pipedrive: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pdf/parse-ficha-cadastral")
async def parse_ficha_cadastral_endpoint(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin)
):
    """
    Recebe um arquivo PDF de Ficha Cadastral (ex: XP), extrai todos os dados cadastrais
    e verifica se já existe uma pessoa correspondente no Pipedrive CRM.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Por favor envie um arquivo em formato PDF (.pdf)")
        
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Arquivo PDF vazio")
            
        # 1. Extração estruturada dos dados da ficha
        extracted = parse_xp_ficha_cadastral(content)
        
        # 2. Busca match no Pipedrive
        matched_person = await find_pipedrive_person_match(
            cpf=extracted.get("cpf"),
            email=extracted.get("email"),
            name=extracted.get("nome_completo")
        )
        
        return {
            "status": "success",
            "file_name": file.filename,
            "file_size": len(content),
            "extracted_data": extracted,
            "matched_person": matched_person,
            "has_match": bool(matched_person)
        }
    except Exception as e:
        logger.error(f"Erro ao processar PDF de Ficha Cadastral: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {str(e)}")


@app.post("/api/pipedrive/sync-person-ficha")
async def sync_person_ficha_endpoint(
    req: SyncPersonFichaRequest,
    user: dict = Depends(require_admin)
):
    """
    Atualiza uma Pessoa existente no Pipedrive (ou cadastra uma nova)
    com os dados extraídos da Ficha Cadastral (CPF, Nascimento, Profissão, Renda, etc.).
    """
    if not PIPEDRIVE_API_TOKEN:
        raise HTTPException(status_code=500, detail="PIPEDRIVE_API_TOKEN não configurado")
        
    payload: Dict[str, Any] = {
        "name": req.nome_completo
    }
    
    if req.email:
        payload["email"] = [{"value": req.email, "primary": True, "label": "work"}]
        
    phone_val = req.celular or req.telefone
    if phone_val:
        payload["phone"] = [{"value": phone_val, "primary": True, "label": "mobile"}]
        
    mapping = req.custom_field_mapping or {}
    
    # Mapeamento dinâmico ou fallback padrão
    cpf_key = mapping.get("cpf", PIPEDRIVE_PERSON_CUSTOM_FIELDS["cpf"])
    nascimento_key = mapping.get("data_nascimento", PIPEDRIVE_PERSON_CUSTOM_FIELDS["data_nascimento"])
    profissao_key = mapping.get("profissao", PIPEDRIVE_PERSON_CUSTOM_FIELDS["profissao"])
    estado_civil_key = mapping.get("estado_civil", PIPEDRIVE_PERSON_CUSTOM_FIELDS["estado_civil"])
    regime_casamento_key = mapping.get("regime_casamento", "011f47eeeffdcd9977e52c2dd706e969a7d76abe")
    nome_conjuge_key = mapping.get("nome_conjuge", PIPEDRIVE_PERSON_CUSTOM_FIELDS["nome_conjuge"])
    renda_key = mapping.get("renda", PIPEDRIVE_PERSON_CUSTOM_FIELDS["renda"])

    if req.cpf and cpf_key and cpf_key != "none":
        payload[cpf_key] = req.cpf
    if req.data_nascimento_iso and nascimento_key and nascimento_key != "none":
        payload[nascimento_key] = req.data_nascimento_iso
    if req.profissao and profissao_key and profissao_key != "none":
        payload[profissao_key] = req.profissao
    if req.estado_civil_id and estado_civil_key and estado_civil_key != "none":
        payload[estado_civil_key] = req.estado_civil_id
    if req.regime_casamento_id and regime_casamento_key and regime_casamento_key != "none":
        payload[regime_casamento_key] = req.regime_casamento_id
    if req.nome_conjuge and nome_conjuge_key and nome_conjuge_key != "none":
        payload[nome_conjuge_key] = req.nome_conjuge
    if req.renda_mensal is not None and renda_key and renda_key != "none":
        payload[renda_key] = float(req.renda_mensal)
        
    # Mapeamentos adicionais configurados pelo usuário
    extra_field_mappings = {
        "endereco_completo": req.endereco_completo,
        "empresa_nome": req.empresa_nome,
        "codigo_xp": req.codigo_xp,
    }
    for field_name, field_val in extra_field_mappings.items():
        target_k = mapping.get(field_name)
        if target_k and target_k != "none" and field_val:
            payload[target_k] = field_val
        
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            target_id = req.person_id
            
            # 1. Atualiza ou Cria Pessoa no Pipedrive
            if target_id and not req.create_new:
                res = await client.put(
                    f"{PIPEDRIVE_BASE_URL}/persons/{target_id}",
                    params={"api_token": PIPEDRIVE_API_TOKEN},
                    json=payload
                )
                action_label = "atualizada"
            else:
                res = await client.post(
                    f"{PIPEDRIVE_BASE_URL}/persons",
                    params={"api_token": PIPEDRIVE_API_TOKEN},
                    json=payload
                )
                action_label = "criada"
                
            if res.status_code not in [200, 201]:
                logger.error(f"Erro ao sincronizar pessoa no Pipedrive: {res.status_code} - {res.text}")
                raise HTTPException(status_code=res.status_code, detail=f"Erro Pipedrive: {res.text}")
                
            person_data = res.json().get("data", {})
            saved_person_id = str(person_data.get("id"))
            person_url = f"https://investimentosblue.pipedrive.com/person/{saved_person_id}"
            
            # 2. Se solicitado, cria uma Atividade no Histórico registrando a importação da Ficha
            activity_id = None
            if req.create_history_activity:
                hist_html = (
                    f"<h3>📑 Ficha Cadastral Importada via PDF</h3>"
                    f"<p><strong>Cliente:</strong> {req.nome_completo}</p>"
                    f"<p><strong>CPF:</strong> {req.cpf or 'N/A'}</p>"
                    f"<p><strong>Data de Nascimento:</strong> {req.data_nascimento_iso or 'N/A'}</p>"
                    f"<p><strong>Profissão:</strong> {req.profissao or 'N/A'}</p>"
                    f"<p><strong>Cônjuge:</strong> {req.nome_conjuge or 'N/A'}</p>"
                    f"<p><strong>Renda Mensal:</strong> {f'R$ {req.renda_mensal:,.2f}' if req.renda_mensal else 'N/A'}</p>"
                    f"<p><strong>Endereço:</strong> {req.endereco_completo or 'N/A'}</p>"
                    f"<p><strong>Código XP:</strong> {req.codigo_xp or 'N/A'}</p>"
                    f"<hr/>"
                    f"<p><small>⚡ Dados extraídos e validados automaticamente pelo Sistema Robson Tavernard</small></p>"
                )
                act_res = await create_pipedrive_activity(
                    subject="Ficha Cadastral XP Importada",
                    activity_type="tactiq",
                    done=True,
                    person_id=saved_person_id,
                    note_content=hist_html
                )
                if act_res:
                    activity_id = str(act_res.get("id"))
                    
            # 3. Log de Auditoria
            log_audit_event(
                action="PERSON_ENRICHED_FROM_FICHA",
                resource_type="person",
                resource_id=saved_person_id,
                user_id=user.get("id", user.get("sub")),
                details={
                    "cliente_nome": req.nome_completo,
                    "cpf": req.cpf,
                    "person_id": saved_person_id,
                    "person_url": person_url,
                    "profissao": req.profissao,
                    "renda": req.renda_mensal,
                    "activity_id": activity_id,
                    "action_type": action_label,
                    "summary": f"Ficha cadastral de '{req.nome_completo}' importada com sucesso: dados {action_label}s no Pipedrive (Pessoa #{saved_person_id})."
                }
            )
            
            return {
                "status": "success",
                "message": f"Dados do cliente {action_label}s com sucesso no Pipedrive!",
                "person_id": saved_person_id,
                "person_url": person_url,
                "action_type": action_label,
                "activity_id": activity_id,
                "person_data": person_data
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao sincronizar ficha no Pipedrive: {e}")
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
