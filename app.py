import os
import pickle
import io
from flask import Flask, render_template, jsonify, request
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
from werkzeug.utils import secure_filename # Para limpar nome do arquivo

app = Flask(__name__)

# --- CONFIGURAÇÕES ---
SCOPES = ['https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.pickle'

# COLOQUE O ID DA SUA PASTA AQUI
ROOT_FOLDER_ID = '1TaMOmbOx1KjpjG3IFFt8fcXAh7-IeG79' 

FOLDERS_STRUCTURE = [
    "01 - DOC CONTRATUAIS", "02 - SSMA (ASO)", "03 - ESPELHO DE PONTO",
    "04 - HOLERITE", "05 - DOC PESSOAIS", "06 - ATESTADO",
    "07 - TREINAMENTOS", "08 - FÉRIAS", "09 - PLANO DE SAÚDE"
]

def get_service():
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, 'rb') as token:
            creds = pickle.load(token)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                return None
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'wb') as token:
            pickle.dump(creds, token)
    return build('drive', 'v3', credentials=creds)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/funcionarios')
def listar_funcionarios():
    try:
        service = get_service()
        results = service.files().list(
            q=f"'{ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="files(id, name)",
            orderBy="name"
        ).execute()
        return jsonify(results.get('files', []))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/arquivos/<func_id>')
def listar_arquivos(func_id):
    try:
        service = get_service()
        # 1. Procura a pasta 05
        query = f"'{func_id}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '05' and trashed=false"
        pastas = service.files().list(q=query).execute().get('files', [])
        
        if not pastas:
            return jsonify({"error": "Pasta 05 não encontrada", "arquivos": []})
        
        doc_folder_id = pastas[0]['id']
        
        # 2. Lista arquivos
        arquivos = service.files().list(
            q=f"'{doc_folder_id}' in parents and trashed=false",
            fields="files(id, name, mimeType, webViewLink, thumbnailLink, iconLink)",
            orderBy="name"
        ).execute().get('files', [])
        
        return jsonify({"arquivos": arquivos, "folder_id": doc_folder_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/renomear', methods=['POST'])
def renomear():
    data = request.json
    try:
        service = get_service()
        service.files().update(fileId=data['id'], body={'name': data['new_name']}).execute()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/api/criar_funcionario', methods=['POST'])
def criar_funcionario():
    data = request.json
    nome = data['nome'].upper() # PASTA CONTINUA MAIÚSCULA
    try:
        service = get_service()
        meta_pai = {'name': nome, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [ROOT_FOLDER_ID]}
        pai = service.files().create(body=meta_pai, fields='id').execute()
        pai_id = pai.get('id')
        
        for folder in FOLDERS_STRUCTURE:
            meta = {'name': folder, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [pai_id]}
            service.files().create(body=meta).execute()
            
        return jsonify({"status": "success", "id": pai_id})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

# --- NOVA ROTA DE UPLOAD ---
@app.route('/api/upload', methods=['POST'])
def upload_arquivo():
    if 'file' not in request.files:
        return jsonify({"status": "error", "msg": "Nenhum arquivo enviado"}), 400
    
    file = request.files['file']
    folder_id = request.form.get('folder_id')
    
    if file.filename == '':
        return jsonify({"status": "error", "msg": "Nome vazio"}), 400

    try:
        service = get_service()
        filename = secure_filename(file.filename)
        
        # Salva temporariamente para enviar
        file.save(filename)
        
        file_metadata = {'name': file.filename, 'parents': [folder_id]}
        media = MediaFileUpload(filename, resumable=True)
        
        file_drive = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        
        # Remove arquivo temporário
        os.remove(filename)
        
        return jsonify({"status": "success", "file_id": file_drive.get('id')})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)