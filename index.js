'use strict';

const express = require('express');
const cron = require('node-cron');
const { fetchAllProducts } = require('./shopify');
const { generateXml } = require('./feedGenerator');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const config = {
  updateFrequencyHours: parseFloat(process.env.UPDATE_FREQUENCY_HOURS) || 6,
  vatRate: parseFloat(process.env.VAT_RATE ?? 21),
  currency: process.env.CURRENCY || 'EUR',
  language: process.env.LANGUAGE || 'en',
  defaultCategory: process.env.FRUUGO_DEFAULT_CATEGORY || 'Other',
  collectionId: process.env.SHOPIFY_COLLECTION_ID || 'gid://shopify/Collection/645243797842',
};

const state = {
  xml: null,
  lastUpdated: null,
  productCount: 0,
  isGenerating: false,
  lastError: null,
};

async function generateFeed() {
  if (state.isGenerating) { console.log('[Feed] Already generating, skipping.'); return; }
  state.isGenerating = true;
  state.lastError = null;
  console.log('[Feed] Starting generation...');
  try {
    const products = await fetchAllProducts(config.collectionId);
    state.xml = generateXml(products, config);
    state.lastUpdated = new Date();
    state.productCount = products.length;
    console.log('[Feed] Done - ' + products.length + ' products, ' + state.xml.length + ' bytes');
  } catch (err) {
    state.lastError = err.message;
    console.error('[Feed] Error:', err.message);
  } finally {
    state.isGenerating = false;
  }
}

let cronJob = null;

function buildCronExpression(hours) {
  if (hours < 1) { const mins = Math.max(1, Math.round(hours * 60)); return '*/' + mins + ' * * * *'; }
  const h = Math.round(hours);
  if (h >= 24) return '0 0 * * *';
  return '0 */' + h + ' * * *';
}

function startScheduler(hours) {
  if (cronJob) cronJob.stop();
  const expr = buildCronExpression(hours);
  console.log('[Scheduler] Cron: "' + expr + '" (every ' + hours + 'h)');
  cronJob = cron.schedule(expr, () => { generateFeed().catch(console.error); });
}

function adminHtml(flash) {
  flash = flash || '';
  const status = state.isGenerating ? 'Generating...' : state.xml ? 'Ready' : 'Not yet generated';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Fruugo Feed - Admin</title><style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;max-width:620px;margin:48px auto;padding:0 20px;color:#111}h1{margin-bottom:4px}.sub{color:#555;margin-bottom:32px}.card{background:#f6f6f6;border-radius:10px;padding:20px 24px;margin-bottom:28px}.card p{margin:4px 0}.key{color:#555;font-size:.85em}label{display:block;font-size:.9em;font-weight:600;margin-bottom:4px;margin-top:14px}input{width:100%;padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:.95em}.row{display:flex;gap:12px}.row input{margin-bottom:0}.btn{display:inline-block;padding:10px 22px;border:none;border-radius:6px;font-size:.95em;cursor:pointer;font-weight:600}.btn-primary{background:#0070f3;color:#fff}.actions{display:flex;gap:12px;margin-top:16px}.flash{background:#d4edda;color:#155724;border-radius:6px;padding:10px 16px;margin-bottom:20px;font-size:.9em}a{color:#0070f3;text-decoration:none}hr{border:none;border-top:1px solid #e5e5e5;margin:28px 0}</style></head><body><h1>Fruugo Feed</h1><p class="sub">Admin panel</p>' + flash + '<div class="card"><p><span class="key">Status</span><br><strong>' + status + '</strong></p><p><span class="key">Last updated</span><br>' + (state.lastUpdated ? state.lastUpdated.toUTCString() : 'Never') + '</p><p><span class="key">Products in feed</span><br>' + state.productCount.toLocaleString() + '</p>' + (state.lastError ? '<p><span class="key">Last error</span><br><span style="color:red">' + state.lastError + '</span></p>' : '') + '<p><span class="key">Feed URL</span><br><a href="/fruugo.xml" target="_blank">/fruugo.xml</a></p><p><span class="key">Update frequency</span><br>Every ' + config.updateFrequencyHours + ' hour(s)</p></div><h2>Actions</h2><form method="POST" action="/admin/refresh" style="display:inline"><button class="btn btn-primary" type="submit">Refresh Feed Now</button></form><hr /><h2>Settings</h2><form method="POST" action="/admin/config"><label>Update Frequency (hours)</label><input type="number" name="updateFrequencyHours" value="' + config.updateFrequencyHours + '" min="0.25" step="0.25" required /><div class="row"><div style="flex:1"><label>VAT Rate (%)</label><input type="number" name="vatRate" value="' + config.vatRate + '" min="0" max="100" step="0.1" /></div><div style="flex:1"><label>Currency (ISO 4217)</label><input type="text" name="currency" value="' + config.currency + '" maxlength="3" /></div></div><div class="row"><div style="flex:1"><label>Language (ISO 639-1)</label><input type="text" name="language" value="' + config.language + '" maxlength="5" /></div><div style="flex:1"><label>Default Fruugo Category</label><input type="text" name="defaultCategory" value="' + config.defaultCategory + '" /></div></div><div class="actions"><button class="btn btn-primary" type="submit">Save Settings</button></div></form></body></html>';
}

app.get('/', (req, res) => res.redirect('/admin'));

app.get('/fruugo.xml', (req, res) => {
  if (!state.xml) return res.status(503).set('Retry-After', '30').send('Feed is being generated, please try again shortly.');
  res.set('Content-Type', 'application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(state.xml);
});

app.get('/admin', (req, res) => {
  let flash = '';
  if (req.query.saved) flash = '<div class="flash">Settings saved.</div>';
  if (req.query.refreshing) flash = '<div class="flash">Feed refresh triggered.</div>';
  res.send(adminHtml(flash));
});

app.post('/admin/config', (req, res) => {
  const { updateFrequencyHours, vatRate, currency, language, defaultCategory } = req.body;
  if (updateFrequencyHours) { const h = parseFloat(updateFrequencyHours); if (h > 0) { config.updateFrequencyHours = h; startScheduler(h); } }
  if (vatRate !== undefined) config.vatRate = parseFloat(vatRate) || 0;
  if (currency) config.currency = currency.toUpperCase().trim().slice(0, 3);
  if (language) config.language = language.toLowerCase().trim().slice(0, 5);
  if (defaultCategory) config.defaultCategory = defaultCategory.trim();
  res.redirect('/admin?saved=1');
});

app.post('/admin/refresh', (req, res) => {
  generateFeed().catch(console.error);
  res.redirect('/admin?refreshing=1');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: state.isGenerating ? 'generating' : state.xml ? 'ready' : 'empty', lastUpdated: state.lastUpdated, productCount: state.productCount });
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, async () => {
  console.log('Server listening on port ' + PORT);
  startScheduler(config.updateFrequencyHours);
  generateFeed().catch(console.error);
});
