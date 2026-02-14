/* Painel Lance Sugerido – integrado ao Gerador de Propostas (100% offline) */
(function(){
  const CORE = (window && window.GerProCore) ? window.GerProCore : null;
  const $ = (id) => document.getElementById(id);

  // ---------- Tabs / Views ----------
  const tabs = Array.from(document.querySelectorAll('.tab[data-view]'));
  const viewPropostas = $('viewPropostas');
  const viewEstruturadas = $('viewEstruturadas');
  const viewPainel = $('viewPainel');
  const viewRelatorio = $('viewRelatorio');
  const viewSettings = $('viewSettings');

    function resetRelatorioUI(){
    try{
      const tbody = document.querySelector('#rcTabela tbody');
      if (tbody){
        tbody.innerHTML = '<tr class="empty"><td colspan="7">Use os filtros e clique em “Consultar”.</td></tr>';
      }
      const detail = document.getElementById('rcDetail');
      if (detail) detail.textContent = '—';
      const detailTable = document.getElementById('rcDetailTable');
      if (detailTable) detailTable.classList.add('hidden');
      const status = document.getElementById('rcStatus');
      if (status) status.textContent = 'Pronto';
    }catch(e){}
  }

function setView(name){
    const isPropostas = name === 'propostas';
    const isEstrut = name === 'estruturadas';
    const isPainel = name === 'painel';
    const isRel = name === 'relatorio';
    const isSettings = name === 'settings';

    if (viewPropostas) viewPropostas.classList.toggle('hidden', !isPropostas);
    if (viewEstruturadas) viewEstruturadas.classList.toggle('hidden', !isEstrut);
    if (viewPainel) viewPainel.classList.toggle('hidden', !isPainel);
    if (viewRelatorio) viewRelatorio.classList.toggle('hidden', !isRel);
    if (viewSettings) viewSettings.classList.toggle('hidden', !isSettings);
    if (isSettings && window && typeof window.__syncSettingsForm === 'function') { try{ window.__syncSettingsForm(); }catch(e){} }
    if (isRel) resetRelatorioUI();
    for (const t of tabs){
      t.classList.toggle('active', t.getAttribute('data-view') === name);
    }
    try{ localStorage.setItem('OE_ACTIVE_VIEW', name); }catch(e){}
  }

  for (const t of tabs){
    t.addEventListener('click', () => setView(t.getAttribute('data-view')));
  }

  const lastView = (function(){
    try{ return localStorage.getItem('OE_ACTIVE_VIEW'); }catch(e){ return null; }
  })();
  if (lastView === 'painel' || lastView === 'estruturadas' || lastView === 'relatorio') setView(lastView);

  // ---------- Painel: estado ----------
  const els = {
    file: $('lpFile'),
    useBase: $('lpUseBase'),
    group: $('lpGroup'),
    buscar: $('lpBuscar'),
    mCons: $('lpMCons'),
    mMod: $('lpMMod'),
    mAro: $('lpMAro'),
    valorCons: $('lpValorConsorcio'),
    kPrazo: $('lpKpiPrazo'),
    kSeg: $('lpKpiSegmento'),
    kBase: $('lpKpiBase'),
    status: $('lpStatus'),
    chartTitle: $('lpChartTitle'),
    baseInfo: $('lpBaseInfo'),
    chart: $('lpChart'),
    vCons: $('lpVCons'),
    vMod: $('lpVMod'),
    vAro: $('lpVAro'),
    vConsBRL: $('lpVConsBRL'),
    vModBRL: $('lpVModBRL'),
    vAroBRL: $('lpVAroBRL'),
    aCons: $('lpACons'),
    aMod: $('lpAMod'),
    aAro: $('lpAAro'),
    btnCons: $('lpBtnCons'),
    btnMod: $('lpBtnMod'),
    btnAro: $('lpBtnAro'),
    applyCons: $('lpApplyCons'),
    applyMod: $('lpApplyMod'),
    applyAro: $('lpApplyAro'),
    applyConsOEC: $('lpApplyConsOEC'),
    applyModOEC: $('lpApplyModOEC'),
    applyAroOEC: $('lpApplyAroOEC'),
  };

  const PANEL_STORAGE_KEY = 'OE_LANCE_PANEL_JSON';

  /** @type {Record<string,{segmento?:string,prazo?:number,lances:number[]}>} */
  let panelDB = {};
  /** @type {string|null} */
  let currentGroup = null;
  let lastScenario = null; // {cons,mod,aro}

  function safeJSONParse(s){
    try{ return JSON.parse(String(s)); }catch(e){ return null; }
  }

  function normalizeFromArray(rows){
    // Espera algo como o painel antigo: [{CODIGO_GRUPO, PRAZO, SEGMENTO, LANCE_MIN, LANCE_MIN.1...}]
    const out = {};
    for (const r of (rows || [])){
      const g = String(r?.CODIGO_GRUPO ?? r?.Grupo ?? r?.grupo ?? '').trim();
      if (!g) continue;
      const seg = String(r?.SEGMENTO ?? r?.Segmento ?? '').trim();
      const l = [];
      for (let i=0;i<12;i++){
        const key = i===0 ? 'LANCE_MIN' : `LANCE_MIN.${i}`;
        const v = toNumber(r?.[key]);
        l.push(Number.isFinite(v) ? v : NaN);
      }
      out[g] = { segmento: seg || out[g]?.segmento || '', lances: l };
    }
    return out;
  }

  function normalizeFromObject(obj){
    // Espera algo como: {"916": {segmento:"Imóvel", lances:[...]}, ...}
    const out = {};
    for (const [k,v] of Object.entries(obj || {})){
      const g = String(k).trim();
      if (!g) continue;
      const seg = String(v?.segmento ?? v?.SEGMENTO ?? '').trim();
      const l = Array.isArray(v?.lances) ? v.lances.map(Number) : [];
      const prazo = Number(v?.prazo ?? v?.PRAZO ?? v?.Prazo ?? "");
      out[g] = { segmento: seg, prazo: (Number.isFinite(prazo)?prazo:undefined), lances: l };
    }
    return out;
  }

  function loadDefaultFromApp(){
    // usa a base de lances do próprio app (atualizada via XLSX/localStorage no app.js)
    const src = (window.LANCE_DB && typeof window.LANCE_DB === 'object') ? window.LANCE_DB : {};
    panelDB = normalizeFromObject(src);
    persistPanelDB(null); // limpa override
    setStatus('Base do app carregada (Painel).');
    refreshIfCurrent();
  }

  function isOverrideActive(){
    try{ return !!localStorage.getItem(PANEL_STORAGE_KEY); }catch(e){ return false; }
  }

  // Se o usuário estiver usando a base do app (sem override), o painel acompanha automaticamente
  // as atualizações feitas no Gerador (upload de XLSX de lances).
  window.addEventListener('OE_LANCE_DB_UPDATED', () => {
    if (isOverrideActive()) return;
    loadDefaultFromApp();
  });

  // Também observa alterações via "storage" (ex.: outra aba/instância do app)
  window.addEventListener('storage', (ev) => {
    if (!ev) return;
    if (ev.key === 'OE_LANCE_DB_JSON'){
      if (isOverrideActive()) return;
      loadDefaultFromApp();
    }
  });

  function persistPanelDB(jsonStrOrNull){
    try{
      if (jsonStrOrNull === null) localStorage.removeItem(PANEL_STORAGE_KEY);
      else localStorage.setItem(PANEL_STORAGE_KEY, jsonStrOrNull);
    } catch(e){}
  }

  function loadPanelOverrideIfAny(){
    const s = (function(){ try{ return localStorage.getItem(PANEL_STORAGE_KEY); }catch(e){ return null; } })();
    if (!s) return false;
    const parsed = safeJSONParse(s);
    if (!parsed) return false;

    if (Array.isArray(parsed)) panelDB = normalizeFromArray(parsed);
    else if (parsed && typeof parsed === 'object') panelDB = normalizeFromObject(parsed);
    else return false;

    setStatus('Base JSON carregada (Painel).');
    return true;
  }

  function overrideIsActive(){
    try{ return !!localStorage.getItem(PANEL_STORAGE_KEY); }catch(e){ return false; }
  }

  // Se a base de lances do Gerador for atualizada (XLSX), recarrega automaticamente no Painel
  window.addEventListener('OE_LANCE_DB_UPDATED', () => {
    if (overrideIsActive()) return; // respeita override manual do painel
    try{ loadDefaultFromApp(); }catch(e){}
  });

  // Também captura alterações via "storage" (quando houver múltiplas abas abertas)
  window.addEventListener('storage', (ev) => {
    if (ev && ev.key === 'OE_LANCE_DB_JSON'){
      if (overrideIsActive()) return;
      try{ loadDefaultFromApp(); }catch(e){}
    }
  });

  // ---------- Cálculos (mesmo do painel_lance_sugerido_v4) ----------
  function toNumber(v){
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace('%','').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtPct(x){
    if (CORE && CORE.fmtPct) return CORE.fmtPct(x);
    if (!Number.isFinite(x)) return '—';
    return x.toFixed(2).replace('.', ',') + '%';
  }

  function parseBRLInputToNumber(text){
    if (text === null || text === undefined) return NaN;
    const s = String(text).trim()
      .replace(/\s/g, '')
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatBRL(n){
    if (CORE && CORE.fmtBRL) return CORE.fmtBRL(n);
    if (!Number.isFinite(n)) return '—';
    try{ return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
    catch(e){ return 'R$ ' + n.toFixed(2).replace('.', ','); }
  }

  function average(arr){
    const v = (arr||[]).filter(Number.isFinite);
    if (!v.length) return NaN;
    return v.reduce((a,b)=>a+b,0)/v.length;
  }

  function stddevSample(arr){
    const v = (arr||[]).filter(Number.isFinite);
    const n = v.length;
    if (n <= 1) return 0;
    const mean = v.reduce((a,b)=>a+b,0)/n;
    let ss = 0;
    for (const x of v){
      const d = x - mean;
      ss += d*d;
    }
    return Math.sqrt(ss / (n - 1));
  }

  function clamp(x, min, max){ return Math.max(min, Math.min(max, x)); }

  function computeBase(lances){
    const mean12 = average(lances);
    const mean5  = average(lances.slice(-5));
    const sd12   = stddevSample(lances);

    let baseWeighted = 0.6*mean5 + 0.4*mean12;

    const finite = lances.filter(Number.isFinite);
    const min12 = finite.length ? Math.min(...finite) : NaN;
    const max12 = finite.length ? Math.max(...finite) : NaN;
    if (Number.isFinite(min12) && Number.isFinite(max12)) baseWeighted = clamp(baseWeighted, min12, max12);

    const baseFinal = clamp(baseWeighted + sd12, 0, 100);

    return { baseFinal, baseWeighted, sd12, min12, max12 };
  }

  function computeScenarios(lances){
    // Desconsidera períodos com 0% (grupo ainda não ativo) e valores <= 1%
    lances = (lances || []).map(Number).filter(v => Number.isFinite(v) && v > 1);

    const { baseFinal, baseWeighted, sd12, min12, max12 } = computeBase(lances);
    const mCons = toNumber(els.mCons?.value);
    const mMod  = toNumber(els.mMod?.value);
    const mAro  = toNumber(els.mAro?.value);

    const cons = clamp(baseFinal + mCons, 0, 100);
    const mod  = clamp(baseFinal + mMod, 0, 100);
    const aro  = clamp(baseFinal + mAro, 0, 100);

    return { baseFinal, baseWeighted, sd12, min12, max12, cons, mod, aro };
  }

  function assertividade(recommended, lances){
    const valid = lances.map(v => {
      const n = Number(v);
      return (Number.isFinite(n) && n > 1) ? n : null;
    });
    const highlights = valid.map(v => (v === null) ? false : (recommended >= v));
    const n = valid.filter(v => v !== null).length;
    const hits = highlights.filter(Boolean).length;
    const pct = n ? (hits/n)*100 : NaN;
    return { pct, hits, n, highlights };
  }

  function scenarioColor(kind){
    const root = getComputedStyle(document.documentElement);
    if (kind === 'cons') return root.getPropertyValue('--c-cons').trim() || '#35d07f';
    if (kind === 'mod')  return root.getPropertyValue('--c-mod').trim()  || '#ffcc66';
    return root.getPropertyValue('--c-aro').trim() || '#ff6b6b';
  }

  function monthLabelsFixed(){
    // Rótulos fixos 1..12 para evitar dependência dos meses reais.
    // Assim, a atualização mensal da base não exige alterar o código.
    return ['1','2','3','4','5','6','7','8','9','10','11','12'];
  }

  function drawBars(lances, highlights, hitColor){
    const canvas = els.chart;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0,0,W,H);

    const labels = monthLabelsFixed();
    const values = lances.map(v => Number.isFinite(v) ? v : null);
    const finite = values.filter(v => v !== null);

    const padL=62, padR=18, padT=18, padB=56;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    if (!finite.length){
      ctx.fillStyle = '#a9b3da';
      ctx.font = '14px system-ui';
      ctx.fillText('Sem dados para plotar.', padL, padT+24);
      return;
    }

    const minV = Math.min(...finite);
    const maxV = Math.max(...finite);
    const range = Math.max(1e-6, maxV - minV);
    const yMin = Math.max(0, minV - range*0.15);
    const yMax = Math.min(100, maxV + range*0.20);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    for (let i=0;i<=5;i++){
      const y = padT + innerH*(i/5);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+innerW, y); ctx.stroke();
    }

    // axes
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT+innerH);
    ctx.lineTo(padL+innerW, padT+innerH);
    ctx.stroke();

    // y labels
    ctx.fillStyle = '#a9b3da';
    ctx.font = '12px system-ui';
    for (let i=0;i<=5;i++){
      const val = yMax - (yMax-yMin)*(i/5);
      const y = padT + innerH*(i/5);
      ctx.fillText(val.toFixed(0)+'%', 10, y+4);
    }

    const n = 12;
    const gap = 10;
    const barW = (innerW - gap*(n-1)) / n;

    function yFor(v){
      const t = (v - yMin)/(yMax - yMin);
      return padT + innerH*(1 - t);
    }

    // x labels
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a9b3da';
    ctx.font = '12px system-ui';
    for (let i=0;i<n;i++){
      const x = padL + i*(barW+gap);
      const center = x + barW/2;
      ctx.fillText(labels[i], center, padT+innerH+22);
    }
    ctx.textAlign = 'left';
    ctx.fillText('Mês', padL, padT+innerH+44);

    const root = getComputedStyle(document.documentElement);
    const barColor = root.getPropertyValue('--bar').trim() || '#6aa5ff';
    const barDim   = root.getPropertyValue('--barDim').trim() || 'rgba(106,165,255,.25)';

    for (let i=0;i<n;i++){
      const v = values[i];
      const x = padL + i*(barW+gap);
      if (v === null) continue;

      const y = yFor(v);
      const h = (padT+innerH) - y;

      const hasHighlights = Array.isArray(highlights);
      const isHit = hasHighlights ? !!highlights[i] : false;

      ctx.fillStyle = !hasHighlights ? barColor : (isHit ? hitColor : barDim);
      ctx.fillRect(x, y, barW, h);

      // label
      ctx.fillStyle = '#e7ecff';
      if (hasHighlights && !isHit) ctx.fillStyle = 'rgba(231,236,255,.75)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(fmtPct(v), x+barW/2, Math.max(padT+12, y-6));
    }
  }

  function getPrazoAtualFromDatabank(grupo){
    const g = String(grupo);
    const raw = Array.isArray(window.DATABANK) ? window.DATABANK : [];
    // pega o maior prazo encontrado para o grupo (normalmente o "prazo do grupo")
    let best = 0;
    for (const r of raw){
      if (String(r?.Grupo ?? '').trim() !== g) continue;
      const p = Number(r?.Prazo);
      if (Number.isFinite(p) && p > best) best = p;
    }
    return best || null;
  }

  function updateBRLDisplays(consPct, modPct, aroPct){
    const baseValue = parseBRLInputToNumber(els.valorCons?.value);
    if (!Number.isFinite(baseValue) || baseValue <= 0){
      els.vConsBRL.textContent = 'R$ —';
      els.vModBRL.textContent  = 'R$ —';
      els.vAroBRL.textContent  = 'R$ —';
      return;
    }
    els.vConsBRL.textContent = formatBRL(baseValue * consPct / 100);
    els.vModBRL.textContent  = formatBRL(baseValue * modPct  / 100);
    els.vAroBRL.textContent  = formatBRL(baseValue * aroPct  / 100);
  }

  function setStatus(msg){
    if (els.status) els.status.textContent = msg;
  }

  function setKpis({prazo, segmento, baseText}){
    els.kPrazo.textContent = prazo ?? '—';
    els.kSeg.textContent = segmento || '—';
    els.kBase.textContent = baseText || '—';
  }

  function showScenarios(lances, title){
    const sc = computeScenarios(lances);

    els.chartTitle.textContent = title || '—';

    const baseTxt = `${fmtPct(sc.baseFinal)} (Base)`;
    els.baseInfo.textContent = `Base: ${fmtPct(sc.baseFinal)} • DP: ${fmtPct(sc.sd12)}`;
    setKpis({ prazo: (panelDB[currentGroup] && panelDB[currentGroup].prazo!=null) ? panelDB[currentGroup].prazo : (getPrazoAtualFromDatabank(currentGroup) ?? '—'), segmento: panelDB[currentGroup]?.segmento ?? '', baseText: fmtPct(sc.baseFinal) });

    els.vCons.textContent = fmtPct(sc.cons);
    els.vMod.textContent  = fmtPct(sc.mod);
    els.vAro.textContent  = fmtPct(sc.aro);

    updateBRLDisplays(sc.cons, sc.mod, sc.aro);

    lastScenario = { cons: sc.cons, mod: sc.mod, aro: sc.aro };

    // padrão: sem destaque
    drawBars(lances, null, scenarioColor('cons'));

    // assertividade hints
    const a1 = assertividade(sc.cons, lances);
    const a2 = assertividade(sc.mod,  lances);
    const a3 = assertividade(sc.aro,  lances);

    els.aCons.textContent = Number.isFinite(a1.pct) ? `${a1.hits}/${a1.n} períodos cobertos (${a1.pct.toFixed(0)}%)` : '—';
    els.aMod.textContent  = Number.isFinite(a2.pct) ? `${a2.hits}/${a2.n} períodos cobertos (${a2.pct.toFixed(0)}%)` : '—';
    els.aAro.textContent  = Number.isFinite(a3.pct) ? `${a3.hits}/${a3.n} períodos cobertos (${a3.pct.toFixed(0)}%)` : '—';

    // botões: pintar barras suficientes
    els.btnCons.onclick = () => {
      const a = assertividade(sc.cons, lances);
      drawBars(lances, a.highlights, scenarioColor('cons'));
    };
    els.btnMod.onclick = () => {
      const a = assertividade(sc.mod, lances);
      drawBars(lances, a.highlights, scenarioColor('mod'));
    };
    els.btnAro.onclick = () => {
      const a = assertividade(sc.aro, lances);
      drawBars(lances, a.highlights, scenarioColor('aro'));
    };


// Aplicar lance do cenário – Propostas (campo editável)
function applyToProposta(pct){
  try{
    const g = currentGroup;
    if (!g || !pct || !isFinite(Number(pct))) return;
    if (typeof window.__GERPRO_SET_LANCE_FOR_GROUP === 'function'){
      const ok = window.__GERPRO_SET_LANCE_FOR_GROUP(g, Number(pct));
      if (els.status) els.status.textContent = ok ? 'Lance aplicado em Propostas.' : 'Não foi possível aplicar (gere resultados na aba Propostas).';
      if (ok) { try{ setView('propostas'); }catch(e){} }
    } else {
      if (els.status) els.status.textContent = 'Abra uma proposta (botão Abrir) antes de aplicar o lance.';
    }
  }catch(e){ console.error(e); if (els.status) els.status.textContent = 'Erro ao aplicar lance.'; }
}

// Aplicar lance do cenário – Operações Estruturadas (Customizada)
function applyToOECustom(pct){
  try{
    const g = currentGroup;
    if (!g || !pct || !isFinite(Number(pct))) return;
    if (typeof window.__GERPRO_SET_LANCE_FOR_GROUP === 'function'){
      const ok = window.__GERPRO_SET_LANCE_FOR_GROUP(g, Number(pct));
      if (els.status) els.status.textContent = ok ? 'Lance aplicado em Operações Estruturadas (Customizada).' : 'Não foi possível aplicar (gere resultados na aba Operações Estruturadas > Customizada).';
      if (ok) { try{ setView('estruturadas'); }catch(e){} }
    } else {
      if (els.status) els.status.textContent = 'Abra o resultado Customizada (botão Abrir) antes de aplicar o lance.';
    }
  }catch(e){ console.error(e); if (els.status) els.status.textContent = 'Erro ao aplicar lance.'; }
}

function updateApplyButtons(){
  try{
    const kind = (window.__GERPRO_LAST_OPEN && window.__GERPRO_LAST_OPEN.kind) ? String(window.__GERPRO_LAST_OPEN.kind) : '';
    const fromOECustom = (kind === 'oe_custom');
    // Quando veio de OE Custom, exibe o botão extra "Aplicar em OECustom"
    const oecBtns = [els.applyConsOEC, els.applyModOEC, els.applyAroOEC].filter(Boolean);
    for (const b of oecBtns){
      b.style.display = fromOECustom ? '' : 'none';
    }
  }catch(e){}
}

if (els.applyCons) els.applyCons.onclick = () => applyToProposta(sc.cons);
if (els.applyMod)  els.applyMod.onclick  = () => applyToProposta(sc.mod);
if (els.applyAro)  els.applyAro.onclick  = () => applyToProposta(sc.aro);

if (els.applyConsOEC) els.applyConsOEC.onclick = () => applyToOECustom(sc.cons);
if (els.applyModOEC)  els.applyModOEC.onclick  = () => applyToOECustom(sc.mod);
if (els.applyAroOEC)  els.applyAroOEC.onclick  = () => applyToOECustom(sc.aro);

updateApplyButtons();

    // base info pill
    void baseTxt;
  }

  function refreshIfCurrent(){
    if (!currentGroup) return;
    const rec = panelDB[currentGroup];
    if (!rec || !Array.isArray(rec.lances)) return;
    showScenarios(rec.lances, `Grupo ${currentGroup}`);
  }

  function buscarGrupo(){
    const code = String(els.group.value || '').trim();
    if (!code){
      currentGroup = null;
      setKpis({prazo:'—', segmento:'—', baseText:'—'});
      els.chartTitle.textContent = '—';
      els.baseInfo.textContent = 'Base: —';
      drawBars([], null, scenarioColor('cons'));
      setStatus('Informe um código de grupo.');
      return;
    }

    const rec = panelDB[code];
    if (!rec){
      currentGroup = null;
      setStatus(`Grupo ${code} não encontrado na base do Painel.`);
      return;
    }

    currentGroup = code;
    setStatus(`Grupo ${code} carregado.`);
    try{ updateApplyButtons(); }catch(e){}
    showScenarios(rec.lances || [], `Grupo ${code}`);
  }

  // ---------- Eventos ----------
  if (els.buscar) els.buscar.addEventListener('click', buscarGrupo);
  if (els.group){
    els.group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter'){
        ev.preventDefault();
        buscarGrupo();
      }
    });
  }

  const recalc = () => { if (currentGroup) buscarGrupo(); };
  for (const id of ['lpMCons','lpMMod','lpMAro']){
    const el = $(id);
    if (el) el.addEventListener('input', recalc);
  }
  if (els.valorCons) els.valorCons.addEventListener('input', () => refreshIfCurrent());

  if (els.useBase) els.useBase.addEventListener('click', () => loadDefaultFromApp());

  if (els.file){
    els.file.addEventListener('change', async () => {
      const f = els.file.files && els.file.files[0];
      if (!f) return;
      try{
        const txt = await f.text();
        const parsed = safeJSONParse(txt);
        if (!parsed){
          setStatus('Não foi possível ler o JSON (arquivo inválido).');
          return;
        }
        persistPanelDB(txt);
        if (Array.isArray(parsed)) panelDB = normalizeFromArray(parsed);
        else if (parsed && typeof parsed === 'object') panelDB = normalizeFromObject(parsed);
        else {
          setStatus('JSON não reconhecido. Esperado: array de linhas ou objeto {grupo:{segmento,lances}}.');
          return;
        }
        setStatus('JSON carregado com sucesso (Painel).');
        refreshIfCurrent();
      } catch(e){
        setStatus('Falha ao carregar JSON.');
      }
    });
  }

  // ---------- Init ----------
  // Paleta do painel antigo (mantida aqui, mas respeita o tema do app)
  const root = document.documentElement;
  if (!root.style.getPropertyValue('--c-cons')) root.style.setProperty('--c-cons', '#35d07f');
  if (!root.style.getPropertyValue('--c-mod'))  root.style.setProperty('--c-mod',  '#ffcc66');
  if (!root.style.getPropertyValue('--c-aro'))  root.style.setProperty('--c-aro',  '#ff6b6b');
  if (!root.style.getPropertyValue('--bar'))    root.style.setProperty('--bar',    '#6aa5ff');
  if (!root.style.getPropertyValue('--barDim')) root.style.setProperty('--barDim', 'rgba(106,165,255,.25)');

  // tenta carregar override do painel; senão usa a base do app
  if (!loadPanelOverrideIfAny()) loadDefaultFromApp();
})();