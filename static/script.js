// ======================================================
// 1. VARIÁVEIS GLOBAIS
// ======================================================
let funcionariosCache = [];
let arquivoAtual = null;
let nomeFuncionarioAtual = "";
let pastaAtualId = null;

// Variáveis de Seleção Múltipla
let modoSelecao = false;
let selecionados = []; 

// Variáveis do Visualizador
let viewerState = { 
    scale: 1, rotation: 0, x: 0, y: 0, 
    isDragging: false, startX: 0, startY: 0, moveMode: false 
};

// ======================================================
// 2. INICIALIZAÇÃO E HELPER UI
// ======================================================
window.onload = async () => {
    // Carregar tema salvo
    if(localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-mode');
        document.getElementById('theme-icon').innerText = 'dark_mode';
    }

    setupDragAndDrop();

    // Carregar lista inicial
    try {
        const res = await fetch('/api/funcionarios');
        funcionariosCache = await res.json();
        renderizarLista(funcionariosCache);
    } catch (e) {
        console.error("Erro ao iniciar:", e);
    }
};

function toggleTheme() {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    document.getElementById('theme-icon').innerText = isLight ? 'dark_mode' : 'light_mode';
}

function formatarNomeVisual(nomeCompleto) {
    if (!nomeCompleto) return "";
    let partes = nomeCompleto.toLowerCase().split(' ').filter(p => p.length > 0);
    if (partes.length === 1) return capitalize(partes[0]);
    let primeiro = capitalize(partes[0]);
    let ultimo = capitalize(partes[partes.length - 1]);
    return `${primeiro} ${ultimo}`;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function sincronizarTiposDocumento() {
    const original = document.getElementById('doc-type');
    const destino = document.getElementById('merge-type');
    if(original && destino) destino.innerHTML = original.innerHTML;
}

// ======================================================
// 3. NAVEGAÇÃO (LISTAS E ABAS)
// ======================================================
function renderizarLista(lista) {
    const container = document.getElementById('lista-funcionarios');
    container.innerHTML = '';
    lista.forEach(f => {
        const div = document.createElement('div');
        div.className = 'func-item';
        div.innerText = formatarNomeVisual(f.name);
        div.title = f.name;
        div.onclick = () => carregarFuncionario(f.id, f.name, div);
        container.appendChild(div);
    });
}

function filtrarFuncionarios() {
    const termo = document.getElementById('search').value.toLowerCase();
    const filtrados = funcionariosCache.filter(f => f.name.toLowerCase().includes(termo));
    renderizarLista(filtrados);
}

async function carregarFuncionario(id, nomeOriginal, elemento) {
    document.querySelectorAll('.func-item').forEach(e => e.classList.remove('active'));
    elemento.classList.add('active');
    
    document.getElementById('titulo-nome').innerText = formatarNomeVisual(nomeOriginal);
    nomeFuncionarioAtual = nomeOriginal;
    
    const containerAbas = document.getElementById('tabs-container');
    const grid = document.getElementById('grid-arquivos');
    
    containerAbas.innerHTML = 'Carregando pastas...';
    grid.innerHTML = '';
    document.getElementById('btn-upload-topo').disabled = true;

    try {
        const res = await fetch(`/api/subpastas/${id}`);
        const pastas = await res.json();
        
        containerAbas.innerHTML = '';

        if(pastas.length === 0) {
            containerAbas.innerHTML = '<span style="padding:10px; color:#888">Sem pastas padrão</span>';
            return;
        }

        pastas.sort((a, b) => a.name.localeCompare(b.name));

        let primeiraPastaId = null;
        pastas.forEach((pasta, index) => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            let nomeAba = pasta.name.includes('-') ? pasta.name.split('-')[1].trim() : pasta.name;
            btn.innerText = nomeAba;
            
            btn.onclick = () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                carregarArquivosDaPasta(pasta.id);
            };

            containerAbas.appendChild(btn);
            if(index === 0) primeiraPastaId = pasta.id;
        });

        if (primeiraPastaId) containerAbas.children[0].click();

    } catch (e) {
        console.error(e);
        containerAbas.innerHTML = 'Erro ao carregar pastas.';
    }
}

async function carregarArquivosDaPasta(folderId) {
    pastaAtualId = folderId;
    document.getElementById('btn-upload-topo').disabled = false;
    
    const grid = document.getElementById('grid-arquivos');
    grid.innerHTML = '<div class="loading-text">Carregando arquivos...</div>';
    document.getElementById('painel-acoes').classList.add('hidden');
    
    // Reseta seleção ao trocar de pasta
    toggleModoSelecao(true); 

    try {
        const res = await fetch(`/api/arquivos_pasta/${folderId}`);
        const dados = await res.json();
        
        grid.innerHTML = '';
        
        if(dados.error) {
            grid.innerHTML = `<div style="text-align:center; margin-top:50px;">Erro: ${dados.error}</div>`;
            return;
        }

        if(dados.arquivos.length === 0) {
            grid.innerHTML = `<div style="color:var(--text-muted); text-align:center; margin-top:50px;">Pasta vazia</div>`;
        }

        dados.arquivos.forEach(arq => {
            criarCardArquivo(arq, grid);
        });

    } catch (e) {
        grid.innerHTML = 'Erro ao listar arquivos.';
    }
}

function criarCardArquivo(arq, container) {
    const card = document.createElement('div');
    card.className = 'file-card';
    // Checkbox para seleção múltipla
    card.innerHTML += `<div class="card-checkbox"></div>`;
    
    card.onclick = (e) => {
        // Se segurar CTRL ou já estiver em modo seleção
        if (modoSelecao || e.ctrlKey) {
            if (!modoSelecao) toggleModoSelecao(); 
            toggleSelecaoArquivo(arq, card);
        } else {
            selecionarArquivo(arq, card);
        }
    };
    
    // Clique Duplo: Abre Visualizador (se não estiver selecionando)
    card.ondblclick = () => { 
        if(!modoSelecao) abrirVisualizadorCompleto(arq); 
    };

    let conteudo = `<span class="material-icons icon-lg">description</span>`;
    if(arq.thumbnailLink) {
         conteudo = `<img src="${arq.thumbnailLink}" class="file-thumb" referrerpolicy="no-referrer">`;
    } else if (arq.mimeType.includes('pdf')) {
        conteudo = '<span class="material-icons icon-lg" style="color:#e74c3c">picture_as_pdf</span>';
    } else if (arq.mimeType.includes('image')) {
        conteudo = '<span class="material-icons icon-lg" style="color:#3498db">image</span>';
    }
    
    card.insertAdjacentHTML('beforeend', `${conteudo}<div class="file-name">${arq.name}</div>`);
    container.appendChild(card);
}

function selecionarArquivo(arq, card) {
    // Limpa seleção visual anterior
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    arquivoAtual = arq;

    const painel = document.getElementById('painel-acoes');
    painel.classList.remove('hidden');
    document.getElementById('nome-arquivo-sel').innerText = arq.name;
    
    atualizarBotoesInterface();
}

// ======================================================
// 4. SELEÇÃO MÚLTIPLA E BOTÕES
// ======================================================
function toggleModoSelecao(forceFalse = false) {
    if(forceFalse) modoSelecao = true; // Inverte abaixo
    modoSelecao = !modoSelecao;
    
    const btn = document.getElementById('btn-select-mode');
    const checks = document.querySelectorAll('.card-checkbox');
    const painel = document.getElementById('painel-acoes');

    if (modoSelecao) {
        btn.classList.add('selection-active');
        checks.forEach(c => c.style.display = 'block');
        painel.classList.add('hidden'); // Esconde barra inferior
        arquivoAtual = null;
        document.querySelectorAll('.file-card').forEach(c => c.classList.remove('selected'));
    } else {
        btn.classList.remove('selection-active');
        checks.forEach(c => c.style.display = 'none');
        limparSelecao();
    }
    atualizarBotoesInterface();
}

function toggleSelecaoArquivo(arq, card) {
    const index = selecionados.findIndex(a => a.id === arq.id);
    if (index >= 0) {
        selecionados.splice(index, 1);
        card.classList.remove('multi-selected');
    } else {
        selecionados.push(arq);
        card.classList.add('multi-selected');
    }
    atualizarBotoesInterface();
}

function limparSelecao() {
    selecionados = [];
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('multi-selected'));
    atualizarBotoesInterface();
}

function atualizarBotoesInterface() {
    // 1. Botão JUNTAR (Flutuante Laranja)
    const btnJuntar = document.getElementById('btn-float-merge');
    if(btnJuntar) btnJuntar.remove();

    if (selecionados.length >= 2) {
        const btn = document.createElement('button');
        btn.id = 'btn-float-merge';
        btn.className = 'btn-orange';
        btn.style.cssText = `position: fixed; bottom: 30px; right: 30px; padding: 15px 30px; border-radius: 50px; box-shadow: 0 5px 20px rgba(0,0,0,0.5); z-index: 2000; display: flex; align-items: center; gap: 8px; font-size: 16px;`;
        btn.innerHTML = `<span class="material-icons">merge</span> JUNTAR (${selecionados.length})`;
        btn.onclick = abrirModalJuntar;
        document.body.appendChild(btn);
    }

    // 2. Botão SEPARAR (Na Barra Inferior) - Cor Roxo
    const btnSeparar = document.getElementById('btn-separar-panel');
    
    // Lógica: Só mostra se estiver no modo normal (1 arquivo) E for PDF
    if (!modoSelecao && arquivoAtual && arquivoAtual.mimeType.includes('pdf')) {
        btnSeparar.classList.remove('hidden');
    } else {
        btnSeparar.classList.add('hidden');
    }
}

// Função chamada pelo botão da barra
function acaoSeparar() {
    if (arquivoAtual) {
        abrirSeparadorDragDrop();
    }
}

// ======================================================
// 5. VISUALIZADOR AVANÇADO (COM ARRASTAR)
// ======================================================
async function abrirVisualizadorCompleto(arq) {
    if(!arq) arq = arquivoAtual;
    if(!arq) return;

    arquivoAtual = arq; 
    const modal = document.getElementById('modal-visualizacao');
    const titulo = document.getElementById('modal-titulo');
    const controls = document.getElementById('viewer-controls');
    const imgElement = document.getElementById('viewer-image');
    const iframeElement = document.getElementById('preview-frame');
    
    titulo.innerText = arq.name;
    modal.style.display = 'flex';
    
    resetarVisualizacao();
    
    // Limpa classes
    imgElement.className = 'viewer-element hidden';
    iframeElement.className = 'viewer-element hidden';
    controls.style.visibility = 'visible'; 

    if (arq.mimeType.includes('image')) {
        imgElement.classList.remove('hidden');
        imgElement.src = `/api/proxy_pdf/${arq.id}`; 
        toggleMover(true); // Imagem pode arrastar por padrão
    } else {
        iframeElement.classList.remove('hidden');
        iframeElement.src = `https://drive.google.com/file/d/${arq.id}/preview`;
        toggleMover(false); // PDF começa travado para rolar página
    }
}

function controlarZoom(delta) {
    viewerState.scale += delta;
    if (viewerState.scale < 0.1) viewerState.scale = 0.1; 
    aplicarTransformacao();
}

function controlarRotacao(graus) {
    viewerState.rotation += graus;
    aplicarTransformacao();
}

function resetarVisualizacao() {
    viewerState.scale = 1;
    viewerState.rotation = 0;
    viewerState.x = 0; viewerState.y = 0;
    aplicarTransformacao();
}

function aplicarTransformacao() {
    const img = document.getElementById('viewer-image');
    const iframe = document.getElementById('preview-frame');
    const target = !img.classList.contains('hidden') ? img : iframe;
    
    if(target) {
        target.style.transform = `translate(${viewerState.x}px, ${viewerState.y}px) rotate(${viewerState.rotation}deg) scale(${viewerState.scale})`;
    }
}

// Ferramenta Mãozinha (Pan)
function toggleMover(forceState = null) {
    const btn = document.getElementById('btn-move');
    const layer = document.getElementById('drag-layer');
    const container = document.getElementById('img-container');

    if (forceState !== null) viewerState.moveMode = forceState;
    else viewerState.moveMode = !viewerState.moveMode;

    if(viewerState.moveMode) {
        btn.classList.add('active-tool');
        layer.classList.remove('hidden');
        container.classList.add('grabbing');
    } else {
        btn.classList.remove('active-tool');
        layer.classList.add('hidden');
        container.classList.remove('grabbing');
    }
}

// Eventos de Mouse para Arrastar
const containerImg = document.getElementById('img-container');

containerImg.addEventListener('mousedown', (e) => {
    if(!viewerState.moveMode) return;
    viewerState.isDragging = true;
    viewerState.startX = e.clientX - viewerState.x;
    viewerState.startY = e.clientY - viewerState.y;
    containerImg.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
    if (!viewerState.isDragging) return;
    e.preventDefault();
    viewerState.x = e.clientX - viewerState.startX;
    viewerState.y = e.clientY - viewerState.startY;
    aplicarTransformacao();
});

window.addEventListener('mouseup', () => {
    if(viewerState.isDragging) {
        viewerState.isDragging = false;
        containerImg.style.cursor = 'grab';
    }
});

// ======================================================
// 6. MODAL JUNTAR (MERGE)
// ======================================================
function abrirModalJuntar() {
    sincronizarTiposDocumento();
    const modal = document.getElementById('modal-juntar');
    const list = document.getElementById('merge-list');
    const inputNome = document.getElementById('merge-name-preview');
    const selectTipo = document.getElementById('merge-type');

    list.innerHTML = '';
    selecionados.forEach(arq => {
        const thumb = arq.thumbnailLink ? arq.thumbnailLink.replace('=s220', '=s800') : 'https://via.placeholder.com/100x140?text=PDF';
        const div = document.createElement('div');
        div.className = 'merge-card';
        div.dataset.id = arq.id; 
        
        div.innerHTML = `
            <button class="btn-remove-merge" onclick="this.parentElement.remove()">×</button>
            <img src="${thumb}" class="merge-thumb" referrerpolicy="no-referrer">
            <div class="merge-name">${arq.name}</div>
        `;
        
        // Zoom na miniatura
        const img = div.querySelector('img');
        img.ondblclick = () => mostrarZoomMiniatura(img.src);

        list.appendChild(div);
    });

    new Sortable(list, { animation: 150, ghostClass: 'ghost' });
    
    const nomePessoa = formatarNomeVisual(nomeFuncionarioAtual);
    const updateNome = () => { inputNome.value = `${selectTipo.value} - ${nomePessoa}.pdf`; };
    selectTipo.onchange = updateNome;
    updateNome(); 
    
    modal.style.display = 'flex';
}

async function confirmarJuncao() {
    const cards = document.querySelectorAll('.merge-card');
    const idsOrdenados = Array.from(cards).map(c => c.dataset.id);
    const nomeFinal = document.getElementById('merge-name-preview').value;

    if(idsOrdenados.length < 2) return alert("Precisa de pelo menos 2 arquivos.");
    document.getElementById('loading-overlay').style.display = 'flex';

    try {
        const res = await fetch('/api/juntar_arquivos', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ids: idsOrdenados, nome: nomeFinal, folder_id: pastaAtualId })
        });
        
        const data = await res.json();
        if(data.status === 'success') {
            alert("Arquivos juntados com sucesso!");
            document.getElementById('modal-juntar').style.display = 'none';
            toggleModoSelecao(true); 
            carregarArquivosDaPasta(pastaAtualId);
        } else {
            alert("Erro: " + data.msg);
        }
    } catch (e) { alert("Erro ao processar."); } 
    finally { document.getElementById('loading-overlay').style.display = 'none'; }
}

// ======================================================
// 7. MODAL SEPARAR (SPLIT - VERSÃO ULTRA RÁPIDA / THUMBNAIL API)
// ======================================================
async function abrirSeparadorDragDrop() {
    if(!arquivoAtual || !arquivoAtual.mimeType.includes('pdf')) return alert("Selecione um PDF");
    
    const modal = document.getElementById('modal-separar');
    const sourceList = document.getElementById('split-source-list');
    const groupsContainer = document.getElementById('split-groups-container');
    const loading = document.getElementById('loading-overlay');

    sourceList.innerHTML = '';
    groupsContainer.innerHTML = '';
    loading.style.display = 'flex';
    
    try {
        // 1. Baixa e conta páginas
        const res = await fetch(`/api/proxy_pdf/${arquivoAtual.id}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const pdf = await pdfjsLib.getDocument(url).promise;
        const totalPaginas = pdf.numPages;

        modal.style.display = 'flex'; 

        // 2. Gera as imagens apontando para a API do Python (iLovePDF Style)
        for (let i = 0; i < totalPaginas; i++) {
            const divPage = document.createElement('div');
            divPage.className = 'page-card';
            divPage.dataset.pageNum = i; 
            
            // URL mágica que traz a página como imagem PNG
            const imgUrl = `/api/thumbnail/${arquivoAtual.id}/${i}`;
            
            divPage.innerHTML = `
                <img src="${imgUrl}" style="width:100%; height:95px; object-fit:contain;" loading="lazy">
                <span>Pág ${i + 1}</span>
            `;
            
            // Zoom na miniatura
            divPage.ondblclick = () => mostrarZoomMiniatura(imgUrl);

            sourceList.appendChild(divPage);
        }

        new Sortable(sourceList, { group: 'shared', animation: 150, sort: false });
        adicionarGrupoSplit();

    } catch (e) {
        alert("Erro: " + e);
        modal.style.display = 'none';
    } finally {
        loading.style.display = 'none';
    }
}

function adicionarGrupoSplit() {
    const container = document.getElementById('split-groups-container');
    const divGrupo = document.createElement('div');
    divGrupo.className = 'doc-group';
    const selectClone = document.getElementById('doc-type').cloneNode(true);
    selectClone.id = ""; 
    
    divGrupo.innerHTML = `
        <div class="doc-group-header">
            <div class="doc-group-title"><span>Novo Doc</span><button class="btn-remove-group" onclick="this.closest('.doc-group').remove()">×</button></div>
            <div class="select-container"></div>
        </div>
        <div class="doc-group-list sortable-drag-area"></div>
    `;
    divGrupo.querySelector('.select-container').appendChild(selectClone);
    container.appendChild(divGrupo);
    new Sortable(divGrupo.querySelector('.doc-group-list'), { group: 'shared', animation: 150 });
}

async function confirmarSeparacao() {
    const gruposDivs = document.querySelectorAll('.doc-group');
    let payloadGrupos = [];
    let nomeLimpo = formatarNomeVisual(nomeFuncionarioAtual);

    for(let grupo of gruposDivs) {
        const tipo = grupo.querySelector('select').value;
        const paginasElements = grupo.querySelectorAll('.page-card');
        let indices = [];
        paginasElements.forEach(el => indices.push(parseInt(el.dataset.pageNum)));
        
        if(indices.length > 0) {
            indices.sort((a, b) => a - b);
            let nomeArquivo = `${tipo} - ${nomeLimpo}.pdf`;
            payloadGrupos.push({ nome: nomeArquivo, paginas: indices });
        }
    }

    if(payloadGrupos.length === 0) return alert("Crie grupos e arraste páginas.");
    document.getElementById('loading-overlay').style.display = 'flex';

    const res = await fetch('/api/separar_blocos', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
            id: arquivoAtual.id, 
            folder_id: pastaAtualId, 
            grupos: payloadGrupos 
        })
    });

    const data = await res.json();
    document.getElementById('loading-overlay').style.display = 'none';
    if(data.status === 'success') {
        alert("Salvo com sucesso!");
        document.getElementById('modal-separar').style.display = 'none';
        carregarArquivosDaPasta(pastaAtualId);
    } else {
        alert("Erro: " + data.msg);
    }
}

// ======================================================
// 8. UTILITÁRIOS E UPLOAD
// ======================================================
function setupDragAndDrop() {
    const dropZone = document.getElementById('drag-overlay');
    let dragCounter = 0;

    // CORREÇÃO: Só previne default se for arquivo externo
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, e => {
            if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault(); 
                e.stopPropagation();
            }
        }, false);
    });

    document.body.addEventListener('dragenter', (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter++;
        if (pastaAtualId) dropZone.classList.remove('hidden');
    });

    document.body.addEventListener('dragleave', (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter--;
        if (dragCounter === 0) dropZone.classList.add('hidden');
    });

    document.body.addEventListener('drop', (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragCounter = 0;
        dropZone.classList.add('hidden');
        if(pastaAtualId) {
            handleFiles(e.dataTransfer.files);
        } else {
            alert("Selecione um funcionário e uma pasta antes de soltar arquivos.");
        }
    });
}

function handleFileSelect(event) {
    const files = event.target.files;
    if(files.length > 0) handleFiles(files);
}

async function handleFiles(files) {
    if(!pastaAtualId) return alert("Nenhuma pasta selecionada.");
    
    const loading = document.getElementById('loading-overlay');
    loading.style.display = 'flex';

    for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        formData.append('folder_id', pastaAtualId);

        try {
            await fetch('/api/upload', { method: 'POST', body: formData });
        } catch (e) {
            console.error("Erro upload", e);
        }
    }

    loading.style.display = 'none';
    carregarArquivosDaPasta(pastaAtualId);
}

function toggleInputs() {
    const f = document.getElementById('check-filho').checked;
    document.getElementById('input-filho').disabled = !f;
    if(f) document.getElementById('check-conjuge').checked = false;
    else if(document.getElementById('check-conjuge').checked) document.getElementById('check-filho').checked = false;
}

async function renomearArquivo() {
    if (!arquivoAtual) return;
    const btn = document.querySelector('.btn-rename');
    const t = btn.innerText; btn.innerText = "..."; btn.disabled = true;

    try {
        const tipo = document.getElementById('doc-type').value;
        const ext = arquivoAtual.name.includes('.') ? arquivoAtual.name.split('.').pop() : 'pdf';
        let n = formatarNomeVisual(nomeFuncionarioAtual); 
        let nn = `${tipo} - ${n}.${ext}`;
        if(document.getElementById('check-conjuge').checked) nn = `${tipo} (Cônjuge) - ${n}.${ext}`;
        else if(document.getElementById('check-filho').checked) {
            let fi = document.getElementById('input-filho').value;
            if(!fi) return alert("Nome filho!");
            nn = `${tipo} (Filho ${formatarNomeVisual(fi)}) - ${n}.${ext}`;
        }

        const res = await fetch('/api/renomear', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: arquivoAtual.id, new_name: nn })
        });

        const d = await res.json();
        if(d.status === 'success') {
            arquivoAtual.name = nn;
            document.querySelector('.file-card.selected .file-name').innerText = nn;
            document.getElementById('nome-arquivo-sel').innerText = nn;
        } else alert(d.msg);
    } catch (e) { console.error(e); }
    finally { btn.innerText = t; btn.disabled = false; }
}

async function abrirModalCriar() {
    const n = prompt("Nome Completo:"); if(!n) return;
    document.body.style.cursor = 'wait';
    const res = await fetch('/api/criar_funcionario', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({nome:n}) });
    document.body.style.cursor = 'default';
    if(res.ok) { alert('Criado!'); location.reload(); } else { alert('Erro'); }
}

// Modal Zoom Rápido para Miniaturas
function mostrarZoomMiniatura(src) {
    const overlay = document.getElementById('thumb-zoom-overlay');
    const img = document.getElementById('thumb-zoom-img');
    
    if(src.includes('googleusercontent') && src.includes('=s')) {
        let parts = src.split('=s');
        src = parts[0] + '=s1600'; 
    }
    
    img.src = src;
    overlay.style.display = 'flex';
}

function fecharModal(event, force = false) {
    if (force || event.target.id === 'modal-visualizacao' || event.target.classList.contains('btn-close')) {
        document.getElementById('modal-visualizacao').style.display = 'none';
        document.getElementById('modal-separar').style.display = 'none';
        document.getElementById('modal-juntar').style.display = 'none';
        document.getElementById('preview-frame').src = '';
        document.getElementById('viewer-image').src = '';
    }
}