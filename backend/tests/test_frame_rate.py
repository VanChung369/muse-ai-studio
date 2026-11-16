"""The film keeps the pace of its clips' frames. Forcing 30 fps on 24 fps
clips repeated every fifth frame, a steady judder (measured 2026-11-16: 61
of 300 frames repeated in a 10 s scene at 1x). Uses a real FFmpeg."""

import re
import subprocess

import pytest

from app.core.config import Settings
from app.rendering.ffmpeg import Segment, compose, find_ffmpeg, frame_rate, merge

FFMPEG = find_ffmpeg(Settings())
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="FFmpeg is not installed.")


def moving_clip(path, seconds=2, rate=24):
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc2=s=320x180:r={rate}:d={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            "-shortest", "-pix_fmt", "yuv420p", str(path),
        ],  # fmt: skip
        check=True,
    )
    return path


def frames(path):
    """The file's frame rate and, frame to frame, whether the picture moved."""
    report = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-an",
            "-vf", "tblend=all_mode=difference,signalstats,"
            "metadata=print:key=lavfi.signalstats.YAVG",
            "-f", "null", "-",
        ],  # fmt: skip
        capture_output=True,
        text=True,
    ).stderr
    rate = re.search(r"Video:.*?(\d+(?:\.\d+)?) fps", report).group(1)
    moved = [float(value) > 0.5 for value in re.findall(r"YAVG=([0-9.]+)", report)]
    return rate, moved


def test_frame_rate_keeps_each_frame_or_repeats_and_drops_evenly():
    assert frame_rate("24") == "24"
    assert frame_rate("24", 1.25) == "30"
    # Faster than 60: every other frame. Slower than 24: each frame twice.
    assert frame_rate("24", 3.0) == "36"
    assert frame_rate("24", 0.5) == "24"
    assert frame_rate("24", 0.75) == "36"
    assert frame_rate("24000/1001") == "24000/1001"
    assert frame_rate("") == "30"


@needs_ffmpeg
@pytest.mark.parametrize(
    ("speed", "rate", "every"),
    [
        # Every frame once: nothing repeated.
        (1.0, "24", None),
        (1.25, "30", None),
        (3.0, "36", None),
        # Half speed: each frame shown twice, evenly.
        (0.5, "24", 2),
    ],
)
def test_compose_keeps_the_pace_of_the_clips(tmp_path, speed, rate, every):
    clip = moving_clip(tmp_path / "scene-01.mp4")
    output = tmp_path / "final.mp4"
    compose(FFMPEG, [Segment(path=clip, speed=speed)], output, lambda: None)
    found, moved = frames(output)
    assert found == rate
    still = [index for index, change in enumerate(moved) if not change]
    if every is None:
        assert still == []
    else:
        # Every `every`-th frame repeats the one before: evenly, all along.
        assert {b - a for a, b in zip(still, still[1:])} == {every}
        assert len(still) >= len(moved) // every - 1


@needs_ffmpeg
def test_a_trimmed_film_keeps_the_pace_of_its_clips(tmp_path):
    clips = [moving_clip(tmp_path / f"scene-{n}.mp4") for n in range(2)]
    output = tmp_path / "final.mp4"
    # Trimmed: re-encoded rather than copied.
    merge(FFMPEG, clips, output, lambda: None, cuts=[(0.5, None), (0.0, 1.5)])
    found, moved = frames(output)
    assert found == "24" and all(moved[:20])
