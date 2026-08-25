"""
FastAPI Backend: Automação Tactiq → Google Drive → Pipedrive
Autenticação, Webhooks, Integração CRM
"""

import os
import uuid
import json
import base64
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
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
    org_id: Optional[str] = None,
    done: bool = True
) -> Optional[Dict]:
    """
    Cria Activity no Pipedrive com suporte a tipo, notas ricas e vinculação de participantes.
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
        
    if deal_id:
        try:
            payload["deal_id"] = int(deal_id)
        except (ValueError, TypeError):
            payload["deal_id"] = deal_id
            
    if person_id:
        try:
            payload["participants"] = [{"person_id": int(person_id), "primary": True}]
        except (ValueError, TypeError):
            pass
            
    if org_id:
        try:
            payload["org_id"] = int(org_id)
        except (ValueError, TypeError):
            payload["org_id"] = org_id
            
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{PIPEDRIVE_BASE_URL}/activities",
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
    Atualiza Activity no Pipedrive usando API v2.
    """
    async with httpx.AsyncClient() as client:
        response = await client.patch(
            f"{PIPEDRIVE_BASE_URL}/activities/{activity_id}",
            params={"api_token": PIPEDRIVE_API_TOKEN},
            json=updates
        )
        
        if response.status_code != 200:
            logger.error(f"Erro ao atualizar Activity: {response.text}")
            return None
        
        data = response.json()
        return data.get("data") if data.get("success") else None

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

def parse_tactiq_doc(text: str, file_name: str = "") -> dict:
    """
    Parser para extrair dados estruturados dos Google Docs gerados pelo Tactiq
    Suporta formato legado e novo formato com Resumo Rápido, Decisões e Pontos de Atenção.
    """
    now = datetime.utcnow()
    data = {
        "resumo_rapido": "",
        "principais_topicos": [],
        "dados_cliente": {
            "nome": "",
            "idade": "",
            "estado_civil": "",
            "herdeiros_filhos": "",
            "patrimonio_bens": "",
            "seguros_existentes": "",
            "demonstrou_interesse": "",
            "email": ""
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
    resumo_match = re.search(r"RESUMO R[AÁ]PIDO\s*\n(.*?)(?=(PRINCIPAIS T[ÓO]PICOS|DADOS DO CLIENTE|DECIS[OÕ]ES|====|$))", text, re.IGNORECASE | re.DOTALL)
    if resumo_match:
        data["resumo_rapido"] = resumo_match.group(1).strip()
        
    # 4. Dados do Cliente
    nome_match = re.search(r"\*\s*Nome:\s*(.*)", text, re.IGNORECASE)
    if nome_match and "nao informado" not in nome_match.group(1).lower() and "não informado" not in nome_match.group(1).lower():
        data["dados_cliente"]["nome"] = nome_match.group(1).strip()
    elif data["participantes"]:
        for p in data["participantes"]:
            if "robson" not in p.lower() and "alexandre" not in p.lower():
                data["dados_cliente"]["nome"] = p
                break

    idade_match = re.search(r"\*\s*Idade:\s*(.*)", text, re.IGNORECASE)
    if idade_match:
        data["dados_cliente"]["idade"] = idade_match.group(1).strip()

    ec_match = re.search(r"\*\s*Estado civil:\s*(.*)", text, re.IGNORECASE)
    if ec_match:
        data["dados_cliente"]["estado_civil"] = ec_match.group(1).strip()

    herdeiros_match = re.search(r"\*\s*Herdeiros[^\:]*:\s*(.*)", text, re.IGNORECASE)
    if herdeiros_match:
        data["dados_cliente"]["herdeiros_filhos"] = herdeiros_match.group(1).strip()

    patrimonio_match = re.search(r"\*\s*Patrim[oô]nio[^\:]*:\s*(.*)", text, re.IGNORECASE)
    if patrimonio_match:
        data["dados_cliente"]["patrimonio_bens"] = patrimonio_match.group(1).strip()

    seguros_match = re.search(r"\*\s*Seguros[^\:]*:\s*(.*)", text, re.IGNORECASE)
    if seguros_match:
        data["dados_cliente"]["seguros_existentes"] = seguros_match.group(1).strip()

    interesse_match = re.search(r"\*\s*Demonstrou interesse:\s*(.*)", text, re.IGNORECASE)
    if interesse_match:
        data["dados_cliente"]["demonstrou_interesse"] = interesse_match.group(1).strip()
        
    # 5. Principais Tópicos
    topicos_section = re.search(r"PRINCIPAIS T[ÓO]PICOS\s*\n(.*?)(?=(DADOS DO CLIENTE|DECIS[OÕ]ES|PONTOS DE ATEN[CÇ][AÃ]O|Link da reuni[aã]o|====|$))", text, re.IGNORECASE | re.DOTALL)
    if topicos_section:
        raw_topicos = topicos_section.group(1).strip().split("\n")
        topicos = []
        for line in raw_topicos:
            line_clean = re.sub(r"^[\*\-\•\d\.]+\s*", "", line).strip()
            if line_clean and len(line_clean) > 3:
                topicos.append(line_clean)
        data["principais_topicos"] = topicos

    # 6. Decisões e Próximos Passos
    decisoes_section = re.search(r"DECIS[OÕ]ES E PR[ÓO]XIMOS PASSOS\s*\n(.*?)(?=(PONTOS DE ATEN[CÇ][AÃ]O|DADOS DO CLIENTE|====|$))", text, re.IGNORECASE | re.DOTALL)
    if decisoes_section:
        raw_decisoes = decisoes_section.group(1).strip().split("\n")
        decisoes = []
        for line in raw_decisoes:
            line_clean = re.sub(r"^[\*\-\•\d\.]+\s*", "", line).strip()
            if line_clean and len(line_clean) > 3:
                decisoes.append(line_clean)
        data["decisoes_proximos_passos"] = decisoes

    # 7. Pontos de Atenção
    atencao_section = re.search(r"PONTOS DE ATEN[CÇ][AÃ]O[^\n]*\s*\n(.*?)(?=(DECIS[OÕ]ES|====|$))", text, re.IGNORECASE | re.DOTALL)
    if atencao_section:
        raw_atencao = atencao_section.group(1).strip().split("\n")
        pontos = []
        for line in raw_atencao:
            line_clean = re.sub(r"^[\*\-\•\d\.]+\s*", "", line).strip()
            if line_clean and len(line_clean) > 3:
                pontos.append(line_clean)
        data["pontos_atencao"] = pontos

    # 8. Próxima Ação Sugerida
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
    """Gera o HTML rico e formatado para a descrição da atividade / nota no Pipedrive"""
    resumo_html = f"<p><strong>📝 Resumo Executivo:</strong><br/>{briefing_json.get('resumo_rapido')}</p>" if briefing_json.get("resumo_rapido") else ""
    
    tactiq_url = briefing_json.get("tactiq_link")
    tactiq_link_html = f"<p><strong>🔗 Gravação & Transcrição no Tactiq:</strong> <a href='{tactiq_url}'>{tactiq_url}</a></p>" if tactiq_url else ""
    
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
        f"<h3>📋 Briefing da Reunião (Origem: Tactiq / Google Drive)</h3>"
        f"<p><strong>Reunião:</strong> {meeting_title}</p>"
        f"<p><strong>Cliente:</strong> {client_name}</p>"
        f"{tactiq_link_html}"
        f"{resumo_html}"
        f"{dados_cli_html}"
        f"<h4>📌 Principais Tópicos Abordados:</h4>"
        f"<ul>{topicos_html or '<li>Discussão patrimonial e sucessória.</li>'}</ul>"
        f"{decisoes_section}"
        f"{atencao_section}"
        f"<h4>🎯 Próxima Ação Sugerida:</h4>"
        f"<p>{briefing_json.get('proxima_acao', {}).get('descricao', 'Dar continuidade aos alinhamentos')}</p>"
        f"<hr/>"
        f"<p><em>⚡ Sincronizado automaticamente pelo Sistema Robson Tavernard (Investimentos Blue)</em></p>"
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
            
            # Verifica se já foi processado com sucesso
            existing = supabase.table("transcriptions").select("id, processing_status, briefing_json").eq(
                "google_doc_id", google_doc_id
            ).execute()
            
            existing_record = existing.data[0] if existing.data else None
            if existing_record and existing_record.get("processing_status") == "completed" and existing_record.get("briefing_json"):
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
                
                person_id = None
                deal_id = None
                activity_id = None
                matching_confidence = 0.0
                
                if cliente_nome and len(cliente_nome) > 2:
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
                            activity_note_html = generate_pipedrive_briefing_html(
                                briefing_json=briefing_json,
                                meeting_title=meeting_title,
                                client_name=cliente_nome
                            )
                            
                            act_res = await create_pipedrive_activity(
                                subject="Transcrição Tactiq",
                                activity_type="tactiq",
                                due_date=meeting_date_str,
                                done=True,
                                deal_id=deal_id,
                                person_id=person_id,
                                note_content=activity_note_html
                            )
                            if act_res:
                                activity_id = str(act_res.get("id"))
                                briefing_json["pipedrive"]["activity_id"] = activity_id
                                briefing_json["pipedrive"]["activity_subject"] = "Transcrição Tactiq"
                                briefing_json["pipedrive"]["activity_type"] = "tactiq"
                                briefing_json["pipedrive"]["activity_date"] = meeting_date_str
                                logger.info(f"Atividade Pipedrive criada com sucesso: #{activity_id} para {cliente_nome}")
                
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
                    summary_text = f"Arquivo '{meeting_title}' recebido do Google Drive e vinculado com sucesso ao cliente '{cliente_nome or 'Identificado'}'" + (f" e Deal #{deal_id}" if deal_id else "") + " no Pipedrive com tarefa agendada."
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
                f"{PIPEDRIVE_BASE_URL}/activities/{activity_id}",
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

async def delete_pipedrive_note(note_id: str) -> bool:
    """Exclui uma nota legada existente no Pipedrive (para fins de limpeza)"""
    if not note_id or not PIPEDRIVE_API_TOKEN:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.delete(
                f"{PIPEDRIVE_BASE_URL}/notes/{note_id}",
                params={"api_token": PIPEDRIVE_API_TOKEN}
            )
            if res.status_code in [200, 204]:
                logger.info(f"Nota legada #{note_id} excluída com sucesso no Pipedrive.")
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

@app.get("/api/pipedrive/assessores")
async def list_pipedrive_assessores(user: dict = Depends(require_admin)):
    """Lista todas as Organizações (Assessores) cadastradas no Pipedrive"""
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://api.pipedrive.com/v1/organizations",
            params={"api_token": PIPEDRIVE_API_TOKEN, "limit": 100}
        )
        if res.status_code != 200:
            return {"assessores": []}
        data = res.json().get("data") or []
        assessores = [{"id": o.get("id"), "name": o.get("name")} for o in data if o.get("name")]
        return {"assessores": sorted(assessores, key=lambda x: x["name"])}

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
            
            # 3. Paginação sobre as atividades no Pipedrive (até 500 registros)
            all_raw_activities = []
            start_offset = 0
            
            for _ in range(5):
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
                person_name = a.get("person_name")
                raw_act_type = a.get("type") or "meeting"
                
                # Filtro: Apenas com cliente e assessor (organização) definidos
                if not person_name or not org_name or org_name == "Sem Assessor":
                    continue
                    
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

async def fetch_comercial_pipeline_data() -> Dict[str, Any]:
    """Busca dados consolidados do Funil Comercial do Pipedrive"""
    async with httpx.AsyncClient() as client:
        # 1. Busca stages do funil 1
        stages_res = await client.get(
            "https://api.pipedrive.com/v1/stages",
            params={"api_token": PIPEDRIVE_API_TOKEN}
        )
        all_stages = stages_res.json().get("data") or []
        comercial_stages = {s["id"]: s["name"] for s in all_stages if s.get("pipeline_id") == PIPELINE_COMERCIAL_ID}
        
        # 2. Busca deals abertos do funil 1
        deals_res = await client.get(
            "https://api.pipedrive.com/v1/deals",
            params={"api_token": PIPEDRIVE_API_TOKEN, "pipeline_id": PIPELINE_COMERCIAL_ID, "status": "open", "limit": 100}
        )
        raw_deals = deals_res.json().get("data") or []
        
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
        
    # 5. Atualiza briefing_json com Pipedrive URLs
    if "pipedrive" not in briefing_json:
        briefing_json["pipedrive"] = {}
    if "dados_cliente" not in briefing_json:
        briefing_json["dados_cliente"] = {}
        
    briefing_json["dados_cliente"]["nome"] = client_name
    briefing_json["pipedrive"]["person_id"] = str(person_id) if person_id else None
    briefing_json["pipedrive"]["deal_id"] = str(deal_id) if deal_id else None
    briefing_json["pipedrive"]["person_url"] = f"https://investimentosblue.pipedrive.com/person/{person_id}" if person_id else None
    briefing_json["pipedrive"]["deal_url"] = f"https://investimentosblue.pipedrive.com/deal/{deal_id}" if deal_id else None
    
    # 6. Cria Atividade no Pipedrive (Tipo 'tactiq', nome padrão 'Transcrição Tactiq')
    activity_id = None
    act_subject = req.activity_subject or "Transcrição Tactiq"
    act_type = req.activity_type or "tactiq"
    act_date = req.activity_date or t.get("meeting_date") or datetime.now().strftime("%Y-%m-%d")
    
    if req.create_activity:
        activity_note_html = generate_pipedrive_briefing_html(
            briefing_json=briefing_json,
            meeting_title=meeting_title,
            client_name=client_name
        )
        
        act_res = await create_pipedrive_activity(
            subject=act_subject,
            activity_type=act_type,
            due_date=act_date,
            due_time=req.activity_time,
            duration=req.duration,
            done=req.done,
            deal_id=deal_id,
            person_id=person_id,
            note_content=activity_note_html
        )
        if act_res:
            activity_id = str(act_res.get("id"))
            briefing_json["pipedrive"]["activity_id"] = activity_id
            briefing_json["pipedrive"]["activity_subject"] = act_subject
            briefing_json["pipedrive"]["activity_type"] = act_type
            briefing_json["pipedrive"]["activity_date"] = act_date
            briefing_json["pipedrive"]["note_id"] = None
            
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
            "pipedrive_activity_id": activity_id,
            "activity_subject": act_subject,
            "activity_type": act_type,
            "activity_date": act_date,
            "old_activity_id": old_activity_id,
            "old_activity_deleted": old_act_deleted,
            "deal_url": briefing_json["pipedrive"].get("deal_url"),
            "person_url": briefing_json["pipedrive"].get("person_url"),
            "proxima_acao": briefing_json.get("proxima_acao", {}).get("descricao"),
            "is_linked_to_crm": True,
            "assigned_manually": True,
            "summary": f"Transcrição '{meeting_title}' " + (f"reatribuída (atividade antiga #{old_activity_id} removida) para '{client_name}'" if old_activity_id else f"vinculada ao cliente '{client_name}'") + (f" (Deal #{deal_id})" if deal_id else "") + f" no Pipedrive por Robson com atividade '{act_subject}' (#{activity_id}) sincronizada."
        }
    )
    
    return {
        "status": "success",
        "message": f"Transcrição vinculada com sucesso ao Pipedrive com Atividade '{act_subject}'!" + (" (Atividade anterior substituída)" if old_act_deleted else ""),
        "person_id": person_id,
        "deal_id": deal_id,
        "activity_id": activity_id,
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
    """Desvincula uma transcrição do Pipedrive e exclui a atividade associada no CRM"""
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
        
    # 2. Apaga nota legada se existir
    note_deleted = False
    if delete_note and old_note_id:
        note_deleted = await delete_pipedrive_note(old_note_id)
        
    # 3. Limpa os vínculos no briefing_json
    briefing_json["pipedrive"] = {
        "person_id": None,
        "deal_id": None,
        "person_url": None,
        "deal_url": None,
        "activity_id": None,
        "note_id": None
    }
    
    # 4. Atualiza registro da Transcrição
    supabase.table("transcriptions").update({
        "processing_status": "pending",
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
            "activity_deleted_from_crm": act_deleted,
            "summary": f"Transcrição '{meeting_title}' desvinculada do Pipedrive por Robson" + (f" (atividade #{old_activity_id} removida do CRM)." if act_deleted else ".")
        }
    )
    
    return {
        "status": "success",
        "message": "Transcrição desvinculada com sucesso" + (" e atividade removida do Pipedrive." if act_deleted else "."),
        "activity_deleted": act_deleted,
        "note_deleted": note_deleted,
        "briefing_json": briefing_json
    }

@app.post("/api/transcriptions/{transcription_id}/toggle-ignore")
async def toggle_ignore_transcription(
    transcription_id: str,
    user: dict = Depends(require_admin)
):
    """Alterna o status de ignorada/reunião interna de uma transcrição para não gerar alertas ou pendências"""
    t_res = supabase.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Transcrição não encontrada")
        
    t = t_res.data[0]
    briefing_json = t.get("briefing_json") or {}
    meeting_title = t.get("meeting_title") or "Reunião"
    
    current_ignored = briefing_json.get("is_ignored", False)
    new_ignored = not current_ignored
    briefing_json["is_ignored"] = new_ignored
    
    supabase.table("transcriptions").update({
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
            "summary": f"Transcrição '{meeting_title}' {action_text} por Robson."
        }
    )
    
    return {
        "status": "success",
        "is_ignored": new_ignored,
        "message": f"Transcrição {action_text} com sucesso.",
        "briefing_json": briefing_json
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

# Agenda job para rodar diariamente às 7h
scheduler.add_job(generate_daily_alerts, "cron", hour=7, minute=0, timezone="America/Sao_Paulo")

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
                status_report["pipedrive"]["detail"] = f"{user_info.get('name')} ({user_info.get('company_name', 'Investimentos Blue')})"
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
        
        # Eventos do calendar-sync armazenam horários em UTC no Pipedrive
        is_calendar_sync = (ref_type == "calendar-sync")
        
        # Ocorrência direta / pai
        if due_date and due_time:
            add_busy_slot(due_date, due_time, dur, is_utc=is_calendar_sync)
            
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
        
        subject = f"[{booking.meeting_type_name}] {booking.client_name}"
        note_content = (
            f"🎯 Tipo: {booking.meeting_type_name}\n"
            f"👤 Cliente: {booking.client_name}\n"
            f"📱 Telefone: {booking.client_phone or 'Não informado'}\n"
            f"📧 E-mail: {booking.client_email or 'Não informado'}\n"
            f"💻 Plataforma: {booking.platform.upper()}\n"
            f"📝 Observações: {booking.notes or 'Nenhuma'}\n"
            f"⚡ Agendado via Sistema Robson Blue3"
        )
        
        # 4. Cria Activity no Pipedrive
        activity = await create_pipedrive_activity(
            person_id=person_id,
            deal_id=deal_id,
            subject=subject,
            due_date=booking.date,
            note=note_content,
            activity_type="meeting"
        )
        
        if not activity:
            raise HTTPException(status_code=500, detail="Erro ao criar atividade no Pipedrive")
            
        activity_id = str(activity.get("id"))
        
        # Atualiza horário e duração na Activity
        await update_pipedrive_activity(activity_id, {
            "due_time": booking.time,
            "duration": dur_str
        })
        
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
        "company": "Blue3 Investimentos",
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
    nome_conjuge: Optional[str] = None
    renda_mensal: Optional[float] = None
    endereco_completo: Optional[str] = None
    empresa_nome: Optional[str] = None
    empresa_cnpj: Optional[str] = None
    codigo_xp: Optional[str] = None
    dados_bancarios: Optional[str] = None
    create_history_activity: bool = True


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
        
    if req.cpf:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["cpf"]] = req.cpf
    if req.data_nascimento_iso:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["data_nascimento"]] = req.data_nascimento_iso
    if req.profissao:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["profissao"]] = req.profissao
    if req.estado_civil_id:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["estado_civil"]] = req.estado_civil_id
    if req.nome_conjuge:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["nome_conjuge"]] = req.nome_conjuge
    if req.renda_mensal is not None:
        payload[PIPEDRIVE_PERSON_CUSTOM_FIELDS["renda"]] = float(req.renda_mensal)
        
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
