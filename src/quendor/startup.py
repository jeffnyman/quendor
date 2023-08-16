import sys
import logging
from typing import Optional

from quendor import __version__
from quendor.cli import process_arguments
from quendor.blorb import Blorb
from quendor.config import Config
from quendor.program import Program


def main(args: Optional[list] = None) -> int:
    print(f"\nQuendor Z-Machine Interpreter (version: {__version__})\n")

    check_python_version()

    if not args:
        args = sys.argv[1:]

    cli = process_arguments(args)
    setup_logging(cli["log"])
    display_arguments(cli)

    program = setup_quendor(cli)
    program_config = read_config(program)
    read_blorb_config(program_config, program.blorbs)

    return 0


def read_config(program: Program) -> dict:
    config = Config(program.data)
    config.read()
    config.set_program_id()
    default_config = config.get_values(config.get_defaults())
    program_config = config.get_values(config.get_program_id())

    # Any configuration settings that aren't specific to a
    # program will use the defaults.

    for key in program_config:
        if program_config[key] == "":
            program_config[key] = default_config[key]

    return program_config


def read_blorb_config(program_config: dict, program_blorbs: list) -> None:
    print(program_blorbs)

    if program_config["blorb"] != "":
        print(program_config["blorb"])
        _ = Blorb.locate(program_config["blorb"])


def setup_quendor(cli: dict) -> Program:
    program = Program(cli["program"])
    program.details()

    # A resource file which doesn't contain an executable chunk can only
    # be used in tandem with an executable file. The interpreter must be
    # given both the resource file and the executable file in order to
    # begin interpreting.

    if cli["resource-file"]:
        resource_file = Blorb.locate(cli["resource-file"])
        program.blorbs.append(Blorb(resource_file.read_bytes(), program.data))

    return program


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
