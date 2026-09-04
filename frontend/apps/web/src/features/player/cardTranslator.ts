/**
 * المترجم: رقم بطاقة ← معنىً تفهمه القصّة.
 *
 * ⚠️ لماذا هنا لا في المحرّك:
 * المحرّك لا يعرف أن RFID موجود، ولا يعرف أن للمنصّة واجهة برمجية. هذا نصّ
 * `ExternalInput.ts` حرفياً: النقل والمعنى خارج المحرّك، والداخل إليه شيء
 * واحد — **قصدُ اختيار** (`Dialogue.ChoiceSelected`). فهذا الملف مستهلك
 * للمنفذ نفسه الذي تستهلكه أزرار الشاشة، ولا يمنحه امتيازاً.
 *
 * ويبثّه على ناقل المحرّك الذي أُعطي له، لا عبر `globalThis.eduInput` —
 * انظر التعليق عند البثّ لِما كلّفه ذلك الوسيط.
 *
 * القسمة الكاملة:
 *
 *     الـESP32 يعرف  →  786qaaa                 ولا شيء غيره
 *     هذا المترجم    →  786qaaa ← «تفاحة»       جدولٌ من المنصّة
 *     القصّة تعرف     →  «تفاحة»                 اسم أصلٍ اختارته المعلّمة
 *
 * فتُفقد البطاقة؟ تُربط أخرى بالاسم نفسه ولا تتغيّر القصّة بحرف. وتُنقل
 * القصّة إلى غرفة ببطاقات أخرى؟ تعمل. ويُنزع القارئ؟ تعمل باللمس.
 *
 * والإشارات الرقمية لا تمرّ من هنا: `YaraBedScene.readDevicePosition` يلتقط
 * «٢» موضعاً قبل أن يصل الأمر إلينا، وهو المسار الذي يعمل بلا جدول أصلاً.
 * فالطبقتان لا تتنازعان — الرقم موضع، والنصّ اسم.
 */

import { EngineEvents, type BootstrappedApp } from "@edu/engine";

import { api } from "../../lib/api";

/** ما يصل من `/api/devices/` — الحقول التي يحتاجها المترجم وحدها. */
interface DeviceRow {
  cards?: Array<{ uid?: string; label?: string }>;
}

/**
 * رقم البطاقة داخل حدث عتاد، أياً كان شكل السكتش.
 *
 * متسامح عمداً: لا بروتوكول مثبَّتاً بعد، ولوحة تُرسل `{type:"card",
 * payload:"786qaaa"}` يجب أن تعمل كما تعمل لوحة تُرسل
 * `{type:"card_detected", payload:{uid:"786qaaa"}}`. رفض شكلٍ لم نتوقّعه
 * يعني قارئاً صامتاً بلا رسالة — أسوأ ما يقع أمام صفّ.
 *
 * يُرجع null لما ليس بطاقة: الأرقام (مواضع، يتكفّل بها المشهد) والفراغ.
 */
export function readCardUid(event: unknown): string | null {
  const node = event as { type?: unknown; payload?: unknown } | null;
  if (!node) return null;

  const candidates: unknown[] = [
    (node.payload as { uid?: unknown } | null)?.uid,
    node.payload,
    node.type
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const uid = candidate.trim();
    if (!uid) continue;
    // رقمٌ خالص موضعٌ لا بطاقة — وقد عولج قبل الوصول إلى هنا.
    if (/^\d+$/.test(uid)) continue;
    // أسماء الأحداث ليست بطاقات. لولا هذا الاستثناء لصار «card_detected»
    // نفسه رقمَ بطاقةٍ يُبحث عنه في الجدول ولا يوجد.
    if (/^(card_detected|card_removed|heartbeat|card)$/i.test(uid)) continue;
    return uid;
  }
  return null;
}

/**
 * جدول الترجمة لكل قارئات المعلّمة، مدموجاً.
 *
 * مدموج ولا يسأل «أي قارئ؟»: البطاقة قطعة مادّية واحدة، ولو قُرئت على
 * جهازين فمعناها واحد. وسؤال المعلّمة عن القارئ قبل الحصّة خطوةٌ تُنسى.
 *
 * يُرجع جدولاً فارغاً عند أي فشل — بلا جدول تبقى القصّة تعمل باللمس
 * وبالموضع، ولا يجوز أن يمنع تعذّر قراءةِ إعدادٍ بدءَ حصّة.
 */
export async function loadCardBindings(): Promise<Map<string, string>> {
  const bindings = new Map<string, string>();
  try {
    const data = await api.get<{ results?: DeviceRow[] }>("/api/devices/");
    for (const device of data.results ?? []) {
      for (const card of device.cards ?? []) {
        if (card.uid && card.label) bindings.set(card.uid, card.label);
      }
    }
  } catch {
    /* لا جهاز، أو لا جلسة — اللمس يكفي */
  }
  return bindings;
}

/**
 * يوصل المترجم بالمحرّك. يُرجع دالّة فصل.
 *
 * بطاقة مجهولة تُهمَل بصمت: قد تكون بطاقة حافلة في جيب طفلة. تحذيرٌ عالٍ
 * هنا يعني ضجيجاً في سجلّ المعلّمة عن شيء ليس عطلاً.
 */
export function attachCardTranslator(app: BootstrappedApp, bindings: Map<string, string>): () => void {
  if (bindings.size === 0) {
    // أشيع سبب لـ«وضعتُ البطاقة ولم يتعرّف»: لا جدول أصلاً، فالمترجم
    // لا يُركَّب ولا شيء يقول ذلك.
    console.info("[edu-device] لا بطاقات مربوطة — اربطيها من صفحة «الأجهزة».");
    return () => {};
  }
  console.info(`[edu-device] الجدول جاهز: ${[...bindings.values()].join("، ")}`);

  const onHardware = (payload: unknown): void => {
    const uid = readCardUid(payload);
    if (!uid) return;
    const label = bindings.get(uid);
    if (!label) {
      console.info(`[edu-device] بطاقة ${uid} غير مربوطة بأي معنى.`);
      return;
    }
    // الاسم يصل المنفذ؛ ما بعده شأن النشاط: يطابق على `alias` ثم المعرّف
    // ثم الموضع. فإن ظهر هذا السطر ولم يحدث شيء، فالخلل في تطابق الاسم مع
    // اسم الأصل — لا في القارئ ولا في الجدول.
    console.info(`[edu-device] ${uid} ← «${label}»`);

    // ── على ناقل **هذا** المحرّك، لا عبر `globalThis.eduInput` ────────────
    //
    // ⚠️ عطل قِيس فعلياً: البطاقة تُقرأ وتُترجم ويظهر اسمها على الشاشة، ثم
    // لا يتحرّك النشاط — بينما النقر على الخيار نفسه يعمل.
    //
    // السبب أن `App.instance` لا يُضبط إلا **بعد** انتهاء الإقلاع، وReact
    // في وضع التطوير يركّب المكوّن مرّتين: فيبدأ إقلاعان متوازيان،
    // و`App.stop()` بينهما لا يجد شيئاً ليوقفه. و`ExternalInput.attach`
    // يُنفَّذ في كليهما، فيبقى `globalThis.eduInput` مشيراً إلى ناقل
    // المحرّك الذي هُدم — أو يُحذف كلّياً مع هدمه. النقر ينجو لأنه يصل
    // كائنات Pixi الحيّة مباشرةً، والبطاقة تمرّ بالعالمي المعطوب.
    //
    // والمنفذ لم يتغيّر: `eduInput.choose()` لا يفعل شيئاً سوى بثّ هذا
    // الحدث بالذات على ناقله. فهذا هو المنفذ نفسه، بلا وسيطٍ عالميّ قد
    // يشير إلى محرّكٍ آخر. والمترجم يملك `app` أصلاً — فلا سبب لسؤال
    // العالم عمّن يستمع.
    app.eventBus.emit(EngineEvents.Dialogue.ChoiceSelected, { choice: label });
  };

  app.eventBus.on(EngineEvents.Hardware.Event, onHardware);
  return () => app.eventBus.off(EngineEvents.Hardware.Event, onHardware);
}
