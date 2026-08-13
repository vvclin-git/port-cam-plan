#!/usr/bin/env python3
"""Ray-casting tile colour sampler and local water-classification tool.

The module is intentionally self-contained.  It accepts the camera-scene/1.1
JSON emitted by the planning page, keeps geometry and sampled colours in
memory, and lets the Tk UI reclassify those samples without doing ray casting
or downloading tiles again.

This is a verification aid, not a survey-grade land/water classifier.
"""

from __future__ import annotations

import argparse
import colorsys
import copy
import json
import math
import os
import queue
import statistics
import sys
import tempfile
import threading
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

try:
    from PIL import Image
    try:
        from PIL import ImageTk
    except ImportError:  # Tk is only needed by --ui, not by CLI/export use
        ImageTk = None  # type: ignore[assignment]
except ImportError:  # pragma: no cover - exercised by the clear CLI error
    Image = None  # type: ignore[assignment]
    ImageTk = None  # type: ignore[assignment]


SCENE_SCHEMA = "camera-scene/1.1"
PROFILE_SCHEMA = "water-color-profile/1.0"
EARTH_RADIUS_M = 6_378_137.0
WEB_MERCATOR_MAX_LAT = 85.0511287798
DEFAULT_GRID = (160, 90)
DEFAULT_NEIGHBORHOOD = 3
DEFAULT_TOLERANCE = 20.0
DEFAULT_OVERLAY_OPACITY = 0.65

STATUS_COLORS = {
    "no-intersection": (135, 206, 235),       # sky blue
    "max-distance": (142, 68, 173),           # purple
    "tile-unavailable": (214, 55, 64),       # red
    "tile-not-in-manifest": (242, 201, 76),  # yellow
    "image-decode-error": (214, 55, 64),
    "unknown": (64, 64, 64),
}
CLASS_COLORS = {
    "water": (36, 126, 190),
    "non-water": (133, 116, 91),
    "unknown": (64, 64, 64),
}
FORBIDDEN_PROFILE_KEYS = {
    "cookie", "cookies", "token", "tokens", "credential", "credentials",
    "authorization", "password", "secret", "privatekey", "private_key",
    "image", "images", "tiledata", "tile_data", "tilebytes", "tile_bytes",
}


class SceneError(ValueError):
    """Raised for unsupported or malformed Camera Scene files."""


class ProfileError(ValueError):
    """Raised for unsupported or unsafe colour profiles."""


def require_pillow() -> None:
    if Image is None:
        raise RuntimeError("Pillow is required. Install it with: python -m pip install Pillow")


def finite(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SceneError(f"{name} must be a finite number")
    return float(value)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_grid(value: str) -> tuple[int, int]:
    try:
        width_text, height_text = value.lower().split("x", 1)
        width, height = int(width_text), int(height_text)
    except (ValueError, AttributeError):
        raise ValueError("grid must use WIDTHxHEIGHT, for example 160x90") from None
    if width <= 0 or height <= 0 or width * height > 1_000_000:
        raise ValueError("grid dimensions must be positive and contain at most 1,000,000 rays")
    return width, height


def parse_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().replace(" ", "")
    if text.startswith("#") and len(text) == 7:
        text = ",".join(str(int(text[index:index + 2], 16)) for index in (1, 3, 5))
    try:
        channels = tuple(int(part) for part in text.split(","))
    except ValueError:
        raise ValueError("RGB must be R,G,B or #RRGGBB") from None
    if len(channels) != 3 or any(channel < 0 or channel > 255 for channel in channels):
        raise ValueError("RGB channels must be in the range 0..255")
    return channels  # type: ignore[return-value]


def rgb_to_hsv(rgb: Iterable[int | float]) -> tuple[float, float, float]:
    channels = tuple(clamp(float(channel), 0.0, 255.0) / 255.0 for channel in rgb)
    if len(channels) != 3:
        raise ValueError("RGB must contain exactly three channels")
    hue, saturation, value = colorsys.rgb_to_hsv(*channels)
    return hue * 360.0, saturation, value


def _srgb_to_linear(channel: float) -> float:
    value = clamp(channel, 0.0, 255.0) / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def rgb_to_lab(rgb: Iterable[int | float]) -> tuple[float, float, float]:
    values = tuple(_srgb_to_linear(float(channel)) for channel in rgb)
    if len(values) != 3:
        raise ValueError("RGB must contain exactly three channels")
    red, green, blue = values
    x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) * 100.0
    y = (red * 0.2126729 + green * 0.7151522 + blue * 0.0721750) * 100.0
    z = (red * 0.0193339 + green * 0.1191920 + blue * 0.9503041) * 100.0
    x /= 95.047
    y /= 100.000
    z /= 108.883

    def lab_curve(value: float) -> float:
        epsilon = 216.0 / 24_389.0
        kappa = 24_389.0 / 27.0
        return value ** (1.0 / 3.0) if value > epsilon else (kappa * value + 16.0) / 116.0

    fx, fy, fz = lab_curve(x), lab_curve(y), lab_curve(z)
    return 116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)


def delta_e_cie76(first: Iterable[float], second: Iterable[float]) -> float:
    a = tuple(float(value) for value in first)
    b = tuple(float(value) for value in second)
    if len(a) != 3 or len(b) != 3:
        raise ValueError("CIELAB values must contain exactly three channels")
    return math.sqrt(sum((left - right) ** 2 for left, right in zip(a, b)))


def colour_details(rgb: Iterable[int | float]) -> dict[str, Any]:
    channels = tuple(int(round(clamp(float(channel), 0.0, 255.0))) for channel in rgb)
    return {
        "rgb": list(channels),
        "hsv": list(rgb_to_hsv(channels)),
        "lab": list(rgb_to_lab(channels)),
    }


@dataclass(frozen=True)
class HSVGate:
    enabled: bool = False
    hue_min_deg: float = 0.0
    hue_max_deg: float = 360.0
    saturation_min: float = 0.0
    saturation_max: float = 1.0
    value_min: float = 0.0
    value_max: float = 1.0

    def contains(self, hsv: Iterable[float]) -> bool:
        hue, saturation, value = tuple(float(item) for item in hsv)
        hue_min = clamp(self.hue_min_deg, 0.0, 360.0)
        hue_max = clamp(self.hue_max_deg, 0.0, 360.0)
        if hue_min <= hue_max:
            hue_ok = hue_min <= hue <= hue_max
        else:
            hue_ok = hue >= hue_min or hue <= hue_max
        return (
            hue_ok
            and clamp(self.saturation_min, 0.0, 1.0) <= saturation <= clamp(self.saturation_max, 0.0, 1.0)
            and clamp(self.value_min, 0.0, 1.0) <= value <= clamp(self.value_max, 0.0, 1.0)
        )


@dataclass(frozen=True)
class ReferenceColor:
    label: str
    rgb: tuple[int, int, int]
    enabled: bool = True

    @property
    def hsv(self) -> tuple[float, float, float]:
        return rgb_to_hsv(self.rgb)

    @property
    def lab(self) -> tuple[float, float, float]:
        return rgb_to_lab(self.rgb)


@dataclass(frozen=True)
class ClassifierConfig:
    references: tuple[ReferenceColor, ...] = ()
    delta_e_tolerance: float = DEFAULT_TOLERANCE
    hsv_gate: HSVGate = field(default_factory=HSVGate)
    sample_neighborhood: int = DEFAULT_NEIGHBORHOOD
    render_mode: str = "overlay"
    overlay_opacity: float = DEFAULT_OVERLAY_OPACITY

    @property
    def enabled_references(self) -> tuple[ReferenceColor, ...]:
        return tuple(reference for reference in self.references if reference.enabled)


class WaterClassifier:
    def __init__(self, config: ClassifierConfig):
        self.config = config
        self._reference_labs = [(reference, reference.lab) for reference in config.enabled_references]

    def classify(self, sample: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not sample or not sample.get("rgb"):
            reason = (sample or {}).get("reason", "no-sample")
            return {"class": "unknown", "reason": reason}
        if not self._reference_labs:
            return {"class": "unknown", "reason": "no-enabled-reference-colors"}

        lab = tuple(float(value) for value in sample["lab"])
        hsv = tuple(float(value) for value in sample["hsv"])
        distances = [
            (delta_e_cie76(lab, reference_lab), reference)
            for reference, reference_lab in self._reference_labs
        ]
        minimum_delta_e, matched_reference = min(distances, key=lambda item: item[0])
        tolerance = clamp(float(self.config.delta_e_tolerance), 0.0, 100.0)
        if tolerance == 0.0:
            score = 1.0 if minimum_delta_e == 0.0 else 0.0
        else:
            score = clamp(1.0 - minimum_delta_e / tolerance, 0.0, 1.0)
        gate_passed = not self.config.hsv_gate.enabled or self.config.hsv_gate.contains(hsv)
        class_name = "water" if minimum_delta_e <= tolerance and gate_passed else "non-water"
        return {
            "class": class_name,
            "minimumDeltaE": minimum_delta_e,
            "matchedReferenceLabel": matched_reference.label,
            "hsvGatePassed": gate_passed,
            "waterScore": score,
        }


def _required_mapping(data: Any, name: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise SceneError(f"{name} must be an object")
    return data


def validate_scene(scene: dict[str, Any]) -> None:
    if not isinstance(scene, dict) or scene.get("schemaVersion") != SCENE_SCHEMA:
        raise SceneError(f"unsupported scene schema; expected {SCENE_SCHEMA}")
    camera = _required_mapping(scene.get("camera"), "camera")
    position = _required_mapping(camera.get("position"), "camera.position")
    orientation = _required_mapping(camera.get("orientation"), "camera.orientation")
    image = _required_mapping(scene.get("image"), "image")
    optics = _required_mapping(scene.get("optics"), "optics")
    tile_source = _required_mapping(scene.get("tileSource"), "tileSource")
    tile_selection = _required_mapping(scene.get("tileSelection"), "tileSelection")
    for name in ("latitudeDeg", "longitudeDeg", "heightM"):
        finite(position.get(name), f"camera.position.{name}")
    finite(orientation.get("headingDeg"), "camera.orientation.headingDeg")
    finite(orientation.get("tiltDownDeg"), "camera.orientation.tiltDownDeg")
    for name in ("widthPx", "heightPx"):
        value = image.get(name)
        if not isinstance(value, int) or value <= 0:
            raise SceneError(f"image.{name} must be a positive integer")
    for name in ("sensorWidthMm", "sensorHeightMm", "focalLengthMm"):
        if finite(optics.get(name), f"optics.{name}") <= 0:
            raise SceneError(f"optics.{name} must be positive")
    if not isinstance(tile_source.get("id"), str) or not tile_source.get("urlTemplate"):
        raise SceneError("tileSource.id and tileSource.urlTemplate are required")
    zoom = tile_selection.get("zoom")
    if not isinstance(zoom, int) or zoom < 0:
        raise SceneError("tileSelection.zoom must be a non-negative integer")
    if not isinstance(tile_selection.get("tiles"), list):
        raise SceneError("tileSelection.tiles must be an array")
    for tile in tile_selection["tiles"]:
        if not isinstance(tile, dict) or not all(isinstance(tile.get(key), int) for key in ("z", "x", "y")):
            raise SceneError("each tile must contain integer z, x and y")


def load_scene(path: Path) -> dict[str, Any]:
    try:
        scene = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SceneError(f"could not read scene: {exc}") from exc
    validate_scene(scene)
    return scene


def longitude_to_tile_x(longitude: float, zoom: int) -> int:
    n = 2 ** zoom
    wrapped = ((longitude + 180.0) % 360.0 + 360.0) % 360.0
    return min(n - 1, max(0, int(math.floor(wrapped / 360.0 * n))))


def latitude_to_tile_y(latitude: float, zoom: int) -> int:
    n = 2 ** zoom
    latitude = clamp(latitude, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT)
    radians = math.radians(latitude)
    normalized = (1.0 - math.log(math.tan(radians) + 1.0 / math.cos(radians)) / math.pi) / 2.0
    return min(n - 1, max(0, int(math.floor(normalized * n))))


def tile_x_to_longitude(x: int, zoom: int) -> float:
    return x / (2 ** zoom) * 360.0 - 180.0


def tile_y_to_latitude(y: int, zoom: int) -> float:
    return math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / (2 ** zoom)))))


def expand_tile_url(template: str, z: int, x: int, y: int) -> str:
    return template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


def tile_bounds(z: int, x: int, y: int) -> dict[str, float]:
    return {
        "west": tile_x_to_longitude(x, z),
        "south": tile_y_to_latitude(y + 1, z),
        "east": tile_x_to_longitude(x + 1, z),
        "north": tile_y_to_latitude(y, z),
    }


def build_tile_manifest(scene: dict[str, Any], zoom: int) -> list[dict[str, Any]]:
    selection = scene.get("tileSelection", {})
    footprint = selection.get("footprint")
    source = scene["tileSource"]
    if not footprint or footprint.get("type") != "Polygon":
        return []
    coordinates = footprint.get("coordinates")
    if not coordinates or not coordinates[0]:
        return []
    points = coordinates[0]
    projected = [(longitude_to_tile_x(float(point[0]), zoom), latitude_to_tile_y(float(point[1]), zoom)) for point in points]
    n = 2 ** zoom
    padding = int(selection.get("paddingTiles", 1))
    min_x = max(0, min(point[0] for point in projected) - padding)
    max_x = min(n - 1, max(point[0] for point in projected) + padding)
    min_y = max(0, min(point[1] for point in projected) - padding)
    max_y = min(n - 1, max(point[1] for point in projected) + padding)
    return [
        {
            "z": zoom,
            "x": x,
            "y": y,
            "url": expand_tile_url(source["urlTemplate"], zoom, x, y),
            "bounds": tile_bounds(zoom, x, y),
        }
        for y in range(min_y, max_y + 1)
        for x in range(min_x, max_x + 1)
    ]


def scene_for_run(scene: dict[str, Any], zoom: Optional[int]) -> dict[str, Any]:
    result = copy.deepcopy(scene)
    if zoom is not None:
        source = result["tileSource"]
        minimum = int(source.get("minZoom", 0))
        maximum = int(source.get("maxZoom", 22))
        if zoom < minimum or zoom > maximum:
            raise SceneError(f"tile zoom must be between {minimum} and {maximum}")
        result["tileSelection"]["zoom"] = zoom
        result["tileSelection"]["tiles"] = build_tile_manifest(result, zoom)
    return result


def destination_from_local_meters(latitude: float, longitude: float, east_m: float, north_m: float) -> tuple[float, float]:
    distance = math.hypot(east_m, north_m)
    if distance == 0.0:
        return latitude, longitude
    bearing = math.atan2(east_m, north_m)
    angular_distance = distance / EARTH_RADIUS_M
    lat1 = math.radians(latitude)
    lon1 = math.radians(longitude)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular_distance)
        + math.cos(lat1) * math.sin(angular_distance) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(angular_distance) * math.cos(lat1),
        math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), (math.degrees(lon2) + 540.0) % 360.0 - 180.0


def ray_direction(scene: dict[str, Any], image_x: float, image_y: float) -> tuple[float, float, float]:
    camera = scene["camera"]
    optics = scene["optics"]
    image = scene["image"]
    sensor_width = float(optics["sensorWidthMm"])
    sensor_height = float(optics["sensorHeightMm"])
    focal = float(optics["focalLengthMm"])
    width = float(image["widthPx"])
    height = float(image["heightPx"])
    principal = image.get("principalPointPx") or {"x": width / 2.0, "y": height / 2.0}
    fx = focal / sensor_width * width
    fy = focal / sensor_height * height
    dx = (image_x + 0.5 - float(principal["x"])) / fx
    dy = (image_y + 0.5 - float(principal["y"])) / fy
    norm = math.sqrt(dx * dx + dy * dy + 1.0)
    dx, dy = dx / norm, dy / norm
    heading = math.radians(float(camera["orientation"]["headingDeg"]))
    tilt = math.radians(float(camera["orientation"]["tiltDownDeg"]))
    east_forward, north_forward = math.sin(heading), math.cos(heading)
    east_right, north_right = math.cos(heading), -math.sin(heading)
    # Camera frame is right (+X), down (+Y), forward (+Z).  At zero tilt,
    # camera down is world down; positive tilt pitches forward toward ground.
    east_down = east_forward * math.sin(tilt)
    north_down = north_forward * math.sin(tilt)
    up_down = -math.cos(tilt)
    east_fwd = east_forward * math.cos(tilt)
    north_fwd = north_forward * math.cos(tilt)
    up_fwd = -math.sin(tilt)
    east = dx * east_right + dy * east_down + east_fwd
    north = dx * north_right + dy * north_down + north_fwd
    up = dy * up_down + up_fwd
    final_norm = math.sqrt(east * east + north * north + up * up)
    return east / final_norm, north / final_norm, up / final_norm


def build_geometry_results(scene: dict[str, Any], grid: tuple[int, int], progress: Optional[Callable[[str, int, int], None]] = None) -> list[dict[str, Any]]:
    width, height = grid
    image_width = float(scene["image"]["widthPx"])
    image_height = float(scene["image"]["heightPx"])
    camera_position = scene["camera"]["position"]
    camera_latitude = float(camera_position["latitudeDeg"])
    camera_longitude = float(camera_position["longitudeDeg"])
    camera_height = float(camera_position["heightM"])
    maximum_distance = float(scene.get("tileSelection", {}).get("maximumRayDistanceM", 30_000.0))
    zoom = int(scene["tileSelection"]["zoom"])
    results: list[dict[str, Any]] = []
    total = width * height
    for grid_y in range(height):
        for grid_x in range(width):
            image_x = (grid_x + 0.5) * image_width / width - 0.5
            image_y = (grid_y + 0.5) * image_height / height - 0.5
            east, north, up = ray_direction(scene, image_x, image_y)
            geometry: dict[str, Any] = {
                "gridIndex": {"x": grid_x, "y": grid_y},
                "imagePixel": {"x": image_x, "y": image_y},
                "rayDirection": [east, north, up],
                "groundIntersection": None,
                "geographicCoordinate": None,
                "tile": None,
                "status": "no-intersection",
            }
            if up < -1e-12:
                distance = camera_height / -up
                east_m, north_m = east * distance, north * distance
                latitude, longitude = destination_from_local_meters(
                    camera_latitude, camera_longitude, east_m, north_m
                )
                tile_x = longitude_to_tile_x(longitude, zoom)
                tile_y = latitude_to_tile_y(latitude, zoom)
                geometry["groundIntersection"] = {
                    "eastM": east_m,
                    "northM": north_m,
                    "distanceM": distance,
                }
                geometry["geographicCoordinate"] = {"latitudeDeg": latitude, "longitudeDeg": longitude}
                geometry["tile"] = {"z": zoom, "x": tile_x, "y": tile_y}
                geometry["status"] = "valid" if distance <= maximum_distance else "max-distance"
            results.append({"geometry": geometry, "sample": None, "classification": None})
            if progress and (len(results) == total or len(results) % max(1, total // 100) == 0):
                progress("ray casting", len(results), total)
    return results


@dataclass(frozen=True)
class TileKey:
    z: int
    x: int
    y: int


class TileCache:
    def __init__(self, cache_path: Path):
        require_pillow()
        self.cache_path = cache_path
        self.images: dict[TileKey, Any] = {}
        self._lock = threading.Lock()

    def path_for(self, key: TileKey) -> Path:
        return self.cache_path / str(key.z) / str(key.x) / f"{key.y}.png"

    def _decode(self, payload: bytes) -> Any:
        require_pillow()
        from io import BytesIO
        with Image.open(BytesIO(payload)) as image:
            return image.convert("RGB")

    def get(self, tile: dict[str, Any], allow_download: bool) -> tuple[Any, str]:
        key = TileKey(int(tile["z"]), int(tile["x"]), int(tile["y"]))
        with self._lock:
            if key in self.images:
                return self.images[key], "ok"
        path = self.path_for(key)
        if path.exists():
            try:
                image = self._decode(path.read_bytes())
            except Exception:
                return None, "image-decode-error"
            with self._lock:
                self.images[key] = image
            return image, "ok"
        if not allow_download:
            return None, "tile-unavailable"
        url = tile.get("url")
        if not isinstance(url, str) or not url:
            return None, "tile-unavailable"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "port-cam-plan-ray-cast/1.0"})
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read()
        except Exception:
            return None, "tile-unavailable"
        try:
            image = self._decode(payload)
        except Exception:
            return None, "image-decode-error"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as handle:
                handle.write(payload)
                temporary_path = Path(handle.name)
            os.replace(temporary_path, path)
        except Exception:
            try:
                if "temporary_path" in locals() and temporary_path.exists():
                    temporary_path.unlink()
            except OSError:
                pass
            return None, "tile-unavailable"
        with self._lock:
            self.images[key] = image
        return image, "ok"


def tile_manifest_map(scene: dict[str, Any]) -> dict[TileKey, dict[str, Any]]:
    return {
        TileKey(int(tile["z"]), int(tile["x"]), int(tile["y"])): tile
        for tile in scene["tileSelection"]["tiles"]
    }


class TileSampler:
    def __init__(self, scene: dict[str, Any], tile_cache: TileCache, allow_download: bool, neighborhood: int):
        if neighborhood not in (1, 3, 5, 9):
            raise ValueError("sample neighborhood must be 1, 3, 5 or 9")
        self.scene = scene
        self.cache = tile_cache
        self.allow_download = allow_download
        self.neighborhood = neighborhood
        self.manifest = tile_manifest_map(scene)
        self.tile_size = int(scene["tileSource"].get("tileSizePx", 256))

    def _tile_pixel(self, latitude: float, longitude: float) -> tuple[int, int, int, int]:
        z = int(self.scene["tileSelection"]["zoom"])
        n = 2 ** z
        world_x = ((longitude + 180.0) / 360.0) * n
        latitude = clamp(latitude, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT)
        radians = math.radians(latitude)
        world_y = (1.0 - math.log(math.tan(radians) + 1.0 / math.cos(radians)) / math.pi) / 2.0 * n
        absolute_x = min(n * self.tile_size - 1, max(0, int(math.floor(world_x * self.tile_size))))
        absolute_y = min(n * self.tile_size - 1, max(0, int(math.floor(world_y * self.tile_size))))
        tile_x, tile_y = absolute_x // self.tile_size, absolute_y // self.tile_size
        return tile_x, tile_y, absolute_x % self.tile_size, absolute_y % self.tile_size

    def sample(self, geometry: dict[str, Any]) -> dict[str, Any]:
        if geometry["status"] != "valid":
            return {"rgb": None, "reason": geometry["status"]}
        coordinate = geometry["geographicCoordinate"]
        tile_x, tile_y, pixel_x, pixel_y = self._tile_pixel(
            float(coordinate["latitudeDeg"]), float(coordinate["longitudeDeg"])
        )
        z = int(self.scene["tileSelection"]["zoom"])
        center_key = TileKey(z, tile_x, tile_y)
        if center_key not in self.manifest:
            return {"rgb": None, "reason": "tile-not-in-manifest", "tilePixel": [pixel_x, pixel_y]}
        center_tile = self.manifest[center_key]
        center_image, center_status = self.cache.get(center_tile, self.allow_download)
        if center_image is None:
            return {
                "rgb": None,
                "reason": center_status,
                "tile": {"z": z, "x": tile_x, "y": tile_y},
                "tilePixel": [pixel_x, pixel_y],
            }

        radius = self.neighborhood // 2
        pixels: list[tuple[int, int, int]] = []
        raw_rgb = tuple(int(channel) for channel in center_image.getpixel((pixel_x, pixel_y)))
        for offset_y in range(-radius, radius + 1):
            for offset_x in range(-radius, radius + 1):
                absolute_x = tile_x * self.tile_size + pixel_x + offset_x
                absolute_y = tile_y * self.tile_size + pixel_y + offset_y
                neighbor_x, local_x = divmod(absolute_x, self.tile_size)
                neighbor_y, local_y = divmod(absolute_y, self.tile_size)
                neighbor_key = TileKey(z, neighbor_x, neighbor_y)
                neighbor_tile = self.manifest.get(neighbor_key)
                if neighbor_tile is None:
                    continue
                image, _ = self.cache.get(neighbor_tile, self.allow_download)
                if image is not None:
                    pixels.append(tuple(int(channel) for channel in image.getpixel((local_x, local_y))))
        if not pixels:
            return {"rgb": None, "reason": "tile-unavailable", "tilePixel": [pixel_x, pixel_y]}
        sampled = tuple(int(statistics.median([pixel[index] for pixel in pixels])) for index in range(3))
        details = colour_details(sampled)
        details["rawRgb"] = list(raw_rgb)
        details["neighborhood"] = self.neighborhood
        details["tile"] = {"z": z, "x": tile_x, "y": tile_y}
        details["tilePixel"] = [pixel_x, pixel_y]
        return details


def sample_geometry_results(
    scene: dict[str, Any],
    results: list[dict[str, Any]],
    cache: TileCache,
    allow_download: bool,
    neighborhood: int,
    progress: Optional[Callable[[str, int, int], None]] = None,
) -> None:
    sampler = TileSampler(scene, cache, allow_download, neighborhood)
    total = len(results)
    for index, result in enumerate(results, start=1):
        result["sample"] = sampler.sample(result["geometry"])
        if progress and (index == total or index % max(1, total // 100) == 0):
            progress("tile sampling", index, total)


def classify_results(results: list[dict[str, Any]], config: ClassifierConfig) -> None:
    classifier = WaterClassifier(config)
    for result in results:
        result["classification"] = classifier.classify(result.get("sample"))


def _safe_json_value(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _safe_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe_json_value(item) for item in value]
    return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_config() -> ClassifierConfig:
    return ClassifierConfig()


def config_to_profile(config: ClassifierConfig, tile_source_id: str, name: str = "Water colour profile") -> dict[str, Any]:
    now = utc_now()
    return {
        "schemaVersion": PROFILE_SCHEMA,
        "name": name,
        "tileSourceId": tile_source_id,
        "createdAt": now,
        "updatedAt": now,
        "references": [
            {"label": reference.label, "rgb": list(reference.rgb), "enabled": reference.enabled}
            for reference in config.references
        ],
        "classifier": {
            "colorSpace": "CIELAB",
            "distanceMethod": "CIE76",
            "deltaETolerance": clamp(config.delta_e_tolerance, 0.0, 100.0),
            "hsvGate": {
                "enabled": config.hsv_gate.enabled,
                "hueMinDeg": clamp(config.hsv_gate.hue_min_deg, 0.0, 360.0),
                "hueMaxDeg": clamp(config.hsv_gate.hue_max_deg, 0.0, 360.0),
                "saturationMin": clamp(config.hsv_gate.saturation_min, 0.0, 1.0),
                "saturationMax": clamp(config.hsv_gate.saturation_max, 0.0, 1.0),
                "valueMin": clamp(config.hsv_gate.value_min, 0.0, 1.0),
                "valueMax": clamp(config.hsv_gate.value_max, 0.0, 1.0),
            },
            "sampleNeighborhood": config.sample_neighborhood,
        },
        "rendering": {
            "mode": config.render_mode,
            "waterOverlayOpacity": clamp(config.overlay_opacity, 0.0, 1.0),
        },
    }


def _reject_forbidden_profile_keys(value: Any, path: str = "profile") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = "".join(character for character in str(key).lower() if character.isalnum() or character == "_")
            if normalized in FORBIDDEN_PROFILE_KEYS:
                raise ProfileError(f"profile contains forbidden field: {path}.{key}")
            _reject_forbidden_profile_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_forbidden_profile_keys(child, f"{path}[{index}]")


def profile_to_config(profile: dict[str, Any]) -> ClassifierConfig:
    _reject_forbidden_profile_keys(profile)
    if profile.get("schemaVersion") != PROFILE_SCHEMA:
        raise ProfileError(f"unsupported profile schema; expected {PROFILE_SCHEMA}")
    references_data = profile.get("references")
    classifier = profile.get("classifier")
    rendering = profile.get("rendering") or {}
    if not isinstance(references_data, list) or not isinstance(classifier, dict):
        raise ProfileError("profile requires references and classifier")
    references: list[ReferenceColor] = []
    for index, item in enumerate(references_data):
        if not isinstance(item, dict) or not isinstance(item.get("label"), str):
            raise ProfileError(f"references[{index}] is invalid")
        references.append(ReferenceColor(item["label"], parse_rgb(",".join(str(v) for v in item.get("rgb", []))), bool(item.get("enabled", True))))
    gate_data = classifier.get("hsvGate") or {}
    gate = HSVGate(
        enabled=bool(gate_data.get("enabled", False)),
        hue_min_deg=finite(gate_data.get("hueMinDeg", 0.0), "hsvGate.hueMinDeg"),
        hue_max_deg=finite(gate_data.get("hueMaxDeg", 360.0), "hsvGate.hueMaxDeg"),
        saturation_min=finite(gate_data.get("saturationMin", 0.0), "hsvGate.saturationMin"),
        saturation_max=finite(gate_data.get("saturationMax", 1.0), "hsvGate.saturationMax"),
        value_min=finite(gate_data.get("valueMin", 0.0), "hsvGate.valueMin"),
        value_max=finite(gate_data.get("valueMax", 1.0), "hsvGate.valueMax"),
    )
    neighborhood = int(classifier.get("sampleNeighborhood", DEFAULT_NEIGHBORHOOD))
    if neighborhood not in (1, 3, 5, 9):
        raise ProfileError("sampleNeighborhood must be 1, 3, 5 or 9")
    return ClassifierConfig(
        references=tuple(references),
        delta_e_tolerance=clamp(finite(classifier.get("deltaETolerance", DEFAULT_TOLERANCE), "deltaETolerance"), 0.0, 100.0),
        hsv_gate=gate,
        sample_neighborhood=neighborhood,
        render_mode=str(rendering.get("mode", "overlay")),
        overlay_opacity=clamp(finite(rendering.get("waterOverlayOpacity", DEFAULT_OVERLAY_OPACITY), "waterOverlayOpacity"), 0.0, 1.0),
    )


def load_profile(path: Path) -> tuple[dict[str, Any], ClassifierConfig]:
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProfileError(f"could not read profile: {exc}") from exc
    return profile, profile_to_config(profile)


def save_profile(path: Path, config: ClassifierConfig, tile_source_id: str, name: str = "Water colour profile") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _safe_json_value(config_to_profile(config, tile_source_id, name))
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def _status_rgb(result: dict[str, Any]) -> tuple[int, int, int]:
    sample = result.get("sample") or {}
    if sample.get("rgb"):
        return tuple(int(channel) for channel in sample["rgb"])
    return STATUS_COLORS.get(sample.get("reason") or result.get("geometry", {}).get("status"), STATUS_COLORS["unknown"])


def _blend(first: tuple[int, int, int], second: tuple[int, int, int], opacity: float) -> tuple[int, int, int]:
    return tuple(int(round(a * (1.0 - opacity) + b * opacity)) for a, b in zip(first, second))


def render_images(
    results: list[dict[str, Any]],
    grid: tuple[int, int],
    config: ClassifierConfig,
    previous_classes: Optional[list[str]] = None,
    aspect_ratio: Optional[float] = None,
) -> dict[str, Any]:
    require_pillow()
    width, height = grid
    raw = Image.new("RGB", (width, height))
    mask = Image.new("RGB", (width, height))
    overlay = Image.new("RGB", (width, height))
    confidence = Image.new("RGB", (width, height))
    difference = Image.new("RGB", (width, height))
    raw_pixels, mask_pixels, overlay_pixels, confidence_pixels, difference_pixels = [], [], [], [], []
    for index, result in enumerate(results):
        sample = result.get("sample") or {}
        classification = result.get("classification") or {"class": "unknown"}
        base = _status_rgb(result)
        raw_pixels.append(base)
        if sample.get("rgb"):
            class_name = classification.get("class", "unknown")
            class_rgb = CLASS_COLORS.get(class_name, CLASS_COLORS["unknown"])
            mask_pixels.append(class_rgb)
            overlay_pixels.append(_blend(base, class_rgb, config.overlay_opacity) if class_name == "water" else base)
            score = clamp(float(classification.get("waterScore", 0.0)), 0.0, 1.0)
            confidence_pixels.append((int(45 + 210 * (1.0 - score)), int(50 + 130 * score), int(80 + 160 * score)))
            previous = previous_classes[index] if previous_classes and index < len(previous_classes) else None
            if previous is not None and previous != class_name:
                difference_pixels.append((255, 165, 0))
            else:
                difference_pixels.append(_blend(base, class_rgb, 0.45))
        else:
            status_colour = STATUS_COLORS.get(sample.get("reason", "unknown"), STATUS_COLORS["unknown"])
            mask_pixels.append(status_colour)
            overlay_pixels.append(status_colour)
            confidence_pixels.append(status_colour)
            difference_pixels.append(status_colour)
    raw.putdata(raw_pixels)
    mask.putdata(mask_pixels)
    overlay.putdata(overlay_pixels)
    confidence.putdata(confidence_pixels)
    difference.putdata(difference_pixels)
    mode_images = {
        "raw-rgb": raw,
        "mask": mask,
        "overlay": overlay,
        "confidence": confidence,
        "difference": difference,
    }
    if aspect_ratio and math.isfinite(aspect_ratio) and aspect_ratio > 0:
        target_height = max(1, int(round(width / aspect_ratio)))
        if target_height != height:
            mode_images = {
                key: image.resize((width, target_height), Image.Resampling.NEAREST)
                for key, image in mode_images.items()
            }
    return {
        "raw": mode_images["raw-rgb"],
        "mask": mode_images["mask"],
        "overlay": mode_images["overlay"],
        "confidence": mode_images["confidence"],
        "difference": mode_images["difference"],
        "mode": mode_images.get(config.render_mode, mode_images["overlay"]),
    }


def output_payload(scene: dict[str, Any], grid: tuple[int, int], results: list[dict[str, Any]], config: ClassifierConfig) -> dict[str, Any]:
    payload_results = []
    for result in results:
        sample = result.get("sample") or {}
        payload_results.append({
            "gridIndex": result["geometry"]["gridIndex"],
            "imagePixel": result["geometry"]["imagePixel"],
            "geometry": result["geometry"],
            "sampleColor": {
                key: sample[key]
                for key in ("rgb", "hsv", "lab")
                if key in sample and sample.get(key) is not None
            } if sample.get("rgb") else None,
            "sampleMetadata": {
                key: sample[key]
                for key in ("rawRgb", "neighborhood", "tile", "tilePixel")
                if key in sample
            },
            "waterClassification": result.get("classification") or {"class": "unknown", "reason": sample.get("reason", "no-classification")},
        })
    return _safe_json_value({
        "schemaVersion": "ray-results/1.0",
        "generatedAt": utc_now(),
        "sceneSchemaVersion": scene["schemaVersion"],
        "tileSourceId": scene["tileSource"]["id"],
        "grid": {"width": grid[0], "height": grid[1]},
        "classifier": config_to_profile(config, scene["tileSource"]["id"])["classifier"],
        "rays": payload_results,
    })


def write_report(path: Path, scene: dict[str, Any], results: list[dict[str, Any]], config: ClassifierConfig) -> None:
    counts = {"water": 0, "non-water": 0, "unknown": 0}
    reasons: dict[str, int] = {}
    distances: list[float] = []
    hits: dict[str, int] = {reference.label: 0 for reference in config.enabled_references}
    for result in results:
        classification = result.get("classification") or {"class": "unknown"}
        class_name = classification.get("class", "unknown")
        counts[class_name] = counts.get(class_name, 0) + 1
        if class_name == "unknown":
            reason = classification.get("reason") or (result.get("sample") or {}).get("reason", "unknown")
            reasons[reason] = reasons.get(reason, 0) + 1
        if isinstance(classification.get("minimumDeltaE"), (int, float)):
            distances.append(float(classification["minimumDeltaE"]))
            label = classification.get("matchedReferenceLabel")
            if label in hits:
                hits[label] += 1
    total = len(results) or 1
    lines = [
        "Ray casting water-colour report",
        f"Tile source: {scene['tileSource']['id']}",
        f"Water rays: {counts['water']} ({counts['water'] / total:.2%})",
        f"Non-water rays: {counts['non-water']} ({counts['non-water'] / total:.2%})",
        f"Unknown rays: {counts['unknown']} ({counts['unknown'] / total:.2%})",
        f"DeltaE tolerance: {config.delta_e_tolerance:g}",
        f"HSV gate: {config.hsv_gate}",
        "References:",
    ]
    lines.extend(f"  - {reference.label}: RGB={reference.rgb}, enabled={reference.enabled}, hits={hits.get(reference.label, 0)}" for reference in config.references)
    if distances:
        lines.append(f"DeltaE min/avg/max: {min(distances):.4f} / {statistics.fmean(distances):.4f} / {max(distances):.4f}")
    else:
        lines.append("DeltaE min/avg/max: n/a")
    lines.append(f"Unknown reasons: {reasons or 'none'}")
    lines.append(f"Tile-unavailable unknown count: {reasons.get('tile-unavailable', 0)}")
    lines.append("Note: this is a visual test classification, not survey-grade GIS output.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_outputs(output_dir: Path, scene: dict[str, Any], grid: tuple[int, int], results: list[dict[str, Any]], config: ClassifierConfig, profile_path: Optional[Path] = None) -> None:
    require_pillow()
    output_dir.mkdir(parents=True, exist_ok=True)
    aspect_ratio = float(scene["image"]["widthPx"]) / float(scene["image"]["heightPx"])
    images = render_images(results, grid, config, aspect_ratio=aspect_ratio)
    for name, image in (
        ("ray-preview-raw.png", images["raw"]),
        ("ray-preview-water-mask.png", images["mask"]),
        ("ray-preview-water-overlay.png", images["overlay"]),
        ("ray-preview-confidence.png", images["confidence"]),
    ):
        image.save(output_dir / name, format="PNG")
    (output_dir / "ray-results.json").write_text(
        json.dumps(output_payload(scene, grid, results, config), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    write_report(output_dir / "report.txt", scene, results, config)
    save_profile(output_dir / "water-color-profile.json", config, scene["tileSource"]["id"])
    if profile_path:
        # Keep the explicit input path out of generated metadata; it is only a
        # convenience for the caller and may contain private local paths.
        _ = profile_path


def profile_from_args(args: argparse.Namespace, tile_source_id: str) -> ClassifierConfig:
    if args.color_profile:
        _, config = load_profile(Path(args.color_profile))
    else:
        config = default_config()
    references = list(config.references)
    for item in args.reference_rgb or []:
        references.append(ReferenceColor(args.reference_label, parse_rgb(item), True))
    gate = config.hsv_gate
    if args.hsv_gate:
        gate = HSVGate(
            enabled=True,
            hue_min_deg=args.hue_min,
            hue_max_deg=args.hue_max,
            saturation_min=args.saturation_min,
            saturation_max=args.saturation_max,
            value_min=args.value_min,
            value_max=args.value_max,
        )
    return ClassifierConfig(
        references=tuple(references),
        delta_e_tolerance=args.tolerance if args.tolerance is not None else config.delta_e_tolerance,
        hsv_gate=gate,
        sample_neighborhood=args.sample_neighborhood or config.sample_neighborhood,
        render_mode=args.render_mode or config.render_mode,
        overlay_opacity=args.overlay_opacity if args.overlay_opacity is not None else config.overlay_opacity,
    )


def run_pipeline(
    scene: dict[str, Any],
    grid: tuple[int, int],
    cache_path: Path,
    allow_download: bool,
    config: ClassifierConfig,
    progress: Optional[Callable[[str, int, int], None]] = None,
) -> list[dict[str, Any]]:
    results = build_geometry_results(scene, grid, progress)
    cache = TileCache(cache_path)
    sample_geometry_results(scene, results, cache, allow_download, config.sample_neighborhood, progress)
    classify_results(results, config)
    return results


def run_cli(args: argparse.Namespace) -> int:
    scene = scene_for_run(load_scene(Path(args.scene)), args.tile_zoom)
    grid = parse_grid(args.grid)
    config = profile_from_args(args, scene["tileSource"]["id"])
    print(f"Scene: {args.scene}")
    print(f"Tile source: {scene['tileSource']['id']} / zoom {scene['tileSelection']['zoom']}")
    print(f"Grid: {grid[0]}x{grid[1]} | download tiles: {bool(args.download_tiles and not args.offline)}")

    def progress(stage: str, current: int, total: int) -> None:
        if current == total or current % max(1, total // 10) == 0:
            print(f"{stage}: {current}/{total}")

    results = run_pipeline(
        scene,
        grid,
        Path(args.cache_path),
        bool(args.download_tiles and not args.offline),
        config,
        progress,
    )
    write_outputs(Path(args.output_dir), scene, grid, results, config, Path(args.color_profile) if args.color_profile else None)
    print(f"Output: {Path(args.output_dir).resolve()}")
    return 0


class WaterColorApp:
    """Tkinter UI.  Worker threads only produce data; all widgets are main-thread owned."""

    def __init__(self, root: Any, scene_path: Path, args: argparse.Namespace):
        require_pillow()
        if ImageTk is None:
            raise RuntimeError("Tkinter support is required for --ui; install a Python build with Tk support")
        import tkinter as tk
        from tkinter import filedialog, messagebox, colorchooser

        self.tk = tk
        self.filedialog = filedialog
        self.messagebox = messagebox
        self.colorchooser = colorchooser
        self.root = root
        self.args = args
        self.scene_path = scene_path
        self.scene: Optional[dict[str, Any]] = None
        self.run_scene: Optional[dict[str, Any]] = None
        self.results: Optional[list[dict[str, Any]]] = None
        self.grid = parse_grid(args.grid)
        self.config = default_config()
        self.previous_classes: Optional[list[str]] = None
        self.sample_neighborhood_used: Optional[int] = None
        self.selected_sample: Optional[dict[str, Any]] = None
        self.raw_photo = None
        self.class_photo = None
        self.raw_display_size = (1, 1)
        self.worker_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.worker_token = 0
        self.render_after_id = None
        self.auto_render_var = tk.BooleanVar(value=True)
        self.download_var = tk.BooleanVar(value=bool(args.download_tiles))
        self.offline_var = tk.BooleanVar(value=bool(args.offline))
        self.tolerance_var = tk.DoubleVar(value=DEFAULT_TOLERANCE)
        self.tolerance_text_var = tk.StringVar(value=str(int(DEFAULT_TOLERANCE)))
        self.hsv_enabled_var = tk.BooleanVar(value=False)
        self.hue_min_var = tk.StringVar(value="0")
        self.hue_max_var = tk.StringVar(value="360")
        self.sat_min_var = tk.StringVar(value="0")
        self.sat_max_var = tk.StringVar(value="1")
        self.value_min_var = tk.StringVar(value="0")
        self.value_max_var = tk.StringVar(value="1")
        self.mode_var = tk.StringVar(value="overlay")
        self.opacity_var = tk.DoubleVar(value=DEFAULT_OVERLAY_OPACITY * 100.0)
        self.neighborhood_var = tk.StringVar(value=str(DEFAULT_NEIGHBORHOOD))
        self.ref_label_var = tk.StringVar(value="sample")
        self.ref_rgb_var = tk.StringVar(value="")
        self.cache_var = tk.StringVar(value=args.cache_path)
        self.output_var = tk.StringVar(value=args.output_dir)
        self.status_var = tk.StringVar(value="Ready")
        self.source_var = tk.StringVar(value="No scene loaded")
        self.profile_status_var = tk.StringVar(value="No profile loaded")
        self.selection_var = tk.StringVar(value="Click a valid pixel in Raw RGB preview")
        self._build_widgets()
        self._bind_rerender_variables()
        self.load_scene_path(scene_path, initial=True)
        self.root.after(100, self._poll_worker)

    def _build_widgets(self) -> None:
        tk = self.tk
        self.root.title("Ray Casting Water Colour Test")
        self.root.geometry("1280x900")
        self.root.minsize(980, 700)

        top = tk.LabelFrame(self.root, text="Scene / tile run")
        top.pack(fill="x", padx=8, pady=(8, 4))
        tk.Label(top, text="Scene").grid(row=0, column=0, sticky="w", padx=4, pady=3)
        self.scene_entry = tk.Entry(top, width=55)
        self.scene_entry.grid(row=0, column=1, columnspan=3, sticky="ew", padx=4)
        tk.Button(top, text="Load…", command=self.choose_scene).grid(row=0, column=4, padx=4)
        tk.Label(top, text="Tile source").grid(row=1, column=0, sticky="w", padx=4)
        tk.Label(top, textvariable=self.source_var, anchor="w").grid(row=1, column=1, sticky="ew", padx=4)
        tk.Label(top, text="Zoom").grid(row=1, column=2, sticky="e", padx=4)
        self.zoom_entry = tk.Entry(top, width=7)
        self.zoom_entry.grid(row=1, column=3, sticky="w", padx=4)
        tk.Label(top, text="Grid").grid(row=1, column=4, sticky="e", padx=4)
        self.grid_entry = tk.Entry(top, width=10)
        self.grid_entry.grid(row=1, column=5, sticky="w", padx=4)
        self.run_button = tk.Button(top, text="Run ray casting", command=self.start_run)
        self.run_button.grid(row=0, column=5, padx=4)
        tk.Checkbutton(top, text="Download missing tiles", variable=self.download_var).grid(row=2, column=0, columnspan=2, sticky="w", padx=4)
        tk.Checkbutton(top, text="Offline", variable=self.offline_var, command=self._sync_download_state).grid(row=2, column=2, sticky="w", padx=4)
        tk.Label(top, text="Cache").grid(row=2, column=3, sticky="e", padx=4)
        tk.Entry(top, textvariable=self.cache_var, width=30).grid(row=2, column=4, columnspan=2, sticky="ew", padx=4)
        tk.Label(top, textvariable=self.status_var, anchor="w", fg="#245b8a").grid(row=3, column=0, columnspan=6, sticky="ew", padx=4, pady=3)
        for column in range(6):
            top.columnconfigure(column, weight=1 if column in (1, 4) else 0)

        previews = tk.Frame(self.root)
        previews.pack(fill="both", expand=True, padx=8, pady=4)
        raw_frame = tk.LabelFrame(previews, text="Raw RGB preview (nearest-neighbor)")
        raw_frame.pack(side="left", fill="both", expand=True, padx=(0, 4))
        class_frame = tk.LabelFrame(previews, text="Classification preview")
        class_frame.pack(side="left", fill="both", expand=True, padx=(4, 0))
        self.raw_label = tk.Label(raw_frame, text="No ray result", bg="#202020", anchor="nw")
        self.raw_label.pack(fill="both", expand=True, padx=4, pady=4)
        self.raw_label.bind("<Button-1>", self.on_raw_click)
        self.class_label = tk.Label(class_frame, text="No classification", bg="#202020")
        self.class_label.pack(fill="both", expand=True, padx=4, pady=4)

        controls = tk.Frame(self.root)
        controls.pack(fill="x", padx=8, pady=4)
        refs = tk.LabelFrame(controls, text="Water colour references")
        refs.pack(side="left", fill="both", expand=True, padx=(0, 4))
        self.reference_list = tk.Listbox(refs, height=5, exportselection=False)
        self.reference_list.pack(fill="both", expand=True, padx=4, pady=3)
        ref_entry = tk.Frame(refs)
        ref_entry.pack(fill="x", padx=4)
        tk.Label(ref_entry, text="Label").pack(side="left")
        tk.Entry(ref_entry, textvariable=self.ref_label_var, width=14).pack(side="left", padx=2)
        tk.Label(ref_entry, text="RGB").pack(side="left")
        tk.Entry(ref_entry, textvariable=self.ref_rgb_var, width=13).pack(side="left", padx=2)
        tk.Button(ref_entry, text="Add", command=self.add_reference).pack(side="left", padx=2)
        tk.Button(ref_entry, text="Picker", command=self.pick_reference).pack(side="left", padx=2)
        ref_buttons = tk.Frame(refs)
        ref_buttons.pack(fill="x", padx=4, pady=(0, 3))
        tk.Button(ref_buttons, text="Update selected", command=self.update_reference).pack(side="left", padx=2)
        tk.Button(ref_buttons, text="Toggle", command=self.toggle_reference).pack(side="left", padx=2)
        tk.Button(ref_buttons, text="Remove", command=self.remove_reference).pack(side="left", padx=2)
        tk.Button(ref_buttons, text="Clear all", command=self.clear_references).pack(side="left", padx=2)

        classifier = tk.LabelFrame(controls, text="Classifier / rendering")
        classifier.pack(side="left", fill="both", expand=True, padx=(4, 0))
        tolerance_row = tk.Frame(classifier)
        tolerance_row.pack(fill="x", padx=4, pady=2)
        tk.Label(tolerance_row, text="ΔE tolerance").pack(side="left")
        tk.Scale(tolerance_row, from_=0, to=100, resolution=1, orient="horizontal", variable=self.tolerance_var, command=self.on_tolerance_scale, length=180).pack(side="left", fill="x", expand=True)
        tk.Entry(tolerance_row, textvariable=self.tolerance_text_var, width=6).pack(side="left")
        tk.Label(tolerance_row, text="Neighborhood").pack(side="left", padx=(8, 2))
        tk.OptionMenu(tolerance_row, self.neighborhood_var, "1", "3", "5", "9").pack(side="left")
        hsv_row = tk.Frame(classifier)
        hsv_row.pack(fill="x", padx=4, pady=2)
        tk.Checkbutton(hsv_row, text="HSV gate", variable=self.hsv_enabled_var).pack(side="left")
        for label, variable in (("H", self.hue_min_var), ("H max", self.hue_max_var), ("S", self.sat_min_var), ("S max", self.sat_max_var), ("V", self.value_min_var), ("V max", self.value_max_var)):
            tk.Label(hsv_row, text=label).pack(side="left", padx=(3, 1))
            tk.Entry(hsv_row, textvariable=variable, width=5).pack(side="left")
        render_row = tk.Frame(classifier)
        render_row.pack(fill="x", padx=4, pady=2)
        tk.Label(render_row, text="Mode").pack(side="left")
        tk.OptionMenu(render_row, self.mode_var, "raw-rgb", "mask", "overlay", "confidence", "difference").pack(side="left")
        tk.Label(render_row, text="Overlay opacity").pack(side="left", padx=(8, 2))
        tk.Scale(render_row, from_=0, to=100, orient="horizontal", variable=self.opacity_var, length=140).pack(side="left")
        tk.Checkbutton(render_row, text="Auto re-render", variable=self.auto_render_var).pack(side="left", padx=6)
        self.render_button = tk.Button(render_row, text="Re-render", command=lambda: self.render_now(force=True))
        self.render_button.pack(side="left")

        bottom = tk.Frame(self.root)
        bottom.pack(fill="x", padx=8, pady=(4, 8))
        tk.Label(bottom, textvariable=self.selection_var, anchor="w", justify="left").pack(side="left", fill="x", expand=True)
        tk.Label(bottom, textvariable=self.profile_status_var, anchor="w", fg="#8a5a00").pack(side="left", padx=4)
        tk.Button(bottom, text="Add selected pixel", command=self.add_selected_reference).pack(side="left", padx=3)
        tk.Button(bottom, text="Load profile", command=self.load_profile_dialog).pack(side="left", padx=3)
        tk.Button(bottom, text="Save profile", command=self.save_profile_dialog).pack(side="left", padx=3)
        tk.Button(bottom, text="Export output", command=self.export_output).pack(side="left", padx=3)

    def _bind_rerender_variables(self) -> None:
        for variable in (
            self.tolerance_text_var, self.hsv_enabled_var, self.hue_min_var, self.hue_max_var,
            self.sat_min_var, self.sat_max_var, self.value_min_var, self.value_max_var,
            self.mode_var, self.opacity_var,
        ):
            variable.trace_add("write", lambda *_: self.schedule_render())
        self.neighborhood_var.trace_add("write", lambda *_: self.mark_sample_layer_stale())
        self.zoom_entry.bind("<KeyRelease>", lambda _event: self.mark_run_stale())
        self.grid_entry.bind("<KeyRelease>", lambda _event: self.mark_run_stale())
        self.reference_list.bind("<<ListboxSelect>>", self.on_reference_select)

    def _sync_download_state(self) -> None:
        if self.offline_var.get():
            self.download_var.set(False)

    def choose_scene(self) -> None:
        selected = self.filedialog.askopenfilename(filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if selected:
            self.load_scene_path(Path(selected))

    def load_scene_path(self, path: Path, initial: bool = False) -> None:
        try:
            scene = load_scene(path)
        except Exception as exc:
            self.status_var.set(f"Scene error: {exc}")
            if not initial:
                self.messagebox.showerror("Scene error", str(exc))
            return
        self.worker_token += 1
        self.scene_path = path
        self.scene = scene
        self.scene_entry.delete(0, self.tk.END)
        self.scene_entry.insert(0, str(path))
        self.zoom_entry.delete(0, self.tk.END)
        self.zoom_entry.insert(0, str(scene["tileSelection"]["zoom"]))
        self.grid_entry.delete(0, self.tk.END)
        self.grid_entry.insert(0, f"{self.grid[0]}x{self.grid[1]}")
        self.source_var.set(f"{scene['tileSource']['name']} ({scene['tileSource']['id']})")
        self.status_var.set("Scene loaded; run ray casting to acquire tile RGB samples.")
        self.results = None
        self.run_scene = None
        self.selected_sample = None
        self.sample_neighborhood_used = None
        self.raw_label.configure(image="", text="No ray result")
        self.class_label.configure(image="", text="No classification")

    def mark_run_stale(self) -> None:
        if self.results is not None or self.run_scene is not None:
            self.worker_token += 1
            self.results = None
            self.run_scene = None
            self.selected_sample = None
            self.run_button.configure(state="normal")
            self.raw_label.configure(image="", text="Parameters changed; run ray casting again")
            self.class_label.configure(image="", text="Parameters changed; run ray casting again")
            self.status_var.set("Camera Scene, zoom or grid changed; previous result is expired. Run ray casting again.")

    def mark_sample_layer_stale(self) -> None:
        if self.results is not None or self.run_scene is not None:
            try:
                neighborhood = int(self.neighborhood_var.get())
            except ValueError:
                return
            if neighborhood != self.sample_neighborhood_used:
                self.worker_token += 1
                self.results = None
                self.run_scene = None
                self.selected_sample = None
                self.run_button.configure(state="normal")
                self.raw_label.configure(image="", text="Sampling neighborhood changed; run tile sampling again")
                self.class_label.configure(image="", text="Sampling neighborhood changed; run tile sampling again")
                self.status_var.set("Sampling neighborhood changed; rerun tile sampling to acquire new medians.")

    def _read_run_controls(self) -> tuple[dict[str, Any], tuple[int, int], int]:
        if not self.scene:
            raise SceneError("load a Camera Scene first")
        grid = parse_grid(self.grid_entry.get().strip())
        try:
            zoom = int(self.zoom_entry.get().strip())
        except ValueError:
            raise SceneError("zoom must be an integer") from None
        return scene_for_run(self.scene, zoom), grid, zoom

    def start_run(self) -> None:
        try:
            scene, grid, zoom = self._read_run_controls()
        except Exception as exc:
            self.messagebox.showerror("Run error", str(exc))
            return
        self.grid = grid
        self.run_scene = scene
        self.worker_token += 1
        token = self.worker_token
        self.run_button.configure(state="disabled")
        self.status_var.set(f"Running ray casting at zoom {zoom}…")
        allow_download = bool(self.download_var.get() and not self.offline_var.get())
        cache_path = Path(self.cache_var.get()).expanduser()
        config = self.config_from_controls()

        def progress(stage: str, current: int, total: int) -> None:
            self.worker_queue.put(("progress", (token, stage, current, total)))

        def worker() -> None:
            try:
                results = run_pipeline(scene, grid, cache_path, allow_download, config, progress)
                self.worker_queue.put(("done", (token, scene, grid, results, config.sample_neighborhood)))
            except Exception as exc:  # send the exception to the main thread
                self.worker_queue.put(("error", (token, str(exc))))

        threading.Thread(target=worker, name="ray-cast-worker", daemon=True).start()

    def _poll_worker(self) -> None:
        try:
            while True:
                message, payload = self.worker_queue.get_nowait()
                token = payload[0]
                if token != self.worker_token:
                    continue
                if message == "progress":
                    _, stage, current, total = payload
                    self.status_var.set(f"{stage}: {current}/{total}")
                elif message == "done":
                    _, scene, grid, results, neighborhood_used = payload
                    self.run_scene, self.grid, self.results = scene, grid, results
                    self.sample_neighborhood_used = neighborhood_used
                    self.run_button.configure(state="normal")
                    self.status_var.set("Ray casting and tile sampling complete.")
                    self.previous_classes = None
                    self.render_now(force=True)
                elif message == "error":
                    self.run_button.configure(state="normal")
                    self.status_var.set(f"Run error: {payload[1]}")
                    self.messagebox.showerror("Run error", payload[1])
        except queue.Empty:
            pass
        self.root.after(100, self._poll_worker)

    def config_from_controls(self) -> ClassifierConfig:
        def number(variable: Any, default: float) -> float:
            try:
                return float(variable.get())
            except (TypeError, ValueError):
                return default
        gate = HSVGate(
            enabled=bool(self.hsv_enabled_var.get()),
            hue_min_deg=number(self.hue_min_var, 0.0),
            hue_max_deg=number(self.hue_max_var, 360.0),
            saturation_min=number(self.sat_min_var, 0.0),
            saturation_max=number(self.sat_max_var, 1.0),
            value_min=number(self.value_min_var, 0.0),
            value_max=number(self.value_max_var, 1.0),
        )
        return ClassifierConfig(
            references=tuple(self.config.references),
            delta_e_tolerance=clamp(number(self.tolerance_text_var, self.tolerance_var.get()), 0.0, 100.0),
            hsv_gate=gate,
            sample_neighborhood=int(self.neighborhood_var.get()),
            render_mode=self.mode_var.get(),
            overlay_opacity=clamp(float(self.opacity_var.get()) / 100.0, 0.0, 1.0),
        )

    def on_tolerance_scale(self, value: str) -> None:
        self.tolerance_text_var.set(str(int(round(float(value)))))

    def schedule_render(self) -> None:
        if not self.results or not self.auto_render_var.get():
            return
        if self.render_after_id:
            self.root.after_cancel(self.render_after_id)
        self.render_after_id = self.root.after(75, self.render_now)

    def render_now(self, force: bool = False) -> None:
        if not self.results:
            return
        if not force and not self.auto_render_var.get():
            return
        self.render_after_id = None
        try:
            config = self.config_from_controls()
        except Exception as exc:
            self.status_var.set(f"Classifier settings error: {exc}")
            return
        old_classes = [result.get("classification", {}).get("class", "unknown") for result in self.results]
        self.previous_classes = old_classes if self.previous_classes is None else self.previous_classes
        classify_results(self.results, config)
        aspect_ratio = None
        if self.run_scene:
            aspect_ratio = float(self.run_scene["image"]["widthPx"]) / float(self.run_scene["image"]["heightPx"])
        images = render_images(self.results, self.grid, config, self.previous_classes, aspect_ratio)
        self.config = config
        self._show_image(self.raw_label, images["raw"], raw=True)
        self._show_image(self.class_label, images["mode"], raw=False)
        self._update_stats()
        self.status_var.set("Classification re-rendered from cached RGB samples.")

    def _show_image(self, label: Any, image: Any, raw: bool) -> None:
        available_width = max(200, label.winfo_width() - 8)
        available_height = max(120, label.winfo_height() - 8)
        scale = min(available_width / image.width, available_height / image.height)
        display_width = max(1, int(image.width * scale))
        display_height = max(1, int(image.height * scale))
        display = image.resize((display_width, display_height), Image.Resampling.NEAREST)
        photo = ImageTk.PhotoImage(display)
        label.configure(image=photo, text="")
        if raw:
            self.raw_photo = photo
            self.raw_display_size = (display_width, display_height)
        else:
            self.class_photo = photo

    def _update_stats(self) -> None:
        if not self.results:
            return
        counts = {"water": 0, "non-water": 0, "unknown": 0}
        for result in self.results:
            class_name = (result.get("classification") or {}).get("class", "unknown")
            counts[class_name] = counts.get(class_name, 0) + 1
        total = len(self.results) or 1
        self.selection_var.set(
            f"Stats  water {counts['water']} ({counts['water'] / total:.1%})  |  "
            f"non-water {counts['non-water']} ({counts['non-water'] / total:.1%})  |  "
            f"unknown {counts['unknown']} ({counts['unknown'] / total:.1%})"
        )

    def on_raw_click(self, event: Any) -> None:
        if not self.results:
            return
        display_width, display_height = self.raw_display_size
        if event.x >= display_width or event.y >= display_height:
            return
        x = min(self.grid[0] - 1, max(0, int(event.x / display_width * self.grid[0])))
        y = min(self.grid[1] - 1, max(0, int(event.y / display_height * self.grid[1])))
        self.selected_sample = self.results[y * self.grid[0] + x]
        geometry = self.selected_sample["geometry"]
        sample = self.selected_sample.get("sample") or {}
        classification = self.selected_sample.get("classification") or {}
        coordinate = geometry.get("geographicCoordinate") or {}
        self.selection_var.set(
            f"grid=({x},{y}) pixel={geometry.get('imagePixel')} RGB={sample.get('rgb')} "
            f"HSV={sample.get('hsv')} Lab={sample.get('lab')} "
            f"lat/lon=({coordinate.get('latitudeDeg')},{coordinate.get('longitudeDeg')}) "
            f"tile={sample.get('tile') or geometry.get('tile')} pixel={sample.get('tilePixel')} "
            f"class={classification.get('class', 'unknown')}"
        )
        if sample.get("rgb"):
            self.ref_rgb_var.set(",".join(str(value) for value in sample["rgb"]))

    def add_selected_reference(self) -> None:
        if not self.selected_sample or not (self.selected_sample.get("sample") or {}).get("rgb"):
            self.messagebox.showinfo("Reference colour", "Select a valid tile pixel first.")
            return
        sample = self.selected_sample["sample"]
        self.ref_rgb_var.set(",".join(str(value) for value in sample["rgb"]))
        self.add_reference()

    def add_reference(self) -> None:
        try:
            rgb = parse_rgb(self.ref_rgb_var.get())
        except ValueError as exc:
            self.messagebox.showerror("Reference colour", str(exc))
            return
        label = self.ref_label_var.get().strip() or f"sample {len(self.config.references) + 1}"
        self.config = ClassifierConfig(
            references=self.config.references + (ReferenceColor(label, rgb, True),),
            delta_e_tolerance=self.config.delta_e_tolerance,
            hsv_gate=self.config.hsv_gate,
            sample_neighborhood=self.config.sample_neighborhood,
            render_mode=self.config.render_mode,
            overlay_opacity=self.config.overlay_opacity,
        )
        self.refresh_reference_list()
        self.schedule_render()

    def selected_reference_index(self) -> Optional[int]:
        selection = self.reference_list.curselection()
        return int(selection[0]) if selection else None

    def refresh_reference_list(self) -> None:
        self.reference_list.delete(0, self.tk.END)
        for reference in self.config.references:
            state = "on" if reference.enabled else "off"
            self.reference_list.insert(self.tk.END, f"[{state}] {reference.label} RGB={reference.rgb} HSV={tuple(round(v, 3) for v in reference.hsv)} Lab={tuple(round(v, 2) for v in reference.lab)}")

    def on_reference_select(self, _event: Any = None) -> None:
        index = self.selected_reference_index()
        if index is None:
            return
        reference = self.config.references[index]
        self.ref_label_var.set(reference.label)
        self.ref_rgb_var.set(",".join(str(value) for value in reference.rgb))

    def update_reference(self) -> None:
        index = self.selected_reference_index()
        if index is None:
            return
        try:
            rgb = parse_rgb(self.ref_rgb_var.get())
        except ValueError as exc:
            self.messagebox.showerror("Reference colour", str(exc))
            return
        references = list(self.config.references)
        references[index] = ReferenceColor(self.ref_label_var.get().strip() or "sample", rgb, references[index].enabled)
        self.config = self._config_with_references(references)
        self.refresh_reference_list()
        self.schedule_render()

    def toggle_reference(self) -> None:
        index = self.selected_reference_index()
        if index is None:
            return
        references = list(self.config.references)
        reference = references[index]
        references[index] = ReferenceColor(reference.label, reference.rgb, not reference.enabled)
        self.config = self._config_with_references(references)
        self.refresh_reference_list()
        self.schedule_render()

    def remove_reference(self) -> None:
        index = self.selected_reference_index()
        if index is None:
            return
        references = list(self.config.references)
        references.pop(index)
        self.config = self._config_with_references(references)
        self.refresh_reference_list()
        self.schedule_render()

    def clear_references(self) -> None:
        self.config = self._config_with_references([])
        self.refresh_reference_list()
        self.schedule_render()

    def _config_with_references(self, references: Iterable[ReferenceColor]) -> ClassifierConfig:
        return ClassifierConfig(tuple(references), self.config.delta_e_tolerance, self.config.hsv_gate, self.config.sample_neighborhood, self.config.render_mode, self.config.overlay_opacity)

    def pick_reference(self) -> None:
        chosen = self.colorchooser.askcolor(title="Water reference colour")
        if chosen and chosen[0]:
            self.ref_rgb_var.set(",".join(str(int(round(channel))) for channel in chosen[0]))

    def load_profile_dialog(self) -> None:
        selected = self.filedialog.askopenfilename(filetypes=[("Water profile", "*.json"), ("JSON", "*.json")])
        if not selected:
            return
        try:
            profile, config = load_profile(Path(selected))
        except Exception as exc:
            self.messagebox.showerror("Profile error", str(exc))
            return
        current_source = self.run_scene or self.scene
        source_id = current_source["tileSource"]["id"] if current_source else None
        warning = ""
        if source_id and profile.get("tileSourceId") != source_id:
            warning = f"Profile tile source is {profile.get('tileSourceId')!r}; current source is {source_id!r}. Apply anyway?"
            if not self.messagebox.askyesno("Tile source mismatch", warning):
                return
        self.config = config
        self.profile_status_var.set(f"Loaded profile: {Path(selected).name}" + (" (tile source differs)" if warning else ""))
        self._set_controls_from_config(config)
        self.refresh_reference_list()
        self.schedule_render()

    def _set_controls_from_config(self, config: ClassifierConfig) -> None:
        self.tolerance_var.set(config.delta_e_tolerance)
        self.tolerance_text_var.set(str(config.delta_e_tolerance))
        self.hsv_enabled_var.set(config.hsv_gate.enabled)
        self.hue_min_var.set(str(config.hsv_gate.hue_min_deg))
        self.hue_max_var.set(str(config.hsv_gate.hue_max_deg))
        self.sat_min_var.set(str(config.hsv_gate.saturation_min))
        self.sat_max_var.set(str(config.hsv_gate.saturation_max))
        self.value_min_var.set(str(config.hsv_gate.value_min))
        self.value_max_var.set(str(config.hsv_gate.value_max))
        self.mode_var.set(config.render_mode)
        self.opacity_var.set(config.overlay_opacity * 100.0)
        self.neighborhood_var.set(str(config.sample_neighborhood))

    def save_profile_dialog(self) -> None:
        selected = self.filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("Water profile", "*.json")])
        if not selected:
            return
        source = self.run_scene or self.scene
        if not source:
            self.messagebox.showerror("Profile", "Load a scene first.")
            return
        try:
            self.config = self.config_from_controls()
            save_profile(Path(selected), self.config, source["tileSource"]["id"])
            self.profile_status_var.set(f"Saved profile: {Path(selected).name}")
        except Exception as exc:
            self.messagebox.showerror("Profile error", str(exc))

    def export_output(self) -> None:
        if not self.results or not self.run_scene:
            self.messagebox.showinfo("Export", "Run ray casting first.")
            return
        try:
            config = self.config_from_controls()
            write_outputs(Path(self.output_var.get()), self.run_scene, self.grid, self.results, config)
            self.status_var.set(f"Exported output to {Path(self.output_var.get()).resolve()}")
        except Exception as exc:
            self.messagebox.showerror("Export error", str(exc))


def launch_ui(args: argparse.Namespace) -> int:
    import tkinter as tk
    root = tk.Tk()
    WaterColorApp(root, Path(args.scene), args)
    root.mainloop()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ray-cast a Camera Scene and classify cached tile colours as water/non-water/unknown.")
    parser.add_argument("scene", help="camera-scene/1.1 JSON")
    parser.add_argument("--ui", action="store_true", help="open the local Tkinter/Pillow desktop UI")
    parser.add_argument("--grid", default="160x90", help="ray grid, WIDTHxHEIGHT (default: 160x90)")
    parser.add_argument("--tile-zoom", type=int, help="override tile zoom and rebuild the manifest from the scene footprint")
    parser.add_argument("--download-tiles", action="store_true", help="download missing manifest tiles into the cache")
    parser.add_argument("--offline", action="store_true", help="never download; use only cached tiles")
    parser.add_argument("--cache-path", default=".tile-cache", help="tile cache directory")
    parser.add_argument("--output-dir", default="output", help="output directory")
    parser.add_argument("--color-profile", help="water-color-profile/1.0 JSON")
    parser.add_argument("--reference-rgb", action="append", help="add a water reference RGB, e.g. 65,128,164")
    parser.add_argument("--reference-label", default="CLI sample", help="label for --reference-rgb")
    parser.add_argument("--tolerance", type=float, help="CIE76 DeltaE tolerance, 0..100")
    parser.add_argument("--sample-neighborhood", type=int, choices=(1, 3, 5, 9), help="median sample neighborhood")
    parser.add_argument("--hsv-gate", action="store_true", help="enable HSV gate")
    parser.add_argument("--hue-min", type=float, default=0.0)
    parser.add_argument("--hue-max", type=float, default=360.0)
    parser.add_argument("--saturation-min", type=float, default=0.0)
    parser.add_argument("--saturation-max", type=float, default=1.0)
    parser.add_argument("--value-min", type=float, default=0.0)
    parser.add_argument("--value-max", type=float, default=1.0)
    parser.add_argument("--render-mode", choices=("raw-rgb", "mask", "overlay", "confidence", "difference"))
    parser.add_argument("--overlay-opacity", type=float, help="water overlay opacity, 0..1")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.ui:
            return launch_ui(args)
        return run_cli(args)
    except (SceneError, ProfileError, ValueError, RuntimeError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
