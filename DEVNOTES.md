- Multiple locate() methods.

There is a `locate()` method in the `Program` module and one in the `Blorb` module. Maybe these should be factored out?

- Handling inncosistent programs.

The Blorb spec says "If an interpreter is handed inconsistent arguments – that is, a resource file with no executable chunk, or a resource file with an executable chunk plus an executable file – it should complain righteously to the user."

I handle the first case but I don't handle the second. An example here would be sending zork1.z3 and zork1.zblorb. Should I handle this situation?
