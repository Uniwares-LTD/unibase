import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('candidate',Path(__file__).resolve().parents[2]/'scripts/deploy/candidate.py')
candidate=importlib.util.module_from_spec(spec);spec.loader.exec_module(candidate)

class CandidateTests(unittest.TestCase):
 def test_resume_binds_both_commit_and_repository(self):
  value={'sourceCommit':'a'*40,'image':'ghcr.io/example/app@sha256:'+'b'*64}
  self.assertEqual(candidate.validate(value,'a'*40,'Example/App'),value)
  for commit,repo in [('c'*40,'example/app'),('a'*40,'example/other')]:
   with self.assertRaises(ValueError):candidate.validate(value,commit,repo)
