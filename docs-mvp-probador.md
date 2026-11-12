# Melva — MVP: Probador Virtual (PDP)

Fecha: 11/11/2026 · Alcance decidido: solo Melva primero · Solo probador (sin ropero en esta fase)

## 1. Qué es

Botón "Probatelo" en cada página de producto de Melva. La clienta sube UNA foto de sí misma, Gemini (nano banana) la viste con esa prenda y ve el resultado en segundos. Sin chat, sin registro, sin input libre. Un solo flujo, ágil.

## 2. Flujo de UX (mobile-first — el tráfico de Melva viene de Instagram)

1. PDP → botón "Probatelo" bajo el botón de compra (o thumbnail flotante en mobile).
2. Modal full-screen:
   - Paso A: subir foto (botón cámara / galería) con guía visual: "de pie, cuerpo entero o medio cuerpo, buena luz, ropa ajustada al cuerpo".
   - Paso B: checkbox consentimiento ("uso de mi foto solo para generar esta imagen, se borra en 24 h").
   - Paso C: estado de espera con skeleton/shimmer + copy "Estamos vistiéndote..." (5-15 s reales).
   - Paso D: resultado — imagen generada + acciones: [Agregar al carrito] [Probar otra foto] [Regenerar].
3. "Probar otra prenda" desde el resultado → vuelve al modal con el catálogo navegable mini (prenda actual por defecto).

Estados de error:
- Safety filter de Gemini rechaza (tops finos, sedas) → "No pudimos procesar esta foto. Probá con otra imagen o escribinos por IG." (nunca mostrar error técnico).
- Foto borrosa/muy chica → aviso previo a gastar créditos.
- Límite diario alcanzado → "Volvé mañana o probá más prendas mañana" (anti-abuso).

## 3. Arquitectura (todo Google/Firebase, sin terceros)

```
[Theme Shopify Melva]  ← snippet Liquid + JS vanilla + CSS
   │  upload foto
   ▼
[Firebase Storage]  ← reglas: solo imágenes <10MB, jpeg/png/webp
   │  (App Check enforcement obligatorio desde 2-nov-2026)
   ▼
[Firestore: doc tryon/{id}]  status: pending
   │  trigger onCreate
   ▼
[Cloud Function: generateTryon]
   - lee foto producto (cacheada de Shopify)
   - llama Gemini Image (gemini-nano-banana-2.1) con prompt v1
   - guarda resultado en Storage
   - actualiza doc → status: done | error
   ▼
[Cliente]  onSnapshot del doc → muestra resultado
```

Decisiones clave:
- El render corre del lado SERVIDOR (Cloud Function), no del cliente: control de costo, rate limit, key nunca expuesta.
- Fotos de producto: webhook `products/create|update` de Shopify → Cloud Function guarda referencia de la foto principal (y recorte si hace falta) en Firestore `products/{id}`. Sin dependencia del Admin API en tiempo real.
- Sesión anónima: Firebase Auth anonymous + App Check; límite 5 try-ons/día por dispositivo (contador en Firestore, regla de seguridad).

## 4. Prompt pipeline (nano banana 2.1)

Un prompt base + variantes por categoría:
- **Base**: "Viste a la persona de la imagen 1 con exactamente la prenda de la imagen 2. Preserva exactamente: rostro, cabello, tono de piel, pose, fondo, iluminación. Cambia SOLO la prenda indicada. Fidelidad absoluta al color, estampado y largo de la prenda. Salida fotorrealista."
- Variantes: vestido (drapeado), top (no tocar pollera/pantalón de la foto original), calzado.
- El prompt vive en Firestore `config/prompts` — se itera sin tocar código.
- Cada categoría de producto lleva `promptVariant` en `products/{id}`.

## 5. Datos y privacidad

- Foto de entrada: se borra de Storage a las 24 h (Cloud Function programada).
- Salida: se conserva 7 días (para que la clienta la reencuentre), luego se borra.
- Checkbox explícito + actualización del privacy policy de Melva.
- No usar imágenes para entrenar (plan pago de Gemini API no entrena; free tier sí — usar plan pago).

## 6. Costos (verificados 11/11/2026)

| Ítem | Precio | Nota |
|---|---|---|
| Render nano banana 2.1 | $0.0336/img (1K), mitad en batch | $0.05/img 2K si se quiere más res |
| Storage | ~$0.026/GB/mes | despreciable |
| Functions/Firestore | capas gratuitas cubren MVP | |

Escenario 500 try-ons/mes ≈ **$17/mes**. 1.000 ≈ $34. Anti-abuso (límite 5/día) mantiene el techo.

## 7. Métricas (desde el día 1, eventos a GA4 + Firestore)

- widget_view → tryon_click → photo_uploaded → tryon_done → add_to_cart
- Tasa: click/widget, done/upload, add_to_cart/done, venta atribuida.
- Objetivo del experimento: add_to_cart post-try-on > 15% y devoluciones por talle ↓ (benchmark del rubro: +13% add-to-basket en Zalando).

## 8. NO incluye esta fase

Ropero, outfits múltiples, recomendación de compra, app genérica Shopify, dashboard de admin (métricas directas de Firestore/GA4 alcanzan), login con cuenta.

## 9. Plan de construcción (4 bloques)

1. **Firebase setup** (proyecto, App Check, Storage rules, Firestore schema, límites) — ~1 día.
2. **Pipeline de render** (Function + prompts + webhook de productos + test harness con fotos reales de Melva) — ~1-2 días. *Punto de control: validar calidad del render con prendas reales antes de seguir.*
3. **Widget en theme** (Liquid snippet + JS + estados + errores + mini-catalogo) — ~2 días.
4. **Métricas + límites + limpieza 24h + QA end-to-end en el store** — ~1 día.

Total estimado: ~5-6 días de trabajo. Requiere: proyecto Firebase (key Gemini plan pago), acceso Admin API de Melva.

## 10. Riesgos y plan B

- **Calidad insuficiente en vestidos/drapeados** (benchmark: FASHN es mejor en one-pieces) → si el test del bloque 2 no convence, se agrega FASHN solo para esa categoría (routing de pocas líneas; decisión con pruebas, no por adelantado).
- **Safety filter falsos positivos** en ropa reveladora → mensaje amable + registrar tasa de rechazo (si >10%, revisar prompts de contorno).
- **Deprecaciones Google** → usar alias de modelo vigente (nano banana 2.1; el original 2.5 ya fue apagado oct-2026) y aislar la llamada en 1 función.
- **Abuso de costo** → límite diario + App Check + monitoreo.
