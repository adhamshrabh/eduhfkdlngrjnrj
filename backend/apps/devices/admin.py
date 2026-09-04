from django.contrib import admin

from .models import Device, DeviceCard


class DeviceCardInline(admin.TabularInline):
    model = DeviceCard
    extra = 0
    fields = ["uid", "label"]


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ["name", "kind", "url", "owner", "updated_at"]
    list_filter = ["kind"]
    search_fields = ["name", "url"]
    inlines = [DeviceCardInline]


@admin.register(DeviceCard)
class DeviceCardAdmin(admin.ModelAdmin):
    list_display = ["label", "uid", "device", "updated_at"]
    search_fields = ["label", "uid"]
