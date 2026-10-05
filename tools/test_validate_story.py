import copy
import json
import unittest
from pathlib import Path

from tools.validate_story import validate


class StoryValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        content_path = Path(__file__).parents[1] / "content" / "story" / "arrival.json"
        gameplay_path = Path(__file__).parents[1] / "content" / "data" / "gameplay.json"
        cls.story = json.loads(content_path.read_text(encoding="utf-8"))
        cls.gameplay = json.loads(gameplay_path.read_text(encoding="utf-8"))

    def test_sample_story_is_valid(self):
        self.assertEqual(validate(self.story), [])

    def test_missing_target_and_unreachable_node_are_reported(self):
        story = copy.deepcopy(self.story)
        story["nodes"]["village_notice"]["choices"][0]["next"] = "missing"
        errors = validate(story)
        self.assertTrue(any("missing" in error for error in errors))
        self.assertTrue(any("unreachable" in error for error in errors))

    def test_unsupported_effect_is_reported(self):
        story = copy.deepcopy(self.story)
        story["nodes"]["village_notice"]["choices"][0]["effects"][0]["type"] = "runJavaScript"
        self.assertTrue(any("unknown rule type" in error for error in validate(story)))

    def test_missing_gameplay_reference_is_reported(self):
        story = copy.deepcopy(self.story)
        story["nodes"]["village_notice"]["choices"][0]["effects"][1]["itemId"] = "missing_item"
        self.assertTrue(any("missing_item" in error for error in validate(story, self.gameplay)))


if __name__ == "__main__":
    unittest.main()
