(function () {
  'use strict';

  /* ============================================================
     0. КОНФИГ И ГЛОБАЛЬНОЕ СОСТОЯНИЕ
     ============================================================ */
  const CFG = window.APP_CONFIG || { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
  const S = {
    supabase: null,
    user: null,
    grade: Number(localStorage.getItem('eq_grade') || CFG.DEFAULT_GRADE),
    vocabulary: { starter: [], mover: [], flyer: [] },
    grammar: { topics: [] },
    dict: JSON.parse(localStorage.getItem('eq_dict') || '[]'),
    stickers: JSON.parse(localStorage.getItem('eq_stickers') || '{}'),
    history: JSON.parse(localStorage.getItem('eq_history') || '[]'),
    knight: JSON.parse(localStorage.getItem('eq_knight') || '[]'),
    taskLog: JSON.parse(localStorage.getItem('eq_tasks') || '[]'),
    weekly: JSON.parse(localStorage.getItem('eq_weekly') || '{}'),
    sm2: JSON.parse(localStorage.getItem('eq_sm2') || '{}'),
    currentTopics: [],
    quiz: { questions: [], idx: 0, records: [], locked: false, live: 0, streak: 0, best: 0 },
    learnQueue: [], learnIdx: 0,
    reviewQueue: [], reviewIdx: 0,
    mode: 'quiz'
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtDate = (ts) => { const d = new Date(ts); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0'); };
  const fmtDateTime = (ts) => fmtDate(ts) + ', ' + String(new Date(ts).getHours()).padStart(2, '0') + ':' + String(new Date(ts).getMinutes()).padStart(2, '0');
  const todayKey = () => new Date().toISOString().slice(0, 10);

  /* ============================================================
     1. ХРАНИЛИЩЕ (localStorage + sync)
     ============================================================ */
  function saveLocal() {
    localStorage.setItem('eq_grade', S.grade);
    localStorage.setItem('eq_dict', JSON.stringify(S.dict));
    localStorage.setItem('eq_stickers', JSON.stringify(S.stickers));
    localStorage.setItem('eq_history', JSON.stringify(S.history));
    localStorage.setItem('eq_knight', JSON.stringify(S.knight));
    localStorage.setItem('eq_tasks', JSON.stringify(S.taskLog));
    localStorage.setItem('eq_weekly', JSON.stringify(S.weekly));
    localStorage.setItem('eq_sm2', JSON.stringify(S.sm2));
    if (S.user) syncToCloud();
  }

  async function syncToCloud() {
    if (!S.supabase || !S.user) return;
    try {
      await S.supabase.from('profiles').upsert({
        id: S.user.id,
        data: {
          grade: S.grade, dict: S.dict, stickers: S.stickers, history: S.history,
          knight: S.knight, taskLog: S.taskLog, weekly: S.weekly, sm2: S.sm2
        },
        updated_at: new Date().toISOString()
      });
    } catch (e) { console.warn('sync error', e); }
  }

  async function loadFromCloud() {
    if (!S.supabase || !S.user) return false;
    try {
      const { data, error } = await S.supabase.from('profiles').select('data').eq('id', S.user.id).maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        const d = data.data;
        // Union-merge: локальные данные не теряются
        S.grade = d.grade || S.grade;
        S.dict = mergeByKey(S.dict, d.dict || [], 'id');
        S.stickers = Object.assign({}, d.stickers || {}, S.stickers); // локальные приоритетнее
        S.history = mergeByKey(S.history, d.history || [], 'ts');
        S.knight = Array.from(new Set([...S.knight, ...(d.knight || [])]));
        S.taskLog = mergeByKey(S.taskLog, d.taskLog || [], 'ts');
        S.weekly = Object.assign({}, d.weekly || {}, S.weekly);
        S.sm2 = Object.assign({}, d.sm2 || {}, S.sm2);
        saveLocal();
        return true;
      }
    } catch (e) { console.warn('load cloud error', e); }
    return false;
  }

  function mergeByKey(a, b, key) {
    const map = new Map();
    [...a, ...b].forEach(item => { if (item[key] !== undefined) map.set(item[key], item); });
    return Array.from(map.values());
  }

  /* ============================================================
     2. АВТОРИЗАЦИЯ (Supabase)
     ============================================================ */
      async function initSupabase() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return null;
    const client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    
    // Слушаем изменения авторизации
    client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Пользователь перешёл по ссылке сброса пароля
        showScreen('reset');
      } else if (session && session.user) {
        S.user = session.user;
        await loadFromCloud();
        renderHome();
      } else {
        S.user = null;
        renderHome();
      }
    });

    // Проверяем текущую сессию при загрузке
    const { data: { session } } = await client.auth.getSession();
    if (session && session.user) {
      S.user = session.user;
      await loadFromCloud();
    }
    return client;
  }



  async function authSubmit() {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const errEl = $('#auth-error');
    errEl.textContent = '';
    if (!email || password.length < 6) { errEl.textContent = 'Email и пароль (мин. 6 символов)'; return; }
    if (!S.supabase) { errEl.textContent = 'Супabase не настроен. Используй локальный режим.'; return; }
    const isSignUp = $('#auth-title').textContent === 'Регистрация';
    try {
      let res;
      if (isSignUp) res = await S.supabase.auth.signUp({ email, password });
      else res = await S.supabase.auth.signInWithPassword({ email, password });
      if (res.error) throw res.error;
      if (isSignUp && res.data.user && !res.data.session) {
        errEl.textContent = 'Аккаунт создан. Проверь почту для подтверждения.';
      } else {
        showScreen('home');
        renderHome();
      }
    } catch (e) { errEl.textContent = e.message; }
  }

  async function logout() {
    if (S.supabase) await S.supabase.auth.signOut();
    S.user = null;
    renderHome();
  }

  /* ============================================================
     3. ЗАГРУЗКА ДАННЫХ
     ============================================================ */
  async function loadVocabulary() {
    try {
      const res = await fetch('data/vocabulary.json');
      if (res.ok) { S.vocabulary = await res.json(); return; }
    } catch (e) { /* file:// или нет файла */ }
    // Fallback: минимальный набор, чтобы приложение не падало
    S.vocabulary = {
      starter: [{ id: 's_apple', en: 'apple', ru: 'яблоко', topic: 'Food', example: 'I eat an apple.' }],
      mover: [{ id: 'm_beach', en: 'beach', ru: 'пляж', topic: 'Travel', example: 'We play on the beach.' }],
      flyer: [{ id: 'f_important', en: 'important', ru: 'важный', topic: 'Adjectives', example: 'It is important.' }]
    };
    toast('Словарь не загружен, используется встроенный', 'gold');
  }

  async function loadGrammar() {
    try {
      const res = await fetch('data/grammar.json');
      if (res.ok) { const j = await res.json(); S.grammar = j; return; }
    } catch (e) { /* fallback */ }
    // Fallback: встроенная грамматика
    S.grammar = { topics: [] };
  }

  function wordsForGrade(grade) {
    // 2 класс → starter, 3 → starter + mover, 4 → starter + mover + flyer
    if (grade <= 2) return [...S.vocabulary.starter];
    if (grade === 3) return [...S.vocabulary.starter, ...S.vocabulary.mover];
    return [...S.vocabulary.starter, ...S.vocabulary.mover, ...S.vocabulary.flyer];
  }

  function allWords() { return [...S.vocabulary.starter, ...S.vocabulary.mover, ...S.vocabulary.flyer]; }

  /* ============================================================
     4. SM-2 (интервальное повторение)
     ============================================================ */
  function sm2Update(wordId, quality) {
    // quality: 0..3 (0=забыл, 1=трудно, 2=нормально, 3=легко)
    const now = Date.now();
    const rec = S.sm2[wordId] || { ease: 2.5, interval: 0, reps: 0, due: now };
    if (quality < 2) {
      rec.reps = 0;
      rec.interval = 1;
    } else {
      rec.reps++;
      if (rec.reps === 1) rec.interval = 1;
      else if (rec.reps === 2) rec.interval = 6;
      else rec.interval = Math.round(rec.interval * rec.ease);
      rec.ease = Math.max(1.3, rec.ease + (0.1 - (3 - quality) * 0.08));
    }
    rec.due = now + rec.interval * 24 * 60 * 60 * 1000;
    rec.last = now;
    S.sm2[wordId] = rec;
    saveLocal();
    return rec;
  }

  function dueWords() {
    const now = Date.now();
    const due = [];
    Object.keys(S.sm2).forEach(id => {
      if (S.sm2[id].due <= now) {
        const w = allWords().find(x => x.id === id);
        if (w) due.push(w);
      }
    });
    // Добавим слова из словарика, которых ещё нет в SM2 (новые)
    S.dict.forEach(d => {
      if (!S.sm2[d.id]) {
        const w = allWords().find(x => x.id === d.id);
        if (w) due.push(w);
      }
    });
    return due;
  }

  /* ============================================================
     5. РЕНДЕР ГЛАВНОГО ЭКРАНА
     ============================================================ */
    function renderHome() {
    const isLogged = !!S.user;
    $('#home-user').textContent = isLogged ? ('👤 ' + (S.user.email || '').split('@')[0]) : '👤 Гость';
    $('#btn-login').hidden = isLogged;
    $('#btn-logout').hidden = !isLogged;
    
    renderGradeSelector();
    updateHomeSummary();
    updateGoalsBadge();
    showScreen('home');
  }

  function renderGradeSelector() {
    const box = $('#grade-selector');
    box.innerHTML = '';
    [2, 3, 4].forEach(g => {
      const b = document.createElement('button');
      b.textContent = g + ' класс';
      if (S.grade === g) b.classList.add('active');
      b.addEventListener('click', () => { S.grade = g; saveLocal(); renderGradeSelector(); updateHomeSummary(); });
      box.appendChild(b);
    });
  }

  function updateHomeSummary() {
    const kCount = S.knight.length;
    const dCount = S.dict.length;
    const last = S.history.length ? Math.round(S.history[S.history.length - 1].score / S.history[S.history.length - 1].total * 100) : null;
    $('#home-summary').innerHTML =
      '📖 Словарик: <b>' + dCount + '</b> · 🏆 Стикеры: <b>' + Object.keys(S.stickers).filter(k => S.stickers[k] > 0).length + '</b><br>' +
      '⚔️ Рыцарь: <b>' + kCount + '/27</b> предметов' +
      (last !== null ? ' · 📊 Последний: <b>' + last + '%</b>' : '');
  }

  /* ============================================================
     6. ЭКРАНЫ
     ============================================================ */
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = $('#screen-' + id);
    if (el) el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
     7. КВИЗ / ТРЕНИРОВКА
     ============================================================ */
  function startTopics(mode) {
    S.mode = mode;
    $('#topics-title').textContent = mode === 'quiz' ? '🎯 Тренировка' : '📚 Новые слова';
    $('#topics-sub').textContent = mode === 'quiz' ? 'Выбери тему. 20 вопросов.' : 'Выбери тему — карточки с озвучкой и SM-2';
    const pool = wordsForGrade(S.grade);
    const topics = [...new Set(pool.map(w => w.topic))].sort();
    const grid = $('#topics-grid');
    grid.innerHTML = '';
    S.currentTopics = topics;
    topics.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'topic-btn' + (i === 0 ? ' active' : '');
      b.textContent = t;
      b.dataset.topic = t;
      b.addEventListener('click', () => {
        $$('#topics-grid .topic-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
      grid.appendChild(b);
    });
    const extra = $('#topics-extra');
    if (mode === 'quiz') { extra.hidden = false; extra.innerHTML = '💡 В тест попадут и слова из предыдущих уровней.'; }
    else { extra.hidden = true; }
    showScreen('topics');
  }

  function startQuiz() {
    const topic = $('#topics-grid .topic-btn.active')?.dataset.topic;
    const pool = wordsForGrade(S.grade).filter(w => w.topic === topic);
    // Добавим несколько слов из предыдущих уровней (интерливинг)
    const prev = S.grade > 2 ? wordsForGrade(S.grade - 1) : [];
    const mix = shuffle([...pool, ...prev]).slice(0, 20);
    if (mix.length < 4) { toast('Мало слов для темы', 'gold'); return; }
    S.quiz.questions = mix.map(w => makeQuestion(w, mix));
    S.quiz.idx = 0; S.quiz.records = []; S.quiz.locked = false;
    S.quiz.live = 0; S.quiz.streak = 0; S.quiz.best = 0;
    showScreen('quiz'); renderQuiz();
  }

  function makeQuestion(word, pool) {
    const dir = Math.random() < 0.5 ? 'ru-en' : 'en-ru';
    const others = pool.filter(w => w.en !== word.en);
    shuffle(others);
    const distractors = others.slice(0, 2);
    let prompt, correct, options;
    if (dir === 'ru-en') { prompt = word.ru; correct = word.en; options = [word.en, ...distractors.map(d => d.en)]; }
    else { prompt = word.en; correct = word.ru; options = [word.ru, ...distractors.map(d => d.ru)]; }
    shuffle(options);
    return { word, dir, prompt, correct, options };
  }

  function renderQuiz() {
    const q = S.quiz.questions[S.quiz.idx];
    $('#q-counter').textContent = (S.quiz.idx + 1) + ' / ' + S.quiz.questions.length;
    $('#q-live').textContent = '✅ ' + S.quiz.live + ' · 🔥 ' + S.quiz.streak;
    $('#q-progress').style.width = (S.quiz.idx / S.quiz.questions.length * 100) + '%';
    $('#q-direction').textContent = q.dir === 'ru-en' ? 'Как сказать по-английски?' : 'Что это значит по-русски?';
    $('#q-word').textContent = q.prompt;
    $('#q-feedback').textContent = ''; $('#q-feedback').className = 'feedback';
    const box = $('#q-options'); box.innerHTML = '';
    q.options.forEach(t => {
      const b = document.createElement('button');
      b.className = 'option'; b.textContent = t;
      b.addEventListener('click', () => quizChoose(b, t));
      box.appendChild(b);
    });
  }

  function quizChoose(btn, text) {
    if (S.quiz.locked) return; S.quiz.locked = true;
    const q = S.quiz.questions[S.quiz.idx];
    const ok = text === q.correct;
    $$('#q-options .option').forEach(b => b.disabled = true);
    if (ok) {
      S.quiz.live++; S.quiz.streak++; S.quiz.best = Math.max(S.quiz.best, S.quiz.streak);
      $('#q-live').textContent = '✅ ' + S.quiz.live + ' · 🔥 ' + S.quiz.streak;
      btn.classList.add('correct');
      const fb = $('#q-feedback'); fb.textContent = pick(['Точно! 🎯', 'Верно! ✅', 'Есть! 💥', 'Молодец! 👏', 'Так держать! 💪']);
      fb.className = 'feedback good-text';
      S.quiz.records.push({ q, ok: true });
    } else {
      S.quiz.streak = 0;
      $('#q-live').textContent = '✅ ' + S.quiz.live + ' · 🔥 0';
      btn.classList.add('wrong');
      $$('#q-options .option').forEach(b => { if (b.textContent === q.correct) b.classList.add('correct'); });
      const fb = $('#q-feedback'); fb.innerHTML = 'Правильно: <b>' + q.correct + '</b>';
      fb.className = 'feedback bad-text';
      S.quiz.records.push({ q, ok: false, chosen: text });
    }
    setTimeout(() => {
      S.quiz.locked = false; S.quiz.idx++;
      if (S.quiz.idx >= S.quiz.questions.length) finishQuiz(); else renderQuiz();
    }, ok ? 700 : 1500);
  }

  function finishQuiz() {
    const total = S.quiz.questions.length;
    const right = S.quiz.records.filter(r => r.ok).length;
    const grade = right / total >= 0.9 ? 5 : right / total >= 0.7 ? 4 : right / total >= 0.5 ? 3 : 2;
    S.history.push({ ts: Date.now(), score: right, total, type: 'quiz' });
    logTask('quiz');
    saveLocal();
    let awarded = [];
    if (grade === 5) awarded = awardStickers(2);
    else if (grade === 4) awarded = awardStickers(1);
    const ge = { 5: '🏆', 4: '😎', 3: '💡', 2: '🐣' }[grade];
    const gl = { 5: 'Отлично', 4: 'Хорошо', 3: 'Неплохо', 2: 'Надо потренироваться' }[grade];
    let html = `<div class="emoji-big">${ge}</div>
      <div class="grade-line"><div class="grade-big">${grade}</div>
      <div style="text-align:left"><div class="score-big">${right} / ${total}</div>
      <div class="verdict" style="margin:0">${gl}</div></div></div>
      <div class="motiv">${pick(['Молодец!', 'Хорошая работа!', 'Продолжай в том же духе!', 'Растёшь!'])}</div>`;
    if (awarded.length) {
      html += `<div class="award-box"><div class="award-title">🎁 Новый стикер!</div>
        <div class="sticker-grid single">${awarded.map(s => `<div class="sticker-item big"><span class="sticker-emoji">${s.emoji}</span><span class="sticker-name">${s.name}</span></div>`).join('')}</div></div>`;
    }
    const wrong = S.quiz.records.filter(r => !r.ok);
    if (wrong.length) {
      html += '<h2>❌ Ошибки</h2><ul class="mistakes">' + wrong.map(r => `<li><span class="m-q">${r.q.prompt} → <b>${r.q.correct}</b></span><span class="m-u">твой: ${r.chosen || '—'}</span></li>`).join('') + '</ul>';
    } else {
      html += '<div class="all-right">Ни одной ошибки! 🎉</div>';
    }
    html += `<div class="btn-row"><button class="btn primary" onclick="location.reload()">🏠 На главную</button></div>`;
    $('#quiz-result-card').innerHTML = html;
    showScreen('quiz-result');
    checkGoals();
  }

  /* ============================================================
     8. КАРТОЧКИ (УЧЁБА)
     ============================================================ */
  function startLearn() {
    const topic = $('#topics-grid .topic-btn.active')?.dataset.topic;
    const known = new Set(S.dict.map(d => d.id));
    S.learnQueue = wordsForGrade(S.grade).filter(w => w.topic === topic && !known.has(w.id));
    if (!S.learnQueue.length) { toast('Все слова темы уже выучены!', 'gold'); return; }
    S.learnIdx = 0;
    showScreen('learn'); renderLearnCard();
  }

  function renderLearnCard() {
    const w = S.learnQueue[S.learnIdx];
    $('#learn-counter').textContent = 'Слово ' + (S.learnIdx + 1) + ' из ' + S.learnQueue.length;
    $('#learn-progress').style.width = (S.learnIdx / S.learnQueue.length * 100) + '%';
    $('#learn-level').textContent = w.id.startsWith('s_') ? 'Pre-A1 Starter' : w.id.startsWith('m_') ? 'A1 Mover' : 'A2 Flyer';
    $('#learn-word').textContent = w.en;
    $('#learn-translation').textContent = w.ru;
    $('#learn-example').textContent = w.example || '';
    $('#pron-result').innerHTML = '';
    setTimeout(() => speak(w.en), 300);
  }

  function nextLearn() {
    const w = S.learnQueue[S.learnIdx];
    if (!S.dict.some(d => d.id === w.id)) S.dict.push(w);
    S.learnIdx++;
    saveLocal();
    if (S.learnIdx >= S.learnQueue.length) {
      logTask('learn');
      const st = awardStickers(1);
      $('#learn-done-card').innerHTML = `<div class="emoji-big">🎓</div><h1>Тема пройдена!</h1>
        <p class="sub">Слова добавлены в словарик. Повторяй их в разделе «Повторение».</p>
        <div class="award-box"><div class="award-title">🎁 Стикер!</div>
        <div class="sticker-grid single">${st.map(s => `<div class="sticker-item big"><span class="sticker-emoji">${s.emoji}</span><span class="sticker-name">${s.name}</span></div>`).join('')}</div></div>
        <div class="btn-row"><button class="btn primary" onclick="location.reload()">🏠 На главную</button></div>`;
      showScreen('learn-done');
      checkGoals();
    } else {
      renderLearnCard();
    }
  }

  /* ============================================================
     9. ПОВТОРЕНИЕ (SM-2)
     ============================================================ */
  function startReview() {
    S.reviewQueue = dueWords();
    if (!S.reviewQueue.length) { toast('Нет слов для повторения. Сначала выучи новые!', 'gold'); return; }
    S.reviewIdx = 0;
    showScreen('review'); renderReviewCard();
  }

  function renderReviewCard() {
    const w = S.reviewQueue[S.reviewIdx];
    $('#review-counter').textContent = 'Повторение ' + (S.reviewIdx + 1) + ' из ' + S.reviewQueue.length;
    $('#review-progress').style.width = (S.reviewIdx / S.reviewQueue.length * 100) + '%';
    $('#review-level').textContent = w.id.startsWith('s_') ? 'Pre-A1 Starter' : w.id.startsWith('m_') ? 'A1 Mover' : 'A2 Flyer';
    $('#review-word').textContent = w.en;
    $('#review-translation').textContent = w.ru;
    $('#review-example').textContent = w.example || '';
  }

  function reviewAnswer(q) {
    const w = S.reviewQueue[S.reviewIdx];
    sm2Update(w.id, q);
    S.reviewIdx++;
    if (S.reviewIdx >= S.reviewQueue.length) {
      toast('Повторение завершено!', 'gold');
      showScreen('home');
      updateHomeSummary();
    } else {
      renderReviewCard();
    }
  }

  /* ============================================================
     10. ГРАММАТИКА
     ============================================================ */
  function renderGrammarList() {
    const topics = S.grammar.topics.filter(t => t.grade <= S.grade);
    let html = '';
    topics.forEach(t => {
      html += `<div class="rule-card" data-id="${t.id}"><h3>${t.title} — ${t.subtitle}</h3>
        <p style="margin:0">${t.intro}</p>
        <div style="margin-top:10px;color:#059669;font-weight:700">Открыть →</div></div>`;
    });
    $('#grammar-lessons').innerHTML = html;
    $$('#grammar-lessons .rule-card').forEach(el => el.addEventListener('click', () => openGrammar(el.dataset.id)));
    $('#grammar-sub').textContent = 'Темы для ' + S.grade + ' класса';
    showScreen('grammar-list');
  }

  function openGrammar(id) {
    const t = S.grammar.topics.find(x => x.id === id);
    let html = `<div class="emoji-big">🧠</div><h1>${t.title}</h1><p class="sub">${t.subtitle}</p>
      <div class="lesson-intro">${t.intro}<br><br><b>Маркеры:</b> ${t.markers.join(', ')}</div>`;
    t.rules.forEach(r => {
      html += `<div class="rule-card" style="cursor:default"><h3>${r.h}</h3><p>${r.p}</p><div class="ex">Пример: ${r.ex}</div></div>`;
    });
    html += `<h2>Упражнения</h2><div id="grammar-ex"></div>
      <div class="btn-row" style="margin-top:16px"><button class="btn ghost" id="gl-back">← К грамматике</button></div>`;
    $('#grammar-lesson-card').innerHTML = html;
    $('#gl-back').addEventListener('click', renderGrammarList);
    const box = $('#grammar-ex');
    t.exercises.forEach((ex, i) => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.innerHTML = `<div class="exercise-sentence">${i + 1}. ${ex.s}</div><div class="exercise-options"></div><div class="ex-explain" style="display:none"></div>`;
      const optBox = card.querySelector('.exercise-options');
      ex.o.forEach(o => {
        const b = document.createElement('button');
        b.className = 'ex-opt'; b.textContent = o;
        b.addEventListener('click', () => {
          if (card.dataset.answered) return;
          card.dataset.answered = '1';
          const ok = o === ex.c;
          Array.from(optBox.children).forEach(x => x.disabled = true);
          b.classList.add(ok ? 'correct' : 'wrong');
          if (!ok) Array.from(optBox.children).forEach(x => { if (x.textContent === ex.c) x.classList.add('correct'); });
          const exp = card.querySelector('.ex-explain');
          exp.style.display = 'block';
          exp.textContent = (ok ? '✅ Верно! ' : '❌ ') + ex.e;
        });
        optBox.appendChild(b);
      });
      box.appendChild(card);
    });
    showScreen('grammar-lesson');
  }

  /* ============================================================
     11. СЛОВАРИК
     ============================================================ */
  function renderDictionary() {
    const dict = S.dict;
    if (!dict.length) {
      $('#dict-sub').textContent = 'Словарик пуст';
      $('#dict-filter').innerHTML = '';
      $('#dict-list').innerHTML = '<div class="empty-state"><span class="emoji">📭</span>Пройди «Новые слова» — и слова появятся здесь.</div>';
      $('#btn-dict-practice').disabled = true;
    } else {
      $('#btn-dict-practice').disabled = false;
      $('#dict-sub').textContent = 'Всего слов: ' + dict.length;
      const topics = ['all', ...new Set(dict.map(w => w.topic))];
      const flt = $('#dict-filter'); flt.innerHTML = '';
      topics.forEach(t => {
        const b = document.createElement('button');
        b.textContent = t === 'all' ? 'Все' : t;
        b.className = t === 'all' ? 'active' : '';
        b.addEventListener('click', () => {
          flt.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          renderDictList(t);
        });
        flt.appendChild(b);
      });
      renderDictList('all');
    }
    showScreen('dictionary');
  }

  function renderDictList(filter) {
    const list = filter === 'all' ? S.dict : S.dict.filter(w => w.topic === filter);
    const el = $('#dict-list');
    if (!list.length) { el.innerHTML = '<div class="empty-state">Нет слов в этой теме</div>'; return; }
    el.innerHTML = '';
    list.slice().reverse().forEach(w => {
      const lvl = w.id.startsWith('s_') ? 'Starter' : w.id.startsWith('m_') ? 'Mover' : 'Flyer';
      const due = S.sm2[w.id] ? new Date(S.sm2[w.id].due) : null;
      const dueStr = due ? 'Повторить: ' + fmtDate(due) : 'Ещё не повторялось';
      const item = document.createElement('div');
      item.className = 'dict-item';
      item.innerHTML = `<div class="dict-body">
        <div class="dict-en">${w.en} <span class="level-tag">${lvl}</span></div>
        <div class="dict-ru">${w.ru}</div>
        ${w.example ? `<div class="dict-example">${w.example}</div>` : ''}
        <div class="dict-due">${dueStr}</div>
      </div>`;
      const pb = document.createElement('button');
      pb.className = 'dict-play'; pb.textContent = '🔊';
      pb.addEventListener('click', () => speak(w.en));
      const acts = document.createElement('div'); acts.className = 'dict-actions'; acts.appendChild(pb);
      item.appendChild(acts);
      el.appendChild(item);
    });
  }

  /* ============================================================
     12. ЦЕЛИ И РЫЦАРЬ (упрощённо, но с наградами)
     ============================================================ */
  const GOALS = [
    { key: 'words', target: 10, title: 'Выучить новых слов', emoji: '📚' },
    { key: 'tasks', target: 5, title: 'Сделать заданий', emoji: '✏️' }
  ];

  function weekStart() {
    const d = new Date(); const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function getGoalProgress(key) {
    const ws = weekStart();
    if (key === 'words') return S.dict.filter(w => (w.learnedAt || 0) >= ws).length;
    if (key === 'tasks') return S.taskLog.filter(t => t.ts >= ws).length;
    return 0;
  }

  function logTask(type) {
    S.taskLog.push({ ts: Date.now(), type });
    saveLocal();
  }

  function checkGoals() {
    const wk = new Date(weekStart()).toISOString().slice(0, 10);
    if (!S.weekly[wk]) S.weekly[wk] = { goals: {}, bonus: false };
    const data = S.weekly[wk];
    GOALS.forEach(g => {
      const cur = data.goals[g.key] || { awarded: false };
      const prog = getGoalProgress(g.key);
      if (!cur.awarded && prog >= g.target) {
        cur.awarded = true;
        data.goals[g.key] = cur;
        const item = awardKnight();
        if (item) toast('🎯 Цель «' + g.title + '»! + ' + item.emoji + ' ' + item.name, 'gold');
      }
    });
    if (GOALS.every(g => data.goals[g.key]?.awarded) && !data.bonus) {
      data.bonus = true;
      const bonus = awardKnight(true);
      if (bonus) toast('🏆 Все цели недели! Легендарная награда: ' + bonus.emoji + ' ' + bonus.name, 'purple');
    }
    saveLocal();
    updateGoalsBadge();
  }

  function awardKnight(bonus) {
    const items = KNIGHT_ITEMS.filter(i => !S.knight.includes(i.id));
    if (!items.length) return null;
    let pool = items;
    if (bonus) { pool = items.filter(i => i.tier >= 4); if (!pool.length) pool = items; }
    const item = pick(pool);
    S.knight.push(item.id); saveLocal(); return item;
  }

  function updateGoalsBadge() {
    const wk = new Date(weekStart()).toISOString().slice(0, 10);
    const data = S.weekly[wk] || { goals: {} };
    const done = GOALS.filter(g => data.goals[g.key]?.awarded).length;
    const badge = $('#goals-badge');
    if (badge) { badge.hidden = done >= GOALS.length; badge.textContent = GOALS.length - done; }
  }

  /* ============================================================
     13. СТИКЕРЫ
     ============================================================ */
  function awardStickers(n) {
    const un = STICKERS.filter(s => !S.stickers[s.id]);
    const awarded = [];
    for (let i = 0; i < n; i++) {
      let pool = un.filter(s => !awarded.includes(s));
      if (!pool.length) pool = STICKERS;
      const s = pick(pool);
      S.stickers[s.id] = (S.stickers[s.id] || 0) + 1;
      awarded.push(s);
    }
    saveLocal(); return awarded;
  }

  /* ============================================================
     14. SPEECH
     ============================================================ */
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }

  /* ============================================================
     15. TOAST
     ============================================================ */
  function toast(msg, color) {
    const el = document.createElement('div');
    el.className = 'toast' + (color ? ' ' + color : '');
    el.textContent = msg;
    $('#toast-container').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-10px)'; setTimeout(() => el.remove(), 300); }, 3000);
  }

  /* ============================================================
     16. СТИКЕРЫ И РЫЦАРЬ (данные)
     ============================================================ */
  const STICKERS = [
    { id: 's1', emoji: '🔵', name: 'Крош' }, { id: 's2', emoji: '🟡', name: 'Ёжик' },
    { id: 's3', emoji: '🦇', name: 'Бэтмен' }, { id: 's4', emoji: '🕷️', name: 'Человек-паук' },
    { id: 's5', emoji: '🟩', name: 'Крипер' }, { id: 's6', emoji: '⛏️', name: 'Стив' },
    { id: 's7', emoji: '⚡', name: 'Пикачу' }, { id: 's8', emoji: '🦖', name: 'Тираннозавр' },
    { id: 's9', emoji: '🚀', name: 'Ракета' }, { id: 's10', emoji: '🏴‍☠️', name: 'Пират' },
    { id: 's11', emoji: '🥷', name: 'Ниндзя' }, { id: 's12', emoji: '🐼', name: 'Панда' },
    { id: 's13', emoji: '🚗', name: 'Машина' }, { id: 's14', emoji: '🤖', name: 'Робот' },
    { id: 's15', emoji: '⚽', name: 'Футбол' }, { id: 's16', emoji: '👾', name: 'Монстрик' },
    { id: 's17', emoji: '📱', name: 'Телефон' }, { id: 's18', emoji: '🔨', name: 'Молоток' },
    { id: 's19', emoji: '🦸‍♂️🐻', name: 'Супермедведь' }
  ];

  const CATEGORY_NAMES = {
    sword: 'Меч', shield: 'Щит', helmet: 'Шлем', armor: 'Доспех',
    horse: 'Конь', castle: 'Замок', relic: 'Реликвии'
  };

  const KNIGHT_ITEMS = [
    { id: 'sword_1', cat: 'sword', tier: 1, emoji: '🗡️', name: 'Деревянный меч' },
    { id: 'sword_2', cat: 'sword', tier: 2, emoji: '⚔️', name: 'Железный меч' },
    { id: 'sword_3', cat: 'sword', tier: 3, emoji: '🔱', name: 'Боевое копьё' },
    { id: 'sword_4', cat: 'sword', tier: 4, emoji: '⚒️', name: 'Боевой молот' },
    { id: 'sword_5', cat: 'sword', tier: 5, emoji: '🪓', name: 'Секира героя' },
    { id: 'shield_1', cat: 'shield', tier: 1, emoji: '🪵', name: 'Деревянный щит' },
    { id: 'shield_2', cat: 'shield', tier: 2, emoji: '🛡️', name: 'Железный щит' },
    { id: 'shield_3', cat: 'shield', tier: 3, emoji: '🧿', name: 'Хрустальный щит' },
    { id: 'shield_4', cat: 'shield', tier: 4, emoji: '💠', name: 'Щит дракона' },
    { id: 'helmet_1', cat: 'helmet', tier: 1, emoji: '⛑️', name: 'Кожаный шлем' },
    { id: 'helmet_2', cat: 'helmet', tier: 2, emoji: '🪖', name: 'Железный шлем' },
    { id: 'helmet_3', cat: 'helmet', tier: 3, emoji: '👑', name: 'Корона рыцаря' },
    { id: 'armor_1', cat: 'armor', tier: 1, emoji: '👕', name: 'Кожаная туника' },
    { id: 'armor_2', cat: 'armor', tier: 2, emoji: '🥋', name: 'Кольчуга' },
    { id: 'armor_3', cat: 'armor', tier: 3, emoji: '🦺', name: 'Стальные латы' },
    { id: 'horse_1', cat: 'horse', tier: 1, emoji: '🐴', name: 'Пони' },
    { id: 'horse_2', cat: 'horse', tier: 2, emoji: '🐎', name: 'Боевой конь' },
    { id: 'horse_3', cat: 'horse', tier: 3, emoji: '🏇', name: 'Королевский скакун' },
    { id: 'castle_1', cat: 'castle', tier: 1, emoji: '🏕️', name: 'Лагерь' },
    { id: 'castle_2', cat: 'castle', tier: 2, emoji: '🏠', name: 'Сторожевая башня' },
    { id: 'castle_3', cat: 'castle', tier: 3, emoji: '🏯', name: 'Крепость' },
    { id: 'castle_4', cat: 'castle', tier: 4, emoji: '🏰', name: 'Рыцарский замок' },
    { id: 'relic_1', cat: 'relic', tier: 2, emoji: '🧿', name: 'Амулет удачи' },
    { id: 'relic_2', cat: 'relic', tier: 3, emoji: '💎', name: 'Драгоценный камень' },
    { id: 'relic_3', cat: 'relic', tier: 3, emoji: '🏆', name: 'Священный Грааль' },
    { id: 'relic_4', cat: 'relic', tier: 4, emoji: '📿', name: 'Чётки мудрости' },
    { id: 'relic_5', cat: 'relic', tier: 5, emoji: '⚱️', name: 'Древняя ваза' }
  ];

  /* ============================================================
     17. ИНИЦИАЛИЗАЦИЯ
     ============================================================ */
  async function init() {
    $('#loading-text').textContent = 'Загрузка словаря…';
    await loadVocabulary();
    await loadGrammar();
    $('#loading-text').textContent = 'Подключение…';
    S.supabase = await initSupabase();
    if (S.supabase && !S.user) {
      showScreen('auth');
    } else {
      renderHome();
    }
    bindEvents();
  }

	  /* ============================================================
     СБРОС ПАРОЛЯ
     ============================================================ */
  async function sendResetEmail() {
    const email = $('#auth-email').value.trim();
    if (!email) { toast('Введите email', 'gold'); return; }
    if (!S.supabase) { toast('Supabase не настроен', 'gold'); return; }

    const { error } = await S.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });

    if (error) {
      $('#auth-error').textContent = error.message;
    } else {
      toast('Письмо для сброса пароля отправлено!', 'gold');
      $('#auth-error').textContent = 'Проверьте почту';
    }
  }

  async function handlePasswordReset(newPassword) {
    if (newPassword.length < 6) {
      $('#reset-error').textContent = 'Пароль должен быть не менее 6 символов';
      return;
    }
    if (!S.supabase) return;

    const { error } = await S.supabase.auth.updateUser({ password: newPassword });
    if (error) {
      $('#reset-error').textContent = error.message;
    } else {
      toast('Пароль успешно изменён! Теперь можно войти.', 'gold');
      showScreen('home');
      renderHome();
    }
  }

    function bindEvents() {
    // Auth
    $('#auth-submit').addEventListener('click', authSubmit);
    $('#auth-switch').addEventListener('click', () => {
      const t = $('#auth-title');
      t.textContent = t.textContent === 'Вход' ? 'Регистрация' : 'Вход';
      $('#auth-sub').textContent = t.textContent === 'Регистрация' ? 'Создай аккаунт, чтобы сохранять прогресс' : 'Войди в аккаунт';
      $('#auth-error').textContent = '';
    });
    $('#auth-skip').addEventListener('click', () => { showScreen('home'); renderHome(); });
    $('#btn-logout').addEventListener('click', logout);
    
	    // Внутри bindEvents() добавьте:
    $('#btn-speak').addEventListener('click', pronounceCurrent); // Для микрофона
	
	    // Обработчик кнопки "Забыли пароль?"
    $('#auth-forgot').addEventListener('click', sendResetEmail);

    // Обработчик сохранения нового пароля
    $('#btn-reset-submit').addEventListener('click', () => {
      handlePasswordReset($('#reset-password').value);
    });
	
    // ДОБАВЛЯЕМ КНОПКУ ВОЙТИ:
    $('#btn-login').addEventListener('click', () => {
      if (!S.supabase) {
        toast('Supabase не настроен. Проверьте config.js', 'gold');
        return;
      }
      showScreen('auth');
    });

    // Home
    $$('.home-btn').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'quiz' || m === 'learn') startTopics(m);
      else if (m === 'review') startReview();
      else if (m === 'grammar') renderGrammarList();
      else if (m === 'dictionary') renderDictionary();
      else if (m === 'goals') renderGoals();
      else if (m === 'knight') renderKnight();
      else if (m === 'stickers') renderStickers();
      else if (m === 'history') renderHistory();
    }));

    // Topics
    $('#btn-topics-start').addEventListener('click', () => {
      if (S.mode === 'quiz') startQuiz(); else startLearn();
    });
    $('#btn-topics-back').addEventListener('click', () => showScreen('home'));

    // Learn
    $('#btn-learn-next').addEventListener('click', nextLearn);
    $('#btn-listen').addEventListener('click', () => { const w = S.learnQueue[S.learnIdx]; if (w) speak(w.en); });

    // Review
    $$('.review-buttons .btn').forEach(b => b.addEventListener('click', () => reviewAnswer(Number(b.dataset.q))));

    // Grammar back
    $('#btn-grammar-back').addEventListener('click', () => showScreen('home'));

    // Dictionary
    $('#btn-dict-back').addEventListener('click', () => showScreen('home'));
    $('#btn-dict-practice').addEventListener('click', () => { S.mode = 'quiz'; startTopics('quiz'); });

    // Goals / Knight
    $('#btn-goals-back').addEventListener('click', () => showScreen('home'));
    $('#btn-goals-knight').addEventListener('click', () => renderKnight());
    $('#btn-knight-back').addEventListener('click', () => showScreen('home'));
    $('#btn-knight-goals').addEventListener('click', () => renderGoals());
  }

  /* ============================================================
     РАСПОЗНАВАНИЕ РЕЧИ (Speech Recognition)
     ============================================================ */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }

  function pronounceCurrent() {
    const w = S.learnQueue[S.learnIdx];
    if (!w) return;
    
    // Проверка поддержки
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      $('#pron-result').innerHTML = '<div class="pron-result fail">🎤 Браузер не поддерживает микрофон. Используйте Chrome или Edge.</div>';
      return;
    }

    const btn = $('#btn-speak');
    btn.disabled = true;
    btn.classList.add('listening');
    btn.textContent = '🎤 Слушаю...';
    $('#pron-result').innerHTML = '';
    window.speechSynthesis.cancel();

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s']/g, '').trim().replace(/\s+/g, ' ');
      const targetNorm = norm(w.en);
      const transcriptNorm = norm(transcript);
      const dist = levenshtein(targetNorm, transcriptNorm);
      const maxLen = Math.max(targetNorm.length, transcriptNorm.length, 1);
      
      let html = '';
      if (dist === 0) {
        html = `<div class="pron-result ok">✅ Отлично! Я услышал: «${transcript}»</div>`;
        speak('Correct!');
      } else if (dist <= 2 && (1 - dist / maxLen) >= 0.75) {
        html = `<div class="pron-result almost">⚠️ Почти! Я услышал: «${transcript}»<small>Попробуй ещё раз.</small></div>`;
      } else {
        html = `<div class="pron-result fail">❌ Не совпало. Я услышал: «${transcript}»<small>Послушай и повтори.</small></div>`;
      }
      $('#pron-result').innerHTML = html;
    };

    rec.onerror = (e) => {
      $('#pron-result').innerHTML = `<div class="pron-result fail">🎤 Ошибка: ${e.error}. Разрешите доступ к микрофону.</div>`;
    };

    rec.onend = () => {
      btn.disabled = false;
      btn.classList.remove('listening');
      btn.textContent = '🎤 Сказать';
    };

    rec.start();
  }

  /* ============================================================
     ОТРИСОВКА ЦЕЛЕЙ И РЫЦАРЯ
     ============================================================ */
	 
    /* ============================================================
     ОТРИСОВКА ЦЕЛЕЙ И РЫЦАРЯ
     ============================================================ */
  function renderGoals() {
    // Безопасная инициализация структуры данных
    if (!S.weekly || typeof S.weekly !== 'object') S.weekly = {};
    const wk = new Date(weekStart()).toISOString().slice(0, 10);
    if (!S.weekly[wk]) S.weekly[wk] = { goals: {}, bonus: false };
    if (!S.weekly[wk].goals) S.weekly[wk].goals = {};
    
    const data = S.weekly[wk];
    const daysLeft = 7 - Math.floor((Date.now() - weekStart()) / (1000 * 60 * 60 * 24));
    
    $('#goals-banner').innerHTML = `Неделя с <b>${fmtDate(weekStart())}</b> · осталось дней: <b>${Math.max(0, daysLeft)}</b><br>За каждую цель — <b>предмет рыцаря</b>. За все три — <b>легендарный бонус</b>!`;
    
    const list = $('#goals-list');
    list.innerHTML = '';
    
    GOALS.forEach(g => {
      const cur = data.goals[g.key] || { awarded: false };
      const prog = getGoalProgress(g.key);
      const pctDone = Math.min(100, Math.round(prog / g.target * 100));
      const done = cur.awarded;
      
      const card = document.createElement('div');
      card.className = 'goal-card' + (done ? ' done' : '');
      card.innerHTML = `
        <div class="goal-head">
          <div class="goal-title"><span class="goal-emoji">${g.emoji}</span>${g.title}</div>
          <div class="goal-reward${done ? ' done' : ''}">${done ? '✓ Выполнено' : '🎁 +предмет'}</div>
        </div>
        <div class="goal-progress-wrap"><div class="goal-progress-bar" style="width:${pctDone}%"></div></div>
        <div class="goal-progress-text"><span>${Math.min(prog, g.target)} / ${g.target}</span><span class="pct">${pctDone}%</span></div>
      `;
      list.appendChild(card);
    });
    showScreen('goals');
  }

  function renderKnight() {
    // Защита от пустых данных
    if (!Array.isArray(S.knight)) S.knight = [];
    
    const ownedSet = {};
    S.knight.forEach(id => ownedSet[id] = true);
    const total = KNIGHT_ITEMS.length;
    const have = S.knight.length;

    const bestOf = (cat) => {
      const items = KNIGHT_ITEMS.filter(i => i.cat === cat && ownedSet[i.id]);
      return items.length ? items.sort((a, b) => b.tier - a.tier)[0] : null;
    };

    const castle = bestOf('castle'), armor = bestOf('armor'), horse = bestOf('horse');
    const sword = bestOf('sword'), shield = bestOf('shield'), helmet = bestOf('helmet'), relic = bestOf('relic');

    $('#scene-castle').textContent = castle ? castle.emoji : '🏕️';
    $('#scene-knight').textContent = armor ? armor.emoji : '🤺';
    $('#scene-horse').textContent = horse ? horse.emoji : '—';
    
    let weapons = [];
    if (sword) weapons.push(sword.emoji);
    if (shield) weapons.push(shield.emoji);
    if (helmet) weapons.push(helmet.emoji);
    if (relic) weapons.push(relic.emoji);
    $('#scene-weapons').textContent = weapons.length ? weapons.join(' ') : '—';
    $('#scene-label').textContent = have === 0 ? 'Выполни цели недели — собери снаряжение!' : `Предметов собрано: ${have} из ${total}`;
    $('#knight-summary').innerHTML = `Всего предметов: <b>${have} из ${total}</b> (${Math.round(have / total * 100)}%)<br>Собери всю коллекцию — стань <b>легендарным рыцарем</b>!`;

    const cats = ['sword', 'shield', 'helmet', 'armor', 'horse', 'castle', 'relic'];
    const catBox = $('#knight-categories');
    catBox.innerHTML = '';

    cats.forEach(cat => {
      const items = KNIGHT_ITEMS.filter(i => i.cat === cat);
      const catOwned = items.filter(i => ownedSet[i.id]).length;
      const catWrap = document.createElement('div');
      catWrap.className = 'knight-cat';
      catWrap.innerHTML = `<div class="knight-cat-head"><span>${CATEGORY_NAMES[cat] || cat}</span><span class="cat-progress">${catOwned}/${items.length}</span></div>`;
      
      const grid = document.createElement('div');
      grid.className = 'knight-item-grid';
      items.forEach(it => {
        const isOwned = !!ownedSet[it.id];
        const el = document.createElement('div');
        el.className = 'knight-item' + (isOwned ? ' owned tier-' + it.tier : ' locked');
        el.innerHTML = `
          <span class="ki-emoji">${isOwned ? it.emoji : '❓'}</span>
          <span class="ki-name">${isOwned ? it.name : '???'}</span>
          ${isOwned ? '<span class="ki-check">✓</span>' : ''}
        `;
        grid.appendChild(el);
      });
      catWrap.appendChild(grid);
      catBox.appendChild(catWrap);
    });
    showScreen('knight');
  }
  // Запуск
  init();
})();