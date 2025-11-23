from google_auth_oauthlib.flow import InstalledAppFlow
import pickle
import os

# --- CONFIGURAÇÕES ---
SCOPES = ['https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.pickle'

def gerar_token():
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"ERRO: Não encontrei o arquivo '{CREDENTIALS_FILE}'.")
        return

    print("--- INICIANDO AUTORIZAÇÃO ---")
    print("Uma janela do navegador vai abrir. Faça login com a conta do RH.")
    
    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
    creds = flow.run_local_server(port=0)
    
    with open(TOKEN_FILE, 'wb') as token:
        pickle.dump(creds, token)
    
    print("\n✅ SUCESSO! O arquivo 'token.pickle' foi gerado.")
    print("Agora você pode fechar isso e rodar o 'app.py' normalmente.")

if __name__ == '__main__':
    gerar_token()