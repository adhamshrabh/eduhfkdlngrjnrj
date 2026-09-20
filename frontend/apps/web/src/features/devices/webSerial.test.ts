/**
 * العطل الذي فرض هذا الملف: المنصّة على خادم يُفتح بـ `http://<ip>:8888`،
 * فتقول صفحة «الأجهزة» «افتحي في Chrome» لمن هي في Chrome. الفحص كان
 * «هل `navigator.serial` موجود؟» ونسبةُ غيابه إلى المتصفّح وحده.
 */
import { afterEach, describe, expect, it } from "vitest";

import { SERIAL_BLOCK_TEXT, serialBlock } from "./webSerial";

const nav = navigator as unknown as { serial?: unknown };
const glob = globalThis as unknown as { window?: { isSecureContext: boolean } };

afterEach(() => {
  delete nav.serial;
  delete glob.window;
});

describe("serialBlock", () => {
  it("الواجهة موجودة: لا حجب ولا رسالة", () => {
    nav.serial = { getPorts: async () => [] };
    expect(serialBlock()).toBeNull();
  });

  it("صفحة على http: السبب الشهادة لا المتصفّح", () => {
    glob.window = { isSecureContext: false };
    expect(serialBlock()).toBe("insecure");
    // الرسالة تسمّي المخرج، وإلا قُرئت مرّةً وأُهملت.
    expect(SERIAL_BLOCK_TEXT.insecure).toContain("https");
  });

  it("سياق آمن والواجهة غائبة: المتصفّح هو السبب فعلاً", () => {
    glob.window = { isSecureContext: true };
    expect(serialBlock()).toBe("unsupported");
    expect(SERIAL_BLOCK_TEXT.unsupported).toContain("Chrome");
  });
});
