/**
 * نظام التصميم.
 *
 * الألوان ومقياس الخطوط مأخوذة من نظام التصميم المعتمد في مشاريعك
 * (kindergarten-platform) حتى تبقى الهوية البصرية واحدة عبر منتجاتك.
 *
 * الإضافة الخاصة بهذا المشروع هي مقياس `present-*`: العرض على بروجكتور
 * يُقرأ من آخر الغرفة، ومقياس الشاشة العادي (28px كأكبر حجم) غير مقروء
 * على مسافة ستة أمتار. لذلك وضع العرض له مقياسه المستقل.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#7F77DD", dark: "#534AB7", light: "#EEEDFE" },
        secondary: "#1D9E75",
        "accent-ai": "#D85A30",
        // ألوان التصنيف — خلفية ونص لكل مجال
        subject: {
          science: { bg: "#E1F5EE", fg: "#085041" },
          motor: { bg: "#E6F1FB", fg: "#0C447C" },
          art: { bg: "#FBEAF0", fg: "#72243E" },
          language: { bg: "#FAEEDA", fg: "#633806" },
          math: { bg: "#EAF3DE", fg: "#27500A" },
          story: { bg: "#FAECE7", fg: "#712B13" },
        },
      },
      fontFamily: {
        sans: ["Cairo", "Tajawal", "system-ui", "sans-serif"],
      },
      fontSize: {
        display: ["28px", { lineHeight: "1.4", fontWeight: "500" }],
        h1: ["22px", { lineHeight: "1.4", fontWeight: "500" }],
        h2: ["18px", { lineHeight: "1.5", fontWeight: "500" }],
        h3: ["15px", { lineHeight: "1.5", fontWeight: "500" }],
        body: ["14px", { lineHeight: "1.7", fontWeight: "400" }],
        caption: ["12px", { lineHeight: "1.6", fontWeight: "400" }],
        label: ["11px", { lineHeight: "1.4", fontWeight: "500", letterSpacing: "0.04em" }],
        // ---- وضع العرض: مقروء من آخر الصف على بروجكتور ----
        "present-title": ["72px", { lineHeight: "1.2", fontWeight: "700" }],
        "present-body": ["44px", { lineHeight: "1.5", fontWeight: "600" }],
        "present-caption": ["28px", { lineHeight: "1.5", fontWeight: "500" }],
      },
      borderRadius: { xl: "14px", "2xl": "20px", "3xl": "28px" },
      backgroundImage: {
        // التدرّج الموحّد الوحيد للهوّية البصرية — يُستخدم حرفياً بكل مكان
        // فيه تدرّج بالموقع (الأزرار الأساسية، التاب النشط، خلفية الدخول)
        // بدل تدرّجات متفرّقة لكل صفحة.
        brand: "linear-gradient(135deg, #7F77DD 0%, #534AB7 100%)",
      },
      spacing: {
        // أصغر مساحة لمس مقبولة لإصبع طفل — تُستخدم كحدّ أدنى لا كمقاس ثابت
        touch: "48px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
        lift: "0 8px 28px rgba(83,74,183,.18)",
        glow: "0 0 0 4px rgba(127,119,221,.14)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "scale-in": { from: { opacity: "0", transform: "scale(.94)" }, to: { opacity: "1", transform: "scale(1)" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
        "slide-down": { from: { opacity: "0", transform: "translateY(-8px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { from: { backgroundPosition: "150% 0" }, to: { backgroundPosition: "-50% 0" } },
        "pop": { "0%": { transform: "scale(1)" }, "40%": { transform: "scale(1.06)" }, "100%": { transform: "scale(1)" } },
        // انسياب الخلفية المتحركة (Aurora) — ثلاث كتل ضوئية بمسارات وأزمنة
        // مختلفة قليلاً حتى لا تتزامن حركتها وتبدو آلية.
        "aurora-a": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(4%, 6%) scale(1.08)" },
          "66%": { transform: "translate(-3%, 3%) scale(0.96)" },
        },
        "aurora-b": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "40%": { transform: "translate(-5%, -4%) scale(1.05)" },
          "70%": { transform: "translate(3%, -2%) scale(0.94)" },
        },
        "aurora-c": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(-4%, 5%) scale(1.1)" },
        },
        // جسيمات عائمة خفيفة بالخلفية — تدرّج شفافية وارتفاع بطيء لا يلفت
        // الانتباه عن المحتوى، فقط يضيف عمقاً.
        float: {
          "0%, 100%": { transform: "translateY(0) translateX(0)", opacity: "0" },
          "10%": { opacity: "var(--float-opacity, .5)" },
          "90%": { opacity: "var(--float-opacity, .5)" },
          "50%": { transform: "translateY(-40px) translateX(6px)" },
        },
        // شعاع لمعان يمرّ فوق الزر عند hover — لمسة زجاجية لا لون إضافي.
        shine: {
          "0%": { transform: "translateX(-120%) skewX(-15deg)" },
          "100%": { transform: "translateX(220%) skewX(-15deg)" },
        },
        // نبضة هادئة جداً — تُستخدم فقط على دعوات الفعل الأساسية (تشغيل)
        // حتى تبقى إشارة، لا ضجيج بصري بكل الأزرار.
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 8px 20px rgba(83,74,183,.28)" },
          "50%": { boxShadow: "0 8px 28px rgba(83,74,183,.5)" },
        },
        ripple: {
          from: { transform: "scale(0)", opacity: "0.45" },
          to: { transform: "scale(2.8)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in .28s ease-out both",
        "scale-in": "scale-in .22s cubic-bezier(.2,.8,.3,1) both",
        "slide-up": "slide-up .32s cubic-bezier(.2,.8,.3,1) both",
        "slide-down": "slide-down .22s ease-out both",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        pop: "pop .28s ease-out both",
        "aurora-a": "aurora-a 22s ease-in-out infinite",
        "aurora-b": "aurora-b 26s ease-in-out infinite",
        "aurora-c": "aurora-c 30s ease-in-out infinite",
        float: "float linear infinite",
        shine: "shine 1.1s ease-in-out",
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        ripple: "ripple .6s ease-out forwards",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(.2,.8,.3,1)",
      },
    },
  },
  plugins: [],
};
