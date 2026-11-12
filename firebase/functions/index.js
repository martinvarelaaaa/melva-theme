/**
 * Melva — Probador Virtual (MVP)
 * Cloud Function HTTP: recibe la foto de la clienta + la foto de la prenda,
 * llama a Gemini Image (nano banana) via VERTEX AI con la identidad del proyecto
 * y devuelve el render base64.
 *
 * Privacidad: NO se persiste ninguna imagen. Solo un log en Firestore (sin imagenes)
 * para rate limit y metricas. Config editable en Firestore config/tryon.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

const DEFAULTS = {
  model: 'gemini-2.5-flash-image',
  location: 'us-central1',
  perDeviceDailyCap: 5,
  globalDailyCap: 500,
  promptBase: `Viste a la persona de la imagen 1 con EXACTAMENTE la prenda que lleva la persona de la imagen 2.
Reglas:
- Preserva EXACTAMENTE el rostro, cabello, tono de piel, pose y fondo de la imagen 1. No cambies el rostro ni agregues accesorios nuevos.
- Reemplaza unicamente la prenda indicada: {category_instructions}
- Fidelidad absoluta al color, estampado, textura y largo de la prenda de la imagen 2.
- Ajusta la prenda al cuerpo de la persona de forma natural y realista (drapeado, arrugas, sombras coherentes con la luz de la imagen 1).
- Salida fotorrealista, sin texto, sin marcas de agua, sin bordes.`,
  categoryInstructions: {
    default: 'reemplaza la pieza superior si es un top o el conjunto completo si es un vestido; conserva la prenda inferior si la prenda nueva es un top.',
    dress: 'la imagen 2 muestra un vestido: reemplaza TODO el vestuario del cuerpo, de hombros a rodillas.',
    top: 'la imagen 2 muestra un top/remera/camisa: reemplaza solo la pieza superior; conserva pantalon o pollera de la imagen 1.',
    bottom: 'la imagen 2 muestra una pollera o pantalon: reemplaza solo la pieza inferior; conserva el top de la imagen 1.'
  }
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getConfig() {
  try {
    const snap = await db.collection('config').doc('tryon').get();
    return snap.exists ? { ...DEFAULTS, ...snap.data() } : DEFAULTS;
  } catch (e) {
    return DEFAULTS;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* Rate limit por identidad: hash(IP + UA). MVP razonable, sin Auth. */
function deviceKey(req) {
  const ip =
    req.headers['fastly-client-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32);
}

async function checkAndCount(config, dkey) {
  const day = today();
  const ref = db.collection('tryon_counts').doc(`${dkey}_${day}`);
  const globalRef = db.collection('tryon_counts').doc(`__global_${day}`);
  return db.runTransaction(async (tx) => {
    const [dev, glob] = await Promise.all([tx.get(ref), tx.get(globalRef)]);
    if ((dev.data()?.count || 0) >= config.perDeviceDailyCap) return { ok: false, reason: 'device' };
    if ((glob.data()?.count || 0) >= config.globalDailyCap) return { ok: false, reason: 'global' };
    tx.set(ref, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(globalRef, { count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true };
  });
}

function pickCategoryInstructions(config, productTitle) {
  const t = (productTitle || '').toLowerCase();
  const has = (words) => words.some((w) => t.includes(w));
  if (has(['vestido', 'dress'])) return config.categoryInstructions.dress;
  if (has(['pollera', 'falda', 'skirt', 'pantalon', 'pantalón', 'pants', 'jean', 'bermuda', 'short']))
    return config.categoryInstructions.bottom;
  if (has(['remera', 'top', 'blusa', 'camisa', 'buzo', 'sweater', 'shirt', 'corset'])) return config.categoryInstructions.top;
  return config.categoryInstructions.default;
}

async function fetchAsB64(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MelvaTryon/1.0)' } });
  if (!res.ok) throw new Error(`product_image_fetch_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 12 * 1024 * 1024) throw new Error('product_image_too_large');
  return buf.toString('base64');
}

function dataUrlToB64(url) {
  const i = url.indexOf('base64,');
  return i >= 0 ? url.slice(i + 7) : url;
}

/* Token del runtime desde el metadata server (identidad del proyecto) */
async function getAccessToken() {
  const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!res.ok) throw new Error(`metadata_token_${res.status}`);
  const j = await res.json();
  return j.access_token;
}

exports.tryon = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 10,
    invoker: 'public',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') return res.set(CORS_HEADERS).status(204).end();
    if (req.method !== 'POST') return res.set(CORS_HEADERS).status(405).json({ error: 'method' });
    res.set(CORS_HEADERS);

    const config = await getConfig();
    const body = req.body || {};
    const { userImage, productImage, productTitle } = body;
    if (!userImage || !productImage) return res.status(400).json({ error: 'missing_images' });
    if (typeof userImage !== 'string' || userImage.length > 8_000_000)
      return res.status(413).json({ error: 'image_too_large' });

    /* rate limit */
    try {
      const dkey = deviceKey(req);
      const allowed = await checkAndCount(config, dkey);
      if (!allowed.ok) return res.status(429).json({ error: 'rate_limited', reason: allowed.reason });
    } catch (e) {
      console.error('ratelimit_error', e);
      /* si Firestore falla, permitimos: no rompemos el shopper por infra */
    }

    /* imagen de producto (URL publica del CDN de Shopify) */
    let productB64;
    try {
      const prodUrl = productImage.startsWith('//') ? 'https:' + productImage : productImage;
      productB64 = prodUrl.startsWith('data:') ? dataUrlToB64(prodUrl) : await fetchAsB64(prodUrl);
    } catch (e) {
      console.error('product_img_error', e.message);
      return res.status(400).json({ error: 'product_image' });
    }

    const prompt = `${config.promptBase}\n${pickCategoryInstructions(config, productTitle)}`;

    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (e) {
      console.error('token_error', e);
      return res.status(500).json({ error: 'auth' });
    }

    const url =
      `https://aiplatform.googleapis.com/v1beta1/projects/${process.env.GCLOUD_PROJECT}` +
      `/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;

    const payload = {
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: userImage } },
          { inlineData: { mimeType: 'image/jpeg', data: productB64 } },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    let apiRes;
    try {
      apiRes = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error('vertex_fetch_error', e);
      return res.status(502).json({ error: 'upstream' });
    }

    const apiData = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) {
      console.error('vertex_error', apiRes.status, JSON.stringify(apiData).slice(0, 500));
      return res.status(502).json({ error: 'generation_failed' });
    }

    const parts = apiData?.candidates?.[0]?.content?.parts || [];
    const inline = parts.map((p) => p.inlineData).find(Boolean);
    if (!inline?.data) {
      console.error('vertex_no_image', JSON.stringify(apiData).slice(0, 500));
      return res.status(422).json({ error: 'no_image' });
    }

    /* log sin imagenes */
    db.collection('tryon_logs').add({
      productTitle: productTitle || null,
      variantId: body.variantId || null,
      device: deviceKey(req),
      model: config.model,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {});

    return res.status(200).json({ image: inline.data, mimeType: inline.mimeType || 'image/png' });
  }
);
