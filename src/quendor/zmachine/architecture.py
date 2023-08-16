from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from quendor.program import Program


class Architecture:
    def __init__(self, program: "Program") -> None:
        self._program: Program = program
