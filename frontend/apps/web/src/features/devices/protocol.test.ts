/**
 * اختبارات EduDevice Protocol v1.
 *
 * العيّنات هنا **منسوخة حرفياً من شاشة صندوق حقيقي** — لوحة ESP32 بقارئ
 * MFRC522 وخمسة أزرار، `firmware/src/main.cpp`. لا تُستبدَل بعيّنات مؤلّفة:
 * قيمة هذا الملف كلّها أنه يثبّت ما يخرج من العتاد فعلاً، لا ما نظنّ أنه
 * يخرج منه.
 */

import { describe, it, expect } from "vitest";

import { LineBuffer, readSignal } from "./protocol";

describe("readSignal — ما يخرج من الصندوق حرفياً", () => {
  it("يقرأ رقم البطاقة", () => {
    const s = readSignal('{"v":1,"type":"card_detected","uid":"87BEC17A"}');
    expect(s.uid).toBe("87BEC17A");
    expect(s.position).toBeNull();
  });

  it("يقرأ موضع الزرّ — الخمسة كلّها", () => {
    for (let i = 1; i <= 5; i++) {
      const s = readSignal(`{"v":1,"type":"button","index":${i}}`);
      expect(s.position).toBe(i);
      expect(s.uid).toBeNull();
    }
  });

  it("النبضة ليست بطاقة ولا زرّاً — وإلّا اختارت كل خمس ثوانٍ خياراً", () => {
    const s = readSignal('{"v":1,"type":"heartbeat"}');
    expect(s.uid).toBeNull();
    expect(s.position).toBeNull();
  });

  it("سطر التشخيص `# reader version 0x92` ليس حدثاً", () => {
    // يُطبع عند الإقلاع. لولا استثناؤه لصار «بطاقة» اسمها نصّ كامل.
    const s = readSignal("# reader version 0x92");
    expect(s.uid).toBeNull();
    expect(s.position).toBeNull();
  });

  it("يوحّد حالة الأحرف — البطاقة نفسها لا تُربَط مرّتين", () => {
    expect(readSignal('{"v":1,"type":"card_detected","uid":"87bec17a"}').uid).toBe("87BEC17A");
  });

  it("سطر فارغ أو JSON مشوّه لا يُسقط شيئاً", () => {
    expect(() => readSignal("")).not.toThrow();
    expect(readSignal('{"v":1,"type":').uid).not.toBe("");
  });

  it("رقم عارٍ بلا JSON = موضع — سكتش قديم يبقى عاملاً", () => {
    expect(readSignal("3").position).toBe(3);
  });

  it("صفر ليس موضعاً — المواضع تبدأ من واحد", () => {
    expect(readSignal("0").position).toBeNull();
  });
});

describe("LineBuffer — الدفق يصل مقطّعاً", () => {
  it("يجمع سطراً انقسم على قراءتين", () => {
    // ⚠️ هذا ليس افتراضاً: المنفذ التسلسلي يسلّم البايتات كما تصل، فتحليل
    // كل قطعة وحدها يُسقط بطاقات بلا أي خطأ ظاهر.
    const buffer = new LineBuffer();
    expect(buffer.push('{"v":1,"type":"card_de')).toEqual([]);
    expect(buffer.push('tected","uid":"87BEC17A"}\n')).toEqual([
      '{"v":1,"type":"card_de' + 'tected","uid":"87BEC17A"}',
    ]);
  });

  it("يعيد عدّة أسطر وصلت في قراءة واحدة", () => {
    const buffer = new LineBuffer();
    const lines = buffer.push('{"v":1,"type":"button","index":1}\n{"v":1,"type":"heartbeat"}\n');
    expect(lines).toHaveLength(2);
    expect(readSignal(lines[0]!).position).toBe(1);
  });

  it("يحتفظ بالسطر الناقص للقراءة التالية", () => {
    const buffer = new LineBuffer();
    buffer.push('{"v":1,"type":"button","index":2}\n{"v":1,"type":"but');
    expect(buffer.push('ton","index":4}\n').map((l) => readSignal(l).position)).toEqual([4]);
  });

  it("يتجاهل CRLF — بعض السكتشات تُنهي بـ\r\n", () => {
    const buffer = new LineBuffer();
    const [line] = buffer.push('{"v":1,"type":"button","index":5}\r\n');
    expect(readSignal(line!).position).toBe(5);
  });
});
