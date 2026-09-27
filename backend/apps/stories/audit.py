"""
هل ستظهر كل صورة وصوت في كل قصّة؟ — فحصٌ يُجرى على قاعدة البيانات والقرص معاً.

العطل الذي يمسكه لا يظهر في أي مكانٍ آخر: بنية القصّة في قاعدة البيانات
وملفاتها في `media`، وانفصال الاثنين (نقلٌ نصفي، استعادةٌ من نسختين بختمين
مختلفين، قرصٌ فُقد) يعطي قصّةً سليمة البنية بصورٍ فارغة — بلا خطأ واحد في
أي سجلّ، حتى تُفتح أمام الصف.

يستعمله `check_stories` (يدوياً وبعد كل نقل)، و`import_content` ليقارن ما
وصل بما أُرسل.
"""
import os
from dataclasses import dataclass, field

from .compat_views import find_asset
from .models import Story


@dataclass
class StoryReport:
    slug: str
    assets: int
    #: أصلٌ مسجّل في القاعدة وملفّه غائب عن القرص.
    missing_files: list[str] = field(default_factory=list)
    #: مرجعٌ في القصّة لا يجد أصلاً — كما يبحث عنه المحرّك.
    unresolved: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing_files and not self.unresolved


def _references(node, out: set[str]) -> None:
    """كل مسار أصلٍ تكتبه القصّة (`assets/images/cat.png`)، في أي عمق."""
    if isinstance(node, dict):
        for value in node.values():
            _references(value, out)
    elif isinstance(node, list):
        for item in node:
            _references(item, out)
    elif isinstance(node, str) and node.startswith("assets/"):
        out.add(node)


def audit_story(story: Story) -> StoryReport:
    assets = list(story.assets.all())
    report = StoryReport(slug=story.slug, assets=len(assets))
    for asset in assets:
        if not asset.file or not os.path.exists(asset.file.path):
            report.missing_files.append(asset.file.name if asset.file else asset.alias)

    refs: set[str] = set()
    _references(story.story_json, refs)
    _references(story.layout_json, refs)
    report.unresolved = sorted(p for p in refs if find_asset(story, p) is None)
    return report


def audit_all() -> list[StoryReport]:
    """القصص الحيّة وحدها — المحذوفة لا تُعرض، فلا معنى لفحص ظهورها."""
    return [audit_story(s) for s in Story.objects.order_by("slug")]


def summary(reports: list[StoryReport]) -> dict:
    """البصمة التي تُقارَن بين الجهازين: إن تطابقت، وصل كل شيء."""
    return {
        "stories": len(reports),
        "assets": sum(r.assets for r in reports),
        "missing_files": sum(len(r.missing_files) for r in reports),
        "unresolved": sum(len(r.unresolved) for r in reports),
    }
