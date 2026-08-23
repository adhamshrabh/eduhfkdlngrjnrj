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

export const engineAliases: Array<{ find: RegExp; replacement: string }> = LAYERS.flatMap((layer) => [
  { find: new RegExp(`^@${layer}$`), replacement: root(`src/${layer}/index.ts`) },
  { find: new RegExp(`^@${layer}/`), replacement: root(`src/${layer}/`) },
]);

/** نفس الخريطة بصيغة tsconfig paths — للتحقّق النوعي في المحرّرات. */
export const engineTsPaths: Record<string, string[]> = Object.fromEntries(
  LAYERS.flatMap((layer) => [
    [`@${layer}`, [`./src/${layer}/index.ts`]],
    [`@${layer}/*`, [`./src/${layer}/*`]],
  ]),
);
