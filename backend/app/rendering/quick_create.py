"""One Quick Create request makes all its outputs in one Muse conversation."""

from uuid import UUID, uuid4, uuid5

from sqlalchemy import case, func, select, update

from app.accounts.task_session import TaskAccountSession
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import (
    generate_image,
    generate_images,
    generate_video,
    video_prompt,
)
from app.models import Account, LibraryAsset, Task
from app.rendering import library, storage
from app.rendering.ffmpeg import MergeError, find_ffmpeg, inspect, thumbnail
from app.rendering.intake import TYPES, content_type, readable, thumbnail_name
from app.repositories import tasks
from app.tasks.coordinator import TaskFailure
from app.tasks.kinds import ACTIVE_STATUSES, GENERATE_IMAGE, GENERATE_VIDEO, QUICK_KINDS

MAX_COUNT = 100


class QuickCreateError(ValueError):
    def __init__(self, code, status=409):
        super().__init__(code)
        self.code, self.status = code, status


def enqueue(session, values, settings, *, api_key_id=None):
    try:
        if not find_ffmpeg(settings):
            raise QuickCreateError("ffmpeg_unavailable")
        # Write before reading: a statement that changes nothing still takes
        # SQLite's write lock. A transaction that has read first cannot take
        # it once a worker has committed in between, and the request would
        # fail with "database is locked".
        session.execute(update(Task).where(Task.id == "").values(id=Task.id))
        if not session.scalar(
            select(Account.id)
            .where(Account.enabled.is_(True), Account.session_status == "valid")
            .limit(1)
        ):
            raise QuickCreateError("account_unavailable")
        if values.reference_asset_id:
            asset = session.get(LibraryAsset, values.reference_asset_id)
            if (
                not asset
                or asset.kind != "image"
                or not (storage.library_dir(settings) / asset.file).is_file()
            ):
                raise QuickCreateError("reference_missing", 422)
        batch_id = str(uuid4())
        tasks.create_task(
            session,
            kind=GENERATE_IMAGE if values.kind == "image" else GENERATE_VIDEO,
            title=values.prompt[:200],
            requires_account=True,
            max_attempts=1,
            payload={
                "batchId": batch_id,
                "batch": True,
                "kind": values.kind,
                "prompt": values.prompt,
                "aspectRatio": values.aspect_ratio,
                "count": values.count,
                "index": 0,
                "referenceAssetId": values.reference_asset_id,
                **(
                    {"source": "api", "hidden": 1, "apiKeyId": api_key_id}
                    if api_key_id is not None
                    else {}
                ),
            },
        )
        # The task reserves all requested slots, minus files already saved.
        # Flush above acquires the write lock before checking capacity.
        stored = session.scalar(select(func.count()).select_from(LibraryAsset))
        remaining = case(
            (
                func.json_extract(Task.payload_json, "$.batch") == 1,
                func.json_extract(Task.payload_json, "$.count")
                - func.coalesce(
                    func.json_array_length(Task.checkpoint_json, "$.assetIds"), 0
                ),
            ),
            else_=1,
        )
        reserved = session.scalar(
            select(func.coalesce(func.sum(remaining), 0)).where(
                Task.kind.in_(QUICK_KINDS), Task.status.in_(ACTIVE_STATUSES)
            )
        )
        if stored + reserved > library.MAX_ASSETS:
            raise QuickCreateError("too_many_files")
        session.commit()
        return batch_id
    except Exception:
        session.rollback()
        raise


def output_id(task_id, index, batch):
    return str(uuid5(UUID(task_id), str(index))) if batch else task_id


def make_quick_handler(app):
    def handler(context):
        context.raise_if_cancelled()
        settings, database = app.state.settings, app.state.database
        ffmpeg = find_ffmpeg(settings)
        if not ffmpeg:
            raise TaskFailure("ffmpeg_unavailable", suggested_action="retry")
        values = context.payload
        is_batch = values.get("batch", False)
        count = values["count"] if is_batch else 1
        asset_ids = list(context.checkpoint.get("assetIds", []))
        thread = context.checkpoint.get("threadPath")
        sent = context.checkpoint.get("sent", False)
        if thread and context.checkpoint.get("accountId") != context.account_id:
            raise TaskFailure("conversation_unavailable")
        reference = []
        with database.sessions() as session:
            # Recover a committed file even if the process stopped before its checkpoint.
            while len(asset_ids) < count:
                asset_id = output_id(context.task_id, len(asset_ids), is_batch)
                asset = session.get(LibraryAsset, asset_id)
                if (
                    not asset
                    or not (storage.library_dir(settings) / asset.file).is_file()
                ):
                    break
                asset_ids.append(asset_id)
            if len(asset_ids) == count:
                return {"assetIds": asset_ids}
            if sent and not thread:
                # A prior request was sent, but its thread id was never learned.
                # Do not silently open a second conversation on a manual retry.
                raise TaskFailure("conversation_unavailable")
            if values.get("referenceAssetId"):
                asset = session.get(LibraryAsset, values["referenceAssetId"])
                if not asset or asset.kind != "image":
                    raise TaskFailure("reference_missing", suggested_action="retry")
                path = storage.library_dir(settings) / asset.file
                if not path.is_file():
                    raise TaskFailure("reference_missing", suggested_action="retry")
                # Keep the bytes for this attempt, including their original MIME.
                reference = [
                    {
                        "name": "reference" + path.suffix,
                        "mimeType": asset.mime,
                        "buffer": path.read_bytes(),
                    }
                ]

        def checkpoint():
            context.save_checkpoint(
                {
                    "assetIds": list(asset_ids),
                    "threadPath": thread,
                    "accountId": context.account_id,
                    "sent": sent,
                }
            )

        checkpoint()
        account = TaskAccountSession(app, context.account_id)

        def before_send(result):
            nonlocal sent
            context.raise_if_cancelled()
            sent = True
            checkpoint()
            context.mark_submitted()

        def remember_thread(path):
            nonlocal thread
            if path != thread:
                thread = path
                checkpoint()

        kind = values["kind"]
        remaining = count - len(asset_ids)
        prompt = (
            f"Generate exactly {remaining} separate images (aspect ratio {values['aspectRatio']}): {values['prompt']}. "
            "Return each image as its own downloadable image attachment, not a collage or contact sheet."
            if kind == "image"
            else video_prompt(values["prompt"], values["aspectRatio"], 10)
        )
        if asset_ids:
            prompt += f" {len(asset_ids)} outputs from this request are already saved. Create only the {remaining} remaining outputs."
        if reference:
            prompt += (
                " Use the attached image as the visual reference for every image."
                if kind == "image"
                else " Use the attached image as the starting frame."
            )

        def save_output(generated):
            mime = content_type(generated.mime)
            if not generated.data or mime not in TYPES or TYPES[mime][0] != kind:
                raise TaskFailure("media_download_failed", suggested_action="retry")
            index = len(asset_ids)
            if index >= count:
                return
            asset_id = output_id(context.task_id, index, is_batch)
            extension = TYPES[mime][1]
            file = f"{asset_id}{extension}"
            folder = storage.library_dir(settings)
            target, still = folder / file, folder / thumbnail_name(file)
            try:
                storage.write(target, generated.data)
                try:
                    info = inspect(ffmpeg, target)
                except MergeError:
                    info = None
                if not readable(info, kind):
                    raise TaskFailure("media_download_failed", suggested_action="retry")
                thumbnail(ffmpeg, target, still)
                with database.sessions() as session:
                    session.add(
                        LibraryAsset(
                            id=asset_id,
                            kind=kind,
                            source=values.get("source", "quick"),
                            name=f"Muse - {values['prompt'][:80]} - {values['index'] + index + 1}{extension}",
                            file=file,
                            mime=mime,
                            size=len(generated.data),
                            seconds=round(info.seconds, 3) if kind == "video" else None,
                            width=info.width,
                            height=info.height,
                        )
                    )
                    session.flush()
                    if (
                        session.scalar(select(func.count()).select_from(LibraryAsset))
                        > library.MAX_ASSETS
                    ):
                        raise TaskFailure("too_many_files", suggested_action="retry")
                    session.commit()
            except BaseException:
                target.unlink(missing_ok=True)
                still.unlink(missing_ok=True)
                raise
            asset_ids.append(asset_id)
            checkpoint()

        generator = (
            generate_images
            if kind == "image" and is_batch
            else generate_image if kind == "image" else generate_video
        )
        options = {"count": remaining} if kind == "image" and is_batch else {}
        try:
            generator(
                app.state.muse_client,
                account.cookies,
                account.expiries,
                account.proxy,
                prompt,
                on_session=account.persist,
                before_send=before_send,
                check_cancelled=context.raise_if_cancelled,
                timeout=settings.render_timeout,
                attachments=reference,
                thread_path=thread,
                require_thread=bool(thread),
                attach_on_continue=True,
                on_thread=remember_thread,
                on_media=save_output,
                **options,
            )
        except MuseError as error:
            raise account.failure(error) from None
        if len(asset_ids) < count:
            raise TaskFailure("image_count_mismatch", suggested_action="retry")
        return {"assetIds": asset_ids}

    return handler
