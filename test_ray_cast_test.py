import json
import tempfile
import unittest
from pathlib import Path

import ray_cast_test as ray
from PIL import Image


class ColourMathTests(unittest.TestCase):
    def test_known_hsv_and_lab_boundaries(self):
        hue, saturation, value = ray.rgb_to_hsv((0, 255, 0))
        self.assertAlmostEqual(hue, 120.0, places=6)
        self.assertAlmostEqual(saturation, 1.0, places=6)
        self.assertAlmostEqual(value, 1.0, places=6)
        self.assertEqual(ray.rgb_to_lab((0, 0, 0)), (0.0, 0.0, 0.0))
        self.assertTrue(all(abs(a - b) < 0.01 for a, b in zip(ray.rgb_to_lab((255, 255, 255)), (100.0, 0.0, 0.0))))

    def test_delta_e_zero_and_symmetric(self):
        first = ray.rgb_to_lab((65, 128, 164))
        second = ray.rgb_to_lab((120, 100, 80))
        self.assertEqual(ray.delta_e_cie76(first, first), 0.0)
        self.assertAlmostEqual(ray.delta_e_cie76(first, second), ray.delta_e_cie76(second, first), places=12)

    def test_rgb_boundaries_are_clamped(self):
        self.assertEqual(ray.colour_details((-10, 260, 0))["rgb"], [0, 255, 0])


class ClassificationTests(unittest.TestCase):
    def sample(self, rgb):
        return ray.colour_details(rgb)

    def test_any_reference_can_match_and_disabled_is_ignored(self):
        config = ray.ClassifierConfig(
            references=(
                ray.ReferenceColor("disabled", (0, 0, 0), False),
                ray.ReferenceColor("harbour", (65, 128, 164), True),
            ),
            delta_e_tolerance=0,
        )
        result = ray.WaterClassifier(config).classify(self.sample((65, 128, 164)))
        self.assertEqual(result["class"], "water")
        self.assertEqual(result["matchedReferenceLabel"], "harbour")
        self.assertEqual(result["waterScore"], 1.0)

    def test_non_water_and_no_reference_are_distinct(self):
        non_water = ray.WaterClassifier(ray.ClassifierConfig((ray.ReferenceColor("water", (0, 0, 255)),), 5)).classify(self.sample((255, 0, 0)))
        unknown = ray.WaterClassifier(ray.ClassifierConfig()).classify(self.sample((255, 0, 0)))
        self.assertEqual(non_water["class"], "non-water")
        self.assertEqual(unknown, {"class": "unknown", "reason": "no-enabled-reference-colors"})

    def test_hsv_gate_supports_crossing_zero(self):
        config = ray.ClassifierConfig(
            references=(ray.ReferenceColor("red", (255, 0, 0)),),
            delta_e_tolerance=0,
            hsv_gate=ray.HSVGate(True, 350, 10, 0.5, 1.0, 0.5, 1.0),
        )
        self.assertEqual(ray.WaterClassifier(config).classify(self.sample((255, 0, 0)))["class"], "water")
        blue = ray.WaterClassifier(config).classify(self.sample((0, 0, 255)))
        self.assertEqual(blue["class"], "non-water")
        self.assertFalse(blue["hsvGatePassed"])

    def test_missing_tile_is_unknown_not_non_water(self):
        sample = {"rgb": None, "reason": "tile-unavailable"}
        result = ray.WaterClassifier(ray.ClassifierConfig((ray.ReferenceColor("water", (0, 0, 255)),))).classify(sample)
        self.assertEqual(result, {"class": "unknown", "reason": "tile-unavailable"})


class ProfileAndRenderTests(unittest.TestCase):
    def test_cached_tile_produces_sample_colour(self):
        scene = ray.load_scene(Path("testdata/camera-scene-minimal.json"))
        with tempfile.TemporaryDirectory() as directory:
            tile_path = Path(directory) / "1" / "1"
            tile_path.mkdir(parents=True)
            Image.new("RGB", (256, 256), (65, 128, 164)).save(tile_path / "0.png")
            results = ray.run_pipeline(
                scene,
                (4, 2),
                Path(directory),
                allow_download=False,
                config=ray.ClassifierConfig((ray.ReferenceColor("harbour", (65, 128, 164)),), 0),
            )
        valid_samples = [result["sample"] for result in results if result["sample"].get("rgb")]
        self.assertTrue(valid_samples)
        self.assertEqual(valid_samples[0]["rgb"], [65, 128, 164])

    def test_profile_round_trip_and_forbidden_fields(self):
        config = ray.ClassifierConfig(
            references=(ray.ReferenceColor("港池深水", (65, 128, 164), True),),
            delta_e_tolerance=20,
            sample_neighborhood=5,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.json"
            ray.save_profile(path, config, "nlscPhoto")
            profile, loaded = ray.load_profile(path)
        self.assertEqual(profile["schemaVersion"], ray.PROFILE_SCHEMA)
        self.assertEqual(loaded.references, config.references)
        self.assertEqual(loaded.sample_neighborhood, 5)
        with self.assertRaises(ray.ProfileError):
            ray.profile_to_config({"schemaVersion": ray.PROFILE_SCHEMA, "references": [], "classifier": {}, "token": "nope"})

    def test_reclassification_does_not_replace_geometry_or_sample(self):
        results = [{
            "geometry": {"gridIndex": {"x": 0, "y": 0}, "status": "valid"},
            "sample": ray.colour_details((65, 128, 164)),
            "classification": None,
        }]
        geometry_before = json.dumps(results[0]["geometry"], sort_keys=True)
        sample_before = json.dumps(results[0]["sample"], sort_keys=True)
        ray.classify_results(results, ray.ClassifierConfig((ray.ReferenceColor("water", (65, 128, 164)),), 0))
        ray.classify_results(results, ray.ClassifierConfig((ray.ReferenceColor("water", (255, 0, 0)),), 0))
        self.assertEqual(json.dumps(results[0]["geometry"], sort_keys=True), geometry_before)
        self.assertEqual(json.dumps(results[0]["sample"], sort_keys=True), sample_before)
        self.assertEqual(results[0]["classification"]["class"], "non-water")


if __name__ == "__main__":
    unittest.main()
