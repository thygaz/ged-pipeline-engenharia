let todosFuncionarios = [];
let arquivoAtual = null;
let nomeFuncionarioAtual = "";
let pastaAtualId = ""; // ID da pasta 05 para upload

window.onload = async () => {
    try {
        const res = await fetch('/api/funcionarios');
        todosFuncionarios = await res.json();
        renderizarLista(todosFuncionarios);
        
        // Configura Drag and Drop
        setupDragAndDrop();
    } catch (e) {
        console.error(e);
        alert("Erro ao conectar. Verifique servidor.");
    }
};

// --- FORMATAÇÃO DE NOME (LÓGICA NOVA) ---
function formatarNomeExibicao(nomeCompleto) {
    // Transforma "ELLEN VITORIA RODRIGUES GOES" em "Ellen Goes"
    if (!nomeCompleto) return "";
    
    // 1. Title Case (Primeira maiúscula)
    let excecoes = ['da', 'de', 'do', 'dos', 'e'];
    let palavras = nomeCompleto.toLowerCase().split(' ').map(w => 
        excecoes.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    );
    
    // 2. Pega Primeiro e Último
    if (palavras.length > 1) {
        return `${palavras[0]} ${palavras[palavras.length - 1]}`;
    }
    return palavras[0];
}

function formatarNomeCompleto(nome) {
    // Apenas formata Title Case para usar na renomeação
    let excecoes = ['da', 'de', 'do', 'dos', 'e'];
    return nome.toLowerCase().split(' ').map(w => 
        excecoes.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(' ');
}

// --- LISTA LATERAL ---
function renderizarLista(lista) {
    const container = document.getElementById('lista-funcionarios');
    container.innerHTML = '';
    lista.forEach(f => {
        const div = document.createElement('div');
        div.className = 'func-item';
        
        // Aqui usamos a formatação curta
        div.innerText = formatarNomeExibicao(f.name);
        
        // Tooltip nativo do navegador (Title) para mostrar nome completo ao passar mouse
        div.title = formatarNomeCompleto(f.name); 
        
        div.onclick = () => carregarFuncionario(f.id, f.name, div);
        container.appendChild(div);
    });
}

function filtrarFuncionarios() {
    const termo = document.getElementById('search').value.toLowerCase();
    const filtrados = todosFuncionarios.filter(f => f.name.toLowerCase().includes(termo));
    renderizarLista(filtrados);
}

// --- CARREGAMENTO ---
async function carregarFuncionario(id, nome, elemento) {
    document.querySelectorAll('.func-item').forEach(e => e.classList.remove('active'));
    elemento.classList.add('active');
    
    // Mostra nome formatado bonito no título
    document.getElementById('titulo-nome').innerText = formatarNomeCompleto(nome);
    nomeFuncionarioAtual = nome;

    const grid = document.getElementById('grid-arquivos');
    grid.innerHTML = '<div class="loading-text">Carregando arquivos...</div>';
    document.getElementById('painel-acoes').style.display = 'none';
    
    // Mostra zona de drop
    document.getElementById('drop-zone').classList.remove('hidden');

    const res = await fetch(`/api/arquivos/${id}`);
    const dados = await res.json();

    grid.innerHTML = '';

    if(dados.error) {
        grid.innerHTML = `<div style="color:salmon; text-align:center; margin-top:50px;">${dados.error}</div>`;
        pastaAtualId = null;
        return;
    }

    pastaAtualId = dados.folder_id; // Salva ID da pasta 05 para uploads

    if(dados.arquivos.length === 0) {
        grid.innerHTML = '<div style="color:#666; text-align:center; margin-top:50px;">Pasta vazia. Arraste arquivos aqui.</div>';
        return;
    }

    dados.arquivos.forEach(arq => {
        const card = document.createElement('div');
        card.className = 'file-card';
        card.onclick = () => selecionarArquivo(arq, card);
        
        let conteudo = `<span class="material-icons icon-lg">description</span>`;
        if(arq.thumbnailLink) {
            conteudo = `<img src="${arq.thumbnailLink}" class="file-thumb" referrerpolicy="no-referrer">`;
        } else if (arq.mimeType.includes('image')) {
            conteudo = '<span class="material-icons icon-lg">image</span>';
        } else if (arq.mimeType.includes('pdf')) {
            conteudo = '<span class="material-icons icon-lg" style="color:#e74c3c">picture_as_pdf</span>';
        }

        card.innerHTML = `${conteudo}<div class="file-name">${arq.name}</div>`;
        grid.appendChild(card);
    });
}

// --- UPLOAD DRAG & DROP ---
function setupDragAndDrop() {
    const main = document.querySelector('.main');
    const dropZone = document.getElementById('drop-zone');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        main.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    main.addEventListener('dragover', () => {
        if(pastaAtualId) dropZone.classList.add('active');
    });

    main.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || !main.contains(e.relatedTarget)) {
            dropZone.classList.remove('active');
        }
    });

    main.addEventListener('drop', (e) => {
        dropZone.classList.remove('active');
        if(!pastaAtualId) return alert("Selecione um funcionário primeiro.");
        
        const dt = e.dataTransfer;
        const files = dt.files;
        uploadArquivos(files);
    });
}

async function uploadArquivos(files) {
    if(!pastaAtualId) return alert("Selecione um funcionário.");
    
    document.getElementById('loading-overlay').style.display = 'flex';

    for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        formData.append('folder_id', pastaAtualId);

        try {
            await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
        } catch (e) {
            console.error("Erro upload", e);
            alert("Erro ao enviar " + files[i].name);
        }
    }

    document.getElementById('loading-overlay').style.display = 'none';
    // Recarrega a pasta atual
    const activeItem = document.querySelector('.func-item.active');
    if(activeItem) activeItem.click(); // Simula clique para recarregar
}

// --- MANIPULAÇÃO DE ARQUIVOS (CÓDIGO EXISTENTE) ---
function selecionarArquivo(arq, card) {
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    arquivoAtual = arq;
    document.getElementById('painel-acoes').style.display = 'flex';
    document.getElementById('nome-arquivo-sel').innerText = arq.name;
}

function abrirModalVisualizacao() {
    if(!arquivoAtual) return;
    const modal = document.getElementById('modal-visualizacao');
    const frame = document.getElementById('preview-frame');
    document.getElementById('modal-titulo').innerText = arquivoAtual.name;
    frame.src = `https://drive.google.com/file/d/${arquivoAtual.id}/preview`;
    modal.style.display = 'flex';
}

function fecharModal(event, force = false) {
    if (force || event.target.id === 'modal-visualizacao') {
        document.getElementById('modal-visualizacao').style.display = 'none';
        document.getElementById('preview-frame').src = '';
    }
}

function toggleInputs() {
    const isFilho = document.getElementById('check-filho').checked;
    document.getElementById('input-filho').disabled = !isFilho;
    if(isFilho) document.getElementById('check-conjuge').checked = false;
    if(document.getElementById('check-conjuge').checked) document.getElementById('check-filho').checked = false;
}

async function renomearArquivo() {
    if (!arquivoAtual) return;
    const btn = document.querySelector('.btn-rename');
    const txtOriginal = btn.innerText;
    btn.innerText = "..."; btn.disabled = true;

    try {
        const tipo = document.getElementById('doc-type').value;
        const ext = arquivoAtual.name.split('.').pop();
        
        let nomeFormatado = formatarNomeCompleto(nomeFuncionarioAtual);
        let partes = nomeFormatado.split(' ');
        let nomeCurto = partes[0] + (partes.length > 1 ? ' ' + partes[partes.length - 1] : '');

        let novoNome = `${tipo} - ${nomeCurto}.${ext}`;

        if(document.getElementById('check-conjuge').checked) {
            novoNome = `${tipo} (Cônjuge) - ${nomeCurto}.${ext}`;
        } else if(document.getElementById('check-filho').checked) {
            const nomeFilho = document.getElementById('input-filho').value;
            if(!nomeFilho) { throw "Nome filho vazio"; }
            novoNome = `${tipo} (Filho ${formatarNomeCompleto(nomeFilho)}) - ${nomeCurto}.${ext}`;
        }

        const res = await fetch('/api/renomear', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: arquivoAtual.id, new_name: novoNome })
        });

        const data = await res.json();
        if(data.status === 'success') {
            arquivoAtual.name = novoNome;
            document.querySelector('.file-card.selected .file-name').innerText = novoNome;
            document.getElementById('nome-arquivo-sel').innerText = novoNome;
            const tituloModal = document.getElementById('modal-titulo');
            if(tituloModal) tituloModal.innerText = novoNome;
        } else {
            alert('Erro: ' + data.msg);
        }
    } catch (e) {
        if(e !== "Nome filho vazio") console.error(e);
        else alert("Digite o nome do filho!");
    } finally {
        btn.innerText = txtOriginal;
        btn.disabled = false;
    }
}

async function abrirModalCriar() {
    const nome = prompt("Nome do novo colaborador:");
    if(!nome) return;
    document.body.style.cursor = 'wait';
    const res = await fetch('/api/criar_funcionario', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ nome: nome })
    });
    document.body.style.cursor = 'default';
    if(res.ok) { alert('Criado com sucesso!'); location.reload(); } 
    else { alert('Erro ao criar'); }
}