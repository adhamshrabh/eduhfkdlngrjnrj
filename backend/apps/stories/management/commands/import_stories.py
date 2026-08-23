"""
استيراد القصص من مجلد `content/stories/` القديم إلى قاعدة البيانات.

الاستخدام:
    python manage.py import_stories --source "/path/to/content/stories" --owner teacher@example.com
    python manage.py import_stories --source ... --owner ... --dry-run

مبدأ التشغيل: **لا يلمس الملفات المصدرية إطلاقاً** — يقرأ فقط وينسخ. ويطبع
تقريراً مقارناً لكل قصة (عدد المشاهد وعدد الأصول قبل/بعد) حتى لا يمرّ استيراد
ناقص بصمت.
"""

from __future__ import annotations

import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from apps.stories.models import Story, StoryAsset
from apps.stories.validators import extract_scene_objects

User = get_user_model()

AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".webm", ".m4a"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}


class Command(BaseCommand):
    help = "استيراد قصص content/stories/* إلى قاعدة البيانات."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--source", required=True, help="مسار مجلد content/stories")
        parser.add_argument("--owner", required=True, help="بريد المعلّمة المالكة")
        parser.add_argument("--dry-run", action="store_true", help="تقرير بلا كتابة")
        parser.add_argument("--publish", action="store_true", help="نشر القصص المستوردة")
        parser.add_argument("--only", nargs="*", default=None, help="استيراد قصص محدّدة بالاسم")

    # ------------------------------------------------------------------ أدوات

    @staticmethod
    def _read_json(path: Path) -> dict | None:
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise CommandError(f"تعذّرت قراءة {path}: {exc}") from exc

    @staticmethod
    def _kind_for(path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in AUDIO_SUFFIXES:
            return StoryAsset.Kind.AUDIO
        if suffix in IMAGE_SUFFIXES:
            return StoryAsset.Kind.IMAGE
        return StoryAsset.Kind.IMAGE

    def _collect_assets(self, story_dir: Path, story_json: dict) -> list[tuple[str, Path]]:
        """
        يبني قائمة (alias, path).

        الأولوية لمصفوفة `assets` داخل story.json لأنها المصدر الذي يستهلكه
        المحرّك فعلاً؛ ثم نلتقط أي ملف موجود على القرص لم تذكره المصفوفة
        حتى لا يضيع أصل رفعته المعلّمة ولم يُسجَّل.
        """
        pairs: list[tuple[str, Path]] = []
        seen_paths: set[Path] = set()
        seen_aliases: set[str] = set()

        nested = story_json.get("story")
        asset_entries = story_json.get("assets") or (nested.get("assets") if isinstance(nested, dict) else None) or []
        for entry in asset_entries:
            if not isinstance(entry, dict):
                continue
            alias = str(entry.get("alias") or "").strip()
            src = str(entry.get("src") or "").strip()
            if not alias or not src:
                continue
            candidate = (story_dir / src).resolve()
            if not candidate.exists() or not candidate.is_file():
                self.stdout.write(self.style.WARNING(f"    ⚠ مرجع مفقود على القرص: {alias} → {src}"))
                continue
            pairs.append((alias, candidate))
            seen_paths.add(candidate)
            seen_aliases.add(alias)

        for path in sorted(story_dir.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in AUDIO_SUFFIXES | IMAGE_SUFFIXES:
                continue
            resolved = path.resolve()
            if resolved in seen_paths:
                continue
            alias = path.stem
            suffix_n = 2
            while alias in seen_aliases:
                alias = f"{path.stem}_{suffix_n}"
                suffix_n += 1
            pairs.append((alias, resolved))
            seen_aliases.add(alias)

        return pairs

    # ----------------------------------------------------------------- التنفيذ

    def handle(self, *args, **options) -> None:
        source = Path(options["source"]).expanduser().resolve()
        if not source.is_dir():
            raise CommandError(f"المجلد غير موجود: {source}")

        owner = User.objects.filter(email=options["owner"]).first()
        if owner is None:
            raise CommandError(f"لا يوجد مستخدم بالبريد {options['owner']}")

        dry_run: bool = options["dry_run"]
        only: list[str] | None = options["only"]

        story_dirs = sorted(d for d in source.iterdir() if d.is_dir() and (d / "story.json").exists())
        if only:
            story_dirs = [d for d in story_dirs if d.name in only]
        if not story_dirs:
            raise CommandError("لم يُعثر على أي مجلد يحتوي story.json")

        self.stdout.write(self.style.MIGRATE_HEADING(f"\nوُجدت {len(story_dirs)} قصة في {source}\n"))
        totals = {"stories": 0, "assets": 0, "skipped": 0}

        for story_dir in story_dirs:
            slug = slugify(story_dir.name, allow_unicode=True)[:80] or story_dir.name[:80]
            story_json = self._read_json(story_dir / "story.json") or {}
            layout_json = self._read_json(story_dir / "layout.json") or {}

            title = str(story_json.get("title") or story_json.get("name") or story_dir.name)
            # المشاهد الفعلية في story.scenes لا في الجذر — قراءة الجذر
            # مباشرة كانت تعطي عدداً خاطئاً لكل قصة حقيقية.
            scene_count = len(extract_scene_objects(story_json))
            assets = self._collect_assets(story_dir, story_json)

            self.stdout.write(f"  📖 {story_dir.name} → «{title}»")
            self.stdout.write(f"     مشاهد: {scene_count} · أصول على القرص: {len(assets)}")

            if Story.all_objects.filter(slug=slug).exists():
                self.stdout.write(self.style.WARNING("     ⏭ موجودة مسبقاً — تُخطّى (احذفيها يدوياً لإعادة الاستيراد)"))
                totals["skipped"] += 1
                continue

            if dry_run:
                self.stdout.write(self.style.NOTICE("     (تجربة — لم يُكتب شيء)"))
                continue

            with transaction.atomic():
                story = Story.objects.create(
                    slug=slug,
                    title=title,
                    description=str(story_json.get("description") or ""),
                    owner=owner,
                    is_published=bool(options["publish"]),
                    story_json=story_json,
                    layout_json=layout_json,
                )
                imported = 0
                for alias, path in assets:
                    try:
                        with path.open("rb") as fh:
                            StoryAsset.objects.create(
                                story=story,
                                asset_id=StoryAsset.next_asset_id(story),
                                alias=alias,
                                kind=self._kind_for(path),
                                file=File(fh, name=path.name),
                                original_name=path.name,
                                size_bytes=path.stat().st_size,
                                # المسار كما تكتبه القصة — يبقى حرفياً كما هو
                                # حتى يعمل story.json بلا أي إعادة كتابة.
                                content_path=path.relative_to(story_dir).as_posix(),
                            )
                        imported += 1
                    except OSError as exc:
                        self.stdout.write(self.style.ERROR(f"     ✗ تعذّر نسخ {path.name}: {exc}"))

            # تحقّق مقارن — لا نعلن النجاح إلا بعد قراءة ما كُتب فعلاً
            story.refresh_from_db()
            written_assets = story.assets.count()
            match = written_assets == len(assets) and story.scene_count == scene_count
            style = self.style.SUCCESS if match else self.style.ERROR
            self.stdout.write(
                style(f"     ✓ كُتب: مشاهد {story.scene_count}/{scene_count} · أصول {written_assets}/{len(assets)}")
            )
            totals["stories"] += 1
            totals["assets"] += written_assets

        self.stdout.write(
            self.style.MIGRATE_HEADING(
                f"\nالإجمالي: {totals['stories']} قصة · {totals['assets']} أصل · "
                f"{totals['skipped']} متخطّاة\n"
            )
        )
