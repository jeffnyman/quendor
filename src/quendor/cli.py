import argparse


def process_arguments(args: list) -> None:
    parser = argparse.ArgumentParser(
        prog="quendor",
        description="Execute a zcode program on the Z-Machine",
        epilog="Enjoy your visit to Quendor!",
    )

    parser.parse_args(args)
