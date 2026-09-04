"""
صلاحيات الأدوار. الواجهة تُخفي؛ الخادم يمنع — والمنع هنا هو الحقيقي.

⚠️ درس مدفوع الثمن: صنف صلاحية يُعرّف `has_object_permission` فقط يرث
`has_permission` من BasePermission — وهي ترجع True دائماً. أي أن استخدامه
وحده في `permission_classes` يفتح مسارات القوائم (list) للزوّار غير الموثّقين،
لأنه يستبدل الافتراضي IsAuthenticated بدل أن يضاف إليه. لذلك كل صنف هنا
يُعرّف `has_permission` صراحةً، ولا نعتمد على الوراثة الصامتة.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsAdmin(BasePermission):
    message = "هذا الإجراء متاح للمديرة فقط."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin_role)


class IsTeacherOrAdmin(BasePermission):
    message = "يلزم تسجيل الدخول."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated)


class IsOwnerOrAdmin(BasePermission):
    """
    القراءة متاحة لكل مستخدم **موثّق**؛ التعديل لصاحب العنصر أو المديرة فقط.

    هذه القاعدة هي ما يمنع معلّمة من الحفظ فوق قصّة معلّمة أخرى —
    ولا يوجد أي مسار بديل يتجاوزها.
    """

    message = "لا تملكين صلاحية تعديل هذا العنصر."

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_admin_role:
            return True
        owner_id = self._owner_id(obj)
        # مالك غير معروف = رفض. عنصر لا نستطيع نسبته إلى أحد لا يُعدَّل.
        return owner_id is not None and owner_id == user.id

    @staticmethod
    def _owner_id(obj):
        """
        المالك كما يعلنه العنصر نفسه — حقلاً كان أو خاصيّة.

        ⚠️ درس مدفوع الثمن — عطل قِيس فعلياً: `StoryAsset` لا يحمل `owner`
        إطلاقاً، لأن الملكية تخصّ القصّة والأصل يتبعها بـ CASCADE. فكان
        `getattr(obj, "owner_id", None)` يعيد None لكل أصل، وNone لا يساوي
        أي معرّف مستخدم — فيُرفض **حذف أي صورة لأي معلّمة، حتى داخل قصّتها
        هي**، برسالة «لا تملكين صلاحية تعديل هذا العنصر» التي تبدو صحيحة
        تماماً وهي تصف ملكيةً قائمة. المديرة وحدها كانت تنجح لأنها تخرج قبل
        هذا السطر — وهذا ما جعل العطل غير مرئي لمن يختبره بحساب مديرة.

        والرفع كان يمرّ لأن DRF لا ينادي `get_object()` عند الإنشاء، فيُفحص
        الأصل عبر قصّته وحدها: تُرفع الصورة ولا تُحذف. ذاك التناقض كشف الأمر.

        الاصطلاح المستقرّ: **كل نموذج تابع يُعلن `owner_id` خاصيّةً تقرأ مالك
        أبيه** (`StoryAsset` عبر `story`، `DeviceCard` عبر `device`). المشي
        على الآباء من هنا كان سيعني قائمة تطول مع كل نموذج جديد، ونسيان
        إضافة اسم إليها = المنع الصامت نفسه — بينما نسيان الخاصيّة يقع عند
        كاتب النموذج، وهو من يعرف أباه.
        """
        return getattr(obj, "owner_id", None)
