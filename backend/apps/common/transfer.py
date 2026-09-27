"""
نقل المحتوى بين جهازين — قاعدة البيانات والأصول **معاً**، ومعهما ما يُثبت الوصول.

الحزمة مجلّدٌ فيه ثلاثة ملفات:

    data.json       المستخدمات، الصفوف، القصص وأصولها، الأجهزة (نسخة طبق الأصل،
                    ومعها المحذوف حذفاً ناعماً — ترقيم الأصول يعتمد عليه)
    media.tar.gz    ملفات الصور والأصوات كما هي في MEDIA_ROOT
    manifest.json   بصمة sha256 لكلٍّ منهما، وعدد الصفوف لكل نموذج، ونتيجة
                    `check_stories` عند التصدير

⚠️ لماذا حزمة واحدة لا «انسخي القاعدة ثم انسخي المجلّد»: نقلُ أحدهما دون الآخر
يعطي قصصاً سليمة البنية بصورٍ فارغة، بلا أي رسالة خطأ. والبصمة تكشف ملفاً
وصل ناقصاً؛ والمقارنة بعد التحميل تكشف ما لم تكشفه البصمة.
"""
import hashlib
import json
import os
import tarfile
from pathlib import Path

from django.apps import apps
from django.conf import settings

FORMAT = 1
DATA, MEDIA, MANIFEST = "data.json", "media.tar.gz", "manifest.json"

#: التطبيقات المنقولة. `accounts.User` وحده من تطبيقه (لا الصلاحيات ولا
#: المجموعات — تُنشئها الترحيلات على الطرف الآخر).
EXPORTED = ["accounts.User", "classrooms", "stories", "games", "devices"]


def exported_models():
    for label in EXPORTED:
        if "." in label:
            yield apps.get_model(label)
        else:
            yield from apps.get_app_config(label).get_models()


def row_counts() -> dict[str, int]:
    """كل الصفوف، ومعها المحذوف حذفاً ناعماً — كما يصدّرها `dumpdata --all`."""
    return {m._meta.label: m._base_manager.count() for m in exported_models()}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def media_files(root: Path):
    """ملفات الأصول، بلا الملفات المخفيّة (بقايا فحص الصحّة وما شابه)."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.startswith("."):
                yield Path(dirpath) / name


def write_media_archive(out: Path) -> int:
    root = Path(settings.MEDIA_ROOT)
    count = 0
    # PAX: أسماء عربية (`stories/حرف_الباء/…`) تُحفظ UTF-8 كما هي على أي نظام.
    with tarfile.open(out, "w:gz", format=tarfile.PAX_FORMAT) as tar:
        if root.is_dir():
            for path in sorted(media_files(root)):
                tar.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
                count += 1
    return count


def extract_media_archive(archive: Path) -> None:
    root = Path(settings.MEDIA_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        # `data`: يرفض المسارات المطلقة و`..` والروابط الخارجة من المجلّد —
        # أرشيفٌ عُدِّل في الطريق لا يكتب خارج MEDIA_ROOT.
        tar.extractall(root, filter="data")


def read_manifest(folder: Path) -> dict:
    path = folder / MANIFEST
    if not path.is_file():
        raise ValueError(f"لا {MANIFEST} في {folder} — ليس مجلّد حزمة نقل.")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("format") != FORMAT:
        raise ValueError(f"صيغة حزمة غير معروفة: {manifest.get('format')} (المتوقَّع {FORMAT}).")
    return manifest
