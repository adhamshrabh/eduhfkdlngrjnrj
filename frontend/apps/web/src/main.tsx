import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/lib/toast";
import { router } from "@/app/router";
import "@/styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("عنصر #root غير موجود.");

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
);
