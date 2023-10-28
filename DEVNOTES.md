- Handling inconsistent programs.

The Blorb spec says "If an interpreter is handed inconsistent arguments – that is, a resource file with no executable chunk, or a resource file with an executable chunk plus an executable file – it should complain righteously to the user."

I handle the first case but I don't handle the second. An example here would be sending zork1.z3 and zork1.zblorb. Should I handle this situation?

- IFhd mismatch.

The Blorb spec says: "The interpreter may want to provide a way for the user to ignore or skip this error."
Should I even make this an exception or just a warning?
