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
  /* el dropzone vive en el modal (movido a body): buscarlo via modal, no via root */
  var dropzoneEl = modal ? modal.querySelector('.melva-tryon-dropzone') : null;
  var HINT_DEFAULT = 'De pie, buena luz, ropa ajustada al cuerpo';
  var lastFocus = null;
  var userImageB64 = null;
  var currentVariantId = null;
  var generating = false;

  /* El modal vive en <body>: Dawn pone transforms en .product__info-wrapper y eso
     captura position:fixed (el modal queda atrapado en la columna y el backdrop no cubre). */
  if (modal && modal.parentElement !== document.body) document.body.appendChild(modal);

  /* ---------- helpers ---------- */
  var LIVE_TEXT = {
    upload: 'Elegí una foto para probarte la prenda',
    loading: 'Vistiéndote… suele tardar entre 15 y 20 segundos',
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
    /* iOS-safe: las fotos de camara moderna (48MP) rompen el canvas de un paso.
       Dos pasos + verificacion + feedback de error visible. */
    var hint = dropzoneHint;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () {
        if (hint) hint.textContent = 'Esa foto no se pudo abrir. Probá con otra 🙏';
        cb(null, null);
      };
      img.onload = function () {
        try {
          var MAX = 768;
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, MAX / Math.max(w, h));
          var cw = Math.round(w * scale);
          var ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          if (Math.max(w, h) > 3000) {
            /* paso intermedio a la mitad hasta bajar de 2000px (limite practico de iOS) */
            var mw = Math.round(w / 2), mh = Math.round(h / 2);
            while (Math.max(mw, mh) > 2000) { mw = Math.round(mw / 2); mh = Math.round(mh / 2); }
            var mid = document.createElement('canvas');
            mid.width = mw;
            mid.height = mh;
            mid.getContext('2d').drawImage(img, 0, 0, mw, mh);
            ctx.drawImage(mid, 0, 0, cw, ch);
          } else {
            ctx.drawImage(img, 0, 0, cw, ch);
          }
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (!dataUrl || dataUrl.length < 2000) throw new Error('canvas_vacio');
          cb(dataUrl.split(',')[1], dataUrl);
        } catch (e) {
          if (hint) hint.textContent = 'Esa foto no se pudo procesar. Probá con otra 🙏';
          cb(null, null);
        }
      };
      img.src = reader.result;
    };
    reader.onerror = function () {
      if (hint) hint.textContent = 'No pudimos leer la foto. Probá con otra 🙏';
      cb(null, null);
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

  modal.querySelector('[data-tryon-pick]').addEventListener('click', function () {
    fileInput.click();
  });
  modal.querySelector('[data-tryon-pick]').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (!fileInput.files || !fileInput.files[0]) return;
    var dz = dropzoneEl;
    var hint = dropzoneHint;
    if (dz) { dz.classList.add('is-processing'); dz.classList.remove('is-loaded', 'is-error'); }
    if (hint) hint.textContent = 'Procesando foto…';
    userImageB64 = null;
    updateGo();
    downscale(fileInput.files[0], function (b64, dataUrl) {
      userImageB64 = b64 || null;
      updateGo();
      if (!dz) return;
      dz.classList.remove('is-processing');
      if (b64 && dataUrl) {
        /* feedback inconfundible: la foto elegida se ve dentro del dropzone */
        dz.style.setProperty('--melva-photo', 'url("' + dataUrl + '")');
        dz.classList.add('is-loaded');
        if (hint) hint.textContent = '✓ Foto cargada — tocá la foto para cambiarla';
      } else {
        dz.classList.add('is-error');
        dz.classList.remove('is-loaded');
        dz.style.removeProperty('--melva-photo');
      }
    });
  });
  consent.addEventListener('change', updateGo);
  function updateGo() {
    goBtn.disabled = !(userImageB64 && consent.checked);
  }

  goBtn.addEventListener('click', generate);

  modal.querySelectorAll('[data-tryon-retry]').forEach(function (b) {
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
    var cartBtn = modal.querySelector('[data-tryon-cart]');
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
  modal.querySelector('[data-tryon-cart]').addEventListener('click', function () {
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

  /* ---------- compartir look ---------- */
  modal.querySelector('[data-tryon-share]').addEventListener('click', function () {
    if (!resultImg.src || !resultImg.src.startsWith('data:')) return;
    fetch(resultImg.src)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var file = new File([blob], 'melva-probador.png', { type: 'image/png' });
        var nav = navigator;
        if (nav.canShare && nav.canShare({ files: [file] })) {
          return nav.share({
            files: [file],
            title: root.dataset.productTitle,
            text: 'Mirá cómo me queda: ' + root.dataset.productTitle
          }).catch(function () {});
        }
        var a = document.createElement('a');
        a.href = resultImg.src;
        a.download = 'melva-probador.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(function () {});
    track('tryon_share');
  });

  /* ---------- métricas ---------- */
  function track(ev) {
    try {
      if (window.gtag) window.gtag('event', ev, { product: root.dataset.productHandle });
    } catch (e) {}
  }
})();
