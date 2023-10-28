import os
import re
import logging
from pathlib import Path
from typing import Optional


class Config:
    def __init__(self, program_data: bytes) -> None:
        self._data: bytes = program_data
        self._file: Optional[Path] = None
        self._contents: str = ""
        self._identifier: str = ""

    def locate(self) -> None:
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

    def get_values(self, default_data: str) -> dict:
        configs: dict = {}

        configs["title"] = self._read_title(default_data)
        configs["width"] = self._read_width(default_data)
        configs["height"] = self._read_height(default_data)
        configs["blorb"] = self._read_blorb(default_data)
        configs["terpnum"] = self._read_terpnum(default_data)

        return configs

    def set_program_id(self) -> None:
        release = (self._data[2] << 8) + self._data[3]
        serial = self._data[0x12:0x18].decode("latin-1")
        self._identifier = str(release) + "." + serial

    def get_program_id(self) -> str:
        text = re.escape(self._identifier)
        expression = r"id:[\s\w\.]*" + text + ".*?(^%%|\\Z)"

        return self._search_regex(expression)

    def get_defaults(self) -> str:
        expression = r".*?(^%%|\Z)"

        return self._search_regex(expression)

    def read(self) -> None:
        if self._file:
            with open(self._file, "r") as config:
                self._contents = config.read()

    def _read_title(self, default_data: str) -> str:
        expression = r"title:.*?$"
        return self._read_config(expression, 6, default_data)

    def _read_width(self, default_data: str) -> str:
        expression = r"width:.*?$"
        return self._read_config(expression, 6, default_data)

    def _read_height(self, default_data: str) -> str:
        expression = r"height:.*?$"
        return self._read_config(expression, 7, default_data)

    def _read_blorb(self, default_data: str) -> str:
        expression = r"blorb:.*?$"
        return self._read_config(expression, 6, default_data)

    def _read_terpnum(self, default_data: str) -> str:
        expression = r"terpnum:.*?$"
        return self._read_config(expression, 8, default_data)

    def _read_config(self, expression: str, key: int, default_data: str) -> str:
        regex = re.compile(expression, re.M)
        match = regex.search(default_data)

        if match is None:
            return ""

        return match.string[match.start() + key : match.end()].strip()

    def _search_regex(self, expression: str) -> str:
        regex = re.compile(expression, re.M | re.S)
        match = regex.search(self._contents)

        if match is not None:
            return match.string[match.start() : match.end()]

        return ""
