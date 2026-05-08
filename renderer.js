// レンダラープロセス：アプリ全ロジック
const { ipcRenderer } = require('electron');
const XLSX = require('xlsx');
const { PERSPECTIVES } = require('./src/perspectives-data');
const { TECHNIQUES, ORTHOGONAL_ARRAYS } = require('./src/techniques-data');

// ============================================================
// アプリ状態
// ============================================================
let state = {
  features: [],        // { id, name, desc, elements: [{id, name, desc}] }
  perspectives: {},    // { targetId: [no, ...] }
  testCases: [],       // { id, featureId, featureName, elementId, elementName, perspectiveNos, technique, condition, data, expected }
};

let selectedFeatureId = null;   // 機能分解タブで選択中の機能
let selectedTechnique = null;   // テスト技法タブで選択中の技法
let techniqueInputState = {};   // 各技法の入力状態
let nextId = 1;

function genId() { return 'id_' + (nextId++); }

// ============================================================
// 初期化
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  renderTechniqueButtons();
  renderPerspectivesGrid();
  loadStateOnStart();
});

async function loadStateOnStart() {
  const result = await ipcRenderer.invoke('load-state');
  if (result.success && result.state) {
    state = result.state;
    // IDカウンターを復元
    let maxId = 0;
    state.features.forEach(f => {
      const n = parseInt(f.id.replace('id_', '')) || 0;
      if (n > maxId) maxId = n;
      f.elements.forEach(e => {
        const m = parseInt(e.id.replace('id_', '')) || 0;
        if (m > maxId) maxId = m;
      });
    });
    state.testCases.forEach(tc => {
      const n = parseInt(tc.id.replace('id_', '')) || 0;
      if (n > maxId) maxId = n;
    });
    nextId = maxId + 1;
    renderFeatureList();
    updateAllSelectors();
    updateDecomposeSummary();
    updateTestCaseCount();
    renderExportTable();
  }
}

// ============================================================
// タブ切り替え
// ============================================================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

  if (tabId === 'tab-perspectives') {
    updateAllSelectors();
  } else if (tabId === 'tab-technique') {
    updateAllSelectors();
    updateTechRecommended();
    updateTestCaseCount();
  } else if (tabId === 'tab-export') {
    updateExportFilters();
    renderExportTable();
  }
}

// ============================================================
// ① 機能分解
// ============================================================
function showAddFeatureForm() {
  document.getElementById('add-feature-form').classList.remove('hidden');
  document.getElementById('new-feature-name').focus();
}
function hideAddFeatureForm() {
  document.getElementById('add-feature-form').classList.add('hidden');
  document.getElementById('new-feature-name').value = '';
  document.getElementById('new-feature-desc').value = '';
}

function addFeature() {
  const name = document.getElementById('new-feature-name').value.trim();
  if (!name) { showToast('機能名を入力してください', 'warn'); return; }
  const feature = { id: genId(), name, desc: document.getElementById('new-feature-desc').value.trim(), elements: [] };
  state.features.push(feature);
  hideAddFeatureForm();
  renderFeatureList();
  selectFeature(feature.id);
  updateAllSelectors();
  updateDecomposeSummary();
  autoSave();
}

function renderFeatureList() {
  const list = document.getElementById('feature-list');
  if (state.features.length === 0) {
    list.innerHTML = '<div class="empty-state">機能が登録されていません<br>「＋ 機能追加」から追加してください</div>';
    return;
  }
  list.innerHTML = state.features.map(f => `
    <div class="list-item ${f.id === selectedFeatureId ? 'selected' : ''}" onclick="selectFeature('${f.id}')">
      <div class="item-info">
        <div class="item-name">${escHtml(f.name)}</div>
        ${f.desc ? `<div class="item-desc">${escHtml(f.desc)}</div>` : ''}
        <div class="item-meta">${f.elements.length}要素</div>
      </div>
      <div class="item-actions">
        <button class="btn-icon-sm" onclick="editFeature('${f.id}', event)" title="編集">✏</button>
        <button class="btn-icon-sm danger" onclick="deleteFeature('${f.id}', event)" title="削除">🗑</button>
      </div>
    </div>
  `).join('');
}

function selectFeature(id) {
  selectedFeatureId = id;
  renderFeatureList();
  renderElementList();
  const f = state.features.find(f => f.id === id);
  document.getElementById('element-pane-title').textContent = f ? `要素一覧 — ${f.name}` : '要素一覧';
  document.getElementById('btn-add-element').disabled = false;
}

function editFeature(id, e) {
  e.stopPropagation();
  const f = state.features.find(f => f.id === id);
  if (!f) return;
  showModal('機能を編集', `
    <label class="modal-label">機能名</label>
    <input type="text" id="modal-name" class="form-input" value="${escHtml(f.name)}">
    <label class="modal-label">説明</label>
    <textarea id="modal-desc" class="form-input form-textarea" rows="3">${escHtml(f.desc)}</textarea>
  `, () => {
    const newName = document.getElementById('modal-name').value.trim();
    if (!newName) { showToast('機能名を入力してください', 'warn'); return false; }
    f.name = newName;
    f.desc = document.getElementById('modal-desc').value.trim();
    renderFeatureList();
    updateAllSelectors();
    autoSave();
    return true;
  });
}

function deleteFeature(id, e) {
  e.stopPropagation();
  const f = state.features.find(f => f.id === id);
  if (!confirm(`機能「${f.name}」を削除しますか？\n（この機能に紐づく要素とテストケースも削除されます）`)) return;
  state.features = state.features.filter(f => f.id !== id);
  state.testCases = state.testCases.filter(tc => tc.featureId !== id);
  if (selectedFeatureId === id) {
    selectedFeatureId = null;
    document.getElementById('element-list').innerHTML = '<div class="empty-state">左から機能を選択してください</div>';
    document.getElementById('element-pane-title').textContent = '要素一覧';
    document.getElementById('btn-add-element').disabled = true;
  }
  renderFeatureList();
  updateAllSelectors();
  updateDecomposeSummary();
  updateTestCaseCount();
  autoSave();
}

function showAddElementForm() {
  if (!selectedFeatureId) return;
  document.getElementById('add-element-form').classList.remove('hidden');
  document.getElementById('new-element-name').focus();
}
function hideAddElementForm() {
  document.getElementById('add-element-form').classList.add('hidden');
  document.getElementById('new-element-name').value = '';
  document.getElementById('new-element-desc').value = '';
}

function addElement() {
  if (!selectedFeatureId) return;
  const name = document.getElementById('new-element-name').value.trim();
  if (!name) { showToast('要素名を入力してください', 'warn'); return; }
  const feature = state.features.find(f => f.id === selectedFeatureId);
  const el = { id: genId(), name, desc: document.getElementById('new-element-desc').value.trim() };
  feature.elements.push(el);
  hideAddElementForm();
  renderElementList();
  renderFeatureList();
  updateAllSelectors();
  updateDecomposeSummary();
  autoSave();
}

function renderElementList() {
  const list = document.getElementById('element-list');
  if (!selectedFeatureId) {
    list.innerHTML = '<div class="empty-state">左から機能を選択してください</div>';
    return;
  }
  const feature = state.features.find(f => f.id === selectedFeatureId);
  if (!feature || feature.elements.length === 0) {
    list.innerHTML = '<div class="empty-state">要素が登録されていません<br>「＋ 要素追加」から追加してください</div>';
    return;
  }
  list.innerHTML = feature.elements.map(el => `
    <div class="list-item">
      <div class="item-info">
        <div class="item-name">${escHtml(el.name)}</div>
        ${el.desc ? `<div class="item-desc">${escHtml(el.desc)}</div>` : ''}
      </div>
      <div class="item-actions">
        <button class="btn-icon-sm" onclick="editElement('${feature.id}','${el.id}', event)" title="編集">✏</button>
        <button class="btn-icon-sm danger" onclick="deleteElement('${feature.id}','${el.id}', event)" title="削除">🗑</button>
      </div>
    </div>
  `).join('');
}

function editElement(fid, eid, e) {
  e.stopPropagation();
  const f = state.features.find(f => f.id === fid);
  const el = f.elements.find(e => e.id === eid);
  showModal('要素を編集', `
    <label class="modal-label">要素名</label>
    <input type="text" id="modal-name" class="form-input" value="${escHtml(el.name)}">
    <label class="modal-label">説明</label>
    <textarea id="modal-desc" class="form-input form-textarea" rows="3">${escHtml(el.desc)}</textarea>
  `, () => {
    const newName = document.getElementById('modal-name').value.trim();
    if (!newName) { showToast('要素名を入力してください', 'warn'); return false; }
    el.name = newName;
    el.desc = document.getElementById('modal-desc').value.trim();
    renderElementList();
    autoSave();
    return true;
  });
}

function deleteElement(fid, eid, e) {
  e.stopPropagation();
  const f = state.features.find(f => f.id === fid);
  const el = f.elements.find(e => e.id === eid);
  if (!confirm(`要素「${el.name}」を削除しますか？`)) return;
  f.elements = f.elements.filter(e => e.id !== eid);
  renderElementList();
  renderFeatureList();
  updateAllSelectors();
  updateDecomposeSummary();
  autoSave();
}

function updateDecomposeSummary() {
  const totalElements = state.features.reduce((sum, f) => sum + f.elements.length, 0);
  document.getElementById('decompose-summary').textContent =
    `機能: ${state.features.length}個　要素: ${totalElements}個`;
}

// ============================================================
// ② テスト観点
// ============================================================
function renderPerspectivesGrid() {
  const grid = document.getElementById('perspectives-grid');
  grid.innerHTML = PERSPECTIVES.map(p => `
    <div class="persp-card" id="pcard-${p.no}">
      <div class="persp-card-header">
        <label class="persp-check-label">
          <input type="checkbox" class="persp-check" data-no="${p.no}" onchange="onPerspChange()">
          <span class="persp-no">No.${p.no}</span>
        </label>
      </div>
      <div class="persp-name">${p.name}</div>
      <div class="persp-content">${p.content}</div>
      <div class="persp-tech">${p.technique !== '-' ? `技法：${p.technique}` : ''}</div>
    </div>
  `).join('');
}

function onPerspFeatureChange() {
  const fid = document.getElementById('persp-feature-sel').value;
  const elSel = document.getElementById('persp-element-sel');
  elSel.innerHTML = '<option value="">-- 全体（機能単位） --</option>';
  if (fid) {
    const f = state.features.find(f => f.id === fid);
    if (f) {
      f.elements.forEach(el => {
        const opt = document.createElement('option');
        opt.value = el.id;
        opt.textContent = el.name;
        elSel.appendChild(opt);
      });
    }
  }
  loadPerspChecks();
}

function onPerspElementChange() {
  loadPerspChecks();
}

function getPerspTargetId() {
  const eid = document.getElementById('persp-element-sel').value;
  const fid = document.getElementById('persp-feature-sel').value;
  return eid || fid || '';
}

function loadPerspChecks() {
  const tid = getPerspTargetId();
  const checked = tid ? (state.perspectives[tid] || []) : [];
  document.querySelectorAll('.persp-check').forEach(cb => {
    cb.checked = checked.includes(parseInt(cb.dataset.no));
  });
  updatePerspHighlight();
  updateRecommended();
}

function onPerspChange() {
  savePerspChecks();
  updatePerspHighlight();
  updateRecommended();
}

function savePerspChecks() {
  const tid = getPerspTargetId();
  if (!tid) return;
  const checked = [];
  document.querySelectorAll('.persp-check:checked').forEach(cb => checked.push(parseInt(cb.dataset.no)));
  state.perspectives[tid] = checked;
  updateTechRecommended();
  autoSave();
}

function updatePerspHighlight() {
  document.querySelectorAll('.persp-check').forEach(cb => {
    const card = document.getElementById(`pcard-${cb.dataset.no}`);
    card.classList.toggle('selected', cb.checked);
  });
}

function updateRecommended() {
  const checked = [];
  document.querySelectorAll('.persp-check:checked').forEach(cb => checked.push(parseInt(cb.dataset.no)));
  const techCodes = new Set();
  PERSPECTIVES.filter(p => checked.includes(p.no)).forEach(p => p.techniqueCodes.forEach(c => techCodes.add(c)));
  const techNames = [...techCodes].map(c => TECHNIQUES.find(t => t.code === c)?.name).filter(Boolean);
  document.getElementById('recommended-list').innerHTML =
    techNames.length ? techNames.map(n => `<span class="rec-chip">${n}</span>`).join('') : '（観点を選択すると推奨技法が表示されます）';
}

function clearPerspChecks() {
  document.querySelectorAll('.persp-check').forEach(cb => { cb.checked = false; });
  onPerspChange();
}
function checkAllPersp() {
  document.querySelectorAll('.persp-check').forEach(cb => { cb.checked = true; });
  onPerspChange();
}

// ============================================================
// ③ テスト技法
// ============================================================
function renderTechniqueButtons() {
  const container = document.getElementById('technique-buttons');
  container.innerHTML = TECHNIQUES.map(t => `
    <button class="tech-btn" id="tbtn-${t.code}" onclick="selectTechnique('${t.code}')">
      <span class="tech-icon">${t.icon}</span>
      <span class="tech-name">${t.name}</span>
    </button>
  `).join('');
}

function onTechFeatureChange() {
  const fid = document.getElementById('tech-feature-sel').value;
  const elSel = document.getElementById('tech-element-sel');
  elSel.innerHTML = '<option value="">-- 要素を選択 --</option>';
  if (fid) {
    const f = state.features.find(f => f.id === fid);
    if (f) {
      f.elements.forEach(el => {
        const opt = document.createElement('option');
        opt.value = el.id;
        opt.textContent = el.name;
        elSel.appendChild(opt);
      });
    }
  }
  updateTechRecommended();
}

function updateTechRecommended() {
  const fid = document.getElementById('tech-feature-sel')?.value || '';
  const eid = document.getElementById('tech-element-sel')?.value || '';
  const tid = eid || fid;
  const checked = tid ? (state.perspectives[tid] || []) : [];
  const techCodes = new Set();
  PERSPECTIVES.filter(p => checked.includes(p.no)).forEach(p => p.techniqueCodes.forEach(c => techCodes.add(c)));
  const container = document.getElementById('tech-recommended-list');
  if (!container) return;
  if (techCodes.size === 0) {
    container.innerHTML = '<span class="muted">（観点タブで選択した観点に基づく推奨）</span>';
    return;
  }
  container.innerHTML = [...techCodes].map(c => {
    const t = TECHNIQUES.find(t => t.code === c);
    if (!t) return '';
    return `<button class="rec-chip clickable" onclick="selectTechnique('${t.code}')">${t.name}</button>`;
  }).join('');
}

function selectTechnique(code) {
  selectedTechnique = code;
  document.querySelectorAll('.tech-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`tbtn-${code}`);
  if (btn) btn.classList.add('active');
  renderTechniqueForm(code);
}

function renderTechniqueForm(code) {
  const area = document.getElementById('technique-form-area');
  const tech = TECHNIQUES.find(t => t.code === code);
  if (!tech) return;

  const savedState = techniqueInputState[code] || {};

  let formHtml = `
    <div class="tech-form-header">
      <span class="tech-form-icon">${tech.icon}</span>
      <div>
        <h3 class="tech-form-title">${tech.name}</h3>
        <p class="tech-form-desc">${tech.description}</p>
      </div>
    </div>
    <div class="tech-form-body">
  `;

  switch (code) {
    case 'equivalence': formHtml += buildEquivalenceForm(savedState); break;
    case 'boundary':    formHtml += buildBoundaryForm(savedState); break;
    case 'decision':    formHtml += buildDecisionForm(savedState); break;
    case 'allpairs':    formHtml += buildAllPairsForm(savedState); break;
    case 'orthogonal':  formHtml += buildOrthogonalForm(savedState); break;
    case 'state':       formHtml += buildStateForm(savedState); break;
    case 'causeeffect': formHtml += buildCauseEffectForm(savedState); break;
    case 'scenario':    formHtml += buildScenarioForm(savedState); break;
    case 'error':       formHtml += buildErrorForm(savedState); break;
    case 'abnormal':    formHtml += buildAbnormalForm(savedState); break;
    case 'cfd':         formHtml += buildCfdForm(savedState); break;
  }

  formHtml += `
    </div>
    <div class="tech-form-actions">
      <button class="btn-primary" onclick="generateTestCases('${code}')">テストケースを生成</button>
      <button class="btn-secondary" onclick="clearTechForm('${code}')">クリア</button>
    </div>
    <div id="tech-result-area" class="tech-result-area hidden"></div>
  `;

  area.innerHTML = formHtml;
  restoreTechFormState(code, savedState);
}

// ============================================================
// 同値分割フォーム
// ============================================================
function buildEquivalenceForm(s) {
  const classes = s.classes || [
    { id: 'ec1', type: 'valid', name: '有効同値クラス1', value: '', expected: '' },
    { id: 'ec2', type: 'invalid', name: '無効同値クラス1', value: '', expected: 'エラー' },
  ];
  techniqueInputState['equivalence'] = techniqueInputState['equivalence'] || { classes };
  return `
    <div class="form-group">
      <label class="form-label">テスト対象名</label>
      <input type="text" id="eq-target" class="form-input" placeholder="例：年齢入力" value="${escHtml(s.target||'')}">
    </div>
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">同値クラス一覧</label>
        <button class="btn-add-small" onclick="addEquivClass('valid')">＋ 有効クラス追加</button>
        <button class="btn-add-small secondary" onclick="addEquivClass('invalid')">＋ 無効クラス追加</button>
      </div>
      <div id="eq-classes-list">
        ${renderEquivClasses(classes)}
      </div>
    </div>
  `;
}

function renderEquivClasses(classes) {
  return classes.map((c, i) => `
    <div class="eq-class-row ${c.type}" id="ecr-${c.id}">
      <span class="eq-class-badge ${c.type}">${c.type === 'valid' ? '有効' : '無効'}</span>
      <input type="text" class="form-input eq-input" placeholder="クラス名" value="${escHtml(c.name)}"
        onchange="updateEquivClass('${c.id}', 'name', this.value)">
      <input type="text" class="form-input eq-input" placeholder="代表値" value="${escHtml(c.value)}"
        onchange="updateEquivClass('${c.id}', 'value', this.value)">
      <input type="text" class="form-input eq-input" placeholder="期待結果" value="${escHtml(c.expected)}"
        onchange="updateEquivClass('${c.id}', 'expected', this.value)">
      <button class="btn-icon-sm danger" onclick="removeEquivClass('${c.id}')">🗑</button>
    </div>
  `).join('');
}

function addEquivClass(type) {
  const s = techniqueInputState['equivalence'] || { classes: [] };
  const id = 'ec' + Date.now();
  const name = type === 'valid' ? `有効同値クラス${s.classes.filter(c=>c.type==='valid').length+1}` : `無効同値クラス${s.classes.filter(c=>c.type==='invalid').length+1}`;
  s.classes.push({ id, type, name, value: '', expected: type === 'invalid' ? 'エラー' : '' });
  techniqueInputState['equivalence'] = s;
  document.getElementById('eq-classes-list').innerHTML = renderEquivClasses(s.classes);
}

function removeEquivClass(id) {
  const s = techniqueInputState['equivalence'];
  s.classes = s.classes.filter(c => c.id !== id);
  document.getElementById('eq-classes-list').innerHTML = renderEquivClasses(s.classes);
}

function updateEquivClass(id, field, value) {
  const s = techniqueInputState['equivalence'];
  const c = s.classes.find(c => c.id === id);
  if (c) c[field] = value;
}

// ============================================================
// 境界値分析フォーム
// ============================================================
function buildBoundaryForm(s) {
  return `
    <div class="form-group">
      <label class="form-label">テスト対象名</label>
      <input type="text" id="bv-target" class="form-input" placeholder="例：注文数量" value="${escHtml(s.target||'')}">
    </div>
    <div class="form-row">
      <div class="form-group flex1">
        <label class="form-label">データ型</label>
        <select id="bv-type" class="form-select" onchange="onBvTypeChange()">
          <option value="integer" ${s.type==='integer'?'selected':''}>整数</option>
          <option value="decimal" ${s.type==='decimal'?'selected':''}>小数</option>
          <option value="strlen"  ${s.type==='strlen'?'selected':''}>文字数</option>
          <option value="date"    ${s.type==='date'?'selected':''}>日付</option>
        </select>
      </div>
      <div class="form-group flex1">
        <label class="form-label">最小値</label>
        <input type="text" id="bv-min" class="form-input" placeholder="1" value="${escHtml(s.min||'')}">
      </div>
      <div class="form-group flex1">
        <label class="form-label">最大値</label>
        <input type="text" id="bv-max" class="form-input" placeholder="100" value="${escHtml(s.max||'')}">
      </div>
      <div class="form-group flex1" id="bv-step-group">
        <label class="form-label">ステップ</label>
        <input type="text" id="bv-step" class="form-input" placeholder="1" value="${escHtml(s.step||'1')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">有効範囲の説明（任意）</label>
      <input type="text" id="bv-desc" class="form-input" placeholder="例：1以上100以下" value="${escHtml(s.desc||'')}">
    </div>
  `;
}

function onBvTypeChange() {
  const type = document.getElementById('bv-type').value;
  const stepGrp = document.getElementById('bv-step-group');
  if (stepGrp) stepGrp.style.display = type === 'date' ? 'none' : '';
}

// ============================================================
// デシジョンテーブルフォーム
// ============================================================
function buildDecisionForm(s) {
  const conditions = s.conditions || [
    { id: 'c1', name: '条件1', values: 'Y,N' },
    { id: 'c2', name: '条件2', values: 'Y,N' },
  ];
  const actions = s.actions || [
    { id: 'a1', name: 'アクション1' },
  ];
  techniqueInputState['decision'] = techniqueInputState['decision'] || { conditions, actions };
  return `
    <div class="form-row">
      <div class="form-group flex1">
        <div class="eq-classes-header">
          <label class="form-label">条件</label>
          <button class="btn-add-small" onclick="addDtItem('conditions', 'c')">＋ 条件追加</button>
        </div>
        <div id="dt-conditions">
          ${renderDtItems(conditions, 'cond')}
        </div>
      </div>
      <div class="form-group flex1">
        <div class="eq-classes-header">
          <label class="form-label">アクション</label>
          <button class="btn-add-small" onclick="addDtItem('actions', 'a')">＋ アクション追加</button>
        </div>
        <div id="dt-actions">
          ${renderDtItems(actions, 'act')}
        </div>
      </div>
    </div>
    <p class="hint-text">※ 条件の値はカンマ区切りで指定（例：Y,N）。生成後に期待アクションをチェックしてください。</p>
  `;
}

function renderDtItems(items, prefix) {
  return items.map(item => `
    <div class="dt-item-row" id="dtr-${item.id}">
      <input type="text" class="form-input dt-name-input" placeholder="${prefix==='cond'?'条件名':'アクション名'}" value="${escHtml(item.name)}"
        onchange="updateDtItem('${prefix==='cond'?'conditions':'actions'}','${item.id}','name',this.value)">
      ${prefix === 'cond' ? `
        <input type="text" class="form-input dt-val-input" placeholder="Y,N" value="${escHtml(item.values||'Y,N')}"
          onchange="updateDtItem('conditions','${item.id}','values',this.value)">
      ` : ''}
      <button class="btn-icon-sm danger" onclick="removeDtItem('${prefix==='cond'?'conditions':'actions'}','${item.id}')">🗑</button>
    </div>
  `).join('');
}

function addDtItem(type, prefix) {
  const s = techniqueInputState['decision'] || { conditions: [], actions: [] };
  const id = prefix + Date.now();
  const n = s[type].length + 1;
  if (type === 'conditions') {
    s[type].push({ id, name: `条件${n}`, values: 'Y,N' });
    document.getElementById('dt-conditions').innerHTML = renderDtItems(s[type], 'cond');
  } else {
    s[type].push({ id, name: `アクション${n}` });
    document.getElementById('dt-actions').innerHTML = renderDtItems(s[type], 'act');
  }
}

function removeDtItem(type, id) {
  const s = techniqueInputState['decision'];
  s[type] = s[type].filter(i => i.id !== id);
  if (type === 'conditions') document.getElementById('dt-conditions').innerHTML = renderDtItems(s.conditions, 'cond');
  else document.getElementById('dt-actions').innerHTML = renderDtItems(s.actions, 'act');
}

function updateDtItem(type, id, field, value) {
  const s = techniqueInputState['decision'];
  const item = s[type].find(i => i.id === id);
  if (item) item[field] = value;
}

// ============================================================
// All-Pairs法フォーム
// ============================================================
function buildAllPairsForm(s) {
  const factors = s.factors || [
    { id: 'f1', name: '因子1', levels: '水準A,水準B' },
    { id: 'f2', name: '因子2', levels: '水準X,水準Y' },
    { id: 'f3', name: '因子3', levels: '水準P,水準Q' },
  ];
  techniqueInputState['allpairs'] = techniqueInputState['allpairs'] || { factors };
  return `
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">因子と水準</label>
        <button class="btn-add-small" onclick="addFactor('allpairs')">＋ 因子追加</button>
      </div>
      <div id="ap-factors">
        ${renderFactors(factors, 'allpairs')}
      </div>
    </div>
    <p class="hint-text">※ 水準はカンマ区切りで指定（例：Chrome,Firefox,Safari）</p>
  `;
}

function buildOrthogonalForm(s) {
  const factors = s.factors || [
    { id: 'f1', name: '因子1', levels: '水準A,水準B' },
    { id: 'f2', name: '因子2', levels: '水準X,水準Y' },
    { id: 'f3', name: '因子3', levels: '水準P,水準Q' },
  ];
  techniqueInputState['orthogonal'] = techniqueInputState['orthogonal'] || { factors };
  return `
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">因子と水準</label>
        <button class="btn-add-small" onclick="addFactor('orthogonal')">＋ 因子追加</button>
      </div>
      <div id="orth-factors">
        ${renderFactors(factors, 'orthogonal')}
      </div>
    </div>
    <p class="hint-text">※ 全ての因子が2水準の場合はL4/L8/L16、3水準の場合はL9/L27を自動選択します。混在の場合はAll-Pairs法を推奨します。</p>
  `;
}

function renderFactors(factors, techCode) {
  const prefix = techCode === 'allpairs' ? 'ap' : 'orth';
  return factors.map(f => `
    <div class="factor-row" id="fr-${f.id}">
      <input type="text" class="form-input factor-name" placeholder="因子名" value="${escHtml(f.name)}"
        onchange="updateFactor('${techCode}','${f.id}','name',this.value)">
      <input type="text" class="form-input factor-levels" placeholder="水準1,水準2,水準3" value="${escHtml(f.levels)}"
        onchange="updateFactor('${techCode}','${f.id}','levels',this.value)">
      <button class="btn-icon-sm danger" onclick="removeFactor('${techCode}','${f.id}')">🗑</button>
    </div>
  `).join('');
}

function addFactor(techCode) {
  const s = techniqueInputState[techCode] || { factors: [] };
  const id = 'f' + Date.now();
  const n = s.factors.length + 1;
  s.factors.push({ id, name: `因子${n}`, levels: '水準A,水準B' });
  const prefix = techCode === 'allpairs' ? 'ap' : 'orth';
  document.getElementById(`${prefix}-factors`).innerHTML = renderFactors(s.factors, techCode);
}

function removeFactor(techCode, id) {
  const s = techniqueInputState[techCode];
  s.factors = s.factors.filter(f => f.id !== id);
  const prefix = techCode === 'allpairs' ? 'ap' : 'orth';
  document.getElementById(`${prefix}-factors`).innerHTML = renderFactors(s.factors, techCode);
}

function updateFactor(techCode, id, field, value) {
  const s = techniqueInputState[techCode];
  const f = s.factors.find(f => f.id === id);
  if (f) f[field] = value;
}

// ============================================================
// 状態遷移テストフォーム
// ============================================================
function buildStateForm(s) {
  const states = s.states || ['状態A', '状態B', '状態C'];
  const events = s.events || ['イベント1', 'イベント2'];
  const transitions = s.transitions || {};
  techniqueInputState['state'] = techniqueInputState['state'] || { states, events, transitions };
  return `
    <div class="form-row">
      <div class="form-group flex1">
        <label class="form-label">状態リスト（1行1つ）</label>
        <textarea id="st-states" class="form-input form-textarea" rows="5" placeholder="状態A&#10;状態B&#10;状態C"
          onchange="updateStateData()">${states.join('\n')}</textarea>
      </div>
      <div class="form-group flex1">
        <label class="form-label">イベントリスト（1行1つ）</label>
        <textarea id="st-events" class="form-input form-textarea" rows="5" placeholder="イベント1&#10;イベント2"
          onchange="updateStateData()">${events.join('\n')}</textarea>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">遷移テーブル（現在状態 × イベント → 次状態。"-" は遷移なし）</label>
      <div id="state-table-wrap" class="state-table-wrap">
        ${buildStateTable(states, events, transitions)}
      </div>
    </div>
  `;
}

function buildStateTable(states, events, transitions) {
  if (!states.length || !events.length) return '<p class="muted">状態とイベントを入力してください</p>';
  let html = '<table class="state-matrix"><thead><tr><th>現在状態 \\ イベント</th>';
  events.forEach(e => { html += `<th>${escHtml(e)}</th>`; });
  html += '</tr></thead><tbody>';
  states.forEach(s => {
    html += `<tr><td class="state-label">${escHtml(s)}</td>`;
    events.forEach(e => {
      const key = `${s}__${e}`;
      const val = transitions[key] || '';
      html += `<td><input type="text" class="state-cell-input" value="${escHtml(val)}"
        onchange="updateTransition('${key.replace(/'/g,"\\'")}', this.value)" placeholder="-"></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function updateStateData() {
  const s = techniqueInputState['state'];
  s.states = document.getElementById('st-states').value.split('\n').map(x=>x.trim()).filter(Boolean);
  s.events = document.getElementById('st-events').value.split('\n').map(x=>x.trim()).filter(Boolean);
  document.getElementById('state-table-wrap').innerHTML = buildStateTable(s.states, s.events, s.transitions);
}

function updateTransition(key, value) {
  const s = techniqueInputState['state'];
  s.transitions[key] = value;
}

// ============================================================
// 原因結果グラフフォーム
// ============================================================
function buildCauseEffectForm(s) {
  const causes = s.causes || [
    { id: 'ca1', name: '条件1' },
    { id: 'ca2', name: '条件2' },
  ];
  const effects = s.effects || [
    { id: 'ef1', name: '結果1' },
  ];
  const rules = s.rules || [];
  techniqueInputState['causeeffect'] = techniqueInputState['causeeffect'] || { causes, effects, rules };
  return `
    <div class="form-row">
      <div class="form-group flex1">
        <div class="eq-classes-header">
          <label class="form-label">原因（条件）</label>
          <button class="btn-add-small" onclick="addCeItem('causes')">＋ 追加</button>
        </div>
        <div id="ce-causes">${renderCeItems(causes, 'causes')}</div>
      </div>
      <div class="form-group flex1">
        <div class="eq-classes-header">
          <label class="form-label">結果（効果）</label>
          <button class="btn-add-small" onclick="addCeItem('effects')">＋ 追加</button>
        </div>
        <div id="ce-effects">${renderCeItems(effects, 'effects')}</div>
      </div>
    </div>
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">ルール（原因→結果の組み合わせ）</label>
        <button class="btn-add-small" onclick="addCeRule()">＋ ルール追加</button>
      </div>
      <div id="ce-rules">${renderCeRules(causes, effects, rules)}</div>
    </div>
  `;
}

function renderCeItems(items, type) {
  return items.map(item => `
    <div class="ce-item-row">
      <input type="text" class="form-input" placeholder="名前" value="${escHtml(item.name)}"
        onchange="updateCeItem('${type}','${item.id}','name',this.value)">
      <button class="btn-icon-sm danger" onclick="removeCeItem('${type}','${item.id}')">🗑</button>
    </div>
  `).join('');
}

function renderCeRules(causes, effects, rules) {
  if (!causes.length || !effects.length) return '<p class="muted">原因と結果を先に入力してください</p>';
  return rules.map((rule, i) => `
    <div class="ce-rule-row">
      <span class="rule-num">R${i+1}</span>
      <select class="form-select rule-cause" onchange="updateCeRule(${i},'cause',this.value)">
        ${causes.map(c=>`<option value="${c.id}" ${rule.causeId===c.id?'selected':''}>${escHtml(c.name)}</option>`).join('')}
      </select>
      <select class="form-select rule-op" onchange="updateCeRule(${i},'causeVal',this.value)">
        <option value="true" ${rule.causeVal!=='false'?'selected':''}>= True（成立）</option>
        <option value="false" ${rule.causeVal==='false'?'selected':''}>= False（不成立）</option>
      </select>
      <span class="rule-arrow">→</span>
      <select class="form-select rule-effect" onchange="updateCeRule(${i},'effect',this.value)">
        ${effects.map(e=>`<option value="${e.id}" ${rule.effectId===e.id?'selected':''}>${escHtml(e.name)}</option>`).join('')}
      </select>
      <select class="form-select rule-op" onchange="updateCeRule(${i},'effectVal',this.value)">
        <option value="true" ${rule.effectVal!=='false'?'selected':''}>= True（発生）</option>
        <option value="false" ${rule.effectVal==='false'?'selected':''}>= False（未発生）</option>
      </select>
      <button class="btn-icon-sm danger" onclick="removeCeRule(${i})">🗑</button>
    </div>
  `).join('') || '<p class="muted">ルールが設定されていません</p>';
}

function addCeItem(type) {
  const s = techniqueInputState['causeeffect'];
  const id = type[0] + Date.now();
  const n = s[type].length + 1;
  s[type].push({ id, name: `${type==='causes'?'条件':'結果'}${n}` });
  document.getElementById(`ce-${type}`).innerHTML = renderCeItems(s[type], type);
  document.getElementById('ce-rules').innerHTML = renderCeRules(s.causes, s.effects, s.rules);
}

function removeCeItem(type, id) {
  const s = techniqueInputState['causeeffect'];
  s[type] = s[type].filter(i => i.id !== id);
  document.getElementById(`ce-${type}`).innerHTML = renderCeItems(s[type], type);
  document.getElementById('ce-rules').innerHTML = renderCeRules(s.causes, s.effects, s.rules);
}

function updateCeItem(type, id, field, value) {
  const s = techniqueInputState['causeeffect'];
  const item = s[type].find(i => i.id === id);
  if (item) item[field] = value;
}

function addCeRule() {
  const s = techniqueInputState['causeeffect'];
  if (!s.causes.length || !s.effects.length) { showToast('原因と結果を先に入力してください', 'warn'); return; }
  s.rules.push({ causeId: s.causes[0].id, causeVal: 'true', effectId: s.effects[0].id, effectVal: 'true' });
  document.getElementById('ce-rules').innerHTML = renderCeRules(s.causes, s.effects, s.rules);
}

function updateCeRule(i, field, value) {
  const s = techniqueInputState['causeeffect'];
  s.rules[i][field] = value;
}

function removeCeRule(i) {
  const s = techniqueInputState['causeeffect'];
  s.rules.splice(i, 1);
  document.getElementById('ce-rules').innerHTML = renderCeRules(s.causes, s.effects, s.rules);
}

// ============================================================
// シナリオテストフォーム
// ============================================================
function buildScenarioForm(s) {
  const steps = s.steps || [
    { id: 's1', action: '', expected: '' },
  ];
  techniqueInputState['scenario'] = techniqueInputState['scenario'] || { name: '', precondition: '', steps };
  return `
    <div class="form-group">
      <label class="form-label">シナリオ名</label>
      <input type="text" id="sc-name" class="form-input" placeholder="例：商品購入フロー" value="${escHtml(s.name||'')}">
    </div>
    <div class="form-group">
      <label class="form-label">前提条件</label>
      <textarea id="sc-precond" class="form-input form-textarea" rows="2" placeholder="例：ログイン済み、商品が在庫あり">${escHtml(s.precondition||'')}</textarea>
    </div>
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">手順と期待結果</label>
        <button class="btn-add-small" onclick="addScenarioStep()">＋ 手順追加</button>
      </div>
      <div id="sc-steps">
        ${renderScenarioSteps(steps)}
      </div>
    </div>
  `;
}

function renderScenarioSteps(steps) {
  return steps.map((step, i) => `
    <div class="sc-step-row" id="ssr-${step.id}">
      <span class="step-num">Step ${i+1}</span>
      <input type="text" class="form-input step-action" placeholder="操作・手順" value="${escHtml(step.action)}"
        onchange="updateScenarioStep('${step.id}','action',this.value)">
      <input type="text" class="form-input step-expected" placeholder="期待結果" value="${escHtml(step.expected)}"
        onchange="updateScenarioStep('${step.id}','expected',this.value)">
      <button class="btn-icon-sm danger" onclick="removeScenarioStep('${step.id}')">🗑</button>
    </div>
  `).join('');
}

function addScenarioStep() {
  const s = techniqueInputState['scenario'];
  const id = 'sst' + Date.now();
  s.steps.push({ id, action: '', expected: '' });
  document.getElementById('sc-steps').innerHTML = renderScenarioSteps(s.steps);
}

function removeScenarioStep(id) {
  const s = techniqueInputState['scenario'];
  s.steps = s.steps.filter(st => st.id !== id);
  document.getElementById('sc-steps').innerHTML = renderScenarioSteps(s.steps);
}

function updateScenarioStep(id, field, value) {
  const s = techniqueInputState['scenario'];
  const step = s.steps.find(st => st.id === id);
  if (step) step[field] = value;
}

// ============================================================
// エラー推測フォーム
// ============================================================
const ERROR_CATEGORIES = [
  { id: 'input_zero', cat: '入力値', label: 'ゼロ値', template: '"{target}" にゼロ（0）を入力する', expected: 'エラー表示または適切なハンドリング' },
  { id: 'input_neg', cat: '入力値', label: 'マイナス値', template: '"{target}" にマイナス値を入力する', expected: 'エラー表示' },
  { id: 'input_max', cat: '入力値', label: '最大値超え', template: '"{target}" に最大値を超えた値を入力する', expected: 'エラー表示' },
  { id: 'input_empty', cat: '入力値', label: '空入力・NULL', template: '"{target}" を空のまま実行する', expected: '必須エラー表示' },
  { id: 'input_special', cat: '入力値', label: '特殊文字', template: '"{target}" に特殊文字（<>&"\'等）を入力する', expected: 'エスケープされるか適切なエラー' },
  { id: 'input_long', cat: '入力値', label: '最大長超え', template: '"{target}" に最大文字数を超えた入力をする', expected: 'エラー表示または切り捨て' },
  { id: 'op_double', cat: '操作', label: 'ボタン連打・二重押し', template: '処理ボタンを素早く連打する', expected: '二重処理が発生しないこと' },
  { id: 'op_cancel', cat: '操作', label: '途中キャンセル', template: '処理途中でキャンセルを行う', expected: '処理が正しくロールバックされること' },
  { id: 'op_back', cat: '操作', label: 'ブラウザバック', template: '処理中にブラウザの戻るボタンを押す', expected: 'データ不整合が発生しないこと' },
  { id: 'state_precheck', cat: '状態', label: '前処理未完了', template: '前提条件を満たさない状態で処理を実行する', expected: '適切なエラーまたは操作抑止' },
  { id: 'state_session', cat: '状態', label: 'セッション切れ', template: 'セッションタイムアウト後に操作を行う', expected: 'ログイン画面へリダイレクト' },
  { id: 'state_concurrent', cat: '状態', label: '同時操作', template: '複数ユーザーが同じデータを同時更新する', expected: '排他制御が正しく機能すること' },
  { id: 'net_disconnect', cat: 'ネットワーク', label: '処理中切断', template: '処理実行中にネットワークを切断する', expected: '適切なエラー処理・ロールバック' },
  { id: 'net_timeout', cat: 'ネットワーク', label: 'タイムアウト', template: 'ネットワーク遅延によるタイムアウトを発生させる', expected: 'タイムアウトエラーが表示されること' },
  { id: 'data_dup', cat: 'データ', label: '重複登録', template: '同一データを重複して登録しようとする', expected: '重複エラーが表示されること' },
  { id: 'data_notexist', cat: 'データ', label: '存在しないキー参照', template: '削除済みデータを参照・更新しようとする', expected: 'エラーまたは適切なメッセージ' },
  { id: 'data_special', cat: 'データ', label: '異常文字・文字化け', template: '異なる文字コードを含むデータを処理する', expected: '文字化けせず正常処理されること' },
];

function buildErrorForm(s) {
  const selectedIds = s.selectedIds || [];
  const target = s.target || '';
  // カテゴリ別にグループ化
  const cats = [...new Set(ERROR_CATEGORIES.map(e => e.cat))];
  techniqueInputState['error'] = techniqueInputState['error'] || { target, selectedIds };
  return `
    <div class="form-group">
      <label class="form-label">テスト対象機能名</label>
      <input type="text" id="err-target" class="form-input" placeholder="例：注文登録画面" value="${escHtml(target)}"
        onchange="updateErrorTarget(this.value)">
    </div>
    <div class="form-group">
      <label class="form-label">エラーパターン選択（該当するものをチェック）</label>
      ${cats.map(cat => `
        <div class="error-cat-group">
          <div class="error-cat-label">${cat}</div>
          ${ERROR_CATEGORIES.filter(e => e.cat === cat).map(e => `
            <label class="error-check-label">
              <input type="checkbox" class="error-check" value="${e.id}" ${selectedIds.includes(e.id)?'checked':''}
                onchange="updateErrorSelection('${e.id}', this.checked)">
              ${e.label}
            </label>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <div class="form-actions-inline">
      <button class="btn-secondary" onclick="checkAllErrors()">全選択</button>
      <button class="btn-secondary" onclick="clearAllErrors()">全解除</button>
    </div>
  `;
}

function updateErrorTarget(val) { if (techniqueInputState['error']) techniqueInputState['error'].target = val; }
function updateErrorSelection(id, checked) {
  const s = techniqueInputState['error'];
  if (checked && !s.selectedIds.includes(id)) s.selectedIds.push(id);
  else s.selectedIds = s.selectedIds.filter(x => x !== id);
}
function checkAllErrors() {
  document.querySelectorAll('.error-check').forEach(cb => { cb.checked = true; });
  const s = techniqueInputState['error'];
  s.selectedIds = ERROR_CATEGORIES.map(e => e.id);
}
function clearAllErrors() {
  document.querySelectorAll('.error-check').forEach(cb => { cb.checked = false; });
  if (techniqueInputState['error']) techniqueInputState['error'].selectedIds = [];
}

// ============================================================
// 異常値・特異値分析フォーム
// ============================================================
const ABNORMAL_PATTERNS = {
  integer:  ['0（ゼロ）', '-1（マイナス値）', '最大値 + 1', '最小値 - 1', '空/NULL', '文字列', '小数値', '非常に大きな値（INT_MAX超）'],
  decimal:  ['0.0', '-0.001', '非常に大きな値', 'NULL', '整数（小数なし）', '文字列', '無限大'],
  string:   ['空文字', 'NULL', '半角スペースのみ', '最大文字数 + 1文字', '特殊文字（<>&"\'）', '制御文字・改行コード', 'SQLインジェクション文字列', 'スクリプトタグ（XSS）', '全角文字', '絵文字'],
  date:     ['存在しない日付（2月30日）', 'うるう年境界（2月29日）', '最小日付', '最大日付', '過去日付', '未来日付（遠い将来）', '文字列形式の日付', 'NULL'],
  email:    ['@なし', 'ドメインなし', '連続ドット', '空文字', '最大長 + 1文字', 'SQLインジェクション'],
  url:      ['プロトコルなし', '不正なURL', 'SQLインジェクション', 'JavaScriptスキーム', '非常に長いURL'],
  password: ['最小文字数 - 1', '最大文字数 + 1', '空', '特殊文字のみ', '空白のみ', '一般的なパスワード（password）'],
  select:   ['選択なし（必須の場合）', '存在しない値', '境界値（最初/最後の選択肢）'],
};

function buildAbnormalForm(s) {
  const fields = s.fields || [
    { id: 'ab1', name: 'フィールド1', type: 'integer' },
  ];
  techniqueInputState['abnormal'] = techniqueInputState['abnormal'] || { fields };
  return `
    <div class="form-group">
      <div class="eq-classes-header">
        <label class="form-label">入力フィールド一覧</label>
        <button class="btn-add-small" onclick="addAbnormalField()">＋ フィールド追加</button>
      </div>
      <div id="ab-fields">
        ${renderAbnormalFields(fields)}
      </div>
    </div>
  `;
}

function renderAbnormalFields(fields) {
  return fields.map(f => `
    <div class="ab-field-row" id="abr-${f.id}">
      <input type="text" class="form-input ab-name" placeholder="フィールド名" value="${escHtml(f.name)}"
        onchange="updateAbnormalField('${f.id}','name',this.value)">
      <select class="form-select ab-type" onchange="updateAbnormalField('${f.id}','type',this.value)">
        ${Object.keys(ABNORMAL_PATTERNS).map(k => `<option value="${k}" ${f.type===k?'selected':''}>${getAbnormalTypeName(k)}</option>`).join('')}
      </select>
      <button class="btn-icon-sm danger" onclick="removeAbnormalField('${f.id}')">🗑</button>
    </div>
  `).join('');
}

function getAbnormalTypeName(type) {
  const names = { integer: '整数', decimal: '小数', string: '文字列', date: '日付', email: 'メールアドレス', url: 'URL', password: 'パスワード', select: '選択' };
  return names[type] || type;
}

function addAbnormalField() {
  const s = techniqueInputState['abnormal'];
  const id = 'ab' + Date.now();
  const n = s.fields.length + 1;
  s.fields.push({ id, name: `フィールド${n}`, type: 'string' });
  document.getElementById('ab-fields').innerHTML = renderAbnormalFields(s.fields);
}

function removeAbnormalField(id) {
  const s = techniqueInputState['abnormal'];
  s.fields = s.fields.filter(f => f.id !== id);
  document.getElementById('ab-fields').innerHTML = renderAbnormalFields(s.fields);
}

function updateAbnormalField(id, field, value) {
  const s = techniqueInputState['abnormal'];
  const f = s.fields.find(f => f.id === id);
  if (f) f[field] = value;
}

// ============================================================
// CFD法フォーム
// ============================================================
function buildCfdForm(s) {
  const steps = s.steps || [
    { id: 'cf1', name: '処理1', condition: '', branch: '' },
    { id: 'cf2', name: '処理2', condition: '', branch: '' },
  ];
  techniqueInputState['cfd'] = techniqueInputState['cfd'] || { steps };
  return `
    <div class="form-group">
      <p class="hint-text">処理の流れを入力してください。条件がある場合は条件と分岐を入力します。</p>
      <div class="eq-classes-header">
        <label class="form-label">処理ステップ</label>
        <button class="btn-add-small" onclick="addCfdStep()">＋ ステップ追加</button>
      </div>
      <div id="cfd-steps">
        ${renderCfdSteps(steps)}
      </div>
    </div>
  `;
}

function renderCfdSteps(steps) {
  return steps.map((step, i) => `
    <div class="cfd-step-row" id="cfdr-${step.id}">
      <span class="step-num">Step ${i+1}</span>
      <input type="text" class="form-input cfd-name" placeholder="処理・操作名" value="${escHtml(step.name)}"
        onchange="updateCfdStep('${step.id}','name',this.value)">
      <input type="text" class="form-input cfd-cond" placeholder="条件（任意）例：残高不足の場合" value="${escHtml(step.condition)}"
        onchange="updateCfdStep('${step.id}','condition',this.value)">
      <input type="text" class="form-input cfd-branch" placeholder="分岐先（条件成立時）" value="${escHtml(step.branch)}"
        onchange="updateCfdStep('${step.id}','branch',this.value)">
      <button class="btn-icon-sm danger" onclick="removeCfdStep('${step.id}')">🗑</button>
    </div>
  `).join('');
}

function addCfdStep() {
  const s = techniqueInputState['cfd'];
  const id = 'cf' + Date.now();
  const n = s.steps.length + 1;
  s.steps.push({ id, name: `処理${n}`, condition: '', branch: '' });
  document.getElementById('cfd-steps').innerHTML = renderCfdSteps(s.steps);
}

function removeCfdStep(id) {
  const s = techniqueInputState['cfd'];
  s.steps = s.steps.filter(st => st.id !== id);
  document.getElementById('cfd-steps').innerHTML = renderCfdSteps(s.steps);
}

function updateCfdStep(id, field, value) {
  const s = techniqueInputState['cfd'];
  const step = s.steps.find(st => st.id === id);
  if (step) step[field] = value;
}

function restoreTechFormState(code, s) { /* フォーム初期化時に状態復元済み */ }

function clearTechForm(code) {
  delete techniqueInputState[code];
  renderTechniqueForm(code);
}

// ============================================================
// テストケース生成ロジック
// ============================================================
function generateTestCases(code) {
  const fid = document.getElementById('tech-feature-sel').value;
  const eid = document.getElementById('tech-element-sel').value;
  const feature = fid ? state.features.find(f => f.id === fid) : null;
  const element = (feature && eid) ? feature.elements.find(e => e.id === eid) : null;
  const tid = eid || fid;
  const selectedPerspNos = tid ? (state.perspectives[tid] || []) : [];
  const perspNames = selectedPerspNos.map(n => PERSPECTIVES.find(p => p.no === n)?.name).filter(Boolean).join(', ') || '—';

  let cases = [];

  switch (code) {
    case 'equivalence': cases = genEquivalence(); break;
    case 'boundary':    cases = genBoundary(); break;
    case 'decision':    cases = genDecision(); break;
    case 'allpairs':    cases = genAllPairs(); break;
    case 'orthogonal':  cases = genOrthogonal(); break;
    case 'state':       cases = genState(); break;
    case 'causeeffect': cases = genCauseEffect(); break;
    case 'scenario':    cases = genScenario(); break;
    case 'error':       cases = genError(); break;
    case 'abnormal':    cases = genAbnormal(); break;
    case 'cfd':         cases = genCfd(); break;
  }

  if (!cases.length) { showToast('テストケースを生成できませんでした。入力を確認してください。', 'warn'); return; }

  const techName = TECHNIQUES.find(t => t.code === code)?.name || code;

  // 結果プレビュー表示
  const resultArea = document.getElementById('tech-result-area');
  resultArea.classList.remove('hidden');
  let tableHtml = `
    <div class="result-header">
      <h4>生成結果（${cases.length}件）</h4>
      <button class="btn-primary" onclick="addGeneratedCases(${JSON.stringify(cases).replace(/"/g,'&quot;')}, '${fid}','${eid}','${escHtml(feature?.name||'')}','${escHtml(element?.name||'')}','${perspNames}','${techName}')">
        ＋ テストケースに追加
      </button>
    </div>
    <div class="result-table-wrap">
    <table class="data-table result-table">
      <thead><tr><th>No.</th><th>テスト条件</th><th>テストデータ</th><th>期待結果</th></tr></thead>
      <tbody>
  `;
  cases.forEach((c, i) => {
    tableHtml += `<tr>
      <td>${i+1}</td>
      <td>${escHtml(c.condition)}</td>
      <td>${escHtml(c.data)}</td>
      <td>${escHtml(c.expected)}</td>
    </tr>`;
  });
  tableHtml += '</tbody></table></div>';
  resultArea.innerHTML = tableHtml;
  resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addGeneratedCases(cases, fid, eid, featureName, elementName, perspNames, techName) {
  cases.forEach(c => {
    state.testCases.push({
      id: genId(),
      featureId: fid,
      featureName,
      elementId: eid,
      elementName,
      perspectiveNames: perspNames,
      technique: techName,
      condition: c.condition,
      data: c.data,
      expected: c.expected,
    });
  });
  showToast(`${cases.length}件のテストケースを追加しました`, 'success');
  updateTestCaseCount();
  autoSave();
}

function updateTestCaseCount() {
  const el = document.getElementById('testcase-count');
  if (el) el.textContent = `生成済みテストケース: ${state.testCases.length}件`;
}

// ============================================================
// 各技法の生成アルゴリズム
// ============================================================

// 同値分割
function genEquivalence() {
  const s = techniqueInputState['equivalence'] || {};
  const target = document.getElementById('eq-target')?.value || s.target || '';
  const classes = s.classes || [];
  return classes.map(c => ({
    condition: `[${c.type === 'valid' ? '有効' : '無効'}] ${target ? target + ': ' : ''}${c.name}`,
    data: c.value,
    expected: c.expected || (c.type === 'valid' ? '正常処理' : 'エラー表示'),
  }));
}

// 境界値分析
function genBoundary() {
  const target = document.getElementById('bv-target')?.value || '';
  const type = document.getElementById('bv-type')?.value || 'integer';
  const minVal = document.getElementById('bv-min')?.value || '';
  const maxVal = document.getElementById('bv-max')?.value || '';
  const step = parseFloat(document.getElementById('bv-step')?.value || '1') || 1;
  const desc = document.getElementById('bv-desc')?.value || '';

  if (!minVal || !maxVal) { showToast('最小値と最大値を入力してください', 'warn'); return []; }

  if (type === 'date') {
    return [
      { condition: `${target}: 最小日付の前日（無効）`, data: `${minVal} の前日`, expected: 'エラー表示' },
      { condition: `${target}: 最小日付（有効）`, data: minVal, expected: '正常処理' },
      { condition: `${target}: 最小日付の翌日（有効）`, data: `${minVal} の翌日`, expected: '正常処理' },
      { condition: `${target}: 最大日付の前日（有効）`, data: `${maxVal} の前日`, expected: '正常処理' },
      { condition: `${target}: 最大日付（有効）`, data: maxVal, expected: '正常処理' },
      { condition: `${target}: 最大日付の翌日（無効）`, data: `${maxVal} の翌日`, expected: 'エラー表示' },
    ];
  }

  const min = parseFloat(minVal);
  const max = parseFloat(maxVal);
  if (isNaN(min) || isNaN(max)) { showToast('最小値・最大値は数値で入力してください', 'warn'); return []; }

  const cases = [];
  const label = desc || `${min}以上${max}以下`;

  if (type === 'strlen') {
    cases.push(
      { condition: `${target}: 最小文字数-1（${min-step}文字・無効）`, data: `${'x'.repeat(Math.max(0, min-step))}`, expected: 'エラー表示' },
      { condition: `${target}: 最小文字数（${min}文字・有効）`, data: `${'x'.repeat(min)}`, expected: '正常処理' },
      { condition: `${target}: 最小文字数+1（${min+step}文字・有効）`, data: `${'x'.repeat(min+step)}`, expected: '正常処理' },
    );
    if (max > min + step * 2) {
      const mid = Math.floor((min + max) / 2);
      cases.push({ condition: `${target}: 中間値（${mid}文字・有効）`, data: `${'x'.repeat(mid)}`, expected: '正常処理' });
    }
    cases.push(
      { condition: `${target}: 最大文字数-1（${max-step}文字・有効）`, data: `${'x'.repeat(max-step)}`, expected: '正常処理' },
      { condition: `${target}: 最大文字数（${max}文字・有効）`, data: `${'x'.repeat(max)}`, expected: '正常処理' },
      { condition: `${target}: 最大文字数+1（${max+step}文字・無効）`, data: `${'x'.repeat(max+step)}`, expected: 'エラー表示' },
    );
  } else {
    const fmt = v => type === 'decimal' ? v.toFixed(String(step).split('.')[1]?.length || 1) : String(Math.round(v));
    cases.push(
      { condition: `${target}: 下限値-${step}（${fmt(min-step)}・無効）`, data: fmt(min-step), expected: 'エラー表示' },
      { condition: `${target}: 下限値（${fmt(min)}・有効）`, data: fmt(min), expected: '正常処理' },
      { condition: `${target}: 下限値+${step}（${fmt(min+step)}・有効）`, data: fmt(min+step), expected: '正常処理' },
    );
    if (max > min + step * 3) {
      const mid = type === 'decimal' ? (min + max) / 2 : Math.floor((min + max) / 2);
      cases.push({ condition: `${target}: 中間値（${fmt(mid)}・有効）`, data: fmt(mid), expected: '正常処理' });
    }
    cases.push(
      { condition: `${target}: 上限値-${step}（${fmt(max-step)}・有効）`, data: fmt(max-step), expected: '正常処理' },
      { condition: `${target}: 上限値（${fmt(max)}・有効）`, data: fmt(max), expected: '正常処理' },
      { condition: `${target}: 上限値+${step}（${fmt(max+step)}・無効）`, data: fmt(max+step), expected: 'エラー表示' },
    );
  }
  return cases;
}

// デシジョンテーブル
function genDecision() {
  const s = techniqueInputState['decision'] || {};
  const conditions = s.conditions || [];
  const actions = s.actions || [];
  if (!conditions.length) { showToast('条件を入力してください', 'warn'); return []; }

  // 全組み合わせ生成
  const allValueArrays = conditions.map(c => c.values.split(',').map(v => v.trim()));
  const combos = cartesian(allValueArrays);

  return combos.map((combo, i) => {
    const condStr = conditions.map((c, j) => `${c.name}=${combo[j]}`).join(', ');
    const actionStr = actions.map(a => a.name).join(', ') || '（アクションを記入）';
    return {
      condition: `ルール${i+1}: ${condStr}`,
      data: combo.join(' / '),
      expected: actionStr + ' — （該当するアクションに○を記入してください）',
    };
  });
}

// 直積（全組み合わせ）ヘルパー
function cartesian(arrays) {
  return arrays.reduce((acc, arr) => acc.flatMap(a => arr.map(v => [...a, v])), [[]]);
}

// All-Pairs法
function genAllPairs() {
  const s = techniqueInputState['allpairs'] || {};
  const rawFactors = s.factors || [];
  const factors = rawFactors.map(f => ({
    name: f.name,
    levels: f.levels.split(',').map(v => v.trim()).filter(Boolean),
  })).filter(f => f.levels.length > 0);
  if (factors.length < 2) { showToast('因子を2つ以上入力してください', 'warn'); return []; }

  const testCases = computeAllPairs(factors);
  return testCases.map((tc, i) => ({
    condition: `テストケース${i+1}`,
    data: tc.map((lv, j) => `${factors[j].name}=${lv}`).join(', '),
    expected: '正常処理（各組み合わせの期待結果を記入）',
  }));
}

function computeAllPairs(factors) {
  const n = factors.length;
  const uncovered = new Set();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const li of factors[i].levels) {
        for (const lj of factors[j].levels) {
          uncovered.add(`${i}:${li}__${j}:${lj}`);
        }
      }
    }
  }

  const testCases = [];
  let safety = 0;
  while (uncovered.size > 0 && safety++ < 1000) {
    const tc = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      let best = factors[i].levels[0];
      let bestScore = -1;
      for (const level of factors[i].levels) {
        let score = 0;
        for (let j = 0; j < i; j++) {
          if (uncovered.has(`${j}:${tc[j]}__${i}:${level}`)) score++;
        }
        if (score > bestScore) { bestScore = score; best = level; }
      }
      tc[i] = best;
    }
    let covered = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i}:${tc[i]}__${j}:${tc[j]}`;
        if (uncovered.has(key)) { uncovered.delete(key); covered++; }
      }
    }
    if (covered === 0) break;
    testCases.push(tc);
  }
  return testCases;
}

// 直交法
function genOrthogonal() {
  const s = techniqueInputState['orthogonal'] || {};
  const rawFactors = s.factors || [];
  const factors = rawFactors.map(f => ({
    name: f.name,
    levels: f.levels.split(',').map(v => v.trim()).filter(Boolean),
  })).filter(f => f.levels.length > 0);
  if (factors.length < 2) { showToast('因子を2つ以上入力してください', 'warn'); return []; }

  // 全因子の水準数を確認
  const levelCounts = factors.map(f => f.levels.length);
  const allSameLevel = levelCounts.every(l => l === levelCounts[0]);

  let array = null;
  let arrayName = '';

  if (allSameLevel && levelCounts[0] === 2) {
    // 2水準直交表を選択
    if (factors.length <= 3) { array = ORTHOGONAL_ARRAYS.L4; arrayName = 'L4'; }
    else if (factors.length <= 7) { array = ORTHOGONAL_ARRAYS.L8; arrayName = 'L8'; }
    else if (factors.length <= 11) { array = ORTHOGONAL_ARRAYS.L12; arrayName = 'L12'; }
    else if (factors.length <= 15) { array = ORTHOGONAL_ARRAYS.L16; arrayName = 'L16'; }
  } else if (allSameLevel && levelCounts[0] === 3) {
    if (factors.length <= 4) { array = ORTHOGONAL_ARRAYS.L9; arrayName = 'L9'; }
  }

  if (!array) {
    showToast('適切な直交表が見つかりませんでした。All-Pairs法をお試しください。', 'warn');
    return [];
  }

  const usedCols = array.array[0].length >= factors.length ? factors.length : array.array[0].length;
  return array.array.map((row, i) => ({
    condition: `${arrayName} テストケース${i+1}`,
    data: factors.slice(0, usedCols).map((f, j) => `${f.name}=${f.levels[row[j]] || row[j]}`).join(', '),
    expected: '正常処理（各テストケースの期待結果を記入）',
  }));
}

// 状態遷移テスト
function genState() {
  const s = techniqueInputState['state'] || {};
  const states = s.states || [];
  const events = s.events || [];
  const transitions = s.transitions || {};
  if (!states.length || !events.length) { showToast('状態とイベントを入力してください', 'warn'); return []; }

  const cases = [];
  // 有効遷移（次状態が入力されているもの）
  states.forEach(st => {
    events.forEach(ev => {
      const key = `${st}__${ev}`;
      const next = (transitions[key] || '').trim();
      if (next && next !== '-') {
        cases.push({
          condition: `現在状態: ${st}、イベント: ${ev}`,
          data: `状態=${st}、イベント=${ev} を発生させる`,
          expected: `状態が ${next} に遷移すること`,
        });
      }
    });
  });
  // 無効遷移（"-" または未入力）
  states.forEach(st => {
    events.forEach(ev => {
      const key = `${st}__${ev}`;
      const next = (transitions[key] || '').trim();
      if (!next || next === '-') {
        cases.push({
          condition: `[無効遷移] 現在状態: ${st}、イベント: ${ev}`,
          data: `状態=${st}、イベント=${ev} を発生させる`,
          expected: `遷移が発生しないこと（エラーまたは無反応）`,
        });
      }
    });
  });
  return cases;
}

// 原因結果グラフ
function genCauseEffect() {
  const s = techniqueInputState['causeeffect'] || {};
  const causes = s.causes || [];
  const effects = s.effects || [];
  const rules = s.rules || [];
  if (!rules.length) { showToast('ルールを入力してください', 'warn'); return []; }

  return rules.map((rule, i) => {
    const cause = causes.find(c => c.id === rule.causeId);
    const effect = effects.find(e => e.id === rule.effectId);
    const causeLabel = `${cause?.name || '?'} が${rule.causeVal === 'true' ? '成立' : '不成立'}`;
    const effectLabel = `${effect?.name || '?'} が${rule.effectVal === 'true' ? '発生' : '発生しない'}`;
    return {
      condition: `ルール${i+1}: ${causeLabel}`,
      data: causeLabel,
      expected: effectLabel,
    };
  });
}

// シナリオテスト
function genScenario() {
  const s = techniqueInputState['scenario'] || {};
  const name = document.getElementById('sc-name')?.value || s.name || '';
  const precond = document.getElementById('sc-precond')?.value || s.precondition || '';
  const steps = s.steps || [];
  if (!steps.length) { showToast('手順を入力してください', 'warn'); return []; }

  return steps.map((step, i) => ({
    condition: `[${name}] Step${i+1}${precond ? ' / 前提: ' + precond : ''}`,
    data: step.action,
    expected: step.expected,
  }));
}

// エラー推測
function genError() {
  const s = techniqueInputState['error'] || {};
  const target = document.getElementById('err-target')?.value || s.target || '';
  const selectedIds = s.selectedIds || [];
  if (!selectedIds.length) { showToast('エラーパターンを選択してください', 'warn'); return []; }

  return selectedIds.map(id => {
    const pattern = ERROR_CATEGORIES.find(e => e.id === id);
    if (!pattern) return null;
    return {
      condition: `[${pattern.cat}] ${pattern.label}`,
      data: pattern.template.replace('{target}', target || 'テスト対象'),
      expected: pattern.expected,
    };
  }).filter(Boolean);
}

// 異常値・特異値分析
function genAbnormal() {
  const s = techniqueInputState['abnormal'] || {};
  const fields = s.fields || [];
  if (!fields.length) { showToast('フィールドを入力してください', 'warn'); return []; }

  const cases = [];
  fields.forEach(f => {
    const patterns = ABNORMAL_PATTERNS[f.type] || ABNORMAL_PATTERNS['string'];
    patterns.forEach(p => {
      cases.push({
        condition: `[${f.name}] 異常値テスト`,
        data: `${f.name} = ${p}`,
        expected: 'エラー表示または適切なハンドリング（正常処理でないことを確認）',
      });
    });
  });
  return cases;
}

// CFD法
function genCfd() {
  const s = techniqueInputState['cfd'] || {};
  const steps = s.steps || [];
  if (!steps.length) { showToast('処理ステップを入力してください', 'warn'); return []; }

  const cases = [];
  // 正常フロー（全ステップ順に実行）
  cases.push({
    condition: '正常フロー: 全ステップを順に実行',
    data: steps.map((st, i) => `Step${i+1}: ${st.name}`).join(' → '),
    expected: '全ての処理が正常に完了すること',
  });
  // 条件分岐があるステップについてテストケースを追加
  steps.forEach((step, i) => {
    if (step.condition) {
      cases.push({
        condition: `条件分岐: Step${i+1} (${step.name}) の条件が成立する場合`,
        data: `Step${i+1} 実行時: ${step.condition}`,
        expected: step.branch ? `${step.branch} へ分岐すること` : '分岐処理が正常に実行されること',
      });
      cases.push({
        condition: `条件分岐: Step${i+1} (${step.name}) の条件が不成立の場合`,
        data: `Step${i+1} 実行時: ${step.condition} が不成立`,
        expected: '通常フローが継続されること',
      });
    }
  });
  return cases;
}

// ============================================================
// ④ 出力
// ============================================================
function updateAllSelectors() {
  // 観点タブのセレクター更新
  updateSelector('persp-feature-sel', true);
  // 技法タブのセレクター更新
  updateSelector('tech-feature-sel', true);
}

function updateSelector(selId, hasPlaceholder) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const curVal = sel.value;
  sel.innerHTML = hasPlaceholder ? '<option value="">-- 機能を選択 --</option>' : '';
  state.features.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if (curVal) sel.value = curVal;
}

function updateExportFilters() {
  const featureSel = document.getElementById('export-feature-filter');
  const techSel = document.getElementById('export-technique-filter');
  if (!featureSel || !techSel) return;

  const curFeature = featureSel.value;
  const curTech = techSel.value;

  featureSel.innerHTML = '<option value="">全て</option>';
  const featureNames = [...new Set(state.testCases.map(tc => tc.featureName).filter(Boolean))];
  featureNames.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    featureSel.appendChild(opt);
  });

  techSel.innerHTML = '<option value="">全て</option>';
  const techNames = [...new Set(state.testCases.map(tc => tc.technique).filter(Boolean))];
  techNames.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    techSel.appendChild(opt);
  });

  if (curFeature) featureSel.value = curFeature;
  if (curTech) techSel.value = curTech;
}

function renderExportTable() {
  const featureFilter = document.getElementById('export-feature-filter')?.value || '';
  const techFilter = document.getElementById('export-technique-filter')?.value || '';

  let filtered = state.testCases.filter(tc =>
    (!featureFilter || tc.featureName === featureFilter) &&
    (!techFilter || tc.technique === techFilter)
  );

  document.getElementById('export-count').textContent = `${filtered.length}件`;

  const tbody = document.getElementById('export-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">テストケースがありません</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((tc, i) => `
    <tr>
      <td class="tc-no">${i+1}</td>
      <td>${escHtml(tc.featureName || '')}</td>
      <td>${escHtml(tc.elementName || '')}</td>
      <td>${escHtml(tc.perspectiveNames || '')}</td>
      <td><span class="tech-badge">${escHtml(tc.technique || '')}</span></td>
      <td>${escHtml(tc.condition || '')}</td>
      <td>${escHtml(tc.data || '')}</td>
      <td>${escHtml(tc.expected || '')}</td>
      <td><button class="btn-icon-sm danger" onclick="deleteTestCase('${tc.id}')">🗑</button></td>
    </tr>
  `).join('');
}

function deleteTestCase(id) {
  state.testCases = state.testCases.filter(tc => tc.id !== id);
  renderExportTable();
  updateTestCaseCount();
  autoSave();
}

function clearAllTestCases() {
  if (!confirm('全てのテストケースを削除しますか？')) return;
  state.testCases = [];
  renderExportTable();
  updateTestCaseCount();
  autoSave();
}

// ============================================================
// Excel出力
// ============================================================
async function exportToExcel() {
  if (!state.testCases.length) { showToast('テストケースがありません', 'warn'); return; }

  const wb = XLSX.utils.book_new();

  // 機能ごとにシートを作成
  const featureGroups = {};
  state.testCases.forEach(tc => {
    const key = tc.featureName || '未分類';
    if (!featureGroups[key]) featureGroups[key] = [];
    featureGroups[key].push(tc);
  });

  Object.entries(featureGroups).forEach(([featureName, cases]) => {
    const headers = ['No.', '機能', '要素', 'テスト観点', 'テスト技法', 'テスト条件', 'テストデータ', '期待結果', '合否'];
    const rows = cases.map((tc, i) => [
      i + 1,
      tc.featureName || '',
      tc.elementName || '',
      tc.perspectiveNames || '',
      tc.technique || '',
      tc.condition || '',
      tc.data || '',
      tc.expected || '',
      '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 列幅設定
    ws['!cols'] = [
      { wch: 5 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
      { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 8 },
    ];

    // ヘッダースタイル
    const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'center' } };
    headers.forEach((_, i) => {
      const cell = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[cell]) ws[cell].s = headerStyle;
    });

    const sheetName = featureName.substring(0, 30);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // 全テストケースシート（サマリー）
  if (Object.keys(featureGroups).length > 1) {
    const headers = ['No.', '機能', '要素', 'テスト観点', 'テスト技法', 'テスト条件', 'テストデータ', '期待結果', '合否'];
    const allRows = state.testCases.map((tc, i) => [
      i + 1, tc.featureName || '', tc.elementName || '', tc.perspectiveNames || '',
      tc.technique || '', tc.condition || '', tc.data || '', tc.expected || '', '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...allRows]);
    ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, '全テストケース');
  }

  // バイナリ書き出し
  const wbout = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const result = await ipcRenderer.invoke('save-excel', { buffer: wbout, filename: `テストケース_${today}.xlsx` });

  if (result.success) {
    showToast(`Excelファイルを保存しました:\n${result.path}`, 'success');
  } else if (result.error) {
    showToast(`保存エラー: ${result.error}`, 'error');
  }
}

// ============================================================
// 状態の保存・読込
// ============================================================
async function saveState() {
  const result = await ipcRenderer.invoke('save-state', { state });
  showToast(result.success ? '状態を保存しました' : '保存に失敗しました', result.success ? 'success' : 'error');
}

async function loadState() {
  const result = await ipcRenderer.invoke('load-state');
  if (result.success && result.state) {
    state = result.state;
    let maxId = 0;
    state.features.forEach(f => {
      const n = parseInt(f.id.replace('id_', '')) || 0;
      if (n > maxId) maxId = n;
    });
    nextId = maxId + 1;
    renderFeatureList();
    updateAllSelectors();
    updateDecomposeSummary();
    updateTestCaseCount();
    renderExportTable();
    showToast('状態を読み込みました', 'success');
  } else {
    showToast('保存済みデータが見つかりません', 'warn');
  }
}

function autoSave() {
  ipcRenderer.invoke('save-state', { state });
}

// ============================================================
// モーダル
// ============================================================
let modalCallback = null;

function showModal(title, body, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  modalCallback = onSave;
  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('modal-save-btn').onclick = () => {
    if (modalCallback && modalCallback() !== false) closeModal();
  };
  const firstInput = document.querySelector('#modal-body input, #modal-body textarea');
  if (firstInput) firstInput.focus();
}

function closeModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  modalCallback = null;
}

// ============================================================
// トースト通知
// ============================================================
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ============================================================
// ユーティリティ
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
