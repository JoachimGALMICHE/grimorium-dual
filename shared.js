/* ============================================================
   GRIMORIUM DUAL — logique partagée entre les 3 documents
   (index.html, divination.html, invocation.html)
   ============================================================ */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBR6hpsvz7es1mM3ki_fqFcnT85pbdL8VM",
  authDomain: "grimorium-dual.firebaseapp.com",
  projectId: "grimorium-dual",
  storageBucket: "grimorium-dual.firebasestorage.app",
  messagingSenderId: "937030752177",
  appId: "1:937030752177:web:8ecb5d724545418899cf90"
};

function escapeHtml(str){
  if(str===undefined || str===null) return '';
  return String(str).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

/* ---------- Stockage : Claude par défaut, Firebase optionnel ---------- */
let firebaseDb = null;
let firebaseReady = false;
let lastFirebaseErrorCode = null;

function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function loadScriptWithFallback(sources){
  let lastErr = null;
  for(const src of sources){
    try{ await loadScript(src); return true; }
    catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('Aucune source de script disponible');
}

async function initFirebaseFromConfig(config){
  try{
    if(!window.firebase){
      // gstatic.com (CDN officiel Firebase/Google) en priorité — cdnjs seulement en repli,
      // car certains navigateurs (protection anti-pistage) bloquent l'accès au stockage pour cdnjs.
      await loadScriptWithFallback([
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
        'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-app-compat.min.js'
      ]);
      await loadScriptWithFallback([
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
        'https://cdnjs.cloudflare.com/ajax/libs/firebase/10.12.2/firebase-firestore-compat.min.js'
      ]);
    }
    if(!firebase.apps.length){ firebase.initializeApp(config); }
    firebaseDb = firebase.firestore();
    // Le SDK détecte déjà automatiquement s'il faut basculer en long polling
    // (streaming WebChannel bloqué) — aucun réglage manuel n'est nécessaire ici.
    firebaseReady = true;
    return true;
  }catch(e){
    // Repli sur le stockage Claude si Firebase est indisponible (réseau, CDN bloqué…)
    firebaseReady = false;
    lastFirebaseErrorCode = (e && (e.code || e.message)) || 'init-failed';
    console.error('[Grimorium Dual] Échec de chargement/initialisation Firebase :', e);
    return false;
  }
}

function hasClaudeStorage(){
  return typeof window.storage !== 'undefined' && window.storage !== null;
}

const CONNECTIVITY_CODES = ['unavailable','permission-denied','unauthenticated','not-found','failed-precondition','resource-exhausted'];
function recordFirebaseError(e, context){
  const code = e && e.code ? e.code : 'unknown';
  const message = e && e.message ? e.message : String(e);
  lastFirebaseErrorCode = code + (message ? ' — ' + message : '');
  console.error('[Grimorium Dual] Firestore ' + context + ' a échoué :', e);
  // On ne coupe Firestore que pour de vraies pannes de connexion/permission,
  // pas pour une erreur liée aux données d'une seule fiche (invalid-argument…)
  if(CONNECTIVITY_CODES.includes(code)){
    firebaseReady = false;
    updateSyncBadge();
  }
}

/* Chargement d'une liste entière (Firestore : une collection ; Claude : un tableau JSON dans une clé) */
async function loadList(collectionName, claudeKey){
  if(firebaseReady){
    try{
      const snap = await firebaseDb.collection(collectionName).get({source:'server'});
      const arr = [];
      snap.forEach(doc=>arr.push(doc.data()));
      return arr;
    }catch(e){
      lastFirebaseErrorCode = e && (e.code || e.message);
      firebaseReady = false;
      updateSyncBadge();
    }
  }
  if(hasClaudeStorage()){
    try{
      const r = await window.storage.get(claudeKey, false);
      return r ? JSON.parse(r.value) : [];
    }catch(e){ return []; }
  }
  return [];
}

/* Sauvegarde d'un seul élément : un document Firestore par fiche (évite la limite de ~1 Mo par document) */
async function saveItem(collectionName, claudeKey, list, item){
  if(firebaseReady){
    try{ await firebaseDb.collection(collectionName).doc(item.id).set(item); return 'firebase'; }
    catch(e){ recordFirebaseError(e, 'set'); }
  }
  if(hasClaudeStorage()){
    try{ await window.storage.set(claudeKey, JSON.stringify(list), false); return 'claude'; }
    catch(e){ /* échec aussi côté Claude */ }
  }
  return null;
}
async function deleteItem(collectionName, claudeKey, list, id){
  if(firebaseReady){
    try{ await firebaseDb.collection(collectionName).doc(id).delete(); return 'firebase'; }
    catch(e){ recordFirebaseError(e, 'delete'); }
  }
  if(hasClaudeStorage()){
    try{ await window.storage.set(claudeKey, JSON.stringify(list), false); return 'claude'; }
    catch(e){ /* échec aussi côté Claude */ }
  }
  return null;
}

function saveResultMessage(result, verb){
  if(result==='firebase') return { msg: verb + ' ✓ (synchronisé sur tous tes appareils)', err:false };
  if(result==='claude') return { msg: verb + ' ✓ (sauvegardé sur ce compte Claude, pas de sync Firebase)', err:false };
  const code = lastFirebaseErrorCode ? ` [${lastFirebaseErrorCode}]` : '';
  return { msg: `Échec de la sauvegarde${code} — note ce code et dis-le à Claude`, err:true };
}

/* ---------- Indicateur de synchronisation & messages ---------- */
function updateSyncBadge(){
  const el = document.getElementById('sync-badge');
  if(!el) return;
  if(firebaseReady){
    el.textContent = '☁ Synchronisé (Firebase)';
    el.className = 'sync-badge ok';
  }else if(hasClaudeStorage()){
    el.textContent = '🔒 Sauvegardé sur ce compte Claude uniquement';
    el.className = 'sync-badge warn';
  }else{
    const detail = lastFirebaseErrorCode ? ` (${lastFirebaseErrorCode})` : '';
    el.textContent = `⚠ Aucune sauvegarde active${detail}`;
    el.className = 'sync-badge err';
  }
}
function showToast(msg, isError){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' err' : '');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ el.className = 'toast'; }, 2600);
}

/* ---------- Ciel étoilé ---------- */
function initStarfield(){
  const container = document.getElementById('starfield');
  if(!container) return;
  const colors = ['#ffffff','#ffffff','#fdf3d0','#fdf3d0','#cfe0ff'];
  const count = 160;
  let html = '';
  for(let i=0;i<count;i++){
    const size = (Math.random()*2 + 0.6).toFixed(2);
    const isBig = Math.random() < 0.08;
    const finalSize = isBig ? (size*1.9).toFixed(2) : size;
    const color = colors[Math.floor(Math.random()*colors.length)];
    const top = (Math.random()*100).toFixed(2);
    const left = (Math.random()*100).toFixed(2);
    const duration = (Math.random()*3 + 2).toFixed(2);
    const delay = (Math.random()*5).toFixed(2);
    const minOp = (Math.random()*0.3 + 0.15).toFixed(2);
    const glow = isBig ? `0 0 ${finalSize*3}px ${color}` : `0 0 ${finalSize*1.5}px ${color}`;
    html += `<div class="star" style="top:${top}%; left:${left}%; width:${finalSize}px; height:${finalSize}px; background:${color}; box-shadow:${glow}; animation-duration:${duration}s; animation-delay:${delay}s; --min-op:${minOp};"></div>`;
  }
  container.innerHTML = html;
}
