"""Merge scene clips into one MP4 with FFmpeg."""

import os
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings

MERGE_TIMEOUT = 900.0
_DURATION = re.compile(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO = re.compile(r"Stream #.*Video:.*?\b(\d{2,5})x(\d{2,5})\b")


class MergeError(Exception):
    pass


@dataclass(frozen=True)
class Clip:
    path: Path
    seconds: float
    width: int
    height: int
    has_audio: bool


def find_ffmpeg(settings: Settings) -> str | None:
    if settings.ffmpeg_path:
        return settings.ffmpeg_path if Path(settings.ffmpeg_path).is_file() else None
    return shutil.which("ffmpeg")


def probe(ffmpeg: str, path: Path) -> Clip:
    """Read a clip's length, frame size and audio presence from FFmpeg itself
    (no separate ffprobe needed)."""
    try:
        # Without an output FFmpeg prints the input's streams and exits 1.
        report = subprocess.run(  # noqa: S603 - fixed arguments, no shell
            [ffmpeg, "-hide_banner", "-i", str(path)],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60,
        ).stderr
    except (OSError, subprocess.SubprocessError):
        raise MergeError from None
    length, video = _DURATION.search(report), _VIDEO.search(report)
    if not length or not video:
        raise MergeError
    hours, minutes, seconds = length.groups()
    return Clip(
        path=path,
        seconds=int(hours) * 3600 + int(minutes) * 60 + float(seconds),
        width=int(video.group(1)),
        height=int(video.group(2)),
        has_audio="Audio:" in report,
    )


def merge(
    ffmpeg: str,
    paths: list[Path],
    output: Path,
    check_cancelled: Callable[[], None],
) -> None:
    """Join the clips in order into `output`.

    Clips that share container, frame size and audio layout are joined
    without re-encoding. Otherwise, or when that result is not as long as
    its parts, every clip is decoded and re-encoded to H.264/AAC at the
    first clip's frame size.
    """
    clips = [probe(ffmpeg, path) for path in paths]
    expected = sum(clip.seconds for clip in clips)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".part.mp4")
    first = clips[0]
    uniform = all(
        clip.path.suffix == ".mp4"
        and (clip.width, clip.height, clip.has_audio)
        == (first.width, first.height, first.has_audio)
        for clip in clips
    )
    try:
        with tempfile.TemporaryDirectory() as folder:
            attempts = [_reencode_arguments(clips)]
            if uniform:
                attempts.insert(0, _copy_arguments(clips, Path(folder) / "clips.txt"))
            for arguments in attempts:
                command = [
                    ffmpeg, "-y", "-v", "error", *arguments,
                    "-movflags", "+faststart", str(temporary),
                ]  # fmt: skip
                if not _run(command, check_cancelled):
                    continue
                # FFmpeg can exit cleanly after silently dropping a clip.
                merged = probe(ffmpeg, temporary).seconds
                if abs(merged - expected) <= max(0.5, expected * 0.05):
                    os.replace(temporary, output)
                    return
        raise MergeError
    finally:
        temporary.unlink(missing_ok=True)


def _copy_arguments(clips: list[Clip], listing: Path) -> list[str]:
    listing.write_text(
        "".join(
            "file '{}'\n".format(clip.path.resolve().as_posix().replace("'", "'\\''"))
            for clip in clips
        ),
        encoding="utf-8",
    )
    return ["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy"]


def _reencode_arguments(clips: list[Clip]) -> list[str]:
    width, height = clips[0].width, clips[0].height
    # H.264 with yuv420p needs even dimensions.
    width, height = width - width % 2, height - height % 2
    with_audio = any(clip.has_audio for clip in clips)
    inputs, filters, pads = [], [], []
    for clip in clips:
        inputs += ["-i", str(clip.path)]
    silent = len(clips)  # Index of the next generated silent track.
    for index, clip in enumerate(clips):
        filters.append(
            f"[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
            f"format=yuv420p[v{index}]"
        )
        pads.append(f"[v{index}]")
        if not with_audio:
            continue
        source = f"{index}:a"
        if not clip.has_audio:
            # A silent clip between ones with sound still needs an audio track.
            inputs += [
                "-f", "lavfi", "-t", f"{clip.seconds:.3f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            ]  # fmt: skip
            source, silent = f"{silent}:a", silent + 1
        filters.append(
            f"[{source}]aresample=44100,aformat=channel_layouts=stereo[a{index}]"
        )
        pads.append(f"[a{index}]")
    audio = 1 if with_audio else 0
    filters.append(
        "".join(pads)
        + f"concat=n={len(clips)}:v=1:a={audio}[v]"
        + ("[a]" if with_audio else "")
    )
    arguments = [*inputs, "-filter_complex", ";".join(filters), "-map", "[v]"]
    if with_audio:
        arguments += ["-map", "[a]", "-c:a", "aac"]
    return [*arguments, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]


def _run(command: list[str], check_cancelled: Callable[[], None]) -> bool:
    try:
        process = subprocess.Popen(  # noqa: S603 - fixed arguments, no shell
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        raise MergeError from None
    deadline = time.monotonic() + MERGE_TIMEOUT
    try:
        while process.poll() is None:
            check_cancelled()
            if time.monotonic() > deadline:
                raise MergeError
            time.sleep(0.2)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    return process.returncode == 0
