from django.contrib import admin
from django.utils.html import format_html

from .models import Story, StoryAsset


class StoryAssetInline(admin.TabularInline):
    model = StoryAsset
    extra = 0
    fields = ["asset_id", "alias", "kind", "file", "size_bytes"]
    readonly_fields = ["asset_id", "size_bytes"]


@admin.register(Story)
class StoryAdmin(admin.ModelAdmin):
    list_display = ["title", "slug", "owner", "is_published", "scene_count", "version", "updated_at"]
    list_filter = ["is_published", "owner"]
    search_fields = ["title", "slug"]
    readonly_fields = ["version", "created_at", "updated_at", "scene_count"]
    inlines = [StoryAssetInline]
    actions = ["publish", "unpublish"]

    @admin.action(description="نشر القصص المحدّدة")
    def publish(self, request, queryset):
        updated = queryset.update(is_published=True)
        self.message_user(request, f"تم نشر {updated} قصة.")

    @admin.action(description="إلغاء نشر القصص المحدّدة")
    def unpublish(self, request, queryset):
        updated = queryset.update(is_published=False)
        self.message_user(request, f"تم إلغاء نشر {updated} قصة.")


@admin.register(StoryAsset)
class StoryAssetAdmin(admin.ModelAdmin):
    list_display = ["alias", "asset_id", "story", "kind", "preview", "size_bytes"]
    list_filter = ["kind", "story"]
    search_fields = ["alias", "asset_id", "original_name"]

    @admin.display(description="معاينة")
    def preview(self, obj: StoryAsset):
        if obj.kind == StoryAsset.Kind.IMAGE and obj.file:
            return format_html('<img src="{}" style="height:40px;border-radius:4px" />', obj.file.url)
        return "—"
