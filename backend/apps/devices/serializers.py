"""مُسلسِلات الأجهزة والبطاقات."""
from rest_framework import serializers

from .models import Device, DeviceCard


class DeviceCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceCard
        fields = ["id", "uid", "label", "updated_at"]
        read_only_fields = ["id", "updated_at"]

    def validate_label(self, value: str) -> str:
        # المعنى هو ما تطابق عليه القصّة (`alias` أو معرّف فرع)، ففراغه يعني
        # بطاقة تُمسح ولا تفعل شيئاً — وهو عطل صامت أمام صفّ.
        label = (value or "").strip()
        if not label:
            raise serializers.ValidationError("المعنى مطلوب — اسم الأصل الذي تشير إليه البطاقة.")
        return label

    def validate_uid(self, value: str) -> str:
        uid = (value or "").strip()
        if not uid:
            raise serializers.ValidationError("رقم البطاقة مطلوب.")
        return uid


class DeviceSerializer(serializers.ModelSerializer):
    cards = DeviceCardSerializer(many=True, read_only=True)
    card_count = serializers.SerializerMethodField()

    class Meta:
        model = Device
        fields = ["id", "name", "kind", "url", "owner", "cards", "card_count", "updated_at"]
        read_only_fields = ["id", "owner", "updated_at"]

    def get_card_count(self, obj: Device) -> int:
        return obj.cards.count()
