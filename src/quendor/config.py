import os
import re
import logging
from pathlib import Path


class Config:
    def __init__(self, program_data: bytes) -> None:
        self._data: bytes = program_data
        self._file: Path
        self._contents: str = ""

        self._locate()

    def get_values(self, default_data: str) -> list:
        configs = []

        configs.append(self._read_title(default_data))

        return configs

    def get_defaults(self) -> str:
        # The defaults in the configuration file are any entries at
        # the start of the file up to the first "%%" characters.

        expression = r".*?(^%%|\Z)"

        # The re.M flag enables multiline matching.
        # The re.S flag enables dot-all matching.

        regex = re.compile(expression, re.M | re.S)

        match = regex.search(self._contents)

        if match is not None:
            return match.string[match.start() : match.end()]

        return ""

    def read(self) -> None:
        if self._file:
            with open(self._file, "r") as config:
                self._contents = config.read()

    def _read_title(self, default_data: str) -> str:
        expression = r"title:.*?$"
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return ""

        return match.string[match.start() + 6 : match.end()].strip()

    def _locate(self) -> None:
        paths = [
            Path.cwd(),
            Path.home(),
            Path(os.path.expandvars("$QUENDOR_PATH")),
        ]

        paths = [Path(path) for path in paths]

        for path in paths:
            logging.info(f"Checking: {Path(path).joinpath('.quendor')}")

            file_path = path.joinpath(".quendor")

            if file_path.is_file():
                self._file = file_path
                return

        checked_paths = "\n\t".join([a.as_posix() for a in paths])

        logging.warning(
            f"\nUnable to locate a .quendor config file."
            f"\n\nChecked in:\n\t{checked_paths}"
        )
