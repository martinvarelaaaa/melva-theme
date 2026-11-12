/* Melva Probador Virtual — MVP. Vanilla JS, sin dependencias. */
(function () {
  'use strict';

  var root = document.getElementById('MelvaTryon');
  if (!root) return;

  var modal = document.getElementById('MelvaTryonModal');
  var fileInput = root.querySelector('.melva-tryon-file');
  var consent = root.querySelector('#MelvaTryonConsent');
  var goBtn = root.querySelector('[data-tryon-go]');
  var steps = {
    upload: root.querySelector('[data-step="upload"]'),
    loading: root.querySelector('[data-step="loading"]'),
    result: root.querySelector('[data-step="result"]'),
    error: root.querySelector('[data-step="error"]'),
    added: root.querySelector('[data-step="added"]')
  };
  var resultImg = root.querySelector('.melva-tryon-result-img');
  var errorText = root.querySelector('[data-tryon-error]');
  var userImageB64 = null;
  var currentVariantId = null;

  /* ---------- helpers ---------- */
  function show(step) {
    Object.keys(steps).forEach(function (k) {
      if (steps[k]) steps[k].hidden = k !== step;
    });
  }

  function readCurrentVariant() {
    /* 1) el variant_id actual lo empuja Dawn al cambiar; 2) fallback: URL ?variant=; 3) el inicial del Liquid */
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('variant')) return params.get('variant');
    } catch (e) {}
    return root.dataset.variantId || null;
  }

  function readCurrentProductImage() {
    /* imagen principal activa de la galería Dawn (sigue al variant), fallback al featured del Liquid */
    var img = root.closest('.product') &&
      root.closest('.product').querySelector('.product__media-item.is-active img, .product__media img');
    if (img && img.currentSrc) return img.currentSrc;
    return root.dataset.productImg;
  }

  function downscale(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var MAX = 768;
        var scale = Math.min(1, MAX / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        cb(dataUrl.split(',')[1], dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- eventos ---------- */
  root.querySelector('.melva-tryon-open').addEventListener('click', function () {
    modal.hidden = false;
    document.body.classList.add('melva-tryon-locked');
    show('upload');
    resetUpload();
  });

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-tryon-close]')) {
      close();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  function close() {
    modal.hidden = true;
    document.body.classList.remove('melva-tryon-locked');
  }

  function resetUpload() {
    userImageB64 = null;
    consent.checked = false;
    goBtn.disabled = true;
  }

  root.querySelector('[data-tryon-pick]').addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    if (!fileInput.files || !fileInput.files[0]) return;
    downscale(fileInput.files[0], function (b64) {
      userImageB64 = b64;
      updateGo();
      var hint = root.querySelector('.melva-tryon-dropzone-hint');
      hint.textContent = '✓ Foto cargada — podés cambiarla si querés';
    });
  });
  consent.addEventListener('change', updateGo);
  function updateGo() {
    goBtn.disabled = !(userImageB64 && consent.checked);
  }

  goBtn.addEventListener('click', generate);

  root.querySelectorAll('[data-tryon-retry]').forEach(function (b) {
    b.addEventListener('click', function () {
      show('upload');
      resetUpload();
    });
  });

  /* ---------- generate ---------- */
  function generate() {
    show('loading');
    var payload = {
      userImage: userImageB64,
      productImage: readCurrentProductImage(),
      productTitle: root.dataset.productTitle,
      variantId: readCurrentVariant(),
      productId: root.dataset.productHandle
    };
    fetch(root.dataset.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (r.status === 429) throw Object.assign(new Error('limit'), { code: 429 });
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data.image) throw new Error('no_image');
        resultImg.src = 'data:image/png;base64,' + data.image;
        currentVariantId = data.variantId || payload.variantId;
        show('result');
        track('tryon_done');
      })
      .catch(function (err) {
        show('error');
        if (err.code === 429) {
          errorText.textContent = 'Alcanzaste el límite de pruebas por hoy. Volvé mañana 🙌';
        } else {
          errorText.textContent = 'No pudimos procesar esta foto. Probá con otra imagen 🙏';
        }
        track('tryon_error');
      });
    track('tryon_generate');
  }

  /* ---------- carrito ---------- */
  root.querySelector('[data-tryon-cart]').addEventListener('click', function () {
    if (!currentVariantId) {
      window.location.href = '/cart';
      return;
    }
    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ id: parseInt(currentVariantId, 10), quantity: 1 }] })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.status) throw new Error(res.description || 'cart_error');
        var t = steps.added.querySelector('[data-tryon-added-text]');
        t.textContent = '✓ ' + root.dataset.addedLabel;
        show('added');
        track('tryon_add_to_cart');
      })
      .catch(function () {
        window.location.href = '/cart';
      });
  });

  /* ---------- métricas ---------- */
  function track(ev) {
    try {
      if (window.gtag) window.gtag('event', ev, { product: root.dataset.productHandle });
    } catch (e) {}
  }
})();
