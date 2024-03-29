import sys
import logging
from typing import Optional

from quendor import __version__
from quendor.cli import process_arguments
from quendor.interpreter import Interpreter

from quendor.app import App


def main(args: Optional[list] = None) -> int:
    print(f"\nQuendor Z-Machine Interpreter (version: {__version__})\n")

    check_python_version()

    if not args:
        args = sys.argv[1:]

    cli = process_arguments(args)
    setup_logging(cli["log"])
    display_arguments(cli)

    app = App(cli)
    app.initialize()
    Interpreter(app)

    return 0


def setup_logging(log_level: str) -> None:
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M",
    )


def display_arguments(args: dict) -> None:
    logging.debug(f"Argument count: {'':>4}" + str(len(args)))

    for i, arg in enumerate(args):
        logging.debug(f"Argument {i}: {'':>8}" + arg)

    logging.debug(f"Parsed arguments: {'':>2}" + f"{args}")


def check_python_version() -> None:
    python_version = (
        f"{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}"
    )

    if sys.version_info < (3, 8, 2):
        sys.stderr.write("\nQuendor requires Python 3.8.2 or later.\n")
        sys.stderr.write(f"Your current version is {python_version}\n\n")
        sys.exit(1)
