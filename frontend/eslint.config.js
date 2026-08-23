/**
 * القواعد المعمارية مفروضة هنا لا بالنيّة الحسنة.
 *
 * القاعدة الوحيدة التي لا تُخترق: `packages/engine/**` ممنوع عليه استيراد
 * React أو أي شيء من طبقة الواجهة. الاتجاه أحادي دائماً — React يستهلك
 * المحرّك، والعكس ممنوع. كل تواصل عبر EventBus.
 */
export default [
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-*", "react-dom"], message: "المحرّك لا يعرف React. استخدمي EventBus." },
            { group: ["@/*", "**/apps/web/**"], message: "المحرّك لا يستورد من طبقة الواجهة." },
          ],
        },
      ],
    },
  },
];
