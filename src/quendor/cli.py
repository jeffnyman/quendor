import argparse

import quendor.__version__

log_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]


def process_arguments(args: list) -> None:
    parser = argparse.ArgumentParser(
        prog="quendor",
        description="Execute a zcode program on the Z-Machine",
        epilog="Enjoy your visit to Quendor!",
    )

    parser.add_argument(
        "--log",
        default="ERROR",
        const="ERROR",
        nargs="?",
        metavar="LEVEL",
        choices=log_levels,
        help="level of logging to display (default: %(default)s). Levels: "
        + ", ".join(log_levels),
    )

    parser.add_argument(
        "-v", "--version", action="version", version=f"Version: {quendor.__version__}"
    )

    parser.parse_args(args)
