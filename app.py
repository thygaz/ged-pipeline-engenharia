import os
import pickle
import io
import shutil # Para manipulação de arquivos e cache
from flask import Flask, render_template, jsonify, request, send_file
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from PyPDF2 import PdfReader, PdfWriter, PdfMerger
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF (Essencial para as miniaturas rápidas)

app = Flask(__name__)

# --- CONFIGURAÇÕES ---
SCOPES = ['https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.pickle'
ROOT_FOLDER_ID = '1BFfAp0hrSSQwjDCiJWcYiMO_BjNA_TCu' 

# Pasta de Cache (Cria se não existir)
CACHE_DIR = 'cache_arquivos'
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

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

# --- ROTAS BÁSICAS ---

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
            pageSize=1000, fields="files(id, name)", orderBy="name"
        ).execute()
        return jsonify(results.get('files', []))
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/subpastas/<func_id>')
def listar_subpastas(func_id):
    try:
        service = get_service()
        results = service.files().list(
            q=f"'{func_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            pageSize=50, fields="files(id, name)", orderBy="name"
        ).execute()
        return jsonify(results.get('files', []))
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/arquivos_pasta/<folder_id>')
def listar_arquivos_pasta(folder_id):
    try:
        service = get_service()
        results = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'",
            pageSize=1000, fields="files(id, name, mimeType, webViewLink, thumbnailLink, iconLink)", orderBy="name"
        ).execute()
        return jsonify({"arquivos": results.get('files', []), "folder_id": folder_id})
    except Exception as e: return jsonify({"error": str(e)}), 500

# --- DOWNLOAD E VISUALIZAÇÃO (COM CACHE) ---

@app.route('/api/proxy_pdf/<file_id>')
def proxy_pdf(file_id):
    try:
        caminho_local = os.path.join(CACHE_DIR, f"{file_id}.pdf")
        
        # 1. Cache Hit
        if os.path.exists(caminho_local):
            return send_file(caminho_local, mimetype='application/pdf')

        # 2. Cache Miss (Baixa do Google)
        service = get_service()
        request_drive = service.files().get_media(fileId=file_id)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request_drive)
        done = False
        while done is False: _, done = downloader.next_chunk()
        
        # 3. Salva no Cache
        fh.seek(0)
        with open(caminho_local, 'wb') as f:
            f.write(fh.getbuffer())
            
        fh.seek(0)
        return send_file(fh, mimetype='application/pdf')
    except Exception as e:
        return str(e), 500

# --- ROTA DE MINIATURAS (PERFORMANCE MÁXIMA) ---
@app.route('/api/thumbnail/<file_id>/<int:page_num>')
def get_page_thumbnail(file_id, page_num):
    try:
        caminho_local = os.path.join(CACHE_DIR, f"{file_id}.pdf")
        
        # Garante arquivo local
        if not os.path.exists(caminho_local):
            service = get_service()
            req = service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, req)
            done = False
            while done is False: _, done = downloader.next_chunk()
            fh.seek(0)
            with open(caminho_local, 'wb') as f: f.write(fh.getbuffer())

        # Processamento Ultrarrápido com PyMuPDF (C++)
        doc = fitz.open(caminho_local)
        
        if page_num < 0 or page_num >= len(doc):
            return "Pág Inválida", 404

        page = doc.load_page(page_num)
        
        # Matrix 0.3 = Baixa Resolução (Rápido para listas)
        pix = page.get_pixmap(matrix=fitz.Matrix(0.3, 0.3))
        
        output = io.BytesIO(pix.tobytes("png"))
        return send_file(output, mimetype='image/png')

    except Exception as e:
        print(f"Erro thumb: {e}")
        return str(e), 500

# --- OPERAÇÕES DE ARQUIVO (CRIAR, DELETAR, RENOMEAR) ---

@app.route('/api/upload', methods=['POST'])
def upload_arquivo():
    if 'file' not in request.files: return jsonify({'status': 'error'}), 400
    file = request.files['file']
    folder_id = request.form.get('folder_id')
    try:
        service = get_service()
        meta = {'name': file.filename, 'parents': [folder_id]}
        fh = io.BytesIO()
        file.save(fh)
        fh.seek(0)
        media = MediaIoBaseUpload(fh, mimetype=file.content_type, resumable=True)
        service.files().create(body=meta, media_body=media).execute()
        return jsonify({'status': 'success'})
    except Exception as e: return jsonify({'status': 'error', 'msg': str(e)}), 500

@app.route('/api/renomear', methods=['POST'])
def renomear():
    data = request.json
    try:
        service = get_service()
        service.files().update(fileId=data['id'], body={'name': data['new_name']}).execute()
        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", 'msg': str(e)}), 500

@app.route('/api/excluir_arquivos', methods=['POST'])
def excluir_arquivos():
    data = request.json
    ids = data.get('ids')
    if not ids: return jsonify({"error": "Nada para excluir"}), 400
    
    try:
        service = get_service()
        for file_id in ids:
            try:
                service.files().delete(fileId=file_id).execute()
                # Limpa do cache local também
                caminho_local = os.path.join(CACHE_DIR, f"{file_id}.pdf")
                if os.path.exists(caminho_local):
                    os.remove(caminho_local)
            except Exception as e:
                print(f"Erro ao deletar {file_id}: {e}")
                
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "msg": str(e)}), 500

# --- LÓGICA DE SEPARAR (SPLIT) - CRIA NOVOS E DELETA O VELHO ---
@app.route('/api/separar_blocos', methods=['POST'])
def separar_blocos():
    data = request.json
    original_id = data.get('id')
    
    try:
        # Usa cache para ler o original
        caminho_local = os.path.join(CACHE_DIR, f"{original_id}.pdf")
        if not os.path.exists(caminho_local):
            return jsonify({"status": "error", "msg": "Arquivo não encontrado no cache"}), 400

        pdf = PdfReader(caminho_local)
        service = get_service()

        # 1. Cria os NOVOS arquivos no Drive
        for g in data.get('grupos'):
            writer = PdfWriter()
            for p in g['paginas']: 
                if p < len(pdf.pages):
                    writer.add_page(pdf.pages[p])
            
            out = io.BytesIO()
            writer.write(out)
            out.seek(0)
            media = MediaIoBaseUpload(out, mimetype='application/pdf', resumable=True)
            service.files().create(body={'name': g['nome'], 'parents': [data.get('folder_id')]}, media_body=media).execute()
            
        # 2. DELETA o arquivo ORIGINAL (O "Misturado")
        try:
            service.files().delete(fileId=original_id).execute()
            # Remove do cache também
            if os.path.exists(caminho_local):
                os.remove(caminho_local)
        except Exception as e:
            print(f"Aviso: Erro ao deletar original {original_id}: {e}")

        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "msg": str(e)}), 500

# --- LÓGICA DE JUNTAR (MERGE) - CRIA NOVO E DELETA VELHOS ---
@app.route('/api/juntar_arquivos', methods=['POST'])
def juntar_arquivos():
    data = request.json
    ids = data.get('ids')
    if not ids or len(ids) < 2: return jsonify({"error": "Sem arquivos"}), 400
    
    try:
        service = get_service()
        merger = PdfMerger()
        streams = []

        for fid in ids:
            caminho_local = os.path.join(CACHE_DIR, f"{fid}.pdf")
            # Garante download se não tiver no cache
            if not os.path.exists(caminho_local):
                req = service.files().get_media(fileId=fid)
                fh = io.BytesIO()
                downloader = MediaIoBaseDownload(fh, req)
                done = False
                while done is False: _, done = downloader.next_chunk()
                fh.seek(0)
                with open(caminho_local, 'wb') as f: f.write(fh.getbuffer())

            fh = open(caminho_local, 'rb')
            merger.append(fh)
            streams.append(fh)

        out = io.BytesIO()
        merger.write(out)
        merger.close()
        for s in streams: s.close()
        out.seek(0)
        
        # 1. Upload do Arquivo Juntado
        media = MediaIoBaseUpload(out, mimetype='application/pdf', resumable=True)
        service.files().create(body={'name': data.get('nome'), 'parents': [data.get('folder_id')]}, media_body=media).execute()
        
        # 2. Deleta os arquivos parciais originais
        for fid in ids:
            try:
                service.files().delete(fileId=fid).execute()
            except: pass

        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "msg": str(e)}), 500

@app.route('/api/criar_funcionario', methods=['POST'])
def criar_funcionario():
    data = request.json
    try:
        service = get_service()
        pai = service.files().create(body={'name': data.get('nome').upper(), 'mimeType': 'application/vnd.google-apps.folder', 'parents': [ROOT_FOLDER_ID]}, fields='id').execute()
        for f in FOLDERS_STRUCTURE:
            service.files().create(body={'name': f, 'mimeType': 'application/vnd.google-apps.folder', 'parents': [pai.get('id')]}).execute()
        return jsonify({"status": "success"})
    except Exception as e: return jsonify({"status": "error", "msg": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)