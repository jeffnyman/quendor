import argparse

import quendor.__version__


def process_arguments(args: list) -> None:
    parser = argparse.ArgumentParser(
        prog="quendor",
        description="Execute a zcode program on the Z-Machine",
        epilog="Enjoy your visit to Quendor!",
    )

    parser.add_argument(
        "-v", "--version", action="version", version=f"Version: {quendor.__version__}"
    )

    parser.parse_args(args)
