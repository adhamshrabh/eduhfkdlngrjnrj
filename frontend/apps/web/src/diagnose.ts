/**
 * صفحة تشخيص المشهد — تُقلع المحرّك مباشرةً بلا تسجيل دخول وبلا راوتر.
 *
 * سببها عطل حقيقي: عنصر يُضاف في الاستوديو ويُحفظ بنجاح ثم لا يظهر في
 * المعاينة. كل طبقة يمكن قياسها من الخارج (الخادم، story.json، layout.json،
 * الأصول) كانت سليمة، فبقي السؤال الوحيد الذي لا يُجاب إلا من داخل المحرّك:
 * هل أُنشئ الشكل أصلاً، وأين وُضع، وهل هو مرئي؟
 *
 * تفتح على: /diagnose.html?story=birds
 *
 * ليست جزءاً من التطبيق — صفحة مستقلّة لا يصل إليها الراوتر، ووجودها يبقي
 * المحرّك قابلاً للفحص وحده كما تفعل `app/standalone.ts`.
 */

import { App, EngineEvents, StoryLoader } from "@edu/engine";

// نفس ما يفعله `main.tsx`: بدونه تذهب نداءات `/content/` بلا رمز، فتُحجب
// مسوّدات المعلّمة — وتصير الصفحة تشخّص غياب المصادقة لا حالة المشهد.
import { installContentAuth } from "./lib/contentAuth";

installContentAuth();

const params = new URLSearchParams(location.search);
const storyId = params.get("story") ?? "birds";
const report = document.getElementById("report")!;
const lines: string[] = [];

function log(s: string): void {
  lines.push(s);
  report.textContent = lines.join("\n");
}

function walk(node: any, depth = 0, path = "stage"): void {
  const kids: any[] = node.children ?? [];
  kids.forEach((c, i) => {
    const t = c.constructor?.name ?? "?";
    let b = { x: 0, y: 0, width: 0, height: 0 };
    try {
      b = c.getBounds();
    } catch {
      /* a sprite with no texture cannot be measured */
    }
    const vis = c.visible !== false && (c.alpha ?? 1) > 0.01;
    log(
      `${"  ".repeat(depth)}[${path}/${i}] ${t}` +
        ` pos=(${Math.round(c.x)},${Math.round(c.y)})` +
        ` z=${c.zIndex ?? 0} a=${(c.alpha ?? 1).toFixed(2)}` +
        ` vis=${c.visible}` +
        ` scale=(${(c.scale?.x ?? 1).toFixed(2)},${(c.scale?.y ?? 1).toFixed(2)})` +
        ` bounds=(${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)})` +
        ` kids=${c.children?.length ?? 0}` +
        (vis ? "" : "   <-- NOT VISIBLE")
    );
    if (kids.length && depth < 3) walk(c, depth + 1, `${path}/${i}`);
  });
}

async function main(): Promise<void> {
  log(`story = ${storyId}`);

  const manifest = await StoryLoader.load(storyId);
  if (!manifest) {
    log("!! StoryLoader.load returned null");
    return;
  }
  const scenes = (manifest.story as any).scenes ?? [];
  log(`manifest scenes = ${scenes.length}, entry scene class = ${manifest.story.scene}`);
  const els = scenes[0]?.elements ?? [];
  log(`scene[0].elements = ${els.length}`);
  els.forEach((e: any, i: number) =>
    log(`   ${i}: id=${e.id} alias=${e.alias ?? "-"} type=${e.type ?? "-"} group=${e.groupId ?? "-"} delay=${e.delay ?? 0}`)
  );

  const host = document.getElementById("stage")!;
  const app = await App.start({ host });
  (window as any).__app = app;
  log("engine started");

  app.eventBus.emit(EngineEvents.Content.RunRequested, { id: manifest.id, scene: manifest.story.scene });

  // الانتظار حتى تنتهي مؤقّتات الظهور المتأخّر (أقصاها 0.2ث في هذه القصة)
  // ثم زمن إضافي لحركة الدخول (0.6ث).
  await new Promise((r) => setTimeout(r, 2500));

  log("\n===== PIXI DISPLAY TREE =====");
  walk((app.engine as any).stage);

  log("\n===== renderer =====");
  const r = (app.engine as any).renderer ?? (app.engine as any).app?.renderer;
  log(`screen = ${r?.screen?.width ?? "?"} x ${r?.screen?.height ?? "?"}`);
}

main().catch((e) => log(`!! ${String(e)}\n${(e as Error).stack ?? ""}`));
