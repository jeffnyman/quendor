import os
import logging
from pathlib import Path


class Config:
    def __init__(self, program_data: bytes) -> None:
        self._data: bytes = program_data
        self._file: Path
        self._contents: str = ""

        self._locate()

    def read(self) -> None:
        if self._file:
            with open(self._file, "r") as config:
                self._contents = config.read()

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
