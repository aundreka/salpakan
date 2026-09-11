import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getDatabase, ref, get, set, update, push, onChildAdded, onValue, onDisconnect,
  serverTimestamp, runTransaction, query, orderByKey, startAfter, type Database, type DatabaseReference,
} from 'firebase/database';
import type { Rules, Team } from '../engine/types';
import type { LogMsg, Msg, Players, RoomMeta } from './protocol';
import { PROTOCOL_VERSION, generateCode, isValidCode } from './protocol';
import type { Transport } from './transport';

let app: FirebaseApp | null = null;
let db: Database | null = null;
let uidPromise: Promise<string> | null = null;

export function firebaseConfigured(): boolean {
  return typeof import.meta.env.VITE_FIREBASE_CONFIG === 'string' && import.meta.env.VITE_FIREBASE_CONFIG.length > 0;
}

async function connect(): Promise<{ db: Database; uid: string }> {
  if (!firebaseConfigured()) throw new Error('Online play is not configured on this build.');
  if (!app) {
    const cfg = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG as string);
    app = initializeApp(cfg);
    db = getDatabase(app);
  }
  if (!uidPromise) {
    const auth = getAuth(app);
    uidPromise = (auth.currentUser
      ? Promise.resolve(auth.currentUser.uid)
      : signInAnonymously(auth).then((cred) => cred.user.uid)
    ).catch((e) => {
      uidPromise = null;
      throw friendly(e);
    });
  }
  return { db: db!, uid: await uidPromise };
}

function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('permission') || code.includes('PERMISSION_DENIED')) {
    return new Error('The database refused the request. The Firebase rules for this project need to allow rooms (see README).');
  }
  if (code.includes('auth/')) return new Error(`Sign-in failed (${code}). Enable Anonymous sign-in in the Firebase console.`);
  return e instanceof Error ? e : new Error(String(e));
}

export async function hostRoom(rules: Rules, name: string): Promise<Transport> {
  const { db, uid } = await connect();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode();
    const roomRef = ref(db, `rooms/${code}`);
    try {
      const existing = await get(ref(db, `rooms/${code}/meta`));
      if (existing.exists()) continue;
      const meta: RoomMeta = { hostUid: uid, rules, createdAt: Date.now(), protocol: PROTOCOL_VERSION };
      // Multi-path update: each path is checked against its own rule. A single set() at the
      // room root would need a write rule at rooms/$code, which the rules deliberately omit.
      await update(roomRef, {
        meta: { ...meta, createdAt: serverTimestamp() },
        'players/A': { uid, name, connected: true },
      });
      return makeTransport(db, code, uid, uid, 'A', rules);
    } catch (e) {
      throw friendly(e);
    }
  }
  throw new Error('Could not find a free room code. Try again.');
}

export async function joinRoom(codeInput: string, name: string): Promise<Transport> {
  const code = codeInput.toUpperCase();
  if (!isValidCode(code)) throw new Error('That is not a valid room code.');
  const { db, uid } = await connect();
  try {
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) throw new Error('No room with that code. Check the letters and try again.');
    const room = snap.val() as { meta: RoomMeta; players?: Players };
    const players = room.players ?? {};
    let team: Team;
    if (players.A?.uid === uid) team = 'A';
    else if (players.B?.uid === uid) team = 'B';
    else if (!players.B) {
      const res = await runTransaction(ref(db, `rooms/${code}/players/B`), (cur) => (cur ? undefined : { uid, name, connected: true }));
      if (!res.committed) throw new Error('Someone else took the seat a moment ago. This room is full.');
      team = 'B';
    } else {
      throw new Error('This room already has two players.');
    }
    return makeTransport(db, code, uid, room.meta.hostUid, team, room.meta.rules);
  } catch (e) {
    throw friendly(e);
  }
}

function makeTransport(db: Database, code: string, uid: string, hostUid: string, team: Team, rules: Rules): Transport {
  const msgsRef = ref(db, `rooms/${code}/msgs`);
  const meRef = ref(db, `rooms/${code}/players/${team}`);
  let offset = 0;
  const offOffset = onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = (s.val() as number) ?? 0; });

  void update(meRef, { connected: true });
  void onDisconnect(meRef).update({ connected: false });

  const cleanups: (() => void)[] = [offOffset];

  return {
    code, uid, hostUid, team, rules, isLocal: false,
    send(msg) {
      // Defer so a message sent from inside a handler is delivered after the current one finishes.
      Promise.resolve().then(() => set(push(msgsRef), { uid, t: serverTimestamp(), ...msg })).catch((e) => {
        console.error('send failed', e);
        window.dispatchEvent(new CustomEvent('salpakan:error', { detail: friendly(e).message }));
      });
    },
    subscribe(onMsg, onSynced) {
      let stopped = false;
      let offLive: (() => void) | null = null;
      const toLog = (key: string, val: Record<string, unknown>): LogMsg => {
        const { uid: from, t, ...rest } = val;
        return { key, uid: String(from), t: typeof t === 'number' ? t : Date.now() + offset, msg: rest as Msg };
      };
      get(query(msgsRef, orderByKey())).then((snap) => {
        if (stopped) return;
        let lastKey: string | null = null;
        snap.forEach((child) => {
          lastKey = child.key;
          onMsg(toLog(child.key, child.val()), false);
        });
        onSynced();
        const liveQuery = lastKey ? query(msgsRef, orderByKey(), startAfter(lastKey)) : query(msgsRef, orderByKey());
        offLive = onChildAdded(liveQuery, (child) => onMsg(toLog(child.key!, child.val()), true), (e) => {
          window.dispatchEvent(new CustomEvent('salpakan:error', { detail: friendly(e).message }));
        });
      }).catch((e) => window.dispatchEvent(new CustomEvent('salpakan:error', { detail: friendly(e).message })));
      const off = () => { stopped = true; offLive?.(); };
      cleanups.push(off);
      return off;
    },
    onPlayers(cb) {
      const off = onValue(ref(db, `rooms/${code}/players`), (s) => cb((s.val() as Players) ?? {}));
      cleanups.push(off);
      return off;
    },
    now: () => Date.now() + offset,
    leave() {
      cleanups.forEach((f) => f());
      void update(meRef, { connected: false });
    },
  };
}

export type { DatabaseReference };
