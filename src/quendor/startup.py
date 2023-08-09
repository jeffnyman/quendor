import sys
from typing import Optional

from quendor import __version__
from quendor.cli import process_arguments


def main(args: Optional[list] = None) -> int:
    print(f"\nQuendor Z-Machine Interpreter (version: {__version__})\n")

    check_python_version()

    if not args:
        args = sys.argv[1:]

    process_arguments(args)

    return 0


def check_python_version() -> None:
    python_version = (
        f"{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}"
    )

    if sys.version_info < (3, 8, 2):
        sys.stderr.write("\nQuendor requires Python 3.8.2 or later.\n")
        sys.stderr.write(f"Your current version is {python_version}\n\n")
        sys.exit(1)
