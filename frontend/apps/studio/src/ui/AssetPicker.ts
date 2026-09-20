/**
 * studio/ui/AssetPicker.ts
 *
 * A visual asset library: a grid of thumbnail cards replacing the plain
 * `<select>` of alias strings that background/element pickers used to be.
 * Choosing between "body" and "eyes" as text is not how a non-technical
 * author thinks about images — seeing them is.
 *
 * Plain `<img>` elements, not PixiJS — this is a picker list, not a
 * WYSIWYG scene (that's SceneCanvas.ts's job). No scene lifecycle, no
 * asset loading pipeline; the browser's own `<img>` tag does the work.
 *
 * Manages its own selection highlight via direct DOM class toggling, so
 * a caller that doesn't want a full re-render on every click (e.g. while
 * still deciding which asset to add, before committing) still gets
 * correct visual feedback.
 */

import { el } from "./components";

export interface AssetPickerItem {
  alias: string;
  /** Absolute URL for the thumbnail. */
  url: string;
}

export interface AssetPickerOptions {
  /** Adds a leading "none" card (e.g. "بدون خلفية") that selects `undefined`. */
  allowNone?: boolean;
  noneLabel?: string;
  /**
   * حين يُمرَّر، تحمل كل بطاقة زرّ حذف صغيراً (✕).
   *
   * ⚠️ اختياري عمداً، ولا يُفعَّل إلا حيث تُقصَد الإدارة. هذه الشبكة تُفتح
   * كثيراً لمجرّد **الاختيار** — خلفيةً، أو صورة خيار، أو جواباً — وزرّ حذفٍ
   * على مسافة بكسلات من زرّ اختيارٍ يُضغط عشرات المرّات هو خطأٌ ينتظر وقوعه.
   *
   * المسؤولية عن التحذير قبل الحذف تبقى عند المستدعي (`StudioApp.deleteAsset`
   * يسرد أين يُستعمل الأصل ويسأل)، فالبطاقة لا تعرف شيئاً عن القصّة.
   */
  onDelete?: (alias: string) => void;
}

export function assetPicker(
  label: string,
  items: AssetPickerItem[],
  selectedAlias: string | undefined,
  onSelect: (alias: string | undefined) => void,
  options: AssetPickerOptions = {}
): HTMLDivElement {
  const wrap = el("div", "s-field");
  wrap.appendChild(el("label", "s-field__label", label));
  const grid = el("div", "s-asset-grid");

  const cards: HTMLButtonElement[] = [];

  const selectCard = (alias: string | undefined, card: HTMLButtonElement) => {
    for (const c of cards) c.classList.remove("s-asset-card--selected");
    card.classList.add("s-asset-card--selected");
    onSelect(alias);
  };

  if (options.allowNone) {
    const card = el("button", "s-asset-card");
    card.type = "button";
    const thumb = el("div", "s-asset-card__thumb s-asset-card__thumb--none", options.noneLabel ?? "بدون");
    card.appendChild(thumb);
    card.addEventListener("click", () => selectCard(undefined, card));
    if (!selectedAlias) card.classList.add("s-asset-card--selected");
    cards.push(card);
    grid.appendChild(card);
  }

  for (const item of items) {
    const card = el("button", "s-asset-card");
    card.type = "button";
    const img = el("img", "s-asset-card__thumb") as HTMLImageElement;
    img.src = item.url;
    img.alt = item.alias;
    img.loading = "lazy";
    card.appendChild(img);
    card.appendChild(el("span", "s-asset-card__label", item.alias));
    card.addEventListener("click", () => selectCard(item.alias, card));
    if (selectedAlias === item.alias) card.classList.add("s-asset-card--selected");
    cards.push(card);

    if (!options.onDelete) {
      grid.appendChild(card);
      continue;
    }

    // ── لماذا غلافٌ بدل زرٍّ داخل زرّ ────────────────────────────────
    //
    // البطاقة `<button>`، وزرٌّ داخل زرّ ليس HTML صالحاً — تفكّكه المتصفّحات
    // بطرقٍ مختلفة، فيصير سلوك النقر رهناً بالمتصفّح. والغلاف يُبقي البطاقة
    // زرّاً حقيقياً بلوحة مفاتيحه ودلالته، ويضع ✕ فوقها بموضعٍ مطلق.
    //
    // ولا يُلَفّ إلا حين يوجد حذف: كل منتقٍ آخر يبقى كما كان بالضبط.
    const slot = el("div", "s-asset-slot");
    slot.appendChild(card);

    const remove = el("button", "s-asset-card__x", "✕") as HTMLButtonElement;
    remove.type = "button";
    remove.title = `حذف «${item.alias}»`;
    remove.setAttribute("aria-label", `حذف «${item.alias}»`);
    remove.addEventListener("click", (e) => {
      // النقر على ✕ ليس اختياراً: بلا هذا يُضاف العنصر ثم يُحذف أصله.
      e.stopPropagation();
      options.onDelete?.(item.alias);
    });
    slot.appendChild(remove);
    grid.appendChild(slot);
  }

  wrap.appendChild(grid);
  return wrap;
}

export interface AssetChooserOptions extends AssetPickerOptions {
  /** Text on the trigger when nothing is selected — e.g. "+ إضافة عنصر".
   *  Without it the trigger falls back to the "none" wording. */
  triggerLabel?: string;
  /** Called after a choice; the grid has already closed. Lets the caller
   *  do a full re-render without the picker reopening. */
  onClose?: () => void;
  /**
   * الحالة المطويّة عند البناء، ومن يتذكّرها.
   *
   * ⚠️ وُجد هذان لأجل الحذف: `deleteAsset` يُعيد الرسم كاملاً، فتُبنى الشبكة
   * من جديد **مطويّة** — والمؤلّفة التي تُنظّف عشرة أصول تفتحها عشر مرّات.
   * فالطيّ صار حالةً يملكها المستدعي، لا سرّاً داخل هذا الملف.
   */
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

/**
 * The same grid, but folded away until asked for.
 *
 * A background is picked once in a scene's whole life, yet `assetPicker`
 * keeps its thumbnail grid open forever — permanently spending the panel's
 * scarcest resource (vertical space) on a decision that is already made.
 * This variant shows the CURRENT choice as one row, and opens the grid only
 * when the author asks to change it.
 *
 * Choosing closes it. There is deliberately no "done" button: the selection
 * IS the confirmation, so the interaction is one click in, one click out.
 */
export function assetChooser(
  label: string,
  items: AssetPickerItem[],
  selectedAlias: string | undefined,
  onSelect: (alias: string | undefined) => void,
  options: AssetChooserOptions = {}
): HTMLDivElement {
  const wrap = el("div", "s-field");
  wrap.appendChild(el("label", "s-field__label", label));

  const trigger = el("button", "s-chooser") as HTMLButtonElement;
  trigger.type = "button";
  trigger.setAttribute("aria-expanded", "false");

  const selected = items.find((i) => i.alias === selectedAlias);
  if (selected) {
    const thumb = el("img", "s-chooser__thumb") as HTMLImageElement;
    thumb.src = selected.url;
    thumb.alt = "";
    trigger.appendChild(thumb);
  } else {
    trigger.appendChild(el("span", "s-chooser__thumb s-chooser__thumb--none"));
  }
  trigger.appendChild(
    el("span", "s-chooser__name", selected?.alias ?? options.triggerLabel ?? options.noneLabel ?? "اختر")
  );
  trigger.appendChild(el("span", "s-chooser__caret", "▾"));

  const picker = assetPicker("", items, selectedAlias, (alias) => {
    close();
    onSelect(alias);
    options.onClose?.();
  }, options);
  // The inner picker's own (empty) label would otherwise leave a blank line.
  picker.querySelector(".s-field__label")?.remove();
  picker.classList.add("s-chooser__panel");

  function close(): void {
    picker.classList.remove("s-chooser__panel--open");
    trigger.setAttribute("aria-expanded", "false");
    options.onToggle?.(false);
  }

  if (options.open) {
    picker.classList.add("s-chooser__panel--open");
    trigger.setAttribute("aria-expanded", "true");
  }

  trigger.addEventListener("click", () => {
    const open = picker.classList.toggle("s-chooser__panel--open");
    trigger.setAttribute("aria-expanded", String(open));
    options.onToggle?.(open);
  });

  wrap.appendChild(trigger);
  wrap.appendChild(picker);
  return wrap;
}
