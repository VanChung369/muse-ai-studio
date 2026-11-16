"""Scenes joined with a dissolve: picture and sound overlap by exactly the
same amount at every join, so nothing drifts out of step; captions, titles
and music stay on the pieces they were placed on; and each scene's sound can
be levelled. Uses a real FFmpeg; skipped when none is installed."""

import array
import re
import subprocess

import pytest

from app.core.config import Settings
from app.rendering import timeline
from app.rendering.ffmpeg import (
    Caption,
    Segment,
    compose,
    film_time,
    find_ffmpeg,
    level_gains,
    overlaps,
    probe,
)

FFMPEG = find_ffmpeg(Settings())
needs_ffmpeg = pytest.mark.skipif(FFMPEG is None, reason="FFmpeg is not installed.")
FRAME = 1 / 30  # The film's frame rate.


def marked_clip(path, seconds=2.0, mark=1.0, beep=0.8, hum=0.02, sample_rate=44100):
    """A clip with a white flash and a beep that start together at `mark`."""
    flash = f"between(t,{mark},{mark + 0.124})"
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "lavfi", "-i",
            f"color=c=0x203040:s=320x180:r=24:d={seconds},"
            f"drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='{flash}'",
            "-f", "lavfi", "-i",
            f"aevalsrc='if(between(t,{mark},{mark + 0.06}),{beep}*sin(2*PI*1000*t),"
            f"{hum}*sin(2*PI*220*t))':s={sample_rate}:d={seconds}",
            "-shortest", "-pix_fmt", "yuv420p", str(path),
        ],  # fmt: skip
        check=True,
    )
    return path


def flashes(path):
    """When each white flash starts."""
    report = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-an",
            "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
            "-f", "null", "-",
        ],  # fmt: skip
        capture_output=True,
        text=True,
    ).stderr
    frames = zip(
        (float(value) for value in re.findall(r"pts_time:([0-9.]+)", report)),
        (float(value) for value in re.findall(r"YAVG=([0-9.]+)", report)),
    )
    starts, lit = [], False
    for time, brightness in frames:
        if brightness > 150 and not lit:
            starts.append(time)
        lit = brightness > 150
    return starts


def beeps(path):
    """When each beep starts (5 ms resolution)."""
    sound = subprocess.run(
        [
            FFMPEG, "-v", "error", "-i", str(path), "-vn",
            "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
        ],  # fmt: skip
        capture_output=True,
        check=True,
    ).stdout
    samples = array.array("h")
    samples.frombytes(sound)
    starts, loud = [], False
    for index in range(0, len(samples) - 40, 40):
        peak = max(abs(value) for value in samples[index : index + 40]) / 32768
        if peak > 0.3 and not loud:
            starts.append(index / 8000)
        loud = peak > 0.3
    return starts


def expected(count, length, overlap, mark):
    """Where the marks should land: each piece starts `overlap` earlier than
    the one before it would have."""
    return [index * (length - overlap) + mark for index in range(count)]


@needs_ffmpeg
@pytest.mark.parametrize("chunk", [24, 3])
def test_dissolve_overlaps_picture_and_sound_by_the_same_amount(tmp_path, monkeypatch, chunk):
    # chunk 3: a film of many pieces, built in parts and joined again.
    monkeypatch.setattr("app.rendering.ffmpeg.CHUNK", chunk)
    count, speed, transition = 7, 1.25, 0.3
    clips = [marked_clip(tmp_path / f"scene-{n}.mp4") for n in range(count)]
    output = tmp_path / "final.mp4"
    compose(
        FFMPEG,
        [Segment(path=path, speed=speed) for path in clips],
        output,
        lambda: None,
        transition=transition,
    )
    length = 2.0 / speed
    marks = expected(count, length, transition, 1.0 / speed)
    assert probe(FFMPEG, output).seconds == pytest.approx(
        count * length - (count - 1) * transition, abs=0.06
    )
    seen, heard = flashes(output), beeps(output)
    assert len(seen) == count and len(heard) == count
    for mark, flash, beep in zip(marks, seen, heard, strict=True):
        assert flash == pytest.approx(mark, abs=FRAME + 0.005)
        assert beep == pytest.approx(mark, abs=0.03)
        # Picture and sound in step, also in the last piece.
        assert abs(flash - beep) <= FRAME + 0.02


@needs_ffmpeg
def test_straight_cuts_are_unchanged_without_a_transition(tmp_path):
    clips = [marked_clip(tmp_path / f"scene-{n}.mp4") for n in range(3)]
    output = tmp_path / "final.mp4"
    compose(FFMPEG, [Segment(path=path) for path in clips], output, lambda: None)
    assert probe(FFMPEG, output).seconds == pytest.approx(6.0, abs=0.06)
    for mark, flash in zip(expected(3, 2.0, 0.0, 1.0), flashes(output), strict=True):
        assert flash == pytest.approx(mark, abs=FRAME + 0.005)


@needs_ffmpeg
def test_straight_cuts_keep_the_sound_in_step_with_the_picture(tmp_path):
    from app.rendering.ffmpeg import merge

    # Muse's clips carry 24 kHz AAC. Copying such streams end to end kept
    # each clip's encoder padding: the sound fell ~70 ms further behind the
    # picture at every join (+290 ms by scene 5, measured 2026-11-16).
    count = 7
    clips = [
        marked_clip(tmp_path / f"scene-{n}.mp4", sample_rate=24000) for n in range(count)
    ]
    output = tmp_path / "final.mp4"
    merge(FFMPEG, clips, output, lambda: None)
    seen, heard = flashes(output), beeps(output)
    assert len(seen) == count and len(heard) == count
    for flash, beep in zip(seen, heard, strict=True):
        assert abs(flash - beep) <= 1 / 24 + 0.01


@needs_ffmpeg
def test_captions_stay_on_their_piece_when_pieces_overlap(tmp_path):
    from app.rendering.ffmpeg import can_caption

    if not can_caption(FFMPEG):
        pytest.skip("This FFmpeg cannot draw captions.")
    clips = [marked_clip(tmp_path / f"scene-{n}.mp4", mark=1.5) for n in range(3)]
    output = tmp_path / "final.mp4"
    # Placed in the editor's time (pieces end to end): on the third piece,
    # 0.5 s in. In the film that piece starts 2 x 0.5 s earlier.
    compose(
        FFMPEG,
        [Segment(path=path) for path in clips],
        output,
        lambda: None,
        transition=0.5,
        captions=[Caption(start=4.5, end=5.0, text="BBBBBBBB")],
    )
    report = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-nostats", "-i", str(output), "-an",
            "-vf", "crop=iw:ih/3:0:ih*2/3,signalstats,metadata=print:key=lavfi.signalstats.YMAX",
            "-f", "null", "-",
        ],  # fmt: skip
        capture_output=True,
        text=True,
    ).stderr
    times = [float(value) for value in re.findall(r"pts_time:([0-9.]+)", report)]
    lit = [float(value) > 200 for value in re.findall(r"YMAX=([0-9.]+)", report)]
    shown = [time for time, on in zip(times, lit, strict=True) if on]
    # The third piece starts at 3.0 s in the film, so the caption shows at
    # 3.5-4.0 s, where nothing else is lit (flashes: 1.5, 3.0 and 4.5 s,
    # 0.12 s each). Left in the editor's time it would show at 4.5-5.0 s.
    assert any(abs(time - 3.7) < 0.1 for time in shown)
    assert not any(4.7 < time < 4.95 for time in shown)


def test_overlaps_never_take_more_than_half_of_a_piece():
    assert overlaps([8.0, 8.0, 8.0], 0.3) == [0.3, 0.3]
    # A short piece is shared by the joins on both its sides.
    assert overlaps([8.0, 0.4, 8.0], 0.3) == pytest.approx([0.2, 0.2])
    assert overlaps([8.0], 0.3) == []
    assert overlaps([8.0, 8.0], 0.0) == [0.0]


def test_a_span_across_a_join_covers_both_parts_and_never_reverses():
    from app.rendering.ffmpeg import film_span

    two, half = [8.0, 8.0], [0.5]
    # Up to the join: still the first piece, which plays until 8.0.
    assert film_span(two, half, 7.7, 8.0) == pytest.approx((7.7, 8.0))
    # Into the second piece: its first 0.2 s show at 7.5-7.7, under the dissolve.
    assert film_span(two, half, 7.7, 8.2) == pytest.approx((7.5, 8.0))
    assert film_span([2.0, 2.0, 2.0], [0.5, 0.5], 4.5, 5.0) == pytest.approx((3.5, 4.0))
    lengths, overlap = [3.0, 0.6, 3.0, 2.0], overlaps([3.0, 0.6, 3.0, 2.0], 0.5)
    ticks = [step / 10 for step in range(0, 90)]
    for start in ticks:
        for end in ticks:
            if end - start >= 0.2:
                low, high = film_span(lengths, overlap, start, end)
                assert high > low


@needs_ffmpeg
def test_levelling_stops_as_soon_as_it_is_cancelled(tmp_path):
    long = marked_clip(tmp_path / "long.mp4", seconds=20.0, beep=0.0, hum=0.3)
    calls = []

    class Stop(Exception):
        pass

    def cancelled():
        calls.append(1)
        if len(calls) > 1:
            raise Stop

    # One piece: cancelled while its sound is being measured, not after.
    with pytest.raises(Stop):
        level_gains(FFMPEG, [Segment(path=long)], cancelled)


def test_film_time_moves_each_piece_by_the_joins_before_it():
    lengths, overlap = [8.0, 8.0, 8.0], [0.3, 0.3]
    assert film_time(lengths, overlap, 4.0) == pytest.approx(4.0)
    assert film_time(lengths, overlap, 8.0) == pytest.approx(7.7)
    assert film_time(lengths, overlap, 20.0) == pytest.approx(19.4)
    assert film_time(lengths, overlap, 24.0) == pytest.approx(23.4)
    assert film_time(lengths, [0.0, 0.0], 20.0) == pytest.approx(20.0)


@needs_ffmpeg
def test_levelled_scenes_play_at_the_same_loudness(tmp_path):
    loud = marked_clip(tmp_path / "loud.mp4", seconds=3.0, beep=0.0, hum=0.5)
    quiet = marked_clip(tmp_path / "quiet.mp4", seconds=3.0, beep=0.0, hum=0.1)
    segments = [Segment(path=loud), Segment(path=quiet)]
    gains = level_gains(FFMPEG, segments)
    # About 14 dB apart: each is brought to the middle of the two.
    assert gains[0] < 1.0 < gains[1]
    output = tmp_path / "final.mp4"
    compose(
        FFMPEG,
        [Segment(path=loud, gain=gains[0]), Segment(path=quiet, gain=gains[1])],
        output,
        lambda: None,
    )

    def mean(start, seconds):
        report = subprocess.run(
            [
                FFMPEG, "-hide_banner", "-ss", str(start), "-t", str(seconds),
                "-i", str(output), "-af", "volumedetect", "-vn", "-f", "null", "-",
            ],  # fmt: skip
            capture_output=True,
            text=True,
        ).stderr
        return float(report.split("mean_volume:")[1].split("dB")[0])

    assert abs(mean(0.5, 2.0) - mean(3.5, 2.0)) < 1.0


def test_a_saved_edit_without_the_new_keys_still_cuts_straight():
    plain = timeline.Timeline()
    assert plain.output["transition"] == 0 and plain.output["level"] is False
    assert plain.plain
    assert not timeline.Timeline(output={**timeline.OUTPUT, "transition": 0.3}).plain
    assert not timeline.Timeline(output={**timeline.OUTPUT, "level": True}).plain
