/* ================= ثابت‌ها ================= */
const RANKS = [
  { key:'new_member', label:'عضو جدید' },
  { key:'member', label:'عضو' },
  { key:'veteran', label:'کهنه‌سرباز' },
  { key:'officer', label:'افسر' },
  { key:'commander', label:'فرمانده' },
  { key:'designer', label:'طراح سایت' },
  { key:'leader', label:'رهبر' }
];
const GAMES = [
  { key:'minecraft', label:'ماینکرفت' },
  { key:'cod', label:'کالاف‌آف‌دیوتی' },
  { key:'both', label:'هر دو' }
];
const DEFAULT_ADMIN_PASSWORD = 'killzone2026';
const SESSION_KEY = 'kz_session';

function rankLabel(key){ const r = RANKS.find(x=>x.key===key); return r ? r.label : key; }
function gameLabel(key){ const g = GAMES.find(x=>x.key===key); return g ? g.label : key; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function initials(name){ return (name||'?').trim().slice(0,2).toUpperCase(); }

async function hashPass(pw){
  try{
    const enc = new TextEncoder().encode(pw);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(e){
    let h = 0;
    for(let i=0;i<pw.length;i++){ h = ((h<<5)-h)+pw.charCodeAt(i); h|=0; }
    return 'fallback-'+h;
  }
}

/* ================= Session (فقط برای نگه‌داشتن ورود بین صفحات) ================= */
let currentUser = null;
function saveSession(acc){ localStorage.setItem(SESSION_KEY, JSON.stringify({ id: acc.id })); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }
function getSessionId(){
  try{ const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw).id : null; }
  catch(e){ return null; }
}
async function initSession(){
  const id = getSessionId();
  if(!id) return;
  const { data, error } = await sb.from('accounts').select('*').eq('id', id).maybeSingle();
  if(!error && data) currentUser = data; else clearSession();
}

/* ================= دیتابیس ================= */
async function ensureSeedAccounts(){
  const { count, error } = await sb.from('accounts').select('*', { count:'exact', head:true });
  if(error){ console.error(error); return; }
  if(count === 0){
    const hp = await hashPass(DEFAULT_ADMIN_PASSWORD);
    await sb.from('accounts').insert([
      { id:'seed-1', username:'1Y2U3I', pass_hash:hp, rank:'leader', game:'both', photo:'', is_admin:true },
      { id:'seed-2', username:'TheROMZ52', pass_hash:hp, rank:'designer', game:'both', photo:'', is_admin:true }
    ]);
  }
}
async function fetchAccounts(){
  const { data, error } = await sb.from('accounts').select('*').order('username');
  if(error){ console.error(error); return []; }
  return data;
}
async function loginUser(username, password){
  const { data, error } = await sb.from('accounts').select('*').ilike('username', username).maybeSingle();
  if(error || !data) return { ok:false, msg:'همچین اکانتی پیدا نشد.' };
  const ph = await hashPass(password);
  if(ph !== data.pass_hash) return { ok:false, msg:'رمز اشتباهه.' };
  return { ok:true, account:data };
}
async function registerUser(username, password, game){
  const { data: existing } = await sb.from('accounts').select('id').ilike('username', username).maybeSingle();
  if(existing) return { ok:false, msg:'این نام‌کاربری قبلاً گرفته شده.' };
  const acc = {
    id: 'm-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
    username, pass_hash: await hashPass(password),
    rank:'new_member', game, photo:'', is_admin:false
  };
  const { error } = await sb.from('accounts').insert([acc]);
  if(error){ console.error(error); return { ok:false, msg:'خطا در ثبت‌نام. دوباره تلاش کن.' }; }
  return { ok:true, account:acc };
}

/* ================= هدر / ورود ================= */
function renderUserBox(){
  const box = document.getElementById('userBox');
  if(!box) return;
  if(currentUser){
    box.innerHTML = `
      <div class="user-chip">
        <span>${escapeHtml(currentUser.username)}</span>
        <span class="rk">${escapeHtml(rankLabel(currentUser.rank))}</span>
      </div>
      ${currentUser.is_admin ? '<span class="admin-btn on">🛠 حالت مدیریت فعاله</span>' : ''}
      <button class="link-btn" id="logoutBtn">خروج</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', ()=>{
      currentUser = null;
      clearSession();
      renderUserBox();
      if(document.getElementById('memberGrid')) renderMembersPage();
    });
  }else{
    box.innerHTML = `<button class="link-btn" id="loginOpenBtn">🔒 ورود</button>`;
    document.getElementById('loginOpenBtn').addEventListener('click', ()=>{
      const msg = document.getElementById('loginMsg');
      if(msg) msg.innerHTML = '';
      document.getElementById('loginOverlay').classList.add('show');
    });
  }
}

function wireLoginModal(){
  const overlay = document.getElementById('loginOverlay');
  if(!overlay) return;
  document.getElementById('loginClose').addEventListener('click', ()=>overlay.classList.remove('show'));
  document.getElementById('loginSubmit').addEventListener('click', async ()=>{
    const username = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value;
    const msg = document.getElementById('loginMsg');
    if(!username || !pass){ msg.innerHTML = '<div class="form-msg err">یوزرنیم و رمز رو وارد کن.</div>'; return; }
    const res = await loginUser(username, pass);
    if(!res.ok){ msg.innerHTML = `<div class="form-msg err">${escapeHtml(res.msg)}</div>`; return; }
    currentUser = res.account;
    saveSession(res.account);
    overlay.classList.remove('show');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    renderUserBox();
    if(document.getElementById('memberGrid')) renderMembersPage();
  });
}

/* ================= صفحه اعضا ================= */
async function renderMembersPage(){
  const grid = document.getElementById('memberGrid');
  if(!grid) return;
  grid.innerHTML = '<div class="loading-note">در حال بارگذاری...</div>';
  const accounts = await fetchAccounts();
  grid.innerHTML = '';
  if(accounts.length === 0){
    grid.innerHTML = '<div class="empty-note">هنوز عضوی ثبت‌نام نکرده.</div>';
  }
  accounts.forEach(m=>{
    const card = document.createElement('div');
    card.className = 'member-card hud';
    card.innerHTML = `
      <div class="c2"></div>
      ${m.photo ? `<img class="avatar" src="${escapeHtml(m.photo)}" alt="${escapeHtml(m.username)}" onerror="this.outerHTML='<div class=avatar>${initials(m.username)}</div>'">`
                : `<div class="avatar">${initials(m.username)}</div>`}
      <h4>${escapeHtml(m.username)}</h4>
      <div class="rank-badge ${m.is_admin ? 'admin' : ''}">${escapeHtml(rankLabel(m.rank))}${m.is_admin ? ' · ادمین' : ''}</div>
      <div class="game-tag">${escapeHtml(gameLabel(m.game))}</div>
      ${currentUser && currentUser.is_admin ? `<div class="member-actions">
        <button class="icon-btn edit" data-id="${m.id}">✎</button>
        <button class="icon-btn del" data-id="${m.id}">✕</button>
      </div>` : ''}
    `;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.icon-btn.edit').forEach(b=>b.addEventListener('click', ()=>openMemberModal(b.dataset.id, accounts)));
  grid.querySelectorAll('.icon-btn.del').forEach(b=>b.addEventListener('click', ()=>deleteMember(b.dataset.id)));

  const addBtn = document.getElementById('addMemberBtn');
  if(addBtn) addBtn.style.display = (currentUser && currentUser.is_admin) ? 'inline-block' : 'none';
}

async function deleteMember(id){
  if(!currentUser || !currentUser.is_admin) return;
  if(id === currentUser.id){ alert('نمی‌تونی اکانت خودت رو حذف کنی.'); return; }
  if(!confirm('این عضو حذف بشه؟')) return;
  const { error } = await sb.from('accounts').delete().eq('id', id);
  if(error) console.error(error);
  renderMembersPage();
}

let editingId = null;
function openMemberModal(id, accountsCache){
  editingId = id;
  const msg = document.getElementById('memberMsg');
  if(msg) msg.innerHTML = '';
  document.getElementById('mNewPass').value = '';
  if(id){
    const m = (accountsCache || []).find(x=>x.id===id);
    document.getElementById('memberModalTitle').textContent = 'ویرایش عضو';
    document.getElementById('mName').value = m?.username || '';
    document.getElementById('mPhoto').value = m?.photo || '';
    document.getElementById('mRank').value = m?.rank || 'new_member';
    document.getElementById('mGame').value = m?.game || 'minecraft';
    document.getElementById('mIsAdmin').checked = !!m?.is_admin;
    document.getElementById('mIsAdmin').disabled = (id === currentUser?.id);
  }else{
    document.getElementById('memberModalTitle').textContent = 'افزودن عضو دستی';
    document.getElementById('mName').value = '';
    document.getElementById('mPhoto').value = '';
    document.getElementById('mRank').value = 'new_member';
    document.getElementById('mGame').value = 'minecraft';
    document.getElementById('mIsAdmin').checked = false;
    document.getElementById('mIsAdmin').disabled = false;
  }
  document.getElementById('memberOverlay').classList.add('show');
}

function wireMemberModal(){
  const overlay = document.getElementById('memberOverlay');
  if(!overlay) return;
  document.getElementById('memberClose').addEventListener('click', ()=>overlay.classList.remove('show'));
  const addBtn = document.getElementById('addMemberBtn');
  if(addBtn) addBtn.addEventListener('click', ()=>openMemberModal(null, []));

  document.getElementById('memberSave').addEventListener('click', async ()=>{
    const username = document.getElementById('mName').value.trim();
    const msg = document.getElementById('memberMsg');
    if(!username){ msg.innerHTML = '<div class="form-msg err">نام‌کاربری رو وارد کن.</div>'; return; }

    const { data: dup } = await sb.from('accounts').select('id').ilike('username', username).neq('id', editingId || '___none___').maybeSingle();
    if(dup){ msg.innerHTML = '<div class="form-msg err">این نام‌کاربری قبلاً استفاده شده.</div>'; return; }

    const data = {
      username,
      photo: document.getElementById('mPhoto').value.trim(),
      rank: document.getElementById('mRank').value,
      game: document.getElementById('mGame').value,
      is_admin: document.getElementById('mIsAdmin').checked
    };
    const newPass = document.getElementById('mNewPass').value;

    if(editingId){
      if(newPass && newPass.length>=4){ data.pass_hash = await hashPass(newPass); }
      const { error } = await sb.from('accounts').update(data).eq('id', editingId);
      if(error){ msg.innerHTML = '<div class="form-msg err">خطا در ذخیره.</div>'; console.error(error); return; }
      if(currentUser && editingId===currentUser.id){
        currentUser = { ...currentUser, ...data };
        saveSession(currentUser);
        renderUserBox();
      }
    }else{
      const newAcc = {
        id: 'm-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),
        pass_hash: await hashPass(newPass && newPass.length>=4 ? newPass : Math.random().toString(36).slice(2,10)),
        ...data
      };
      const { error } = await sb.from('accounts').insert([newAcc]);
      if(error){ msg.innerHTML = '<div class="form-msg err">خطا در ذخیره.</div>'; console.error(error); return; }
    }

    overlay.classList.remove('show');
    renderMembersPage();
  });
}

/* ================= صفحه ثبت‌نام ================= */
function wireRegisterForm(){
  const form = document.getElementById('regForm');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const username = document.getElementById('regName').value.trim();
    const pass = document.getElementById('regPass').value;
    const pass2 = document.getElementById('regPass2').value;
    const game = document.getElementById('regGame').value;
    const msg = document.getElementById('regMsg');

    if(!username || username.length<3){ msg.innerHTML = '<div class="form-msg err">نام‌کاربری باید حداقل ۳ کاراکتر باشه.</div>'; return; }
    if(pass.length<4){ msg.innerHTML = '<div class="form-msg err">رمز باید حداقل ۴ کاراکتر باشه.</div>'; return; }
    if(pass !== pass2){ msg.innerHTML = '<div class="form-msg err">تکرار رمز مطابقت نداره.</div>'; return; }

    const res = await registerUser(username, pass, game);
    if(!res.ok){ msg.innerHTML = `<div class="form-msg err">${escapeHtml(res.msg)}</div>`; return; }

    currentUser = res.account;
    saveSession(res.account);
    form.reset();
    msg.innerHTML = '<div class="form-msg ok">اکانتت ساخته شد و وارد شدی! رنکت رو مدیریت تیم بعداً ارتقا می‌ده. ✔</div>';
    renderUserBox();
    setTimeout(()=>{ window.location.href = 'members.html'; }, 900);
  });
}

/* ================= خانه: آمار ================= */
async function renderHomeStats(){
  const el = document.getElementById('statMembers');
  if(!el) return;
  const accounts = await fetchAccounts();
  el.textContent = accounts.length;
}

/* ================= شروع هر صفحه ================= */
async function initPage(){
  await ensureSeedAccounts();
  await initSession();
  renderUserBox();
  wireLoginModal();
  wireMemberModal();
  wireRegisterForm();
  if(document.getElementById('memberGrid')) renderMembersPage();
  if(document.getElementById('statMembers')) renderHomeStats();
}
document.addEventListener('DOMContentLoaded', initPage);
