"""
خدمة ملفات Vite المبنية في الإنتاج — `/assets/*` و`/studio/assets/*`.

⚠️ درس مدفوع الثمن — عطل قِيس بإعدادات الإنتاج نفسها: كانت هذه الملفات
تُخدَم عبر `static()` في `config/urls.py`، وتلك الدالّة **تُرجع قائمةً فارغة
حين `DEBUG=False`**. فالتطوير يعمل تماماً، والإنتاج:

    /assets/<التطبيق>.js          → 404
    /studio/assets/<الاستوديو>.js → 200 text/html (مسار SPA ابتلعه)

أي صفحتان بيضاوان بلا رسالة، ولا يظهر ذلك إلا بعد النشر. وكان الإغراء
تشغيلَ الخادم بـ `DEBUG=1` «كي يعمل» — وهو ما يكشف تتبّع الأخطاء للعالم.

WhiteNoise مُركَّب أصلاً في الميدلوير، فيكفي أن نعرّفه على المجلّدين.
"""
import re
from pathlib import Path

from django.conf import settings
from whitenoise.middleware import WhiteNoiseMiddleware

#: ملفات Vite في `assets/` تحمل بصمة محتواها في اسمها (`Player-Dho2EROL.js`)،
#: فالاسم يتغيّر مع المحتوى ويجوز تخزينها إلى الأبد. بدون هذا يعيد كل صفّ
#: تنزيل مقطع Pixi (~٤٨٠ كيلوبايت) في كل حصّة.
VITE_HASHED = re.compile(r"^/(?:studio/)?assets/.+-[\w-]{8}\.\w+$")


class FrontendWhiteNoiseMiddleware(WhiteNoiseMiddleware):
    """WhiteNoise كما هو، ومعه مجلّدا `dist` للتطبيق والاستوديو."""

    def __init__(self, get_response=None, settings=settings):
        super().__init__(get_response, settings=settings)
        mounts = (("web", "/"), ("studio", "/studio/"))
        for name, prefix in mounts:
            root = Path(settings.FRONTEND_DIST[name])
            # مجلد غير مبني = لا شيء يُخدَم، ومسار SPA يشرح ذلك بنفسه.
            if root.is_dir():
                self.add_files(str(root), prefix=prefix)

    def immutable_file_test(self, path, url):
        return bool(VITE_HASHED.match(url)) or super().immutable_file_test(path, url)
