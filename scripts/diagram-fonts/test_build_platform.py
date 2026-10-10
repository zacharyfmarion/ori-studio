import unittest
from unittest.mock import patch

from build_platform import require_cjk_build_platform


class BuildPlatformTests(unittest.TestCase):
    def test_published_platform_is_accepted(self):
        require_cjk_build_platform('Linux', 'x86_64')

    def test_other_platforms_cannot_overwrite_the_published_set(self):
        for system, machine in [('Darwin', 'arm64'), ('Darwin', 'x86_64'), ('Linux', 'aarch64'), ('Windows', 'AMD64')]:
            with self.subTest(system=system, machine=machine):
                with self.assertRaisesRegex(RuntimeError, 'Copy the verified CI font assets'):
                    require_cjk_build_platform(system, machine)

    def test_checks_the_actual_host_by_default(self):
        with patch('build_platform.platform.system', return_value='Darwin'), patch('build_platform.platform.machine', return_value='arm64'):
            with self.assertRaises(RuntimeError):
                require_cjk_build_platform()


if __name__ == '__main__':
    unittest.main()
