/* ===================================================================
   Swelli — shared data layer (localStorage-based)

   This is a pilot-ready, zero-backend data layer: every check-in and
   activity a student does is saved on THEIR device, so streaks/entries
   are real and persist across days. It does NOT sync across devices —
   that needs a real backend (e.g. routing through your existing Apps
   Script / Sheets setup), which is the natural next step once this
   pilot validates the flow.
=================================================================== */

const Swelli = (() => {

  const SESSION_KEY = 'swelli:session';
  const entriesKey = (studentId) => `swelli:entries:${studentId}`;

  // Auto-inject Iconify web-component script so every page gets Fluent Emoji
  // without needing a <script> tag in each HTML file.
  (function(){
    if(typeof customElements !== 'undefined' && !customElements.get('iconify-icon')){
      const s = document.createElement('script');
      s.src = 'https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js';
      s.async = true;
      document.head.appendChild(s);
    }
  })();

  // Render a Fluent Emoji via Iconify.
  function emoji(iconName, size){
    return `<iconify-icon icon="${iconName}" width="${size||36}" height="${size||36}" style="display:inline-flex;align-items:center;justify-content:center;"></iconify-icon>`;
  }

  const BACKEND_URL = '';

  function postToBackend(type, payload){
    if(!BACKEND_URL) return;
    // text/plain avoids a CORS preflight against Apps Script.
    fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type, payload }),
    }).catch(()=>{ /* fire-and-forget; offline shouldn't break the app */ });
  }

  async function fetchRemoteFlags(){
    if(!BACKEND_URL) return [];
    try {
      const res = await fetch(`${BACKEND_URL}?action=getFlags`);
      const data = await res.json();
      return data.flags || [];
    } catch(e){ return []; }
  }

  function acknowledgeRemoteFlag(id){
    postToBackend('acknowledge', { flagId: id });
  }


  // Fluent Emoji icon names (via Iconify fluent-emoji pack, MIT licensed, by Microsoft)
  const BUDDY_ICONS = {
    fox:    'fluent-emoji:fox',
    owl:    'fluent-emoji:owl',
    turtle: 'fluent-emoji:turtle',
    bee:    'fluent-emoji:honeybee',
  };
  const MOOD_ICONS = {
    happy:    'fluent-emoji:smiling-face-with-smiling-eyes',
    laughing: 'fluent-emoji:face-with-tears-of-joy',
    tired:    'fluent-emoji:sleepy-face',
    angry:    'fluent-emoji:pouting-face',
    sad:      'fluent-emoji:crying-face',
    anxious:  'fluent-emoji:worried-face',
  };
  const MOOD_LABELS = {
    happy:'Happy', laughing:'Silly', tired:'Tired',
    angry:'Angry', sad:'Sad', anxious:'Worried',
  };
  const GROWTH_STAGES = [
    'fluent-emoji:seedling','fluent-emoji:seedling',
    'fluent-emoji:herb','fluent-emoji:herb','fluent-emoji:herb',
    'fluent-emoji:cherry-blossom','fluent-emoji:cherry-blossom','fluent-emoji:cherry-blossom',
    'fluent-emoji:sunflower','fluent-emoji:sunflower','fluent-emoji:sunflower','fluent-emoji:sunflower',
  ];
  // counselor. In production this would come from your roster system —
  // for the pilot it's a simple hardcoded lookup by slugified first name.
  const PLAN_STUDENTS = ['maya', 'sofia'];

  function slugify(s){
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function icon(id, cls){
    return `<svg class="${cls || 'icon'}" aria-hidden="true"><use href="icons.svg#${id}"></use></svg>`;
  }

  function safeParse(json, fallback){
    try { const v = JSON.parse(json); return v === null ? fallback : v; }
    catch(e){ return fallback; }
  }

  function storageAvailable(){
    try {
      localStorage.setItem('__swelli_test__','1');
      localStorage.removeItem('__swelli_test__');
      return true;
    } catch(e){ return false; }
  }

  // ---------------- Session ----------------
  function createSession({ name, buddy, school, classCode }){
    const studentId = `${slugify(name)}-${slugify(classCode) || 'class'}`;
    const session = {
      studentId, name, buddy, school: school || '',
      hasPlan: PLAN_STUDENTS.includes(slugify(name)),
      isPreview: false,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function getSession(){
    return safeParse(localStorage.getItem(SESSION_KEY), null);
  }

  function clearSession(){
    localStorage.removeItem(SESSION_KEY);
  }

  function requireSession(redirectTo = 'index.html'){
    const s = getSession();
    if(!s){ window.location.href = redirectTo; return null; }
    return s;
  }

  // ---------------- Entries ----------------
  function getEntries(studentId){
    const id = studentId || (getSession() || {}).studentId;
    if(!id) return [];
    return safeParse(localStorage.getItem(entriesKey(id)), []);
  }

  function addEntry(entry){
    const session = getSession();
    if(!session) return null;
    const entries = getEntries(session.studentId);
    const full = { ts: Date.now(), ...entry };
    entries.push(full);
    localStorage.setItem(entriesKey(session.studentId), JSON.stringify(entries));
    postToBackend('entry', { studentId: session.studentId, studentName: session.name, ...full });
    return full;
  }

  // Patch the most recent entry — used e.g. to record which unwind
  // activity a student picked, or to attach what they wrote/drew.
  function updateLastEntry(patch){
    const session = getSession();
    if(!session) return null;
    const entries = getEntries(session.studentId);
    if(!entries.length) return null;
    entries[entries.length - 1] = { ...entries[entries.length - 1], ...patch };
    localStorage.setItem(entriesKey(session.studentId), JSON.stringify(entries));
    return entries[entries.length - 1];
  }

  function dayKey(ts){
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function computeStats(entries){
    entries = entries || getEntries();
    const total = entries.length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const blossoms = entries.filter(e => e.ts >= weekAgo).length;

    // Streak = consecutive calendar days with at least one entry,
    // counting back from today (a missed day breaks the streak).
    const days = new Set(entries.map(e => dayKey(e.ts)));
    let streak = 0;
    let cursor = Date.now();
    while(days.has(dayKey(cursor))){
      streak++;
      cursor -= 24 * 60 * 60 * 1000;
    }
    return { streak, total, blossoms };
  }

  function relativeDay(ts){
    const diffDays = Math.floor((Date.now() - ts) / (24*60*60*1000));
    if(diffDays <= 0) return 'Today';
    if(diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
  }

  // ---------------- Admin preview ("View as") ----------------
  // Seeds a temporary local session + a plausible entry history for a
  // roster student so the admin can see the real student experience
  // with realistic data, without needing that student's actual device.
  function startPreview(student){
    const studentId = `preview-${slugify(student.name)}`;
    const session = {
      studentId, name: student.name, buddy: student.buddy, school: '',
      hasPlan: PLAN_STUDENTS.includes(slugify(student.name)),
      isPreview: true,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    const entries = [];
    const now = Date.now();
    for(let i = student.streak - 1; i >= 0; i--){
      entries.push({
        ts: now - i * 24*60*60*1000,
        mood: i === 0 ? student.mood : 'happy',
        note: '', activity: i % 3 === 0 ? 'drawing' : (i % 3 === 1 ? 'writing' : 'mapping'),
      });
    }
    localStorage.setItem(entriesKey(studentId), JSON.stringify(entries));
    return session;
  }

  function endPreview(){
    const session = getSession();
    if(session && session.isPreview){
      localStorage.removeItem(entriesKey(session.studentId));
    }
    clearSession();
  }

  // ---------------- Safety language detection ----------------
  // IMPORTANT: this is a first-pass keyword/phrase scanner, not a
  // clinical tool. It will miss things phrased differently and will
  // sometimes flag harmless text — that's an intentional trade-off
  // (false positives are fine to dismiss; missed real disclosures are
  // the real risk). Have your counseling staff review and expand this
  // list before relying on it with real students.
  const SAFETY_PATTERNS = [
    { category: 'Possible self-harm or suicide risk', severity: 'critical', patterns: [
      /kill(ing)? myself/i, /want(ed)? to die/i, /don'?t want to (be alive|live|wake up)/i,
      /end(ing)? (my life|it all)/i, /no reason to live/i, /better off dead/i, /\bsuicide\b/i,
      /hurt(ing)? myself/i, /cut(ting)? myself/i, /self.?harm/i, /can'?t (go on|do this anymore)/i,
      /wish i (was|were) dead/i, /thinking about dying/i,
    ]},
    { category: 'Possible abuse or unsafe home situation', severity: 'critical', patterns: [
      /(he|she|someone) (hits?|hurts?) me/i, /hits? me at home/i,
      /touch(ed|es|ing) me.*(wrong|bad|scared|didn'?t like|don'?t like|uncomfortable)/i,
      /(keeps?|won'?t stop) touching me/i,
      /scared of (my )?(dad|mom|father|mother|stepdad|stepmom|uncle|brother|stepfather|stepmother)/i,
      /\babused?\b/i, /\brape(d)?\b/i, /molest(ed|ing)?/i, /assault(ed)?/i, /won'?t leave me alone.*(home|night)/i,
    ]},
    { category: 'Possible threat to someone else', severity: 'critical', patterns: [
      /bring a gun/i, /going to hurt (him|her|them|someone)/i, /kill (him|her|them)/i, /going to (shoot|stab)/i,
    ]},
    { category: 'Possible eating disorder', severity: 'high', patterns: [
      /haven'?t eaten/i, /starv(e|ing) myself/i, /purg(e|ing)/i, /throw(ing)? up after (eating|i eat)/i,
      /hate my body/i, /too fat/i, /b[iy]nge/i, /skip(ping)? meals/i,
    ]},
    { category: 'Signs of depression or hopelessness', severity: 'medium', patterns: [
      /no one cares/i, /nothing matters/i, /\bgive up\b/i, /\bhopeless\b/i, /nobody (likes|loves) me/i,
      /i'?m worthless/i, /i hate (myself|my life)/i,
    ]},
  ];

  function scanText(text){
    if(!text) return [];
    const hits = [];
    SAFETY_PATTERNS.forEach(group => {
      if(group.patterns.some(p => p.test(text))) hits.push({ category: group.category, severity: group.severity });
    });
    return hits;
  }

  const FLAGS_KEY = 'swelli:allFlags';
  function addFlag({ studentName, category, severity, snippet, source }){
    const flags = safeParse(localStorage.getItem(FLAGS_KEY), []);
    const flag = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      ts: Date.now(), studentName, category, severity, snippet, source, acknowledged: false,
    };
    flags.push(flag);
    localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
    postToBackend('flag', flag);
    return flag;
  }
  function getFlags(){ return safeParse(localStorage.getItem(FLAGS_KEY), []); }
  function getUnacknowledgedFlags(){ return getFlags().filter(f => !f.acknowledged); }
  function acknowledgeFlag(id){
    const flags = getFlags();
    const f = flags.find(x => x.id === id);
    if(f) f.acknowledged = true;
    localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
  }

  // Scans text and logs a flag per match. Returns the hits so the
  // calling page can show the student support immediately — that part
  // is the priority, independent of whether anyone reviews the flag.
  function checkAndFlag(text, source){
    const hits = scanText(text);
    if(hits.length){
      const session = getSession();
      hits.forEach(h => addFlag({
        studentName: session ? session.name : 'Unknown student',
        category: h.category, severity: h.severity, snippet: (text || '').slice(0, 140), source,
      }));
    }
    return hits;
  }

  // Full-screen, student-facing support overlay. Shown immediately on
  // any flagged text, regardless of whether an adult ever sees the flag.
  function showSafetyOverlay(hits, onContinue){
    const isCritical = hits.some(h => h.severity === 'critical');
    const hasAbuse = hits.some(h => h.category.includes('abuse'));
    const hasED = hits.some(h => h.category.includes('eating'));

    const overlay = document.createElement('div');
    overlay.className = 'safety-overlay';
    overlay.innerHTML = `
      <div class="safety-card">
        <h2>You matter, and you're not alone.</h2>
        <p>${isCritical
          ? "It sounds like things might be really hard right now. Please go tell a trusted adult — your counselor, a teacher, or a parent — right now. You don't have to go through this by yourself."
          : "It sounds like you might be going through something tough. It could really help to talk to your school counselor about it."}</p>
        <div class="safety-resources">
          <div class="safety-res"><strong>Call or text 988</strong><span>Suicide &amp; Crisis Lifeline — free, anytime</span></div>
          <div class="safety-res"><strong>Text HOME to 741741</strong><span>Crisis Text Line — free, anytime</span></div>
          ${hasAbuse ? `<div class="safety-res"><strong>Call 1-800-422-4453</strong><span>Childhelp National Child Abuse Hotline — free, anytime</span></div>` : ''}
          ${hasED ? `<div class="safety-res"><strong>Call 1-866-662-1235</strong><span>National Alliance for Eating Disorders Helpline — weekdays 9am–7pm ET</span></div>` : ''}
        </div>
        <p class="safety-note">This check-in was also shared with your school's care team.</p>
        <button class="btn btn-primary btn-block" id="safetyContinueBtn">Okay</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('safetyContinueBtn').addEventListener('click', ()=>{
      overlay.remove();
      if(onContinue) onContinue();
    });
  }

  // ---- Settings ----
  const SETTINGS_KEY = (id) => `swelli:settings:${id}`;

  const THEMES = {
    mint:     { label:'Mint',      emoji:'🌿', vars:{ '--mint-deep':'#2F9C8D','--mint':'#3FB3A2','--mint-pale':'#DCF2EC','--mint-paler':'#EFFAF7','--coral':'#FF8A65','--coral-deep':'#F26B45' } },
    sunset:   { label:'Sunset',    emoji:'🌅', vars:{ '--mint-deep':'#BF5530','--mint':'#E07050','--mint-pale':'#FDEBD6','--mint-paler':'#FEF5ED','--coral':'#F4A460','--coral-deep':'#BF5530' } },
    ocean:    { label:'Ocean',     emoji:'🌊', vars:{ '--mint-deep':'#1A5C8A','--mint':'#2980B9','--mint-pale':'#D4EAF7','--mint-paler':'#EAF5FC','--coral':'#5DADE2','--coral-deep':'#1A5C8A' } },
    lavender: { label:'Lavender',  emoji:'💜', vars:{ '--mint-deep':'#6B4A9B','--mint':'#9370CC','--mint-pale':'#EDE0F9','--mint-paler':'#F5EEFF','--coral':'#C39BD3','--coral-deep':'#6B4A9B' } },
    forest:   { label:'Forest',    emoji:'🌲', vars:{ '--mint-deep':'#1E6B3C','--mint':'#27AE60','--mint-pale':'#C8E8D4','--mint-paler':'#E5F5EC','--coral':'#58D68D','--coral-deep':'#1E6B3C' } },
    ruby:     { label:'Ruby',      emoji:'❤️', vars:{ '--mint-deep':'#C0392B','--mint':'#E74C3C','--mint-pale':'#FDECEA','--mint-paler':'#FFF5F5','--coral':'#F1948A','--coral-deep':'#C0392B' } },
    amber:    { label:'Amber',     emoji:'🍊', vars:{ '--mint-deep':'#D35400','--mint':'#E67E22','--mint-pale':'#FDEBD0','--mint-paler':'#FEF5E7','--coral':'#F0B27A','--coral-deep':'#D35400' } },
    indigo:   { label:'Indigo',    emoji:'🌙', vars:{ '--mint-deep':'#2C3E7A','--mint':'#4A5FA8','--mint-pale':'#D8E0F5','--mint-paler':'#EEF2FC','--coral':'#7B8FC4','--coral-deep':'#2C3E7A' } },
    rose:     { label:'Rose',      emoji:'🌹', vars:{ '--mint-deep':'#AD1457','--mint':'#D81B60','--mint-pale':'#FCE4EC','--mint-paler':'#FFF0F6','--coral':'#F48FB1','--coral-deep':'#AD1457' } },
    slate:    { label:'Slate',     emoji:'🩶', vars:{ '--mint-deep':'#455A64','--mint':'#607D8B','--mint-pale':'#ECEFF1','--mint-paler':'#F5F7F8','--coral':'#90A4AE','--coral-deep':'#455A64' } },
    peach:    { label:'Peach',     emoji:'🍑', vars:{ '--mint-deep':'#A0522D','--mint':'#CD853F','--mint-pale':'#FFF0E0','--mint-paler':'#FFF8F0','--coral':'#DEB887','--coral-deep':'#A0522D' } },
    berry:    { label:'Berry',     emoji:'🫐', vars:{ '--mint-deep':'#6A1B4D','--mint':'#9C2773','--mint-pale':'#F8E0F0','--mint-paler':'#FDF0F9','--coral':'#CE8FBB','--coral-deep':'#6A1B4D' } },
  };

  const FONTS = {
    friendly:    { label:'Friendly',    sample:'Aa', family:"'Nunito', sans-serif",           url:null },
    playful:     { label:'Playful',     sample:'Aa', family:"'Comic Neue', cursive",           url:'https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap' },
    clear:       { label:'Clear',       sample:'Aa', family:"'Open Sans', sans-serif",         url:'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&display=swap' },
    cursive:     { label:'Cursive',     sample:'Aa', family:"'Dancing Script', cursive",       url:'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap' },
    handwriting: { label:'Handwriting', sample:'Aa', family:"'Caveat', cursive",               url:'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap' },
    rounded:     { label:'Rounded',     sample:'Aa', family:"'Comfortaa', sans-serif",         url:'https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&display=swap' },
    schoolbook:  { label:'Schoolbook',  sample:'Aa', family:"'Patrick Hand', cursive",         url:'https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap' },
  };

  const BUDDY_OPTIONS = [
    { id:'fox',       icon:'fluent-emoji:fox',         label:'Fox'       },
    { id:'owl',       icon:'fluent-emoji:owl',          label:'Owl'       },
    { id:'turtle',    icon:'fluent-emoji:turtle',       label:'Turtle'    },
    { id:'bee',       icon:'fluent-emoji:honeybee',     label:'Bee'       },
    { id:'bear',      icon:'fluent-emoji:bear',         label:'Bear'      },
    { id:'panda',     icon:'fluent-emoji:panda',        label:'Panda'     },
    { id:'rabbit',    icon:'fluent-emoji:rabbit',       label:'Rabbit'    },
    { id:'cat',       icon:'fluent-emoji:cat',          label:'Cat'       },
    { id:'dog',       icon:'fluent-emoji:dog',          label:'Dog'       },
    { id:'frog',      icon:'fluent-emoji:frog',         label:'Frog'      },
    { id:'penguin',   icon:'fluent-emoji:penguin',      label:'Penguin'   },
    { id:'lion',      icon:'fluent-emoji:lion',         label:'Lion'      },
    { id:'butterfly', icon:'fluent-emoji:butterfly',    label:'Butterfly' },
    { id:'unicorn',   icon:'fluent-emoji:unicorn',      label:'Unicorn'   },
    { id:'dragon',    icon:'fluent-emoji:dragon',       label:'Dragon'    },
    { id:'hamster',   icon:'fluent-emoji:hamster',      label:'Hamster'   },
    { id:'koala',     icon:'fluent-emoji:koala',        label:'Koala'     },
    { id:'parrot',    icon:'fluent-emoji:parrot',       label:'Parrot'    },
    { id:'octopus',   icon:'fluent-emoji:octopus',      label:'Octopus'   },
    { id:'elephant',  icon:'fluent-emoji:elephant',     label:'Elephant'  },
  ];

  function getSettings(){
    const session = getSession();
    const defaults = { theme:'mint', font:'friendly', checkInFrequency:'weekly', displayName:'' };
    if(!session) return defaults;
    return safeParse(localStorage.getItem(SETTINGS_KEY(session.studentId)), defaults);
  }

  function saveSettings(patch){
    const session = getSession();
    if(!session) return;
    const updated = { ...getSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY(session.studentId), JSON.stringify(updated));
    if(patch.buddy){
      session.buddy = patch.buddy;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    applySettings(updated);
    return updated;
  }

  function applySettings(s){
    if(!s) return;
    const theme = THEMES[s.theme] || THEMES.mint;
    Object.entries(theme.vars).forEach(([k,v])=> document.documentElement.style.setProperty(k, v));
    const font = FONTS[s.font] || FONTS.friendly;
    if(font.url && !document.getElementById('swelli-font-link')){
      const link = document.createElement('link');
      link.id = 'swelli-font-link'; link.rel = 'stylesheet'; link.href = font.url;
      document.head.appendChild(link);
    }
    document.body.style.fontFamily = font.family;
  }

  // Check if the student has already checked in within their chosen frequency window.
  function hasCheckedInRecently(){
    const entries = getEntries();
    if(!entries.length) return false;
    const freq = getSettings().checkInFrequency || 'weekly';
    const last = entries[entries.length - 1];
    const now = new Date();
    if(freq === 'daily'){
      return new Date(last.ts).toDateString() === now.toDateString();
    }
    // Weekly: same Mon–Sun calendar week
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    startOfWeek.setHours(0,0,0,0);
    return last.ts >= startOfWeek.getTime();
  }

  // Redirect to home after a save action (used by writing, drawing, mapping).
  function saveAndGoHome(entryPatch, toastEl, delay){
    if(entryPatch) updateLastEntry(entryPatch);
    delay = delay || 1600;
    if(toastEl){ toastEl.classList.add('show'); }
    setTimeout(()=> window.location.href = 'home.html', delay);
  }

  // Auto-apply settings on every page load so themes/fonts persist across pages.
  document.addEventListener('DOMContentLoaded', ()=>{
    const session = getSession();
    if(session) applySettings(getSettings());
  });

  // ---- Garden: 4-stage plant progression ----
  // Every 4 streak days completes one plant: pot → seedling → growing → bloom.
  // The bloom type rotates through 8 different plants across cycles.
  function getGardenStage(dayIndex){
    const BLOOM_TYPES = [
      'fluent-emoji:sunflower','fluent-emoji:rose','fluent-emoji:tulip',
      'fluent-emoji:cherry-blossom','fluent-emoji:cactus','fluent-emoji:four-leaf-clover',
      'fluent-emoji:hibiscus','fluent-emoji:potted-plant',
    ];
    const pos = dayIndex % 4;
    const cycle = Math.floor(dayIndex / 4);
    const stages = [
      'fluent-emoji:pot',
      'fluent-emoji:seedling',
      'fluent-emoji:herb',
      BLOOM_TYPES[cycle % BLOOM_TYPES.length],
    ];
    return stages[pos];
  }

  // ---- Avatar pill: logout dropdown + buddy refresh ----
  // Call once per page after DOM ready. Refreshes the buddy icon from the
  // current session and adds a "Log out" dropdown to the avatar pill.
  function setupAvatarPill(){
    const pill = document.getElementById('avatarPill');
    const dot = document.getElementById('avatarDot');
    if(!pill) return;
    const session = getSession();
    if(session && dot){
      const buddyObj = BUDDY_OPTIONS.find(b => b.id === session.buddy) || BUDDY_OPTIONS[0];
      dot.innerHTML = emoji(buddyObj.icon, 26);
    }
    // Build dropdown once
    if(!document.getElementById('avatarDropdown')){
      const dd = document.createElement('div');
      dd.id = 'avatarDropdown';
      dd.style.cssText = `display:none;position:absolute;right:0;top:54px;background:#fff;
        border-radius:14px;box-shadow:0 12px 32px -8px rgba(37,57,58,0.22);
        padding:8px;min-width:160px;z-index:40;`;
      dd.innerHTML = `
        <a href="settings.html" style="display:flex;align-items:center;gap:8px;padding:10px 14px;font-weight:700;font-size:14px;color:var(--ink);border-radius:8px;text-decoration:none;">
          <svg width="16" height="16" aria-hidden="true"><use href="icons.svg#icon-person"/></svg> Settings</a>
        <button id="logoutBtn" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;font-weight:700;font-size:14px;color:#B23B2E;border-radius:8px;background:none;border:none;text-align:left;cursor:pointer;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg> Log out</button>`;
      pill.style.position = 'relative';
      pill.appendChild(dd);
      pill.style.cursor = 'pointer';
      pill.addEventListener('click', e => {
        e.stopPropagation();
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => dd.style.display = 'none');
      document.getElementById('logoutBtn')?.addEventListener('click', () => {
        clearSession();
        window.location.href = 'index.html';
      });
    }
  }

  return {
    storageAvailable, icon, emoji, slugify,
    createSession, getSession, clearSession, requireSession,
    getEntries, addEntry, updateLastEntry, computeStats, relativeDay,
    startPreview, endPreview,
    scanText, checkAndFlag, addFlag, getFlags, getUnacknowledgedFlags, acknowledgeFlag, showSafetyOverlay,
    fetchRemoteFlags, acknowledgeRemoteFlag,
    getSettings, saveSettings, applySettings, hasCheckedInRecently, saveAndGoHome,
    getGardenStage, setupAvatarPill,
    THEMES, FONTS, BUDDY_OPTIONS, BUDDY_ICONS, MOOD_ICONS, MOOD_LABELS, GROWTH_STAGES,
  };
})();
