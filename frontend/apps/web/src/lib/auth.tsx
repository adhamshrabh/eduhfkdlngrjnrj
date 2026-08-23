/**
 * حالة المصادقة.
 *
 * تُخزَّن بيانات المستخدمة محلياً حتى لا تُظهر الصفحة وميضاً عند كل تحميل،
 * لكنها **لا تُعتبر مصدر ثقة** — الجلسة الحقيقية هي الرمز، والصلاحية الحقيقية
 * تُفحص في الخادم عند كل طلب. ما هنا لتحسين التجربة فقط.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, tokens } from "./api";
import type { Role, User } from "./types";

const USER_KEY = "edu.user";

interface AuthContextValue {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(readCachedUser);
  const [status, setStatus] = useState<AuthContextValue["status"]>(() =>
    tokens.access ? "loading" : "anonymous",
  );

  // نتحقّق من الرمز مع الخادم عند الإقلاع. عند انقطاع الشبكة نُبقي الجلسة
  // المخزّنة بدل تسجيل خروج قسري — المعلّمة قد تكون وسط حصّة بلا إنترنت،
  // وطردها من التطبيق حينها أسوأ من الاستمرار بنسخة محفوظة.
  useEffect(() => {
    if (!tokens.access) {
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    api
      .get<User>("/api/auth/me/")
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        localStorage.setItem(USER_KEY, JSON.stringify(fresh));
        setStatus("authenticated");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const offline = err instanceof Error && "status" in err && (err as { status: number }).status === 0;
        if (offline && readCachedUser()) {
          setStatus("authenticated");
          return;
        }
        tokens.clear();
        localStorage.removeItem(USER_KEY);
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedIn = await api.login(email, password);
    localStorage.setItem(USER_KEY, JSON.stringify(loggedIn));
    setUser(loggedIn);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    tokens.clear();
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, hasRole }),
    [user, status, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth يجب أن يُستخدم داخل <AuthProvider>.");
  return context;
}
