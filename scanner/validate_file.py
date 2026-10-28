"""Runs in a bounded subprocess before ClamAV; success means parsed allowed format only."""
import resource
import sys
import warnings
from pathlib import Path


def validate(path, mime):
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
    if mime == "application/pdf":
        from pypdf import PdfReader
        if not Path(path).read_bytes()[:8].startswith(b"%PDF-"):
            raise ValueError("invalid_pdf_header")
        reader = PdfReader(path, strict=True)
        if reader.is_encrypted:
            raise ValueError("encrypted_pdf")
        if not 0 < len(reader.pages) <= 1000:
            raise ValueError("pdf_page_limit")
        for page in reader.pages:
            contents = page.get_contents()
            if contents is not None and len(contents.get_data()) > 100 * 1024 * 1024:
                raise ValueError("pdf_content_limit")
    else:
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 20_000_000
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        expected = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}[mime]
        with Image.open(path, formats=[expected]) as image:
            if image.format != expected:
                raise ValueError("mime_mismatch")
            image.verify()
        with Image.open(path, formats=[expected]) as image:
            total_pixels = 0
            frames = getattr(image, "n_frames", 1)
            if frames > 100:
                raise ValueError("image_frame_limit")
            for frame in range(frames):
                image.seek(frame)
                total_pixels += image.width * image.height
                if total_pixels > 40_000_000:
                    raise ValueError("image_pixel_limit")
                image.load()


if __name__ == "__main__":
    try:
        validate(sys.argv[1], sys.argv[2])
    except Exception:
        sys.exit(2)

