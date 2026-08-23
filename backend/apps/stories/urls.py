from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import StoryAssetViewSet, StoryViewSet

router = DefaultRouter()
router.register("", StoryViewSet, basename="story")

asset_list = StoryAssetViewSet.as_view({"get": "list", "post": "create"})
asset_detail = StoryAssetViewSet.as_view({"patch": "update", "delete": "destroy"})

urlpatterns = [
    path("<str:story_slug>/assets/", asset_list, name="story-assets"),
    path("<str:story_slug>/assets/<str:asset_id>/", asset_detail, name="story-asset-detail"),
    path("", include(router.urls)),
]
