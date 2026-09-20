/**
 * بوّابة Web Serial — والسبب الذي جعل «هذا المتصفّح لا يدعم» رسالةً مضلِّلة.
 *
 * ⚠️ `navigator.serial` لا يُعرَّف إلا في **سياق آمن**: `https://` أو
 * `localhost`/`127.0.0.1`. ووضعُ المنصّة على خادم يُفتح بـ `http://<ip>`
 * يحذف الواجهة من Chrome نفسه — فتقرأ المعلّمة «افتحي في Chrome» وهي في
 * Chrome، ويُبحَث عن العطل في المتصفّح والكبل والصندوق، والسبب في الخادم.
 *
 * فالغياب سببان لا سبب واحد، وموضع علاجهما مختلف: أحدهما شهادة على الخادم،
 * والآخر متصفّح عند المعلّمة. يُفصَلان هنا مرّة واحدة ويقرأهما المساران —
 * صفحة «الأجهزة» وصفحة العرض — من مصدرٍ واحد فلا تتناقض رسالتاهما.
 */

export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}

export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  /** حوار اختيار المنفذ — يشترط المتصفّح ضغطةً لفتحه. مسار العرض لا يناديه. */
  requestPort(): Promise<SerialPortLike>;
}

export function serialApi(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

/** سبب غياب الواجهة، أو `null` حين تكون متاحة. */
export type SerialBlock = "insecure" | "unsupported";

export function serialBlock(): SerialBlock | null {
  if (serialApi()) return null;
  // ترتيبٌ مقصود: الصفحة غير الآمنة تحجب الواجهة في Chrome أيضاً، فلو سألنا
  // عن المتصفّح أولاً لنسبنا إليه عطلاً ليس منه.
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure";
  return "unsupported";
}

/**
 * ما يُقال للمعلّمة — وكلٌّ منهما يسمّي الفعل التالي، لا العطل وحده.
 *
 * رسالةٌ تصف المشكلة بلا مخرج تُقرأ مرّةً ثم تُتجاهَل.
 */
export const SERIAL_BLOCK_TEXT: Readonly<Record<SerialBlock, string>> = {
  insecure:
    "قراءة المنفذ تحتاج اتصالاً آمناً، وهذه الصفحة مفتوحة عبر http. " +
    "افتحي المنصّة على عنوان https، أو على localhost في حاسوب الخادم نفسه.",
  unsupported: "هذا المتصفّح لا يدعم قراءة المنفذ. افتحي المنصّة في Chrome أو Edge على حاسوب.",
};
