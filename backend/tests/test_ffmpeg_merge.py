"""Merging with a real FFmpeg binary; skipped when none is installed."""

import subprocess

import pytest

from app.core.config import Settings
from app.rendering.ffmpeg import MergeError, find_ffmpeg, last_frame, merge, probe

FFMPEG = find_ffmpeg(Settings())
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="FFmpeg is not installed.")


def clip(path, seconds, color, suffix_args=()):
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "lavfi", "-i", f"color=c={color}:s=320x180:r=24:d={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            "-shortest", *suffix_args, str(path),
        ],  # fmt: skip
        check=True,
    )
    return path


def duration(path):
    return probe(FFMPEG, path).seconds


@needs_ffmpeg
def test_clips_are_joined_in_order(tmp_path):
    clips = [
        clip(tmp_path / "scene-01.mp4", 2, "red"),
        clip(tmp_path / "scene's 02.mp4", 1, "blue"),
    ]
    output = tmp_path / "out" / "final.mp4"
    merge(FFMPEG, clips, output, lambda: None)
    assert 2.7 < duration(output) < 3.4
    assert not list(output.parent.glob("*.part.mp4"))


@needs_ffmpeg
def test_mixed_containers_are_re_encoded(tmp_path):
    clips = [
        clip(tmp_path / "scene-01.mp4", 1, "red"),
        clip(
            tmp_path / "scene-02.webm",
            1,
            "green",
            ("-c:v", "libvpx", "-c:a", "libvorbis"),
        ),
    ]
    output = tmp_path / "final.mp4"
    merge(FFMPEG, clips, output, lambda: None)
    assert 1.7 < duration(output) < 2.4


@needs_ffmpeg
def test_different_sizes_and_a_silent_clip_keep_every_scene(tmp_path):
    silent = tmp_path / "scene-02.mp4"
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=blue:s=180x320:r=24:d=1", str(silent),
        ],  # fmt: skip
        check=True,
    )
    clips = [clip(tmp_path / "scene-01.mp4", 1, "red"), silent]
    output = tmp_path / "final.mp4"
    merge(FFMPEG, clips, output, lambda: None)
    merged = probe(FFMPEG, output)
    assert 1.7 < merged.seconds < 2.4
    assert (merged.width, merged.height, merged.has_audio) == (320, 180, True)


@needs_ffmpeg
def test_unreadable_clip_and_cancel_leave_no_output(tmp_path):
    broken = tmp_path / "scene-01.mp4"
    broken.write_bytes(b"not a video")
    output = tmp_path / "final.mp4"
    with pytest.raises(MergeError):
        merge(FFMPEG, [broken], output, lambda: None)
    assert not output.exists() and not list(tmp_path.glob("*.part.mp4"))

    class Cancelled(Exception):
        pass

    def cancel():
        raise Cancelled

    good = clip(tmp_path / "scene-02.mp4", 1, "red")
    with pytest.raises(Cancelled):
        merge(FFMPEG, [good], output, cancel)
    assert not output.exists() and not list(tmp_path.glob("*.part.mp4"))


@needs_ffmpeg
def test_last_frame_is_a_jpeg_of_the_clip_end(tmp_path):
    frame = last_frame(FFMPEG, clip(tmp_path / "scene-01.mp4", 2, "red"))
    assert frame[:3] == b"\xff\xd8\xff" and len(frame) > 500
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    with pytest.raises(MergeError):
        last_frame(FFMPEG, broken)


def test_missing_binary_is_a_merge_error(tmp_path):
    with pytest.raises(MergeError):
        merge(
            str(tmp_path / "no-ffmpeg"),
            [tmp_path / "a.mp4"],
            tmp_path / "o.mp4",
            lambda: None,
        )


def test_configured_path_must_exist(tmp_path):
    assert find_ffmpeg(Settings(ffmpeg_path=str(tmp_path / "missing"))) is None
