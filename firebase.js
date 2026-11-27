// firebase.js - Conexión de SPORTX con Firebase (Authentication + Cloud Firestore)
// Se carga con: <script type="module" src="firebase.js"></script>
// Expone window.SportXCloud para usarlo desde index.html sin cambiar tu estructura.

const SDK = '10.14.1';

// 1) PEGA AQUÍ el bloque firebaseConfig de tu proyecto (Configuración del proyecto > Tus apps > Web).
const CONFIG = {
  apiKey: 'AIzaSyBLMlKZ4htgZhSVZd0hlbREcfiuEyJHRxQ',
  authDomain: 'sports-x-ba9fc.firebaseapp.com',
  projectId: 'sports-x-ba9fc',
  storageBucket: 'sports-x-ba9fc.firebasestorage.app',
  messagingSenderId: '49701033485',
  appId: '1:49701033485:web:c59ad32dc6446acb54a744'
};

const SPORTS = ['futbol', 'voleibol', 'basquetbol', 'general'];

/* ---------- Funciones puras (se pueden probar sin Firebase) ---------- */
export const calcXp = (series) => 30 + 10 * series;                 // regla de XP
export const calcLevel = (xp) => Math.floor(xp / 200) + 1;          // nivel cada 200 XP
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;                     // nombre de usuario válido
export const normSport = (s) => String(s || 'general').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const slugName = (s) => (String(s || 'atleta').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, 14).replace(/_+$/, '') || 'atleta');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function nextStreak(lastDay, streak, today = new Date()) {
  const t = dayKey(today);
  if (lastDay === t) return streak || 1;
  const y = new Date(today); y.setDate(y.getDate() - 1);
  return lastDay === dayKey(y) ? (streak || 0) + 1 : 1;
}
export const pairId = (a, b) => [a, b].sort().join('_');

const withTimeout = (p, ms, msg = 'timeout') => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(msg), { code: 'timeout' })), ms))]);

/* ---------- Carga del SDK (si no hay internet, la app sigue funcionando local) ---------- */
let A, F, auth, db, ready = null;
function load() {
  if (ready) return ready;
  ready = (async () => {
    if (CONFIG.apiKey === 'PEGA_AQUI') throw new Error('Falta pegar el firebaseConfig en firebase.js');
    const base = `https://www.gstatic.com/firebasejs/${SDK}/`;
    const [app, a, f] = await withTimeout(Promise.all([
      import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')
    ]), 12000, 'No se pudo cargar Firebase');
    const fb = app.initializeApp(CONFIG);
    A = a; F = f; auth = a.getAuth(fb); db = f.getFirestore(fb);
    auth.languageCode = 'es';
    return true;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/* ---------- Sesión ---------- */
async function onAuth(cb) {
  try { await load(); } catch (e) { cb(null, e); return () => {}; }
  return A.onAuthStateChanged(auth, async (u) => {
    if (u) { try { await withTimeout(ensureProfile(u), 8000); } catch (e) { console.warn('Perfil:', e); } }
    cb(u, null);
  });
}
async function loginWith(provider) { await load(); const r = await A.signInWithPopup(auth, provider); return r.user; }
// Google: popup en el navegador; redirección si la app está instalada (PWA) o el popup está bloqueado.
const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
const REDIRECT_CODES = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];
const google = async () => {
  await load();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (standalone()) { await A.signInWithRedirect(auth, provider); return null; }
  try { return (await A.signInWithPopup(auth, provider)).user; }
  catch (e) {
    if (REDIRECT_CODES.includes(e.code)) { await A.signInWithRedirect(auth, provider); return null; }
    throw e;
  }
};
// Al volver de la redirección, avisa si Google devolvió un error (dominio no autorizado, etc.).
async function onRedirectError(cb) { try { await load(); await A.getRedirectResult(auth); } catch (e) { cb(e); } }
const facebook = async () => { await load(); return loginWith(new A.FacebookAuthProvider()); };
async function emailSignUp(email, password, name) {
  await load();
  const r = await A.createUserWithEmailAndPassword(auth, email, password);
  if (name) await A.updateProfile(r.user, { displayName: name });
  return r.user;
}
async function emailSignIn(email, password) { await load(); return (await A.signInWithEmailAndPassword(auth, email, password)).user; }
async function resetPassword(email) { await load(); return A.sendPasswordResetEmail(auth, email); }
async function logout() { await load(); return A.signOut(auth); }
const me = () => auth && auth.currentUser;

/* ---------- Perfil público (profiles/{uid}) ---------- */
async function ensureProfile(user) {
  const ref = F.doc(db, 'profiles', user.uid);
  if ((await F.getDoc(ref)).exists()) return;
  const base = slugName(user.displayName || (user.email || '').split('@')[0]);
  for (let i = 0; i < 6; i++) {
    const username = (base + (i === 0 ? '' : '_' + Math.floor(1000 + Math.random() * 9000))).slice(0, 20).padEnd(3, '_');
    if (!USERNAME_RE.test(username)) continue;
    try {
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'usernames', username), { uid: user.uid });
      b.set(ref, {
        username, displayName: user.displayName || username, photo: user.photoURL || null,
        xp: 0, level: 1, workouts: 0, streak: 0, lastDay: null, lastWorkoutId: null,
        sportXp: { futbol: 0, voleibol: 0, basquetbol: 0, general: 0 },
        createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
      });
      await b.commit();
      return;
    } catch (e) { if (i === 5) throw e; }   // nombre ocupado: reintenta con otro sufijo
  }
}
async function getProfile(uid) { await load(); const s = await F.getDoc(F.doc(db, 'profiles', uid || me().uid)); return s.exists() ? { uid: s.id, ...s.data() } : null; }
async function saveProfile({ displayName, photo }) {
  await load();
  const data = { updatedAt: F.serverTimestamp() };
  if (displayName !== undefined) data.displayName = String(displayName).slice(0, 40);
  if (photo !== undefined) data.photo = photo;       // data URL pequeña (~128 px) o URL
  return F.updateDoc(F.doc(db, 'profiles', me().uid), data);
}

/* ---------- Entrenamientos y XP ---------- */
async function saveWorkout({ id, at, exercise, sport, place, series, reps, durationSec }) {
  await load();
  const uid = me().uid, sp = normSport(sport), xp = calcXp(series);
  const pRef = F.doc(db, 'profiles', uid);
  const wRef = id ? F.doc(db, 'workouts', uid, 'items', String(id)) : F.doc(F.collection(db, 'workouts', uid, 'items'));   // id fijo = no se duplica la XP
  await F.runTransaction(db, async (tx) => {
    const p = (await tx.get(pRef)).data();
    if ((await tx.get(wRef)).exists()) return;          // ya estaba sincronizado: no sumar otra vez
    const total = p.xp + xp;
    const when = at ? new Date(at) : new Date(), day = dayKey(when);
    const keep = p.lastDay && day < p.lastDay;          // entreno viejo: no rompe la racha
    tx.set(wRef, { exercise, sport: sp, place: place || null, series, reps: reps || null, durationSec: durationSec || 0, xp, createdAt: F.serverTimestamp() });
    tx.update(pRef, {
      xp: total, level: calcLevel(total), workouts: p.workouts + 1,
      [`sportXp.${sp}`]: (p.sportXp[sp] || 0) + xp,
      streak: keep ? p.streak : nextStreak(p.lastDay, p.streak, when), lastDay: keep ? p.lastDay : day, lastWorkoutId: wRef.id,
      updatedAt: F.serverTimestamp()
    });
  });
  return { id: wRef.id, xp };
}
async function history(n = 30) {
  await load();
  const q = F.query(F.collection(db, 'workouts', me().uid, 'items'), F.orderBy('createdAt', 'desc'), F.limit(n));
  return (await F.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function resetAll() {
  await load();
  const uid = me().uid;
  const items = await F.getDocs(F.collection(db, 'workouts', uid, 'items'));
  await Promise.all(items.docs.map((d) => F.deleteDoc(d.ref)));
  return F.updateDoc(F.doc(db, 'profiles', uid), {
    xp: 0, level: 1, workouts: 0, streak: 0, lastDay: null, lastWorkoutId: null,
    sportXp: { futbol: 0, voleibol: 0, basquetbol: 0, general: 0 }, updatedAt: F.serverTimestamp()
  });
}

/* ---------- Ranking en línea ---------- */
// sport: 'global' | 'futbol' | 'voleibol' | 'basquetbol' | 'general'
async function ranking(sport = 'global', n = 20) {
  await load();
  const field = sport === 'global' ? 'xp' : `sportXp.${normSport(sport)}`;
  const q = F.query(F.collection(db, 'profiles'), F.orderBy(field, 'desc'), F.limit(n));
  return (await F.getDocs(q)).docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .map((p) => ({ ...p, score: sport === 'global' ? p.xp : (p.sportXp || {})[normSport(sport)] || 0 }))
    .filter((p) => p.score > 0);
}

/* ---------- Amigos (friendships/{uidA_uidB}) ---------- */
async function sendFriendRequest(username) {
  await load();
  const u = await F.getDoc(F.doc(db, 'usernames', String(username).trim().toLowerCase()));
  if (!u.exists()) throw new Error('No existe ese nombre de usuario');
  const other = u.data().uid, mine = me().uid;
  if (other === mine) throw new Error('No puedes agregarte a ti mismo');
  return F.setDoc(F.doc(db, 'friendships', pairId(mine, other)), {
    users: [mine, other], requester: mine, status: 'pending', createdAt: F.serverTimestamp()
  });
}
async function friendships() {
  await load();
  const q = F.query(F.collection(db, 'friendships'), F.where('users', 'array-contains', me().uid));
  const rows = (await F.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
  return Promise.all(rows.map(async (r) => {
    const other = r.users.find((x) => x !== me().uid);
    return { ...r, other: await getProfile(other), incoming: r.status === 'pending' && r.requester !== me().uid };
  }));
}
async function acceptFriend(id) { await load(); return F.updateDoc(F.doc(db, 'friendships', id), { status: 'accepted' }); }
async function removeFriend(id) { await load(); return F.deleteDoc(F.doc(db, 'friendships', id)); }
async function friendsRanking() {
  const list = (await friendships()).filter((f) => f.status === 'accepted' && f.other).map((f) => f.other);
  const mine = await getProfile();
  return [mine, ...list].sort((a, b) => b.xp - a.xp);
}

window.SportXCloud = {
  onAuth, onRedirectError, google, facebook, emailSignUp, emailSignIn, resetPassword, logout, me,
  getProfile, saveProfile, saveWorkout, history, resetAll, ranking,
  sendFriendRequest, friendships, acceptFriend, removeFriend, friendsRanking,
  util: { calcXp, calcLevel, nextStreak, USERNAME_RE, normSport, slugName, pairId }
};
