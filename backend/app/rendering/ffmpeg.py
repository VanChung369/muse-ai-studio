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
    report = _report(ffmpeg, path)
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


def _report(ffmpeg: str, path: Path) -> str:
    try:
        # Without an output FFmpeg prints the input's streams and exits 1.
        return subprocess.run(  # noqa: S603 - fixed arguments, no shell
            [ffmpeg, "-hide_banner", "-i", str(path)],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60,
        ).stderr
    except (OSError, subprocess.SubprocessError):
        raise MergeError from None


def thumbnail(ffmpeg: str, clip: Path, target: Path) -> bool:
    """Write a small JPEG of the clip to `target`. False when it could not be made."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".part.jpg")
    try:
        # A frame one second in avoids a black or fading first frame; very
        # short clips fall back to their first frame.
        for seek in ("1", "0"):
            subprocess.run(  # noqa: S603 - fixed arguments, no shell
                [
                    ffmpeg, "-y", "-v", "error", "-ss", seek, "-i", str(clip),
                    "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(temporary),
                ],  # fmt: skip
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=60,
            )
            if temporary.is_file() and temporary.stat().st_size > 0:
                os.replace(temporary, target)
                return True
    except (OSError, subprocess.SubprocessError):
        pass
    finally:
        temporary.unlink(missing_ok=True)
    return False


def last_frame(ffmpeg: str, clip: Path) -> bytes:
    """The clip's final frame as a JPEG."""
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / "frame.jpg"
        try:
            # Decode the last second and keep overwriting one image, which
            # leaves the final frame (seeking straight to it can miss).
            subprocess.run(  # noqa: S603 - fixed arguments, no shell
                [
                    ffmpeg, "-y", "-v", "error", "-sseof", "-1", "-i", str(clip),
                    "-update", "1", "-q:v", "3", str(target),
                ],  # fmt: skip
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            raise MergeError from None
        if not target.is_file() or target.stat().st_size == 0:
            raise MergeError
        return target.read_bytes()


def merge(
    ffmpeg: str,
    paths: list[Path],
    output: Path,
    check_cancelled: Callable[[], None],
    mute: bool = False,
    cuts: list[tuple[float, float | None]] | None = None,
) -> None:
    """Join the clips in order into `output`. With `mute`, without any sound.

    `cuts` keeps only part of each clip: (start, end) in seconds, one
    per path, end None meaning the clip's end. Trimming needs frame
    accuracy, so a film with any trimmed clip is always re-encoded.

    Clips that share container, frame size and audio layout are joined
    without re-encoding. Otherwise, or when that result is not as long as
    its parts, every clip is decoded and re-encoded to H.264/AAC at the
    first clip's frame size.
    """
    clips = [probe(ffmpeg, path) for path in paths]
    spans = [
        _span(clip, *cut)
        for clip, cut in zip(clips, cuts or [(0.0, None)] * len(clips), strict=True)
    ]
    trimmed = any(
        start > 0.01 or end < clip.seconds - 0.01
        for clip, (start, end) in zip(clips, spans, strict=True)
    )
    expected = sum(end - start for start, end in spans)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".part.mp4")
    first = clips[0]
    uniform = all(
        clip.path.suffix == ".mp4"
        # Audio layout only matters when the sound is kept.
        and (clip.width, clip.height, mute or clip.has_audio)
        == (first.width, first.height, mute or first.has_audio)
        for clip in clips
    )
    try:
        with tempfile.TemporaryDirectory() as folder:
            attempts = [_reencode_arguments(clips, mute, spans if trimmed else None)]
            if uniform and not trimmed:
                attempts.insert(
                    0, _copy_arguments(clips, Path(folder) / "clips.txt", mute)
                )
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


def _span(clip: Clip, start: float, end: float | None) -> tuple[float, float]:
    """The part of a clip to keep, fitted inside the clip."""
    end = min(end if end is not None else clip.seconds, clip.seconds)
    start = max(0.0, min(start, end))
    return start, end


def _copy_arguments(clips: list[Clip], listing: Path, mute: bool) -> list[str]:
    listing.write_text(
        "".join(
            "file '{}'\n".format(clip.path.resolve().as_posix().replace("'", "'\\''"))
            for clip in clips
        ),
        encoding="utf-8",
    )
    arguments = ["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy"]
    return [*arguments, "-an"] if mute else arguments


def _reencode_arguments(
    clips: list[Clip], mute: bool, spans: list[tuple[float, float]] | None = None
) -> list[str]:
    width, height = clips[0].width, clips[0].height
    # H.264 with yuv420p needs even dimensions.
    width, height = width - width % 2, height - height % 2
    with_audio = not mute and any(clip.has_audio for clip in clips)
    inputs, filters, pads = [], [], []
    lengths = [clip.seconds for clip in clips]
    for index, clip in enumerate(clips):
        if spans:
            # Seeking on the input while decoding is frame accurate.
            start, end = spans[index]
            lengths[index] = end - start
            inputs += ["-ss", f"{start:.3f}", "-t", f"{end - start:.3f}"]
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
                "-f", "lavfi", "-t", f"{lengths[index]:.3f}",
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


def _run(
    command: list[str],
    check_cancelled: Callable[[], None],
    cwd: str | None = None,
) -> bool:
    try:
        process = subprocess.Popen(  # noqa: S603 - fixed arguments, no shell
            command,
            cwd=cwd,
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


@dataclass(frozen=True)
class MediaInfo:
    # None for a picture.
    seconds: float | None
    # None for audio.
    width: int | None
    height: int | None
    has_audio: bool


def inspect(ffmpeg: str, path: Path) -> MediaInfo:
    """Length, frame size and audio presence of any media file: a video has
    all three, a picture a frame size, audio a length."""
    report = _report(ffmpeg, path)
    length, video = _DURATION.search(report), _VIDEO.search(report)
    has_audio = "Audio:" in report
    if not video and not has_audio:
        raise MergeError
    seconds = None
    if length:
        hours, minutes, rest = length.groups()
        seconds = int(hours) * 3600 + int(minutes) * 60 + float(rest)
    return MediaInfo(
        seconds=seconds,
        width=int(video.group(1)) if video else None,
        height=int(video.group(2)) if video else None,
        has_audio=has_audio,
    )


def can_caption(ffmpeg: str) -> bool:
    """Whether this FFmpeg can draw captions (it needs libass)."""
    try:
        listing = subprocess.run(  # noqa: S603 - fixed arguments, no shell
            [ffmpeg, "-hide_banner", "-filters"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=60,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return re.search(r"^\s*\S+\s+subtitles\s", listing, re.MULTILINE) is not None


class CaptionError(MergeError):
    """This FFmpeg cannot draw captions."""


# How long a picture is shown when its entry does not say.
STILL_SECONDS = 3.0


@dataclass(frozen=True)
class Segment:
    """One piece of the film's picture: part of a clip, or a still."""

    path: Path
    # Seconds into the clip; `end` None means the clip's end. For a still,
    # `end - start` is how long it is shown.
    start: float = 0.0
    end: float | None = None
    # 2.0 plays twice as fast (and takes half as long). Ignored for a still.
    speed: float = 1.0
    still: bool = False


@dataclass(frozen=True)
class Soundtrack:
    """Audio laid over the film."""

    path: Path
    # Where in the film it starts.
    offset: float = 0.0
    # The part of the file that is used; `end` None means its end.
    start: float = 0.0
    end: float | None = None
    volume: float = 1.0
    # Repeat that part until the film ends.
    loop: bool = False


@dataclass(frozen=True)
class Caption:
    # Seconds into the film.
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class CaptionStyle:
    """How captions are drawn into the picture."""

    # Height of the letters as a share of the frame's height.
    size: float = 0.06
    # "#RRGGBB".
    color: str = "#FFFFFF"
    outline: str = "#000000"
    # "bottom", "middle" or "top".
    position: str = "bottom"
    bold: bool = False
    # A dark box behind the words instead of an outline around them.
    box: bool = False


def compose(
    ffmpeg: str,
    segments: list[Segment],
    output: Path,
    check_cancelled: Callable[[], None],
    *,
    mute: bool = False,
    volume: float = 1.0,
    soundtracks: list[Soundtrack] | tuple[Soundtrack, ...] = (),
    captions: list[Caption] | tuple[Caption, ...] = (),
    caption_style: CaptionStyle | None = None,
    frame: tuple[int, int] | None = None,
) -> None:
    """Build the film from `segments` in order, always re-encoding.

    This is the general form of `merge`, for a film that needs more than
    joining: stills, a changed speed, audio laid over it, captions drawn
    into the picture. `mute` and `volume` apply to the sound the clips came
    with; soundtracks keep their own volume and still play when muted.
    `frame` is the film's frame size (default: the first clip's).
    """
    if captions and not can_caption(ffmpeg):
        raise CaptionError
    parts = []  # (segment, start, seconds of source used, has audio)
    for segment in segments:
        if segment.still:
            shown = (segment.end or STILL_SECONDS) - segment.start
            parts.append((segment, 0.0, max(shown, 0.1), False))
            continue
        clip = probe(ffmpeg, segment.path)
        start, end = _span(clip, segment.start, segment.end)
        parts.append((segment, start, end - start, clip.has_audio))
        frame = frame or (clip.width, clip.height)
    width, height = frame or (1280, 720)
    # H.264 with yuv420p needs even dimensions.
    width, height = width - width % 2, height - height % 2
    lengths = [
        used / (1.0 if segment.still else segment.speed)
        for segment, _, used, _ in parts
    ]
    total = sum(lengths)
    keep_sound = not mute and volume > 0 and any(part[3] for part in parts)

    inputs: list[str] = []
    count = 0

    def add(*arguments: str) -> int:
        nonlocal count
        inputs.extend(arguments)
        count += 1
        return count - 1

    filters, pads = [], []
    fit = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"
    )
    for index, ((segment, start, used, has_audio), length) in enumerate(
        zip(parts, lengths, strict=True)
    ):
        if segment.still:
            source = add(
                "-loop", "1", "-framerate", "30", "-t", f"{used:.3f}",
                "-i", str(segment.path),
            )  # fmt: skip
            pace = ""
        else:
            # Seeking on the input while decoding is frame accurate.
            source = add(
                "-ss", f"{start:.3f}", "-t", f"{used:.3f}", "-i", str(segment.path)
            )
            pace = "" if segment.speed == 1 else f"setpts=PTS/{segment.speed:.4f},"
        filters.append(f"[{source}:v]{pace}{fit}[v{index}]")
        pads.append(f"[v{index}]")
        if not keep_sound:
            continue
        if has_audio:
            sound, tempo = f"{source}:a", _tempo(segment.speed)
        else:
            # A silent piece between ones with sound still needs an audio track.
            silent = add(
                "-f", "lavfi", "-t", f"{length:.3f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            )  # fmt: skip
            sound, tempo = f"{silent}:a", ""
        filters.append(
            f"[{sound}]{tempo}aresample=44100,aformat=channel_layouts=stereo[a{index}]"
        )
        pads.append(f"[a{index}]")
    filters.append(
        "".join(pads)
        + f"concat=n={len(parts)}:v=1:a={1 if keep_sound else 0}[joined]"
        + ("[sound]" if keep_sound else "")
    )

    mix = []
    if keep_sound:
        if volume == 1:
            mix.append("[sound]")
        else:
            filters.append(f"[sound]volume={volume:.3f}[level]")
            mix.append("[level]")
    for index, track in enumerate(soundtracks):
        room = total - track.offset
        info = inspect(ffmpeg, track.path)
        if not info.has_audio or info.seconds is None:
            raise MergeError
        end = min(track.end if track.end is not None else info.seconds, info.seconds)
        start = max(0.0, min(track.start, end))
        own = end - start
        if room <= 0.05 or own <= 0.05:
            continue  # Starts after the film ends, or nothing of it is used.
        play = room if track.loop else min(own, room)
        source = add("-i", str(track.path))
        steps = [
            "aresample=44100",
            "aformat=channel_layouts=stereo",
            f"atrim=start={start:.3f}:end={end:.3f}",
            "asetpts=PTS-STARTPTS",
        ]
        if track.loop:
            steps.append(f"aloop=loop=-1:size={int(own * 44100)}")
        steps += [f"atrim=duration={play:.3f}", f"volume={track.volume:.3f}"]
        if play > 2 and (track.loop or own > room):
            # Cut off by the film's end: let it fade rather than stop dead.
            steps.append(f"afade=t=out:st={play - 1.5:.3f}:d=1.5")
        if track.offset > 0:
            steps.append(f"adelay={int(track.offset * 1000)}:all=1")
        filters.append(f"[{source}:a]{','.join(steps)}[m{index}]")
        mix.append(f"[m{index}]")
    audio = None
    if len(mix) == 1 and keep_sound:
        audio = mix[0]
    elif mix:
        if not keep_sound:
            # The mix is as long as its first input: silence of the film's length.
            bed = add(
                "-f", "lavfi", "-t", f"{total:.3f}",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            )  # fmt: skip
            mix.insert(0, f"[{bed}:a]")
        filters.append(
            "".join(mix)
            + f"amix=inputs={len(mix)}:duration=first:dropout_transition=0:normalize=0,"
            "alimiter=limit=0.95[mixed]"
        )
        audio = "[mixed]"

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + ".part.mp4")
    try:
        with tempfile.TemporaryDirectory() as folder:
            picture = "[joined]"
            if captions:
                # Read by a relative name with the folder as working directory:
                # a Windows path cannot be written safely inside a filter.
                (Path(folder) / CAPTION_FILE).write_text(
                    caption_script(
                        captions, caption_style or CaptionStyle(), width, height
                    ),
                    encoding="utf-8",
                )
                filters.append(f"[joined]subtitles={CAPTION_FILE}[drawn]")
                picture = "[drawn]"
            command = [
                ffmpeg, "-y", "-v", "error", *inputs,
                "-filter_complex", ";".join(filters), "-map", picture,
            ]  # fmt: skip
            if audio:
                command += ["-map", audio, "-c:a", "aac", "-b:a", "192k"]
            command += [
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-t", f"{total:.3f}", "-movflags", "+faststart",
                str(temporary.resolve()),
            ]  # fmt: skip
            if not _run(command, check_cancelled, cwd=folder):
                raise MergeError
        made = probe(ffmpeg, temporary).seconds
        if abs(made - total) > max(0.5, total * 0.05):
            raise MergeError
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


CAPTION_FILE = "captions.ass"


def caption_text(captions) -> str:
    """The captions as an SRT file."""

    def stamp(seconds: float) -> str:
        whole = int(round(seconds * 1000))
        hours, rest = divmod(whole, 3_600_000)
        minutes, rest = divmod(rest, 60_000)
        return f"{hours:02d}:{minutes:02d}:{rest // 1000:02d},{rest % 1000:03d}"

    blocks = []
    for number, caption in enumerate(sorted(captions, key=lambda c: c.start), 1):
        # Braces start style overrides in the caption renderer; a blank line
        # would end the block.
        lines = [
            line.strip()
            for line in caption.text.replace("{", "(").replace("}", ")").splitlines()
        ]
        text = "\n".join(line for line in lines if line)
        if text:
            blocks.append(
                f"{number}\n{stamp(caption.start)} --> {stamp(caption.end)}\n{text}\n"
            )
    return "\n".join(blocks)


def _tempo(speed: float) -> str:
    """Audio filters that play `speed` times as fast at the same pitch (one
    `atempo` covers 0.5 to 2, so larger changes are chained)."""
    steps = []
    while speed > 2.0 + 1e-9:
        steps.append("atempo=2.0")
        speed /= 2.0
    while speed < 0.5 - 1e-9:
        steps.append("atempo=0.5")
        speed /= 0.5
    if abs(speed - 1.0) > 1e-9:
        steps.append(f"atempo={speed:.4f}")
    return "".join(step + "," for step in steps)


def extract_audio(ffmpeg: str, source: Path, target: Path) -> None:
    """Write the sound of `source` to `target` as AAC, without its picture."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.stem + ".part" + target.suffix)
    try:
        done = _run(
            [
                ffmpeg, "-y", "-v", "error", "-i", str(source),
                "-vn", "-c:a", "aac", "-b:a", "192k", str(temporary),
            ],  # fmt: skip
            lambda: None,
        )
        if not done or not temporary.is_file() or temporary.stat().st_size == 0:
            raise MergeError
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def caption_script(captions, style: CaptionStyle, width: int, height: int) -> str:
    """The captions as an ASS script for a frame of this size. Written in
    full rather than styled through the filter, so sizes are in the film's
    own pixels and the position means the same in every FFmpeg build."""

    def colour(value: str, alpha: str = "00") -> str:
        red, green, blue = value[1:3], value[3:5], value[5:7]
        return f"&H{alpha}{blue}{green}{red}".upper()

    def stamp(seconds: float) -> str:
        whole = int(round(seconds * 100))
        hours, rest = divmod(whole, 360_000)
        minutes, rest = divmod(rest, 6_000)
        return f"{hours}:{minutes:02d}:{rest // 100:02d}.{rest % 100:02d}"

    size = max(round(height * style.size), 8)
    # A box is drawn as a thick, half-transparent "outline" in black.
    border = (
        f"3,{round(size * 0.22, 1)},0"
        if style.box
        else f"1,{round(size * 0.07, 1)},{round(size * 0.03, 1)}"
    )
    edge = colour("#000000", "70") if style.box else colour(style.outline)
    alignment = {"bottom": 2, "middle": 5, "top": 8}.get(style.position, 2)
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Default,Arial,{size},{colour(style.color)},&H000000FF,{edge},"
        f"&H80000000,{-1 if style.bold else 0},0,0,0,100,100,0,0,{border},"
        f"{alignment},{round(width * 0.05)},{round(width * 0.05)},"
        f"{round(height * 0.06)},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for caption in sorted(captions, key=lambda c: c.start):
        # Braces and backslashes start style overrides in the renderer.
        rows = [
            row.strip()
            for row in caption.text.replace("{", "(")
            .replace("}", ")")
            .replace("\\", "/")
            .splitlines()
        ]
        text = "\\N".join(row for row in rows if row)
        if text:
            lines.append(
                f"Dialogue: 0,{stamp(caption.start)},{stamp(caption.end)},Default,,0,0,0,,{text}"
            )
    return "\n".join(lines) + "\n"


def waveform(ffmpeg: str, source: Path, target: Path) -> bool:
    """Draw the sound of `source` as a wide, see-through PNG (white on
    nothing). False when it could not be made."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.stem + ".part.png")
    try:
        done = _run(
            [
                ffmpeg, "-y", "-v", "error", "-i", str(source),
                "-filter_complex",
                "aformat=channel_layouts=mono,showwavespic=s=1600x96:colors=white",
                "-frames:v", "1", str(temporary),
            ],  # fmt: skip
            lambda: None,
        )
        if not done or not temporary.is_file() or temporary.stat().st_size == 0:
            return False
        os.replace(temporary, target)
        return True
    except MergeError:
        return False
    finally:
        temporary.unlink(missing_ok=True)
