// Splash Screen (abertura) – mostra o GIF ao iniciar e remove após 4s
(function(){
  const SHOW_MS = 7000;
  const FADE_MS = 450;

  function tryPlaySplashVideo(){
    const v = document.getElementById('splash-video');
    if (!v) return;
    try{
      v.muted = true;
      v.playsInline = true;
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(()=>{});
    }catch(e){}
  }

  function hideSplash(){
    const splash = document.getElementById("splash-screen");
    if (!splash) return;
    splash.classList.add("is-hiding");
    setTimeout(() => { try{ splash.remove(); }catch(e){} }, FADE_MS + 50);
  }

  function startSplashTimer(){
    tryPlaySplashVideo();
    tryPlaySplashVideo();
    // Garante que o app não fique preso no splash mesmo se algum recurso demorar a carregar
    setTimeout(hideSplash, SHOW_MS);
  }

  // Permite pular o splash com clique/toque (não altera regras do app, só melhora UX)
  document.addEventListener("click", (e) => {
    const splash = document.getElementById("splash-screen");
    if (!splash) return;
    if (splash.contains(e.target)) hideSplash();
  }, { once: true });

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", startSplashTimer, { once: true });
  } else {
    startSplashTimer();
  }
})();

/* Offline app – dados em window.DATABANK (carregado via data.js) e window.LANCE_DB (data_lances.js) */
(function(){
  const CORE = (window && window.GerProCore) ? window.GerProCore : null;
  const fmtBRL = (n) => {
    if (CORE && CORE.fmtBRL) return CORE.fmtBRL(n);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
  };

  // Utilitários locais (evitam erros quando chamados em qualquer aba)
  const round2 = (n) => {
    if (CORE && CORE.round2) return CORE.round2(n);
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  };

  const clamp = (n, min, max) => {
    if (CORE && CORE.clamp) return CORE.clamp(n, min, max);
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
  };

  const isFiniteNumber = (n) => Number.isFinite(Number(n));

  const STORAGE_KEYS = {
    databank: "OE_DATABANK_JSON",
    lances: "OE_LANCE_DB_JSON",
    apelidos: "OE_APELIDOS_JSON",
    updatedAt: "OE_UPDATED_AT"
  };

  const safeJSONParse = (s) => {
    try{ return JSON.parse(String(s)); }catch(e){ return null; }
  };

  function getLocalOrWindowArray(key, windowVal){
    const local = safeJSONParse(localStorage.getItem(key));
    if (Array.isArray(local)) return local;
    return Array.isArray(windowVal) ? windowVal : [];
  }

  function getLocalOrWindowObject(key, windowVal){
    const local = safeJSONParse(localStorage.getItem(key));
    if (local && typeof local === "object" && !Array.isArray(local)) return local;
    return (windowVal && typeof windowVal === "object") ? windowVal : {};
  }

  function calcSaldoDevedor(credito, taxaPct, fundoPct){
    const taxa = Number(taxaPct) / 100;
    const fundo = Number(fundoPct) / 100;
    const t = isFinite(taxa) ? taxa : 0;
    const f = isFinite(fundo) ? fundo : 0;
    return Math.max(0, credito) * (1 + t + f);
  }

  // Média ponderada com pesos crescentes (mais recente = maior peso)
  function medianOf(arr){
    const a = (Array.isArray(arr) ? arr : []).map(Number).filter(Number.isFinite).slice().sort((x,y)=>x-y);
    const n = a.length;
    if (!n) return 0;
    const m = Math.floor(n/2);
    return (n % 2) ? a[m] : ((a[m-1] + a[m]) / 2);
  }

  function weightedMean(values){
    const v = (values || []).map(Number).filter(x => isFinite(x));
    if (!v.length) return 0;
    let wSum = 0;
    let vwSum = 0;
    for (let i = 0; i < v.length; i++){
      const w = (i + 1); // 1..N (mais recente = maior peso)
      wSum += w;
      vwSum += v[i] * w;
    }
    return wSum ? (vwSum / wSum) : 0;
  }

  function takeLastN(values, n){
    const v = (values || []).slice();
    if (!v.length) return [];
    const nn = Math.max(1, Math.floor(n || 1));
    return v.slice(Math.max(0, v.length - nn));
  }

  
  // Média ponderada com pesos crescentes (mais recente = maior peso)
  function weightedMeanOf(arr){
    const v = (Array.isArray(arr) ? arr : []).map(Number).filter(Number.isFinite);
    const n = v.length;
    if (!n) return 0;
    let wSum = 0;
    let vwSum = 0;
    for (let i = 0; i < n; i++){
      const w = i + 1; // último elemento (mais recente) recebe maior peso
      wSum += w;
      vwSum += v[i] * w;
    }
    return wSum ? (vwSum / wSum) : 0;
  }

function sampleStd(values){
    const v = (values || []).map(Number).filter(x => isFinite(x));
    const n = v.length;
    if (n <= 1) return 0;
    const mean = v.reduce((a,b)=>a+b,0) / n;
    const varSum = v.reduce((a,b)=>a + Math.pow(b-mean,2), 0);
    return Math.sqrt(varSum / (n - 1));
  }

  // Lance sugerido em % = média ponderada (últimos 6 períodos) + DP (últimos 6 períodos)
  function suggestedPctForGroup(grupo){
    const db = window.LANCE_DB || {};
    const rec = db[String(grupo)];
    if (!rec || !Array.isArray(rec.lances)) return 0;

    // Desconsidera períodos com 0% (grupo ainda não ativo) e valores <= 1%
    // Período 1 = mais antigo, Período 12 = mais recente (com maior peso)
    const serieAll = rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1);

    // Base: últimos 12 períodos válidos (quando existir). Se tiver menos, usa o que houver.
    const serie = takeLastN(serieAll, 12);

    const mediaPonderada = weightedMeanOf(serie); // peso maior para o mais recente
    const dp = sampleStd(serie);

    // Fórmula solicitada: média ponderada + DP  (a margem de segurança é aplicada em getCalculatedLance)
    const pct = mediaPonderada + dp;
    return Math.max(0, pct);
  }

  // Regra de exclusão: se a série histórica tiver uma sequência fixa de 20% (place-holder),
  // removemos o grupo dos resultados.
  function hasFixedTwentySequence(grupo){
    const db = window.LANCE_DB || {};
    const rec = db[String(grupo)];
    if (!rec || !Array.isArray(rec.lances)) return false;
    // considera apenas períodos válidos (> 1%)
    const serie = rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1);
    if (!serie.length) return false;
    // Verifica sequência fixa de 20%: 6 ou mais períodos consecutivos iguais a 20.00
    const is20 = (v)=> Math.abs(v - 20) < 1e-6;
    let run = 0;
    for (const v of serie){
      if (is20(v)){
        run++;
        if (run >= 6) return true;
      } else {
        run = 0;
      }
    }
    return false;
  }

  // Assertividade: quantos períodos (ex.: 12) o % sugerido teria "coberto" o lance mínimo histórico.
  // Regra: acerto quando pct_sugerido >= lance_min_do_periodo.
  const _assertCache = new Map();
  function assertForGroup(grupo){
    const key = String(grupo);
    if (_assertCache.has(key)) return _assertCache.get(key);
    const db = window.LANCE_DB || {};
    const rec = db[key];
    const lancesAll = (rec && Array.isArray(rec.lances)) ? rec.lances.map(Number).filter(x => Number.isFinite(x) && x > 1) : [];
    const lances = takeLastN(lancesAll, 6);
    const n = lances.length || 0;
    const pctSug = suggestedPctForGroup(grupo);
    let hits = 0;
    for (const x of lances){
      if (pctSug >= x) hits++;
    }
    const pct = n ? (hits / n) * 100 : 0;
    const out = { hits, n, pct };
    _assertCache.set(key, out);
    return out;
  }

  const creditoEl = document.getElementById("credito");
  const grupoEspecificoEl = document.getElementById("grupoEspecifico");
  const lanceEl = document.getElementById("lance");
  const lanceTipoEl = document.getElementById("lanceTipo");
  const prazoEl = document.getElementById("prazo");
  const parcelaEl = document.getElementById("parcela");
  const btnBuscar = document.getElementById("btnBuscar");
  const btnLimpar = document.getElementById("btnLimpar");
  const btnExport = document.getElementById("btnExport");
  const selectAllEl = document.getElementById("selectAll");
  const tbody = document.getElementById("tbody");
  const statusBase = document.getElementById("statusBase");
  const exportModal = document.getElementById("exportModal");
  const exportSummary = document.getElementById("exportSummary");
  const dataAssembleiaEl = document.getElementById("dataAssembleia");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const btnCancelExport = document.getElementById("btnCancelExport");
  const btnConfirmExport = document.getElementById("btnConfirmExport");

  // Operações Estruturadas (OE)
  const oeCreditoEl = document.getElementById("oeCredito");
  const oeQtdEl = document.getElementById("oeQtd");
  const oeLanceEl = document.getElementById("oeLance");
  const oeLanceTipoEl = document.getElementById("oeLanceTipo");
  const oePrazoMinEl = document.getElementById("oePrazoMin");
  const oePrazoMaxEl = document.getElementById("oePrazoMax");
  const oeBuscarBtn = document.getElementById("oeBuscar");
  const oeLimparBtn = document.getElementById("oeLimpar");
  const oeExportBtn = document.getElementById("oeExport");
  const oeSelectAllEl = document.getElementById("oeSelectAll");
  const oeTbody = document.getElementById("oeTbody");
  const oeResumoEl = document.getElementById("oeResumo");
  const oeResumo2El = document.getElementById("oeResumo2");
  const oeParcelasDemoEl = document.getElementById("oeParcelasDemo");
  const oeStatusEl = document.getElementById("oeStatus");

  // Configurações (salvas no navegador)
  const btnSettings = document.getElementById("btnSettings");
  const settingsModal = document.getElementById("settingsModal");
  const btnCloseSettings = document.getElementById("btnCloseSettings");
  const btnSalvarSettings = document.getElementById("btnSalvarSettings");
  const btnOpenQualidade = document.getElementById("btnOpenQualidade");
  const cfgPdfMargins = document.getElementById("cfgPdfMargins");
  const cfgMargemSeguranca = document.getElementById("cfgMargemSeguranca");
  const cfgMaxLinhas = document.getElementById("cfgMaxLinhas");
  const cfgFormatoLance = document.getElementById("cfgFormatoLance");
  const cfgTabelaSimplificada = document.getElementById("cfgTabelaSimplificada");
  const cfgMostrarExplicacoes = document.getElementById("cfgMostrarExplicacoes");
  const cfgModoDiagnostico = document.getElementById("cfgModoDiagnostico");

  // Qualidade da base
  const btnQualidadeBase = document.getElementById("btnQualidadeBase");
  const qualityModal = document.getElementById("qualityModal");
  const qualityBody = document.getElementById("qualityBody");
  const btnCloseQuality = document.getElementById("btnCloseQuality");
  const btnCloseQuality2 = document.getElementById("btnCloseQuality2");
  const btnRestaurarBaseOriginal = document.getElementById("btnRestaurarBaseOriginal");


  // OE – Resultado "Customizada"
  const oeCTbody = document.getElementById("oeCTbody");
  const oeCSelectAllEl = document.getElementById("oeCSelectAll");
  const oeCResumoEl = document.getElementById("oeCResumo");
  const oeCResumo2El = document.getElementById("oeCResumo2");
  const oeCStatusEl = document.getElementById("oeCStatus");
  const oeCExportBtn = document.getElementById("oeCExport");

  // OE – modo de resultado (ComboAuto / Custom)
  const oeModeComboEl = document.getElementById("oeModeCombo");
  const oeModeCustomEl = document.getElementById("oeModeCustom");
  const oeComboBlockEl = document.getElementById("oeComboBlock");
  const oeCustomBlockEl = document.getElementById("oeCustomBlock");
  const oeCParcelasDemoEl = document.getElementById("oeCParcelasDemo");



  let latestRowsOE = [];
  let oeWasCleared = true;
  let _oeParcelasRanges = [];
  let _oeTotals = null;


  let latestRowsOECustom = [];
  let _oeCTotals = null;

  // último crédito-alvo usado na planilha Customizada (para re-render/recalcular sem perder contexto)
  let _oeCCreditoAlvo = null;

  function oeApplyMode(){
    // Garante exclusividade entre as caixas
    const comboChecked = !!(oeModeComboEl && oeModeComboEl.checked);
    const customChecked = !!(oeModeCustomEl && oeModeCustomEl.checked);

    if (comboChecked && customChecked){
      // Se ambos, prioriza o que foi marcado por último (tratado no listener); aqui força ComboAuto.
      if (oeModeCustomEl) oeModeCustomEl.checked = false;
    } else if (!comboChecked && !customChecked){
      if (oeModeComboEl) oeModeComboEl.checked = true;
    }

    const isCustom = !!(oeModeCustomEl && oeModeCustomEl.checked);

    if (oeComboBlockEl) oeComboBlockEl.classList.toggle("hidden", isCustom);
    if (oeCustomBlockEl) oeCustomBlockEl.classList.toggle("hidden", !isCustom);
  }

  if (oeModeComboEl){
    oeModeComboEl.addEventListener("change", ()=>{
      if (oeModeComboEl.checked && oeModeCustomEl) oeModeCustomEl.checked = false;
      oeApplyMode();
    });
  }
  if (oeModeCustomEl){
    oeModeCustomEl.addEventListener("change", ()=>{
      if (oeModeCustomEl.checked && oeModeComboEl) oeModeComboEl.checked = false;
      oeApplyMode();
    });
  }
  // Inicializa modo ao carregar
  oeApplyMode();



  // Contexto atual para exportação (propostas ou OE)
  let _exportCtx = { kind: "propostas" };

  // Atualização de bases (xlsx)
  const fileLancesEl = document.getElementById("fileLances");
  const fileGruposEl = document.getElementById("fileGrupos");
  const fileApelidosEl = document.getElementById("fileApelidos");
  const btnUploadLances = document.getElementById("btnUploadLances");
  const btnUploadGrupos = document.getElementById("btnUploadGrupos");
  const btnUploadApelidos = document.getElementById("btnUploadApelidos");
  const btnClearLocal = document.getElementById("btnClearLocal");
  const statusUpdates = document.getElementById("statusUpdates");
  let latestRows = [];

  // Mantém seleção das linhas da aba Propostas ao alternar entre abas/re-renderizações
  const selectedProposalKeys = new Set();
  // Mantém quais linhas estão expandidas (bloco de explicação/score/simulador)
  const expandedProposalKeys = new Set();
  const proposalRowKey = (row) => {
    const g = String(row?.grupo ?? "").trim();
    const p = String(row?.prazoInicial ?? "").trim();
    const c = Math.round(Number(row?.totalCredito ?? 0));
    return `${g}|${p}|${c}`;
  };

// Mantém seleção das linhas da aba Operações Estruturadas ao alternar entre abas/re-renderizações
const selectedOEKeys = new Set();
const oeRowKey = (row) => {
  const g = String(row?.grupo ?? "").trim();
  const p = String(row?.prazoInicial ?? "").trim();
  const c = Math.round(Number(row?.totalCredito ?? 0));
  return `${g}|${p}|${c}`;
};

// Mantém seleção das linhas do resultado Customizada (Operações Estruturadas)
const selectedOECustomKeys = new Set();
const oeCustomRowKey = (row) => {
  const g = String(row?.grupo ?? "").trim();
  const p = String(row?.prazoInicial ?? "").trim();
  return `${g}|${p}`;
};



  // ---------- Explicação / Score / Simulador (Propostas) ----------
  function getSerieValid(grupo){
    const db = window.LANCE_DB || {};
    const rec = db[String(grupo)];
    if (!rec || !Array.isArray(rec.lances)) return [];
    return rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1);
  }

  function qualityScoreForRow(row){
    const g = String(row?.grupo || '').trim();
    const serieAll = getSerieValid(g);
    const last12 = takeLastN(serieAll, 12);
    const mediana = medianOf(last12);
    const dp = sampleStd(last12);
    const pct = Number(row?.lancePctSug || 0);
    const assert = row?.assert || assertForGroup(g);
    const assertPct = Math.max(0, Math.min(100, Number(assert?.pct || 0)));

    // Distância em "desvios padrão" (quanto mais perto da mediana histórica, melhor)
    const denom = (dp && isFinite(dp)) ? dp : 1;
    const z = denom ? Math.abs(pct - mediana) / denom : 0;

    // Score coerente: 80% vem da aderência ao histórico (assertividade), 20% vem do alinhamento do percentual
    let score = (assertPct * 0.80);

    // bônus/penalidade por alinhamento com a faixa histórica
    if (z <= 1.0) score += 20;
    else if (z <= 1.5) score += 12;
    else if (z <= 2.0) score += 5;
    else if (z <= 2.5) score -= 5;
    else score -= 12;

    score = Math.max(0, Math.min(100, score));

    let label = 'Boa';
    let tone = 'good';
    if (score >= 85){ label = 'Excelente'; tone = 'excellent'; }
    else if (score >= 70){ label = 'Ótima'; tone = 'great'; }
    else if (score >= 55){ label = 'Boa'; tone = 'good'; }
    else { label = 'Agressiva'; tone = 'aggressive'; }

    return { score, label, tone, mediana, dp, assertPct, z, last12Count: last12.length };
  }

  function explanationForRow(row){
    const g = String(row?.grupo || '').trim();
    const pct = Number(row?.lancePctSug || 0);
    const a = row?.assert || assertForGroup(g);
    const serieAll = getSerieValid(g);
    const last12 = takeLastN(serieAll, 12);

    const q = qualityScoreForRow(row);
    const margem = Number(USER_SETTINGS && USER_SETTINGS.margemSeguranca != null ? USER_SETTINGS.margemSeguranca : 2.5) || 0;

    const parts = [];
    parts.push(`Este resultado usa o histórico do grupo (até os últimos ${q.last12Count || 0} períodos válidos).`);
    parts.push(`Lance sugerido = <b>mediana + DP + margem</b>. Margem atual: <b>${formatPct(margem)}</b>.`);

    if (a && a.n){
      parts.push(`Qualidade (aderência ao histórico): <b>${a.hits}/${a.n}</b> períodos (≈ <b>${Math.round(a.pct)}%</b>). Quanto maior, melhor.`);
    } else {
      parts.push('Qualidade (aderência ao histórico): sem dados suficientes de assertividade para este grupo.');
    }

    if (last12.length && isFinite(q.mediana) && isFinite(q.dp)){
      const faixaInf = q.mediana - q.dp;
      const faixaSup = q.mediana + q.dp;

      if (pct >= faixaInf && pct <= faixaSup){
        parts.push('O percentual sugerido está <b>dentro</b> da faixa mais comum (mediana ± 1 DP).');
      } else if (q.z <= 2){
        parts.push('O percentual sugerido está <b>um pouco fora</b> do padrão (entre 1 e 2 DP).');
      } else {
        parts.push('O percentual sugerido está <b>bem afastado</b> do padrão (acima de 2 DP), ficando mais agressivo.');
      }

      parts.push(`Referência do histórico: mediana ≈ <b>${formatPct(q.mediana)}</b> e DP ≈ <b>${formatPct(q.dp)}</b>.`);
    }

    parts.push('Parcelas pós-lance e prazo pós-lance são recalculados com base no lance aplicado, mantendo as regras existentes.');
    return parts.join(' ');
  }


  function applyPctToRow(row, pct){
    const pctN = Number(pct);
    if (!isFinite(pctN) || pctN < 0) return false;
    const lance = (Number(row.totalCredito||0) * pctN) / 100;
    row.lanceSug = Math.max(0, lance);
    row.lancePctSug = pctN;
    const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, row.lanceSug, row.prazoInicial);
    row.parcelaPos = calc.parcelaPos;
    row.prazoPos = calc.prazoPos;
    // atualiza assert (não depende do pct editado, mas mantemos a mesma referência)
    row.assert = row.assert || assertForGroup(row.grupo);
    return true;
  }


  // Bases (preferência para versões atualizadas em localStorage)
  const raw = getLocalOrWindowArray(STORAGE_KEYS.databank, window.DATABANK);
  const LANCE_DB = getLocalOrWindowObject(STORAGE_KEYS.lances, window.LANCE_DB);
  const APELIDOS = getLocalOrWindowObject(STORAGE_KEYS.apelidos, window.APELIDOS);
  window.DATABANK = raw;
  window.LANCE_DB = LANCE_DB;
  window.APELIDOS = APELIDOS;

  statusBase.textContent = raw.length ? `Base carregada: ${raw.length} linhas` : "Base vazia";

  // --------- Qualidade da base (validação automática) ---------
  let __BASE_QUALITY = { criticalErrors: [], warnings: [], info: {} };
  let __BASE_OK = true;
  try{
    if (CORE && CORE.validateDatabank){
      const baseRes = CORE.validateDatabank(raw);
      const lanceRes = CORE.validateLanceDb(window.LANCE_DB || {});
      const histRes = CORE.groupsWithInsufficientHistory(raw, window.LANCE_DB || {}, 12);
      __BASE_QUALITY = CORE.summarizeQuality(baseRes, lanceRes, histRes);
      __BASE_OK = (__BASE_QUALITY.criticalErrors || []).length === 0;
    }
  }catch(e){
    __BASE_OK = true;
  }

  // Identificação visual da origem da base (original ou atualizada)
  function baseOriginLabel(){
    const hasLocal = !!localStorage.getItem(STORAGE_KEYS.databank) || !!localStorage.getItem(STORAGE_KEYS.lances) || !!localStorage.getItem(STORAGE_KEYS.apelidos);
    return hasLocal ? 'Atualizada (local)' : 'Original (embutida)';
  }

  function baseUpdatedAtLabel(){
    const ts = localStorage.getItem(STORAGE_KEYS.updatedAt);
    if (!ts) return '—';
    const d = new Date(ts);
    if (!isFinite(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  }

  // Sinaliza problemas de base logo na tela
  try{
    if (statusBase){
      const extra = __BASE_OK ? '' : ' • ⚠ Base com inconsistências (veja Qualidade da base)';
      statusBase.textContent = raw.length ? `Base carregada: ${raw.length} linhas • Origem: ${baseOriginLabel()} • Atualização: ${baseUpdatedAtLabel()}${extra}` : `Base vazia • Origem: ${baseOriginLabel()} • Atualização: ${baseUpdatedAtLabel()}${extra}`;
    }
  }catch(e){}

  // index: grupo -> prazo -> itens[]
  const index = new Map();
  for (const r of raw){
    const g = String(r["Grupo"]);
    if (g === "0" || g === "0.0") continue;
    const p = Number(r["Prazo"]);
    const credito = Number(r["Valor do Crédito"] ?? r["Crédito"] ?? r["Valor do credito"] ?? r["valor_do_credito"]);
    const taxaPct = (r["Taxa de Administração %"] ?? r["Taxa Adm %"] ?? 0);
    const fundoPct = (r["Fundo de Reserva %"] ?? r["Fundo %"] ?? 0);
    const saldo = calcSaldoDevedor(credito, taxaPct, fundoPct);
    const parcela = saldo / p;
    const segmento = (r["Segmento"] ?? "");
    if (!isFinite(p) || !isFinite(credito) || !isFinite(parcela)) continue;

    if (!index.has(g)) index.set(g, new Map());
    const m = index.get(g);
    if (!m.has(p)) m.set(p, []);
    m.get(p).push({ credito, parcela, saldo, taxa: Number(taxaPct), fundo: Number(fundoPct), segmento });
  }
  // ordenar por crédito
  for (const [,m] of index){
    for (const [,arr] of m){
      arr.sort((a,b)=>a.credito-b.credito);
    }
  }

  function getManualLance(totalCredito){
    const v = Number(lanceEl.value);
    if (!isFinite(v) || v <= 0) return 0;
    const tipo = (lanceTipoEl && lanceTipoEl.value) ? lanceTipoEl.value : "reais";
    if (tipo === "percentual"){
      return totalCredito * (v/100);
    }
    return v;
  }

  // Lance calculado (reais) a partir do % sugerido.
  // extraPct: ajuste em pontos percentuais (ex.: +5pp na aba Propostas).
  function getCalculatedLance(grupo, totalCredito, extraPct){
    const add = Number(extraPct) || 0;
    const margem = Number(USER_SETTINGS && USER_SETTINGS.margemSeguranca != null ? USER_SETTINGS.margemSeguranca : 2.5) || 0;

    // Fórmula solicitada: média ponderada dos períodos + DP + margem de segurança (+ eventual ajuste adicional)
    // Observação: retirado o ajuste de “cobertura do histórico” conforme solicitado.
    let pct = suggestedPctForGroup(grupo) + margem + add;

    // Proteções básicas
    pct = clamp(pct, 0, 100);

    const cred = Math.max(0, Number(totalCredito) || 0);
    const lanceReais = cred * (pct / 100);
    return round2(lanceReais);
  }

  function formatPct(n){
    if (CORE && CORE.fmtPct) return CORE.fmtPct(n);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  }

  function groupPublicName(grupo){
    const m = window.APELIDOS || {};
    const k = String(grupo);
    const v = m[k];
    return (typeof v === "string" && v.trim()) ? v.trim() : k;
  }

function groupAliasMini(grupo){
  const k = String(grupo);
  const pub = groupPublicName(grupo);
  if (!pub || String(pub) === k) return "";
  return ` <span class="miniTag">(${pub})</span>`;
}

function miniPctBrlCell(pct, brl){
  const p = Number(pct||0);
  const v = Number(brl||0);
  return `<div class="miniCell"><div class="miniMain">${formatPct(p)}</div><div class="miniSecondary">${fmtBRL(v)}</div></div>`;
}

  function calcParcelaPos(totalSaldoDevedor, parcelaInicial, lanceReais, prazoInicial){
    const prazoPos = Math.max(1, prazoInicial - 1);
    const lance = Math.max(0, Number(lanceReais) || 0);
    const parcIni = Math.max(0, Number(parcelaInicial) || 0);
    const saldoIni = Math.max(0, Number(totalSaldoDevedor) || 0);
    const saldoPos = Math.max(0, saldoIni - (parcIni + lance));
    return { prazoPos, parcelaPos: saldoPos / prazoPos, saldoPos };
  }

  function withinMargin(total, target){
    const min = target * 0.95;
    const max = target * 1.20;
    return total >= min && total <= max;
  }

  // Gera combinações (mesmo grupo e mesmo prazo) respeitando limites por segmento.
// Permite repetição de cotas (junção) e limita busca para manter performance.
  function combosForGroupPrazo(items, target, segmento, opts){
    const min = target * 0.95;
    const max = target * 1.20;

    const seg = String(segmento || "").toUpperCase().trim();

    // Limites por segmento:
    // - MAUTO: mantém limite de crédito por operação dentro do segmento.
    // - Demais segmentos (AUTO-IPCA, AUTO-FIPE, PESADOS, etc.): não limitar soma por segmento;
    //   limitar apenas quantidade de cotas por performance.
    let maxTotalCredito = Infinity;
    let maxCotas = 3;

    if (seg.includes("MAUTO") || seg.includes("MOTO")){
      maxTotalCredito = (opts && Number(opts.motoMautoLimit) > 0) ? Number(opts.motoMautoLimit) : 175000;
      maxCotas = 8;
    } else {
      // Sem limite de soma por segmento (permitir somar "tanto quanto necessário")
      maxTotalCredito = Infinity;
      maxCotas = 80; // limite alto apenas para manter performance
    }

    // aplica teto da margem de busca (e, no MAUTO, o teto do segmento)
    const hardMax = isFinite(maxTotalCredito) ? Math.min(max, maxTotalCredito) : max;


    // agrupa tipos únicos (por crédito + taxa + fundo)
    const map = new Map();
    for (const it of items){
      const key = `${it.credito}|${it.taxa}|${it.fundo}`;
      if (!map.has(key)) map.set(key, it);
    }
    let types = Array.from(map.values());
    // prioriza tipos com crédito mais próximo do alvo (melhora qualidade e performance)
    types.sort((a,b)=>Math.abs(a.credito-target)-Math.abs(b.credito-target));
    // limita o número de tipos considerados para evitar explosão combinatória
    const MAX_TYPES = 12;
    if (types.length > MAX_TYPES) types = types.slice(0, MAX_TYPES);

    const out = [];
    const seen = new Set();

    function pushCombo(totalCredito, totalParcela, totalSaldo, totalTaxReais, totalFundoReais){
  if (!isFinite(totalCredito) || totalCredito <= 0) return;
  if (totalCredito > hardMax) return;
  if (totalCredito < min || totalCredito > max) return;

  const taxR = isFinite(totalTaxReais) ? Number(totalTaxReais) : 0;
  const funR = isFinite(totalFundoReais) ? Number(totalFundoReais) : 0;
  const taxaPct = totalCredito ? (taxR / totalCredito) * 100 : 0;
  const fundoPct = totalCredito ? (funR / totalCredito) * 100 : 0;

  const key = `${Math.round(totalCredito*100)}|${Math.round(totalParcela*100)}|${Math.round(totalSaldo*100)}|${Math.round(taxaPct*100)}|${Math.round(fundoPct*100)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ totalCredito, totalParcela, totalSaldo, taxaPct, fundoPct, taxaReais: taxR, fundoReais: funR });
}

    // 1) repetições de um único tipo (n cotas iguais)
    for (const t of types){
      const maxN = Math.min(maxCotas, Math.floor(hardMax / t.credito));
      for (let n=1; n<=maxN; n++){
        pushCombo(n*t.credito, n*t.parcela, n*t.saldo, n*t.credito*(Number(t.taxa||0)/100), n*t.credito*(Number(t.fundo||0)/100));
      }
    }
    // 2) combinações de N tipos (multiset), com busca dirigida para aproximar o target
    // Observação: para manter performance, limitamos profundidade/estados e usamos um "catálogo" reduzido (MAX_TYPES).
    const MAX_STATES = 2500;
    const MAX_DEPTH = Math.min(maxCotas, 8); // limite prático de tipos/contagens para não explodir

    // ordena por maior crédito primeiro (ajuda o greedy)
    const typesByCred = types.slice().sort((a,b)=>b.credito-a.credito);

    function dfs(idx, usedCotas, sumCred, sumParc, sumSaldo, sumTaxR, sumFunR, states){
      if (states.count++ > MAX_STATES) return;
      if (sumCred > hardMax + 1e-9) return;
      if (usedCotas > maxCotas) return;

      // se já está dentro da janela, registra
      if (sumCred >= min - 1e-9 && sumCred <= max + 1e-9){
        pushCombo(sumCred, sumParc, sumSaldo, sumTaxR, sumFunR);
      }

      if (idx >= typesByCred.length) return;
      if (usedCotas >= MAX_DEPTH) return;

      const t = typesByCred[idx];

      // número máximo de cotas desse tipo
      const maxN = Math.min(
        maxCotas - usedCotas,
        Math.floor((hardMax - sumCred) / t.credito)
      );

      // Busca dirigida: tenta primeiro a quantidade que aproxima do target,
      // depois avalia uma pequena vizinhança em torno dela.
      const idealTotal = Math.min(hardMax, Math.max(min, Math.min(max, target)));
      const idealRemain = idealTotal - sumCred;
      let n0 = Math.round(idealRemain / t.credito);
      if (!isFinite(n0)) n0 = 0;
      const tried = new Set();

      function tryN(n){
        if (n < 0 || n > maxN) return;
        if (tried.has(n)) return;
        tried.add(n);
        const nCred = sumCred + n*t.credito;
        const nParc = sumParc + n*t.parcela;
        const nSaldo = sumSaldo + n*t.saldo;
        const nTaxR = sumTaxR + n*t.credito*(Number(t.taxa||0)/100);
        const nFunR = sumFunR + n*t.credito*(Number(t.fundo||0)/100);
        dfs(idx+1, usedCotas + n, nCred, nParc, nSaldo, nTaxR, nFunR, states);
      }

      // vizinhança curta em torno do n0
      for (let d=-3; d<=3; d++){
        tryN(n0 + d);
      }
      // também tenta 0 (pular o tipo)
      tryN(0);
    }

    // inicia DFS
    dfs(0, 0, 0, 0, 0, 0, 0, { count: 0 });

    // ordenar por proximidade do alvo e por menor crédito (para estabilidade)
    out.sort((x,y)=>{
      const dx = Math.abs(x.totalCredito-target);
      const dy = Math.abs(y.totalCredito-target);
      if (dx !== dy) return dx-dy;
      return x.totalCredito - y.totalCredito;
    });

    return out;
  }

  // Seleção: prioriza amplitude de prazos e menores lances, evitando repetir prazos do mesmo segmento.
// Regras:
// - minRows..maxRows (tenta ao menos minRows quando possível)
// - no máximo 2 opções por prazo
// - evita repetir (segmento, prazo); só relaxa se faltar para atingir minRows
function pickSmart(results, minRows, maxRows, maxGap, strict){
  const byPrazo = new Map();
  for (const r of results){
    const p = r.prazoInicial;
    if (!byPrazo.has(p)) byPrazo.set(p, []);
    byPrazo.get(p).push(r);
  }
  const prazos = Array.from(byPrazo.keys()).sort((a,b)=>a-b);
  if (!prazos.length) return [];

  // ordenar cada prazo por menor lance sugerido
  for (const p of prazos){
    byPrazo.get(p).sort((a,b)=>{
      if (a.lanceSug !== b.lanceSug) return a.lanceSug - b.lanceSug;
      const da = Math.abs(a.totalCredito - Number(creditoEl.value || 0));
      const db = Math.abs(b.totalCredito - Number(creditoEl.value || 0));
      if (da !== db) return da - db;
      return a.parcelaInicial - b.parcelaInicial;
    });
  }

  const picked = [];
  const countPrazo = new Map();
  const usedSegPrazo = new Set();

  const canPick = (r, relaxed) => {
    const p = r.prazoInicial;
    const c = countPrazo.get(p) || 0;
    if (c >= 2) return false;
    const key = `${r.segmento || "—"}|${p}`;
    if (!relaxed && usedSegPrazo.has(key)) return false;
    return true;
  };

  const addPick = (r) => {
    picked.push(r);
    const p = r.prazoInicial;
    countPrazo.set(p, (countPrazo.get(p)||0)+1);
    usedSegPrazo.add(`${r.segmento || "—"}|${p}`);
  };

  // Etapa 1: Âncoras de amplitude (se strict=false, prioriza cobrir prazos com passo ~maxGap)
  if (!strict){
    const minP = prazos[0];
    const maxP = prazos[prazos.length-1];
    const targets = [];
    for (let t=minP; t<=maxP; t+=maxGap) targets.push(t);
    if (targets[targets.length-1] !== maxP) targets.push(maxP);

    function chooseClosestPrazo(target){
      let bestPrazo = null;
      let bestDist = Infinity;
      for (const p of prazos){
        const d = Math.abs(p - target);
        if (d < bestDist){
          bestDist = d;
          bestPrazo = p;
        } else if (d === bestDist && bestPrazo !== null){
          const a = byPrazo.get(p)?.[0];
          const b = byPrazo.get(bestPrazo)?.[0];
          if (a && b && a.lanceSug < b.lanceSug) bestPrazo = p;
        }
      }
      return bestPrazo;
    }

    for (const t of targets){
      if (picked.length >= maxRows) break;
      const p = chooseClosestPrazo(t);
      if (p == null) continue;

      // tentar pegar o melhor desse prazo sem repetir segmento/prazo
      const arr = byPrazo.get(p) || [];
      let chosen = null;
      for (const r of arr){
        if (canPick(r, false)){ chosen = r; break; }
      }
      if (!chosen && arr[0] && canPick(arr[0], true)) chosen = arr[0];
      if (!chosen) continue;

      // evitar repetir exatamente o mesmo registro
      if (picked.some(x => x.grupo===chosen.grupo && x.prazoInicial===chosen.prazoInicial && Math.round(x.totalCredito*100)===Math.round(chosen.totalCredito*100))) continue;
      addPick(chosen);
    }
  }

  // Etapa 2: completa com as mais baratas
  const allSorted = [...results].sort((a,b)=>{
    if (a.lanceSug !== b.lanceSug) return a.lanceSug - b.lanceSug;
    if (a.prazoInicial !== b.prazoInicial) return a.prazoInicial - b.prazoInicial;
    const da = Math.abs(a.totalCredito - Number(creditoEl.value || 0));
    const db = Math.abs(b.totalCredito - Number(creditoEl.value || 0));
    if (da !== db) return da - db;
    return a.parcelaInicial - b.parcelaInicial;
  });

  // primeiro, sem relaxar segmento/prazo
  for (const r of allSorted){
    if (picked.length >= maxRows) break;
    if (picked.some(x => x.grupo===r.grupo && x.prazoInicial===r.prazoInicial && Math.round(x.totalCredito*100)===Math.round(r.totalCredito*100))) continue;
    if (!canPick(r, false)) continue;
    addPick(r);
  }

  // se ainda não atingiu minRows, relaxa repetição de segmento/prazo
  if (picked.length < Math.min(minRows, maxRows)){
    for (const r of allSorted){
      if (picked.length >= maxRows) break;
      if (picked.some(x => x.grupo===r.grupo && x.prazoInicial===r.prazoInicial && Math.round(x.totalCredito*100)===Math.round(r.totalCredito*100))) continue;
      if (!canPick(r, true)) continue;
      addPick(r);
      if (picked.length >= minRows) break;
    }
  }

  picked.sort((a,b)=>{
    if (a.prazoInicial !== b.prazoInicial) return a.prazoInicial - b.prazoInicial;
    return a.lanceSug - b.lanceSug;
  });

  return picked;
}

  function search(){
    const creditoTarget = Number(creditoEl.value);
    if (!isFinite(creditoTarget) || creditoTarget <= 0){
      renderEmpty("Informe um valor de crédito válido.");
      creditoEl.focus();
      return;
    }

    const prazoDesejado = Number(prazoEl.value);
    const parcelaDesejada = Number(parcelaEl.value);
    const hasPrazo = isFinite(prazoDesejado) && prazoDesejado > 0;
    const hasParcela = isFinite(parcelaDesejada) && parcelaDesejada > 0;
    const hasLance = (Number(lanceEl.value) > 0) && isFinite(Number(lanceEl.value));

    // Grupo específico (opcional): normaliza para comparação/consulta consistente.
    // Remove caracteres não numéricos para evitar falsos positivos de duplicidade.
    const grupoEspecifico = String((grupoEspecificoEl && grupoEspecificoEl.value) ? grupoEspecificoEl.value : "")
      .trim()
      .replace(/\D+/g, "");
    const isGrupoMode = !!grupoEspecifico;

    // Modo "grupo específico": adiciona 1 opção por clique (até 5) e preserva o que já está na tela
    if (isGrupoMode){
      // limita resultados acumulados
      if (Array.isArray(latestRows) && latestRows.length >= 5){
          alert("Não posso gerar o PDF por segurança. Motivos:\n• " + msg);
        return;
      }
      // evita duplicar o mesmo grupo
      if (Array.isArray(latestRows) && latestRows.some(r => String(r.grupo) === grupoEspecifico)){
        alert(`O grupo ${grupoEspecifico} já está nos resultados. Informe outro grupo ou clique em Limpar.`);
        return;
      }

      const mp = index.get(grupoEspecifico);
      if (!mp){
        alert(`Grupo ${grupoEspecifico} não encontrado na base de grupos ativos.`);
        return;
      }

      // Exclui grupos com sequência fixa de 20% na série histórica
      if (hasFixedTwentySequence(grupoEspecifico)){
        alert(`O grupo ${grupoEspecifico} foi excluído por apresentar sequência fixa de 20% na série histórica.`);
        return;
      }

      const scoped = [];
      for (const [prazo, items] of mp){
        if (hasPrazo){
          const minP = prazoDesejado * 0.80;
          const maxP = prazoDesejado * 1.20;
          if (prazo < minP || prazo > maxP) continue;
        }

        const segmento = (items[0]?.segmento ?? (window.LANCE_DB?.[String(grupoEspecifico)]?.segmento ?? ""));
        const combos = combosForGroupPrazo(items, creditoTarget, segmento);

        for (const c of combos){
          if (!withinMargin(c.totalCredito, creditoTarget)) continue;

          const lanceSug = getCalculatedLance(grupoEspecifico, c.totalCredito, 0); // margem de segurança (Configurações)
          const { prazoPos, parcelaPos } = calcParcelaPos(c.totalSaldo, c.totalParcela, lanceSug, prazo);

          if (hasLance){
            const manual = getManualLance(c.totalCredito);
            if (manual > 0){
              const minL = manual * 0.50;
              const maxL = manual * 1.30;
              if (lanceSug < minL || lanceSug > maxL) continue;
            }
          }
          if (hasParcela){
            if (parcelaPos < parcelaDesejada * 0.70 || parcelaPos > parcelaDesejada * 1.30) continue;
          }

          const lancePctSug = c.totalCredito ? (lanceSug / c.totalCredito) * 100 : 0;
          const assert = assertForGroup(grupoEspecifico);
          scoped.push({
            grupo: grupoEspecifico,
            segmento,
            totalCredito: c.totalCredito,
            prazoInicial: prazo,
            parcelaInicial: c.totalParcela,
            totalSaldo: c.totalSaldo,
            taxaAdmReais: Number(c.taxaReais||0),
            fundoResReais: Number(c.fundoReais||0),
            taxaAdmPct: Number(c.taxaPct||0),
            fundoResPct: Number(c.fundoPct||0),
            taxaAdmReais: Number(c.taxaReais||0),
            fundoResReais: Number(c.fundoReais||0),
            lanceSug,
            lancePctSug,
            assert,
            parcelaPos,
            prazoPos
          });
        }
      }

      scoped.sort((a,b)=>{
        // menor lance sugerido primeiro; depois proximidade do crédito alvo
        if (a.lanceSug !== b.lanceSug) return a.lanceSug - b.lanceSug;
        const da = Math.abs(a.totalCredito - creditoTarget);
        const db = Math.abs(b.totalCredito - creditoTarget);
        if (da !== db) return da - db;
        return a.parcelaInicial - b.parcelaInicial;
      });

      const best = scoped[0];
      if (!best){
        alert(`Nenhuma opção encontrada para o grupo ${grupoEspecifico} com os filtros atuais.`);
        return;
      }

      // adiciona e re-renderiza (mantém os anteriores)
      const merged = (Array.isArray(latestRows) ? latestRows.slice() : []);
      merged.push(best);
      renderTable(merged);
      // limpa o campo para evitar que o usuário clique novamente sem perceber
      // (e também elimina edge cases em que alguns navegadores mantêm um valor anterior)
      if (grupoEspecificoEl) grupoEspecificoEl.value = "";
      return;
    }

    const results = [];

    for (const [grupo, mp] of index){
      // Exclui grupos com sequência fixa de 20% na série histórica
      if (hasFixedTwentySequence(grupo)) continue;
      for (const [prazo, items] of mp){
        if (hasPrazo){
          const minP = prazoDesejado * 0.80;
          const maxP = prazoDesejado * 1.20;
          if (prazo < minP || prazo > maxP) continue;
        }

        const segmento = (items[0]?.segmento ?? (window.LANCE_DB?.[String(grupo)]?.segmento ?? ""));

        // combinações até 3
        const combos = combosForGroupPrazo(items, creditoTarget, segmento);

        for (const c of combos){
          if (!withinMargin(c.totalCredito, creditoTarget)) continue;

          const lanceSug = getCalculatedLance(grupo, c.totalCredito, 0); // margem de segurança (Configurações)
          const { prazoPos, parcelaPos } = calcParcelaPos(c.totalSaldo, c.totalParcela, lanceSug, prazo);

          if (hasLance){
            const manual = getManualLance(c.totalCredito);
            if (manual > 0){
              const minL = manual * 0.50;
              const maxL = manual * 1.30;
              if (lanceSug < minL || lanceSug > maxL) continue;
            }
          }

          if (hasParcela){
            // parcela pós-lance: até 20% acima do desejado; sem limite para baixo
            if (parcelaPos < parcelaDesejada * 0.70 || parcelaPos > parcelaDesejada * 1.30) continue;
          }

          const lancePctSug = c.totalCredito ? (lanceSug / c.totalCredito) * 100 : 0;
          const assert = assertForGroup(grupo);

          results.push({
            grupo,
            segmento,
            totalCredito: c.totalCredito,
            prazoInicial: prazo,
            parcelaInicial: c.totalParcela,
            totalSaldo: c.totalSaldo,
            taxaAdmPct: Number(c.taxaPct||0),
            fundoResPct: Number(c.fundoPct||0),
            taxaAdmReais: Number(c.taxaReais||0),
            fundoResReais: Number(c.fundoReais||0),
            lanceSug,
            lancePctSug,
            assert,
            parcelaPos,
            prazoPos
          });
        }
      }
    }

    // Ordenação (Propostas):
    // 1) prazo crescente
    // 2) proximidade do crédito alvo e reordenar por prazo crescente
    // 3) parcela inicial e reordenar por prazo crescente
    function stableSort(arr, cmp){
      return arr
        .map((v,idx)=>({v,idx}))
        .sort((a,b)=>{
          const c = cmp(a.v,b.v);
          return c !== 0 ? c : (a.idx - b.idx);
        })
        .map(x=>x.v);
    }

    results.splice(0, results.length, ...stableSort(results, (a,b)=> (a.prazoInicial||0) - (b.prazoInicial||0)));
    results.splice(0, results.length, ...stableSort(results, (a,b)=>{
      const da = Math.abs((a.totalCredito||0) - creditoTarget);
      const db = Math.abs((b.totalCredito||0) - creditoTarget);
      return da - db;
    }));
    results.splice(0, results.length, ...stableSort(results, (a,b)=> (a.prazoInicial||0) - (b.prazoInicial||0)));
    results.splice(0, results.length, ...stableSort(results, (a,b)=> (a.parcelaInicial||0) - (b.parcelaInicial||0)));
    results.splice(0, results.length, ...stableSort(results, (a,b)=> (a.prazoInicial||0) - (b.prazoInicial||0)));

    const strict = hasPrazo || hasParcela || hasLance;
    const picked = pickSmart(results, 5, 20, 12, strict);
    
    // Se houver seleção ativa e o usuário não clicou em Limpar, preserve os grupos selecionados
    // e complete com novas opções que satisfaçam os filtros (sem duplicar grupos).
    let finalRows = picked;
    try{
      const hasSelection = selectedProposalKeys && selectedProposalKeys.size > 0;
      if (hasSelection && Array.isArray(latestRows) && latestRows.length){
        const kept = latestRows.filter(r => selectedProposalKeys.has(proposalRowKey(r)));
        if (kept.length){
          const keptKeys = new Set(kept.map(r => proposalRowKey(r)));
          const extras = picked.filter(r => !keptKeys.has(proposalRowKey(r)) && !kept.some(k => String(k.grupo) === String(r.grupo)));
          const merged = kept.concat(extras);
          // Mantém o limite máximo de linhas (mesmo comportamento visual anterior)
          finalRows = merged.slice(0, 20);
        }
      }
    }catch(e){}
    renderTable(finalRows);

  }

  function renderEmpty(msg){
    tbody.innerHTML = `<tr class="empty"><td colspan="13">${msg}</td></tr>`;
  }

  function renderTable(rows){
    latestRows = rows.slice();
    try{ rows.sort((a,b)=>(Number(a.prazoInicial||0)-Number(b.prazoInicial||0)) || (Number(a.lanceSug||0)-Number(b.lanceSug||0))); }catch(e){}
    if (selectAllEl) selectAllEl.checked = false;
    if (!rows.length){
      renderEmpty("Nenhuma opção encontrada dentro das regras e margens definidas.");
      return;
    }

    tbody.innerHTML = "";
    const maxTela = Number(USER_SETTINGS && USER_SETTINGS.maxLinhasTela) || rows.length;
    const displayRows = rows.slice(0, Math.max(1, maxTela));
    const infoEl = document.getElementById('limitInfoPropostas');
    if (infoEl){
      infoEl.textContent = (rows.length > displayRows.length)
        ? `Mostrando ${displayRows.length} de ${rows.length} linhas na tela (ajuste em Configurações).`
        : '';
    }

    for (const [idx,row] of displayRows.entries()){
      const rowKey = proposalRowKey(row);
      // guarda o valor original (para o simulador "E se...")
      if (row && row._origPct == null) row._origPct = Number(row.lancePctSug || 0);
      if (row && row._origLance == null) row._origLance = Number(row.lanceSug || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="selectCol"><input class="rowSelect" type="checkbox" data-idx="${idx}" /></td>
        <td>
          ${row.grupo}${groupAliasMini(row.grupo)}${(row.mult && row.mult>1) ? ` <span class="pctMini">(x${row.mult})</span>` : ''}
          <button class="btn ghost mini toggleDetail" type="button" data-key="${rowKey}">Detalhes</button>
        </td>
        <td>
          <button class="btn ghost mini openPainel" type="button" data-grupo="${String(row.grupo)}" data-credito="${Number(row.totalCredito||0)}">Abrir</button>
        </td>
        <td class="cellCredPro">${fmtBRL(row.totalCredito)}</td>
        <td class="cellEditCredPro"></td>
        <td>${row.prazoInicial}</td>
        <td>${fmtBRL(row.parcelaInicial)}</td>
        <td>
          <div class="lanceCell">
            <span class="pctMini">(${formatPct(row.lancePctSug)})</span>
            <input class="inlineInput" type="number" min="0" step="0.01" value="${(row.lanceSug||0).toFixed(2)}" />
          </div>
        </td>
        <td class="cellParcelaPos">${fmtBRL(row.parcelaPos)}</td>
        <td class="cellPrazoPos">${row.prazoPos}</td>
        <td class="cellTaxaAdm">${miniPctBrlCell(row.taxaAdmPct, row.taxaAdmReais)}</td>
        <td class="cellFundoRes">${miniPctBrlCell(row.fundoResPct, row.fundoResReais)}</td>
        <td class="cellAssert">${(row.assert && row.assert.n) ? `(${row.assert.hits}/${row.assert.n}  ${Math.round(row.assert.pct)}%)` : "—"}</td>
      `;
      // restaura seleção (não desmarca ao alternar abas)
      const _cb = tr.querySelector('input.rowSelect');
      if (_cb){
        _cb.checked = selectedProposalKeys.has(rowKey);
        _cb.onchange = () => {
          try{
            if (_cb.checked) selectedProposalKeys.add(rowKey);
            else selectedProposalKeys.delete(rowKey);
          }catch(e){}
        };
      }



      // Edição de crédito (dropdown + multiplicador), como em Operações Estruturadas > Custom
      try{
        const cellEdit = tr.querySelector('.cellEditCredPro');
        if (cellEdit){
          const credits = pGetCreditOptions(row.grupo, row.prazoInicial);
          const unitNow = Number(row.unitCredito || (credits[0] || (row.totalCredito||0)));
          const creditOpts = (credits.length ? credits : [unitNow]).map(v=>{
            const sel = (Number(v) === Number(unitNow)) ? 'selected' : '';
            return `<option value="${Number(v)}" ${sel}>${fmtBRL(v)}</option>`;
          }).join("");
          const multMax = 20;
          const multNow = Number(row.mult||1) || 1;
          const multOpts = Array.from({length: multMax}, (_,i)=>i+1).map(v=>{
            const sel = (Number(v) === Number(multNow)) ? 'selected' : '';
            return `<option value="${v}" ${sel}>x${v}</option>`;
          }).join("");
          cellEdit.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <select class="pUnitSel" style="min-width:150px;">${creditOpts}</select>
              <select class="pMultSel" style="width:90px;">${multOpts}</select>
            </div>
          `;
          const unitSel = cellEdit.querySelector('select.pUnitSel');
          const multSel = cellEdit.querySelector('select.pMultSel');
          const cellCred = tr.querySelector('.cellCredPro');
          const cellParcIni = tr.querySelector('td:nth-child(7)'); // Parcela Inicial (after adding col, positions shift; safer update below)
          const lanceInput = tr.querySelector('input.inlineInput');
          const pctMini = tr.querySelector('.lanceCell .pctMini');
          const cellParcPos = tr.querySelector('.cellParcelaPos');
          const cellPrazoPos = tr.querySelector('.cellPrazoPos');
          const cellTaxa = tr.querySelector('.cellTaxaAdm');
          const cellFundo = tr.querySelector('.cellFundoRes');

          const applyChoice = () => {
            const u = unitSel ? Number(unitSel.value) : unitNow;
            const mlt = multSel ? Number(multSel.value) : Number(row.mult||1);
            pRecalcRowFromChoice(row, u, mlt);

            if (cellCred) cellCred.textContent = fmtBRL(row.totalCredito);
            // Parcela Inicial é a coluna "Parcela Inicial" (busca por texto é caro; pega pelo primeiro td com fmt da parcela inicial)
            try{
              const tds = tr.querySelectorAll('td');
              // Colunas (com novo th): 1 select,2 grupo,3 painel,4 crédito,5 editar,6 prazo,7 parcela inicial,8 lance,9 pós,10 prazo pós,11 taxa,12 fundo,13 assert
              if (tds && tds.length>=13){
                tds[6].textContent = fmtBRL(row.parcelaInicial);
                if (cellTaxa) cellTaxa.innerHTML = miniPctBrlCell(row.taxaAdmPct, row.taxaAdmReais);
                if (cellFundo) cellFundo.innerHTML = miniPctBrlCell(row.fundoResPct, row.fundoResReais);
              }
            }catch(e){}
            if (lanceInput) lanceInput.value = (Number(row.lanceSug||0)).toFixed(2);
            if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
            if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
            if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;

            // atualizar dataset do botão "Abrir" (painel) para refletir crédito atual
            const btnOpen2 = tr.querySelector('button.openPainel');
            if (btnOpen2) btnOpen2.dataset.credito = String(Number(row.totalCredito||0));
          };

          // Lance manual: atualiza cálculos da linha imediatamente
          if (lanceInput){
            lanceInput.addEventListener('input', ()=>{
              try{
                row._userEditedLance = true;
                row.lanceSug = Number(lanceInput.value||0);
                row.lancePctSug = row.totalCredito ? (Number(row.lanceSug||0)/Number(row.totalCredito||1))*100 : 0;
                const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, Number(row.lanceSug||0), row.prazoInicial);
                row.parcelaPos = calc.parcelaPos;
                row.prazoPos = calc.prazoPos;
                if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
                if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
                if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;
              }catch(e){}
            });
          }

          if (unitSel) unitSel.addEventListener('change', applyChoice);
          if (multSel) multSel.addEventListener('change', applyChoice);
        }
      }catch(e){}

      // Botão: abrir grupo no Painel de Lances
      const btnOpen = tr.querySelector('button.openPainel');
      if (btnOpen){
        btnOpen.addEventListener('click', () => {
          const g = String(btnOpen.dataset.grupo || '').trim();
          if (!g) return;
          try{

// expõe referência da linha aberta para permitir aplicar lances do Painel aos campos editáveis desta tabela
window.__GERPRO_LAST_OPEN = { kind: "propostas", grupo: g, rowRef: row };
if (!window.__GERPRO_SET_LANCE_FOR_GROUP){
  window.__GERPRO_SET_LANCE_FOR_GROUP = function(grupo, pct){
    try{
      const g2 = String(grupo||"").trim();
      const r = (latestRows || []).find(x => String(x.grupo) === g2);
      if (!r) return false;
      const pctN = Number(pct);
      if (!isFinite(pctN) || pctN <= 0) return false;
      const lance = (Number(r.totalCredito||0) * pctN) / 100;
      r.lanceSug = lance;
      r.lancePctSug = pctN;
      const calc = calcParcelaPos(r.totalSaldo, r.parcelaInicial, lance, r.prazoInicial);
      r.parcelaPos = calc.parcelaPos;
      r.prazoPos = calc.prazoPos;
      renderTable(latestRows);
      return true;
    }catch(e){ console.error(e); return false; }
  };
}

            // muda para a aba Painel
            const tabPainel = document.querySelector('.tab[data-view="painel"]');
            if (tabPainel) tabPainel.click();

            // preenche e executa busca
            const inputGroup = document.getElementById('lpGroup');
            const inputValor = document.getElementById('lpValorConsorcio');
            const btnBuscarPainel = document.getElementById('lpBuscar');
            if (inputGroup) inputGroup.value = g;
            // também preenche o valor do consórcio no painel com o valor de crédito desta linha
            // (usa o valor numérico bruto para não depender de formatação)
                        if (inputValor) {
              const n = Number(row.totalCredito);
              inputValor.value = Number.isFinite(n)
                ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : String(row.totalCredito || '').trim();
            }
            if (btnBuscarPainel) btnBuscarPainel.click();
          }catch(e){
            console.error(e);
          }
        });
      }

      const input = tr.querySelector("input.inlineInput");
      const pctMini = tr.querySelector(".pctMini");
      const cellParcelaPos = tr.querySelector(".cellParcelaPos");
      const cellPrazoPos = tr.querySelector(".cellPrazoPos");

      input.addEventListener("input", () => {
        // IMPORTANT: o valor editado pelo usuário precisa ser persistido no objeto
        // para que a exportação use exatamente o lance ajustado (e não o sugerido original).
        const lance = Number(input.value);
        const lanceFix = (isFinite(lance) && lance >= 0) ? lance : 0;
        const { prazoPos, parcelaPos } = calcParcelaPos(row.totalSaldo, row.parcelaInicial, lanceFix, row.prazoInicial);

        // Atualiza UI
        cellParcelaPos.textContent = fmtBRL(parcelaPos);
        cellPrazoPos.textContent = prazoPos;
        const pct = row.totalCredito ? (lanceFix / row.totalCredito) * 100 : 0;
        if (pctMini) pctMini.textContent = `(${formatPct(pct)})`;

        // Atualiza dados (exportação)
        row.lanceSug = lanceFix;
        row.lancePctSug = pct;
        row.parcelaPos = parcelaPos;
        row.prazoPos = prazoPos;
      });

      // Se a linha estiver expandida, atualiza score/explicação após o usuário concluir a edição
      input.addEventListener('change', () => {
        try{
          if (expandedProposalKeys.has(rowKey)){
            expandedProposalKeys.add(rowKey);
            renderTable(latestRows);
          }
        }catch(e){}
      });

      tbody.appendChild(tr);

      // Linha expandida (explicação + score + simulador)
      const detailTr = document.createElement('tr');
      detailTr.className = 'detailRow';
      const isOpen = expandedProposalKeys.has(rowKey);
      const q = qualityScoreForRow(row);
      const exp = explanationForRow(row);
      detailTr.innerHTML = `
        <td colspan="13">
          <div class="detailWrap" style="display:${isOpen ? 'block' : 'none'}">
            <div class="detailHead">
              <span class="qScore ${q.tone}">${q.label} <span class="qMini">(${Math.round(q.score)})</span></span>
              <span class="qMeta">Grupo ${row.grupo} • Prazo ${row.prazoInicial} • ${formatPct(row.lancePctSug||0)}</span>
            </div>
            <div class="detailBody">
              <div class="detailText"><strong>Por que esta proposta é adequada:</strong> ${exp}</div>
              <div class="simBox">
                <div class="simTitle"><strong>Simulador “E se…”</strong> (ajusta o lance e recalcula parcelas)</div>
                <div class="simBtns">
                  <button class="btn mini simDelta" type="button" data-delta="0.5" data-key="${rowKey}">+0,5 pp</button>
                  <button class="btn mini simDelta" type="button" data-delta="1" data-key="${rowKey}">+1,0 pp</button>
                  <button class="btn mini simDelta" type="button" data-delta="2" data-key="${rowKey}">+2,0 pp</button>
                  <button class="btn ghost mini simReset" type="button" data-key="${rowKey}">Resetar</button>
                </div>
              </div>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(detailTr);

      // Toggle do bloco de detalhes
      const toggleBtn = tr.querySelector('button.toggleDetail');
      if (toggleBtn){
        toggleBtn.addEventListener('click', () => {
          const k = String(toggleBtn.dataset.key||'');
          if (!k) return;
          if (expandedProposalKeys.has(k)) expandedProposalKeys.delete(k);
          else expandedProposalKeys.add(k);
          renderTable(latestRows);
        });
      }

      // Simulador: aplica variação em pontos percentuais na própria linha
      const simBtns = detailTr.querySelectorAll('button.simDelta');
      simBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const k = String(btn.dataset.key||'');
          const delta = Number(btn.dataset.delta||0);
          if (!isFinite(delta)) return;
          const target = (latestRows || []).find(r => proposalRowKey(r) === k);
          if (!target) return;
          // guarda original, se ainda não existir
          if (target._origPct == null) target._origPct = Number(target.lancePctSug||0);
          const newPct = Math.max(0, Number(target.lancePctSug||0) + delta);
          applyPctToRow(target, newPct);
          expandedProposalKeys.add(k);
          renderTable(latestRows);
        });
      });
      const resetBtn = detailTr.querySelector('button.simReset');
      if (resetBtn){
        resetBtn.addEventListener('click', () => {
          const k = String(resetBtn.dataset.key||'');
          const target = (latestRows || []).find(r => proposalRowKey(r) === k);
          if (!target) return;
          const back = (target._origPct != null) ? Number(target._origPct) : Number(target.lancePctSug||0);
          applyPctToRow(target, back);
          expandedProposalKeys.add(k);
          renderTable(latestRows);
        });
      }
    }

    // Aviso quando a tela está limitada pelas configurações
    try{
      if (rows.length > displayRows.length){
        const trLim = document.createElement("tr");
        trLim.className = "empty";
        trLim.innerHTML = `<td colspan="13">Mostrando apenas ${displayRows.length} de ${rows.length} linhas na tela. Você pode ajustar em Configurações (⚙️).</td>`;
        tbody.appendChild(trLim);
      }
    }catch(e){}
  }


  // ---------- Operações Estruturadas ----------
  function oeRenderEmpty(msg){
    if (!oeTbody) return;
    oeTbody.innerHTML = `<tr class="empty"><td colspan="11">${msg}</td></tr>`;
  }

  // Totais dinâmicos do resultado ComboAuto (soma apenas os selecionados)
  function oeComputeTotalsFromChecked(){
    const rows = Array.isArray(latestRowsOE) ? latestRowsOE : [];
    const picked = rows.filter(r => selectedOEKeys.has(oeRowKey(r)));
    const use = picked.length ? picked : [];
    const sumCredito = use.reduce((a,r)=>a+Number(r.totalCredito||0),0);
    const sumParcIni = use.reduce((a,r)=>a+Number(r.parcelaInicial||0),0);
    const sumLance = use.reduce((a,r)=>a+Number(r.lanceSug||0),0);
    const sumTaxaAdm = use.reduce((a,r)=>a+Number(r.taxaAdmReais||0),0);
    const sumFundoRes = use.reduce((a,r)=>a+Number(r.fundoResReais||0),0);
    const pct = sumCredito ? (sumLance/sumCredito)*100 : 0;
    const taxaMedPct = sumCredito ? (sumTaxaAdm/sumCredito)*100 : 0;
    const fundoMedPct = sumCredito ? (sumFundoRes/sumCredito)*100 : 0;
    return {
      count: use.length,
      sumCredito, sumParcIni, sumLance,
      pct,
      sumTaxaAdm, sumFundoRes,
      taxaMedPct, fundoMedPct
    };
  }

  function oeUpdateTotalsRowDOM(){
    if (!oeTbody) return;
    const tr = oeTbody.querySelector('tr.oeTotalRow.oeTotalRowCombo');
    if (!tr) return;
    const t = oeComputeTotalsFromChecked();
    tr.querySelector('.tCredito').textContent = fmtBRL(t.sumCredito);
    tr.querySelector('.tParcIni').textContent = fmtBRL(t.sumParcIni);
    tr.querySelector('.tLance').innerHTML = `${fmtBRL(t.sumLance)} <span class="pct">(${formatPct(t.pct)})</span>`;
    const taxEl = tr.querySelector('.tTaxa');
    const fundEl = tr.querySelector('.tFundo');
    if (taxEl) taxEl.innerHTML = `<b>${formatPct(t.taxaMedPct)}<span class="pct">${fmtBRL(t.sumTaxaAdm)}</span></b>`;
    if (fundEl) fundEl.innerHTML = `<b>${formatPct(t.fundoMedPct)}<span class="pct">${fmtBRL(t.sumFundoRes)}</span></b>`;
  }

  function oeUpdateFooterFromSelection(){
    const t = oeComputeTotalsFromChecked();
    if (oeResumoEl){
      oeResumoEl.textContent = t.count
        ? `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})`
        : '—';
    }
    if (oeResumo2El){
      if (!t.count){
        oeResumo2El.textContent = '—';
      } else {
        const picked = latestRowsOE.filter(r => selectedOEKeys.has(oeRowKey(r)));
        const m = oeCComputeMetrics(picked);
        oeResumo2El.textContent = `Valor Presente/Parcelado: ${fmtBRL(m.valorPresente)} • Taxa de Adm + F. Res: ${fmtBRL(m.taxaAdmFR)} • Custo Estimado Total: ${formatPct(m.custoTotalPct)} • Custo Estimado Mensal: ${formatPct(m.custoMensalPct)}`;
      }
    }
    if (oeParcelasDemoEl){
      if (!t.count){
        oeParcelasDemoEl.textContent = '—';
      } else {
        const picked = latestRowsOE.filter(r => selectedOEKeys.has(oeRowKey(r)))
          .slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
        const ranges = oeComputeParcelasRanges(picked);
        if (!ranges.length) oeParcelasDemoEl.textContent = '—';
        else {
          oeParcelasDemoEl.innerHTML = ranges.map(r => {
            const faixa = (r.start === r.end) ? `${r.start}` : `${r.start} a ${r.end}`;
            return `<div><b>${faixa}</b> — ${fmtBRL(r.valor)}</div>`;
          }).join('');
        }
      }
    }
    oeUpdateTotalsRowDOM();
  }

  function oeComputeParcelasRanges(rowsSorted){
    // rowsSorted: prazoInicial asc
    const ranges = [];
    if (!rowsSorted.length) return ranges;
    let start = 2;
    for (let i=0;i<rowsSorted.length;i++){
      const end = Number(rowsSorted[i].prazoInicial);
      const soma = rowsSorted.slice(i).reduce((acc,r)=>acc + Number(r.parcelaPos||0), 0);
      if (end >= start){
        ranges.push({ start, end, valor: soma });
      }
      start = end + 1;
    }
    return ranges;
  }

  function oeRenderTable(rows){
    // latestRowsOE será definido após ordenação (para manter índices consistentes)
    if (oeSelectAllEl) oeSelectAllEl.checked = false;

    if (!rows.length){
      oeRenderEmpty("Nenhuma operação encontrada dentro das regras e margens definidas.");
      if (oeResumoEl) oeResumoEl.textContent = "—";
      if (oeParcelasDemoEl) oeParcelasDemoEl.textContent = "—";
      _oeTotals = null;
      _oeParcelasRanges = [];
      return;
    }

    // Ordenar do menor prazo para o maior (exigência)
    const sorted = rows.slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
    latestRowsOE = sorted.slice();
    oeWasCleared = false;
    const sumCredito = sorted.reduce((a,r)=>a+Number(r.totalCredito||0),0);
    const sumParcIni = sorted.reduce((a,r)=>a+Number(r.parcelaInicial||0),0);
    const sumLance = sorted.reduce((a,r)=>a+Number(r.lanceSug||0),0);
    const sumTaxaAdm = sorted.reduce((a,r)=>a+Number(r.taxaAdmReais||0),0);
    const sumFundoRes = sorted.reduce((a,r)=>a+Number(r.fundoResReais||0),0);
    const pct = sumCredito ? (sumLance/sumCredito)*100 : 0;
    _oeTotals = { sumCredito, sumParcIni, sumLance, pct, sumTaxaAdm, sumFundoRes, taxaMedPct: (sumCredito? (sumTaxaAdm/sumCredito)*100:0), fundoMedPct: (sumCredito? (sumFundoRes/sumCredito)*100:0) };

    // Parcelas decrescentes (pós-lance)
    _oeParcelasRanges = oeComputeParcelasRanges(sorted);

    // Rodapé passa a ser dinâmico (baseado nos selecionados), igual ao modo Custom.
    // Para evitar confusão, o rodapé fica em “—” até o usuário marcar as linhas.
    if (oeResumoEl) oeResumoEl.textContent = "—";
    if (oeResumo2El) oeResumo2El.textContent = "—";
    if (oeParcelasDemoEl) oeParcelasDemoEl.textContent = "—";

    // tabela
    oeTbody.innerHTML = "";
    const maxTela = Number(USER_SETTINGS && USER_SETTINGS.maxLinhasTela) || sorted.length;
    const displayRows = sorted.slice(0, Math.max(1, maxTela));
    const infoEl = document.getElementById('limitInfoOE');
    if (infoEl){
      infoEl.textContent = (sorted.length > displayRows.length)
        ? `Mostrando ${displayRows.length} de ${sorted.length} linhas na tela (ajuste em Configurações).`
        : '';
    }
    for (const [idx,row] of displayRows.entries()){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="selectCol"><input class="rowSelectOE" type="checkbox" data-idx="${idx}" /></td>
        <td><span class="badge">#${idx+1}</span> ${row.grupo}${groupAliasMini(row.grupo)}</td>
        <td>
          <button class="btn ghost mini openPainelOE" type="button" data-grupo="${String(row.grupo)}" data-credito="${Number(row.totalCredito||0)}">Abrir</button>
        </td>
        <td class="cellCredPro">${fmtBRL(row.totalCredito)}</td>
        <td class="cellEditCredPro"></td>
        <td style="text-align:center">${row.prazoInicial}</td>
        <td>${fmtBRL(row.parcelaInicial)}</td>
        <td>
          <div class="lanceCell">
            <span class="pctMini">(${formatPct(row.lancePctSug)})</span>
            <input class="inlineInput" type="number" min="0" step="0.01" value="${(row.lanceSug||0).toFixed(2)}" />
          </div>
        </td>
        <td class="cellParcelaPos">${fmtBRL(row.parcelaPos)}</td>
        <td class="cellPrazoPos" style="text-align:center">${row.prazoPos}</td>
        <td class="cellTaxaAdm">${miniPctBrlCell(row.taxaAdmPct, row.taxaAdmReais)}</td>
        <td class="cellFundoRes">${miniPctBrlCell(row.fundoResPct, row.fundoResReais)}</td>
              `;

// restaura/persiste seleção (mantém ao alternar abas e entre buscas, até clicar em Limpar)
const _cb = tr.querySelector('input.rowSelectOE');
const _k = oeRowKey(row);
if (_cb){
  _cb.checked = selectedOEKeys.has(_k);
  _cb.onchange = () => {
    try{
      if (_cb.checked) selectedOEKeys.add(_k);
      else selectedOEKeys.delete(_k);
    }catch(e){}
    // Atualiza totais/rodapé baseados apenas nos selecionados
    try{ oeUpdateFooterFromSelection(); }catch(e){}
  };
}


      // Edição de crédito (dropdown + multiplicador), como em Operações Estruturadas > Custom
      try{
        const cellEdit = tr.querySelector('.cellEditCredPro');
        if (cellEdit){
          const credits = pGetCreditOptions(row.grupo, row.prazoInicial);
          const unitNow = Number(row.unitCredito || (credits[0] || (row.totalCredito||0)));
          const creditOpts = (credits.length ? credits : [unitNow]).map(v=>{
            const sel = (Number(v) === Number(unitNow)) ? 'selected' : '';
            return `<option value="${Number(v)}" ${sel}>${fmtBRL(v)}</option>`;
          }).join("");
          const multMax = 20;
          const multNow = Number(row.mult||1) || 1;
          const multOpts = Array.from({length: multMax}, (_,i)=>i+1).map(v=>{
            const sel = (Number(v) === Number(multNow)) ? 'selected' : '';
            return `<option value="${v}" ${sel}>x${v}</option>`;
          }).join("");
          cellEdit.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <select class="pUnitSel" style="min-width:150px;">${creditOpts}</select>
              <select class="pMultSel" style="width:90px;">${multOpts}</select>
            </div>
          `;
          const unitSel = cellEdit.querySelector('select.pUnitSel');
          const multSel = cellEdit.querySelector('select.pMultSel');
          const cellCred = tr.querySelector('.cellCredPro');
          const cellParcIni = tr.querySelector('td:nth-child(7)'); // Parcela Inicial (after adding col, positions shift; safer update below)
          const lanceInput = tr.querySelector('input.inlineInput');
          const pctMini = tr.querySelector('.lanceCell .pctMini');
          const cellParcPos = tr.querySelector('.cellParcelaPos');
          const cellPrazoPos = tr.querySelector('.cellPrazoPos');
          const cellTaxa = tr.querySelector('.cellTaxaAdm');
          const cellFundo = tr.querySelector('.cellFundoRes');

          const applyChoice = () => {
            const u = unitSel ? Number(unitSel.value) : unitNow;
            const mlt = multSel ? Number(multSel.value) : Number(row.mult||1);
            pRecalcRowFromChoice(row, u, mlt);

            if (cellCred) cellCred.textContent = fmtBRL(row.totalCredito);
            // Parcela Inicial é a coluna "Parcela Inicial" (busca por texto é caro; pega pelo primeiro td com fmt da parcela inicial)
            try{
              const tds = tr.querySelectorAll('td');
              // Colunas (com novo th): 1 select,2 grupo,3 painel,4 crédito,5 editar,6 prazo,7 parcela inicial,8 lance,9 pós,10 prazo pós,11 taxa,12 fundo,13 assert
              if (tds && tds.length>=13){
                tds[6].textContent = fmtBRL(row.parcelaInicial);
                if (cellTaxa) cellTaxa.innerHTML = miniPctBrlCell(row.taxaAdmPct, row.taxaAdmReais);
                if (cellFundo) cellFundo.innerHTML = miniPctBrlCell(row.fundoResPct, row.fundoResReais);
              }
            }catch(e){}
            if (lanceInput) lanceInput.value = (Number(row.lanceSug||0)).toFixed(2);
            if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
            if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
            if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;

            // atualizar dataset do botão "Abrir" (painel) para refletir crédito atual
            const btnOpen2 = tr.querySelector('button.openPainel');
            if (btnOpen2) btnOpen2.dataset.credito = String(Number(row.totalCredito||0));
          };

          // Lance manual: atualiza cálculos da linha imediatamente
          if (lanceInput){
            lanceInput.addEventListener('input', ()=>{
              try{
                row._userEditedLance = true;
                row.lanceSug = Number(lanceInput.value||0);
                row.lancePctSug = row.totalCredito ? (Number(row.lanceSug||0)/Number(row.totalCredito||1))*100 : 0;
                const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, Number(row.lanceSug||0), row.prazoInicial);
                row.parcelaPos = calc.parcelaPos;
                row.prazoPos = calc.prazoPos;
                if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
                if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
                if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;
              }catch(e){}
            });
          }

          if (unitSel) unitSel.addEventListener('change', applyChoice);
          if (multSel) multSel.addEventListener('change', applyChoice);
        }
      }catch(e){}

      // Botão: abrir grupo no Painel de Lances
      const btnOpen = tr.querySelector('button.openPainelOE');
      if (btnOpen){
        btnOpen.addEventListener('click', () => {
          const g = String(btnOpen.dataset.grupo || '').trim();
          if (!g) return;
          try{
            window.__GERPRO_LAST_OPEN = { kind: "oe_custom", grupo: g };
            const tabPainel = document.querySelector('.tab[data-view="painel"]');
            if (tabPainel) tabPainel.click();

            const inputGroup = document.getElementById('lpGroup');
            const inputValor = document.getElementById('lpValorConsorcio');
            const btnBuscarPainel = document.getElementById('lpBuscar');
            if (inputGroup) inputGroup.value = g;
            if (inputValor) {
              const n = Number(row.totalCredito);
              inputValor.value = Number.isFinite(n)
                ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : String(row.totalCredito || '').trim();
            }
            if (btnBuscarPainel) btnBuscarPainel.click();
          }catch(e){ console.error(e); }
        });
      }

      const input = tr.querySelector("input.inlineInput");
      const pctMini = tr.querySelector(".pctMini");
      const cellParcelaPos = tr.querySelector(".cellParcelaPos");
      const cellPrazoPos = tr.querySelector(".cellPrazoPos");

      // Edição do lance (repercute em parcela/prazo pós-lance) sem re-render completo
      // (o re-render completo derrubava o foco e podia “parecer” que não editava)
      input.addEventListener("input", () => {
        const lance = Number(input.value);
        const lanceFix = (isFinite(lance) && lance >= 0) ? lance : 0;
        const { prazoPos, parcelaPos } = calcParcelaPos(row.totalSaldo, row.parcelaInicial, lanceFix, row.prazoInicial);

        cellParcelaPos.textContent = fmtBRL(parcelaPos);
        cellPrazoPos.textContent = prazoPos;
        const pct = row.totalCredito ? (lanceFix / row.totalCredito) * 100 : 0;
        if (pctMini) pctMini.textContent = `(${formatPct(pct)})`;

        row.lanceSug = lanceFix;
        row.lancePctSug = pct;
        row.parcelaPos = parcelaPos;
        row.prazoPos = prazoPos;

        // Atualiza totalização e demonstrativo sem recriar a tabela
        oeUpdateTotalsAndDemo(sorted);
        oeUpdateTotalsRowDOM();
      });

      oeTbody.appendChild(tr);
    }

    // Linha TOTAL (dinâmica: soma apenas os selecionados)
    const trTot = document.createElement('tr');
    trTot.className = 'oeTotalRow oeTotalRowCombo';
    const t0 = oeComputeTotalsFromChecked();
    trTot.innerHTML = `
      <td class="selectCol"></td>
      <td><b>TOTAL (selecionados)</b></td>
      <td></td>
      <td style="text-align:right"><b class="tCredito">${fmtBRL(t0.sumCredito)}</b></td>
      <td></td>
      <td style="text-align:right"><b class="tParcIni">${fmtBRL(t0.sumParcIni)}</b></td>
      <td style="text-align:right"><b class="tLance">${fmtBRL(t0.sumLance)} <span class="pct">(${formatPct(t0.pct)})</span></b></td>
      <td></td>
      <td></td>
      <td style="text-align:right" class="tTaxa"><b>${formatPct(t0.taxaMedPct)}<span class="pct">${fmtBRL(t0.sumTaxaAdm)}</span></b></td>
      <td style="text-align:right" class="tFundo"><b>${formatPct(t0.fundoMedPct)}<span class="pct">${fmtBRL(t0.sumFundoRes)}</span></b></td>
    `;
    oeTbody.appendChild(trTot);

    // Atualiza o rodapé inicialmente com base no que já estava selecionado (se existir)
    try{ oeUpdateFooterFromSelection(); }catch(e){}

    // OBS.: removida a linha TOTAL fixa (todas as linhas). Agora a totalização é igual ao modo Custom:
    // soma apenas o que estiver marcado.
  }

  // Helpers para atualizar totais/rodapé sem re-render completo.
  // Agora tudo é baseado APENAS no que estiver selecionado (igual ao modo Custom).
  function oeUpdateTotalsAndDemo(){
    try{ oeUpdateFooterFromSelection(); }catch(e){}
  }

  function oeGetSelectedRows(){
    const checks = Array.from(oeTbody.querySelectorAll('input.rowSelectOE:checked'));
    const idxs = checks.map(c => Number(c.dataset.idx)).filter(n => Number.isFinite(n));
    return idxs.map(i => latestRowsOE[i]).filter(Boolean);
  }

  function oeCGetSelectedRows(){
    if (!oeCTbody) return [];
    const checks = Array.from(oeCTbody.querySelectorAll('input.rowSelectOEC:checked'));
    const idxs = checks.map(c => Number(c.dataset.idx)).filter(n => Number.isFinite(n));
    return idxs.map(i => latestRowsOECustom[i]).filter(Boolean);
  }

  function oeCComputeMetrics(rows){
    const arr = Array.isArray(rows) ? rows : [];
    let valorPresente = 0;
    let taxaAdmFR = 0;
    let prazoTotal = 0;
    for (const r of arr){
      const prazo = Number(r.prazoInicial || 0);
      const parc = Number(r.parcelaInicial || 0);
      const lance = Number(r.lanceSug || 0);
      const cred = Number(r.totalCredito || 0);
      // Valor Presente / Parcelado (conforme fórmula solicitada)
      valorPresente += Math.max(0, cred - (parc + lance));
      // Taxa de Adm + Fundo de Reserva (estimado)
      taxaAdmFR += (parc * prazo) - cred;
      if (prazo > prazoTotal) prazoTotal = prazo;
    }
    const custoTotalPct = (valorPresente !== 0) ? (taxaAdmFR / valorPresente) * 100 : 0;
    const denom = Math.max(1, prazoTotal - 1);
    const custoMensalPct = custoTotalPct / denom;
    return { valorPresente, taxaAdmFR, custoTotalPct, custoMensalPct, prazoTotal };
  }


  function oeCRenderEmpty(msg){
    if (!oeCTbody) return;
    oeCTbody.innerHTML = `<tr class="empty"><td colspan="13">${msg}</td></tr>`;
    if (oeCResumoEl) oeCResumoEl.textContent = "—";
    if (oeCParcelasDemoEl) oeCParcelasDemoEl.textContent = "—";
    _oeCTotals = null;
  }

  // Compatibilidade com versões anteriores que chamavam o nome com "y".
  const oeCRenderEmptyy = oeCRenderEmpty;

  
// ---------------- Propostas: edição de crédito (dropdown + multiplicador) ----------------
function pGetCreditOptions(grupo, prazo){
  try{
    const g = String(grupo);
    const p = Number(prazo);
    const m = index.get(g);
    const items = m ? m.get(p) : null;
    if (!items || !items.length) return [];
    const uniq = Array.from(new Set(items.map(it => Number(it.credito)).filter(Number.isFinite)));
    uniq.sort((a,b)=>a-b);
    return uniq;
  }catch(e){
    return [];
  }
}
function pGetBestItemForCredit(grupo, prazo, unitCredito){
  try{
    const g = String(grupo);
    const p = Number(prazo);
    const u = Number(unitCredito);
    const m = index.get(g);
    const items = m ? m.get(p) : null;
    if (!items || !items.length) return null;
    // melhor match: crédito mais próximo
    let best = items[0];
    let bestD = Math.abs(Number(best.credito||0) - u);
    for (const it of items){
      const d = Math.abs(Number(it.credito||0) - u);
      if (d < bestD){
        best = it; bestD = d;
      }
    }
    return best || null;
  }catch(e){
    return null;
  }
}
function pRecalcRowFromChoice(row, unitCredito, mult){
  if (!row) return;
  const mlt = Math.max(1, parseInt(mult || "1", 10) || 1);
  const it = pGetBestItemForCredit(row.grupo, row.prazoInicial, unitCredito);
  if (it){
    row.unitCredito = Number(it.credito);
    row.unitSaldo = Number(it.saldo);
    row.unitParcela = Number(it.parcela);
    row.segmento = row.segmento || it.segmento || row.segmento;
    row.taxaAdmPct = Number(it.taxa||0);
    row.fundoResPct = Number(it.fundo||0);
  } else {
    // fallback proporcional
    const u = Number(unitCredito);
    row.unitCredito = Number.isFinite(u) ? u : Number(row.unitCredito || (row.totalCredito||0));
    const ratioSaldo = row.totalCredito ? (Number(row.totalSaldo||0)/Number(row.totalCredito||1)) : 1;
    const ratioParc = row.totalCredito ? (Number(row.parcelaInicial||0)/Number(row.totalCredito||1)) : 0;
    row.unitSaldo = row.unitCredito * ratioSaldo;
    row.unitParcela = row.unitCredito * ratioParc;
  }
  row.mult = mlt;
  row.totalCredito = Number(row.unitCredito||0) * mlt;
  row.totalSaldo = Number(row.unitSaldo||0) * mlt;
  row.parcelaInicial = Number(row.unitParcela||0) * mlt;

  // reais (taxa/fundo) pela regra atual
  row.taxaAdmReais = Number(row.totalCredito||0) * (Number(row.taxaAdmPct||0)/100);
  row.fundoResReais = Number(row.totalCredito||0) * (Number(row.fundoResPct||0)/100);

  // lance: se usuário já editou manualmente, preserva valor; senão recalcula sugestão
  if (row._userEditedLance){
    const l = Number(row.lanceSug||0);
    row.lancePctSug = row.totalCredito ? (l/row.totalCredito)*100 : 0;
  } else {
    const l = getCalculatedLance(String(row.grupo), Number(row.totalCredito||0), 0);
    row.lanceSug = l;
    row.lancePctSug = row.totalCredito ? (l/row.totalCredito)*100 : 0;
  }

  const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, Number(row.lanceSug||0), row.prazoInicial);
  row.parcelaPos = calc.parcelaPos;
  row.prazoPos = calc.prazoPos;
}

function oeCGetCreditOptions(grupo, prazo){
    try{
      const g = String(grupo);
      const p = Number(prazo);
      const m = index.get(g);
      const items = m ? m.get(p) : null;
      if (!items || !items.length) return [];
      const uniq = Array.from(new Set(items.map(it => Number(it.credito)).filter(Number.isFinite)));
      uniq.sort((a,b)=>a-b);
      return uniq;
    }catch(e){
      return [];
    }
  }

  function oeCGetBestItemForCredit(grupo, prazo, credito){
    try{
      const g = String(grupo);
      const p = Number(prazo);
      const m = index.get(g);
      const items = m ? m.get(p) : null;
      if (!items || !items.length) return null;
      const target = Number(credito);
      let best = items[0];
      let bestD = Infinity;
      for (const it of items){
        const d = Math.abs(Number(it.credito) - target);
        if (d < bestD){
          bestD = d;
          best = it;
        }
      }
      return best;
    }catch(e){
      return null;
    }
  }

  function oeCRecalcRowFromChoice(row, unitCredito, mult){
    const m = Math.max(1, parseInt(mult || "1", 10) || 1);
    const uCred = Number(unitCredito);
    if (!row) return;

    const item = oeCGetBestItemForCredit(row.grupo, row.prazoInicial, uCred);
    if (item){
      row.unitCredito = Number(item.credito);
      row.unitSaldo = Number(item.saldo);
      row.unitParcela = Number(item.parcela);
      row.segmento = row.segmento || item.segmento || row.segmento;
      row.taxaAdmPct = Number(item.taxa||0);
      row.fundoResPct = Number(item.fundo||0);
    } else {
      row.unitCredito = isFinite(uCred) ? uCred : Number(row.unitCredito || row.totalCredito || 0);
      // fallback: mantém proporções atuais, se existirem
      const ratioSaldo = row.totalCredito ? (Number(row.totalSaldo||0)/Number(row.totalCredito||1)) : 1;
      const ratioParc = row.totalCredito ? (Number(row.parcelaInicial||0)/Number(row.totalCredito||1)) : 1;
      row.unitSaldo = row.unitCredito * ratioSaldo;
      row.unitParcela = row.unitCredito * ratioParc;
    }

    row.mult = m;

    row.totalCredito = Number(row.unitCredito || 0) * m;
    row.totalSaldo = Number(row.unitSaldo || 0) * m;
    row.parcelaInicial = Number(row.unitParcela || 0) * m;

    // Taxa de Adm e Fundo de Reserva (totais estimados) – % vem do item da base
    const tPct = Number(row.taxaAdmPct || 0);
    const fPct = Number(row.fundoResPct || 0);
    row.taxaAdmReais = row.totalCredito ? (row.totalCredito * (tPct/100)) : 0;
    row.fundoResReais = row.totalCredito ? (row.totalCredito * (fPct/100)) : 0;

    // Recalcula lance sugerido e pós-lance
    row.lanceSug = getCalculatedLance(row.grupo, row.totalCredito, 0);
    row.lancePctSug = row.totalCredito ? (row.lanceSug / row.totalCredito) * 100 : 0;

    const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, row.lanceSug, row.prazoInicial);
    row.parcelaPos = calc.parcelaPos;
    row.prazoPos = calc.prazoPos;
  }

  function oeCComputeTotalsFromChecked(){
  if (!oeCTbody) return { sumCredito:0, sumParcIni:0, sumLance:0, pct:0, count:0, sumTaxaAdm:0, sumFundoRes:0, taxaMedPct:0, fundoMedPct:0 };
  const rows = oeCGetSelectedRows();
  const sumCredito = rows.reduce((a,r)=>a+Number(r.totalCredito||0),0);
  const sumParcIni = rows.reduce((a,r)=>a+Number(r.parcelaInicial||0),0);
  const sumLance = rows.reduce((a,r)=>a+Number(r.lanceSug||0),0);
  const sumTaxaAdm = rows.reduce((a,r)=>a+Number(r.taxaAdmReais||0),0);
  const sumFundoRes = rows.reduce((a,r)=>a+Number(r.fundoResReais||0),0);
  const pct = sumCredito ? (sumLance/sumCredito)*100 : 0;
  const taxaMedPct = sumCredito ? (sumTaxaAdm/sumCredito)*100 : 0;
  const fundoMedPct = sumCredito ? (sumFundoRes/sumCredito)*100 : 0;
  return { sumCredito, sumParcIni, sumLance, pct, count: rows.length, sumTaxaAdm, sumFundoRes, taxaMedPct, fundoMedPct };
}


  function oeCUpdateTotalsRowDOM(){
    if (!oeCTbody) return;
    const tr = oeCTbody.querySelector('tr.oeCTotalRow');
    if (!tr) return;
    const t = oeCComputeTotalsFromChecked();
    const tds = tr.querySelectorAll('td');
    if (tds.length < 13) return;
    // 3 crédito, 6 parcela inicial, 7 lance, 10 taxa adm média, 11 fundo res médio
    tds[3].innerHTML = `<b>${fmtBRL(t.sumCredito)}</b>`;
    tds[6].innerHTML = `<b>${fmtBRL(t.sumParcIni)}</b>`;
    tds[7].innerHTML = `<b>${fmtBRL(t.sumLance)}<span class="pct">(${formatPct(t.pct)})</span></b>`;
    if (tds[10]) tds[10].innerHTML = `<b>${formatPct(t.taxaMedPct)}<span class="pct">${fmtBRL(t.sumTaxaAdm)}</span></b>`;
    if (tds[11]) tds[11].innerHTML = `<b>${formatPct(t.fundoMedPct)}<span class="pct">${fmtBRL(t.sumFundoRes)}</span></b>`;

    // Atualiza métricas estimadas (Customizada) apenas com selecionados
    if (oeCResumo2El){
      const m = oeCComputeMetrics(oeCGetSelectedRows());
      oeCResumo2El.textContent =
        `Valor Presente/Parcelado: ${fmtBRL(m.valorPresente)} • Taxa de Adm + F. Res: ${fmtBRL(m.taxaAdmFR)} • Custo Estimado Total: ${formatPct(m.custoTotalPct)} • Custo Estimado Mensal: ${formatPct(m.custoMensalPct)}`;
    }

    // Atualiza quadro de parcelas decrescentes (Customizada) com base apenas nos selecionados
    if (oeCParcelasDemoEl){
      const sel = oeCGetSelectedRows().slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
      const ranges = oeComputeParcelasRanges(sel);
      if (!ranges.length){
        oeCParcelasDemoEl.textContent = "—";
      } else {
        oeCParcelasDemoEl.innerHTML = ranges.map(r => {
          const faixa = (r.start === r.end) ? `${r.start}` : `${r.start} a ${r.end}`;
          return `<div><b>${faixa}</b> — ${fmtBRL(r.valor)}</div>`;
        }).join("");
      }
    }
  }



  function oeCRenderTable(rows, creditoAlvo){
    if (oeCSelectAllEl) oeCSelectAllEl.checked = false;

    if (!rows || !rows.length){
      oeCRenderEmpty("Nenhuma opção encontrada com os filtros atuais.");
      if (oeCStatusEl) oeCStatusEl.textContent = "Sem resultado";
      return;
    }

    _oeCCreditoAlvo = creditoAlvo;
    // Ordena do menor prazo para o maior prazo (Customizada)
    latestRowsOECustom = rows.slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
    oeCTbody.innerHTML = "";

    const maxTela = Number(USER_SETTINGS && USER_SETTINGS.maxLinhasTela) || latestRowsOECustom.length;
    const displayRows = latestRowsOECustom.slice(0, Math.max(1, maxTela));
    const infoEl = document.getElementById('limitInfoOEC');
    if (infoEl){
      infoEl.textContent = (latestRowsOECustom.length > displayRows.length)
        ? `Mostrando ${displayRows.length} de ${latestRowsOECustom.length} linhas na tela (ajuste em Configurações).`
        : '';
    }

    for (const [idx,row] of displayRows.entries()){
      // garante estado inicial
      if (!row.mult) row.mult = 1;
      if (!row.unitCredito) row.unitCredito = Number(row.totalCredito||0) / Number(row.mult||1);

      const key = oeCustomRowKey(row);
      const tr = document.createElement("tr");

      const credits = oeCGetCreditOptions(row.grupo, row.prazoInicial);
      const unitNow = Number(row.unitCredito || credits[0] || 0);

      const creditOptionsHtml = (credits.length ? credits : [unitNow]).map(v => {
        const sel = (Number(v) === Number(unitNow)) ? 'selected' : '';
        return `<option value="${Number(v)}" ${sel}>${fmtBRL(v)}</option>`;
      }).join("");

      // multiplicadores: 1..20
      const multMax = 20;
      const multOptionsHtml = Array.from({length: multMax}, (_,i)=>i+1).map(v=>{
        const sel = (Number(v) === Number(row.mult||1)) ? 'selected' : '';
        return `<option value="${v}" ${sel}>x${v}</option>`;
      }).join("");

      tr.innerHTML = `
        <td class="selectCol"><input class="rowSelectOEC" type="checkbox" data-idx="${idx}" /></td>
        <td><span class="badge">#${idx+1}</span> ${row.grupo}${groupAliasMini(row.grupo)}</td>
        <td>
          <button class="btn ghost mini openPainelOEC" type="button" data-grupo="${String(row.grupo)}" data-credito="${Number(row.totalCredito||0)}">Abrir</button>
        </td>
        <td class="cellCredOEC">${fmtBRL(row.totalCredito)}</td>
        <td>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <select class="oeCUnitSel" style="min-width:150px;">${creditOptionsHtml}</select>
            <select class="oeCMultSel" style="width:90px;">${multOptionsHtml}</select>
          </div>
        </td>
        <td style="text-align:center">${row.prazoInicial}</td>
        <td class="cellParcIniOEC">${fmtBRL(row.parcelaInicial)}</td>
        <td class="cellLanceOEC">
          <div class="lanceCell">
            <span class="pctMini">(${formatPct(row.lancePctSug)})</span>
            <input class="inlineInput oeCLanceInput" type="number" min="0" step="0.01" value="${(Number(row.lanceSug||0)).toFixed(2)}" />
          </div>
        </td>
        <td class="cellParcelaPosOEC">${fmtBRL(row.parcelaPos)}</td>
        <td class="cellPrazoPosOEC" style="text-align:center">${row.prazoPos}</td>
        <td class="cellTaxaAdmOEC">${miniPctBrlCell(row.taxaAdmPct, row.taxaAdmReais)}</td>
        <td class="cellFundoResOEC">${miniPctBrlCell(row.fundoResPct, row.fundoResReais)}</td>
              `;

      // seleção persistente
      const cb = tr.querySelector('input.rowSelectOEC');
      if (cb){
        cb.checked = selectedOECustomKeys.has(key);
        cb.onchange = () => {
          try{
            if (cb.checked) selectedOECustomKeys.add(key);
            else selectedOECustomKeys.delete(key);
          }catch(e){}
          // totals dinâmicos apenas dos marcados
          const t = oeCComputeTotalsFromChecked();
          _oeCTotals = t;
          oeCUpdateTotalsRowDOM();
          if (oeCResumoEl){
            const rest = (isFinite(Number(creditoAlvo)) ? Math.max(0, Number(creditoAlvo) - t.sumCredito) : null);
            oeCResumoEl.textContent =
              `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})` +
              (rest !== null ? ` • Restante p/ alvo: ${fmtBRL(rest)}` : '');
          if (oeCResumo2El){
            const m = oeCComputeMetrics(oeCGetSelectedRows());
            oeCResumo2El.textContent =
              `Valor Presente/Parcelado: ${fmtBRL(m.valorPresente)} • Taxa de Adm + F. Res: ${fmtBRL(m.taxaAdmFR)} • Custo Estimado Total: ${formatPct(m.custoTotalPct)} • Custo Estimado Mensal: ${formatPct(m.custoMensalPct)}`;
          }
          }
        };
      }

      // abrir painel
      const btnOpen = tr.querySelector('button.openPainelOEC');
      if (btnOpen){
        btnOpen.addEventListener('click', () => {
          const g = String(btnOpen.dataset.grupo || '').trim();
          if (!g) return;
          try{
            window.__GERPRO_LAST_OPEN = { kind: "oe_custom", grupo: g };
            const tabPainel = document.querySelector('.tab[data-view="painel"]');
            if (tabPainel) tabPainel.click();
            const inputGroup = document.getElementById('lpGroup');
            const inputValor = document.getElementById('lpValorConsorcio');
            const btnBuscarPainel = document.getElementById('lpBuscar');
            if (inputGroup) inputGroup.value = g;
            if (inputValor){
              const n = Number(row.totalCredito);
              inputValor.value = Number.isFinite(n)
                ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : String(row.totalCredito || '').trim();
            }
            if (btnBuscarPainel) btnBuscarPainel.click();
          }catch(e){ console.error(e); }
        });
      }

      const unitSel = tr.querySelector('select.oeCUnitSel');
      const multSel = tr.querySelector('select.oeCMultSel');
      const cellCred = tr.querySelector('.cellCredOEC');
      const cellParcIni = tr.querySelector('.cellParcIniOEC');
      const inputLance = tr.querySelector('.cellLanceOEC input.oeCLanceInput');
      const pctMini = tr.querySelector('.cellLanceOEC .pctMini');
      const cellParcPos = tr.querySelector('.cellParcelaPosOEC');
      const cellPrazoPos = tr.querySelector('.cellPrazoPosOEC');

      const applyChoice = () => {
        const u = unitSel ? Number(unitSel.value) : unitNow;
        const mlt = multSel ? Number(multSel.value) : Number(row.mult||1);
        oeCRecalcRowFromChoice(row, u, mlt);

        if (cellCred) cellCred.textContent = fmtBRL(row.totalCredito);
        if (cellParcIni) cellParcIni.textContent = fmtBRL(row.parcelaInicial);
        if (inputLance) inputLance.value = (Number(row.lanceSug||0)).toFixed(2);
        if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
        if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
        if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;

        // se marcado, totals mudam imediatamente
        if (cb && cb.checked){
          const t = oeCComputeTotalsFromChecked();
          _oeCTotals = t;
          oeCUpdateTotalsRowDOM();
          if (oeCResumoEl){
            const rest = (isFinite(Number(creditoAlvo)) ? Math.max(0, Number(creditoAlvo) - t.sumCredito) : null);
            oeCResumoEl.textContent =
              `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})` +
              (rest !== null ? ` • Restante p/ alvo: ${fmtBRL(rest)}` : '');
          if (oeCResumo2El){
            const m = oeCComputeMetrics(oeCGetSelectedRows());
            oeCResumo2El.textContent =
              `Valor Presente/Parcelado: ${fmtBRL(m.valorPresente)} • Taxa de Adm + F. Res: ${fmtBRL(m.taxaAdmFR)} • Custo Estimado Total: ${formatPct(m.custoTotalPct)} • Custo Estimado Mensal: ${formatPct(m.custoMensalPct)}`;
          }
          }
        }
      };

      if (unitSel) unitSel.addEventListener('change', applyChoice);
      if (multSel) multSel.addEventListener('change', applyChoice);

      // Lance editável manualmente (recalcula parcela pós-lance e totais dinâmicos)
      if (inputLance){
        inputLance.addEventListener('input', () => {
          const lance = Number(inputLance.value);
          const lanceFix = (isFinite(lance) && lance >= 0) ? lance : 0;
          row.lanceSug = lanceFix;
          row.lancePctSug = row.totalCredito ? (lanceFix / row.totalCredito) * 100 : 0;
          const calc = calcParcelaPos(row.totalSaldo, row.parcelaInicial, lanceFix, row.prazoInicial);
          row.parcelaPos = calc.parcelaPos;
          row.prazoPos = calc.prazoPos;

          if (pctMini) pctMini.textContent = `(${formatPct(row.lancePctSug)})`;
          if (cellParcPos) cellParcPos.textContent = fmtBRL(row.parcelaPos);
          if (cellPrazoPos) cellPrazoPos.textContent = row.prazoPos;

          if (cb && cb.checked){
            _oeCTotals = oeCComputeTotalsFromChecked();
            oeCUpdateTotalsRowDOM();
            if (oeCResumoEl){
              const t = _oeCTotals;
              const rest = (isFinite(Number(creditoAlvo)) ? Math.max(0, Number(creditoAlvo) - t.sumCredito) : null);
              oeCResumoEl.textContent =
                `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})` +
                (rest !== null ? ` • Restante p/ alvo: ${fmtBRL(rest)}` : '');
            }
          }
        });
      }

      oeCTbody.appendChild(tr);
    }

    // Linha TOTAL (dinâmica: soma apenas os selecionados)
    const trTot = document.createElement('tr');
    trTot.className = 'oeTotalRow oeCTotalRow';
    const t0 = oeCComputeTotalsFromChecked();
    trTot.innerHTML = `
      <td class="selectCol"></td>
      <td><b>TOTAL (selecionados)</b></td>
      <td></td>
      <td style="text-align:right"><b>${fmtBRL(t0.sumCredito)}</b></td>
      <td></td>
      <td style="text-align:center">—</td>
      <td style="text-align:right"><b>${fmtBRL(t0.sumParcIni)}</b></td>
      <td style="text-align:right"><b>${fmtBRL(t0.sumLance)}<span class="pct">(${formatPct(t0.pct)})</span></b></td>
      <td></td>
      <td></td>
      <td style="text-align:right"><b>${formatPct(t0.taxaMedPct)}<span class="pct">${fmtBRL(t0.sumTaxaAdm)}</span></b></td>
      <td style="text-align:right"><b>${formatPct(t0.fundoMedPct)}<span class="pct">${fmtBRL(t0.sumFundoRes)}</span></b></td>
      <td></td>
    `;
    oeCTbody.appendChild(trTot);

    // resumo inicial baseado em checkeds (persistidos)
    const t = oeCComputeTotalsFromChecked();
    _oeCTotals = t;
    if (oeCResumoEl){
      const rest = (isFinite(Number(creditoAlvo)) ? Math.max(0, Number(creditoAlvo) - t.sumCredito) : null);
      oeCResumoEl.textContent =
        `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})` +
        (rest !== null ? ` • Restante p/ alvo: ${fmtBRL(rest)}` : '');
    }

    if (oeCStatusEl){
      if (isFinite(Number(creditoAlvo))){
        const rest = Math.max(0, Number(creditoAlvo) - t.sumCredito);
        oeCStatusEl.textContent = rest > 0 ? `Restante: ${fmtBRL(rest)}` : "Alvo atingido";
      } else {
        oeCStatusEl.textContent = "OK";
      }
    }
  }



  function oeClear(){
    latestRowsOE = [];
    latestRowsOECustom = [];
    try{ selectedOEKeys.clear(); }catch(e){}
    try{ selectedOECustomKeys.clear(); }catch(e){}
    if (oeCreditoEl) oeCreditoEl.value = "";
    if (oeLanceEl) oeLanceEl.value = "";
    if (oePrazoMinEl) oePrazoMinEl.value = "";
    if (oePrazoMaxEl) oePrazoMaxEl.value = "";
    if (oeQtdEl) oeQtdEl.value = "3";
    oeRenderEmpty("Preencha o valor do crédito total e clique em “Buscar operações”.");
    oeCRenderEmpty("Faça uma busca para ver opções customizáveis.");
    if (oeResumoEl) oeResumoEl.textContent = "—";
    if (oeResumo2El) oeResumo2El.textContent = "—";
    if (oeParcelasDemoEl) oeParcelasDemoEl.textContent = "—";
    if (oeCStatusEl) oeCStatusEl.textContent = "Pronto";
    const infoOE = document.getElementById('limitInfoOE');
    if (infoOE) infoOE.textContent = '';
    const infoOEC = document.getElementById('limitInfoOEC');
    if (infoOEC) infoOEC.textContent = '';
  }

  function oeWithinMargin(total, target, minF, maxF){
    // mesma margem do app (com possibilidade de flexibilizar)
    const minFactor = (isFinite(minF) ? Number(minF) : 0.95);
    const maxFactor = (isFinite(maxF) ? Number(maxF) : 1.20);
    const min = target * minFactor;
    const max = target * maxFactor;
    return total >= min && total <= max;
  }

  function oeBuildCandidateOptions(creditoTarget, filtros){
    const out = [];
    for (const [grupo, mp] of index){
      // Exclui grupos com sequência fixa de 20% na série histórica
      if (hasFixedTwentySequence(grupo)) continue;
      for (const [prazo, items] of mp){
        if (filtros.hasPrazoRange){
          const minP = Number(filtros.prazoMin||0);
          const maxP = Number(filtros.prazoMax||0);
          if (isFinite(minP) && isFinite(maxP)){
            if (prazo < minP || prazo > maxP) continue;
          }
        }
        const segmento = (items[0]?.segmento ?? (window.LANCE_DB?.[String(grupo)]?.segmento ?? ""));
        // Para operações estruturadas, queremos diversidade, então pegamos apenas o "melhor" combo deste prazo/grupo
        // Para OE, não obrigamos divisão igualitária do crédito: geramos combos em torno de alguns alvos
        const baseT = creditoTarget / Math.max(1, filtros.k);
        const targets = [baseT, baseT*0.90, baseT*0.75, baseT*0.60, baseT*0.50, baseT*1.10, baseT*1.25, baseT*1.40].filter(v=>isFinite(v) && v>0);
        const combosMap = new Map();
        for (const t of targets){
          for (const c of combosForGroupPrazo(items, t, segmento, { motoMautoLimit: 177000 })){
            const key = `${Math.round(c.totalCredito*100)}|${Math.round(c.totalParcela*100)}|${Math.round(c.totalSaldo*100)}`;
            if (!combosMap.has(key)) combosMap.set(key, c);
          }
        }
        const combos = Array.from(combosMap.values());
        // Observação importante (OE):
        // - Nesta aba é permitido somar valores iguais do mesmo grupo (mesma configuração) para atingir créditos altos.
        // - Porém NÃO é permitido repetir o mesmo grupo em linhas distintas.
        // Para viabilizar isso com performance, guardamos as opções como "unidades" (unit*) e permitimos multiplicadores
        // durante a escolha da combinação (oePickBestCombo / fallback).
        for (const c of combos){
          const lanceSugUnit = getCalculatedLance(grupo, c.totalCredito, 0); // mesma metodologia da aba Propostas (+5pp)
          const { prazoPos, parcelaPos } = calcParcelaPos(c.totalSaldo, c.totalParcela, lanceSugUnit, prazo);

          // Observação (OE): o filtro de lance é aplicado na combinação final (média),
          // não aqui por linha. Assim conseguimos “perseguir os menores lances”
          // e ainda atingir o filtro pelo lance médio.
          const lancePctSug = c.totalCredito ? (lanceSugUnit / c.totalCredito) * 100 : 0;
          out.push({
            grupo,
            segmento,
            // valores unitários (podem ser multiplicados mais tarde)
            unitCredito: c.totalCredito,
            prazoInicial: prazo,
            unitParcelaInicial: c.totalParcela,
            unitSaldo: c.totalSaldo,
            taxaAdmPct: Number(c.taxaPct||0),
            fundoResPct: Number(c.fundoPct||0),
            taxaAdmReaisUnit: Number(c.taxaReais||0),
            fundoResReaisUnit: Number(c.fundoReais||0),
            lanceSugUnit,
            lancePctSug,
            parcelaPos,
            prazoPos,
            // compatibilidade com render (preenchidos na fase de seleção)
            totalCredito: c.totalCredito,
            parcelaInicial: c.totalParcela,
            totalSaldo: c.totalSaldo,
            taxaAdmPct: Number(c.taxaPct||0),
            fundoResPct: Number(c.fundoPct||0),
            taxaAdmReais: Number(c.taxaReais||0),
            fundoResReais: Number(c.fundoReais||0),
            lanceSug: lanceSugUnit,
            prazoPos
          });
        }
      }
    }
    // mantém candidatos "bons"
    out.sort((a,b)=>{
      if (a.lanceSug !== b.lanceSug) return a.lanceSug - b.lanceSug;
      if (a.lancePctSug !== b.lancePctSug) return a.lancePctSug - b.lancePctSug;
      if (a.prazoInicial !== b.prazoInicial) return a.prazoInicial - b.prazoInicial;
      return a.totalCredito - b.totalCredito;
    });
    // remove duplicatas por grupo/prazo, keep best
    const seen = new Set();
    const dedup = [];
    for (const r of out){
      const key = `${r.grupo}|${r.prazoInicial}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(r);
      if (dedup.length >= (creditoTarget > 700000 ? 420 : 180)) break;
    }
    return dedup;
  }

  function oeCloneWithMult(unitRow, mult){
    const m = Math.max(1, Math.floor(mult || 1));
    const totalCredito = Number(unitRow.unitCredito || unitRow.totalCredito || 0) * m;
    const parcelaInicial = Number(unitRow.unitParcelaInicial || unitRow.parcelaInicial || 0) * m;
    const totalSaldo = Number(unitRow.unitSaldo || unitRow.totalSaldo || 0) * m;
    const taxaAdmReais = Number(unitRow.taxaAdmReaisUnit || unitRow.taxaAdmReais || 0) * m;
    const fundoResReais = Number(unitRow.fundoResReaisUnit || unitRow.fundoResReais || 0) * m;
    const taxaAdmPct = totalCredito ? (taxaAdmReais/totalCredito)*100 : Number(unitRow.taxaAdmPct||0);
    const fundoResPct = totalCredito ? (fundoResReais/totalCredito)*100 : Number(unitRow.fundoResPct||0);
    const prazo = Number(unitRow.prazoInicial || 0);
    const grupo = unitRow.grupo;
    // Recalcula o lance no total (mantém metodologia da aba Propostas)
    const lanceSug = getCalculatedLance(grupo, totalCredito, 0);
    const { prazoPos, parcelaPos } = calcParcelaPos(totalSaldo, parcelaInicial, lanceSug, prazo);
    const lancePctSug = totalCredito ? (lanceSug / totalCredito) * 100 : 0;
    return {
      ...unitRow,
      mult: m,
      totalCredito,
      parcelaInicial,
      totalSaldo,
      lanceSug,
      lancePctSug,
      parcelaPos,
      prazoPos,
      taxaAdmPct,
      fundoResPct,
      taxaAdmReais,
      fundoResReais
    };
  }

  function oePickBestCombo(cands, target, k, lanceTarget, lanceUpperPct, marginMinF, marginMaxF, pruneMaxF, filtros){
    // Heurística: escolhe k opções com prazos e grupos distintos,
    // minimizando a soma dos lances (e respeitando limites/filters).
    const best = { score: Infinity, rows: null, dist: Infinity, meanPrazo: -Infinity, lanceMedPct: Infinity };
    // Limite de quantidade de grupos MOTO/MAUTO conforme k (2-4=>1, 5-7=>2, 8-10=>3)
    const kInt = Math.max(2, Math.min(10, parseInt(k||2, 10) || 2));
    const maxMotoMautoCountAllowed = (kInt <= 4) ? 1 : (kInt <= 7 ? 2 : 3);

    // Regra (ComboAuto): MOTO + MAUTO podem aparecer várias vezes, desde que a soma do crédito desses segmentos não ultrapasse 177.000.

    // agrupar por prazo
    const byPrazo = new Map();
    for (const r of cands){
      const p = Number(r.prazoInicial);
      if (!isFinite(p)) continue;
      if (!byPrazo.has(p)) byPrazo.set(p, []);
      byPrazo.get(p).push(r);
    }

    // em cada prazo, mantém top N por menor lance sugerido
    const prazosAll = Array.from(byPrazo.keys()).sort((a,b)=>a-b);
    // Se houver faixa de prazo, distribuímos "slots" por intervalos (bins) proporcionalmente à quantidade de grupos.
// Regra: span=(pMax-pMin); step=span/k.
// Slot i usa [start..end] com variáveis dinâmicas (não preso a exemplos).
const hasPrazoRange = Boolean(filtros && filtros.hasPrazoRange && isFinite(Number(filtros.prazoMin)) && isFinite(Number(filtros.prazoMax)));
let slotPrazos = null;

    // distribuição por faixa de prazo quando informado prazoMin/prazoMax
    if (hasPrazoRange){
      try{ slotPrazos = oeBuildDistributedSlots(cands, filtros, lanceTarget, k); }catch(e){ slotPrazos = null; }
      if (!slotPrazos || !slotPrazos.length) {
        // Se não houver slots suficientes (ex.: faixa muito estreita), volta para o modo normal de escolha por prazos
        slotPrazos = null;
      }
    }

function oeBuildDistributedSlots(candsAll, filtros, lanceTarget, kSlots){
  const pMin = Number(filtros.prazoMin);
  const pMax = Number(filtros.prazoMax);
  const gr = Math.max(1, parseInt(filtros.qtdGrupos||kSlots||1, 10) || kSlots || 1);
  const i = Math.max(0, pMax - pMin);
  const step = Math.max(1, Math.floor(i / gr)); // intervalo por faixa

  const _metric = (r)=>{
    if (lanceTarget && String(lanceTarget.tipo)==='percentual') return Number(r.lancePctSug||Infinity);
    return Number(r.lanceSug||Infinity);
  };

  // Elegíveis: dentro do prazo e (se informado) dentro da faixa de lance -50%/+30%
  const eligible = (candsAll||[]).filter(r=>{
    const p = Number(r.prazoInicial||0);
    if (!(p >= pMin && p <= pMax)) return false;

    if (lanceTarget && isFinite(Number(lanceTarget.valor)) && Number(lanceTarget.valor) > 0){
      const v = Number(lanceTarget.valor);
      const minL = v * 0.50;
      const maxL = v * 1.30;
      if (String(lanceTarget.tipo) === 'percentual'){
        const pct = Number(r.lancePctSug||0);
        if (pct < minL || pct > maxL) return false;
      } else {
        const lr = Number(r.lanceSug||0);
        if (lr < minL || lr > maxL) return false;
      }
    }
    return true;
  });

  if (!eligible.length) return null;

  const byPrazo = eligible.slice().sort((a,b)=>Number(a.prazoInicial||0)-Number(b.prazoInicial||0));
  const usedGroups = new Set();
  const winners = [];

  let start = pMin;
  for (let j=0; j<gr; j++){
    // Exemplo exigido: 1ª faixa inclui (pMin .. pMin+step). As demais são contíguas (start=prevEnd+1).
    let end = (j===0) ? Math.min(pMax, start + step) : Math.min(pMax, start + step - 1);
    if (j===gr-1) end = pMax;
    const center = (start + end) / 2;

    const inside = byPrazo.filter(r=>{
      const p = Number(r.prazoInicial||0);
      const g = String(r.grupo);
      return p >= start && p <= end && !usedGroups.has(g);
    }).sort((a,b)=>_metric(a)-_metric(b));

    let chosen = inside.length ? inside[0] : null;

    if (!chosen){
      // fallback: prazo mais próximo do centro
      let bestD = Infinity;
      let best = null;
      for (const r of byPrazo){
        const g = String(r.grupo);
        if (usedGroups.has(g)) continue;
        const d = Math.abs(Number(r.prazoInicial||0) - center);
        if (d < bestD){
          bestD = d;
          best = r;
        }
      }
      chosen = best;
    }

    if (chosen){
      usedGroups.add(String(chosen.grupo));
      winners.push(chosen);
    }

    start = end + 1;
    if (start > pMax) break;
  }

  if (!winners.length) return null;
  const prazosChosen = winners.map(r=>Number(r.prazoInicial||0)).filter(Number.isFinite);
  return prazosChosen.map(p=>[p]);
}




    for (const p of prazosAll){
      const arr = byPrazo.get(p) || [];
      arr.sort((a,b)=>a.lanceSug-b.lanceSug || a.lancePctSug-b.lancePctSug || a.totalCredito-b.totalCredito);
      byPrazo.set(p, arr.slice(0, (target > 700000 ? 16 : 10)));
    }

    // escolhe um conjunto reduzido de prazos candidatos (melhores lances)
    const prazoRank = prazosAll.map(p=>{
      const arr = byPrazo.get(p) || [];
      const bestLance = arr.length ? Number(arr[0].lanceSug || 0) : Infinity;
      return { p, bestLance };
    }).sort((a,b)=>a.bestLance-b.bestLance);

    // garante variedade mínima de prazos
    const MAX_PRAZOS = (target > 700000 ? Math.max(40, Math.min(90, prazosAll.length)) : Math.max(22, Math.min(46, prazosAll.length)));
    const prazos = prazoRank.slice(0, MAX_PRAZOS).map(x=>x.p).sort((a,b)=>a-b);
    // budget para evitar travamentos em buscas maiores
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const BUDGET_MS = (target > 700000 ? 2600 : 650);
    let stop = false;

    function outOfBudget(){
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      return (now - t0) > BUDGET_MS;
    }

    
    function evaluateChosenPrazos(chosenPrazos){
      const optsLists = chosenPrazos.map(p => byPrazo.get(p) || []);
      const picked = [];
      const usedGroups = new Set();

      function dfsPick(i, sumCred, sumLanceReais, sumPrazo, motoMautoSum, motoMautoCount){
        if (stop) return;
        if (outOfBudget()) { stop = true; return; }
        if (i === optsLists.length){
          // Regra: buscar soma de créditos o mais próximo possível do alvo; usamos margem apenas como limite superior de busca (pruning).
          const maxCred = target * (isFinite(marginMaxF) ? Number(marginMaxF) : 1.55);
          if (sumCred > maxCred) return;

          // filtro de lance (lance médio/total) com faixa: -50% a +30% do valor informado
          if (lanceTarget && isFinite(Number(lanceTarget.valor)) && Number(lanceTarget.valor) > 0){
            const v = Number(lanceTarget.valor);
            const minV = v * 0.50;
            const maxV = v * 1.30;
            if (String(lanceTarget.tipo) === 'percentual'){
              const totalPct = sumCred ? (sumLanceReais / sumCred) * 100 : Infinity;
              if (!(totalPct >= minV && totalPct <= maxV)) return;
            } else {
              if (!(sumLanceReais >= minV && sumLanceReais <= maxV)) return;
            }
          }

          const meanPrazo = sumPrazo / k;
const dist = Math.abs(sumCred - target);
const scoreLance = sumLanceReais; // critério secundário: menor soma dos lances

// Regra principal (OE): soma de créditos o mais próximo possível do alvo.
// Desempates: menor soma de lances; depois maior prazo médio; depois menor lance médio (%).
const lanceMedPct = sumCred ? (sumLanceReais / sumCred) * 100 : Infinity;

if (
  dist < best.dist ||
  (dist === best.dist && scoreLance < best.score) ||
  (dist === best.dist && scoreLance === best.score && meanPrazo > best.meanPrazo) ||
  (dist === best.dist && scoreLance === best.score && meanPrazo === best.meanPrazo && lanceMedPct < best.lanceMedPct)
){
  best.score = scoreLance;
  best.dist = dist;
  best.meanPrazo = meanPrazo;
  best.lanceMedPct = lanceMedPct;
  best.rows = picked.slice();
}
          return;
        }

        for (const unit of (optsLists[i] || [])){
          const g = String(unit.grupo);
          if (usedGroups.has(g)) continue;

          const seg = String(unit.segmento || "").toUpperCase();
          const isMotoMauto = (seg.includes("MAUTO") || seg.includes("MOTO"));

          const unitCred = Number(unit.unitCredito || unit.totalCredito || 0);
          if (!(isFinite(unitCred) && unitCred > 0)) continue;

          const remainingUpper = (target * (isFinite(marginMaxF) ? Number(marginMaxF) : 1.20)) - sumCred;
          const roughMax = Math.max(1, Math.ceil((remainingUpper / unitCred)));

          // Limite de multiplicadores por segmento:
          // - AUTO-FIPE, AUTO-IPCA, PESADOS: 20x
          // - MAUTO mantém regra atual
          // - demais: limite alto apenas por performance
          let hardCap = (target > 700000 ? 60 : 24);
          if (seg.includes("AUTO-FIPE") || seg.includes("AUTO-IPCA") || seg.includes("PESADOS")){
            hardCap = 20;
          }
          const maxMult = Math.min(hardCap, roughMax + 2);

          for (let mult = 1; mult <= maxMult; mult++){
            const row = oeCloneWithMult(unit, mult);
            // Filtro de lance (ComboAuto): por linha, dentro de -50% / +30% do valor informado
            if (lanceTarget && isFinite(Number(lanceTarget.valor)) && Number(lanceTarget.valor) > 0){
              const v = Number(lanceTarget.valor);
              const minL = v * 0.50;
              const maxL = v * 1.30;
              if (String(lanceTarget.tipo) === 'percentual'){
                const pct = Number(row.lancePctSug||0);
                if (pct < minL || pct > maxL) { continue; }
              } else {
                const lr = Number(row.lanceSug||0);
                if (lr < minL || lr > maxL) { continue; }
              }
            }

            const pruneMax = target * (isFinite(pruneMaxF) ? Number(pruneMaxF) : 1.20);
            if (nextSumCred > pruneMax) break;

            const nextMotoMautoSum = isMotoMauto ? (motoMautoSum + Number(row.totalCredito||0)) : motoMautoSum;
            const nextMotoMautoCount = isMotoMauto ? (motoMautoCount + 1) : motoMautoCount;
            
            
            if (nextMotoMautoSum > 175000) continue;
            if (nextMotoMautoCount > maxMotoMautoCountAllowed) continue;

            usedGroups.add(g);
            picked.push(row);
            dfsPick(
              i + 1,
              nextSumCred,
              sumLanceReais + Number(row.lanceSug||0),
              sumPrazo + Number(row.prazoInicial||0),
              nextMotoMautoSum,
              nextMotoMautoCount
            );
            picked.pop();
            usedGroups.delete(g);
            if (stop) return;
          }
        }
      }

      dfsPick(0, 0, 0, 0, 0, 0);
    }

    function dfsPrazo(startIdx, chosenPrazos){
      if (stop) return;
      if (outOfBudget()) { stop = true; return; }
      if (chosenPrazos.length === k){
        evaluateChosenPrazos(chosenPrazos);
        return;
      }

      for (let i = startIdx; i < prazos.length; i++){
        chosenPrazos.push(prazos[i]);
        dfsPrazo(i + 1, chosenPrazos);
        chosenPrazos.pop();
      }
    }

    function dfsSlots(slotIdx, chosenPrazos, usedPrazos){
      if (stop) return;
      if (outOfBudget()) { stop = true; return; }
      if (slotIdx === k){
        evaluateChosenPrazos(chosenPrazos);
        return;
      }
      const candidates = (slotPrazos && slotPrazos[slotIdx]) ? slotPrazos[slotIdx] : [];
      for (const p of candidates){
        if (usedPrazos.has(p)) continue;
        chosenPrazos.push(p);
        usedPrazos.add(p);
        dfsSlots(slotIdx + 1, chosenPrazos, usedPrazos);
        usedPrazos.delete(p);
        chosenPrazos.pop();
        if (stop) return;
      }
    }

    if (hasPrazoRange && slotPrazos){
      dfsSlots(0, [], new Set());
    } else {
      dfsPrazo(0, []);
    }

    return best.rows;
  }


// Fallback: combinação rápida para sempre devolver resultado (usada apenas se a busca heurística não achar nada)
function oeGreedyFallback(cands, target, k){
  if (!cands || !cands.length) return [];

  // ordena por menor "custo" de lance por crédito e depois por menor lance
  const arr = cands.slice().sort((a,b)=>{
    const ra = a.totalCredito ? (a.lanceSug / a.totalCredito) : Infinity;
    const rb = b.totalCredito ? (b.lanceSug / b.totalCredito) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.lanceSug - b.lanceSug;
  }).slice(0, (target > 700000 ? 260 : 180));

  // Busca limitada por profundidade (DFS) com pruning simples
  let best = null;
  let bestDist = Infinity;

  function dfs(start, chosen, sumCred, sumLance, motoMautoSum, motoMautoCount, usedGroups){
    if (chosen.length === k){
      const dist = Math.abs(sumCred - target);
      if (dist < bestDist){
        bestDist = dist;
        best = chosen.slice();
      }
      return;
    }
    // pruning: se já passou muito do alvo e dist pior, corta
    if (sumCred > target * 2.6) return;

    for (let i=start; i<arr.length; i++){
      const r = arr[i];
      const g = String(r.grupo);
      if (usedGroups.has(g)) continue;

      const seg = String(r.segmento||"").toUpperCase();
      const isMotoMauto = (seg.includes("MAUTO") || seg.includes("MOTO"));
      if (isMotoMauto){
        if (motoMautoSum + Number(r.totalCredito||0) > 175000) continue;
        if (motoMautoCount + 1 > maxMotoMautoCountAllowed) continue;
      }

      // Filtro de lance (ComboAuto): por linha, dentro de -50% / +30% do valor informado
      if (typeof window !== 'undefined' && window.__OE_LANCE_TARGET){
        const lt = window.__OE_LANCE_TARGET;
        if (lt && isFinite(Number(lt.valor)) && Number(lt.valor) > 0){
          const v = Number(lt.valor);
          const minL = v * 0.50;
          const maxL = v * 1.30;
          if (String(lt.tipo) === 'percentual'){
            const pct = Number(r.lancePctSug||0);
            if (pct < minL || pct > maxL) continue;
          } else {
            const lr = Number(r.lanceSug||0);
            if (lr < minL || lr > maxL) continue;
          }
        }
      }

      // mantém prazos preferencialmente distintos (mas não obriga no fallback)
      chosen.push(r);
      usedGroups.add(g);
      dfs(i+1, chosen,
          sumCred + Number(r.totalCredito||0),
          sumLance + Number(r.lanceSug||0),
          motoMautoSum + (isMotoMauto ? Number(r.totalCredito||0) : 0),
          motoMautoCount + (isMotoMauto ? 1 : 0),
          usedGroups);
      usedGroups.delete(g);
      chosen.pop();

      if (best && bestDist === 0) return; // perfeito
    }
  }

  dfs(0, [], 0, 0, 0, 0, new Set());

  // Se não achou nada (muito raro), retorna os primeiros k sem repetir grupo respeitando MAUTO
  if (!best){
    const out = [];
    const used = new Set();
    let motoMautoSum = 0;
    for (const r of arr){
      const g = String(r.grupo);
      if (used.has(g)) continue;
      const seg = String(r.segmento||"").toUpperCase();
      const isMotoMauto = (seg.includes("MAUTO") || seg.includes("MOTO"));
      if (isMotoMauto){
        if (motoMautoSum + Number(r.totalCredito||0) > 175000) continue;
        motoMautoSum += Number(r.totalCredito||0);
      }
      used.add(g);
      out.push(r);
      if (out.length === k) break;
    }
    best = out;
  }
  // Ajuste de multiplicadores: permitido somar valores iguais do mesmo grupo
  // (sem repetir o grupo em linhas distintas). Aqui, caso ainda esteja longe do alvo,
  // aumentamos multiplicadores de forma gulosa para aproximar do crédito total.
  const units = (best || []).slice();
  if (!units.length) return [];

  const hardCap = (target > 700000 ? 60 : 24);
  const mults = units.map(()=>1);

  function totalsForMults(){
    let sumCred = 0;
    let motoMautoSum = 0;
    for (let i=0; i<units.length; i++){
      const u = units[i];
      const m = mults[i];
      const cred = Number(u.unitCredito || u.totalCredito || 0) * m;
      sumCred += cred;
      const segU = String(u.segmento||"").toUpperCase();
      const isMotoMauto = (segU.includes("MAUTO") || segU.includes("MOTO"));
      if (isMotoMauto){
        motoMautoSum += cred;
      }
    }
    return { sumCred, motoMautoSum };
  }

  // Ordena índices por melhor custo (% menor) para receber incrementos primeiro
  const order = units.map((u,idx)=>{
    const cred = Number(u.unitCredito || u.totalCredito || 0);
    const lance = getCalculatedLance(u.grupo, Math.max(1, cred), 0);
    const pct = cred ? (lance/cred) : Infinity;
    return { idx, pct, seg: String(u.segmento||"").toUpperCase() };
  }).sort((a,b)=>a.pct-b.pct);

  let guard = 0;
  while (guard < 800){
    guard++;
    const { sumCred, motoMautoSum } = totalsForMults();
    if (sumCred >= target) break;

    // tenta aumentar o melhor candidato que não viole MAUTO
    let bumped = false;
    for (const it of order){
      const i = it.idx;
      const u = units[i];
      // Limite de multiplicadores no fallback:
      // - AUTO-FIPE, AUTO-IPCA, PESADOS: 20x
      // - MAUTO mantém regra atual
      // - demais: hardCap (performance)
      const seg = String(u.segmento||"").toUpperCase();
      const cap = (seg.includes('AUTO-FIPE') || seg.includes('AUTO-IPCA') || seg.includes('PESADOS')) ? 20 : hardCap;
      if (mults[i] >= cap) continue;
      const isMotoMauto = (it.seg === "MAUTO" || it.seg === "MOTO");
      if (isMotoMauto){
        // respeita limite de crédito dentro do MAUTO
        const nextMotoMautoSum = motoMautoSum + Number(u.unitCredito || u.totalCredito || 0);
        if (nextMotoMautoSum > 175000) continue;
      }
      mults[i] += 1;
      bumped = true;
      break;
    }
    if (!bumped) break;
  }

  return units.map((u,i)=>oeCloneWithMult(u, mults[i]));
}



  function oeCustomSearch(creditoTarget, filtros, lanceTarget, lanceUpperPct){
    try{
      if (!oeCTbody){
        return;
      }
      const alvo = Number(creditoTarget);
      if (!isFinite(alvo) || alvo <= 0){
        oeCRenderEmpty("Informe um valor de crédito total válido.");
        return;
      }

      // Subtrai o que já foi selecionado (sem clicar em Limpar)
      const selTotals = oeCComputeTotalsFromChecked();
      const restante = Math.max(0, alvo - Number(selTotals.sumCredito||0));

      if (restante <= 0){
        // Ainda mostramos as linhas selecionadas para permitir ajustes
        const kept = Array.isArray(latestRowsOECustom) ? latestRowsOECustom.filter(r => selectedOECustomKeys.has(oeCustomRowKey(r))) : [];
        if (kept.length){
          oeCRenderTable(kept.slice(0,20), alvo);
          if (oeCStatusEl) oeCStatusEl.textContent = "Alvo atingido";
        } else {
          oeCRenderEmpty("Alvo já atingido pelos grupos selecionados.");
          if (oeCStatusEl) oeCStatusEl.textContent = "Alvo atingido";
        }
        return;
      }

      if (oeCStatusEl) oeCStatusEl.textContent = "Buscando…";

      // Gera candidatos usando a mesma base e filtros (ignorando a limitação de quantidade de grupos no resultado)
      const cands = oeBuildCandidateOptions(restante, filtros);

      // Filtra por lance (até X acima, sem limite para baixo), se informado
      let filtered = cands.slice();
      if (lanceTarget && isFinite(lanceTarget.valor) && lanceTarget.valor > 0){
        const tipo = String(lanceTarget.tipo||"reais");
        const maxAllowed = (tipo === "percentual")
          ? (restante * ((lanceTarget.valor * (1 + (lanceUpperPct||0))) / 100))
          : (lanceTarget.valor * (1 + (lanceUpperPct||0)));
        filtered = filtered.filter(r => Number(r.lanceSug||0) <= maxAllowed + 1e-9);
      }

      // Dedup por grupo+prazo (1 linha por grupo/prazo, ajuste via dropdown)
      const byKey = new Map();
      for (const r of filtered){
        const k = `${String(r.grupo)}|${String(r.prazoInicial)}`;
        const cur = byKey.get(k);
        // escolhe o mais próximo do restante
        if (!cur){
          byKey.set(k, r);
        } else {
          const d1 = Math.abs(Number(r.totalCredito||0) - restante);
          const d2 = Math.abs(Number(cur.totalCredito||0) - restante);
          if (d1 < d2) byKey.set(k, r);
        }
      }
      let options = Array.from(byKey.values());

      // Ordena por proximidade do restante e menor % de lance
      options.sort((a,b)=>{
        const da = Math.abs(Number(a.totalCredito||0) - restante);
        const db = Math.abs(Number(b.totalCredito||0) - restante);
        if (da !== db) return da - db;
        return Number(a.lancePctSug||0) - Number(b.lancePctSug||0);
      });

      options = options.slice(0, 20);

      // Preserva selecionados anteriores e completa com novas opções
      let finalRows = options;
      try{
        const kept = Array.isArray(latestRowsOECustom)
          ? latestRowsOECustom.filter(r => selectedOECustomKeys.has(oeCustomRowKey(r)))
          : [];
        if (kept.length){
          const keptKeys = new Set(kept.map(r => `${String(r.grupo)}|${String(r.prazoInicial)}`));
          const extras = options.filter(r => !keptKeys.has(`${String(r.grupo)}|${String(r.prazoInicial)}`));
          finalRows = kept.concat(extras).slice(0, 20);
        }
      }catch(e){}

      // Normaliza linhas (garante unit/mult)
      for (const r of finalRows){
        if (!r.mult) r.mult = 1;
        if (!r.unitCredito) r.unitCredito = Number(r.unitCredito || (Number(r.totalCredito||0) / Number(r.mult||1)));
      }

      if (!finalRows.length){
        oeCRenderEmpty("Nenhuma opção encontrada com os filtros atuais.");
        if (oeCStatusEl) oeCStatusEl.textContent = "Sem resultado";
        return;
      }

      if (oeCStatusEl) oeCStatusEl.textContent = `Restante: ${fmtBRL(restante)}`;
      oeCRenderTable(finalRows, alvo);
    }catch(e){
      console.error(e);
      oeCRenderEmpty("Erro ao buscar customizada: " + (e && e.message ? e.message : e));
      if (oeCStatusEl) oeCStatusEl.textContent = "Erro";
    }
  }


  function oeHasTwoTwenty(grupo){
    try{
      const g = String(grupo||'').trim();
      const db = (window && window.LANCE_DB) ? window.LANCE_DB : {};
      const arr = db && db[g] && Array.isArray(db[g].lances) ? db[g].lances : [];
      let c = 0;
      for (const v of arr){
        const n = Number(v);
        if (Math.abs(n - 20) < 1e-9) c += 1;
        if (c >= 2) return true;
      }
    }catch(e){}
    return false;
  }

function oeSearch(){
  try{
    const creditoTarget = Number(oeCreditoEl?.value);
    if (!isFinite(creditoTarget) || creditoTarget <= 0){
      oeRenderEmpty("Informe um valor de crédito total válido.");
      if (oeCreditoEl) oeCreditoEl.focus();
      return;
    }

    const k = Math.max(2, Math.min(10, parseInt(oeQtdEl?.value || "3", 10) || 3));
    if (oeQtdEl) oeQtdEl.value = String(k);

    // Faixa de prazo (opcional)
    const prazoMinRaw = Number(oePrazoMinEl?.value);
    const prazoMaxRaw = Number(oePrazoMaxEl?.value);
    let prazoMin = (isFinite(prazoMinRaw) && prazoMinRaw > 0) ? prazoMinRaw : null;
    let prazoMax = (isFinite(prazoMaxRaw) && prazoMaxRaw > 0) ? prazoMaxRaw : null;
    if (prazoMin !== null || prazoMax !== null){
      if (prazoMin === null) prazoMin = prazoMax;
      if (prazoMax === null) prazoMax = prazoMin;
      if (prazoMin > prazoMax){ const t = prazoMin; prazoMin = prazoMax; prazoMax = t; }
      // garante limites razoáveis
      prazoMin = Math.max(1, Math.floor(prazoMin));
      prazoMax = Math.max(prazoMin, Math.floor(prazoMax));
    }

    const lanceRaw = (oeLanceEl && oeLanceEl.value != null) ? String(oeLanceEl.value).trim() : "";
    const hasLance = (lanceRaw !== "") && isFinite(Number(lanceRaw)) && (Number(lanceRaw) > 0);
    const lanceTarget = hasLance ? { tipo: String(oeLanceTipoEl?.value || 'reais'), valor: Number(lanceRaw) } : null;
    // para o fallback (oeGreedyFallback) aplicar o mesmo filtro de lance por linha
    try{ window.__OE_LANCE_TARGET = lanceTarget; }catch(e){}

    const filtros = { k, prazoMin, prazoMax, hasPrazoRange: (prazoMin !== null && prazoMax !== null) };

    const useCustomEarly = !!(oeModeCustomEl && oeModeCustomEl.checked);
    if (useCustomEarly){
      if (oeCStatusEl) oeCStatusEl.textContent = "Buscando…";
      // Em modo Custom, geramos apenas a planilha Customizada (até 20 opções)
      oeCustomSearch(creditoTarget, filtros, lanceTarget, 0.20);
      if (oeCStatusEl) oeCStatusEl.textContent = "OK";
      return;
    }

    if (oeStatusEl) oeStatusEl.textContent = "Buscando…";


    // ComboAuto: se buscar novamente sem clicar em "Limpar", troque os grupos NÃO marcados por outros (evita repetir)
    const prevRowsOE = (!oeWasCleared && Array.isArray(latestRowsOE) && latestRowsOE.length) ? latestRowsOE.slice() : [];
    const uncheckedGroupsOE = new Set();
    if (prevRowsOE.length){
      try{
        const checks = Array.from(document.querySelectorAll('input.rowSelectOE[type="checkbox"]'));
        for (const cb of checks){
          const idx = Number(cb.getAttribute('data-idx'));
          const row = prevRowsOE[idx];
          if (!row) continue;
          if (!cb.checked) uncheckedGroupsOE.add(String(row.grupo));
        }
      }catch(e){}
    }


    // Estratégia: tenta regras mais restritas primeiro e flexibiliza caso não encontre.
    const attempts = [];

    const isHigh = creditoTarget > 700000;
    // Para créditos altos, margens amplas para garantir resultado.
    const baseMarginMin = isHigh ? 0.60 : 0.85;
    const baseMarginMax = isHigh ? 3.20 : 1.55;
    const basePruneMax  = isHigh ? 3.40 : 1.70;

    // 1) regra principal: até 20% acima no lance (sem limite para baixo)
    attempts.push({ filtros, marginMin: baseMarginMin, marginMax: baseMarginMax, pruneMax: basePruneMax, lanceUpper: 0.20 });
    // 2) amplia para 25% acima (ainda sem limite para baixo)
    attempts.push({ filtros, marginMin: baseMarginMin, marginMax: baseMarginMax, pruneMax: basePruneMax, lanceUpper: 0.25 });
    // 3) amplia mais o lance (último recurso) e pruning
    attempts.push({ filtros, marginMin: baseMarginMin, marginMax: (isHigh ? 3.80 : 1.75), pruneMax: (isHigh ? 4.00 : 1.90), lanceUpper: 0.35 });
let best = null;

    for (const a of attempts){
      let cands = oeBuildCandidateOptions(creditoTarget, a.filtros);
      // ComboAuto: remover grupos com 20% em 2 períodos ou mais (histórico)
      cands = cands.filter(r=>!oeHasTwoTwenty(r.grupo));
      // ComboAuto: em nova busca sem "Limpar", evitar repetir grupos não marcados
      if (uncheckedGroupsOE.size){
        const beforeUnchecked = cands;
        cands = cands.filter(r=>!uncheckedGroupsOE.has(String(r.grupo)));
        // se remover tudo, volta ao conjunto anterior (ainda excluindo 20% repetido)
        if (!cands.length) cands = beforeUnchecked;
      }
      const b = oePickBestCombo(cands, creditoTarget, k, lanceTarget, a.lanceUpper, a.marginMin, a.marginMax, a.pruneMax, a.filtros);
      if (b && b.length){
        best = b;
        break;
      }
    }

    // Fallback obrigatório: retorna alguma composição mesmo com filtros restritivos (relaxando prazo se preciso)
    if (!best || !best.length){
      const candsAll = oeBuildCandidateOptions(creditoTarget, { ...filtros, hasPrazoRange: false, prazoMin: null, prazoMax: null });
      const fb = oeGreedyFallback(candsAll, creditoTarget, k);
      if (fb && fb.length) best = fb;
    }

    if (!best || !best.length){
      oeRenderEmpty("Nenhuma operação encontrada com os filtros atuais. Tente reduzir a quantidade de grupos ou remover o filtro de lance/faixa de prazo.");
      if (oeStatusEl) oeStatusEl.textContent = "Sem resultado";
      return;
    }

    if (oeStatusEl) oeStatusEl.textContent = "OK";

    // Se houver seleção ativa e o usuário não clicou em Limpar, preserve os grupos selecionados
    // e complete com novas opções que satisfaçam os filtros, sem duplicar grupos em linhas distintas.
    let finalRows = best;
    try{
      const hasSel = selectedOEKeys && selectedOEKeys.size > 0;
      if (hasSel && Array.isArray(latestRowsOE) && latestRowsOE.length){
        const kept = latestRowsOE.filter(r => selectedOEKeys.has(oeRowKey(r)));
        if (kept.length){
          const keptKeys = new Set(kept.map(r => oeRowKey(r)));
          const extras = best.filter(r => !keptKeys.has(oeRowKey(r)) && !kept.some(k => String(k.grupo) === String(r.grupo)));
          finalRows = kept.concat(extras).slice(0, 20);
        }
      }
    }catch(e){}
    // Decide qual resultado está ativo
    const useCustom = !!(oeModeCustomEl && oeModeCustomEl.checked);

    if (!useCustom){
      oeRenderTable(finalRows);
    }

    if (useCustom){
      // Modo Custom: ignora a planilha ComboAuto e gera apenas a planilha customizada
      oeCustomSearch(creditoTarget, filtros, lanceTarget, 0.20);
    }

  }catch(e){
    console.error(e);
    oeRenderEmpty("Ocorreu um erro ao buscar operações. Tente novamente.");
    if (oeStatusEl) oeStatusEl.textContent = "Erro";
  }
}

function clear(){
    latestRows = []; if (selectAllEl) selectAllEl.checked = false;
    try{ selectedProposalKeys.clear(); }catch(e){}
    try{ expandedProposalKeys.clear(); }catch(e){}
    creditoEl.value = "";
    if (grupoEspecificoEl) grupoEspecificoEl.value = "";
    if (lanceEl) lanceEl.value = "";
    if (prazoEl) prazoEl.value = "";
    if (parcelaEl) parcelaEl.value = "";
    // volta o tipo de lance para o padrão escolhido em Configurações
    try{
      if (lanceTipoEl){
        lanceTipoEl.dataset.userChanged = "";
        lanceTipoEl.value = (USER_SETTINGS && USER_SETTINGS.formatoLancePadrao==='percentual') ? 'percentual' : 'reais';
      }
    }catch(e){}
    renderEmpty("Preencha o valor do crédito e clique em buscar.");
    creditoEl.focus();
  }

  btnBuscar.addEventListener("click", ()=>{ try{ try{ search(); } catch(e){ console.error(e); renderEmpty("Erro ao buscar: " + (e && e.message ? e.message : e)); } } catch(e){ console.error(e); renderEmpty("Erro ao buscar: " + (e && e.message ? e.message : e)); } });
  btnLimpar.addEventListener("click", clear);


  function closeModal(){
    if (!exportModal) return;
    exportModal.classList.add("hidden");
  }
  function openModal(selectedCount){
    if (!exportModal) return;
    try{ if (settingsModal) settingsModal.classList.add("hidden"); }catch(e){}
    try{ if (qualityModal) qualityModal.classList.add("hidden"); }catch(e){}
    exportSummary.textContent = selectedCount ? (`${selectedCount} opção(ões) selecionada(s). Confirme a data da assembléia para gerar o PDF.`) : "Selecione ao menos uma opção para exportar.";
    exportModal.classList.remove("hidden");
    if (dataAssembleiaEl && !dataAssembleiaEl.value){
      // sugere hoje
      dataAssembleiaEl.value = todayISOInBrasilia();
    }
  }

  // Data no fuso de Brasília (America/Sao_Paulo) em YYYY-MM-DD
  function todayISOInBrasilia(){
    try{
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const y = parts.find(p=>p.type==='year')?.value;
      const m = parts.find(p=>p.type==='month')?.value;
      const d = parts.find(p=>p.type==='day')?.value;
      if (y && m && d) return `${y}-${m}-${d}`;
    }catch(e){}
    // fallback
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function getSelectedRows(){
    const checks = Array.from(tbody.querySelectorAll('input.rowSelect:checked'));
    const idxs = checks.map(c => Number(c.dataset.idx)).filter(n => Number.isFinite(n));
    return idxs.map(i => latestRows[i]).filter(Boolean);
  }

  function formatDateBR(iso){
    if (!iso) return "—";
    const [y,m,d] = iso.split("-");
    if (!y||!m||!d) return iso;
    return `${d}/${m}/${y}`;
  }

  function imgToDataURL(imgEl){
    return new Promise((resolve) => {
      if (!imgEl) return resolve(null);
      const done = () => {
        try{
          // Se a imagem não carregou (naturalWidth 0), devolve null para usar o fallback.
          if ((imgEl.naturalWidth||0) === 0 || (imgEl.naturalHeight||0) === 0) return resolve(null);
          const c = document.createElement("canvas");
          c.width = imgEl.naturalWidth || imgEl.width;
          c.height = imgEl.naturalHeight || imgEl.height;
          const ctx = c.getContext("2d");
          ctx.drawImage(imgEl, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.92));
        }catch(e){
          resolve(null);
        }
      };
      // Se já terminou de tentar carregar e falhou, resolve imediatamente.
      if (imgEl.complete && (imgEl.naturalWidth||0) === 0) return resolve(null);
      if (imgEl.complete && (imgEl.naturalWidth||0) > 0) return done();
      imgEl.addEventListener("load", done, { once:true });
      imgEl.addEventListener("error", ()=>resolve(null), { once:true });
    });
  }

  
  // ---------------- Relatório e Consultas (histórico de PDFs gerados) ----------------
  const RC_STORAGE_KEY = 'GERPRO_PDF_LOG';

  function rcLoad(){
    try{
      const s = localStorage.getItem(RC_STORAGE_KEY);
      const arr = JSON.parse(s || '[]');
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }

  function rcSave(arr){
    try{
      localStorage.setItem(RC_STORAGE_KEY, JSON.stringify(arr || []));
    }catch(e){}
  }

  function rcAddRecord(rec){
    const arr = rcLoad();
    if (!rec || !rec.propostaNumero) return;
    // evita duplicar o mesmo número
    if (arr.some(x => x && x.propostaNumero === rec.propostaNumero)) return;
    arr.unshift(rec); // mais recente primeiro
    if (arr.length > 500) arr.length = 500;
    rcSave(arr);
  }

  function rcTipoLabel(kind){
    if (kind === 'propostas') return 'Proposta com Lance Sugerido';
    if (kind === 'oe' || kind === 'oe_custom') return 'Operação Estruturada';
    return String(kind||'—');
  }

async function exportPDF(){
    _exportCtx = { kind: "propostas" };
    const rows = (_exportCtx && (_exportCtx.kind === "oe" || _exportCtx.kind === "oe_custom"))
      ? (_exportCtx.kind === "oe_custom" ? oeCGetSelectedRows() : oeGetSelectedRows())
      : getSelectedRows();
    if (!rows.length){
      renderEmpty("Selecione ao menos uma opção para exportar.");
      return;
    }
    openModal(rows.length);
  }

  async function doPrint(){
    const rows = (_exportCtx && (_exportCtx.kind === "oe" || _exportCtx.kind === "oe_custom"))
      ? (_exportCtx.kind === "oe_custom" ? oeCGetSelectedRows() : oeGetSelectedRows())
      : getSelectedRows();
    if (!rows.length){ closeModal(); renderEmpty("Selecione ao menos uma opção para exportar."); return; }

    // Checklist automático antes da exportação (protege contra erros e inconsistências)
    if (!__BASE_OK){
      closeModal();
      renderEmpty("A base está com inconsistências críticas. Abra 'Qualidade da base' e corrija/atualize antes de exportar.");
      return;
    }
    try{
      if (CORE && CORE.checkBeforeExport){
        const ck = CORE.checkBeforeExport({ rows: rows, baseReport: { criticalCount: (__BASE_QUALITY && __BASE_QUALITY.criticalErrors ? __BASE_QUALITY.criticalErrors.length : 0) }, margins: Number(USER_SETTINGS.pdfMarginsMm||12) });
        if (!ck.ok){
          closeModal();
          const msg = (ck.errors || []).slice(0, 12).join("\n• ");
          alert("Não posso gerar o PDF por segurança. Motivos:\n• " + msg);
          return;
        }
      }
    }catch(e){}

    const dataAssembleia = dataAssembleiaEl ? dataAssembleiaEl.value : "";
    const includeTaxCols = !!(document.getElementById('pdfIncludeTaxas') && document.getElementById('pdfIncludeTaxas').checked);
    // Data da proposta no fuso de Brasília (evita "voltar um dia" quando o navegador estiver em outro fuso)
    const genDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());

    // Número sequencial da proposta (persistente no navegador) – inicia em 0100
    const SEQ_KEY = "OE_PROPOSAL_SEQ";
    const curSeq = Math.max(100, parseInt(localStorage.getItem(SEQ_KEY) || "100", 10) || 100);
    const seqStr = String(curSeq).padStart(4, "0");
    localStorage.setItem(SEQ_KEY, String(curSeq + 1));
    const [dd, mm, yyyy] = String(genDate).split("/");
    const yy = (yyyy || "").slice(-2);
    const titleDate = (dd && mm && yy) ? `${dd}/${mm}/${yy}` : genDate;

    const leftImg = document.getElementById("logoLeft");
    const rightImg = document.getElementById("logoRight");
    const afterImg = document.getElementById("logoAfter");
    const leftData = await imgToDataURL(leftImg);
    const rightData = await imgToDataURL(rightImg);
    const afterData = await imgToDataURL(afterImg);

    const bgImg = document.getElementById("bgMark");
    const bgData = await imgToDataURL(bgImg);
    const bgFallback = new URL("watermark.png", location.href).href;


    const leftFallback = new URL("logoguerra.png", location.href).href;
    const rightFallback = new URL("logoBB.png", location.href).href;
    const afterFallback = new URL("2.jpg", location.href).href;

    // Legendas em ordem coerente com o cabeçalho (sem "Grupo")
    const explain = [
      ["Valor do Crédito", "Valor da carta de crédito que estará disponível após a contemplação."],
      ["Prazo Inicial", "Prazo total do grupo."],
      ["Parcela Inicial", "Primeira parcela do consórcio (após o pagamento, o cliente passa a concorrer por sorteio ou lance)."],
      ["Lance Sugerido", "Valor calculado para buscar contemplação na próxima assembleia."],
      ["Parcela Pós Lance", "Valor das parcelas após a contemplação usando o lance sugerido."],
      ["Prazo pós Lance", "Quantidade de parcelas após a contemplação usando o lance sugerido."],
      ...(includeTaxCols ? [
        ["Taxa de Adm Total", "Taxa fixa do consórcio que remunera a administradora pela gestão e operação do grupo."],
        ["Fundo de Reserva Total", "Taxa extra para cobrir inadimplência e despesas imprevistas do grupo; se não usada, é devolvida ao final do grupo."]
      ] : [])
    ];

    const w = window.open("", "_blank");
    if (!w) { closeModal(); renderEmpty("Não foi possível abrir a janela de impressão (pop-up bloqueado)."); return; }

    const buildRowsHtml = (pageRows, startIndex) => pageRows.map((r, idx)=>{
      const i = startIndex + idx;
      const lanceTxt = `${fmtBRL(r.lanceSug)} <span class="pct">(${formatPct((r.totalCredito? (r.lanceSug/r.totalCredito)*100:0))})</span>`;
      // No PDF da aba Operações Estruturadas: não exibir multiplicador (regra do usuário)
      const grupoPublico = groupPublicName(r.grupo);
      const taxTds = includeTaxCols ? `
        <td style="text-align:right">${formatPct(r.taxaAdmPct)} <span class="pct">${fmtBRL(r.taxaAdmReais)}</span></td>
        <td style="text-align:right">${formatPct(r.fundoResPct)} <span class="pct">${fmtBRL(r.fundoResReais)}</span></td>
      ` : "";
      return `<tr>
        <td style="text-align:center">${i+1}</td>
        <td>${grupoPublico}</td>
        <td style="text-align:right">${fmtBRL(r.totalCredito)}</td>
        <td style="text-align:center">${r.prazoInicial}</td>
        <td style="text-align:right">${fmtBRL(r.parcelaInicial)}</td>
        <td style="text-align:right">${lanceTxt}</td>
        <td style="text-align:right">${fmtBRL(r.parcelaPos)}</td>
        <td style="text-align:center">${r.prazoPos}</td>
        ${taxTds}
      </tr>`;
    }).join("");

    // Paginação:
    // - Propostas: mantém paginação conservadora para preservar layout.
    // - Operações Estruturadas: o usuário pediu PDF em 1 página; então evitamos paginação
    //   e ajustamos compactação (font/padding) via CSS abaixo.
    const isOE = (_exportCtx && (_exportCtx.kind === "oe" || _exportCtx.kind === "oe_custom"));
    const isOECustom = (_exportCtx && _exportCtx.kind === "oe_custom");
    const MAX_ROWS_PER_PAGE = isOE ? 9999 : 10;
    const pages = [];
    for (let i=0; i<rows.length; i += MAX_ROWS_PER_PAGE){
      pages.push({ start:i, rows: rows.slice(i, i + MAX_ROWS_PER_PAGE) });
    }

    const explainHtml = explain.map(([k,v]) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

    // (isOE já calculado acima)
    let oeExtraHtml = "";
    let oeTotalsRowHtml = "";
    if (isOE){
      const sortedOE = rows.slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
      const sumCredito = sortedOE.reduce((a,r)=>a+Number(r.totalCredito||0),0);
      const sumParcIni = sortedOE.reduce((a,r)=>a+Number(r.parcelaInicial||0),0);
      const sumLance = sortedOE.reduce((a,r)=>a+Number(r.lanceSug||0),0);
      const sumTaxaAdm = sortedOE.reduce((a,r)=>a+Number(r.taxaAdmReais||0),0);
      const sumFundoRes = sortedOE.reduce((a,r)=>a+Number(r.fundoResReais||0),0);
      const pct = sumCredito ? (sumLance/sumCredito)*100 : 0;

      const oeTaxTds = includeTaxCols ? `
          <td style="text-align:right">${formatPct(sumCredito ? (sumTaxaAdm/sumCredito)*100 : 0)}</td>
          <td style="text-align:right">${formatPct(sumCredito ? (sumFundoRes/sumCredito)*100 : 0)}</td>
      ` : ``;



      // TOTAL row em destaque (+2pt)
      oeTotalsRowHtml = `
        <tr class="tot">
          <td style="text-align:center">—</td>
          <td>TOTAL</td>
          <td style="text-align:right">${fmtBRL(sumCredito)}</td>
          <td style="text-align:center">—</td>
          <td style="text-align:right">${fmtBRL(sumParcIni)}</td>
          <td style="text-align:right">${fmtBRL(sumLance)} <span class="pct">(${formatPct(pct)})</span></td>
          <td style="text-align:right">—</td>
          <td style="text-align:center">—</td>
          ${oeTaxTds}
        </tr>
      `;

      // Demonstrativo de parcelas pós lance (vertical, à esquerda)
      const ranges = oeComputeParcelasRanges(sortedOE);
      const rangesHtml = ranges.map(r=>{
        const faixa = (r.start===r.end) ? `${r.start}` : `${r.start} a ${r.end}`;
        return `<div class="range"><span class="faixa"><b>${faixa}</b></span><span class="valor">${fmtBRL(r.valor)}</span></div>`;
      }).join("");

      // Gráfico de linhas (SVG) – eixo X: faixas (mudança de valor), eixo Y: valor das parcelas
      const xs = ranges.map((r, i)=>i);
      const ys = ranges.map(r=>Number(r.valor||0));
      const maxY = Math.max(1, ...ys);
      const minY = Math.min(...ys);
      const W = 520, H = 150, padL = 48, padR = 12, padT = 18, padB = 44;
      const xStep = (W - padL - padR) / Math.max(1, (xs.length - 1));
      const yScale = (H - padT - padB) / Math.max(1e-6, (maxY - minY || maxY));

      const pts = ys.map((y,i)=>{
        const x = padL + i * xStep;
        const yy = padT + (maxY - y) * yScale;
        return { x, y: yy, v: y, label: (ranges[i].start===ranges[i].end) ? String(ranges[i].start) : `${ranges[i].start}-${ranges[i].end}` };
      });

      const poly = pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

      const yTicks = 4;
      const tickLines = Array.from({length:yTicks+1}, (_,i)=>{
        const t = i / yTicks;
        const y = padT + t * (H - padT - padB);
        const val = maxY - t * (maxY - minY);
        return `<g opacity="0.35">
          <line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="rgb(0,2,96)" stroke-width="1" />
          <text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10" fill="rgb(0,2,96)">${fmtBRL(val).replace('R$','').trim()}</text>
        </g>`;
      }).join("");

      const pointLabels = pts.map((p,i)=>`
        <circle cx="${p.x}" cy="${p.y}" r="3.2" fill="rgb(0,2,96)"></circle>
        <text x="${p.x}" y="${p.y-8}" text-anchor="middle" font-size="10" fill="rgb(0,2,96)">${fmtBRL(p.v).replace('R$','').trim()}</text>
        <text x="${p.x}" y="${H-18}" text-anchor="middle" font-size="10" fill="rgb(0,2,96)">${p.label}</text>
      `).join("");


      // Observação (pedido do usuário): no PDF da planilha Custom NÃO deve aparecer o bloco:
      // "Valor Presente/Parcelado", "Taxa de Adm + F. Res", "Custo Estimado Total" e "Custo Estimado Mensal".
      // Essas métricas seguem disponíveis na tela (rodapé), mas não entram no documento.
      const oeMetricsHtml = "";

      oeExtraHtml = `
        <div class="oe-extra${isOECustom ? " custom" : ""}">
          <div class="oe-row">
            <div class="oe-parcelas">
              <div class="oe-parcelas-title"><b>Parcelas pós lance (decrescentes)</b></div>
              <div class="oe-parcelas-list">${rangesHtml}</div>
            </div>

            <div class="oe-chart">
              <div class="oe-parcelas-title"><b>Gráfico – Parcelas pós lance</b></div>
              <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
              ${tickLines}
              <polyline points="${poly}" fill="none" stroke="rgb(0,2,96)" stroke-width="2.2" />
              ${pointLabels}
              <line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="rgb(0,2,96)" stroke-width="1.4" />
              <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="rgb(0,2,96)" stroke-width="1.4" />
              </svg>
            </div>
          </div>
          ${oeMetricsHtml}

        </div>
      `;
    }

    const safeDate = String(titleDate || "").replaceAll("/","-");
    const proposalId = `Proposta ${seqStr}-${titleDate}`;
    const filename = `Proposta_${seqStr}-${safeDate}.pdf`;

    // Registra no Relatório e Consultas (somente quando o usuário clica em Gerar PDF)
    try{
      const sumCredito = rows.reduce((a,r)=>a+Number(r.totalCredito||0),0);
      rcAddRecord({
        propostaNumero: `${seqStr}-${titleDate}`,
        radical: seqStr,
        dataCriacao: genDate, // dd/mm/aaaa (Brasília)
        dataAssembleia: dataAssembleia || "",
        tipo: rcTipoLabel(_exportCtx?.kind || 'propostas'),
        kind: (_exportCtx?.kind || 'propostas'),
        valorCredito: sumCredito,
        rows: rows.map(r => ({
          grupo: r.grupo,
          totalCredito: Number(r.totalCredito||0),
          prazoInicial: Number(r.prazoInicial||0),
          parcelaInicial: Number(r.parcelaInicial||0),
          lanceSug: Number(r.lanceSug||0),
          parcelaPos: Number(r.parcelaPos||0),
          prazoPos: Number(r.prazoPos||0),
          taxaAdmPct: Number(r.taxaAdmPct||0),
          fundoResPct: Number(r.fundoResPct||0),
          taxaAdmReais: Number(r.taxaAdmReais||0),
          fundoResReais: Number(r.fundoResReais||0),
          segmento: r.segmento || ""
        }))
      });
    }catch(e){}

    // Compactação para garantir 1 página em Operações Estruturadas
    const oeRowCount = rows.length;
    let metaFont = 14, titleFont = 22, tableFont = 14, thPad = 7, tdPad = 6, totFont = 16, oeExtraFont = 12;
    if (isOE){
      if (oeRowCount >= 9){
        metaFont = 13; titleFont = 20; tableFont = 12; thPad = 5; tdPad = 4; totFont = 14; oeExtraFont = 11;
      }
      if (oeRowCount >= 10){
        metaFont = 12; titleFont = 19; tableFont = 11; thPad = 4; tdPad = 3; totFont = 13; oeExtraFont = 10;
      }
    }
    const marginMm = Number(USER_SETTINGS && USER_SETTINGS.pdfMarginsMm ? USER_SETTINGS.pdfMarginsMm : 12) || 12;

    w.document.open();
    w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${filename}</title>
      <style>
        @page { size: A4 landscape; margin: ${marginMm}mm; }
        body{
          font-family: Calibri, Arial, Helvetica, sans-serif;
          color: rgb(0,2,96);
          font-weight:800;
          /* Padrão solicitado: A4 paisagem e 85% do tamanho */
          zoom: 0.85;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .wm{
          position:fixed;
          inset:0;
          background-repeat:no-repeat;
          background-position:center;
          background-size: 70%;
          opacity: .05; /* 95% transparente */
          pointer-events:none;
          z-index:0;
        }
        .page, .header, .meta, .title, .table-wrap, .foot{ position:relative; z-index:1; }

        .page{ width:100%; page-break-after: auto; }
        .page:last-child{ page-break-after: auto; }
        .header{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:8px 0 8px 0;
          border-bottom:3px solid rgb(0,2,96);
        }
        .header-col{ display:flex; align-items:center; }
        .header-left{ flex:0 0 auto; }
        .header-right{ flex:0 0 auto; justify-content:flex-end; }
        .header-mid{ flex:1 1 auto; justify-content:center; }
        .logo{ object-fit:contain; }
        .logo-left{ height:69px; }
        /* Logo BB – respeitar comprimento mínimo de 35mm */
        .logo-right{ width:35mm; height:auto; }
        .logo-after{ width:70mm; height:auto; }
        .meta{
          display:flex;
          justify-content:space-between;
          margin-top:6px;
          font-size:${metaFont}px;
          font-weight:800;
        }
        .meta strong{ color: rgb(0,2,96); }
        .title{
          font-size:${titleFont}px;
          font-weight:800;
          color: rgb(0,2,96);
          margin:10px 0 8px 0;
          letter-spacing:.2px;
        }

        /* Table */
        .table-wrap{ display:flex; justify-content:center; }
        table{
          width:92%;
          max-width:980px;
          border-collapse:collapse;
          font-size:${tableFont}px;
          table-layout:fixed;
          margin:0 auto;
        }
        thead th{
          background:#F0F000;
          padding:${thPad}px 6px;
          border:0;
          text-align: left;
          font-weight:800;
        }
        tbody td{
          padding:${tdPad}px 6px;
          border:0;
          vertical-align:middle;
          text-align: left;
          word-wrap:break-word;
          font-weight:800;
        }
        tbody tr:nth-child(even){ background:#f7f7f7; }
        tbody tr:nth-child(odd){ background:#ffffff; }
        .pct{
          display:block;
          font-size:11px;
          opacity:.85;
          margin-top:1px;
        }

        /* Explanations */
        .foot{
          width:92%;
          max-width:980px;
          margin:6px auto 0 auto;
          display:grid;
          grid-template-columns:repeat(4, 1fr);
          gap:4px;
          font-size:9px;
          line-height:1.25;
        }
        .kv{
          border-left:3px solid rgb(0,2,96);
          padding:2px 4px;
          background:#f7f7f7;
        }
        .k{ font-weight:800; margin-bottom:1px; color: rgb(0,2,96); font-size:10px; }
        .v{ color: rgb(0,2,96); font-size:9px; font-weight:800; }


        tbody tr.tot td{
          font-size:${totFont}px;
          font-weight:800;
          background:#F0F000;
        }

        .oe-extra{
          width:92%;
          max-width:980px;
          margin:10px auto 0 auto;
          font-size:${oeExtraFont}px;
          font-weight:800;
        }
        .oe-extra.custom{
          font-size:${oeExtraFont+2}px;
        }

        .oe-row{ display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-top:8px; }
        .oe-parcelas{ flex:0 0 42%; }
        .oe-chart{ flex:0 0 56%; display:flex; flex-direction:column; align-items:flex-end; }
        .oe-top{
          display:flex;
          gap:16px;
          flex-wrap:wrap;
          margin-bottom:8px;
        }
        .oe-parcelas{
          margin-top:6px;
        }
        .oe-parcelas-title{
          margin:4px 0 4px 0;
        }
        .oe-parcelas-list{
          display:block;
          text-align:left;
          font-size:12px;
          line-height:1.35;
        }
        /* Prazo e valor lado a lado (valor imediatamente ao lado do prazo) */
        .oe-parcelas-list .range{ margin:2px 0; display:grid; grid-template-columns: 92px auto; gap:10px; align-items:baseline; justify-content:start; }
        .oe-parcelas-list .range .faixa{ min-width: 92px; display:inline-block; }
        .oe-parcelas-list .range .valor{ white-space:nowrap; }
        .oe-chart{ margin-top:6px; }

        .after-wrap{ width:92%; max-width:980px; margin:6px auto 0 auto; display:flex; justify-content:space-between; }

        .disclaimer{
          width:92%;
          max-width:980px;
          margin:8px auto 0 auto;
          display:flex;
          justify-content:flex-end;
          gap:12px;
          font-size:8px;
          font-weight:400;
          text-align:right;
          color: rgb(0,2,96);
        }
      </style></head><body><div class="wm" style="background-image:url('${bgData || bgFallback}')"></div>
        ${pages.map(p=>{
          const rowsHtml = buildRowsHtml(p.rows, p.start);
          const isLastPage = (p.start + p.rows.length >= rows.length);
          return `
          <div class="page">
            <div class="header">
              <div class="header-col header-left">${leftData ? `<img class="logo logo-left" src="${leftData}" />` : `<img class="logo logo-left" src="${leftFallback}" />`}</div>
              <div class="header-col header-mid">${afterData ? `<img class="logo logo-after" src="${afterData}" />` : `<img class="logo logo-after" src="${afterFallback}" />`}</div>
              <div class="header-col header-right">${rightData ? `<img class="logo logo-right" src="${rightData}" />` : `<img class="logo logo-right" src="${rightFallback}" />`}</div>
            </div>
            <div class="meta">
              <div><strong>Data da proposta:</strong> ${genDate}</div>
              <div><strong>Data da assembléia:</strong> ${formatDateBR(dataAssembleia)}</div>
            </div>

            <div class="title">${proposalId} - Consórcio com Lance Sugerido${isOE ? " Parcelas Decrescentes" : ""}</div>

            <div class="table-wrap"><table>
              <thead>
                <tr>
                  <th style="width:28px; text-align:center">#</th>
                  <th style="width:120px; text-align:left">Grupo</th>
                  <th style="width:150px; text-align:right">Valor do Crédito</th>
                  <th style="width:95px; text-align:center">Prazo Inicial</th>
                  <th style="width:120px; text-align:right">Parcela Inicial</th>
                  <th style="width:150px; text-align:right">Lance Sugerido</th>
                  <th style="width:125px; text-align:right">Parcela Pós Lance</th>
                  <th style="width:95px; text-align:center">Prazo pós Lance</th>
                  ${includeTaxCols ? `
                    <th style="width:110px; text-align:right">Taxa Adm Total</th>
                    <th style="width:110px; text-align:right">Fundo Res Total</th>
                  ` : ""}
                </tr>
              </thead>
              <tbody>${rowsHtml}${(isOE && isLastPage) ? oeTotalsRowHtml : ""}</tbody>
            </table></div>

            ${ (isOE && (p.start + p.rows.length >= rows.length)) ? oeExtraHtml : "" }
            ${!isOE ? ('<div class="foot">' + explainHtml + '</div>') : ""}
<div class="disclaimer">
              <div>Proposta sujeita a disponibilidade de vaga nos grupos</div>
                          </div>
          </div>`;
        }).join("")}

        <script>
          window.onload = () => { try{ document.title = ${JSON.stringify(filename)}; }catch(e){} window.focus(); window.print(); };
        </script>
      
</body></html>`);
    w.document.close();
    closeModal();
  }

  function setUpdatePill(){
    if (!statusUpdates) return;
    const ts = localStorage.getItem(STORAGE_KEYS.updatedAt);
    if (!ts){
      statusUpdates.textContent = "Sem atualizações locais";
      return;
    }
    const d = new Date(ts);
    if (isFinite(d.getTime())){
      const dd = String(d.getDate()).padStart(2,"0");
      const mm = String(d.getMonth()+1).padStart(2,"0");
      const yy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2,"0");
      const mi = String(d.getMinutes()).padStart(2,"0");
      statusUpdates.textContent = `Atualizado em ${dd}/${mm}/${yy} ${hh}:${mi}`;
    } else {
      statusUpdates.textContent = "Atualizações locais ativas";
    }
  }

  // ---------------- Configurações (salvas no navegador) ----------------
  let USER_SETTINGS = (CORE && CORE.getSettings) ? CORE.getSettings() : {
    pdfMarginsMm: 12,
    maxLinhasTela: 25,
    formatoLancePadrao: 'reais',
    tabelaSimplificada: false,
    modoDiagnostico: false,
    mostrarExplicacoes: false,
  };

  function applySettingsToApp(){
    try{
      // visualização simplificada (somente na tela)
      document.body.classList.toggle('simpleView', !!USER_SETTINGS.tabelaSimplificada);

      // formato padrão do lance: só aplica se o usuário ainda não escolheu manualmente
      if (lanceTipoEl && !lanceTipoEl.dataset.userChanged){
        lanceTipoEl.value = USER_SETTINGS.formatoLancePadrao === 'percentual' ? 'percentual' : 'reais';
      }
      if (oeLanceTipoEl && !oeLanceTipoEl.dataset.userChanged){
        oeLanceTipoEl.value = USER_SETTINGS.formatoLancePadrao === 'percentual' ? 'percentual' : 'reais';
      }
      if (oeLanceTipoEl2 && !oeLanceTipoEl2.dataset.userChanged){
        oeLanceTipoEl2.value = USER_SETTINGS.formatoLancePadrao === 'percentual' ? 'percentual' : 'reais';
      }

      // mostra/oculta explicações
      const showExpl = !!USER_SETTINGS.mostrarExplicacoes;
      document.documentElement.style.setProperty('--show-explanations', showExpl ? '1' : '0');

      // se estiver em modo diagnóstico, exibe uma faixa leve no rodapé
      const diag = document.getElementById('diagBar');
      if (diag) diag.classList.toggle('hidden', !USER_SETTINGS.modoDiagnostico);
    }catch(e){}
  }

  function syncSettingsForm(){
    // Carrega valores atuais nas caixas da aba Configurações
    try{
      USER_SETTINGS = (CORE && CORE.getSettings) ? CORE.getSettings() : (USER_SETTINGS || {});
      if (cfgPdfMargins) cfgPdfMargins.value = USER_SETTINGS.pdfMarginsMm;
      if (cfgMargemSeguranca) cfgMargemSeguranca.value = (Number(USER_SETTINGS.margemSeguranca ?? 2.5)).toFixed(2);
      if (cfgMaxLinhas) cfgMaxLinhas.value = USER_SETTINGS.maxLinhasTela;
      if (cfgFormatoLance) cfgFormatoLance.value = USER_SETTINGS.formatoLancePadrao;
      if (cfgTabelaSimplificada) cfgTabelaSimplificada.checked = !!USER_SETTINGS.tabelaSimplificada;
      if (cfgMostrarExplicacoes) cfgMostrarExplicacoes.checked = !!USER_SETTINGS.mostrarExplicacoes;
      if (cfgModoDiagnostico) cfgModoDiagnostico.checked = !!USER_SETTINGS.modoDiagnostico;
    }catch(e){}
  }
  // usado pelo controlador de abas (painel_lances.js)
  window.__syncSettingsForm = syncSettingsForm;

  function openSettingsModal(){
    // compatibilidade: modal removido, agora é uma aba
    syncSettingsForm();
  }
  function closeSettingsModal(){
    // compatibilidade
  }

  function saveSettingsFromModal(){
    const next = {
      pdfMarginsMm: Number(cfgPdfMargins && cfgPdfMargins.value),
      maxLinhasTela: Number(cfgMaxLinhas && cfgMaxLinhas.value),
      formatoLancePadrao: (cfgFormatoLance && cfgFormatoLance.value) || 'reais',
      tabelaSimplificada: !!(cfgTabelaSimplificada && cfgTabelaSimplificada.checked),
      mostrarExplicacoes: !!(cfgMostrarExplicacoes && cfgMostrarExplicacoes.checked),
      modoDiagnostico: !!(cfgModoDiagnostico && cfgModoDiagnostico.checked),
      margemSeguranca: Number(cfgMargemSeguranca && cfgMargemSeguranca.value),
    };
    USER_SETTINGS = (CORE && CORE.saveSettings) ? CORE.saveSettings(next) : Object.assign({}, USER_SETTINGS, next);
    applySettingsToApp();
    closeSettingsModal();
    // re-render para aplicar limite de linhas
    try{ if (latestRows && latestRows.length) renderTable(latestRows); }catch(e){}
    try{ if (latestRowsOE && latestRowsOE.length) oeRenderTable(latestRowsOE, _oeCreditoAlvo||0); }catch(e){}
    try{ if (latestRowsOECustom && latestRowsOECustom.length) oeCRenderTable(latestRowsOECustom, _oeCCreditoAlvo||0); }catch(e){}
  }

  // marca quando o usuário escolhe manualmente o tipo de lance
  if (lanceTipoEl){
    lanceTipoEl.addEventListener('change', ()=>{ lanceTipoEl.dataset.userChanged = '1'; });
  }
  if (oeLanceTipoEl){
    oeLanceTipoEl.addEventListener('change', ()=>{ oeLanceTipoEl.dataset.userChanged = '1'; });
  }
  // oeLanceTipoEl2 pode não existir em versões antigas
  const oeLanceTipoEl2 = document.getElementById('oeLanceTipo2');
  if (oeLanceTipoEl2){
    oeLanceTipoEl2.addEventListener('change', ()=>{ oeLanceTipoEl2.dataset.userChanged = '1'; });
  }

  // botões/ações
  if (btnSettings){
    btnSettings.addEventListener('click', (e)=>{ e.preventDefault(); openSettingsModal(); });
  }
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (btnSalvarSettings) btnSalvarSettings.addEventListener('click', saveSettingsFromModal);
  if (settingsModal) settingsModal.addEventListener('click', (ev)=>{ if (ev.target === settingsModal) closeSettingsModal(); });
  if (btnOpenQualidade) btnOpenQualidade.addEventListener('click', ()=>{ closeSettingsModal(); openQualityModal(); });

  // Aplica ao carregar
  applySettingsToApp();

  // ---------------- Relatório de qualidade da base ----------------
  function buildQualityHtml(){
    const q = __BASE_QUALITY || { criticalErrors: [], warnings: [], info: {} };
    const critical = (q.criticalErrors || []);
    const warns = (q.warnings || []);
    const info = q.info || {};

    const lines = [];
    lines.push(`<div><b>Total de grupos carregados:</b> ${info.totalGrupos || 0}</div>`);
    lines.push(`<div><b>Total de linhas (base):</b> ${info.totalLinhas || 0}</div>`);
    lines.push(`<div><b>Origem:</b> ${baseOriginLabel()} • <b>Última atualização:</b> ${baseUpdatedAtLabel()}</div>`);

    if (info.gruposSemHistorico && info.gruposSemHistorico.length){
      lines.push(`<div style="margin-top:8px"><b>Grupos sem histórico suficiente no Painel:</b> ${info.gruposSemHistorico.length}</div>`);
      lines.push(`<div class="muted" style="font-size:12px; margin-top:2px">Ex.: ${info.gruposSemHistorico.slice(0, 20).join(', ')}${info.gruposSemHistorico.length>20?'…':''}</div>`);
    }

    if (critical.length){
      lines.push('<div style="margin-top:10px"><b style="color:#b10000">Inconsistências críticas (bloqueiam PDF)</b></div>');
      lines.push('<ul>' + critical.map(x=>`<li>${escapeHtml(x)}</li>`).join('') + '</ul>');
    } else {
      lines.push('<div style="margin-top:10px"><b style="color:#0c6b2c">Sem inconsistências críticas</b></div>');
    }

    if (warns.length){
      lines.push('<div style="margin-top:10px"><b>Avisos</b></div>');
      lines.push('<ul>' + warns.map(x=>`<li>${escapeHtml(x)}</li>`).join('') + '</ul>');
    }

    lines.push('<div class="muted" style="margin-top:10px; font-size:12px">Dica: enquanto houver item crítico, a exportação de PDF fica bloqueada para evitar proposta incorreta.</div>');

    return lines.join('');
  }

  function escapeHtml(s){
    return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  function openQualityModal(){
    if (!qualityModal) return;
    try{ if (qualityBody) qualityBody.innerHTML = buildQualityHtml(); }catch(e){}
    qualityModal.classList.remove('hidden');
  }
  function closeQualityModal(){
    if (!qualityModal) return;
    qualityModal.classList.add('hidden');
  }

  if (btnQualidadeBase) btnQualidadeBase.addEventListener('click', openQualityModal);
  if (btnCloseQuality) btnCloseQuality.addEventListener('click', closeQualityModal);
  if (btnCloseQuality2) btnCloseQuality2.addEventListener('click', closeQualityModal);
  if (qualityModal) qualityModal.addEventListener('click', (ev)=>{ if (ev.target === qualityModal) closeQualityModal(); });

  if (btnRestaurarBaseOriginal){
    btnRestaurarBaseOriginal.addEventListener('click', ()=>{ try{ if (btnClearLocal) btnClearLocal.click(); }catch(e){} });
  }

  // Pequena barra de diagnóstico (só aparece quando ativada)
  function updateDiagBar(text){
    try{
      const diag = document.getElementById('diagBar');
      if (!diag) return;
      diag.textContent = text || '';
    }catch(e){}
  }


  // ---------------- XLSX (parser mínimo, sem dependências externas) ----------------
  // Funciona para planilhas simples (1ª aba, 1ª linha = cabeçalho).
  // XLSX é ZIP: extraímos sharedStrings + sheet1 e montamos um array de objetos.
  const u32 = (dv,o) => dv.getUint32(o, true);
  const u16 = (dv,o) => dv.getUint16(o, true);

  function findEOCD(bytes){
    // procura assinatura 0x06054b50 no final do arquivo
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--){
      if (bytes[i] === 0x50 && bytes[i+1] === 0x4b && bytes[i+2] === 0x05 && bytes[i+3] === 0x06) return i;
    }
    return -1;
  }

  async function inflateRaw(data){
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function readZipEntries(xlsxBytes){
    const bytes = xlsxBytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOff = findEOCD(bytes);
    if (eocdOff < 0) throw new Error("XLSX inválido (EOCD não encontrado)");
    const cdCount = u16(dv, eocdOff + 10);
    const cdOff = u32(dv, eocdOff + 16);
    let ptr = cdOff;
    const enc = new TextDecoder("utf-8");
    const entries = new Map();
    for (let i=0; i<cdCount; i++){
      if (u32(dv, ptr) !== 0x02014b50) break;
      const comp = u16(dv, ptr + 10);
      const compSize = u32(dv, ptr + 20);
      const nameLen = u16(dv, ptr + 28);
      const extraLen = u16(dv, ptr + 30);
      const commentLen = u16(dv, ptr + 32);
      const localOff = u32(dv, ptr + 42);
      const name = enc.decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
      entries.set(name, { comp, compSize, localOff });
      ptr = ptr + 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function readZipFile(bytes, entries, name){
    const ent = entries.get(name);
    if (!ent) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const o = ent.localOff;
    if (u32(dv, o) !== 0x04034b50) return null;
    const comp = u16(dv, o + 8);
    const nameLen = u16(dv, o + 26);
    const extraLen = u16(dv, o + 28);
    const dataStart = o + 30 + nameLen + extraLen;
    const compBytes = bytes.slice(dataStart, dataStart + ent.compSize);
    if (comp === 0) return compBytes;
    if (comp === 8) return await inflateRaw(compBytes);
    throw new Error("Método de compressão ZIP não suportado: " + comp);
  }

  function colLettersToIndex(letters){
    let n = 0;
    for (let i=0; i<letters.length; i++){
      const c = letters.charCodeAt(i);
      if (c < 65 || c > 90) continue;
      n = n * 26 + (c - 64);
    }
    return n;
  }

  function parseSharedStrings(xmlText){
    const out = [];
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const sis = Array.from(doc.getElementsByTagName("si"));
    for (const si of sis){
      // pode haver múltiplos <t> (rich text)
      const ts = Array.from(si.getElementsByTagName("t")).map(t=>t.textContent||"").join("");
      out.push(ts);
    }
    return out;
  }

  function parseSheetToGrid(sheetXmlText, shared){
    const doc = new DOMParser().parseFromString(sheetXmlText, "application/xml");
    const cells = Array.from(doc.getElementsByTagName("c"));
    const grid = new Map(); // row -> Map(col -> value)
    let maxCol = 0;
    for (const c of cells){
      const ref = c.getAttribute("r") || "";
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const col = colLettersToIndex(m[1]);
      const row = Number(m[2]);
      if (!isFinite(row) || row <= 0) continue;
      maxCol = Math.max(maxCol, col);
      const t = c.getAttribute("t") || "";
      let val = "";
      if (t === "inlineStr"){
        const tEl = c.getElementsByTagName("t")[0];
        val = tEl ? (tEl.textContent||"") : "";
      } else {
        const vEl = c.getElementsByTagName("v")[0];
        const vTxt = vEl ? (vEl.textContent||"") : "";
        if (t === "s"){
          const idx = Number(vTxt);
          val = (isFinite(idx) && shared[idx] != null) ? shared[idx] : "";
        } else {
          val = vTxt;
        }
      }
      if (!grid.has(row)) grid.set(row, new Map());
      grid.get(row).set(col, val);
    }
    return { grid, maxCol };
  }

  function normalizeHeader(h){
    return String(h||"").trim();
  }

  async function parseXlsxFirstSheetToObjects(arrayBuffer){
    const bytes = new Uint8Array(arrayBuffer);
    const entries = await readZipEntries(bytes);
    const sharedXml = await readZipFile(bytes, entries, "xl/sharedStrings.xml");
    const sheetXml = await readZipFile(bytes, entries, "xl/worksheets/sheet1.xml");
    if (!sheetXml) throw new Error("Não encontrei a 1ª aba (sheet1). Garanta que os dados estejam na primeira planilha do arquivo .xlsx.");
    const shared = sharedXml ? parseSharedStrings(new TextDecoder("utf-8").decode(sharedXml)) : [];
    const sheetText = new TextDecoder("utf-8").decode(sheetXml);
    const { grid, maxCol } = parseSheetToGrid(sheetText, shared);

    // header row = 1
    const headerMap = grid.get(1) || new Map();
    const headers = [];
    for (let c=1; c<=maxCol; c++) headers.push(normalizeHeader(headerMap.get(c) || ""));

    const out = [];
    const rows = Array.from(grid.keys()).filter(r=>r>1).sort((a,b)=>a-b);
    for (const r of rows){
      const rowMap = grid.get(r);
      const obj = {};
      let nonEmpty = 0;
      for (let c=1; c<=maxCol; c++){
        const key = headers[c-1] || `COL${c}`;
        let v = rowMap.get(c);
        if (v == null) v = "";
        // tenta número
        const vTrim = String(v).trim();
        const asNum = Number(vTrim.replace(".",".").replace(",","."));
        if (vTrim !== "" && isFinite(asNum) && /^-?\d+[\d.,]*$/.test(vTrim)){
          obj[key] = asNum;
        } else {
          obj[key] = vTrim;
        }
        if (obj[key] !== "" && obj[key] != null) nonEmpty++;
      }
      if (nonEmpty > 0) out.push(obj);
    }
    return out;
  }

  async function readFileArrayBuffer(file){
    return await new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Falha ao ler arquivo"));
      fr.onload = () => resolve(fr.result);
      fr.readAsArrayBuffer(file);
    });
  }

  function touchUpdatedAt(){
    localStorage.setItem(STORAGE_KEYS.updatedAt, new Date().toISOString());
    setUpdatePill();
  }

  async function handleUploadApelidos(file){
    const ab = await readFileArrayBuffer(file);
    const rows = await parseXlsxFirstSheetToObjects(ab);
    const map = {};
    for (const r of rows){
      // Layout esperado: "código grupo" | "grupo"
      const code = r["código grupo"] ?? r["Código grupo"] ?? r["Codigo grupo"] ?? r["código do grupo"] ?? r["Código do grupo"] ?? r["Codigo do grupo"] ?? r["CODIGO GRUPO"] ?? r["CÓDIGO GRUPO"] ?? r["CODIGO_DO_GRUPO"] ?? r["codigo grupo"] ?? r["codigo do grupo"];
      const alias = r["grupo"] ?? r["Grupo"] ?? r["apelido"] ?? r["Apelido"] ?? r["nome"] ?? r["Nome"];
      if (code == null || alias == null) continue;
      const k = String(code).trim().replace(/\D+/g,'');
      const v = String(alias).trim();
      if (k && v) map[k] = v;
    }
    if (!Object.keys(map).length) throw new Error('Planilha de apelidos vazia ou com cabeçalhos inválidos. Use: "código grupo" e "grupo".');
    localStorage.setItem(STORAGE_KEYS.apelidos, JSON.stringify(map));
    window.APELIDOS = map;
    try{ window.dispatchEvent(new CustomEvent('OE_APELIDOS_UPDATED', { detail: { source:'upload_xlsx' } })); }catch(e){}
    touchUpdatedAt();
  }

  async function handleUploadGrupos(file){
    const ab = await readFileArrayBuffer(file);
    const rows = await parseXlsxFirstSheetToObjects(ab);
    // aceita qualquer colunagem desde que tenha Grupo e Prazo e Valor do Crédito
    const filtered = rows.filter(r => (r["Grupo"] != null && r["Prazo"] != null && (r["Valor do Crédito"] != null || r["Crédito"] != null || r["Valor do credito"] != null || r["valor_do_credito"] != null)));
    if (!filtered.length) throw new Error("Planilha de grupos não contém colunas mínimas (Grupo, Prazo, Valor do Crédito). Confira o cabeçalho/colunas.");
    localStorage.setItem(STORAGE_KEYS.databank, JSON.stringify(filtered));
    window.DATABANK = filtered;
    touchUpdatedAt();
    // recarrega para reconstruir índice
    location.reload();
  }

  async function handleUploadLances(file){
    const ab = await readFileArrayBuffer(file);
    const rows = await parseXlsxFirstSheetToObjects(ab);
    const db = {};

    // Layout esperado:
    // GRUPO | SEGMENTO | PRAZO | P1 | ... | P12
    for (const r of rows){
      const grupo = r["GRUPO"] ?? r["Grupo"] ?? r["Código do grupo"] ?? r["Codigo do grupo"] ?? r["Código"] ?? r["Codigo"];
      if (grupo == null) continue;
      const key = String(grupo).trim().replace(/\D+/g,"");
      if (!key) continue;

      const segmento = String(r["SEGMENTO"] ?? r["Segmento"] ?? r["segmento"] ?? "").trim();
      const prazo = Number(r["PRAZO"] ?? r["Prazo"] ?? r["prazo"] ?? "");

      const lances = [];
      for (let i=1; i<=12; i++){
        const v = r["P"+i] ?? r["p"+i] ?? r["M"+i] ?? r["m"+i] ?? r["Período "+i] ?? r["Periodo "+i] ?? r["Periodo"+i] ?? r["Período"+i];
        const n = Number(v);
        lances.push(isFinite(n) ? n : 0);
      }

      // validação mínima: precisa ter ao menos alguns números (não tudo zero)
      const nonZero = lances.reduce((a,b)=>a + (Number(b)>0?1:0), 0);
      if (nonZero === 0){
        // ainda assim registra, mas evita sobrescrever uma linha válida
        if (!db[key]) db[key] = { segmento, prazo: (isFinite(prazo)?prazo:undefined), lances };
      } else {
        db[key] = { segmento, prazo: (isFinite(prazo)?prazo:undefined), lances };
      }
    }

    if (!Object.keys(db).length) throw new Error("Planilha de lances não gerou registros (verifique colunas/linhas e cabeçalhos: GRUPO, SEGMENTO, PRAZO, P1..P12).");
    localStorage.setItem(STORAGE_KEYS.lances, JSON.stringify(db));
    window.LANCE_DB = db;
    _assertCache.clear();
    touchUpdatedAt();

    // Notifica outras telas (ex.: Painel de Lances) para recarregar a base
    try{
      window.dispatchEvent(new CustomEvent('OE_LANCE_DB_UPDATED', { detail: { source: 'upload_xlsx' } }));
    }catch(e){}

  }

  // ---------------- UI: atualização de bases ----------------

  // Consulta rápida: apelido -> código (XXXX)
  const apelidoLookupEl = document.getElementById("apelidoLookup");
  const btnApelidoToCodigo = document.getElementById("btnApelidoToCodigo");
  const apelidoCodigoOut = document.getElementById("apelidoCodigoOut");
  function formatGrupoXXXX(g){
    const s = String(g||"").trim().replace(/\D+/g,"");
    if (!s) return "";
    return s.padStart(4, "0").slice(-4);
  }
  function _normTxt(s){
    return String(s||'')
      .trim()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // remove acentos
      .replace(/\s+/g,' ')
      .replace(/[\-_]+/g,'-');
  }
  function _getApelidosMap(){
    // garante que está lendo a última base
    if (window.APELIDOS && typeof window.APELIDOS === 'object' && Object.keys(window.APELIDOS).length) return window.APELIDOS;
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.apelidos);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') { window.APELIDOS = obj; return obj; }
    }catch(e){}
    return {};
  }
  function findCodigoByApelido(apelido){
    const aRaw = String(apelido||'').trim();
    if (!aRaw) return '';
    // se usuário digitar um código diretamente, aceita
    const onlyDigits = aRaw.replace(/\D+/g,'');
    if (onlyDigits.length >= 3) return onlyDigits;
    const a = _normTxt(aRaw);
    const map = _getApelidosMap();
    // match exato (normalizado)
    for (const [k,v] of Object.entries(map)){
      if (_normTxt(v) === a) return String(k);
    }
    // match contém (normalizado)
    for (const [k,v] of Object.entries(map)){
      const vv = _normTxt(v);
      if (vv && vv.includes(a)) return String(k);
    }
    return '';
  }
  if (apelidoLookupEl){
    apelidoLookupEl.addEventListener('keydown', (ev)=>{ if (ev.key==='Enter'){ ev.preventDefault(); try{ btnApelidoToCodigo && btnApelidoToCodigo.click(); }catch(e){} } });
  }
  if (btnApelidoToCodigo){
    btnApelidoToCodigo.addEventListener("click", ()=>{
      try{
        const ap = apelidoLookupEl ? apelidoLookupEl.value : "";
        const code = findCodigoByApelido(ap);
        const out = code ? formatGrupoXXXX(code) : "";
        if (apelidoCodigoOut) apelidoCodigoOut.textContent = "Código: " + (out || "—");
      }catch(e){
        if (apelidoCodigoOut) apelidoCodigoOut.textContent = "Código: —";
      }
    });
  }

  setUpdatePill();

  async function guardUpload(fileEl, handler){
    const f = fileEl && fileEl.files && fileEl.files[0];
    if (!f) throw new Error("Selecione um arquivo .xlsx primeiro.");
    await handler(f);
  }

  if (btnUploadApelidos && fileApelidosEl){
    btnUploadApelidos.addEventListener("click", async ()=>{
      try{
        await guardUpload(fileApelidosEl, handleUploadApelidos);
        alert("Apelidos atualizados com sucesso. A exportação agora usa os apelidos para sigilo.");
      } catch(e){
        console.error(e);
        alert("Erro ao atualizar apelidos: " + (e && e.message ? e.message : e));
      }
    });
  }

  if (btnUploadGrupos && fileGruposEl){
    btnUploadGrupos.addEventListener("click", async ()=>{
      try{
        await guardUpload(fileGruposEl, handleUploadGrupos);
      } catch(e){
        console.error(e);
        alert("Erro ao atualizar grupos: " + (e && e.message ? e.message : e));
      }
    });
  }

  if (btnUploadLances && fileLancesEl){
    btnUploadLances.addEventListener("click", async ()=>{
      try{
        await guardUpload(fileLancesEl, handleUploadLances);
        alert("Lances atualizados com sucesso.");
      } catch(e){
        console.error(e);
        alert("Erro ao atualizar lances: " + (e && e.message ? e.message : e));
      }
    });
  }

  if (btnClearLocal){
    btnClearLocal.addEventListener("click", ()=>{
      try{
        localStorage.removeItem(STORAGE_KEYS.databank);
        localStorage.removeItem(STORAGE_KEYS.lances);
        localStorage.removeItem(STORAGE_KEYS.apelidos);
        localStorage.removeItem(STORAGE_KEYS.updatedAt);
        alert("Bases locais removidas. Vou recarregar as bases originais.");
        location.reload();
      } catch(e){
        console.error(e);
        alert("Erro ao restaurar bases: " + (e && e.message ? e.message : e));
      }
    });
  }

  if (selectAllEl){
    selectAllEl.addEventListener("change", () => {
      const checked = !!selectAllEl.checked;
      Array.from(tbody.querySelectorAll('input.rowSelect')).forEach(c => c.checked = checked);
      try{
        if (checked){
          for (const r of latestRows){ selectedProposalKeys.add(proposalRowKey(r)); }
        } else {
          selectedProposalKeys.clear();
        }
      }catch(e){}
    });
  }


  if (oeSelectAllEl && oeTbody){
    oeSelectAllEl.addEventListener("change", () => {
      const checked = !!oeSelectAllEl.checked;
      Array.from(oeTbody.querySelectorAll('input.rowSelectOE')).forEach(c => c.checked = checked);
      try{
        if (checked){
          for (const r of latestRowsOE){ selectedOEKeys.add(oeRowKey(r)); }
        } else {
          selectedOEKeys.clear();
        }
      }catch(e){}
      // Atualiza totalização/rodapé com base no que ficou marcado
      try{ oeUpdateFooterFromSelection(); }catch(e){}
    });
  }


  if (oeCSelectAllEl && oeCTbody){
    oeCSelectAllEl.addEventListener("change", () => {
      const checked = !!oeCSelectAllEl.checked;
      Array.from(oeCTbody.querySelectorAll('input.rowSelectOEC')).forEach(c => c.checked = checked);
      try{
        if (checked){
          for (const r of latestRowsOECustom){ selectedOECustomKeys.add(oeCustomRowKey(r)); }
        } else {
          selectedOECustomKeys.clear();
        }
      }catch(e){}
      // atualiza resumo
      const t = oeCComputeTotalsFromChecked();
      _oeCTotals = t;
      oeCUpdateTotalsRowDOM();
      if (oeCResumoEl){
        oeCResumoEl.textContent = `Selecionados: ${t.count} • Soma créditos: ${fmtBRL(t.sumCredito)} • Soma parcelas iniciais: ${fmtBRL(t.sumParcIni)} • Soma lances: ${fmtBRL(t.sumLance)} (${formatPct(t.pct)})`;
      }
    });
  }



  if (oeBuscarBtn) oeBuscarBtn.addEventListener("click", ()=>{ try{ oeSearch(); } catch(e){ console.error(e); oeRenderEmpty("Erro ao buscar: " + (e && e.message ? e.message : e)); } });
  if (oeLimparBtn) oeLimparBtn.addEventListener("click", oeClear);

  if (oeExportBtn){
    oeExportBtn.addEventListener("click", ()=>{ 
      try{ 
        _exportCtx = { kind: "oe" };
        const rows = oeGetSelectedRows();
        if (!rows.length){
          oeRenderEmpty("Selecione ao menos uma opção para exportar.");
          return;
        }
        openModal(rows.length);
      } catch(e){ 
        console.error(e); 
        oeRenderEmpty("Erro ao exportar: " + (e && e.message ? e.message : e)); 
      } 
    });
  }

  if (oeCExportBtn){
    oeCExportBtn.addEventListener("click", ()=>{ 
      try{ 
        _exportCtx = { kind: "oe_custom" };
        const rows = oeCGetSelectedRows();
        if (!rows.length){
          oeCRenderEmpty("Selecione ao menos uma opção (na Customizada) para exportar.");
          return;
        }
        openModal(rows.length);
      } catch(e){ 
        console.error(e); 
        oeCRenderEmpty("Erro ao exportar: " + (e && e.message ? e.message : e)); 
      } 
    });
  }



  // Enter para buscar (OE)
  for (const el of [oeCreditoEl, oeLanceEl, oePrazoMinEl, oePrazoMaxEl, oeQtdEl].filter(Boolean)){
    el.addEventListener("keydown", (e)=>{
      if (e.key === "Enter"){
        e.preventDefault();
        try{ oeSearch(); } catch(err){ console.error(err); oeRenderEmpty("Erro ao buscar: " + (err && err.message ? err.message : err)); }
      }
    });
  }

  if (btnExport){
    btnExport.addEventListener("click", ()=>{ try{ exportPDF(); } catch(e){ console.error(e); renderEmpty("Erro ao exportar: " + (e && e.message ? e.message : e)); } });
  }
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
  if (btnCancelExport) btnCancelExport.addEventListener("click", closeModal);
  if (exportModal) exportModal.addEventListener("click", (ev)=>{ if (ev.target === exportModal) closeModal(); });
  if (btnConfirmExport) btnConfirmExport.addEventListener("click", ()=>{ try{ doPrint(); } catch(e){ console.error(e); closeModal(); renderEmpty("Erro ao gerar PDF: " + (e && e.message ? e.message : e)); } });


  // Enter para buscar
  for (const el of [creditoEl, lanceEl, prazoEl, parcelaEl]){
    el.addEventListener("keydown", (e)=>{
      if (e.key === "Enter"){
        e.preventDefault();
        try{ search(); } catch(e){ console.error(e); renderEmpty("Erro ao buscar: " + (e && e.message ? e.message : e)); }
      }
    });
  }

  // Permite que o Painel de Lances aplique um percentual de lance diretamente
  // nos resultados (Propostas e Operações Estruturadas > Customizada).
  window.__GERPRO_SET_LANCE_FOR_GROUP = function(grupo, pct){
    try{
      const g = String(grupo||"").trim();
      const pctN = Number(pct);
      if (!g || !isFinite(pctN) || pctN <= 0) return false;

      let applied = false;

      // --- Propostas ---
      try{
        const r = (latestRows || []).find(x => String(x.grupo) === g);
        if (r){
          const lance = (Number(r.totalCredito||0) * pctN) / 100;
          r.lanceSug = lance;
          r.lancePctSug = pctN;
          const calc = calcParcelaPos(r.totalSaldo, r.parcelaInicial, lance, r.prazoInicial);
          r.parcelaPos = calc.parcelaPos;
          r.prazoPos = calc.prazoPos;
          applied = true;
          renderTable(latestRows);
        }
      }catch(e){}

      // --- Operações Estruturadas (Customizada) ---
      try{
        const r2 = (latestRowsOECustom || []).find(x => String(x.grupo) === g);
        if (r2){
          const lance = (Number(r2.totalCredito||0) * pctN) / 100;
          r2.lanceSug = lance;
          r2.lancePctSug = pctN;
          const calc2 = calcParcelaPos(r2.totalSaldo, r2.parcelaInicial, lance, r2.prazoInicial);
          r2.parcelaPos = calc2.parcelaPos;
          r2.prazoPos = calc2.prazoPos;
          applied = true;
          // Re-render mantendo contexto (alvo)
          oeCRenderTable(latestRowsOECustom, _oeCCreditoAlvo);
          // Reforça totais/parcelas dinâmicos
          _oeCTotals = oeCComputeTotalsFromChecked();
          oeCUpdateTotalsRowDOM();
        }
      }catch(e){}

      return applied;
    }catch(e){
      console.error(e);
      return false;
    }
  };

  
  // ---------------- UI: Relatório e Consultas ----------------
  const rcDateFromEl = document.getElementById('rcDateFrom');
  const rcDateToEl = document.getElementById('rcDateTo');
  const rcRadicalEl = document.getElementById('rcRadical');
  const rcDetailLevelEl = document.getElementById('rcDetailLevel');
  const rcBuscarBtn = document.getElementById('rcBuscar');
  const rcLimparBtn = document.getElementById('rcLimpar');
  const rcExportCsvBtn = document.getElementById('rcExportCsv');
  const rcRelatorioBaseBtn = document.getElementById('rcRelatorioBase');
  const rcTbody = document.getElementById('rcTbody');
  const rcStatusEl = document.getElementById('rcStatus');
  const rcDetailEl = document.getElementById('rcDetail');
  const rcDetailTableEl = document.getElementById('rcDetailTable');
  const rcDetailTbody = document.getElementById('rcDetailTbody');

  function rcParseDDMMYYYY(s){
    const m = String(s||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (!isFinite(d)||!isFinite(mo)||!isFinite(y)) return null;
    return new Date(Date.UTC(y, mo-1, d, 12, 0, 0)); // meio-dia UTC para evitar variação de fuso
  }

  function rcRender(list){
    if (!rcTbody) return;
    if (!list.length){
      rcTbody.innerHTML = '<tr class="empty"><td colspan="5">Nenhum resultado com os filtros informados.</td></tr>';
      return;
    }
    rcTbody.innerHTML = '';
    for (const rec of list){
      const tr = document.createElement('tr');
      const valor = fmtBRL(Number(rec.valorCredito||0));
      tr.innerHTML = `
        <td>${rec.propostaNumero || '—'}<div class="muted" style="font-size:12px;">Radical: ${rec.radical || '—'}</div></td>
        <td>${rec.dataCriacao || '—'}</td>
        <td style="text-align:right">${valor}</td>
        <td>${rcTipoLabel(rec.kind)}</td>
        <td style="white-space:nowrap;">
          <button class="btn mini ghost rcView" type="button" data-id="${rec.propostaNumero}">Ver</button>
          <button class="btn mini secondary rcPrint" type="button" data-id="${rec.propostaNumero}">Gerar PDF</button>
          <button class="btn mini ghost rcDelete" type="button" data-id="${rec.propostaNumero}">Excluir</button>
        </td>`;
      rcTbody.appendChild(tr);
    }
  }

  function rcApplyFilters(){
    const all = rcLoad();

    const rad = String(rcRadicalEl?.value || '').trim();
    const from = rcDateFromEl?.value ? new Date(rcDateFromEl.value + 'T12:00:00Z') : null;
    const to = rcDateToEl?.value ? new Date(rcDateToEl.value + 'T12:00:00Z') : null;

    let out = all.slice();

    if (rad){
      out = out.filter(r => String(r.radical||'').trim() === rad);
    }

    if (from || to){
      out = out.filter(r => {
        const d = rcParseDDMMYYYY(r.dataCriacao);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    if (rcStatusEl) rcStatusEl.textContent = `${out.length} registro(s)`;
    rcRender(out);
    return out;
  }

  async function rcPrintRecord(rec){
    try{
      if (!rec || !Array.isArray(rec.rows) || !rec.rows.length) return;

      const rows = rec.rows.map(r => ({
        ...r,
        // compatibilidade com templates
        totalSaldo: Number(r.totalSaldo||0),
        segmento: r.segmento || ""
      }));

      const leftImg = document.getElementById("logoLeft");
      const rightImg = document.getElementById("logoRight");
      const afterImg = document.getElementById("logoAfter");
      const leftData = await imgToDataURL(leftImg);
      const rightData = await imgToDataURL(rightImg);
      const afterData = await imgToDataURL(afterImg);

      const bgImg = document.getElementById("bgMark");
      const bgData = await imgToDataURL(bgImg);

      const w = window.open("", "_blank");
      if (!w) return alert("Não foi possível abrir a janela de impressão (pop-up bloqueado).");

      const safeDate = String(rec.propostaNumero || '').replaceAll("/","-").replaceAll(" ","_");
      const proposalId = `Proposta ${rec.propostaNumero || ''}`;
      const titleDate = rec.dataCriacao || '';

      const buildRowsHtml = (pageRows, startIndex) => pageRows.map((r, idx)=>{
        const i = startIndex + idx;
        const lanceTxt = `${fmtBRL(r.lanceSug)} <span class="pct">(${formatPct((r.totalCredito? (r.lanceSug/r.totalCredito)*100:0))})</span>`;
        const grupoPublico = groupPublicName(r.grupo);
        return `<tr>
          <td style="text-align:center">${i+1}</td>
          <td>${grupoPublico}</td>
          <td style="text-align:right">${fmtBRL(r.totalCredito)}</td>
          <td style="text-align:center">${r.prazoInicial}</td>
          <td style="text-align:right">${fmtBRL(r.parcelaInicial)}</td>
          <td style="text-align:right">${lanceTxt}</td>
          <td style="text-align:right">${fmtBRL(r.parcelaPos)}</td>
          <td style="text-align:center">${r.prazoPos}</td>
          <td style="text-align:right">${formatPct(r.taxaAdmPct)} <span class="pct">${fmtBRL(r.taxaAdmReais)}</span></td>
          <td style="text-align:right">${formatPct(r.fundoResPct)} <span class="pct">${fmtBRL(r.fundoResReais)}</span></td>
        </tr>`;
      }).join("");

      const isOE = (rec.kind === 'oe' || rec.kind === 'oe_custom');
      const MAX_ROWS_PER_PAGE = isOE ? 9999 : 10;
      const pages = [];
      for (let i=0; i<rows.length; i += MAX_ROWS_PER_PAGE){
        pages.push({ start:i, rows: rows.slice(i, i + MAX_ROWS_PER_PAGE) });
      }

      let oeExtraHtml = '';
      if (isOE){
        const sortedOE = rows.slice().sort((a,b)=>Number(a.prazoInicial)-Number(b.prazoInicial));
        const sumCredito = sortedOE.reduce((a,r)=>a+Number(r.totalCredito||0),0);
        const sumParcIni = sortedOE.reduce((a,r)=>a+Number(r.parcelaInicial||0),0);
        const sumLance = sortedOE.reduce((a,r)=>a+Number(r.lanceSug||0),0);
        const pct = sumCredito ? (sumLance/sumCredito)*100 : 0;


        const ranges = oeComputeParcelasRanges(sortedOE);
        const rangesHtml = ranges.length
          ? ranges.map(r => {
              const faixa = (r.start === r.end) ? `${r.start}` : `${r.start} a ${r.end}`;
              return `<div><b>${faixa}</b> — ${fmtBRL(r.valor)}</div>`;
            }).join('')
          : '<div>—</div>';
        oeExtraHtml = `
          <div class="oeBox">
            <div class="oeLine"><b>Total crédito:</b> ${fmtBRL(sumCredito)} • <b>Total parcela inicial:</b> ${fmtBRL(sumParcIni)} • <b>Total lances:</b> ${fmtBRL(sumLance)} (${formatPct(pct)})</div>
            <div class="oeRanges"><div class="oeRangesTitle"><b>Parcelas pós lance (decrescentes)</b></div>${rangesHtml}</div>
          </div>`;
      }

      const logoLeftHtml = leftData ? `<img class="logo" src="${leftData}" />` : '';
      const logoRightHtml = rightData ? `<img class="logo" src="${rightData}" />` : '';
      const afterHtml = afterData ? `<img class="after" src="${afterData}" />` : '';
      const bgUrl = bgData ? bgData : '';

      const css = `
        <style>
          @page { size: A4; margin: ${marginMm}mm; }
          body{ font-family: Arial, Helvetica, sans-serif; color:#111; }
          .head{ display:flex; justify-content:space-between; align-items:center; gap:12px; }
          .title{ font-size:16px; font-weight:900; }
          .sub{ font-size:12px; color:#444; }
          table{ width:100%; border-collapse:collapse; margin-top:10px; }
          th,td{ border:1px solid #ddd; padding:6px 8px; font-size:12px; }
          th{ background:#f5f5f5; }
          .pct{ color:#555; font-size:11px; }
          .logo{ height:38px; }
          .oeBox{ margin-top:10px; padding:8px; border:1px solid #ddd; border-radius:10px; }
          .oeRangesTitle{ margin-top:6px; }
          .oeRanges div{ font-size:12px; margin-top:4px; }
        </style>`;

      const pagesHtml = pages.map((p,pi)=>`
        <div class="page">
          <div class="head">
            <div>${logoLeftHtml}</div>
            <div style="text-align:center;">
              <div class="title">${proposalId}</div>
              <div class="sub">Data: ${titleDate} • Assembléia: ${rec.dataAssembleia || '—'}</div>
            </div>
            <div>${logoRightHtml}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>#</th><th>Grupo</th><th>Crédito</th><th>Prazo</th><th>Parcela</th><th>Lance</th><th>Pós-lance</th><th>Prazo pós</th><th>Taxa Adm</th><th>Fundo Res</th>
              </tr>
            </thead>
            <tbody>${buildRowsHtml(p.rows, p.start)}</tbody>
          </table>

          ${pi === pages.length-1 ? oeExtraHtml : ''}
          ${pi === pages.length-1 ? afterHtml : ''}
        </div>`).join('');

      const marginMm = Number(USER_SETTINGS && USER_SETTINGS.pdfMarginsMm ? USER_SETTINGS.pdfMarginsMm : 12) || 12;

    w.document.open();
      w.document.write('<!doctype html><html><head><meta charset="utf-8"/><title>'+proposalId+'</title>'+css+'</head><body>'+pagesHtml+'</body></html>');
      w.document.close();
      w.focus();
      setTimeout(()=>{ try{ w.print(); }catch(e){} }, 350);
    }catch(e){
      console.error(e);
      alert('Erro ao gerar PDF: ' + (e && e.message ? e.message : e));
    }
  }

  function rcShowDetails(rec){
    if (!rcDetailEl || !rcDetailTableEl || !rcDetailTbody) return;
    if (!rec){
      rcDetailEl.textContent = 'Selecione “Detalhado” e clique em “Ver” para visualizar os itens.';
      rcDetailTableEl.classList.add('hidden');
      return;
    }
    const rows = Array.isArray(rec.rows) ? rec.rows : [];
    rcDetailEl.innerHTML = '<b>Proposta:</b> ' + (rec.propostaNumero||'—') + ' • <b>Tipo:</b> ' + rcTipoLabel(rec.kind) + ' • <b>Crédito:</b> ' + fmtBRL(Number(rec.valorCredito||0));
    if (!rows.length){
      rcDetailTableEl.classList.add('hidden');
      return;
    }
    rcDetailTbody.innerHTML = rows.map((r,i)=>`
      <tr>
        <td style="text-align:center">${i+1}</td>
        <td>${groupPublicName(r.grupo)}</td>
        <td style="text-align:right">${fmtBRL(Number(r.totalCredito||0))}</td>
        <td style="text-align:center">${Number(r.prazoInicial||0) || '—'}</td>
        <td style="text-align:right">${fmtBRL(Number(r.parcelaInicial||0))}</td>
        <td style="text-align:right">${fmtBRL(Number(r.lanceSug||0))} <span class="pct">(${formatPct((r.totalCredito? (r.lanceSug/r.totalCredito)*100:0))})</span></td>
        <td style="text-align:right">${fmtBRL(Number(r.parcelaPos||0))}</td>
      </tr>`).join('');
    rcDetailTableEl.classList.remove('hidden');
  }

  function rcExportBasePdf(){
    const db = Array.isArray(window.DATABANK) ? window.DATABANK : [];
    if (!db.length) return alert('Base vazia.');

    // Filtra linhas minimamente válidas (grupos ativos)
    const rows = db
      .map(r => ({
        grupo: Number(r["Grupo"]),
        nomeGrupo: groupPublicName(Number(r["Grupo"])),
        credito: Number(r["Valor do Crédito"]),
        parcelaInicial: Number(r["Parcela Inicial"]),
        prazoInicial: Number(r["Prazo"]),
        taxaAdmPct: Number(r["Taxa de Administração %"] ?? r["Taxa de Administração %"]),
        fundoResPct: Number(r["Fundo de Reserva %"] ?? r["Fundo de Reserva %"]),
      }))
      .filter(r => Number.isFinite(r.grupo) && r.grupo > 0 && Number.isFinite(r.credito) && r.credito > 0 && Number.isFinite(r.prazoInicial) && r.prazoInicial > 0);

    if (!rows.length) return alert('Nenhum grupo ativo encontrado na base.');

    // Ordena por grupo, depois crédito
    rows.sort((a,b)=> (a.grupo-b.grupo) || (a.credito-b.credito));

    const margem = Number(USER_SETTINGS && USER_SETTINGS.margemSeguranca != null ? USER_SETTINGS.margemSeguranca : 2.5) || 0;

    const lines = rows.map(r => {
      const lanceReais = getCalculatedLance(r.grupo, r.credito, 0);
      const lancePct = r.credito ? (lanceReais / r.credito) * 100 : 0;
      const { prazoPos, parcelaPos } = calcParcelaPos(r.credito, r.parcelaInicial, lanceReais, r.prazoInicial);

      const taxaAdmReais = (Number.isFinite(r.taxaAdmPct) ? (r.credito * (r.taxaAdmPct/100)) : 0);
      const fundoResReais = (Number.isFinite(r.fundoResPct) ? (r.credito * (r.fundoResPct/100)) : 0);

      return Object.assign({}, r, {
        lanceReais, lancePct,
        parcelaPos, prazoPos,
        taxaAdmReais, fundoResReais
      });
    });

    const title = 'Relatório da Base de Grupos Ativos';
    const now = new Date();
    const stamp = now.toLocaleString('pt-BR');
    const css = '<style>' + (document.getElementById('inlineStyles') ? document.getElementById('inlineStyles').textContent : '') + '</style>';

    const headHtml = `
      <div style="margin:0 0 12px 0;">
        <div style="font-weight:900; font-size:18px;">${title}</div>
        <div style="font-size:12px; opacity:.85;">Gerado em: ${stamp} • Margem de segurança: ${formatPct(margem)}</div>
      </div>
    `;

    const tableHtml = `
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Nº Grupo</th>
            <th style="text-align:left; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Nome grupo</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Valor do crédito</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Parcela inicial</th>
            <th style="text-align:center; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Prazo inicial</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Lance sugerido</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Parcela pós-lance</th>
            <th style="text-align:center; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Prazo pós-lance</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Taxa Adm total</th>
            <th style="text-align:right; padding:6px; border-bottom:1px solid rgba(0,0,0,.2);">Fundo de reserva</th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => `
            <tr>
              <td style="padding:6px; border-bottom:1px solid rgba(0,0,0,.08);">${l.grupo}</td>
              <td style="padding:6px; border-bottom:1px solid rgba(0,0,0,.08);">${l.nomeGrupo || l.grupo}</td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${fmtBRL(l.credito)}</td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${fmtBRL(l.parcelaInicial)}</td>
              <td style="padding:6px; text-align:center; border-bottom:1px solid rgba(0,0,0,.08);">${l.prazoInicial}</td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${fmtBRL(l.lanceReais)} <span style="opacity:.8;">(${formatPct(l.lancePct)})</span></td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${fmtBRL(l.parcelaPos)}</td>
              <td style="padding:6px; text-align:center; border-bottom:1px solid rgba(0,0,0,.08);">${l.prazoPos}</td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${formatPct(l.taxaAdmPct)} <span style="opacity:.8;">(${fmtBRL(l.taxaAdmReais)})</span></td>
              <td style="padding:6px; text-align:right; border-bottom:1px solid rgba(0,0,0,.08);">${formatPct(l.fundoResPct)} <span style="opacity:.8;">(${fmtBRL(l.fundoResReais)})</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>${css}</head>
      <body style="background:white; color:black; margin:16px; font-family:Arial, sans-serif;">
        ${headHtml}
        ${tableHtml}
      </body></html>`;

    // Imprime usando um iframe oculto (evita bloqueio de pop-up)
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || (iframe.contentWindow ? iframe.contentWindow.document : null);
    if (!doc){
      document.body.removeChild(iframe);
      return alert('Não foi possível abrir a impressão neste navegador.');
    }

    doc.open();
    doc.write(html);
    doc.close();

    const win = iframe.contentWindow;
    try{ win.focus(); }catch(e){}
    setTimeout(() => {
      try{ win.print(); }catch(e){}
      // remove após tentativa de impressão
      setTimeout(() => { try{ document.body.removeChild(iframe); }catch(e){} }, 800);
    }, 300);
}

  function rcExportCsv(list){
    const rows = (list || []).map(r => ({
      propostaNumero: r.propostaNumero || '',
      radical: r.radical || '',
      dataCriacao: r.dataCriacao || '',
      dataAssembleia: r.dataAssembleia || '',
      tipo: rcTipoLabel(r.kind),
      valorCredito: Number(r.valorCredito||0)
    }));
    const header = Object.keys(rows[0] || {propostaNumero:''});
    const csv = [header.join(';')].concat(rows.map(r => header.map(k => String(r[k] ?? '').replaceAll(';',',')).join(';'))).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'relatorio_consultas.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  if (rcBuscarBtn) rcBuscarBtn.addEventListener('click', () => {
    const list = rcApplyFilters();
    if (rcDetailLevelEl && rcDetailLevelEl.value !== 'detalhado'){
      rcShowDetails(null);
    } else if (!list.length){
      rcShowDetails(null);
    }
  });

  if (rcLimparBtn) rcLimparBtn.addEventListener('click', () => {
    if (rcDateFromEl) rcDateFromEl.value = '';
    if (rcDateToEl) rcDateToEl.value = '';
    if (rcRadicalEl) rcRadicalEl.value = '';
    if (rcStatusEl) rcStatusEl.textContent = 'Pronto';
    rcRender(rcLoad());
    rcShowDetails(null);
  });

  if (rcExportCsvBtn) rcExportCsvBtn.addEventListener('click', () => {
    const list = rcApplyFilters();
    if (!list.length) return alert('Sem dados para exportar.');
    rcExportCsv(list);
  });


  if (rcRelatorioBaseBtn) rcRelatorioBaseBtn.addEventListener('click', () => {
    try{
      rcExportBasePdf();
    }catch(e){
      console.error(e);
      alert('Erro ao gerar o relatório da base: ' + (e && e.message ? e.message : e));
    }
  });

  if (rcTbody){
    rcTbody.addEventListener('click', async (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn) return;
      const id = String(btn.dataset.id || '').trim();
      if (!id) return;
      const all = rcLoad();
      const rec = all.find(r => String(r.propostaNumero||'') === id);
      if (!rec) return;

      if (btn.classList.contains('rcView')){
        if (rcDetailLevelEl && rcDetailLevelEl.value === 'detalhado'){
          rcShowDetails(rec);
        } else {
          alert('Selecione “Detalhado (itens da proposta)” para visualizar os itens.');
        }
      } else if (btn.classList.contains('rcPrint')){
        await rcPrintRecord(rec);
      } else if (btn.classList.contains('rcDelete')){
        if (!confirm('Excluir este registro do relatório?')) return;
        const next = all.filter(r => String(r.propostaNumero||'') !== id);
        rcSave(next);
        rcRender(next);
        rcShowDetails(null);
        if (rcStatusEl) rcStatusEl.textContent = `${next.length} registro(s)`;
      }
    });
  }

  // render inicial do relatório (sem trocar de aba)
  try{ rcRender(rcLoad()); }catch(e){}
// inicial
  renderEmpty("Preencha o valor do crédito e clique em buscar.");
})();