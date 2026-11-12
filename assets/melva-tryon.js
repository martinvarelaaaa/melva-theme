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
  var liveRegion = root.querySelector('[data-tryon-live]');
  var dropzoneHint = root.querySelector('.melva-tryon-dropzone-hint');
  var HINT_DEFAULT = 'De pie, buena luz, ropa ajustada al cuerpo';
  var lastFocus = null;
  var userImageB64 = null;
  var currentVariantId = null;
  var generating = false;

  /* ---------- helpers ---------- */
  var LIVE_TEXT = {
    upload: 'Elegí una foto para probarte la prenda',
    loading: 'Generando tu prueba. Suele tardar entre 15 y 20 segundos',
    result: 'Listo, así te queda la prenda',
    error: 'Hubo un problema. Podés intentar de nuevo',
    added: 'Prenda agregada al carrito'
  };
  function show(step) {
    Object.keys(steps).forEach(function (k) {
      if (steps[k]) steps[k].hidden = k !== step;
    });
    if (liveRegion) liveRegion.textContent = LIVE_TEXT[step] || '';
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
  root.querySelector('.melva-tryon-open').addEventListener('click', open);
  function open() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('melva-tryon-locked');
    show('upload');
    resetUpload();
    var first = modal.querySelector('.melva-tryon-dropzone') || modal.querySelector('button');
    if (first) first.focus();
  }

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
    var target = (lastFocus && lastFocus !== document.body && lastFocus.focus) ? lastFocus : root.querySelector('.melva-tryon-open');
    if (target) target.focus();
  }

  /* focus trap dentro del card */
  modal.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var focusables = Array.prototype.filter.call(
      modal.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null && !el.disabled; }
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function resetUpload() {
    userImageB64 = null;
    consent.checked = false;
    goBtn.disabled = true;
    fileInput.value = '';
    if (dropzoneHint) dropzoneHint.textContent = HINT_DEFAULT;
  }

  root.querySelector('[data-tryon-pick]').addEventListener('click', function () {
    fileInput.click();
  });
  root.querySelector('[data-tryon-pick]').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
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
      var keepWork = !steps.error.hidden; /* 'Intentar de nuevo' tras un error: conserva foto y consentimiento */
      show('upload');
      if (keepWork) {
        updateGo();
      } else {
        resetUpload();
      }
    });
  });

  /* ---------- generate ---------- */
  function generate() {
    if (generating) return;
    generating = true;
    goBtn.disabled = true;
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
        if (!r.ok) throw Object.assign(new Error('http_' + r.status), { http: r.status });
        return r.json();
      })
      .then(function (data) {
        if (!data.image) throw new Error('no_image');
        resultImg.src = 'data:image/png;base64,' + data.image;
        currentVariantId = data.variantId || payload.variantId;
        updateCartLabel();
        show('result');
        track('tryon_done');
      })
      .catch(function (err) {
        show('error');
        if (err.code === 429) {
          errorText.textContent = 'Alcanzaste el límite de pruebas por hoy. Volvé mañana 🙌';
        } else if (err.message === 'no_image' || err.http === 422) {
          errorText.textContent = 'No pudimos ponerte la prenda con esta foto. Probá con otra de cuerpo entero y buena luz.';
        } else if (err.http === 413) {
          errorText.textContent = 'La foto es muy pesada. Probá con una más liviana.';
        } else {
          errorText.textContent = 'No pudimos procesar esta foto. Probá con otra imagen 🙏';
        }
        track('tryon_error');
      })
      .finally(function () {
        generating = false;
        updateGo();
      });
    track('tryon_generate');
  }

  /* CTA del resultado con precio del variant activo */
  function updateCartLabel() {
    var cartBtn = root.querySelector('[data-tryon-cart]');
    if (!cartBtn) return;
    var price = '';
    try {
      var p = document.querySelector('.price-item--regular, .product__info-container .price__regular [class*=money]');
      if (p) price = p.textContent.trim();
    } catch (e) {}
    var size = '';
    try {
      var checked = document.querySelector('.product-form__input input[type=radio]:checked');
      if (checked && checked.name && /talle|size/i.test(checked.name)) size = checked.value;
    } catch (e) {}
    var bits = [root.dataset.cartLabel || 'Agregar al carrito'];
    if (size) bits.push('Talle ' + size);
    if (price) bits.push(price);
    cartBtn.textContent = bits.join(' · ');
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
