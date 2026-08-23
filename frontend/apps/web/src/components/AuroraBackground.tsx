/**
 * خلفية متحركة موحّدة — نمط "Aurora" (كتل تدرّج ضبابية تنساب ببطء) بألوان
 * هوية المنصّة نفسها بلا استثناء: بنفسجي، أزرق سماوي، وردي ناعم — بدل
 * تدرّجات مختلفة لكل صفحة.
 *
 * CSS خالص (transform + filter، بلا JS متحرّك ولا مكتبة جسيمات ولا صورة/فيديو
 * مُحمَّل) — عمداً: هذه منصّة تعمل على أجهزة روضة متواضعة، ومكتبات كـ
 * particles.js/three.js تضيف مئات الكيلوبايتات لأثر بصري نفس النتيجة منه
 * ممكنة بـ opacity + blur. transform/opacity مسرَّعتان بمعالج الرسوميات فلا
 * تُثقلان المعالج الرئيسي، وقاعدة prefers-reduced-motion العامة (index.css)
 * تُجمّدها تلقائياً لمن يفضّل حركة أقل.
 *
 * ثابتة الموضع خلف كل شيء (-z-10) — توضع مرّة واحدة في AppShell فتظهر خلف
 * كل تاب، وفي LoginPage بنفس الألوان والحركة تماماً، حتى يبقى الانطباع
 * الأول والتجربة كلّها بصمة بصرية واحدة لا شاشتين مختلفتين.
 */

interface Particle {
  left: number;
  size: number;
  duration: number;
  delay: number;
  opacity: number;
}

// ثابتة عند تحميل الوحدة — لا داعي لعشوائية جديدة بكل رسم، فقط تنويع بصري.
const PARTICLES: Particle[] = Array.from({ length: 16 }, (_, i) => {
  const seed = i * 137.5; // زاوية ذهبية تقريبية — توزيع متباعد بلا تكتّل
  return {
    left: seed % 100,
    size: 3 + ((i * 7) % 6),
    duration: 14 + ((i * 5) % 12),
    delay: -(i * 1.7) % 18,
    opacity: 0.25 + ((i * 3) % 4) * 0.1,
  };
});

export function AuroraBackground(): JSX.Element {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-[#F7F7FC]">
      <div
        className="absolute -top-1/4 -right-1/4 w-[60vw] h-[60vw] max-w-[720px] max-h-[720px]
          rounded-full bg-primary/30 blur-[110px] animate-aurora-a motion-reduce:animate-none"
      />
      <div
        className="absolute top-1/3 -left-1/4 w-[55vw] h-[55vw] max-w-[640px] max-h-[640px]
          rounded-full bg-sky-300/30 blur-[110px] animate-aurora-b motion-reduce:animate-none"
      />
      <div
        className="absolute -bottom-1/4 right-1/4 w-[50vw] h-[50vw] max-w-[560px] max-h-[560px]
          rounded-full bg-pink-300/25 blur-[110px] animate-aurora-c motion-reduce:animate-none"
      />

      {/* جسيمات عائمة — عمق خفيف بلا تشتيت */}
      <div className="absolute inset-0 motion-reduce:hidden">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute bottom-0 rounded-full bg-white animate-float"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              // @ts-expect-error -- خاصية CSS مخصّصة يقرأها keyframe الحركة
              "--float-opacity": p.opacity,
            }}
          />
        ))}
      </div>

      {/* حبيبات خفيفة جداً تكسر ملمس التدرّج الأملس — لمسة "فاخرة" لا مسطّحة */}
      <div
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
