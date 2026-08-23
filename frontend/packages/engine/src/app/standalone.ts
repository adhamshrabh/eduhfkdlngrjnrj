/**
 * نقطة دخول مستقلة للمحرّك (بلا React).
 *
 * تُستخدم للتجريب السريع لمشهد أو قصة أثناء التطوير — تطبيق الويب لا يمرّ من
 * هنا، بل يُركّب المحرّك عبر <EngineCanvas />. وجودها يبقي المحرّك قابلاً
 * للتشغيل وحده، وهو أحد أوجه استقلال الطبقات.
 */
import { App } from "./index";

const host = document.getElementById("app") ?? undefined;

App.start({ host }).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[standalone] تعذّر بدء المحرّك:", err);
});
