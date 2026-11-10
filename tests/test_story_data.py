import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STORY_DIR = ROOT / "web/public/stories/gongitsune"


class TestStoryData(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        path = STORY_DIR / "story.json"
        cls.story = json.loads(path.read_text(encoding="utf-8"))

    def test_audio_file(self):
        audio = self.story["audio_file"]

        self.assertEqual(audio, "narration.mp3")
        self.assertTrue((STORY_DIR / audio).is_file())
        self.assertGreater((STORY_DIR / audio).stat().st_size, 0)

    def test_segment_count(self):
        self.assertEqual(len(self.story["segments"]), 168)

    def test_timestamps_and_emotions(self):
        segments = self.story["segments"]
        duration = float(self.story["duration_sec"])

        self.assertTrue(math.isfinite(duration))
        self.assertGreater(duration, 0)

        previous_end = 0.0

        for i, segment in enumerate(segments, start=1):
            with self.subTest(segment=i):
                start = float(segment["start_sec"])
                end = float(segment["end_sec"])

                self.assertTrue(math.isfinite(start))
                self.assertTrue(math.isfinite(end))

                self.assertGreaterEqual(start, previous_end - 0.001)
                self.assertGreater(end, start)
                self.assertLessEqual(end, duration + 0.001)

                self.assertTrue(segment["text"].strip())

                for field in ("reader_emotions", "writer_emotions"):
                    scores = segment[field]

                    self.assertIsInstance(scores, dict)
                    self.assertEqual(len(scores), 8)

                    for value in scores.values():
                        self.assertTrue(math.isfinite(float(value)))

                previous_end = end

        self.assertAlmostEqual(previous_end, duration, delta=0.001)


if __name__ == "__main__":
    unittest.main()
