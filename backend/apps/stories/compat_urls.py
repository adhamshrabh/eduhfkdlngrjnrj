"""مسارات التوافق مع المحرّك — قراءة فقط."""
from django.urls import path, re_path

from . import compat_views

urlpatterns = [
    path("index.json", compat_views.stories_index, name="compat-index"),
    path("<str:slug>/story.json", compat_views.story_json, name="compat-story"),
    path("<str:slug>/layout.json", compat_views.layout_json, name="compat-layout"),
    re_path(r"^(?P<slug>[^/]+)/(?P<path>.+)$", compat_views.story_asset, name="compat-asset"),
]
