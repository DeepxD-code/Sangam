'use strict';

/**
 * Day 29 Verification — Interactive Widget + Item List Drill-Down
 * Groups: A: Widget interactivity | B: ItemListPage SSR | C: API client
 *         D: /api/supply/items real backend | E: /api/supply/categories
 */

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const esbuild = require('esbuild');
const React  = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const http   = require('http');
const jwt    = require('jsonwebtoken');

const srcDir    = path.join(__dirname, '..', 'src');
const clientSrc = path.join(srcDir, 'api', 'client.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise)
      return r.then(() => { console.log(`  ✅ ${name}`); passed++; })
              .catch(e => { console.error(`  ❌ ${name}: ${e.message}`); failed++; });
    console.log(`  ✅ ${name}`); passed++;
  } catch(e) { console.error(`  ❌ ${name}: ${e.message}`); failed++; }
  return Promise.resolve();
}
function html(c, p) { return renderToStaticMarkup(React.createElement(c, p)); }

// Temporarily swap api/client.js with a browser-free stub, run buildSync,
// then restore. buildSync is synchronous so the swap is safe.
const CLIENT_STUB = `
export function getToken() { return null; }
export function setToken() {}
export function getRefreshToken() { return null; }
export function setRefreshToken() {}
export function clearToken() {}
export const api = {
  login: async () => ({}), logout: async () => ({}),
  getDashboardSummary: async () => ({}), refreshDashboard: async () => ({}),
  getMe: async () => ({}),
  getSupplyItems: async () => ({ items: [], total: 0 }),
  getSupplyCategories: async () => ({ categories: [] })
};
export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}
`;

function loadBundled(relativePath) {
  const fullPath    = path.join(srcDir, relativePath);
  const origClient  = fs.readFileSync(clientSrc, 'utf8');
  fs.writeFileSync(clientSrc, CLIENT_STUB);
  let result;
  try {
    result = esbuild.buildSync({
      entryPoints: [fullPath],
      bundle: true, write: false, format: 'cjs', jsx: 'automatic',
      loader: { '.jsx': 'jsx', '.js': 'js' }, platform: 'node',
      external: ['react', 'react-dom', 'react/jsx-runtime']
    });
  } finally {
    fs.writeFileSync(clientSrc, origClient);
  }
  const code = result.outputFiles[0].text;
  const Module = require('module');
  const m = new Module(fullPath, module);
  m.filename = fullPath;
  m.paths = Module._nodeModulePaths(path.dirname(fullPath));
  m._compile(code, fullPath);
  return m.exports.default || m.exports;
}

// Load all components under test up front
const Widget       = loadBundled('components/Widget.jsx');
const ItemListPage = loadBundled('pages/ItemListPage.jsx');

// Load real client separately with browser shims for export inspection
const shimPath = path.join(os.tmpdir(), `shim-${Date.now()}.js`);
fs.writeFileSync(shimPath,
  'const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};\n' +
  'const fetch=async()=>({ok:true,headers:{get:()=>"application/json"},json:async()=>({})});\n');
const clientCJS = esbuild.buildSync({
  entryPoints: [clientSrc], bundle: false, write: false,
  format: 'cjs', platform: 'browser', inject: [shimPath]
});
fs.unlinkSync(shimPath);
const clientMod = new (require('module'))(clientSrc, module);
clientMod.filename = clientSrc;
clientMod.paths = require('module')._nodeModulePaths(path.join(srcDir,'api'));
clientMod._compile(clientCJS.outputFiles[0].text, clientSrc);
const realClient = clientMod.exports;

// Real backend helper
const JWT_SECRET = process.env.JWT_SECRET || 'sangam-dev-secret-CHANGE-IN-PRODUCTION';
const createApp  = require('../../backend/src/app');
function makeToken(o={}) {
  return jwt.sign({userId:1,username:'x',role:'COMMANDER',unitId:10,unitCode:'HQ',...o}, JWT_SECRET, {expiresIn:'1h'});
}
function bget(port, p, token) {
  return new Promise((resolve, reject) => {
    http.get({port, path:p, headers:{Authorization:`Bearer ${token}`}, timeout:4000}, res => {
      let b=''; res.on('data',c=>b+=c);
      res.on('end', () => { try { resolve({status:res.statusCode, body:JSON.parse(b)}); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function run() {
  console.log('\n🖱️  Day 29 — Interactive Widget + Item List Drill-Down\n');

  // ── A: Interactive Widget ────────────────────────────────────
  console.log('📦 Group A: Interactive Widget');

  await test('A-01 onClick adds widget-interactive + role=button + tabIndex + drill-hint', () => {
    const out = html(Widget, { code:'SUP', headline:142, available:true, onClick:()=>{} });
    if (!out.includes('widget-interactive')) throw new Error('missing interactive class');
    if (!out.includes('role="button"'))      throw new Error('missing ARIA role');
    if (!out.includes('tabindex'))           throw new Error('missing tabIndex');
    if (!out.includes('VIEW'))               throw new Error('missing drill-hint');
  });

  await test('A-02 unavailable widget + onClick is NOT interactive', () => {
    const out = html(Widget, { code:'SUP', available:false, onClick:()=>{} });
    if (out.includes('widget-interactive')) throw new Error('interactive class on unavailable');
    if (out.includes('role="button"'))      throw new Error('button role on unavailable');
  });

  await test('A-03 no onClick = not interactive', () => {
    const out = html(Widget, { code:'UNT', headline:4, available:true });
    if (out.includes('widget-interactive')) throw new Error('spurious interactive class');
    if (out.includes('VIEW'))               throw new Error('spurious drill-hint');
  });

  await test('A-04 interactive widget still renders headline, unit, breakdown', () => {
    const out = html(Widget, { code:'SUP', headline:142, unit:'ITEMS', available:true, onClick:()=>{}, breakdown:{AMMO:50,FUEL:30} });
    if (!out.includes('142'))        throw new Error('missing headline');
    if (!out.includes('ITEMS'))      throw new Error('missing unit label');
    if (!out.includes('AMMO · 50')) throw new Error('missing breakdown chip');
  });

  await test('A-05 zero headline on interactive widget renders without crash', () => {
    const out = html(Widget, { code:'TRF', headline:0, available:true, onClick:()=>{} });
    if (!out.includes('widget-interactive')) throw new Error('crashed with headline=0');
  });

  // ── B: ItemListPage SSR ────────────────────────────────────────
  console.log('\n📋 Group B: ItemListPage SSR');

  await test('B-01 page title, back link, TopBar wordmark in initial state', () => {
    const out = html(ItemListPage, { user:{displayName:'Capt',unitCode:'A-COY'}, onLogout:()=>{}, onBack:()=>{} });
    if (!out.includes('Supply Items'))     throw new Error('missing title');
    if (!out.includes('BACK TO OVERVIEW')) throw new Error('missing back link');
    if (!out.includes('SANGAM'))           throw new Error('TopBar missing');
  });

  await test('B-02 filter bar present (search, category select, low-stock toggle)', () => {
    const out = html(ItemListPage, { onLogout:()=>{}, onBack:()=>{} });
    if (!out.includes('Search by name')) throw new Error('missing search placeholder');
    if (!out.includes('LOW STOCK ONLY')) throw new Error('missing toggle');
    if (!out.includes('All categories')) throw new Error('missing category default');
  });

  await test('B-03 no <table> in pre-fetch state (items=[])', () => {
    const out = html(ItemListPage, { onLogout:()=>{}, onBack:()=>{} });
    if (out.includes('<table')) throw new Error('table rendered before data');
  });

  await test('B-04 missing user prop does not crash render', () => {
    const out = html(ItemListPage, { onLogout:()=>{} });
    if (!out.includes('SANGAM')) throw new Error('crash without user');
  });

  await test('B-05 missing onBack prop does not crash render', () => {
    try { html(ItemListPage, { onLogout:()=>{} }); }
    catch(e) { throw new Error(`Crashed: ${e.message}`); }
  });

  // ── C: API Client Exports ──────────────────────────────────────
  console.log('\n🔌 Group C: API Client Exports');

  await test('C-01 api.getSupplyItems is a function', () => {
    if (typeof realClient.api.getSupplyItems !== 'function') throw new Error('missing');
  });
  await test('C-02 api.getSupplyCategories is a function', () => {
    if (typeof realClient.api.getSupplyCategories !== 'function') throw new Error('missing');
  });
  await test('C-03 existing methods intact after additions', () => {
    for (const n of ['login','logout','getDashboardSummary','refreshDashboard','getMe']) {
      if (typeof realClient.api[n] !== 'function') throw new Error(`${n} missing`);
    }
  });
  await test('C-04 getRefreshToken + setRefreshToken exported', () => {
    if (typeof realClient.getRefreshToken !== 'function') throw new Error('getRefreshToken missing');
    if (typeof realClient.setRefreshToken !== 'function') throw new Error('setRefreshToken missing');
  });

  // ── D: Real backend /api/supply/items ─────────────────────────
  console.log('\n🌐 Group D: /api/supply/items');

  await test('D-01 returns 200 + success + items array', async () => {
    const app = createApp(null,{},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port, '/api/supply/items', makeToken());
    srv.close();
    if (res.status !== 200)             throw new Error(`${res.status}`);
    if (!res.body.success)              throw new Error('success:false');
    if (!Array.isArray(res.body.items)) throw new Error('items not array');
  });

  await test('D-02 seeded item appears in response', async () => {
    const SC = require('../../backend/src/services/supply-chain.service');
    class R { async getCommandScope(u){return{ids:[u],codes:[]};} }
    class N { async notifyLowStock(){} async notifyTransferPending(){} async notifyTransferDecision(){} }
    const supply = new SC(null,new R(),new N());
    await supply.createItem({itemCode:'SEED-01',itemName:'Seeded',category:'GENERAL',unitId:10,quantity:50});
    const app = createApp(null,{supply},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/items', makeToken());
    srv.close();
    if (!res.body.items.some(i=>i.itemCode==='SEED-01')) throw new Error('seeded item missing');
  });

  await test('D-03 ?category=AMMO returns only AMMO items', async () => {
    const SC = require('../../backend/src/services/supply-chain.service');
    class R { async getCommandScope(u){return{ids:[u],codes:[]};} }
    class N { async notifyLowStock(){} async notifyTransferPending(){} async notifyTransferDecision(){} }
    const supply = new SC(null,new R(),new N());
    await supply.createItem({itemCode:'A1',itemName:'Ammo',category:'AMMO',unitId:10,quantity:100});
    await supply.createItem({itemCode:'F1',itemName:'Fuel',category:'FUEL',unitId:10,quantity:200});
    const app = createApp(null,{supply},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/items?category=AMMO',makeToken());
    srv.close();
    if (!res.body.items.every(i=>i.category==='AMMO')) throw new Error('non-AMMO items leaked');
  });

  await test('D-04 ?lowStockOnly=true filters correctly', async () => {
    const SC = require('../../backend/src/services/supply-chain.service');
    class R { async getCommandScope(u){return{ids:[u],codes:[]};} }
    class N { async notifyLowStock(){} async notifyTransferPending(){} async notifyTransferDecision(){} }
    const supply = new SC(null,new R(),new N());
    await supply.createItem({itemCode:'LO',itemName:'Low', category:'MEDICAL',unitId:10,quantity:2,  lowStockThreshold:10});
    await supply.createItem({itemCode:'OK',itemName:'OK',  category:'MEDICAL',unitId:10,quantity:100,lowStockThreshold:10});
    const app = createApp(null,{supply},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/items?lowStockOnly=true',makeToken());
    srv.close();
    if (res.body.items.some(i=>i.itemCode==='OK'))   throw new Error('OK item in low-stock results');
    if (!res.body.items.some(i=>i.itemCode==='LO'))  throw new Error('low item missing');
  });

  await test('D-05 ?search=rifle matches case-insensitively', async () => {
    const SC = require('../../backend/src/services/supply-chain.service');
    class R { async getCommandScope(u){return{ids:[u],codes:[]};} }
    class N { async notifyLowStock(){} async notifyTransferPending(){} async notifyTransferDecision(){} }
    const supply = new SC(null,new R(),new N());
    await supply.createItem({itemCode:'RFL-01',itemName:'L96 Rifle',    category:'EQUIPMENT',unitId:10,quantity:10});
    await supply.createItem({itemCode:'AMM-01',itemName:'5.56mm Rounds',category:'AMMO',     unitId:10,quantity:500});
    const app = createApp(null,{supply},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/items?search=rifle',makeToken());
    srv.close();
    if (!res.body.items.some(i=>i.itemCode==='RFL-01')) throw new Error('rifle not found');
    if (res.body.items.some(i=>i.itemCode==='AMM-01'))  throw new Error('ammo leaked into rifle search');
  });

  // ── E: /api/supply/categories ─────────────────────────────────
  console.log('\n📋 Group E: /api/supply/categories');

  await test('E-01 returns 10 categories', async () => {
    const app = createApp(null,{},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/categories',makeToken());
    srv.close();
    if (res.status !== 200)                  throw new Error(`${res.status}`);
    if (res.body.categories.length !== 10)   throw new Error(`Expected 10, got ${res.body.categories.length}`);
  });

  await test('E-02 ARMS not in categories', async () => {
    const app = createApp(null,{},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/categories',makeToken());
    srv.close();
    if (res.body.categories.includes('ARMS')) throw new Error('ARMS wrongly present');
  });

  await test('E-03 EQUIPMENT and GENERAL present', async () => {
    const app = createApp(null,{},{logLevel:false});
    const srv = http.createServer(app);
    await new Promise(r => srv.listen(0,r));
    const res = await bget(srv.address().port,'/api/supply/categories',makeToken());
    srv.close();
    if (!res.body.categories.includes('EQUIPMENT')) throw new Error('EQUIPMENT missing');
    if (!res.body.categories.includes('GENERAL'))   throw new Error('GENERAL missing');
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Day 29 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
