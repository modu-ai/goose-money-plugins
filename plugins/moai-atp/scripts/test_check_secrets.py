import unittest
from pathlib import Path
from check_secrets import findings_for

class SecretGateTests(unittest.TestCase):
    def test_secret_in_test_file_still_blocks(self):
        token = b'ghp_' + b'A'*36
        self.assertTrue(findings_for('oss/server/test/example.ts', token))
    def test_known_synthetic_value_is_allowed(self):
        self.assertEqual(findings_for('oss/server/test/example.ts', b'apiKey="synthetic-fixture-value"'), [])
    def test_account_number_blocks(self):
        self.assertTrue(findings_for('oss/src/example.ts', b'accountNumber="12345678-01"'))
    def test_private_paths_block_even_empty_files(self):
        self.assertTrue(findings_for('project-docs/profile.json', b'{}'))
    def test_private_key_and_binary_block(self):
        self.assertTrue(findings_for('oss/invalid.txt', b'-----BEGIN PRIVATE KEY-----'))
        self.assertTrue(findings_for('oss/invalid.dat', b'\x00'))
    def test_ordinary_source_passes(self):
        self.assertEqual(findings_for('oss/src/file.ts', b'const enabled = false;'), [])
    def test_reviewed_wordmark_is_allowed_only_at_its_exact_path_and_digest(self):
        path = 'plugins/moai-atp/server/assets/report-runtime/artboard-wordmark.webp'
        data = (Path(__file__).resolve().parents[1] / 'server/assets/report-runtime/artboard-wordmark.webp').read_bytes()
        self.assertEqual(findings_for(path, data), [])
        for name, content in [(path, data + b'changed'), ('other.webp', data), (path, b'\0')]:
            with self.subTest(path=name, size=len(content)):
                self.assertTrue(any(item['rule'] == 'unexpected_binary' for item in findings_for(name, content)))

if __name__ == '__main__':
    unittest.main()
