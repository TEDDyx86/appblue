import os
import json
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client

load_dotenv('backend/.env')
supabase = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_ROLE_KEY'))

def seed_audit_history():
    print("Limpando e recriando histórico de auditoria com dados precisos...")
    
    # Limpa logs antigos
    supabase.table('audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
    
    # Busca transcrições
    transcriptions = supabase.table('transcriptions').select('*').order('created_at', desc=False).execute().data or []
    print(f"Total de transcrições: {len(transcriptions)}")
    
    for t in transcriptions:
        b = t.get('briefing_json') or {}
        client_info = b.get('dados_cliente') or {}
        pipe_info = b.get('pipedrive') or {}
        action_info = b.get('proxima_acao') or {}
        
        raw_client_name = client_info.get('nome') or ''
        client_name = raw_client_name.strip() if raw_client_name.strip() and raw_client_name.strip().lower() != 'cliente' else None
        
        deal_id = pipe_info.get('deal_id')
        person_id = pipe_info.get('person_id')
        activity_id = pipe_info.get('activity_id')
        deal_url = pipe_info.get('deal_url')
        person_url = pipe_info.get('person_url')
        doc_title = t.get('meeting_title')
        
        is_linked = bool(deal_id or person_id)
        
        if is_linked:
            action = 'DRIVE_DOC_LINKED'
            summary = f"Arquivo '{doc_title}' recebido do Google Drive e vinculado ao cliente '{client_name or 'Identificado'}'"
            if deal_id:
                summary += f" e Deal #{deal_id}"
            summary += " no Pipedrive com tarefa agendada."
        else:
            action = 'DRIVE_DOC_UNLINKED'
            if client_name:
                summary = f"Arquivo '{doc_title}' recebido do Google Drive e analisado pela IA (mencionou '{client_name}'). Não foi vinculado ao Pipedrive pois o contato não foi localizado no CRM ou trata-se de reunião interna."
            else:
                summary = f"Arquivo '{doc_title}' recebido do Google Drive e processado pela IA. Reunião interna da equipe ou sem cliente externo identificado no Pipedrive."
        
        log_entry = {
            'action': action,
            'resource_type': 'transcription',
            'resource_id': t.get('id'),
            'details': {
                'doc_title': doc_title,
                'google_doc_id': t.get('google_doc_id'),
                'cliente_nome': client_name,
                'cliente_email': client_info.get('email'),
                'pipedrive_person_id': person_id,
                'pipedrive_deal_id': deal_id,
                'pipedrive_activity_id': activity_id,
                'deal_url': deal_url,
                'person_url': person_url,
                'proxima_acao': action_info.get('descricao') if is_linked else None,
                'tactiq_link': b.get('tactiq_link'),
                'is_linked_to_crm': is_linked,
                'summary': summary
            },
            'created_at': t.get('meeting_date') or t.get('created_at') or datetime.utcnow().isoformat()
        }
        
        supabase.table('audit_log').insert(log_entry).execute()
        status_label = "VINCULADO" if is_linked else "NÃO VINCULADO"
        print(f"  [{status_label}] {doc_title}")
        
    print("Povoamento concluído com sucesso!")

if __name__ == '__main__':
    seed_audit_history()
