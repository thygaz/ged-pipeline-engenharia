import os
import pickle
import io
from flask import Flask, render_template, jsonify, request, send_file
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from PyPDF2 import PdfReader, PdfWriter, PdfMerger # Adicionado PdfMerger
from werkzeug.utils import secure_filename

app = Flask(__name__)

# --- CONFIGURAÇÕES ---
SCOPES = ['https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.pickle'
ROOT_FOLDER_ID = '1BFfAp0hrSSQwjDCiJWcYiMO_BjNA_TCu'

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
        if not service: return jsonify({"error": "Erro de autenticação"}), 500
        
        results = service.files().list(
            q=f"'{ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            pageSize=1000,
            fields="files(id, name)",
            orderBy="name"
        ).execute()
        return jsonify(results.get('files', []))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/subpastas/<func_id>')
def listar_subpastas(func_id):
    try:
        service = get_service()
        results = service.files().list(
            q=f"'{func_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            pageSize=50,
            fields="files(id, name)",
            orderBy="name"
        ).execute()
        return jsonify(results.get('files', []))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/arquivos_pasta/<folder_id>')
def listar_arquivos_pasta(folder_id):
    try:
        service = get_service()
        results = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'",
            pageSize=1000,
            fields="files(id, name, mimeType, webViewLink, thumbnailLink, iconLink)",
            orderBy="name"
        ).execute()
        return jsonify({"arquivos": results.get('files', []), "folder_id": folder_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_arquivo():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'msg': 'Nenhum arquivo enviado'}), 400
    
    file = request.files['file']
    folder_id = request.form.get('folder_id')
    
    if file.filename == '':
        return jsonify({'status': 'error', 'msg': 'Nome de arquivo inválido'}), 400

    try:
        service = get_service()
        file_metadata = {'name': file.filename, 'parents': [folder_id]}
        
        fh = io.BytesIO()
        file.save(fh)
        fh.seek(0)
        
        media = MediaIoBaseUpload(fh, mimetype=file.content_type, resumable=True)
        file_drive = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
        return jsonify({'status': 'success', 'file_id': file_drive.get('id')})
    except Exception as e:
        return jsonify({'status': 'error', 'msg': str(e)}), 500

@app.route('/api/renomear', methods=['POST'])
def renomear():
    data = request.json
    try:
        service = get_service()
        service.files().update(fileId=data['id'], body={'name': data['new_name']}).execute()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/api/proxy_pdf/<file_id>')
def proxy_pdf(file_id):
    try:
        service = get_service()
        request_drive = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request_drive)
        done = False
        while done is False:
            status, done = downloader.next_chunk()
        fh.seek(0)
        return send_file(fh, mimetype='application/pdf')
    except Exception as e:
        return str(e), 500

@app.route('/api/separar_blocos', methods=['POST'])
def separar_blocos():
    data = request.json
    file_id = data.get('id')
    grupos = data.get('grupos')
    folder_id = data.get('folder_id')

    try:
        service = get_service()
        request_drive = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request_drive)
        done = False
        while done is False: status, done = downloader.next_chunk()
        fh.seek(0)
        
        pdf_reader = PdfReader(fh)
        total_pages = len(pdf_reader.pages)

        for grupo in grupos:
            nome_arquivo = grupo['nome']
            indices_paginas = grupo['paginas']
            if not indices_paginas: continue

            pdf_writer = PdfWriter()
            for p_index in indices_paginas:
                if 0 <= p_index < total_pages:
                    pdf_writer.add_page(pdf_reader.pages[p_index])

            output_stream = io.BytesIO()
            pdf_writer.write(output_stream)
            output_stream.seek(0)

            media_body = MediaIoBaseUpload(output_stream, mimetype='application/pdf', resumable=True)
            file_metadata = {'name': nome_arquivo, 'parents': [folder_id]}
            service.files().create(body=file_metadata, media_body=media_body).execute()

        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

# --- NOVA ROTA: JUNTAR ARQUIVOS ---
@app.route('/api/juntar_arquivos', methods=['POST'])
def juntar_arquivos():
    data = request.json
    ids_arquivos = data.get('ids')
    novo_nome = data.get('nome')
    folder_id = data.get('folder_id')

    if not ids_arquivos or len(ids_arquivos) < 2:
        return jsonify({"status": "error", "msg": "Selecione pelo menos 2 arquivos."}), 400

    try:
        service = get_service()
        merger = PdfMerger()
        streams = [] 

        # Baixa e junta na ordem
        for file_id in ids_arquivos:
            request_drive = service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request_drive)
            done = False
            while done is False: status, done = downloader.next_chunk()
            fh.seek(0)
            
            try:
                merger.append(fh)
                streams.append(fh)
            except:
                pass 

        output_stream = io.BytesIO()
        merger.write(output_stream)
        merger.close()
        for s in streams: s.close()
        output_stream.seek(0)

        media_body = MediaIoBaseUpload(output_stream, mimetype='application/pdf', resumable=True)
        file_metadata = {'name': novo_nome, 'parents': [folder_id]}
        service.files().create(body=file_metadata, media_body=media_body).execute()

        return jsonify({"status": "success"})

    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/api/criar_funcionario', methods=['POST'])
def criar_funcionario():
    data = request.json
    nome = data.get('nome').upper()
    try:
        service = get_service()
        meta_pai = {'name': nome, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [ROOT_FOLDER_ID]}
        pai = service.files().create(body=meta_pai, fields='id').execute()
        pai_id = pai.get('id')
        
        for folder in FOLDERS_STRUCTURE:
            meta = {'name': folder, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [pai_id]}
            service.files().create(body=meta).execute()
            
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)