import os
import re
import logging
from pathlib import Path
from typing import List, Union


class Config:
    def __init__(self, program_data: bytes) -> None:
        self._data: bytes = program_data
        self._file: Path
        self._contents: str = ""
        self._identifier: str = ""

        self._locate()

    def get_values(self, default_data: str) -> list:
        configs: List[Union[str, int]] = []

        configs.append(self._read_title(default_data))
        configs.append(self._read_width(default_data))
        configs.append(self._read_height(default_data))
        configs.append(self._read_blorb(default_data))
        configs.append(self._read_terpnum(default_data))

        return configs

    def set_program_id(self) -> None:
        release = (self._data[2] << 8) + self._data[3]
        serial = self._data[0x12:0x18].decode("latin-1")
        self._identifier = str(release) + "." + serial

    def get_program_id(self) -> str:
        # PLACEDHOLDER: Need an identifier from the program file first.
        return ""

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

    def _read_width(self, default_data: str) -> int:
        expression = r"width:.*?$"
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return 0

        return int(match.string[match.start() + 6 : match.end()].strip())

    def _read_height(self, default_data: str) -> int:
        expression = r"height:.*?$"
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return 0

        return int(match.string[match.start() + 7 : match.end()].strip())

    def _read_blorb(self, default_data: str) -> str:
        expression = r"blorb:.*?$"
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return ""

        return match.string[match.start() + 6 : match.end()].strip()

    def _read_terpnum(self, default_data: str) -> str:
        expression = r"terpnum:.*?$"
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return ""

        return match.string[match.start() + 8 : match.end()].strip()

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
