import { describe, it, expect } from "vitest";
import { pathSampler } from "./MotionPath";

describe("pathSampler — المسار عبر نقاط المؤلّفة (v1.0.33 §2)", () => {
  it("يبدأ عند أوّل نقطةٍ وينتهي عند آخرها", () => {
    const at = pathSampler([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 0 }]);
    expect(at(0)).toEqual({ x: 0, y: 0 });
    expect(at(1)).toEqual({ x: 200, y: 0 });
  });

  it("يمرّ بالنقاط الوسطى — لا يقترب منها فقط", () => {
    const points = [{ x: 0, y: 0 }, { x: 300, y: 300 }, { x: 600, y: 0 }];
    const at = pathSampler(points);
    let closest = Infinity;
    for (let i = 0; i <= 1000; i++) {
      const p = at(i / 1000);
      closest = Math.min(closest, Math.hypot(p.x - 300, p.y - 300));
    }
    expect(closest).toBeLessThan(3);
  });

  it("السرعة متّسقة: نصف الوقت ≈ نصف المسافة ولو اختلفت أطوال المقاطع", () => {
    // مقطعٌ قصير ثم طويل، على خطٍّ مستقيم.
    const at = pathSampler([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 1000, y: 0 }]);
    expect(at(0.5).x).toBeGreaterThan(450);
    expect(at(0.5).x).toBeLessThan(550);
  });

  it("نقرةٌ مزدوجة على الموضع نفسه ليست منعطفاً", () => {
    const at = pathSampler([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(at(0.5).x).toBeCloseTo(50, 0);
  });

  it("نقطةٌ واحدة أو لا شيء: ساكنٌ ولا يرمي", () => {
    expect(pathSampler([{ x: 5, y: 7 }])(0.3)).toEqual({ x: 5, y: 7 });
    expect(() => pathSampler([])(0.5)).not.toThrow();
  });
});
