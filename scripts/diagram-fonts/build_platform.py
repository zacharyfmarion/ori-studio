"""The platform whose CJK outlines were published as Diagram v1."""
import platform


def require_cjk_build_platform(system=None, machine=None):
    system = platform.system() if system is None else system
    machine = platform.machine() if machine is None else machine
    if (system, machine) != ('Linux', 'x86_64'):
        raise RuntimeError(
            'Diagram v1 CJK fonts must be built on Linux x86_64: skia-pathops '
            'produces different outlines on other platforms. Copy the verified '
            'CI font assets for local use, then run check_fonts.py. '
            'Use --skip-cjk to build only Latin fonts.'
        )
