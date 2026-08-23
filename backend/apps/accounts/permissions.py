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
        return getattr(obj, "owner_id", None) == user.id
