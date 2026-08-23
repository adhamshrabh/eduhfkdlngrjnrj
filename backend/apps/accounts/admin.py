from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "full_name", "role", "is_active", "date_joined"]
    list_filter = ["role", "is_active"]
    search_fields = ["email", "full_name"]
    ordering = ["full_name"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("المعلومات الشخصية", {"fields": ("full_name", "role")}),
        ("الصلاحيات", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("تواريخ", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "full_name", "role", "password1", "password2")}),
    )
