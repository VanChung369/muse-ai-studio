"""Merging with a real FFmpeg binary; skipped when none is installed."""

import subprocess

import pytest

from app.core.config import Settings
from app.rendering.ffmpeg import (
    MergeError,
    find_ffmpeg,
    last_frame,
    merge,
    probe,
    thumbnail,
)

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
def test_cuts_keep_only_part_of_each_clip(tmp_path):
    clips = [
        clip(tmp_path / "scene-01.mp4", 3, "red"),
        clip(tmp_path / "scene-02.mp4", 2, "blue"),
    ]
    output = tmp_path / "final.mp4"
    # One second from the middle of the first clip, then all of the second.
    merge(FFMPEG, clips, output, lambda: None, cuts=[(1.0, 2.0), (0.0, None)])
    assert 2.7 < probe(FFMPEG, output).seconds < 3.4
    # A cut longer than its clip is fitted to it.
    merge(FFMPEG, clips, output, lambda: None, cuts=[(2.5, 9.0), (0.0, 1.0)])
    assert 1.2 < probe(FFMPEG, output).seconds < 1.9


@needs_ffmpeg
def test_muted_merge_has_no_audio_track(tmp_path):
    clips = [
        clip(tmp_path / "scene-01.mp4", 1, "red"),
        clip(tmp_path / "scene-02.mp4", 1, "blue"),
    ]
    output = tmp_path / "final.mp4"
    merge(FFMPEG, clips, output, lambda: None, mute=True)
    merged = probe(FFMPEG, output)
    assert 1.7 < merged.seconds < 2.4 and not merged.has_audio


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


@needs_ffmpeg
def test_thumbnail_is_a_small_jpeg(tmp_path):
    target = tmp_path / "stills" / "scene-01.jpg"
    assert thumbnail(FFMPEG, clip(tmp_path / "scene-01.mp4", 2, "red"), target)
    assert target.read_bytes()[:3] == b"\xff\xd8\xff"
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    assert not thumbnail(FFMPEG, broken, tmp_path / "broken.jpg")
    assert not (tmp_path / "broken.jpg").exists()
    assert not list(tmp_path.glob("*.part.jpg"))


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


def still(path, color="green", size="640x360"):
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error", "-f", "lavfi",
            "-i", f"color=c={color}:s={size}", "-frames:v", "1", str(path),
        ],  # fmt: skip
        check=True,
    )
    return path


def tone(path, seconds, frequency=660):
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error", "-f", "lavfi",
            "-i", f"sine=frequency={frequency}:duration={seconds}", str(path),
        ],  # fmt: skip
        check=True,
    )
    return path


def loudness(path, start, seconds):
    """Mean volume in dB of a stretch of the file's sound."""
    report = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-ss", str(start), "-t", str(seconds),
            "-i", str(path), "-af", "volumedetect", "-vn", "-f", "null", "-",
        ],  # fmt: skip
        capture_output=True,
        text=True,
    ).stderr
    return float(report.split("mean_volume:")[1].split("dB")[0])


@needs_ffmpeg
def test_compose_joins_clips_stills_and_changes_speed(tmp_path):
    from app.rendering.ffmpeg import Segment, compose

    scene = clip(tmp_path / "scene-01.mp4", 4, "red")
    output = tmp_path / "final.mp4"
    compose(
        FFMPEG,
        [
            # Two seconds of the clip at double speed: one second of film.
            Segment(scene, start=1.0, end=3.0, speed=2.0),
            Segment(still(tmp_path / "logo.png"), end=1.5, still=True),
            Segment(still(tmp_path / "photo.jpg", "blue", "300x500"), end=1.0, still=True),
            Segment(still(tmp_path / "card.webp", "white"), end=0.5, still=True),
            # One second at half speed: two seconds of film.
            Segment(scene, start=0.0, end=1.0, speed=0.5),
        ],
        output,
        lambda: None,
    )
    made = probe(FFMPEG, output)
    assert 5.7 < made.seconds < 6.4
    # The film keeps the first clip's frame; other shapes are fitted into it.
    assert (made.width, made.height, made.has_audio) == (320, 180, True)
    assert not list(tmp_path.glob("*.part.mp4"))


@needs_ffmpeg
def test_compose_lays_soundtracks_over_the_film(tmp_path):
    from app.rendering.ffmpeg import Segment, Soundtrack, compose

    scene = clip(tmp_path / "scene-01.mp4", 6, "red")
    music = tone(tmp_path / "music.mp3", 1)
    output = tmp_path / "final.mp4"
    # Muted scenes, music from second 3 on, repeated to the film's end.
    compose(
        FFMPEG,
        [Segment(scene)],
        output,
        lambda: None,
        mute=True,
        soundtracks=[Soundtrack(music, offset=3.0, loop=True)],
    )
    made = probe(FFMPEG, output)
    assert 5.7 < made.seconds < 6.4 and made.has_audio
    assert loudness(output, 0.5, 2) < -60  # Nothing before the music starts.
    assert loudness(output, 3.2, 1) > -40

    # Without a soundtrack a muted film has no audio track at all.
    compose(FFMPEG, [Segment(scene, speed=2.0)], output, lambda: None, mute=True)
    made = probe(FFMPEG, output)
    assert 2.7 < made.seconds < 3.4 and not made.has_audio

    # A track that is not audio is refused rather than skipped.
    with pytest.raises(MergeError):
        compose(
            FFMPEG, [Segment(scene)], output, lambda: None,
            soundtracks=[Soundtrack(still(tmp_path / "x.png"))],
        )  # fmt: skip


@needs_ffmpeg
def test_compose_draws_captions(tmp_path):
    from app.rendering.ffmpeg import Caption, Segment, can_caption, caption_text, compose

    captions = [
        Caption(2.0, 3.5, "Sương sớm trên đồi Cầu Đất"),
        Caption(0.0, 1.5, "Dòng một\n\n{\an8}dòng hai"),
    ]
    assert caption_text(captions) == (
        "1\n00:00:00,000 --> 00:00:01,500\nDòng một\n(\an8)dòng hai\n\n"
        "2\n00:00:02,000 --> 00:00:03,500\nSương sớm trên đồi Cầu Đất\n"
    )
    if not can_caption(FFMPEG):
        pytest.skip("This FFmpeg has no caption renderer.")
    scene = clip(tmp_path / "scene-01.mp4", 4, "black")
    plain, drawn = tmp_path / "plain.mp4", tmp_path / "drawn.mp4"
    compose(FFMPEG, [Segment(scene)], plain, lambda: None)
    compose(FFMPEG, [Segment(scene)], drawn, lambda: None, captions=captions)
    assert 3.7 < probe(FFMPEG, drawn).seconds < 4.4

    def frame(path):
        return subprocess.run(
            [
                FFMPEG, "-v", "error", "-ss", "2.5", "-i", str(path),
                "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
            ],  # fmt: skip
            capture_output=True,
        ).stdout

    # White letters on a black picture: only the captioned film has any.
    assert max(frame(plain)) < 60 < max(frame(drawn))


@needs_ffmpeg
def test_inspect_reads_each_kind_of_media(tmp_path):
    from app.rendering.ffmpeg import inspect

    video = inspect(FFMPEG, clip(tmp_path / "a.mp4", 2, "red"))
    assert (video.width, video.height, video.has_audio) == (320, 180, True)
    assert 1.7 < video.seconds < 2.4
    picture = inspect(FFMPEG, still(tmp_path / "a.png"))
    assert (picture.width, picture.height, picture.has_audio) == (640, 360, False)
    audio = inspect(FFMPEG, tone(tmp_path / "a.wav", 3))
    assert audio.width is None and audio.has_audio and 2.7 < audio.seconds < 3.4
    (tmp_path / "notes.txt").write_text("not media")
    with pytest.raises(MergeError):
        inspect(FFMPEG, tmp_path / "notes.txt")


@needs_ffmpeg
def test_extract_audio_keeps_only_the_sound(tmp_path):
    from app.rendering.ffmpeg import extract_audio, inspect

    source = clip(tmp_path / "music-clip.mp4", 3, "black")
    target = tmp_path / "music.m4a"
    extract_audio(FFMPEG, source, target)
    sound = inspect(FFMPEG, target)
    assert sound.width is None and sound.has_audio and 2.7 < sound.seconds < 3.4
    assert not list(tmp_path.glob("*.part.*"))
    # A clip without a soundtrack has nothing to keep.
    silent = tmp_path / "silent.mp4"
    subprocess.run(
        [FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=1", str(silent)],
        check=True,
    )
    with pytest.raises(MergeError):
        extract_audio(FFMPEG, silent, tmp_path / "none.m4a")
    assert not (tmp_path / "none.m4a").exists()


@needs_ffmpeg
def test_captions_follow_their_style(tmp_path):
    from app.rendering.ffmpeg import (
        Caption,
        CaptionStyle,
        Segment,
        can_caption,
        caption_script,
        compose,
    )

    style = CaptionStyle(size=0.1, color="#FFE000", position="top", bold=True)
    script = caption_script(
        [Caption(1.0, 2.5, "Dòng {một}\nC:" + chr(92) + "hai")], style, 320, 180
    )
    # Size in the film's pixels, yellow letters (blue, green, red), top centre.
    assert "PlayResY: 180" in script and "Style: Default,Arial,18,&H0000E0FF," in script
    assert ",8,16,16,11,1\n" in script
    # A line break is written as backslash-N; other backslashes are replaced.
    line = "Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Dòng (một)"
    assert line + chr(92) + "NC:/hai\n" in script
    if not can_caption(FFMPEG):
        pytest.skip("This FFmpeg has no caption renderer.")

    scene = clip(tmp_path / "scene-01.mp4", 3, "black")
    output = tmp_path / "final.mp4"
    compose(
        FFMPEG, [Segment(scene)], output, lambda: None,
        captions=[Caption(0.0, 3.0, "MMMMMMMM")], caption_style=style,
    )  # fmt: skip
    frame = subprocess.run(
        [
            FFMPEG, "-v", "error", "-ss", "1", "-i", str(output),
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],  # fmt: skip
        capture_output=True,
    ).stdout
    rows = [frame[row * 320 * 3 : (row + 1) * 320 * 3] for row in range(180)]
    top, bottom = b"".join(rows[:60]), b"".join(rows[120:])
    # Letters in the top third only, and yellow: red and green without blue.
    assert max(top) > 180 and max(bottom) < 60
    brightest = max(range(0, len(top), 3), key=lambda at: top[at] + top[at + 1])
    assert top[brightest] > 180 and top[brightest + 1] > 150 and top[brightest + 2] < 110

    # A box behind the words darkens nothing on black but still draws them.
    compose(
        FFMPEG, [Segment(scene)], output, lambda: None,
        captions=[Caption(0.0, 3.0, "MMMM")], caption_style=CaptionStyle(box=True),
    )  # fmt: skip
    assert 2.7 < probe(FFMPEG, output).seconds < 3.4


@needs_ffmpeg
def test_waveform_draws_the_sound_of_a_file(tmp_path):
    from app.rendering.ffmpeg import inspect, waveform

    drawing = tmp_path / "song.wave.png"
    assert waveform(FFMPEG, tone(tmp_path / "song.mp3", 2), drawing)
    picture = inspect(FFMPEG, drawing)
    assert (picture.width, picture.height) == (1600, 96)
    # A picture has no sound to draw.
    assert not waveform(FFMPEG, still(tmp_path / "logo.png"), tmp_path / "none.png")
    assert not (tmp_path / "none.png").exists()
