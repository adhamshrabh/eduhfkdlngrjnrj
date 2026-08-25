/**
 * عميل الواجهة البرمجية.
 *
 * كل استجابة من الخادم لها الغلاف نفسه: { data, error, message }.
 * هذا الملف هو المكان **الوحيد** الذي يعرف ذلك — بقية التطبيق يتعامل مع
 * البيانات مباشرة أو مع استثناء يحمل رسالة عربية جاهزة للعرض.
 */

const ACCESS_KEY = "edu.access";
const REFRESH_KEY = "edu.refresh";

export interface Envelope<T> {
  data: T;
  error: unknown;
  message: string;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly fields: Record<string, unknown> | null;

  constructor(message: string, status: number, fields: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

export const tokens = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh?: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** يمنع عشرة طلبات فاشلة من إطلاق عشر عمليات تجديد متوازية. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = tokens.refresh;
    if (!refresh) return false;
    try {
      const res = await fetch("/api/auth/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { access?: string; refresh?: string };
      if (!body.access) return false;
      tokens.set(body.access, body.refresh);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** يُستخدم لرفع الملفات — لا نضبط Content-Type ليضعه المتصفّح بالحدود الصحيحة. */
  formData?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {};
  const access = tokens.access;
  if (access) headers.Authorization = `Bearer ${access}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method: options.method ?? "GET", headers, body, signal: options.signal });
  } catch {
    // انقطاع شبكة — سيناريو متوقّع في الروضة، لا حالة استثنائية.
    throw new ApiError("تعذّر الاتصال بالخادم. تحقّقي من الإنترنت.", 0);
  }

  if (res.status === 401 && !isRetry && tokens.refresh) {
    if (await refreshAccessToken()) return request<T>(path, options, true);
    tokens.clear();
  }

  if (res.status === 204) return undefined as T;

  let payload: Partial<Envelope<T>> = {};
  try {
    payload = (await res.json()) as Partial<Envelope<T>>;
  } catch {
    if (!res.ok) throw new ApiError("استجابة غير مفهومة من الخادم.", res.status);
  }

  if (!res.ok) {
    const fields = (payload.error && typeof payload.error === "object" ? payload.error : null) as Record<
      string,
      unknown
    > | null;
    throw new ApiError(payload.message || "تعذّر إتمام الطلب.", res.status, fields);
  }

  return payload.data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
  /** تسجيل الدخول لا يمرّ بالغلاف — SimpleJWT يُرجع الرموز مباشرة. */
  async login(email: string, password: string) {
    let res: Response;
    try {
      res = await fetch("/api/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      // نفس معالجة `request` أعلاه — الدخول كان الطلب الوحيد بلا هذا الغلاف.
      throw new ApiError("تعذّر الاتصال بالخادم. تحقّقي من الإنترنت.", 0);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // التمييز مقصود: كل استجابة فاشلة كانت تُعرَض «البريد أو كلمة المرور
      // غير صحيحة»، فخادم متوقّف — يعيده وسيط Vite بـ 500، لا كخطأ شبكة —
      // كان يُتَّهم فيه كلمةُ المرور. أضاع ذلك وقتاً حقيقياً في التشخيص:
      // الرسالة توجّه إلى الحقل الخطأ بينما السبب أن الباك إند لا يعمل.
      if (res.status >= 500) {
        throw new ApiError("الخادم لا يستجيب. تأكّدي أن الباك إند يعمل على المنفذ 8000.", res.status);
      }
      throw new ApiError(body?.message || "البريد أو كلمة المرور غير صحيحة.", res.status);
    }
    tokens.set(body.access, body.refresh);
    return body.user as import("./types").User;
  },
};
