/*
  GerPro Core (offline)
  - Centraliza formatação, arredondamento e cálculos base
  - Centraliza validações e checklist de exportação
  Obs.: não altera regras comerciais, apenas organiza e protege contra erros.
*/
(function(){
  const CORE = {};
// adicionando comentário teste
  // ---------------- utilitários ----------------
  CORE.round2 = function(n){
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  };

  CORE.isFiniteNumber = function(n){
    return Number.isFinite(Number(n));
  };

  CORE.clamp = function(n, min, max){
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
  };

  CORE.fmtBRL = function(n){
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    // pt-BR já usa 2 casas por padrão no currency
    return x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  CORE.fmtPct = function(n){
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return CORE.round2(x).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  };

  CORE.nowBR = function(){
    // data/hora local do navegador
    const d = new Date();
    return d.toLocaleString('pt-BR');
  };

  // ---------------- fórmulas principais ----------------
  CORE.calcSaldoDevedor = function(credito, taxaPct, fundoPct){
    const c = Math.max(0, Number(credito) || 0);
    const taxa = (Number(taxaPct) || 0) / 100;
    const fundo = (Number(fundoPct) || 0) / 100;
    const t = Number.isFinite(taxa) ? taxa : 0;
    const f = Number.isFinite(fundo) ? fundo : 0;
    return c * (1 + t + f);
  };

  CORE.calcTaxaFundoTotais = function(credito, taxaPct, fundoPct){
    const c = Math.max(0, Number(credito) || 0);
    const tPct = Number(taxaPct) || 0;
    const fPct = Number(fundoPct) || 0;
    const taxaBRL = c * (tPct / 100);
    const fundoBRL = c * (fPct / 100);
    return {
      taxaPct: CORE.round2(tPct),
      fundoPct: CORE.round2(fPct),
      taxaBRL: CORE.round2(taxaBRL),
      fundoBRL: CORE.round2(fundoBRL)
    };
  };

  CORE.calcParcelaPos = function(totalSaldoDevedor, parcelaInicial, lanceReais, prazoInicial){
    const prazoPos = Math.max(1, (Number(prazoInicial) || 0) - 1);
    const lance = Math.max(0, Number(lanceReais) || 0);
    const parcIni = Math.max(0, Number(parcelaInicial) || 0);
    const saldoIni = Math.max(0, Number(totalSaldoDevedor) || 0);
    const saldoPos = Math.max(0, saldoIni - (parcIni + lance));
    const parcelaPos = prazoPos ? (saldoPos / prazoPos) : 0;
    return {
      prazoPos,
      saldoPos: CORE.round2(saldoPos),
      parcelaPos: CORE.round2(parcelaPos)
    };
  };

  // ---------------- série histórica e assertividade ----------------
  CORE.takeLastN = function(values, n){
    const v = (values || []).slice();
    if (!v.length) return [];
    const nn = Math.max(1, Math.floor(n || 1));
    return v.slice(Math.max(0, v.length - nn));
  };

  CORE.weightedMean = function(values){
    const v = (values || []).map(Number).filter(x => Number.isFinite(x));
    if (!v.length) return 0;
    let wSum = 0;
    let vwSum = 0;
    for (let i = 0; i < v.length; i++){
      const w = (i + 1);
      wSum += w;
      vwSum += v[i] * w;
    }
    return wSum ? (vwSum / wSum) : 0;
  };

  CORE.sampleStd = function(values){
    const v = (values || []).map(Number).filter(x => Number.isFinite(x));
    const n = v.length;
    if (n <= 1) return 0;
    const mean = v.reduce((a,b)=>a+b,0) / n;
    const varSum = v.reduce((a,b)=>a + Math.pow(b-mean,2), 0);
    return Math.sqrt(varSum / (n - 1));
  };

  CORE.suggestedPctForGroup = function(grupo, periods){
    const db = window.LANCE_DB || {};
    const rec = db[String(grupo)];
    if (!rec || !Array.isArray(rec.lances)) return 0;
    const serieAll = rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1);
    const n = Number(periods) || 6;
    const serie = CORE.takeLastN(serieAll, n);
    const med = CORE.weightedMean(serie);
    const dp = CORE.sampleStd(serie);
    return Math.max(0, med + dp);
  };

  const _assertCache = new Map();
  CORE.clearAssertCache = function(){ _assertCache.clear(); };

  CORE.assertForGroup = function(grupo, periods){
    const key = String(grupo);
    const cacheKey = key + "::" + String(periods || 6);
    if (_assertCache.has(cacheKey)) return _assertCache.get(cacheKey);

    const db = window.LANCE_DB || {};
    const rec = db[key];
    const lancesAll = (rec && Array.isArray(rec.lances)) ? rec.lances.map(Number).filter(x => Number.isFinite(x) && x > 1) : [];
    const nPer = Number(periods) || 6;
    const lances = CORE.takeLastN(lancesAll, nPer);
    const n = lances.length || 0;
    const pctSug = CORE.suggestedPctForGroup(grupo, nPer);
    let hits = 0;
    for (const x of lances){
      if (pctSug >= x) hits++;
    }
    const pct = n ? (hits / n) * 100 : 0;
    const out = { hits, n, pct: CORE.round2(pct), pctSug: CORE.round2(pctSug) };
    _assertCache.set(cacheKey, out);
    return out;
  };

  CORE.hasFixedTwentySequence = function(grupo){
    const db = window.LANCE_DB || {};
    const rec = db[String(grupo)];
    if (!rec || !Array.isArray(rec.lances)) return false;
    const serie = rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1);
    if (!serie.length) return false;
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
  };

  // ---------------- validação de base ----------------
  const REQUIRED_FIELDS = [
    { key: 'Grupo', label: 'grupo' },
    { key: 'Prazo', label: 'prazo' },
    { key: 'Valor do Crédito', alt: ['Crédito'], label: 'crédito' },
    { key: 'Taxa de Administração %', alt: ['Taxa Adm %'], label: 'taxa de administração' },
    { key: 'Fundo de Reserva %', alt: ['Fundo %'], label: 'fundo de reserva' },
  ];

  function getFieldValue(row, def){
    if (!row || typeof row !== 'object') return undefined;
    if (row[def.key] !== undefined) return row[def.key];
    if (Array.isArray(def.alt)){
      for (const k of def.alt){
        if (row[k] !== undefined) return row[k];
      }
    }
    return undefined;
  }

  CORE.validateBase = function(databank){
    const rows = Array.isArray(databank) ? databank : [];
    const issues = [];
    let okCount = 0;

    for (let i = 0; i < rows.length; i++){
      const r = rows[i];
      const g = String(getFieldValue(r, {key:'Grupo'}) ?? '').trim();
      if (!g || g === '0' || g === '0.0') continue;

      let rowOk = true;
      for (const f of REQUIRED_FIELDS){
        const v = getFieldValue(r, f);
        if (v === undefined || v === null || String(v).trim() === ''){
          issues.push({ grupo: g, linha: i+1, tipo: 'ausente', campo: f.label });
          rowOk = false;
          continue;
        }
        // numéricos
        if (f.label !== 'grupo'){
          const n = Number(v);
          if (!Number.isFinite(n)){
            issues.push({ grupo: g, linha: i+1, tipo: 'inválido', campo: f.label, valor: v });
            rowOk = false;
          }
        }
      }
      if (rowOk) okCount++;
    }

    const critical = issues.filter(x => x.tipo === 'ausente' || x.tipo === 'inválido');
    return {
      totalLinhas: rows.length,
      linhasOk: okCount,
      issues,
      criticalCount: critical.length
    };
  };

  CORE.baseQualityReport = function(databank, lanceDb){
    const rows = Array.isArray(databank) ? databank : [];
    const ldb = (lanceDb && typeof lanceDb === 'object') ? lanceDb : (window.LANCE_DB || {});

    const gruposSet = new Set();
    const incompletos = new Set();
    const semHistorico = new Set();
    const foraPadrao = [];

    for (let i = 0; i < rows.length; i++){
      const r = rows[i];
      const g = String(r['Grupo'] ?? '').trim();
      if (!g || g === '0' || g === '0.0') continue;
      gruposSet.add(g);

      // checa presença mínima
      const prazo = Number(r['Prazo']);
      const cred = Number(r['Valor do Crédito'] ?? r['Crédito']);
      const taxa = Number(r['Taxa de Administração %'] ?? r['Taxa Adm %']);
      const fundo = Number(r['Fundo de Reserva %'] ?? r['Fundo %']);
      if (![prazo, cred, taxa, fundo].every(Number.isFinite)){
        incompletos.add(g);
      }

      // fora do padrão simples
      if (Number.isFinite(taxa) && (taxa < 0 || taxa > 100)) foraPadrao.push({ grupo: g, campo: 'taxa de administração', valor: taxa });
      if (Number.isFinite(fundo) && (fundo < 0 || fundo > 100)) foraPadrao.push({ grupo: g, campo: 'fundo de reserva', valor: fundo });
      if (Number.isFinite(prazo) && (prazo < 1 || prazo > 240)) foraPadrao.push({ grupo: g, campo: 'prazo', valor: prazo });
      if (Number.isFinite(cred) && cred <= 0) foraPadrao.push({ grupo: g, campo: 'crédito', valor: cred });
    }

    for (const g of gruposSet){
      const rec = ldb[String(g)];
      const serie = (rec && Array.isArray(rec.lances)) ? rec.lances.map(Number).filter(v => Number.isFinite(v) && v > 1) : [];
      if (serie.length < 6) semHistorico.add(g);
    }

    return {
      totalGrupos: gruposSet.size,
      gruposIncompletos: Array.from(incompletos),
      gruposSemHistoricoSuficiente: Array.from(semHistorico),
      camposForaPadrao: foraPadrao
    };
  };


  // Aliases para manter compatibilidade com o app (nomes esperados pelo app.js)
  // - Não muda regras, apenas expõe as mesmas validações com nomes padronizados.
  CORE.validateDatabank = function(databank){
    return CORE.validateBase(databank);
  };

  CORE.validateLanceDb = function(lanceDb){
    const db = (lanceDb && typeof lanceDb === 'object') ? lanceDb : {};
    const issues = [];
    let total = 0;
    for (const [grupo, rec] of Object.entries(db)){
      total++;
      if (!rec || !Array.isArray(rec.lances)){
        issues.push({ grupo: String(grupo), tipo: 'inválido', campo: 'histórico de lances', valor: 'ausente' });
        continue;
      }
      const nums = rec.lances.map(Number).filter(v => Number.isFinite(v));
      if (nums.length < 1){
        issues.push({ grupo: String(grupo), tipo: 'inválido', campo: 'histórico de lances', valor: 'sem números' });
      }
    }
    return { totalGrupos: total, issues };
  };

  CORE.groupsWithInsufficientHistory = function(databank, lanceDb, minPeriods){
    const rows = Array.isArray(databank) ? databank : [];
    const db = (lanceDb && typeof lanceDb === 'object') ? lanceDb : {};
    const need = Math.max(1, Math.floor(Number(minPeriods) || 12));
    const grupos = new Set();
    for (const r of rows){
      const g = String((r && (r['Grupo'] ?? r['grupo'])) ?? '').trim();
      if (!g || g === '0' || g === '0.0') continue;
      grupos.add(g);
    }
    const out = [];
    for (const g of grupos){
      const rec = db[String(g)];
      const serie = rec && Array.isArray(rec.lances) ? rec.lances.map(Number).filter(v => Number.isFinite(v)) : [];
      if (serie.length < need) out.push(String(g));
    }
    return out;
  };

  CORE.summarizeQuality = function(baseRes, lanceRes, gruposSemHistorico){
    const b = baseRes || { totalLinhas: 0, issues: [], criticalCount: 0 };
    const l = lanceRes || { totalGrupos: 0, issues: [] };
    const semHist = Array.isArray(gruposSemHistorico) ? gruposSemHistorico : [];

    const criticalErrors = [];
    const warnings = [];

    const baseIssues = Array.isArray(b.issues) ? b.issues : [];
    for (const it of baseIssues){
      if (!it) continue;
      const g = it.grupo ? String(it.grupo) : '?';
      const campo = it.campo ? String(it.campo) : 'campo';
      const tipo = it.tipo ? String(it.tipo) : 'problema';
      if (tipo === 'ausente' || tipo === 'inválido'){
        criticalErrors.push(`Grupo ${g}: ${campo} ${tipo}${it.valor!==undefined?` (“${it.valor}”)`:''}`);
      } else {
        warnings.push(`Grupo ${g}: ${campo} ${tipo}`);
      }
    }

    const lanceIssues = Array.isArray(l.issues) ? l.issues : [];
    for (const it of lanceIssues){
      const g = it.grupo ? String(it.grupo) : '?';
      warnings.push(`Histórico (Painel): Grupo ${g} com dados inválidos/ausentes.`);
    }

    const totalGrupos = (function(){
      const set = new Set();
      const rows = Array.isArray(window.DATABANK) ? window.DATABANK : [];
      for (const r of rows){
        const g = String((r && r['Grupo']) ?? '').trim();
        if (g && g !== '0' && g !== '0.0') set.add(g);
      }
      return set.size;
    })();

    return {
      criticalErrors,
      warnings,
      info: {
        totalGrupos,
        totalLinhas: Number(b.totalLinhas || 0),
        gruposSemHistorico: semHist
      }
    };
  };

  // ---------------- checklist de exportação ----------------
  CORE.checkBeforeExport = function(options){
    const out = { ok: true, errors: [], warnings: [] };
    const rows = (options && Array.isArray(options.rows)) ? options.rows : [];
    const baseReport = options && options.baseReport;
    const margins = options && options.margins;

    if (!rows.length){
      out.ok = false;
      out.errors.push('Selecione ao menos 1 linha para exportar.');
    }

    if (baseReport && baseReport.criticalCount > 0){
      out.ok = false;
      out.errors.push('A base de dados tem inconsistências críticas. Corrija/atualize a base antes de exportar.');
    }

    // valida dados mínimos da seleção
    for (const r of rows){
      const prazo = Number(r.prazoInicial);
      const cred = Number(r.totalCredito);
      const lance = Number(r.lanceSug);
      const pct = Number(r.lancePctSug);
      if (!Number.isFinite(prazo) || prazo < 1){
        out.ok = false;
        out.errors.push(`Linha do grupo ${r.grupo}: prazo inválido.`);
        break;
      }
      if (!Number.isFinite(cred) || cred <= 0){
        out.ok = false;
        out.errors.push(`Linha do grupo ${r.grupo}: crédito inválido.`);
        break;
      }
      if (Number.isFinite(pct) && (pct < 0 || pct > 100)){
        out.ok = false;
        out.errors.push(`Linha do grupo ${r.grupo}: percentual de lance fora do padrão (0% a 100%).`);
      }
      if (!Number.isFinite(lance) || lance < 0){
        out.ok = false;
        out.errors.push(`Linha do grupo ${r.grupo}: lance inválido.`);
        break;
      }
      if (lance > cred){
        out.warnings.push(`Grupo ${r.grupo}: lance maior que o crédito (verifique).`);
      }
      // percentuais (se existirem)
      if (r.taxaAdmPct !== undefined){
        const t = Number(r.taxaAdmPct);
        if (Number.isFinite(t) && (t < 0 || t > 100)){
          out.ok = false;
          out.errors.push(`Grupo ${r.grupo}: taxa de administração fora do padrão.`);
          break;
        }
      }
      if (r.fundoResPct !== undefined){
        const f = Number(r.fundoResPct);
        if (Number.isFinite(f) && (f < 0 || f > 100)){
          out.ok = false;
          out.errors.push(`Grupo ${r.grupo}: fundo de reserva fora do padrão.`);
          break;
        }
      }
    }

    // margens
    if (margins){
      const m = Number(margins);
      if (Number.isFinite(m) && (m < 5 || m > 25)){
        out.warnings.push('Margens do PDF estão fora do padrão comum (recomendado entre 8 e 15 mm).');
      }
    }

    return out;
  };

  // ---------------- settings do usuário ----------------
  const SETTINGS_KEY = 'GERPRO_USER_SETTINGS_V1';
  const DEFAULT_SETTINGS = {
    pdfMarginsMm: 10,
    maxLinhasTela: 20,
    formatoLancePadrao: 'reais', // 'reais' ou 'percentual'
    tabelaSimplificada: false,
    modoDiagnostico: false,
    mostrarExplicacoes: false,
    margemSeguranca: 2.5
  };

  CORE.getSettings = function(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      const s = Object.assign({}, DEFAULT_SETTINGS, (obj && typeof obj === 'object') ? obj : {});
      // saneamento
      s.pdfMarginsMm = CORE.clamp(s.pdfMarginsMm, 5, 25);
      s.maxLinhasTela = Math.max(5, Math.min(200, Math.floor(Number(s.maxLinhasTela) || DEFAULT_SETTINGS.maxLinhasTela)));
      s.formatoLancePadrao = (s.formatoLancePadrao === 'percentual') ? 'percentual' : 'reais';
      s.tabelaSimplificada = !!s.tabelaSimplificada;
      s.modoDiagnostico = !!s.modoDiagnostico;
      s.mostrarExplicacoes = !!s.mostrarExplicacoes;
      s.margemSeguranca = CORE.round2(CORE.clamp(Number(s.margemSeguranca ?? DEFAULT_SETTINGS.margemSeguranca), 0, 30));
      return s;
    }catch(e){
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  };

  CORE.saveSettings = function(next){
    const s = Object.assign({}, CORE.getSettings(), (next && typeof next === 'object') ? next : {});
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return s;
  };

  CORE.DEFAULT_SETTINGS = DEFAULT_SETTINGS;

  window.GerProCore = CORE;
})();