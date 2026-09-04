/**
 * أسماء المسارات المستعارة داخل المحرّك (@core, @game …).
 *
 * تُصدَّر من الحزمة نفسها لا من كل تطبيق، حتى يبقى تعريفها في مكان واحد:
 * تطبيق الويب والاستوديو يستهلكان القائمة نفسها، فلا تتباعد النسختان.
 *
 * تُستخدم صيغة regex (لا كائن) لأن مطابقة البادئة في Vite تكسر `@game/scenes`
 * حين يكون `@game` مُستعاراً أيضاً — التعليق الأصلي في المحرّك يشرح ذلك،
 * وهو محفوظ هنا عمداً لأن السبب ما زال قائماً.
 */
import { fileURLToPath, URL } from "node:url";

const packageRoot = new URL("./", import.meta.url);
const root = (sub: string): string => fileURLToPath(new URL(sub, packageRoot));

const LAYERS = ["app", "core", "systems", "game", "content", "hardware", "editor", "shared"] as const;

export const engineAliases: Array<{ find: RegExp; replacement: string }> = [
  // ── اسم الحزمة نفسه، أوّلاً ──────────────────────────────────────────
  //
  // ⚠️ درس مدفوع الثمن — عطل قِيس في شبكة المتصفّح: كانت الصفحة الواحدة
  // تحمّل ملفات المحرّك نفسها عبر **مسارين**:
  //
  //     /@fs/.../frontend/node_modules/@edu/engine/src/...   (وصلة الحزمة)
  //     /@fs/.../frontend/packages/engine/src/...            (هذه الأسماء)
  //
  // لأن `@edu/engine` كان يُحلّ عبر وصلة حزمة العمل بينما `@core/…`
  // و`@game/…` تُحلّ إلى المسار الحقيقي. ومساران في Vite = **وحدتان
  // مستقلّتان** لنفس الملف: صنفان لـ`App` بثوابت ساكنة منفصلة، وناقلان،
  // و`ExternalInput` يُركّب `globalThis.eduInput` من كليهما.
  //
  // الأثر أمام المستخدم: محرّكان يُقلعان («Bootstrapping…» مرّتين، وكل حزمة
  // أصول تُسجَّل مرّتين — ومنه تحذيرات PixiJS «already has key … overwriting»)،
  // والنقر على خيار في النشاط يعمل بينما مسح البطاقة لا يفعل شيئاً: النقر
  // يصل كائنات Pixi الحيّة مباشرةً، والبطاقة تمرّ بعالميٍّ يشير إلى ناقل
  // المحرّك الآخر. بلا خطأ ولا رسالة.
  //
  // توحيد المسار هنا يجعل المحرّك وحدةً واحدة مهما اختلف مدخل الاستيراد.
  { find: /^@edu\/engine$/, replacement: root("index.ts") },
  { find: /^@edu\/engine\/aliases$/, replacement: root("aliases.ts") },

  ...LAYERS.flatMap((layer) => [
    { find: new RegExp(`^@${layer}$`), replacement: root(`src/${layer}/index.ts`) },
    { find: new RegExp(`^@${layer}/`), replacement: root(`src/${layer}/`) },
  ]),
];

/** نفس الخريطة بصيغة tsconfig paths — للتحقّق النوعي في المحرّرات. */
export const engineTsPaths: Record<string, string[]> = Object.fromEntries(
  LAYERS.flatMap((layer) => [
    [`@${layer}`, [`./src/${layer}/index.ts`]],
    [`@${layer}/*`, [`./src/${layer}/*`]],
  ]),
);
