/**
 * core/effects/MotionPath.ts
 *
 * «يمشي عبر هذه النقاط» (v1.0.33 §2) — منحنى ناعم يمرّ **بكل** نقطةٍ
 * رسمتها المؤلّفة، لا خطوطٌ مكسورة بينها.
 *
 * ── لماذا Catmull-Rom المركزيّ ─────────────────────────────────────────
 *
 * المؤلّفة تنقر نقاطاً على المسرح وتتوقّع أن يمرّ البالون **بها**. منحنى
 * Bézier يقترب من نقاط التحكّم ولا يمرّ بها، فتنقر نقطةً ويمرّ العنصر
 * بجانبها — وهذا ما لا يفسّره لها شيء. Catmull-Rom يمرّ بكل نقطة بالتعريف.
 *
 * والصيغة **المركزية** (α = ½) لا العادية: العادية تصنع عُقَداً وحلقاتٍ
 * حين تتقارب نقطتان وتتباعد الثالثة — وهو بالضبط ما تفعله يدٌ تنقر بسرعة.
 *
 * ── ولماذا يُعاد التوسيط بالطول ────────────────────────────────────────
 *
 * معامل المنحنى الخام يقضي الوقت نفسه في كل مقطع، قصيراً كان أو طويلاً:
 * فيندفع البالون في المقطع الطويل ويزحف في القصير. جدول الأطوال يجعل
 * `t` نسبةً من **المسافة**، فتتوزّع السرعة على المسار كلّه، ويبقى `ease`
 * المؤلَّف هو وحده ما يغيّرها.
 *
 * خالصٌ بلا عارض ولا مكتبة حركة: يُختبر مباشرةً، ويبقى `core/effects`
 * بلا اعتماديات كما يقضي رأس `EffectRunner.ts`.
 */

import type { EffectPoint } from "./EffectContract";

/** عيّناتٌ لكل مقطع في جدول الأطوال — أكثر من كافٍ لعينٍ على ١٩٢٠ بكسل. */
const SAMPLES_PER_SEGMENT = 24;

/** دالّة: نسبة المسافة المقطوعة (٠..١) ← النقطة على المسار. */
export type PathSampler = (t: number) => EffectPoint;

/**
 * يبني المسار من نقاطه **بالترتيب**: الأولى البداية والأخيرة الوجهة.
 *
 * نقطتان متتاليتان متطابقتان تُدمجان (نقرةٌ مزدوجة على الموضع نفسه ليست
 * منعطفاً). ونقطةٌ واحدة مسارٌ ساكن — لا يرمي، كسائر المؤثّرات.
 */
export function pathSampler(input: ReadonlyArray<EffectPoint>): PathSampler {
  const points = dedupe(input);
  if (points.length === 0) return () => ({ x: 0, y: 0 });
  if (points.length === 1) {
    const only = points[0]!;
    return () => ({ x: only.x, y: only.y });
  }

  // نقاطٌ وهمية منعكسة عند الطرفين، فيبدأ المنحنى وينتهي باتّجاه أوّل
  // مقطعٍ وآخره — تكرار الطرف نفسه كان سيقسم على مسافة صفر.
  const first = points[0]!;
  const second = points[1]!;
  const last = points[points.length - 1]!;
  const beforeLast = points[points.length - 2]!;
  const padded = [
    { x: 2 * first.x - second.x, y: 2 * first.y - second.y },
    ...points,
    { x: 2 * last.x - beforeLast.x, y: 2 * last.y - beforeLast.y }
  ];

  // جدول: لكل عيّنة موضعها والمسافة المتراكمة حتى بلوغها.
  const samples: EffectPoint[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (let seg = 0; seg < points.length - 1; seg++) {
    const [p0, p1, p2, p3] = [padded[seg]!, padded[seg + 1]!, padded[seg + 2]!, padded[seg + 3]!];
    for (let i = seg === 0 ? 0 : 1; i <= SAMPLES_PER_SEGMENT; i++) {
      const point = centripetal(p0, p1, p2, p3, i / SAMPLES_PER_SEGMENT);
      const prev = samples[samples.length - 1];
      if (prev) total += Math.hypot(point.x - prev.x, point.y - prev.y);
      samples.push(point);
      lengths.push(total);
    }
  }

  return (t: number): EffectPoint => {
    if (!(t > 0)) return { x: first.x, y: first.y };
    if (t >= 1 || total === 0) return { x: last.x, y: last.y };
    const wanted = t * total;
    // بحثٌ ثنائي عن أوّل عيّنةٍ تبلغ المسافة المطلوبة.
    let lo = 0;
    let hi = lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid]! < wanted) lo = mid + 1;
      else hi = mid;
    }
    const b = samples[lo]!;
    const a = samples[Math.max(0, lo - 1)]!;
    const span = lengths[lo]! - lengths[Math.max(0, lo - 1)]!;
    const k = span > 0 ? (wanted - lengths[Math.max(0, lo - 1)]!) / span : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
}

function dedupe(points: ReadonlyArray<EffectPoint>): EffectPoint[] {
  const out: EffectPoint[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Barry–Goldman: نقطةٌ على المقطع p1→p2 عند نسبة u (٠..١). */
function centripetal(p0: EffectPoint, p1: EffectPoint, p2: EffectPoint, p3: EffectPoint, u: number): EffectPoint {
  const knot = (a: EffectPoint, b: EffectPoint): number => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;

  const lerp = (a: EffectPoint, b: EffectPoint, ta: number, tb: number): EffectPoint => {
    const wa = (tb - t) / (tb - ta);
    const wb = (t - ta) / (tb - ta);
    return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}
