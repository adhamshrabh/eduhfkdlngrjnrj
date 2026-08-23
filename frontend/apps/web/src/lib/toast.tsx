/**
 * إشعارات نجاح/خطأ عابرة — يُستدعى `useToast().show()` من أي مكان بعد فعل
 * ناجح (إضافة مستخدمة، حفظ سجلّ، نشر قصة) بدل ترك القائمة تتحدّث بصمت
 * كتأكيد وحيد. كل toast يختفي تلقائياً؛ يمكن إغلاقه يدوياً أيضاً.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS = 3800;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useState(() => ({ value: 0 }))[0];

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.value++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss, nextId],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-20 md:bottom-6 inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-center gap-2 max-w-sm w-full sm:w-auto
              px-4 py-3 rounded-2xl shadow-lift backdrop-blur-xl border animate-slide-up text-h3
              ${
                t.tone === "success"
                  ? "bg-emerald-50/95 border-emerald-200 text-emerald-800"
                  : "bg-rose-50/95 border-rose-200 text-rose-800"
              }`}
          >
            {t.tone === "success" ? <CheckCircle2 size={20} className="shrink-0" /> : <XCircle size={20} className="shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="إغلاق"
              className="shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast يجب أن يُستخدم داخل <ToastProvider>.");
  return context;
}
