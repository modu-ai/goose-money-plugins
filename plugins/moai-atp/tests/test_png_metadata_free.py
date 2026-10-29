"""t39: the two shipped PNG assets carry no metadata chunk and no email-shaped bytes.

Pins the exact post-removal file hashes and the pixel-data digest (IHDR body plus concatenated IDAT bodies)
measured from the originals, which proves the pixels are unchanged. Reads repository files only; no network,
no credentials. Run: python3 -m unittest plugins/moai-atp/tests/test_png_metadata_free.py
"""
import hashlib
import re
import struct
import sys
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
sys.path.insert(0, str(PLUGIN / 'scripts'))
import build_runtime_bundle as bundle  # noqa: E402

SIGNATURE = b'\x89PNG\r\n\x1a\n'
EMAIL = re.compile(rb'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')

# relative path -> (pinned whole-file sha256, pinned pixel-data digest measured from the originals)
ASSETS = {
    'assets/modu-stock-plugin-icon-square.png': (
        'f8b6e1fd48b693643232a46be6969ad585ef5dc8f34a2f06c417868b2a206166',
        'fb9e9403db36b5853c1e0d957c48c03baf9a29fb1e352b315d5c5a0dacb69a8d'),
    'server/assets/report-runtime/stock-sample-logo.png': (
        '5c4f5d9ca5e04e3bf42bd686602de399b997aa8e5020710f547bc9520511036b',
        'a863edf51a0a89c48189c06d97a446ae59ab363aebe1026e75b22b31f4aef14b'),
}


def read_chunks(data):
    """Return [(kind, body)] after verifying the signature, every length and every CRC."""
    if data[:8] != SIGNATURE:
        raise AssertionError('bad PNG signature')
    position, chunks = 8, []
    while position < len(data):
        length, = struct.unpack('>I', data[position:position + 4])
        kind = data[position + 4:position + 8]
        body = data[position + 8:position + 8 + length]
        stored, = struct.unpack('>I', data[position + 8 + length:position + 12 + length])
        if len(body) != length or zlib.crc32(kind + body) != stored:
            raise AssertionError('bad chunk length or CRC: %r' % kind)
        chunks.append((kind, body))
        position += 12 + length
    return chunks


def pixel_digest(chunks):
    return hashlib.sha256(chunks[0][1] + b''.join(body for kind, body in chunks if kind == b'IDAT')).hexdigest()


class PngMetadataFree(unittest.TestCase):
    def test_every_asset_is_structurally_valid_and_metadata_free(self):
        for relative, (new_sha, pixel_sha) in ASSETS.items():
            with self.subTest(asset=relative):
                data = (PLUGIN / relative).read_bytes()
                chunks = read_chunks(data)
                kinds = [kind for kind, _ in chunks]
                self.assertEqual(kinds[0], b'IHDR')
                self.assertEqual(kinds[-1], b'IEND')
                self.assertTrue(kinds[1:-1] and all(kind == b'IDAT' for kind in kinds[1:-1]), kinds)
                self.assertNotIn(b'caBX', kinds)
                self.assertEqual(len(EMAIL.findall(data)), 0)
                self.assertEqual(hashlib.sha256(data).hexdigest(), new_sha)
                self.assertEqual(pixel_digest(chunks), pixel_sha)

    def test_bundle_builder_pins_equal_the_file_hashes(self):
        source = (PLUGIN / 'scripts' / 'build_runtime_bundle.py').read_text(encoding='utf-8')
        for relative, (new_sha, _) in ASSETS.items():
            with self.subTest(asset=relative):
                self.assertEqual(hashlib.sha256((PLUGIN / relative).read_bytes()).hexdigest(), new_sha)
                self.assertIn("'%s':'%s'" % (relative, new_sha), source)
        self.assertTrue(hasattr(bundle, 'build'))


if __name__ == '__main__':
    unittest.main()
