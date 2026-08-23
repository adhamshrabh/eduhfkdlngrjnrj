/**
 * علامة المنصّة — كتاب مفتوح ونجمة صغيرة، بدل أيقونة BookOpen العامة من
 * مكتبة الأيقونات. SVG خالص فتُستخدم بكل حجم (شريط التنقّل، شاشة الدخول)
 * وتُصدَّر أيضاً كأيقونات PWA (انظر public/icons + scripts/render-icons).
 */
export interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 28, className = "" }: LogoProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="logo-bg" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7F77DD" />
          <stop offset="1" stopColor="#534AB7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#logo-bg)" />
      {/* كتاب مفتوح: صفحتان بمنحنى مركزي واحد */}
      <path
        d="M32 24c-3.8-3.4-9-5-14.5-5-1.4 0-2.5 1.1-2.5 2.5v18c0 1.4 1.1 2.5 2.5 2.5 5.2 0 10.1 1.5 13.7 4.6.5.4 1.1.4 1.6 0 3.6-3.1 8.5-4.6 13.7-4.6 1.4 0 2.5-1.1 2.5-2.5v-18c0-1.4-1.1-2.5-2.5-2.5-5.5 0-10.7 1.6-14.5 5z"
        fill="white"
        fillOpacity="0.95"
      />
      <path d="M32 24v22.6" stroke="#7F77DD" strokeOpacity="0.35" strokeWidth="1.6" strokeLinecap="round" />
      {/* نجمة صغيرة — لمسة مرحة تناسب روضة */}
      <path
        d="M49.5 12l1.7 3.6 3.8.6-2.8 2.7.7 3.9-3.4-1.9-3.4 1.9.7-3.9-2.8-2.7 3.8-.6z"
        fill="#FFE28A"
      />
    </svg>
  );
}
