from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DeviceButtonViewSet, DeviceCardViewSet, DeviceViewSet

router = DefaultRouter()
router.register("", DeviceViewSet, basename="device")

# متداخل يدوياً لا بـ`drf-nested-routers`: مستوى واحد من التداخل، ونفس
# الأسلوب الذي تتبعه `apps/stories/urls.py` للأصول — إضافة اعتمادية لمسارٍ
# واحد ثمنٌ أكبر من سطرين.
card_list = DeviceCardViewSet.as_view({"get": "list", "post": "create"})
card_detail = DeviceCardViewSet.as_view({"patch": "update", "delete": "destroy"})
button_list = DeviceButtonViewSet.as_view({"get": "list", "post": "create"})
button_detail = DeviceButtonViewSet.as_view({"delete": "destroy"})

urlpatterns = [
    path("<int:device_pk>/cards/", card_list, name="device-card-list"),
    path("<int:device_pk>/cards/<int:pk>/", card_detail, name="device-card-detail"),
    path("<int:device_pk>/buttons/", button_list, name="device-button-list"),
    path("<int:device_pk>/buttons/<int:pk>/", button_detail, name="device-button-detail"),
    path("", include(router.urls)),
]
