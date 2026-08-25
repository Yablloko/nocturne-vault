from pathlib import Path
from PIL import Image, ImageDraw


def scaled(value: int, size: int) -> int:
    return round(value * size / 256)


def make_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (scaled(8, size), scaled(8, size), scaled(248, size), scaled(248, size)),
        radius=scaled(58, size),
        fill=(35, 39, 41, 255),
    )
    draw.rounded_rectangle(
        (scaled(56, size), scaled(54, size), scaled(200, size), scaled(210, size)),
        radius=scaled(42, size),
        fill=(58, 76, 85, 255),
        outline=(116, 137, 146, 255),
        width=max(1, scaled(3, size)),
    )
    stroke = max(2, scaled(13, size))
    draw.arc(
        (scaled(85, size), scaled(66, size), scaled(171, size), scaled(151, size)),
        180,
        360,
        fill=(218, 226, 229, 255),
        width=stroke,
    )
    draw.rounded_rectangle(
        (scaled(78, size), scaled(116, size), scaled(178, size), scaled(184, size)),
        radius=scaled(20, size),
        outline=(218, 226, 229, 255),
        width=stroke,
    )
    draw.ellipse(
        (scaled(119, size), scaled(140, size), scaled(137, size), scaled(158, size)),
        fill=(218, 226, 229, 255),
    )
    draw.rounded_rectangle(
        (scaled(124, size), scaled(151, size), scaled(132, size), scaled(169, size)),
        radius=scaled(4, size),
        fill=(218, 226, 229, 255),
    )
    return image


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "assets"
    output.mkdir(parents=True, exist_ok=True)
    large = make_icon(256)
    large.save(output / "nocturne.png")
    large.save(output / "nocturne.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
