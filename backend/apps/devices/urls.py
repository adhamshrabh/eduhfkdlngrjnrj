from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DeviceCardViewSet, DeviceViewSet

router = DefaultRouter()
router.register("", DeviceViewSet, basename="device")

# متداخل يدوياً لا بـ`drf-nested-routers`: مستوى واحد من التداخل، ونفس
# الأسلوب الذي تتبعه `apps/stories/urls.py` للأصول — إضافة اعتمادية لمسارٍ
# واحد ثمنٌ أكبر من سطرين.
card_list = DeviceCardViewSet.as_view({"get": "list", "post": "create"})
card_detail = DeviceCardViewSet.as_view({"patch": "update", "delete": "destroy"})

urlpatterns = [
    path("<int:device_pk>/cards/", card_list, name="device-card-list"),
    path("<int:device_pk>/cards/<int:pk>/", card_detail, name="device-card-detail"),
    path("", include(router.urls)),
]
