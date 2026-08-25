"""
مسارات التوافق مع المحرّك: `/content/stories/...`

لماذا موجودة أصلاً؟
المحرّك يقرأ محتواه من `/content/stories/<slug>/story.json` وأصوله من مسارات
نسبية داخل الملف نفسه (`assets/images/village.png`). هذا العقد مُثبَّت في
StoryLoader و AssetUrls، ويعتمد عليه 567 اختباراً ناجحاً.

كان أمامنا خياران: تعديل المحمّلات لتنادي `/api/stories/`، أو أن يخدم Django
نفس المسارات القديمة. اخترنا الثاني لسببين:

  1. **صفر تعديل على المحرّك** — أي صفر مخاطرة على مجموعة اختبارات قائمة
     وناجحة. الترحيل يصبح غير مرئي للطبقة التي لا يجب أن تعرف من أين يأتي
     المحتوى أصلاً.
  2. `story.json` يعود كما هو حرفياً — لا إعادة كتابة لمسارات الأصول، فلا
     فرصة لخلل صامت في مرجع صورة يظهر أمام الصف لا في الاختبارات.

المسارات هنا للقراءة فقط. كل كتابة تمرّ عبر `/api/stories/` مع صلاحياتها
وفحص النسخة — لا يوجد باب خلفي للكتابة.
"""

from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_GET

from .models import Story, StoryAsset


def _authenticated_user(request):
    """
    صاحبة الطلب، من الجلسة أو من رمز JWT.

    ⚠️ درس مدفوع الثمن: هذه الدوالّ دوالّ Django عادية (`@require_GET`) لا
    DRF، وميدلوير Django يقرأ الهوية من **الجلسة وحدها**. ترويسة
    `Authorization: Bearer` لا يفكّها إلا DRF عبر أصناف المصادقة، فكان
    `request.user` زائراً مجهولاً دائماً هنا مهما أرسل العميل من رموز.

    الأثر لم يكن نظرياً: شرط «المعلّمة ترى قصصها» أدناه كان **كوداً ميّتاً
    لا يعمل أبداً**، فلا المعلّمة تعاين مسوّدتها ولا تظهر في أي فهرس —
    وحلقة التأليف (أنشئي ← حرّري ← عايني) مكسورة لكل قصّة جديدة، لأن كل
    قصّة جديدة مسوّدة بالتعريف.
    """
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return user

    try:
        from rest_framework_simplejwt.authentication import JWTAuthentication

        result = JWTAuthentication().authenticate(request)
    except Exception:
        # رمز تالف أو منتهٍ = زائر، لا خطأ. القصص المنشورة يجب أن تبقى
        # قابلة للعرض على الصف حتى لو انتهت جلسة المعلّمة أثناء الحصّة.
        return None
    return result[0] if result else None


def _visible_stories(request):
    """
    القصص المنشورة عامة للقراءة؛ المعلّمة ترى قصصها أيضاً.

    القراءة العامة للمنشور مقصودة: العرض على شاشة الصف قد يجري من متصفّح
    بلا جلسة، ولا يوجد في القصص المنشورة ما هو خاص.
    """
    qs = Story.objects.all()
    user = _authenticated_user(request)
    if user is None:
        return qs.filter(is_published=True)
    if user.is_admin_role:
        return qs

    from django.db.models import Q

    return qs.filter(Q(is_published=True) | Q(owner=user))


@require_GET
def stories_index(request):
    """
    GET /content/stories/index.json — يقابل StoryLoader.discover().

    ⚠️ الشكل مهمّ: `stories` مصفوفة **معرّفات نصية**، لا كائنات.
    `discover()` يُمرّر كل عنصر مباشرة إلى `load(id)`، فلو أعدنا كائنات
    لتحوّلت إلى "[object Object]" في مسار الطلب وفشل تحميل كل قصة —
    وهو بالضبط ما حدث قبل هذا الإصلاح. العنوان يأتي لاحقاً من story.json
    نفسه، فلا حاجة لإرساله هنا.
    """
    slugs = list(_visible_stories(request).values_list("slug", flat=True))
    return JsonResponse({"stories": slugs}, json_dumps_params={"ensure_ascii": False})


@require_GET
def story_json(request, slug: str):
    """GET /content/stories/<slug>/story.json — يُعاد كما حُفظ، بلا تحويل."""
    story = get_object_or_404(_visible_stories(request), slug=slug)
    return JsonResponse(story.story_json or {}, json_dumps_params={"ensure_ascii": False}, safe=False)


@require_GET
def layout_json(request, slug: str):
    """
    GET /content/stories/<slug>/layout.json

    يعود `{}` لا 404 حين لا يوجد تخطيط. هذا مقصود: قصة جديدة بلا مفتاح
    `puzzle` هي الحالة الطبيعية، وافتراض وجوده هو ما كان يجمّد كل قصة جديدة.
    """
    story = get_object_or_404(_visible_stories(request), slug=slug)
    return JsonResponse(story.layout_json or {}, json_dumps_params={"ensure_ascii": False}, safe=False)


@require_GET
def story_asset(request, slug: str, path: str):
    """
    GET /content/stories/<slug>/<path> — يخدم أصلاً بمساره كما تكتبه القصة.

    نبحث بالمسار المحفوظ أولاً، ثم بالاسم المستعار، ثم باسم الملف — لأن
    محتوى قديم قد يشير إلى الملف بأي من الثلاثة، ولا نريد صورة فارغة أمام
    الصف بسبب اختلاف شكلي في المرجع.
    """
    story = get_object_or_404(_visible_stories(request), slug=slug)
    normalized = path.strip("/")

    asset = (
        story.assets.filter(content_path=normalized).first()
        or story.assets.filter(content_path__endswith=normalized).first()
        or story.assets.filter(alias=normalized.rsplit("/", 1)[-1].rsplit(".", 1)[0]).first()
        or story.assets.filter(original_name=normalized.rsplit("/", 1)[-1]).first()
    )
    if asset is None or not asset.file:
        raise Http404("الأصل غير موجود.")

    try:
        return FileResponse(asset.file.open("rb"))
    except FileNotFoundError as exc:  # الملف اختفى من القرص
        raise Http404("ملف الأصل مفقود على الخادم.") from exc
