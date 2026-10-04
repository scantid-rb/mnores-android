import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const copy = value => JSON.parse(JSON.stringify(value));
class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-03T12:00:00Z'])); } }
function load(path, dependencies, extra = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date: Clock, console,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, ...extra });
  return module.exports;
}
function webFixture() {
  const values = new Map();
  let serial = 0;
  let failWrite = false;
  let writes = 0;
  let lockTail = Promise.resolve();
  const storage = {
    getItem: async (key, fallback) => values.get(key) ?? fallback,
    setItem: async (key, value) => { writes++; if (failWrite) return false; values.set(key, value); return true; },
  };
  const navigator = { locks: { request: (_name, run) => {
    const result = lockTail.then(run); lockTail = result.catch(() => {}); return result;
  } } };
  const open = () => load('src/database/store.web.ts', {
    '@/src/utils/storage': { storage }, '@/src/utils/id': { newQueueId: () => `queue-${++serial}` },
  }, { navigator }).localStore;
  return { store: open(), open, values, fail: value => { failWrite = value; }, writes: () => writes };
}
function sqliteFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  let serial = 0;
  const args = values => Array.isArray(values[0]) ? values[0] : values;
  const sqlite = { openDatabaseAsync: async () => ({
    execAsync: async sql => db.exec(sql),
    runAsync: async (sql, ...values) => db.prepare(sql).run(...args(values)),
    getFirstAsync: async (sql, ...values) => db.prepare(sql).get(...args(values)) ?? null,
    getAllAsync: async (sql, ...values) => db.prepare(sql).all(...args(values)),
    withTransactionAsync: async fn => {
      db.exec('BEGIN');
      try { await fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  }) };
  return load('src/database/store.ts', {
    'expo-sqlite': sqlite,
    'expo-file-system/legacy': { getInfoAsync: async () => ({ exists: false }) },
    '@/src/utils/id': { newQueueId: () => `queue-${++serial}` },
    '@/src/services/sync/backgroundScheduling': { reconcileBackgroundSync: async () => {} },
  }).localStore;
}
const input = { local_id: 'local-1', boat_id: 1, category_id: 1, name: 'Pump', quantity: 2 };
const user = { id: 1, username: 'A', role: 'chief_engineer', boat_id: 1 };
async function state(store) {
  return copy({ parts: await store.searchParts({}), row: await store.getPart(input.local_id),
    queue: await store.getPendingChanges(), photos: await store.getPendingPhotos(),
    failed: await store.getFailedChanges(), count: await store.getPendingCount(),
    protected: await store.getProtectedServerIds(), session: await store.getSession() });
}
async function parity(t, scenario) {
  const web = webFixture().store;
  const native = sqliteFixture(t);
  for (const store of [web, native]) { await store.init(); await store.saveSession(user); }
  const steps = scenario();
  for (const step of steps) {
    const webResult = await step(web);
    const nativeResult = await step(native);
    assert.deepEqual(copy(webResult ?? null), copy(nativeResult ?? null));
    assert.deepEqual(await state(web), await state(native));
  }
}
const create = s => s.createPartLocal(input);
const photo = s => s.setLocalPhoto(input.local_id, 'photo.jpg');
const first = async s => (await s.getPendingChanges())[0];
const ack = async s => s.applyCreateOk((await first(s)).queue_id, input.local_id, 10, 'v1');
const reject = async (s, error = 'invalid') => s.markFailed((await first(s)).queue_id, input.local_id, error);

test('web matches SQLite for offline create/edit/photo and acknowledgements', async t => {
  await parity(t, () => [create, photo, s => s.updatePartLocal(input.local_id, { name: 'Pump edited' }),
    async s => s.claimChange((await first(s)).queue_id), ack,
    async s => s.claimPhoto((await s.getPendingPhotos())[0].queue_id),
    async s => s.applyPhotoOk((await s.getPendingPhotos())[0].queue_id, 'v2')]);
});
for (const error of ['invalid', 'forbidden']) {
  test(`web matches P2 parent ${error}, editing and explicit retries`, async t => {
    await parity(t, () => [create, photo, s => reject(s, error),
      s => s.updatePartLocal(input.local_id, { name: 'Fixed' }), s => reject(s, error),
      s => s.retryFailed(), ack]);
  });
}
test('web preserves original idempotent create after lost response and exhausted retries', async t => {
  await parity(t, () => [create, photo, async s => s.claimChange((await first(s)).queue_id),
    ...Array.from({ length: 4 }, () => async s => s.markRetry((await first(s)).queue_id, 'network')),
    s => s.updatePartLocal(input.local_id, { name: 'Later edit' }), ack,
    async s => s.claimChange((await first(s)).queue_id),
    async s => s.applyUpdateOk((await first(s)).queue_id, 10, 'v2')]);
});
test('web defers deletion of an already sent create and resolves photos and dependent queues', async t => {
  await parity(t, () => [create, photo, async s => s.claimChange((await first(s)).queue_id),
    s => s.deletePartLocal(input.local_id), ack,
    async s => s.claimChange((await first(s)).queue_id),
    async s => s.applyDeleteOk((await first(s)).queue_id, 10)]);
});
test('web deletes a never sent create and all dependent work', async t => {
  await parity(t, () => [create, photo, s => s.updatePartLocal(input.local_id, { quantity: 3 }),
    s => s.deletePartLocal(input.local_id)]);
});
test('web discards failed create with deferred edit/photo and resets cursor', async t => {
  await parity(t, () => [create, photo, async s => s.claimChange((await first(s)).queue_id),
    s => s.updatePartLocal(input.local_id, { name: 'Deferred' }), s => reject(s),
    s => s.setLastSyncAt('cursor'), s => s.discardFailed()]);
});
test('web keeps newer updates and photo while old acknowledgements arrive', async t => {
  await parity(t, () => [create, ack, photo,
    async s => s.claimPhoto((await s.getPendingPhotos())[0].queue_id),
    s => s.setLocalPhoto(input.local_id, 'new.jpg'),
    async s => s.applyPhotoOk((await s.getPendingPhotos())[0].queue_id, 'v2'),
    s => s.updatePartLocal(input.local_id, { quantity: 3 }),
    async s => s.claimChange((await first(s)).queue_id),
    s => s.updatePartLocal(input.local_id, { quantity: 4 }),
    async s => s.applyUpdateOk((await first(s)).queue_id, 10, 'v3')]);
});
test('web recovers interrupted claims and does not reactivate independent photo failure', async t => {
  await parity(t, () => [create, async s => s.claimChange((await first(s)).queue_id),
    s => s.recoverInterruptedSync(), ack, photo,
    async s => s.claimPhoto((await s.getPendingPhotos())[0].queue_id), s => s.recoverInterruptedSync(),
    ...Array.from({ length: 5 }, () => async s => s.markPhotoRetry((await s.getPendingPhotos())[0].queue_id, 'upload')),
    s => s.updatePartLocal(input.local_id, { quantity: 5 }), s => s.retryFailed()]);
});
test('web reconciles protected rows, cursor, local photos, and tombstones like SQLite', async t => {
  const inventory = { boats: [], categories: [], parts: [{ id: 10, boat_id: 1, name: 'Server', quantity: 5, updated_at: 'v3' }] };
  await parity(t, () => [create, ack, photo, s => s.reconcileAndSetCursor(inventory, 'cursor'),
    s => s.updatePartLocal(input.local_id, { name: 'Local' }),
    s => s.reconcileAndSetCursor(inventory, 'cursor2'),
    async s => s.applyUpdateOk((await first(s)).queue_id, 10, 'v4'),
    s => s.reconcileAndSetCursor({ ...inventory, parts: [{ ...inventory.parts[0], deleted_at: 'deleted' }] }, 'cursor3')]);
});
test('web single claims are atomic across concurrent runtimes/tabs', async () => {
  const f = webFixture();
  await f.store.init(); await create(f.store);
  const queueId = (await first(f.store)).queue_id;
  const claims = await Promise.all([f.store.claimChange(queueId), f.open().claimChange(queueId)]);
  assert.equal(claims.filter(Boolean).length, 1);
  await ack(f.store); await photo(f.store);
  const photoId = (await f.store.getPendingPhotos())[0].queue_id;
  assert.equal((await Promise.all([f.store.claimPhoto(photoId), f.open().claimPhoto(photoId)])).filter(Boolean).length, 1);
});
test('web commits part and queue once, rejects persistence failure and recovers from persisted snapshot', async () => {
  const f = webFixture(); await f.store.init();
  const writes = f.writes(); await create(f.store); assert.equal(f.writes(), writes + 1);
  const before = await state(f.store);
  f.fail(true);
  await assert.rejects(f.store.updatePartLocal(input.local_id, { name: 'Lost' }), /guardar/);
  f.fail(false);
  assert.deepEqual(await state(f.open()), before);
  await photo(f.store); await f.store.claimChange((await first(f.store)).queue_id);
  const reopened = f.open(); await reopened.init();
  assert.equal((await first(reopened)).status, 'pending');
  assert.equal((await first(reopened)).retry_count, 1);
  assert.equal((await reopened.getPendingPhotos())[0].local_path, 'photo.jpg');
});
test('web migrates legacy queues/photos, repairs dependency failure, and retains identity on clear', async () => {
  const f = webFixture();
  const queue = { queue_id: 'old', action: 'create', row_uid: 'legacy', entity_id: null,
    entity: 'part', client_local_id: 'legacy', payload: '{}', created_at: 'old', retry_count: 5, last_error: 'network', status: 'failed' };
  f.values.set('db.queue', JSON.stringify([queue]));
  f.values.set('db.photo.queue', JSON.stringify([{ queue_id: 'photo', row_uid: 'legacy', server_id: null, local_path: 'preserved.jpg', status: 'uploading', retry_count: 0, last_error: null, created_at: 'old' }]));
  await f.store.init();
  assert.equal(await f.store.getPendingCount(), 0);
  assert.equal((await f.store.getFailedChanges())[1].last_error, 'parent_create_failed');
  await f.store.retryFailed();
  assert.equal(await f.store.getPendingCount(), 2);
  assert.equal((await f.store.getPendingPhotos())[0].local_path, 'preserved.jpg');
  await f.store.saveSession(user); await f.store.clearUserData();
  assert.equal((await f.store.getSession()).id, user.id);
  assert.equal(await f.open().getPendingCount(), 0);
});
test('web claims defer photos and updates until create supplies a server ID', async () => {
  const s = webFixture().store; await s.init(); await create(s); await photo(s);
  assert.equal(await s.claimPhoto((await s.getPendingPhotos())[0].queue_id), null);
  await s.claimChange((await first(s)).queue_id);
  await s.updatePartLocal(input.local_id, { quantity: 3 });
  assert.equal(await s.claimChange((await s.getPendingChanges())[1].queue_id), null);
});

test('web reconciliation cannot commit inventory without its cursor when storage fails', async () => {
  const f = webFixture(); await f.store.init(); await f.store.saveSession(user); await create(f.store);
  const before = await state(f.store);
  f.fail(true);
  await assert.rejects(f.store.reconcileAndSetCursor({ boats: [], categories: [], parts: [] }, 'new-cursor'), /guardar/);
  f.fail(false);
  assert.deepEqual(await state(f.open()), before);
});
test('P1 repository retains web queue ownership on logout and clears A data before storing B credentials', async () => {
  const f = webFixture(); const s = f.store; await s.init(); await s.saveSession(user); await create(s); await photo(s);
  let token = 'token-A';
  const observations = [];
  const B = { id: 2, username: 'B', role: 'chief_engineer', boat_id: 2 };
  const repository = load('src/repositories/sessionRepository.ts', {
    '@/src/services/sync/nativeBackground': { backgroundBridge: null, withSyncLock: fn => fn() },
    '@/src/services/sync/backgroundScheduling': { reconcileBackgroundSync: async () => {} },
    '@/src/utils/storage': { storage: {
      secureGet: async () => token,
      secureRemove: async () => { token = null; return true; },
      secureSet: async (_key, next) => { observations.push(await state(s)); token = next; return true; },
    } },
    '@/src/constants/storage': { TOKEN_KEY: 'token' },
    '@/src/services/api/endpoints': { apiLogin: async () => ({ token: 'token-B', user: B }), apiGetMe: async () => B },
    '@/src/database/store': { localStore: s },
  }).sessionRepository;
  await repository.logout();
  assert.equal((await repository.restore()).token, null);
  assert.equal((await s.getSession()).id, user.id);
  assert.equal(await s.getPendingCount(), 2);
  await repository.login('B', 'secret');
  assert.equal(observations[0].session.id, B.id);
  assert.equal(observations[0].count, 0);
  assert.equal(observations[0].row, null);
  assert.equal((await repository.restore()).token, 'token-B');
});
for (const system of ['light', 'dark', null, 'unspecified']) {
  test(`theme safely falls back for system scheme ${system}`, () => {
    const theme = load('src/theme.ts', {
      react: { useMemo: fn => fn() },
      'react-native': { Appearance: { setColorScheme() {} }, StyleSheet: { create: value => value }, useColorScheme: () => system },
    });
    assert.equal(theme.useTheme().scheme, 'light');
    assert.equal(theme.useTheme().colors, theme.themes.light);
    theme.themes.dark = { ...theme.themes.light, surface: '#000000' };
    assert.equal(theme.useTheme().scheme, system === 'dark' ? 'dark' : 'light');
  });
}
