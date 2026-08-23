/**
 * مكوّنات الواجهة الأساسية.
 *
 * قواعد ملتزم بها هنا: بلا أنماط مضمّنة (Tailwind فقط)، بلا أرقام سحرية،
 * وكل مكوّن له واجهة Props مسمّاة. مساحات اللمس لا تقلّ عن 48 بكسل.
 */
import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

// ------------------------------------------------------------------- Button

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  /** نبضة هادئة — لدعوة الفعل الأساسية فقط (تشغيل قصة/لعبة) لا كل الأزرار. */
  pulse?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "relative overflow-hidden bg-brand text-white shadow-card hover:shadow-lift hover:brightness-110 " +
    "before:absolute before:inset-x-0 before:top-0 before:h-1/2 before:rounded-t-[inherit] " +
    "before:bg-gradient-to-b before:from-white/25 before:to-transparent before:pointer-events-none",
  secondary: "bg-primary-light text-primary-dark hover:bg-primary-light/70",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100",
  danger: "bg-rose-50 text-rose-700 hover:bg-rose-100",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "text-caption px-3 py-2 rounded-xl",
  md: "text-h3 px-4 py-3 rounded-xl min-h-touch",
  lg: "text-h2 px-6 py-4 rounded-2xl min-h-touch",
};

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  pulse = false,
  disabled,
  className = "",
  children,
  onPointerDown,
  ...rest
}: ButtonProps): JSX.Element {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);

  const spawnRipple: PointerEventHandler<HTMLButtonElement> = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.4;
    const id = rippleId.current++;
    setRipples((prev) => [
      ...prev,
      { id, size, x: event.clientX - rect.left - size / 2, y: event.clientY - rect.top - size / 2 },
    ]);
    window.setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 650);
    onPointerDown?.(event);
  };

  return (
    <button
      {...rest}
      onPointerDown={spawnRipple}
      disabled={disabled || loading}
      className={`group relative isolate inline-flex items-center justify-center gap-2 font-medium overflow-hidden
        transition-all duration-200 ease-spring active:scale-[.96]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${pulse && !disabled && !loading ? "animate-pulse-glow" : ""}
        ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    >
      {/* شعاع لمعان يمرّ عند hover — إشارة "زجاجية" بلا تعديل الشفافية الأساسية */}
      {variant === "primary" ? (
        <span className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]">
          <span
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent
              -translate-x-[120%] skew-x-[-15deg] opacity-0 group-hover:opacity-100 group-hover:animate-shine"
          />
        </span>
      ) : null}

      {/* دوائر التموّج عند النقر */}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="pointer-events-none absolute z-10 rounded-full bg-white/50 animate-ripple"
          style={{ left: r.x, top: r.y, width: r.size, height: r.size }}
        />
      ))}

      <span className="relative z-10 inline-flex items-center gap-2 transition-transform duration-200 group-hover:scale-105 group-active:scale-95">
        {loading ? <Spinner size={16} /> : icon}
        {children}
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ Spinner

export interface SpinnerProps {
  size?: number;
}

export function Spinner({ size = 20 }: SpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label="جارٍ التحميل"
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent motion-safe:[animation-duration:.7s]"
      style={{ width: size, height: size }}
    />
  );
}

// --------------------------------------------------------------------- Card

export interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** حدّ متدرّج بألوان الهوية — للبطاقات المميّزة (مثل القصص المنشورة) فقط. */
  featured?: boolean;
}

/** الزجاج الموحّد لكل بطاقات الموقع: شفافية 75% + ضبابية خلف البطاقة تكشف
 *  ألوان Aurora بهدوء بدل أبيض مسطّح، مع حافّة بيضاء رفيعة تُبرز حوافها. */
const GLASS = "bg-white/75 backdrop-blur-xl border border-white/60";

export function Card({ children, className = "", onClick, featured = false }: CardProps): JSX.Element {
  const interactive = onClick
    ? "cursor-pointer hover:shadow-lift hover:-translate-y-1 active:translate-y-0 active:scale-[.99]"
    : "";
  const card = (
    <div
      onClick={onClick}
      className={`${GLASS} ${featured ? "rounded-[18.5px]" : "rounded-2xl"} shadow-card p-5
        transition-all duration-200 ease-spring ${interactive} ${className}`}
    >
      {children}
    </div>
  );

  if (!featured) return card;

  // حدّ متدرّج: طبقة خارجية بالتدرّج + فراغ 1.5px يكشفه كإطار.
  return <div className="bg-brand rounded-2xl p-[1.5px]">{card}</div>;
}

// -------------------------------------------------------------------- Badge

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "primary";
}

const BADGE_TONES: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-slate-100 text-slate-600",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  primary: "bg-primary-light text-primary-dark",
};

export function Badge({ children, tone = "neutral" }: BadgeProps): JSX.Element {
  return (
    <span className={`inline-block px-2.5 py-1 rounded-lg text-label animate-scale-in ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

// -------------------------------------------------------------------- Input

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Field({ label, error, id, className = "", ...rest }: FieldProps): JSX.Element {
  const inputId = id ?? `field-${label}`;
  return (
    <label htmlFor={inputId} className="block">
      <span className="block mb-1.5 text-h3 text-slate-700">{label}</span>
      <input
        {...rest}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`w-full min-h-touch px-4 py-3 rounded-xl border bg-white text-body
          transition-all duration-150 outline-none
          hover:border-slate-300 focus:border-primary focus:shadow-glow
          ${error ? "border-rose-400" : "border-slate-200"} ${className}`}
      />
      {error ? <span className="block mt-1.5 text-caption text-rose-600 animate-slide-down">{error}</span> : null}
    </label>
  );
}

// --------------------------------------------------------------- EmptyState

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, hint, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6 animate-slide-up">
      {icon ? (
        <div className="mb-4 grid place-items-center w-20 h-20 rounded-full bg-primary-light text-primary">
          {icon}
        </div>
      ) : null}
      <p className="text-h2 text-slate-700">{title}</p>
      {hint ? <p className="mt-2 text-body text-slate-500 max-w-sm">{hint}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------- ErrorNote

export interface ErrorNoteProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorNote({ message, onRetry }: ErrorNoteProps): JSX.Element {
  return (
    <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-body text-rose-800">
      <p>{message}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" className="mt-2 text-rose-700" onClick={onRetry}>
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- SearchInput

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** بحث مؤجَّل — يرسل القيمة بعد توقّف الكتابة ٣٥٠ملّي‌ثانية، لا مع كل حرف،
 *  حتى لا تُغرق الخادم بطلب لكل ضغطة أثناء الكتابة السريعة. */
export function SearchInput({ value, onChange, placeholder, className = "" }: SearchInputProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (next: string): void => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), 350);
  };

  return (
    <div className={`relative ${className}`}>
      <Search size={18} className="absolute top-1/2 -translate-y-1/2 right-3.5 text-slate-400 pointer-events-none" />
      <input
        type="search"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-touch pr-11 pl-4 py-3 rounded-xl border border-slate-200 bg-white/90 text-body
          transition-all duration-150 outline-none hover:border-slate-300 focus:border-primary focus:shadow-glow"
      />
    </div>
  );
}

// ----------------------------------------------------------------- Pagination

export interface PaginationProps {
  page: number;
  pageSize: number;
  count: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageSize, count, onChange }: PaginationProps): JSX.Element | null {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-center gap-3 pt-2" aria-label="ترقيم الصفحات">
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronRight size={16} />}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="الصفحة السابقة"
      />
      <span className="text-caption text-slate-500 tabular-nums">
        {page} / {totalPages}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronLeft size={16} />}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="الصفحة التالية"
      />
    </nav>
  );
}
