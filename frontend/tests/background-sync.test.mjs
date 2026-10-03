import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
    console: { info() {}, warn() {} }, Date, Set, Map,
  }, { filename: path });
  return module.exports;
}
class ApiError extends Error {
  constructor(status, kind) { super(kind); this.status = status; this.kind = kind; this.bodySnippet = null; }
}
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-sync-'));
  const file = join(dir, 'mnores.db');
  const files = new Set(['photo.jpg']);
  let serial = 0;
  const handles = [];
  let localStore;
  let scheduled = 0;
  const fs = { getInfoAsync: async path => ({ exists: files.has(path) }), deleteAsync: async path => files.delete(path) };
  function openStore() {
    const sqlite = {
      openDatabaseAsync: async () => {
        const db = new DatabaseSync(file); handles.push(db);
        const args = values => Array.isArray(values[0]) ? values[0] : values;
        return {
          execAsync: async sql => db.exec(sql),
          runAsync: async (sql, ...values) => db.prepare(sql).run(...args(values)),
          getFirstAsync: async (sql, ...values) => db.prepare(sql).get(...args(values)) ?? null,
          getAllAsync: async (sql, ...values) => db.prepare(sql).all(...args(values)),
          withTransactionAsync: async fn => {
            db.exec('BEGIN');
            try { await fn(); db.exec('COMMIT'); }
            catch (error) { db.exec('ROLLBACK'); throw error; }
          },
        };
      },
    };
    localStore = load('src/database/store.ts', {
      'expo-sqlite': sqlite, 'expo-file-system/legacy': fs,
      '@/src/utils/id': { newQueueId: () => `queue-${++serial}` },
      '@/src/services/sync/backgroundScheduling': { reconcileBackgroundSync: async () => { scheduled++; } },
    }).localStore;
    return localStore;
  }
  await openStore().init();
  await localStore.saveSession({ id: 1, username: 'mechanic', role: 'mechanic', boat_id: 1 });
  const server = new Map();
  const events = [];
  let failure = null;
  let pushStatus = "ok";
  let identityId = 1;
  let identityError = null;
  let loseResponse = false;
  let photoFailure = null;
  let lockTail = Promise.resolve();
  const locked = async fn => {
    const previous = lockTail;
    let release;
    lockTail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };
  function engine() {
    return load('src/services/sync/syncEngine.ts', {
      './nativeBackground': { withSyncLock: locked },
      './backgroundScheduling': { reconcileBackgroundSync: async () => { scheduled++; } },
      '@/src/utils/storage': { storage: { secureGet: async () => 'token' } },
      '@/src/constants/storage': { TOKEN_KEY: 'token-key' },
      '@/src/services/serverConfig': { initializeServerConfig: async () => {} },
      '@/src/services/api/client': { ApiError },
      '@/src/database/store': { localStore },
      '@/src/services/photos/photoService': {
        photoExists: async path => files.has(path),
        uploadPartPhoto: async (_token, id) => {
          events.push(`photo:${id}`);
          if (photoFailure) throw photoFailure;
          return { updated_at: '2026-10-03T12:00:00Z' };
        },
      },
      '@/src/services/api/endpoints': {
        apiGetMe: async () => { if (identityError) throw identityError; return { id: identityId }; },
        apiPush: async (_token, [change]) => {
          events.push(change.action);
          if (failure) throw failure;
          let id = change.id;
          if (change.action === 'create') {
            if (!server.has(change.local_id)) server.set(change.local_id, { ...change, id: server.size + 100 });
            id = server.get(change.local_id).id;
          }
          if (loseResponse) { loseResponse = false; throw new ApiError(0, 'network'); }
          return { ok: true, results: [{ action: change.action, id, local_id: change.local_id, status: pushStatus, updated_at: '2026-10-03T12:00:00Z' }] };
        },
        apiGetSync: async () => ({ server_time: '2026-10-03T12:00:00Z', parts: [...server.values()].map(p => ({ ...p, boat_id: 1, quantity: 1, deleted_at: null })) }),
        apiGetBoats: async () => [], apiGetUsers: async () => [], apiGetCategories: async () => [],
      },
    });
  }
  t.after(() => { for (const db of handles) db.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get store() { return localStore; }, engine, openStore, files, events, server, file,
    create: id => localStore.createPartLocal({ local_id: id, boat_id: 1, name: 'pump', quantity: 1 }),
    get scheduled() { return scheduled; },
    fail: error => { failure = error; }, photoFail: error => { photoFailure = error; },
    pushStatus: status => { pushStatus = status; }, identity: id => { identityId = id; }, identityFail: error => { identityError = error; },
    loseResponse: () => { loseResponse = true; },
  };
}

test('offline create/update survives a fresh SQLite instance, then drains with same runSync', async t => {
  const f = await fixture(t); const part = await f.create('stable-1');
  await f.store.updatePartLocal(part.row_uid, { quantity: 3 });
  f.fail(new ApiError(0, 'network'));
  assert.equal((await f.engine().runSync('token')).networkError, true);
  assert.equal(await f.store.getPendingCount(), 1);
  await f.openStore().init();
  assert.equal((await f.store.getPart(part.row_uid)).quantity, 3);
  f.fail(null); await f.engine().runSync('token');
  assert.equal(await f.store.getPendingCount(), 0);
  assert.equal(f.server.size, 1);
  assert.ok(f.scheduled >= 2);
});

test('lost create acknowledgment retains client_local_id across process restart, no duplicate', async t => {
  const f = await fixture(t); const part = await f.create('stable-idempotency');
  f.loseResponse(); await f.engine().runSync('token');
  assert.equal(f.server.size, 1); assert.equal(await f.store.getPendingCount(), 1);
  await f.openStore().init();
  await f.store.updatePartLocal(part.row_uid, { quantity: 9 });
  await f.engine().runSync('token');
  assert.equal(f.server.size, 1); assert.equal(await f.store.getPendingCount(), 0);
  assert.deepEqual(f.events, ['create', 'create', 'update']);
});

test('photo survives process interruption and is uploaded after its entity receives an id', async t => {
  const f = await fixture(t); const part = await f.create('with-photo');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
  await f.openStore().init(); await f.engine().runSync('token');
  assert.deepEqual(f.events, ['create', 'photo:100']);
  assert.equal(await f.store.getPendingCount(), 0);
  assert.equal(f.files.has('photo.jpg'), false); // deleted only after successful acknowledgment
});

for (const status of [401, 403]) {
  test(`HTTP ${status} retains operations`, async t => {
    const f = await fixture(t); await f.create(`auth-${status}`); f.fail(new ApiError(status, 'http'));
    assert.equal((await f.engine().runSync('token')).authError, true);
    assert.equal(await f.store.getPendingCount(), 1);
    assert.equal((await f.store.getPendingChanges())[0].status, 'pending');
  });
  test(`photo HTTP ${status} retains file and retry eligibility`, async t => {
    const f = await fixture(t); const part = await f.create(`photo-auth-${status}`);
    await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.photoFail(new ApiError(status, 'http'));
    assert.equal((await f.engine().runSync('token')).authError, true);
    assert.equal(await f.store.getPendingCount(), 1); assert.equal(f.files.has('photo.jpg'), true);
    assert.equal((await f.store.getPendingPhotos())[0].retry_count, 0);
    f.photoFail(null); await f.engine().runSync('token'); assert.equal(await f.store.getPendingCount(), 0);
  });
}

test('prolonged disconnection never exhausts the photo queue retry budget', async t => {
  const f = await fixture(t); const part = await f.create('long-offline');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.photoFail(new ApiError(0, 'network'));
  for (let i = 0; i < 10; i++) await f.engine().runSync('token');
  assert.equal(await f.store.getPendingCount(), 1);
  assert.equal((await f.store.getPendingPhotos())[0].retry_count, 0);
  assert.equal(f.files.has('photo.jpg'), true);
  f.photoFail(null); await f.engine().runSync('token'); assert.equal(await f.store.getPendingCount(), 0);
});

test('claims left by process death are recovered for operations and photos', async t => {
  const f = await fixture(t); const part = await f.create('crash');
  const [change] = await f.store.getPendingChanges(); await f.store.claimChange(change.queue_id);
  f.server.set('crash', { id: 100, name: 'pump', boat_id: 1, quantity: 1 });
  await f.store.applyCreateOk(change.queue_id, part.row_uid, 100, '2026-10-03T12:00:00Z');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
  const [photo] = await f.store.getPendingPhotos(); await f.store.claimPhoto(photo.queue_id);
  await f.openStore().init();
  assert.equal((await f.store.getPendingPhotos())[0].status, 'uploading');
  await f.engine().runSync('token'); assert.deepEqual(f.events, ['photo:100']);
  assert.equal(await f.store.getPendingCount(), 0);
});

test('server-backed deletion is preserved offline and drains after reconnect', async t => {
  const f = await fixture(t); const part = await f.create('delete'); await f.engine().runSync('token');
  await f.store.deletePartLocal(part.row_uid); f.fail(new ApiError(0, 'network'));
  await f.engine().runSync('token'); assert.equal(await f.store.getPendingCount(), 1);
  f.fail(null); await f.engine().runSync('token'); assert.equal(await f.store.getPendingCount(), 0);
  assert.equal(f.events.at(-1), 'delete');
});

test('expired execution budget retains all pending work for the next attempt', async t => {
  const f = await fixture(t); await f.create('deadline');
  await f.engine().runSync('token', { deadline: 0 });
  assert.equal(await f.store.getPendingCount(), 1); assert.deepEqual(f.events, []);
});

test('foreground and headless passes use serialization instead of sending twice', async t => {
  const f = await fixture(t); await f.create('concurrent'); const engine = f.engine();
  await Promise.all([engine.runSync('token'), engine.runSync('token')]);
  assert.deepEqual(f.events, ['create']); assert.equal(await f.store.getPendingCount(), 0);
});

const { executeBackgroundSync } = load('src/services/sync/backgroundRunner.ts', {});
for (const scenario of ['empty', 'pending', 'drained', 'auth', 'no-token', 'exception']) {
  test(`headless runner outcome: ${scenario}`, async () => {
    let count = scenario === 'empty' ? 0 : 1;
    let paused = false; let called = false;
    const result = await executeBackgroundSync({
      initialize: async () => {},
      restore: async () => ({ token: scenario === 'no-token' ? null : 'token', session: { id: 1 } }),
      pendingCount: async () => count,
      sync: async () => { called = true; if (scenario === 'exception') throw new Error('timeout'); if (scenario === 'drained') count = 0; return { authError: scenario === 'auth' }; },
      suspendAuth: async () => { paused = true; },
    });
    assert.equal(result, ['auth', 'no-token'].includes(scenario) ? 'auth' : ['empty', 'drained'].includes(scenario) ? 'done' : 'retry');
    assert.equal(paused, ['auth', 'no-token'].includes(scenario));
    assert.equal(called, !['empty', 'no-token'].includes(scenario));
  });
}

test('interrupted operation claim is retried after a fresh runtime starts', async t => {
  const f = await fixture(t); await f.create('crash-operation');
  const [entry] = await f.store.getPendingChanges(); await f.store.claimChange(entry.queue_id);
  await f.openStore().init();
  assert.equal((await f.store.getPendingChanges())[0].status, 'syncing');
  await f.engine().runSync('token');
  assert.equal(await f.store.getPendingCount(), 0); assert.equal(f.server.size, 1);
});

test('a queued call with an obsolete token cannot send pending operations', async t => {
  const f = await fixture(t); await f.create('obsolete-token');
  await assert.rejects(f.engine().runSync('obsolete'), /sesión ha cambiado/);
  assert.equal(await f.store.getPendingCount(), 1); assert.deepEqual(f.events, []);
});

test('a queued call after logout cannot send pending operations', async t => {
  const f = await fixture(t); await f.create('logged-out'); await f.store.clearSession();
  await assert.rejects(f.engine().runSync('token'), /sesión ha cambiado/);
  assert.equal(await f.store.getPendingCount(), 1); assert.deepEqual(f.events, []);
});

for (const scenario of ['secure-write-failure', 'metadata-write-failure']) {
  test(`login cannot expose partial credentials to background sync: ${scenario}`, async () => {
    const events = []; let token = 'old-token';
    const user = { id: 1, username: 'mechanic', role: 'mechanic', boat_id: 1 };
    const { sessionRepository } = load('src/repositories/sessionRepository.ts', {
      '@/src/services/sync/nativeBackground': {
        withSyncLock: fn => fn(),
        backgroundBridge: { suspendAuth: async () => events.push('pause'), resumeAuth: async () => events.push('resume') },
      },
      '@/src/services/sync/backgroundScheduling': { reconcileBackgroundSync: async () => events.push('schedule') },
      '@/src/utils/storage': { storage: {
        secureGet: async () => token,
        secureSet: async (_key, value) => {
          if (scenario === 'secure-write-failure') return false;
          token = value; return true;
        },
        secureRemove: async () => { token = null; return true; },
      } },
      '@/src/constants/storage': { TOKEN_KEY: 'existing-key' },
      '@/src/services/api/endpoints': { apiLogin: async () => ({ token: 'new-token', user }) },
      '@/src/database/store': { localStore: {
        getSession: async () => user,
        clearUserData: async () => events.push('clear-data'),
        saveSession: async () => { if (scenario === 'metadata-write-failure') throw new Error('SQLite write failed'); },
      } },
    });
    await assert.rejects(sessionRepository.login('mechanic', 'password'));
    assert.deepEqual(events, ['pause']); assert.equal(token, null);
  });
}

for (const reason of ['invalid', 'forbidden', 'max-retries']) {
  test(`P2 photo stops retries for ${reason} and survives explicit retry`, async t => {
    const f = await fixture(t); const part = await f.create(`dependent-${reason}`);
    await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
    if (reason === 'max-retries') {
      f.fail(new ApiError(500, 'http'));
      for (let i = 0; i < 5; i++) await f.engine().runSync('token');
    } else { f.pushStatus(reason); await f.engine().runSync('token'); }
    assert.equal(await f.store.getPendingCount(), 0);
    const failed = await f.store.getFailedChanges(); assert.equal(failed.length, 2);
    assert.equal(failed.find(entry => entry.local_path)?.last_error, 'parent_create_failed');
    assert.ok(f.files.has('photo.jpg'));
    const result = await executeBackgroundSync({
      initialize: async () => {}, restore: async () => ({ token: 'token', session: { id: 1 } }),
      pendingCount: () => f.store.getPendingCount(), sync: () => { throw new Error('must not retry'); }, suspendAuth: async () => {},
    });
    assert.equal(result, 'done');
    await f.openStore().init(); assert.equal(await f.store.getPendingCount(), 0);
    await f.store.retryFailed(); assert.equal(await f.store.getPendingCount(), 2);
    f.fail(null); f.pushStatus('ok'); await f.engine().runSync('token');
    assert.equal(await f.store.getPendingCount(), 0); assert.equal(f.events.at(-1), 'photo:100');
  });
  test(`P2 editing ${reason} CREATE reactivates its retained photograph`, async t => {
    const f = await fixture(t); const part = await f.create(`edit-${reason}`);
    await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
    const [entry] = await f.store.getPendingChanges();
    if (reason === 'max-retries') {
      for (let i = 0; i < 5; i++) await f.store.markRetry(entry.queue_id, 'HTTP 500');
    } else await f.store.markFailed(entry.queue_id, part.row_uid, reason);
    await f.store.updatePartLocal(part.row_uid, { name: 'corrected' });
    assert.ok(await f.store.getPendingCount() >= 2);
    assert.equal((await f.store.getPendingPhotos())[0].status, 'pending');
    await f.engine().runSync('token');
    assert.equal(f.events.at(-1), 'photo:100'); assert.equal(await f.store.getPendingCount(), 0);
  });
}
test('P2 attaching a photo on a failed parent stays failed; discard cleans file', async t => {
  const f = await fixture(t); const part = await f.create('already-failed');
  const [entry] = await f.store.getPendingChanges(); await f.store.markFailed(entry.queue_id, part.row_uid, 'invalid');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
  assert.equal(await f.store.getPendingCount(), 0); assert.ok(f.files.has('photo.jpg'));
  await f.store.discardFailed(); assert.equal((await f.store.getFailedChanges()).length, 0);
  assert.equal(await f.store.getPart(part.row_uid), null); assert.equal(f.files.has('photo.jpg'), false);
});
test('P2 cold initialization repairs legacy pending photos of a failed CREATE', async t => {
  const f = await fixture(t); const part = await f.create('legacy-photo');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
  const [entry] = await f.store.getPendingChanges(); await f.store.markFailed(entry.queue_id, part.row_uid, 'forbidden');
  const db = new DatabaseSync(f.file); db.exec("UPDATE photo_queue SET status = 'pending', last_error = NULL;"); db.close();
  await f.openStore().init(); assert.equal(await f.store.getPendingCount(), 0); assert.ok(f.files.has('photo.jpg'));
});
test('P1 server identity mismatch cannot push operations or upload photos, including legacy state', async t => {
  const f = await fixture(t); const part = await f.create('identity-mismatch');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.identity(2);
  assert.equal((await f.engine().runSync('token')).authError, true);
  assert.deepEqual(f.events, []); assert.equal(await f.store.getPendingCount(), 2);
});

async function sessionFixture(f, hooks = {}) {
  let token = 'token-A';
  const userB = { id: 2, username: 'user-B', role: 'mechanic', boat_id: 2 };
  const snapshots = [];
  const snapshot = async boundary => {
    snapshots.push({ boundary, token, session: await f.store.getSession(),
      pending: await f.store.getPendingCount(), cached: (await f.store.getCounts()).parts });
  };
  const repository = load('src/repositories/sessionRepository.ts', {
    '@/src/services/sync/nativeBackground': { withSyncLock: fn => fn(), backgroundBridge: {
      suspendAuth: async () => snapshot('before-token-removal'),
      resumeAuth: async () => snapshot('before-resume-auth'),
    } },
    '@/src/services/sync/backgroundScheduling': { reconcileBackgroundSync: async () => {} },
    '@/src/utils/storage': { storage: {
      secureGet: async () => token,
      secureRemove: async () => {
        if (hooks.failRemoval) return false;
        token = null; await snapshot('after-token-removal'); return true;
      },
      secureSet: async (_key, value) => {
        await snapshot('before-new-token'); token = value; await snapshot('after-new-token'); return true;
      },
    } },
    '@/src/constants/storage': { TOKEN_KEY: 'existing-key' },
    '@/src/services/api/endpoints': { apiLogin: async () => ({ token: 'token-B', user: userB }) },
    '@/src/database/store': { localStore: {
      getSession: () => f.store.getSession(),
      clearUserData: async () => { await snapshot('during-clear-before-commit'); await f.store.clearUserData(); await snapshot('after-clear'); },
      saveSession: async user => { await f.store.saveSession(user); await snapshot('after-new-metadata'); },
    } },
  }).sessionRepository;
  return { repository, snapshots, snapshot, get token() { return token; } };
}
test('P1 every persisted login boundary binds credentials only to their own SQLite owner', async t => {
  const f = await fixture(t); const part = await f.create('p1-old');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg');
  const auth = await sessionFixture(f); await auth.repository.login('user-B', 'password');
  assert.deepEqual(auth.snapshots.map(s => s.boundary), [
    'before-token-removal', 'after-token-removal', 'during-clear-before-commit', 'after-clear',
    'after-new-metadata', 'before-new-token', 'after-new-token', 'before-resume-auth',
  ]);
  for (const state of auth.snapshots) {
    if (state.token === 'token-A') assert.equal(state.session.id, 1);
    if (state.token === 'token-B') { assert.equal(state.session.id, 2); assert.equal(state.pending, 0); assert.equal(state.cached, 0); }
    let sends = 0;
    const restored = load('src/repositories/sessionRepository.ts', {
      '@/src/services/sync/nativeBackground': { withSyncLock: fn => fn() },
      '@/src/services/sync/backgroundScheduling': {},
      '@/src/utils/storage': { storage: { secureGet: async () => state.token } },
      '@/src/constants/storage': { TOKEN_KEY: 'existing-key' },
      '@/src/services/api/endpoints': {},
      '@/src/database/store': { localStore: { getSession: async () => state.session } },
    }).sessionRepository;
    await executeBackgroundSync({
      initialize: async () => {}, restore: () => restored.restore(), pendingCount: async () => state.pending,
      sync: async credential => { assert.equal(credential, 'token-A'); sends++; return { authError: false }; },
      suspendAuth: async () => {},
    });
    if (state.token !== 'token-A') assert.equal(sends, 0, state.boundary);
  }
});
test('P1 interrupted SQLite clear rolls back while credentials remain absent', async t => {
  const f = await fixture(t); await f.create('p1-rollback');
  // SQLite rolls an uncommitted transaction back on connection/process death.
  const db = new DatabaseSync(f.file); db.exec('BEGIN; DELETE FROM pending_changes; DELETE FROM parts;'); db.close();
  await f.openStore().init(); assert.equal((await f.store.getSession()).id, 1);
  assert.equal(await f.store.getPendingCount(), 1);
  assert.equal(await executeBackgroundSync({ initialize: async () => {},
    restore: async () => ({ token: null, session: await f.store.getSession() }),
    pendingCount: () => f.store.getPendingCount(), sync: () => { throw new Error('unsafe send'); }, suspendAuth: async () => {},
  }), 'auth');
});
test('P1 failed credential removal aborts before changing identity or queues', async t => {
  const f = await fixture(t); await f.create('remove-failed');
  const auth = await sessionFixture(f, { failRemoval: true });
  await assert.rejects(auth.repository.login('user-B', 'password'), /retirar/);
  assert.equal(auth.token, 'token-A'); assert.equal((await f.store.getSession()).id, 1);
  assert.equal(await f.store.getPendingCount(), 1);
});
test('P1 logout retains queue ownership so a subsequent other-user login clears it safely', async t => {
  const f = await fixture(t); await f.create('logout-old'); const auth = await sessionFixture(f);
  await auth.repository.logout();
  assert.equal(auth.token, null); assert.equal((await f.store.getSession()).id, 1);
  assert.equal(await f.store.getPendingCount(), 1); assert.equal((await auth.repository.restore()).token, null);
  await auth.repository.login('user-B', 'password');
  assert.equal((await f.store.getSession()).id, 2); assert.equal(await f.store.getPendingCount(), 0);
});

for (const [status, kind, flag] of [[0, 'network', 'networkError'], [401, 'http', 'authError']]) {
  test(`P1 identity validation ${kind} failure preserves both queues`, async t => {
    const f = await fixture(t); const part = await f.create(`identity-check-${kind}`);
    await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.identityFail(new ApiError(status, kind));
    assert.equal((await f.engine().runSync('token'))[flag], true);
    assert.deepEqual(f.events, []); assert.equal(await f.store.getPendingCount(), 2);
    assert.ok(f.files.has('photo.jpg'));
  });
}
test('P1 legacy inventory with no owner is cleared before publishing a new credential', async t => {
  const f = await fixture(t); await f.create('unowned-legacy'); await f.store.clearSession();
  const auth = await sessionFixture(f);
  assert.equal((await auth.repository.restore()).token, null);
  await auth.repository.login('user-B', 'password');
  assert.equal(await f.store.getPendingCount(), 0); assert.equal((await f.store.getSession()).id, 2);
  assert.equal(auth.token, 'token-B');
});
test('P1 a stale authentication failure cannot suspend a freshly completed login', async t => {
  const f = await fixture(t); const auth = await sessionFixture(f);
  await auth.repository.login('user-B', 'password'); const count = auth.snapshots.length;
  await auth.repository.suspendIfCurrentToken('token-A'); assert.equal(auth.snapshots.length, count);
});

test('P2 correcting a retry-exhausted CREATE after a lost acknowledgment preserves idempotency and photo', async t => {
  const f = await fixture(t); const part = await f.create('uncertain-create');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.loseResponse(); await f.engine().runSync('token');
  f.fail(new ApiError(500, 'http')); for (let i = 0; i < 4; i++) await f.engine().runSync('token');
  assert.equal(await f.store.getPendingCount(), 0); assert.equal(f.server.size, 1);
  await f.store.updatePartLocal(part.row_uid, { name: 'corrected' });
  const queued = await f.store.getPendingChanges();
  assert.equal(JSON.parse(queued.find(c => c.action === 'create').payload).name, 'pump');
  assert.equal(JSON.parse(queued.find(c => c.action === 'update').payload).name, 'corrected');
  f.fail(null); await f.engine().runSync('token');
  assert.equal(f.server.size, 1); assert.equal(await f.store.getPendingCount(), 0);
  assert.equal(f.events.at(-1), 'photo:100');
});
test('P2 dependency repair does not reactivate a photo failed by its own upload errors', async t => {
  const f = await fixture(t); const part = await f.create('upload-failed');
  await f.store.setLocalPhoto(part.row_uid, 'photo.jpg'); f.photoFail(new ApiError(500, 'http'));
  for (let i = 0; i < 5; i++) await f.engine().runSync('token');
  assert.equal((await f.store.getFailedChanges()).length, 1);
  await f.store.updatePartLocal(part.row_uid, { name: 'edited' });
  assert.equal((await f.store.getPendingPhotos()).length, 0); assert.ok(f.files.has('photo.jpg'));
  await f.store.retryFailed(); f.photoFail(null); await f.engine().runSync('token');
  assert.equal(await f.store.getPendingCount(), 0); assert.equal((await f.store.getFailedChanges()).length, 0);
});
