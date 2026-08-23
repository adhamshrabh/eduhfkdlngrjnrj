"""
معالج أخطاء موحّد.

كل استجابة في المنصّة — ناجحة أو فاشلة — لها الشكل نفسه:
    {"data": ..., "error": ..., "message": ...}
الواجهة تعتمد على هذا العقد، فلا تكسره.

`message` يجب أن يكون جملة صالحة للعرض مباشرة أمام المعلّمة. رسالة عامة
مثل «حدث خطأ» عديمة الفائدة وقت العطل، لذا نستخرج أول خطأ حقلي فعلي.
"""

from typing import Any

from rest_framework.views import exception_handler

_GENERIC = "تعذّر إتمام الطلب."

# رسائل DRF الإنجليزية الشائعة — تُترجم حتى لا ترى المعلّمة نصاً إنجليزياً
# يكشف تفاصيل داخلية وقت العطل.
_TRANSLATIONS = {
    "Authentication credentials were not provided.": "يلزم تسجيل الدخول.",
    "Given token not valid for any token type": "انتهت صلاحية الجلسة. سجّلي الدخول من جديد.",
    "Token is invalid or expired": "انتهت صلاحية الجلسة. سجّلي الدخول من جديد.",
    "No active account found with the given credentials": "البريد أو كلمة المرور غير صحيحة.",
    "You do not have permission to perform this action.": "لا تملكين صلاحية هذا الإجراء.",
    "Not found.": "العنصر غير موجود.",
}


def _translate(message: str) -> str:
    if message in _TRANSLATIONS:
        return _TRANSLATIONS[message]
    # رسالة Django القياسية: "No <Model> matches the given query."
    if message.startswith("No ") and message.endswith("matches the given query."):
        return "العنصر غير موجود أو لا تملكين صلاحية الوصول إليه."
    return message


def _first_message(detail: Any, depth: int = 0) -> str | None:
    """ينزل داخل بنية أخطاء DRF المتشعّبة ويعيد أول نصّ صالح للعرض."""
    if depth > 6:
        return None
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        for item in detail:
            found = _first_message(item, depth + 1)
            if found:
                return found
        return None
    if isinstance(detail, dict):
        # نُقدّم `detail` لأنه رسالة DRF المقصودة للعرض حين تكون موجودة.
        if "detail" in detail:
            found = _first_message(detail["detail"], depth + 1)
            if found:
                return found
        for key, value in detail.items():
            found = _first_message(value, depth + 1)
            if found:
                # نُصدِّر اسم الحقل مع الرسالة إلا إن كان غير مفيد للقارئ.
                return found if key in ("detail", "non_field_errors") else f"{key}: {found}"
    return None


def envelope_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    detail = response.data
    raw = _first_message(detail)
    response.data = {
        "data": None,
        "error": detail,
        "message": _translate(raw) if raw else _GENERIC,
    }
    return response
