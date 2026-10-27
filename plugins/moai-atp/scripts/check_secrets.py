#!/usr/bin/env python3
"""Scan the exact staged bytes; print locations/rules only, never matched values.

Heuristic secret/privacy gate, not a proof that arbitrary prose contains no PII.
Synthetic literals must be recognizable; test paths do not bypass token rules.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

STRONG = {
    'private_key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'github_token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'openai_key': re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b'),
    'aws_key': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'jwt': re.compile(rb'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b'),
    'credential_url': re.compile(rb'https?://[^\s/"\x27]+:[^\s/@"\x27]+@'),
}
ASSIGNMENT = re.compile(rb'''(?i)["']?(?:app[_-]?key|app[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|authorization)["']?\s*[:=]\s*["']([^"'\r\n]{8,})["']''')
ACCOUNT = re.compile(rb'''(?i)["']?(?:cano|acnt_prdt_cd|account[_-]?(?:number|id)|resident[_-]?number)["']?\s*[:=]\s*["']([0-9-]{2,})["']''')
SYNTHETIC = re.compile(rb'(?i)synthetic|fixture|example|placeholder|redacted|mock|test[_-]|not[_-]a[_-]real')

def findings_for(path, data):
    found = []
    parts = Path(path).parts
    if any(x in parts for x in ['.goose', 'keystore', 'node_modules', 'dist', 'project-docs', 'review', 'tools', 'moai-atp-0.1.0-rc.23']) or Path(path).name.startswith('.env'):
        found.append({'path': path, 'line': 0, 'rule': 'excluded_path'})
    if b'\0' in data:
        found.append({'path': path, 'line': 0, 'rule': 'unexpected_binary'})
        return found
    for rule, pattern in STRONG.items():
        for match in pattern.finditer(data):
            found.append({'path': path, 'line': data[:match.start()].count(b'\n') + 1, 'rule': rule})
    for rule, pattern in [('credential_literal', ASSIGNMENT), ('account_literal', ACCOUNT)]:
        for match in pattern.finditer(data):
            # Only explicit, recognizable synthetic values are exempt, not files.
            if SYNTHETIC.search(match.group(1)):
                continue
            found.append({'path': path, 'line': data[:match.start()].count(b'\n') + 1, 'rule': rule})
    return found

def staged_files(root):
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).split(b'\0')
    for raw in paths:
        if raw:
            path = raw.decode('utf-8')
            mode = subprocess.check_output(['git', 'ls-files', '-s', '--', path], cwd=root).decode().split()[0]
            if mode not in ['100644', '100755']:
                yield path, b'\0'
            else:
                yield path, subprocess.check_output(['git', 'show', ':' + path], cwd=root)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--staged', action='store_true', required=True)
    args = parser.parse_args()
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel']).decode().strip())
    files = list(staged_files(root))
    exceptions = json.loads(subprocess.check_output(['git', 'show', ':oss/scripts/synthetic-scan-exceptions.json'], cwd=root))
    found, reviewed = [], []
    for path, data in files:
        lines = data.splitlines()
        for item in findings_for(path, data):
            line = item['line']
            digest = hashlib.sha256(lines[line-1]).hexdigest() if 0 < line <= len(lines) else ''
            approved = next((e for e in exceptions if e['path'] == path and e['rule'] == item['rule'] and e['line_sha256'] == digest), None)
            (reviewed if approved else found).append(item)
    print(json.dumps({'scanner': 'moai-atp-staged-heuristics-v1', 'files_scanned': len(files), 'bytes_scanned': sum(len(data) for _, data in files), 'findings': found, 'reviewed_synthetic_negatives': reviewed, 'limitations': 'Heuristic content scan; human review still required for arbitrary personal prose. Exceptions pin exact reviewed test-line bytes; test directories are not excluded.'}, indent=2))
    return 1 if found or not files else 0

if __name__ == '__main__':
    sys.exit(main())
