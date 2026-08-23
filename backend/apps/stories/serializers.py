"""مُسلسِلات القصص والأصول."""
from rest_framework import serializers

from .models import Story, StoryAsset
from .validators import validate_layout_json, validate_story_json


class StoryAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = StoryAsset
        fields = ["asset_id", "alias", "kind", "url", "original_name", "size_bytes", "updated_at"]
        read_only_fields = ["asset_id", "url", "size_bytes", "updated_at"]

    def get_url(self, obj: StoryAsset) -> str:
        request = self.context.get("request")
        url = obj.file.url if obj.file else ""
        return request.build_absolute_uri(url) if request and url else url


class StoryListSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    scene_count = serializers.IntegerField(read_only=True)
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = Story
        fields = [
            "slug", "title", "description", "is_published",
            "owner", "owner_name", "scene_count", "asset_count",
            "version", "updated_at",
        ]

    def get_asset_count(self, obj: Story) -> int:
        return obj.assets.count()


class StoryDetailSerializer(StoryListSerializer):
    """
    الشكل الذي يستهلكه المحرّك مباشرة.

    `story_json` و `layout_json` تُرجَعان كما هما بلا أي تحويل — نفس عقد
    story.json / layout.json على القرص سابقاً، حتى لا يحتاج المحرّك طبقة ترجمة.
    """

    assets = StoryAssetSerializer(many=True, read_only=True)

    class Meta(StoryListSerializer.Meta):
        fields = StoryListSerializer.Meta.fields + ["story_json", "layout_json", "assets"]


class StoryWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Story
        fields = ["slug", "title", "description", "is_published", "story_json", "layout_json"]
        extra_kwargs = {"slug": {"required": False}}

    def validate_story_json(self, value):
        return validate_story_json(value)

    def validate_layout_json(self, value):
        return validate_layout_json(value)
