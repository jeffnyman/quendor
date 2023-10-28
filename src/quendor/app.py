import logging

from quendor.blorb import Blorb
from quendor.config import Config
from quendor.program import Program


class App:
    def __init__(self, setup: dict) -> None:
        self._program_file: str = setup["program-file"]
        self._resource_file: str = setup["resource-file"]
        self._program_config: dict = {}
        self.program: Program

    def initialize(self) -> None:
        self._setup_quendor()
        self._read_config()

        self._read_blorb_config()
        self._check_blorb_list()

    def _setup_quendor(self) -> None:
        self.program = Program(self._program_file)
        self.program.details()

        # A resource file which doesn't contain an executable chunk can only
        # be used in tandem with an executable file. The interpreter must be
        # given both the resource file and the executable file in order to
        # begin interpreting.

        if self._resource_file:
            resource_file = Blorb.locate(self._resource_file)
            self.program.blorbs.append(
                Blorb(resource_file.read_bytes(), self.program.data)
            )

    def _read_config(self) -> None:
        config = Config(self.program.data)
        config.locate()
        config.read()
        config.set_program_id()

        default_config = config.get_values(config.get_defaults())
        self._program_config = config.get_values(config.get_program_id())

        # Any configuration settings that aren't specific to a
        # program will use the defaults.

        for key in self._program_config:
            if self._program_config[key] == "":
                self._program_config[key] = default_config[key]

    def _read_blorb_config(self) -> None:
        if self._program_config["blorb"] != "":
            resource_file = Blorb.locate(self._program_config["blorb"])
            self.program.blorbs.append(Blorb(resource_file.read_bytes()))

    def _check_blorb_list(self) -> None:
        # It's possible that a blorb will be specified multiple times. If
        # that's the case, any blorbs with exactly equivalent byte data
        # should be removed. In terms of defensive logic, a second loop
        # is provided that reverses the iteration order for removing
        # items so that removing items from the list doesn't impact the
        # indices of remaining items.

        blorbs_to_remove = []

        for first_blorb in range(len(self.program.blorbs)):
            for second_blorb in range(first_blorb + 1, len(self.program.blorbs)):
                if (
                    self.program.blorbs[first_blorb]._data
                    == self.program.blorbs[second_blorb]._data
                ):
                    logging.warning(
                        "Byte data match found between blorbs in the list. "
                        "Removing duplicates."
                    )
                    blorbs_to_remove.append(second_blorb)

        for index in reversed(blorbs_to_remove):
            self.program.blorbs.pop(index)
