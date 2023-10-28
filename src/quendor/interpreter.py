from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from quendor.app import App

from quendor.zmachine.cpu import Cpu
from quendor.zmachine.memory import Memory


class Interpreter:
    def __init__(self, app: "App") -> None:
        self._app: App = app
        self._program = self._app.program

        # The CPU will need to get the pc to start executing at.
        # The pc comes from the header.
        # The header is part of memory.
        # There's a need to read varous values from memory.

        Memory(self._program.data)
        Cpu()
